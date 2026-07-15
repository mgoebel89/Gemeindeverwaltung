(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store, roles } = GR;
  const { el, toast, confirmDialog, formatDatum } = GR.ui;
  const M = GR.models;

  const STATUS_META = {
    geplant: { label: 'Geplant', cls: 'vg-st-geplant' },
    bearbeitung: { label: 'In Bearbeitung', cls: 'vg-st-bearbeitung' },
    pausiert: { label: 'Pausiert', cls: 'vg-st-pausiert' },
    beendet: { label: 'Beendet', cls: 'vg-st-beendet' },
  };

  // Merkt Filter-/Sortier-Zustand über Re-Renders hinweg (nur diese Session).
  const uiState = { q: '', kategorie: '', sort: '-erstelltAm', showBeendet: false };
  // Notiz-Einträge im Bearbeiten-Modus (transient, überlebt Re-Renders).
  const histEditing = new Set();

  // Markdown → HTML für die Notiz-Vorschau (reiner Anzeige-Zweck, ein Nutzer,
  // internes Netz – wie in der Aufgaben-Detailkarte).
  function mdRender(md) {
    const m = window.marked;
    const fn = m && (m.parse || m);
    if (typeof fn !== 'function') return '<p class="help">Vorschau nicht verfügbar.</p>';
    try { return fn(String(md || ''), { breaks: true, gfm: true }); } catch (_) { return ''; }
  }

  const HIST_TYP_META = {
    notiz: { label: 'Notiz', icon: '📝' },
    referenz: { label: 'Referenz', icon: '↪' },
    dokument: { label: 'Dokument', icon: '📄' },
    todo: { label: 'ToDo', icon: '☑' },
    kosten: { label: 'Kosten', icon: '€' },
  };

  const PRIO_OPTS = [['', 'Keine Priorität'], ['1', 'Niedrig'], ['2', 'Mittel'], ['3', 'Hoch'], ['4', 'Dringend'], ['5', 'Sofort']];
  const PRIO_LABEL = { 1: 'Niedrig', 2: 'Mittel', 3: 'Hoch', 4: 'Dringend', 5: 'Sofort' };

  function eur(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }

  function statusBadge(status) {
    const m = STATUS_META[status] || STATUS_META.geplant;
    return el('span', { class: 'vg-badge ' + m.cls }, m.label);
  }

  // ---------- Rollen-Chip (Umschalter mit PIN) ----------
  function roleChip(onChanged) {
    const leitung = roles.isLeitung();
    const chip = el('button', {
      class: 'role-chip ' + (leitung ? 'role-leitung' : 'role-rat'),
      title: leitung
        ? 'Leitungs-Ansicht aktiv – vertrauliche Vorgänge sind sichtbar. Klicken, um zu sperren.'
        : 'Ratsmitglied-Ansicht – vertrauliche Vorgänge sind ausgeblendet. Klicken, um die Leitungs-Ansicht freizuschalten.',
      onClick: async () => {
        if (roles.isLeitung()) {
          roles.setRat();
          toast('Leitungs-Ansicht gesperrt');
          onChanged && onChanged();
          return;
        }
        if (roles.hasPin()) {
          const pin = window.prompt('PIN für die Leitungs-Ansicht:');
          if (pin === null) return;
          const ok = await roles.trySetLeitung(pin);
          if (!ok) { toast('Falscher PIN'); return; }
          toast('Leitungs-Ansicht freigeschaltet');
        } else {
          await roles.trySetLeitung('');
          toast('Leitungs-Ansicht aktiv (kein PIN gesetzt – in den Einstellungen einrichten)', 3500);
        }
        onChanged && onChanged();
      },
    }, [
      el('span', { class: 'role-dot' }),
      leitung ? 'Leitung' : 'Ratsmitglied',
    ]);
    return chip;
  }

  // =================== Übersicht (Kacheln) ===================
  function renderOverview(mount) {
    function refresh() { mount.innerHTML = ''; renderOverview(mount); }

    const alle = roles.filterVorgaenge(store.listVorgaenge());
    const kategorien = (store.getSettings().vorgaenge || {}).kategorien || [];

    // Toolbar
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('h1', { class: 'view-title', style: 'margin:0; font-size:1.3rem;' }, 'Vorgänge & Projekte'),
      el('div', { class: 'spacer' }),
      roleChip(refresh),
      el('a', { class: 'btn', href: '#/vorgaenge?view=planung' }, '📊 Haushaltsplanung'),
      el('button', { class: 'btn-primary', onClick: () => onNew(refresh) }, '+ Neuer Vorgang'),
    ]));

    // Filterleiste
    const qInput = el('input', {
      class: 'input', type: 'search', placeholder: 'Suche Titel/Beschreibung…', value: uiState.q,
      onInput: (e) => { uiState.q = e.target.value; renderTiles(); },
      style: 'max-width:260px;',
    });
    const katSelect = el('select', { class: 'input', onChange: (e) => { uiState.kategorie = e.target.value; renderTiles(); }, style: 'max-width:200px;' }, [
      el('option', { value: '' }, 'Alle Kategorien'),
      ...kategorien.map(k => el('option', { value: k, selected: uiState.kategorie === k }, k)),
    ]);
    const sortSelect = el('select', { class: 'input', onChange: (e) => { uiState.sort = e.target.value; renderTiles(); }, style: 'max-width:200px;' }, [
      el('option', { value: '-erstelltAm', selected: uiState.sort === '-erstelltAm' }, 'Neueste zuerst'),
      el('option', { value: 'erstelltAm', selected: uiState.sort === 'erstelltAm' }, 'Älteste zuerst'),
      el('option', { value: 'titel', selected: uiState.sort === 'titel' }, 'Titel A–Z'),
      el('option', { value: '-lastModifiedAt', selected: uiState.sort === '-lastModifiedAt' }, 'Zuletzt geändert' ),
    ]);
    mount.appendChild(el('div', { class: 'vg-filterbar' }, [qInput, katSelect, sortSelect]));

    const tilesHost = el('div', {});
    mount.appendChild(tilesHost);

    function matches(v) {
      if (uiState.kategorie && v.kategorie !== uiState.kategorie) return false;
      if (uiState.q) {
        const q = uiState.q.toLowerCase();
        if (!(String(v.titel || '').toLowerCase().includes(q) ||
              String(v.beschreibung || '').toLowerCase().includes(q))) return false;
      }
      return true;
    }
    function sortList(list) {
      const arr = list.slice();
      switch (uiState.sort) {
        case 'erstelltAm': arr.sort((a, b) => String(a.erstelltAm || '').localeCompare(String(b.erstelltAm || ''))); break;
        case 'titel': arr.sort((a, b) => String(a.titel || '').localeCompare(String(b.titel || ''), 'de')); break;
        case '-lastModifiedAt': arr.sort((a, b) => String(b.lastModifiedAt || '').localeCompare(String(a.lastModifiedAt || ''))); break;
        default: arr.sort((a, b) => String(b.erstelltAm || '').localeCompare(String(a.erstelltAm || '')));
      }
      return arr;
    }

    function renderTiles() {
      tilesHost.innerHTML = '';
      const gefiltert = alle.filter(matches);
      const aktive = sortList(gefiltert.filter(v => v.status !== 'beendet'));
      const beendet = sortList(gefiltert.filter(v => v.status === 'beendet'));

      if (aktive.length === 0) {
        tilesHost.appendChild(el('div', { class: 'card vg-empty' },
          alle.length === 0
            ? 'Noch keine Vorgänge. Lege mit „+ Neuer Vorgang" den ersten an.'
            : 'Keine laufenden Vorgänge für diese Filter.'));
      } else {
        const grid = el('div', { class: 'vg-grid' }, aktive.map(tile));
        tilesHost.appendChild(grid);
      }

      // Abgeschlossen-Bereich (eingeklappt)
      if (beendet.length > 0) {
        const header = el('button', {
          class: 'vg-section-toggle',
          onClick: () => { uiState.showBeendet = !uiState.showBeendet; renderTiles(); },
        }, [
          el('span', {}, (uiState.showBeendet ? '▾ ' : '▸ ') + `Abgeschlossen (${beendet.length})`),
        ]);
        tilesHost.appendChild(el('div', { class: 'vg-section' }, [
          header,
          uiState.showBeendet ? el('div', { class: 'vg-grid vg-grid-done' }, beendet.map(tile)) : null,
        ]));
      }
    }

    function tile(v) {
      const kosten = M.vorgangKosten(v);
      return el('div', {
        class: 'vg-tile' + (v.vertraulich ? ' vg-tile-vertraulich' : '') + (v.status === 'beendet' ? ' vg-tile-done' : ''),
        onClick: () => { location.hash = '#/vorgaenge?id=' + encodeURIComponent(v.id); },
      }, [
        el('div', { class: 'vg-tile-top' }, [
          statusBadge(v.status),
          v.vertraulich ? el('span', { class: 'vg-lock', title: 'Vertraulich – nur für die Leitung' }, '🔒') : null,
        ]),
        el('div', { class: 'vg-tile-title' }, v.titel || '(ohne Titel)'),
        v.kategorie ? el('div', { class: 'vg-tile-kat' }, v.kategorie) : null,
        el('div', { class: 'vg-tile-meta' }, [
          el('span', {}, 'angelegt ' + (v.erstelltAm ? formatDatum(v.erstelltAm) : '—')),
          kosten > 0 ? el('span', {}, eur(kosten)) : null,
        ]),
      ]);
    }

    renderTiles();
  }

  function onNew(after) {
    const titel = window.prompt('Titel des neuen Vorgangs:');
    if (titel === null) return;
    const v = M.emptyVorgang();
    v.titel = titel.trim();
    store.saveVorgang(v);
    location.hash = '#/vorgaenge?id=' + encodeURIComponent(v.id);
  }

  // =================== Detail ===================
  function renderDetail(mount, id) {
    const v = store.getVorgang(id);
    if (!v) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, 'Vorgang nicht gefunden'),
        el('a', { href: '#/vorgaenge' }, '← Zurück zur Übersicht'),
      ]));
      return;
    }
    // Ratsmitglieder dürfen vertrauliche Vorgänge nicht öffnen.
    if (!roles.canSeeVorgang(v)) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, 'Nicht sichtbar'),
        el('p', {}, 'Dieser Vorgang ist als vertraulich markiert und nur in der Leitungs-Ansicht sichtbar.'),
        el('a', { href: '#/vorgaenge' }, '← Zurück zur Übersicht'),
      ]));
      return;
    }

    function persist() { store.saveVorgang(v); }
    function refresh() { mount.innerHTML = ''; renderDetail(mount, id); }

    const kategorien = (store.getSettings().vorgaenge || {}).kategorien || [];

    // Ablauf-Dokumentation als PDF (Download bzw. in Paperless ablegen).
    function exportPdf(target) {
      GR.vorgaengePdf.buildVorgangDokumentation(v, {
        target,
        onUploaded: (docRec) => {
          const entry = Object.assign(M.emptyHistorieEintrag('dokument'), {
            titel: 'Ablauf-Dokumentation',
            paperlessDocs: [{ id: docRec.id, title: docRec.title || ('Dokument ' + docRec.id) }],
          });
          v.historie.push(entry);
          persist();
          toast('Dokumentation in Paperless abgelegt und verknüpft');
          refresh();
        },
      });
    }

    // Kopf-Toolbar
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vorgaenge' }, '← Übersicht'),
      el('div', { class: 'spacer' }),
      roleChip(refresh),
      el('button', { class: 'btn', onClick: () => exportPdf('download') }, '📄 Ablauf-PDF'),
      el('button', { class: 'btn', onClick: () => exportPdf('paperless') }, '📥 In Paperless'),
      el('button', {
        class: 'btn btn-danger', onClick: () => {
          if (!confirmDialog(`Vorgang „${v.titel || 'ohne Titel'}" wirklich löschen?`)) return;
          store.deleteVorgang(v.id);
          location.hash = '#/vorgaenge';
        },
      }, 'Löschen'),
    ]));

    // Karte: Eckdaten
    const titelInput = el('input', {
      class: 'input', type: 'text', value: v.titel || '', placeholder: 'Titel des Vorgangs',
      style: 'font-size:1.15rem; font-weight:600;',
      onChange: (e) => { v.titel = e.target.value.trim(); persist(); },
    });
    const statusSelect = el('select', {
      class: 'input', onChange: (e) => { v.status = e.target.value; persist(); refresh(); },
    }, M.VORGANG_STATUS.map(s => el('option', { value: s, selected: v.status === s }, STATUS_META[s].label)));
    const katSelect = el('select', {
      class: 'input', onChange: (e) => { v.kategorie = e.target.value; persist(); },
    }, [
      el('option', { value: '' }, '– keine –'),
      ...kategorien.map(k => el('option', { value: k, selected: v.kategorie === k }, k)),
    ]);
    const vertraulichToggle = el('label', { class: 'vg-toggle' }, [
      el('input', {
        type: 'checkbox', checked: !!v.vertraulich,
        onChange: (e) => { v.vertraulich = e.target.checked; persist(); refresh(); },
      }),
      el('span', {}, '🔒 Vertraulich (nur für die Leitung sichtbar)'),
    ]);
    const beschreibung = el('textarea', {
      class: 'input', rows: '4', placeholder: 'Kurzbeschreibung des Vorgangs…',
      onChange: (e) => { v.beschreibung = e.target.value; persist(); },
    });
    beschreibung.value = v.beschreibung || '';

    mount.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'vg-form-row' }, [
        el('div', { class: 'vg-field vg-field-grow' }, [el('label', { class: 'vg-label' }, 'Titel'), titelInput]),
      ]),
      el('div', { class: 'vg-form-row' }, [
        el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Status'), statusSelect]),
        el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Kategorie'), katSelect]),
      ]),
      el('div', { class: 'vg-form-row' }, [vertraulichToggle]),
      el('div', { class: 'vg-form-row' }, [
        el('div', { class: 'vg-field vg-field-grow' }, [el('label', { class: 'vg-label' }, 'Beschreibung'), beschreibung]),
      ]),
    ]));

    mount.appendChild(buildBudget(v, persist, refresh));
    mount.appendChild(buildHistorie(v, persist, refresh));
  }

  // =================== Budget / Kostenstellen ===================
  function buildBudget(v, persist, refresh) {
    if (!Array.isArray(v.haushaltsstellen)) v.haushaltsstellen = [];
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, 'Budget / Kostenstellen'));

    const jahrI = el('input', {
      class: 'input', type: 'number', step: '1', value: v.haushaltsjahr || new Date().getFullYear(),
      onChange: (ev) => { v.haushaltsjahr = ev.target.value === '' ? '' : Number(ev.target.value); persist(); refresh(); },
    });
    card.appendChild(el('div', { class: 'vg-form-row' }, [
      el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Haushaltsjahr (fürs ganze Projekt)'), jahrI]),
    ]));

    // --- Zugewiesene Kostenstellen (Liste; Eintrag wählt daraus) ---
    card.appendChild(el('div', { class: 'vg-label', style: 'margin-top:6px;' }, 'Zugewiesene Kostenstellen'));
    const chips = el('div', { class: 'vg-stellen-chips' });
    if (v.haushaltsstellen.length === 0) {
      chips.appendChild(el('span', { class: 'help' }, 'Noch keine Kostenstelle zugewiesen.'));
    }
    for (const id of v.haushaltsstellen) {
      const h = store.getHaushaltsstelle(id);
      const benutzt = M.vorgangKostenAuf(v, id) > 0;
      const rm = el('button', {
        class: 'vg-chip-x', title: benutzt ? 'Wird von Kosteneinträgen genutzt – erst dort entfernen' : 'Entfernen',
        disabled: benutzt,
        onClick: () => { v.haushaltsstellen = v.haushaltsstellen.filter(x => x !== id); persist(); refresh(); },
      }, '✕');
      chips.appendChild(el('span', { class: 'vg-stelle-chip' }, [
        el('span', {}, h ? ((h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)')) : '(unbekannte Stelle)'),
        rm,
      ]));
    }
    card.appendChild(chips);

    // Hinzufügen-Auswahl (nur noch nicht zugewiesene Stellen)
    const frei = store.listHaushaltsstellen().filter(h => !v.haushaltsstellen.includes(h.id));
    const addSel = el('select', { class: 'input', onChange: (ev) => {
      if (!ev.target.value) return;
      if (!v.haushaltsstellen.includes(ev.target.value)) v.haushaltsstellen.push(ev.target.value);
      persist(); refresh();
    } }, [
      el('option', { value: '' }, frei.length ? '+ Kostenstelle zuweisen…' : '(keine weiteren Stellen – in Bargeldauslagen anlegen)'),
      ...frei.map(h => el('option', { value: h.id }, (h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)'))),
    ]);
    card.appendChild(el('div', { class: 'vg-field', style: 'margin-top:8px; max-width:360px;' }, [addSel]));

    // --- Kennzahlen ---
    const eigen = M.vorgangKosten(v);
    card.appendChild(el('div', { class: 'vg-kpis', style: 'margin-top:14px;' }, [
      kpi('Kosten dieses Vorgangs', eur(eigen), v.haushaltsstellen.length > 1 ? 'über ' + v.haushaltsstellen.length + ' Kostenstellen' : null),
    ]));

    if (v.haushaltsstellen.length > 0) {
      const rows = v.haushaltsstellen.map(id => {
        const h = store.getHaushaltsstelle(id);
        const budget = h && h.budget != null ? Number(h.budget) : null;
        const eigenAuf = M.vorgangKostenAuf(v, id);
        const ausl = M.budgetVerbrauch(store.listAuslagen(), id, v.haushaltsjahr, M.ABGERECHNET_STATUS);
        const vorg = M.vorgaengeVerbrauch(store.listVorgaenge(), id, v.haushaltsjahr);
        const gesamt = ausl + vorg;
        const rest = budget != null ? budget - gesamt : null;
        return el('tr', { class: rest != null && rest < 0 ? 'vg-row-neg' : '' }, [
          el('td', {}, h ? ((h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)')) : '(unbekannt)'),
          el('td', { style: 'text-align:right;' }, eur(eigenAuf)),
          el('td', { style: 'text-align:right;' }, budget != null ? eur(budget) : '—'),
          el('td', { style: 'text-align:right;', title: 'Auslagen ' + eur(ausl) + ' · Vorgänge ' + eur(vorg) }, eur(gesamt)),
          el('td', { style: 'text-align:right; font-weight:600;' }, rest != null ? eur(rest) : '—'),
        ]);
      });
      card.appendChild(el('table', { class: 'vg-budget-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Kostenstelle'),
          el('th', { style: 'text-align:right;' }, 'Dieser Vorgang'),
          el('th', { style: 'text-align:right;' }, 'Budget'),
          el('th', { style: 'text-align:right;' }, 'Verbrauch ' + (v.haushaltsjahr || '')),
          el('th', { style: 'text-align:right;' }, 'Restmittel'),
        ])),
        el('tbody', {}, rows),
      ]));
    } else {
      card.appendChild(el('p', { class: 'help' }, 'Weise eine oder mehrere Kostenstellen zu, um Restmittel im Blick zu behalten. Kosten erfasst du unten in der Historie als „€ Kosten" und buchst sie je Anschaffung auf eine der Stellen.'));
    }

    // Planung für künftigen Haushalt
    const planBetragI = el('input', {
      class: 'input', type: 'number', step: '0.01', min: '0', value: (v.planung && v.planung.betrag != null) ? v.planung.betrag : '',
      placeholder: '0,00', onChange: (ev) => { v.planung = v.planung || {}; v.planung.betrag = ev.target.value === '' ? null : Number(ev.target.value); persist(); },
    });
    const planJahrI = el('input', {
      class: 'input', type: 'number', step: '1', value: (v.planung && v.planung.zieljahr) || '', placeholder: String(new Date().getFullYear() + 1),
      onChange: (ev) => { v.planung = v.planung || {}; v.planung.zieljahr = ev.target.value; persist(); },
    });
    card.appendChild(el('div', { class: 'vg-plan-box' }, [
      el('div', { class: 'vg-label', style: 'margin-bottom:6px;' }, 'Bedarf für künftigen Haushalt planen'),
      el('div', { class: 'vg-form-row' }, [
        el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Geplanter Betrag (€)'), planBetragI]),
        el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Zieljahr'), planJahrI]),
      ]),
      el('p', { class: 'help', style: 'margin:4px 0 0;' }, 'Erscheint in der Haushaltsplanung (Übersicht › Haushaltsplanung).'),
    ]));

    return card;
  }

  function kpi(label, value, sub, cls) {
    return el('div', { class: 'vg-kpi ' + (cls || '') }, [
      el('div', { class: 'vg-kpi-label' }, label),
      el('div', { class: 'vg-kpi-value' }, value),
      sub ? el('div', { class: 'vg-kpi-sub' }, sub) : null,
    ]);
  }

  // =================== Vorgangshistorie (Zeitleiste) ===================
  function buildHistorie(v, persist, refresh) {
    if (!Array.isArray(v.historie)) v.historie = [];
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, 'Vorgangshistorie'));

    // Add-Leiste (Phase 2: Notiz/Referenz/Dokument; ToDo/Kosten folgen in Phase 3)
    function addEntry(typ, extra) {
      const e = Object.assign(M.emptyHistorieEintrag(typ), extra || {});
      v.historie.push(e);
      if (typ === 'notiz') histEditing.add(e.id);
      persist();
      refresh();
    }
    card.appendChild(el('div', { class: 'vg-addbar' }, [
      el('span', { class: 'vg-addbar-label' }, 'Eintrag hinzufügen:'),
      el('button', { class: 'btn-sm', onClick: () => addEntry('notiz', { textMd: '' }) }, '📝 Notiz'),
      el('button', { class: 'btn-sm', onClick: () => addEntry('todo', { titel: '', faellig: '', prioritaet: '', vikunjaTaskId: null, erledigt: false }) }, '☑ ToDo'),
      el('button', { class: 'btn-sm', onClick: () => addEntry('kosten', { betrag: 0, beschreibung: '', haendler: '', belegdatum: '', haushaltsstelleId: (v.haushaltsstellen && v.haushaltsstellen.length === 1 ? v.haushaltsstellen[0] : ''), paperlessDocs: [] }) }, '€ Kosten'),
      el('button', { class: 'btn-sm', onClick: () => addEntry('referenz', { refVorgangId: '', notiz: '' }) }, '↪ Referenz'),
      el('button', { class: 'btn-sm', onClick: () => addEntry('dokument', { titel: '', paperlessDocs: [] }) }, '📄 Dokument'),
    ]));

    // Zeitleiste (nur sichtbare Einträge; neueste zuerst nach Datum)
    const sichtbar = roles.visibleHistorie(v).slice()
      .sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));

    if (sichtbar.length === 0) {
      card.appendChild(el('div', { class: 'help vg-hist-empty' }, 'Noch keine Einträge. Beginne oben mit Notiz, Referenz oder Dokument.'));
      return card;
    }

    const list = el('div', { class: 'vg-hist' });
    for (const e of sichtbar) list.appendChild(histEntry(v, e, persist, refresh));
    card.appendChild(list);
    return card;
  }

  function histEntry(v, e, persist, refresh) {
    const meta = HIST_TYP_META[e.typ] || { label: e.typ, icon: '•' };
    const wrap = el('div', { class: 'vg-hist-entry' + (e.vertraulich ? ' vg-hist-vertraulich' : '') });

    // Kopfzeile: Typ · Datum · Vertraulich · Löschen
    const dateInput = el('input', {
      type: 'date', class: 'input vg-hist-date', value: e.datum || '',
      onChange: (ev) => { e.datum = ev.target.value; persist(); refresh(); },
    });
    const vToggle = el('label', { class: 'vg-hist-vtoggle', title: 'Vertraulich – nur für die Leitung' }, [
      el('input', { type: 'checkbox', checked: !!e.vertraulich, onChange: (ev) => { e.vertraulich = ev.target.checked; persist(); refresh(); } }),
      el('span', {}, '🔒'),
    ]);
    const delBtn = el('button', {
      class: 'btn-sm btn-danger', title: 'Eintrag löschen', onClick: () => {
        if (!confirmDialog('Diesen Historieneintrag löschen?')) return;
        v.historie = v.historie.filter(x => x.id !== e.id);
        histEditing.delete(e.id);
        persist(); refresh();
      },
    }, '✕');
    wrap.appendChild(el('div', { class: 'vg-hist-head' }, [
      el('span', { class: 'vg-hist-type' }, meta.icon + ' ' + meta.label),
      dateInput,
      el('div', { class: 'spacer', style: 'flex:1;' }),
      vToggle,
      delBtn,
    ]));

    // Körper je Typ
    wrap.appendChild(histBody(v, e, persist, refresh));
    return wrap;
  }

  function histBody(v, e, persist, refresh) {
    if (e.typ === 'notiz') return notizBody(e, persist, refresh);
    if (e.typ === 'todo') return todoBody(v, e, persist, refresh);
    if (e.typ === 'kosten') return kostenBody(v, e, persist, refresh);
    if (e.typ === 'referenz') return referenzBody(v, e, persist);
    if (e.typ === 'dokument') return dokumentBody(v, e, persist);
    return el('div', { class: 'help' }, '(unbekannter Typ)');
  }

  // --- ToDo (in festem Vikunja-Projekt anlegen, Status zurückgespiegelt) ---
  function todoBody(v, e, persist, refresh) {
    const box = el('div', { class: 'vg-hist-body' });
    if (!e.vikunjaTaskId) { box.appendChild(todoDraft(v, e, persist, refresh)); }
    else { box.appendChild(todoLive(e, persist)); }
    return box;
  }

  // Entwurf: Titel/Fälligkeit/Priorität erfassen und in Vikunja anlegen.
  function todoDraft(v, e, persist, refresh) {
    const wrap = el('div', {});
    const titelI = el('input', { class: 'input', type: 'text', placeholder: 'Was ist zu tun?', value: e.titel || '', onChange: (ev) => { e.titel = ev.target.value; persist(); } });
    const dueI = el('input', { class: 'input', type: 'date', value: e.faellig || '', onChange: (ev) => { e.faellig = ev.target.value; persist(); } });
    const prioSel = el('select', { class: 'input', onChange: (ev) => { e.prioritaet = ev.target.value; persist(); } },
      PRIO_OPTS.map(([val, lbl]) => el('option', { value: val, selected: String(e.prioritaet || '') === val }, lbl)));

    // App-weit gewähltes Vikunja-Projekt; falls nicht gesetzt → Auswahl anbieten.
    const globalProjekt = store.getSettings().vikunjaProjektId;
    let projSel = null;
    if (!globalProjekt) {
      projSel = el('select', { class: 'input' }, [el('option', { value: '' }, 'Vikunja-Projekt lädt…')]);
      GR.api.listTaskProjects().then(res => {
        projSel.innerHTML = '';
        const projs = res.projects || [];
        if (!projs.length) { projSel.appendChild(el('option', { value: '' }, 'Keine Projekte gefunden')); return; }
        projSel.appendChild(el('option', { value: '' }, '– Projekt wählen –'));
        projs.forEach(p => projSel.appendChild(el('option', { value: String(p.id) }, p.title)));
      }).catch(() => { projSel.innerHTML = ''; projSel.appendChild(el('option', { value: '' }, 'Projekte nicht ladbar (Vikunja prüfen)')); });
    }

    const status = el('div', { class: 'help', style: 'margin-top:4px;' }, '');
    const createBtn = el('button', {
      class: 'btn-sm btn-primary', onClick: async () => {
        const titel = (titelI.value || '').trim();
        if (!titel) { status.textContent = 'Bitte einen Titel eingeben.'; return; }
        const projectId = globalProjekt || (projSel && projSel.value);
        if (!projectId) { status.textContent = 'Bitte ein Vikunja-Projekt wählen.'; return; }
        createBtn.disabled = true; status.textContent = 'Wird in Vikunja angelegt…';
        try {
          const t = await GR.api.createTask(projectId, { title: titel, dueDate: dueI.value || undefined, priority: e.prioritaet || undefined });
          e.titel = t.title || titel;
          e.vikunjaTaskId = t.id;
          e.erledigt = !!t.done;
          e.faellig = t.dueDate ? String(t.dueDate).slice(0, 10) : (dueI.value || '');
          e.prioritaet = t.priority || (e.prioritaet || '');
          // Erstmalig gewähltes Projekt app-weit als festes Projekt merken.
          if (!globalProjekt && projectId) {
            const s = store.getSettings();
            s.vikunjaProjektId = isNaN(Number(projectId)) ? projectId : Number(projectId);
            store.saveSettings(s);
          }
          persist(); toast('ToDo in Vikunja angelegt'); refresh();
        } catch (err) {
          createBtn.disabled = false;
          status.textContent = 'Vikunja-Fehler: ' + err.message;
        }
      },
    }, 'In Vikunja anlegen');

    wrap.appendChild(el('div', { class: 'vg-todo-form' }, [
      el('div', { class: 'vg-field vg-field-grow' }, [el('label', { class: 'vg-label' }, 'Titel'), titelI]),
      el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Fällig am'), dueI]),
      el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Priorität'), prioSel]),
    ]));
    if (projSel) wrap.appendChild(el('div', { class: 'vg-field', style: 'margin-top:8px;' }, [el('label', { class: 'vg-label' }, 'Vikunja-Projekt (einmalig, wird gemerkt)'), projSel]));
    wrap.appendChild(el('div', { style: 'margin-top:8px;' }, [createBtn]));
    wrap.appendChild(status);
    return wrap;
  }

  // Live-Zeile: Checkbox (Status aus Vikunja), Titel, Fälligkeit, Priorität.
  function todoLive(e, persist) {
    const row = el('div', { class: 'vg-todo-live' });
    const cb = el('input', { type: 'checkbox', checked: !!e.erledigt });
    const titleSpan = el('span', { class: 'vg-todo-title' + (e.erledigt ? ' vg-todo-done' : '') }, e.titel || '(ohne Titel)');
    const metaSpan = el('span', { class: 'vg-todo-meta' }, todoMetaText(e));
    const note = el('span', { class: 'help vg-todo-note' }, '');

    function reflect() {
      cb.checked = !!e.erledigt;
      titleSpan.textContent = e.titel || '(ohne Titel)';
      titleSpan.className = 'vg-todo-title' + (e.erledigt ? ' vg-todo-done' : '');
      metaSpan.textContent = todoMetaText(e);
    }

    cb.addEventListener('change', async () => {
      const want = cb.checked;
      cb.disabled = true;
      try {
        await GR.api.completeTask(e.vikunjaTaskId, want);
        e.erledigt = want; persist(); reflect();
      } catch (err) { cb.checked = !want; note.textContent = 'Vikunja-Fehler: ' + err.message; }
      finally { cb.disabled = false; }
    });

    // Live-Status aus Vikunja nachziehen (ohne Endlos-Refresh: nur bei Änderung).
    GR.api.getTask(e.vikunjaTaskId).then(t => {
      let changed = false;
      if (!!t.done !== !!e.erledigt) { e.erledigt = !!t.done; changed = true; }
      if (t.title && t.title !== e.titel) { e.titel = t.title; changed = true; }
      const due = t.dueDate ? String(t.dueDate).slice(0, 10) : '';
      if (due !== (e.faellig || '')) { e.faellig = due; changed = true; }
      const prio = typeof t.priority === 'number' ? t.priority : 0;
      if (String(prio || '') !== String(e.prioritaet || '')) { e.prioritaet = prio || ''; changed = true; }
      if (changed) { persist(); reflect(); }
    }).catch(() => { note.textContent = '(Status offline – zuletzt bekannter Stand)'; });

    row.appendChild(el('label', { class: 'vg-todo-check' }, [cb, titleSpan]));
    row.appendChild(metaSpan);
    row.appendChild(note);
    row.appendChild(el('div', { class: 'help vg-todo-hint' }, 'Titel/Fälligkeit ändern in der Aufgaben-Ansicht.'));
    return row;
  }

  function todoMetaText(e) {
    const parts = [];
    if (e.faellig) parts.push('fällig ' + formatDatum(e.faellig));
    if (e.prioritaet && PRIO_LABEL[e.prioritaet]) parts.push('Prio: ' + PRIO_LABEL[e.prioritaet]);
    return parts.join(' · ');
  }

  // --- Kosten (Rechnung/Quittung, verrechnet mit einer Haushaltsstelle) ---
  function kostenBody(v, e, persist, refresh) {
    const box = el('div', { class: 'vg-hist-body' });
    if (!Array.isArray(e.paperlessDocs)) e.paperlessDocs = [];
    const betragI = el('input', { class: 'input', type: 'number', step: '0.01', min: '0', value: e.betrag != null ? e.betrag : 0, onChange: (ev) => { e.betrag = ev.target.value === '' ? 0 : Number(ev.target.value); persist(); } });
    const beschrI = el('input', { class: 'input', type: 'text', placeholder: 'Beschreibung', value: e.beschreibung || '', onChange: (ev) => { e.beschreibung = ev.target.value; persist(); } });
    const haendlerI = el('input', { class: 'input', type: 'text', placeholder: 'Händler/Empfänger', value: e.haendler || '', onChange: (ev) => { e.haendler = ev.target.value; persist(); } });
    const belegI = el('input', { class: 'input', type: 'date', value: e.belegdatum || '', onChange: (ev) => { e.belegdatum = ev.target.value; persist(); } });

    // Kostenstelle: Auswahl aus den dem Projekt zugewiesenen Haushaltsstellen.
    const zugewiesen = (v.haushaltsstellen || []);
    let stelleField;
    if (zugewiesen.length === 0) {
      stelleField = el('div', { class: 'help' }, 'Keine Kostenstelle zugewiesen – oben unter „Budget / Kostenstelle" zuweisen.');
    } else {
      const stelleSel = el('select', {
        class: 'input', onChange: (ev) => { e.haushaltsstelleId = ev.target.value; persist(); refresh(); },
      }, [
        el('option', { value: '' }, '– Kostenstelle wählen –'),
        ...zugewiesen.map(id => { const h = store.getHaushaltsstelle(id); return el('option', { value: id, selected: e.haushaltsstelleId === id }, h ? ((h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)')) : '(unbekannt)'); }),
      ]);
      stelleField = el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Kostenstelle'), stelleSel]);
    }

    box.appendChild(el('div', { class: 'vg-kosten-form' }, [
      el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Betrag (€)'), betragI]),
      el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Belegdatum'), belegI]),
      stelleField,
      el('div', { class: 'vg-field vg-field-grow' }, [el('label', { class: 'vg-label' }, 'Beschreibung'), beschrI]),
      el('div', { class: 'vg-field vg-field-grow' }, [el('label', { class: 'vg-label' }, 'Händler/Empfänger'), haendlerI]),
    ]));
    box.appendChild(el('div', { class: 'vg-label', style: 'margin-top:8px;' }, 'Rechnung/Quittung (Paperless)'));
    box.appendChild(GR.ui.renderPaperlessDocsSection(e, () => persist(), { prefillTitle: (v.titel ? v.titel + ' – ' : '') + (e.beschreibung || 'Beleg'), emptyText: 'Beleg verknüpfen oder hochladen.' }));
    return box;
  }

  // --- Notiz (Markdown mit Vorschau/Bearbeiten) ---
  function notizBody(e, persist, refresh) {
    const box = el('div', { class: 'vg-hist-body' });
    if (histEditing.has(e.id)) {
      const ta = el('textarea', {
        class: 'input vg-md-input', rows: '4', placeholder: 'Notiz (Markdown: **fett**, - Liste, # Überschrift …)',
        onChange: (ev) => { e.textMd = ev.target.value; persist(); },
      });
      ta.value = e.textMd || '';
      const preview = el('div', { class: 'vg-md' });
      preview.innerHTML = mdRender(e.textMd || '');
      ta.addEventListener('input', () => { e.textMd = ta.value; preview.innerHTML = mdRender(ta.value); });
      const doneBtn = el('button', { class: 'btn-sm btn-primary', onClick: () => { e.textMd = ta.value; persist(); histEditing.delete(e.id); refresh(); } }, 'Fertig');
      box.appendChild(ta);
      box.appendChild(el('div', { class: 'vg-md-preview-label' }, 'Vorschau'));
      box.appendChild(preview);
      box.appendChild(el('div', { style: 'margin-top:6px;' }, [doneBtn]));
    } else {
      const rendered = el('div', { class: 'vg-md' });
      rendered.innerHTML = e.textMd ? mdRender(e.textMd) : '<span class="help">(leere Notiz)</span>';
      const editBtn = el('button', { class: 'btn-sm', onClick: () => { histEditing.add(e.id); refresh(); } }, 'Bearbeiten');
      box.appendChild(rendered);
      box.appendChild(el('div', { style: 'margin-top:6px;' }, [editBtn]));
    }
    return box;
  }

  // --- Referenz auf einen anderen Vorgang ---
  function referenzBody(v, e, persist) {
    const box = el('div', { class: 'vg-hist-body' });
    // Auswahl anderer sichtbarer Vorgänge (ohne den aktuellen)
    const kandidaten = roles.filterVorgaenge(store.listVorgaenge()).filter(x => x.id !== v.id);
    const sel = el('select', {
      class: 'input', onChange: (ev) => { e.refVorgangId = ev.target.value; persist(); },
    }, [
      el('option', { value: '' }, '– Vorgang wählen –'),
      ...kandidaten.map(x => el('option', { value: x.id, selected: e.refVorgangId === x.id }, x.titel || '(ohne Titel)')),
    ]);
    box.appendChild(el('div', { class: 'vg-ref-row' }, [sel]));

    // Verlinkung anzeigen, wenn gesetzt
    if (e.refVorgangId) {
      const target = store.getVorgang(e.refVorgangId);
      if (target && roles.canSeeVorgang(target)) {
        box.appendChild(el('div', { class: 'vg-ref-link' }, [
          statusBadge(target.status),
          el('a', { href: '#/vorgaenge?id=' + encodeURIComponent(target.id) }, '→ ' + (target.titel || '(ohne Titel)')),
        ]));
      } else {
        box.appendChild(el('div', { class: 'help' }, target ? '(vertraulicher Vorgang)' : '(Vorgang nicht gefunden)'));
      }
    }

    const notiz = el('input', {
      class: 'input', type: 'text', placeholder: 'Kontext zur Referenz (optional)', value: e.notiz || '',
      onChange: (ev) => { e.notiz = ev.target.value; persist(); },
    });
    box.appendChild(el('div', { style: 'margin-top:6px;' }, [notiz]));
    return box;
  }

  // --- Dokument-Verknüpfung (Paperless) ---
  function dokumentBody(v, e, persist) {
    const box = el('div', { class: 'vg-hist-body' });
    if (!Array.isArray(e.paperlessDocs)) e.paperlessDocs = [];
    box.appendChild(GR.ui.renderPaperlessDocsSection(e, () => persist(), {
      prefillTitle: v.titel || '',
      emptyText: 'Noch kein Dokument – verknüpfen oder hochladen.',
    }));
    return box;
  }

  // =================== Haushaltsplanung (geplanter Bedarf) ===================
  function renderPlanung(mount) {
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vorgaenge' }, '← Übersicht'),
      el('h1', { class: 'view-title', style: 'margin:0; font-size:1.3rem;' }, 'Haushaltsplanung'),
    ]));
    mount.appendChild(el('p', { class: 'help' }, 'Geplanter Bedarf aus Vorgängen, gruppiert nach Zieljahr. Grundlage für die Haushaltsberatung.'));

    // Nur sichtbare Vorgänge mit geplantem Betrag
    const mitPlan = roles.filterVorgaenge(store.listVorgaenge())
      .filter(v => v.planung && Number(v.planung.betrag) > 0);

    if (mitPlan.length === 0) {
      mount.appendChild(el('div', { class: 'card vg-empty' }, 'Kein geplanter Bedarf erfasst. Trage ihn im Vorgang unter „Budget / Kostenstelle" ein.'));
      return;
    }

    // nach Zieljahr gruppieren (leer = „ohne Jahr")
    const byYear = {};
    for (const v of mitPlan) {
      const y = (v.planung.zieljahr || '').toString().trim() || 'ohne Jahr';
      (byYear[y] = byYear[y] || []).push(v);
    }
    const years = Object.keys(byYear).sort((a, b) => (a === 'ohne Jahr' ? 1 : b === 'ohne Jahr' ? -1 : a.localeCompare(b)));

    let gesamt = 0;
    for (const y of years) {
      const rows = byYear[y].slice().sort((a, b) => Number(b.planung.betrag) - Number(a.planung.betrag));
      const summe = rows.reduce((s, v) => s + Number(v.planung.betrag), 0);
      gesamt += summe;
      const table = el('table', { class: 'vg-plan-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Vorgang'), el('th', {}, 'Status'), el('th', { style: 'text-align:right;' }, 'Geplant'),
        ])),
        el('tbody', {}, rows.map(v => el('tr', {}, [
          el('td', {}, [
            el('a', { href: '#/vorgaenge?id=' + encodeURIComponent(v.id) }, v.titel || '(ohne Titel)'),
            v.vertraulich ? el('span', { class: 'vg-lock', title: 'Vertraulich' }, ' 🔒') : null,
          ]),
          el('td', {}, STATUS_META[v.status] ? STATUS_META[v.status].label : v.status),
          el('td', { style: 'text-align:right;' }, eur(Number(v.planung.betrag))),
        ]))),
        el('tfoot', {}, el('tr', {}, [
          el('td', { colspan: '2' }, 'Summe ' + y),
          el('td', { style: 'text-align:right; font-weight:600;' }, eur(summe)),
        ])),
      ]);
      mount.appendChild(el('div', { class: 'card' }, [
        el('h3', {}, 'Zieljahr ' + y),
        table,
      ]));
    }

    mount.appendChild(el('div', { class: 'card vg-plan-total' }, [
      el('span', {}, 'Gesamter geplanter Bedarf'),
      el('span', { class: 'vg-plan-total-val' }, eur(gesamt)),
    ]));
  }

  // =================== Einstieg ===================
  function renderVorgaenge(mount, params) {
    if (params && params.view === 'planung') return renderPlanung(mount);
    if (params && params.id) return renderDetail(mount, params.id);
    return renderOverview(mount);
  }

  GR.views = GR.views || {};
  GR.views.renderVorgaenge = renderVorgaenge;
})();
