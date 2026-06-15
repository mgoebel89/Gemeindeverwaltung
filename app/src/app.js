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

  window.addEventListener('hashchange', router);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', router);
  } else {
    router();
  }
})();
