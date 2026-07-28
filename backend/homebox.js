'use strict';

// REST-Client gegen Homebox. Homebox ist die führende Quelle fürs Inventar — es
// gibt bewusst KEINE lokale Kopie der Artikel, damit keine Sync-Konflikte
// entstehen. Fällt Homebox aus, ist nur das Inventarmodul betroffen.
//
// Zwei Eigenheiten prägen diese Datei:
//
// 1. KEINE dauerhaften API-Tokens. Homebox kennt nur `POST /v1/users/login`
//    mit Benutzername und Passwort und gibt einen zeitlich begrenzten Token
//    zurück. Deshalb liegen die Zugangsdaten serverseitig, und der Client
//    meldet sich bei Ablauf selbst neu an. Sie werden nie ans Frontend
//    ausgeliefert.
//
// 2. API-BRUCH. Neuere Homebox-Versionen haben Items und Locations zu
//    „Entities" verschmolzen: `/v1/items` und `/v1/locations` wurden durch
//    `/v1/entities` ersetzt, `locationId` heißt `parentId`, Labels heißen Tags.
//    Welche Version läuft, wissen wir nicht — der Client probiert daher die
//    neue API zuerst und fällt auf die alte zurück (wie schon bei Vikunja in
//    der Gemeindeverwaltung).
//
// 3. SAMMLUNGEN (Collections/Groups). Ein Homebox-Konto kann zu mehreren
//    getrennten Beständen gehören. Welcher gemeint ist, entscheidet der Header
//    `X-Tenant: <group-uuid>`; ohne ihn nimmt Homebox die Standard-Sammlung des
//    Kontos. Die Liste liefert `GET /v1/groups/all`.

const db = require('./db');

const ENV_URL = (process.env.HOMEBOX_URL || '').replace(/\/+$/, '');
const ENV_USER = process.env.HOMEBOX_USER || '';
const ENV_PASS = process.env.HOMEBOX_PASSWORD || '';
const ENV_GROUP = process.env.HOMEBOX_GROUP_ID || '';

// Name des benutzerdefinierten Felds, in dem der Hersteller-Barcode steht.
// Die Asset-ID vergibt Homebox selbst und taugt dafür nicht.
const BARCODE_FELD = 'Barcode';

let cfg = { url: ENV_URL, username: ENV_USER, password: ENV_PASS, groupId: ENV_GROUP, groupName: '' };
let token = '';
let tokenBis = 0;          // Zeitpunkt, ab dem neu angemeldet wird
let apiStil = null;        // 'entities' | 'items' — einmal erkannt, dann gemerkt
let feldFilter = null;     // kann der Server nach Feldwerten filtern? (siehe feldFilterPruefen)

function loadConfig() {
  let stored = null;
  try { stored = db.getHomeboxConfig(); } catch (_) { stored = null; }
  cfg = {
    url: ((stored && stored.url) ? String(stored.url) : ENV_URL).replace(/\/+$/, ''),
    username: (stored && stored.username) ? String(stored.username) : ENV_USER,
    password: (stored && stored.password) ? String(stored.password) : ENV_PASS,
    groupId: (stored && stored.groupId) ? String(stored.groupId) : ENV_GROUP,
    groupName: (stored && stored.groupName) ? String(stored.groupName) : '',
  };
  return cfg;
}
loadConfig();

// Leeres Passwortfeld lässt das bestehende stehen — so lässt sich die URL
// ändern, ohne das Passwort erneut einzutippen.
function setConfig({ url, username, password, groupId, groupName } = {}) {
  const cur = (() => { try { return db.getHomeboxConfig() || {}; } catch (_) { return {}; } })();
  const next = {
    url: (url != null ? String(url).trim() : (cur.url || '')).replace(/\/+$/, ''),
    username: (username != null ? String(username).trim() : (cur.username || '')),
    password: (password != null && String(password) !== '') ? String(password) : (cur.password || ''),
    // Leerer String ist hier eine gültige Angabe („Standard-Sammlung nehmen"),
    // deshalb auf undefined prüfen und nicht auf Wahrheitswert.
    groupId: (groupId !== undefined ? String(groupId || '').trim() : (cur.groupId || '')),
    groupName: (groupName !== undefined ? String(groupName || '').trim() : (cur.groupName || '')),
  };
  db.saveHomeboxConfig(next);
  loadConfig();
  // Zugang geändert → alles neu ermitteln. Auch der Feldfilter: eine andere
  // Homebox kann eine andere Version sein.
  token = ''; tokenBis = 0; apiStil = null; feldFilter = null;
  return publicConfig();
}

// Fürs Frontend: Passwort NIE herausgeben.
function publicConfig() {
  let stored = null;
  try { stored = db.getHomeboxConfig(); } catch (_) { stored = null; }
  const source = (stored && (stored.url || stored.username)) ? 'app' : ((ENV_URL || ENV_USER) ? 'env' : 'none');
  return {
    url: cfg.url || '',
    username: cfg.username || '',
    hasPassword: !!cfg.password,
    groupId: cfg.groupId || '',
    groupName: cfg.groupName || '',
    source,
    barcodeFeld: BARCODE_FELD,
  };
}

function isConfigured() {
  return !!(cfg.url && cfg.username && cfg.password);
}

class HomeboxError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HomeboxError';
    this.status = status || 502;
  }
}

// --- Anmeldung ------------------------------------------------------------
async function login() {
  if (!isConfigured()) {
    throw new HomeboxError('Homebox ist nicht konfiguriert (Einstellungen → Inventar).', 503);
  }
  let res;
  try {
    res = await fetch(cfg.url + '/api/v1/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password, stayLoggedIn: true }),
    });
  } catch (e) {
    throw new HomeboxError(`Homebox nicht erreichbar: ${e.message}`, 502);
  }
  if (!res.ok) {
    // Homebox antwortet bei Anmeldefehlern bewusst mit 500, um keine Hinweise
    // zu geben. Für den Nutzer ist die wahrscheinlichste Ursache die richtige.
    const text = await res.text().catch(() => '');
    throw new HomeboxError(
      res.status === 500 || res.status === 401
        ? 'Anmeldung bei Homebox fehlgeschlagen — Benutzername oder Passwort stimmt nicht.'
        : `Homebox ${res.status}: ${text.slice(0, 200)}`,
      res.status === 500 ? 401 : res.status,
    );
  }
  const data = await res.json().catch(() => null);
  const roh = data && (data.token || data.Token);
  if (!roh) throw new HomeboxError('Homebox hat keinen Token geliefert.', 502);

  // Je nach Version enthält der Token das „Bearer "-Präfix bereits.
  token = String(roh).startsWith('Bearer ') ? String(roh) : 'Bearer ' + roh;

  // Ablauf: wenn Homebox einen nennt, den nehmen (mit Sicherheitsabstand),
  // sonst konservative sechs Stunden.
  const abl = data.expiresAt || data.expires_at;
  const ms = abl ? (new Date(abl).getTime() - Date.now()) : 0;
  tokenBis = Date.now() + (ms > 60000 ? ms - 60000 : 6 * 3600 * 1000);
  return token;
}

async function tokenHolen() {
  if (token && Date.now() < tokenBis) return token;
  return login();
}

// --- HTTP -----------------------------------------------------------------
// Ein 401 heißt fast immer „Token abgelaufen" — dann einmal neu anmelden und
// den Aufruf wiederholen, statt den Nutzer mit einem Fehler zu behelligen.
// `ohneSammlung` unterdrückt den X-Tenant-Header. Das braucht die Abfrage der
// Sammlungsliste: steht dort eine ungültige ID in der Konfiguration, antwortet
// Homebox mit 403 — und man käme nicht mehr an die Liste, um sie zu korrigieren.
async function api(pfad, { method = 'GET', body, params, wiederholt = false, ohneSammlung = false } = {}) {
  if (!isConfigured()) {
    throw new HomeboxError('Homebox ist nicht konfiguriert (Einstellungen → Inventar).', 503);
  }
  const t = await tokenHolen();
  const u = new URL(cfg.url + pfad);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { for (const x of v) u.searchParams.append(k, String(x)); }
    else u.searchParams.set(k, String(v));
  }

  let res;
  try {
    res = await fetch(u, {
      method,
      headers: {
        Authorization: t,
        Accept: 'application/json',
        // Ohne Header nimmt Homebox die Standard-Sammlung des Kontos.
        ...(!ohneSammlung && cfg.groupId ? { 'X-Tenant': cfg.groupId } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new HomeboxError(`Homebox nicht erreichbar: ${e.message}`, 502);
  }

  if (res.status === 401 && !wiederholt) {
    token = ''; tokenBis = 0;
    return api(pfad, { method, body, params, ohneSammlung, wiederholt: true });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Homebox lehnt eine fremde Sammlung mit 403 ab und eine, die keine UUID
    // ist, mit 400. Beides ist derselbe Bedienfehler — also dieselbe Antwort.
    if (cfg.groupId && !ohneSammlung
        && (res.status === 403 || (res.status === 400 && /tenant/i.test(text)))) {
      throw new HomeboxError(
        `Kein Zugriff auf die eingestellte Sammlung${cfg.groupName ? ` „${cfg.groupName}"` : ''}. `
        + 'Bitte unter Einstellungen → Inventar eine andere wählen.', 403);
    }
    throw new HomeboxError(`Homebox ${res.status}: ${text.slice(0, 250)}`, res.status);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// Alle Sammlungen des Kontos. Bewusst OHNE X-Tenant, damit die Liste auch dann
// erreichbar bleibt, wenn die gespeicherte Sammlung nicht (mehr) zugänglich ist.
async function sammlungen() {
  const data = await api('/api/v1/groups/all', { ohneSammlung: true });
  const arr = Array.isArray(data) ? data : (data && data.items) || [];
  return arr.map(g => ({ id: g.id, name: g.name || '(ohne Namen)', waehrung: g.currency || '' }));
}

// --- API-Stil erkennen ----------------------------------------------------
// Neuere Homebox kennt /v1/entities, ältere nur /v1/items. Einmal ermitteln
// und merken; bei 404 auf die alte API zurückfallen.
async function stilErmitteln() {
  if (apiStil) return apiStil;
  try {
    await api('/api/v1/entities', { params: { page: 1, pageSize: 1 } });
    apiStil = 'entities';
  } catch (e) {
    if (e.status === 404) {
      await api('/api/v1/items', { params: { page: 1, pageSize: 1 } });
      apiStil = 'items';
    } else {
      throw e;   // 401/503 usw. sind echte Fehler, kein Versionsproblem
    }
  }
  return apiStil;
}

// --- Normalisierung -------------------------------------------------------
// Beide API-Stile auf EINE Form bringen, damit das Frontend nichts von der
// Homebox-Version wissen muss.
function normArtikel(roh) {
  if (!roh) return null;
  const felder = roh.fields || [];
  const bc = felder.find(f => String(f.name || '').toLowerCase() === BARCODE_FELD.toLowerCase());
  const ort = roh.parent || roh.location || null;
  const marken = roh.tags || roh.labels || [];
  return {
    id: roh.id,
    name: roh.name || '',
    beschreibung: roh.description || '',
    menge: Number(roh.quantity) || 0,
    barcode: bc ? (bc.textValue || '') : '',
    ortId: ort ? ort.id : '',
    ortName: ort ? ort.name : '',
    marken: marken.map(m => ({ id: m.id, name: m.name })),
    assetId: roh.assetId || roh.assetID || '',
    kaufpreis: roh.purchasePrice != null ? Number(roh.purchasePrice) : null,
    hersteller: roh.manufacturer || '',
    notizen: roh.notes || '',
    archiviert: !!roh.archived,
  };
}

function normOrt(roh) {
  return { id: roh.id, name: roh.name || '', anzahl: roh.itemCount != null ? roh.itemCount : null };
}

function listeAus(data) {
  if (!data) return { eintraege: [], gesamt: 0 };
  const arr = data.items || data.results || (Array.isArray(data) ? data : []);
  return { eintraege: arr, gesamt: data.total != null ? data.total : arr.length };
}

// --- Lesen ----------------------------------------------------------------
async function suchen({ q = '', seite = 1, proSeite = 25, ortId = '' } = {}) {
  const stil = await stilErmitteln();
  const data = stil === 'entities'
    ? await api('/api/v1/entities', { params: { q, page: seite, pageSize: proSeite, parentIds: ortId || undefined } })
    : await api('/api/v1/items', { params: { q, page: seite, pageSize: proSeite, locations: ortId || undefined } });
  const { eintraege, gesamt } = listeAus(data);
  return { artikel: eintraege.map(normArtikel), gesamt, seite, proSeite };
}

async function holen(id) {
  const stil = await stilErmitteln();
  const pfad = stil === 'entities' ? `/api/v1/entities/${encodeURIComponent(id)}` : `/api/v1/items/${encodeURIComponent(id)}`;
  return normArtikel(await api(pfad));
}

// Barcodes werden verglichen, nicht interpretiert — führende oder angehängte
// Leerzeichen aus der Handeingabe dürfen keinen Fehltreffer erzeugen.
function gleicherCode(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

// Kann diese Homebox serverseitig nach Feldwerten filtern? Einmal ermitteln
// und merken.
//
// Die Prüfung muss sein, weil ein nicht unterstützter Parameter schlicht
// ignoriert würde — die Antwort sähe dann aus wie „alles passt". Deshalb wird
// mit einem Wert gefragt, den es garantiert nicht gibt: kommt nichts zurück,
// obwohl das Inventar gefüllt ist, hat der Server wirklich gefiltert.
//
// Der Merker `feldFilter` steht oben bei `apiStil` — beide werden zurückgesetzt,
// wenn sich der Zugang ändert.
async function feldFilterPruefen() {
  if (feldFilter !== null) return feldFilter;
  if (await stilErmitteln() !== 'entities') { feldFilter = false; return false; }
  try {
    const ohne = listeAus(await api('/api/v1/entities', { params: { page: 1, pageSize: 1 } }));
    // Leeres Lager: nichts zu erkennen — und nichts zu merken, sonst bliebe
    // das Ergebnis für die ganze Laufzeit falsch.
    if (!ohne.eintraege.length) return false;
    const mit = listeAus(await api('/api/v1/entities', {
      params: { fields: [`${BARCODE_FELD}=__gibt-es-nicht__`], page: 1, pageSize: 1 },
    }));
    feldFilter = mit.eintraege.length === 0;
  } catch (_) {
    feldFilter = false;
  }
  return feldFilter;
}

// Artikel zu einem Barcode finden.
//
// Die neue API kann direkt nach Feldwerten filtern (?fields=Barcode=…) und
// vergleicht dabei exakt. Die alte kann das nicht — dort durchsucht `q` nur
// Name und Beschreibung. Für diesen Fall werden die Artikel seitenweise geholt
// und selbst gefiltert. Das ist bei einem Gemeindeinventar (einige hundert
// Artikel) unproblematisch und legt keine Kopie an: die Daten werden nur für
// diesen einen Aufruf gelesen.
//
// FALLE, die real zugeschlagen hat: die Listenantwort ist eine Kurzfassung
// OHNE Feldwerte. Der Treffer des Serverfilters durfte deshalb nicht über
// `a.barcode` geprüft werden — der ist in der Liste immer leer, also fand die
// App den eigenen Artikel nie wieder und wollte ihn erneut anlegen. Der
// Filtertreffer ist maßgeblich; das Detail wird nur noch nachgeladen.
async function beiBarcode(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;

  if (await feldFilterPruefen()) {
    const data = await api('/api/v1/entities', {
      params: { fields: [`${BARCODE_FELD}=${code}`], page: 1, pageSize: 5 },
    });
    const { eintraege } = listeAus(data);
    if (!eintraege.length) return null;      // der Server hat exakt gefiltert
    return holen(eintraege[0].id);           // Detail nachladen (Feldwerte!)
  }

  return await durchsuchenNachBarcode(code);
}

// Rückfallweg für ältere Homebox-Versionen, deren Artikelsuche `q` nur Name und
// Beschreibung durchsucht und die keinen Feld-Filter kennt.
//
// Vorgehen: erst `q` (falls der Code doch im Text steht), dann alle Artikel
// seitenweise durchgehen. Liefert die Listenantwort die Feldwerte gleich mit,
// ist man sofort fertig; andernfalls werden die Details in kleinen Bündeln
// parallel nachgeladen. Bei einem Gemeindeinventar (einige hundert Artikel) sind
// das wenige Sekunden — und es entsteht KEINE Kopie: alles bleibt im Aufruf.
const MAX_DURCHSUCHT = 600;

async function durchsuchenNachBarcode(code) {
  const stil = await stilErmitteln();
  const listenPfad = stil === 'entities' ? '/api/v1/entities' : '/api/v1/items';

  // 1. Der billige Versuch.
  try {
    const data = await api(listenPfad, { params: { q: code, pageSize: 10 } });
    const treffer = listeAus(data).eintraege.map(normArtikel).find(a => gleicherCode(a.barcode, code));
    if (treffer) return holen(treffer.id);
  } catch (_) { /* egal, unten weiter */ }

  // 2. Vollständiger Durchgang.
  const proSeite = 100;
  let geprueft = 0;
  for (let seite = 1; seite <= Math.ceil(MAX_DURCHSUCHT / proSeite); seite++) {
    const data = await api(listenPfad, { params: { page: seite, pageSize: proSeite } });
    const { eintraege, gesamt } = listeAus(data);
    if (!eintraege.length) break;

    const artikel = eintraege.map(normArtikel);
    const direkt = artikel.find(a => a.barcode === code);
    if (direkt) return holen(direkt.id);

    // Keine Feldwerte in der Liste → Details nachladen, 10 gleichzeitig.
    const ohneFelder = eintraege.some(r => !Array.isArray(r.fields));
    if (ohneFelder) {
      for (let i = 0; i < artikel.length; i += 10) {
        const bündel = artikel.slice(i, i + 10);
        const details = await Promise.all(bündel.map(a => holen(a.id).catch(() => null)));
        const t = details.find(d => d && d.barcode === code);
        if (t) return t;
      }
    }

    geprueft += eintraege.length;
    if (eintraege.length < proSeite || (gesamt && geprueft >= gesamt)) break;
    if (geprueft >= MAX_DURCHSUCHT) {
      throw new HomeboxError(
        `Barcode in den ersten ${MAX_DURCHSUCHT} Artikeln nicht gefunden. Diese Homebox-Version unterstützt keine Suche nach Feldwerten — bitte den Artikel über den Namen suchen.`,
        404,
      );
    }
  }
  return null;
}

async function orte() {
  const stil = await stilErmitteln();
  const data = stil === 'entities'
    ? await api('/api/v1/entities', { params: { isLocation: true, pageSize: 200 } })
    : await api('/api/v1/locations');
  const { eintraege } = listeAus(data);
  return eintraege.map(normOrt);
}

async function marken() {
  const stil = await stilErmitteln();
  if (stil === 'items') {
    const data = await api('/api/v1/labels');
    const { eintraege } = listeAus(data);
    return eintraege.map(m => ({ id: m.id, name: m.name }));
  }
  const data = await api('/api/v1/tags', { params: { pageSize: 200 } }).catch(() => null);
  const { eintraege } = listeAus(data);
  return eintraege.map(m => ({ id: m.id, name: m.name }));
}

// --- Schreiben ------------------------------------------------------------
// Homebox' PUT erwartet das vollständige Objekt. Deshalb wird der Rohdatensatz
// geladen, verändert und zurückgeschrieben — sonst gingen Felder verloren, die
// diese App gar nicht kennt.
async function aktualisieren(id, patch) {
  const stil = await stilErmitteln();
  const pfad = stil === 'entities' ? `/api/v1/entities/${encodeURIComponent(id)}` : `/api/v1/items/${encodeURIComponent(id)}`;
  const roh = await api(pfad);
  if (!roh) throw new HomeboxError('Artikel nicht gefunden.', 404);

  if (patch.name !== undefined) roh.name = patch.name;
  if (patch.beschreibung !== undefined) roh.description = patch.beschreibung;
  if (patch.menge !== undefined) roh.quantity = Number(patch.menge) || 0;
  if (patch.notizen !== undefined) roh.notes = patch.notizen;
  if (patch.hersteller !== undefined) roh.manufacturer = patch.hersteller;
  if (patch.kaufpreis !== undefined) roh.purchasePrice = patch.kaufpreis === null ? 0 : Number(patch.kaufpreis);
  if (patch.ortId !== undefined) {
    if (stil === 'entities') roh.parentId = patch.ortId; else roh.locationId = patch.ortId;
  }
  if (patch.markenIds !== undefined) {
    if (stil === 'entities') roh.tagIds = patch.markenIds; else roh.labelIds = patch.markenIds;
  }
  if (patch.barcode !== undefined) setzeBarcodeFeld(roh, patch.barcode);

  // PUT will die IDs der Beziehungen, nicht die eingebetteten Objekte.
  if (stil === 'entities') {
    if (roh.parentId === undefined && roh.parent) roh.parentId = roh.parent.id;
    if (roh.tagIds === undefined && roh.tags) roh.tagIds = roh.tags.map(t => t.id);
  } else {
    if (roh.locationId === undefined && roh.location) roh.locationId = roh.location.id;
    if (roh.labelIds === undefined && roh.labels) roh.labelIds = roh.labels.map(l => l.id);
  }

  await api(pfad, { method: 'PUT', body: roh });
  return holen(id);
}

function setzeBarcodeFeld(roh, barcode) {
  if (!Array.isArray(roh.fields)) roh.fields = [];
  const i = roh.fields.findIndex(f => String(f.name || '').toLowerCase() === BARCODE_FELD.toLowerCase());
  if (i >= 0) roh.fields[i].textValue = String(barcode || '');
  else roh.fields.push({ name: BARCODE_FELD, type: 'text', textValue: String(barcode || '') });
}

async function anlegen({ name, beschreibung, menge, ortId, barcode, markenIds, hersteller, kaufpreis, notizen }) {
  const stil = await stilErmitteln();
  const basis = {
    name: String(name || '').trim(),
    description: beschreibung || '',
    quantity: Number(menge) || 1,
  };
  if (stil === 'entities') {
    basis.parentId = ortId || undefined;
    if (markenIds && markenIds.length) basis.tagIds = markenIds;
  } else {
    basis.locationId = ortId || undefined;
    if (markenIds && markenIds.length) basis.labelIds = markenIds;
  }

  const pfad = stil === 'entities' ? '/api/v1/entities' : '/api/v1/items';
  const angelegt = await api(pfad, { method: 'POST', body: basis });
  const id = angelegt && angelegt.id;
  if (!id) throw new HomeboxError('Homebox hat keine ID für den neuen Artikel geliefert.', 502);

  // Barcode und die übrigen Felder kann POST nicht — sie kommen per Update
  // hinterher. Das ist ein Aufruf mehr, aber der einzige verlässliche Weg.
  const nach = {};
  if (barcode) nach.barcode = barcode;
  if (hersteller) nach.hersteller = hersteller;
  if (kaufpreis != null) nach.kaufpreis = kaufpreis;
  if (notizen) nach.notizen = notizen;
  if (Object.keys(nach).length) return aktualisieren(id, nach);
  return holen(id);
}

// Bestand ändern. `delta` bucht relativ (Entnahme/Zugang), `menge` setzt absolut.
// Relativ ist der Normalfall am Lager und vermeidet, dass zwei gleichzeitige
// Buchungen sich gegenseitig überschreiben.
async function bestandAendern(id, { delta, menge }) {
  if (menge != null) return aktualisieren(id, { menge: Math.max(0, Number(menge) || 0) });
  const a = await holen(id);
  if (!a) throw new HomeboxError('Artikel nicht gefunden.', 404);
  const neu = Math.max(0, a.menge + (Number(delta) || 0));
  return aktualisieren(id, { menge: neu });
}

// Einen Gegenstand aus dem Bestand entfernen. Homebox löscht dabei auch dessen
// Wartungseinträge; die lokale Ergänzung dazu räumt die Route auf.
async function loeschen(id) {
  const stil = await stilErmitteln();
  const pfad = stil === 'entities' ? `/api/v1/entities/${encodeURIComponent(id)}` : `/api/v1/items/${encodeURIComponent(id)}`;
  await api(pfad, { method: 'DELETE' });
  return { geloescht: true, id };
}

// --- Wartungen ------------------------------------------------------------
// Homebox führt Wartungen selbst — geprüft am Quelltext (v1_ctrl_maint_entry.go,
// repo_maintenance_entry.go). Was es NICHT kennt, ist eine Wiederholung; das
// Intervall führt darum die Gemeindeverwaltung (backend/db.js, inventar_wartungen).
//
// Drei Eigenheiten, die beim Bauen Zeit gekostet hätten:
//  * Ein Eintrag ist ENTWEDER geplant ODER erledigt. „Offen" heißt: geplantes
//    Datum gesetzt, Erledigungsdatum leer. Homebox liefert ein leeres Datum als
//    leere Zeichenkette, nicht als null.
//  * `cost` ist im JSON eine ZEICHENKETTE (Go-Tag `,string`) — als Zahl
//    geschickt lehnt Homebox den ganzen Datensatz ab.
//  * Bei `/v1/maintenance` ist `status` PFLICHT. Ohne den Parameter antwortet
//    Homebox mit „unknown status" statt mit allen Einträgen.
const WARTUNG_STATUS = ['scheduled', 'completed', 'both'];

function normWartung(roh) {
  if (!roh) return null;
  const datum = (v) => (v ? String(v).slice(0, 10) : '');
  const geplant = datum(roh.scheduledDate);
  const erledigt = datum(roh.completedDate);
  return {
    id: roh.id,
    itemId: roh.itemID || roh.itemId || '',
    itemName: roh.itemName || '',
    name: roh.name || '',
    beschreibung: roh.description || '',
    geplantAm: geplant,
    erledigtAm: erledigt,
    kosten: roh.cost != null && roh.cost !== '' ? Number(roh.cost) : null,
    offen: !erledigt,
  };
}

// Homebox akzeptiert nur „YYYY-MM-DD"; ein leeres Datum muss als leere
// Zeichenkette mitgehen, sonst scheitert das Entfernen eines Termins.
function wartungBody({ name, beschreibung, geplantAm, erledigtAm, kosten }) {
  return {
    name: String(name || '').trim(),
    description: beschreibung || '',
    scheduledDate: geplantAm ? String(geplantAm).slice(0, 10) : '',
    completedDate: erledigtAm ? String(erledigtAm).slice(0, 10) : '',
    cost: String(kosten == null || kosten === '' ? 0 : Number(kosten)),
  };
}

function wartungPfad(itemId) {
  return apiStil === 'entities'
    ? `/api/v1/entities/${encodeURIComponent(itemId)}/maintenance`
    : `/api/v1/items/${encodeURIComponent(itemId)}/maintenance`;
}

async function wartungen(itemId, status = 'both') {
  await stilErmitteln();
  const s = WARTUNG_STATUS.includes(status) ? status : 'both';
  const data = await api(wartungPfad(itemId), { params: { status: s } });
  const arr = Array.isArray(data) ? data : listeAus(data).eintraege;
  return arr.map(normWartung).map(w => Object.assign(w, { itemId: w.itemId || itemId }));
}

// Alle Wartungen des ganzen Bestands in EINEM Aufruf — die Grundlage des
// täglichen Laufs. Ältere Homebox-Versionen kennen den Weg nicht (404); dann
// bleibt nur der Gang über die einzelnen Gegenstände.
async function alleWartungen(status = 'scheduled') {
  await stilErmitteln();
  const s = WARTUNG_STATUS.includes(status) ? status : 'scheduled';
  const data = await api('/api/v1/maintenance', { params: { status: s } });
  const arr = Array.isArray(data) ? data : listeAus(data).eintraege;
  return arr.map(normWartung);
}

async function wartungAnlegen(itemId, daten) {
  await stilErmitteln();
  const body = wartungBody(daten);
  if (!body.name) throw new HomeboxError('Die Wartung braucht eine Bezeichnung.', 400);
  if (!body.scheduledDate && !body.completedDate) {
    throw new HomeboxError('Bitte ein geplantes oder ein Erledigungsdatum angeben.', 400);
  }
  return normWartung(await api(wartungPfad(itemId), { method: 'POST', body }));
}

async function wartungAendern(id, daten) {
  await stilErmitteln();
  const body = wartungBody(daten);
  if (!body.scheduledDate && !body.completedDate) {
    throw new HomeboxError('Bitte ein geplantes oder ein Erledigungsdatum angeben.', 400);
  }
  return normWartung(await api(`/api/v1/maintenance/${encodeURIComponent(id)}`, { method: 'PUT', body }));
}

async function wartungLoeschen(id) {
  await stilErmitteln();
  await api(`/api/v1/maintenance/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { geloescht: true, id };
}

// Kann diese Homebox Wartungen? Ältere Versionen kennen die Pfade nicht. Einmal
// prüfen reicht — das Ergebnis hängt an der Version, nicht am Gegenstand.
let wartungenMoeglich = null;
async function wartungenVerfuegbar() {
  if (wartungenMoeglich !== null) return wartungenMoeglich;
  try {
    await alleWartungen('scheduled');
    wartungenMoeglich = true;
  } catch (e) {
    if (e.status === 404) wartungenMoeglich = false;
    else throw e;
  }
  return wartungenMoeglich;
}

async function health() {
  await stilErmitteln();
  // Den Namen der aktiven Sammlung mitgeben — bei mehreren Beständen ist das
  // die wichtigste Rückmeldung: arbeite ich gerade im richtigen?
  let aktiv = cfg.groupName || '';
  let mehrere = false;
  try {
    const liste = await sammlungen();
    mehrere = liste.length > 1;
    if (cfg.groupId) {
      const g = liste.find(x => x.id === cfg.groupId);
      if (g) aktiv = g.name;
    } else {
      // Ohne eigene Wahl greift die Standard-Sammlung des Kontos. Welche das
      // ist, steht am Nutzer — die Reihenfolge der Liste sagt es NICHT.
      const self = await api('/api/v1/users/self', { ohneSammlung: true }).catch(() => null);
      const std = self && (self.item || self).defaultGroupId;
      const g = std ? liste.find(x => x.id === std) : null;
      aktiv = g ? `${g.name} (Standard)` : 'Standard-Sammlung des Kontos';
    }
  } catch (_) { /* ältere Versionen ohne Sammlungen */ }
  return { ok: true, url: cfg.url, apiStil, sammlung: aktiv, mehrereSammlungen: mehrere };
}

module.exports = {
  HomeboxError,
  BARCODE_FELD,
  isConfigured,
  publicConfig,
  setConfig,
  sammlungen,
  suchen,
  holen,
  beiBarcode,
  orte,
  marken,
  anlegen,
  aktualisieren,
  bestandAendern,
  loeschen,
  wartungen,
  alleWartungen,
  wartungAnlegen,
  wartungAendern,
  wartungLoeschen,
  wartungenVerfuegbar,
  health,
  // für Tests
  _normArtikel: normArtikel,
  _normWartung: normWartung,
  _wartungBody: wartungBody,
};
