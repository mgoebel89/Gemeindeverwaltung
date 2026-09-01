'use strict';

// Einwohnerliste — Proxy auf eine ZWEITE NocoDB-Base.
//
// Diese Base ist NICHT die, in die der allgemeine Sync sichert. Sie bleibt
// bewusst getrennt: das Melderegister der Ortsgemeinde hat in einer Sicherung
// von Sitzungen, Vermietungen und Rechnungen nichts verloren. Deshalb hat sie
// hier eigene Zugangsdaten unter dem eigenen DB-Key `einwohner` — wie
// Paperless, Vikunja, Mail und Homebox landet der nicht im Settings-Blob und
// damit weder im Snapshot noch im NocoDB-Sync der ersten Base.
//
// NocoDB bleibt die führende Quelle. Es gibt bewusst keine lokale Kopie der
// Einwohner: zwei Bestände laufen auseinander, und beim zweiten weiß niemand
// mehr, welcher stimmt. Gelesen und geschrieben wird immer dort.
//
// DAS PIN-GATE ist der eigentliche Grund, warum dieses Modul im Backend liegt
// und nicht wie der übrige NocoDB-Sync im Browser:
//
//   * Einwohner stehen NICHT in /api/snapshot. Der Snapshot geht ungefiltert an
//     jeden Browser im Netz; die Rollen-Umschaltung der Vorgänge filtert erst
//     im Browser und ist deshalb kein Schutz, sondern nur eine Sichtblende.
//   * Der PIN-Hash liegt hier, nicht in den Einstellungen. Die Leitungs-PIN der
//     Vorgänge steht als SHA-256 im Settings-Blob und fährt im Snapshot an jeden
//     Browser — eine vierstellige PIN ist daraus in Sekunden zurückgerechnet.
//     Hier steht sie mit Salz und 120.000 PBKDF2-Runden und verlässt den Server
//     nie.
//   * Wer die PIN kennt, bekommt einen zeitlich begrenzten Token. Ohne gültigen
//     Token antworten die Datenrouten mit 401 — egal, was der Browser behauptet.
//
// Das ist keine Benutzerverwaltung und ersetzt keine. Es ist die Grenze, ab der
// „im internen Netz" nicht mehr als Begründung reicht.
//
// AUSSPERR-HILFE: Wer die PIN vergisst, kommt über die Umgebungsvariablen in
// /etc/gemeindeverwaltung.env wieder hinein (EINWOHNER_NOCODB_*) bzw. setzt den
// Key `einwohner` in der settings-Tabelle zurück:
//   sqlite3 <datadir>/gemeinde.db "DELETE FROM settings WHERE key='einwohner';"
// Danach ist das Modul wieder unkonfiguriert und die PIN neu vergebbar.

const crypto = require('crypto');
const db = require('./db');

const ENV_URL = (process.env.EINWOHNER_NOCODB_URL || '').replace(/\/+$/, '');
const ENV_TOKEN = process.env.EINWOHNER_NOCODB_TOKEN || '';
const ENV_BASE = process.env.EINWOHNER_NOCODB_BASE || '';
const ENV_TABLE = process.env.EINWOHNER_NOCODB_TABLE || '';

// Spaltentitel in NocoDB. Vorbelegt mit denen der bestehenden Liste; über die
// Einstellungen änderbar, falls die Base anders benannte Spalten hat.
// `Name` ist der NACHNAME, `Rufname` der Vorname — amtliche Schreibweise des
// Melderegisters. Das ist genau andersherum, als man beim Lesen vermutet, und
// entscheidet über Sortierung und Urkundenaufdruck.
const STANDARD_FELDER = {
  nachname: 'Name',
  vorname: 'Rufname',
  geburtsdatum: 'Geburtsdatum',
  wohnungsart: 'Wohnungsart',
  wohnort: 'Wohnort',
  strasse: 'Straße',
  hausnummer: 'Hausnummer',
  zusatz: 'Zusatz',
};

// Sitzungsdauer eines PIN-Tokens.
const SITZUNG_MS = 8 * 3600 * 1000;
// Kurzer Lesecache. Eine Dorfliste ist klein; der Cache spart nur das
// Nachschlagen beim Blättern und wird bei jedem Schreibvorgang verworfen.
const CACHE_MS = 30 * 1000;

const PBKDF2_RUNDEN = 120000;

let cfg = null;
let cache = { at: 0, liste: null };
const sitzungen = new Map();     // token -> Ablaufzeitpunkt (ms)

class EinwohnerError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'EinwohnerError';
    this.status = status || 502;
  }
}

// --- Konfiguration --------------------------------------------------------
function loadConfig() {
  let stored = null;
  try { stored = db.getEinwohnerConfig(); } catch (_) { stored = null; }
  stored = stored || {};
  cfg = {
    url: (stored.url ? String(stored.url) : ENV_URL).replace(/\/+$/, ''),
    token: stored.token ? String(stored.token) : ENV_TOKEN,
    baseId: stored.baseId ? String(stored.baseId) : ENV_BASE,
    tableId: stored.tableId ? String(stored.tableId) : ENV_TABLE,
    tableName: stored.tableName ? String(stored.tableName) : '',
    felder: Object.assign({}, STANDARD_FELDER, stored.felder || {}),
    pinHash: stored.pinHash || '',
    pinSalt: stored.pinSalt || '',
  };
  return cfg;
}
loadConfig();

// Leeres Tokenfeld lässt das bestehende stehen — so lässt sich die Tabelle
// wechseln, ohne den API-Token erneut einzutippen.
function setConfig({ url, token, baseId, tableId, tableName, felder } = {}) {
  const cur = (() => { try { return db.getEinwohnerConfig() || {}; } catch (_) { return {}; } })();
  const next = {
    url: (url != null ? String(url).trim() : (cur.url || '')).replace(/\/+$/, ''),
    token: (token != null && String(token) !== '') ? String(token).trim() : (cur.token || ''),
    baseId: (baseId != null ? String(baseId).trim() : (cur.baseId || '')),
    tableId: (tableId != null ? String(tableId).trim() : (cur.tableId || '')),
    tableName: (tableName != null ? String(tableName).trim() : (cur.tableName || '')),
    felder: Object.assign({}, STANDARD_FELDER, cur.felder || {}, felder || {}),
    // PIN bleibt unberührt — die wird über setPin gesetzt.
    pinHash: cur.pinHash || '',
    pinSalt: cur.pinSalt || '',
  };
  db.saveEinwohnerConfig(next);
  loadConfig();
  cacheLeeren();
  return publicConfig();
}

// Fürs Frontend: API-Token und PIN-Hash NIE herausgeben.
function publicConfig() {
  let stored = null;
  try { stored = db.getEinwohnerConfig(); } catch (_) { stored = null; }
  const source = (stored && stored.url) ? 'app' : (ENV_URL ? 'env' : 'none');
  return {
    url: cfg.url || '',
    baseId: cfg.baseId || '',
    tableId: cfg.tableId || '',
    tableName: cfg.tableName || '',
    felder: Object.assign({}, cfg.felder),
    standardFelder: Object.assign({}, STANDARD_FELDER),
    hasToken: !!cfg.token,
    hasPin: !!cfg.pinHash,
    // Damit die Einstellungen schon beim Öffnen sagen können, was noch fehlt —
    // ohne dass man erst „Verbindung testen" drücken muss.
    fehlt: fehlendeAngaben(),
    source,
  };
}

function isConfigured() {
  return !!(cfg.url && cfg.token && cfg.tableId);
}

// Was genau fehlt noch? „Nicht eingerichtet" allein hilft niemandem beim
// Einrichten — die Meldung muss das fehlende Feld benennen.
function fehlendeAngaben() {
  const fehlt = [];
  if (!cfg.url) fehlt.push('NocoDB-URL');
  if (!cfg.token) fehlt.push('API-Token');
  if (!cfg.baseId) fehlt.push('Base-ID');
  if (!cfg.tableId) fehlt.push('Tabelle');
  return fehlt;
}

// --- PIN und Sitzungen ----------------------------------------------------
function pbkdf2(pin, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(pin), salt, PBKDF2_RUNDEN, 32, 'sha256', (err, key) => {
      if (err) reject(err); else resolve(key.toString('hex'));
    });
  });
}

async function pinStimmt(pin) {
  if (!cfg.pinHash || !cfg.pinSalt) return false;
  const h = await pbkdf2(pin, cfg.pinSalt);
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(cfg.pinHash, 'hex');
  // Gleiche Länge ist Voraussetzung für timingSafeEqual — bei ungleicher Länge
  // kann der Hash ohnehin nicht stimmen.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hasPin() { return !!cfg.pinHash; }

// Ohne gesetzte PIN darf jeder die erste vergeben (Ersteinrichtung, wie beim
// Paperless-Token). Ist eine gesetzt, muss die alte stimmen.
async function setPin(neu, alt) {
  if (cfg.pinHash) {
    if (!(await pinStimmt(alt || ''))) {
      throw new EinwohnerError('Die bisherige PIN stimmt nicht.', 403);
    }
  }
  const cur = (() => { try { return db.getEinwohnerConfig() || {}; } catch (_) { return {}; } })();
  if (neu === '' || neu == null) {
    // PIN entfernen heißt: das Modul ist offen. Bewusst möglich, aber die
    // Oberfläche warnt davor.
    db.saveEinwohnerConfig(Object.assign({}, cur, { pinHash: '', pinSalt: '' }));
    loadConfig();
    sitzungen.clear();
    return { hasPin: false };
  }
  const pin = String(neu);
  if (pin.length < 4) throw new EinwohnerError('Die PIN muss mindestens vier Zeichen haben.', 400);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await pbkdf2(pin, salt);
  db.saveEinwohnerConfig(Object.assign({}, cur, { pinHash: hash, pinSalt: salt }));
  loadConfig();
  // Alte Sitzungen enden mit der PIN-Änderung.
  sitzungen.clear();
  return { hasPin: true };
}

function abgelaufeneAufraeumen() {
  const jetzt = Date.now();
  for (const [t, bis] of sitzungen) {
    if (bis <= jetzt) sitzungen.delete(t);
  }
}

async function anmelden(pin) {
  if (!cfg.pinHash) throw new EinwohnerError('Für das Einwohnermodul ist noch keine PIN vergeben.', 409);
  if (!(await pinStimmt(pin || ''))) throw new EinwohnerError('PIN falsch.', 401);
  abgelaufeneAufraeumen();
  const token = crypto.randomBytes(24).toString('hex');
  const bis = Date.now() + SITZUNG_MS;
  sitzungen.set(token, bis);
  return { token, gueltigBis: new Date(bis).toISOString() };
}

function abmelden(token) {
  if (token) sitzungen.delete(String(token));
  return { ok: true };
}

// Der Wächter. Ohne PIN ist das Modul offen (Ersteinrichtung) — sobald eine
// gesetzt ist, kommt niemand ohne gültigen Token an Daten.
function tokenGueltig(token) {
  if (!cfg.pinHash) return true;
  if (!token) return false;
  abgelaufeneAufraeumen();
  const bis = sitzungen.get(String(token));
  return !!(bis && bis > Date.now());
}

// --- NocoDB ---------------------------------------------------------------
async function api(pfad, opts = {}) {
  if (!cfg.url || !cfg.token) {
    throw new EinwohnerError('Die Einwohnerliste ist nicht eingerichtet (Einstellungen → Einwohner).', 503);
  }
  let res;
  try {
    res = await fetch(cfg.url + pfad, {
      method: opts.method || 'GET',
      headers: {
        'xc-token': cfg.token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new EinwohnerError(`NocoDB nicht erreichbar: ${e.message}`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new EinwohnerError('NocoDB weist den API-Token zurück.', 401);
    }
    throw new EinwohnerError(`NocoDB ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function tabellen() {
  if (!cfg.url || !cfg.token || !cfg.baseId) {
    throw new EinwohnerError(
      'Zum Laden der Tabellen fehlen noch: '
      + [!cfg.url && 'NocoDB-URL', !cfg.token && 'API-Token', !cfg.baseId && 'Base-ID']
        .filter(Boolean).join(', ')
      + '. Erst „Speichern" drücken — die Liste kommt über den gespeicherten Zugang.',
      400,
    );
  }
  const data = await api(`/api/v2/meta/bases/${encodeURIComponent(cfg.baseId)}/tables`);
  const list = (data && (data.list || data.tables)) || [];
  return list.map(t => ({ id: t.id, title: t.title || t.table_name || t.id }));
}

// --- Abbildung NocoDB <-> App --------------------------------------------
const text = (v) => (v == null ? '' : String(v).trim());

// Kalendertage kommen je nach Spaltentyp als 'YYYY-MM-DD' oder als voller
// Zeitstempel. Nur die ersten zehn Zeichen zählen — Date.parse ist hier
// verboten, es liest 'YYYY-MM-DD' als UTC und verschiebt den Tag um eins.
function datumNorm(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function ausNocoDb(row, felder) {
  const f = felder || cfg.felder;
  const roh = row[f.hausnummer];
  return {
    id: String(row.Id != null ? row.Id : (row.id != null ? row.id : '')),
    nachname: text(row[f.nachname]),
    vorname: text(row[f.vorname]),
    geburtsdatum: datumNorm(row[f.geburtsdatum]),
    wohnungsart: text(row[f.wohnungsart]),
    wohnort: text(row[f.wohnort]),
    strasse: text(row[f.strasse]),
    hausnummer: roh == null ? '' : String(roh).trim(),
    zusatz: text(row[f.zusatz]),
  };
}

// Klartextnamen der Felder — nur für Fehlermeldungen, damit dort nicht die
// internen Bezeichner stehen.
const FELD_BESCHRIFTUNG = {
  nachname: 'Name', vorname: 'Rufname', geburtsdatum: 'Geburtsdatum',
  wohnungsart: 'Wohnungsart', wohnort: 'Wohnort', strasse: 'Straße',
  hausnummer: 'Hausnummer', zusatz: 'Zusatz',
};

function nachNocoDb(e, felder) {
  const f = felder || cfg.felder;
  const row = {};

  // ZWEI REGELN, die beim Schreiben über Erfolg und 400 entscheiden:
  //
  // 1. Eine Spalte ohne Zuordnung wird NICHT geschrieben. Vorher landete bei
  //    leerer Zuordnung ein Feld mit dem Namen '' im Datensatz — NocoDB weist
  //    den ganzen Schreibvorgang zurück. Wer eine Spalte in seiner Base nicht
  //    hat, lässt die Zuordnung in den Einstellungen leer und kann trotzdem
  //    anlegen.
  // 2. Leere Werte gehen als null, nicht als ''. Bei Textspalten ist das
  //    gleichbedeutend; bei einer Auswahlspalte (SingleSelect — Wohnungsart ist
  //    typischerweise eine) ist '' KEINE gültige Option und führt zur
  //    Ablehnung, null dagegen leert das Feld sauber.
  const setz = (spalte, wert) => {
    if (!spalte) return;
    row[spalte] = (wert === '' || wert === undefined) ? null : wert;
  };

  setz(f.nachname, text(e.nachname));
  setz(f.vorname, text(e.vorname));
  setz(f.geburtsdatum, datumNorm(e.geburtsdatum));
  setz(f.wohnungsart, text(e.wohnungsart));
  setz(f.wohnort, text(e.wohnort));
  setz(f.strasse, text(e.strasse));
  // Die Hausnummer ist in der Base eine Zahl. Reine Ziffern deshalb als Zahl
  // schicken; „12b" bliebe Text und würde von NocoDB abgelehnt — dafür ist die
  // Spalte `Zusatz` da.
  const hn = text(e.hausnummer);
  setz(f.hausnummer, hn === '' ? '' : (/^\d+$/.test(hn) ? Number(hn) : hn));
  setz(f.zusatz, text(e.zusatz));
  return row;
}

// Welche Spalten hat die Tabelle wirklich, welchen Typ haben sie, und welche
// Werte lässt eine Auswahlspalte zu? Nur für die Fehlerdeutung — im
// Normalbetrieb wird das nicht abgefragt.
async function spaltenInfo() {
  const data = await api(`/api/v2/meta/tables/${encodeURIComponent(cfg.tableId)}`);
  const cols = (data && (data.columns || data.Columns)) || [];
  return cols
    .map(c => ({
      titel: c.title || c.column_name,
      typ: c.uidt || '',
      optionen: (((c.colOptions || {}).options) || []).map(o => o.title).filter(Boolean),
    }))
    .filter(c => c.titel);
}

async function spaltenTitel() {
  return (await spaltenInfo()).map(c => c.titel);
}

// „NocoDB 400: …" hilft beim Anlegen niemandem. Schlägt ein Schreibvorgang
// fehl, wird nachgesehen, ob eine zugeordnete Spalte in der Tabelle überhaupt
// existiert — das ist die mit Abstand häufigste Ursache und beim LESEN nicht zu
// bemerken: eine unbekannte Spalte liefert dort einfach nichts.
async function schreibfehlerDeuten(fehler, row) {
  let spalten = null;
  try { spalten = await spaltenInfo(); } catch (_) { return fehler; }
  if (!spalten || !spalten.length) return fehler;
  const titel = spalten.map(c => c.titel);

  // Ursache 1: eine zugeordnete Spalte gibt es gar nicht. Beim LESEN fällt das
  // nie auf — eine unbekannte Spalte liefert dort einfach nichts.
  const fehlend = Object.entries(cfg.felder)
    .filter(([, spalte]) => spalte && !titel.includes(spalte))
    .map(([feld, spalte]) => `„${spalte}" (zugeordnet für ${FELD_BESCHRIFTUNG[feld] || feld})`);
  if (fehlend.length) {
    return new EinwohnerError(
      `Diese Spalte(n) gibt es in der Tabelle nicht: ${fehlend.join(', ')}. `
      + `Vorhanden sind: ${titel.join(', ')}. `
      + 'Zuordnung berichtigen unter Einstellungen → Einwohner — eine leer gelassene '
      + 'Zuordnung wird beim Schreiben übersprungen.',
      400,
    );
  }

  // Ursache 2: ein Wert, den eine Auswahlspalte nicht kennt. Typischer Fall ist
  // die Wohnungsart — die Base führt sie oft als SingleSelect mit eigener
  // Schreibweise, und dann passt „Nebenwohnung" eben nicht zu „Nebenwohnsitz".
  if (row) {
    for (const c of spalten) {
      if (!c.optionen.length) continue;
      const wert = row[c.titel];
      if (wert === null || wert === undefined || wert === '') continue;
      if (!c.optionen.includes(String(wert))) {
        return new EinwohnerError(
          `Die Spalte „${c.titel}" ist eine Auswahlspalte und kennt den Wert „${wert}" nicht. `
          + `Zulässig sind: ${c.optionen.join(', ')}. `
          + 'Entweder in NocoDB als Auswahlmöglichkeit ergänzen oder den passenden Wert nehmen.',
          400,
        );
      }
    }
  }

  return fehler;
}

// --- Lesen ----------------------------------------------------------------
function cacheLeeren() { cache = { at: 0, liste: null }; }

async function alle({ frisch = false } = {}) {
  if (!frisch && cache.liste && (Date.now() - cache.at) < CACHE_MS) return cache.liste;
  const out = [];
  let offset = 0;
  const limit = 200;
  while (true) {
    const data = await api(`/api/v2/tables/${encodeURIComponent(cfg.tableId)}/records?limit=${limit}&offset=${offset}`);
    const list = (data && (data.list || data.records)) || [];
    out.push(...list.map(r => ausNocoDb(r)));
    const info = (data && (data.pageInfo || data.page_info)) || {};
    if (list.length < limit || info.isLastPage) break;
    offset += limit;
    if (offset > 50000) break;           // Reißleine gegen eine kaputte Antwort
  }
  cache = { at: Date.now(), liste: out };
  return out;
}

// Amtliche Sortierung: Straße, dann HAUSNUMMER, dann Nachname, dann Vorname —
// genau so führt die Verbandsgemeinde ihre Papierliste.
//
// KORREKTUR (2026-09-01): Hier stand bis dahin ausdrücklich „bewusst NICHT nach
// Hausnummer“. Das war eine Annahme über die Amtsliste, und sie war falsch —
// beim ersten echten Abgleich liefen die beiden Listen deshalb auseinander.
// Diese Funktion ist die EINZIGE Stelle, an der die Reihenfolge festgelegt wird;
// Bildschirmliste, Prüfliste und Abgleichsassistent erben sie.
const sammler = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

// Hausnummern sortieren zahlmäßig, nicht alphabetisch: 2 vor 10, und „12a“ vor
// „12b“. Der Buchstabe kann in der Hausnummer selbst stecken („12b“) oder in der
// eigenen Spalte `Zusatz` — beides wird hier zusammengezogen, sonst stünde
// dieselbe Adresse je nach Erfassung an zwei verschiedenen Stellen.
function hausnummerTeile(e) {
  const roh = `${e.hausnummer == null ? '' : e.hausnummer}`.trim();
  const m = /^(\d+)(.*)$/.exec(roh);
  return {
    // Ohne Hausnummer ans Ende, nicht an den Anfang: eine leere Angabe ist
    // ein Erfassungsmangel und soll beim Durchgehen auffallen.
    zahl: m ? Number(m[1]) : Number.POSITIVE_INFINITY,
    rest: ((m ? m[2] : roh) + ' ' + `${e.zusatz || ''}`).trim(),
  };
}

function amtlichSortiert(liste) {
  return liste.slice().sort((a, b) => {
    const s = sammler.compare(a.strasse, b.strasse);
    if (s) return s;
    const ha = hausnummerTeile(a);
    const hb = hausnummerTeile(b);
    if (ha.zahl !== hb.zahl) return ha.zahl < hb.zahl ? -1 : 1;
    return sammler.compare(ha.rest, hb.rest)
      || sammler.compare(a.nachname, b.nachname)
      || sammler.compare(a.vorname, b.vorname);
  });
}

function passtZuSuche(e, q) {
  if (!q) return true;
  const n = q.toLowerCase();
  return [e.nachname, e.vorname, e.strasse, e.wohnort, e.hausnummer, e.zusatz]
    .some(v => String(v || '').toLowerCase().includes(n));
}

async function suchen({ q = '', frisch = false } = {}) {
  const liste = await alle({ frisch });
  return amtlichSortiert(liste.filter(e => passtZuSuche(e, q)));
}

async function holen(id) {
  const liste = await alle();
  return liste.find(e => e.id === String(id)) || null;
}

// --- Schreiben ------------------------------------------------------------
function pruefe(e) {
  if (!text(e.nachname)) throw new EinwohnerError('Der Name fehlt.', 400);
  if (e.geburtsdatum && !datumNorm(e.geburtsdatum)) {
    throw new EinwohnerError('Das Geburtsdatum muss als JJJJ-MM-TT angegeben werden.', 400);
  }
}

async function anlegen(e) {
  pruefe(e);
  const zeile = nachNocoDb(e);
  let data;
  try {
    data = await api(`/api/v2/tables/${encodeURIComponent(cfg.tableId)}/records`, {
      method: 'POST',
      body: [zeile],
    });
  } catch (err) { throw await schreibfehlerDeuten(err, zeile); }
  cacheLeeren();
  const erzeugt = Array.isArray(data) ? data[0] : data;
  const id = erzeugt && (erzeugt.Id != null ? erzeugt.Id : erzeugt.id);
  return Object.assign({}, e, { id: id == null ? '' : String(id) });
}

async function aktualisieren(id, e) {
  pruefe(e);
  const zahl = Number(id);
  const zeile = nachNocoDb(e);
  try {
    await api(`/api/v2/tables/${encodeURIComponent(cfg.tableId)}/records`, {
      method: 'PATCH',
      body: [Object.assign({ Id: Number.isFinite(zahl) ? zahl : id }, zeile)],
    });
  } catch (err) { throw await schreibfehlerDeuten(err, zeile); }
  cacheLeeren();
  return Object.assign({}, e, { id: String(id) });
}

async function loeschen(id) {
  const zahl = Number(id);
  await api(`/api/v2/tables/${encodeURIComponent(cfg.tableId)}/records`, {
    method: 'DELETE',
    body: [{ Id: Number.isFinite(zahl) ? zahl : id }],
  });
  cacheLeeren();
  return { ok: true };
}

// --- Verbindungsprobe -----------------------------------------------------
async function health() {
  if (!isConfigured()) {
    const fehlt = fehlendeAngaben();
    return {
      ok: false,
      fehlt,
      error: `Es fehlt noch: ${fehlt.join(', ')}. Angaben eintragen und erst „Speichern" drücken — `
        + 'die Prüfung läuft über den gespeicherten Zugang, nicht über die Eingabefelder.',
    };
  }
  try {
    const data = await api(`/api/v2/tables/${encodeURIComponent(cfg.tableId)}/records?limit=1`);
    const list = (data && (data.list || data.records)) || [];
    const info = (data && (data.pageInfo || data.page_info)) || {};
    // Eine Beispielzeile hilft beim Prüfen, ob die Spaltenzuordnung stimmt —
    // ohne sie merkt man den vertauschten Namen erst auf der Urkunde. Sie
    // enthält echte Personendaten und geht deshalb nur durch das PIN-Gate.
    const beispiel = list.length ? ausNocoDb(list[0]) : null;
    return {
      ok: true,
      anzahl: info.totalRows != null ? info.totalRows : (list.length || 0),
      beispiel,
      spalten: list.length ? Object.keys(list[0]) : [],
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  EinwohnerError,
  STANDARD_FELDER,
  isConfigured, fehlendeAngaben, publicConfig, setConfig,
  hasPin, setPin, anmelden, abmelden, tokenGueltig,
  tabellen, health, spaltenTitel, spaltenInfo,
  alle, suchen, holen, anlegen, aktualisieren, loeschen,
  amtlichSortiert, cacheLeeren,
  // für Tests
  _ausNocoDb: ausNocoDb,
  _nachNocoDb: nachNocoDb,
  _datumNorm: datumNorm,
  _passtZuSuche: passtZuSuche,
  _hausnummerTeile: hausnummerTeile,
  _schreibfehlerDeuten: schreibfehlerDeuten,
};
