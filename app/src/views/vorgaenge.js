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
    foto: { label: 'Foto', icon: '📷' },
    angebot: { label: 'Angebot', icon: '🧾' },
    entscheidung: { label: 'Auswahl', icon: '⚖' },
    email: { label: 'E-Mail', icon: '✉' },
  };

  // Kleiner ID-Helfer für Matrix-Eigenschaften (models.uuid ist nicht exportiert).
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

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
      // async, seit Verlaufsfotos nachgeladen werden
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
      }).catch(err => { console.error(err); toast('PDF fehlgeschlagen: ' + err.message, 4000); });
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
        const arb = M.arbeitszeitenVerbrauch(store.listArbeitsabrechnungen(), id, v.haushaltsjahr);
        const gesamt = ausl + vorg + arb;
        const rest = budget != null ? budget - gesamt : null;
        return el('tr', { class: rest != null && rest < 0 ? 'vg-row-neg' : '' }, [
          el('td', {}, h ? ((h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)')) : '(unbekannt)'),
          el('td', { style: 'text-align:right;' }, eur(eigenAuf)),
          el('td', { style: 'text-align:right;' }, budget != null ? eur(budget) : '—'),
          el('td', { style: 'text-align:right;', title: 'Auslagen ' + eur(ausl) + ' · Vorgänge ' + eur(vorg) + ' · Arbeitszeiten ' + eur(arb) }, eur(gesamt)),
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

    // --- Vorliegende Angebote (Übersicht; günstigstes zuerst) ---
    const angebote = M.vorgangAngebote(v);
    if (angebote.length > 0) {
      const chosenIds = new Set((v.historie || []).filter(e => e.typ === 'entscheidung' && e.gewaehltId).map(e => e.gewaehltId));
      card.appendChild(el('div', { class: 'vg-label', style: 'margin-top:16px;' }, 'Vorliegende Angebote'));
      const alist = el('div', { class: 'vg-angebot-list' });
      angebote.slice()
        .sort((a, b) => (a.preis != null ? Number(a.preis) : Infinity) - (b.preis != null ? Number(b.preis) : Infinity))
        .forEach(a => {
          const chosen = chosenIds.has(a.id);
          const docs = Array.isArray(a.paperlessDocs) ? a.paperlessDocs.length : 0;
          alist.appendChild(el('div', { class: 'vg-angebot-item' + (chosen ? ' vg-angebot-chosen' : '') }, [
            el('div', { class: 'vg-angebot-main' }, [
              el('span', { class: 'vg-angebot-name' }, [
                document.createTextNode(a.anbieter || '(ohne Anbieter)'),
                chosen ? el('span', { class: 'vg-tag-chosen' }, ' ✓ gewählt') : null,
              ]),
              a.beschreibung ? el('span', { class: 'help', style: 'display:block;' }, a.beschreibung) : null,
            ]),
            docs ? el('span', { class: 'vg-angebot-docs help', title: docs + ' verknüpfte(r) Paperless-Beleg(e)' }, '📎 ' + docs) : null,
            el('span', { class: 'vg-angebot-preis' }, a.preis != null ? eur(a.preis) : '—'),
          ]));
        });
      card.appendChild(alist);
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

    // Anlegen läuft über EINEN Knopf; die Typwahl passiert im Overlay. Die
    // Zeitleiste bleibt damit Chronik statt Formularleiste.
    card.appendChild(el('div', { class: 'vg-addbar' }, [
      el('button', {
        class: 'btn-sm btn-primary',
        onClick: () => openEintragOverlay(v, null, persist, refresh),
      }, '+ Eintrag'),
    ]));

    // Zeitleiste (nur sichtbare Einträge; neueste zuerst nach Datum)
    const sichtbar = roles.visibleHistorie(v).slice()
      .sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));

    if (sichtbar.length === 0) {
      card.appendChild(el('div', { class: 'help vg-hist-empty' }, 'Noch keine Einträge. Lege oben den ersten an.'));
      return card;
    }

    const list = el('div', { class: 'vg-hist' });
    for (const e of sichtbar) list.appendChild(histEntry(v, e, persist, refresh));
    card.appendChild(list);
    return card;
  }

  // Zeitleisten-Karte: rein lesend. Klick öffnet das Bearbeiten-Overlay.
  // Ausnahmen sind zwei Schnellaktionen, die täglich gebraucht werden und
  // deshalb direkt in der Liste bleiben (Klasse `vg-hist-quick`): ToDo abhaken
  // und ein Foto groß ansehen.
  function histEntry(v, e, persist, refresh) {
    const meta = HIST_TYP_META[e.typ] || { label: e.typ, icon: '•' };
    const wrap = el('div', {
      class: 'vg-hist-entry vg-hist-card' + (e.vertraulich ? ' vg-hist-vertraulich' : ''),
      role: 'button', tabindex: '0',
      title: 'Zum Bearbeiten anklicken',
    });
    const oeffnen = () => openEintragOverlay(v, e, persist, refresh);
    wrap.addEventListener('click', (ev) => {
      if (ev.target.closest && ev.target.closest('.vg-hist-quick')) return;
      oeffnen();
    });
    wrap.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); oeffnen(); }
    });

    wrap.appendChild(el('div', { class: 'vg-hist-head' }, [
      el('span', { class: 'vg-hist-type' }, meta.icon + ' ' + meta.label),
      el('span', { class: 'vg-hist-datum' }, e.datum ? formatDatum(e.datum) : '(ohne Datum)'),
      el('div', { class: 'spacer', style: 'flex:1;' }),
      e.vertraulich ? el('span', { class: 'vg-hist-lock', title: 'Vertraulich – nur für die Leitung' }, '🔒') : null,
      el('span', { class: 'vg-hist-open help' }, 'Bearbeiten ›'),
    ].filter(Boolean)));

    wrap.appendChild(histSummary(v, e, persist, refresh));
    return wrap;
  }

  // --- Kurzfassung je Typ für die Zeitleiste (lesend) ---
  function histSummary(v, e, persist, refresh) {
    const box = el('div', { class: 'vg-hist-sum' });
    const leer = (t) => el('span', { class: 'help' }, t);

    if (e.typ === 'notiz') {
      const txt = String(e.textMd || '').replace(/[#*_>`-]/g, ' ').replace(/\s+/g, ' ').trim();
      box.appendChild(txt ? el('span', {}, txt.length > 220 ? txt.slice(0, 220) + ' …' : txt) : leer('(leere Notiz)'));

    } else if (e.typ === 'todo') {
      if (!e.vikunjaTaskId) {
        box.appendChild(leer(e.titel ? e.titel + ' – noch nicht in Vikunja angelegt' : '(ToDo noch nicht angelegt)'));
      } else {
        // Schnellaktion: abhaken ohne Umweg über das Overlay.
        const cb = el('input', { type: 'checkbox', class: 'vg-hist-quick', checked: !!e.erledigt });
        const titel = el('span', { class: 'vg-todo-title' + (e.erledigt ? ' vg-todo-done' : '') }, e.titel || '(ohne Titel)');
        const hinweis = el('span', { class: 'help' }, '');
        cb.addEventListener('change', async () => {
          const want = cb.checked;
          cb.disabled = true;
          try {
            await GR.api.completeTask(e.vikunjaTaskId, want);
            e.erledigt = want; persist();
            titel.className = 'vg-todo-title' + (want ? ' vg-todo-done' : '');
          } catch (err) { cb.checked = !want; hinweis.textContent = 'Vikunja-Fehler: ' + err.message; }
          finally { cb.disabled = false; }
        });
        box.appendChild(el('label', { class: 'vg-todo-check vg-hist-quick' }, [cb, titel]));
        const meta = todoMetaText(e);
        if (meta) box.appendChild(el('span', { class: 'vg-todo-meta' }, meta));
        box.appendChild(hinweis);
      }

    } else if (e.typ === 'kosten') {
      const teile = [el('strong', {}, eur(e.betrag || 0))];
      if (e.beschreibung) teile.push(el('span', {}, e.beschreibung));
      if (e.haendler) teile.push(el('span', { class: 'help' }, e.haendler));
      const h = e.haushaltsstelleId && store.getHaushaltsstelle(e.haushaltsstelleId);
      if (h) teile.push(el('span', { class: 'help' }, (h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '')));
      const docs = (e.paperlessDocs || []).length;
      if (docs) teile.push(el('span', { class: 'help' }, '📄 ' + docs));
      box.appendChild(el('div', { class: 'vg-hist-sum-row' }, teile));

    } else if (e.typ === 'referenz') {
      if (!e.refVorgangId) box.appendChild(leer('(kein Vorgang gewählt)'));
      else {
        const ziel = store.getVorgang(e.refVorgangId);
        if (ziel && roles.canSeeVorgang(ziel)) {
          box.appendChild(el('div', { class: 'vg-hist-sum-row' }, [
            statusBadge(ziel.status),
            el('span', {}, '→ ' + (ziel.titel || '(ohne Titel)')),
          ]));
        } else box.appendChild(leer(ziel ? '(vertraulicher Vorgang)' : '(Vorgang nicht gefunden)'));
      }
      if (e.notiz) box.appendChild(el('div', { class: 'help' }, e.notiz));

    } else if (e.typ === 'dokument') {
      const docs = (e.paperlessDocs || []);
      const zeile = [];
      if (e.titel) zeile.push(el('span', {}, e.titel));
      zeile.push(el('span', { class: 'help' }, docs.length ? '📄 ' + docs.length + ' Dokument(e)' : 'noch kein Dokument'));
      box.appendChild(el('div', { class: 'vg-hist-sum-row' }, zeile));

    } else if (e.typ === 'foto') {
      if (e.bildunterschrift) box.appendChild(el('div', {}, e.bildunterschrift));
      const fotos = store.listVorgangFotos(v.id).filter(f => f.kind === 'hist_' + e.id);
      if (!fotos.length) box.appendChild(leer('(noch kein Foto)'));
      else {
        // Schnellaktion: Foto groß ansehen, ohne das Overlay zu öffnen.
        box.appendChild(el('div', { class: 'vg-foto-grid vg-hist-quick' }, fotos.map(f =>
          el('a', { class: 'vg-foto', href: store.vorgangFotoUrl(f.id), target: '_blank', rel: 'noopener' },
            [el('img', { src: store.vorgangFotoUrl(f.id), alt: f.filename || 'Foto', loading: 'lazy' })]))));
      }

    } else if (e.typ === 'angebot') {
      const teile = [el('strong', {}, e.anbieter || '(ohne Anbieter)')];
      if (e.preis != null) teile.push(el('span', {}, eur(e.preis)));
      if (e.beschreibung) teile.push(el('span', { class: 'help' }, e.beschreibung));
      const docs = (e.paperlessDocs || []).length;
      if (docs) teile.push(el('span', { class: 'help' }, '📄 ' + docs));
      box.appendChild(el('div', { class: 'vg-hist-sum-row' }, teile));

    } else if (e.typ === 'email') {
      const raus = e.richtung === 'aus';
      const teile = [
        el('span', { class: 'mail-richtung' }, raus ? '↗ gesendet' : '↙ empfangen'),
        el('strong', {}, e.betreff || '(kein Betreff)'),
        el('span', { class: 'help' }, raus ? ('an ' + (e.an || '—')) : ('von ' + (e.von || '—'))),
      ];
      const docs = (e.paperlessDocs || []).length;
      if (docs) teile.push(el('span', { class: 'help' }, '📄 ' + docs));
      box.appendChild(el('div', { class: 'vg-hist-sum-row' }, teile));

    } else if (e.typ === 'entscheidung') {
      const anz = (e.teilnehmer || []).length;
      const teile = [el('span', {}, (e.titel || 'Entscheidungsmatrix') + ' · ' + anz + ' Anbieter')];
      if (M.entscheidungAbgeschlossen(e)) {
        const gew = (e.teilnehmer || []).find(t => t.angebotId === e.gewaehltId);
        teile.push(el('strong', {}, '✓ ' + (gew ? gew.name : 'gewählt')));
      } else if (anz) {
        const emp = (e.teilnehmer || []).find(t => t.angebotId === M.entscheidungGewinner(e));
        if (emp) teile.push(el('span', { class: 'help' }, 'Empfehlung: ' + emp.name));
      }
      box.appendChild(el('div', { class: 'vg-hist-sum-row' }, teile));

    } else {
      box.appendChild(leer('(unbekannter Typ)'));
    }
    return box;
  }

  // Frisch angelegte, aber nie befüllte Einträge sollen keine Karteileichen
  // hinterlassen, wenn das Overlay ohne Eingabe geschlossen wird.
  function istLeer(v, e) {
    const t = (s) => !String(s || '').trim();
    switch (e.typ) {
      case 'notiz': return t(e.textMd);
      case 'todo': return t(e.titel) && !e.vikunjaTaskId;
      case 'kosten': return !Number(e.betrag) && t(e.beschreibung) && t(e.haendler) && !(e.paperlessDocs || []).length;
      case 'referenz': return t(e.refVorgangId) && t(e.notiz);
      case 'dokument': return t(e.titel) && !(e.paperlessDocs || []).length;
      case 'foto': return t(e.bildunterschrift)
        && !store.listVorgangFotos(v.id).some(f => f.kind === 'hist_' + e.id);
      case 'angebot': return t(e.anbieter) && e.preis == null && t(e.beschreibung) && !(e.paperlessDocs || []).length;
      case 'entscheidung': return !(e.teilnehmer || []).length;
      case 'email': return t(e.betreff) && t(e.text) && t(e.von) && t(e.an);
      default: return false;
    }
  }

  // --- Overlay zum Anlegen und Bearbeiten eines Historieneintrags ---
  // `entry === null` startet mit der Typwahl.
  function openEintragOverlay(v, entry, persist, onClose) {
    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal vg-eintrag-modal' });
    overlay.appendChild(modal);

    let e = entry;
    let neu = false;

    function schliessen() {
      // Ohne jede Eingabe angelegte Einträge wieder entfernen.
      if (neu && e && istLeer(v, e)) {
        v.historie = v.historie.filter(x => x.id !== e.id);
        persist();
      }
      overlay.remove();
      if (onClose) onClose();
    }
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) schliessen(); });
    const onKey = (ev) => { if (ev.key === 'Escape') { document.removeEventListener('keydown', onKey); schliessen(); } };
    document.addEventListener('keydown', onKey);

    function waehleTyp(typ) {
      // Die Entscheidungsmatrix hat ihren eigenen Assistenten und legt den
      // Eintrag selbst an – hier nur weiterreichen.
      if (typ === 'entscheidung') {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        openAuswahlAssistent(v, null, persist, onClose);
        return;
      }
      // E-Mail wird nicht getippt, sondern aus dem Posteingang gewählt; das
      // Zuordnen-Overlay legt den Eintrag samt Anhängen an.
      if (typ === 'email') {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        if (!GR.mailUi) { toast('E-Mail-Modul nicht geladen.', 3000); if (onClose) onClose(); return; }
        GR.mailUi.openNachrichtenWahl((voll) => GR.mailUi.openZuordnen(voll, v.id));
        return;
      }
      const vorlagen = {
        notiz: { textMd: '' },
        todo: { titel: '', faellig: '', prioritaet: '', vikunjaTaskId: null, erledigt: false },
        foto: { bildunterschrift: '' },
        kosten: {
          betrag: 0, beschreibung: '', haendler: '', belegdatum: '', paperlessDocs: [],
          haushaltsstelleId: (v.haushaltsstellen && v.haushaltsstellen.length === 1 ? v.haushaltsstellen[0] : ''),
        },
        referenz: { refVorgangId: '', notiz: '' },
        dokument: { titel: '', paperlessDocs: [] },
        angebot: { anbieter: '', preis: null, beschreibung: '', paperlessDocs: [] },
      };
      e = Object.assign(M.emptyHistorieEintrag(typ), vorlagen[typ] || {});
      neu = true;
      v.historie.push(e);
      persist();
      render();
    }

    function renderTypwahl() {
      modal.appendChild(el('h3', {}, 'Neuer Eintrag'));
      modal.appendChild(el('p', { class: 'help' }, 'Was soll festgehalten werden?'));
      modal.appendChild(el('div', { class: 'vg-typwahl' }, Object.keys(HIST_TYP_META).map(typ => {
        const m = HIST_TYP_META[typ];
        return el('button', { class: 'vg-typ-btn', onClick: () => waehleTyp(typ) }, [
          el('span', { class: 'vg-typ-icon' }, m.icon),
          el('span', {}, m.label),
        ]);
      })));
      modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { onClick: schliessen }, 'Abbrechen'),
      ]));
    }

    function renderFormular() {
      const meta = HIST_TYP_META[e.typ] || { label: e.typ, icon: '•' };
      modal.appendChild(el('h3', {}, meta.icon + ' ' + meta.label));

      const dateInput = el('input', {
        type: 'date', class: 'input vg-hist-date', value: e.datum || '',
        onChange: (ev) => { e.datum = ev.target.value; persist(); },
      });
      const vToggle = el('label', { class: 'vg-hist-vtoggle', title: 'Vertraulich – nur für die Leitung' }, [
        el('input', {
          type: 'checkbox', checked: !!e.vertraulich,
          onChange: (ev) => { e.vertraulich = ev.target.checked; persist(); },
        }),
        el('span', {}, '🔒 Vertraulich'),
      ]);
      modal.appendChild(el('div', { class: 'vg-eintrag-kopf' }, [
        el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Datum'), dateInput]),
        vToggle,
      ]));

      modal.appendChild(histBody(v, e, persist, render));

      modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: schliessen }, 'Fertig'),
        el('div', { class: 'spacer', style: 'flex:1;' }),
        el('button', {
          class: 'btn-danger', onClick: () => {
            if (!confirmDialog('Diesen Historieneintrag löschen?')) return;
            v.historie = v.historie.filter(x => x.id !== e.id);
            persist();
            neu = false;
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            if (onClose) onClose();
          },
        }, 'Löschen'),
      ]));
    }

    function render() {
      modal.innerHTML = '';
      if (!e) renderTypwahl(); else renderFormular();
    }

    render();
    document.body.appendChild(overlay);
  }

  function histBody(v, e, persist, refresh) {
    if (e.typ === 'notiz') return notizBody(e, persist);
    if (e.typ === 'todo') return todoBody(v, e, persist, refresh);
    if (e.typ === 'kosten') return kostenBody(v, e, persist, refresh);
    if (e.typ === 'referenz') return referenzBody(v, e, persist);
    if (e.typ === 'dokument') return dokumentBody(v, e, persist);
    if (e.typ === 'foto') return fotoBody(v, e, persist, refresh);
    if (e.typ === 'angebot') return angebotBody(v, e, persist, refresh);
    if (e.typ === 'entscheidung') return entscheidungBody(v, e, persist, refresh);
    if (e.typ === 'email') return emailBody(v, e, persist, refresh);
    return el('div', { class: 'help' }, '(unbekannter Typ)');
  }

  // --- Foto (Kamera/Galerie wie in der Vermietung; Dateien in vorgang_files) ---
  // Fotos hängen über kind = 'hist_<eintragId>' am Eintrag.
  function fotoBody(v, e, persist, refresh) {
    const box = el('div', { class: 'vg-hist-body' });
    const kind = 'hist_' + e.id;
    const fotos = store.listVorgangFotos(v.id).filter(f => f.kind === kind);

    box.appendChild(el('input', {
      class: 'input', type: 'text', placeholder: 'Bildunterschrift (optional)',
      value: e.bildunterschrift || '',
      onChange: (ev) => { e.bildunterschrift = ev.target.value; persist(); },
    }));

    if (fotos.length) {
      box.appendChild(el('div', { class: 'vg-foto-grid' }, fotos.map(f => el('figure', { class: 'vg-foto' }, [
        el('a', { href: store.vorgangFotoUrl(f.id), target: '_blank', rel: 'noopener' },
          [el('img', { src: store.vorgangFotoUrl(f.id), alt: f.filename || 'Foto', loading: 'lazy' })]),
        el('button', {
          class: 'btn-sm btn-danger vg-foto-del', title: 'Foto löschen', onClick: async () => {
            if (!confirmDialog('Dieses Foto löschen?')) return;
            try { await store.deleteVorgangFoto(v.id, f.id); refresh(); }
            catch (err) { toast('Löschen fehlgeschlagen: ' + err.message, 4000); }
          },
        }, '✕'),
      ]))));
    }

    // Vorgänge müssen serverseitig existieren, bevor eine Datei anhängen kann.
    const onPick = async (file) => {
      try {
        toast('Foto wird hochgeladen …');
        const klein = await GR.ui.resizeImageFile(file);
        await store.uploadVorgangFoto(v.id, klein, kind);
        refresh();
      } catch (err) { toast('Upload fehlgeschlagen: ' + err.message, 4000); }
    };
    const pick = async (capture) => { const f = await GR.ui.pickFile('image/*', capture); if (f) onPick(f); };
    box.appendChild(el('div', { class: 'vg-foto-actions' }, [
      el('button', { class: 'btn-sm', onClick: () => pick('environment') }, '📷 Kamera'),
      el('button', { class: 'btn-sm', onClick: () => pick(null) }, '🖼 Galerie'),
    ]));
    return box;
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

  // --- Notiz (Markdown mit Live-Vorschau) ---
  // Läuft nur noch im Overlay, deshalb immer direkt bearbeitbar – der frühere
  // Umschalter „Bearbeiten/Fertig" entfällt, „Fertig" schließt das Overlay.
  function notizBody(e, persist) {
    const box = el('div', { class: 'vg-hist-body' });
    const ta = el('textarea', {
      class: 'input vg-md-input', rows: '6',
      placeholder: 'Notiz (Markdown: **fett**, - Liste, # Überschrift …)',
      onChange: (ev) => { e.textMd = ev.target.value; persist(); },
    });
    ta.value = e.textMd || '';
    const preview = el('div', { class: 'vg-md' });
    preview.innerHTML = mdRender(e.textMd || '');
    ta.addEventListener('input', () => { e.textMd = ta.value; preview.innerHTML = mdRender(ta.value); });
    box.appendChild(ta);
    box.appendChild(el('div', { class: 'vg-md-preview-label' }, 'Vorschau'));
    box.appendChild(preview);
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

  // --- E-Mail (aus dem Postfach zugeordnet) ---
  // Der Text ist eine Kopie und bleibt deshalb unveränderlich – die Akte soll
  // wiedergeben, was tatsächlich geschrieben wurde. Bearbeitbar sind nur Datum,
  // Vertraulich und die verknüpften Dokumente.
  function emailBody(v, e, persist, refresh) {
    const box = el('div', { class: 'vg-hist-body' });
    if (!Array.isArray(e.paperlessDocs)) e.paperlessDocs = [];
    const raus = e.richtung === 'aus';

    box.appendChild(el('div', { class: 'mail-kopf' }, [
      el('div', {}, [el('span', { class: 'mail-label' }, 'Richtung'),
        el('span', {}, raus ? '↗ aus der App gesendet' : '↙ empfangen')]),
      el('div', {}, [el('span', { class: 'mail-label' }, raus ? 'An' : 'Von'),
        el('span', {}, (raus ? e.an : e.von) || '—')]),
      e.cc ? el('div', {}, [el('span', { class: 'mail-label' }, 'Kopie'), el('span', {}, e.cc)]) : null,
      el('div', {}, [el('span', { class: 'mail-label' }, 'Betreff'), el('span', {}, e.betreff || '—')]),
    ].filter(Boolean)));

    box.appendChild(el('pre', { class: 'mail-text' }, e.text || '(kein Textinhalt)'));

    // Antworten geht nur auf empfangene Nachrichten und nur, wenn das
    // E-Mail-Modul geladen ist.
    if (!raus && GR.mailUi) {
      box.appendChild(el('div', { class: 'toolbar', style: 'margin:8px 0 0;' }, [
        el('button', {
          class: 'btn-sm', onClick: () => {
            GR.mailUi.openAntwort({
              betreff: e.betreff, von: e.von, vonListe: [], datum: e.datum,
              text: e.text, messageId: e.messageId, references: e.references || [],
            }, v, refresh);
          },
        }, '↩ Antworten'),
      ]));
    }

    box.appendChild(el('div', { class: 'vg-label', style: 'margin-top:10px;' }, 'Anhänge / Dokumente (Paperless)'));
    box.appendChild(GR.ui.renderPaperlessDocsSection(e, () => persist(), {
      prefillTitle: (v.titel ? v.titel + ' – ' : '') + (e.betreff || 'E-Mail'),
      emptyText: 'Kein Dokument verknüpft.',
    }));
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

  // =================== Angebote & Entscheidungsmatrix ===================
  // Punktzahl (kann durch Gewichte gebrochen sein) hübsch mit Komma.
  function fmtPts(n) {
    const x = Math.round((Number(n) || 0) * 10) / 10;
    return String(x).replace('.', ',');
  }

  // --- Angebot: Anbieter, Preis, Beschreibung + Paperless-Beleg ---
  function angebotBody(v, e, persist, refresh) {
    const box = el('div', { class: 'vg-hist-body' });
    if (!Array.isArray(e.paperlessDocs)) e.paperlessDocs = [];
    const anbieterI = el('input', { class: 'input', type: 'text', placeholder: 'Anbieter/Firma', value: e.anbieter || '', onChange: (ev) => { e.anbieter = ev.target.value; persist(); refresh(); } });
    const preisI = el('input', { class: 'input', type: 'number', step: '0.01', min: '0', placeholder: '0,00', value: e.preis != null ? e.preis : '', onChange: (ev) => { e.preis = ev.target.value === '' ? null : Number(ev.target.value); persist(); refresh(); } });
    const beschrI = el('input', { class: 'input', type: 'text', placeholder: 'Leistung/Beschreibung', value: e.beschreibung || '', onChange: (ev) => { e.beschreibung = ev.target.value; persist(); } });
    box.appendChild(el('div', { class: 'vg-kosten-form' }, [
      el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Anbieter/Firma'), anbieterI]),
      el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Angebotspreis (€)'), preisI]),
      el('div', { class: 'vg-field vg-field-grow' }, [el('label', { class: 'vg-label' }, 'Beschreibung'), beschrI]),
    ]));
    box.appendChild(el('div', { class: 'vg-label', style: 'margin-top:8px;' }, 'Angebot (Paperless)'));
    box.appendChild(GR.ui.renderPaperlessDocsSection(e, () => persist(), {
      prefillTitle: (v.titel ? v.titel + ' – ' : '') + 'Angebot ' + (e.anbieter || ''),
      emptyText: 'Angebot verknüpfen oder hochladen.',
    }));
    return box;
  }

  // --- Anzeige-Tabelle einer Entscheidungsmatrix (read-only) ---
  function matrixTable(e, gewinnerId) {
    const head = el('tr', {}, [
      el('th', {}, 'Anbieter'),
      ...e.eigenschaften.map(eig => {
        const gw = Number(eig.gewicht);
        return el('th', { class: 'vg-matrix-crit' }, eig.name + (gw !== 1 ? ' (×' + fmtPts(eig.gewicht) + ')' : ''));
      }),
      el('th', { style: 'text-align:right;' }, 'Preis'),
      el('th', { style: 'text-align:right;' }, 'Summe'),
    ]);
    const rows = e.teilnehmer.map(t => {
      const zeile = (e.bewertung && e.bewertung[t.angebotId]) || {};
      const isChosen = t.angebotId === e.gewaehltId;
      const isWin = t.angebotId === gewinnerId;
      return el('tr', { class: isChosen ? 'vg-matrix-chosen' : (isWin ? 'vg-matrix-win' : '') }, [
        el('td', {}, [
          document.createTextNode(t.name || '(ohne Anbieter)'),
          isChosen ? el('span', { class: 'vg-tag-chosen' }, ' ✓ gewählt') : (isWin ? el('span', { class: 'vg-tag-win' }, ' ★') : null),
        ]),
        ...e.eigenschaften.map(eig => { const p = zeile[eig.id]; return el('td', { style: 'text-align:center;' }, p != null ? String(p) : '–'); }),
        el('td', { style: 'text-align:right;' }, t.preis != null ? eur(t.preis) : '—'),
        el('td', { style: 'text-align:right; font-weight:600;' }, fmtPts(M.entscheidungScore(e, t.angebotId))),
      ]);
    });
    return el('div', { class: 'vg-matrix-wrap' }, [
      el('table', { class: 'vg-matrix' }, [el('thead', {}, head), el('tbody', {}, rows)]),
    ]);
  }

  // --- Entscheidungs-Eintrag (Auswahlprozess) ---
  function entscheidungBody(v, e, persist, refresh) {
    const box = el('div', { class: 'vg-hist-body' });
    if (!Array.isArray(e.teilnehmer)) e.teilnehmer = [];
    if (!Array.isArray(e.eigenschaften)) e.eigenschaften = [];
    if (!e.bewertung) e.bewertung = {};
    if (!Array.isArray(e.paperlessDocs)) e.paperlessDocs = [];

    const titelI = el('input', { class: 'input', type: 'text', placeholder: 'Titel des Auswahlprozesses (optional)', value: e.titel || '', onChange: (ev) => { e.titel = ev.target.value; persist(); } });
    box.appendChild(el('div', { class: 'vg-field', style: 'margin-bottom:10px;' }, [el('label', { class: 'vg-label' }, 'Titel'), titelI]));

    if (e.teilnehmer.length === 0 || e.eigenschaften.length === 0) {
      box.appendChild(el('p', { class: 'help' }, 'Noch keine vollständige Matrix. Lege über „Matrix bearbeiten" die Anbieter und Vergleichseigenschaften fest.'));
      box.appendChild(el('div', { class: 'vg-hist-actions' }, [
        el('button', { class: 'btn-sm btn-primary', onClick: () => openAuswahlAssistent(v, e, persist, refresh) }, '⚙ Matrix bearbeiten'),
      ]));
      return box;
    }

    const gewinnerId = M.entscheidungGewinner(e);
    box.appendChild(matrixTable(e, gewinnerId));

    const gWin = e.teilnehmer.find(t => t.angebotId === gewinnerId);
    if (gWin) {
      const max = M.entscheidungMaxScore(e);
      const sc = M.entscheidungScore(e, gewinnerId);
      box.appendChild(el('div', { class: 'vg-empfehlung' }, '★ Empfehlung (höchste Punktzahl): ' + (gWin.name || '(ohne Anbieter)') + ' – ' + fmtPts(sc) + (max ? ' / ' + fmtPts(max) : '') + ' Punkte'));
    }

    box.appendChild(el('div', { class: 'vg-hist-actions' }, [
      el('button', { class: 'btn-sm btn-primary', onClick: () => openBewertungOverlay(v, e, persist, refresh) }, '✎ Punkte eintragen/bearbeiten'),
      el('button', { class: 'btn-sm', onClick: () => openAuswahlAssistent(v, e, persist, refresh) }, '⚙ Matrix bearbeiten'),
    ]));

    // Finale Auswahl + Begründung
    const sel = el('select', { class: 'input', onChange: (ev) => { e.gewaehltId = ev.target.value || null; persist(); refresh(); } }, [
      el('option', { value: '' }, '– noch offen –'),
      ...e.teilnehmer.map(t => el('option', { value: t.angebotId, selected: e.gewaehltId === t.angebotId }, (t.name || '(ohne Anbieter)') + (t.angebotId === gewinnerId ? ' (Empfehlung)' : ''))),
    ]);
    const begr = el('textarea', { class: 'input', rows: '3', placeholder: 'Warum wurde dieser Anbieter gewählt?', onChange: (ev) => { e.begruendung = ev.target.value; persist(); refresh(); } });
    begr.value = e.begruendung || '';
    box.appendChild(el('div', { class: 'vg-entsch-final' }, [
      el('label', { class: 'vg-label' }, 'Gewählter Anbieter'), sel,
      el('label', { class: 'vg-label', style: 'margin-top:8px;' }, 'Begründung'), begr,
    ]));

    // PDF-Export – erst wenn abgeschlossen (Anbieter + Begründung)
    if (M.entscheidungAbgeschlossen(e)) {
      const docsSection = GR.ui.renderPaperlessDocsSection(e, () => persist(), { showAdd: false, emptyText: 'Noch nicht in Paperless abgelegt.' });
      const pdfErr = (err) => { console.error(err); toast('PDF fehlgeschlagen: ' + err.message, 4000); };
      box.appendChild(el('div', { class: 'vg-label', style: 'margin-top:12px;' }, 'Matrix als PDF'));
      box.appendChild(el('div', { class: 'vg-hist-actions' }, [
        el('button', { class: 'btn-sm', onClick: () => GR.vorgaengePdf.buildEntscheidungPdf(v, e).catch(pdfErr) }, '📄 Matrix-PDF'),
        el('button', { class: 'btn-sm', onClick: () => GR.vorgaengePdf.buildEntscheidungPdf(v, e, { target: 'paperless', onUploaded: (doc) => docsSection.linkDoc(doc) }).catch(pdfErr) }, '📥 In Paperless speichern'),
      ]));
      box.appendChild(docsSection);
    } else {
      box.appendChild(el('p', { class: 'help', style: 'margin-top:10px;' }, 'PDF-Export möglich, sobald ein Anbieter gewählt und eine Begründung eingetragen ist.'));
    }
    return box;
  }

  // --- 0–5-Punktewähler mit Klartext-Skala ---
  function scoreSelector(e, angebotId, eig, persist, rerender) {
    if (!e.bewertung[angebotId]) e.bewertung[angebotId] = {};
    const zeile = e.bewertung[angebotId];
    const cur = zeile[eig.id];
    const btns = el('div', { class: 'vg-score' });
    for (let n = M.SCORE_MIN; n <= M.SCORE_MAX; n++) {
      const active = Number(cur) === n;
      btns.appendChild(el('button', {
        class: 'vg-score-btn' + (active ? ' active' : ''), type: 'button',
        title: n + ' – ' + (M.SCORE_LABEL[n] || ''),
        onClick: () => { zeile[eig.id] = n; persist(); rerender(); },
      }, String(n)));
    }
    const cap = el('span', { class: 'vg-score-cap' }, (cur != null && M.SCORE_LABEL[cur] != null) ? (cur + ' – ' + M.SCORE_LABEL[cur]) : 'noch nicht bewertet');
    return el('div', { class: 'vg-score-row' }, [btns, cap]);
  }

  // --- Geführtes Overlay: Anbieter wählen + Eigenschaften festlegen ---
  // entry === null: neuen Auswahl-Eintrag anlegen; sonst bestehenden bearbeiten.
  function openAuswahlAssistent(v, entry, persist, onDone) {
    const angebote = M.vorgangAngebote(v);
    if (angebote.length === 0) { toast('Lege zuerst mindestens ein Angebot an.', 3000); return; }

    const selected = new Set();
    if (entry && Array.isArray(entry.teilnehmer) && entry.teilnehmer.length) {
      entry.teilnehmer.forEach(t => { if (angebote.some(a => a.id === t.angebotId)) selected.add(t.angebotId); });
    } else {
      angebote.forEach(a => selected.add(a.id));
    }
    let eigs = (entry && Array.isArray(entry.eigenschaften) && entry.eigenschaften.length)
      ? entry.eigenschaften.map(x => ({ id: x.id, name: x.name, gewicht: x.gewicht != null ? x.gewicht : 1 }))
      : [{ id: uid(), name: '', gewicht: 1 }];

    let step = 1;
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    const modal = el('div', { class: 'modal vg-wiz' });
    overlay.appendChild(modal);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });

    function render() {
      modal.innerHTML = '';
      modal.appendChild(el('div', { class: 'vg-wiz-steps' }, [
        el('span', { class: 'vg-wiz-step' + (step === 1 ? ' active' : '') }, '1 · Anbieter'),
        el('span', { class: 'vg-wiz-step' + (step === 2 ? ' active' : '') }, '2 · Eigenschaften'),
      ]));
      if (step === 1) renderStep1(); else renderStep2();
    }

    function renderStep1() {
      modal.appendChild(el('h3', {}, entry ? 'Auswahl bearbeiten – Anbieter' : 'Auswahlprozess – Anbieter wählen'));
      modal.appendChild(el('p', { class: 'help' }, 'Wähle die Angebote, die verglichen werden sollen. Jedes angehakte Angebot wird eine Zeile der Matrix.'));
      const list = el('div', { class: 'vg-wiz-list' });
      angebote.forEach(a => {
        const cb = el('input', { type: 'checkbox', checked: selected.has(a.id), onChange: (ev) => { if (ev.target.checked) selected.add(a.id); else selected.delete(a.id); } });
        list.appendChild(el('label', { class: 'vg-wiz-check' }, [
          cb,
          el('span', { class: 'vg-wiz-check-main' }, [
            el('strong', {}, a.anbieter || '(ohne Anbieter)'),
            a.preis != null ? el('span', { class: 'vg-wiz-preis' }, eur(a.preis)) : null,
            a.beschreibung ? el('span', { class: 'help', style: 'display:block; margin-top:2px;' }, a.beschreibung) : null,
          ]),
        ]));
      });
      modal.appendChild(list);
      modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: () => { if (selected.size === 0) return toast('Bitte mindestens einen Anbieter wählen'); step = 2; render(); } }, 'Weiter →'),
        el('button', { onClick: close }, 'Abbrechen'),
      ]));
    }

    function renderStep2() {
      modal.appendChild(el('h3', {}, 'Vergleichseigenschaften'));
      modal.appendChild(el('p', { class: 'help' }, 'Lege die Kriterien fest, nach denen bewertet wird. Das Gewicht (Standard 1) erhöht den Einfluss einer Eigenschaft.'));
      const list = el('div', { class: 'vg-wiz-eigs' });
      function drawEigs() {
        list.innerHTML = '';
        eigs.forEach((eig, i) => {
          const nameI = el('input', { class: 'input', type: 'text', placeholder: 'Eigenschaft (z. B. Preis-Leistung, Lieferzeit, Referenzen …)', value: eig.name || '', onChange: (ev) => { eig.name = ev.target.value; } });
          const gI = el('input', { class: 'input vg-eig-gewicht', type: 'number', step: '0.5', min: '0', value: eig.gewicht != null ? eig.gewicht : 1, onChange: (ev) => { eig.gewicht = ev.target.value === '' ? 1 : Number(ev.target.value); } });
          const rm = el('button', { class: 'btn-sm btn-danger', title: 'Eigenschaft entfernen', onClick: () => { eigs.splice(i, 1); if (eigs.length === 0) eigs.push({ id: uid(), name: '', gewicht: 1 }); drawEigs(); } }, '✕');
          list.appendChild(el('div', { class: 'vg-eig-row' }, [
            el('div', { class: 'vg-field vg-field-grow' }, [nameI]),
            el('div', { class: 'vg-field vg-eig-gewicht-field' }, [el('label', { class: 'vg-label' }, 'Gewicht'), gI]),
            rm,
          ]));
        });
      }
      drawEigs();
      modal.appendChild(list);
      modal.appendChild(el('button', { class: 'btn-sm', style: 'margin-top:8px;', onClick: () => { eigs.push({ id: uid(), name: '', gewicht: 1 }); drawEigs(); } }, '+ Eigenschaft'));
      modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { onClick: () => { step = 1; render(); } }, '← Zurück'),
        el('button', { class: 'btn-primary', onClick: finish }, entry ? 'Übernehmen' : 'Matrix anlegen'),
        el('button', { onClick: close }, 'Abbrechen'),
      ]));
    }

    function finish() {
      const cleanEigs = eigs.filter(x => String(x.name || '').trim()).map(x => ({ id: x.id, name: x.name.trim(), gewicht: (x.gewicht != null && !isNaN(Number(x.gewicht))) ? Number(x.gewicht) : 1 }));
      if (selected.size === 0) return toast('Bitte mindestens einen Anbieter wählen');
      if (cleanEigs.length === 0) return toast('Bitte mindestens eine Eigenschaft angeben');
      const teilnehmer = angebote.filter(a => selected.has(a.id)).map(a => ({ angebotId: a.id, name: a.anbieter || '(ohne Anbieter)', preis: a.preis != null ? a.preis : null }));

      const target = entry || Object.assign(M.emptyHistorieEintrag('entscheidung'), { titel: '', teilnehmer: [], eigenschaften: [], bewertung: {}, gewaehltId: null, begruendung: '', paperlessDocs: [] });
      const oldBew = target.bewertung || {};
      const newBew = {};
      for (const t of teilnehmer) {
        const oldRow = oldBew[t.angebotId] || {};
        const row = {};
        for (const eig of cleanEigs) { if (oldRow[eig.id] != null) row[eig.id] = oldRow[eig.id]; }
        newBew[t.angebotId] = row;
      }
      target.teilnehmer = teilnehmer;
      target.eigenschaften = cleanEigs;
      target.bewertung = newBew;
      if (target.gewaehltId && !teilnehmer.some(t => t.angebotId === target.gewaehltId)) target.gewaehltId = null;

      if (!entry) v.historie.push(target);
      persist();
      close();
      if (onDone) onDone();
    }

    render();
    document.body.appendChild(overlay);
  }

  // --- Bewertungs-Overlay: Punkte je Anbieter nacheinander, dann Auswertung ---
  function openBewertungOverlay(v, e, persist, onDone) {
    if (!Array.isArray(e.teilnehmer) || e.teilnehmer.length === 0 || !Array.isArray(e.eigenschaften) || e.eigenschaften.length === 0) {
      toast('Erst Anbieter und Eigenschaften festlegen (Matrix bearbeiten).', 3500); return;
    }
    if (!e.bewertung) e.bewertung = {};
    const N = e.teilnehmer.length;
    let idx = 0; // 0..N-1 = Anbieter; N = Auswertung
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    const modal = el('div', { class: 'modal vg-bewert' });
    overlay.appendChild(modal);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });

    function render() { modal.innerHTML = ''; if (idx < N) renderProvider(); else renderSummary(); }

    function renderProvider() {
      const t = e.teilnehmer[idx];
      modal.appendChild(el('div', { class: 'vg-wiz-steps' }, [el('span', { class: 'vg-wiz-step active' }, 'Anbieter ' + (idx + 1) + ' / ' + N)]));
      modal.appendChild(el('h3', {}, (t.name || '(ohne Anbieter)') + (t.preis != null ? ' – ' + eur(t.preis) : '')));
      modal.appendChild(el('p', { class: 'help' }, 'Bewerte jede Eigenschaft: 0 = trifft nicht zu … 5 = trifft voll zu.'));
      const listBox = el('div', { class: 'vg-bewert-list' });
      e.eigenschaften.forEach(eig => {
        const gw = Number(eig.gewicht);
        listBox.appendChild(el('div', { class: 'vg-bewert-item' }, [
          el('div', { class: 'vg-bewert-crit' }, eig.name + (gw !== 1 ? ' (×' + fmtPts(eig.gewicht) + ')' : '')),
          scoreSelector(e, t.angebotId, eig, persist, render),
        ]));
      });
      modal.appendChild(listBox);
      modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        idx > 0 ? el('button', { onClick: () => { idx--; render(); } }, '← Zurück') : null,
        el('button', { class: 'btn-primary', onClick: () => { idx++; render(); } }, idx < N - 1 ? 'Weiter →' : 'Zur Auswertung →'),
        el('button', { onClick: close }, 'Schließen'),
      ]));
    }

    function renderSummary() {
      modal.appendChild(el('div', { class: 'vg-wiz-steps' }, [el('span', { class: 'vg-wiz-step active' }, 'Auswertung')]));
      modal.appendChild(el('h3', {}, 'Auswertung & Auswahl'));
      const gewinnerId = M.entscheidungGewinner(e);
      const max = M.entscheidungMaxScore(e);
      const ranked = e.teilnehmer.slice().sort((a, b) => M.entscheidungScore(e, b.angebotId) - M.entscheidungScore(e, a.angebotId));
      const rank = el('div', { class: 'vg-rank' });
      ranked.forEach((t, i) => {
        const sc = M.entscheidungScore(e, t.angebotId);
        rank.appendChild(el('div', { class: 'vg-rank-row' + (t.angebotId === gewinnerId ? ' vg-rank-win' : '') }, [
          el('span', { class: 'vg-rank-pos' }, (i + 1) + '.'),
          el('span', { class: 'vg-rank-name' }, t.name || '(ohne Anbieter)'),
          el('span', { class: 'vg-rank-score' }, fmtPts(sc) + (max ? ' / ' + fmtPts(max) : '') + ' Pkt'),
        ]));
      });
      modal.appendChild(rank);

      const sel = el('select', { class: 'input', onChange: (ev) => { e.gewaehltId = ev.target.value || null; persist(); } }, [
        el('option', { value: '' }, '– Anbieter wählen –'),
        ...e.teilnehmer.map(t => el('option', { value: t.angebotId, selected: e.gewaehltId === t.angebotId }, (t.name || '(ohne Anbieter)') + (t.angebotId === gewinnerId ? ' (Empfehlung)' : ''))),
      ]);
      const begr = el('textarea', { class: 'input', rows: '3', placeholder: 'Warum wurde dieser Anbieter gewählt?', onChange: (ev) => { e.begruendung = ev.target.value; persist(); } });
      begr.value = e.begruendung || '';
      modal.appendChild(el('div', { style: 'margin-top:12px;' }, [el('label', { class: 'vg-label' }, 'Gewählter Anbieter'), sel]));
      modal.appendChild(el('div', { style: 'margin-top:8px;' }, [el('label', { class: 'vg-label' }, 'Begründung'), begr]));

      modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { onClick: () => { idx = N - 1; render(); } }, '← Zurück'),
        el('button', { class: 'btn-primary', onClick: () => { persist(); close(); if (onDone) onDone(); } }, 'Fertig'),
      ]));
    }

    render();
    document.body.appendChild(overlay);
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
