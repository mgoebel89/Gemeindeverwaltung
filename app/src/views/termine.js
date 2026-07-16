(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, formatDatum, wochentag } = GR.ui;

  // ---- Termine (Kalender) ----
  // Zeigt die aggregierten Termine aller abonnierten iCal-Kalender in drei
  // Ansichten: Monat, Woche (je 7 Tagesspalten) und Liste. Die Kalender werden
  // serverseitig geholt/geparst (Backend-Proxy).
  //
  // Geladen wird immer GENAU der angezeigte Zeitraum (`from`+`days`), nicht
  // „heute + n Tage". Nur so sind auch Termine Jahre in der Zukunft erreichbar.
  //
  // Route: #/termine?view=monat|woche|liste&date=YYYY-MM-DD&days=90

  const DOW_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];

  // --- Datumshilfen (bewusst mit lokalen Komponenten; toISOString() würde die
  // lokale Mitternacht in UTC auf den Vortag schieben). ---
  const p2 = (n) => String(n).padStart(2, '0');
  function iso(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
  function parseIso(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function addMonths(d, n) { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); return x; }
  function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; }
  function heuteIso() { return iso(new Date()); }
  function kw(d) {
    // ISO-8601-Kalenderwoche
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
    const jan4 = new Date(x.getFullYear(), 0, 4);
    return 1 + Math.round(((x - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  }

  function renderTermine(mount, params) {
    const view = ['monat', 'woche', 'liste'].includes((params && params.view) || '') ? params.view : 'monat';
    const anker = parseIso(params && params.date) || new Date();
    let days = parseInt((params && params.days) || '90', 10);
    if (!Number.isFinite(days)) days = 90;

    // Sichtbares Fenster je Ansicht → genau das wird geladen.
    let from, spanDays, titel;
    if (view === 'monat') {
      const erster = new Date(anker.getFullYear(), anker.getMonth(), 1);
      from = startOfWeek(erster);          // Raster beginnt am Montag vor dem 1.
      spanDays = 42;                        // immer 6 Wochen → stabile Rasterhöhe
      titel = MONATE[anker.getMonth()] + ' ' + anker.getFullYear();
    } else if (view === 'woche') {
      from = startOfWeek(anker);
      spanDays = 7;
      titel = 'KW ' + kw(from) + ' · ' + formatDatum(iso(from)) + ' – ' + formatDatum(iso(addDays(from, 6)));
    } else {
      from = new Date(); from.setHours(0, 0, 0, 0);
      spanDays = days;
      titel = 'Nächste Termine';
    }

    mount.appendChild(buildToolbar(view, anker, days, titel));

    const body = el('div', {});
    mount.appendChild(body);
    body.appendChild(el('p', { class: 'help' }, 'Termine werden geladen…'));

    GR.api.listCalEvents(spanDays, iso(from)).then(res => {
      body.innerHTML = '';
      const errors = res.errors || [];
      if (errors.length) {
        body.appendChild(el('div', { class: 'warn' },
          'Einige Kalender konnten nicht geladen werden: ' +
          errors.map(e => `${e.calName || '?'} (${e.error})`).join(' · ')));
      }
      const events = res.events || [];
      if (view === 'monat') body.appendChild(monatsGitter(anker, from, events));
      else if (view === 'woche') body.appendChild(wochenGitter(from, events));
      else body.appendChild(listenAnsicht(events, errors));
    }).catch(err => {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'warn' }, 'Termine konnten nicht geladen werden: ' + err.message));
    });
  }

  function buildToolbar(view, anker, days, titel) {
    const go = (v, d) => `#/termine?view=${v}&date=${iso(d)}` + (v === 'liste' ? `&days=${days}` : '');
    const schritt = (n) => {
      if (view === 'monat') return addMonths(anker, n);
      if (view === 'woche') return addDays(anker, n * 7);
      return anker;
    };

    const umschalter = el('div', { class: 'cal-switch' }, [
      ['monat', 'Monat'], ['woche', 'Woche'], ['liste', 'Liste'],
    ].map(([v, lbl]) => el('a', {
      class: 'btn btn-sm' + (v === view ? ' is-active' : ''), href: go(v, anker),
    }, lbl)));

    const nav = view === 'liste' ? null : el('div', { class: 'cal-nav' }, [
      el('a', { class: 'btn btn-sm', href: go(view, schritt(-1)), title: 'Zurück' }, '‹'),
      el('a', { class: 'btn btn-sm', href: go(view, new Date()) }, 'Heute'),
      el('a', { class: 'btn btn-sm', href: go(view, schritt(1)), title: 'Weiter' }, '›'),
    ]);

    let rangeSel = null;
    if (view === 'liste') {
      rangeSel = el('select', { class: 'btn-sm', title: 'Zeitraum' });
      [[30, 'nächste 30 Tage'], [90, 'nächste 3 Monate'], [180, 'nächste 6 Monate'], [365, 'nächstes Jahr']]
        .forEach(([v, lbl]) => rangeSel.appendChild(el('option', { value: v, selected: v === days }, lbl)));
      rangeSel.onchange = () => { location.hash = `#/termine?view=liste&days=${rangeSel.value}`; };
    }

    return el('div', { class: 'toolbar cal-toolbar' }, [
      el('h2', { class: 'cal-titel' }, titel),
      el('div', { class: 'spacer' }),
      nav,
      rangeSel,
      umschalter,
      el('a', { class: 'btn btn-sm', href: '#/einstellungen' }, 'Kalender verwalten'),
    ]);
  }

  // Termine nach Datum bündeln: 'YYYY-MM-DD' -> [ev, …].
  // Mehrtägige Termine erscheinen an jedem Tag, den sie berühren.
  function nachTag(events) {
    const map = new Map();
    const add = (key, ev) => { if (!map.has(key)) map.set(key, []); map.get(key).push(ev); };
    for (const ev of events) {
      add(ev.date, ev);
      if (ev.endDate && ev.endDate !== ev.date) {
        let d = parseIso(ev.date);
        const ende = parseIso(ev.endDate);
        if (!d || !ende) continue;
        for (let i = 0; i < 60 && (d = addDays(d, 1)) <= ende; i++) add(iso(d), Object.assign({}, ev, { weiter: true }));
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.allDay === b.allDay ? 0 : (a.allDay ? -1 : 1)) || a.startMs - b.startMs);
    }
    return map;
  }

  function zeitLabel(ev) {
    if (ev.allDay) return 'ganztägig';
    if (ev.weiter) return 'bis ' + (ev.endTime || '');
    return ev.time || '';
  }

  function chip(ev) {
    const c = el('div', {
      class: 'cal-chip' + (ev.allDay ? ' is-allday' : '') + (ev.weiter ? ' is-weiter' : ''),
      title: [zeitLabel(ev), ev.summary, ev.location, ev.calName].filter(Boolean).join(' · '),
    }, [
      ev.allDay ? null : el('span', { class: 'cal-chip-zeit' }, zeitLabel(ev)),
      el('span', { class: 'cal-chip-titel' }, ev.summary),
    ]);
    return c;
  }

  // --- Monatsansicht: 6 Wochen × 7 Tage ---
  function monatsGitter(anker, from, events) {
    const map = nachTag(events);
    const heute = heuteIso();
    const monat = anker.getMonth();

    const grid = el('div', { class: 'cal-grid' });
    for (const d of DOW_KURZ) grid.appendChild(el('div', { class: 'cal-dow' }, d));

    for (let i = 0; i < 42; i++) {
      const tag = addDays(from, i);
      const key = iso(tag);
      const evs = map.get(key) || [];
      grid.appendChild(el('div', {
        class: 'cal-cell' + (tag.getMonth() === monat ? '' : ' is-fremd') + (key === heute ? ' is-heute' : ''),
      }, [
        el('div', { class: 'cal-cell-kopf' }, [
          el('span', { class: 'cal-tagnr' }, String(tag.getDate())),
          evs.length ? el('span', { class: 'cal-anzahl' }, String(evs.length)) : null,
        ]),
        el('div', { class: 'cal-cell-body' }, evs.map(chip)),
      ]));
    }
    return grid;
  }

  // --- Wochenansicht: 7 Tagesspalten mit Terminliste ---
  function wochenGitter(from, events) {
    const map = nachTag(events);
    const heute = heuteIso();

    const grid = el('div', { class: 'cal-woche' });
    for (let i = 0; i < 7; i++) {
      const tag = addDays(from, i);
      const key = iso(tag);
      const evs = map.get(key) || [];
      grid.appendChild(el('div', { class: 'cal-spalte' + (key === heute ? ' is-heute' : '') }, [
        el('div', { class: 'cal-spalte-kopf' }, [
          el('span', { class: 'cal-spalte-dow' }, DOW_KURZ[i]),
          el('span', { class: 'cal-spalte-nr' }, String(tag.getDate()) + '.' + p2(tag.getMonth() + 1) + '.'),
        ]),
        el('div', { class: 'cal-spalte-body' }, evs.length
          ? evs.map(chip)
          : [el('div', { class: 'cal-leer' }, '–')]),
      ]));
    }
    return grid;
  }

  // --- Listenansicht (wie bisher: nach Tag gruppiert) ---
  function listenAnsicht(events, errors) {
    const wrap = el('div', {});
    if (!events.length) {
      wrap.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'help', style: 'margin:0;' }, errors.length
          ? 'Keine Termine im gewählten Zeitraum (siehe Hinweis oben).'
          : 'Keine Termine im gewählten Zeitraum. Kalender-Abos können unter Einstellungen → Kalender hinzugefügt werden.'),
      ]));
      return wrap;
    }
    const groups = [];
    const byDate = new Map();
    for (const ev of events) {
      if (!byDate.has(ev.date)) { const g = { date: ev.date, items: [] }; byDate.set(ev.date, g); groups.push(g); }
      byDate.get(ev.date).items.push(ev);
    }
    for (const g of groups) wrap.appendChild(dayBlock(g));
    return wrap;
  }

  function dayBlock(g) {
    return el('div', { class: 'termine-day' }, [
      el('div', { class: 'termine-day-head' }, [
        el('span', { class: 'termine-dow' }, wochentag(g.date)),
        el('span', { class: 'termine-date' }, formatDatum(g.date)),
      ]),
      el('ul', { class: 'termine-list' }, g.items.map(eventItem)),
    ]);
  }

  function eventItem(ev) {
    const zeit = ev.allDay ? 'ganztägig'
      : (ev.time + (ev.endTime && ev.endTime !== ev.time && ev.endDate === ev.date ? '–' + ev.endTime : ''));
    const meta = [];
    if (ev.location) meta.push('📍 ' + ev.location);
    if (ev.calName) meta.push(ev.calName);
    return el('li', { class: 'termine-item' }, [
      el('span', { class: 'termine-time' + (ev.allDay ? ' is-allday' : '') }, zeit),
      el('span', { class: 'termine-main' }, [
        el('strong', {}, ev.summary),
        meta.length ? el('span', { class: 'help', style: 'margin:0; display:block;' }, meta.join(' · ')) : null,
      ]),
    ]);
  }

  GR.views = GR.views || {};
  GR.views.renderTermine = renderTermine;
})();
