'use strict';

// Express-Router für Netzwerk-Scanner (eSCL / AirScan).
// - GET  /scanners        mDNS-Discovery (_uscan._tcp / _uscans._tcp)
// - GET  /health?url=...  Scanner-Ping (eSCL ScannerCapabilities)
// - POST /                Scan auslösen, Seiten als Beleg-Dateien zur Auslage ablegen
//
// eSCL ist reines HTTP; wir sprechen den Scanner direkt aus dem Backend an
// (Browser könnten das mangels CORS am Gerät nicht). Die mDNS-Bibliothek wird
// lazy geladen, damit das Backend auch ohne installierte Dependency startet.
//
// scanPages()/esclBase() werden zusätzlich exportiert, damit das Dokumente-Modul
// (Paperless-Upload) denselben Scan-Weg nutzen kann.

const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { URL } = require('url');
const db = require('../db');

// --- eSCL-Basis-URL normalisieren (…/eSCL ohne abschließenden Slash) ---
function esclBase(raw) {
  let u = String(raw || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  try {
    const parsed = new URL(u);
    if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/eSCL';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) { return u; }
}

// --- kleiner HTTP(S)-Helfer (liefert Buffer) ---
function request(method, urlStr, { headers = {}, body = null, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(new Error('Ungültige Scanner-URL')); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers,
      timeout,
      rejectUnauthorized: false, // eSCL-Geräte haben oft selbstsignierte Zertifikate
    };
    const req = mod.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Zeitüberschreitung beim Scanner')); });
    if (body) req.write(body);
    req.end();
  });
}

// --- ScanSettings-XML (A4, 300 dpi, Farbe, JPEG) ---
function scanSettingsXml(source) {
  const input = source === 'platen' ? 'Platen' : 'Feeder';
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>2481</pwg:Width>
      <pwg:Height>3507</pwg:Height>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${input}</pwg:InputSource>
  <scan:ColorMode>RGB24</scan:ColorMode>
  <scan:XResolution>300</scan:XResolution>
  <scan:YResolution>300</scan:YResolution>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
</scan:ScanSettings>`;
}

// Löst einen Scan aus und liefert die Seiten als JPEG-Buffer zurück.
// `base` ist bereits über esclBase() normalisiert. Wirft mit .status=502 bei Fehlern.
async function scanPages(base, source) {
  const xml = scanSettingsXml(source);
  const post = await request('POST', `${base}/ScanJobs`, {
    headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) },
    body: xml,
    timeout: 15000,
  });
  if (post.status !== 201 || !post.headers.location) {
    const err = new Error(`Scan-Job abgelehnt (Status ${post.status}). Papier eingelegt? Quelle korrekt (Einzug/Vorlagenglas)?`);
    err.status = 502;
    throw err;
  }
  let jobUrl = post.headers.location;
  if (/^\//.test(jobUrl)) { const u = new URL(base); jobUrl = `${u.protocol}//${u.host}${jobUrl}`; }

  const pages = [];
  for (let page = 0; page < 50; page++) {
    let doc;
    try {
      doc = await request('GET', `${jobUrl}/NextDocument`, { timeout: 60000 });
    } catch (e) {
      if (pages.length) break; // Netzwerk-Ende nach mind. einer Seite tolerieren
      throw e;
    }
    if (doc.status === 404 || doc.status === 410) break; // keine weitere Seite
    if (doc.status < 200 || doc.status >= 300 || !doc.body.length) break;
    pages.push(doc.body);
  }
  return pages;
}

module.exports = function createScanRouter(broadcast) {
  const router = express.Router();

  // --- mDNS-Discovery ---
  router.get('/scanners', async (_req, res) => {
    let Bonjour;
    try {
      ({ Bonjour } = require('bonjour-service'));
    } catch (e) {
      return res.status(501).json({ error: 'mDNS-Suche nicht verfügbar (bonjour-service nicht installiert). Scanner-URL bitte manuell eintragen.' });
    }
    const instance = new Bonjour();
    const found = new Map(); // key: ip:port
    function collect(service, secure) {
      const ip = (service.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || service.host;
      if (!ip) return;
      const port = service.port;
      const rs = (service.txt && (service.txt.rs || service.txt.RS)) || 'eSCL';
      const proto = secure ? 'https' : 'http';
      const url = `${proto}://${ip}:${port}/${String(rs).replace(/^\/+/, '')}`;
      found.set(`${ip}:${port}`, {
        name: service.name || (service.txt && service.txt.ty) || ip,
        host: ip,
        port,
        url,
      });
    }
    const b1 = instance.find({ type: 'uscan' }, (s) => collect(s, false));
    const b2 = instance.find({ type: 'uscans' }, (s) => collect(s, true));
    setTimeout(() => {
      try { b1.stop(); b2.stop(); instance.destroy(); } catch (_) {}
      res.json(Array.from(found.values()));
    }, 3000);
  });

  // --- Health / Verbindungstest ---
  router.get('/health', async (req, res) => {
    const base = esclBase(req.query.url);
    if (!base) return res.status(400).json({ ok: false, error: 'Scanner-URL fehlt.' });
    try {
      const r = await request('GET', `${base}/ScannerCapabilities`, { timeout: 8000 });
      if (r.status >= 200 && r.status < 300) return res.json({ ok: true, url: base });
      return res.status(502).json({ ok: false, error: `Scanner antwortete mit Status ${r.status}` });
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message });
    }
  });

  // --- Scan auslösen (Belege zu einer Auslage) ---
  router.post('/', async (req, res) => {
    const { auslageId, source } = req.body || {};
    const base = esclBase((req.body || {}).scannerUrl);
    if (!base) return res.status(400).json({ error: 'Scanner-URL fehlt.' });
    if (!auslageId || !db.getAuslage(auslageId)) return res.status(404).json({ error: 'auslage not found' });

    try {
      const pages = await scanPages(base, source);
      if (!pages.length) return res.status(502).json({ error: 'Scanner lieferte keine Seite. Papier eingelegt?' });

      const created = [];
      for (let i = 0; i < pages.length; i++) {
        const body = pages[i];
        const id = crypto.randomUUID();
        db.ensureBelegDir(auslageId);
        fs.writeFileSync(db.belegFilePath(auslageId, id), body);
        const rec = db.insertBelegFile({
          id, auslageId,
          filename: `Scan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${i + 1}.jpg`,
          mimetype: 'image/jpeg',
          size: body.length,
        });
        created.push(rec);
        broadcast({ type: 'beleg:add', beleg: rec, origin: req.header('x-client-id') || '' });
      }
      res.status(201).json(created);
    } catch (e) {
      res.status(e.status || 502).json({ error: 'Scan fehlgeschlagen: ' + e.message });
    }
  });

  return router;
};

// Für Wiederverwendung durch das Dokumente-Modul (Paperless-Upload per Scan).
module.exports.scanPages = scanPages;
module.exports.esclBase = esclBase;
