(function () {
  'use strict';
  window.GR = window.GR || {};

  const BASE = ''; // gleicher Host, nginx leitet /api an Node
  const WS_PATH = '/ws';

  const CLIENT_ID = (function () {
    let id = '';
    try { id = sessionStorage.getItem('gr.clientId') || ''; } catch (_) {}
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || ('c-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      try { sessionStorage.setItem('gr.clientId', id); } catch (_) {}
    }
    return id;
  })();

  const listeners = [];
  let ws = null;
  let wsReconnectTimer = null;
  let wsBackoff = 1000;

  async function jsonFetch(path, opts = {}) {
    const res = await fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${txt.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  // --- Snapshot/Health ---
  async function health() { return jsonFetch('/api/health'); }
  async function snapshot() { return jsonFetch('/api/snapshot'); }

  // --- Sitzungen ---
  async function putSitzung(s) { return jsonFetch(`/api/sitzungen/${encodeURIComponent(s.id)}`, { method: 'PUT', body: s }); }
  async function deleteSitzungRemote(id) { return jsonFetch(`/api/sitzungen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // --- Mitglieder ---
  async function putMitglied(m) { return jsonFetch(`/api/mitglieder/${encodeURIComponent(m.id)}`, { method: 'PUT', body: m }); }
  async function deleteMitgliedRemote(id) { return jsonFetch(`/api/mitglieder/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // --- Settings ---
  async function putSettings(s) { return jsonFetch('/api/settings', { method: 'PUT', body: s }); }

  // --- Attachments ---
  async function listAttachments(sitzungId) { return jsonFetch(`/api/sitzungen/${encodeURIComponent(sitzungId)}/attachments`); }
  async function uploadAttachment(sitzungId, file) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const res = await fetch(`/api/sitzungen/${encodeURIComponent(sitzungId)}/attachments`, { method: 'POST', body: fd, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }
  async function deleteAttachment(id) { return jsonFetch(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  function attachmentUrl(id) { return `/api/attachments/${encodeURIComponent(id)}`; }

  // --- Bulk-Import (Migration) ---
  async function importAll(payload) { return jsonFetch('/api/import', { method: 'POST', body: payload }); }

  // --- WebSocket ---
  function connectWs() {
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      wsBackoff = 1000;
      notify({ type: 'ws:open' });
    };
    ws.onclose = () => {
      notify({ type: 'ws:close' });
      scheduleReconnect();
    };
    ws.onerror = () => { /* close folgt */ };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        notify(msg);
      } catch (_) {}
    };
  }
  function scheduleReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      wsBackoff = Math.min(wsBackoff * 2, 15000);
      connectWs();
    }, wsBackoff);
  }
  function subscribe(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function notify(msg) { for (const fn of listeners) { try { fn(msg); } catch (_) {} } }

  GR.api = {
    health, snapshot,
    putSitzung, deleteSitzungRemote,
    putMitglied, deleteMitgliedRemote,
    putSettings,
    listAttachments, uploadAttachment, deleteAttachment, attachmentUrl,
    importAll,
    connectWs, subscribe,
    clientId: CLIENT_ID,
  };
})();
