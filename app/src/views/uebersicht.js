(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store, models } = GR;
  const { el, formatDatum } = GR.ui;

  // ---- Dashboard / Übersicht ----
  // Startseite mit Überblick über anstehende Vermietungen, Vertrags-Fristen und
  // (in späteren Phasen) Termine aus Kalendern und Aufgaben aus Vikunja.
  function renderDashboard(mount) {
    const heute = new Date(); heute.setHours(0, 0, 0, 0);

    mount.appendChild(el('div', { class: 'toolbar', style: 'align-items:center;' }, [
      el('h2', { style: 'margin:0;' }, 'Übersicht'),
      el('div', { class: 'spacer' }),
      el('a', { class: 'btn btn-sm', href: '#/sitzungen' }, '+ Sitzung'),
      el('a', { class: 'btn btn-sm', href: '#/vermietung' }, '+ Vermietung'),
      el('button', { class: 'btn-sm btn-primary', onClick: () => GR.ui.uploadPaperlessDocument({ onUploaded: () => {} }) }, '＋ Dokument'),
    ]));

    const grid = el('div', { class: 'dash-grid' });
    grid.appendChild(cardVermietungen(heute));
    grid.appendChild(cardFristen(heute));
    grid.appendChild(cardTermine());
    grid.appendChild(cardPlaceholder('Offene Aufgaben', '✅', 'Vikunja-Anbindung folgt (Phase 3): offene To-dos erscheinen hier.'));
    mount.appendChild(grid);
  }

  function dashCard(title, icon, bodyNodes, footLink) {
    const children = [
      el('div', { class: 'dash-card-head' }, [
        el('span', { class: 'dash-icon' }, icon),
        el('h3', { style: 'margin:0;' }, title),
      ]),
      el('div', { class: 'dash-card-body' }, bodyNodes),
    ];
    if (footLink) children.push(el('div', { class: 'dash-card-foot' }, [footLink]));
    return el('div', { class: 'card dash-card' }, children);
  }

  function emptyLine(text) { return el('p', { class: 'help', style: 'margin:0;' }, text); }

  // --- Anstehende Saalvermietungen ---
  function cardVermietungen(heute) {
    const rows = store.listVermietungen()
      .filter(v => v.startDatum && new Date(v.startDatum) >= heute)
      .sort((a, b) => (a.startDatum < b.startDatum ? -1 : 1))
      .slice(0, 6);

    let body;
    if (!rows.length) {
      body = [emptyLine('Keine anstehenden Vermietungen.')];
    } else {
      body = [el('ul', { class: 'dash-list' }, rows.map(v => {
        const raum = store.getRaum(v.raumId);
        const mieter = store.getMieter(v.mieterId);
        const name = mieter ? models.fullNameMieter(mieter) : '—';
        const zeit = formatDatum(v.startDatum) + (v.endDatum && v.endDatum !== v.startDatum ? '–' + formatDatum(v.endDatum) : '');
        return el('li', {}, [
          el('span', { class: 'dash-date' }, zeit),
          el('span', { class: 'dash-main' }, [
            el('strong', {}, raum ? raum.name : 'Objekt?'),
            el('span', { class: 'help', style: 'margin:0;' }, ' · ' + name + (v.anlass ? ' · ' + v.anlass : '')),
          ]),
        ]);
      }))];
    }
    return dashCard('Anstehende Saalvermietungen', '🏛', body,
      el('a', { href: '#/vermietung' }, 'Zum Vermietungsmodul →'));
  }

  // --- Vertrags-Fristen (Kündigung) ---
  function cardFristen(heute) {
    const items = store.listVertraege()
      .map(v => ({ v, status: models.fristStatus(v, heute), tage: models.tageBisKuendigung(v, heute) }))
      .filter(x => x.status && x.status !== 'ok')
      .sort((a, b) => (a.tage ?? 1e9) - (b.tage ?? 1e9))
      .slice(0, 6);

    const ampel = { ueberfaellig: ['🔴', 'überfällig'], akut: ['🟠', 'akut'], bald: ['🟡', 'bald'] };
    let body;
    if (!items.length) {
      body = [emptyLine('Keine anstehenden Kündigungsfristen.')];
    } else {
      body = [el('ul', { class: 'dash-list' }, items.map(({ v, status, tage }) => {
        const partner = store.getVertragspartner(v.partnerId);
        const termin = models.spaetesterKuendigungstermin(v);
        const [dot, lbl] = ampel[status] || ['⚪', ''];
        const tageTxt = tage == null ? '' : (tage < 0 ? `${-tage} T überfällig` : `in ${tage} T`);
        return el('li', {}, [
          el('span', { class: 'dash-date', title: lbl }, dot + ' ' + (termin ? formatDatum(models.dateToIso(termin)) : '')),
          el('span', { class: 'dash-main' }, [
            el('strong', {}, v.bezeichnung || '(ohne Bezeichnung)'),
            el('span', { class: 'help', style: 'margin:0;' }, ' · ' + (partner ? partner.name : '—') + (tageTxt ? ' · ' + tageTxt : '')),
          ]),
        ]);
      }))];
    }
    return dashCard('Vertrags-Fristen (Kündigung)', '⏰', body,
      el('a', { href: '#/vertraege' }, 'Zu Verträge & Pacht →'));
  }

  // --- Anstehende Termine (iCal-Abos, serverseitig geladen) ---
  function cardTermine() {
    const bodyBox = el('div', {}, [emptyLine('Termine werden geladen…')]);
    const card = dashCard('Anstehende Termine', '📅', [bodyBox],
      el('a', { href: '#/termine' }, 'Zu den Terminen →'));

    GR.api.listCalEvents(60).then(res => {
      bodyBox.innerHTML = '';
      const events = (res.events || []).slice(0, 6);
      const errors = res.errors || [];
      if (!events.length) {
        bodyBox.appendChild(emptyLine(errors.length ? 'Kalender nicht erreichbar.' : 'Keine anstehenden Termine.'));
        return;
      }
      bodyBox.appendChild(el('ul', { class: 'dash-list' }, events.map(ev => {
        const zeit = formatDatum(ev.date) + (ev.allDay ? '' : ' · ' + ev.time);
        return el('li', {}, [
          el('span', { class: 'dash-date' }, zeit),
          el('span', { class: 'dash-main' }, [
            el('strong', {}, ev.summary),
            el('span', { class: 'help', style: 'margin:0;' }, ev.calName ? ' · ' + ev.calName : ''),
          ]),
        ]);
      })));
    }).catch(() => {
      bodyBox.innerHTML = '';
      bodyBox.appendChild(emptyLine('Termine konnten nicht geladen werden.'));
    });
    return card;
  }

  function cardPlaceholder(title, icon, text) {
    return dashCard(title, icon, [
      el('div', { class: 'dash-placeholder' }, [emptyLine(text)]),
    ]);
  }

  GR.views = GR.views || {};
  GR.views.renderDashboard = renderDashboard;
})();
