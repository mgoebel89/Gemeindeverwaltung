'use strict';

// Täglicher Abgleich zwischen den Wartungen (Homebox) und dem Aufgabenmodul
// (Vikunja).
//
// Warum im Backend und nicht im Browser: eine Wartungsfrist läuft weiter, auch
// wenn wochenlang niemand die App öffnet. Ein Feuerlöscher, dessen Prüfung
// fällig wird, während Urlaub ist, muss die Aufgabe trotzdem erzeugen.
//
// Der Lauf macht drei Dinge, in dieser Reihenfolge:
//
//  1. FÄLLIG → AUFGABE. Jede offene Wartung, deren geplantes Datum in die
//     Vorlauffrist rutscht, bekommt eine Vikunja-Aufgabe. Die id der Aufgabe
//     wird lokal an der Wartung vermerkt — das ist der einzige Schutz davor,
//     morgen dieselbe Aufgabe noch einmal anzulegen.
//  2. AUFGABE ABGEHAKT → WARTUNG ERLEDIGT. Wer die Aufgabe in Vikunja abhakt,
//     hat die Wartung gemacht. Sie wird mit dem Datum von heute in Homebox als
//     erledigt gebucht.
//  3. ERLEDIGT → FOLGETERMIN. Ist ein Intervall hinterlegt, entsteht sofort
//     der nächste Termin (Erledigungsdatum + Intervall), und die Aufgabe wird
//     geschlossen. Damit reißt die Kette nie ab — das ist der Kern der ganzen
//     Übung, denn Homebox selbst kennt keine Wiederholung.
//
// Alles ist gegen Doppelausführung gesichert: Punkt 1 über `aufgabeId`,
// Punkt 3 über `folgeWartungId`. Fehler an einer einzelnen Wartung brechen den
// Lauf nicht ab — sonst hinge der ganze Bestand an einem kaputten Datensatz.

const db = require('./db');
const homebox = require('./homebox');
const vikunja = require('./vikunja');

const STANDARD_VORLAUF_TAGE = 30;
const LAUF_INTERVALL_MS = 24 * 3600 * 1000;
// Kurz nach dem Start einmal laufen: nach einem Neustart des Containers wäre
// sonst bis zum nächsten Tag Stillstand.
const ERSTER_LAUF_MS = 60 * 1000;

let timer = null;
let laeuft = false;
let letzterLauf = null;

// --- Datumshilfen ---------------------------------------------------------
// Durchgehend lokale Kalendertage. `toISOString` ist hier verboten: es rechnet
// nach UTC um und verschiebt in unserer Zeitzone den Tag um eins nach hinten.
function heuteIso() { return zuIso(new Date()); }

function zuIso(d) {
  const j = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${j}-${m}-${t}`;
}

function ausIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function tageBis(iso) {
  const d = ausIso(iso);
  if (!d) return null;
  const heute = ausIso(heuteIso());
  return Math.round((d - heute) / 86400000);
}

// Monate addieren, ohne ins Nachbarmonat zu rutschen: der 31.01. plus einen
// Monat ist der 28./29.02., nicht der 02./03.03.
function plusMonate(iso, monate) {
  const d = ausIso(iso);
  if (!d) return '';
  const tag = d.getDate();
  const ziel = new Date(d.getFullYear(), d.getMonth() + Number(monate), 1);
  const letzterTag = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  ziel.setDate(Math.min(tag, letzterTag));
  return zuIso(ziel);
}

// --- Einstellungen --------------------------------------------------------
function einstellungen() {
  let s = null;
  try { s = db.getSettings(); } catch (_) { s = null; }
  const inv = (s && s.inventar) || {};
  const vorlauf = Number(inv.vorlaufTage);
  return {
    projektId: s && s.vikunjaProjektId ? s.vikunjaProjektId : null,
    vorlaufTage: Number.isFinite(vorlauf) && vorlauf >= 0 ? vorlauf : STANDARD_VORLAUF_TAGE,
    aktiv: inv.wartungsaufgaben !== false,
  };
}

function lokal(id) { return db.getInventarWartung(id) || null; }

function lokalSpeichern(id, patch) {
  const vorher = lokal(id) || { id };
  const neu = Object.assign({}, vorher, patch, { id, lastModifiedAt: new Date().toISOString() });
  db.saveInventarWartung(neu);
  return neu;
}

function aufgabenTitel(w) {
  const gegenstand = w.itemName || 'Gegenstand';
  return `Wartung: ${gegenstand} — ${w.name || 'Prüfung'}`;
}

function aufgabenText(w, faellig) {
  const zeilen = [
    `Wartung für **${w.itemName || 'Gegenstand'}**`,
    ``,
    `- Fällig am: ${faellig}`,
  ];
  if (w.beschreibung) zeilen.push(`- Hinweis: ${w.beschreibung}`);
  zeilen.push('', 'Angelegt aus dem Inventar der Gemeindeverwaltung. Wird die Wartung dort als erledigt gebucht, schließt sich diese Aufgabe von selbst — und umgekehrt.');
  return zeilen.join('\n');
}

// --- Der Lauf -------------------------------------------------------------
async function wartungslaufJetzt() {
  if (laeuft) return { uebersprungen: 'Ein Lauf ist bereits unterwegs.' };
  laeuft = true;
  const bericht = {
    at: new Date().toISOString(),
    aufgabenAngelegt: 0, wartungenErledigt: 0, folgetermine: 0, aufgabenGeschlossen: 0,
    geprueft: 0, fehler: [],
  };
  try {
    const cfg = einstellungen();
    if (!cfg.aktiv) return Object.assign(bericht, { uebersprungen: 'Wartungsaufgaben sind abgeschaltet.' });
    if (!homebox.isConfigured()) return Object.assign(bericht, { uebersprungen: 'Homebox ist nicht eingerichtet.' });
    if (!(await homebox.wartungenVerfuegbar().catch(() => false))) {
      return Object.assign(bericht, { uebersprungen: 'Diese Homebox-Version kennt keine Wartungen.' });
    }

    await schrittOffene(cfg, bericht);
    await schrittErledigte(cfg, bericht);

    letzterLauf = bericht;
    return bericht;
  } catch (e) {
    bericht.fehler.push(e.message || String(e));
    letzterLauf = bericht;
    return bericht;
  } finally {
    laeuft = false;
  }
}

// Schritt 1 + 2: offene Wartungen.
async function schrittOffene(cfg, bericht) {
  const offene = await homebox.alleWartungen('scheduled');
  bericht.geprueft = offene.length;
  const heute = heuteIso();

  for (const w of offene) {
    try {
      const l = lokal(w.id);
      const vorlauf = (l && l.vorlaufTage != null) ? Number(l.vorlaufTage) : cfg.vorlaufTage;
      const tage = tageBis(w.geplantAm);
      if (tage == null) continue;                 // ohne Datum nichts zu tun

      // Schon eine Aufgabe? Dann nur noch prüfen, ob sie abgehakt wurde.
      if (l && l.aufgabeId) {
        const task = await vikunja.getTask(l.aufgabeId).catch(() => null);
        if (task && task.done) {
          await homebox.wartungAendern(w.id, {
            name: w.name,
            beschreibung: w.beschreibung,
            geplantAm: '',
            erledigtAm: heute,
            kosten: w.kosten,
          });
          bericht.wartungenErledigt++;
          // Der Folgetermin entsteht gleich in Schritt 3 — dort steht die
          // Intervall-Logik an EINER Stelle, egal wo die Wartung erledigt wurde.
        }
        continue;
      }

      if (tage > vorlauf) continue;               // noch nicht in der Frist
      if (!cfg.projektId) {
        if (!bericht.fehler.includes('Kein Aufgabenprojekt gewählt.')) {
          bericht.fehler.push('Kein Aufgabenprojekt gewählt.');
        }
        continue;
      }

      const task = await vikunja.createTask(cfg.projektId, {
        title: aufgabenTitel(w),
        description: aufgabenText(w, w.geplantAm),
        dueDate: w.geplantAm,
        // Überfällig oder heute fällig ist dringend, sonst hoch.
        priority: tage <= 0 ? 4 : 3,
      });
      if (task && task.id) {
        lokalSpeichern(w.id, { itemId: w.itemId, aufgabeId: task.id, aufgabeAm: heute });
        bericht.aufgabenAngelegt++;
      }
    } catch (e) {
      bericht.fehler.push(`${w.itemName || w.itemId}: ${e.message || e}`);
    }
  }
}

// Schritt 3: erledigte Wartungen — Folgetermin und Aufgabe schließen.
async function schrittErledigte(cfg, bericht) {
  // Nur solche mit lokaler Ergänzung sind interessant; ohne Intervall und ohne
  // Aufgabe gibt es nichts zu tun. Deshalb erst lokal filtern, dann Homebox.
  const lokaleIds = new Set(db.listInventarWartungen().map(x => x.id));
  if (!lokaleIds.size) return;

  const erledigte = (await homebox.alleWartungen('completed')).filter(w => lokaleIds.has(w.id));

  for (const w of erledigte) {
    try {
      const l = lokal(w.id) || {};

      // Aufgabe schließen, falls sie noch offen steht (Wartung wurde in der App
      // oder direkt in Homebox erledigt).
      if (l.aufgabeId) {
        const task = await vikunja.getTask(l.aufgabeId).catch(() => null);
        if (task && !task.done) {
          await vikunja.setTaskDone(l.aufgabeId, true);
          bericht.aufgabenGeschlossen++;
        }
      }

      // Folgetermin — genau einmal.
      const intervall = Number(l.intervallMonate) || 0;
      if (intervall > 0 && !l.folgeWartungId) {
        const basis = w.erledigtAm || heuteIso();
        const neuesDatum = plusMonate(basis, intervall);
        const neu = await homebox.wartungAnlegen(w.itemId, {
          name: w.name,
          beschreibung: w.beschreibung,
          geplantAm: neuesDatum,
          erledigtAm: '',
          kosten: null,
        });
        // Intervall und eigene Frist wandern mit — sonst endet die Kette nach
        // dem ersten Durchlauf.
        lokalSpeichern(neu.id, {
          itemId: w.itemId,
          intervallMonate: intervall,
          vorlaufTage: l.vorlaufTage == null ? null : l.vorlaufTage,
          aufgabeId: null,
          vorgaengerId: w.id,
        });
        lokalSpeichern(w.id, { folgeWartungId: neu.id });
        bericht.folgetermine++;
      }
    } catch (e) {
      bericht.fehler.push(`${w.itemName || w.itemId}: ${e.message || e}`);
    }
  }
}

function starteWartungslauf() {
  if (timer) return;
  setTimeout(() => { wartungslaufJetzt().catch(() => {}); }, ERSTER_LAUF_MS).unref?.();
  timer = setInterval(() => { wartungslaufJetzt().catch(() => {}); }, LAUF_INTERVALL_MS);
  timer.unref?.();
}

function stoppeWartungslauf() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
  wartungslaufJetzt,
  starteWartungslauf,
  stoppeWartungslauf,
  letzterWartungslauf: () => letzterLauf,
  // für Tests
  _plusMonate: plusMonate,
  _tageBis: tageBis,
  _zuIso: zuIso,
  _aufgabenTitel: aufgabenTitel,
  STANDARD_VORLAUF_TAGE,
};
