'use strict';

// Express-Router für das Modul „Vorgänge & Projekte".
// Eine Entität (vorgaenge) nach dem Payload-Muster (wie Verträge).
// Die getippte Vorgangshistorie, verknüpfte Paperless-Dokumente und
// Kosteneinträge laufen alle im Payload-JSON mit – daher kein Datei-Handling
// hier (Belege liegen in Paperless und werden nur per ID referenziert).
// Wird in server.js gemountet; broadcast() wird injiziert, damit Änderungen
// wie bei den anderen Modulen per WebSocket live verteilt werden.

const express = require('express');
const db = require('../db');

module.exports = function createVorgaengeRouter(broadcast) {
  const router = express.Router();

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

  return router;
};
