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
  const PRIO_LABEL = { 1: 'Niedrig', 2: 'Mittel', 3: 'Hoch', 4: 'Dringend', 5: 'Sofort' };
  const TYP_LABEL = { notiz: 'Notiz', todo: 'ToDo', dokument: 'Dokument', referenz: 'Referenz', kosten: 'Kosten' };

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
    const lines = doc.splitTextToSize(String(text == null ? '' : text), mw);
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

  // === Gesamt-Dokumentation eines Vorgangs ===
  // opts.target: 'download' (Standard) | 'paperless'; opts.onUploaded (Paperless).
  function buildVorgangDokumentation(v, opts = {}) {
    if (!v) return;
    const doc = newDoc(); if (!doc) return;
    const settings = store.getSettings();
    const ort = (settings.vermietung && settings.vermietung.ortsgemeinde) || settings.ortsname || '';
    const state = { y: MARGIN_TOP };

    // Kopf
    const wappen = getWappenDataUrl();
    if (wappen) { try { doc.addImage(wappen, 'PNG', RIGHT_X - 20, state.y - 2, 20, 24, undefined, 'SLOW'); } catch (_) {} }
    setFont(doc, 15, true);
    doc.text('Vorgang: ' + (v.titel || '(ohne Titel)'), MARGIN_X, state.y + 4, { maxWidth: CONTENT_W - 24 });
    state.y += 11;
    const kopf = [
      'Ortsgemeinde ' + ort,
      'Status: ' + (M.VORGANG_STATUS_LABEL[v.status] || v.status || '—'),
      v.kategorie ? 'Kategorie: ' + v.kategorie : null,
      'angelegt ' + (v.erstelltAm ? formatDatum(v.erstelltAm) : '—'),
    ].filter(Boolean).join('  ·  ');
    line(doc, state, kopf, { size: 9.5, color: C_MUTED });
    if (v.vertraulich) line(doc, state, '🔒 VERTRAULICH', { size: 9.5, bold: true, color: [183, 121, 31] });
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
      const head = (e.datum ? formatDatum(e.datum) : '—') + '  ·  ' + (TYP_LABEL[e.typ] || e.typ) + (e.vertraulich ? '  🔒' : '');
      line(doc, state, head, { size: 10.5, bold: true });
      renderEntry(doc, state, v, e);
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

  function renderEntry(doc, state, v, e) {
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
      line(doc, state, (e.erledigt ? '☑ ' : '☐ ') + (e.titel || '(ohne Titel)') + (meta.length ? '  (' + meta.join(' · ') + ')' : ''), { size: 10, indent: IND });
    } else if (e.typ === 'kosten') {
      line(doc, state, `${euro(e.betrag)} — ${e.beschreibung || 'Kosten'}`, { size: 10, bold: true, indent: IND });
      const parts = [];
      if (e.haendler) parts.push('Händler: ' + e.haendler);
      if (e.belegdatum) parts.push('Beleg: ' + formatDatum(e.belegdatum));
      if (e.haushaltsstelleId) parts.push('Kostenstelle: ' + stelleName(e.haushaltsstelleId));
      if (parts.length) line(doc, state, parts.join('  ·  '), { size: 9.5, color: C_MUTED, indent: IND });
      for (const d of (e.paperlessDocs || [])) line(doc, state, '📄 ' + (d.title || ('Dokument ' + d.id)), { size: 9.5, indent: IND + 2 });
    } else if (e.typ === 'dokument') {
      const docs = e.paperlessDocs || [];
      if (docs.length === 0) line(doc, state, '(kein Dokument)', { size: 10, italic: true, color: C_MUTED, indent: IND });
      for (const d of docs) line(doc, state, '📄 ' + (d.title || ('Dokument ' + d.id)) + '  (#' + d.id + ')', { size: 10, indent: IND });
    } else if (e.typ === 'referenz') {
      const target = store.getVorgang(e.refVorgangId);
      const label = target && roles.canSeeVorgang(target) ? (target.titel || '(ohne Titel)') + ' (' + (M.VORGANG_STATUS_LABEL[target.status] || target.status) + ')' : (target ? '(vertraulicher Vorgang)' : '(Vorgang nicht gefunden)');
      line(doc, state, '→ ' + label, { size: 10, indent: IND });
      if (e.notiz) line(doc, state, e.notiz, { size: 9.5, color: C_MUTED, indent: IND + 2 });
    }
  }

  GR.vorgaengePdf = { buildVorgangDokumentation };
})();
