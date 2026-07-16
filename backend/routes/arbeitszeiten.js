'use strict';

// Express-Router für das Modul „Arbeitszeiten & Vergütung".
// Drei Entitäten nach dem Payload-Muster (wie Vermietung/Verträge):
//   arbeiter             – Leistungserbringer (Person ODER Firma, ein Typ)
//   arbeitszeiten        – einzelne Tätigkeitseinträge
//   arbeitsabrechnungen  – je Person/Zeitraum zusammengefasst, Sätze eingefroren
// Belege/Dateien gibt es hier bewusst nicht (die PDFs landen bei Bedarf in
// Paperless). Wird in server.js gemountet; broadcast() wird injiziert, damit
// Änderungen wie in den anderen Modulen per WebSocket live verteilt werden.

const express = require('express');
const db = require('../db');

module.exports = function createArbeitszeitenRouter(broadcast) {
  const router = express.Router();

  // Baut CRUD-Routen für eine Entität an einem Sub-Router (wie im Vermietungs-Router).
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

  mount('/arbeiter', {
    list: db.listArbeiter, get: db.getArbeiter, save: db.saveArbeiter, delete: db.deleteArbeiter,
  }, 'arbeiter');
  mount('/arbeitszeiten', {
    list: db.listArbeitszeiten, get: db.getArbeitszeit, save: db.saveArbeitszeit, delete: db.deleteArbeitszeit,
  }, 'arbeitszeit');
  mount('/arbeitsabrechnungen', {
    list: db.listArbeitsabrechnungen, get: db.getArbeitsabrechnung,
    save: db.saveArbeitsabrechnung, delete: db.deleteArbeitsabrechnung,
  }, 'arbeitsabrechnung');

  return router;
};
