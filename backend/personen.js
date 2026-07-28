'use strict';

// Zentrale Personen-Stammdaten.
//
// Früher gab es fünf getrennte Personenlisten (Ratsmitglieder, Mieter,
// Empfänger, Arbeiter/Firmen, Vertragspartner) mit je eigener Tabelle. Sie
// liegen jetzt alle in `personen`; welche Liste eine Person betrifft, sagen die
// Rollen-Flags. Entscheidend für die Migration ohne Datenverlust:
//
//  * Jede Person BEHÄLT die id ihres alten Datensatzes. Damit lösen
//    vermietung.mieterId, auslage.empfaengerId, arbeitszeit.arbeiterId,
//    vertrag.partnerId und die Anwesenheitslisten der Sitzungen unverändert auf –
//    kein einziger Verweis muss umgeschrieben werden.
//  * Das Feldschema ist die VEREINIGUNG aller fünf Quellen, nicht die
//    Schnittmenge. Kein Feld geht verloren.
//  * Zwei Namensfallen aus den Altdaten: `empfaenger.name` meint den NACHNAMEN,
//    `vertragspartner.name` dagegen die FIRMA. Und die Vertragspartner-Anschrift
//    ist mehrzeiliger Freitext, während Mieter/Arbeiter Straße/PLZ/Ort getrennt
//    führen – der Freitext bleibt darum als eigenes Feld erhalten, statt beim
//    Migrieren geraten zu werden.
//
// Die to*/apply*-Funktionen bilden die alten Datensatz-Formen auf Personen ab
// und zurück. Dadurch arbeiten die bestehenden Routen, Ansichten und PDFs
// unverändert weiter, obwohl darunter nur noch eine Liste liegt.
//
// ACHTUNG: Dieselbe Abbildung gibt es ein zweites Mal im Frontend
// (app/src/models.js, Abschnitt „Personen"). Node-Modul und Browser-Skript
// können sich keine Datei teilen – Änderungen hier müssen dort nachgezogen
// werden.
//
// Das Zusammenführen von Dubletten selbst liegt bewusst NUR im Frontend
// (models.js, Abschnitt „Personen zusammenführen" + store.js): es muss die
// Verweise aller Module mitziehen, und die kennt der Store ohnehin komplett im
// Cache. Hier gehören nur das Feld `zusammengefuehrt` und die Alias-Auflösung
// her, damit ein eingespieltes Backup dieselbe Form behält.

const ROLLEN = ['rat', 'mieter', 'empfaenger', 'arbeiter', 'partner'];

const ROLLEN_LABEL = {
  rat: 'Ratsmitglied',
  mieter: 'Mieter',
  empfaenger: 'Auslagen-Empfänger',
  arbeiter: 'Arbeiter/Firma',
  partner: 'Vertragspartner',
};

function emptyRollen() {
  return { rat: false, mieter: false, empfaenger: false, arbeiter: false, partner: false };
}

function emptyPerson(id) {
  return {
    id: id || '',
    // Identität
    anrede: '',
    vorname: '',
    nachname: '',
    firma: '',              // gesetzt ⇒ Anzeigename; die Person ist dann Ansprechpartner
    ansprechpartner: '',    // Freitext aus den alten Vertragspartnern
    // Anschrift
    strasse: '',
    plz: '',
    ort: '',
    anschriftFreitext: '',  // mehrzeilig, aus den alten Vertragspartnern
    // Kontakt
    telefon: '',
    email: '',
    // Bankverbindung (sensibel)
    iban: '',
    kontoinhaber: '',
    // Steuer/Sozialversicherung (sensibel)
    svNummer: '',
    steuerId: '',
    geburtsdatum: '',
    // Rollen + rollenspezifische Felder
    rollen: emptyRollen(),
    funktion: '',           // nur Rolle rat
    ortsfremd: false,       // nur Rolle mieter
    // Allgemein
    notiz: '',
    aktiv: true,
    aliasIds: [],           // ids zusammengeführter Dubletten
    herkunft: [],           // aus welchen Altlisten die Person stammt
    zusammengefuehrt: [],   // Archiv je Zusammenführung (Rückgängig-Grundlage)
    schemaVersion: 1,
  };
}

// Fehlende Felder auffüllen (Altbestand, NocoDB-Restore, fremde Payloads).
function normalizePerson(p) {
  const out = Object.assign(emptyPerson(p && p.id), p || {});
  out.rollen = Object.assign(emptyRollen(), (p && p.rollen) || {});
  out.aliasIds = Array.isArray(out.aliasIds) ? out.aliasIds : [];
  out.herkunft = Array.isArray(out.herkunft) ? out.herkunft : [];
  out.zusammengefuehrt = Array.isArray(out.zusammengefuehrt) ? out.zusammengefuehrt : [];
  return out;
}

// Eine über `aliasIds` aufgegebene id findet ihre Zielperson wieder. Nötig für
// alte Backups und NocoDB-Zeilen, die noch die id der zusammengeführten
// Dublette tragen – ohne das liefe der Verweis ins Leere.
function findePersonMitAlias(personen, id) {
  if (!id) return null;
  const direkt = (personen || []).find(p => p.id === id);
  if (direkt) return direkt;
  return (personen || []).find(p => Array.isArray(p.aliasIds) && p.aliasIds.includes(id)) || null;
}

function setRolle(p, rolle, an) {
  p.rollen = Object.assign(emptyRollen(), p.rollen || {});
  p.rollen[rolle] = !!an;
  return p;
}
function hatRolle(p, rolle) { return !!(p && p.rollen && p.rollen[rolle]); }
function hatIrgendeineRolle(p) { return ROLLEN.some(r => hatRolle(p, r)); }

function merkeHerkunft(p, quelle) {
  if (!Array.isArray(p.herkunft)) p.herkunft = [];
  if (quelle && !p.herkunft.includes(quelle)) p.herkunft.push(quelle);
  return p;
}

const s = (v) => String(v == null ? '' : v).trim();

// Anzeigename: Firma falls gesetzt, sonst „Vorname Nachname".
function personName(p) {
  if (!p) return '';
  const firma = s(p.firma);
  if (firma) return firma;
  return [s(p.vorname), s(p.nachname)].filter(Boolean).join(' ');
}
// Name der dahinterstehenden Person (auch wenn eine Firma den Namen stellt).
function personLangname(p) {
  if (!p) return '';
  return [s(p.vorname), s(p.nachname)].filter(Boolean).join(' ');
}
// Anschrift als Einzeiler; bevorzugt die strukturierten Felder.
function personAnschrift(p) {
  if (!p) return '';
  const strukturiert = [s(p.strasse), [s(p.plz), s(p.ort)].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  if (strukturiert) return strukturiert;
  return s(p.anschriftFreitext).split('\n').map(x => x.trim()).filter(Boolean).join(', ');
}

// ---------------------------------------------------------------- Ratsmitglied
function toMitglied(p) {
  return {
    id: p.id,
    vorname: s(p.vorname),
    nachname: s(p.nachname),
    funktion: s(p.funktion) || 'Ratsmitglied',
    aktiv: p.aktiv !== false,
    lastModifiedAt: p.lastModifiedAt,
  };
}
function applyMitglied(person, m) {
  const p = normalizePerson(person || emptyPerson(m.id));
  p.id = m.id;
  p.vorname = s(m.vorname);
  p.nachname = s(m.nachname);
  p.funktion = s(m.funktion) || 'Ratsmitglied';
  if (m.aktiv !== undefined) p.aktiv = !!m.aktiv;
  return merkeHerkunft(setRolle(p, 'rat', true), 'mitglieder');
}

// ---------------------------------------------------------------------- Mieter
function toMieter(p) {
  return {
    id: p.id,
    anrede: s(p.anrede),
    vorname: s(p.vorname),
    nachname: s(p.nachname),
    strasse: s(p.strasse),
    plz: s(p.plz),
    ort: s(p.ort),
    telefon: s(p.telefon),
    email: s(p.email),
    ortsfremd: !!p.ortsfremd,
    notiz: p.notiz || '',
    lastModifiedAt: p.lastModifiedAt,
  };
}
function applyMieter(person, m) {
  const p = normalizePerson(person || emptyPerson(m.id));
  p.id = m.id;
  p.anrede = s(m.anrede);
  p.vorname = s(m.vorname);
  p.nachname = s(m.nachname);
  p.strasse = s(m.strasse);
  p.plz = s(m.plz);
  p.ort = s(m.ort);
  p.telefon = s(m.telefon);
  p.email = s(m.email);
  p.ortsfremd = !!m.ortsfremd;
  if (m.notiz !== undefined) p.notiz = m.notiz;
  return merkeHerkunft(setRolle(p, 'mieter', true), 'mieter');
}

// ------------------------------------------------------------------- Empfänger
// Falle: `name` ist hier der Nachname (im Formular „Name (Nachname)").
function toEmpfaenger(p) {
  return {
    id: p.id,
    name: s(p.nachname) || s(p.firma),
    vorname: s(p.vorname),
    iban: s(p.iban),
    lastModifiedAt: p.lastModifiedAt,
  };
}
function applyEmpfaenger(person, e) {
  const p = normalizePerson(person || emptyPerson(e.id));
  p.id = e.id;
  // Bei Firmen steht der Anzeigename in `firma`; dann den Namen nicht in den
  // Nachnamen zurückschreiben, sonst stünde die Firma doppelt im Datensatz.
  if (s(p.firma) && s(e.name) === s(p.firma)) { /* unverändert lassen */ }
  else p.nachname = s(e.name);
  p.vorname = s(e.vorname);
  p.iban = s(e.iban);
  return merkeHerkunft(setRolle(p, 'empfaenger', true), 'empfaenger');
}

// -------------------------------------------------------------- Arbeiter/Firma
function toArbeiter(p) {
  return {
    id: p.id,
    vorname: s(p.vorname),
    nachname: s(p.nachname),
    firma: s(p.firma),
    strasse: s(p.strasse),
    plz: s(p.plz),
    ort: s(p.ort),
    iban: s(p.iban),
    kontoinhaber: s(p.kontoinhaber),
    svNummer: s(p.svNummer),
    steuerId: s(p.steuerId),
    geburtsdatum: s(p.geburtsdatum),
    telefon: s(p.telefon),
    email: s(p.email),
    notiz: p.notiz || '',
    aktiv: p.aktiv !== false,
    lastModifiedAt: p.lastModifiedAt,
  };
}
function applyArbeiter(person, a) {
  const p = normalizePerson(person || emptyPerson(a.id));
  p.id = a.id;
  p.vorname = s(a.vorname);
  p.nachname = s(a.nachname);
  p.firma = s(a.firma);
  p.strasse = s(a.strasse);
  p.plz = s(a.plz);
  p.ort = s(a.ort);
  p.iban = s(a.iban);
  p.kontoinhaber = s(a.kontoinhaber);
  p.svNummer = s(a.svNummer);
  p.steuerId = s(a.steuerId);
  p.geburtsdatum = s(a.geburtsdatum);
  p.telefon = s(a.telefon);
  p.email = s(a.email);
  if (a.notiz !== undefined) p.notiz = a.notiz;
  if (a.aktiv !== undefined) p.aktiv = !!a.aktiv;
  return merkeHerkunft(setRolle(p, 'arbeiter', true), 'arbeiter');
}

// -------------------------------------------------------------- Vertragspartner
// Falle: `name` ist hier die Firma bzw. der komplette Name, `anschrift` ist
// mehrzeiliger Freitext.
function toVertragspartner(p) {
  const anschrift = s(p.anschriftFreitext)
    || [s(p.strasse), [s(p.plz), s(p.ort)].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  return {
    id: p.id,
    name: personName(p),
    anschrift,
    ansprechpartner: s(p.ansprechpartner) || (s(p.firma) ? personLangname(p) : ''),
    telefon: s(p.telefon),
    email: s(p.email),
    notiz: p.notiz || '',
    lastModifiedAt: p.lastModifiedAt,
  };
}
function applyVertragspartner(person, v) {
  const p = normalizePerson(person || emptyPerson(v.id));
  p.id = v.id;
  // „Name / Firma" ist im alten Formular beides. Entspricht der Text genau dem
  // Personennamen, bleiben Vor-/Nachname stehen – sonst ist es eine Firma.
  const name = s(v.name);
  if (name && name === personLangname(p)) { /* Personenname unverändert */ }
  else p.firma = name;
  p.ansprechpartner = s(v.ansprechpartner);
  p.anschriftFreitext = v.anschrift || '';
  p.telefon = s(v.telefon);
  p.email = s(v.email);
  if (v.notiz !== undefined) p.notiz = v.notiz;
  return merkeHerkunft(setRolle(p, 'partner', true), 'vertragspartner');
}

// Beim Anlegen aus einem Modul heraus: leere Person mit passender Rolle.
function neuePersonFuerRolle(id, rolle) {
  const p = emptyPerson(id);
  if (rolle) setRolle(p, rolle, true);
  return p;
}

const QUELLEN = [
  { quelle: 'mitglieder', rolle: 'rat', apply: applyMitglied },
  { quelle: 'mieter', rolle: 'mieter', apply: applyMieter },
  { quelle: 'empfaenger', rolle: 'empfaenger', apply: applyEmpfaenger },
  { quelle: 'arbeiter', rolle: 'arbeiter', apply: applyArbeiter },
  { quelle: 'vertragspartner', rolle: 'partner', apply: applyVertragspartner },
];

module.exports = {
  ROLLEN, ROLLEN_LABEL, QUELLEN,
  emptyRollen, emptyPerson, normalizePerson, findePersonMitAlias,
  setRolle, hatRolle, hatIrgendeineRolle,
  personName, personLangname, personAnschrift,
  toMitglied, applyMitglied,
  toMieter, applyMieter,
  toEmpfaenger, applyEmpfaenger,
  toArbeiter, applyArbeiter,
  toVertragspartner, applyVertragspartner,
  neuePersonFuerRolle,
};
