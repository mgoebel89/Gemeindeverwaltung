'use strict';

// Express-Router für das E-Mail-Modul. Proxyt zum Postfach (mail.js);
// Zugangsdaten bleiben im Backend. Eingebunden in server.js unter /api/mail.

const express = require('express');
const mail = require('../mail');

const router = express.Router();

function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  res.status(status).json({ error: err && err.message ? err.message : 'Serverfehler' });
}

// Zugang (Host/Benutzer/Ports/Absender; Passwort nur schreibend).
router.get('/config', (_req, res) => {
  try { res.json(mail.publicConfig()); } catch (err) { sendError(res, err); }
});
router.put('/config', (req, res) => {
  try { res.json(mail.setConfig(req.body || {})); } catch (err) { sendError(res, err); }
});

// Verbindungstest (IMAP und SMTP getrennt).
router.post('/test', async (_req, res) => {
  try { res.json(await mail.testConnection()); }
  catch (err) { res.status(200).json({ ok: false, error: err.message }); }
});

// Posteingang (Kopfzeilen). ?limit=50&search=…
router.get('/messages', async (req, res) => {
  try {
    res.json(await mail.listInbox({ limit: req.query.limit, search: req.query.search }));
  } catch (err) { sendError(res, err); }
});

// Einzelne Nachricht inkl. Text und Anhangsliste.
router.get('/messages/:uid', async (req, res) => {
  try { res.json(await mail.getMessage(req.params.uid)); } catch (err) { sendError(res, err); }
});

// Anhang als Datei – wird beim Zuordnen an den Paperless-Upload weitergereicht.
router.get('/messages/:uid/attachments/:idx', async (req, res) => {
  try {
    const a = await mail.getAttachment(req.params.uid, req.params.idx);
    res.setHeader('Content-Type', a.contentType);
    res.setHeader('Content-Disposition',
      'inline; filename="' + String(a.filename).replace(/"/g, '') + '"');
    res.send(a.content);
  } catch (err) { sendError(res, err); }
});

// Senden (Antwort aus dem Vorgang heraus oder neue Nachricht).
router.post('/send', async (req, res) => {
  try { res.json(await mail.sendMail(req.body || {})); } catch (err) { sendError(res, err); }
});

module.exports = router;
