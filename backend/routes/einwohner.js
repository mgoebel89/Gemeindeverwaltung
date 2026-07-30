'use strict';

// Routen des Einwohnermoduls.
//
// ALLE Datenrouten liegen hinter `gate`. Das ist der Unterschied zu jedem
// anderen Modul dieser App: hier entscheidet der Server, ob jemand die Daten
// bekommt, nicht der Browser. Die Einwohner stehen deshalb auch NICHT im
// /api/snapshot — sonst wäre das Gate umsonst.
//
// Offen bleiben nur zwei Dinge:
//   * `GET /config` und `GET /status` — sie enthalten keine Personendaten,
//     sondern nur die Frage, ob das Modul eingerichtet und gesperrt ist. Ohne
//     sie könnte die Oberfläche nicht einmal die PIN-Abfrage anzeigen.
//   * `PUT /config` und `POST /pin`, SOLANGE keine PIN vergeben ist — sonst
//     ließe sich das Modul nie einrichten. Ab der ersten PIN sind beide zu.
//
// Reihenfolge beachten: alles Feste („/ehrungen", „/health", „/anmelden") muss
// VOR der generischen „/:id"-Route stehen, sonst schluckt die den Pfad.

const express = require('express');
const einwohner = require('../einwohner');
const ehrungen = require('../ehrungen');
const db = require('../db');
const { jubilaeumslaufJetzt, letzterJubilaeumslauf } = require('../jubilaeumslauf');

module.exports = function createEinwohnerRouter() {
  const router = express.Router();

  const weiterreichen = (res, e) => {
    res.status(e && e.status ? e.status : 500).json({ error: e.message || 'Fehler' });
  };

  const tokenAus = (req) => req.get('X-Einwohner-Token') || '';

  // Der Wächter.
  function gate(req, res, next) {
    if (einwohner.tokenGueltig(tokenAus(req))) return next();
    res.status(401).json({ error: 'Gesperrt — bitte die PIN des Einwohnermoduls eingeben.', gesperrt: true });
  }

  // --- Status und Anmeldung (offen) ---
  router.get('/status', (req, res) => {
    res.json({
      konfiguriert: einwohner.isConfigured(),
      hasPin: einwohner.hasPin(),
      angemeldet: einwohner.tokenGueltig(tokenAus(req)) && einwohner.hasPin(),
      // Ohne PIN ist das Modul offen — die Oberfläche warnt dann sichtbar.
      offen: !einwohner.hasPin(),
    });
  });

  router.post('/anmelden', async (req, res) => {
    try { res.json(await einwohner.anmelden((req.body || {}).pin)); }
    catch (e) { weiterreichen(res, e); }
  });

  router.post('/abmelden', (req, res) => res.json(einwohner.abmelden(tokenAus(req))));

  // PIN setzen/ändern/entfernen. Die Prüfung der alten PIN steckt in setPin —
  // ohne gesetzte PIN darf die erste vergeben werden (Ersteinrichtung).
  router.post('/pin', async (req, res) => {
    try {
      const b = req.body || {};
      res.json(await einwohner.setPin(b.neu, b.alt));
    } catch (e) { weiterreichen(res, e); }
  });

  // --- Konfiguration ---
  router.get('/config', (_req, res) => res.json(einwohner.publicConfig()));

  router.put('/config', (req, res) => {
    // Ist eine PIN gesetzt, darf nur ein Angemeldeter die Verbindung ändern.
    if (einwohner.hasPin() && !einwohner.tokenGueltig(tokenAus(req))) {
      return res.status(401).json({ error: 'Gesperrt.', gesperrt: true });
    }
    try { res.json(einwohner.setConfig(req.body || {})); }
    catch (e) { weiterreichen(res, e); }
  });

  router.get('/tabellen', gate, async (_req, res) => {
    try { res.json(await einwohner.tabellen()); }
    catch (e) { weiterreichen(res, e); }
  });

  // Enthält eine Beispielzeile mit echten Personendaten → hinter dem Gate.
  router.get('/health', gate, async (_req, res) => {
    try { res.json(await einwohner.health()); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // --- Ehrungen (vor '/:id') ---
  router.get('/ehrungen', gate, async (req, res) => {
    try {
      const heute = ehrungen.heuteIso();
      const von = /^\d{4}-\d{2}-\d{2}$/.test(req.query.von || '') ? req.query.von : heute;
      const bis = /^\d{4}-\d{2}-\d{2}$/.test(req.query.bis || '')
        ? req.query.bis
        : `${Number(heute.slice(0, 4)) + 1}${heute.slice(4)}`;
      const liste = await einwohner.alle();
      res.json(ehrungen.anstehende(liste, von, bis));
    } catch (e) { weiterreichen(res, e); }
  });

  router.get('/ehrungen/historie', gate, (_req, res) => {
    try { res.json(ehrungen.historie()); }
    catch (e) { weiterreichen(res, e); }
  });

  // Status/Notiz einer Ehrung setzen. Der Datensatz wird dabei erst angelegt —
  // vorher ist die Ehrung reine Rechnung.
  router.put('/ehrungen/:id', gate, (req, res) => {
    try {
      const b = req.body || {};
      if (!b.einwohnerId || !b.alter || !b.datum) {
        return res.status(400).json({ error: 'einwohnerId, alter und datum sind nötig.' });
      }
      const patch = {};
      if (b.status !== undefined) {
        if (!ehrungen.STATUS.includes(b.status)) {
          return res.status(400).json({ error: 'Unbekannter Status.' });
        }
        patch.status = b.status;
        const heute = ehrungen.heuteIso();
        // Die Zeitstempel ergeben sich aus dem Status und werden nicht getippt.
        if (b.status === 'urkunde') patch.urkundeAm = b.urkundeAm || heute;
        if (b.status === 'ueberreicht') {
          patch.urkundeAm = b.urkundeAm || undefined;
          patch.ueberreichtAm = b.ueberreichtAm || heute;
        }
        if (b.status === 'offen') { patch.urkundeAm = ''; patch.ueberreichtAm = ''; }
      }
      if (b.notiz !== undefined) patch.notiz = String(b.notiz || '');
      // undefined-Werte würden sonst echte Werte überschreiben.
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];

      const gespeichert = ehrungen.speichern({
        id: req.params.id,
        einwohnerId: String(b.einwohnerId),
        alter: Number(b.alter),
        datum: String(b.datum),
        nachname: b.nachname || '',
        vorname: b.vorname || '',
      }, patch);
      res.json(gespeichert);
    } catch (e) { weiterreichen(res, e); }
  });

  // Den Tageslauf von Hand anstoßen (Einstellungen: „Jetzt prüfen").
  router.post('/jubilaeumslauf', gate, async (_req, res) => {
    try { res.json(await jubilaeumslaufJetzt()); }
    catch (e) { weiterreichen(res, e); }
  });

  router.get('/jubilaeumslauf', gate, (_req, res) => res.json(letzterJubilaeumslauf() || null));

  // --- Abgleich: wann zuletzt geprüft wurde ---
  // Steht im allgemeinen Settings-Blob, weil es keine Personendaten sind —
  // nur ein Datum und eine Anzahl.
  router.post('/abgleich', gate, (req, res) => {
    try {
      const s = db.getSettings() || {};
      s.einwohner = Object.assign({}, s.einwohner, {
        letzterAbgleich: ehrungen.heuteIso(),
        letzterAbgleichAnzahl: Number((req.body || {}).anzahl) || 0,
      });
      db.saveSettings(s);
      res.json({ ok: true, letzterAbgleich: s.einwohner.letzterAbgleich });
    } catch (e) { weiterreichen(res, e); }
  });

  // --- Einwohner ---
  router.get('/', gate, async (req, res) => {
    try {
      res.json(await einwohner.suchen({
        q: req.query.q || '',
        frisch: req.query.frisch === '1',
      }));
    } catch (e) { weiterreichen(res, e); }
  });

  router.post('/', gate, async (req, res) => {
    try { res.status(201).json(await einwohner.anlegen(req.body || {})); }
    catch (e) { weiterreichen(res, e); }
  });

  router.get('/:id', gate, async (req, res) => {
    try {
      const e = await einwohner.holen(req.params.id);
      if (!e) return res.status(404).json({ error: 'not found' });
      res.json(e);
    } catch (e) { weiterreichen(res, e); }
  });

  router.put('/:id', gate, async (req, res) => {
    try { res.json(await einwohner.aktualisieren(req.params.id, req.body || {})); }
    catch (e) { weiterreichen(res, e); }
  });

  router.delete('/:id', gate, async (req, res) => {
    try { res.json(await einwohner.loeschen(req.params.id)); }
    catch (e) { weiterreichen(res, e); }
  });

  return router;
};
