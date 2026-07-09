'use strict';

// Express-Router für das Vermietungs-Modul (Gemeindehaus & Jugendraum).
// Drei Entitäten (mieter, raeume, vermietungen) nach dem Payload-Muster.
// Wird in server.js gemountet; broadcast()/clientId werden injiziert, damit
// Änderungen wie bei den Sitzungen per WebSocket live verteilt werden.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

const MAX_UPLOAD = parseInt(process.env.MAX_UPLOAD_BYTES || (25 * 1024 * 1024), 10);

module.exports = function createVermietungRouter(broadcast) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });

  // Baut CRUD-Routen für eine Entität an einem Sub-Router.
  function mount(path, api, evName) {
    const r = express.Router();
    r.get('/', (_req, res) => res.json(api.list()));
    r.get('/:id', (req, res) => {
      const obj = api.get(req.params.id);
      if (!obj) return res.status(404).json({ error: 'not found' });
      res.json(obj);
    });
    r.put('/:id', (req, res) => {
      const body = req.body || {};
      if (body.id !== req.params.id) return res.status(400).json({ error: 'id mismatch' });
      const saved = api.save(body);
      broadcast({ type: `${evName}:save`, [evName]: saved, origin: req.header('x-client-id') || '' });
      res.json(saved);
    });
    r.delete('/:id', (req, res) => {
      api.delete(req.params.id);
      broadcast({ type: `${evName}:delete`, id: req.params.id, origin: req.header('x-client-id') || '' });
      res.status(204).end();
    });
    router.use(path, r);
  }

  mount('/mieter', {
    list: db.listMieter, get: db.getMieter, save: db.saveMieter, delete: db.deleteMieter,
  }, 'mieter');
  mount('/raeume', {
    list: db.listRaeume, get: db.getRaum, save: db.saveRaum, delete: db.deleteRaum,
  }, 'raum');
  mount('/vermietungen', {
    list: db.listVermietungen, get: db.getVermietung, save: db.saveVermietung, delete: db.deleteVermietung,
  }, 'vermietung');

  // --- Zählerstand-Fotos zu einer Vermietung (Beweisführung) ---
  router.get('/vermietungen/:id/fotos', (req, res) => {
    res.json(db.listVermietungFiles(req.params.id));
  });

  router.post('/vermietungen/:id/fotos', upload.single('file'), (req, res) => {
    const vermietungId = req.params.id;
    if (!db.getVermietung(vermietungId)) return res.status(404).json({ error: 'vermietung not found' });
    if (!req.file) return res.status(400).json({ error: 'file fehlt' });
    const id = crypto.randomUUID();
    db.ensureVermietungFileDir(vermietungId);
    fs.writeFileSync(db.vermietungFilePath(vermietungId, id), req.file.buffer);
    const rec = db.insertVermietungFile({
      id,
      vermietungId,
      kind: (req.body && req.body.kind) || '',
      filename: req.file.originalname,
      mimetype: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
    });
    broadcast({ type: 'vermietungFoto:add', foto: rec, origin: req.header('x-client-id') || '' });
    res.status(201).json(rec);
  });

  router.get('/vermietung-files/:fileId', (req, res) => {
    const f = db.getVermietungFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: 'not found' });
    const p = db.vermietungFilePath(f.vermietungId, f.id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'file fehlt auf disk' });
    res.setHeader('Content-Type', f.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.filename)}"`);
    res.setHeader('Content-Length', f.size);
    fs.createReadStream(p).pipe(res);
  });

  router.delete('/vermietung-files/:fileId', (req, res) => {
    const f = db.deleteVermietungFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: 'not found' });
    broadcast({ type: 'vermietungFoto:delete', id: f.id, vermietungId: f.vermietungId, origin: req.header('x-client-id') || '' });
    res.status(204).end();
  });

  return router;
};
