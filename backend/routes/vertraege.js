'use strict';

// Express-Router für das Modul „Verträge und Pacht".
// Zwei Entitäten (vertragspartner, vertraege) nach dem Payload-Muster.
// Wird in server.js gemountet; broadcast() wird injiziert, damit Änderungen
// wie bei den anderen Modulen per WebSocket live verteilt werden.
// Die verknüpften Vertragsdokumente liegen in Paperless und werden nur per ID
// referenziert – hier gibt es daher kein Datei-Handling.

const express = require('express');
const db = require('../db');

module.exports = function createVertraegeRouter(broadcast) {
  const router = express.Router();

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

  mount('/vertragspartner', {
    list: db.listVertragspartner, get: db.getVertragspartner, save: db.saveVertragspartner, delete: db.deleteVertragspartner,
  }, 'vertragspartner');
  mount('/vertraege', {
    list: db.listVertraege, get: db.getVertrag, save: db.saveVertrag, delete: db.deleteVertrag,
  }, 'vertrag');

  return router;
};
