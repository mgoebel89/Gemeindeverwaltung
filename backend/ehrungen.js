'use strict';

// Altersjubiläen und ihre Ehrungen.
//
// Die Ortsgemeinde ehrt zur Vollendung des 80., 90., 95. und 100. Lebensjahres.
// Wer wann dran ist, wird aus dem Geburtsdatum GERECHNET und nirgends
// gespeichert — sonst müsste die Liste jedes Jahr gepflegt werden.
//
// Gespeichert wird nur, was die Rechnung nicht weiß: ob die Urkunde schon
// gedruckt und die Ehrung überreicht wurde, eine Notiz dazu und die Aufgabe,
// die der Tageslauf dafür angelegt hat. Das ist dasselbe Muster wie bei den
// Inventar-Wartungen: die führende Quelle bleibt außerhalb, hier steht nur die
// Ergänzung.
//
// Die id einer Ehrung ist `<einwohnerId>-<alter>` und damit vorhersagbar. Das
// ist der einzige Schutz davor, dass der Tageslauf morgen dieselbe Ehrung noch
// einmal anlegt — ein zweiter Datensatz für denselben 90. Geburtstag kann gar
// nicht entstehen.
//
// EIN SCHNAPPSCHUSS DES NAMENS liegt bewusst mit im Datensatz. Zieht die Person
// später weg und wird aus der NocoDB-Liste gelöscht, stünde in der Historie
// sonst eine nackte Kennung — und niemand wüsste mehr, wer 2027 geehrt wurde.

const db = require('./db');

const JUBILAEUMS_ALTER = [80, 90, 95, 100];

const STATUS = ['offen', 'urkunde', 'ueberreicht'];
const STATUS_LABEL = {
  offen: 'Offen',
  urkunde: 'Urkunde erstellt',
  ueberreicht: 'Überreicht',
};

// --- Datumshilfen ---------------------------------------------------------
// Wie überall in diesem Projekt: Kalendertage NUR über lokale Komponenten.
// `toISOString` rechnet nach UTC um und verschiebt in unserer Zeitzone den Tag.
function zuIso(d) {
  const j = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${j}-${m}-${t}`;
}
function heuteIso() { return zuIso(new Date()); }

function teile(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? { j: Number(m[1]), m: Number(m[2]), t: Number(m[3]) } : null;
}

function schaltjahr(j) {
  return (j % 4 === 0 && j % 100 !== 0) || j % 400 === 0;
}

// Der Tag, an dem jemand ein bestimmtes Alter vollendet.
//
// SONDERFALL 29. FEBRUAR: Wer am 29.02. geboren ist, hat in drei von vier
// Jahren gar keinen Geburtstag. Ohne Behandlung fiele die Person schlicht durchs
// Raster und bekäme nie eine Ehrung. Gefeiert wird dann am 28.02.
function jubilaeumsDatum(geburtsdatum, alter) {
  const g = teile(geburtsdatum);
  if (!g) return '';
  const zielJahr = g.j + Number(alter);
  let tag = g.t;
  if (g.m === 2 && g.t === 29 && !schaltjahr(zielJahr)) tag = 28;
  return `${zielJahr}-${String(g.m).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

// Vollendetes Lebensalter an einem Stichtag.
function alterAm(geburtsdatum, stichtag) {
  const g = teile(geburtsdatum);
  const s = teile(stichtag || heuteIso());
  if (!g || !s) return null;
  let a = s.j - g.j;
  if (s.m < g.m || (s.m === g.m && s.t < g.t)) a--;
  return a;
}

function tageBis(iso, ab) {
  const z = teile(iso);
  const h = teile(ab || heuteIso());
  if (!z || !h) return null;
  return Math.round(
    (new Date(z.j, z.m - 1, z.t) - new Date(h.j, h.m - 1, h.t)) / 86400000,
  );
}

// Kalendermonat addieren, ohne ins Nachbarmonat zu rutschen (31.01. + 1 Monat
// = 28./29.02.). Wie in wartungslauf.js — dieselbe Falle, dieselbe Lösung.
function plusMonate(iso, monate) {
  const p = teile(iso);
  if (!p) return '';
  const ziel = new Date(p.j, p.m - 1 + Number(monate), 1);
  const letzterTag = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  ziel.setDate(Math.min(p.t, letzterTag));
  return zuIso(ziel);
}

// --- Jubiläen -------------------------------------------------------------
const ehrungId = (einwohnerId, alter) => `${einwohnerId}-${alter}`;

// Alle Jubiläen einer Person, die in ein Zeitfenster fallen.
// ISO-Daten lassen sich als Zeichenketten vergleichen — das ist hier gewollt,
// weil es die Zeitzonenfalle gar nicht erst aufmacht.
function jubilaeenVon(e, vonIso, bisIso) {
  const out = [];
  if (!e || !e.geburtsdatum) return out;
  for (const alter of JUBILAEUMS_ALTER) {
    const datum = jubilaeumsDatum(e.geburtsdatum, alter);
    if (!datum) continue;
    if (vonIso && datum < vonIso) continue;
    if (bisIso && datum > bisIso) continue;
    out.push({ alter, datum });
  }
  return out;
}

// Die Ehrungen aller Einwohner in einem Zeitfenster, mit dem gespeicherten
// Zustand verschmolzen und nach Datum sortiert.
function anstehende(einwohner, vonIso, bisIso) {
  const out = [];
  for (const e of einwohner || []) {
    for (const j of jubilaeenVon(e, vonIso, bisIso)) {
      out.push(verschmelzen(e, j.alter, j.datum));
    }
  }
  out.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
  return out;
}

// Gerechnetes Jubiläum + gespeicherte Ergänzung = ein Datensatz fürs Frontend.
function verschmelzen(e, alter, datum) {
  const id = ehrungId(e.id, alter);
  const gespeichert = db.getEhrung(id) || {};
  return {
    id,
    einwohnerId: e.id,
    alter: Number(alter),
    datum,
    nachname: e.nachname || gespeichert.nachname || '',
    vorname: e.vorname || gespeichert.vorname || '',
    strasse: e.strasse || '',
    hausnummer: e.hausnummer || '',
    zusatz: e.zusatz || '',
    wohnort: e.wohnort || '',
    wohnungsart: e.wohnungsart || '',
    geburtsdatum: e.geburtsdatum || '',
    status: STATUS.includes(gespeichert.status) ? gespeichert.status : 'offen',
    notiz: gespeichert.notiz || '',
    aufgabeId: gespeichert.aufgabeId || null,
    urkundeAm: gespeichert.urkundeAm || '',
    ueberreichtAm: gespeichert.ueberreichtAm || '',
    tageBis: tageBis(datum),
  };
}

// Speichern legt den Datensatz erst an, wenn es etwas zu merken gibt — eine
// Ehrung im Zustand „offen" ohne Notiz und ohne Aufgabe ist reine Rechnung und
// braucht keine Zeile.
function speichern(ehrung, patch) {
  const id = ehrung.id || ehrungId(ehrung.einwohnerId, ehrung.alter);
  const vorher = db.getEhrung(id) || {};
  const neu = Object.assign({}, vorher, {
    id,
    einwohnerId: ehrung.einwohnerId,
    alter: Number(ehrung.alter),
    datum: ehrung.datum,
    // Namensschnappschuss aktuell halten, solange die Person noch in der Liste
    // steht — danach ist er das Einzige, was bleibt.
    nachname: ehrung.nachname || vorher.nachname || '',
    vorname: ehrung.vorname || vorher.vorname || '',
  }, patch || {}, { lastModifiedAt: new Date().toISOString() });

  const leer = (!neu.status || neu.status === 'offen')
    && !neu.notiz && !neu.aufgabeId && !neu.urkundeAm && !neu.ueberreichtAm;
  if (leer) {
    if (vorher.id) db.deleteEhrung(id);
    return neu;
  }
  db.saveEhrung(neu);
  return neu;
}

// Die Historie: alles, was jemals gespeichert wurde — auch zu Personen, die
// inzwischen weggezogen und aus der Liste gelöscht sind.
function historie() {
  return db.listEhrungen()
    .slice()
    .sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));
}

module.exports = {
  JUBILAEUMS_ALTER, STATUS, STATUS_LABEL,
  jubilaeumsDatum, alterAm, tageBis, plusMonate, zuIso, heuteIso, schaltjahr,
  ehrungId, jubilaeenVon, anstehende, verschmelzen, speichern, historie,
};
