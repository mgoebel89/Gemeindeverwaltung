(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { toast } = GR.ui;

  // Prüfliste für den jährlichen Abgleich mit der Papierliste der
  // Verbandsgemeinde.
  //
  // Die Sortierung ist der ganze Zweck dieses Dokuments: Straße, dann Nachname,
  // dann Vorname — genau wie die Amtsliste. Bewusst NICHT nach Hausnummer;
  // sortierte man danach, ließen sich die beiden Listen nicht mehr Zeile für
  // Zeile nebeneinander durchgehen, und das ist die einzige Arbeitsweise, die
  // ohne Datei funktioniert.
  //
  // Die Amtsliste führt kein Geburtsdatum. Es steht hier trotzdem mit, weil
  // beim Durchgehen ohnehin auffällt, wenn ein Jahrgang nicht stimmen kann —
  // und weil die Ehrungen daran hängen.

  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN_X = 16;
  const MARGIN_TOP = 18;
  const RIGHT_X = PAGE_W - MARGIN_X;
  const CONTENT_W = PAGE_W - 2 * MARGIN_X;
  const FUSS_Y = PAGE_H - 12;

  // Spalten: Kästchen, Name, Vorname, Anschrift, Geburtsdatum
  const SPALTEN = [
    { key: 'box', w: 7, label: '' },
    { key: 'nachname', w: 42, label: 'Name' },
    { key: 'vorname', w: 34, label: 'Vorname' },
    { key: 'anschrift', w: 62, label: 'Anschrift' },
    { key: 'geburtsdatum', w: 33, label: 'Geburtsdatum' },
  ];

  function newDoc() {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert('jsPDF ist nicht geladen.'); return null; }
    return new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  }

  function setFont(doc, size, bold) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
  }

  const datumDe = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
  };

  function anschrift(e) {
    const nr = [e.hausnummer, e.zusatz].filter(Boolean).join('');
    return [e.strasse, nr].filter(Boolean).join(' ');
  }

  // Ankreuzfeld als Vektor — ☐ kann die PDF-Standardschrift nicht.
  function kaestchen(doc, x, baselineY, size = 3.4) {
    doc.setDrawColor(60); doc.setLineWidth(0.3);
    doc.rect(x, baselineY - size + 0.4, size, size);
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

  // --- Kopf und Tabellenkopf -----------------------------------------------
  function kopfZeichnen(doc, state, ortsname, anzahl) {
    const kopf = GR.pdfKopf.platziere(doc, {
      seite: 'rechts', x: RIGHT_X, y: MARGIN_TOP,
      box: { w: 18, h: 22 }, inhaltsBreite: CONTENT_W,
    });
    const breite = kopf.textBreite == null ? CONTENT_W : kopf.textBreite;

    state.y = MARGIN_TOP + 5;
    setFont(doc, 15, true);
    doc.text('Einwohnerprüfliste', MARGIN_X, state.y, { maxWidth: breite });
    state.y += 7;
    setFont(doc, 10, false);
    doc.text(`Ortsgemeinde ${ortsname}`, MARGIN_X, state.y, { maxWidth: breite });
    state.y += 5;
    doc.setTextColor(90);
    doc.text(
      `Stand ${datumDe(heuteIso())} · ${anzahl} Einwohner · sortiert nach Straße, Name, Vorname`,
      MARGIN_X, state.y, { maxWidth: breite },
    );
    doc.setTextColor(0);
    state.y += 5;
    doc.text('Zum Abgleich mit der Liste der Verbandsgemeinde: Zeile für Zeile abhaken, Abweichungen am Rand vermerken.',
      MARGIN_X, state.y, { maxWidth: breite });
    state.y = GR.pdfKopf.unterhalb(kopf, state.y + 6);
  }

  function tabellenKopf(doc, state) {
    setFont(doc, 8.5, true);
    doc.setTextColor(70);
    let x = MARGIN_X;
    for (const s of SPALTEN) {
      if (s.label) doc.text(s.label, x, state.y);
      x += s.w;
    }
    doc.setTextColor(0);
    state.y += 1.6;
    doc.setDrawColor(150); doc.setLineWidth(0.3);
    doc.line(MARGIN_X, state.y, RIGHT_X, state.y);
    state.y += 4;
  }

  function heuteIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Reicht der Platz noch? Sonst neue Seite samt Tabellenkopf.
  function platzPruefen(doc, state, brauchtMm) {
    if (state.y + brauchtMm <= FUSS_Y - 6) return;
    doc.addPage();
    state.y = MARGIN_TOP;
    tabellenKopf(doc, state);
  }

  function strassenKopf(doc, state, strasse) {
    platzPruefen(doc, state, 12);
    state.y += 1.5;
    setFont(doc, 10, true);
    doc.text(strasse || '(ohne Straßenangabe)', MARGIN_X, state.y);
    state.y += 1.4;
    doc.setDrawColor(200); doc.setLineWidth(0.2);
    doc.line(MARGIN_X, state.y, RIGHT_X, state.y);
    state.y += 4.2;
  }

  function zeile(doc, state, e) {
    platzPruefen(doc, state, 6);
    let x = MARGIN_X;
    kaestchen(doc, x + 1, state.y);
    x += SPALTEN[0].w;
    setFont(doc, 9.5, false);
    const werte = [
      e.nachname || '',
      e.vorname || '',
      anschrift(e) || '',
      datumDe(e.geburtsdatum) || '',
    ];
    for (let i = 0; i < werte.length; i++) {
      const s = SPALTEN[i + 1];
      // Lange Namen kürzen statt umbrechen — eine Zeile je Person hält die
      // Liste neben der Amtsliste synchron.
      doc.text(String(werte[i]), x, state.y, { maxWidth: s.w - 2 });
      x += s.w;
    }
    state.y += 5.6;
  }

  function fusszeilen(doc, ortsname) {
    const seiten = doc.internal.getNumberOfPages();
    for (let i = 1; i <= seiten; i++) {
      doc.setPage(i);
      setFont(doc, 8, false);
      doc.setTextColor(120);
      doc.text(`Ortsgemeinde ${ortsname} · Einwohnerprüfliste · Seite ${i}/${seiten}`, MARGIN_X, FUSS_Y);
      doc.text('vertraulich', RIGHT_X, FUSS_Y, { align: 'right' });
      doc.setTextColor(0);
    }
  }

  // --- Hauptbauer -----------------------------------------------------------
  // `liste` kommt bereits amtlich sortiert aus dem Backend. Hier wird nur noch
  // nach Straße gruppiert — dieselbe Reihenfolge, nur mit Zwischenüberschrift.
  function buildPruefliste(liste, opts = {}) {
    const doc = newDoc();
    if (!doc) return null;
    const s = store.getSettings();
    const ortsname = s.ortsname || 'Hörschhausen';
    const eintraege = Array.isArray(liste) ? liste : [];

    const state = { y: MARGIN_TOP };
    kopfZeichnen(doc, state, ortsname, eintraege.length);
    tabellenKopf(doc, state);

    if (!eintraege.length) {
      setFont(doc, 10, false);
      doc.text('Keine Einwohner erfasst.', MARGIN_X, state.y);
    }

    let letzteStrasse = null;
    for (const e of eintraege) {
      const str = e.strasse || '';
      if (str !== letzteStrasse) {
        strassenKopf(doc, state, str);
        letzteStrasse = str;
      }
      zeile(doc, state, e);
    }

    fusszeilen(doc, ortsname);

    const name = `Einwohnerpruefliste_${ortsname}_${heuteIso()}.pdf`.replace(/\s+/g, '_');
    if (opts.target === 'blob') return doc.output('blob');
    openPdf(doc, name);
    return doc;
  }

  GR.einwohnerPdf = {
    buildPruefliste,
    // für Tests
    _anschrift: anschrift,
    _datumDe: datumDe,
    SPALTEN,
  };
})();
