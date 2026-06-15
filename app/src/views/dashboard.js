(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, formatDatum, confirmDialog, toast } = GR.ui;
  const { emptySitzung } = GR.models;

  function renderDashboard(mount) {
    const sitzungen = store.listSitzungen().sort((a, b) => (a.datum < b.datum ? 1 : -1));

    const statusTag = s => {
      if (s.status === 'abgeschlossen') return el('span', { class: 'tag done' }, 'abgeschlossen');
      if (s.status === 'live') return el('span', { class: 'tag live' }, 'live');
      return el('span', { class: 'tag prep' }, 'in Vorbereitung');
    };

    const onNeu = () => {
      const s = emptySitzung();
      store.saveSitzung(s);
      location.hash = `#/sitzung/vorbereitung?id=${s.id}`;
    };

    const onDelete = id => {
      if (!confirmDialog('Diese Sitzung wirklich löschen? Diese Aktion ist nicht rückgängig zu machen.')) return;
      store.deleteSitzung(id);
      toast('Sitzung gelöscht');
      mount.innerHTML = '';
      renderDashboard(mount);
    };

    const body = el('div', {}, [
      el('div', { class: 'toolbar' }, [
        el('h2', { style: 'margin:0' }, 'Sitzungen'),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn-primary', onClick: onNeu }, '+ Neue Sitzung'),
      ]),
      el('div', { class: 'warn' }, 'Wichtig: Alle Daten liegen ausschließlich im Browserspeicher (localStorage). Bitte nach jeder Sitzung über „Einstellungen → Backup" ein JSON sichern.'),
      sitzungen.length === 0
        ? el('div', { class: 'card empty' }, 'Noch keine Sitzungen angelegt.')
        : el('div', { class: 'card', style: 'padding:0' }, [
            (() => {
              const table = el('table');
              table.appendChild(el('thead', {}, el('tr', {}, [
                el('th', {}, 'Datum'),
                el('th', {}, 'Status'),
                el('th', {}, 'TOPs'),
                el('th', {}, ''),
              ])));
              const tbody = el('tbody');
              for (const s of sitzungen) {
                const oeff = s.tops.filter(t => t.bereich === 'oeffentlich').length;
                const nicht = s.tops.filter(t => t.bereich === 'nicht_oeffentlich').length;
                tbody.appendChild(el('tr', {}, [
                  el('td', {}, formatDatum(s.datum)),
                  el('td', {}, [statusTag(s)]),
                  el('td', {}, `${oeff} öffentlich · ${nicht} nicht-öffentlich`),
                  el('td', { style: 'text-align:right; white-space:nowrap;' }, [
                    el('a', { class: 'btn btn-sm', href: `#/sitzung/vorbereitung?id=${s.id}` }, 'Vorbereiten'),
                    ' ',
                    el('a', { class: 'btn btn-sm btn-primary', href: `#/sitzung/live?id=${s.id}` }, 'Protokollieren'),
                    ' ',
                    el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(s.id) }, 'Löschen'),
                  ]),
                ]));
              }
              table.appendChild(tbody);
              return table;
            })(),
          ]),
    ]);

    mount.appendChild(body);
  }

  GR.views = GR.views || {};
  GR.views.renderDashboard = renderDashboard;
})();
