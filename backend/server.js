'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const db = require('./db');
const dokumenteRouter = require('./routes/dokumente');
const kalenderRouter = require('./routes/kalender');
const aufgabenRouter = require('./routes/vikunja');
const createVermietungRouter = require('./routes/vermietung');
const createAuslagenRouter = require('./routes/auslagen');
const createScanRouter = require('./routes/scan');
const createVertraegeRouter = require('./routes/vertraege');
const createVorgaengeRouter = require('./routes/vorgaenge');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPLOAD = parseInt(process.env.MAX_UPLOAD_BYTES || (25 * 1024 * 1024), 10);

const app = express();
app.use(express.json({ limit: '10mb' }));

// --- WebSocket-Broadcast ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === 1) {
      try { c.send(data); } catch (_) {}
    }
  }
}
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'hello', t: Date.now() }));
});

// --- Health ---
app.get('/api/health', (_req, res) => res.json({ ok: true, version: 1 }));

// --- Modul: Dokumente (Paperless-ngx-Proxy) ---
app.use('/api/dokumente', dokumenteRouter);

// --- Modul: Kalender (iCal-Abo-Proxy) ---
app.use('/api/kalender', kalenderRouter);

// --- Modul: Aufgaben (Vikunja-Proxy) ---
app.use('/api/aufgaben', aufgabenRouter);

// --- Modul: Vermietung (Gemeindehaus & Jugendraum) ---
app.use('/api', createVermietungRouter(broadcast));

// --- Modul: Bargeldauslagen ---
app.use('/api', createAuslagenRouter(broadcast));
app.use('/api/scan', createScanRouter(broadcast));

// --- Modul: Verträge und Pacht ---
app.use('/api', createVertraegeRouter(broadcast));
app.use('/api', createVorgaengeRouter(broadcast));

// --- Snapshot (Bootstrap) ---
app.get('/api/snapshot', (_req, res) => {
  res.json({
    sitzungen: db.listSitzungen(),
    mitglieder: db.listMitglieder(),
    settings: db.getSettings(),
    attachments: groupAttachments(),
    mieter: db.listMieter(),
    raeume: db.listRaeume(),
    vermietungen: db.listVermietungen(),
    vermietungFiles: groupVermietungFotos(),
    empfaenger: db.listEmpfaenger(),
    haushaltsstellen: db.listHaushaltsstellen(),
    auslagen: db.listAuslagen(),
    belege: groupBelege(),
    vertragspartner: db.listVertragspartner(),
    vertraege: db.listVertraege(),
    vorgaenge: db.listVorgaenge(),
    serverTime: new Date().toISOString(),
  });
});

function groupAttachments() {
  const grouped = {};
  for (const s of db.listSitzungen()) {
    const atts = db.listAttachments(s.id);
    if (atts.length) grouped[s.id] = atts;
  }
  return grouped;
}

function groupBelege() {
  const grouped = {};
  for (const a of db.listAuslagen()) {
    const files = db.listBelegFiles(a.id);
    if (files.length) grouped[a.id] = files;
  }
  return grouped;
}

function groupVermietungFotos() {
  const grouped = {};
  for (const v of db.listVermietungen()) {
    const files = db.listVermietungFiles(v.id);
    if (files.length) grouped[v.id] = files;
  }
  return grouped;
}

// --- Sitzungen ---
app.get('/api/sitzungen', (_req, res) => res.json(db.listSitzungen()));
app.get('/api/sitzungen/:id', (req, res) => {
  const s = db.getSitzung(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});
app.put('/api/sitzungen/:id', (req, res) => {
  const body = req.body || {};
  if (body.id !== req.params.id) return res.status(400).json({ error: 'id mismatch' });
  const saved = db.saveSitzung(body);
  broadcast({ type: 'sitzung:save', sitzung: saved, origin: req.header('x-client-id') || '' });
  res.json(saved);
});
app.delete('/api/sitzungen/:id', (req, res) => {
  db.deleteSitzung(req.params.id);
  broadcast({ type: 'sitzung:delete', id: req.params.id, origin: req.header('x-client-id') || '' });
  res.status(204).end();
});

// --- Mitglieder ---
app.get('/api/mitglieder', (_req, res) => res.json(db.listMitglieder()));
app.put('/api/mitglieder/:id', (req, res) => {
  const body = req.body || {};
  if (body.id !== req.params.id) return res.status(400).json({ error: 'id mismatch' });
  const saved = db.saveMitglied(body);
  broadcast({ type: 'mitglied:save', mitglied: saved, origin: req.header('x-client-id') || '' });
  res.json(saved);
});
app.delete('/api/mitglieder/:id', (req, res) => {
  db.deleteMitglied(req.params.id);
  broadcast({ type: 'mitglied:delete', id: req.params.id, origin: req.header('x-client-id') || '' });
  res.status(204).end();
});

// --- Settings ---
app.get('/api/settings', (_req, res) => res.json(db.getSettings() || null));
app.put('/api/settings', (req, res) => {
  const saved = db.saveSettings(req.body || {});
  broadcast({ type: 'settings:save', settings: saved, origin: req.header('x-client-id') || '' });
  res.json(saved);
});

// --- Attachments ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD },
});

app.get('/api/sitzungen/:id/attachments', (req, res) => {
  res.json(db.listAttachments(req.params.id));
});

app.post('/api/sitzungen/:id/attachments', upload.single('file'), (req, res) => {
  const sitzungId = req.params.id;
  if (!db.getSitzung(sitzungId)) return res.status(404).json({ error: 'sitzung not found' });
  if (!req.file) return res.status(400).json({ error: 'file fehlt' });
  const id = crypto.randomUUID();
  db.ensureAttachmentDir(sitzungId);
  fs.writeFileSync(db.attachmentPath(sitzungId, id), req.file.buffer);
  const rec = db.insertAttachment({
    id,
    sitzungId,
    filename: req.file.originalname,
    mimetype: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
  });
  broadcast({ type: 'attachment:add', attachment: rec, origin: req.header('x-client-id') || '' });
  res.status(201).json(rec);
});

app.get('/api/attachments/:id', (req, res) => {
  const a = db.getAttachment(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  const p = db.attachmentPath(a.sitzungId, a.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'file fehlt auf disk' });
  res.setHeader('Content-Type', a.mimetype || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.filename)}"`);
  res.setHeader('Content-Length', a.size);
  fs.createReadStream(p).pipe(res);
});

app.delete('/api/attachments/:id', (req, res) => {
  const a = db.deleteAttachment(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  broadcast({ type: 'attachment:delete', id: a.id, sitzungId: a.sitzungId, origin: req.header('x-client-id') || '' });
  res.status(204).end();
});

// --- Bulk-Import (Migration aus localStorage) ---
app.post('/api/import', (req, res) => {
  const { sitzungen = [], mitglieder = [], settings = null } = req.body || {};
  let s = 0, m = 0;
  for (const x of sitzungen) { try { db.saveSitzung(x); s++; } catch (e) { console.warn('import sitzung', e.message); } }
  for (const x of mitglieder) { try { db.saveMitglied(x); m++; } catch (e) { console.warn('import mitglied', e.message); } }
  if (settings) db.saveSettings(settings);
  broadcast({ type: 'bulk:imported', counts: { sitzungen: s, mitglieder: m } });
  res.json({ sitzungen: s, mitglieder: m, settings: !!settings });
});

// --- Error-Handler (z. B. multer LIMIT_FILE_SIZE) ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Serverfehler' });
});

server.listen(PORT, HOST, () => {
  console.log(`Gemeindeverwaltung-Backend lauscht auf http://${HOST}:${PORT}`);
});
