'use strict';

// Einwohner-Abgleich mit der Papierliste der Verbandsgemeinde.
//
// Die Verbandsgemeinde schickt die Liste einmal im Jahr auf PAPIER. Früher hieß
// das: Prüfliste drucken, mit dem Stift durchgehen, Änderungen hinterher
// eintippen. Der Lauf hier ersetzt den Stift — die Liste steht am Bildschirm in
// derselben Reihenfolge wie das Papier und wird Straße für Straße abgehakt.
//
// WARUM DAS IN DIE DATENBANK GEHÖRT UND NICHT IN DEN BROWSER:
// Ein Abgleich über mehrere hundert Einwohner macht niemand in einem Zug. Das
// Telefon klingelt, der Browser wird zugemacht, morgen geht es weiter. Läge der
// Haken nur im Speicher der Seite, wäre er beim ersten Neuladen weg — und
// niemand fängt einen Abgleich zweimal an.
//
// WAS HIER NICHT LIEGT — und das ist der springende Punkt:
// Nur die NocoDB-Kennung und der Haken. Kein Name, kein Geburtsdatum, keine
// Anschrift. Die Namen holt die Oberfläche bei jedem Öffnen frisch aus der
// Base, hinter dem PIN-Gate. Damit bleibt die Zusage dieses Moduls unberührt,
// dass das Melderegister nirgends lokal gespiegelt wird.
//
// Das unterscheidet den Merkzettel von der Tabelle `ehrungen`: dort steht
// bewusst ein Namensschnappschuss, weil eine Ehrung Jahre später noch
// nachvollziehbar sein muss, auch wenn die Person längst weggezogen ist. Hier
// ist das Gegenteil richtig — der Merkzettel lebt nur, solange der Lauf läuft,
// und wer darin steht, steht per Definition noch in der Base.

const db = require('./db');

// Vier Zustände, die eine Zeile im Lauf annehmen kann. Alle vier zählen als
// „durch" — der Fortschritt fragt nicht, WIE eine Zeile erledigt wurde.
//   ok        stimmt so, wie sie dasteht
//   geaendert etwas korrigiert (Umzug, Schreibfehler, Geburtsdatum)
//   neu       während des Laufs zugezogen und angelegt
//   fehlt     steht bei uns, aber nicht mehr auf der Papierliste
//
// `fehlt` löscht NICHT. Es ist eine Vormerkung, über die zum Abschluss des Laufs
// gesammelt entschieden wird. Ein Fingertipp darf keine Person aus dem
// Melderegister werfen — vertippt ist schnell, und die Löschung geht sofort und
// unwiderruflich in die NocoDB-Base.
const STATUS = ['ok', 'geaendert', 'neu', 'fehlt'];

function heuteIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Der Lauf selbst (Startdatum) steht im allgemeinen Settings-Blob — das sind
// keine Personendaten, sondern ein Datum, genau wie der bereits vorhandene
// Vermerk `letzterAbgleich`. Die Marken dagegen dürfen dort nicht stehen: der
// Settings-Blob fährt im Snapshot an jeden Browser im Netz.
function einstellungen() {
  const s = db.getSettings() || {};
  return s.einwohner || {};
}

function einstellungenSchreiben(patch) {
  const s = db.getSettings() || {};
  s.einwohner = Object.assign({}, s.einwohner, patch);
  db.saveSettings(s);
  return s.einwohner;
}

function laufOffen() {
  const e = einstellungen();
  return e.abgleichLauf && e.abgleichLauf.startAm ? e.abgleichLauf : null;
}

// --- Lauf steuern ---------------------------------------------------------
// Ein neuer Lauf beginnt mit leerem Merkzettel. Sonst schleppte er die Haken
// des Vorjahres mit und meldete Zeilen als geprüft, die niemand angesehen hat.
function starten() {
  db.clearAbgleichMarken();
  const lauf = { startAm: heuteIso(), startZeit: new Date().toISOString() };
  einstellungenSchreiben({ abgleichLauf: lauf });
  return { lauf, marken: {} };
}

function abbrechen() {
  db.clearAbgleichMarken();
  einstellungenSchreiben({ abgleichLauf: null });
  return { ok: true };
}

// Nach Kennung geschlüsselt, weil die Oberfläche genau so danach fragt: sie hat
// eine Einwohnerzeile und will wissen, ob die schon durch ist.
function marken() {
  const out = {};
  for (const m of db.listAbgleichMarken()) {
    if (m && m.id) out[m.id] = { status: m.status, am: m.am || '' };
  }
  return out;
}

function stand() {
  return { lauf: laufOffen(), marken: marken() };
}

// Ein leerer Status nimmt den Haken zurück — dieselbe Schaltfläche noch einmal
// gedrückt, und die Zeile ist wieder offen. Ohne diesen Weg bliebe ein
// Fehlgriff für den Rest des Laufs stehen.
function markieren(einwohnerId, status) {
  const id = String(einwohnerId || '').trim();
  if (!id) throw Object.assign(new Error('Zu welcher Person?'), { status: 400 });
  if (!status) {
    db.deleteAbgleichMarke(id);
    return { id, status: '' };
  }
  if (!STATUS.includes(status)) {
    throw Object.assign(new Error('Unbekannter Abgleichsstatus.'), { status: 400 });
  }
  const eintrag = { id, status, am: new Date().toISOString() };
  db.saveAbgleichMarke(eintrag);
  return eintrag;
}

// Alles, was zum Löschen vorgemerkt ist — nur Kennungen. Die Namen dazu sucht
// die Oberfläche in der Liste, die sie ohnehin schon geladen hat.
function vorgemerkt() {
  return Object.entries(marken())
    .filter(([, m]) => m.status === 'fehlt')
    .map(([id]) => id);
}

// --- Abschluss ------------------------------------------------------------
// Der Abschluss räumt den Merkzettel weg und hinterlässt genau das, was vorher
// schon vermerkt wurde: wann zuletzt abgeglichen wurde und wie viele es waren.
function abschliessen(anzahl) {
  const heute = heuteIso();
  db.clearAbgleichMarken();
  einstellungenSchreiben({
    abgleichLauf: null,
    letzterAbgleich: heute,
    letzterAbgleichAnzahl: Number(anzahl) || 0,
  });
  return { ok: true, letzterAbgleich: heute };
}

module.exports = {
  STATUS,
  heuteIso,
  starten, abbrechen, stand, marken, markieren, vorgemerkt, abschliessen,
  laufOffen,
};
