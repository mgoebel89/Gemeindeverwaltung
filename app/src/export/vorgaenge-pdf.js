(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store, roles } = GR;
  const M = GR.models;
  const { formatDatum, toast } = GR.ui;

  // --- Layout (mm, A4 hochkant) ---
  const PAGE_W = 210, PAGE_H = 297;
  const MARGIN_X = 22, MARGIN_TOP = 22;
  const RIGHT_X = PAGE_W - MARGIN_X;
  const CONTENT_W = PAGE_W - 2 * MARGIN_X;
  const C_TEXT = [0, 0, 0], C_MUTED = [90, 90, 90], C_LEAD = [44, 82, 130];

  function euro(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
  function fmtPts(n) { const x = Math.round((Number(n) || 0) * 10) / 10; return String(x).replace('.', ','); }
  const PRIO_LABEL = { 1: 'Niedrig', 2: 'Mittel', 3: 'Hoch', 4: 'Dringend', 5: 'Sofort' };
  const TYP_LABEL = { notiz: 'Notiz', todo: 'ToDo', dokument: 'Dokument', referenz: 'Referenz', kosten: 'Kosten', foto: 'Foto', angebot: 'Angebot', entscheidung: 'Auswahl' };

  // Die jsPDF-Standardschriften können nur WinAnsi (CP1252). Enthält eine Zeile
  // ein Zeichen darüber hinaus (Emoji, Pfeile, Haken), kodiert jsPDF die GANZE
  // Zeile anders — sichtbar als Buchstabensalat („Ø=ÜÄ") in Sperrschrift.
  // Darum alles Fremde ersetzen bzw. entfernen, bevor es in doc.text() geht.
  const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹Œ Ž‘’“”•–—˜™š›œžŸ';
  const ERSATZ = { '→': '»', '←': '«', '✓': '-', '✔': '-', '☑': '-', '☐': '-', '·': '·', '‑': '-', '−': '-', ' ': ' ', '\t': ' ' };
  function winAnsi(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/[→←✓✔☑☐‑− \t]/g, ch => ERSATZ[ch] || ' ');
    let out = '';
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp <= 0xff || WINANSI_EXTRA.includes(ch)) out += ch;
      else if (cp >= 0x1f000 || (cp >= 0x2190 && cp <= 0x2bff)) continue; // Emoji/Symbole ersatzlos
      else out += '?';
    }
    return out.replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
  }

  // Ankreuzfeld als Vektor (statt ☐/☑ — die kann die PDF-Standardschrift nicht).
  function checkbox(doc, x, baselineY, checked, size = 3.2) {
    const top = baselineY - size + 0.4;
    doc.setDrawColor(80); doc.setLineWidth(0.3);
    doc.rect(x, top, size, size);
    if (checked) {
      doc.setLineWidth(0.5);
      doc.line(x + 0.7, top + size * 0.55, x + size * 0.42, top + size - 0.6);
      doc.line(x + size * 0.42, top + size - 0.6, x + size - 0.5, top + 0.6);
    }
    doc.setLineWidth(0.2);
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

  function newDoc() {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert('jsPDF ist nicht geladen.'); return null; }
    return new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  }
  function setFont(doc, size, bold, italic, color) {
    doc.setFont('helvetica', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    const c = color || C_TEXT; doc.setTextColor(c[0], c[1], c[2]);
  }
  function ensureSpace(doc, state, need) {
    if (state.y + (need || 6) > PAGE_H - 16) { doc.addPage(); state.y = MARGIN_TOP; }
  }
  // Umgebrochener Text ab state.y; berücksichtigt Seitenumbruch.
  function line(doc, state, text, opts = {}) {
    const { size = 11, bold = false, italic = false, color, indent = 0, gap = 5.4, maxWidth } = opts;
    setFont(doc, size, bold, italic, color);
    const mw = maxWidth || (CONTENT_W - indent);
    const lines = doc.splitTextToSize(winAnsi(text), mw);
    for (const ln of lines) { ensureSpace(doc, state, gap); doc.text(ln, MARGIN_X + indent, state.y); state.y += gap; }
  }
  function gap(state, mm) { state.y += mm; }
  function hr(doc, state, mm) { ensureSpace(doc, state, (mm || 3) + 2); doc.setDrawColor(210); doc.setLineWidth(0.2); doc.line(MARGIN_X, state.y, RIGHT_X, state.y); state.y += (mm || 3); }

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

  // Markdown → einfache Zeilen fürs PDF (Überschriften fett, Aufzählungen mit •,
  // Inline-Marker entfernt). Kein voller Renderer – reine Lesbarkeit.
  function mdLines(md) {
    const out = [];
    for (let raw of String(md || '').split(/\r?\n/)) {
      const t = raw.replace(/\s+$/, '');
      if (t.trim() === '') { out.push({ text: '', gap: 2.6 }); continue; }
      let m;
      if ((m = t.match(/^\s*(#{1,6})\s+(.*)$/))) { out.push({ text: strip(m[2]), bold: true, size: 11.5 }); continue; }
      if ((m = t.match(/^\s*[-*]\s+(.*)$/))) { out.push({ text: '• ' + strip(m[1]), indent: 4 }); continue; }
      if ((m = t.match(/^\s*(\d+)\.\s+(.*)$/))) { out.push({ text: m[1] + '. ' + strip(m[2]), indent: 4 }); continue; }
      out.push({ text: strip(t) });
    }
    return out;
    function strip(s) { return String(s).replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`([^`]*)`/g, '$1'); }
  }

  function stelleName(id) {
    const h = store.getHaushaltsstelle(id);
    return h ? ((h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)')) : '(unbekannte Stelle)';
  }

  // Bild (URL → Data-URL + Naturmaße) laden; für Verlaufsfotos.
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

  // Bild seitenverhältnistreu in eine Box einpassen → tatsächliche mm-Maße.
  function fitBox(natW, natH, maxW, maxH) {
    if (!natW || !natH) return { w: maxW, h: maxH };
    const s = Math.min(maxW / natW, maxH / natH);
    return { w: natW * s, h: natH * s };
  }

  // === Gesamt-Dokumentation eines Vorgangs ===
  // opts.target: 'download' (Standard) | 'paperless'; opts.onUploaded (Paperless).
  async function buildVorgangDokumentation(v, opts = {}) {
    if (!v) return;
    const doc = newDoc(); if (!doc) return;
    const settings = store.getSettings();
    const ort = (settings.vermietung && settings.vermietung.ortsgemeinde) || settings.ortsname || '';
    const state = { y: MARGIN_TOP };

    // Kopf — das Wappen sitzt rechts oben; die Kopftexte dürfen nicht darunter
    // laufen, daher ist ihre Breite um die Wappenspalte verkürzt.
    const WAPPEN_BOX = { w: 20, h: 24 };
    let kopfW = CONTENT_W;
    const wappen = getWappenDataUrl();
    if (wappen) {
      try {
        const p = doc.getImageProperties(wappen);
        const fit = fitBox(p.width, p.height, WAPPEN_BOX.w, WAPPEN_BOX.h);
        doc.addImage(wappen, 'PNG', RIGHT_X - fit.w, state.y - 2, fit.w, fit.h, undefined, 'SLOW');
        kopfW = CONTENT_W - fit.w - 5;
      } catch (_) { kopfW = CONTENT_W - WAPPEN_BOX.w - 5; }
    }
    setFont(doc, 15, true);
    const titelZeilen = doc.splitTextToSize(winAnsi('Vorgang: ' + (v.titel || '(ohne Titel)')), kopfW);
    for (const tz of titelZeilen) { doc.text(tz, MARGIN_X, state.y + 4); state.y += 7; }
    state.y += 4;
    const kopf = [
      'Ortsgemeinde ' + ort,
      'Status: ' + (M.VORGANG_STATUS_LABEL[v.status] || v.status || '—'),
      v.kategorie ? 'Kategorie: ' + v.kategorie : null,
      'angelegt ' + (v.erstelltAm ? formatDatum(v.erstelltAm) : '—'),
    ].filter(Boolean).join('  ·  ');
    line(doc, state, kopf, { size: 9.5, color: C_MUTED, maxWidth: kopfW });
    if (v.vertraulich) line(doc, state, 'VERTRAULICH', { size: 9.5, bold: true, color: [183, 121, 31], maxWidth: kopfW });
    // Unter das Wappen zurückfallen, damit die erste Sektion frei steht.
    state.y = Math.max(state.y, MARGIN_TOP + WAPPEN_BOX.h);
    hr(doc, state, 4);

    // Beschreibung
    if (v.beschreibung && v.beschreibung.trim()) {
      line(doc, state, 'Beschreibung', { size: 11.5, bold: true, color: C_LEAD });
      for (const l of mdLines(v.beschreibung)) line(doc, state, l.text, { size: l.size || 10.5, bold: l.bold, indent: l.indent || 0, gap: l.text === '' ? (l.gap || 2.6) : 5 });
      gap(state, 3);
    }

    // Budget / Kostenstellen
    const stellen = v.haushaltsstellen || [];
    if (stellen.length > 0) {
      line(doc, state, 'Budget / Kostenstellen (' + (v.haushaltsjahr || '—') + ')', { size: 11.5, bold: true, color: C_LEAD });
      for (const id of stellen) {
        const h = store.getHaushaltsstelle(id);
        const budget = h && h.budget != null ? Number(h.budget) : null;
        const eigen = M.vorgangKostenAuf(v, id);
        const ausl = M.budgetVerbrauch(store.listAuslagen(), id, v.haushaltsjahr, M.ABGERECHNET_STATUS);
        const vorg = M.vorgaengeVerbrauch(store.listVorgaenge(), id, v.haushaltsjahr);
        const rest = budget != null ? budget - (ausl + vorg) : null;
        line(doc, state, `${stelleName(id)}: dieser Vorgang ${euro(eigen)}` + (budget != null ? ` · Budget ${euro(budget)} · Restmittel ${euro(rest)}` : ' · kein Budget hinterlegt'), { size: 10, indent: 2 });
      }
      line(doc, state, 'Kosten dieses Vorgangs gesamt: ' + euro(M.vorgangKosten(v)), { size: 10, bold: true, indent: 2 });
      gap(state, 2);
    }
    if (v.planung && Number(v.planung.betrag) > 0) {
      line(doc, state, `Geplanter Bedarf: ${euro(v.planung.betrag)}` + (v.planung.zieljahr ? ` (Zieljahr ${v.planung.zieljahr})` : ''), { size: 10, indent: 2 });
      gap(state, 2);
    }
    hr(doc, state, 4);

    // Verlauf (chronologisch aufsteigend; nur für die Rolle sichtbare Einträge)
    line(doc, state, 'Verlauf', { size: 12, bold: true, color: C_LEAD });
    const sichtbar = roles.visibleHistorie(v).slice().sort((a, b) => String(a.datum || '').localeCompare(String(b.datum || '')));
    const versteckt = (v.historie || []).length - sichtbar.length;

    if (sichtbar.length === 0) {
      line(doc, state, 'Keine Einträge.', { size: 10, italic: true, color: C_MUTED });
    }
    for (const e of sichtbar) {
      gap(state, 1.5);
      ensureSpace(doc, state, 12);
      const head = (e.datum ? formatDatum(e.datum) : '—') + '  ·  ' + (TYP_LABEL[e.typ] || e.typ) + (e.vertraulich ? '  (vertraulich)' : '');
      line(doc, state, head, { size: 10.5, bold: true });
      await renderEntry(doc, state, v, e);
    }

    if (versteckt > 0) {
      gap(state, 3);
      line(doc, state, `Hinweis: ${versteckt} vertrauliche(r) Eintrag/Einträge nicht enthalten (nur in der Leitungs-Ansicht).`, { size: 9, italic: true, color: C_MUTED });
    }

    // Fußzeile mit Seitenzahlen
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      setFont(doc, 8, false, false, C_MUTED);
      doc.text(`${ort} · Vorgangsdokumentation · Seite ${i}/${pages}`, MARGIN_X, PAGE_H - 8);
      doc.text(new Date().toLocaleDateString('de-DE'), RIGHT_X, PAGE_H - 8, { align: 'right' });
    }

    const safe = (v.titel || 'Vorgang').replace(/[^\wäöüÄÖÜß ]+/g, '').replace(/\s+/g, '_').slice(0, 40);
    const filename = `Vorgang-${safe}.pdf`;
    if (opts.target === 'paperless') GR.ui.savePdfToPaperless(doc, filename, { prefillTitle: 'Vorgang: ' + (v.titel || ''), onUploaded: opts.onUploaded });
    else openPdf(doc, filename);
  }

  async function renderEntry(doc, state, v, e) {
    const IND = 4;
    if (e.typ === 'notiz') {
      if (!e.textMd || !e.textMd.trim()) { line(doc, state, '(leere Notiz)', { size: 10, italic: true, color: C_MUTED, indent: IND }); return; }
      for (const l of mdLines(e.textMd)) {
        if (l.text === '') { gap(state, l.gap || 2.4); continue; }
        line(doc, state, l.text, { size: l.size || 10, bold: l.bold, indent: IND + (l.indent || 0), gap: 4.8 });
      }
    } else if (e.typ === 'todo') {
      const meta = [];
      if (e.faellig) meta.push('fällig ' + formatDatum(e.faellig));
      if (e.prioritaet && PRIO_LABEL[e.prioritaet]) meta.push('Priorität ' + PRIO_LABEL[e.prioritaet]);
      // Ankreuzfeld vor dem Text; der Text rückt um die Box ein.
      const BOX_IND = IND + 5.2;
      ensureSpace(doc, state, 6); // > gap der Textzeile, sonst bricht line() um und die Box bliebe allein zurück
      checkbox(doc, MARGIN_X + IND, state.y, !!e.erledigt);
      line(doc, state, (e.titel || '(ohne Titel)') + (meta.length ? '  (' + meta.join(' · ') + ')' : ''), { size: 10, indent: BOX_IND });
    } else if (e.typ === 'foto') {
      await renderFotos(doc, state, v, e, IND);
    } else if (e.typ === 'kosten') {
      line(doc, state, `${euro(e.betrag)} — ${e.beschreibung || 'Kosten'}`, { size: 10, bold: true, indent: IND });
      const parts = [];
      if (e.haendler) parts.push('Händler: ' + e.haendler);
      if (e.belegdatum) parts.push('Beleg: ' + formatDatum(e.belegdatum));
      if (e.haushaltsstelleId) parts.push('Kostenstelle: ' + stelleName(e.haushaltsstelleId));
      if (parts.length) line(doc, state, parts.join('  ·  '), { size: 9.5, color: C_MUTED, indent: IND });
      for (const d of (e.paperlessDocs || [])) line(doc, state, 'Beleg: ' + (d.title || ('Dokument ' + d.id)), { size: 9.5, indent: IND + 2 });
    } else if (e.typ === 'dokument') {
      const docs = e.paperlessDocs || [];
      if (docs.length === 0) line(doc, state, '(kein Dokument)', { size: 10, italic: true, color: C_MUTED, indent: IND });
      for (const d of docs) line(doc, state, 'Dokument: ' + (d.title || d.id) + '  (#' + d.id + ')', { size: 10, indent: IND });
    } else if (e.typ === 'referenz') {
      const target = store.getVorgang(e.refVorgangId);
      const label = target && roles.canSeeVorgang(target) ? (target.titel || '(ohne Titel)') + ' (' + (M.VORGANG_STATUS_LABEL[target.status] || target.status) + ')' : (target ? '(vertraulicher Vorgang)' : '(Vorgang nicht gefunden)');
      line(doc, state, '» ' + label, { size: 10, indent: IND });
      if (e.notiz) line(doc, state, e.notiz, { size: 9.5, color: C_MUTED, indent: IND + 2 });
    } else if (e.typ === 'angebot') {
      line(doc, state, (e.anbieter || '(ohne Anbieter)') + (e.preis != null ? '  —  ' + euro(e.preis) : ''), { size: 10, bold: true, indent: IND });
      if (e.beschreibung) line(doc, state, e.beschreibung, { size: 9.5, color: C_MUTED, indent: IND });
      for (const d of (e.paperlessDocs || [])) line(doc, state, 'Angebot: ' + (d.title || ('Dokument ' + d.id)), { size: 9.5, indent: IND + 2 });
    } else if (e.typ === 'entscheidung') {
      if (e.titel) line(doc, state, e.titel, { size: 10, bold: true, indent: IND });
      if (!e.teilnehmer || !e.teilnehmer.length || !e.eigenschaften || !e.eigenschaften.length) {
        line(doc, state, '(Matrix unvollständig)', { size: 10, italic: true, color: C_MUTED, indent: IND });
      } else {
        gap(state, 1);
        drawMatrix(doc, state, e);
        const win = e.teilnehmer.find(t => t.angebotId === M.entscheidungGewinner(e));
        if (win) line(doc, state, 'Empfehlung (höchste Punktzahl): ' + (win.name || '(ohne Anbieter)'), { size: 9.5, indent: IND });
        const chosen = e.teilnehmer.find(t => t.angebotId === e.gewaehltId);
        if (chosen) line(doc, state, 'Gewählter Anbieter: ' + (chosen.name || '(ohne Anbieter)'), { size: 10, bold: true, indent: IND });
        if (e.begruendung && e.begruendung.trim()) {
          line(doc, state, 'Begründung:', { size: 9.5, bold: true, indent: IND });
          for (const l of mdLines(e.begruendung)) { if (l.text === '') { gap(state, l.gap || 2.2); continue; } line(doc, state, l.text, { size: 9.5, indent: IND + (l.indent || 0), gap: 4.6 }); }
        }
      }
    }
  }

  // Eine Tabellenzelle mit Rahmen (und optionaler Füllung) + umbrochenem Text.
  function matrixCell(doc, x, y, w, h, text, opts = {}) {
    if (opts.fill) doc.setFillColor(opts.fill[0], opts.fill[1], opts.fill[2]);
    doc.setDrawColor(200); doc.setLineWidth(0.2);
    doc.rect(x, y, w, h, opts.fill ? 'FD' : 'S');
    setFont(doc, opts.size || 8.5, !!opts.bold, false, opts.color || C_TEXT);
    const pad = 1.3;
    const lines = doc.splitTextToSize(winAnsi(String(text == null ? '' : text)), w - 2 * pad);
    const maxLines = Math.max(1, Math.floor((h - 1) / 3.1));
    let ty = y + 3.4;
    for (let i = 0; i < lines.length && i < maxLines; i++) {
      if (opts.align === 'right') doc.text(lines[i], x + w - pad, ty, { align: 'right' });
      else if (opts.align === 'center') doc.text(lines[i], x + w / 2, ty, { align: 'center' });
      else doc.text(lines[i], x + pad, ty);
      ty += 3.1;
    }
  }

  // Entscheidungsmatrix als gezeichnete Tabelle (Anbieter × Eigenschaften).
  function drawMatrix(doc, state, e) {
    const gewinnerId = M.entscheidungGewinner(e);
    const crits = e.eigenschaften || [];
    const nameW = 44, preisW = 22, summeW = 20;
    const critTotal = CONTENT_W - nameW - preisW - summeW;
    const critW = crits.length ? Math.max(11, critTotal / crits.length) : critTotal;
    const headH = 11, rowH = 7;
    const HEAD_FILL = [235, 238, 243];

    function header(y) {
      let x = MARGIN_X;
      matrixCell(doc, x, y, nameW, headH, 'Anbieter', { bold: true, fill: HEAD_FILL }); x += nameW;
      for (const eig of crits) {
        const gw = Number(eig.gewicht);
        matrixCell(doc, x, y, critW, headH, eig.name + (gw !== 1 ? ' (x' + fmtPts(eig.gewicht) + ')' : ''), { bold: true, fill: HEAD_FILL, align: 'center', size: 8 }); x += critW;
      }
      matrixCell(doc, x, y, preisW, headH, 'Preis', { bold: true, fill: HEAD_FILL, align: 'right' }); x += preisW;
      matrixCell(doc, x, y, summeW, headH, 'Summe', { bold: true, fill: HEAD_FILL, align: 'right' });
      return y + headH;
    }

    ensureSpace(doc, state, headH + rowH + 2);
    state.y = header(state.y);

    for (const t of e.teilnehmer) {
      if (state.y + rowH > PAGE_H - 16) { doc.addPage(); state.y = MARGIN_TOP; state.y = header(state.y); }
      const zeile = (e.bewertung && e.bewertung[t.angebotId]) || {};
      const isChosen = t.angebotId === e.gewaehltId;
      const isWin = t.angebotId === gewinnerId;
      const fill = isChosen ? [214, 234, 219] : (isWin ? [235, 243, 250] : undefined);
      let x = MARGIN_X;
      const nameTxt = (t.name || '(ohne Anbieter)') + (isChosen ? '  [gewählt]' : (isWin ? '  [Empf.]' : ''));
      matrixCell(doc, x, state.y, nameW, rowH, nameTxt, { fill, bold: isChosen, size: 8.5 }); x += nameW;
      for (const eig of crits) { const p = zeile[eig.id]; matrixCell(doc, x, state.y, critW, rowH, p != null ? String(p) : '–', { fill, align: 'center' }); x += critW; }
      matrixCell(doc, x, state.y, preisW, rowH, t.preis != null ? euro(t.preis) : '—', { fill, align: 'right', size: 8 }); x += preisW;
      matrixCell(doc, x, state.y, summeW, rowH, fmtPts(M.entscheidungScore(e, t.angebotId)), { fill, align: 'right', bold: true });
      state.y += rowH;
    }
    state.y += 2;
  }

  // Fotos eines Verlaufseintrags: je Bild seitenverhältnistreu in eine feste
  // Box (Breite/Höhe), darunter die Bildunterschrift.
  async function renderFotos(doc, state, v, e, IND) {
    const BOX_W = 85, BOX_H = 60;
    if (e.bildunterschrift && e.bildunterschrift.trim()) {
      line(doc, state, e.bildunterschrift, { size: 10, indent: IND });
    }
    const fotos = store.listVorgangFotos(v.id).filter(f => f.kind === 'hist_' + e.id);
    if (fotos.length === 0) {
      line(doc, state, '(kein Foto)', { size: 10, italic: true, color: C_MUTED, indent: IND });
      return;
    }
    for (const f of fotos) {
      try {
        const img = await loadImage(store.vorgangFotoUrl(f.id), f.mimetype);
        const fit = fitBox(img.w, img.h, BOX_W, BOX_H);
        ensureSpace(doc, state, fit.h + 3);
        doc.addImage(img.dataUrl, img.format, MARGIN_X + IND, state.y, fit.w, fit.h, undefined, 'FAST');
        state.y += fit.h + 3;
      } catch (err) {
        console.warn('Foto konnte nicht ins PDF geladen werden', f.id, err);
        line(doc, state, '(Foto nicht ladbar: ' + (f.filename || f.id) + ')', { size: 9, italic: true, color: C_MUTED, indent: IND });
      }
    }
  }

  // === Separates PDF einer Entscheidungsmatrix (aus dem Auswahl-Eintrag) ===
  // opts.target: 'download' (Standard) | 'paperless'; opts.onUploaded (Paperless).
  async function buildEntscheidungPdf(v, e, opts = {}) {
    if (!v || !e) return;
    const doc = newDoc(); if (!doc) return;
    const settings = store.getSettings();
    const ort = (settings.vermietung && settings.vermietung.ortsgemeinde) || settings.ortsname || '';
    const state = { y: MARGIN_TOP };

    // Kopf mit Wappen rechts oben
    const WAPPEN_BOX = { w: 20, h: 24 };
    let kopfW = CONTENT_W;
    const wappen = getWappenDataUrl();
    if (wappen) {
      try {
        const p = doc.getImageProperties(wappen);
        const fit = fitBox(p.width, p.height, WAPPEN_BOX.w, WAPPEN_BOX.h);
        doc.addImage(wappen, 'PNG', RIGHT_X - fit.w, state.y - 2, fit.w, fit.h, undefined, 'SLOW');
        kopfW = CONTENT_W - fit.w - 5;
      } catch (_) { kopfW = CONTENT_W - WAPPEN_BOX.w - 5; }
    }
    setFont(doc, 15, true);
    doc.text(winAnsi('Entscheidungsmatrix'), MARGIN_X, state.y + 4); state.y += 9;
    const kopf = [
      'Ortsgemeinde ' + ort,
      'Vorgang: ' + (v.titel || '(ohne Titel)'),
      e.titel ? ('Auswahl: ' + e.titel) : null,
      e.datum ? ('Datum: ' + formatDatum(e.datum)) : null,
    ].filter(Boolean).join('  ·  ');
    line(doc, state, kopf, { size: 9.5, color: C_MUTED, maxWidth: kopfW });
    state.y = Math.max(state.y, MARGIN_TOP + WAPPEN_BOX.h);
    hr(doc, state, 4);

    if (!e.teilnehmer || !e.teilnehmer.length || !e.eigenschaften || !e.eigenschaften.length) {
      line(doc, state, 'Die Matrix ist unvollständig.', { size: 11, italic: true, color: C_MUTED });
    } else {
      line(doc, state, 'Bewertung: 0 = trifft nicht zu … 5 = trifft voll zu', { size: 9.5, color: C_MUTED });
      gap(state, 1.5);
      drawMatrix(doc, state, e);

      const max = M.entscheidungMaxScore(e);
      const win = e.teilnehmer.find(t => t.angebotId === M.entscheidungGewinner(e));
      if (win) line(doc, state, 'Empfehlung (höchste Punktzahl): ' + (win.name || '(ohne Anbieter)') + '  —  ' + fmtPts(M.entscheidungScore(e, win.angebotId)) + (max ? ' / ' + fmtPts(max) : '') + ' Punkte', { size: 10.5, bold: true, color: C_LEAD });
      gap(state, 2);
      const chosen = e.teilnehmer.find(t => t.angebotId === e.gewaehltId);
      line(doc, state, 'Gewählter Anbieter: ' + (chosen ? (chosen.name || '(ohne Anbieter)') : '(noch offen)'), { size: 11, bold: true });
      if (e.begruendung && e.begruendung.trim()) {
        gap(state, 1);
        line(doc, state, 'Begründung der Auswahl', { size: 10.5, bold: true, color: C_LEAD });
        for (const l of mdLines(e.begruendung)) { if (l.text === '') { gap(state, l.gap || 2.4); continue; } line(doc, state, l.text, { size: 10, indent: l.indent || 0, gap: 5 }); }
      }
      gap(state, 3);
      hr(doc, state, 3);
      line(doc, state, 'Verglichene Angebote', { size: 10.5, bold: true, color: C_LEAD });
      for (const t of e.teilnehmer) {
        line(doc, state, (t.name || '(ohne Anbieter)') + ': ' + (t.preis != null ? euro(t.preis) : 'kein Preis angegeben'), { size: 10, indent: 2 });
      }
    }

    // Fußzeile mit Seitenzahlen
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      setFont(doc, 8, false, false, C_MUTED);
      doc.text(winAnsi(ort + ' · Entscheidungsmatrix · Seite ' + i + '/' + pages), MARGIN_X, PAGE_H - 8);
      doc.text(new Date().toLocaleDateString('de-DE'), RIGHT_X, PAGE_H - 8, { align: 'right' });
    }

    const safe = ((v.titel || 'Vorgang') + '-Auswahl').replace(/[^\wäöüÄÖÜß ]+/g, '').replace(/\s+/g, '_').slice(0, 45);
    const filename = 'Entscheidungsmatrix-' + safe + '.pdf';
    if (opts.target === 'paperless') GR.ui.savePdfToPaperless(doc, filename, { prefillTitle: 'Entscheidungsmatrix: ' + (v.titel || '') + (e.titel ? ' – ' + e.titel : ''), onUploaded: opts.onUploaded });
    else openPdf(doc, filename);
  }

  GR.vorgaengePdf = { buildVorgangDokumentation, buildEntscheidungPdf };
})();
