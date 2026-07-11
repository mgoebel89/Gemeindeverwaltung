(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, formatDatum, wochentag } = GR.ui;

  // ---- Termine (Kalender) ----
  // Zeigt die aggregierten Termine aller abonnierten iCal-Kalender, nach Tag
  // gruppiert. Die Kalender werden serverseitig geholt/geparst (Backend-Proxy).
  function renderTermine(mount, params) {
    let days = parseInt((params && params.days) || '90', 10);
    if (!Number.isFinite(days)) days = 90;

    const bar = el('div', { class: 'toolbar', style: 'align-items:center;' }, [
      el('h2', { style: 'margin:0;' }, 'Termine'),
      el('div', { class: 'spacer' }),
    ]);
    const rangeSel = el('select', { class: 'btn-sm', title: 'Zeitraum' });
    [[30, 'nächste 30 Tage'], [90, 'nächste 3 Monate'], [180, 'nächste 6 Monate'], [365, 'nächstes Jahr']]
      .forEach(([v, lbl]) => rangeSel.appendChild(el('option', { value: v, selected: v === days }, lbl)));
    rangeSel.onchange = () => { location.hash = `#/termine?days=${rangeSel.value}`; };
    bar.appendChild(rangeSel);
    bar.appendChild(el('a', { class: 'btn btn-sm', href: '#/einstellungen' }, 'Kalender verwalten'));
    mount.appendChild(bar);

    const body = el('div', {});
    mount.appendChild(body);
    body.appendChild(el('p', { class: 'help' }, 'Termine werden geladen…'));

    GR.api.listCalEvents(days).then(res => {
      body.innerHTML = '';
      const errors = res.errors || [];
      if (errors.length) {
        body.appendChild(el('div', { class: 'warn' },
          'Einige Kalender konnten nicht geladen werden: ' +
          errors.map(e => `${e.calName || '?'} (${e.error})`).join(' · ')));
      }
      const events = res.events || [];
      if (!events.length) {
        body.appendChild(el('div', { class: 'card' }, [
          el('p', { class: 'help', style: 'margin:0;' }, errors.length
            ? 'Keine Termine im gewählten Zeitraum (siehe Hinweis oben).'
            : 'Keine Termine im gewählten Zeitraum. Kalender-Abos können unter Einstellungen → Kalender hinzugefügt werden.'),
        ]));
        return;
      }
      // nach Tag gruppieren (Reihenfolge bleibt, da events bereits sortiert sind)
      const groups = [];
      const byDate = new Map();
      for (const ev of events) {
        if (!byDate.has(ev.date)) { const g = { date: ev.date, items: [] }; byDate.set(ev.date, g); groups.push(g); }
        byDate.get(ev.date).items.push(ev);
      }
      for (const g of groups) body.appendChild(dayBlock(g));
    }).catch(err => {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'warn' }, 'Termine konnten nicht geladen werden: ' + err.message));
    });
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
