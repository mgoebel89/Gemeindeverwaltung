'use strict';

// SANE-Brücke: spricht Netzwerkscanner über das lokale `scanimage` an (Paket
// sane-utils + Treiber wie sane-airscan). Damit lassen sich auch Geräte nutzen,
// die die App nicht direkt per eSCL erreicht – insbesondere **WSD-only**-Scanner
// wie der Epson ES-580W (sane-airscan wählt automatisch eSCL oder WSD).
//
// Installation auf dem LXC:  apt install sane-utils sane-airscan
// Gerätenamen liefert `scanimage -L` (z. B. "airscan:w1:EPSON ES-580W").
//
// In der App werden SANE-Geräte im selben Scanner-Feld wie eSCL abgelegt, aber
// mit Präfix `sane:` gekennzeichnet (siehe routes/scan.js). Node ruft scanimage
// per spawn mit Argument-Array auf (keine Shell) – Gerätenamen mit Leerzeichen
// sind so unkritisch.

const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const SCAN_TIMEOUT_MS = 180000; // Mehrseitiger ADF-Scan darf dauern.

// Führt scanimage aus und liefert { code, stdout(Buffer), stderr(String) }.
function run(args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('scanimage', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return reject(e); }
    const out = [], err = [];
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} reject(new Error('Zeitüberschreitung bei scanimage')); }, timeout);
    proc.stdout.on('data', d => out.push(d));
    proc.stderr.on('data', d => err.push(d));
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }); });
  });
}

// Ist scanimage installiert? (einmalig gecacht)
let _available = null;
async function available() {
  if (_available !== null) return _available;
  try {
    const r = await run(['--version'], { timeout: 5000 });
    _available = r.code === 0;
  } catch (_) { _available = false; }
  return _available;
}

// Parst die Ausgabe von `scanimage --formatted-device-list=%d|%v|%m|%t%n`
// (device|vendor|model|type je Zeile) zu [{ device, name }].
function parseDeviceList(text) {
  const devices = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s || s.indexOf('|') < 0) continue;
    const [device, vendor, model] = s.split('|');
    if (!device) continue;
    const label = [vendor, model].filter(Boolean).join(' ').trim() || device;
    devices.push({ device, name: label });
  }
  return devices;
}

// Verfügbare SANE-Geräte auflisten: [{ device, name }].
async function listDevices() {
  if (!(await available())) return [];
  let r;
  try {
    // Kompakte, gut parsebare Ausgabe: device|vendor|model|type je Zeile.
    r = await run(['--formatted-device-list=%d|%v|%m|%t%n'], { timeout: 25000 });
  } catch (_) { return []; }
  return parseDeviceList(r.stdout.toString('utf8'));
}

// Baut die scanimage-Argumente (voll + minimal als Fallback).
function buildScanArgs(device, source, pattern) {
  const srcArg = source === 'platen' ? ['--source', 'Flatbed'] : (source === 'feeder' ? ['--source', 'ADF'] : []);
  return {
    full: ['-d', device, '--format=jpeg', '--mode', 'Color', '--resolution', '300', ...srcArg, '--batch=' + pattern],
    minimal: ['-d', device, '--format=jpeg', '--batch=' + pattern],
  };
}

// Prüft, ob ein bestimmtes Gerät (device-String) aktuell auflistbar ist.
async function devicePresent(device) {
  if (!(await available())) return { ok: false, error: 'SANE/scanimage nicht installiert (apt install sane-utils sane-airscan).' };
  const list = await listDevices();
  const hit = list.find(d => d.device === device);
  if (hit) return { ok: true, device: hit.device, name: hit.name };
  return { ok: false, error: 'Gerät nicht in „scanimage -L" gefunden. Eingeschaltet und im selben Netz?' };
}

// Liest die im Batch erzeugten Seiten (p0001.jpg, …) sortiert als Buffer.
function readPages(dir) {
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return []; }
  return files
    .filter(f => /^p\d+\.jpg$/i.test(f))
    .sort()
    .map(f => fs.readFileSync(path.join(dir, f)))
    .filter(b => b.length);
}

function saneError(r) {
  const s = (r && r.stderr ? r.stderr : '').trim();
  if (/no documents|out of documents|feeder|document feeder/i.test(s)) return 'Kein Papier im Einzug (ADF leer).';
  if (/invalid argument|not a valid device|no such device|failed to open|open of device/i.test(s)) return 'Scanner nicht erreichbar oder Gerätename ungültig.';
  const tail = s ? ': ' + s.split('\n').filter(Boolean).slice(-3).join(' ') : (r ? ' (Code ' + r.code + ')' : '');
  return 'Scan fehlgeschlagen' + tail;
}

// Scannt über scanimage und liefert JPEG-Seiten als Buffer[] (wie eSCL-Pfad).
// `source`: 'feeder' | 'platen' | undefined. Bei mehrseitigem ADF liefert der
// Batch mehrere Seiten; beim Flachbett bricht scanimage nach Seite 1 mit Fehler
// ab – die bereits geschriebene Seite wird trotzdem übernommen.
async function scanToJpegs(device, source) {
  if (!(await available())) { const e = new Error('SANE/scanimage nicht installiert (apt install sane-utils sane-airscan).'); e.status = 503; throw e; }
  if (!device) { const e = new Error('Kein SANE-Gerät angegeben.'); e.status = 400; throw e; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvscan-'));
  const pattern = path.join(dir, 'p%04d.jpg');
  const { full: fullArgs, minimal: minimalArgs } = buildScanArgs(device, source, pattern);

  try {
    let r = await run(fullArgs, { timeout: SCAN_TIMEOUT_MS });
    // Manche Backends benennen --source/--mode/--resolution anders. Wenn der
    // volle Aufruf fehlschlägt UND keine Seite entstand, minimal wiederholen.
    if (r.code !== 0 && !readPages(dir).length) {
      r = await run(minimalArgs, { timeout: SCAN_TIMEOUT_MS });
    }
    const pages = readPages(dir);
    if (!pages.length) { const e = new Error(saneError(r)); e.status = 502; throw e; }
    return pages;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  available, listDevices, devicePresent, scanToJpegs,
  // für Tests:
  parseDeviceList, buildScanArgs, saneError,
};
