(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast } = GR.ui;
  const api = GR.api;

  const PAGE_SIZE = 15;

  function fmtDate(iso) {
    if (!iso) return '';
    const d = String(iso).slice(0, 10).split('-');
    return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso;
  }

  // Modaler Paperless-Dokument-Picker. Ruft onPick({ id, title }) beim Auswählen.
  // Nutzt den bestehenden Paperless-Proxy (/api/dokumente). Kein neues Backend nötig.
  function pickPaperlessDocument(onPick) {
    const state = { page: 1, query: '', data: null };

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();

    const queryInput = el('input', { type: 'search', placeholder: 'Volltextsuche in Paperless…', style: 'flex:1; min-width:180px;' });
    const resultsBox = el('div', { style: 'margin-top:12px; max-height:52vh; overflow:auto;' }, el('div', { class: 'empty' }, 'Suchbegriff eingeben und „Suchen" – oder leer lassen für die neuesten Dokumente.'));

    async function doSearch() {
      resultsBox.innerHTML = '';
      resultsBox.appendChild(el('div', { class: 'empty' }, 'Suche läuft…'));
      try {
        state.data = await api.searchDocuments({
          query: state.query || undefined,
          page: state.page,
          page_size: PAGE_SIZE,
          ordering: '-created',
        });
        renderResults();
      } catch (e) {
        resultsBox.innerHTML = '';
        resultsBox.appendChild(el('div', { class: 'empty' }, '⚠ Fehler: ' + e.message));
      }
    }

    function renderResults() {
      resultsBox.innerHTML = '';
      const data = state.data || { count: 0, results: [] };
      const results = data.results || [];
      if (results.length === 0) {
        resultsBox.appendChild(el('div', { class: 'empty' }, 'Keine Dokumente gefunden.'));
        return;
      }
      const table = el('table', { style: 'width:100%;' });
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Titel'), el('th', {}, 'Datum'), el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      for (const d of results) {
        tbody.appendChild(el('tr', {}, [
          el('td', {}, d.title || '(ohne Titel)'),
          el('td', { style: 'white-space:nowrap;' }, fmtDate(d.created)),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', {
              class: 'btn-sm btn-primary',
              onClick: () => { close(); if (onPick) onPick({ id: d.id, title: d.title || ('Dokument ' + d.id) }); },
            }, 'Verknüpfen'),
          ]),
        ]));
      }
      table.appendChild(tbody);

      const totalPages = Math.max(1, Math.ceil((data.count || 0) / PAGE_SIZE));
      const pager = el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 2px;' }, [
        el('button', { class: 'btn-sm', disabled: state.page <= 1, onClick: () => { state.page--; doSearch(); } }, '‹ Zurück'),
        el('span', { class: 'help', style: 'margin:0;' }, `${data.count || 0} Treffer · Seite ${state.page}/${totalPages}`),
        el('button', { class: 'btn-sm', disabled: state.page >= totalPages, onClick: () => { state.page++; doSearch(); } }, 'Weiter ›'),
      ]);
      resultsBox.appendChild(pager);
      resultsBox.appendChild(table);
    }

    const apply = () => { state.query = queryInput.value.trim(); state.page = 1; doSearch(); };
    queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });

    const box = el('div', { class: 'modal', style: 'max-width:680px; width:92vw;' }, [
      el('h3', {}, 'Paperless-Dokument verknüpfen'),
      el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
        queryInput,
        el('button', { class: 'btn-primary', onClick: apply }, 'Suchen'),
      ]),
      resultsBox,
      el('div', { class: 'toolbar', style: 'margin-top:14px; margin-bottom:0;' }, [
        el('div', { class: 'spacer' }),
        el('button', { onClick: close }, 'Abbrechen'),
      ]),
    ]);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);

    // Verbindung prüfen und initiale (neueste) Liste laden.
    api.docHealth().then(h => {
      if (!h || h.ok !== true) throw new Error(h && h.error ? h.error : 'Paperless nicht verbunden');
      doSearch();
    }).catch(e => {
      resultsBox.innerHTML = '';
      resultsBox.appendChild(el('div', { class: 'empty' }, [
        el('p', {}, '⚠ Paperless nicht erreichbar.'),
        el('p', { class: 'help' }, e.message),
        el('p', { class: 'help' }, 'PAPERLESS_URL und PAPERLESS_TOKEN im Backend prüfen.'),
      ]));
    });
  }

  GR.ui.pickPaperlessDocument = pickPaperlessDocument;

  // Wiederverwendbarer Abschnitt „verknüpfte Paperless-Dokumente" für eine
  // beliebige Entität mit `entity.paperlessDocs = [{ id, title }]`. `persist`
  // speichert die Entität. opts:
  //   showAdd (default true) – Buttons „verknüpfen"/„hochladen" anzeigen
  //   prefillTitle           – Vorschlag beim Hochladen
  //   emptyText              – Text, wenn nichts verknüpft ist
  // Rückgabe: das wrap-Element; `wrap.linkDoc(doc)` fügt extern ein Dokument
  // hinzu (z. B. nach dem Ablegen eines erzeugten PDFs) und aktualisiert die Liste.
  function renderPaperlessDocsSection(entity, persist, opts = {}) {
    const showAdd = opts.showAdd !== false;
    const wrap = el('div', {});
    const listBox = el('div', {});

    function renderList() {
      listBox.innerHTML = '';
      const docs = entity.paperlessDocs || [];
      if (docs.length === 0) {
        listBox.appendChild(el('div', { class: 'help', style: 'margin:0 0 8px;' }, opts.emptyText || 'Noch keine Dokumente verknüpft.'));
        return;
      }
      for (const d of docs) {
        listBox.appendChild(el('div', { class: 'doc-link-row' }, [
          el('span', { style: 'flex:1; min-width:0;' }, '📄 ' + (d.title || ('Dokument ' + d.id))),
          el('a', { class: 'btn-sm', href: GR.api.docFileUrl(d.id, 'preview'), target: '_blank', rel: 'noopener' }, 'Vorschau'),
          el('button', { class: 'btn-sm btn-danger', onClick: () => { entity.paperlessDocs = (entity.paperlessDocs || []).filter(x => String(x.id) !== String(d.id)); persist(); renderList(); } }, 'Entfernen'),
        ]));
      }
    }
    renderList();

    function linkDoc(doc) {
      if (!doc || doc.id == null) return;
      if (!entity.paperlessDocs) entity.paperlessDocs = [];
      if (entity.paperlessDocs.some(x => String(x.id) === String(doc.id))) { toast('Dokument ist bereits verknüpft.'); return; }
      entity.paperlessDocs.push({ id: doc.id, title: doc.title || ('Dokument ' + doc.id) });
      persist();
      renderList();
    }

    wrap.appendChild(listBox);
    if (showAdd) {
      const pickBtn = el('button', { class: 'btn-sm', onClick: () => {
        pickPaperlessDocument((doc) => { linkDoc(doc); toast('Dokument verknüpft'); });
      } }, '+ Dokument verknüpfen');
      const uploadBtn = el('button', { class: 'btn-sm btn-primary', onClick: () => {
        GR.ui.uploadPaperlessDocument({ prefillTitle: opts.prefillTitle || '', onUploaded: (doc) => linkDoc(doc) });
      } }, '＋ Dokument hochladen');
      wrap.appendChild(el('div', { style: 'display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;' }, [pickBtn, uploadBtn]));
    }

    wrap.linkDoc = linkDoc;
    return wrap;
  }

  GR.ui.renderPaperlessDocsSection = renderPaperlessDocsSection;
})();
