(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, confirmDialog } = GR.ui;
  const M = GR.models;

  function eur(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
  function hsLabel(h) { return (h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)'); }

  // Merkt das gewählte Jahr über Re-Renders (nur diese Session).
  const uiState = { jahr: new Date().getFullYear() };

  function renderHaushalt(mount) {
    function refresh() { mount.innerHTML = ''; renderHaushalt(mount); }

    const hss = store.listHaushaltsstellen().sort((a, b) => (a.nummer || '').localeCompare(b.nummer || '', 'de'));

    // Jahre für die Auswahl (aus Auslagen + Vorgängen + Arbeitsabrechnungen + aktuellem Jahr).
    const jahre = new Set([new Date().getFullYear(), Number(uiState.jahr)]);
    for (const a of store.listAuslagen()) if (a.haushaltsjahr) jahre.add(Number(a.haushaltsjahr));
    for (const v of store.listVorgaenge()) if (v.haushaltsjahr) jahre.add(Number(v.haushaltsjahr));
    for (const a of store.listArbeitsabrechnungen()) if (a.haushaltsjahr) jahre.add(Number(a.haushaltsjahr));
    const jahrSel = el('select', { class: 'input', style: 'width:auto;', onChange: (e) => { uiState.jahr = Number(e.target.value); refresh(); } },
      [...jahre].sort((a, b) => b - a).map(j => el('option', { value: j, selected: Number(uiState.jahr) === j }, String(j))));

    mount.appendChild(el('div', { class: 'toolbar', style: 'align-items:center;' }, [
      el('h2', { style: 'margin:0;' }, 'Haushalt'),
      el('div', { class: 'spacer', style: 'flex:1;' }),
      el('span', { class: 'help', style: 'align-self:center;' }, 'Jahr:'),
      jahrSel,
      el('button', { class: 'btn-primary', onClick: () => GR.auslagen.haushaltsstelleDialog(null, refresh) }, '+ Neue Haushaltsstelle'),
    ]));
    mount.appendChild(el('p', { class: 'help' }, 'Restmittel = Budget − (eingereichte + erstattete Bargeldauslagen + alle Kosten aus Vorgängen + abgerechnete und ausgezahlte Arbeitszeiten) im gewählten Haushaltsjahr.'));

    if (hss.length === 0) {
      mount.appendChild(el('div', { class: 'card empty' }, 'Noch keine Haushaltsstellen angelegt. Oben „+ Neue Haushaltsstelle".'));
      return;
    }

    const jahr = uiState.jahr;
    let sumBudget = 0, sumVerbrauch = 0;
    const rows = hss.map(h => {
      const budget = (h.budget === null || h.budget === undefined || h.budget === '') ? null : Number(h.budget);
      const ausl = M.budgetVerbrauch(store.listAuslagen(), h.id, jahr, M.ABGERECHNET_STATUS);
      const vorg = M.vorgaengeVerbrauch(store.listVorgaenge(), h.id, jahr);
      const arb = M.arbeitszeitenVerbrauch(store.listArbeitsabrechnungen(), h.id, jahr);
      const verbrauch = ausl + vorg + arb;
      const rest = budget != null ? budget - verbrauch : null;
      if (budget != null) sumBudget += budget;
      sumVerbrauch += verbrauch;
      return el('tr', { class: rest != null && rest < 0 ? 'vg-row-neg' : '' }, [
        el('td', {}, el('strong', {}, h.nummer || '—')),
        el('td', {}, h.bezeichnung || '—'),
        el('td', { style: 'text-align:right;' }, budget != null ? eur(budget) : '—'),
        el('td', { style: 'text-align:right;', title: 'Auslagen ' + eur(ausl) + ' · Vorgänge ' + eur(vorg) + ' · Arbeitszeiten ' + eur(arb) }, eur(verbrauch)),
        el('td', { style: 'text-align:right; font-weight:600;' }, rest != null ? eur(rest) : '—'),
        el('td', { style: 'text-align:right; white-space:nowrap;' }, [
          el('button', { class: 'btn-sm', onClick: () => GR.auslagen.haushaltsstelleDialog(h, refresh) }, 'Bearbeiten'), ' ',
          el('button', { class: 'btn-sm btn-danger', onClick: () => { if (confirmDialog(`Haushaltsstelle „${hsLabel(h)}" löschen?`)) { store.deleteHaushaltsstelle(h.id); refresh(); } } }, 'Löschen'),
        ]),
      ]);
    });

    const table = el('table', { class: 'vg-budget-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', {}, 'Nummer'), el('th', {}, 'Bezeichnung'),
        el('th', { style: 'text-align:right;' }, 'Budget'),
        el('th', { style: 'text-align:right;' }, 'Verbrauch ' + jahr),
        el('th', { style: 'text-align:right;' }, 'Restmittel'),
        el('th', {}, ''),
      ])),
      el('tbody', {}, rows),
      el('tfoot', {}, el('tr', {}, [
        el('td', { colspan: '2' }, el('strong', {}, 'Summe')),
        el('td', { style: 'text-align:right; font-weight:600;' }, eur(sumBudget)),
        el('td', { style: 'text-align:right; font-weight:600;' }, eur(sumVerbrauch)),
        el('td', { style: 'text-align:right; font-weight:600;' }, eur(sumBudget - sumVerbrauch)),
        el('td', {}, ''),
      ])),
    ]);
    mount.appendChild(el('div', { class: 'card' }, [table]));
  }

  GR.views = GR.views || {};
  GR.views.renderHaushalt = renderHaushalt;
})();
