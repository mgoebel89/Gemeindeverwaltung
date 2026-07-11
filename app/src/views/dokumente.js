(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast } = GR.ui;
  const api = GR.api;

  const PAGE_SIZE = 25;

  // Modul-State (lebt über Re-Renders der Teilbereiche hinweg).
  const state = {
    meta: { tags: [], correspondents: [], documentTypes: [], customFields: [] },
    filters: { query: '', correspondent: '', document_type: '', tags: [], created_gte: '', created_lte: '' },
    page: 1,
    data: null,        // { count, results, next, previous }
    selectedId: null,
    loadingMeta: false,
  };

  const byId = (list, id) => list.find(x => String(x.id) === String(id)) || null;
  const nameOf = (list, id) => { const x = byId(list, id); return x ? x.name : ''; };

  function fmtDate(iso) {
    if (!iso) return '';
    const d = String(iso).slice(0, 10).split('-');
    return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso;
  }
  const isoDate = iso => (iso ? String(iso).slice(0, 10) : '');

  // ---------- Haupt-Render ----------
  function renderDokumente(mount) {
    state.selectedId = null;

    const listPanel = el('div', { class: 'card', style: 'padding:0; flex:1 1 420px; min-width:340px; max-height:72vh; overflow:auto;' },
      el('div', { class: 'empty' }, 'Lade…'));
    const detailPanel = el('div', { class: 'card', style: 'flex:1 1 480px; min-width:340px; max-height:72vh; overflow:auto;' },
      el('div', { class: 'empty' }, 'Kein Dokument ausgewählt.'));
    state._listPanel = listPanel;
    state._detailPanel = detailPanel;

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-primary', onClick: () => GR.ui.uploadPaperlessDocument({ onUploaded: () => { state.page = 1; doSearch(); } }) }, '＋ Dokument hochladen'),
    ]));
    mount.appendChild(el('h2', {}, 'Dokumente'));
    mount.appendChild(el('p', { class: 'help' }, 'Dokumente aus Paperless-ngx durchsuchen, hochladen und Metadaten bearbeiten.'));
    mount.appendChild(buildToolbar());
    mount.appendChild(el('div', { class: 'doc-split', style: 'display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start;' }, [listPanel, detailPanel]));

    loadMetaThenSearch();
  }

  async function loadMetaThenSearch() {
    try {
      const h = await api.docHealth();
      if (!h || h.ok !== true) throw new Error(h && h.error ? h.error : 'Paperless nicht verbunden');
    } catch (e) {
      state._listPanel.innerHTML = '';
      state._listPanel.appendChild(el('div', { class: 'empty' }, [
        el('p', {}, '⚠ Paperless nicht erreichbar.'),
        el('p', { class: 'help' }, e.message),
        el('p', { class: 'help' }, 'PAPERLESS_URL und PAPERLESS_TOKEN im Backend prüfen.'),
      ]));
      return;
    }
    try {
      state.meta = await api.docMeta();
      refreshFilterOptions();
    } catch (e) {
      toast('Filter konnten nicht geladen werden: ' + e.message);
    }
    doSearch();
  }

  // ---------- Toolbar ----------
  function buildToolbar() {
    const f = state.filters;

    const queryInput = el('input', { type: 'search', placeholder: 'Volltextsuche…', value: f.query, style: 'min-width:220px;' });
    queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') { f.query = queryInput.value; state.page = 1; doSearch(); } });

    const correspondentSel = el('select', { id: 'doc-f-correspondent' });
    const typeSel = el('select', { id: 'doc-f-type' });
    const tagsSel = el('select', { id: 'doc-f-tags', multiple: 'multiple', size: '1', style: 'min-width:160px; height:34px;' });

    const fromInput = el('input', { type: 'date', value: f.created_gte });
    const toInput = el('input', { type: 'date', value: f.created_lte });

    const apply = () => {
      f.query = queryInput.value.trim();
      f.correspondent = correspondentSel.value;
      f.document_type = typeSel.value;
      f.tags = Array.from(tagsSel.selectedOptions).map(o => o.value);
      f.created_gte = fromInput.value;
      f.created_lte = toInput.value;
      state.page = 1;
      doSearch();
    };
    const reset = () => {
      state.filters = { query: '', correspondent: '', document_type: '', tags: [], created_gte: '', created_lte: '' };
      state.page = 1;
      queryInput.value = ''; correspondentSel.value = ''; typeSel.value = '';
      Array.from(tagsSel.options).forEach(o => (o.selected = false));
      fromInput.value = ''; toInput.value = '';
      doSearch();
    };

    state._refreshFilterOptions = () => {
      fillSelect(correspondentSel, state.meta.correspondents, 'Korrespondent: alle', f.correspondent);
      fillSelect(typeSel, state.meta.documentTypes, 'Typ: alle', f.document_type);
      tagsSel.innerHTML = '';
      for (const t of state.meta.tags) {
        tagsSel.appendChild(el('option', { value: t.id, selected: f.tags.includes(String(t.id)) }, t.name));
      }
    };

    const field = (label, node) => el('div', { style: 'display:flex; flex-direction:column; gap:2px;' }, [el('label', { class: 'help', style: 'margin:0;' }, label), node]);

    return el('div', { class: 'card' }, [
      el('div', { class: 'row', style: 'display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;' }, [
        field('Suche', queryInput),
        field('Korrespondent', correspondentSel),
        field('Dokumenttyp', typeSel),
        field('Tags (Mehrfach)', tagsSel),
        field('Datum von', fromInput),
        field('Datum bis', toInput),
        el('div', { style: 'display:flex; gap:6px; align-items:flex-end;' }, [
          el('button', { class: 'btn-primary', onClick: apply }, 'Suchen'),
          el('button', { class: 'btn-sm', onClick: reset }, 'Zurücksetzen'),
        ]),
      ]),
    ]);
  }

  function fillSelect(sel, items, allLabel, current) {
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, allLabel));
    for (const it of items) sel.appendChild(el('option', { value: it.id, selected: String(it.id) === String(current) }, it.name));
  }
  function refreshFilterOptions() { if (state._refreshFilterOptions) state._refreshFilterOptions(); }

  // ---------- Suche / Liste ----------
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
      ordering: '-created',
    };
  }

  async function doSearch() {
    const panel = state._listPanel;
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'empty' }, 'Suche läuft…'));
    try {
      state.data = await api.searchDocuments(buildParams());
      renderResults();
    } catch (e) {
      panel.innerHTML = '';
      panel.appendChild(el('div', { class: 'empty' }, '⚠ Fehler: ' + e.message));
    }
  }

  function renderResults() {
    const panel = state._listPanel;
    panel.innerHTML = '';
    const data = state.data || { count: 0, results: [] };
    const results = data.results || [];

    if (results.length === 0) {
      panel.appendChild(el('div', { class: 'empty' }, 'Keine Dokumente gefunden.'));
      return;
    }

    const table = el('table', { style: 'width:100%;' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Titel'), el('th', {}, 'Korrespondent'), el('th', {}, 'Typ'), el('th', {}, 'Datum'),
    ])));
    const tbody = el('tbody');
    for (const d of results) {
      const tr = el('tr', {
        style: 'cursor:pointer;' + (String(d.id) === String(state.selectedId) ? ' background:rgba(0,0,0,0.06);' : ''),
        onClick: () => selectDoc(d.id),
      }, [
        el('td', {}, d.title || '(ohne Titel)'),
        el('td', {}, nameOf(state.meta.correspondents, d.correspondent) || '—'),
        el('td', {}, nameOf(state.meta.documentTypes, d.document_type) || '—'),
        el('td', { style: 'white-space:nowrap;' }, fmtDate(d.created)),
      ]);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const totalPages = Math.max(1, Math.ceil((data.count || 0) / PAGE_SIZE));
    const pager = el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px;' }, [
      el('button', { class: 'btn-sm', disabled: state.page <= 1, onClick: () => { state.page--; doSearch(); } }, '‹ Zurück'),
      el('span', { class: 'help', style: 'margin:0;' }, `${data.count || 0} Treffer · Seite ${state.page}/${totalPages}`),
      el('button', { class: 'btn-sm', disabled: state.page >= totalPages, onClick: () => { state.page++; doSearch(); } }, 'Weiter ›'),
    ]);

    panel.appendChild(pager);
    panel.appendChild(table);
  }

  // ---------- Detail / Bearbeiten ----------
  async function selectDoc(id) {
    state.selectedId = id;
    renderResults(); // Markierung aktualisieren
    const panel = state._detailPanel;
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'empty' }, 'Lade Dokument…'));
    try {
      const doc = await api.getDocument(id);
      renderDetail(doc);
    } catch (e) {
      panel.innerHTML = '';
      panel.appendChild(el('div', { class: 'empty' }, '⚠ Fehler: ' + e.message));
    }
  }

  function renderDetail(doc) {
    const panel = state._detailPanel;
    panel.innerHTML = '';

    // Editierbarer Entwurf
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

    // Tags als Checkbox-Liste
    const tagSet = new Set(draft.tags);
    const tagBox = el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px; max-height:120px; overflow:auto; border:1px solid rgba(0,0,0,0.15); border-radius:6px; padding:8px;' });
    for (const t of state.meta.tags) {
      const cb = el('input', { type: 'checkbox', checked: tagSet.has(String(t.id)) });
      cb.addEventListener('change', () => { if (cb.checked) tagSet.add(String(t.id)); else tagSet.delete(String(t.id)); });
      tagBox.appendChild(el('label', { class: 'tag', style: 'display:inline-flex; align-items:center; gap:4px; cursor:pointer;' }, [cb, t.name]));
    }
    if (state.meta.tags.length === 0) tagBox.appendChild(el('span', { class: 'help', style: 'margin:0;' }, 'Keine Tags vorhanden.'));

    // Custom Fields: zuweisen, ändern, entfernen. cfState hält den aktuellen Stand;
    // die Werte werden per Listener direkt in cfState gespiegelt, damit Hinzufügen/
    // Entfernen andere Felder nicht verwirft.
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
          el('div', { style: 'flex:1;' }, field(label, input)),
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
      // custom_fields immer mitsenden — ein leeres Array entfernt alle Zuweisungen.
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
        // Liste aktualisieren (Titel/Typ/Korrespondent/Datum können sich geändert haben)
        if (state.data && state.data.results) {
          const idx = state.data.results.findIndex(r => String(r.id) === String(doc.id));
          if (idx >= 0) state.data.results[idx] = { ...state.data.results[idx], ...updated };
          renderResults();
        }
        renderDetail(updated);
      } catch (e) {
        toast('Speichern fehlgeschlagen: ' + e.message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Speichern';
      }
    };

    const saveBtn = el('button', { class: 'btn-primary', onClick: onSave }, 'Speichern');

    function field(label, node) {
      return el('div', { style: 'margin-bottom:10px;' }, [el('label', {}, label), node]);
    }

    // Vorschau
    const previewUrl = api.docFileUrl(doc.id, 'preview');
    const downloadUrl = api.docFileUrl(doc.id, 'download');
    const preview = el('iframe', { src: previewUrl, title: 'Vorschau', style: 'width:100%; height:340px; border:1px solid rgba(0,0,0,0.15); border-radius:6px;' });

    panel.appendChild(el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px;' }, [
      el('h3', { style: 'margin:0;' }, doc.title || '(ohne Titel)'),
      el('a', { href: downloadUrl, target: '_blank', rel: 'noopener', class: 'btn-sm' }, 'Download'),
    ]));
    panel.appendChild(preview);
    panel.appendChild(el('div', { style: 'height:12px;' }));

    panel.appendChild(field('Titel', titleInput));
    panel.appendChild(el('div', { class: 'row', style: 'display:flex; gap:12px; flex-wrap:wrap;' }, [
      el('div', { style: 'flex:1 1 160px;' }, field('Dokumentdatum', dateInput)),
      el('div', { style: 'flex:1 1 160px;' }, field('Archiv-Nr. (ASN)', asnInput)),
    ]));
    panel.appendChild(field('Korrespondent', corrSel));
    panel.appendChild(field('Dokumenttyp', typeSel));
    panel.appendChild(field('Tags', tagBox));
    panel.appendChild(el('h4', { style: 'margin:14px 0 6px;' }, 'Weitere Felder'));
    panel.appendChild(cfContainer);
    panel.appendChild(cfAddRow);
    renderCF();

    panel.appendChild(el('div', { style: 'display:flex; gap:8px; margin-top:12px;' }, [saveBtn]));

    // Notizen (eigener Bereich, unabhängig vom Metadaten-Speichern)
    panel.appendChild(el('h4', { style: 'margin:20px 0 6px;' }, 'Notizen'));
    const notesBox = el('div', {});
    panel.appendChild(notesBox);
    renderNotesSection(notesBox, doc.id, doc.notes);
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
        list.appendChild(el('div', { style: 'display:flex; gap:8px; align-items:flex-start; border:1px solid rgba(0,0,0,0.1); border-radius:6px; padding:8px; margin-bottom:6px;' }, [
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
      try {
        notes = await api.addDocNote(docId, text);
        textArea.value = '';
        renderList();
      } catch (e) { toast('Notiz speichern fehlgeschlagen: ' + e.message); }
      finally { addBtn.disabled = false; addBtn.textContent = 'Notiz hinzufügen'; }
    }
    async function onDelete(noteId) {
      try { notes = await api.deleteDocNote(docId, noteId); renderList(); }
      catch (e) { toast('Notiz löschen fehlgeschlagen: ' + e.message); }
    }

    box.appendChild(list);
    box.appendChild(el('div', { style: 'margin-top:6px;' }, [textArea, el('div', { style: 'margin-top:6px;' }, [addBtn])]));
    renderList();

    // Falls das Dokument-Detail keine Notizen mitliefert: separat nachladen.
    if (notes == null) {
      api.listDocNotes(docId)
        .then(n => { notes = Array.isArray(n) ? n : []; renderList(); })
        .catch(e => { notes = []; renderList(); toast('Notizen konnten nicht geladen werden: ' + e.message); });
    }
  }

  GR.views = GR.views || {};
  GR.views.renderDokumente = renderDokumente;
})();
