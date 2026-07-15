'use strict';

// Kalender-Modul: abonnierte iCal-URLs (ICS) werden serverseitig geholt und
// geparst. Läuft über einen Backend-Proxy, weil externe Kalender (Google,
// Nextcloud, …) im Browser an CORS scheitern und die Abo-URL ein Geheimnis
// enthalten kann. Config bleibt serverseitig (DB-Key 'kalender'), nicht im
// Snapshot/NocoDB-Sync.
//
// Umfang: VEVENT-Parsing inkl. Zeitzonen (Z=UTC, TZID/floating als lokale
// Wandzeit), Serientermine (RRULE: DAILY/WEEKLY/MONTHLY/YEARLY mit
// INTERVAL/COUNT/UNTIL/BYDAY/BYMONTHDAY) und EXDATE. Node ≥18 ⇒ globales fetch.

const db = require('./db');

// Env-Vorgabe: kommagetrennte URLs als Fallback, falls in der App nichts gesetzt.
const ENV_URLS = (process.env.KALENDER_URLS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const FETCH_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min – Kalender ändern sich selten
const MAX_ICS_BYTES = 8 * 1024 * 1024;
const MAX_OCCURRENCES_PER_EVENT = 400; // Runaway-Schutz bei Serien

// --- Konfiguration -------------------------------------------------------

// Liste von { id, name, url } laden. Env-URLs greifen nur, wenn nichts in der DB.
function listCalendars() {
  let stored = null;
  try { stored = db.getKalenderConfig(); } catch (_) { stored = null; }
  if (stored && Array.isArray(stored.calendars) && stored.calendars.length) {
    return stored.calendars.map(normalizeCal).filter(c => c.url);
  }
  return ENV_URLS.map((url, i) => ({ id: 'env-' + i, name: 'Kalender ' + (i + 1), url }));
}

function normalizeCal(c) {
  return {
    id: String(c.id || ''),
    name: String(c.name || '').trim(),
    url: String(c.url || '').trim(),
  };
}

function source() {
  let stored = null;
  try { stored = db.getKalenderConfig(); } catch (_) { stored = null; }
  if (stored && Array.isArray(stored.calendars) && stored.calendars.length) return 'app';
  return ENV_URLS.length ? 'env' : 'none';
}

// Speichert die komplette Liste. IDs werden serverseitig vergeben, falls neu.
function saveCalendars(calendars) {
  const list = (Array.isArray(calendars) ? calendars : [])
    .map(normalizeCal)
    .filter(c => c.url)
    .map(c => ({ id: c.id || genId(), name: c.name || c.url, url: c.url }));
  db.saveKalenderConfig({ calendars: list });
  cache.clear();
  return { calendars: list, source: source() };
}

function publicConfig() {
  return { calendars: listCalendars(), source: source() };
}

function genId() {
  return 'cal_' + Math.random().toString(36).slice(2, 10);
}

// --- ICS holen (mit Cache) ----------------------------------------------

const cache = new Map(); // url -> { text, at }

async function fetchIcs(url) {
  const hit = cache.get(url);
  if (hit && (Date.now() - hit.at) < CACHE_TTL_MS) return hit.text;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'Gemeindeverwaltung/1.0' },
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError' ? 'Zeitüberschreitung beim Laden' : ('Netzwerkfehler: ' + err.message));
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ICS_BYTES) throw new Error('Kalender zu groß (> 8 MB)');
  const text = buf.toString('utf8');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Keine gültige iCal-Datei (VCALENDAR fehlt)');
  cache.set(url, { text, at: Date.now() });
  return text;
}

// --- ICS parsen ----------------------------------------------------------

// Zeilen entfalten (RFC 5545: Folding – Fortsetzungszeile beginnt mit SPACE/TAB).
function unfold(text) {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

// "NAME;P1=a;P2=b:VALUE" → { name, params:{P1:'a',P2:'b'}, value }
function parseLine(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const parts = head.split(';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

function unescapeText(v) {
  return String(v || '')
    .replace(/\\n/gi, '\n').replace(/\\,/g, ',')
    .replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Datum/Zeit parsen. Rückgabe: { ms, allDay, dateKey } wobei ms ein absoluter
// Zeitstempel ist. Z=UTC exakt; TZID/floating als lokale Wandzeit des Servers
// (LXC läuft in Europe/Berlin – für die Anzeige ausreichend genau).
function parseDate(value, params) {
  const v = String(value || '').trim();
  const isDateOnly = (params && params.VALUE === 'DATE') || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  const Y = +y, Mo = +mo - 1, D = +d;
  if (isDateOnly || hh === undefined) {
    const dt = new Date(Y, Mo, D, 0, 0, 0);
    return { ms: dt.getTime(), allDay: true };
  }
  let dt;
  if (z) dt = new Date(Date.UTC(Y, Mo, D, +hh, +mm, +ss));
  else dt = new Date(Y, Mo, D, +hh, +mm, +ss);
  return { ms: dt.getTime(), allDay: false };
}

// Alle VEVENTs als Rohobjekte extrahieren.
function parseEvents(text) {
  const lines = unfold(text);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'DTSTART': cur.start = parseDate(p.value, p.params); cur.startRaw = p; break;
      case 'DTEND': cur.end = parseDate(p.value, p.params); break;
      case 'DURATION': cur.duration = p.value; break;
      case 'SUMMARY': cur.summary = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'DESCRIPTION': cur.description = unescapeText(p.value); break;
      case 'RRULE': cur.rrule = parseRRule(p.value); break;
      case 'UID': cur.uid = p.value; break;
      case 'EXDATE': {
        for (const part of String(p.value).split(',')) {
          const dd = parseDate(part, p.params);
          if (dd) cur.exdates.push(dd.ms);
        }
        break;
      }
    }
  }
  return events;
}

function parseRRule(value) {
  const rule = {};
  for (const part of String(value).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return rule;
}

// --- Serien expandieren --------------------------------------------------

const WEEKDAY_IDX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// n-ter Wochentag eines Monats (ord>0 = von vorn, ord<0 = von hinten, z. B.
// 2TU = 2. Dienstag, -1FR = letzter Freitag). Rückgabe: ms oder null.
function nthWeekdayOfMonth(year, month, dow, ord, H, Min, S) {
  if (!ord) ord = 1;
  const dim = daysInMonth(year, month);
  let day;
  if (ord > 0) {
    const firstDow = new Date(year, month, 1).getDay();
    day = 1 + ((dow - firstDow + 7) % 7) + (ord - 1) * 7;
  } else {
    const lastDow = new Date(year, month, dim).getDay();
    day = dim - ((lastDow - dow + 7) % 7) - (Math.abs(ord) - 1) * 7;
  }
  if (day < 1 || day > dim) return null;
  return new Date(year, month, day, H, Min, S).getTime();
}

// Liefert absolute Startzeitpunkte (ms) einer (evtl. wiederkehrenden) VEVENT,
// die das Fenster [windowStart, windowEnd] schneiden (dauerbewusst: auch schon
// laufende mehrtägige Termine, deren Start vor dem Fenster liegt).
function expandOccurrences(ev, windowStart, windowEnd) {
  if (!ev.start) return [];
  const startMs = ev.start.ms;
  const exset = new Set(ev.exdates || []);
  const durMs = (ev.end && ev.start && ev.end.ms > ev.start.ms) ? (ev.end.ms - ev.start.ms) : 0;
  // Ein Vorkommen zählt, wenn sein Intervall [ms, ms+dur] das Fenster schneidet.
  const inWindow = (ms) => (ms <= windowEnd) && ((ms + durMs) >= windowStart);

  if (!ev.rrule) {
    return (inWindow(startMs) && !exset.has(startMs)) ? [startMs] : [];
  }

  const r = ev.rrule;
  const freq = (r.FREQ || '').toUpperCase();
  const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1);
  const count = r.COUNT ? parseInt(r.COUNT, 10) : null;
  const untilParsed = r.UNTIL ? parseDate(r.UNTIL) : null;
  const until = untilParsed ? untilParsed.ms : null;
  const byday = r.BYDAY ? r.BYDAY.split(',').map(s => s.trim().toUpperCase()) : null;
  const bymonthday = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(n => parseInt(n, 10)) : null;

  const base = new Date(startMs);
  const H = base.getHours(), Min = base.getMinutes(), S = base.getSeconds();
  const results = [];
  let emitted = 0; // zählt gemäß COUNT alle theoretischen Vorkommen
  let guard = 0;

  const push = (ms) => {
    if (until != null && ms > until) return false;
    if (count != null && emitted >= count) return false;
    emitted++;
    if (inWindow(ms) && !exset.has(ms)) results.push(ms);
    return true;
  };
  // Über das Fenster hinaus (unter Berücksichtigung der Dauer) → abbrechen.
  const stopByWindow = (ms) => (ms - durMs) > windowEnd && (until == null || ms <= until);

  if (freq === 'WEEKLY' && byday && byday.length) {
    // Wochenraster: je Intervall-Woche die passenden Wochentage.
    const wkStart = startOfWeek(base); // Montag als Wochenbeginn (locale-agnostisch)
    let weekBase = wkStart.getTime();
    const targetDows = byday.map(t => WEEKDAY_IDX[t.replace(/^[+-]?\d+/, '')]).filter(n => n != null);
    while (weekBase <= windowEnd && guard < 6000) {
      guard++;
      for (const dow of targetDows) {
        const day = new Date(weekBase);
        const delta = (dow - 1 + 7) % 7; // 0=Mo
        day.setDate(day.getDate() + delta);
        day.setHours(H, Min, S, 0);
        const ms = day.getTime();
        if (ms < startMs) continue;
        if (!push(ms)) { return finalize(results, exset); }
      }
      const nw = new Date(weekBase);
      nw.setDate(nw.getDate() + 7 * interval);
      weekBase = nw.getTime();
      if (count == null && weekBase - durMs > windowEnd) break;
    }
    return finalize(results, exset);
  }

  // MONTHLY/YEARLY mit „n-ter Wochentag" (z. B. jeden 2. Dienstag).
  if ((freq === 'MONTHLY' || freq === 'YEARLY') && byday && byday.length) {
    const specs = byday.map(t => {
      const m = t.match(/^([+-]?\d+)?([A-Z]{2})$/);
      if (!m) return null;
      const ord = m[1] ? parseInt(m[1], 10) : 1;
      const dow = WEEKDAY_IDX[m[2]];
      return dow == null ? null : { ord, dow };
    }).filter(Boolean);
    let y = base.getFullYear(), mo = base.getMonth();
    const stepMonths = freq === 'MONTHLY' ? interval : interval * 12;
    while (guard < MAX_OCCURRENCES_PER_EVENT * 2) {
      guard++;
      const periodStartMs = new Date(y, mo, 1).getTime();
      for (const sp of specs) {
        const ms = nthWeekdayOfMonth(y, mo, sp.dow, sp.ord, H, Min, S);
        if (ms == null || ms < startMs) continue;
        if (!push(ms)) return finalize(results, exset);
      }
      // Fensterende (dauerbewusst) und Schutzgrenzen
      if (count == null && periodStartMs - durMs > windowEnd) break;
      if (results.length > MAX_OCCURRENCES_PER_EVENT) break;
      mo += stepMonths; while (mo > 11) { mo -= 12; y++; }
    }
    return finalize(results, exset);
  }

  // Einfache Schrittfolge ab Startdatum – für alte Serien vorspulen, damit die
  // Schutzgrenze nicht vor dem Fenster zuschlägt (nur ohne COUNT).
  const cursor = new Date(startMs);
  if (count == null && windowStart > startMs + durMs) {
    if (freq === 'DAILY') {
      const perStep = interval * 86400000;
      const n = Math.floor((windowStart - durMs - startMs) / perStep);
      if (n > 0) cursor.setDate(cursor.getDate() + n * interval);
    } else if (freq === 'WEEKLY') {
      const perStep = interval * 7 * 86400000;
      const n = Math.floor((windowStart - durMs - startMs) / perStep);
      if (n > 0) cursor.setDate(cursor.getDate() + n * 7 * interval);
    } else if (freq === 'MONTHLY') {
      const bd = new Date(windowStart);
      let months = (bd.getFullYear() - base.getFullYear()) * 12 + (bd.getMonth() - base.getMonth()) - 1;
      months = Math.floor(months / interval) * interval;
      if (months > 0) {
        cursor.setMonth(cursor.getMonth() + months);
        if (bymonthday && bymonthday.length) cursor.setDate(Math.min(bymonthday[0], daysInMonth(cursor.getFullYear(), cursor.getMonth())));
      }
    } else if (freq === 'YEARLY') {
      let years = new Date(windowStart).getFullYear() - base.getFullYear() - 1;
      years = Math.floor(years / interval) * interval;
      if (years > 0) cursor.setFullYear(cursor.getFullYear() + years);
    }
    cursor.setHours(H, Min, S, 0);
  }

  while (guard < MAX_OCCURRENCES_PER_EVENT * 2) {
    guard++;
    const ms = cursor.getTime();
    if (!push(ms)) break;
    if (count == null && stopByWindow(ms)) break;
    if (results.length > MAX_OCCURRENCES_PER_EVENT) break;
    if (freq === 'DAILY') cursor.setDate(cursor.getDate() + interval);
    else if (freq === 'WEEKLY') cursor.setDate(cursor.getDate() + 7 * interval);
    else if (freq === 'MONTHLY') {
      if (bymonthday && bymonthday.length) {
        cursor.setMonth(cursor.getMonth() + interval);
        cursor.setDate(Math.min(bymonthday[0], daysInMonth(cursor.getFullYear(), cursor.getMonth())));
      } else {
        cursor.setMonth(cursor.getMonth() + interval);
      }
    } else if (freq === 'YEARLY') cursor.setFullYear(cursor.getFullYear() + interval);
    else break; // unbekannte FREQ ⇒ nur Erstvorkommen
    cursor.setHours(H, Min, S, 0);
  }
  return finalize(results, exset);
}

function finalize(results, exset) {
  return results.filter(ms => !exset.has(ms)).sort((a, b) => a - b);
}

function startOfWeek(d) {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 0=Mo
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// --- Öffentliche Aggregation ---------------------------------------------

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function timeKey(ms) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// Holt und aggregiert Termine aller Kalender im Fenster [heute .. +days].
// Bei Fehlern eines einzelnen Kalenders wird dieser übersprungen und im
// Ergebnis unter `errors` vermerkt (Rest bleibt nutzbar).
async function getEvents({ days = 90, from } = {}) {
  const cals = listCalendars();
  const now = new Date();
  const windowStart = from != null ? from : new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const windowEnd = windowStart + Math.max(1, days) * 24 * 60 * 60 * 1000;

  const out = [];
  const errors = [];
  await Promise.all(cals.map(async (cal) => {
    try {
      const text = await fetchIcs(cal.url);
      const events = parseEvents(text);
      for (const ev of events) {
        const occ = expandOccurrences(ev, windowStart, windowEnd);
        for (const ms of occ) {
          const durMs = (ev.end && ev.start) ? (ev.end.ms - ev.start.ms) : 0;
          const endMs = ms + (durMs > 0 ? durMs : 0);
          out.push({
            calId: cal.id,
            calName: cal.name,
            uid: ev.uid || '',
            summary: ev.summary || '(ohne Titel)',
            location: ev.location || '',
            description: ev.description || '',
            allDay: !!(ev.start && ev.start.allDay),
            startMs: ms,
            date: dateKey(ms),
            time: (ev.start && ev.start.allDay) ? null : timeKey(ms),
            endDate: dateKey(endMs),
            endTime: (ev.start && ev.start.allDay) ? null : timeKey(endMs),
          });
        }
      }
    } catch (err) {
      errors.push({ calId: cal.id, calName: cal.name, error: err.message });
    }
  }));

  out.sort((a, b) => a.startMs - b.startMs || (a.allDay === b.allDay ? 0 : (a.allDay ? -1 : 1)));
  return { events: out, errors, count: out.length };
}

// Einzelne URL testen (ohne sie zu speichern): Anzahl VEVENTs zurückgeben.
async function testUrl(url) {
  if (!url) throw new Error('Keine URL angegeben');
  const text = await fetchIcs(String(url).trim());
  const events = parseEvents(text);
  return { ok: true, events: events.length };
}

module.exports = {
  listCalendars, saveCalendars, publicConfig,
  getEvents, testUrl,
  // für Tests:
  parseEvents, expandOccurrences, unfold, parseDate,
};
