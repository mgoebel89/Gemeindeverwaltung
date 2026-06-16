(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { fullName, isEinstimmig, einstimmigRichtung } = GR.models;
  const { formatDatum, wochentag, toast } = GR.ui;

  // --- Wappen-Helfer ---
  function imageElementToDataUrl(img) {
    try {
      if (!img || !img.complete || !img.naturalWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('Wappen Canvas-Konvertierung fehlgeschlagen', e);
      return null;
    }
  }

  function getWappenDataUrl() {
    const settings = store.getSettings();
    if (settings && settings.wappenDataUrl) return settings.wappenDataUrl;
    const img = document.getElementById('wappenImg');
    return imageElementToDataUrl(img);
  }

  function nameOf(id, mitglieder) {
    const m = mitglieder.find(x => x.id === id);
    return m ? fullName(m) : '';
  }

  // --- Layout-Konstanten (mm, A4 hochkant) ---
  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN_X = 22;
  const MARGIN_TOP = 22;
  const MARGIN_BOTTOM = 24;
  const CONTENT_W = PAGE_W - 2 * MARGIN_X;
  const PAGE_BOTTOM = PAGE_H - MARGIN_BOTTOM;

  const C_TEXT = [0, 0, 0];
  const C_MUTED = [102, 102, 102];
  const C_LINE_LIGHT = [187, 187, 187];
  const C_LINE_DARK = [60, 60, 60];

  const GAP_TEXT = 5.4;
  const GAP_BLOCK = 5.6;
  const GAP_LABEL = 5.4;

  function ensureSpace(doc, state, needed) {
    if (state.y + needed > PAGE_BOTTOM) {
      doc.addPage();
      state.y = MARGIN_TOP;
    }
  }

  function drawText(doc, state, text, opts = {}) {
    const {
      size = 10.5,
      bold = false,
      italic = false,
      color = C_TEXT,
      indent = 0,
      lineGap = GAP_TEXT,
      align = 'left',
      maxWidth = CONTENT_W - indent,
    } = opts;
    doc.setFont('helvetica', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(String(text ?? ''), maxWidth);
    for (const ln of lines) {
      ensureSpace(doc, state, lineGap);
      const x = align === 'right' ? PAGE_W - MARGIN_X : MARGIN_X + indent;
      doc.text(ln, x, state.y, { align });
      state.y += lineGap;
    }
  }

  // Sehr leichter Markdown-Renderer für Aufzählungen.
  // - Listenelemente: Zeilen, die mit "- ", "* " oder "1. " beginnen
  // - **fett** und *kursiv* werden NICHT geparst (zu viel Aufwand für jsPDF)
  // - Leerzeilen werden als halber Zeilenabstand übernommen
  function drawMarkdown(doc, state, text, opts = {}) {
    const {
      size = 10.5,
      lineGap = GAP_BLOCK,
      indent = 0,
      color = C_TEXT,
    } = opts;
    const maxWidth = CONTENT_W - indent;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = String(text || '').split(/\r?\n/);
    for (const raw of lines) {
      if (!raw.trim()) {
        state.y += lineGap * 0.5;
        continue;
      }
      const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
      const numbered = raw.match(/^\s*(\d+)\.\s+(.*)$/);
      if (bullet) {
        const t = bullet[1];
        const bIndent = 6;
        const wrapped = doc.splitTextToSize(t, maxWidth - bIndent);
        ensureSpace(doc, state, lineGap);
        doc.text('•', MARGIN_X + indent + 1.5, state.y);
        wrapped.forEach((ln, i) => {
          if (i > 0) ensureSpace(doc, state, lineGap);
          doc.text(ln, MARGIN_X + indent + bIndent, state.y);
          state.y += lineGap;
        });
      } else if (numbered) {
        const num = numbered[1];
        const t = numbered[2];
        const nIndent = 9;
        const wrapped = doc.splitTextToSize(t, maxWidth - nIndent);
        ensureSpace(doc, state, lineGap);
        doc.text(num + '.', MARGIN_X + indent + 1.5, state.y);
        wrapped.forEach((ln, i) => {
          if (i > 0) ensureSpace(doc, state, lineGap);
          doc.text(ln, MARGIN_X + indent + nIndent, state.y);
          state.y += lineGap;
        });
      } else {
        const wrapped = doc.splitTextToSize(raw, maxWidth);
        for (const ln of wrapped) {
          ensureSpace(doc, state, lineGap);
          doc.text(ln, MARGIN_X + indent, state.y);
          state.y += lineGap;
        }
      }
    }
  }

  function drawLine(doc, state, color = C_LINE_LIGHT, width = 0.3, gapBefore = 3, gapAfter = 5) {
    state.y += gapBefore;
    ensureSpace(doc, state, gapAfter + width);
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(width);
    doc.line(MARGIN_X, state.y, PAGE_W - MARGIN_X, state.y);
    state.y += gapAfter;
  }

  // ---------- Checkbox ----------
  function drawCheckbox(doc, x, y, size, checked) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(x, y, size, size, 'S');
    if (checked) {
      doc.setLineWidth(0.55);
      const m = 0.9;
      doc.line(x + m, y + m, x + size - m, y + size - m);
      doc.line(x + size - m, y + m, x + m, y + size - m);
    }
  }

  // ---------- Abstimmungs-Box ----------
  const BOX_LINE_H = 4.6;       // Zeilenhöhe innerhalb Inhaltsspalten
  const BOX_PAD = 2.2;          // vertikaler Innenabstand pro untere Zeile
  const BOX_HEADER_H = 9;       // Höhe Kopfzeile (Einstimmig / Mit Stimmenmehrheit)
  const BOX_SUB_H = 9;          // Höhe Sub-Zeile (dafür/dagegen + Ja/Nein/Enth)
  const BOX_CB = 4.4;           // Checkbox-Kantenlänge
  const BOX_CB_COL_W = 10;      // Breite der Checkbox-Spalte links
  const BOX_TEXT_PAD_L = 2.5;   // Innen-Padding links

  function wrapWidth(doc, text, maxW, size, bold) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    return doc.splitTextToSize(String(text ?? ''), maxW);
  }

  function rowHeightFor(lines, extraBulletLines = 0) {
    const n = Math.max(1, (lines ? lines.length : 0)) + extraBulletLines;
    return Math.max(8, n * BOX_LINE_H + BOX_PAD * 2);
  }

  function drawBoxRow(doc, x, y, w, h, checked, contentDrawer) {
    doc.setDrawColor(C_LINE_DARK[0], C_LINE_DARK[1], C_LINE_DARK[2]);
    doc.setLineWidth(0.3);
    // Rahmen
    doc.rect(x, y, BOX_CB_COL_W, h, 'S');
    doc.rect(x + BOX_CB_COL_W, y, w - BOX_CB_COL_W, h, 'S');
    // Checkbox
    const cbX = x + (BOX_CB_COL_W - BOX_CB) / 2;
    const cbY = y + (h - BOX_CB) / 2;
    drawCheckbox(doc, cbX, cbY, BOX_CB, checked);
    // Inhalt
    contentDrawer(x + BOX_CB_COL_W + BOX_TEXT_PAD_L, y + BOX_PAD + 3, w - BOX_CB_COL_W - 2 * BOX_TEXT_PAD_L);
  }

  function drawAbstimmungBox(doc, state, top, mitglieder) {
    const a = top.abstimmung;
    const einst = isEinstimmig(a);
    const richtung = einstimmigRichtung(a); // 'dafuer' | 'dagegen' | null
    const enth = (a.enthaltung || 0) > 0;

    const boxX = MARGIN_X;
    const boxW = CONTENT_W;

    // Inhalte der vier unteren Zeilen vorbereiten (für Höhenberechnung)
    const innerW = boxW - BOX_CB_COL_W - 2 * BOX_TEXT_PAD_L;
    const SIZE_ROW = 10;

    // §22-Zeile: Label + Bullet-Liste der ausgewählten Ratsmitglieder
    const befIds = top.befangenheitsIds || [];
    const bef = befIds.map(id => nameOf(id, mitglieder)).filter(Boolean);
    const r1Lead = 'Ratsmitglied hat wegen §22 Abs. 1 GemO nicht teilgenommen und zuvor im Zuhörerbereich Platz genommen / den Sitzungsraum verlassen:';
    const r1Lines = wrapWidth(doc, r1Lead, innerW, SIZE_ROW, false);
    const befLines = bef.map(n => ({ bullet: true, text: n }));

    // Freiwilliger-Verzicht-Zeile
    const verz = (top.freiwilligerVerzichtIds || []).map(id => nameOf(id, mitglieder)).filter(Boolean);
    const r2Lead = 'Ratsmitglied hat freiwillig auf Teilnahme verzichtet:';
    const r2Lines = wrapWidth(doc, r2Lead, innerW, SIZE_ROW, false);
    const r2Bullets = verz.map(n => ({ bullet: true, text: n }));

    // §36-Zeile
    const ruht = (top.stimmrechtRuhtIds || []).map(id => nameOf(id, mitglieder)).filter(Boolean);
    const r3Lead = 'Das Stimmrecht des/der Vorsitzenden ruht gemäß §36 Abs. 3 GemO.';
    const r3Lines = wrapWidth(doc, r3Lead, innerW, SIZE_ROW, false);
    const r3Bullets = ruht.map(n => ({ bullet: true, text: n }));

    // Bemerkungen-Zeile (inline)
    const bem = (top.bemerkungen || '').trim();
    const r4Text = bem ? `Bemerkungen: ${bem}` : 'Bemerkungen:';
    const r4Lines = wrapWidth(doc, r4Text, innerW, SIZE_ROW, false);

    const r1H = rowHeightFor(r1Lines, befLines.length);
    const r2H = rowHeightFor(r2Lines, r2Bullets.length);
    const r3H = rowHeightFor(r3Lines, r3Bullets.length);
    const r4H = rowHeightFor(r4Lines);

    const totalH = BOX_HEADER_H + BOX_SUB_H + r1H + r2H + r3H + r4H;

    // Box zusammenhängend halten
    if (state.y + totalH + 4 > PAGE_BOTTOM) {
      doc.addPage();
      state.y = MARGIN_TOP;
    }
    state.y += 2;

    let y = state.y;

    // --- Kopfzeile: zwei Zellen ---
    doc.setDrawColor(C_LINE_DARK[0], C_LINE_DARK[1], C_LINE_DARK[2]);
    doc.setLineWidth(0.3);
    const halfW = boxW / 2;
    doc.rect(boxX, y, halfW, BOX_HEADER_H, 'S');
    doc.rect(boxX + halfW, y, halfW, BOX_HEADER_H, 'S');

    // Linke Kopfzelle: Einstimmig
    {
      const cbY = y + (BOX_HEADER_H - BOX_CB) / 2;
      drawCheckbox(doc, boxX + 3, cbY, BOX_CB, einst);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Einstimmig', boxX + 3 + BOX_CB + 3, y + BOX_HEADER_H / 2 + 1.2);
    }
    // Rechte Kopfzelle: Mit Stimmenmehrheit
    {
      const cbY = y + (BOX_HEADER_H - BOX_CB) / 2;
      drawCheckbox(doc, boxX + halfW + 3, cbY, BOX_CB, !einst && a.durchgefuehrt);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text('Mit Stimmenmehrheit', boxX + halfW + 3 + BOX_CB + 3, y + BOX_HEADER_H / 2 + 1.2);
    }
    y += BOX_HEADER_H;

    // --- Sub-Zeile ---
    // Links: dafür / dagegen / davon Enthaltungen
    doc.rect(boxX, y, halfW, BOX_SUB_H, 'S');
    {
      const subY = y + (BOX_SUB_H - BOX_CB) / 2;
      const textY = y + BOX_SUB_H / 2 + 1.2;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(0, 0, 0);
      const items = [
        { label: 'dafür', checked: einst && richtung === 'dafuer' },
        { label: 'dagegen', checked: einst && richtung === 'dagegen' },
        { label: 'davon Enthaltungen', checked: einst && enth },
      ];
      let x = boxX + 3;
      for (const it of items) {
        drawCheckbox(doc, x, subY, BOX_CB, it.checked);
        doc.text(it.label, x + BOX_CB + 1.5, textY);
        const w = doc.getTextWidth(it.label);
        x += BOX_CB + 3 + w + 4;
      }
    }
    // Rechts: drei gleiche Spalten Ja / Nein / Enth
    const thirdW = halfW / 3;
    const labels = ['Ja-Stimmen', 'Nein-Stimmen', 'Enthaltungen'];
    const values = !einst && a.durchgefuehrt ? [String(a.ja || 0), String(a.nein || 0), String(a.enthaltung || 0)] : ['', '', ''];
    for (let i = 0; i < 3; i++) {
      doc.rect(boxX + halfW + i * thirdW, y, thirdW, BOX_SUB_H, 'S');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.text(labels[i], boxX + halfW + i * thirdW + thirdW / 2, y + 3.5, { align: 'center' });
      if (values[i]) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text(values[i], boxX + halfW + i * thirdW + thirdW / 2, y + BOX_SUB_H - 1.8, { align: 'center' });
      }
    }
    y += BOX_SUB_H;

    // --- Untere Zeilen ---
    function drawContentBlock(x, yStart, w, leadLines, bullets) {
      let cy = yStart;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(SIZE_ROW); doc.setTextColor(0, 0, 0);
      for (const l of leadLines) { doc.text(l, x, cy); cy += BOX_LINE_H; }
      for (const b of bullets) {
        doc.text('•', x + 1.5, cy);
        doc.text(b.text, x + 5, cy);
        cy += BOX_LINE_H;
      }
    }

    drawBoxRow(doc, boxX, y, boxW, r1H, bef.length > 0, (cx, cy, cw) => drawContentBlock(cx, cy, cw, r1Lines, befLines));
    y += r1H;
    drawBoxRow(doc, boxX, y, boxW, r2H, verz.length > 0, (cx, cy, cw) => drawContentBlock(cx, cy, cw, r2Lines, r2Bullets));
    y += r2H;
    drawBoxRow(doc, boxX, y, boxW, r3H, ruht.length > 0, (cx, cy, cw) => drawContentBlock(cx, cy, cw, r3Lines, r3Bullets));
    y += r3H;
    drawBoxRow(doc, boxX, y, boxW, r4H, !!bem, (cx, cy, cw) => drawContentBlock(cx, cy, cw, r4Lines, []));
    y += r4H;

    state.y = y + 3;
  }

  function drawAntraegeBlock(doc, state, sitzung) {
    const at = sitzung.antraegeTagesordnung || { modus: 'keine', text: '' };
    const keine = at.modus !== 'antraege';
    const txt = (at.text || '').trim();

    state.y += 6;
    // Titel-Zeile mit Rahmen
    const boxX = MARGIN_X;
    const boxW = CONTENT_W;
    const headerH = 9;

    ensureSpace(doc, state, headerH + 28);
    doc.setDrawColor(C_LINE_DARK[0], C_LINE_DARK[1], C_LINE_DARK[2]);
    doc.setLineWidth(0.3);
    doc.rect(boxX, state.y, boxW, headerH, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(C_TEXT[0], C_TEXT[1], C_TEXT[2]);
    doc.text('Anträge zur Tagesordnung', boxX + 4, state.y + headerH / 2 + 1.4);
    state.y += headerH + 4;

    // Zeile 1: Es gibt keine Anträge
    const CB = 4.4;
    drawCheckbox(doc, MARGIN_X, state.y - 3.5, CB, keine);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text('Es gibt keine Anträge zur Tagesordnung.', MARGIN_X + CB + 4, state.y);
    state.y += 7;

    // Zeile 2: Nachfolgende Anträge … + Text
    drawCheckbox(doc, MARGIN_X, state.y - 3.5, CB, !keine);
    doc.text('Nachfolgende Anträge zur Tagesordnung werden vorgebracht:', MARGIN_X + CB + 4, state.y);
    state.y += 6;

    if (!keine && txt) {
      const indent = CB + 4;
      drawMarkdown(doc, state, txt, { indent, lineGap: 5, size: 10.5 });
    }
    state.y += 4;
  }

  function drawTopTitle(doc, state, top) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(C_TEXT[0], C_TEXT[1], C_TEXT[2]);
    const titleLine = `TOP ${top.nummer} — ${(top.titel || '').toUpperCase()}`;
    const lines = doc.splitTextToSize(titleLine, CONTENT_W);
    const lineH = 5.2;
    for (const ln of lines) {
      doc.text(ln, MARGIN_X, state.y);
      state.y += lineH;
    }
    state.y += 1.5;
    doc.setDrawColor(C_LINE_DARK[0], C_LINE_DARK[1], C_LINE_DARK[2]);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, state.y, PAGE_W - MARGIN_X, state.y);
    state.y += 9;
  }

  function renderTop(doc, state, top, isFirst, mitglieder, wechselVor, wechselNach) {
    if (!isFirst) state.y += 6;

    // Mindestplatz reservieren, damit Titel + Anfang des Inhalts nicht orphan auf alter Seite landen
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    const titleLine = `TOP ${top.nummer} — ${(top.titel || '').toUpperCase()}`;
    const titleLines = doc.splitTextToSize(titleLine, CONTENT_W).length;
    const wechselLines = wechselVor
      ? doc.splitTextToSize(wechselVor, CONTENT_W).length
      : 0;
    // Wechsel + Abstand + Titel + Linie + Abstand + Label + 2 Zeilen Inhalt
    const needed = wechselLines * 5.4 + titleLines * 5.2 + 12 + GAP_LABEL + 2 * GAP_BLOCK + 6;
    if (state.y + needed > PAGE_BOTTOM) {
      doc.addPage();
      state.y = MARGIN_TOP;
    }

    if (wechselVor) {
      drawText(doc, state, wechselVor, { italic: true, color: C_TEXT, size: 10 });
      state.y += 1.5;
    }
    drawTopTitle(doc, state, top);
    drawText(doc, state, 'Beschlussvorlage:', { bold: true, lineGap: GAP_LABEL });
    if ((top.beschlussvorlage || '').trim()) {
      drawMarkdown(doc, state, top.beschlussvorlage, { lineGap: GAP_BLOCK });
    } else {
      drawText(doc, state, '—', { lineGap: GAP_BLOCK });
    }

    if (top.abstimmung && top.abstimmung.durchgefuehrt) {
      drawAbstimmungBox(doc, state, top, mitglieder);
    } else {
      state.y += 1;
      drawText(doc, state, 'Keine Abstimmung durchgeführt.', { color: C_MUTED, size: 9.5 });
    }

    if (wechselNach) {
      state.y += 3;
      drawText(doc, state, wechselNach, { italic: true, color: C_TEXT, size: 10 });
    }
  }

  function drawHeader(doc, state, sitzung, wappenDataUrl) {
    if (wappenDataUrl) {
      try {
        doc.addImage(wappenDataUrl, 'PNG', MARGIN_X, state.y - 2, 20, 24, undefined, 'SLOW');
      } catch (e) {
        console.warn('Wappen konnte nicht in PDF eingefügt werden', e);
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(C_TEXT[0], C_TEXT[1], C_TEXT[2]);
    doc.text('Sitzungsprotokoll', PAGE_W - MARGIN_X, state.y + 6, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(C_MUTED[0], C_MUTED[1], C_MUTED[2]);
    doc.text(`Gemeinderatssitzung — ${wochentag(sitzung.datum)}, ${formatDatum(sitzung.datum)}`, PAGE_W - MARGIN_X, state.y + 13, { align: 'right' });
    state.y += 26;
    drawLine(doc, state, C_LINE_DARK, 0.4, 0, 9);
  }

  function drawList(doc, state, label, items) {
    drawText(doc, state, label, { size: 11, bold: true, lineGap: GAP_LABEL + 0.4 });
    if (!items.length) {
      drawText(doc, state, '–  —', { indent: 2, color: C_MUTED });
    } else {
      for (const it of items) {
        drawText(doc, state, '–  ' + it, { indent: 2 });
      }
    }
    state.y += 2;
  }

  function drawSignatureBlock(doc, state, settings, sitzung) {
    state.y += 16;
    ensureSpace(doc, state, 32);
    drawText(doc, state, `${settings.ortsname || sitzung.ort}, ${formatDatum(sitzung.datum)}`, { lineGap: 6 });
    state.y += 18;
    ensureSpace(doc, state, 14);
    const colW = CONTENT_W / 2 - 8;
    doc.setDrawColor(C_TEXT[0], C_TEXT[1], C_TEXT[2]);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_X, state.y, MARGIN_X + colW, state.y);
    doc.line(PAGE_W - MARGIN_X - colW, state.y, PAGE_W - MARGIN_X, state.y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(C_MUTED[0], C_MUTED[1], C_MUTED[2]);
    doc.text('Sitzungsleitung', MARGIN_X, state.y + 5);
    doc.text('Schriftführer', PAGE_W - MARGIN_X - colW, state.y + 5);
    state.y += 9;
  }

  function drawFooters(doc, sitzung) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(119, 119, 119);
      doc.text(`Protokoll ${formatDatum(sitzung.datum)}`, MARGIN_X, PAGE_H - 10);
      doc.text(`${i} / ${total}`, PAGE_W - MARGIN_X, PAGE_H - 10, { align: 'right' });
    }
  }

  function drawWatermark(doc) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.saveGraphicsState && doc.saveGraphicsState();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(90);
      doc.setTextColor(225, 225, 225);
      doc.text('ENTWURF', PAGE_W / 2, PAGE_H / 2 + 30, { align: 'center', angle: 45 });
      doc.restoreGraphicsState && doc.restoreGraphicsState();
    }
  }

  // Anwesenden-Name mit Zeiten zusammenbauen
  function anwesendDisplay(mitglied, zeiten) {
    const z = (zeiten && zeiten[mitglied.id]) || {};
    const parts = [];
    if (z.kamUm) parts.push('anwesend ab ' + z.kamUm + ' Uhr');
    if (z.gingUm) parts.push('anwesend bis ' + z.gingUm + ' Uhr');
    const name = fullName(mitglied);
    return parts.length ? `${name} (${parts.join(', ')})` : name;
  }

  // Berechnet pro TOP (in der gegebenen Reihenfolge) die Wechsel-Sätze davor.
  // Standard = sitzung.sitzungsleitungId. Effektive Leitung = top.sitzungsleitungId || Standard.
  // Wechsel-Satz nur an Stellen, an denen sich die effektive Leitung ändert.
  function computeWechselSaetze(tops, sitzung, mitglieder) {
    const standard = sitzung.sitzungsleitungId || '';
    const result = new Array(tops.length).fill('');
    let prev = standard;
    for (let i = 0; i < tops.length; i++) {
      const eff = tops[i].sitzungsleitungId || standard;
      if (eff && eff !== prev) {
        if (eff === standard) {
          const n = nameOf(standard, mitglieder);
          result[i] = n ? `Die Sitzungsleitung wird wieder von ${n} übernommen.` : '';
        } else {
          const n = nameOf(eff, mitglieder);
          result[i] = n ? `Die Sitzungsleitung wechselt zu ${n}.` : '';
        }
      }
      prev = eff;
    }
    // Nach dem letzten TOP ggf. Rückwechsel zum Standard
    let trailing = '';
    if (prev && prev !== standard && standard) {
      const n = nameOf(standard, mitglieder);
      trailing = n ? `Die Sitzungsleitung wird wieder von ${n} übernommen.` : '';
    }
    return { perTop: result, trailing };
  }

  function buildPdf(sitzung, opts) {
    opts = opts || {};
    const draft = !!opts.draft;

    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('jsPDF ist nicht geladen.\n\nBitte vendor/jspdf.inline.js bereitstellen (siehe vendor/README.txt).');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    const mitglieder = store.listMitglieder();
    const settings = store.getSettings();
    const wappen = getWappenDataUrl();
    const state = { y: MARGIN_TOP };

    const aktive = mitglieder.filter(m => m.aktiv);
    const anwesendIds = new Set(sitzung.anwesendIds || []);
    const zeiten = sitzung.anwesenheitsZeiten || {};

    const anwesendeNamen = aktive.filter(m => anwesendIds.has(m.id)).map(m => anwesendDisplay(m, zeiten));
    const abwesendeNamen = aktive.filter(m => !anwesendIds.has(m.id)).map(m => fullName(m));

    const oeff = sitzung.tops.filter(t => t.bereich === 'oeffentlich');
    const nicht = sitzung.tops.filter(t => t.bereich === 'nicht_oeffentlich');
    const hasNichtOeff = nicht.length > 0;

    // Wechsel-Sätze über alle TOPs in zeitlicher Reihenfolge (öffentlich, dann nicht-öffentlich)
    const alleTops = [...oeff, ...nicht];
    const wechsel = computeWechselSaetze(alleTops, sitzung, mitglieder);
    const wechselFor = new Map(alleTops.map((t, i) => [t.id, wechsel.perTop[i]]));

    drawHeader(doc, state, sitzung, wappen);

    drawList(doc, state, 'Anwesende Ratsmitglieder', anwesendeNamen);
    drawList(doc, state, 'Abwesend', abwesendeNamen);

    drawText(doc, state, 'Sitzungsleitung: ' + (nameOf(sitzung.sitzungsleitungId, mitglieder) || '—'), { lineGap: GAP_TEXT });
    drawText(doc, state, 'Schriftführer: ' + (nameOf(sitzung.schriftfuehrerId, mitglieder) || '—'), { lineGap: GAP_TEXT });
    drawText(doc, state, 'Gäste: ' + (sitzung.gaeste || '—'), { lineGap: GAP_TEXT });

    drawLine(doc, state, C_LINE_LIGHT, 0.3, 6, 8);
    drawText(doc, state, `Sitzungsbeginn (öffentlich): ${sitzung.beginnOeffentlich || 'HH:mm'} Uhr`, { bold: true, color: C_TEXT, size: 10 });

    drawAntraegeBlock(doc, state, sitzung);

    if (oeff.length === 0) {
      state.y += 2;
      drawText(doc, state, '— keine öffentlichen Tagesordnungspunkte —', { color: C_MUTED });
    } else {
      oeff.forEach((t, i) => {
        const isLastOfAll = !hasNichtOeff && i === oeff.length - 1;
        renderTop(doc, state, t, i === 0, mitglieder, wechselFor.get(t.id), isLastOfAll ? wechsel.trailing : '');
      });
    }

    if (hasNichtOeff) {
      drawLine(doc, state, C_LINE_LIGHT, 0.3, 8, 8);
      drawText(doc, state, `Ende des öffentlichen Teils der Sitzung ${sitzung.endeOeffentlich || 'HH:mm'} Uhr. Alle Gäste werden verabschiedet.`, { bold: true, color: C_TEXT, size: 10 });
      state.y += 2;
      drawText(doc, state, `Beginn des nicht-öffentlichen Teils der Sitzung um ${sitzung.beginnNichtOeffentlich || 'HH:mm'} Uhr.`, { bold: true, color: C_TEXT, size: 10 });
      nicht.forEach((t, i) => {
        const isLastOfAll = i === nicht.length - 1;
        renderTop(doc, state, t, i === 0, mitglieder, wechselFor.get(t.id), isLastOfAll ? wechsel.trailing : '');
      });
    }

    drawLine(doc, state, C_LINE_LIGHT, 0.3, 8, 8);
    drawText(doc, state, `Die Sitzung endet um ${sitzung.endeSitzung || 'HH:mm'} Uhr.`, { bold: true, color: C_TEXT, size: 10 });

    drawSignatureBlock(doc, state, settings, sitzung);
    drawFooters(doc, sitzung);
    if (draft) drawWatermark(doc);

    try {
      const filename = draft
        ? `Protokoll-Entwurf-${sitzung.datum}.pdf`
        : `Protokoll-${sitzung.datum}.pdf`;
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      // In neuem Tab öffnen — der eingebaute PDF-Viewer des Browsers übernimmt Vorschau, Drucken und Speichern.
      const win = window.open(url, '_blank');
      if (!win) {
        // Popup blockiert → unsichtbaren Link mit gewünschtem Dateinamen klicken (Fallback: Download).
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 0);
        toast('Popup blockiert — PDF als Download gestartet');
      } else {
        try { win.document.title = filename; } catch (_) { /* cross-origin write nach Load nicht zwingend möglich */ }
        toast(draft ? 'Entwurfs-PDF in neuem Tab geöffnet' : 'PDF in neuem Tab geöffnet');
      }
      // URL nach einigen Minuten freigeben — Tab hat Blob bis dahin geladen
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e) {
      console.error(e);
      alert('PDF konnte nicht erzeugt werden: ' + e.message);
    }
  }

  GR.pdf = { buildPdf };
})();
