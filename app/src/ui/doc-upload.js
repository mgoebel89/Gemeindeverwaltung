(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast, pickFile } = GR.ui;
  const api = GR.api;

  const POLL_INTERVAL = 2500;
  const POLL_MAX = 48; // ~2 Minuten

  // Upload-Dialog für ein neues Paperless-Dokument.
  // opts: { prefillTitle, onUploaded({ id, title }) }
  function uploadPaperlessDocument(opts = {}) {
    const meta = { correspondents: [], documentTypes: [], tags: [] };
    let selectedFile = null;
    let source = 'file'; // 'file' | 'scanner'
    let busy = false;

    const scannerUrl = ((GR.store.getSettings().auslagen) || {}).scannerUrl || '';

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => { if (!busy) overlay.remove(); };

    // --- Quelle ---
    const fileNameLabel = el('span', { class: 'help', style: 'margin:0;' }, 'keine Datei gewählt');
    const chooseFileBtn = el('button', { class: 'btn-sm', onClick: async () => {
      const f = await pickFile('application/pdf,image/*');
      if (f) { selectedFile = f; fileNameLabel.textContent = f.name; }
    } }, 'Datei wählen…');
    const fileRow = el('div', { style: 'display:flex; gap:8px; align-items:center; margin:6px 0;' }, [chooseFileBtn, fileNameLabel]);

    const scannerHint = el('span', { class: 'help', style: 'margin:0;' }, scannerUrl ? scannerUrl : '(keine Scanner-URL in den Einstellungen)');
    const scannerRow = el('div', { style: 'margin:6px 0;' }, [scannerHint]);
    scannerRow.style.display = 'none';

    const srcFile = el('input', { type: 'radio', name: 'docsrc', checked: true });
    const srcScan = el('input', { type: 'radio', name: 'docsrc' });
    if (!scannerUrl) srcScan.disabled = true;
    const applySource = () => {
      source = srcScan.checked ? 'scanner' : 'file';
      fileRow.style.display = source === 'file' ? 'flex' : 'none';
      scannerRow.style.display = source === 'scanner' ? 'block' : 'none';
    };
    srcFile.addEventListener('change', applySource);
    srcScan.addEventListener('change', applySource);

    const sourceBox = el('div', {}, [
      el('label', { style: 'display:inline-flex; gap:6px; align-items:center; margin-right:16px;' }, [srcFile, 'Datei hochladen']),
      el('label', { style: 'display:inline-flex; gap:6px; align-items:center;' }, [srcScan, scannerUrl ? 'Scannen' : 'Scannen (nicht konfiguriert)']),
      fileRow,
      scannerRow,
    ]);

    // --- Metadaten ---
    const titleInput = el('input', { type: 'text', value: opts.prefillTitle || '', style: 'width:100%;' });

    const corrSel = el('select', { style: 'flex:1;' });
    const typeSel = el('select', { style: 'flex:1;' });
    const tagBox = el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px; max-height:110px; overflow:auto; border:1px solid rgba(0,0,0,0.15); border-radius:6px; padding:8px;' });

    function fillSelect(sel, items, allLabel) {
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '' }, allLabel));
      for (const it of items) sel.appendChild(el('option', { value: it.id }, it.name));
    }
    function addTagCheckbox(t, checked) {
      const cb = el('input', { type: 'checkbox', checked: !!checked, value: String(t.id) });
      tagBox.appendChild(el('label', { class: 'tag', style: 'display:inline-flex; align-items:center; gap:4px; cursor:pointer;' }, [cb, t.name]));
    }
    function renderTags() {
      tagBox.innerHTML = '';
      if (!meta.tags.length) { tagBox.appendChild(el('span', { class: 'help', style: 'margin:0;' }, 'Keine Tags.')); return; }
      for (const t of meta.tags) addTagCheckbox(t, false);
    }

    const addCorr = el('button', { class: 'btn-sm', onClick: () => addNew('Korrespondent', api.createCorrespondent, o => { meta.correspondents.push(o); fillSelect(corrSel, meta.correspondents, '— kein —'); corrSel.value = o.id; }) }, '＋ neu');
    const addType = el('button', { class: 'btn-sm', onClick: () => addNew('Dokumenttyp', api.createDocumentType, o => { meta.documentTypes.push(o); fillSelect(typeSel, meta.documentTypes, '— kein —'); typeSel.value = o.id; }) }, '＋ neu');
    const addTag = el('button', { class: 'btn-sm', onClick: () => addNew('Tag', api.createTag, o => { meta.tags.push(o); if (tagBox.querySelector('.help')) tagBox.innerHTML = ''; addTagCheckbox(o, true); }) }, '＋ Tag');

    async function addNew(label, fn, after) {
      const name = (window.prompt(`Name des neuen ${label}s:`) || '').trim();
      if (!name) return;
      try { after(await fn(name)); toast(`${label} „${name}" angelegt`); }
      catch (e) { toast(`${label} anlegen fehlgeschlagen: ${e.message}`, 4000); }
    }

    const statusBox = el('div', { style: 'margin-top:10px; min-height:20px;' });
    const uploadBtn = el('button', { class: 'btn-primary', onClick: onSubmit }, 'Hochladen');
    const cancelBtn = el('button', { onClick: close }, 'Abbrechen');

    function field(label, node) { return el('div', { style: 'margin-bottom:10px;' }, [el('label', {}, label), node]); }

    const box = el('div', { class: 'modal', style: 'max-width:600px; width:92vw;' }, [
      el('h3', {}, 'Dokument nach Paperless hochladen'),
      sourceBox,
      el('hr', { style: 'border:none; border-top:1px solid rgba(0,0,0,0.1); margin:10px 0;' }),
      field('Titel', titleInput),
      field('Korrespondent', el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [corrSel, addCorr])),
      field('Dokumenttyp', el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [typeSel, addType])),
      el('div', { style: 'margin-bottom:10px;' }, [
        el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [el('label', { style: 'margin:0;' }, 'Tags'), addTag]),
        tagBox,
      ]),
      statusBox,
      el('div', { class: 'toolbar', style: 'margin-top:14px; margin-bottom:0;' }, [
        uploadBtn, cancelBtn,
      ]),
    ]);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);

    // Meta laden (nicht-fatal: ohne Paperless kann man trotzdem einen Titel setzen).
    fillSelect(corrSel, [], '— kein —');
    fillSelect(typeSel, [], '— kein —');
    tagBox.appendChild(el('span', { class: 'help', style: 'margin:0;' }, 'Lade…'));
    api.docMeta().then(m => {
      meta.correspondents = m.correspondents || [];
      meta.documentTypes = m.documentTypes || [];
      meta.tags = m.tags || [];
      fillSelect(corrSel, meta.correspondents, '— kein —');
      fillSelect(typeSel, meta.documentTypes, '— kein —');
      renderTags();
    }).catch(e => {
      tagBox.innerHTML = '';
      tagBox.appendChild(el('span', { class: 'help', style: 'margin:0;' }, '⚠ Paperless-Listen nicht geladen: ' + e.message));
    });

    function collectMeta() {
      const meta_ = {};
      const title = titleInput.value.trim();
      if (title) meta_.title = title;
      if (corrSel.value) meta_.correspondent = corrSel.value;
      if (typeSel.value) meta_.document_type = typeSel.value;
      const tags = Array.from(tagBox.querySelectorAll('input[type=checkbox]')).filter(c => c.checked).map(c => c.value);
      if (tags.length) meta_.tags = tags;
      return meta_;
    }

    function setStatus(text, kind) {
      statusBox.innerHTML = '';
      statusBox.appendChild(el('div', { class: kind === 'error' ? '' : 'help', style: 'margin:0;' + (kind === 'error' ? 'color:#c0392b;' : '') }, text));
    }
    function setBusy(b) {
      busy = b;
      uploadBtn.disabled = b; cancelBtn.disabled = b;
      uploadBtn.textContent = b ? 'Lädt…' : 'Hochladen';
    }

    async function onSubmit() {
      const m = collectMeta();
      try {
        setBusy(true);
        let taskId;
        if (source === 'scanner') {
          setStatus('Scanne… (Papier im Einzug?)');
          const r = await api.scanUploadDocument({ scannerUrl, source: 'feeder', ...m });
          taskId = r.taskId;
        } else {
          if (!selectedFile) { setBusy(false); return toast('Bitte eine Datei wählen.'); }
          setStatus('Datei wird hochgeladen…');
          const r = await api.uploadDocument(selectedFile, m);
          taskId = r.taskId;
        }
        if (!taskId) {
          setStatus('Hochgeladen. Paperless verarbeitet das Dokument — es erscheint in Kürze und kann dann verknüpft werden.');
          setBusy(false);
          setTimeout(close, 2500);
          return;
        }
        await pollTask(taskId, m.title);
      } catch (e) {
        setStatus('Fehlgeschlagen: ' + e.message, 'error');
        setBusy(false);
      }
    }

    async function pollTask(taskId, title) {
      setStatus('Paperless verarbeitet das Dokument (OCR)…');
      for (let i = 0; i < POLL_MAX; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        let t;
        try { t = await api.getDocTask(taskId); }
        catch (_) { continue; } // transient — weiter versuchen
        if (t.status === 'SUCCESS' && t.documentId) {
          setStatus('Fertig.');
          toast('Dokument hochgeladen');
          if (opts.onUploaded) opts.onUploaded({ id: t.documentId, title: title || ('Dokument ' + t.documentId) });
          setBusy(false);
          close();
          return;
        }
        if (t.status === 'FAILURE') {
          setStatus('Paperless-Verarbeitung fehlgeschlagen: ' + (t.result || 'unbekannt'), 'error');
          setBusy(false);
          return;
        }
      }
      setStatus('Verarbeitung dauert länger als erwartet. Das Dokument erscheint gleich in Paperless und kann dann manuell verknüpft werden.');
      setBusy(false);
    }
  }

  GR.ui.uploadPaperlessDocument = uploadPaperlessDocument;
})();
