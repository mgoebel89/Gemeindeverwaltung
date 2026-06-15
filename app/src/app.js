(function () {
  'use strict';
  const { renderDashboard, renderStammdaten, renderEinstellungen, renderVorbereitung, renderLive } = GR.views;

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
    if (path === '/stammdaten') return renderStammdaten(mount);
    if (path === '/einstellungen') return renderEinstellungen(mount);
    if (path === '/sitzung/vorbereitung') return renderVorbereitung(mount, params.id);
    if (path === '/sitzung/live') return renderLive(mount, params.id);
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
          labelText = 'Sync aus';
          title = 'NocoDB nicht konfiguriert — in den Einstellungen einrichten, um Sitzungen automatisch zu sichern.';
          break;
        case 'idle':
          labelText = 'bereit';
          title = 'Auto-Sync läuft, noch nichts zu sichern.';
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

  function startApp() {
    router();
    bindSyncStatus();
    if (GR.auto_sync) GR.auto_sync.start();
  }

  window.addEventListener('hashchange', router);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
})();
