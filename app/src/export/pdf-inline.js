(function () {
  'use strict';
  window.GR = window.GR || {};

  // Auszeichnungen INNERHALB einer Zeile für jsPDF: hochgestellt, tiefgestellt,
  // fett, kursiv.
  //
  // WARUM DAS EIN EIGENER BAUSTEIN IST UND WARUM ES IHN LANGE NICHT GAB:
  // jsPDF kann eine Zeile nur in EINER Schrift und EINER Größe setzen. Sobald
  // sich mitten in der Zeile etwas ändert, muss die Zeile in Stücke zerlegt,
  // jedes Stück einzeln gemessen und an seiner eigenen x-Position gesetzt
  // werden — und der Zeilenumbruch muss über die Stückgrenzen hinweg rechnen,
  // weil `splitTextToSize` das nicht mehr kann. Genau diese Maschinerie ist der
  // Grund, warum Fett und Kursiv im Protokoll bisher fehlten.
  //
  // FERTIGE UNICODE-ZEICHEN SIND KEINE ABKÜRZUNG. Am Blatt geprüft, was die
  // Standardschrift wirklich kann:
  //   ¹ ² ³        drucken korrekt — „1.250 m²" war nie kaputt
  //   ⁰ und ⁴ – ⁹  drucken als falsche BUCHSTABEN (p, t, u, v, w, x, y)
  //   ₀ – ₉        drucken als Satzzeichen — aus „CO₂" wird „CO,"
  // und in den beiden schlechten Fällen verliert die GANZE Zeile ihre
  // Laufweite, weil jsPDF auf eine andere Kodierung umschaltet und sämtliche
  // Breiten falsch misst. Solche Zeichen werden hier deshalb eingelesen und
  // über denselben Weg gesetzt wie `m^2` — wer aus Word ein „CO₂" einfügt,
  // bekommt es einfach richtig gedruckt.

  // Punkt -> Millimeter. Das Dokument rechnet in mm, Schriftgrößen in pt.
  const PT_MM = 0.3528;
  // Maßverhältnisse für die versetzten Stücke. Mit 0,65 / 0,33 / 0,16 am
  // gedruckten Blatt geprüft, bei 11 pt Fließtext und bei 14 pt.
  const KLEIN = 0.65;
  const HOCH_VERSATZ = 0.33;
  const TIEF_VERSATZ = 0.16;

  // Fertige Zeichen, die jemand tippt (AltGr+2 auf der deutschen Tastatur) oder
  // aus Word einfügt. Sie werden in dieselbe Form gebracht wie `^2`.
  const HOCH_ZEICHEN = {
    '¹': '1', '²': '2', '³': '3',
    '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6',
    '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', 'ⁿ': 'n',
  };
  const TIEF_ZEICHEN = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '-',
  };

  function leererStil() {
    return { hoch: false, tief: false, fett: false, kursiv: false };
  }
  function stilMit(stil, aenderung) {
    return Object.assign(leererStil(), stil, aenderung || {});
  }

  // --- Zerlegen -------------------------------------------------------------
  // Aus „1250 m^2 CO_2" wird eine Liste von Stücken mit je eigenem Stil.
  //
  // Schreibweise: `^` und `_` gelten für EIN Zeichen, `^{...}` und `_{...}` für
  // mehrere. `**fett**`, `*kursiv*`. Ein wörtliches Sonderzeichen wird mit
  // Backslash geschützt: `\_`, `\^`, `\*`, `\\`.
  function zerlege(text) {
    const s = String(text == null ? '' : text);
    const stuecke = [];
    let puffer = '';
    let stil = leererStil();
    let fett = false, kursiv = false;

    const schiebe = (zusatzStil) => {
      if (!puffer) return;
      stuecke.push({ text: puffer, stil: stilMit(zusatzStil || stil, { fett: fett, kursiv: kursiv }) });
      puffer = '';
    };

    for (let i = 0; i < s.length; i++) {
      const c = s[i];

      // Backslash schützt das nächste Zeichen.
      if (c === '\\' && i + 1 < s.length && '^_*\\{}'.indexOf(s[i + 1]) >= 0) {
        puffer += s[i + 1];
        i++;
        continue;
      }

      // Fertige Hoch-/Tiefstellzeichen: wie ^x bzw. _x behandeln.
      if (HOCH_ZEICHEN[c] || TIEF_ZEICHEN[c]) {
        const hoch = !!HOCH_ZEICHEN[c];
        // Eine Folge solcher Zeichen zu EINEM Stück zusammenfassen, damit aus
        // „m²³" nicht zwei einzeln gesetzte Stücke werden.
        let folge = '';
        while (i < s.length && ((hoch && HOCH_ZEICHEN[s[i]]) || (!hoch && TIEF_ZEICHEN[s[i]]))) {
          folge += (hoch ? HOCH_ZEICHEN[s[i]] : TIEF_ZEICHEN[s[i]]);
          i++;
        }
        i--;
        schiebe();
        stuecke.push({
          text: folge,
          stil: stilMit(leererStil(), { hoch: hoch, tief: !hoch, fett: fett, kursiv: kursiv }),
        });
        continue;
      }

      if (c === '^' || c === '_') {
        const hoch = (c === '^');
        let inhalt = '';
        if (s[i + 1] === '{') {
          const ende = s.indexOf('}', i + 2);
          if (ende < 0) { puffer += c; continue; }   // offene Klammer: wörtlich
          inhalt = s.slice(i + 2, ende);
          i = ende;
        } else if (i + 1 < s.length && !/\s/.test(s[i + 1])) {
          inhalt = s[i + 1];
          i++;
        } else {
          puffer += c;                                // allein stehend: wörtlich
          continue;
        }
        if (!inhalt) continue;
        schiebe();
        stuecke.push({
          text: inhalt,
          stil: stilMit(leererStil(), { hoch: hoch, tief: !hoch, fett: fett, kursiv: kursiv }),
        });
        continue;
      }

      if (c === '*') {
        if (s[i + 1] === '*') { schiebe(); fett = !fett; i++; continue; }
        schiebe(); kursiv = !kursiv; continue;
      }

      puffer += c;
    }
    schiebe();
    return stuecke.filter(t => t.text !== '');
  }

  // Lohnt sich das Zerlegen überhaupt? Der weitaus häufigste Fall ist Text ohne
  // jede Auszeichnung — der soll nicht durch die ganze Maschinerie laufen.
  function hatAuszeichnung(text) {
    const s = String(text == null ? '' : text);
    if (/[\^_*\\]/.test(s)) return true;
    for (const c of s) if (HOCH_ZEICHEN[c] || TIEF_ZEICHEN[c]) return true;
    return false;
  }

  // Der Text ohne jede Auszeichnung — für Stellen, die nur messen oder
  // vergleichen wollen.
  function klartext(text) {
    return zerlege(text).map(t => t.text).join('');
  }

  // --- Messen ---------------------------------------------------------------
  function schriftart(stil, grundFett, grundKursiv) {
    const f = stil.fett || grundFett;
    const k = stil.kursiv || grundKursiv;
    return f && k ? 'bolditalic' : f ? 'bold' : k ? 'italic' : 'normal';
  }
  function groesse(stil, grund) {
    return (stil.hoch || stil.tief) ? grund * KLEIN : grund;
  }
  function versatz(stil, grund) {
    if (stil.hoch) return -grund * HOCH_VERSATZ * PT_MM;
    if (stil.tief) return grund * TIEF_VERSATZ * PT_MM;
    return 0;
  }

  function breiteVon(doc, stueck, grund, grundFett, grundKursiv) {
    doc.setFont('helvetica', schriftart(stueck.stil, grundFett, grundKursiv));
    doc.setFontSize(groesse(stueck.stil, grund));
    return doc.getTextWidth(stueck.text);
  }

  // --- Umbrechen ------------------------------------------------------------
  // Liefert Zeilen; jede Zeile ist wieder eine Liste von Stücken.
  //
  // `splitTextToSize` kann das nicht mehr, sobald eine Zeile verschieden große
  // Stücke enthält — die Breite hängt am Stil jedes einzelnen Wortes.
  function umbrich(doc, stuecke, maxBreite, grund, grundFett, grundKursiv) {
    // In Wörter und Zwischenräume zerlegen, Stil je Teil mitnehmen.
    const teile = [];
    for (const st of stuecke) {
      for (const w of st.text.split(/(\s+)/)) {
        if (w !== '') teile.push({ text: w, stil: st.stil, leer: /^\s+$/.test(w) });
      }
    }

    const zeilen = [];
    let zeile = [];
    let breite = 0;
    const schliesse = () => {
      // Nachlaufende Zwischenräume tragen nicht zur Zeile bei.
      while (zeile.length && zeile[zeile.length - 1].leer) zeile.pop();
      zeilen.push(zeile);
      zeile = [];
      breite = 0;
    };

    for (const t of teile) {
      const b = breiteVon(doc, t, grund, grundFett, grundKursiv);
      // Am Zeilenanfang keine Zwischenräume mitschleppen.
      if (!zeile.length && t.leer) continue;
      if (zeile.length && !t.leer && breite + b > maxBreite) {
        schliesse();
        if (t.leer) continue;
      }
      zeile.push(t);
      breite += b;
    }
    if (zeile.length) schliesse();
    if (!zeilen.length) zeilen.push([]);
    return zeilen;
  }

  // Breite einer fertigen Zeile — für rechtsbündigen oder zentrierten Satz.
  function zeilenBreite(doc, zeile, grund, grundFett, grundKursiv) {
    let b = 0;
    for (const t of zeile) b += breiteVon(doc, t, grund, grundFett, grundKursiv);
    return b;
  }

  // --- Zeichnen -------------------------------------------------------------
  // Setzt EINE Zeile ab x. Gibt die gezeichnete Breite zurück.
  function gleicherStil(a, b) {
    return a.hoch === b.hoch && a.tief === b.tief
      && a.fett === b.fett && a.kursiv === b.kursiv;
  }

  // Benachbarte Teile gleichen Stils zu EINEM Zug zusammenfassen.
  //
  // Der Umbruch zerlegt die Zeile in einzelne Woerter — die braucht er, um zu
  // messen. Sie einzeln zu setzen waere aber falsch: jsPDF wuerde jedes Wort an
  // eine selbst gerechnete Position stellen und dabei Wortabstaende und Kerning
  // verlieren. Gesetzt wird deshalb wieder in ganzen Stuecken; nur dort, wo der
  // Stil wechselt, entsteht ein neuer Zug.
  function fasseZusammen(zeile) {
    const zuege = [];
    for (const t of zeile) {
      const letzter = zuege[zuege.length - 1];
      if (letzter && gleicherStil(letzter.stil, t.stil)) letzter.text += t.text;
      else zuege.push({ text: t.text, stil: t.stil });
    }
    return zuege;
  }

  function zeichneZeile(doc, zeile, x, y, grund, grundFett, grundKursiv) {
    let cx = x;
    for (const t of fasseZusammen(zeile)) {
      const art = schriftart(t.stil, grundFett, grundKursiv);
      const g = groesse(t.stil, grund);
      doc.setFont('helvetica', art);
      doc.setFontSize(g);
      doc.text(t.text, cx, y + versatz(t.stil, grund));
      cx += doc.getTextWidth(t.text);
    }
    // Aufgeräumt zurücklassen, sonst läuft der nächste Aufrufer in der
    // zuletzt gesetzten Größe weiter.
    doc.setFont('helvetica', grundFett && grundKursiv ? 'bolditalic'
      : grundFett ? 'bold' : grundKursiv ? 'italic' : 'normal');
    doc.setFontSize(grund);
    return cx - x;
  }

  // --- Entschaerfen fuer Module ohne Zeilensetzer ---------------------------
  // Nicht jedes PDF der App setzt Zeilen aus Stuecken (Vermietung, Auslagen,
  // Vertraege, Vorgaenge, Arbeitszeiten, Einwohner, Urkunde). Dort genuegt es,
  // dafuer zu sorgen, dass ein eingefuegtes Zeichen die Zeile nicht zerstoert.
  //
  // WAS DIE STANDARDSCHRIFT WIRKLICH KANN, am Blatt geprueft:
  //   ¹ ² ³ und °  -> drucken korrekt, bleiben unangetastet
  //   ⁰ ⁴ bis ⁹    -> drucken als falsche BUCHSTABEN (p, t, u, v, w, x, y)
  //   ₀ bis ₉      -> drucken als Satzzeichen (aus ₂ wird ein Komma)
  // und in beiden schlechten Faellen verliert die GANZE Zeile ihre Laufweite,
  // weil jsPDF auf eine andere Kodierung umschaltet und alle Breiten falsch
  // misst. Aus „CO₂" wird deshalb hier „CO2" — lesbar und richtig, statt
  // „CO," in einer zerrissenen Zeile.
  const DRUCKBAR = { '¹': 1, '²': 1, '³': 1 };
  function entschaerfe(text) {
    let out = '';
    for (const c of String(text == null ? '' : text)) {
      if (DRUCKBAR[c]) out += c;
      else if (HOCH_ZEICHEN[c]) out += HOCH_ZEICHEN[c];
      else if (TIEF_ZEICHEN[c]) out += TIEF_ZEICHEN[c];
      else out += c;
    }
    return out;
  }

  // Schutz an der Wurzel fuer Module, die ihren Text an vielen Stellen direkt
  // setzen. Statt Dutzende Aufrufstellen einzeln anzufassen wird `doc.text`
  // dieses EINEN Dokuments einmal umhuellt — dann kann keine Stelle vergessen
  // werden, auch keine spaeter hinzugefuegte.
  function schuetze(doc) {
    if (!doc || doc._grEntschaerft) return doc;
    const echt = doc.text.bind(doc);
    doc.text = function (t) {
      const args = Array.prototype.slice.call(arguments);
      args[0] = Array.isArray(t) ? t.map(entschaerfe) : entschaerfe(t);
      return echt.apply(null, args);
    };
    doc._grEntschaerft = true;
    return doc;
  }

  GR.pdfInline = {
    zerlege, hatAuszeichnung, klartext, entschaerfe, schuetze, fasseZusammen,
    umbrich, zeichneZeile, zeilenBreite, breiteVon,
    // für Tests
    _PT_MM: PT_MM, _KLEIN: KLEIN,
  };
})();
