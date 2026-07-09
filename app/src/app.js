(function () {
  'use strict';
  const { renderDashboard, renderDokumente, renderStammdaten, renderEinstellungen, renderVorbereitung, renderLive, renderVermietung, renderMieter, renderAuslagen, renderAuslagenStammdaten } = GR.views;

  const mount = document.getElementById('app');

  function parseHash() {
    const h = (location.hash || '#/').replace(/^#/, '');
    const [path, query] = h.split('?');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    return { path, params };
  }

  function setActiveNav(path) {
    document.querySelectorAll('.mainnav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-route') === path);
    });
  }

  function router() {
    const { path, params } = parseHash();
    mount.innerHTML = '';
    setActiveNav(path);
    if (path === '/' || path === '') return renderDashboard(mount);
    if (path === '/dokumente') return renderDokumente(mount, params);
    if (path === '/stammdaten') return renderStammdaten(mount);
    if (path === '/einstellungen') return renderEinstellungen(mount);
    if (path === '/sitzung/vorbereitung') return renderVorbereitung(mount, params.id);
    if (path === '/sitzung/live') return renderLive(mount, params.id);
    if (path === '/vermietung') return renderVermietung(mount, params);
    if (path === '/mieter') return renderMieter(mount);
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
