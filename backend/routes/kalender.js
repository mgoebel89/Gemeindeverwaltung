'use strict';

// Express-Router für das Kalender-Modul (abonnierte iCal-URLs). Holt und parst
// externe Kalender serverseitig (kalender.js), damit CORS und geheime Abo-URLs
// im Backend bleiben. Eingebunden in server.js unter /api/kalender.

const express = require('express');
const kalender = require('../kalender');

const router = express.Router();

function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  res.status(status).json({ error: err && err.message ? err.message : 'Serverfehler' });
}

// Konfiguration: Liste der Abo-Kalender { id, name, url }.
router.get('/config', (_req, res) => {
  try { res.json(kalender.publicConfig()); } catch (err) { sendError(res, err); }
});
router.put('/config', (req, res) => {
  try {
    const cals = (req.body && req.body.calendars) || [];
    res.json(kalender.saveCalendars(cals));
  } catch (err) { sendError(res, err); }
});

// Einzelne URL testen, ohne sie zu speichern.
router.post('/test', async (req, res) => {
  try {
    const url = req.body && req.body.url;
    res.json(await kalender.testUrl(url));
  } catch (err) { res.status(200).json({ ok: false, error: err.message }); }
});

// Aggregierte Termine aller Kalender im Fenster [from .. +days].
// `from` (YYYY-MM-DD, lokal) ist optional – ohne Angabe beginnt das Fenster
// heute. Die Kalenderansichten blättern damit zu beliebigen Monaten/Wochen,
// auch Jahre in der Zukunft.
router.get('/events', async (req, res) => {
  try {
    const days = Math.min(730, Math.max(1, parseInt(req.query.days, 10) || 90));
    let from;
    const q = String(req.query.from || '').trim();
    if (q) {
      const m = q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return res.status(400).json({ error: 'from muss YYYY-MM-DD sein' });
      // Lokale Mitternacht – nicht Date.parse(), das läse YYYY-MM-DD als UTC
      // und verschöbe den Fensterstart um einen Tag.
      from = new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0).getTime();
    }
    res.json(await kalender.getEvents({ days, from }));
  } catch (err) { sendError(res, err); }
});

module.exports = router;
