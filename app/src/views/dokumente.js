(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast, confirmDialog } = GR.ui;
  const api = GR.api;
  const store = GR.store;

  const PAGE_SIZE = 30;
  const LAYOUT_KEY = 'gr.docLayout';

  const SORTS = [
    { key: '-created', label: 'Neueste zuerst' },
    { key: 'created', label: 'Älteste zuerst' },
    { key: 'title', label: 'Titel A–Z' },
    { key: '-added', label: 'Zuletzt hinzugefügt' },
  ];

  const emptyFilters = () => ({ query: '', correspondent: '', document_type: '', tags: [], created_gte: '', created_lte: '' });

  // Modul-State (lebt über Re-Renders der Teilbereiche hinweg).
  const state = {
    meta: { tags: [], correspondents: [], documentTypes: [], customFields: [] },
    filters: emptyFilters(),
    sort: '-created',
    layout: (localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'tiles'),
    page: 1,
    items: [],
    count: 0,
    hasMore: false,
    activeViewId: 'all',
    loading: false,
    _els: {},
    _detailTab: 'preview',
  };

  const byId = (list, id) => (list || []).find(x => String(x.id) === String(id)) || null;
  const nameOf = (list, id) => { const x = byId(list, id); return x ? x.name : ''; };
  const clone = o => JSON.parse(JSON.stringify(o));

  function fmtDate(iso) {
    if (!iso) return '';
    const d = String(iso).slice(0, 10).split('-');
    return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso;
  }
  const isoDate = iso => (iso ? String(iso).slice(0, 10) : '');

  // Lesbare Textfarbe (schwarz/weiß) zu einer Tag-Hintergrundfarbe.
  function readableOn(hex) {
    if (!hex) return '#fff';
    const c = String(hex).replace('#', '');
    if (c.length < 6) return '#fff';
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#222' : '#fff';
  }

  // ---------- Gespeicherte Ansichten (serverseitig in settings.docViews) ----------
  function loadViews() {
    const s = store.getSettings();
    return Array.isArray(s.docViews) ? s.docViews : [];
  }
  function persistViews(views) {
    const s = store.getSettings();
    s.docViews = views;
    store.saveSettings(s);
  }
  function newViewId() {
    return (crypto.randomUUID && crypto.randomUUID()) || ('v-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  }
  function currentSnapshot() { return { filters: clone(state.filters), sort: state.sort }; }
  function viewMatchesCurrent(v) {
    return JSON.stringify({ filters: v.filters, sort: v.sort || '-created' }) === JSON.stringify(currentSnapshot());
  }

  // ---------- Haupt-Render ----------
  function renderDokumente(mount) {
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-primary', onClick: () => GR.ui.uploadPaperlessDocument({ onUploaded: () => reload() }) }, '＋ Dokument hochladen'),
    ]));
    mount.appendChild(el('h2', {}, 'Dokumente'));
    mount.appendChild(el('p', { class: 'help' }, 'Dokumente aus Paperless-ngx durchsuchen, hochladen und Metadaten bearbeiten.'));

    const chips = el('div', {});
    const toolbar = el('div', {});
    const gallery = el('div', { class: 'card doc-gallery-card', style: 'padding:0;' }, el('div', { class: 'empty' }, 'Lade…'));
    state._els = { chips, toolbar, gallery };

    mount.appendChild(chips);
    mount.appendChild(toolbar);
    mount.appendChild(gallery);

    renderChips();
    renderToolbar();
    loadMetaThenSearch();
  }

  async function loadMetaThenSearch() {
    try {
      const h = await api.docHealth();
      if (!h || h.ok !== true) throw new Error(h && h.error ? h.error : 'Paperless nicht verbunden');
    } catch (e) {
      state._els.gallery.innerHTML = '';
      state._els.gallery.appendChild(el('div', { class: 'empty' }, [
        el('p', {}, '⚠ Paperless nicht erreichbar.'),
        el('p', { class: 'help' }, e.message),
        el('p', { class: 'help' }, 'Zugang unter Einstellungen → Dokumente prüfen (URL + Token).'),
      ]));
      return;
    }
    try {
      state.meta = await api.docMeta();
      renderToolbar();
    } catch (e) {
      toast('Filter konnten nicht geladen werden: ' + e.message);
    }
    reload();
  }

  // ---------- Ansichten-Chips ----------
  function renderChips() {
    const wrap = state._els.chips;
    wrap.innerHTML = '';
    const views = loadViews();

    const row = el('div', { class: 'doc-chips' });
    row.appendChild(chip({ id: 'all', name: 'Alle' }, state.activeViewId === 'all'));
    for (const v of views) row.appendChild(chip(v, state.activeViewId === v.id));
    row.appendChild(el('button', { class: 'doc-chip doc-chip-add', title: 'Aktuelle Filter als Ansicht speichern', onClick: onSaveNewView }, '＋ Ansicht speichern'));
    wrap.appendChild(row);

    const active = views.find(v => v.id === state.activeViewId);
    if (active) {
      const modified = !viewMatchesCurrent(active);
      wrap.appendChild(el('div', { class: 'doc-chip-actions' }, [
        modified ? el('span', { class: 'help', style: 'margin:0;' }, 'Filter/Sortierung geändert.') : null,
        modified ? el('button', { class: 'btn-sm', onClick: () => onUpdateView(active) }, 'Ansicht aktualisieren') : null,
        el('button', { class: 'btn-sm', onClick: () => onRenameView(active) }, 'Umbenennen'),
        el('button', { class: 'btn-sm btn-danger', onClick: () => onDeleteView(active) }, 'Löschen'),
      ]));
    }
  }
  function chip(v, active) {
    return el('button', { class: 'doc-chip' + (active ? ' active' : ''), onClick: () => applyView(v) }, v.name);
  }

  function applyView(v) {
    if (v.id === 'all') { state.filters = emptyFilters(); state.sort = '-created'; }
    else { state.filters = clone(v.filters || emptyFilters()); state.sort = v.sort || '-created'; }
    state.activeViewId = v.id;
    state.page = 1;
    renderToolbar();
    reload();
  }

  function onSaveNewView() {
    const name = (window.prompt('Name der neuen Ansicht:', '') || '').trim();
    if (!name) return;
    const views = loadViews();
    const v = { id: newViewId(), name, filters: clone(state.filters), sort: state.sort };
    views.push(v);
    persistViews(views);
    state.activeViewId = v.id;
    renderChips();
    toast('Ansicht „' + name + '" gespeichert');
  }
  function onUpdateView(active) {
    const views = loadViews();
    const v = views.find(x => x.id === active.id);
    if (!v) return;
    v.filters = clone(state.filters); v.sort = state.sort;
    persistViews(views);
    renderChips();
    toast('Ansicht aktualisiert');
  }
  function onRenameView(active) {
    const name = (window.prompt('Neuer Name:', active.name) || '').trim();
    if (!name) return;
    const views = loadViews();
    const v = views.find(x => x.id === active.id);
    if (!v) return;
    v.name = name;
    persistViews(views);
    renderChips();
  }
  function onDeleteView(active) {
    if (!confirmDialog('Ansicht „' + active.name + '" löschen?')) return;
    const views = loadViews().filter(x => x.id !== active.id);
    persistViews(views);
    if (state.activeViewId === active.id) applyView({ id: 'all' });
    renderChips();
  }

  // ---------- Filter-/Sortier-Toolbar ----------
  function fillSelect(sel, items, allLabel, current) {
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, allLabel));
    for (const it of items) sel.appendChild(el('option', { value: it.id, selected: String(it.id) === String(current) }, it.name));
  }

  function renderToolbar() {
    const f = state.filters;
    const t = state._els.toolbar;
    t.innerHTML = '';

    const queryInput = el('input', { type: 'search', placeholder: 'Volltextsuche…', value: f.query, style: 'min-width:200px;' });
    queryInput.oninput = () => { f.query = queryInput.value; };
    queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') { state.page = 1; reload(); } });

    const corrSel = el('select', {});
    fillSelect(corrSel, state.meta.correspondents, 'Korrespondent: alle', f.correspondent);
    corrSel.onchange = () => { f.correspondent = corrSel.value; };

    const typeSel = el('select', {});
    fillSelect(typeSel, state.meta.documentTypes, 'Typ: alle', f.document_type);
    typeSel.onchange = () => { f.document_type = typeSel.value; };

    const tagsSel = el('select', { multiple: 'multiple', size: '1', style: 'min-width:150px; height:34px;' });
    for (const tg of state.meta.tags) tagsSel.appendChild(el('option', { value: tg.id, selected: f.tags.includes(String(tg.id)) }, tg.name));
    tagsSel.onchange = () => { f.tags = Array.from(tagsSel.selectedOptions).map(o => o.value); };

    const fromInput = el('input', { type: 'date', value: f.created_gte });
    fromInput.onchange = () => { f.created_gte = fromInput.value; };
    const toInput = el('input', { type: 'date', value: f.created_lte });
    toInput.onchange = () => { f.created_lte = toInput.value; };

    const sortSel = el('select', {}, SORTS.map(s => el('option', { value: s.key, selected: s.key === state.sort }, s.label)));
    sortSel.onchange = () => { state.sort = sortSel.value; state.page = 1; reload(); };

    const layoutToggle = el('div', { class: 'doc-layout-toggle' }, [
      el('button', { class: 'btn-sm' + (state.layout === 'tiles' ? ' active' : ''), onClick: () => setLayout('tiles') }, '▦ Kacheln'),
      el('button', { class: 'btn-sm' + (state.layout === 'list' ? ' active' : ''), onClick: () => setLayout('list') }, '☰ Liste'),
    ]);

    const ff = (label, node) => el('div', { class: 'doc-field' }, [el('label', { class: 'help', style: 'margin:0;' }, label), node]);

    t.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'doc-filterbar' }, [
        ff('Suche', queryInput),
        ff('Korrespondent', corrSel),
        ff('Dokumenttyp', typeSel),
        ff('Tags (Mehrfach)', tagsSel),
        ff('Datum von', fromInput),
        ff('Datum bis', toInput),
        ff('Sortierung', sortSel),
        el('div', { class: 'doc-filter-actions' }, [
          el('button', { class: 'btn-primary', onClick: () => { state.page = 1; reload(); } }, 'Suchen'),
          el('button', { class: 'btn-sm', onClick: resetFilters }, 'Zurücksetzen'),
        ]),
        el('div', { class: 'spacer' }),
        layoutToggle,
      ]),
    ]));
  }

  function resetFilters() {
    state.filters = emptyFilters();
    state.sort = '-created';
    state.activeViewId = 'all';
    state.page = 1;
    renderToolbar();
    reload();
  }
  function setLayout(l) {
    if (state.layout === l) return;
    state.layout = l;
    localStorage.setItem(LAYOUT_KEY, l);
    renderToolbar();
    renderGallery();
  }

  // ---------- Suche / Galerie ----------
  function buildParams() {
    const f = state.filters;
    return {
      query: f.query || undefined,
      correspondent: f.correspondent || undefined,
      document_type: f.document_type || undefined,
      tags: f.tags.length ? f.tags.join(',') : undefined,
      created_gte: f.created_gte || undefined,
      created_lte: f.created_lte || undefined,
      page: state.page,
      page_size: PAGE_SIZE,
      ordering: state.sort,
    };
  }

  async function reload() {
    state.page = 1;
    state.items = [];
    state._els.gallery.innerHTML = '';
    state._els.gallery.appendChild(el('div', { class: 'empty' }, 'Suche läuft…'));
    await fetchPage(false);
    renderChips();
  }
  async function loadMore() {
    state.page++;
    await fetchPage(true);
  }
  async function fetchPage(append) {
    state.loading = true;
    try {
      const data = await api.searchDocuments(buildParams());
      state.count = data.count || 0;
      const results = data.results || [];
      state.items = append ? state.items.concat(results) : results;
      state.hasMore = !!data.next;
      renderGallery();
    } catch (e) {
      if (!append) {
        state._els.gallery.innerHTML = '';
        state._els.gallery.appendChild(el('div', { class: 'empty' }, '⚠ Fehler: ' + e.message));
      } else {
        toast('Nachladen fehlgeschlagen: ' + e.message);
        state.page--;
      }
    } finally { state.loading = false; }
  }

  function renderGallery() {
    const g = state._els.gallery;
    g.innerHTML = '';
    if (!state.items.length) { g.appendChild(el('div', { class: 'empty' }, 'Keine Dokumente gefunden.')); return; }

    const container = el('div', { class: state.layout === 'tiles' ? 'doc-gallery' : 'doc-listview' });
    for (const d of state.items) container.appendChild(state.layout === 'tiles' ? tileCard(d) : listRow(d));
    g.appendChild(container);

    g.appendChild(el('div', { class: 'doc-gallery-foot' }, [
      el('span', { class: 'help', style: 'margin:0;' }, `${state.items.length} von ${state.count} angezeigt`),
      state.hasMore ? el('button', { class: 'btn-sm', onClick: loadMore }, 'Mehr laden') : null,
    ]));
  }

  function thumbEl(d) {
    const wrap = el('div', { class: 'doc-thumb' });
    const img = el('img', { loading: 'lazy', alt: '', src: api.docFileUrl(d.id, 'thumb') });
    img.addEventListener('error', () => { wrap.innerHTML = ''; wrap.appendChild(el('div', { class: 'doc-thumb-fallback' }, '📄')); });
    wrap.appendChild(img);
    return wrap;
  }
  function tagChips(d) {
    const ids = d.tags || [];
    if (!ids.length) return null;
    const row = el('div', { class: 'doc-tags' });
    for (const id of ids) {
      const tg = byId(state.meta.tags, id);
      if (!tg) continue;
      row.appendChild(el('span', { class: 'doc-tag', style: `background:${tg.color || '#888'}; color:${readableOn(tg.color)};` }, tg.name));
    }
    return row;
  }
  function metaLine(d) {
    const corr = nameOf(state.meta.correspondents, d.correspondent);
    const parts = [corr || '—', fmtDate(d.created)].filter(Boolean);
    return parts.join(' · ');
  }

  function tileCard(d) {
    return el('div', { class: 'doc-tile', onClick: () => openDetail(d.id), title: d.title || '' }, [
      thumbEl(d),
      el('div', { class: 'doc-tile-body' }, [
        el('div', { class: 'doc-tile-title' }, d.title || '(ohne Titel)'),
        el('div', { class: 'doc-tile-sub help' }, metaLine(d)),
        tagChips(d),
      ]),
    ]);
  }
  function listRow(d) {
    return el('div', { class: 'doc-listrow', onClick: () => openDetail(d.id) }, [
      thumbEl(d),
      el('div', { class: 'doc-listrow-body' }, [
        el('div', { class: 'doc-listrow-title' }, d.title || '(ohne Titel)'),
        el('div', { class: 'doc-listrow-sub help' }, metaLine(d)),
      ]),
      el('div', { class: 'doc-listrow-tags' }, [tagChips(d)]),
    ]);
  }

  // ---------- Detail (Overlay) ----------
  function openDetail(id) {
    state._detailTab = 'preview';
    const overlay = el('div', { class: 'doc-detail-overlay' });
    const panel = el('div', { class: 'doc-detail-modal' }, el('div', { class: 'empty' }, 'Lade Dokument…'));
    overlay.appendChild(panel);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
    function esc(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(overlay);

    api.getDocument(id)
      .then(doc => renderDetail(doc, panel, close))
      .catch(e => { panel.innerHTML = ''; panel.appendChild(el('div', { class: 'empty' }, '⚠ Fehler: ' + e.message)); });
  }

  // Aktualisiert die Kachel/Zeile in der offenen Galerie nach dem Speichern.
  function patchItemInGallery(updated) {
    const idx = state.items.findIndex(r => String(r.id) === String(updated.id));
    if (idx >= 0) { state.items[idx] = { ...state.items[idx], ...updated }; renderGallery(); }
  }

  function renderDetail(doc, panel, close) {
    panel.innerHTML = '';

    const draft = {
      title: doc.title || '',
      created: isoDate(doc.created),
      correspondent: doc.correspondent || '',
      document_type: doc.document_type || '',
      tags: (doc.tags || []).map(String),
      archive_serial_number: doc.archive_serial_number || '',
      custom_fields: (doc.custom_fields || []).map(cf => ({ field: cf.field, value: cf.value })),
    };

    const titleInput = el('input', { type: 'text', value: draft.title, style: 'width:100%;' });
    const dateInput = el('input', { type: 'date', value: draft.created });
    const corrSel = el('select', { style: 'width:100%;' });
    fillSelect(corrSel, state.meta.correspondents, '— kein —', draft.correspondent);
    const typeSel = el('select', { style: 'width:100%;' });
    fillSelect(typeSel, state.meta.documentTypes, '— kein —', draft.document_type);
    const asnInput = el('input', { type: 'number', value: draft.archive_serial_number, style: 'width:140px;' });

    const tagSet = new Set(draft.tags);
    const tagBox = el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px; max-height:120px; overflow:auto; border:1px solid var(--border); border-radius:6px; padding:8px;' });
    for (const t of state.meta.tags) {
      const cb = el('input', { type: 'checkbox', checked: tagSet.has(String(t.id)) });
      cb.addEventListener('change', () => { if (cb.checked) tagSet.add(String(t.id)); else tagSet.delete(String(t.id)); });
      tagBox.appendChild(el('label', { class: 'tag', style: 'display:inline-flex; align-items:center; gap:4px; cursor:pointer;' }, [cb, t.name]));
    }
    if (state.meta.tags.length === 0) tagBox.appendChild(el('span', { class: 'help', style: 'margin:0;' }, 'Keine Tags vorhanden.'));

    const cfState = draft.custom_fields.map(cf => ({ field: cf.field, value: cf.value }));
    const cfContainer = el('div', {});
    const cfAddRow = el('div', { style: 'margin-top:4px;' });
    const cfInputType = dt => (dt === 'integer' || dt === 'float' || dt === 'monetary') ? 'number'
      : dt === 'date' ? 'date' : dt === 'boolean' ? 'checkbox' : 'text';

    function renderCF() {
      cfContainer.innerHTML = '';
      if (!cfState.length) cfContainer.appendChild(el('p', { class: 'help', style: 'margin:0 0 6px;' }, 'Keine Felder zugewiesen.'));
      cfState.forEach((item) => {
        const def = byId(state.meta.customFields, item.field);
        const label = def ? def.name : `Feld ${item.field}`;
        const inputType = cfInputType(def ? def.data_type : 'string');
        const input = el('input', { type: inputType, style: inputType === 'checkbox' ? '' : 'width:100%;' });
        if (inputType === 'checkbox') { input.checked = !!item.value; input.addEventListener('change', () => { item.value = input.checked; }); }
        else { input.value = item.value == null ? '' : item.value; input.addEventListener('input', () => { item.value = input.value; }); }
        const removeBtn = el('button', { class: 'btn-sm', title: 'Feld entfernen', onClick: () => { const i = cfState.indexOf(item); if (i >= 0) cfState.splice(i, 1); renderCF(); } }, '✕');
        cfContainer.appendChild(el('div', { style: 'display:flex; gap:8px; align-items:flex-end; margin-bottom:8px;' }, [
          el('div', { style: 'flex:1;' }, dfield(label, input)),
          removeBtn,
        ]));
      });
      renderCFAdd();
    }
    function renderCFAdd() {
      cfAddRow.innerHTML = '';
      const used = new Set(cfState.map(c => String(c.field)));
      const avail = (state.meta.customFields || []).filter(d => !used.has(String(d.id)));
      if (!avail.length) return;
      const sel = el('select', { style: 'flex:1;' }, [
        el('option', { value: '' }, '— Feld hinzufügen —'),
        ...avail.map(d => el('option', { value: d.id }, d.name)),
      ]);
      const btn = el('button', { class: 'btn-sm', onClick: () => {
        if (!sel.value) return;
        const def = byId(state.meta.customFields, sel.value);
        cfState.push({ field: Number(sel.value), value: (def && def.data_type === 'boolean') ? false : '' });
        renderCF();
      } }, '＋');
      cfAddRow.appendChild(el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [sel, btn]));
    }

    const onSave = async () => {
      const patch = {
        title: titleInput.value.trim(),
        created: dateInput.value || null,
        correspondent: corrSel.value ? Number(corrSel.value) : null,
        document_type: typeSel.value ? Number(typeSel.value) : null,
        tags: Array.from(tagSet).map(Number),
        archive_serial_number: asnInput.value === '' ? null : Number(asnInput.value),
      };
      patch.custom_fields = cfState.map(c => {
        const def = byId(state.meta.customFields, c.field);
        const dt = def ? def.data_type : 'string';
        let value = c.value;
        if (dt === 'boolean') value = !!value;
        else if (dt === 'integer' || dt === 'float' || dt === 'monetary') value = (value === '' || value == null) ? null : Number(value);
        else value = (value === '' ? null : value);
        return { field: c.field, value };
      });
      saveBtn.disabled = true;
      saveBtn.textContent = 'Speichere…';
      try {
        const updated = await api.patchDocument(doc.id, patch);
        toast('Dokument gespeichert');
        patchItemInGallery(updated);
        renderDetail(updated, panel, close);
      } catch (e) {
        toast('Speichern fehlgeschlagen: ' + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Speichern';
      }
    };
    const saveBtn = el('button', { class: 'btn-primary', onClick: onSave }, 'Speichern');

    function dfield(label, node) { return el('div', { style: 'margin-bottom:10px;' }, [el('label', {}, label), node]); }

    const previewUrl = api.docFileUrl(doc.id, 'preview');
    const downloadUrl = api.docFileUrl(doc.id, 'download');

    panel.appendChild(el('div', { class: 'doc-detail-head' }, [
      el('h3', { style: 'margin:0; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }, doc.title || '(ohne Titel)'),
      el('a', { href: downloadUrl, target: '_blank', rel: 'noopener', class: 'btn-sm' }, 'Download'),
      el('button', { class: 'btn-sm', onClick: close }, '✕ Schließen'),
    ]));

    const tabPreview = el('div', { class: 'doc-preview-wrap' }, [
      el('div', { class: 'doc-preview-bar' }, [
        el('button', { class: 'btn-sm btn-primary', onClick: () => openLightbox(previewUrl, downloadUrl, doc.title) }, '⛶ Vollbild'),
        el('a', { href: downloadUrl, target: '_blank', rel: 'noopener', class: 'btn-sm' }, 'Herunterladen'),
      ]),
      el('iframe', { src: previewUrl, title: 'Vorschau' }),
    ]);

    const tabProps = el('div', {}, [
      dfield('Titel', titleInput),
      el('div', { class: 'row', style: 'display:flex; gap:12px; flex-wrap:wrap;' }, [
        el('div', { style: 'flex:1 1 160px;' }, dfield('Dokumentdatum', dateInput)),
        el('div', { style: 'flex:1 1 160px;' }, dfield('Archiv-Nr. (ASN)', asnInput)),
      ]),
      dfield('Korrespondent', corrSel),
      dfield('Dokumenttyp', typeSel),
      dfield('Tags', tagBox),
      el('h4', { style: 'margin:14px 0 6px;' }, 'Weitere Felder'),
      cfContainer, cfAddRow,
      el('div', { style: 'display:flex; gap:8px; margin-top:12px;' }, [saveBtn]),
    ]);
    renderCF();

    const notesBox = el('div', {});
    const tabNotes = el('div', {}, [notesBox]);
    renderNotesSection(notesBox, doc.id, doc.notes);

    const tabs = [
      { key: 'preview', label: 'Vorschau', node: tabPreview },
      { key: 'props', label: 'Eigenschaften', node: tabProps },
      { key: 'notes', label: 'Notizen', node: tabNotes },
    ];
    const content = el('div', {});
    const tabBar = el('div', { class: 'doc-tabs' });
    function showTab(key) {
      state._detailTab = key;
      Array.from(tabBar.children).forEach(b => b.classList.toggle('active', b.dataset.key === key));
      content.innerHTML = '';
      const t = tabs.find(x => x.key === key) || tabs[0];
      content.appendChild(t.node);
    }
    tabs.forEach(t => {
      const b = el('button', { onClick: () => showTab(t.key) }, t.label);
      b.dataset.key = t.key;
      tabBar.appendChild(b);
    });
    panel.appendChild(tabBar);
    panel.appendChild(content);
    showTab(state._detailTab || 'preview');
  }

  // Vollbild-Vorschau (Lightbox)
  function openLightbox(url, downloadUrl, title) {
    const lb = el('div', { class: 'doc-lightbox' });
    const closeLb = () => lb.remove();
    lb.appendChild(el('div', { class: 'lb-bar' }, [
      el('strong', { style: 'font-weight:600;' }, title || 'Vorschau'),
      el('div', { class: 'spacer' }),
      el('a', { href: downloadUrl, target: '_blank', rel: 'noopener' }, 'Herunterladen'),
      el('button', { class: 'btn-sm', onClick: closeLb }, '✕ Schließen'),
    ]));
    lb.appendChild(el('iframe', { src: url, title: 'Vollbild-Vorschau' }));
    lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
    document.body.appendChild(lb);
  }

  // ---------- Notizen ----------
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
    return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  }
  function renderNotesSection(box, docId, initialNotes) {
    let notes = Array.isArray(initialNotes) ? initialNotes.slice() : null;
    const list = el('div', {});
    const textArea = el('textarea', { rows: '2', placeholder: 'Neue Notiz…', style: 'width:100%; resize:vertical;' });
    const addBtn = el('button', { class: 'btn-sm btn-primary', onClick: onAdd }, 'Notiz hinzufügen');

    function renderList() {
      list.innerHTML = '';
      if (notes == null) { list.appendChild(el('p', { class: 'help', style: 'margin:0;' }, 'Lade…')); return; }
      if (!notes.length) { list.appendChild(el('p', { class: 'help', style: 'margin:0;' }, 'Keine Notizen.')); return; }
      for (const n of notes) {
        list.appendChild(el('div', { style: 'display:flex; gap:8px; align-items:flex-start; border:1px solid var(--border); border-radius:6px; padding:8px; margin-bottom:6px;' }, [
          el('div', { style: 'flex:1;' }, [
            el('div', { style: 'white-space:pre-wrap;' }, n.note || ''),
            el('div', { class: 'help', style: 'margin:4px 0 0;' }, fmtDateTime(n.created)),
          ]),
          el('button', { class: 'btn-sm', title: 'Notiz löschen', onClick: () => onDelete(n.id) }, '✕'),
        ]));
      }
    }
    async function onAdd() {
      const text = textArea.value.trim();
      if (!text) return;
      addBtn.disabled = true; addBtn.textContent = 'Speichere…';
      try { notes = await api.addDocNote(docId, text); textArea.value = ''; renderList(); }
      catch (e) { toast('Notiz speichern fehlgeschlagen: ' + e.message); }
      finally { addBtn.disabled = false; addBtn.textContent = 'Notiz hinzufügen'; }
    }
    async function onDelete(noteId) {
      try { notes = await api.deleteDocNote(docId, noteId); renderList(); }
      catch (e) { toast('Notiz löschen fehlgeschlagen: ' + e.message); }
    }

    box.appendChild(list);
    box.appendChild(el('div', { style: 'margin-top:6px;' }, [textArea, el('div', { style: 'margin-top:6px;' }, [addBtn])]));
    renderList();
    if (notes == null) {
      api.listDocNotes(docId)
        .then(n => { notes = Array.isArray(n) ? n : []; renderList(); })
        .catch(e => { notes = []; renderList(); toast('Notizen konnten nicht geladen werden: ' + e.message); });
    }
  }

  GR.views = GR.views || {};
  GR.views.renderDokumente = renderDokumente;
})();
