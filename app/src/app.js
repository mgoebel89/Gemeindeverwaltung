(function () {
  'use strict';
  const { renderDashboard, renderSitzungen, renderDokumente, renderTermine, renderAufgaben, renderStammdaten, renderEinstellungen, renderVorbereitung, renderLive, renderVermietung, renderMieter, renderProtokolle, renderAuslagen, renderAuslagenStammdaten, renderVertraege, renderVertragspartner, renderVorgaenge } = GR.views;

  const mount = document.getElementById('app');
  const shell = document.getElementById('appShell');

  // ---------- Navigations-Config (neues Modul = 1 Eintrag) ----------
  // icon: Name aus ICONS (schlichte Linien-Icons). Gruppen strukturieren die Seitenleiste.
  const NAV = [
    { items: [
      { path: '/', label: 'Übersicht', icon: 'home' },
      { path: '/vorgaenge', label: 'Vorgänge & Projekte', icon: 'folder' },
      { path: '/termine', label: 'Termine', icon: 'calendar' },
      { path: '/aufgaben', label: 'Aufgaben', icon: 'check' },
    ] },
    { label: 'Gremien', items: [
      { path: '/sitzungen', label: 'Sitzungen', icon: 'gavel' },
      { path: '/dokumente', label: 'Dokumente', icon: 'doc' },
    ] },
    { label: 'Liegenschaften', items: [
      { path: '/vermietung', label: 'Vermietung', icon: 'key' },
      { path: '/vertraege', label: 'Verträge & Pacht', icon: 'file' },
    ] },
    { label: 'Finanzen', items: [
      { path: '/auslagen', label: 'Bargeldauslagen', icon: 'euro' },
    ] },
    { footer: true, items: [
      { path: '/stammdaten', label: 'Stammdaten', icon: 'users' },
      { path: '/einstellungen', label: 'Einstellungen', icon: 'gear' },
    ] },
  ];

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9"/>',
    gavel: '<path d="M14 4l6 6"/><path d="M4 20l7-7"/><path d="M9 8l4 4"/><path d="M15 14l4 4"/>',
    doc: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    key: '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9"/><path d="M17 17l2-2"/>',
    file: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
    euro: '<path d="M17 6a6 6 0 100 12"/><path d="M4 10h9M4 14h9"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 6a3 3 0 010 6"/><path d="M17 15c2 .5 4 2 4 5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  function parseHash() {
    const h = (location.hash || '#/').replace(/^#/, '');
    const [path, query] = h.split('?');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    return { path, params };
  }

  function buildSidebar() {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    nav.innerHTML = '';
    for (const group of NAV) {
      const wrap = document.createElement('div');
      if (group.footer) wrap.className = 'nav-spacer';
      if (group.label) {
        const gl = document.createElement('div');
        gl.className = 'nav-group-label';
        gl.textContent = group.label;
        wrap.appendChild(gl);
      }
      for (const item of group.items) {
        const a = document.createElement('a');
        a.className = 'nav-item';
        a.href = '#' + item.path;
        a.setAttribute('data-route', item.path);
        a.title = item.label;
        a.innerHTML = `<span class="nav-icon">${icon(item.icon)}</span><span class="nav-label">${item.label}</span>`;
        a.addEventListener('click', () => shell && shell.classList.remove('nav-open')); // Drawer auf dem Handy schließen
        wrap.appendChild(a);
      }
      nav.appendChild(wrap);
    }
  }

  function setActiveNav(path) {
    // längste passende Route markieren (z. B. /sitzung/live → Sitzungen)
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(a => {
      const route = a.getAttribute('data-route');
      const active = route === '/' ? (path === '/' || path === '') : path.startsWith(route);
      a.classList.toggle('active', active);
    });
  }

  function bindShellControls() {
    const collapseBtn = document.getElementById('sidebarCollapse');
    const menuBtn = document.getElementById('menuToggle');
    const backdrop = document.getElementById('sidebarBackdrop');
    // Collapse-Zustand (Desktop) merken
    try { if (localStorage.getItem('gr.sidebarCollapsed') === '1') shell.classList.add('sidebar-collapsed'); } catch (_) {}
    if (collapseBtn) collapseBtn.addEventListener('click', () => {
      const c = shell.classList.toggle('sidebar-collapsed');
      try { localStorage.setItem('gr.sidebarCollapsed', c ? '1' : '0'); } catch (_) {}
    });
    if (menuBtn) menuBtn.addEventListener('click', () => shell.classList.toggle('nav-open'));
    if (backdrop) backdrop.addEventListener('click', () => shell.classList.remove('nav-open'));
  }

  function router() {
    const { path, params } = parseHash();
    mount.innerHTML = '';
    setActiveNav(path);
    if (path === '/' || path === '') return renderDashboard(mount);
    if (path === '/vorgaenge') return renderVorgaenge(mount, params);
    if (path === '/sitzungen') return renderSitzungen(mount);
    if (path === '/dokumente') return renderDokumente(mount, params);
    if (path === '/termine') return renderTermine(mount, params);
    if (path === '/aufgaben') return renderAufgaben(mount, params);
    if (path === '/stammdaten') return renderStammdaten(mount);
    if (path === '/einstellungen') return renderEinstellungen(mount);
    if (path === '/sitzung/vorbereitung') return renderVorbereitung(mount, params.id);
    if (path === '/sitzung/live') return renderLive(mount, params.id);
    if (path === '/vermietung') return renderVermietung(mount, params);
    if (path === '/mieter') return renderMieter(mount);
    if (path === '/protokolle') return renderProtokolle(mount);
    if (path === '/vertraege') return renderVertraege(mount, params);
    if (path === '/vertragspartner') return renderVertragspartner(mount);
    if (path === '/auslagen') return renderAuslagen(mount, params);
    if (path === '/auslagen-stammdaten') return renderAuslagenStammdaten(mount);
    mount.innerHTML = '<div class="card"><h2>Seite nicht gefunden</h2><a href="#/">Zurück zur Übersicht</a></div>';
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) { return iso; }
  }

  function bindSyncStatus() {
    const btn = document.getElementById('syncStatus');
    if (!btn || !GR.auto_sync) return;
    const label = btn.querySelector('.sync-label');
    GR.auto_sync.subscribe(state => {
      btn.classList.remove('sync-status--unconfigured', 'sync-status--idle', 'sync-status--ok', 'sync-status--syncing', 'sync-status--error');
      btn.classList.add('sync-status--' + state.status);
      let labelText = 'Sync';
      let title = '';
      switch (state.status) {
        case 'unconfigured':
          labelText = 'NocoDB aus';
          title = 'NocoDB nicht konfiguriert — in den Einstellungen einrichten, um Sitzungen zusätzlich extern zu sichern.';
          break;
        case 'idle':
          labelText = 'bereit';
          title = 'Auto-Sync (NocoDB) läuft, noch nichts zu sichern.';
          break;
        case 'syncing':
          labelText = `synchronisiere${state.pending ? ' (' + state.pending + ')' : ''}…`;
          title = 'Synchronisiere mit NocoDB…';
          break;
        case 'ok':
          labelText = 'aktuell';
          title = `Zuletzt synchronisiert: ${fmtTime(state.lastSyncAt) || '—'}`;
          break;
        case 'error':
          labelText = `Fehler${state.pending ? ' (' + state.pending + ')' : ''}`;
          title = `Fehler: ${state.lastError || 'unbekannt'}\nLetzter erfolgreicher Sync: ${fmtTime(state.lastSyncAt) || '—'}\nKlicken, um erneut zu versuchen.`;
          break;
      }
      label.textContent = labelText;
      btn.title = title;
    });
    btn.addEventListener('click', () => {
      if (!GR.nocodb_client.isConfigured()) {
        location.hash = '#/einstellungen';
        return;
      }
      GR.auto_sync.triggerNow();
    });
  }

  // ---------- Migration localStorage → Backend ----------
  function hasLocalStorageData() {
    try {
      const s = JSON.parse(localStorage.getItem('gr.sitzungen') || '[]');
      const m = JSON.parse(localStorage.getItem('gr.mitglieder') || '[]');
      return (Array.isArray(s) && s.length > 0) || (Array.isArray(m) && m.length > 0);
    } catch (_) { return false; }
  }

  async function maybeMigrate() {
    if (!GR.store.isBackendAvailable()) return;
    const backendEmpty = GR.store.listSitzungen().length === 0 && GR.store.listMitglieder().length === 0;
    if (!backendEmpty) return;
    if (!hasLocalStorageData()) return;
    let s = [], m = [], settings = null;
    try {
      s = JSON.parse(localStorage.getItem('gr.sitzungen') || '[]');
      m = JSON.parse(localStorage.getItem('gr.mitglieder') || '[]');
      settings = JSON.parse(localStorage.getItem('gr.settings') || 'null');
    } catch (_) {}
    const msg = `Im Backend liegen noch keine Daten.\n\nIm Browser sind ${s.length} Sitzung(en) und ${m.length} Mitglied(er) vorhanden.\n\nIns Backend übernehmen?\n(Anschließend werden die lokalen Browser-Daten gelöscht.)`;
    if (!window.confirm(msg)) return;
    try {
      await GR.api.importAll({ sitzungen: s, mitglieder: m, settings });
      localStorage.removeItem('gr.sitzungen');
      localStorage.removeItem('gr.mitglieder');
      // Settings im localStorage löschen wir bewusst nicht, falls noch NocoDB-Setup drin ist;
      // gleicher Inhalt liegt jetzt im Backend.
      await GR.store.bootstrap();
      if (GR.ui && GR.ui.toast) GR.ui.toast('Migration abgeschlossen');
      router();
    } catch (e) {
      alert('Migration fehlgeschlagen: ' + e.message);
    }
  }

  function showBackendUnavailableBanner() {
    const banner = document.createElement('div');
    banner.className = 'backend-banner';
    banner.textContent = '⚠ Backend nicht erreichbar — Eingaben werden nicht gespeichert. Bitte den Container/Service prüfen.';
    document.body.insertBefore(banner, document.body.firstChild);
  }

  async function startApp() {
    buildSidebar();
    bindShellControls();
    bindSyncStatus();
    // WebSocket-Nachrichten in den Store leiten
    if (GR.api && GR.api.subscribe) {
      GR.api.subscribe(msg => GR.store.applyServerMessage(msg));
      GR.api.connectWs();
    }
    // Snapshot ziehen
    await GR.store.bootstrap();
    if (!GR.store.isBackendAvailable()) showBackendUnavailableBanner();
    // Erste View rendern
    router();
    // Bei Server-Push (von ANDEREN Clients) neu rendern. Eigene Eingaben triggern das nicht,
    // damit Cursor/Scrollposition beim Tippen erhalten bleiben.
    GR.store.onRemoteChange(() => router());
    // Migration anbieten
    await maybeMigrate();
    // NocoDB-Auto-Sync starten
    if (GR.auto_sync) GR.auto_sync.start();
  }

  window.addEventListener('hashchange', router);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
})();
