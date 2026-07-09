(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { fullNameEmpfaenger, gesamtbetrag, formatIban } = GR.models;
  const { formatDatum, toast } = GR.ui;

  const PAGE_W = 210;
  const PAGE_H = 297;
  const C_TEXT = [0, 0, 0];

  function euro(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }

  // Wappen als Data-URL (hochgeladenes bevorzugt, sonst Datei via Canvas).
  function getWappenDataUrl() {
    const s = store.getSettings();
    if (s && s.wappenDataUrl) return s.wappenDataUrl;
    try {
      const img = document.getElementById('wappenImg');
      if (!img || !img.complete || !img.naturalWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (_) { return null; }
  }

  function newDoc() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('jsPDF ist nicht geladen.\n\nBitte vendor/jspdf.inline.js bereitstellen (siehe vendor/README.txt).');
      return null;
    }
    return new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  }

  function setFont(doc, size, bold, italic, color) {
    doc.setFont('helvetica', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    const c = color || C_TEXT;
    doc.setTextColor(c[0], c[1], c[2]);
  }

  function line(doc, x1, y1, x2, y2, w) {
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(w || 0.3);
    doc.line(x1, y1, x2, y2);
  }

  function openPdf(doc, filename) {
    try {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = filename;
        document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0);
        toast('Popup blockiert — PDF als Download gestartet');
      } else {
        try { win.document.title = filename; } catch (_) {}
        toast('PDF in neuem Tab geöffnet');
      }
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e) {
      console.error(e);
      alert('PDF konnte nicht erzeugt werden: ' + e.message);
    }
  }

  // Bild-Beleg laden: {dataUrl, w, h, format} — nur Bilder (JPEG/PNG).
  function loadImage(url, mimetype) {
    return new Promise((resolve, reject) => {
      fetch(url).then(r => r.blob()).then(blob => {
        const fr = new FileReader();
        fr.onload = () => {
          const dataUrl = String(fr.result);
          const img = new Image();
          img.onload = () => resolve({
            dataUrl, w: img.naturalWidth, h: img.naturalHeight,
            format: (mimetype || blob.type || '').includes('png') ? 'PNG' : 'JPEG',
          });
          img.onerror = () => reject(new Error('Bild konnte nicht dekodiert werden'));
          img.src = dataUrl;
        };
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      }).catch(reject);
    });
  }

  // ---- Formularseite zeichnen (nach Vorlage Bargeldauslage_Vorlage.pdf) ----
  function drawFormular(doc, auslage) {
    const settings = store.getSettings();
    const cfg = settings.auslagen || {};
    const emp = store.getEmpfaenger(auslage.empfaengerId);
    const hs = store.getHaushaltsstelle(auslage.haushaltsstelleId);
    const wappen = getWappenDataUrl();
    const ort = cfg.ortsgemeinde || 'Hörschhausen';

    // Kopf: Wappen + Titel
    if (wappen) {
      try { doc.addImage(wappen, 'PNG', 20, 16, 18, 22, undefined, 'SLOW'); } catch (_) {}
    }
    setFont(doc, 22, true);
    doc.text('Ortsgemeinde ' + ort, 44, 30);

    // Haushaltsjahr / Haushaltsstelle
    setFont(doc, 10, false);
    doc.text('Haushaltsjahr:', 20, 54);
    line(doc, 50, 55, 95, 55);
    setFont(doc, 10, true);
    doc.text(String(auslage.haushaltsjahr || ''), 52, 54);
    setFont(doc, 10, false);
    doc.text('Haushaltsstelle:', 108, 54);
    line(doc, 143, 55, 190, 55);
    setFont(doc, 10, true);
    doc.text(hs ? (hs.nummer || '') : '', 145, 54);

    // Box "Bar-Auslage"
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4);
    doc.rect(80, 63, 50, 9, 'S');
    setFont(doc, 11, true);
    doc.text('Bar-Auslage', 105, 69, { align: 'center' });
    setFont(doc, 10, false);
    doc.text('für Ortsgemeinde ' + ort, 105, 82, { align: 'center' });

    // Zu Zahlen sind: <Betrag> €
    setFont(doc, 11, false);
    doc.text('Zu Zahlen sind:', 138, 100, { align: 'right' });
    line(doc, 142, 101, 182, 101);
    setFont(doc, 12, true);
    doc.text(gesamtbetrag(auslage).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 178, 100, { align: 'right' });
    setFont(doc, 11, false);
    doc.text('€', 185, 100);

    // Feldblock
    const rows = [
      ['Empfänger:', emp ? fullNameEmpfaenger(emp) : ''],
      ['Konto:', emp ? formatIban(emp.iban) : ''],
      ['Fälligkeit:', ''],
      ['Adressnummer:', ''],
      ['Bezeichnung:', auslage.verwendungszweck || ''],
    ];
    let y = 122;
    for (const [label, value] of rows) {
      setFont(doc, 10.5, false);
      doc.text(label, 55, y, { align: 'right' });
      line(doc, 58, y + 1, 190, y + 1);
      setFont(doc, 10.5, false);
      doc.text(String(value), 60, y);
      y += 10;
    }

    // Hörschhausen, den <Datum>
    y += 6;
    setFont(doc, 10.5, false);
    doc.text(`${ort}, den ${auslage.datum ? formatDatum(auslage.datum) : ''}`, 20, y);

    // Unterschriftszeilen (3 Spalten)
    const cols = [
      { cx: 45, label: 'Bürgermeister', name: cfg.buergermeisterName || 'M. Göbel', sign: true },
      { cx: 105, label: 'Ortsbeigeordneter', name: cfg.ortsbeigeordneterName || 'C. Arenz', sign: false },
      { cx: 165, label: 'Sachlich und rechnerisch richtig', name: '', sign: false },
    ];
    const labelY = y + 18;
    const lineY = y + 40;
    setFont(doc, 9.5, false);
    for (const c of cols) doc.text(c.label, c.cx, labelY, { align: 'center' });
    // Bürgermeister-Unterschrift als Bild über die Linie legen
    if (cfg.unterschriftDataUrl) {
      try {
        const fmt = cfg.unterschriftDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        doc.addImage(cfg.unterschriftDataUrl, fmt, cols[0].cx - 22, lineY - 16, 44, 15, undefined, 'SLOW');
      } catch (_) {}
    }
    for (const c of cols) {
      line(doc, c.cx - 24, lineY, c.cx + 24, lineY, 0.4);
      if (c.name) { setFont(doc, 9, false); doc.text(c.name, c.cx, lineY + 5, { align: 'center' }); }
    }

    // Quittungsblock unten
    line(doc, 20, 252, 190, 252, 0.5);
    setFont(doc, 10.5, false);
    doc.text('Quittung:', 20, 260);
    doc.text('Betrag dankend erhalten:', 20, 268);
    doc.text(`${cfg.quittungOrt || 'Kelberg'}, den`, 20, 280);
    line(doc, 48, 281, 95, 281);
    line(doc, 20, 291, 75, 291);
    setFont(doc, 9, false);
    doc.text('(Unterschrift)', 30, 296);
  }

  async function buildGesamtPdf(auslage) {
    const doc = newDoc(); if (!doc) return;
    drawFormular(doc, auslage);

    // Bild-Scans als Folgeseiten anhängen (in Beleg-Reihenfolge).
    const belege = (auslage.belege || []).slice().sort((x, y) => (Number(x.nr) || 0) - (Number(y.nr) || 0));
    const margin = 12;
    let skippedPdf = 0;
    for (const b of belege) {
      if (!b.scanFileId) continue;
      const file = store.getBelegFile(auslage.id, b.scanFileId);
      if (!file) continue;
      if ((file.mimetype || '').includes('pdf')) { skippedPdf++; continue; }
      try {
        const img = await loadImage(store.belegUrl(b.scanFileId), file.mimetype);
        doc.addPage();
        setFont(doc, 10, true);
        doc.text(`Beleg Nr. ${b.nr}${b.beschreibung ? ' – ' + b.beschreibung : ''}${b.betrag ? '   (' + euro(b.betrag) + ')' : ''}`, margin, margin);
        const availW = PAGE_W - 2 * margin;
        const availH = PAGE_H - 2 * margin - 6;
        const ratio = Math.min(availW / img.w, availH / img.h);
        const w = img.w * ratio, h = img.h * ratio;
        const x = (PAGE_W - w) / 2;
        doc.addImage(img.dataUrl, img.format, x, margin + 6, w, h, undefined, 'SLOW');
      } catch (e) {
        console.warn('Beleg-Scan konnte nicht eingebettet werden', e);
      }
    }

    if (skippedPdf > 0) {
      toast(`${skippedPdf} PDF-Beleg(e) nicht eingebettet – als Bild scannen oder separat anhängen.`, 5000);
    }
    openPdf(doc, `Bargeldauslage-${auslage.datum || ''}.pdf`);
  }

  GR.auslagenPdf = { buildGesamtPdf };
})();
