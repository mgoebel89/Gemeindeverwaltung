'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const P = require('./personen');

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

  -- Zentrale Personen-Stammdaten. Führt die früher getrennten Listen
  -- Ratsmitglieder, Mieter, Empfänger, Arbeiter/Firmen und Vertragspartner
  -- zusammen; die alten Tabellen bleiben als Sicherheitsnetz bestehen.
  CREATE TABLE IF NOT EXISTS personen (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );

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

  -- Modul Verträge und Pacht
  CREATE TABLE IF NOT EXISTS vertragspartner (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vertraege (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vertraege_modified ON vertraege(last_modified);

  -- Modul Vorgänge & Projekte (Vorgangsverfolgung mit getippter Historie)
  CREATE TABLE IF NOT EXISTS vorgaenge (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vorgaenge_modified ON vorgaenge(last_modified);
  -- Ergänzung zu den Wartungen, die in Homebox liegen. Homebox kennt keine
  -- Wiederholung und keine Verknüpfung zu einer Aufgabe – genau das steht hier.
  -- Die id ist die der Homebox-Wartung, damit beides ohne Suchen zusammenfindet.
  CREATE TABLE IF NOT EXISTS inventar_wartungen (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inventar_wartungen_modified ON inventar_wartungen(last_modified);
  -- Fotos zu Verlaufseinträgen eines Vorgangs (kind = hist_<eintragId>)
  CREATE TABLE IF NOT EXISTS vorgang_files (
    id           TEXT PRIMARY KEY,
    vorgang_id   TEXT NOT NULL,
    kind         TEXT NOT NULL,
    filename     TEXT NOT NULL,
    mimetype     TEXT NOT NULL,
    size         INTEGER NOT NULL,
    uploaded_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vorgangfile_vorgang ON vorgang_files(vorgang_id);

  -- Modul Arbeitszeiten & Vergütung (Leistungserbringer, Tätigkeiten, Abrechnungen)
  CREATE TABLE IF NOT EXISTS arbeiter (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS arbeitszeiten (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_arbeitszeiten_modified ON arbeitszeiten(last_modified);
  CREATE TABLE IF NOT EXISTS arbeitsabrechnungen (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_arbeitsabr_modified ON arbeitsabrechnungen(last_modified);

  -- Modul Einwohner: Ergänzung zu den Altersjubiläen. Die Einwohner selbst
  -- liegen in einer eigenen NocoDB-Base und werden NICHT lokal kopiert; wer
  -- wann ein Jubiläum hat, wird aus dem Geburtsdatum gerechnet. Hier steht nur,
  -- was die Rechnung nicht weiß: Status, Notiz und die angelegte Aufgabe.
  -- Die id ist einwohnerId-alter und verhindert dadurch Doppelanlagen.
  -- (Keine Backticks in diesem Kommentar: das ganze Schema steht in einem
  --  JS-Template-Literal, ein Backtick hier würde es beenden.)
  CREATE TABLE IF NOT EXISTS ehrungen (
    id           TEXT PRIMARY KEY,
    payload      TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ehrungen_modified ON ehrungen(last_modified);
`);

const BELEG_DIR = path.join(ATTACH_DIR, 'auslagen');
fs.mkdirSync(BELEG_DIR, { recursive: true });

const VERM_FILE_DIR = path.join(ATTACH_DIR, 'vermietung');
fs.mkdirSync(VERM_FILE_DIR, { recursive: true });

const VORGANG_FILE_DIR = path.join(ATTACH_DIR, 'vorgaenge');
fs.mkdirSync(VORGANG_FILE_DIR, { recursive: true });

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
// Ratsmitglieder sind Personen mit der Rolle „rat". Die Funktionen dazu stehen
// weiter unten im Abschnitt „Personen-Stammdaten".

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

// Paperless-Zugangsdaten: eigener Key, damit sie NICHT im allgemeinen
// Settings-Blob (Snapshot/NocoDB-Sync) landen. Enthält den Token im Klartext –
// bleibt serverseitig, wird nie im Snapshot ausgegeben.
function getPaperlessConfig() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'paperless'").get();
  return r ? JSON.parse(r.value) : null;
}
function savePaperlessConfig(c) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('paperless', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(c));
  return c;
}

// Kalender-Abos (iCal-URLs): eigener Key, damit sie NICHT im allgemeinen
// Settings-Blob (Snapshot/NocoDB-Sync) landen. Abo-URLs können ein Geheimnis
// enthalten (z. B. Google-Privat-iCal) und bleiben deshalb serverseitig.
function getKalenderConfig() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'kalender'").get();
  return r ? JSON.parse(r.value) : null;
}
function saveKalenderConfig(c) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('kalender', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(c));
  return c;
}

// Vikunja-Zugangsdaten (URL + API-Token): eigener Key, damit sie NICHT im
// allgemeinen Settings-Blob (Snapshot/NocoDB-Sync) landen. Token im Klartext –
// bleibt serverseitig, wird nie im Snapshot ausgegeben.
function getVikunjaConfig() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'vikunja'").get();
  return r ? JSON.parse(r.value) : null;
}
function saveVikunjaConfig(c) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('vikunja', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(c));
  return c;
}

// E-Mail-Zugang (IMAP/SMTP des Bürgermeister-Postfachs): eigener Key, damit er
// NICHT im allgemeinen Settings-Blob (Snapshot/NocoDB-Sync) landet. Enthält das
// Passwort im Klartext – bleibt serverseitig, wird nie im Snapshot ausgegeben.
function getMailConfig() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'mail'").get();
  return r ? JSON.parse(r.value) : null;
}
function saveMailConfig(c) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('mail', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(c));
  return c;
}

// Homebox-Zugang (URL + Benutzer + Passwort + gewählte Sammlung): eigener Key,
// damit er NICHT im allgemeinen Settings-Blob (Snapshot/NocoDB-Sync) landet.
// Homebox kennt keine dauerhaften Tokens, deshalb liegt hier das Passwort im
// Klartext – es bleibt serverseitig und wird nie im Snapshot ausgegeben.
function getHomeboxConfig() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'homebox'").get();
  return r ? JSON.parse(r.value) : null;
}
function saveHomeboxConfig(c) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('homebox', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(c));
  return c;
}

// Einwohner-Zugang (zweite NocoDB-Base) + PIN des Moduls: eigener Key, damit er
// NICHT im allgemeinen Settings-Blob (Snapshot/NocoDB-Sync) landet. Das ist hier
// wichtiger als bei allen anderen Modulen: neben dem API-Token steht in diesem
// Datensatz auch der PIN-Hash, der das Melderegister absichert. Läge er im
// Snapshot, ginge er an jeden Browser im Netz und wäre offline angreifbar.
function getEinwohnerConfig() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'einwohner'").get();
  return r ? JSON.parse(r.value) : null;
}
function saveEinwohnerConfig(c) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('einwohner', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(c));
  return c;
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

// --- Personen-Stammdaten (zentral für alle Module) --------------------------
// Fünf früher getrennte Listen liegen jetzt in EINER Tabelle; die Rollen-Flags
// sagen, in welchem Modul eine Person auftaucht. Die alten Funktionsnamen
// bleiben als Sichten darauf bestehen, damit Routen, Ansichten und PDFs
// unverändert weiterlaufen.
//
// Zwei Regeln, die den Umbau verlustfrei halten:
//  * list*() filtert nach Rolle (das speist die Auswahllisten), get*() dagegen
//    NICHT – sonst würde eine alte Vermietung ihren Mieter nicht mehr anzeigen,
//    nur weil dessen Mieter-Rolle inzwischen entfernt wurde.
//  * delete*() entfernt nur die Rolle. Gelöscht wird eine Person erst, wenn sie
//    in keinem Modul mehr vorkommt – sonst risse das Löschen eines Mieters
//    denselben Menschen aus den Arbeitszeiten.
const personenStore = makePayloadStore('personen');

function listPersonen() { return personenStore.list().map(P.normalizePerson); }
function getPerson(id) {
  const p = personenStore.get(id);
  return p ? P.normalizePerson(p) : null;
}
// Wie getPerson, löst aber zusätzlich die ids zusammengeführter Dubletten auf.
// NUR für lesende Sichten: beim Speichern muss die id exakt bleiben, sonst
// bekäme die Zielperson beim Sichern eines Altdatensatzes dessen id.
function getPersonAufgeloest(id) {
  return getPerson(id) || P.findePersonMitAlias(listPersonen(), id);
}
function savePerson(p) {
  const person = P.normalizePerson(p);
  if (!person.id) throw new Error('person.id fehlt');
  person.lastModifiedAt = person.lastModifiedAt || nowIso();
  personenStore.save(person);
  return person;
}
function deletePerson(id) { personenStore.delete(id); }

function personenMitRolle(rolle) { return listPersonen().filter(p => P.hatRolle(p, rolle)); }

// Speichern aus einem Modul heraus: eine bestehende Person wird ERGÄNZT, nie
// ersetzt – die Felder der anderen Rollen bleiben unangetastet.
function speichereAlsRolle(apply, datensatz) {
  if (!datensatz || !datensatz.id) throw new Error('id fehlt');
  const person = apply(getPerson(datensatz.id), datensatz);
  person.lastModifiedAt = nowIso();
  return savePerson(person);
}

function entferneRolle(id, rolle) {
  const p = getPerson(id);
  if (!p) return;
  P.setRolle(p, rolle, false);
  if (P.hatIrgendeineRolle(p)) { p.lastModifiedAt = nowIso(); savePerson(p); }
  else deletePerson(id);
}

// Sichten: Ratsmitglieder
const listMitglieder = () => personenMitRolle('rat').map(P.toMitglied);
const getMitglied = (id) => { const p = getPersonAufgeloest(id); return p ? P.toMitglied(p) : null; };
const saveMitglied = (m) => P.toMitglied(speichereAlsRolle(P.applyMitglied, m));
const deleteMitglied = (id) => entferneRolle(id, 'rat');

// Sichten: Mieter
const listMieter = () => personenMitRolle('mieter').map(P.toMieter);
const getMieter = (id) => { const p = getPersonAufgeloest(id); return p ? P.toMieter(p) : null; };
const saveMieter = (m) => P.toMieter(speichereAlsRolle(P.applyMieter, m));
const deleteMieter = (id) => entferneRolle(id, 'mieter');

// Sichten: Empfänger (Bargeldauslagen)
const listEmpfaenger = () => personenMitRolle('empfaenger').map(P.toEmpfaenger);
const getEmpfaenger = (id) => { const p = getPersonAufgeloest(id); return p ? P.toEmpfaenger(p) : null; };
const saveEmpfaenger = (e) => P.toEmpfaenger(speichereAlsRolle(P.applyEmpfaenger, e));
const deleteEmpfaenger = (id) => entferneRolle(id, 'empfaenger');

// Sichten: Arbeiter/Firmen (Arbeitszeiten)
const listArbeiter = () => personenMitRolle('arbeiter').map(P.toArbeiter);
const getArbeiter = (id) => { const p = getPersonAufgeloest(id); return p ? P.toArbeiter(p) : null; };
const saveArbeiter = (a) => P.toArbeiter(speichereAlsRolle(P.applyArbeiter, a));
const deleteArbeiter = (id) => entferneRolle(id, 'arbeiter');

// Sichten: Vertragspartner
const listVertragspartner = () => personenMitRolle('partner').map(P.toVertragspartner);
const getVertragspartner = (id) => { const p = getPersonAufgeloest(id); return p ? P.toVertragspartner(p) : null; };
const saveVertragspartner = (p) => P.toVertragspartner(speichereAlsRolle(P.applyVertragspartner, p));
const deleteVertragspartner = (id) => entferneRolle(id, 'partner');

const raeumeStore = makePayloadStore('raeume');
const vermietungenStore = makePayloadStore('vermietungen');

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
const haushaltsstellenStore = makePayloadStore('haushaltsstellen');
const auslagenStore = makePayloadStore('auslagen');

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

// --- Modul Verträge und Pacht ---
const vertraegeStore = makePayloadStore('vertraege');

const listVertraege = () => vertraegeStore.list();
const getVertrag = (id) => vertraegeStore.get(id);
const saveVertrag = (v) => vertraegeStore.save(v);
const deleteVertrag = (id) => vertraegeStore.delete(id);

// --- Modul Vorgänge & Projekte ---
const vorgaengeStore = makePayloadStore('vorgaenge');
const listVorgaenge = () => vorgaengeStore.list();
const getVorgang = (id) => vorgaengeStore.get(id);
const saveVorgang = (v) => vorgaengeStore.save(v);
function deleteVorgang(id) {
  // Verlaufsfotos auf Disk wegräumen (wie bei den Vermietungen)
  const dir = path.join(VORGANG_FILE_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM vorgang_files WHERE vorgang_id = ?').run(id);
  vorgaengeStore.delete(id);
}

// --- Modul Inventar: lokale Ergänzung zu den Homebox-Wartungen ---
// Die Wartungen selbst liegen in Homebox. Hier steht nur, was Homebox nicht
// kennt: das Wiederholungsintervall, eine abweichende Vorlauffrist und die
// Aufgabe, die dafür schon angelegt wurde. Die id ist die der Homebox-Wartung.
const inventarWartungenStore = makePayloadStore('inventar_wartungen');
const listInventarWartungen = () => inventarWartungenStore.list();
const getInventarWartung = (id) => inventarWartungenStore.get(id);
const saveInventarWartung = (w) => inventarWartungenStore.save(w);
const deleteInventarWartung = (id) => inventarWartungenStore.delete(id);
// Beim Löschen eines Gegenstands räumt Homebox seine Wartungen mit weg – die
// lokalen Ergänzungen blieben sonst als Waisen liegen.
function deleteInventarWartungenZuArtikel(itemId) {
  let n = 0;
  for (const w of listInventarWartungen()) {
    if (w && w.itemId === itemId) { inventarWartungenStore.delete(w.id); n++; }
  }
  return n;
}

// --- Modul Einwohner: Ergänzung zu den Altersjubiläen ---
// Die Einwohner liegen in einer eigenen NocoDB-Base, nicht hier. Gespeichert
// wird nur, was sich nicht aus dem Geburtsdatum rechnen lässt: Status, Notiz
// und die Aufgabe, die der Tageslauf für die Ehrung angelegt hat.
const ehrungenStore = makePayloadStore('ehrungen');
const listEhrungen = () => ehrungenStore.list();
const getEhrung = (id) => ehrungenStore.get(id);
const saveEhrung = (e) => ehrungenStore.save(e);
const deleteEhrung = (id) => ehrungenStore.delete(id);

// --- Modul Arbeitszeiten & Vergütung ---
const arbeitszeitenStore = makePayloadStore('arbeitszeiten');
const listArbeitszeiten = () => arbeitszeitenStore.list();
const getArbeitszeit = (id) => arbeitszeitenStore.get(id);
const saveArbeitszeit = (z) => arbeitszeitenStore.save(z);
const deleteArbeitszeit = (id) => arbeitszeitenStore.delete(id);

const arbeitsabrechnungenStore = makePayloadStore('arbeitsabrechnungen');
const listArbeitsabrechnungen = () => arbeitsabrechnungenStore.list();
const getArbeitsabrechnung = (id) => arbeitsabrechnungenStore.get(id);
const saveArbeitsabrechnung = (a) => arbeitsabrechnungenStore.save(a);
const deleteArbeitsabrechnung = (id) => arbeitsabrechnungenStore.delete(id);

// --- Verlaufsfotos (zu einem Vorgang) ---
function listVorgangFiles(vorgangId) {
  return db.prepare('SELECT id, vorgang_id AS vorgangId, kind, filename, mimetype, size, uploaded_at AS uploadedAt FROM vorgang_files WHERE vorgang_id = ? ORDER BY uploaded_at ASC').all(vorgangId);
}
function getVorgangFile(id) {
  return db.prepare('SELECT id, vorgang_id AS vorgangId, kind, filename, mimetype, size, uploaded_at AS uploadedAt FROM vorgang_files WHERE id = ?').get(id);
}
function vorgangFilePath(vorgangId, id) {
  return path.join(VORGANG_FILE_DIR, vorgangId, id);
}
function ensureVorgangFileDir(vorgangId) {
  const dir = path.join(VORGANG_FILE_DIR, vorgangId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function insertVorgangFile({ id, vorgangId, kind, filename, mimetype, size }) {
  db.prepare('INSERT INTO vorgang_files (id, vorgang_id, kind, filename, mimetype, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, vorgangId, kind, filename, mimetype, size, nowIso());
  return getVorgangFile(id);
}
function deleteVorgangFile(id) {
  const f = getVorgangFile(id);
  if (!f) return null;
  const p = vorgangFilePath(f.vorgangId, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  db.prepare('DELETE FROM vorgang_files WHERE id = ?').run(id);
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

// --- Einmalige Migration der fünf alten Personenlisten ----------------------
// Läuft beim Start, ist idempotent (ein Marker in den Settings, zusätzlich wird
// jede id übersprungen, die es als Person schon gibt) und lässt die alten
// Tabellen unangetastet stehen – sie sind der Rückweg, falls etwas fehlt.
function personenMigrationStatus() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'personenMigration'").get();
  return r ? JSON.parse(r.value) : null;
}

function migrierePersonen({ force = false } = {}) {
  const vorher = personenMigrationStatus();
  if (vorher && vorher.version >= 1 && !force) return vorher;

  const bestand = new Map(listPersonen().map(p => [p.id, p]));
  const quellen = {};

  const lauf = db.transaction(() => {
    for (const { quelle, apply } of P.QUELLEN) {
      const alt = makePayloadStore(quelle).list();
      let uebernommen = 0;
      let uebersprungen = 0;
      for (const eintrag of alt) {
        if (!eintrag || !eintrag.id) { uebersprungen++; continue; }
        if (bestand.has(eintrag.id)) { uebersprungen++; continue; }
        const person = apply(null, eintrag);
        person.lastModifiedAt = eintrag.lastModifiedAt || nowIso();
        savePerson(person);
        bestand.set(person.id, person);
        uebernommen++;
      }
      quellen[quelle] = { gefunden: alt.length, uebernommen, uebersprungen };
    }
  });
  lauf();

  const status = {
    version: 1,
    at: nowIso(),
    quellen,
    personen: bestand.size,
  };
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('personenMigration', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(status));
  return status;
}

try {
  const status = migrierePersonen();
  if (status && status.quellen) {
    const zusammenfassung = Object.entries(status.quellen)
      .map(([k, v]) => `${k}: ${v.uebernommen}/${v.gefunden}`).join(', ');
    console.log(`[personen] ${status.personen} Personen (Migration ${status.at}) – ${zusammenfassung}`);
  }
} catch (e) {
  console.error('[personen] Migration fehlgeschlagen:', e.message);
}

module.exports = {
  DATA_DIR, ATTACH_DIR, BELEG_DIR, VERM_FILE_DIR,
  listPersonen, getPerson, getPersonAufgeloest, savePerson, deletePerson,
  personenMitRolle, entferneRolle,
  migrierePersonen, personenMigrationStatus,
  listSitzungen, getSitzung, saveSitzung, deleteSitzung,
  listMitglieder, getMitglied, saveMitglied, deleteMitglied,
  getSettings, saveSettings,
  getPaperlessConfig, savePaperlessConfig,
  getKalenderConfig, saveKalenderConfig,
  getVikunjaConfig, saveVikunjaConfig,
  getMailConfig, saveMailConfig,
  getHomeboxConfig, saveHomeboxConfig,
  getEinwohnerConfig, saveEinwohnerConfig,
  listEhrungen, getEhrung, saveEhrung, deleteEhrung,
  listInventarWartungen, getInventarWartung, saveInventarWartung,
  deleteInventarWartung, deleteInventarWartungenZuArtikel,
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
  listVertragspartner, getVertragspartner, saveVertragspartner, deleteVertragspartner,
  listVertraege, getVertrag, saveVertrag, deleteVertrag,
  listVorgaenge, getVorgang, saveVorgang, deleteVorgang,
  listVorgangFiles, getVorgangFile, vorgangFilePath, ensureVorgangFileDir,
  insertVorgangFile, deleteVorgangFile,
  listArbeiter, getArbeiter, saveArbeiter, deleteArbeiter,
  listArbeitszeiten, getArbeitszeit, saveArbeitszeit, deleteArbeitszeit,
  listArbeitsabrechnungen, getArbeitsabrechnung, saveArbeitsabrechnung, deleteArbeitsabrechnung,
};
