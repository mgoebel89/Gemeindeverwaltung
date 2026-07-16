(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const M = GR.models;
  const { formatDatum, toast } = GR.ui;

  // Vorläufige interne Abrechnung (Modul Arbeitszeiten & Vergütung).
  // Bewusst ein eigenes, schlichtes Layout: das echte VG-Formular liegt noch
  // nicht vor und kommt später als zweite build-Funktion daneben.

  const PAGE_W = 210, PAGE_H = 297;
  const MARGIN_X = 20, MARGIN_TOP = 20;
  const RIGHT_X = PAGE_W - MARGIN_X;
  const CONTENT_W = PAGE_W - 2 * MARGIN_X;
  const C_TEXT = [0, 0, 0], C_MUTED = [90, 90, 90], C_LEAD = [44, 82, 130];

  const euro = (n) => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const std = (n) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // jsPDF-Standardschriften können nur WinAnsi; ein Emoji im Text kippt die
  // ganze Zeile in eine andere Kodierung (Buchstabensalat). Siehe vorgaenge-pdf.
  const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹Œ Ž‘’“”•–—˜™š›œžŸ';
  function winAnsi(text) {
    let out = '';
    for (const ch of String(text == null ? '' : text)) {
      const cp = ch.codePointAt(0);
      if (cp <= 0xff || WINANSI_EXTRA.includes(ch)) out += ch;
      else if (cp >= 0x1f000 || (cp >= 0x2190 && cp <= 0x2bff)) continue;
      else out += '?';
    }
    return out;
  }

  function newDoc() {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert('jsPDF ist nicht geladen.'); return null; }
    return new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  }
  function setFont(doc, size, bold, italic, color) {
    doc.setFont('helvetica', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    const c = color || C_TEXT; doc.setTextColor(c[0], c[1], c[2]);
  }
  function text(doc, s, x, y, opts = {}) { doc.text(winAnsi(s), x, y, opts); }
  function ensureSpace(doc, state, need) {
    if (state.y + (need || 6) > PAGE_H - 20) { doc.addPage(); state.y = MARGIN_TOP; return true; }
    return false;
  }
  function line(doc, state, s, opts = {}) {
    const { size = 10, bold = false, italic = false, color, indent = 0, gap = 5, maxWidth } = opts;
    setFont(doc, size, bold, italic, color);
    const lines = doc.splitTextToSize(winAnsi(s), maxWidth || (CONTENT_W - indent));
    for (const ln of lines) { ensureSpace(doc, state, gap); doc.text(ln, MARGIN_X + indent, state.y); state.y += gap; }
  }
  function hr(doc, state, mm) {
    ensureSpace(doc, state, (mm || 3) + 2);
    doc.setDrawColor(210); doc.setLineWidth(0.2);
    doc.line(MARGIN_X, state.y, RIGHT_X, state.y);
    state.y += (mm || 3);
  }

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
  function fitBox(natW, natH, maxW, maxH) {
    if (!natW || !natH) return { w: maxW, h: maxH };
    const s = Math.min(maxW / natW, maxH / natH);
    return { w: natW * s, h: natH * s };
  }

  function openPdf(doc, filename) {
    try {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0);
        toast('Popup blockiert — PDF als Download gestartet');
      } else { try { win.document.title = filename; } catch (_) {} toast('PDF in neuem Tab geöffnet'); }
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e) { console.error(e); alert('PDF konnte nicht erzeugt werden: ' + e.message); }
  }

  function stelleName(id) {
    const h = store.getHaushaltsstelle(id);
    return h ? ((h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)')) : '';
  }

  // === Vorläufige Abrechnung ===
  // opts.target: 'download' (Standard) | 'paperless'; opts.onUploaded (Paperless).
  function buildVorlaeufigeAbrechnung(abr, opts = {}) {
    if (!abr) return;
    const doc = newDoc(); if (!doc) return;
    const settings = store.getSettings();
    const cfg = settings.auslagen || {};
    const ort = (settings.vermietung && settings.vermietung.ortsgemeinde) || settings.ortsname || '';
    const arbeiter = store.getArbeiter(abr.arbeiterId) || {};
    const state = { y: MARGIN_TOP };

    // --- Kopf (Wappen rechts; Titel darf nicht darunter laufen) ---
    let kopfW = CONTENT_W;
    const wappen = getWappenDataUrl();
    if (wappen) {
      try {
        const p = doc.getImageProperties(wappen);
        const fit = fitBox(p.width, p.height, 20, 24);
        doc.addImage(wappen, 'PNG', RIGHT_X - fit.w, state.y - 2, fit.w, fit.h, undefined, 'SLOW');
        kopfW = CONTENT_W - fit.w - 5;
      } catch (_) { kopfW = CONTENT_W - 25; }
    }
    setFont(doc, 15, true);
    text(doc, 'Abrechnung Arbeitsleistung', MARGIN_X, state.y + 4);
    state.y += 11;
    line(doc, state, 'Ortsgemeinde ' + ort, { size: 9.5, color: C_MUTED, maxWidth: kopfW });
    line(doc, state, 'Zeitraum ' + formatDatum(abr.zeitraumVon) + ' – ' + formatDatum(abr.zeitraumBis)
      + '  ·  erstellt ' + formatDatum(abr.erstelltAm), { size: 9.5, color: C_MUTED, maxWidth: kopfW });
    setFont(doc, 8.5, false, true, C_MUTED);
    text(doc, 'Vorläufige interne Abrechnung – kein Formular der Verbandsgemeinde.', MARGIN_X, state.y);
    state.y = Math.max(state.y + 5, MARGIN_TOP + 24);
    hr(doc, state, 5);

    // --- Leistungserbringer ---
    line(doc, state, 'Leistungserbringer', { size: 11.5, bold: true, color: C_LEAD });
    line(doc, state, M.arbeiterName(arbeiter), { size: 11, bold: true });
    const zusatz = M.arbeiterZusatz(arbeiter);
    if (zusatz) line(doc, state, zusatz, { size: 9.5, color: C_MUTED });
    const anschrift = [arbeiter.strasse, [arbeiter.plz, arbeiter.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (anschrift) line(doc, state, anschrift, { size: 10 });
    if (arbeiter.iban) {
      line(doc, state, 'IBAN: ' + M.formatIban(arbeiter.iban)
        + (arbeiter.kontoinhaber ? '  ·  Kontoinhaber: ' + arbeiter.kontoinhaber : ''), { size: 10 });
    }
    state.y += 2;
    hr(doc, state, 5);

    // --- Positionstabelle ---
    line(doc, state, 'Tätigkeiten', { size: 11.5, bold: true, color: C_LEAD });
    const COL = { datum: MARGIN_X, taet: MARGIN_X + 26, std: MARGIN_X + 118, satz: MARGIN_X + 140, betrag: RIGHT_X };

    function kopfzeile() {
      setFont(doc, 9, true, false, C_MUTED);
      text(doc, 'Datum', COL.datum, state.y);
      text(doc, 'Tätigkeit', COL.taet, state.y);
      text(doc, 'Stunden', COL.std, state.y, { align: 'right' });
      text(doc, 'Satz', COL.satz, state.y, { align: 'right' });
      text(doc, 'Betrag', COL.betrag, state.y, { align: 'right' });
      state.y += 2;
      doc.setDrawColor(180); doc.setLineWidth(0.3);
      doc.line(MARGIN_X, state.y, RIGHT_X, state.y);
      state.y += 4;
    }
    kopfzeile();

    for (const p of (abr.positionen || [])) {
      // Lange Tätigkeitstexte umbrechen; Zeilenhöhe danach bemessen.
      setFont(doc, 9.5, false);
      const taetLines = doc.splitTextToSize(winAnsi(p.taetigkeit || '—'), 88);
      const hoehe = Math.max(5, taetLines.length * 4.4);
      if (ensureSpace(doc, state, hoehe + 2)) kopfzeile();
      setFont(doc, 9.5, false);
      text(doc, formatDatum(p.datum), COL.datum, state.y);
      let ty = state.y;
      for (const tl of taetLines) { doc.text(tl, COL.taet, ty); ty += 4.4; }
      text(doc, std(p.stunden), COL.std, state.y, { align: 'right' });
      text(doc, euro(p.satz), COL.satz, state.y, { align: 'right' });
      text(doc, euro(p.betrag), COL.betrag, state.y, { align: 'right' });
      state.y += hoehe;
    }

    // --- Summen ---
    ensureSpace(doc, state, 16);
    doc.setDrawColor(120); doc.setLineWidth(0.4);
    doc.line(MARGIN_X, state.y, RIGHT_X, state.y);
    state.y += 5;
    setFont(doc, 10.5, true);
    text(doc, 'Summe', COL.taet, state.y);
    text(doc, std(abr.summeStunden) + ' Std.', COL.std, state.y, { align: 'right' });
    text(doc, euro(abr.summeBetrag), COL.betrag, state.y, { align: 'right' });
    state.y += 8;

    if (abr.haushaltsstelleId) line(doc, state, 'Haushaltsstelle: ' + stelleName(abr.haushaltsstelleId)
      + (abr.haushaltsjahr ? '  ·  Haushaltsjahr ' + abr.haushaltsjahr : ''), { size: 10 });
    if (abr.status === 'ausgezahlt') {
      line(doc, state, 'Ausgezahlt am ' + formatDatum(abr.ausgezahltAm), { size: 10, bold: true });
    }
    if (abr.notiz) line(doc, state, 'Notiz: ' + abr.notiz, { size: 9.5, color: C_MUTED });

    // --- Unterschriften ---
    state.y = Math.max(state.y + 12, PAGE_H - 60);
    const cols = [
      { cx: MARGIN_X + 40, label: 'Leistungserbringer', name: M.arbeiterName(arbeiter), sign: false },
      { cx: RIGHT_X - 40, label: 'Bürgermeister', name: cfg.buergermeisterName || '', sign: true },
    ];
    setFont(doc, 9.5, false, false, C_MUTED);
    for (const c of cols) text(doc, c.label, c.cx, state.y, { align: 'center' });
    const lineY = state.y + 22;
    // Bürgermeister-Unterschrift seitenverhältnistreu einpassen (Maße aus den
    // Einstellungen); ohne Maße fester Kasten wie in den anderen PDFs.
    if (cfg.unterschriftDataUrl) {
      try {
        const maxW = 44, maxH = 15;
        let w = maxW, h = maxH;
        if (cfg.unterschriftW > 0 && cfg.unterschriftH > 0) {
          const r = Math.min(maxW / cfg.unterschriftW, maxH / cfg.unterschriftH);
          w = cfg.unterschriftW * r; h = cfg.unterschriftH * r;
        }
        const c = cols[1];
        doc.addImage(cfg.unterschriftDataUrl, String(cfg.unterschriftDataUrl).includes('image/png') ? 'PNG' : 'JPEG',
          c.cx - w / 2, lineY - h - 1, w, h, undefined, 'SLOW');
      } catch (_) {}
    }
    doc.setDrawColor(60); doc.setLineWidth(0.4);
    for (const c of cols) {
      doc.line(c.cx - 30, lineY, c.cx + 30, lineY);
      if (c.name) { setFont(doc, 9, false); text(doc, c.name, c.cx, lineY + 5, { align: 'center' }); }
    }

    // --- Fußzeile ---
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      setFont(doc, 8, false, false, C_MUTED);
      text(doc, `${ort} · Abrechnung Arbeitsleistung · Seite ${i}/${pages}`, MARGIN_X, PAGE_H - 8);
      text(doc, new Date().toLocaleDateString('de-DE'), RIGHT_X, PAGE_H - 8, { align: 'right' });
    }

    const safe = M.arbeiterName(arbeiter).replace(/[^\wäöüÄÖÜß ]+/g, '').replace(/\s+/g, '_').slice(0, 30);
    const filename = `Arbeitszeit-${safe}-${abr.zeitraumBis || ''}.pdf`;
    if (opts.target === 'paperless') {
      GR.ui.savePdfToPaperless(doc, filename, {
        prefillTitle: 'Arbeitszeit ' + M.arbeiterName(arbeiter) + ' ' + formatDatum(abr.zeitraumVon) + '–' + formatDatum(abr.zeitraumBis),
        onUploaded: opts.onUploaded,
      });
    } else openPdf(doc, filename);
  }

  GR.arbeitszeitenPdf = { buildVorlaeufigeAbrechnung };
})();
