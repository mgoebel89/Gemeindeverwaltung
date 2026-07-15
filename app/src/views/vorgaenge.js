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

    // Kopf-Toolbar
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vorgaenge' }, '← Übersicht'),
      el('div', { class: 'spacer' }),
      roleChip(refresh),
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

    // Platzhalter: Budget (Phase 3) und Historie (Phase 2) – als Ausblick sichtbar.
    mount.appendChild(el('div', { class: 'card vg-placeholder' }, [
      el('h3', {}, 'Budget / Kostenstelle'),
      el('p', { class: 'muted' }, 'Kommt in Phase 3: Haushaltsstelle zuordnen, geplanten Bedarf erfassen und Restmittel im Blick behalten.'),
    ]));
    mount.appendChild(buildHistorie(v, persist, refresh));
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
    if (e.typ === 'referenz') return referenzBody(v, e, persist);
    if (e.typ === 'dokument') return dokumentBody(v, e, persist);
    return el('div', { class: 'help' }, '(unbekannter Typ)');
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

  function eur(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }

  // =================== Einstieg ===================
  function renderVorgaenge(mount, params) {
    if (params && params.id) return renderDetail(mount, params.id);
    return renderOverview(mount);
  }

  GR.views = GR.views || {};
  GR.views.renderVorgaenge = renderVorgaenge;
})();
