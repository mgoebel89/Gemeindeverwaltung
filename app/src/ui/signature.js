(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast } = GR.ui;

  // Vollbild-Unterschriftenfeld. Der Nutzer (i. d. R. der Mieter) unterschreibt
  // mit Finger/Stift (oder Maus) direkt am Gerät. Ergebnis ist ein transparentes
  // PNG als Data-URL, das inline am Datensatz gespeichert wird.
  //
  // opts:
  //   onDone(dataUrl|null)  – dataUrl bei „Übernehmen", null bei „Abbrechen"
  //   title, subtitle       – Kopfzeile
  //   consent               – kleiner Einwilligungstext unter den Buttons
  //   name                  – Name über der Unterschriftslinie (nur Anzeige)
  function captureSignature(opts = {}) {
    const { onDone, title = 'Unterschrift', subtitle = '', consent = '', name = '' } = opts;

    const overlay = el('div', { class: 'sig-overlay' });
    const canvas = el('canvas', { class: 'sig-canvas' });
    const hint = el('div', { class: 'sig-hint' }, 'Hier mit dem Finger oder Stift unterschreiben');
    const baseline = el('div', { class: 'sig-baseline' });
    const nameLabel = name ? el('div', { class: 'sig-name' }, name) : null;
    const stage = el('div', { class: 'sig-stage' }, [canvas, baseline, hint, nameLabel]);

    const ctx = canvas.getContext('2d');
    let hasInk = false;
    let drawing = false;
    let last = null;

    const takeBtn = el('button', { class: 'btn-primary', disabled: true, onClick: () => finish() }, 'Übernehmen');
    const clearBtn = el('button', { class: 'btn', type: 'button', onClick: () => clearCanvas() }, 'Löschen');
    const cancelBtn = el('button', { class: 'btn', type: 'button', onClick: () => close(null) }, 'Abbrechen');

    function close(result) {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (typeof onDone === 'function') onDone(result);
    }
    function onKey(e) { if (e.key === 'Escape') close(null); }

    function finish() {
      if (!hasInk) { toast('Bitte zuerst unterschreiben'); return; }
      let dataUrl = null;
      try { dataUrl = canvas.toDataURL('image/png'); } catch (_) {}
      close(dataUrl);
    }

    // Canvas an die Bühnengröße + Device-Pixel-Ratio anpassen (scharfe Linien).
    // Löscht die aktuelle Zeichnung – daher nur beim Öffnen / bei echter
    // Größenänderung aufrufen.
    function sizeCanvas() {
      const rect = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#12233a';
    }

    function clearCanvas() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasInk = false;
      takeBtn.disabled = true;
      hint.style.display = '';
    }

    let lastRect = null;
    function onResize() {
      const rect = stage.getBoundingClientRect();
      // Nur bei echter Änderung neu dimensionieren (verhindert Löschen durch
      // die Adressleisten-Höhenwackler auf dem Handy).
      if (lastRect && Math.abs(rect.width - lastRect.width) < 2 && Math.abs(rect.height - lastRect.height) < 2) return;
      lastRect = rect;
      sizeCanvas();
      clearCanvas();
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function lineWidthFor(e) {
      // Stifte liefern Druck (0..1); Finger/Maus melden 0 oder 0.5 → fester Wert.
      const p = (e.pointerType === 'pen' && e.pressure > 0) ? e.pressure : 0.5;
      return 1.4 + p * 2.6;
    }

    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      drawing = true;
      hasInk = true;
      takeBtn.disabled = false;
      hint.style.display = 'none';
      last = pos(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      // Ein Punkt (Antippen) erzeugt einen sichtbaren Klecks.
      ctx.beginPath();
      ctx.lineWidth = lineWidthFor(e);
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(last.x + 0.01, last.y + 0.01);
      ctx.stroke();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.lineWidth = lineWidthFor(e);
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    const stop = e => { if (drawing) { drawing = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} } };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);

    overlay.appendChild(el('div', { class: 'sig-head' }, [
      el('h3', {}, title),
      subtitle ? el('span', { class: 'sig-sub' }, subtitle) : null,
    ]));
    overlay.appendChild(stage);
    if (consent) overlay.appendChild(el('div', { class: 'sig-consent' }, consent));
    overlay.appendChild(el('div', { class: 'sig-actions' }, [
      clearBtn,
      el('div', { class: 'spacer' }),
      cancelBtn,
      takeBtn,
    ]));

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    // Nach dem Layout dimensionieren (Bühne hat dann echte Maße).
    requestAnimationFrame(() => { lastRect = stage.getBoundingClientRect(); sizeCanvas(); });
  }

  GR.ui.captureSignature = captureSignature;
})();
