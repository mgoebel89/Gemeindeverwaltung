(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { fullNameMieter, anzahlTage, berechneGesamt, istPauschal } = GR.models;
  const { formatDatum, toast } = GR.ui;

  // --- Layout-Konstanten (mm, A4 hochkant) ---
  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN_X = 22;
  const MARGIN_TOP = 22;
  const RIGHT_X = PAGE_W - MARGIN_X;
  const CONTENT_W = PAGE_W - 2 * MARGIN_X;
  const C_TEXT = [0, 0, 0];
  const C_MUTED = [90, 90, 90];

  function euro(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
  function num(n) { return (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 3 }); }

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

  // Schreibt (ggf. umgebrochenen) Text ab state.y, links.
  function line(doc, state, text, opts = {}) {
    const { size = 11, bold = false, italic = false, color, indent = 0, gap = 5.6, maxWidth = CONTENT_W - indent } = opts;
    setFont(doc, size, bold, italic, color);
    const lines = doc.splitTextToSize(String(text ?? ''), maxWidth);
    for (const ln of lines) { doc.text(ln, MARGIN_X + indent, state.y); state.y += gap; }
  }
  function gap(state, mm) { state.y += mm; }

  function checkbox(doc, x, y, size, checked) {
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
    doc.rect(x, y, size, size, 'S');
    if (checked) {
      doc.setLineWidth(0.55); const m = 0.9;
      doc.line(x + m, y + m, x + size - m, y + size - m);
      doc.line(x + size - m, y + m, x + m, y + size - m);
    }
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

  function mieterAnschrift(m) {
    if (!m) return '';
    return [m.strasse, [m.plz, m.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }

  // Bürgermeister-Unterschrift (aus den Bargeldauslagen-Einstellungen)
  // mittig über eine Signaturlinie legen. Ohne hinterlegtes Bild passiert nichts.
  function drawBuergermeisterSignatur(doc, centerX, lineY) {
    const cfg = (store.getSettings().auslagen) || {};
    if (!cfg.unterschriftDataUrl) return;
    try {
      const fmt = cfg.unterschriftDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(cfg.unterschriftDataUrl, fmt, centerX - 22, lineY - 16, 44, 15, undefined, 'SLOW');
    } catch (_) {}
  }

  function zeitraumText(v) {
    if (!v.startDatum) return '';
    if (!v.endDatum || v.endDatum === v.startDatum) return formatDatum(v.startDatum);
    return formatDatum(v.startDatum) + ' bis ' + formatDatum(v.endDatum);
  }

  // Ablesedatum = Tag nach der Nutzung. Bevorzugt das Abrechnungsdatum,
  // sonst Enddatum + 1 Tag.
  function ablesedatum(v) {
    if (v.abrechnungDatum) return formatDatum(v.abrechnungDatum);
    if (v.endDatum) {
      const [y, m, d] = v.endDatum.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + 1);
      return formatDatum(dt.toISOString().slice(0, 10));
    }
    return '';
  }

  // ================================================================ Mietvertrag
  function buildMietvertrag(v) {
    const doc = newDoc(); if (!doc) return;
    const settings = store.getSettings();
    const vm = settings.vermietung;
    const raum = store.getRaum(v.raumId) || { name: 'Gemeindehaus', preise: { stromProKwh: 0, gasProCbm: 0 } };
    const mieter = store.getMieter(v.mieterId);
    const wappen = getWappenDataUrl();
    const preise = v.preisSnapshot || { grundMiete: 0, stromProKwh: raum.preise.stromProKwh, gasProCbm: raum.preise.gasProCbm };

    const state = { y: MARGIN_TOP };

    // Kopf: Titel links, Wappen + Absender rechts
    if (wappen) {
      try { doc.addImage(wappen, 'PNG', RIGHT_X - 20, state.y - 2, 20, 24, undefined, 'SLOW'); } catch (_) {}
    }
    setFont(doc, 26, true);
    doc.text('Mietvertrag', MARGIN_X, state.y + 12);

    // Absenderblock rechts (unter dem Wappen)
    let ry = state.y + 26;
    setFont(doc, 9, false, false, C_MUTED);
    doc.text('Ortsgemeinde ' + (vm.ortsgemeinde || ''), RIGHT_X, ry, { align: 'right' }); ry += 5;
    setFont(doc, 9, false);
    doc.text(vm.buergermeister || '', RIGHT_X, ry, { align: 'right' }); ry += 4;
    for (const l of String(vm.anschrift || '').split(/\r?\n/)) { doc.text(l, RIGHT_X, ry, { align: 'right' }); ry += 4; }
    if (vm.telefon) { doc.text('Tel: ' + vm.telefon, RIGHT_X, ry, { align: 'right' }); ry += 4; }
    if (vm.email) { doc.text('Mail: ' + vm.email, RIGHT_X, ry, { align: 'right' }); ry += 4; }

    // Vertragstext links
    state.y += 24;
    line(doc, state, `Zwischen der Ortsgemeinde ${vm.ortsgemeinde || ''},`);
    line(doc, state, `vertr. durch ${vm.buergermeister || ''}, Ortsbürgermeister/in`);
    line(doc, state, '(Vermieter)');
    gap(state, 3);
    line(doc, state, 'und');
    gap(state, 3);
    line(doc, state, mieter ? (fullNameMieter(mieter) + (mieterAnschrift(mieter) ? ', ' + mieterAnschrift(mieter) : '')) : '________________________', { bold: true });
    line(doc, state, '(Mieter)');
    gap(state, 3);
    line(doc, state, `über die Benutzung und Gebührenerhebung für das ${raum.name} ${vm.ortsgemeinde || ''} wird der folgende Vertrag abgeschlossen.`);
    gap(state, 3);
    line(doc, state, `Für die Benutzung des ${raum.name} am ${zeitraumText(v) || '____________'} sind folgende Gebühren zu zahlen:`);
    gap(state, 2);
    line(doc, state, `Saalmiete: ${euro(preise.grundMiete)}`, { bold: true });
    gap(state, 2);

    if (istPauschal(raum)) {
      // Pauschalmiete: Strom und Gas sind enthalten, kein Zählerstand.
      line(doc, state, 'Strom und Gas sind in der Miete enthalten; eine gesonderte Abrechnung der Verbrauchskosten erfolgt nicht.');
      gap(state, 3);
    } else {
      line(doc, state, 'Neben der Miete sind die tatsächlichen Kosten für Gas und Strom zu erstatten. Dabei werden folgende Kosten in Rechnung gestellt:');
      gap(state, 1);
      line(doc, state, `Strom: ${euro(preise.stromProKwh)}/kWh`);
      line(doc, state, `Gas: ${euro(preise.gasProCbm)}/cbm`);
      gap(state, 3);

      // Tabelle Zählerstand vor der Nutzung
      const z = v.zaehler || {};
      const tblX = MARGIN_X, tblW = 110, rowH = 8, col1 = 30;
      const th = state.y;
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
      // Kopfzeile
      doc.rect(tblX, th, col1, rowH, 'S');
      doc.rect(tblX + col1, th, tblW - col1, rowH, 'S');
      setFont(doc, 10, false);
      doc.text('Zählerstand vor der Nutzung', tblX + col1 + 3, th + rowH - 2.6);
      // Strom
      doc.rect(tblX, th + rowH, col1, rowH, 'S');
      doc.rect(tblX + col1, th + rowH, tblW - col1, rowH, 'S');
      doc.text('Strom', tblX + 3, th + rowH + rowH - 2.6);
      doc.text((z.stromStart != null ? num(z.stromStart) : '') + '  kWh', tblX + col1 + 3, th + rowH + rowH - 2.6);
      // Gas
      doc.rect(tblX, th + 2 * rowH, col1, rowH, 'S');
      doc.rect(tblX + col1, th + 2 * rowH, tblW - col1, rowH, 'S');
      doc.text('Gas', tblX + 3, th + 2 * rowH + rowH - 2.6);
      doc.text((z.gasStart != null ? num(z.gasStart) : '') + '  cbm', tblX + col1 + 3, th + 2 * rowH + rowH - 2.6);
      state.y = th + 3 * rowH + 6;
    }

    line(doc, state, `Der Mieter erkennt die Satzung der Ortsgemeinde ${vm.ortsgemeinde || ''} über die Benutzung des Gemeindehauses und die Erhebung der Gebühren vom ${vm.satzungsDatum || ''} an.`);
    gap(state, 1);
    line(doc, state, 'Eine Kaution entfällt.');
    gap(state, 1);
    line(doc, state, 'Die Gesamtabrechnung wird nach der Nutzung erstellt und ausgehändigt.');
    gap(state, 8);
    line(doc, state, `${vm.ortsgemeinde || ''}, den ${v.vertragDatum ? formatDatum(v.vertragDatum) : ''}`);

    // Unterschriftszeilen
    gap(state, 22);
    const colW = CONTENT_W / 2 - 8;
    // Unterschriftsbild des Bürgermeisters über die linke (Vermieter-)Linie
    drawBuergermeisterSignatur(doc, MARGIN_X + colW / 2, state.y);
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4);
    doc.line(MARGIN_X, state.y, MARGIN_X + colW, state.y);
    doc.line(RIGHT_X - colW, state.y, RIGHT_X, state.y);
    setFont(doc, 9, false, false, C_MUTED);
    doc.text(vm.buergermeister || '', MARGIN_X, state.y + 5);
    doc.text(mieter ? fullNameMieter(mieter) : 'Mieter', RIGHT_X - colW, state.y + 5);

    openPdf(doc, `Mietvertrag-${v.startDatum || ''}.pdf`);
  }

  // =================================================== Kostenabrechnungsbogen
  function amountRow(doc, state, label, opts = {}) {
    const { amount, percentText, mid, bold = false, gap: g = 7 } = opts;
    setFont(doc, 10.5, bold);
    doc.text(String(label), MARGIN_X, state.y);
    if (mid) { setFont(doc, 10, false); doc.text(mid, PAGE_W - MARGIN_X - 40, state.y, { align: 'right' }); }
    if (percentText) { setFont(doc, 10, false); doc.text(percentText, PAGE_W - MARGIN_X - 40, state.y, { align: 'right' }); }
    if (amount != null) { setFont(doc, 10.5, bold); doc.text(amount, RIGHT_X, state.y, { align: 'right' }); }
    state.y += g;
  }

  function buildKostenabrechnung(v) {
    const doc = newDoc(); if (!doc) return;
    const settings = store.getSettings();
    const vm = settings.vermietung;
    const raum = store.getRaum(v.raumId) || { name: 'Gemeindehaus', kostenbogenTyp: 'gemeindehaus', preise: {} };
    const mieter = store.getMieter(v.mieterId);
    const g = berechneGesamt(v, raum);
    const snap = v.preisSnapshot || { stromProKwh: raum.preise.stromProKwh || 0, gasProCbm: raum.preise.gasProCbm || 0 };

    const state = { y: MARGIN_TOP };

    setFont(doc, 13, true, true);
    doc.text('Ortsgemeinde ' + (vm.ortsgemeinde || '') + ',', MARGIN_X, state.y);
    state.y += 10;
    setFont(doc, 18, true);
    doc.text('Kostenabrechnungsbogen', PAGE_W / 2, state.y, { align: 'center' });
    state.y += 12;

    setFont(doc, 10, false);
    for (const l of String(vm.vgEmpfaenger || '').split(/\r?\n/)) { doc.text(l, MARGIN_X, state.y); state.y += 4.6; }
    state.y += 6;

    line(doc, state, `Abrechnung für die Benutzung des/r Bürgerhauses/Grillhütte in ${vm.ortsgemeinde || ''}`, { bold: true });
    gap(state, 2);
    line(doc, state, 'Mieter/Nutzer: ' + (mieter ? fullNameMieter(mieter) : ''));
    line(doc, state, 'Anschrift: ' + mieterAnschrift(mieter));
    line(doc, state, 'Anlass: ' + (v.anlass || ''));
    gap(state, 1);

    // Ankreuzzeile Objekt
    const typ = raum.kostenbogenTyp || 'gemeindehaus';
    setFont(doc, 10.5, false);
    let cx = MARGIN_X;
    const cbSize = 4;
    doc.text('Für die Benutzung des/r Gemeindehauses', cx, state.y); cx += doc.getTextWidth('Für die Benutzung des/r Gemeindehauses') + 2;
    checkbox(doc, cx, state.y - 3.4, cbSize, typ === 'gemeindehaus'); cx += cbSize + 3;
    doc.text('/ Grillhütte', cx, state.y); cx += doc.getTextWidth('/ Grillhütte') + 2;
    checkbox(doc, cx, state.y - 3.4, cbSize, typ === 'grillhuette'); cx += cbSize + 3;
    doc.text('/ Sonstiges', cx, state.y); cx += doc.getTextWidth('/ Sonstiges') + 2;
    checkbox(doc, cx, state.y - 3.4, cbSize, typ === 'sonstiges');
    state.y += 7;
    if (typ === 'sonstiges') { line(doc, state, 'Sonstiges: ' + raum.name); }
    line(doc, state, 'in ' + (vm.ortsgemeinde || ''));

    const tage = anzahlTage(v.startDatum, v.endDatum);
    line(doc, state, `für die Dauer vom ${v.startDatum ? formatDatum(v.startDatum) : '________'} bis ${v.endDatum ? formatDatum(v.endDatum) : '________'} insgesamt ${tage || 0} Tag/e`);
    gap(state, 1);
    line(doc, state, 'anlässlich der oben aufgeführten Veranstaltung stellen wir Ihnen folgende Benutzungsgebühren und Nebenkosten in Rechnung:');
    gap(state, 3);

    amountRow(doc, state, 'Benutzungsgebühren', { amount: euro(g.grundMiete) });
    amountRow(doc, state, 'Auswärtigenzuschlag', { percentText: '0,00 %', amount: euro(0) });
    amountRow(doc, state, '- Nebenkosten für:', {});
    const abgelesen = ablesedatum(v);
    amountRow(doc, state, 'Wasser: Stand:', { mid: 'cbm x ' + euro(0), amount: euro(0) });
    amountRow(doc, state, `Strom: Stand: ${abgelesen}`, { mid: `${num(g.stromMenge)} kWh x ` + euro(snap.stromProKwh), amount: euro(g.stromKosten) });
    amountRow(doc, state, `Gas: Stand: ${abgelesen}`, { mid: `${num(g.gasMenge)} cbm x ` + euro(snap.gasProCbm), amount: euro(g.gasKosten) });
    amountRow(doc, state, 'Heizung: Stand:', { mid: 'ltr. x ' + euro(0), amount: euro(0) });
    amountRow(doc, state, 'Reinigungspauschale:', { amount: euro(0) });
    amountRow(doc, state, 'Sonstiges:', { amount: euro(0), gap: 4 });
    line(doc, state, '(z.B. Küchennutzung, Beschallungsanlage, Verbrauchsgüter u.ä.)', { size: 8.5, color: C_MUTED, gap: 6 });
    // Freie Zusatzposten (tatsächlich berechnet) darunter auflisten
    for (const p of (v.zusatzposten || [])) {
      amountRow(doc, state, (p.bezeichnung || 'Sonstiges') + ':', { amount: euro(p.betrag) });
    }

    gap(state, 2);
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.line(MARGIN_X, state.y, RIGHT_X, state.y);
    state.y += 7;
    amountRow(doc, state, 'Gesamtbetrag:', { amount: euro(g.gesamt), bold: true });

    gap(state, 4);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_X, state.y, RIGHT_X, state.y);
    state.y += 6;
    line(doc, state, 'sachlich und rechnerisch richtig', { size: 10 });
    gap(state, 16);
    // Unterschriftsbild des Bürgermeisters über die Signaturlinie
    drawBuergermeisterSignatur(doc, MARGIN_X + 35, state.y);
    doc.setLineWidth(0.4);
    doc.line(MARGIN_X, state.y, MARGIN_X + 70, state.y);
    setFont(doc, 9, false, false, C_MUTED);
    doc.text(vm.buergermeister || '', MARGIN_X, state.y + 5);

    openPdf(doc, `Kostenabrechnung-${v.startDatum || ''}.pdf`);
  }

  GR.vermietungPdf = { buildMietvertrag, buildKostenabrechnung };
})();
