(function () {
  'use strict';
  window.GR = window.GR || {};

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = !!v;
      else node.setAttribute(k, v);
    }
    const list = Array.isArray(children) ? children : [children];
    for (const c of list) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  function toast(message, ms = 2200) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.hidden = true), ms);
  }

  function confirmDialog(text) { return window.confirm(text); }

  function downloadFile(filename, content, mime = 'application/octet-stream') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  // capture: z. B. 'environment', damit auf dem Handy direkt die Kamera öffnet
  // (auf dem Desktop wird das Attribut ignoriert → normaler Dateidialog).
  function pickFile(accept = '.json', capture = null) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      if (capture) input.setAttribute('capture', capture);
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsText(file, 'utf-8');
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  function formatDatum(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function wochentag(iso) {
    if (!iso) return '';
    const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    return days[new Date(iso + 'T00:00:00').getDay()];
  }

  function nowTime() {
    return new Date().toTimeString().slice(0, 5);
  }

  GR.ui = { el, toast, confirmDialog, downloadFile, pickFile, readFileAsText, readFileAsDataUrl, formatDatum, wochentag, nowTime };
})();
