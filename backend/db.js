'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || '/var/lib/gemeindeverwaltung';
const DB_PATH = path.join(DATA_DIR, 'data.db');
const ATTACH_DIR = path.join(DATA_DIR, 'attachments');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ATTACH_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sitzungen (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mitglieder (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id          TEXT PRIMARY KEY,
    sitzung_id  TEXT NOT NULL,
    filename    TEXT NOT NULL,
    mimetype    TEXT NOT NULL,
    size        INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_att_sitzung ON attachments(sitzung_id);

  -- Modul Vermietung (Gemeindehaus & Jugendraum)
  CREATE TABLE IF NOT EXISTS mieter (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS raeume (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vermietungen (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_verm_modified ON vermietungen(last_modified);
  -- Zählerstand-Fotos zu einer Vermietung (Beweisführung; kind = stromStart/stromEnde/gasStart/gasEnde)
  CREATE TABLE IF NOT EXISTS vermietung_files (
    id            TEXT PRIMARY KEY,
    vermietung_id TEXT NOT NULL,
    kind          TEXT NOT NULL,
    filename      TEXT NOT NULL,
    mimetype      TEXT NOT NULL,
    size          INTEGER NOT NULL,
    uploaded_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vermfile_verm ON vermietung_files(vermietung_id);

  -- Modul Bargeldauslagen (Empfänger, Haushaltsstellen, Auslagen)
  CREATE TABLE IF NOT EXISTS empfaenger (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS haushaltsstellen (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auslagen (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auslagen_modified ON auslagen(last_modified);
  -- Beleg-Scans zu Auslagen (analog attachments, aber an auslage_id gebunden)
  CREATE TABLE IF NOT EXISTS beleg_files (
    id          TEXT PRIMARY KEY,
    auslage_id  TEXT NOT NULL,
    filename    TEXT NOT NULL,
    mimetype    TEXT NOT NULL,
    size        INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_beleg_auslage ON beleg_files(auslage_id);
`);

const BELEG_DIR = path.join(ATTACH_DIR, 'auslagen');
fs.mkdirSync(BELEG_DIR, { recursive: true });

const VERM_FILE_DIR = path.join(ATTACH_DIR, 'vermietung');
fs.mkdirSync(VERM_FILE_DIR, { recursive: true });

function nowIso() { return new Date().toISOString(); }

// --- Sitzungen ---
function listSitzungen() {
  return db.prepare('SELECT payload FROM sitzungen').all().map(r => JSON.parse(r.payload));
}
function getSitzung(id) {
  const r = db.prepare('SELECT payload FROM sitzungen WHERE id = ?').get(id);
  return r ? JSON.parse(r.payload) : null;
}
function saveSitzung(sitzung) {
  if (!sitzung || !sitzung.id) throw new Error('sitzung.id fehlt');
  if (!sitzung.lastModifiedAt) sitzung.lastModifiedAt = nowIso();
  db.prepare(`
    INSERT INTO sitzungen (id, payload, last_modified) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, last_modified = excluded.last_modified
  `).run(sitzung.id, JSON.stringify(sitzung), sitzung.lastModifiedAt);
  return sitzung;
}
function deleteSitzung(id) {
  // Anhänge auf Disk wegräumen
  const dir = path.join(ATTACH_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM attachments WHERE sitzung_id = ?').run(id);
  db.prepare('DELETE FROM sitzungen WHERE id = ?').run(id);
}

// --- Mitglieder ---
function listMitglieder() {
  return db.prepare('SELECT payload FROM mitglieder').all().map(r => JSON.parse(r.payload));
}
function getMitglied(id) {
  const r = db.prepare('SELECT payload FROM mitglieder WHERE id = ?').get(id);
  return r ? JSON.parse(r.payload) : null;
}
function saveMitglied(m) {
  if (!m || !m.id) throw new Error('mitglied.id fehlt');
  if (!m.lastModifiedAt) m.lastModifiedAt = nowIso();
  db.prepare(`
    INSERT INTO mitglieder (id, payload, last_modified) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, last_modified = excluded.last_modified
  `).run(m.id, JSON.stringify(m), m.lastModifiedAt);
  return m;
}
function deleteMitglied(id) {
  db.prepare('DELETE FROM mitglieder WHERE id = ?').run(id);
}

// --- Settings ---
function getSettings() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get();
  return r ? JSON.parse(r.value) : null;
}
function saveSettings(s) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('settings', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(s));
  return s;
}

// --- Generischer Payload-Store (für Vermietung-Entitäten) ---
function makePayloadStore(table) {
  return {
    list() { return db.prepare(`SELECT payload FROM ${table}`).all().map(r => JSON.parse(r.payload)); },
    get(id) {
      const r = db.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(id);
      return r ? JSON.parse(r.payload) : null;
    },
    save(obj) {
      if (!obj || !obj.id) throw new Error(`${table}.id fehlt`);
      if (!obj.lastModifiedAt) obj.lastModifiedAt = nowIso();
      db.prepare(`
        INSERT INTO ${table} (id, payload, last_modified) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, last_modified = excluded.last_modified
      `).run(obj.id, JSON.stringify(obj), obj.lastModifiedAt);
      return obj;
    },
    delete(id) { db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id); },
  };
}

const mieterStore = makePayloadStore('mieter');
const raeumeStore = makePayloadStore('raeume');
const vermietungenStore = makePayloadStore('vermietungen');

const listMieter = () => mieterStore.list();
const getMieter = (id) => mieterStore.get(id);
const saveMieter = (m) => mieterStore.save(m);
const deleteMieter = (id) => mieterStore.delete(id);

const listRaeume = () => raeumeStore.list();
const getRaum = (id) => raeumeStore.get(id);
const saveRaum = (r) => raeumeStore.save(r);
const deleteRaum = (id) => raeumeStore.delete(id);

const listVermietungen = () => vermietungenStore.list();
const getVermietung = (id) => vermietungenStore.get(id);
const saveVermietung = (v) => vermietungenStore.save(v);
function deleteVermietung(id) {
  // Zählerstand-Fotos auf Disk wegräumen
  const dir = path.join(VERM_FILE_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM vermietung_files WHERE vermietung_id = ?').run(id);
  vermietungenStore.delete(id);
}

// --- Zählerstand-Fotos (zu einer Vermietung) ---
function listVermietungFiles(vermietungId) {
  return db.prepare('SELECT id, vermietung_id AS vermietungId, kind, filename, mimetype, size, uploaded_at AS uploadedAt FROM vermietung_files WHERE vermietung_id = ? ORDER BY uploaded_at ASC').all(vermietungId);
}
function getVermietungFile(id) {
  return db.prepare('SELECT id, vermietung_id AS vermietungId, kind, filename, mimetype, size, uploaded_at AS uploadedAt FROM vermietung_files WHERE id = ?').get(id);
}
function vermietungFilePath(vermietungId, id) {
  return path.join(VERM_FILE_DIR, vermietungId, id);
}
function ensureVermietungFileDir(vermietungId) {
  const dir = path.join(VERM_FILE_DIR, vermietungId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function insertVermietungFile({ id, vermietungId, kind, filename, mimetype, size }) {
  db.prepare('INSERT INTO vermietung_files (id, vermietung_id, kind, filename, mimetype, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, vermietungId, kind, filename, mimetype, size, nowIso());
  return getVermietungFile(id);
}
function deleteVermietungFile(id) {
  const f = getVermietungFile(id);
  if (!f) return null;
  const p = vermietungFilePath(f.vermietungId, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  db.prepare('DELETE FROM vermietung_files WHERE id = ?').run(id);
  return f;
}

// --- Modul Bargeldauslagen ---
const empfaengerStore = makePayloadStore('empfaenger');
const haushaltsstellenStore = makePayloadStore('haushaltsstellen');
const auslagenStore = makePayloadStore('auslagen');

const listEmpfaenger = () => empfaengerStore.list();
const getEmpfaenger = (id) => empfaengerStore.get(id);
const saveEmpfaenger = (e) => empfaengerStore.save(e);
const deleteEmpfaenger = (id) => empfaengerStore.delete(id);

const listHaushaltsstellen = () => haushaltsstellenStore.list();
const getHaushaltsstelle = (id) => haushaltsstellenStore.get(id);
const saveHaushaltsstelle = (h) => haushaltsstellenStore.save(h);
const deleteHaushaltsstelle = (id) => haushaltsstellenStore.delete(id);

const listAuslagen = () => auslagenStore.list();
const getAuslage = (id) => auslagenStore.get(id);
const saveAuslage = (a) => auslagenStore.save(a);
function deleteAuslage(id) {
  // Beleg-Scans auf Disk wegräumen
  const dir = path.join(BELEG_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM beleg_files WHERE auslage_id = ?').run(id);
  auslagenStore.delete(id);
}

// --- Beleg-Dateien (Scans zu einer Auslage) ---
function listBelegFiles(auslageId) {
  return db.prepare('SELECT id, auslage_id AS auslageId, filename, mimetype, size, uploaded_at AS uploadedAt FROM beleg_files WHERE auslage_id = ? ORDER BY uploaded_at ASC').all(auslageId);
}
function getBelegFile(id) {
  return db.prepare('SELECT id, auslage_id AS auslageId, filename, mimetype, size, uploaded_at AS uploadedAt FROM beleg_files WHERE id = ?').get(id);
}
function belegFilePath(auslageId, id) {
  return path.join(BELEG_DIR, auslageId, id);
}
function ensureBelegDir(auslageId) {
  const dir = path.join(BELEG_DIR, auslageId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function insertBelegFile({ id, auslageId, filename, mimetype, size }) {
  db.prepare('INSERT INTO beleg_files (id, auslage_id, filename, mimetype, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, auslageId, filename, mimetype, size, nowIso());
  return getBelegFile(id);
}
function deleteBelegFile(id) {
  const f = getBelegFile(id);
  if (!f) return null;
  const p = belegFilePath(f.auslageId, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  db.prepare('DELETE FROM beleg_files WHERE id = ?').run(id);
  return f;
}

// Beim ersten Start die beiden Standard-Objekte anlegen (Preise aus den Vorlagen).
function seedRaeume() {
  if (raeumeStore.list().length > 0) return;
  const now = nowIso();
  raeumeStore.save({
    id: 'raum-gemeindehaus', name: 'Gemeindehaus', aktiv: true, abrechnungsart: 'verbrauch',
    preise: { grund: { anwohnerTag1: 50, anwohnerWeitererTag: 30, ortsfremdTag1: 80, ortsfremdWeitererTag: 50 }, stromProKwh: 0.50, gasProCbm: 2.50 },
    kostenbogenTyp: 'gemeindehaus', lastModifiedAt: now,
  });
  // Jugendraum: Pauschale je Herkunft, Strom/Gas inklusive (keine Verbrauchsabrechnung).
  raeumeStore.save({
    id: 'raum-jugendraum', name: 'Jugendraum', aktiv: true, abrechnungsart: 'pauschal',
    preise: { grund: { anwohnerTag1: 30, anwohnerWeitererTag: 0, ortsfremdTag1: 50, ortsfremdWeitererTag: 0 }, stromProKwh: 0, gasProCbm: 0 },
    kostenbogenTyp: 'sonstiges', lastModifiedAt: now,
  });
}
seedRaeume();

// Migration für Bestands-Installationen: fehlt die Abrechnungsart, Standardwerte
// setzen (Jugendraum -> pauschal, alles andere -> verbrauch). Eine explizit vom
// Nutzer gesetzte Art bleibt unangetastet.
function migrateRaeumeAbrechnungsart() {
  for (const r of raeumeStore.list()) {
    if (r.abrechnungsart) continue;
    r.abrechnungsart = (r.id === 'raum-jugendraum') ? 'pauschal' : 'verbrauch';
    raeumeStore.save(r);
  }
}
migrateRaeumeAbrechnungsart();

// --- Attachments ---
function listAttachments(sitzungId) {
  return db.prepare('SELECT id, sitzung_id AS sitzungId, filename, mimetype, size, uploaded_at AS uploadedAt FROM attachments WHERE sitzung_id = ? ORDER BY uploaded_at ASC').all(sitzungId);
}
function getAttachment(id) {
  return db.prepare('SELECT id, sitzung_id AS sitzungId, filename, mimetype, size, uploaded_at AS uploadedAt FROM attachments WHERE id = ?').get(id);
}
function attachmentPath(sitzungId, id) {
  return path.join(ATTACH_DIR, sitzungId, id);
}
function ensureAttachmentDir(sitzungId) {
  const dir = path.join(ATTACH_DIR, sitzungId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function insertAttachment({ id, sitzungId, filename, mimetype, size }) {
  db.prepare('INSERT INTO attachments (id, sitzung_id, filename, mimetype, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, sitzungId, filename, mimetype, size, nowIso());
  return getAttachment(id);
}
function deleteAttachment(id) {
  const a = getAttachment(id);
  if (!a) return null;
  const p = attachmentPath(a.sitzungId, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  return a;
}

module.exports = {
  DATA_DIR, ATTACH_DIR, BELEG_DIR, VERM_FILE_DIR,
  listSitzungen, getSitzung, saveSitzung, deleteSitzung,
  listMitglieder, getMitglied, saveMitglied, deleteMitglied,
  getSettings, saveSettings,
  listAttachments, getAttachment, attachmentPath, ensureAttachmentDir,
  insertAttachment, deleteAttachment,
  listMieter, getMieter, saveMieter, deleteMieter,
  listRaeume, getRaum, saveRaum, deleteRaum,
  listVermietungen, getVermietung, saveVermietung, deleteVermietung,
  listVermietungFiles, getVermietungFile, vermietungFilePath, ensureVermietungFileDir,
  insertVermietungFile, deleteVermietungFile,
  listEmpfaenger, getEmpfaenger, saveEmpfaenger, deleteEmpfaenger,
  listHaushaltsstellen, getHaushaltsstelle, saveHaushaltsstelle, deleteHaushaltsstelle,
  listAuslagen, getAuslage, saveAuslage, deleteAuslage,
  listBelegFiles, getBelegFile, belegFilePath, ensureBelegDir,
  insertBelegFile, deleteBelegFile,
};
