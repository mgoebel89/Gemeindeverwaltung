'use strict';

// IMAP/SMTP-Anbindung des Gemeinde-Postfachs (Evanzo-Hosting = Standard-IMAP,
// kein Sonderprotokoll). Zugangsdaten bleiben serverseitig – Backend-Proxy wie
// Paperless/Vikunja/Kalender. Konfiguration aus Env als Vorgabe/Fallback:
//   MAIL_HOST, MAIL_USER, MAIL_PASS, MAIL_IMAP_PORT (993), MAIL_SMTP_PORT (587),
//   MAIL_FROM (Anzeigename/Absender), MAIL_SENT (Ordnername, Standard „Sent")
//
// Zweck ist NICHT ein Mailclient-Ersatz, sondern die Brücke zur Vorgangsakte:
// Posteingang durchsehen, eine Nachricht einem Vorgang zuordnen, aus dem
// Vorgang heraus antworten. Deshalb bewusst nur INBOX.

const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const db = require('./db');

const ENV = {
  host: process.env.MAIL_HOST || '',
  user: process.env.MAIL_USER || '',
  pass: process.env.MAIL_PASS || '',
  imapPort: Number(process.env.MAIL_IMAP_PORT || 993),
  smtpPort: Number(process.env.MAIL_SMTP_PORT || 587),
  from: process.env.MAIL_FROM || '',
  sentBox: process.env.MAIL_SENT || 'Sent',
};

const TIMEOUT_MS = 20000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

let cfg = { ...ENV };

function loadConfig() {
  let s = null;
  try { s = db.getMailConfig(); } catch (_) { s = null; }
  const pick = (k, fallback) => (s && s[k] != null && s[k] !== '') ? s[k] : fallback;
  cfg = {
    host: String(pick('host', ENV.host)).trim(),
    user: String(pick('user', ENV.user)).trim(),
    pass: (s && s.pass) ? String(s.pass) : ENV.pass,
    imapPort: Number(pick('imapPort', ENV.imapPort)) || 993,
    smtpPort: Number(pick('smtpPort', ENV.smtpPort)) || 587,
    from: String(pick('from', ENV.from)).trim(),
    sentBox: String(pick('sentBox', ENV.sentBox)).trim() || 'Sent',
  };
  return cfg;
}
loadConfig();

// Leeres Passwortfeld lässt das gespeicherte unangetastet – so lassen sich
// Host/Port/Absender ändern, ohne das Passwort neu einzutippen.
function setConfig(patch = {}) {
  const cur = (() => { try { return db.getMailConfig() || {}; } catch (_) { return {}; } })();
  const str = (k) => (patch[k] != null ? String(patch[k]).trim() : (cur[k] || ''));
  const next = {
    host: str('host'),
    user: str('user'),
    pass: (patch.pass != null && String(patch.pass) !== '') ? String(patch.pass) : (cur.pass || ''),
    imapPort: Number(patch.imapPort != null ? patch.imapPort : (cur.imapPort || ENV.imapPort)) || 993,
    smtpPort: Number(patch.smtpPort != null ? patch.smtpPort : (cur.smtpPort || ENV.smtpPort)) || 587,
    from: str('from'),
    sentBox: str('sentBox') || 'Sent',
  };
  db.saveMailConfig(next);
  loadConfig();
  return publicConfig();
}

// Passwort NIE herausgeben – nur ob gesetzt und woher.
function publicConfig() {
  let s = null;
  try { s = db.getMailConfig(); } catch (_) { s = null; }
  const src = (s && (s.host || s.user || s.pass)) ? 'app' : ((ENV.host || ENV.user) ? 'env' : 'none');
  return {
    host: cfg.host || '', user: cfg.user || '',
    imapPort: cfg.imapPort, smtpPort: cfg.smtpPort,
    from: cfg.from || '', sentBox: cfg.sentBox || 'Sent',
    hasPass: !!cfg.pass, source: src,
  };
}

function isConfigured() { return !!(cfg.host && cfg.user && cfg.pass); }

class MailError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'MailError';
    this.status = status || 502;
  }
}

function requireConfig() {
  if (!isConfigured()) {
    throw new MailError('E-Mail ist nicht konfiguriert (Einstellungen → E-Mail).', 503);
  }
}

// --- IMAP ------------------------------------------------------------------
// Jede Anfrage öffnet eine eigene Verbindung und schließt sie wieder. Für die
// paar Zugriffe dieser App ist das robuster als ein Dauer-Client, der nach
// Netzhängern still tot ist.
async function withImap(fn) {
  requireConfig();
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.imapPort,
    secure: cfg.imapPort === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    await client.connect();
  } catch (err) {
    throw new MailError('IMAP-Verbindung fehlgeschlagen: ' + err.message, 502);
  }
  try {
    return await fn(client);
  } finally {
    try { await client.logout(); } catch (_) { /* Verbindung ist ohnehin hin */ }
  }
}

function adr(a) {
  if (!a) return '';
  const list = Array.isArray(a) ? a : (a.value || []);
  return list.map(x => (x.name ? `${x.name} <${x.address}>` : x.address)).join(', ');
}
function adrListe(a) {
  if (!a) return [];
  const list = Array.isArray(a) ? a : (a.value || []);
  return list.map(x => ({ name: x.name || '', address: x.address || '' }));
}

// Kopfzeilen des Posteingangs. `search` filtert über Betreff ODER Absender –
// serverseitig via IMAP SEARCH, damit auch ältere Nachrichten gefunden werden.
async function listInbox({ limit, search } = {}) {
  const max = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  return withImap(async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // WICHTIG: `search()` liefert ohne `{ uid: true }` SEQUENZNUMMERN (1..N),
      // keine UIDs. Beides zu verwechseln liefert stillschweigend die falschen
      // Nachrichten – `fetch(..., { uid: true })` liest die Sequenznummern dann
      // als UIDs und trifft je nach Alter des Postfachs Jahre daneben.
      let uids;
      const q = String(search || '').trim();
      if (q) {
        const [betreff, von] = await Promise.all([
          client.search({ subject: q }, { uid: true }),
          client.search({ from: q }, { uid: true }),
        ]);
        uids = [...new Set([...(betreff || []), ...(von || [])])];
      } else {
        uids = await client.search({ all: true }, { uid: true });
      }
      // Höchste UIDs = zuletzt eingegangen.
      uids = (uids || []).map(Number).filter(n => Number.isFinite(n))
        .sort((a, b) => a - b).slice(-max).reverse();
      if (!uids.length) return { messages: [], gesamt: 0 };

      const out = [];
      for await (const msg of client.fetch(uids, { envelope: true, flags: true, bodyStructure: true }, { uid: true })) {
        const env = msg.envelope || {};
        out.push({
          uid: msg.uid,
          betreff: env.subject || '(kein Betreff)',
          von: adr(env.from), vonListe: adrListe(env.from),
          an: adr(env.to),
          datum: env.date ? new Date(env.date).toISOString() : null,
          messageId: env.messageId || '',
          gelesen: !!(msg.flags && msg.flags.has && msg.flags.has('\\Seen')),
          hatAnhang: hatAnhaenge(msg.bodyStructure),
        });
      }
      // fetch liefert nicht zwingend in UID-Reihenfolge → neueste zuerst.
      out.sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));
      return { messages: out, gesamt: out.length };
    } finally {
      lock.release();
    }
  });
}

function hatAnhaenge(node) {
  if (!node) return false;
  if (Array.isArray(node.childNodes)) return node.childNodes.some(hatAnhaenge);
  const disp = String(node.disposition || '').toLowerCase();
  if (disp === 'attachment') return true;
  const typ = String(node.type || '').toLowerCase();
  return !!(node.dispositionParameters && node.dispositionParameters.filename)
    || (!!node.parameters && !!node.parameters.name && typ !== 'text/plain' && typ !== 'text/html');
}

// Vollständige Nachricht inkl. Textkörper und Anhangsliste (ohne Inhalte).
async function getMessage(uid) {
  const id = Number(uid);
  if (!Number.isFinite(id)) throw new MailError('Ungültige UID.', 400);
  return withImap(async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const msg = await client.fetchOne(String(id), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new MailError('Nachricht nicht gefunden.', 404);
      const p = await simpleParser(msg.source);
      return {
        uid: id,
        betreff: p.subject || '(kein Betreff)',
        von: adr(p.from), vonListe: adrListe(p.from),
        an: adr(p.to), anListe: adrListe(p.to),
        cc: adr(p.cc),
        datum: p.date ? new Date(p.date).toISOString() : null,
        messageId: p.messageId || '',
        references: [].concat(p.references || []).filter(Boolean),
        text: p.text || '',
        anhaenge: (p.attachments || []).map((a, i) => ({
          index: i,
          filename: a.filename || ('anhang-' + (i + 1)),
          contentType: a.contentType || 'application/octet-stream',
          size: a.size || (a.content ? a.content.length : 0),
        })),
      };
    } finally {
      lock.release();
    }
  });
}

// Einzelner Anhang als Buffer – für den Weiterreicher nach Paperless.
async function getAttachment(uid, index) {
  const id = Number(uid); const idx = Number(index);
  if (!Number.isFinite(id) || !Number.isFinite(idx)) throw new MailError('Ungültige Parameter.', 400);
  return withImap(async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const msg = await client.fetchOne(String(id), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new MailError('Nachricht nicht gefunden.', 404);
      const p = await simpleParser(msg.source);
      const a = (p.attachments || [])[idx];
      if (!a) throw new MailError('Anhang nicht gefunden.', 404);
      return {
        filename: a.filename || ('anhang-' + (idx + 1)),
        contentType: a.contentType || 'application/octet-stream',
        content: a.content,
      };
    } finally {
      lock.release();
    }
  });
}

// --- SMTP ------------------------------------------------------------------
function transporter() {
  requireConfig();
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465, // 587 = STARTTLS, wird von nodemailer selbst gehoben
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
  });
}

// Versendet und legt die Nachricht zusätzlich per IMAP in „Gesendet" ab – sonst
// fehlte der halbe Schriftwechsel im gewohnten Mailprogramm.
async function sendMail({ an, cc, betreff, text, inReplyTo, references }) {
  requireConfig();
  const empfaenger = String(an || '').trim();
  if (!empfaenger) throw new MailError('Kein Empfänger angegeben.', 400);

  const mail = {
    from: cfg.from || cfg.user,
    to: empfaenger,
    cc: String(cc || '').trim() || undefined,
    subject: String(betreff || '').trim() || '(kein Betreff)',
    text: String(text || ''),
  };
  if (inReplyTo) {
    mail.inReplyTo = inReplyTo;
    mail.references = [].concat(references || [], inReplyTo).filter(Boolean);
  }

  let info;
  try {
    info = await transporter().sendMail(mail);
  } catch (err) {
    throw new MailError('Versand fehlgeschlagen: ' + err.message, 502);
  }

  // Ablage in „Gesendet" ist Komfort, kein Muss: schlägt sie fehl, ist die Mail
  // trotzdem raus – deshalb nur vermerken, nicht den ganzen Versand kippen.
  let abgelegt = false, ablageFehler = '';
  try {
    const raw = info.message || (await buildRaw(mail));
    await withImap(async (client) => {
      await client.append(cfg.sentBox, raw, ['\\Seen']);
    });
    abgelegt = true;
  } catch (err) {
    ablageFehler = err.message;
  }

  return {
    messageId: info.messageId || '',
    an: empfaenger,
    betreff: mail.subject,
    gesendetAm: new Date().toISOString(),
    inSentOrdner: abgelegt,
    ablageFehler,
  };
}

// Rohfassung für den IMAP-APPEND, falls der Transport sie nicht mitliefert.
async function buildRaw(mail) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  return await new MailComposer(mail).compile().build();
}

// Verbindungstest für die Einstellungen: prüft IMAP und SMTP getrennt, damit
// klar wird, welche Seite klemmt.
async function testConnection() {
  const out = { imap: { ok: false }, smtp: { ok: false } };
  try {
    const anz = await withImap(async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try { return client.mailbox ? client.mailbox.exists : 0; } finally { lock.release(); }
    });
    out.imap = { ok: true, nachrichten: anz };
  } catch (err) { out.imap = { ok: false, error: err.message }; }

  try {
    await transporter().verify();
    out.smtp = { ok: true };
  } catch (err) { out.smtp = { ok: false, error: err.message }; }

  out.ok = out.imap.ok && out.smtp.ok;
  return out;
}

module.exports = {
  loadConfig, setConfig, publicConfig, isConfigured,
  listInbox, getMessage, getAttachment, sendMail, testConnection,
  MailError,
};
