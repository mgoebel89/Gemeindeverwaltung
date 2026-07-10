(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const M = GR.models;
  const { formatDatum, toast } = GR.ui;

  // A4 quer – die Übersichtstabelle braucht Breite.
  const PAGE_W = 297;
  const PAGE_H = 210;
  const MARGIN_X = 15;
  const MARGIN_TOP = 18;
  const BOTTOM = PAGE_H - 15;

  function euro(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }

  // Spalten: [Schlüssel, Überschrift, Breite mm, Ausrichtung]
  const COLS = [
    ['bezeichnung', 'Bezeichnung', 52, 'left'],
    ['kategorie', 'Kategorie', 28, 'left'],
    ['partner', 'Partner', 44, 'left'],
    ['richtung', 'Art', 20, 'left'],
    ['betrag', 'Jahresbetrag', 30, 'right'],
    ['ende', 'Ende', 24, 'left'],
    ['kuend', 'Kündigung bis', 32, 'left'],
    ['status', 'Status', 24, 'left'],
  ];

  function newDoc() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('jsPDF ist nicht geladen.\n\nBitte vendor/jspdf.inline.js bereitstellen (siehe vendor/README.txt).');
      return null;
    }
    return new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  }

  function setFont(doc, size, bold) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
  }

  function colX(idx) {
    let x = MARGIN_X;
    for (let i = 0; i < idx; i++) x += COLS[i][2];
    return x;
  }
  function firstLine(doc, text, w) {
    const lines = doc.splitTextToSize(String(text == null ? '' : text), w - 2);
    return lines[0] || '';
  }

  function drawHeader(doc, y) {
    setFont(doc, 9, true);
    for (let i = 0; i < COLS.length; i++) {
      const [, title, w, align] = COLS[i];
      const x = colX(i);
      doc.text(title, align === 'right' ? x + w - 2 : x, y, { align: align === 'right' ? 'right' : 'left' });
    }
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
    doc.line(MARGIN_X, y + 1.5, PAGE_W - MARGIN_X, y + 1.5);
    return y + 6;
  }

  function buildVertragsUebersicht(vertraege, partnerById) {
    const doc = newDoc();
    if (!doc) return;
    partnerById = partnerById || {};

    const s = store.getSettings();
    const ortsname = (s && s.ortsname) || 'Gemeinde';

    setFont(doc, 15, true);
    doc.text('Vertragsübersicht – ' + ortsname, MARGIN_X, MARGIN_TOP);
    setFont(doc, 9, false);
    doc.setTextColor(90, 90, 90);
    doc.text('Stand: ' + formatDatum(M.dateToIso(new Date())), MARGIN_X, MARGIN_TOP + 5);
    doc.setTextColor(0, 0, 0);

    let y = MARGIN_TOP + 12;
    y = drawHeader(doc, y);

    const sorted = vertraege.slice().sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || '', 'de'));
    let kosten = 0, einnahmen = 0;

    setFont(doc, 9, false);
    for (const v of sorted) {
      if (y > BOTTOM) { doc.addPage(); y = drawHeader(doc, MARGIN_TOP); setFont(doc, 9, false); }
      const partner = partnerById[v.partnerId];
      const jb = M.jahresbetrag(v);
      if (v.status === 'aktiv') {
        if (v.richtung === 'ausgabe') kosten += jb; else einnahmen += jb;
      }
      const termin = M.spaetesterKuendigungstermin(v);
      const cells = {
        bezeichnung: v.bezeichnung || '(ohne Bezeichnung)',
        kategorie: v.kategorie || '',
        partner: partner ? partner.name : '',
        richtung: M.RICHTUNG_LABEL[v.richtung] || v.richtung,
        betrag: v.intervall === 'einmalig' ? euro(v.betrag) + ' (einm.)' : euro(jb),
        ende: v.ende ? formatDatum(v.ende) : '—',
        kuend: termin ? formatDatum(M.dateToIso(termin)) : '—',
        status: { aktiv: 'aktiv', gekuendigt: 'gekündigt', ausgelaufen: 'ausgelaufen' }[v.status] || v.status,
      };
      for (let i = 0; i < COLS.length; i++) {
        const [key, , w, align] = COLS[i];
        const x = colX(i);
        const txt = firstLine(doc, cells[key], w);
        doc.text(txt, align === 'right' ? x + w - 2 : x, y, { align: align === 'right' ? 'right' : 'left' });
      }
      y += 5.5;
    }

    // Summenzeile
    if (y > BOTTOM - 12) { doc.addPage(); y = MARGIN_TOP; }
    y += 3;
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
    doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
    y += 6;
    setFont(doc, 10, true);
    doc.text(`Summe jährliche Kosten (aktiv): ${euro(kosten)}`, MARGIN_X, y);
    doc.text(`Summe jährliche Einnahmen (aktiv): ${euro(einnahmen)}`, MARGIN_X + 110, y);

    openPdf(doc, 'vertragsuebersicht.pdf');
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

  GR.vertraegePdf = { buildVertragsUebersicht };
})();
