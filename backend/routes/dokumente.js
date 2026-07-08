'use strict';

// Express-Router für das Dokumente-Modul. Proxyt zu Paperless-ngx; der Token
// bleibt im Backend (paperless.js). Eingebunden in server.js unter /api/dokumente.

const express = require('express');
const { Readable } = require('stream');
const paperless = require('../paperless');

const router = express.Router();

// Beim PATCH erlaubte Felder (alles andere wird ignoriert).
const PATCH_WHITELIST = ['title', 'created', 'correspondent', 'document_type', 'tags', 'archive_serial_number', 'custom_fields'];

function pickPatch(body) {
  const out = {};
  for (const k of PATCH_WHITELIST) {
    if (body && Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out;
}

// Einheitliche Fehlerausgabe (PaperlessError trägt einen sinnvollen Status).
function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  res.status(status).json({ error: err && err.message ? err.message : 'Serverfehler' });
}

// --- Health / Verbindungstest ---
router.get('/health', async (_req, res) => {
  if (!paperless.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'Paperless nicht konfiguriert (PAPERLESS_URL/PAPERLESS_TOKEN).' });
  }
  try {
    res.json(await paperless.health());
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, error: err.message });
  }
});

// --- Filterwerte für Suche & Edit-Selects ---
router.get('/meta', async (_req, res) => {
  try {
    const [tags, correspondents, documentTypes, customFields] = await Promise.all([
      paperless.listTags(),
      paperless.listCorrespondents(),
      paperless.listDocumentTypes(),
      paperless.listCustomFields(),
    ]);
    res.json({ tags, correspondents, documentTypes, customFields });
  } catch (err) {
    sendError(res, err);
  }
});

// --- Liste / Suche ---
router.get('/', async (req, res) => {
  try {
    res.json(await paperless.searchDocuments(req.query));
  } catch (err) {
    sendError(res, err);
  }
});

// --- Datei-Streams (vor :id, damit /:id nicht "1234/preview" frisst) ---
async function streamKind(req, res, kind) {
  try {
    const upstream = await paperless.fetchFile(req.params.id, kind);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const cd = upstream.headers.get('content-disposition');
    if (cd) res.setHeader('Content-Disposition', cd);
    else if (kind === 'preview') res.setHeader('Content-Disposition', 'inline');
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    sendError(res, err);
  }
}
router.get('/:id/preview', (req, res) => streamKind(req, res, 'preview'));
router.get('/:id/download', (req, res) => streamKind(req, res, 'download'));
router.get('/:id/thumb', (req, res) => streamKind(req, res, 'thumb'));

// --- Einzelmetadaten ---
router.get('/:id', async (req, res) => {
  try {
    res.json(await paperless.getDocument(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// --- Metadaten ändern ---
router.patch('/:id', async (req, res) => {
  try {
    const patch = pickPatch(req.body || {});
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Keine änderbaren Felder im Body.' });
    res.json(await paperless.updateDocument(req.params.id, patch));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
