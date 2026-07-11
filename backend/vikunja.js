'use strict';

// Dünner REST-Client gegen Vikunja (Aufgabenverwaltung). URL + API-Token bleiben
// serverseitig (Backend-Proxy wie Paperless/Kalender – CORS + geheimer Token).
// Konfiguration aus Env als Vorgabe/Fallback:
//   VIKUNJA_URL    z. B. http://192.168.1.40:3456  (ohne /api/v1)
//   VIKUNJA_TOKEN  API-Token (Vikunja: Einstellungen → API-Tokens)
// Node ≥18 ⇒ globales fetch.
//
// Auth: Bearer-Token. Endpunkte: GET /api/v1/tasks/all, GET /api/v1/projects,
// POST /api/v1/tasks/{id} (Update, z. B. done=true), PUT /api/v1/projects/{id}/tasks
// (neue Aufgabe). Unbelegte Datumsfelder liefert Vikunja als "0001-01-01T00:00:00Z".

const db = require('./db');

const ENV_URL = (process.env.VIKUNJA_URL || '').replace(/\/+$/, '');
const ENV_TOKEN = process.env.VIKUNJA_TOKEN || '';

const FETCH_TIMEOUT_MS = 12000;
const MAX_PAGES = 10; // Sicherheitsdeckel beim Durchblättern

let cfg = { url: ENV_URL, token: ENV_TOKEN };

function loadConfig() {
  let stored = null;
  try { stored = db.getVikunjaConfig(); } catch (_) { stored = null; }
  cfg = {
    url: ((stored && stored.url != null && stored.url !== '') ? String(stored.url) : ENV_URL).replace(/\/+$/, ''),
    token: (stored && stored.token) ? String(stored.token) : ENV_TOKEN,
  };
  return cfg;
}
loadConfig();

// Leerer/fehlender Token lässt den bestehenden unangetastet (URL änderbar,
// ohne den Token neu einzutippen).
function setConfig({ url, token } = {}) {
  const cur = (() => { try { return db.getVikunjaConfig() || {}; } catch (_) { return {}; } })();
  const next = {
    url: (url != null ? String(url).trim() : (cur.url || '')).replace(/\/+$/, ''),
    token: (token != null && String(token) !== '') ? String(token) : (cur.token || ''),
  };
  db.saveVikunjaConfig(next);
  loadConfig();
  return publicConfig();
}

// Token NIE herausgeben – nur ob gesetzt und woher.
function publicConfig() {
  let stored = null;
  try { stored = db.getVikunjaConfig(); } catch (_) { stored = null; }
  const src = (stored && (stored.url || stored.token)) ? 'app' : ((ENV_URL || ENV_TOKEN) ? 'env' : 'none');
  return { url: cfg.url || '', hasToken: !!cfg.token, source: src };
}

function isConfigured() { return !!(cfg.url && cfg.token); }

class VikunjaError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'VikunjaError';
    this.status = status || 502;
  }
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json', ...extra };
}

function buildUrl(pathname, params = {}) {
  if (!isConfigured()) throw new VikunjaError('Vikunja ist nicht konfiguriert (URL/Token unter Einstellungen → Aufgaben hinterlegen).', 503);
  const u = new URL(cfg.url + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u;
}

// Führt einen JSON-Request aus. Gibt bei Erfolg { data, headers } zurück.
async function apiJson(pathname, params = {}, opts = {}) {
  const url = buildUrl(pathname, params);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: opts.method || 'GET',
      headers: authHeaders(opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new VikunjaError(e.name === 'AbortError' ? 'Vikunja: Zeitüberschreitung' : `Vikunja nicht erreichbar: ${e.message}`, 502);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new VikunjaError(`Vikunja ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  if (res.status === 204) return { data: null, headers: res.headers };
  const data = await res.json().catch(() => null);
  return { data, headers: res.headers };
}

// Vikunja liefert unbelegte Datumsfelder als "0001-...". → null.
function cleanDate(v) {
  if (!v || typeof v !== 'string') return null;
  if (v.startsWith('0001-')) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? v : null;
}

function normalizeTask(t) {
  return {
    id: t.id,
    title: t.title || '(ohne Titel)',
    description: t.description || '',
    done: !!t.done,
    dueDate: cleanDate(t.due_date),
    priority: typeof t.priority === 'number' ? t.priority : 0,
    percentDone: typeof t.percent_done === 'number' ? t.percent_done : 0,
    projectId: t.project_id || null,
    identifier: t.identifier || '',
    labels: Array.isArray(t.labels) ? t.labels.map(l => ({ id: l.id, title: l.title, hexColor: l.hex_color })) : [],
  };
}

// --- Öffentliche Operationen --------------------------------------------

async function health() {
  // Günstiger Aufruf, der Erreichbarkeit + Token (mit Lese-Scope) validiert.
  await apiJson('/api/v1/tasks/all', { filter: 'done = false', page: 1 });
  return { ok: true, url: cfg.url };
}

// Alle offenen Aufgaben, fällige zuerst. Blättert bis MAX_PAGES durch.
async function listOpenTasks() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { data, headers } = await apiJson('/api/v1/tasks/all', {
      filter: 'done = false',
      sort_by: 'due_date',
      order_by: 'asc',
      page,
    });
    const arr = Array.isArray(data) ? data : [];
    for (const t of arr) all.push(normalizeTask(t));
    const tp = parseInt(headers.get('x-pagination-total-pages') || '1', 10);
    totalPages = Number.isFinite(tp) ? tp : 1;
    page++;
  } while (page <= totalPages && page <= MAX_PAGES);
  return all;
}

// Projekte (für die Auswahl beim Anlegen). Pseudo-Projekte (id ≤ 0, z. B.
// „Favoriten") werden herausgefiltert.
async function listProjects() {
  const { data } = await apiJson('/api/v1/projects');
  const arr = Array.isArray(data) ? data : [];
  return arr
    .filter(p => typeof p.id === 'number' && p.id > 0)
    .map(p => ({ id: p.id, title: p.title || ('Projekt ' + p.id) }));
}

// Aufgabe als erledigt/offen markieren.
async function setTaskDone(id, done) {
  const { data } = await apiJson(`/api/v1/tasks/${encodeURIComponent(id)}`, {}, {
    method: 'POST', body: { done: !!done },
  });
  return data ? normalizeTask(data) : { id, done: !!done };
}

// Neue Aufgabe in einem Projekt anlegen. `payload` = { title, dueDate?, description?, priority? }.
async function createTask(projectId, payload = {}) {
  const pid = parseInt(projectId, 10);
  if (!Number.isFinite(pid) || pid <= 0) throw new VikunjaError('Ungültiges Projekt.', 400);
  if (!payload.title || !String(payload.title).trim()) throw new VikunjaError('Titel fehlt.', 400);
  const body = { title: String(payload.title).trim() };
  if (payload.description) body.description = String(payload.description);
  if (payload.dueDate) body.due_date = toVikunjaDate(payload.dueDate);
  if (payload.priority != null && payload.priority !== '') body.priority = parseInt(payload.priority, 10) || 0;
  const { data } = await apiJson(`/api/v1/projects/${pid}/tasks`, {}, { method: 'PUT', body });
  return data ? normalizeTask(data) : null;
}

// "YYYY-MM-DD" (aus dem Datumsfeld im Frontend) → ISO 8601 mit Zeit.
function toVikunjaDate(v) {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : s;
}

module.exports = {
  VikunjaError,
  isConfigured,
  publicConfig, setConfig,
  health, listOpenTasks, listProjects, setTaskDone, createTask,
  // für Tests:
  normalizeTask, cleanDate, toVikunjaDate,
};
