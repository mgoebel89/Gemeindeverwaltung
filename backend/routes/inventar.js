'use strict';

// Proxy zu Homebox für das Gemeindeinventar. Homebox bleibt die führende
// Quelle — hier wird nichts gespeichert, nur durchgereicht. Die Zugangsdaten
// bleiben serverseitig.
//
// Eine Ausnahme gibt es: die Wartungs-ERGÄNZUNG. Homebox führt die Wartungen
// selbst, kennt aber keine Wiederholung und weiß nichts von unserem
// Aufgabenmodul. Wiederholungsintervall, abweichende Vorlauffrist und die
// bereits angelegte Aufgabe stehen deshalb lokal (Tabelle inventar_wartungen,
// id = id der Homebox-Wartung). Diese Routen fügen beides zusammen, damit das
// Frontend nur EINE Wartung kennt.

const express = require('express');
const homebox = require('../homebox');
const db = require('../db');
const { wartungslaufJetzt } = require('../wartungslauf');

module.exports = function createInventarRouter() {
  const router = express.Router();

  const weiterreichen = (res, e) => {
    res.status(e && e.status ? e.status : 500).json({ error: e.message || 'Fehler' });
  };

  // Homebox-Wartung + lokale Ergänzung zu einem Datensatz verschmelzen.
  function mitErgaenzung(w) {
    const lokal = db.getInventarWartung(w.id) || {};
    return Object.assign({}, w, {
      intervallMonate: Number(lokal.intervallMonate) || 0,
      vorlaufTage: lokal.vorlaufTage == null ? null : Number(lokal.vorlaufTage),
      aufgabeId: lokal.aufgabeId || null,
    });
  }

  function ergaenzungSpeichern(id, itemId, body) {
    const vorher = db.getInventarWartung(id) || {};
    const intervall = Number(body.intervallMonate) || 0;
    const vorlauf = (body.vorlaufTage === '' || body.vorlaufTage == null)
      ? null : Number(body.vorlaufTage);
    // Ohne Intervall UND ohne eigene Frist UND ohne Aufgabe gibt es nichts zu
    // merken – dann den lokalen Datensatz gar nicht erst stehen lassen.
    if (!intervall && vorlauf == null && !vorher.aufgabeId) {
      if (vorher.id) db.deleteInventarWartung(id);
      return;
    }
    db.saveInventarWartung(Object.assign({}, vorher, {
      id,
      itemId,
      intervallMonate: intervall,
      vorlaufTage: vorlauf,
      lastModifiedAt: new Date().toISOString(),
    }));
  }

  // --- Konfiguration ---
  router.get('/config', (_req, res) => res.json(homebox.publicConfig()));
  router.put('/config', (req, res) => {
    try { res.json(homebox.setConfig(req.body || {})); }
    catch (e) { weiterreichen(res, e); }
  });
  router.get('/health', async (_req, res) => {
    try {
      const h = await homebox.health();
      // Ob diese Homebox Wartungen kann, entscheidet, was die Oberfläche
      // überhaupt anbieten darf.
      h.wartungen = await homebox.wartungenVerfuegbar().catch(() => false);
      res.json(h);
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // --- Sammlungen (Homebox-Gruppen) ---
  router.get('/sammlungen', async (_req, res) => {
    try { res.json(await homebox.sammlungen()); }
    catch (e) { weiterreichen(res, e); }
  });

  // --- Stammdaten (Lagerorte, Etiketten) ---
  router.get('/stammdaten', async (_req, res) => {
    try {
      const [orte, marken] = await Promise.all([
        homebox.orte(),
        homebox.marken().catch(() => []),   // Etiketten sind optional
      ]);
      res.json({ orte, marken });
    } catch (e) { weiterreichen(res, e); }
  });

  // --- Wartungen über den ganzen Bestand ---
  // Steht VOR '/:id', sonst schluckt die generische Route den Pfad.
  router.get('/wartungen', async (req, res) => {
    try {
      const liste = await homebox.alleWartungen(req.query.status || 'scheduled');
      res.json(liste.map(mitErgaenzung));
    } catch (e) { weiterreichen(res, e); }
  });

  // Den täglichen Lauf von Hand anstoßen (Einstellungen: „Jetzt prüfen").
  router.post('/wartungslauf', async (_req, res) => {
    try { res.json(await wartungslaufJetzt()); }
    catch (e) { weiterreichen(res, e); }
  });

  // --- Barcode-Suche ---
  router.get('/barcode/:code', async (req, res) => {
    try {
      const artikel = await homebox.beiBarcode(req.params.code);
      if (!artikel) return res.status(404).json({ error: 'not found', barcode: req.params.code });
      res.json(artikel);
    } catch (e) { weiterreichen(res, e); }
  });

  // --- Suche/Liste ---
  router.get('/', async (req, res) => {
    try {
      res.json(await homebox.suchen({
        q: req.query.q || '',
        seite: parseInt(req.query.seite, 10) || 1,
        proSeite: parseInt(req.query.proSeite, 10) || 25,
        ortId: req.query.ortId || '',
      }));
    } catch (e) { weiterreichen(res, e); }
  });

  // --- Anlegen ---
  router.post('/', async (req, res) => {
    try {
      const b = req.body || {};
      if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Name fehlt.' });
      res.status(201).json(await homebox.anlegen(b));
    } catch (e) { weiterreichen(res, e); }
  });

  // --- Bestand buchen ---
  router.post('/:id/bestand', async (req, res) => {
    try {
      const { delta, menge } = req.body || {};
      if (delta == null && menge == null) return res.status(400).json({ error: 'delta oder menge angeben.' });
      res.json(await homebox.bestandAendern(req.params.id, { delta, menge }));
    } catch (e) { weiterreichen(res, e); }
  });

  // --- Wartungen eines Gegenstands ---
  router.get('/:id/wartungen', async (req, res) => {
    try {
      const liste = await homebox.wartungen(req.params.id, req.query.status || 'both');
      res.json(liste.map(mitErgaenzung));
    } catch (e) { weiterreichen(res, e); }
  });

  router.post('/:id/wartungen', async (req, res) => {
    try {
      const b = req.body || {};
      const w = await homebox.wartungAnlegen(req.params.id, b);
      ergaenzungSpeichern(w.id, req.params.id, b);
      res.status(201).json(mitErgaenzung(w));
    } catch (e) { weiterreichen(res, e); }
  });

  router.put('/wartung/:wid', async (req, res) => {
    try {
      const b = req.body || {};
      const w = await homebox.wartungAendern(req.params.wid, b);
      ergaenzungSpeichern(w.id, b.itemId || w.itemId || '', b);
      res.json(mitErgaenzung(w));
    } catch (e) { weiterreichen(res, e); }
  });

  router.delete('/wartung/:wid', async (req, res) => {
    try {
      await homebox.wartungLoeschen(req.params.wid);
      db.deleteInventarWartung(req.params.wid);
      res.json({ ok: true });
    } catch (e) { weiterreichen(res, e); }
  });

  // --- Einzelabruf, Bearbeiten, Löschen ---
  router.get('/:id', async (req, res) => {
    try {
      const a = await homebox.holen(req.params.id);
      if (!a) return res.status(404).json({ error: 'not found' });
      res.json(a);
    } catch (e) { weiterreichen(res, e); }
  });

  router.put('/:id', async (req, res) => {
    try { res.json(await homebox.aktualisieren(req.params.id, req.body || {})); }
    catch (e) { weiterreichen(res, e); }
  });

  // Homebox löscht die Wartungen des Gegenstands mit; die lokalen Ergänzungen
  // dazu blieben sonst als Waisen liegen und der Tageslauf stolperte darüber.
  router.delete('/:id', async (req, res) => {
    try {
      await homebox.loeschen(req.params.id);
      const aufgeraeumt = db.deleteInventarWartungenZuArtikel(req.params.id);
      res.json({ ok: true, wartungenAufgeraeumt: aufgeraeumt });
    } catch (e) { weiterreichen(res, e); }
  });

  return router;
};
