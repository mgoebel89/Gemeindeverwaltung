(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast, pickFile } = GR.ui;
  const api = GR.api;

  const POLL_INTERVAL = 2500;
  const POLL_MAX = 48; // ~2 Minuten

  // Vollbild-Assistent für ein neues Paperless-Dokument.
  // opts: { prefillTitle, onUploaded({ id, title }) }
  function uploadPaperlessDocument(opts = {}) {
    const meta = { correspondents: [], documentTypes: [], tags: [], customFields: [] };
    let step = 1;
    let mode = null;            // 'file' | 'scan'
    let selectedFile = null;
    let fileUrl = null;         // ObjectURL der lokalen Datei (Vorschau)
    let scan = null;            // { scanId, count }
    let busy = false;

    const scannerUrl = ((GR.store.getSettings().auslagen) || {}).scannerUrl || '';

    // ---------- Grundgerüst ----------
    const overlay = el('div', { class: 'wiz-overlay' });
    const stepEls = {
      1: el('div', { class: 'step' }, [el('span', { class: 'num' }, '1'), el('span', { class: 'label' }, 'Quelle')]),
      2: el('div', { class: 'step' }, [el('span', { class: 'num' }, '2'), el('span', { class: 'label' }, 'Eigenschaften')]),
    };
    const body = el('div', { class: 'wiz-body' });
    const foot = el('div', { class: 'wiz-foot' });
    const box = el('div', { class: 'wiz' }, [
      el('div', { class: 'wiz-head' }, [
        el('h3', {}, 'Neues Dokument'),
        el('div', { class: 'wiz-steps' }, [stepEls[1], stepEls[2]]),
        el('button', { class: 'wiz-close', title: 'Abbrechen', onClick: () => close() }, '×'),
      ]),
      body, foot,
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    async function close() {
      if (busy) return;
      if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
      if (scan && scan.scanId) { api.discardScan(scan.scanId).catch(() => {}); scan = null; }
      overlay.remove();
    }

    // ---------- Metadaten laden (nicht-fatal) ----------
    api.docMeta().then(m => {
      meta.correspondents = m.correspondents || [];
      meta.documentTypes = m.documentTypes || [];
      meta.tags = m.tags || [];
      meta.customFields = m.customFields || [];
      fillSelect(corrSel, meta.correspondents);
      fillSelect(typeSel, meta.documentTypes);
      renderTagChecks();
      renderCFAdd();
    }).catch(e => toast('Paperless-Listen nicht geladen: ' + e.message, 4000));

    // ================= Schritt 1: Quelle =================
    const dzText = el('div', {}, [
      el('div', { class: 'dz-icon' }, '⬆'),
      el('div', {}, 'Datei hierher ziehen'),
      el('div', { class: 'dz-hint' }, 'oder tippen zum Auswählen (PDF oder Bild)'),
    ]);
    const dropzone = el('div', { class: 'dropzone', onClick: chooseFile }, [dzText]);
    ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
    ['dragleave', 'dragend'].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.remove('drag')));
    dropzone.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('drag');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setFile(f);
    });

    const scanBtn = el('button', { class: 'btn-sm', onClick: doScan }, '🖨 Scannen');
    if (!scannerUrl) { scanBtn.disabled = true; scanBtn.title = 'Kein Scanner in den Einstellungen hinterlegt'; }
    const sourceBtns = el('div', { class: 'wiz-source-btns' }, [
      el('button', { class: 'btn-primary', onClick: chooseFile }, 'Datei wählen…'),
      scanBtn,
    ]);

    const sourceInfo = el('div', { style: 'margin-top:16px;' }); // zeigt gewählte Datei / Scan-Ergebnis
    const step1El = el('div', {}, [
      el('p', { class: 'help', style: 'margin-top:0;' }, 'Wähle eine Datei (Ziehen & Ablegen möglich) oder scanne ein Dokument. Die Vorschau siehst du im nächsten Schritt.'),
      dropzone,
      sourceBtns,
      sourceInfo,
    ]);

    async function chooseFile() {
      const f = await pickFile('application/pdf,image/*');
      if (f) setFile(f);
    }
    function setFile(f) {
      if (scan && scan.scanId) { api.discardScan(scan.scanId).catch(() => {}); scan = null; }
      if (fileUrl) { URL.revokeObjectURL(fileUrl); }
      selectedFile = f; mode = 'file'; fileUrl = URL.createObjectURL(f);
      if (!titleInput.value.trim()) titleInput.value = f.name.replace(/\.[^.]+$/, '');
      renderSourceInfo();
      updateNav();
    }

    async function doScan() {
      if (busy) return;
      setBusy(true, 'Scanne… (Papier im Einzug?)');
      try {
        if (scan && scan.scanId) { await api.discardScan(scan.scanId).catch(() => {}); scan = null; }
        const r = await api.scanDocument(scannerUrl, 'feeder');
        scan = { scanId: r.scanId, count: r.count };
        selectedFile = null; mode = 'scan';
        if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
        renderSourceInfo();
        updateNav();
        setBusy(false, '');
      } catch (e) {
        setBusy(false, '');
        setStatus('Scan fehlgeschlagen: ' + e.message, 'error');
      }
    }

    function renderSourceInfo() {
      sourceInfo.innerHTML = '';
      if (mode === 'file' && selectedFile) {
        sourceInfo.appendChild(el('div', { class: 'attachment-row' }, [
          el('div', {}, [el('strong', {}, selectedFile.name), el('div', { class: 'att-meta' }, fmtSize(selectedFile.size))]),
          el('div', { class: 'spacer', style: 'flex:1;' }),
          el('button', { class: 'btn-sm', onClick: clearSource }, 'Entfernen'),
        ]));
      } else if (mode === 'scan' && scan) {
        const thumbs = el('div', { class: 'scan-thumbs' });
        for (let i = 0; i < scan.count; i++) {
          thumbs.appendChild(el('div', { class: 'thumb' }, [
            el('img', { src: api.scanPageUrl(scan.scanId, i), alt: 'Seite ' + (i + 1) }),
            el('div', { class: 'cap' }, 'Seite ' + (i + 1)),
          ]));
        }
        sourceInfo.appendChild(el('div', {}, [
          el('p', { class: 'help', style: 'margin:0 0 6px;' }, scan.count + ' Seite(n) gescannt.'),
          thumbs,
          el('div', { style: 'display:flex; gap:8px;' }, [
            el('button', { class: 'btn-sm', onClick: doScan }, '↻ Neu scannen'),
            el('button', { class: 'btn-sm', onClick: clearSource }, 'Verwerfen'),
          ]),
        ]));
      }
    }
    function clearSource() {
      if (scan && scan.scanId) { api.discardScan(scan.scanId).catch(() => {}); }
      if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
      selectedFile = null; scan = null; mode = null;
      renderSourceInfo(); updateNav();
    }

    // ================= Schritt 2: Eigenschaften =================
    const titleInput = el('input', { type: 'text', value: opts.prefillTitle || '', style: 'width:100%;' });
    const corrSel = el('select', { style: 'flex:1;' });
    const typeSel = el('select', { style: 'flex:1;' });
    const tagBox = el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px; max-height:120px; overflow:auto; border:1px solid var(--border); border-radius:6px; padding:8px;' });
    const cfContainer = el('div', {});
    const cfAddRow = el('div', { style: 'margin-top:4px;' });
    const previewPane = el('div', { class: 'wiz-preview' });

    function fillSelect(sel, items) {
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '' }, '— kein —'));
      for (const it of items) sel.appendChild(el('option', { value: it.id }, it.name));
    }
    function renderTagChecks() {
      tagBox.innerHTML = '';
      if (!meta.tags.length) { tagBox.appendChild(el('span', { class: 'help', style: 'margin:0;' }, 'Keine Tags.')); return; }
      for (const t of meta.tags) {
        const cb = el('input', { type: 'checkbox', value: String(t.id) });
        tagBox.appendChild(el('label', { class: 'tag', style: 'display:inline-flex; align-items:center; gap:4px; cursor:pointer;' }, [cb, t.name]));
      }
    }

    // Custom Fields (zuweisen/entfernen) — Werte werden im PATCH nach dem Upload gesetzt.
    const cfState = [];
    const cfInputType = dt => (dt === 'integer' || dt === 'float' || dt === 'monetary') ? 'number'
      : dt === 'date' ? 'date' : dt === 'boolean' ? 'checkbox' : 'text';
    function renderCF() {
      cfContainer.innerHTML = '';
      cfState.forEach(item => {
        const def = meta.customFields.find(d => String(d.id) === String(item.field));
        const label = def ? def.name : ('Feld ' + item.field);
        const inputType = cfInputType(def ? def.data_type : 'string');
        const input = el('input', { type: inputType, style: inputType === 'checkbox' ? '' : 'width:100%;' });
        if (inputType === 'checkbox') { input.checked = !!item.value; input.addEventListener('change', () => { item.value = input.checked; }); }
        else { input.value = item.value == null ? '' : item.value; input.addEventListener('input', () => { item.value = input.value; }); }
        const rm = el('button', { class: 'btn-sm', title: 'Feld entfernen', onClick: () => { const i = cfState.indexOf(item); if (i >= 0) cfState.splice(i, 1); renderCF(); renderCFAdd(); } }, '✕');
        cfContainer.appendChild(el('div', { style: 'display:flex; gap:8px; align-items:flex-end; margin-bottom:8px;' }, [
          el('div', { style: 'flex:1;' }, field(label, input)), rm,
        ]));
      });
    }
    function renderCFAdd() {
      cfAddRow.innerHTML = '';
      const used = new Set(cfState.map(c => String(c.field)));
      const avail = (meta.customFields || []).filter(d => !used.has(String(d.id)));
      if (!avail.length) return;
      const sel = el('select', { style: 'flex:1;' }, [
        el('option', { value: '' }, '— Feld hinzufügen —'),
        ...avail.map(d => el('option', { value: d.id }, d.name)),
      ]);
      const btn = el('button', { class: 'btn-sm', onClick: () => {
        if (!sel.value) return;
        const def = meta.customFields.find(d => String(d.id) === String(sel.value));
        cfState.push({ field: Number(sel.value), value: (def && def.data_type === 'boolean') ? false : '' });
        renderCF(); renderCFAdd();
      } }, '＋');
      cfAddRow.appendChild(el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [sel, btn]));
    }

    const addCorr = el('button', { class: 'btn-sm', onClick: () => addNew('Korrespondent', api.createCorrespondent, o => { meta.correspondents.push(o); fillSelect(corrSel, meta.correspondents); corrSel.value = o.id; }) }, '＋ neu');
    const addType = el('button', { class: 'btn-sm', onClick: () => addNew('Dokumenttyp', api.createDocumentType, o => { meta.documentTypes.push(o); fillSelect(typeSel, meta.documentTypes); typeSel.value = o.id; }) }, '＋ neu');
    const addTag = el('button', { class: 'btn-sm', onClick: () => addNew('Tag', api.createTag, o => { meta.tags.push(o); renderTagCheckKeepSelection(o); }) }, '＋ Tag');

    function renderTagCheckKeepSelection(o) {
      // neuen Tag ergänzen und direkt anhaken, vorhandene Auswahl erhalten
      if (tagBox.querySelector('.help')) tagBox.innerHTML = '';
      const cb = el('input', { type: 'checkbox', value: String(o.id), checked: true });
      tagBox.appendChild(el('label', { class: 'tag', style: 'display:inline-flex; align-items:center; gap:4px; cursor:pointer;' }, [cb, o.name]));
    }

    async function addNew(label, fn, after) {
      const name = (window.prompt('Name des neuen ' + label + 's:') || '').trim();
      if (!name) return;
      try { after(await fn(name)); toast(label + ' „' + name + '" angelegt'); }
      catch (e) { toast(label + ' anlegen fehlgeschlagen: ' + e.message, 4000); }
    }

    function field(label, node) { return el('div', { style: 'margin-bottom:10px;' }, [el('label', {}, label), node]); }

    const formCol = el('div', {}, [
      field('Titel', titleInput),
      field('Korrespondent', el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [corrSel, addCorr])),
      field('Dokumenttyp', el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [typeSel, addType])),
      el('div', { style: 'margin-bottom:10px;' }, [
        el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [el('label', { style: 'margin:0;' }, 'Tags'), addTag]),
        tagBox,
      ]),
      el('div', { style: 'margin-bottom:6px;' }, [el('label', { style: 'margin:0;' }, 'Weitere Felder'), cfContainer, cfAddRow]),
    ]);
    const step2El = el('div', { class: 'wiz-split' }, [previewPane, formCol]);

    function refreshPreview() {
      previewPane.innerHTML = '';
      if (mode === 'file' && selectedFile) {
        if (selectedFile.type.startsWith('image/')) {
          previewPane.appendChild(el('img', { src: fileUrl, alt: 'Vorschau' }));
        } else if (selectedFile.type === 'application/pdf') {
          previewPane.appendChild(el('embed', { src: fileUrl, type: 'application/pdf' }));
        } else {
          previewPane.appendChild(el('div', { class: 'ph' }, ['Keine Vorschau für diesen Dateityp.', el('br'), selectedFile.name]));
        }
      } else if (mode === 'scan' && scan) {
        // erste Seite groß + weitere als Thumbnails
        const wrap = el('div', { style: 'width:100%; overflow:auto; max-height:66vh;' });
        for (let i = 0; i < scan.count; i++) {
          wrap.appendChild(el('img', { src: api.scanPageUrl(scan.scanId, i), alt: 'Seite ' + (i + 1), style: 'width:100%; display:block; margin-bottom:6px; background:#f1f3f5;' }));
        }
        previewPane.appendChild(wrap);
      } else {
        previewPane.appendChild(el('div', { class: 'ph' }, 'Keine Quelle gewählt.'));
      }
    }

    // ================= Navigation / Footer =================
    const statusEl = el('div', { class: 'wiz-status' }, '');
    function setStatus(text, kind) {
      statusEl.textContent = text || '';
      statusEl.style.color = kind === 'error' ? 'var(--danger)' : '';
    }
    function setBusy(b, text) {
      busy = b;
      if (text !== undefined) setStatus(text || '');
      Array.from(foot.querySelectorAll('button')).forEach(btn => { btn.disabled = b; });
    }

    let weiterBtn, backBtn, uploadBtn;
    function updateNav() {
      if (weiterBtn) weiterBtn.disabled = !(selectedFile || scan);
    }

    function showStep(n) {
      step = n;
      body.innerHTML = '';
      foot.innerHTML = '';
      stepEls[1].className = 'step' + (n === 1 ? ' active' : ' done');
      stepEls[2].className = 'step' + (n === 2 ? ' active' : '');
      if (n === 1) {
        body.appendChild(step1El);
        weiterBtn = el('button', { class: 'btn-primary', onClick: () => showStep(2) }, 'Weiter →');
        foot.appendChild(el('div', { class: 'spacer' }));
        foot.appendChild(statusEl);
        foot.appendChild(weiterBtn);
        updateNav();
      } else {
        refreshPreview();
        body.appendChild(step2El);
        backBtn = el('button', { onClick: () => showStep(1) }, '‹ Zurück');
        uploadBtn = el('button', { class: 'btn-primary', onClick: onSubmit }, 'Hochladen');
        foot.appendChild(backBtn);
        foot.appendChild(el('div', { class: 'spacer' }));
        foot.appendChild(statusEl);
        foot.appendChild(uploadBtn);
      }
    }

    // ================= Absenden =================
    function collectMeta() {
      const m = {};
      const title = titleInput.value.trim();
      if (title) m.title = title;
      if (corrSel.value) m.correspondent = corrSel.value;
      if (typeSel.value) m.document_type = typeSel.value;
      const tags = Array.from(tagBox.querySelectorAll('input[type=checkbox]')).filter(c => c.checked).map(c => c.value);
      if (tags.length) m.tags = tags;
      return m;
    }
    function collectCustomFields() {
      return cfState.map(c => {
        const def = meta.customFields.find(d => String(d.id) === String(c.field));
        const dt = def ? def.data_type : 'string';
        let value = c.value;
        if (dt === 'boolean') value = !!value;
        else if (dt === 'integer' || dt === 'float' || dt === 'monetary') value = (value === '' || value == null) ? null : Number(value);
        else value = (value === '' ? null : value);
        return { field: c.field, value };
      });
    }

    async function onSubmit() {
      const m = collectMeta();
      const cfs = collectCustomFields();
      try {
        setBusy(true, mode === 'scan' ? 'Scan wird hochgeladen…' : 'Datei wird hochgeladen…');
        let taskId;
        if (mode === 'scan') {
          if (!scan) { setBusy(false, ''); return toast('Kein Scan vorhanden.'); }
          taskId = (await api.commitScan(scan.scanId, m)).taskId;
          scan = null; // vom Server nach commit gelöscht
        } else {
          if (!selectedFile) { setBusy(false, ''); return toast('Bitte eine Datei wählen.'); }
          taskId = (await api.uploadDocument(selectedFile, m)).taskId;
        }
        if (!taskId) {
          setStatus('Hochgeladen. Paperless verarbeitet das Dokument — es erscheint in Kürze.');
          setBusy(false); setTimeout(() => close(), 2500);
          return;
        }
        await pollTask(taskId, m.title, cfs);
      } catch (e) {
        setStatus('Fehlgeschlagen: ' + e.message, 'error');
        setBusy(false);
      }
    }

    async function pollTask(taskId, title, cfs) {
      setStatus('Paperless verarbeitet das Dokument (OCR)…');
      for (let i = 0; i < POLL_MAX; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        let t;
        try { t = await api.getDocTask(taskId); }
        catch (_) { continue; }
        if (t.status === 'SUCCESS' && t.documentId) {
          if (cfs && cfs.length) {
            setStatus('Zusatzfelder werden gesetzt…');
            try { await api.patchDocument(t.documentId, { custom_fields: cfs }); }
            catch (e) { toast('Zusatzfelder konnten nicht gesetzt werden: ' + e.message, 4000); }
          }
          toast('Dokument hochgeladen');
          if (opts.onUploaded) opts.onUploaded({ id: t.documentId, title: title || ('Dokument ' + t.documentId) });
          busy = false;
          overlay.remove();
          return;
        }
        if (t.status === 'FAILURE') {
          setStatus('Paperless-Verarbeitung fehlgeschlagen: ' + (t.result || 'unbekannt'), 'error');
          setBusy(false);
          return;
        }
      }
      setStatus('Verarbeitung dauert länger als erwartet. Das Dokument erscheint gleich in Paperless und kann dann verknüpft werden.');
      setBusy(false);
    }

    function fmtSize(n) {
      if (n == null) return '';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
      return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) { if (!busy) close(); }
      if (!document.body.contains(overlay)) document.removeEventListener('keydown', esc);
    });

    showStep(1);
  }

  GR.ui.uploadPaperlessDocument = uploadPaperlessDocument;
})();
