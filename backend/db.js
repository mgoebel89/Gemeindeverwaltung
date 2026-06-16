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
`);

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
  DATA_DIR, ATTACH_DIR,
  listSitzungen, getSitzung, saveSitzung, deleteSitzung,
  listMitglieder, getMitglied, saveMitglied, deleteMitglied,
  getSettings, saveSettings,
  listAttachments, getAttachment, attachmentPath, ensureAttachmentDir,
  insertAttachment, deleteAttachment,
};
