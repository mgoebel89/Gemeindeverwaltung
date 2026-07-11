'use strict';

// Express-Router für das Aufgaben-Modul. Proxyt zu Vikunja; URL/Token bleiben
// im Backend (vikunja.js). Eingebunden in server.js unter /api/aufgaben.

const express = require('express');
const vikunja = require('../vikunja');

const router = express.Router();

function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  res.status(status).json({ error: err && err.message ? err.message : 'Serverfehler' });
}

// Zugang (URL + Token).
router.get('/config', (_req, res) => {
  try { res.json(vikunja.publicConfig()); } catch (err) { sendError(res, err); }
});
router.put('/config', (req, res) => {
  try {
    const { url, token } = req.body || {};
    res.json(vikunja.setConfig({ url, token }));
  } catch (err) { sendError(res, err); }
});

// Verbindungstest.
router.get('/health', async (_req, res) => {
  try { res.json(await vikunja.health()); }
  catch (err) { res.status(200).json({ ok: false, error: err.message }); }
});

// Offene Aufgaben (fällige zuerst).
router.get('/tasks', async (_req, res) => {
  try { res.json({ tasks: await vikunja.listOpenTasks() }); } catch (err) { sendError(res, err); }
});

// Projekte (für die Auswahl beim Anlegen).
router.get('/projects', async (_req, res) => {
  try { res.json({ projects: await vikunja.listProjects() }); } catch (err) { sendError(res, err); }
});

// In Vikunja definierte Labels (für die Zuordnung in der Detailkarte).
router.get('/labels', async (_req, res) => {
  try { res.json({ labels: await vikunja.listLabels() }); } catch (err) { sendError(res, err); }
});

// Aufgabe abhaken / wieder öffnen. (Vor dem generischen /tasks/:id-Update.)
router.post('/tasks/:id/done', async (req, res) => {
  try {
    const done = req.body && req.body.done != null ? !!req.body.done : true;
    res.json(await vikunja.setTaskDone(req.params.id, done));
  } catch (err) { sendError(res, err); }
});

// Label an eine Aufgabe hängen / entfernen. (Vor dem generischen /tasks/:id.)
router.put('/tasks/:id/labels', async (req, res) => {
  try {
    const labelId = req.body && req.body.labelId;
    res.json(await vikunja.addTaskLabel(req.params.id, labelId));
  } catch (err) { sendError(res, err); }
});
router.delete('/tasks/:id/labels/:labelId', async (req, res) => {
  try { res.json(await vikunja.removeTaskLabel(req.params.id, req.params.labelId)); } catch (err) { sendError(res, err); }
});

// Eine Aufgabe im Detail laden (Beschreibung als Markdown).
router.get('/tasks/:id', async (req, res) => {
  try { res.json(await vikunja.getTask(req.params.id)); } catch (err) { sendError(res, err); }
});

// Aufgabe aktualisieren (Titel, Beschreibung, Fälligkeit, Priorität).
router.post('/tasks/:id', async (req, res) => {
  try { res.json(await vikunja.updateTask(req.params.id, req.body || {})); } catch (err) { sendError(res, err); }
});

// Neue Aufgabe in einem Projekt anlegen.
router.post('/projects/:pid/tasks', async (req, res) => {
  try { res.json(await vikunja.createTask(req.params.pid, req.body || {})); } catch (err) { sendError(res, err); }
});

module.exports = router;
