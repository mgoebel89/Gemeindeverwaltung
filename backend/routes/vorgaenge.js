'use strict';

// Express-Router für das Modul „Vorgänge & Projekte".
// Eine Entität (vorgaenge) nach dem Payload-Muster (wie Verträge).
// Die getippte Vorgangshistorie, verknüpfte Paperless-Dokumente und
// Kosteneinträge laufen im Payload-JSON mit (Belege liegen in Paperless und
// werden nur per ID referenziert). Verlaufsfotos sind dagegen echte Dateien und
// laufen über vorgang_files nach dem *_files-Muster der Vermietung.
// Wird in server.js gemountet; broadcast() wird injiziert, damit Änderungen
// wie bei den anderen Modulen per WebSocket live verteilt werden.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

const MAX_UPLOAD = parseInt(process.env.MAX_UPLOAD_BYTES || (25 * 1024 * 1024), 10);

module.exports = function createVorgaengeRouter(broadcast) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });

  router.get('/vorgaenge', (_req, res) => res.json(db.listVorgaenge()));
  router.get('/vorgaenge/:id', (req, res) => {
    const obj = db.getVorgang(req.params.id);
    if (!obj) return res.status(404).json({ error: 'not found' });
    res.json(obj);
  });
  router.put('/vorgaenge/:id', (req, res) => {
    const body = req.body || {};
    if (body.id !== req.params.id) return res.status(400).json({ error: 'id mismatch' });
    const saved = db.saveVorgang(body);
    broadcast({ type: 'vorgang:save', vorgang: saved, origin: req.header('x-client-id') || '' });
    res.json(saved);
  });
  router.delete('/vorgaenge/:id', (req, res) => {
    db.deleteVorgang(req.params.id);
    broadcast({ type: 'vorgang:delete', id: req.params.id, origin: req.header('x-client-id') || '' });
    res.status(204).end();
  });

  // --- Fotos zu Verlaufseinträgen (kind = hist_<eintragId>) ---
  router.get('/vorgaenge/:id/fotos', (req, res) => {
    res.json(db.listVorgangFiles(req.params.id));
  });

  router.post('/vorgaenge/:id/fotos', upload.single('file'), (req, res) => {
    const vorgangId = req.params.id;
    if (!db.getVorgang(vorgangId)) return res.status(404).json({ error: 'vorgang not found' });
    if (!req.file) return res.status(400).json({ error: 'file fehlt' });
    const id = crypto.randomUUID();
    db.ensureVorgangFileDir(vorgangId);
    fs.writeFileSync(db.vorgangFilePath(vorgangId, id), req.file.buffer);
    const rec = db.insertVorgangFile({
      id,
      vorgangId,
      kind: (req.body && req.body.kind) || '',
      filename: req.file.originalname,
      mimetype: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
    });
    broadcast({ type: 'vorgangFoto:add', foto: rec, origin: req.header('x-client-id') || '' });
    res.status(201).json(rec);
  });

  router.get('/vorgang-files/:fileId', (req, res) => {
    const f = db.getVorgangFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: 'not found' });
    const p = db.vorgangFilePath(f.vorgangId, f.id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'file fehlt auf disk' });
    res.setHeader('Content-Type', f.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.filename)}"`);
    res.setHeader('Content-Length', f.size);
    fs.createReadStream(p).pipe(res);
  });

  router.delete('/vorgang-files/:fileId', (req, res) => {
    const f = db.deleteVorgangFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: 'not found' });
    broadcast({ type: 'vorgangFoto:delete', id: f.id, vorgangId: f.vorgangId, origin: req.header('x-client-id') || '' });
    res.status(204).end();
  });

  return router;
};
