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

  // --- Modul: Vermietung (Mieter, Räume, Vermietungen) ---
  async function putMieter(m) { return jsonFetch(`/api/mieter/${encodeURIComponent(m.id)}`, { method: 'PUT', body: m }); }
  async function deleteMieterRemote(id) { return jsonFetch(`/api/mieter/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putRaum(r) { return jsonFetch(`/api/raeume/${encodeURIComponent(r.id)}`, { method: 'PUT', body: r }); }
  async function deleteRaumRemote(id) { return jsonFetch(`/api/raeume/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putVermietung(v) { return jsonFetch(`/api/vermietungen/${encodeURIComponent(v.id)}`, { method: 'PUT', body: v }); }
  async function deleteVermietungRemote(id) { return jsonFetch(`/api/vermietungen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function listVermietungFotos(vermietungId) { return jsonFetch(`/api/vermietungen/${encodeURIComponent(vermietungId)}/fotos`); }
  async function uploadVermietungFoto(vermietungId, file, kind) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (kind) fd.append('kind', kind);
    const res = await fetch(`/api/vermietungen/${encodeURIComponent(vermietungId)}/fotos`, { method: 'POST', body: fd, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }
  async function deleteVermietungFoto(fileId) { return jsonFetch(`/api/vermietung-files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }); }
  function vermietungFotoUrl(fileId) { return `/api/vermietung-files/${encodeURIComponent(fileId)}`; }

  // --- Modul: Bargeldauslagen (Empfänger, Haushaltsstellen, Auslagen, Belege, Scan) ---
  async function putEmpfaenger(e) { return jsonFetch(`/api/empfaenger/${encodeURIComponent(e.id)}`, { method: 'PUT', body: e }); }
  async function deleteEmpfaengerRemote(id) { return jsonFetch(`/api/empfaenger/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putHaushaltsstelle(h) { return jsonFetch(`/api/haushaltsstellen/${encodeURIComponent(h.id)}`, { method: 'PUT', body: h }); }
  async function deleteHaushaltsstelleRemote(id) { return jsonFetch(`/api/haushaltsstellen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putAuslage(a) { return jsonFetch(`/api/auslagen/${encodeURIComponent(a.id)}`, { method: 'PUT', body: a }); }
  async function deleteAuslageRemote(id) { return jsonFetch(`/api/auslagen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  async function listBelege(auslageId) { return jsonFetch(`/api/auslagen/${encodeURIComponent(auslageId)}/belege`); }
  async function uploadBeleg(auslageId, file) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const res = await fetch(`/api/auslagen/${encodeURIComponent(auslageId)}/belege`, { method: 'POST', body: fd, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }
  async function deleteBelegFile(fileId) { return jsonFetch(`/api/belege/${encodeURIComponent(fileId)}`, { method: 'DELETE' }); }
  function belegUrl(fileId) { return `/api/belege/${encodeURIComponent(fileId)}`; }
  async function listScanners() { return jsonFetch('/api/scan/scanners'); }
  async function scanHealth(url) { return jsonFetch(`/api/scan/health?url=${encodeURIComponent(url)}`); }
  async function scan(auslageId, scannerUrl, source) { return jsonFetch('/api/scan', { method: 'POST', body: { auslageId, scannerUrl, source } }); }

  // --- Modul: Verträge und Pacht (Vertragspartner, Verträge) ---
  async function putVertragspartner(p) { return jsonFetch(`/api/vertragspartner/${encodeURIComponent(p.id)}`, { method: 'PUT', body: p }); }
  async function deleteVertragspartnerRemote(id) { return jsonFetch(`/api/vertragspartner/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putVertrag(v) { return jsonFetch(`/api/vertraege/${encodeURIComponent(v.id)}`, { method: 'PUT', body: v }); }
  async function deleteVertragRemote(id) { return jsonFetch(`/api/vertraege/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // --- Modul: Dokumente (Paperless-Proxy im Backend) ---
  function docQuery(params = {}) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      usp.set(k, v);
    }
    const qs = usp.toString();
    return qs ? `?${qs}` : '';
  }
  async function docHealth() { return jsonFetch('/api/dokumente/health'); }
  async function docMeta() { return jsonFetch('/api/dokumente/meta'); }
  async function searchDocuments(params) { return jsonFetch('/api/dokumente' + docQuery(params)); }
  async function getDocument(id) { return jsonFetch(`/api/dokumente/${encodeURIComponent(id)}`); }
  async function patchDocument(id, patch) { return jsonFetch(`/api/dokumente/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }); }
  function docFileUrl(id, kind = 'preview') { return `/api/dokumente/${encodeURIComponent(id)}/${kind}`; }

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
    docHealth, docMeta, searchDocuments, getDocument, patchDocument, docFileUrl,
    putMieter, deleteMieterRemote,
    putRaum, deleteRaumRemote,
    putVermietung, deleteVermietungRemote,
    listVermietungFotos, uploadVermietungFoto, deleteVermietungFoto, vermietungFotoUrl,
    putEmpfaenger, deleteEmpfaengerRemote,
    putHaushaltsstelle, deleteHaushaltsstelleRemote,
    putAuslage, deleteAuslageRemote,
    listBelege, uploadBeleg, deleteBelegFile, belegUrl,
    listScanners, scanHealth, scan,
    putVertragspartner, deleteVertragspartnerRemote,
    putVertrag, deleteVertragRemote,
    connectWs, subscribe,
    clientId: CLIENT_ID,
  };
})();
