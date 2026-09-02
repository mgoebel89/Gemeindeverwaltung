(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { toast } = GR.ui;

  // Ehrenurkunde zum Alters­jubiläum — Nachbau der ODT-Vorlage der Gemeinde.
  //
  // Aufbau wie in der Vorlage: goldener Lorbeerkranz mit der Jubiläumszahl
  // darin, rechts daneben das Wappen, darunter mittig der Glückwunschtext mit
  // dem Namen als größtem Element, unten Ort/Datum und zwei Unterschriftszeilen.
  //
  // ZWEI BEWUSSTE ABWEICHUNGEN von der Vorlage:
  //  1. Serifenschrift (Times) statt der Fließschrift des Textprogramms. Eine
  //     Urkunde trägt das besser, und die PDF-Standardschriften geben ohnehin
  //     nur Helvetica/Times/Courier her.
  //  2. Der Tippfehler „im Nahmen des Gemeinderates" ist berichtigt.
  //
  // Die Unterschriften bleiben LEER. Das ist keine Auslassung, sondern
  // Vorgabe: Ehrungen werden persönlich unterschrieben, und das hinterlegte
  // Bürgermeisterbild aus den Einstellungen hat hier nichts zu suchen.

  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN_X = 25;
  const MARGIN_TOP = 22;
  const RIGHT_X = PAGE_W - MARGIN_X;
  const CONTENT_W = PAGE_W - 2 * MARGIN_X;
  const MITTE = PAGE_W / 2;

  // Goldton des Lorbeerkranzes, für die Zahl darin.
  const C_GOLD = [212, 160, 23];

  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  // Umschrift für Zeichen, die die PDF-Standardschriften nicht können.
  //
  // Hintergrund (dieselbe Falle wie in vorgaenge-pdf.js): jsPDF kodiert
  // WinAnsi/CP1252. Steht EIN Zeichen außerhalb in der Zeile, verrutscht die
  // GANZE Zeile zu Buchstabensalat. Umlaute und ß sind enthalten und
  // unproblematisch — ein Name wie „Kowalczyk" mit ł oder ś aber nicht.
  //
  // Deshalb wird hier UMGESCHRIEBEN statt ersetzt: aus ł wird l, aus ş ein s.
  // Ein „?" mitten im Namen auf einer Ehrenurkunde wäre schlimmer als ein
  // fehlender Akzent.
  const UMSCHRIFT = {
    'Ā': 'A', 'ā': 'a', 'Ă': 'A', 'ă': 'a', 'Ą': 'A', 'ą': 'a',
    'Ć': 'C', 'ć': 'c', 'Ĉ': 'C', 'ĉ': 'c', 'Ċ': 'C', 'ċ': 'c', 'Č': 'C', 'č': 'c',
    'Ď': 'D', 'ď': 'd', 'Đ': 'D', 'đ': 'd',
    'Ē': 'E', 'ē': 'e', 'Ĕ': 'E', 'ĕ': 'e', 'Ė': 'E', 'ė': 'e', 'Ę': 'E', 'ę': 'e', 'Ě': 'E', 'ě': 'e',
    'Ĝ': 'G', 'ĝ': 'g', 'Ğ': 'G', 'ğ': 'g', 'Ġ': 'G', 'ġ': 'g', 'Ģ': 'G', 'ģ': 'g',
    'Ĥ': 'H', 'ĥ': 'h', 'Ħ': 'H', 'ħ': 'h',
    'Ĩ': 'I', 'ĩ': 'i', 'Ī': 'I', 'ī': 'i', 'Ĭ': 'I', 'ĭ': 'i', 'Į': 'I', 'į': 'i', 'İ': 'I', 'ı': 'i',
    'Ĵ': 'J', 'ĵ': 'j', 'Ķ': 'K', 'ķ': 'k',
    'Ĺ': 'L', 'ĺ': 'l', 'Ļ': 'L', 'ļ': 'l', 'Ľ': 'L', 'ľ': 'l', 'Ł': 'L', 'ł': 'l',
    'Ń': 'N', 'ń': 'n', 'Ņ': 'N', 'ņ': 'n', 'Ň': 'N', 'ň': 'n',
    'Ō': 'O', 'ō': 'o', 'Ŏ': 'O', 'ŏ': 'o', 'Ő': 'Ö', 'ő': 'ö',
    'Ŕ': 'R', 'ŕ': 'r', 'Ŗ': 'R', 'ŗ': 'r', 'Ř': 'R', 'ř': 'r',
    'Ś': 'S', 'ś': 's', 'Ŝ': 'S', 'ŝ': 's', 'Ş': 'S', 'ş': 's', 'Š': 'S', 'š': 's',
    'Ţ': 'T', 'ţ': 't', 'Ť': 'T', 'ť': 't', 'Ŧ': 'T', 'ŧ': 't',
    'Ũ': 'U', 'ũ': 'u', 'Ū': 'U', 'ū': 'u', 'Ŭ': 'U', 'ŭ': 'u', 'Ů': 'U', 'ů': 'u',
    'Ű': 'Ü', 'ű': 'ü', 'Ų': 'U', 'ų': 'u',
    'Ŵ': 'W', 'ŵ': 'w', 'Ŷ': 'Y', 'ŷ': 'y',
    'Ź': 'Z', 'ź': 'z', 'Ż': 'Z', 'ż': 'z', 'Ž': 'Z', 'ž': 'z',
    'ẞ': 'SS',
    '‚': ',', '„': '"', '‘': "'", '’': "'", '“': '"', '”': '"',
    '–': '-', '—': '-', '‑': '-', '−': '-', '…': '...', ' ': ' ',
  };

  function winAnsi(text) {
    // Hoch-/tiefgestellte Zeichen zuerst entschaerfen: die Pruefung unten
    // laesst ² (0xB2) richtigerweise durch, macht aus ₂ aber ein '?'.
    // Lesbar ist 'CO2'. Siehe export/pdf-inline.js.
    if (window.GR && GR.pdfInline) text = GR.pdfInline.entschaerfe(text);
    let out = '';
    for (const ch of String(text == null ? '' : text)) {
      if (UMSCHRIFT[ch] !== undefined) { out += UMSCHRIFT[ch]; continue; }
      const cp = ch.codePointAt(0);
      // CP1252 deckt Latin-1 ab; die Umlaute und ß liegen darin.
      if (cp <= 0xff) { out += ch; continue; }
      if (cp >= 0x1f000 || (cp >= 0x2190 && cp <= 0x2bff)) continue;  // Emoji raus
      out += '?';
    }
    return out;
  }

  function newDoc() {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert('jsPDF ist nicht geladen.'); return null; }
    return new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  }

  function setFont(doc, size, bold, color) {
    doc.setFont('times', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const c = color || [0, 0, 0];
    doc.setTextColor(c[0], c[1], c[2]);
  }

  // Zentrierte Zeile(n) ab state.y.
  function mittig(doc, state, text, opts = {}) {
    const { size = 12, bold = false, color, gap = size * 0.52, breite = CONTENT_W } = opts;
    setFont(doc, size, bold, color);
    const zeilen = doc.splitTextToSize(winAnsi(text), breite);
    for (const z of zeilen) {
      doc.text(z, MITTE, state.y, { align: 'center' });
      state.y += gap;
    }
  }

  // Punkt → mm. Und die Versalhöhe einer Schriftgröße, die für das optische
  // Ausrichten gebraucht wird: eine Grundlinie sagt nichts darüber, wo der Text
  // MITTIG sitzt — dafür muss man wissen, wie hoch die Großbuchstaben sind.
  const PT_MM = 0.352778;
  const VERSAL_ANTEIL = 0.662;          // Times: Versalhöhe je Schriftgrad
  const versalHoehe = (groesse) => groesse * PT_MM * VERSAL_ANTEIL;

  // Wie viele Zeilen braucht ein Text — ohne ihn zu zeichnen. Für die
  // Höhenverteilung nötig.
  function zeilenZahl(doc, text, groesse, bold, breite) {
    setFont(doc, groesse, bold);
    return doc.splitTextToSize(winAnsi(text), breite).length;
  }

  // Zierrahmen. Eine leere A4-Seite mit etwas Text in der Mitte wirkt wie ein
  // Entwurf; der doppelte Rahmen macht daraus eine Urkunde und füllt das Blatt,
  // ohne inhaltlich etwas zu erfinden.
  function rahmen(doc) {
    doc.setDrawColor(C_GOLD[0], C_GOLD[1], C_GOLD[2]);
    doc.setLineWidth(1.4);
    doc.rect(11, 11, PAGE_W - 22, PAGE_H - 22);
    doc.setLineWidth(0.4);
    doc.rect(14.5, 14.5, PAGE_W - 29, PAGE_H - 29);
    doc.setLineWidth(0.2);
    doc.setDrawColor(0);
  }

  const zwei = (n) => String(n).padStart(2, '0');

  function datumLang(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    return `${Number(m[3])}. ${MONATE[Number(m[2]) - 1]} ${m[1]}`;
  }
  function datumKurz(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
  }
  function heuteIso() {
    const d = new Date();
    return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
  }

  const vollerName = (eh) => [eh.vorname, eh.nachname].filter(Boolean).join(' ').trim();

  // Platzhalter füllen. Wird auch von der Vorschau im Modul benutzt, deshalb
  // exportiert.
  function fuelle(vorlage, eh, settings) {
    const s = settings || store.getSettings();
    const ort = (s.vermietung && s.vermietung.ortsgemeinde) || s.ortsname || 'Hörschhausen';
    return String(vorlage || '')
      .replace(/\{name\}/g, vollerName(eh))
      .replace(/\{alter\}/g, String(eh.alter || ''))
      .replace(/\{datum\}/g, datumLang(eh.datum))
      .replace(/\{ortsgemeinde\}/g, ort);
  }

  // --- Kopfgrafiken ---------------------------------------------------------
  // Lorbeerkranz links, Wappen rechts, die Jubiläumszahl mittig IM Kranz.
  // Rückgabe: Unterkante beider Grafiken, damit der Text nicht hineinläuft
  // (genau der Fehler, der im Juli in der Jahresübersicht steckte).
  // Wo in der Kranzhöhe die Öffnung optisch ihre Mitte hat. Der Kranz ist oben
  // offen und schließt sich unten, deshalb liegt sie etwas über der geometrischen
  // Mitte.
  const OEFFNUNG_MITTE = 0.46;
  const ZAHL_GROESSE = 68;

  // Die Jubiläumszahl optisch mittig in den Kranz setzen.
  //
  // NICHT über eine geratene Quote der Grundlinie: eine Grundlinie sagt nichts
  // darüber, wo der Text mittig sitzt — die Zahl hängt darunter, nicht darum
  // herum. Vorher stand die Grundlinie bei 78 % der Kranzhöhe, wodurch die Zahl
  // rund 6 mm zu tief saß und in die unteren Blätter lief. Jetzt wird von der
  // gewünschten MITTE aus zurückgerechnet: Grundlinie = Mitte + halbe Versalhöhe.
  function zahlInKranz(doc, alter, kranzX, kranzY, breite, hoehe) {
    setFont(doc, ZAHL_GROESSE, true, C_GOLD);
    const grundlinie = kranzY + hoehe * OEFFNUNG_MITTE + versalHoehe(ZAHL_GROESSE) / 2;
    doc.text(String(alter), kranzX + breite / 2, grundlinie, { align: 'center' });
  }

  function kopfGrafiken(doc, alter) {
    // Größer als in der Vorlage: auf A4 wirkt ein 60-mm-Kranz verloren.
    const kranzBox = { w: 74, h: 58 };
    const kranzX = MARGIN_X;
    const kranzY = MARGIN_TOP;
    let unten = kranzY;

    const kranzUrl = GR.pdfKopf.bildDataUrl('lorbeerImg');
    if (kranzUrl) {
      let masse = kranzBox;
      try {
        const p = doc.getImageProperties(kranzUrl);
        masse = GR.pdfKopf.fitBox(p.width, p.height, kranzBox.w, kranzBox.h);
      } catch (_) { /* ohne Maße der Kasten — besser als gar kein Kranz */ }
      try {
        doc.addImage(kranzUrl, 'PNG', kranzX, kranzY, masse.w, masse.h, undefined, 'SLOW');
        unten = Math.max(unten, kranzY + masse.h);
      } catch (e) {
        console.warn('Lorbeerkranz konnte nicht eingefügt werden', e);
        masse = { w: kranzBox.w, h: 0 };
      }
      if (masse.h) zahlInKranz(doc, alter, kranzX, kranzY, masse.w, masse.h);
    } else {
      // Ohne Kranzbild trotzdem eine Zahl setzen — die Urkunde soll nicht an
      // einer fehlenden Grafik scheitern.
      zahlInKranz(doc, alter, kranzX, kranzY, kranzBox.w, kranzBox.h);
      unten = kranzY + kranzBox.h;
    }

    // Das Wappen mittig zur Kranzhöhe, sonst klebt es oben in der Ecke.
    const wappenBox = { w: 36, h: 43 };
    const kranzHoehe = unten - kranzY;
    const wappenY = kranzY + Math.max(0, (kranzHoehe - wappenBox.h) / 2);
    const wappen = GR.pdfKopf.platziere(doc, {
      seite: 'rechts', x: RIGHT_X, y: wappenY, box: wappenBox,
    });
    unten = Math.max(unten, wappen.unterkante);
    return unten;
  }

  // --- Unterschriften -------------------------------------------------------
  // Zwei Blöcke nebeneinander, jeweils Linie, Name, Funktion. Ohne Bild.
  function unterschriften(doc, y, s) {
    const ein = s.einwohner || {};
    const bloecke = [
      { name: ein.urkundeUnterschrift1 || '', funktion: ein.urkundeFunktion1 || '' },
      { name: ein.urkundeUnterschrift2 || '', funktion: ein.urkundeFunktion2 || '' },
    ].filter(b => b.name || b.funktion);
    if (!bloecke.length) return y;

    const spalte = CONTENT_W / bloecke.length;
    const linienBreite = Math.min(70, spalte - 6);
    for (let i = 0; i < bloecke.length; i++) {
      const mitteX = MARGIN_X + spalte * i + spalte / 2;
      doc.setDrawColor(60); doc.setLineWidth(0.3);
      doc.line(mitteX - linienBreite / 2, y, mitteX + linienBreite / 2, y);
      setFont(doc, 12, false);
      doc.text(winAnsi(bloecke[i].name), mitteX, y + 5.5, { align: 'center' });
      setFont(doc, 10.5, false, [90, 90, 90]);
      doc.text(winAnsi(bloecke[i].funktion), mitteX, y + 11, { align: 'center' });
    }
    return y + 13;
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
        toast('Urkunde in neuem Tab geöffnet');
      }
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e) {
      console.error(e);
      alert('Die Urkunde konnte nicht erzeugt werden: ' + e.message);
    }
  }

  // --- Hauptbauer -----------------------------------------------------------
  // eh: { alter, datum, vorname, nachname }
  // opts: { anrede: 'du' | 'sie', target: 'download' | 'blob' }
  function buildUrkunde(eh, opts = {}) {
    const doc = newDoc();
    if (!doc) return null;
    const s = store.getSettings();
    const ein = s.einwohner || {};
    const ort = (s.vermietung && s.vermietung.ortsgemeinde) || s.ortsname || 'Hörschhausen';
    const anrede = opts.anrede === 'sie' ? 'sie' : 'du';

    rahmen(doc);
    const unten = kopfGrafiken(doc, eh.alter);

    // Die Blöcke des Textkörpers. `vorher` ist der Mindestabstand darüber, der
    // beim Verteilen zusätzlich aufgefüllt wird.
    const textBreite = CONTENT_W - 12;
    const vorlage = anrede === 'sie' ? ein.urkundeTextSie : ein.urkundeTextDu;
    // `dehnbar` entscheidet, wo zusätzliche Luft hinkommt. Das ist keine
    // Feinheit: die drei mittleren Blöcke bilden EINEN Satz
    // („… übermitteln wir dem Geburtstagskind / NAME / die herzlichsten
    // Glückwünsche."). Verteilt man die Luft gleichmäßig, klafft mitten im Satz
    // ein Loch und die Urkunde liest sich zerrissen. Gedehnt wird deshalb nur
    // vor der Überschrift und vor dem Schlussabsatz.
    const bloecke = [
      { text: `Zum ${eh.alter}. Geburtstag`, size: 19, bold: true, zeile: 9.5, vorher: 2, dehnbar: true },
      { text: `am ${datumLang(eh.datum)} übermitteln wir dem Geburtstagskind`, size: 13.5, zeile: 7.5, vorher: 9 },
      { text: vollerName(eh), size: 36, bold: true, zeile: 15, vorher: 8 },
      { text: 'die herzlichsten Glückwünsche.', size: 13.5, zeile: 7.5, vorher: 6 },
      { text: fuelle(vorlage, eh, s), size: 13, zeile: 7.6, vorher: 10, dehnbar: true, breite: textBreite },
    ];

    // Höhe messen, BEVOR gezeichnet wird — nur so lässt sich der Rest gleichmäßig
    // verteilen, statt den Text oben zusammenzudrängen und die untere Hälfte des
    // Blattes leer zu lassen.
    let natuerlich = 0;
    for (const b of bloecke) {
      b.zeilen = zeilenZahl(doc, b.text, b.size, b.bold, b.breite || CONTENT_W);
      b.hoehe = b.zeilen * b.zeile;
      natuerlich += b.hoehe + b.vorher;
    }

    const startY = Math.max(unten + 14, 88);
    const fussY = PAGE_H - 74;               // ab hier Ort/Datum + Unterschriften
    // Luft nur auf die dehnbaren Stellen verteilen, und gedeckelt: bei einem
    // sehr kurzen Text sollen die Blöcke nicht über die Seite auseinanderfliegen.
    const dehnbare = bloecke.filter(b => b.dehnbar).length || 1;
    const luft = Math.max(0, (fussY - 14) - startY - natuerlich);
    const zusatz = Math.min(luft / dehnbare, 22);

    const state = { y: startY };
    for (const b of bloecke) {
      state.y += b.vorher + (b.dehnbar ? zusatz : 0);
      mittig(doc, state, b.text, {
        size: b.size, bold: b.bold, gap: b.zeile, breite: b.breite || CONTENT_W,
      });
    }

    // Ort/Datum und Unterschriften stehen fest unten, nicht direkt unter dem
    // Text — sonst wandern sie je nach Textlänge.
    const ortY = Math.max(state.y + 16, fussY);
    setFont(doc, 11.5, false);
    doc.text(winAnsi(`Ortsgemeinde ${ort}, den ${datumKurz(opts.ausstellungsdatum || heuteIso())}`),
      MARGIN_X, ortY);

    unterschriften(doc, ortY + 32, s);

    const dateiName = `Urkunde_${eh.alter}_${(vollerName(eh) || 'Ehrung').replace(/[^\wÄÖÜäöüß]+/g, '_')}.pdf`;
    if (opts.target === 'blob') return doc.output('blob');
    openPdf(doc, dateiName);
    return doc;
  }

  GR.urkundePdf = {
    buildUrkunde,
    fuelle,
    // für Tests
    _winAnsi: winAnsi,
    _datumLang: datumLang,
    _datumKurz: datumKurz,
  };
})();
