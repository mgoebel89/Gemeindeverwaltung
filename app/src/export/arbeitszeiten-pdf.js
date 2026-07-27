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

  // === VG-Formular „Lohnabrechnung" ===
  // Maßgetreuer Nachbau des Vordrucks der Verbandsgemeinde (Stand 2024). Alle
  // Maße stammen aus dem OOXML des Originals (Twips ÷ 56,6929 = mm):
  // A4, Times New Roman 11 pt, KEIN Wappen, Ränder oben/unten 10, links 25,
  // rechts 15. Am Layout bitte nichts „verschönern" – das Formular muss so
  // aussehen wie der Papiervordruck.
  const VG = {
    L: 25, R: 195, W: 170,          // Satzspiegel
    TOP: 10, BOTTOM: 287,
    LH: 4.46,                        // Zeilenabstand 11 pt einfach
    LH14: 5.68,                      // Zeilenabstand 14 pt (Titel)
    T1: { w: 165.4, c: [101.9, 63.5], kopfH: 9.24, zeileH: 7.41, zeilen: 4 },
    T2: {
      w: 168.6,
      c: [40.92, 10.23, 9.52, 9.52, 9.52, 9.52, 9.52, 9.52, 19.05, 19.05, 22.22],
      kopfH: [10.58, 5.82, 8.48], zeileH: 7.06, zeilen: 5,
    },
    STRICH: 0.35,                    // Tabellenrahmen (Word: single, sz 8 = 1 pt)
  };
  const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  function vgFont(doc, size, bold) {
    doc.setFont('times', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
  }
  // Stunden knapp: 7,5 statt 7,50 – die Tagesspalten sind nur 9,5 mm breit.
  function stdKurz(n) {
    const v = Number(n) || 0;
    if (!v) return '';
    return v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  }
  const betragFmt = (n) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // opts.target: 'download' (Standard) | 'paperless'; opts.onUploaded (Paperless).
  function buildVgFormular(abr, opts = {}) {
    if (!abr) return;
    const doc = newDoc(); if (!doc) return;
    const settings = store.getSettings();
    const cfg = settings.auslagen || {};
    const ort = settings.ortsname || '';
    const arbeiter = store.getArbeiter(abr.arbeiterId) || {};

    const arbeiten = M.abrechnungArbeiten(abr);
    const wochen = M.abrechnungWochenzeilen(abr);
    const kosten = (abr.kostenerstattungen || []).filter(k => k);

    // Der Vordruck fasst 4 Tätigkeiten und 5 Wochenzeilen. Reicht das nicht
    // (ein Monat berührt 5–6 Kalenderwochen, gemischte Sätze splitten eine
    // Woche auf zwei Zeilen), werden weitere Blätter im selben Layout gedruckt.
    // Arbeitslohn, Kostenerstattungen und Unterschrift stehen nur auf dem
    // letzten Blatt.
    const blaetter = Math.max(1,
      Math.ceil(arbeiten.length / VG.T1.zeilen),
      Math.ceil(wochen.length / VG.T2.zeilen));

    for (let b = 0; b < blaetter; b++) {
      if (b > 0) doc.addPage();
      zeichneBlatt(doc, {
        abr, arbeiter, ort, cfg, kosten,
        arbeiten: arbeiten.slice(b * VG.T1.zeilen, (b + 1) * VG.T1.zeilen),
        wochen: wochen.slice(b * VG.T2.zeilen, (b + 1) * VG.T2.zeilen),
        letztes: b === blaetter - 1,
        blatt: b + 1, blaetter,
      });
    }

    const safe = M.arbeiterName(arbeiter).replace(/[^\wäöüÄÖÜß ]+/g, '').replace(/\s+/g, '_').slice(0, 30);
    const monat = M.monatsSchluessel(abr.zeitraumVon) || (abr.zeitraumBis || '');
    const filename = `Lohnabrechnung-${safe}-${monat}.pdf`;
    if (opts.target === 'paperless') {
      GR.ui.savePdfToPaperless(doc, filename, {
        prefillTitle: 'Lohnabrechnung ' + M.arbeiterName(arbeiter) + ' ' + M.monatsLabel(abr.zeitraumVon),
        onUploaded: opts.onUploaded,
      });
    } else openPdf(doc, filename);
  }

  function zeichneBlatt(doc, ctx) {
    const { abr, arbeiter, ort, cfg, arbeiten, wochen, kosten, letztes, blatt, blaetter } = ctx;
    const st = { y: VG.TOP + 4 };
    const zeile = (n) => { st.y += (n || 1) * VG.LH; };

    // Beschriftetes Feld mit Ausfülllinie über die restliche Zeilenbreite.
    function feld(label, wert, bisX) {
      vgFont(doc, 11, false);
      text(doc, label, VG.L, st.y);
      const x = VG.L + doc.getTextWidth(winAnsi(label)) + 2;
      const ende = bisX || VG.R;
      doc.setDrawColor(0); doc.setLineWidth(0.2);
      doc.line(x, st.y + 1.2, ende, st.y + 1.2);
      if (wert) text(doc, String(wert), x + 1.5, st.y);
      zeile();
    }

    // --- Kopf ---
    feld('ORTSGEMEINDE:', ort);
    zeile();

    vgFont(doc, 14, false);
    text(doc, 'L o h n a b r e c h n u n g', VG.L + VG.W / 2, st.y, { align: 'center' });
    st.y += VG.LH14;
    vgFont(doc, 14, true);
    text(doc, '====================', VG.L + VG.W / 2, st.y, { align: 'center' });
    st.y += VG.LH14;
    zeile();

    if (blaetter > 1) {
      vgFont(doc, 9, false);
      text(doc, `Blatt ${blatt} von ${blaetter}`, VG.R, VG.TOP + 4, { align: 'right' });
    }

    feld('Abrechnungszeitraum:', formatDatum(abr.zeitraumVon) + ' – ' + formatDatum(abr.zeitraumBis));
    zeile();

    // --- Anschrift (Label + 4 freie Zeilen wie im Vordruck) ---
    vgFont(doc, 11, false);
    text(doc, 'Anschrift des Arbeitnehmers:', VG.L, st.y);
    zeile();
    const anschrift = [
      M.arbeiterName(arbeiter),
      M.arbeiterZusatz(arbeiter),
      arbeiter.strasse || '',
      [arbeiter.plz, arbeiter.ort].filter(Boolean).join(' '),
    ].filter(Boolean).slice(0, 4);
    for (const z of anschrift) { text(doc, z, VG.L + 6, st.y); zeile(); }
    zeile(4 - anschrift.length);

    // Bankverbindung: IBAN, Kontoinhaber nur wenn er abweicht.
    const inhaber = (arbeiter.kontoinhaber || '').trim();
    const eigen = inhaber && inhaber.toLowerCase() !== M.arbeiterName(arbeiter).toLowerCase();
    feld('Bankverbindung:', arbeiter.iban
      ? M.formatIban(arbeiter.iban) + (eigen ? '  (Kontoinhaber: ' + inhaber + ')' : '')
      : '');
    zeile(2);

    // --- Tabelle 1: durchgeführte Arbeiten ---
    tabelle1(doc, st, arbeiten);
    zeile();

    vgFont(doc, 11, false);
    text(doc, 'Arbeitszeit:', VG.L, st.y); zeile();
    text(doc, '=========', VG.L, st.y); zeile();
    zeile();

    // --- Tabelle 2: Arbeitszeit je Woche (Wochen ohne Arbeit kommen erst gar
    // nicht vor – die Zeilen entstehen nur aus erfassten Positionen) ---
    tabelle2(doc, st, wochen);
    zeile();

    if (!letztes) return;

    // --- Arbeitslohn insgesamt ---
    vgFont(doc, 11, true);
    text(doc, 'Arbeitslohn insgesamt:', VG.L, st.y);
    text(doc, betragFmt(abr.summeBetrag) + ' €', VG.R, st.y, { align: 'right' });
    zeile();
    text(doc, '==========', VG.R, st.y, { align: 'right' });
    zeile();

    // --- Sonstige Kostenerstattungen (unterstrichene Überschrift) ---
    vgFont(doc, 11, false);
    const ueber = 'Sonstige Kostenerstattungen (z. B. für Maschineneinsatz)';
    text(doc, ueber, VG.L, st.y);
    doc.setDrawColor(0); doc.setLineWidth(0.2);
    doc.line(VG.L, st.y + 1, VG.L + doc.getTextWidth(winAnsi(ueber)), st.y + 1);
    zeile();
    let freieZeilen = 4;
    for (const k of kosten.slice(0, 4)) {
      text(doc, k.beschreibung || '—', VG.L + 6, st.y);
      text(doc, betragFmt(k.betrag) + ' €', VG.R, st.y, { align: 'right' });
      zeile(); freieZeilen--;
    }
    if (kosten.length > 1) {
      vgFont(doc, 11, true);
      text(doc, betragFmt(M.abrechnungKostenSumme(abr)) + ' €', VG.R, st.y, { align: 'right' });
      zeile(); freieZeilen--;
    }
    zeile(Math.max(0, freieZeilen));

    // --- Ort, Datum ---
    vgFont(doc, 11, false);
    doc.setDrawColor(0); doc.setLineWidth(0.2);
    const ortBis = VG.L + 52;
    doc.line(VG.L, st.y + 1.2, ortBis, st.y + 1.2);
    if (ort) text(doc, ort, VG.L + 1.5, st.y);
    text(doc, ', den', ortBis + 2, st.y);
    const datVon = ortBis + 2 + doc.getTextWidth(winAnsi(', den')) + 2;
    doc.line(datVon, st.y + 1.2, datVon + 32, st.y + 1.2);
    text(doc, formatDatum(abr.erstelltAm), datVon + 1.5, st.y);
    zeile(4);

    // --- Unterschrift Ortsbürgermeister/in ---
    const sigX = VG.L, sigB = 43;
    if (cfg.unterschriftDataUrl) {
      try {
        const maxW = 44, maxH = 15;
        let w = maxW, h = maxH;
        if (cfg.unterschriftW > 0 && cfg.unterschriftH > 0) {
          const r = Math.min(maxW / cfg.unterschriftW, maxH / cfg.unterschriftH);
          w = cfg.unterschriftW * r; h = cfg.unterschriftH * r;
        }
        doc.addImage(cfg.unterschriftDataUrl,
          String(cfg.unterschriftDataUrl).includes('image/png') ? 'PNG' : 'JPEG',
          sigX, st.y - h - 0.5, w, h, undefined, 'SLOW');
      } catch (_) {}
    }
    doc.setDrawColor(0); doc.setLineWidth(0.2);
    doc.line(sigX, st.y + 1.2, sigX + sigB, st.y + 1.2);
    zeile();
    vgFont(doc, 11, false);
    text(doc, '  - Ortsbürgermeister/in -', VG.L, st.y);
  }

  // Rahmen + Text einer Zelle; gibt nichts zurück, zeichnet nur.
  function zelle(doc, x, y, w, h, inhalt, o = {}) {
    doc.setDrawColor(0); doc.setLineWidth(VG.STRICH);
    doc.rect(x, y, w, h);
    if (inhalt == null || inhalt === '') return;
    const zeilen = Array.isArray(inhalt) ? inhalt : [inhalt];
    vgFont(doc, o.size || 10, !!o.bold);
    const lh = (o.size || 10) * 0.4;
    // vertikal: 'bottom' (Vordruck-Standard) | 'center' | 'top'
    let ty;
    if (o.valign === 'center') ty = y + h / 2 - (zeilen.length - 1) * lh / 2 + lh * 0.35;
    else if (o.valign === 'top') ty = y + 1.2 + lh;
    else ty = y + h - 1.5 - (zeilen.length - 1) * lh;
    for (const z of zeilen) {
      const tx = o.align === 'center' ? x + w / 2 : o.align === 'right' ? x + w - 1.5 : x + 1.5;
      text(doc, z, tx, ty, o.align && o.align !== 'left' ? { align: o.align } : undefined);
      ty += lh;
    }
  }

  function tabelle1(doc, st, arbeiten) {
    const [c0, c1] = VG.T1.c;
    let y = st.y - 3;
    zelle(doc, VG.L, y, c0, VG.T1.kopfH, 'Bezeichnung der durchgeführten Arbeiten', { valign: 'center' });
    zelle(doc, VG.L + c0, y, c1, VG.T1.kopfH, ['hierauf entfallende', 'Arbeitsstunden']);
    y += VG.T1.kopfH;
    for (let i = 0; i < VG.T1.zeilen; i++) {
      const a = arbeiten[i];
      zelle(doc, VG.L, y, c0, VG.T1.zeileH, a ? a.taetigkeit : '');
      zelle(doc, VG.L + c0, y, c1, VG.T1.zeileH, a ? stdKurz(a.stunden) : '', { align: 'right' });
      y += VG.T1.zeileH;
    }
    st.y = y + 3;
  }

  function tabelle2(doc, st, wochen) {
    const c = VG.T2.c;
    const x = (i) => VG.L + c.slice(0, i).reduce((s, v) => s + v, 0);
    const [h0, h1, h2] = VG.T2.kopfH;
    let y = st.y - 3;

    // Kopf: links über alle drei Kopfzeilen verbundene Zeitraum-Zelle, oben
    // rechts die (im Original leere) Bannerzelle.
    zelle(doc, VG.L, y, c[0], h0 + h1 + h2, ['', 'Zeitraum', '(Woche vom ___', 'bis ___)'], { size: 9.5, valign: 'top' });
    zelle(doc, x(1), y, VG.T2.w - c[0], h0, '');
    y += h0;
    zelle(doc, x(1), y, c.slice(1, 8).reduce((s, v) => s + v, 0), h1, 'Arbeitsstunden pro Tag', { size: 9.5, align: 'center', valign: 'center' });
    zelle(doc, x(8), y, c[8], h1 + h2, ['Stunden', 'pro', 'Woche'], { size: 9, align: 'center' });
    zelle(doc, x(9), y, c[9], h1 + h2, ['Entgelt', 'pro', 'Stunde'], { size: 9, align: 'center' });
    zelle(doc, x(10), y, c[10], h1 + h2, ['Entgelt', 'pro', 'Woche'], { size: 9, align: 'center' });
    y += h1;
    for (let i = 0; i < 7; i++) zelle(doc, x(1 + i), y, c[1 + i], h2, TAGE[i], { size: 9.5, align: 'center', valign: 'center' });
    y += h2;

    for (let i = 0; i < Math.max(VG.T2.zeilen, wochen.length); i++) {
      const w = wochen[i];
      const kurz = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
      zelle(doc, VG.L, y, c[0], VG.T2.zeileH,
        w ? kurz(w.von) + '–' + kurz(w.bis) + w.bis.slice(0, 4) : '', { size: 9.5 });
      for (let d = 0; d < 7; d++) {
        zelle(doc, x(1 + d), y, c[1 + d], VG.T2.zeileH, w ? stdKurz(w.tage[d]) : '', { size: 9.5, align: 'center' });
      }
      zelle(doc, x(8), y, c[8], VG.T2.zeileH, w ? stdKurz(w.stunden) : '', { size: 9.5, align: 'right' });
      zelle(doc, x(9), y, c[9], VG.T2.zeileH, w ? betragFmt(w.satz) : '', { size: 9.5, align: 'right' });
      zelle(doc, x(10), y, c[10], VG.T2.zeileH, w ? betragFmt(w.betrag) : '', { size: 9.5, align: 'right' });
      y += VG.T2.zeileH;
    }
    st.y = y + 3;
  }

  GR.arbeitszeitenPdf = { buildVorlaeufigeAbrechnung, buildVgFormular };
})();
