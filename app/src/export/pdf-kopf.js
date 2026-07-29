(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;

  // Gemeinsamer Kopf-Baustein für ALLE PDF-Bauer.
  //
  // Vorher gab es das Wappen an acht Stellen in fünf Dateien, jedes Mal mit
  // eigener Kopie von `getWappenDataUrl` und fest eingetragenen Millimetermaßen.
  // Daraus folgten zwei Fehler, die Matthias gemeldet hat:
  //
  //  1. VERZERRUNG. `addImage(..., 20, 24)` quetscht das Wappen in ein festes
  //     Rechteck. Ist die Bilddatei nicht zufällig im Verhältnis 20:24, wird sie
  //     gestaucht — derselbe Fehler wie früher bei den Unterschriften.
  //  2. ÜBERLAPPUNG. Wer die tatsächliche Höhe nicht kennt, rät den Abstand
  //     darunter. In der Vermietungsübersicht stand `state.y += 20`, während das
  //     Wappen bis 22 mm reichte — die Tabelle begann also IM Wappen.
  //
  // Deshalb macht dieser Baustein beides selbst: er passt das Bild
  // seitenverhältnistreu ein UND gibt seine Unterkante sowie die verbleibende
  // Textbreite zurück. Kein Aufrufer muss mehr Maße raten.
  //
  // Die Typografie bleibt bewusst bei den einzelnen Bauern: das
  // Auslagen-Formular und der VG-Vordruck sind maßgetreue Nachbauten amtlicher
  // Vorlagen. Ein gemeinsamer Kopf, der ihnen Schriftgrößen und Positionen
  // vorschreibt, würde genau die Treue zerstören, auf die es dort ankommt.

  // Abstand zwischen Wappenspalte und Text.
  const SPALTEN_ABSTAND = 5;
  // Luft zwischen Wappen-Unterkante und dem, was darunter folgt.
  const ABSTAND_UNTEN = 4;

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

  // Hochgeladenes Wappen aus den Einstellungen bevorzugt, sonst die Bilddatei
  // aus der Seite über ein Canvas.
  function wappenDataUrl() {
    let settings = null;
    try { settings = store.getSettings(); } catch (_) { settings = null; }
    if (settings && settings.wappenDataUrl) return settings.wappenDataUrl;
    return imageElementToDataUrl(document.getElementById('wappenImg'));
  }

  // Seitenverhältnistreu in eine Box einpassen → tatsächliche mm-Maße.
  // Ohne bekannte Naturmaße bleibt es beim Kasten (wie bisher).
  function fitBox(natW, natH, maxW, maxH) {
    if (!natW || !natH) return { w: maxW, h: maxH };
    const s = Math.min(maxW / natW, maxH / natH);
    return { w: natW * s, h: natH * s };
  }

  // Zeichnet das Wappen und liefert die Geometrie zurück.
  //
  // opts:
  //   seite          'rechts' (Standard) | 'links'
  //   x              linke Kante bei seite='links', RECHTE Kante bei 'rechts'
  //   y              Oberkante
  //   box            { w, h } Höchstmaße, Standard 20 × 24 mm
  //   inhaltsBreite  volle Textbreite; wird um die Wappenspalte gekürzt
  //
  // Rückgabe immer vollständig, auch ohne Wappen — dann mit Breite 0 und
  // `unterkante = y`, sodass die Aufrufer nicht unterscheiden müssen.
  function platziere(doc, opts) {
    const o = opts || {};
    const box = o.box || { w: 20, h: 24 };
    const y = o.y || 0;
    const ohne = {
      vorhanden: false, w: 0, h: 0, x: o.x, y,
      unterkante: y,
      textBreite: o.inhaltsBreite,
    };

    const url = wappenDataUrl();
    if (!url) return ohne;

    let masse;
    try {
      const p = doc.getImageProperties(url);
      masse = fitBox(p.width, p.height, box.w, box.h);
    } catch (_) {
      // Maße nicht ermittelbar (fremdes Format): Kasten wie bisher, damit das
      // Wappen wenigstens erscheint.
      masse = { w: box.w, h: box.h };
    }

    const x = o.seite === 'links' ? o.x : (o.x - masse.w);
    try {
      doc.addImage(url, 'PNG', x, y, masse.w, masse.h, undefined, 'SLOW');
    } catch (e) {
      console.warn('Wappen konnte nicht in das PDF eingefügt werden', e);
      return ohne;
    }

    return {
      vorhanden: true,
      w: masse.w,
      h: masse.h,
      x, y,
      unterkante: y + masse.h,
      textBreite: o.inhaltsBreite == null
        ? undefined
        : Math.max(20, o.inhaltsBreite - masse.w - SPALTEN_ABSTAND),
    };
  }

  // Ab hier darf weitergeschrieben werden, ohne ins Wappen zu laufen.
  // `jetzt` ist die aktuelle Schreibposition; zurück kommt die spätere von
  // beiden — steht der Text ohnehin tiefer, bleibt er unangetastet.
  function unterhalb(kopf, jetzt, abstand) {
    const unten = (kopf && kopf.unterkante ? kopf.unterkante : 0)
      + (abstand == null ? ABSTAND_UNTEN : abstand);
    return Math.max(jetzt, unten);
  }

  GR.pdfKopf = {
    wappenDataUrl,
    fitBox,
    platziere,
    unterhalb,
    SPALTEN_ABSTAND,
    ABSTAND_UNTEN,
    // für Tests
    _imageElementToDataUrl: imageElementToDataUrl,
  };
})();
