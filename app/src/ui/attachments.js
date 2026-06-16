(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast, confirmDialog } = GR.ui;

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return iso; }
  }

  function renderAttachmentsCard(sitzungId) {
    const list = GR.store.listAttachments(sitzungId);

    const rows = el('div', { class: 'attachment-list' },
      list.length ? list.map(a => {
        const url = GR.store.attachmentUrl(a.id);
        return el('div', { class: 'attachment-row' }, [
          el('a', { href: url, target: '_blank', rel: 'noopener', class: 'att-name' }, a.filename),
          el('span', { class: 'att-meta' }, fmtSize(a.size) + ' · ' + fmtDate(a.uploadedAt)),
          el('button', { class: 'btn-sm btn-danger', onClick: async () => {
            if (!confirmDialog(`Anhang „${a.filename}" wirklich löschen?`)) return;
            try {
              await GR.store.deleteAttachment(sitzungId, a.id);
              toast('Anhang gelöscht');
            } catch (e) { alert('Löschen fehlgeschlagen: ' + e.message); }
          } }, 'Löschen'),
        ]);
      }) : [el('p', { class: 'help' }, 'Noch keine Anhänge.')]
    );

    const fileInput = el('input', { type: 'file', style: 'display:none' });
    fileInput.multiple = true;

    async function handleFiles(files) {
      if (!files || !files.length) return;
      for (const f of files) {
        try {
          await GR.store.uploadAttachment(sitzungId, f);
        } catch (e) {
          alert(`„${f.name}" konnte nicht hochgeladen werden: ${e.message}`);
        }
      }
      toast(`${files.length} Datei(en) hochgeladen`);
    }

    fileInput.onchange = () => { handleFiles(fileInput.files); fileInput.value = ''; };

    const dropzone = el('div', { class: 'attachment-dropzone' }, 'Dateien hierher ziehen oder klicken zum Auswählen');
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });

    return el('div', { class: 'card' }, [
      el('h3', {}, 'Anhänge'),
      el('p', { class: 'help' }, 'Externe Dateien (z. B. Sitzungsvorlagen als PDF). Anhänge sind nur in der App sichtbar — sie erscheinen nicht im Protokoll-PDF.'),
      rows,
      dropzone,
      fileInput,
    ]);
  }

  GR.ui.renderAttachmentsCard = renderAttachmentsCard;
})();
