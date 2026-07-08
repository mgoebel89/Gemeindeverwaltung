'use strict';

// Express-Router für das Vermietungs-Modul (Gemeindehaus & Jugendraum).
// Drei Entitäten (mieter, raeume, vermietungen) nach dem Payload-Muster.
// Wird in server.js gemountet; broadcast()/clientId werden injiziert, damit
// Änderungen wie bei den Sitzungen per WebSocket live verteilt werden.

const express = require('express');
const db = require('../db');

module.exports = function createVermietungRouter(broadcast) {
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

  mount('/mieter', {
    list: db.listMieter, get: db.getMieter, save: db.saveMieter, delete: db.deleteMieter,
  }, 'mieter');
  mount('/raeume', {
    list: db.listRaeume, get: db.getRaum, save: db.saveRaum, delete: db.deleteRaum,
  }, 'raum');
  mount('/vermietungen', {
    list: db.listVermietungen, get: db.getVermietung, save: db.saveVermietung, delete: db.deleteVermietung,
  }, 'vermietung');

  return router;
};
