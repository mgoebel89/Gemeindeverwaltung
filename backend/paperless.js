'use strict';

// Dünner REST-Client gegen Paperless-ngx. Token bleibt serverseitig.
// Konfiguration aus Env:
//   PAPERLESS_URL   z. B. http://192.168.1.20:8000
//   PAPERLESS_TOKEN API-Token (Paperless: Einstellungen → "API-Token")
// Node ≥18 ⇒ globales fetch verfügbar.

const db = require('./db');

// Env dient als Vorgabe/Fallback; in der App (Einstellungen) gesetzte Werte
// überschreiben sie und werden serverseitig in der DB gehalten.
const ENV_URL = (process.env.PAPERLESS_URL || '').replace(/\/+$/, '');
const ENV_TOKEN = process.env.PAPERLESS_TOKEN || '';

let cfg = { url: ENV_URL, token: ENV_TOKEN };

// Lädt die aktive Konfiguration (DB vor Env). Bei fehlenden DB-Feldern greift Env.
function loadConfig() {
  let stored = null;
  try { stored = db.getPaperlessConfig(); } catch (_) { stored = null; }
  cfg = {
    url: ((stored && stored.url != null && stored.url !== '') ? String(stored.url) : ENV_URL).replace(/\/+$/, ''),
    token: (stored && stored.token) ? String(stored.token) : ENV_TOKEN,
  };
  return cfg;
}
loadConfig();

// Speichert neue Werte. Leerer/fehlender Token lässt den bestehenden unangetastet,
// sodass die URL geändert werden kann, ohne den Token neu eintippen zu müssen.
function setConfig({ url, token } = {}) {
  const cur = (() => { try { return db.getPaperlessConfig() || {}; } catch (_) { return {}; } })();
  const next = {
    url: (url != null ? String(url).trim() : (cur.url || '')).replace(/\/+$/, ''),
    token: (token != null && String(token) !== '') ? String(token) : (cur.token || ''),
  };
  db.savePaperlessConfig(next);
  loadConfig();
  return publicConfig();
}

// Für das Frontend: Token NIE herausgeben — nur ob einer gesetzt ist und woher.
function publicConfig() {
  let stored = null;
  try { stored = db.getPaperlessConfig(); } catch (_) { stored = null; }
  const source = (stored && (stored.url || stored.token)) ? 'app' : ((ENV_URL || ENV_TOKEN) ? 'env' : 'none');
  return { url: cfg.url || '', hasToken: !!cfg.token, source };
}

function isConfigured() {
  return !!(cfg.url && cfg.token);
}

class PaperlessError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PaperlessError';
    this.status = status || 502;
  }
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Token ${cfg.token}`,
    Accept: 'application/json',
    ...extra,
  };
}

// Baut eine Paperless-URL inkl. Query-Parameter. `params` ist ein Objekt;
// leere/undefinierte Werte werden weggelassen.
function buildUrl(pathname, params = {}) {
  if (!isConfigured()) throw new PaperlessError('Paperless ist nicht konfiguriert (URL/Token unter Einstellungen → Dokumente hinterlegen).', 503);
  const u = new URL(cfg.url + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u;
}

async function apiJson(pathname, params = {}, opts = {}) {
  const url = buildUrl(pathname, params);
  let res;
  try {
    res = await fetch(url, {
      method: opts.method || 'GET',
      headers: authHeaders(opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new PaperlessError(`Paperless nicht erreichbar: ${e.message}`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PaperlessError(`Paperless ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- Dokumente ---

// Sucht/listet Dokumente. Erlaubte Filter werden 1:1 an Paperless durchgereicht.
async function searchDocuments(query = {}) {
  const params = {
    query: query.query,
    ordering: query.ordering || '-created',
    page: query.page || 1,
    page_size: query.page_size || 25,
    tags__id__all: query.tags,                 // kommaseparierte Tag-IDs (UND)
    correspondent__id: query.correspondent,
    document_type__id: query.document_type,
    'created__date__gte': query.created_gte,
    'created__date__lte': query.created_lte,
  };
  return apiJson('/api/documents/', params);
}

async function getDocument(id) {
  return apiJson(`/api/documents/${encodeURIComponent(id)}/`);
}

// Aktualisiert Metadaten. `patch` wurde vom Router bereits auf eine Whitelist reduziert.
async function updateDocument(id, patch) {
  return apiJson(`/api/documents/${encodeURIComponent(id)}/`, {}, { method: 'PATCH', body: patch });
}

// Lädt eine Datei nach Paperless hoch. Paperless verarbeitet asynchron (OCR) und
// gibt eine Task-ID zurück; das fertige Dokument wird über getTask() ermittelt.
// `file` = { buffer, filename, mimetype }, `meta` = { title, correspondent, document_type, tags[], created }.
async function uploadDocument(file, meta = {}) {
  if (!isConfigured()) throw new PaperlessError('Paperless nicht konfiguriert (URL/Token unter Einstellungen → Dokumente hinterlegen).', 503);
  const form = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
  form.append('document', blob, file.filename || 'upload');
  if (meta.title) form.append('title', String(meta.title));
  if (meta.correspondent) form.append('correspondent', String(meta.correspondent));
  if (meta.document_type) form.append('document_type', String(meta.document_type));
  if (meta.created) form.append('created', String(meta.created));
  for (const t of (meta.tags || [])) form.append('tags', String(t));
  let res;
  try {
    // Kein Content-Type setzen — fetch ergänzt die multipart-Boundary selbst.
    res = await fetch(buildUrl('/api/documents/post_document/'), { method: 'POST', headers: authHeaders(), body: form });
  } catch (e) {
    throw new PaperlessError(`Paperless nicht erreichbar: ${e.message}`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PaperlessError(`Paperless ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  const data = await res.json().catch(() => null); // i. d. R. die Task-UUID als String
  const taskId = (typeof data === 'string') ? data : (data && (data.task_id || data.id)) || null;
  return { taskId };
}

// Fragt den Verarbeitungsstatus einer Upload-Task ab. Liefert
// { status: 'PENDING'|'STARTED'|'SUCCESS'|'FAILURE', documentId, result }.
async function getTask(taskId) {
  const data = await apiJson('/api/tasks/', { task_id: taskId });
  const t = Array.isArray(data) ? data[0] : (data && data.results ? data.results[0] : data);
  if (!t) return { status: 'PENDING', documentId: null, result: '' };
  const doc = t.related_document;
  return {
    status: t.status || 'PENDING',
    documentId: (doc === 0 || doc) ? Number(doc) : null,
    result: t.result || '',
  };
}

async function createCorrespondent(name) {
  const r = await apiJson('/api/correspondents/', {}, { method: 'POST', body: { name } });
  return { id: r.id, name: r.name };
}
async function createDocumentType(name) {
  const r = await apiJson('/api/document_types/', {}, { method: 'POST', body: { name } });
  return { id: r.id, name: r.name };
}
async function createTag(name) {
  const r = await apiJson('/api/tags/', {}, { method: 'POST', body: { name } });
  return { id: r.id, name: r.name, color: r.color };
}

// --- Notizen (Paperless-Notes je Dokument) ---
// GET/POST/DELETE laufen über /api/documents/{id}/notes/; POST/DELETE liefern
// die aktualisierte Notizliste zurück (DELETE erwartet ?id=<note>).
function asNotes(data) {
  return Array.isArray(data) ? data : (data && data.results ? data.results : []);
}
async function listNotes(id) {
  return asNotes(await apiJson(`/api/documents/${encodeURIComponent(id)}/notes/`));
}
async function addNote(id, note) {
  return asNotes(await apiJson(`/api/documents/${encodeURIComponent(id)}/notes/`, {}, { method: 'POST', body: { note } }));
}
async function deleteNote(id, noteId) {
  return asNotes(await apiJson(`/api/documents/${encodeURIComponent(id)}/notes/`, { id: noteId }, { method: 'DELETE' }));
}

// Streamt die Datei (preview | download | thumb). Liefert die rohe fetch-Response,
// der Router pipet body + Content-Type weiter.
async function fetchFile(id, kind) {
  const map = { preview: 'preview', download: 'download', thumb: 'thumb' };
  const seg = map[kind] || 'preview';
  const url = buildUrl(`/api/documents/${encodeURIComponent(id)}/${seg}/`);
  let res;
  try {
    res = await fetch(url, { headers: authHeaders() });
  } catch (e) {
    throw new PaperlessError(`Paperless nicht erreichbar: ${e.message}`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PaperlessError(`Paperless ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  return res;
}

// --- Stammdaten / Filterwerte (paginiert einsammeln) ---

async function fetchAll(pathname) {
  const out = [];
  let next = buildUrl(pathname, { page_size: 200 }).toString();
  let guard = 0;
  while (next && guard < 100) {
    guard++;
    let res;
    try {
      res = await fetch(next, { headers: authHeaders() });
    } catch (e) {
      throw new PaperlessError(`Paperless nicht erreichbar: ${e.message}`, 502);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PaperlessError(`Paperless ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    const data = await res.json();
    out.push(...(data.results || []));
    next = data.next || null;
  }
  return out;
}

const slim = (items, fields) => items.map(it => {
  const o = {};
  for (const f of fields) o[f] = it[f];
  return o;
});

async function listTags() {
  return slim(await fetchAll('/api/tags/'), ['id', 'name', 'color']);
}
async function listCorrespondents() {
  return slim(await fetchAll('/api/correspondents/'), ['id', 'name']);
}
async function listDocumentTypes() {
  return slim(await fetchAll('/api/document_types/'), ['id', 'name']);
}
async function listCustomFields() {
  try {
    return slim(await fetchAll('/api/custom_fields/'), ['id', 'name', 'data_type']);
  } catch (_) {
    return []; // ältere Paperless-Versionen ohne Custom Fields
  }
}

async function health() {
  // Günstiger Aufruf, der Erreichbarkeit + Token validiert.
  await apiJson('/api/documents/', { page_size: 1 });
  return { ok: true, url: cfg.url };
}

module.exports = {
  PaperlessError,
  isConfigured,
  baseUrl: () => cfg.url,
  publicConfig,
  setConfig,
  searchDocuments,
  getDocument,
  updateDocument,
  uploadDocument,
  getTask,
  createCorrespondent,
  createDocumentType,
  createTag,
  listNotes,
  addNote,
  deleteNote,
  fetchFile,
  listTags,
  listCorrespondents,
  listDocumentTypes,
  listCustomFields,
  health,
};
