'use strict';

// Express-Router für das Modul Bargeldauslagen.
// Drei Entitäten (empfaenger, haushaltsstellen, auslagen) nach dem Payload-Muster
// (analog routes/vermietung.js) plus Beleg-Datei-Endpunkte (Scans zu einer
// Auslage, analog den Sitzungs-Attachments in server.js).

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

const MAX_UPLOAD = parseInt(process.env.MAX_UPLOAD_BYTES || (25 * 1024 * 1024), 10);

module.exports = function createAuslagenRouter(broadcast) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });

  // Generisches CRUD für eine Payload-Entität.
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

  mount('/empfaenger', {
    list: db.listEmpfaenger, get: db.getEmpfaenger, save: db.saveEmpfaenger, delete: db.deleteEmpfaenger,
  }, 'empfaenger');
  mount('/haushaltsstellen', {
    list: db.listHaushaltsstellen, get: db.getHaushaltsstelle, save: db.saveHaushaltsstelle, delete: db.deleteHaushaltsstelle,
  }, 'haushaltsstelle');
  mount('/auslagen', {
    list: db.listAuslagen, get: db.getAuslage, save: db.saveAuslage, delete: db.deleteAuslage,
  }, 'auslage');

  // --- Beleg-Dateien (Scans) zu einer Auslage ---
  router.get('/auslagen/:id/belege', (req, res) => {
    res.json(db.listBelegFiles(req.params.id));
  });

  router.post('/auslagen/:id/belege', upload.single('file'), (req, res) => {
    const auslageId = req.params.id;
    if (!db.getAuslage(auslageId)) return res.status(404).json({ error: 'auslage not found' });
    if (!req.file) return res.status(400).json({ error: 'file fehlt' });
    const id = crypto.randomUUID();
    db.ensureBelegDir(auslageId);
    fs.writeFileSync(db.belegFilePath(auslageId, id), req.file.buffer);
    const rec = db.insertBelegFile({
      id,
      auslageId,
      filename: req.file.originalname,
      mimetype: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
    });
    broadcast({ type: 'beleg:add', beleg: rec, origin: req.header('x-client-id') || '' });
    res.status(201).json(rec);
  });

  router.get('/belege/:fileId', (req, res) => {
    const f = db.getBelegFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: 'not found' });
    const p = db.belegFilePath(f.auslageId, f.id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'file fehlt auf disk' });
    res.setHeader('Content-Type', f.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.filename)}"`);
    res.setHeader('Content-Length', f.size);
    fs.createReadStream(p).pipe(res);
  });

  router.delete('/belege/:fileId', (req, res) => {
    const f = db.deleteBelegFile(req.params.fileId);
    if (!f) return res.status(404).json({ error: 'not found' });
    broadcast({ type: 'beleg:delete', id: f.id, auslageId: f.auslageId, origin: req.header('x-client-id') || '' });
    res.status(204).end();
  });

  return router;
};
