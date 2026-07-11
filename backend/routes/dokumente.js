'use strict';

// Express-Router für das Dokumente-Modul. Proxyt zu Paperless-ngx; der Token
// bleibt im Backend (paperless.js). Eingebunden in server.js unter /api/dokumente.

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { PDFDocument } = require('pdf-lib');
const db = require('../db');
const paperless = require('../paperless');
const { scanPages, esclBase } = require('./scan');

const router = express.Router();

const MAX_UPLOAD = parseInt(process.env.MAX_UPLOAD_BYTES || (25 * 1024 * 1024), 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });

// Zwischenspeicher für gescannte Seiten (Scan → Vorschau → Speichern). Die Seiten
// liegen bis zum "commit" unter DATA_DIR/scan_tmp/<scanId>/<idx>.jpg.
const SCAN_TMP = path.join(db.DATA_DIR, 'scan_tmp');
const SCAN_TTL_MS = 60 * 60 * 1000; // verwaiste Scans nach 1 h aufräumen
const isScanId = s => /^[0-9a-f-]{36}$/i.test(String(s || ''));

function scanDir(scanId) { return path.join(SCAN_TMP, scanId); }

// Räumt Scan-Ordner auf, die älter als SCAN_TTL_MS sind (opportunistisch bei jedem neuen Scan).
function cleanupOldScans() {
  try {
    if (!fs.existsSync(SCAN_TMP)) return;
    const now = Date.now();
    for (const name of fs.readdirSync(SCAN_TMP)) {
      const p = path.join(SCAN_TMP, name);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > SCAN_TTL_MS) fs.rmSync(p, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

// Beim PATCH erlaubte Felder (alles andere wird ignoriert).
const PATCH_WHITELIST = ['title', 'created', 'correspondent', 'document_type', 'tags', 'archive_serial_number', 'custom_fields'];

// Metadaten aus einem Request-Body (multipart-Textfelder oder JSON) einsammeln.
function parseMeta(body) {
  const b = body || {};
  const meta = {};
  if (b.title) meta.title = String(b.title);
  if (b.correspondent) meta.correspondent = Number(b.correspondent);
  if (b.document_type) meta.document_type = Number(b.document_type);
  if (b.created) meta.created = String(b.created);
  if (b.tags !== undefined && b.tags !== null && b.tags !== '') {
    const raw = Array.isArray(b.tags) ? b.tags : String(b.tags).split(',');
    meta.tags = raw.map(x => Number(String(x).trim())).filter(n => !Number.isNaN(n));
  }
  return meta;
}

// Baut aus mehreren Bild-Buffern (JPEG/PNG) ein einzelnes PDF.
async function imagesToPdf(pages) {
  const pdf = await PDFDocument.create();
  for (const buf of pages) {
    let img;
    try { img = await pdf.embedJpg(buf); }
    catch (_) { img = await pdf.embedPng(buf); }
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return Buffer.from(await pdf.save());
}

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
    return res.status(503).json({ ok: false, error: 'Paperless nicht konfiguriert. Bitte URL/Token unter Einstellungen → Dokumente hinterlegen.' });
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

// --- Paperless-Zugang (URL/Token) aus der App verwalten ---
// GET gibt den Token NIE zurück, nur ob einer gesetzt ist.
router.get('/config', (_req, res) => {
  try {
    res.json(paperless.publicConfig());
  } catch (err) { sendError(res, err); }
});
router.put('/config', (req, res) => {
  try {
    const { url, token } = req.body || {};
    res.json(paperless.setConfig({ url, token }));
  } catch (err) { sendError(res, err); }
});

// --- Liste / Suche ---
router.get('/', async (req, res) => {
  try {
    res.json(await paperless.searchDocuments(req.query));
  } catch (err) {
    sendError(res, err);
  }
});

// --- Upload: Datei nach Paperless (asynchrone Verarbeitung → Task-ID) ---
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Datei fehlt.' });
    const result = await paperless.uploadDocument(
      { buffer: req.file.buffer, filename: req.file.originalname, mimetype: req.file.mimetype },
      parseMeta(req.body),
    );
    res.status(202).json(result); // { taskId }
  } catch (err) {
    sendError(res, err);
  }
});

// --- Scannen (Schritt 1): scannt, legt die Seiten in den Zwischenspeicher,
//     liefert scanId + Seitenanzahl zurück (noch KEIN Upload nach Paperless) ---
router.post('/scan', async (req, res) => {
  try {
    cleanupOldScans();
    const base = esclBase((req.body || {}).scannerUrl);
    if (!base) return res.status(400).json({ error: 'Scanner-URL fehlt.' });
    const pages = await scanPages(base, (req.body || {}).source);
    if (!pages.length) return res.status(502).json({ error: 'Scanner lieferte keine Seite. Papier eingelegt?' });
    const scanId = crypto.randomUUID();
    const dir = scanDir(scanId);
    fs.mkdirSync(dir, { recursive: true });
    pages.forEach((buf, i) => fs.writeFileSync(path.join(dir, `${i}.jpg`), buf));
    res.status(201).json({ scanId, count: pages.length, pages: pages.map((_, i) => ({ index: i })) });
  } catch (err) {
    res.status(err.status || 502).json({ error: 'Scan fehlgeschlagen: ' + err.message });
  }
});

// --- Scan-Seite als Bild ausliefern (für die Vorschau im Assistenten) ---
router.get('/scan/:scanId/page/:idx', (req, res) => {
  const { scanId, idx } = req.params;
  if (!isScanId(scanId) || !/^\d+$/.test(idx)) return res.status(400).end();
  const file = path.join(scanDir(scanId), `${Number(idx)}.jpg`);
  if (!file.startsWith(SCAN_TMP) || !fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});

// --- Scan verwerfen (z. B. "neu scannen") ---
router.delete('/scan/:scanId', (req, res) => {
  const { scanId } = req.params;
  if (!isScanId(scanId)) return res.status(400).end();
  fs.rmSync(scanDir(scanId), { recursive: true, force: true });
  res.status(204).end();
});

// --- Scannen (Schritt 2): Seiten zu einem PDF bündeln und mit Metadaten hochladen ---
router.post('/scan/:scanId/commit', async (req, res) => {
  try {
    const { scanId } = req.params;
    if (!isScanId(scanId)) return res.status(400).json({ error: 'Ungültige Scan-ID.' });
    const dir = scanDir(scanId);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Scan nicht gefunden oder abgelaufen.' });
    const files = fs.readdirSync(dir).filter(f => /^\d+\.jpg$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
    if (!files.length) return res.status(400).json({ error: 'Keine Seiten im Scan.' });
    const buffers = files.map(f => fs.readFileSync(path.join(dir, f)));
    const pdf = await imagesToPdf(buffers);
    const meta = parseMeta(req.body);
    const filename = (meta.title ? meta.title.replace(/[^\w.\- ]+/g, '_') : 'Scan') + '.pdf';
    const result = await paperless.uploadDocument({ buffer: pdf, filename, mimetype: 'application/pdf' }, meta);
    fs.rmSync(dir, { recursive: true, force: true });
    res.status(202).json(result); // { taskId }
  } catch (err) {
    sendError(res, err);
  }
});

// --- Task-Status abfragen (Auto-Verknüpfung wartet darauf) ---
router.get('/tasks/:id', async (req, res) => {
  try {
    res.json(await paperless.getTask(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// --- Neue Stammwerte anlegen (aus dem Upload-Dialog) ---
router.post('/correspondents', async (req, res) => {
  try {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name fehlt.' });
    res.status(201).json(await paperless.createCorrespondent(name));
  } catch (err) { sendError(res, err); }
});
router.post('/document-types', async (req, res) => {
  try {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name fehlt.' });
    res.status(201).json(await paperless.createDocumentType(name));
  } catch (err) { sendError(res, err); }
});
router.post('/tags', async (req, res) => {
  try {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name fehlt.' });
    res.status(201).json(await paperless.createTag(name));
  } catch (err) { sendError(res, err); }
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

// --- Notizen (vor /:id) ---
router.get('/:id/notes', async (req, res) => {
  try {
    res.json(await paperless.listNotes(req.params.id));
  } catch (err) { sendError(res, err); }
});
router.post('/:id/notes', async (req, res) => {
  try {
    const note = (req.body && req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Notiztext fehlt.' });
    res.status(201).json(await paperless.addNote(req.params.id, note));
  } catch (err) { sendError(res, err); }
});
router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
    res.json(await paperless.deleteNote(req.params.id, req.params.noteId));
  } catch (err) { sendError(res, err); }
});

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
