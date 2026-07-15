(function () {
  'use strict';
  window.GR = window.GR || {};

  // Rollen-/Vertraulichkeits-Steuerung (Vorstufe zur echten Nutzerverwaltung).
  //
  // WICHTIG – bewusst clientseitig: Dies ist reine Anzeige-Filterung. Vertrauliche
  // Vorgänge/Einträge liegen technisch weiterhin im Snapshot/localStorage jedes
  // Geräts. Es ist KEIN Schutz gegen jemanden mit Netzwerk-/Browserzugriff,
  // sondern richtet die Oberfläche für eine spätere serverseitige Nutzerverwaltung
  // vor. Der PIN gatet lediglich das Umschalten in die Leitungs-Ansicht.
  //
  // Rollen: 'rat' (Standard, sieht keine vertraulichen Inhalte) | 'leitung'
  // (Bürgermeister + Beigeordneter, sieht alles). Der Unlock gilt pro
  // Browser-Session (sessionStorage) – nach dem Schließen wieder gesperrt.

  const SESSION_KEY = 'gr.rolle';
  const listeners = [];

  function current() {
    try { return sessionStorage.getItem(SESSION_KEY) === 'leitung' ? 'leitung' : 'rat'; }
    catch (_) { return 'rat'; }
  }
  function isLeitung() { return current() === 'leitung'; }

  function setRole(role) {
    try {
      if (role === 'leitung') sessionStorage.setItem(SESSION_KEY, 'leitung');
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
    for (const fn of listeners) { try { fn(current()); } catch (e) { console.warn(e); } }
  }
  function setRat() { setRole('rat'); }
  function onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

  // --- PIN (SHA-256-Hash in den Settings) ---
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function pinHash() {
    const s = GR.store && GR.store.getSettings && GR.store.getSettings();
    return (s && s.vorgaenge && s.vorgaenge.leitungPinHash) || '';
  }
  function hasPin() { return !!pinHash(); }

  // Wechsel in die Leitungs-Ansicht. Ohne gesetzten PIN frei erlaubt (mit Hinweis
  // an anderer Stelle), sonst nur bei korrektem PIN. Gibt true bei Erfolg zurück.
  async function trySetLeitung(pin) {
    const h = pinHash();
    if (!h) { setRole('leitung'); return true; }
    const check = await sha256Hex(pin || '');
    if (check === h) { setRole('leitung'); return true; }
    return false;
  }

  // PIN in den Settings setzen/entfernen (leer = entfernen). Für die
  // Einstellungen-Karte (Phase 4); speichert über den Store.
  async function setPin(pin) {
    const s = GR.store.getSettings();
    s.vorgaenge = s.vorgaenge || {};
    s.vorgaenge.leitungPinHash = pin ? await sha256Hex(pin) : '';
    GR.store.saveSettings(s);
  }

  // --- Filter-Helfer ---
  // Vertrauliche Vorgänge für Ratsmitglieder komplett ausblenden.
  function filterVorgaenge(list) {
    if (isLeitung()) return list.slice();
    return (list || []).filter(v => !v.vertraulich);
  }
  function canSeeVorgang(v) { return isLeitung() || !(v && v.vertraulich); }
  // Sichtbare Historieneinträge (vertrauliche nur für die Leitung).
  function visibleHistorie(v) {
    const h = (v && v.historie) || [];
    if (isLeitung()) return h.slice();
    return h.filter(e => !e.vertraulich);
  }

  GR.roles = {
    current, isLeitung, setRat, setRole, onChange,
    hasPin, trySetLeitung, setPin, sha256Hex,
    filterVorgaenge, canSeeVorgang, visibleHistorie,
  };
})();
