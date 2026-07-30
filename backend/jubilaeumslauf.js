'use strict';

// Täglicher Abgleich zwischen den Altersjubiläen und dem Aufgabenmodul
// (Vikunja) — dasselbe Muster wie backend/wartungslauf.js.
//
// Warum im Backend und nicht im Browser: ein 90. Geburtstag rückt näher, ob
// jemand die App öffnet oder nicht. Läge die Prüfung im Browser, käme die
// Erinnerung genau dann nicht, wenn wochenlang niemand hineinschaut.
//
// Zwei Schritte:
//
//  1. JUBILÄUM RÜCKT IN DIE FRIST → AUFGABE. Ein Kalendermonat vorher entsteht
//     eine Vikunja-Aufgabe. Ihre id wird an der Ehrung vermerkt — das ist der
//     einzige Schutz davor, morgen dieselbe Aufgabe noch einmal anzulegen.
//  2. AUFGABE ABGEHAKT → EHRUNG ÜBERREICHT. Und umgekehrt: wer die Ehrung in
//     der App auf „überreicht" setzt, schließt damit die Aufgabe.
//
// ZUM DATENSCHUTZ: Der Lauf liest die Einwohner direkt über die Fassade, ohne
// PIN. Das ist kein Loch — die PIN schützt die HTTP-Oberfläche, nicht den
// Server vor sich selbst. Wohl aber steht der NAME in der Vikunja-Aufgabe, und
// die ist im Aufgabenmodul und im Kalender für jeden im Netz sichtbar, auch
// ohne PIN. Matthias hat das am 2026-07-30 in Kenntnis des Umstands so
// entschieden; über `settings.einwohner.aufgabeMitNamen = false` lässt sich auf
// eine namenlose Fassung umstellen, ohne dass am Code etwas geändert wird.

const db = require('./db');
const einwohner = require('./einwohner');
const ehrungen = require('./ehrungen');
const vikunja = require('./vikunja');

const STANDARD_VORLAUF_MONATE = 1;
const LAUF_INTERVALL_MS = 24 * 3600 * 1000;
// Kurz nach dem Start einmal laufen: nach einem Neustart des Containers wäre
// sonst bis zum nächsten Tag Stillstand.
const ERSTER_LAUF_MS = 90 * 1000;

let timer = null;
let laeuft = false;
let letzterLauf = null;

function einstellungen() {
  let s = null;
  try { s = db.getSettings(); } catch (_) { s = null; }
  const ein = (s && s.einwohner) || {};
  const monate = Number(ein.vorlaufMonate);
  return {
    projektId: s && s.vikunjaProjektId ? s.vikunjaProjektId : null,
    vorlaufMonate: Number.isFinite(monate) && monate >= 0 ? monate : STANDARD_VORLAUF_MONATE,
    aktiv: ein.jubilaeumsaufgaben !== false,
    mitNamen: ein.aufgabeMitNamen !== false,
  };
}

function vollerName(e) {
  return [e.vorname, e.nachname].filter(Boolean).join(' ').trim() || 'Einwohner';
}

function datumDe(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

function aufgabenTitel(eh, mitNamen) {
  if (!mitNamen) return `Ehrung vorbereiten — ${eh.alter}. Geburtstag am ${datumDe(eh.datum)}`;
  return `Ehrung: ${eh.alter}. Geburtstag von ${vollerName(eh)} am ${datumDe(eh.datum)}`;
}

function aufgabenText(eh, mitNamen) {
  const zeilen = [];
  if (mitNamen) {
    zeilen.push(`**${vollerName(eh)}** vollendet am ${datumDe(eh.datum)} das ${eh.alter}. Lebensjahr.`);
    const anschrift = [eh.strasse, [eh.hausnummer, eh.zusatz].filter(Boolean).join('')]
      .filter(Boolean).join(' ');
    if (anschrift) zeilen.push('', `- Anschrift: ${anschrift}${eh.wohnort ? ', ' + eh.wohnort : ''}`);
  } else {
    zeilen.push(`Am ${datumDe(eh.datum)} steht eine Ehrung zum ${eh.alter}. Geburtstag an.`);
    zeilen.push('', 'Wer es ist, steht im Einwohnermodul der Gemeindeverwaltung (PIN erforderlich).');
  }
  zeilen.push(
    '',
    'Die Urkunde lässt sich im Einwohnermodul der Gemeindeverwaltung drucken.',
    'Wird die Ehrung dort als überreicht gebucht, schließt sich diese Aufgabe von selbst — und umgekehrt.',
  );
  return zeilen.join('\n');
}

// --- Der Lauf -------------------------------------------------------------
async function jubilaeumslaufJetzt() {
  if (laeuft) return { uebersprungen: 'Ein Lauf ist bereits unterwegs.' };
  laeuft = true;
  const bericht = {
    at: new Date().toISOString(),
    aufgabenAngelegt: 0, ehrungenErledigt: 0, aufgabenGeschlossen: 0,
    geprueft: 0, fehler: [],
  };
  try {
    const cfg = einstellungen();
    if (!cfg.aktiv) return Object.assign(bericht, { uebersprungen: 'Jubiläumsaufgaben sind abgeschaltet.' });
    if (!einwohner.isConfigured()) {
      return Object.assign(bericht, { uebersprungen: 'Die Einwohnerliste ist nicht eingerichtet.' });
    }

    const liste = await einwohner.alle({ frisch: true });
    const heute = ehrungen.heuteIso();
    const bis = ehrungen.plusMonate(heute, cfg.vorlaufMonate);

    // Schritt 1: was in die Frist rückt, bekommt eine Aufgabe.
    const anstehend = ehrungen.anstehende(liste, heute, bis);
    bericht.geprueft = anstehend.length;

    for (const eh of anstehend) {
      try {
        if (eh.status === 'ueberreicht') continue;
        if (eh.aufgabeId) continue;                 // hat schon eine
        if (!cfg.projektId) {
          if (!bericht.fehler.includes('Kein Aufgabenprojekt gewählt.')) {
            bericht.fehler.push('Kein Aufgabenprojekt gewählt.');
          }
          continue;
        }
        const task = await vikunja.createTask(cfg.projektId, {
          title: aufgabenTitel(eh, cfg.mitNamen),
          description: aufgabenText(eh, cfg.mitNamen),
          dueDate: eh.datum,
          priority: (eh.tageBis != null && eh.tageBis <= 0) ? 4 : 3,
        });
        if (task && task.id) {
          ehrungen.speichern(eh, { aufgabeId: task.id, aufgabeAm: heute });
          bericht.aufgabenAngelegt++;
        }
      } catch (e) {
        bericht.fehler.push(`${eh.datum} (${eh.alter}.): ${e.message || e}`);
      }
    }

    // Schritt 2: beide Richtungen abgleichen. Interessant ist nur, wofür es
    // überhaupt einen gespeicherten Datensatz mit Aufgabe gibt.
    for (const gespeichert of db.listEhrungen()) {
      if (!gespeichert || !gespeichert.aufgabeId) continue;
      try {
        const task = await vikunja.getTask(gespeichert.aufgabeId).catch(() => null);
        if (!task) continue;
        if (task.done && gespeichert.status !== 'ueberreicht') {
          // Abgehakt in Vikunja → Ehrung gilt als überreicht.
          ehrungen.speichern(gespeichert, {
            status: 'ueberreicht',
            ueberreichtAm: gespeichert.ueberreichtAm || heute,
          });
          bericht.ehrungenErledigt++;
        } else if (!task.done && gespeichert.status === 'ueberreicht') {
          // In der App gebucht → Aufgabe schließen.
          await vikunja.setTaskDone(gespeichert.aufgabeId, true);
          bericht.aufgabenGeschlossen++;
        }
      } catch (e) {
        bericht.fehler.push(`Aufgabe ${gespeichert.aufgabeId}: ${e.message || e}`);
      }
    }

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

function starteJubilaeumslauf() {
  if (timer) return;
  setTimeout(() => { jubilaeumslaufJetzt().catch(() => {}); }, ERSTER_LAUF_MS).unref?.();
  timer = setInterval(() => { jubilaeumslaufJetzt().catch(() => {}); }, LAUF_INTERVALL_MS);
  timer.unref?.();
}

function stoppeJubilaeumslauf() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
  jubilaeumslaufJetzt,
  starteJubilaeumslauf,
  stoppeJubilaeumslauf,
  letzterJubilaeumslauf: () => letzterLauf,
  // für Tests
  _aufgabenTitel: aufgabenTitel,
  _aufgabenText: aufgabenText,
  _datumDe: datumDe,
  STANDARD_VORLAUF_MONATE,
};
