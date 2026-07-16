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

  // Bild von einer URL als Data-URL + Maße laden (für Beanstandungsfotos).
  function loadImage(url, mimetype) {
    return new Promise((resolve, reject) => {
      fetch(url).then(r => r.blob()).then(blob => {
        const fr = new FileReader();
        fr.onload = () => {
          const img = new Image();
          img.onload = () => resolve({ dataUrl: fr.result, w: img.naturalWidth, h: img.naturalHeight, format: (mimetype || blob.type || '').includes('png') ? 'PNG' : 'JPEG' });
          img.onerror = reject;
          img.src = fr.result;
        };
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      }).catch(reject);
    });
  }

  // Ein Unterschriftsbild (Data-URL) mittig über eine Signaturlinie legen.
  // Sind die Pixelmaße (opts.natW/natH) bekannt, wird das Bild
  // seitenverhältnistreu in die Maximalbox (maxW×maxH mm) eingepasst –
  // sonst als fester Kasten gezeichnet (Rückfall / Bürgermeisterbild).
  function drawSignatureImage(doc, dataUrl, centerX, lineY, opts = {}) {
    if (!dataUrl) return;
    const maxW = opts.maxW || 44, maxH = opts.maxH || 15;
    let w = maxW, h = maxH;
    if (opts.natW > 0 && opts.natH > 0) {
      const r = Math.min(maxW / opts.natW, maxH / opts.natH);
      w = opts.natW * r; h = opts.natH * r;
    }
    try {
      const fmt = String(dataUrl).includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(dataUrl, fmt, centerX - w / 2, lineY - h - 1, w, h, undefined, 'SLOW');
    } catch (_) {}
  }

  // Bürgermeister-Unterschrift (aus den Bargeldauslagen-Einstellungen) mittig
  // über eine Signaturlinie legen. Sind die Maße hinterlegt (direkt
  // unterschrieben oder neu hochgeladen), wird seitenverhältnistreu
  // eingepasst; ältere Bilder ohne Maße bleiben beim festen Kasten.
  function drawBuergermeisterSignatur(doc, centerX, lineY) {
    const cfg = (store.getSettings().auslagen) || {};
    drawSignatureImage(doc, cfg.unterschriftDataUrl, centerX, lineY, {
      natW: cfg.unterschriftW, natH: cfg.unterschriftH, maxW: 44, maxH: 15,
    });
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
  // opts.target: 'download' (Standard) oder 'paperless'; opts.prefillTitle/onUploaded
  // werden bei 'paperless' durchgereicht.
  function buildMietvertrag(v, opts = {}) {
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
    // Live erfasste Mieter-Unterschrift über die rechte (Mieter-)Linie
    const mSig = v.mieterUnterschrift;
    if (mSig && mSig.dataUrl) drawSignatureImage(doc, mSig.dataUrl, RIGHT_X - colW / 2, state.y, { natW: mSig.w, natH: mSig.h, maxW: 55, maxH: 18 });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4);
    doc.line(MARGIN_X, state.y, MARGIN_X + colW, state.y);
    doc.line(RIGHT_X - colW, state.y, RIGHT_X, state.y);
    setFont(doc, 9, false, false, C_MUTED);
    doc.text(vm.buergermeister || '', MARGIN_X, state.y + 5);
    doc.text(mieter ? fullNameMieter(mieter) : 'Mieter', RIGHT_X - colW, state.y + 5);
    if (mSig && mSig.dataUrl && mSig.datum) {
      setFont(doc, 8, false, false, C_MUTED);
      doc.text('unterschrieben am ' + formatDatum(mSig.datum), RIGHT_X - colW, state.y + 9);
    }

    const filename = `Mietvertrag-${v.startDatum || ''}.pdf`;
    if (opts.target === 'paperless') {
      GR.ui.savePdfToPaperless(doc, filename, { prefillTitle: opts.prefillTitle, onUploaded: opts.onUploaded });
    } else {
      openPdf(doc, filename);
    }
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

  function buildKostenabrechnung(v, opts = {}) {
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

    const filename = `Kostenabrechnung-${v.startDatum || ''}.pdf`;
    if (opts.target === 'paperless') {
      GR.ui.savePdfToPaperless(doc, filename, { prefillTitle: opts.prefillTitle, onUploaded: opts.onUploaded });
    } else {
      openPdf(doc, filename);
    }
  }

  // ============================================= Übergabe-/Abnahmeprotokoll
  // type: 'uebergabe' | 'abnahme'. opts.target='paperless' legt direkt ab.
  async function buildUebergabeprotokoll(v, type, opts = {}) {
    const doc = newDoc(); if (!doc) return;
    const proto = v.protokolle && v.protokolle[type];
    if (!proto) { toast('Für diese Vermietung ist kein Protokoll angelegt.'); return; }
    const s = store.getSettings();
    const vm = s.vermietung || {};
    const ortsname = s.ortsname || '';
    const raum = store.getRaum(v.raumId);
    const mieter = store.getMieter(v.mieterId);
    const state = { y: MARGIN_TOP };

    const wappen = getWappenDataUrl();
    if (wappen) { try { doc.addImage(wappen, 'PNG', RIGHT_X - 22, MARGIN_TOP - 6, 22, 22, undefined, 'SLOW'); } catch (_) {} }

    const titel = type === 'uebergabe' ? 'Übergabeprotokoll' : 'Abnahmeprotokoll';
    line(doc, state, titel, { size: 16, bold: true });
    line(doc, state, ortsname ? 'Ortsgemeinde ' + ortsname : 'Ortsgemeinde', { size: 10, color: C_MUTED, gap: 6 });
    gap(state, 2);
    line(doc, state, 'Objekt: ' + (raum ? raum.name : '—'), { size: 11 });
    line(doc, state, 'Mieter: ' + (mieter ? fullNameMieter(mieter) : '—') + (mieterAnschrift(mieter) ? ', ' + mieterAnschrift(mieter) : ''), { size: 11 });
    line(doc, state, 'Nutzungszeitraum: ' + (zeitraumText(v) || '—'), { size: 11 });
    line(doc, state, 'Protokolldatum: ' + (proto.datum ? formatDatum(proto.datum) : '—'), { size: 11 });
    gap(state, 3);

    const beanstandungen = [];
    (proto.punkte || []).forEach(p => {
      if (state.y > PAGE_H - 28) { doc.addPage(); state.y = MARGIN_TOP; }
      const y0 = state.y - 3.2;
      checkbox(doc, MARGIN_X, y0, 3.6, p.status === 'ok');
      setFont(doc, 9, false); doc.text('OK', MARGIN_X + 5, state.y - 0.4);
      checkbox(doc, MARGIN_X + 15, y0, 3.6, p.status === 'nichtok');
      setFont(doc, 9, false); doc.text('nicht OK', MARGIN_X + 20, state.y - 0.4);
      line(doc, state, p.text || '', { size: 10.5, indent: 42, gap: 5.4, maxWidth: CONTENT_W - 42 });
      if (p.status === 'nichtok' && p.notiz) line(doc, state, '↳ ' + p.notiz, { size: 9.5, italic: true, color: C_MUTED, indent: 42 });
      if (p.status === 'nichtok' && p.fotoId) beanstandungen.push(p);
      gap(state, 1.4);
    });

    if (state.y > PAGE_H - 42) { doc.addPage(); state.y = MARGIN_TOP; }
    gap(state, 14);
    const lineY = state.y;
    const colW = 66;
    drawBuergermeisterSignatur(doc, MARGIN_X + colW / 2, lineY);
    // Live erfasste Mieter-Unterschrift über die rechte Linie
    const pSig = proto.mieterUnterschrift;
    if (pSig && pSig.dataUrl) drawSignatureImage(doc, pSig.dataUrl, RIGHT_X - colW / 2, lineY, { natW: pSig.w, natH: pSig.h, maxW: 55, maxH: 18 });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4);
    doc.line(MARGIN_X, lineY, MARGIN_X + colW, lineY);
    doc.line(RIGHT_X - colW, lineY, RIGHT_X, lineY);
    setFont(doc, 9, false, false, C_MUTED);
    doc.text('Ortsgemeinde (' + (vm.buergermeister || 'Bürgermeister/in') + ')', MARGIN_X, lineY + 5);
    doc.text(mieter ? fullNameMieter(mieter) : 'Mieter/in', RIGHT_X - colW, lineY + 5);
    if (pSig && pSig.dataUrl && pSig.datum) {
      setFont(doc, 8, false, false, C_MUTED);
      doc.text('unterschrieben am ' + formatDatum(pSig.datum), RIGHT_X - colW, lineY + 9);
    }

    for (const p of beanstandungen) {
      try {
        const img = await loadImage(store.vermietungFotoUrl(p.fotoId));
        doc.addPage();
        setFont(doc, 10.5, true); doc.text('Beanstandung: ' + (p.text || ''), MARGIN_X, MARGIN_TOP);
        let yTop = MARGIN_TOP + 6;
        if (p.notiz) { setFont(doc, 9.5, false, true, C_MUTED); for (const ln of doc.splitTextToSize(p.notiz, CONTENT_W)) { doc.text(ln, MARGIN_X, yTop); yTop += 5; } }
        const availW = CONTENT_W, availH = PAGE_H - yTop - 12;
        const ratio = Math.min(availW / img.w, availH / img.h);
        const w = img.w * ratio, h = img.h * ratio;
        doc.addImage(img.dataUrl, img.format, MARGIN_X + (availW - w) / 2, yTop + 4, w, h, undefined, 'SLOW');
      } catch (e) { console.warn('Beanstandungsfoto nicht eingebettet', e); }
    }

    const safeRaum = raum ? raum.name.replace(/\s+/g, '_') : 'Objekt';
    const filename = `${titel}-${safeRaum}-${v.startDatum || ''}.pdf`;
    if (opts.target === 'paperless') {
      GR.ui.savePdfToPaperless(doc, filename, { prefillTitle: opts.prefillTitle, onUploaded: opts.onUploaded });
    } else {
      openPdf(doc, filename);
    }
  }

  // Jahres-Übersicht: alle Vermietungen eines Jahres + Summe der Einnahmen.
  // opts.target: 'download' (Standard) oder 'paperless'.
  function buildJahresuebersicht(jahr, opts = {}) {
    const doc = newDoc();
    if (!doc) return;
    const settings = store.getSettings();
    const vm = settings.vermietung || {};
    const state = { y: MARGIN_TOP };

    const wappen = getWappenDataUrl();
    if (wappen) { try { doc.addImage(wappen, 'PNG', RIGHT_X - 20, state.y - 2, 20, 24, undefined, 'SLOW'); } catch (_) {} }
    setFont(doc, 15, true);
    doc.text('Vermietungen ' + jahr, MARGIN_X, state.y + 4);
    setFont(doc, 10, false, false, C_MUTED);
    doc.text('Ortsgemeinde ' + (vm.ortsgemeinde || ''), MARGIN_X, state.y + 10);
    state.y += 20;

    const rows = store.listVermietungen()
      .filter(v => v.startDatum && String(new Date(v.startDatum).getFullYear()) === String(jahr))
      .sort((a, b) => (a.startDatum || '').localeCompare(b.startDatum || ''));

    const colDatum = MARGIN_X, colObjekt = MARGIN_X + 34, colMieter = MARGIN_X + 78, colBetrag = RIGHT_X;
    const headRow = () => {
      setFont(doc, 9.5, true);
      doc.text('Zeitraum', colDatum, state.y);
      doc.text('Objekt', colObjekt, state.y);
      doc.text('Mieter', colMieter, state.y);
      doc.text('Betrag', colBetrag, state.y, { align: 'right' });
      state.y += 2; doc.setDrawColor(180); doc.line(MARGIN_X, state.y, RIGHT_X, state.y); state.y += 4;
    };
    headRow();

    let summe = 0;
    setFont(doc, 9.5, false);
    if (rows.length === 0) {
      setFont(doc, 10, false, true, C_MUTED);
      doc.text('Keine Vermietungen in diesem Jahr.', MARGIN_X, state.y); state.y += 6;
    }
    for (const v of rows) {
      if (state.y > PAGE_H - 30) { doc.addPage(); state.y = MARGIN_TOP; headRow(); setFont(doc, 9.5, false); }
      const raum = store.getRaum(v.raumId);
      const mieter = store.getMieter(v.mieterId);
      const zeitraum = formatDatum(v.startDatum) + (v.endDatum && v.endDatum !== v.startDatum ? '–' + formatDatum(v.endDatum) : '');
      const betrag = v.kostenfrei ? 0 : (raum ? berechneGesamt(v, raum).gesamt : 0);
      summe += betrag;
      setFont(doc, 9.5, false);
      doc.text(zeitraum, colDatum, state.y);
      doc.text(String(raum ? raum.name : '—').slice(0, 22), colObjekt, state.y);
      doc.text(String(mieter ? fullNameMieter(mieter) : '—').slice(0, 26), colMieter, state.y);
      doc.text(v.kostenfrei ? 'kostenfrei' : euro(betrag), colBetrag, state.y, { align: 'right' });
      state.y += 5.5;
    }

    state.y += 2; doc.setDrawColor(120); doc.line(MARGIN_X, state.y, RIGHT_X, state.y); state.y += 5;
    setFont(doc, 11, true);
    doc.text('Einnahmen gesamt ' + jahr, MARGIN_X, state.y);
    doc.text(euro(summe), colBetrag, state.y, { align: 'right' });
    state.y += 6;
    setFont(doc, 9, false, false, C_MUTED);
    doc.text(rows.length + ' Vermietung(en)', MARGIN_X, state.y);

    const filename = `Vermietungen-${jahr}.pdf`;
    if (opts.target === 'paperless') GR.ui.savePdfToPaperless(doc, filename, { prefillTitle: 'Vermietungen ' + jahr, onUploaded: opts.onUploaded });
    else openPdf(doc, filename);
  }

  GR.vermietungPdf = { buildMietvertrag, buildKostenabrechnung, buildUebergabeprotokoll, buildJahresuebersicht };
})();
