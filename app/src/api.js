(function () {
  'use strict';
  window.GR = window.GR || {};

  const BASE = ''; // gleicher Host, nginx leitet /api an Node
  const WS_PATH = '/ws';

  const CLIENT_ID = (function () {
    let id = '';
    try { id = sessionStorage.getItem('gr.clientId') || ''; } catch (_) {}
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || ('c-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      try { sessionStorage.setItem('gr.clientId', id); } catch (_) {}
    }
    return id;
  })();

  const listeners = [];
  let ws = null;
  let wsReconnectTimer = null;
  let wsBackoff = 1000;

  async function jsonFetch(path, opts = {}) {
    const res = await fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${txt.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  // --- Snapshot/Health ---
  async function health() { return jsonFetch('/api/health'); }
  async function snapshot() { return jsonFetch('/api/snapshot'); }

  // --- Sitzungen ---
  async function putSitzung(s) { return jsonFetch(`/api/sitzungen/${encodeURIComponent(s.id)}`, { method: 'PUT', body: s }); }
  async function deleteSitzungRemote(id) { return jsonFetch(`/api/sitzungen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // --- Personen-Stammdaten (Rat, Mieter, Empfänger, Arbeiter, Vertragspartner) ---
  async function listPersonen() { return jsonFetch('/api/personen'); }
  async function putPerson(p) { return jsonFetch(`/api/personen/${encodeURIComponent(p.id)}`, { method: 'PUT', body: p }); }
  async function deletePersonRemote(id) { return jsonFetch(`/api/personen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function personenMigration() { return jsonFetch('/api/personen-migration'); }

  // --- Mitglieder (Sicht auf die Personen mit Rolle „rat") ---
  async function putMitglied(m) { return jsonFetch(`/api/mitglieder/${encodeURIComponent(m.id)}`, { method: 'PUT', body: m }); }
  async function deleteMitgliedRemote(id) { return jsonFetch(`/api/mitglieder/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // --- Settings ---
  async function putSettings(s) { return jsonFetch('/api/settings', { method: 'PUT', body: s }); }

  // --- Attachments ---
  async function listAttachments(sitzungId) { return jsonFetch(`/api/sitzungen/${encodeURIComponent(sitzungId)}/attachments`); }
  async function uploadAttachment(sitzungId, file) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const res = await fetch(`/api/sitzungen/${encodeURIComponent(sitzungId)}/attachments`, { method: 'POST', body: fd, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }
  async function deleteAttachment(id) { return jsonFetch(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  function attachmentUrl(id) { return `/api/attachments/${encodeURIComponent(id)}`; }

  // --- Bulk-Import (Migration) ---
  async function importAll(payload) { return jsonFetch('/api/import', { method: 'POST', body: payload }); }

  // --- Modul: Vermietung (Mieter, Räume, Vermietungen) ---
  async function putMieter(m) { return jsonFetch(`/api/mieter/${encodeURIComponent(m.id)}`, { method: 'PUT', body: m }); }
  async function deleteMieterRemote(id) { return jsonFetch(`/api/mieter/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putRaum(r) { return jsonFetch(`/api/raeume/${encodeURIComponent(r.id)}`, { method: 'PUT', body: r }); }
  async function deleteRaumRemote(id) { return jsonFetch(`/api/raeume/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putVermietung(v) { return jsonFetch(`/api/vermietungen/${encodeURIComponent(v.id)}`, { method: 'PUT', body: v }); }
  async function deleteVermietungRemote(id) { return jsonFetch(`/api/vermietungen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function listVermietungFotos(vermietungId) { return jsonFetch(`/api/vermietungen/${encodeURIComponent(vermietungId)}/fotos`); }
  async function uploadVermietungFoto(vermietungId, file, kind) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (kind) fd.append('kind', kind);
    const res = await fetch(`/api/vermietungen/${encodeURIComponent(vermietungId)}/fotos`, { method: 'POST', body: fd, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }
  async function deleteVermietungFoto(fileId) { return jsonFetch(`/api/vermietung-files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }); }
  function vermietungFotoUrl(fileId) { return `/api/vermietung-files/${encodeURIComponent(fileId)}`; }

  // --- Modul: Bargeldauslagen (Empfänger, Haushaltsstellen, Auslagen, Belege, Scan) ---
  async function putEmpfaenger(e) { return jsonFetch(`/api/empfaenger/${encodeURIComponent(e.id)}`, { method: 'PUT', body: e }); }
  async function deleteEmpfaengerRemote(id) { return jsonFetch(`/api/empfaenger/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putHaushaltsstelle(h) { return jsonFetch(`/api/haushaltsstellen/${encodeURIComponent(h.id)}`, { method: 'PUT', body: h }); }
  async function deleteHaushaltsstelleRemote(id) { return jsonFetch(`/api/haushaltsstellen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putAuslage(a) { return jsonFetch(`/api/auslagen/${encodeURIComponent(a.id)}`, { method: 'PUT', body: a }); }
  async function deleteAuslageRemote(id) { return jsonFetch(`/api/auslagen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  async function listBelege(auslageId) { return jsonFetch(`/api/auslagen/${encodeURIComponent(auslageId)}/belege`); }
  async function uploadBeleg(auslageId, file) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const res = await fetch(`/api/auslagen/${encodeURIComponent(auslageId)}/belege`, { method: 'POST', body: fd, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }
  async function deleteBelegFile(fileId) { return jsonFetch(`/api/belege/${encodeURIComponent(fileId)}`, { method: 'DELETE' }); }
  function belegUrl(fileId) { return `/api/belege/${encodeURIComponent(fileId)}`; }
  async function listScanners() { return jsonFetch('/api/scan/scanners'); }
  async function scanHealth(url) { return jsonFetch(`/api/scan/health?url=${encodeURIComponent(url)}`); }
  async function scan(auslageId, scannerUrl, source) { return jsonFetch('/api/scan', { method: 'POST', body: { auslageId, scannerUrl, source } }); }

  // --- Modul: Verträge und Pacht (Vertragspartner, Verträge) ---
  async function putVertragspartner(p) { return jsonFetch(`/api/vertragspartner/${encodeURIComponent(p.id)}`, { method: 'PUT', body: p }); }
  async function deleteVertragspartnerRemote(id) { return jsonFetch(`/api/vertragspartner/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putVertrag(v) { return jsonFetch(`/api/vertraege/${encodeURIComponent(v.id)}`, { method: 'PUT', body: v }); }
  async function deleteVertragRemote(id) { return jsonFetch(`/api/vertraege/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // --- Modul: Vorgänge & Projekte ---
  async function putVorgang(v) { return jsonFetch(`/api/vorgaenge/${encodeURIComponent(v.id)}`, { method: 'PUT', body: v }); }
  async function deleteVorgangRemote(id) { return jsonFetch(`/api/vorgaenge/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  // --- Modul: Arbeitszeiten & Vergütung ---
  async function putArbeiter(a) { return jsonFetch(`/api/arbeiter/${encodeURIComponent(a.id)}`, { method: 'PUT', body: a }); }
  async function deleteArbeiterRemote(id) { return jsonFetch(`/api/arbeiter/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putArbeitszeit(z) { return jsonFetch(`/api/arbeitszeiten/${encodeURIComponent(z.id)}`, { method: 'PUT', body: z }); }
  async function deleteArbeitszeitRemote(id) { return jsonFetch(`/api/arbeitszeiten/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function putArbeitsabrechnung(a) { return jsonFetch(`/api/arbeitsabrechnungen/${encodeURIComponent(a.id)}`, { method: 'PUT', body: a }); }
  async function deleteArbeitsabrechnungRemote(id) { return jsonFetch(`/api/arbeitsabrechnungen/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  async function listVorgangFotos(vorgangId) { return jsonFetch(`/api/vorgaenge/${encodeURIComponent(vorgangId)}/fotos`); }
  async function uploadVorgangFoto(vorgangId, file, kind) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (kind) fd.append('kind', kind);
    const res = await fetch(`/api/vorgaenge/${encodeURIComponent(vorgangId)}/fotos`, { method: 'POST', body: fd, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }
  async function deleteVorgangFoto(fileId) { return jsonFetch(`/api/vorgang-files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }); }
  function vorgangFotoUrl(fileId) { return `/api/vorgang-files/${encodeURIComponent(fileId)}`; }

  // --- Modul: Dokumente (Paperless-Proxy im Backend) ---
  function docQuery(params = {}) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      usp.set(k, v);
    }
    const qs = usp.toString();
    return qs ? `?${qs}` : '';
  }
  async function docHealth() { return jsonFetch('/api/dokumente/health'); }
  async function docMeta() { return jsonFetch('/api/dokumente/meta'); }
  async function searchDocuments(params) { return jsonFetch('/api/dokumente' + docQuery(params)); }
  async function getDocument(id) { return jsonFetch(`/api/dokumente/${encodeURIComponent(id)}`); }
  async function patchDocument(id, patch) { return jsonFetch(`/api/dokumente/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }); }
  function docFileUrl(id, kind = 'preview') { return `/api/dokumente/${encodeURIComponent(id)}/${kind}`; }
  // Upload einer Datei nach Paperless (multipart). meta: { title, correspondent, document_type, created, tags[] }
  async function uploadDocument(file, meta = {}) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (meta.title) fd.append('title', meta.title);
    if (meta.correspondent) fd.append('correspondent', meta.correspondent);
    if (meta.document_type) fd.append('document_type', meta.document_type);
    if (meta.created) fd.append('created', meta.created);
    if (meta.tags && meta.tags.length) fd.append('tags', meta.tags.join(','));
    const res = await fetch('/api/dokumente/upload', { method: 'POST', body: fd, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Upload ${res.status}: ${t.slice(0, 200)}`); }
    return res.json();
  }
  async function scanDocument(scannerUrl, source) { return jsonFetch('/api/dokumente/scan', { method: 'POST', body: { scannerUrl, source } }); }
  function scanPageUrl(scanId, idx) { return `/api/dokumente/scan/${encodeURIComponent(scanId)}/page/${idx}`; }
  async function discardScan(scanId) { return jsonFetch(`/api/dokumente/scan/${encodeURIComponent(scanId)}`, { method: 'DELETE' }); }
  async function commitScan(scanId, meta) { return jsonFetch(`/api/dokumente/scan/${encodeURIComponent(scanId)}/commit`, { method: 'POST', body: meta }); }
  async function getDocTask(id) { return jsonFetch(`/api/dokumente/tasks/${encodeURIComponent(id)}`); }
  async function createCorrespondent(name) { return jsonFetch('/api/dokumente/correspondents', { method: 'POST', body: { name } }); }
  async function createDocumentType(name) { return jsonFetch('/api/dokumente/document-types', { method: 'POST', body: { name } }); }
  async function createTag(name) { return jsonFetch('/api/dokumente/tags', { method: 'POST', body: { name } }); }
  async function getDocConfig() { return jsonFetch('/api/dokumente/config'); }
  async function putDocConfig(cfg) { return jsonFetch('/api/dokumente/config', { method: 'PUT', body: cfg }); }
  // --- Kalender (iCal-Abos, Backend-Proxy) ---
  async function getCalConfig() { return jsonFetch('/api/kalender/config'); }
  async function putCalConfig(calendars) { return jsonFetch('/api/kalender/config', { method: 'PUT', body: { calendars } }); }
  async function testCalUrl(url) { return jsonFetch('/api/kalender/test', { method: 'POST', body: { url } }); }
  // from: 'YYYY-MM-DD' (lokal) – ohne Angabe beginnt das Fenster heute.
  async function listCalEvents(days = 90, from = null) {
    const q = `days=${encodeURIComponent(days)}` + (from ? `&from=${encodeURIComponent(from)}` : '');
    return jsonFetch(`/api/kalender/events?${q}`);
  }

  // --- Aufgaben (Vikunja, Backend-Proxy) ---
  // --- E-Mail (Postfach der Gemeinde, Backend-Proxy) ---
  async function getMailConfig() { return jsonFetch('/api/mail/config'); }
  async function putMailConfig(cfg) { return jsonFetch('/api/mail/config', { method: 'PUT', body: cfg }); }
  async function testMail() { return jsonFetch('/api/mail/test', { method: 'POST', body: {} }); }
  async function listMails({ limit, search } = {}) {
    const p = new URLSearchParams();
    if (limit) p.set('limit', String(limit));
    if (search) p.set('search', search);
    const q = p.toString();
    return jsonFetch('/api/mail/messages' + (q ? '?' + q : ''));
  }
  async function getMail(uid) { return jsonFetch(`/api/mail/messages/${encodeURIComponent(uid)}`); }
  function mailAttachmentUrl(uid, idx) { return `/api/mail/messages/${encodeURIComponent(uid)}/attachments/${encodeURIComponent(idx)}`; }
  async function markMailSeen(uid, gelesen = true) {
    return jsonFetch(`/api/mail/messages/${encodeURIComponent(uid)}/seen`, { method: 'POST', body: { gelesen } });
  }
  async function sendMail(body) { return jsonFetch('/api/mail/send', { method: 'POST', body }); }

  async function getTaskConfig() { return jsonFetch('/api/aufgaben/config'); }
  async function putTaskConfig(cfg) { return jsonFetch('/api/aufgaben/config', { method: 'PUT', body: cfg }); }
  async function taskHealth() { return jsonFetch('/api/aufgaben/health'); }
  async function listOpenTasks() { return jsonFetch('/api/aufgaben/tasks'); }
  async function listTaskProjects() { return jsonFetch('/api/aufgaben/projects'); }
  async function completeTask(id, done = true) { return jsonFetch(`/api/aufgaben/tasks/${encodeURIComponent(id)}/done`, { method: 'POST', body: { done } }); }
  async function createTask(projectId, payload) { return jsonFetch(`/api/aufgaben/projects/${encodeURIComponent(projectId)}/tasks`, { method: 'POST', body: payload }); }
  async function getTask(id) { return jsonFetch(`/api/aufgaben/tasks/${encodeURIComponent(id)}`); }
  async function updateTask(id, patch) { return jsonFetch(`/api/aufgaben/tasks/${encodeURIComponent(id)}`, { method: 'POST', body: patch }); }
  async function listTaskLabels() { return jsonFetch('/api/aufgaben/labels'); }
  async function addTaskLabel(id, labelId) { return jsonFetch(`/api/aufgaben/tasks/${encodeURIComponent(id)}/labels`, { method: 'PUT', body: { labelId } }); }
  async function removeTaskLabel(id, labelId) { return jsonFetch(`/api/aufgaben/tasks/${encodeURIComponent(id)}/labels/${encodeURIComponent(labelId)}`, { method: 'DELETE' }); }

  // --- Modul Inventar (Homebox-Proxy) ---
  // Es gibt bewusst keinen lokalen Cache: Homebox ist die führende Quelle,
  // deshalb ist hier alles asynchron und jede Ansicht fragt frisch nach.
  const inv = (p) => '/api/inventar' + p;
  async function getInventarConfig() { return jsonFetch(inv('/config')); }
  async function putInventarConfig(cfg) { return jsonFetch(inv('/config'), { method: 'PUT', body: cfg }); }
  async function inventarHealth() { return jsonFetch(inv('/health')); }
  async function listInventarSammlungen() { return jsonFetch(inv('/sammlungen')); }
  async function inventarStammdaten() { return jsonFetch(inv('/stammdaten')); }
  async function suchenInventar({ q = '', ortId = '', seite = 1, proSeite = 50 } = {}) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (ortId) p.set('ortId', ortId);
    p.set('seite', seite); p.set('proSeite', proSeite);
    return jsonFetch(inv('/?' + p.toString()));
  }
  async function getInventarArtikel(id) { return jsonFetch(inv(`/${encodeURIComponent(id)}`)); }
  async function inventarBeiBarcode(code) { return jsonFetch(inv(`/barcode/${encodeURIComponent(code)}`)); }
  async function anlegenInventarArtikel(a) { return jsonFetch(inv('/'), { method: 'POST', body: a }); }
  async function speichernInventarArtikel(id, a) { return jsonFetch(inv(`/${encodeURIComponent(id)}`), { method: 'PUT', body: a }); }
  async function loeschenInventarArtikel(id) { return jsonFetch(inv(`/${encodeURIComponent(id)}`), { method: 'DELETE' }); }
  async function buchenInventarBestand(id, arg) { return jsonFetch(inv(`/${encodeURIComponent(id)}/bestand`), { method: 'POST', body: arg }); }
  async function listInventarWartungen(id, status = 'both') { return jsonFetch(inv(`/${encodeURIComponent(id)}/wartungen?status=${status}`)); }
  async function listOffeneWartungen(status = 'scheduled') { return jsonFetch(inv(`/wartungen?status=${status}`)); }
  async function anlegenWartung(id, w) { return jsonFetch(inv(`/${encodeURIComponent(id)}/wartungen`), { method: 'POST', body: w }); }
  async function speichernWartung(wid, w) { return jsonFetch(inv(`/wartung/${encodeURIComponent(wid)}`), { method: 'PUT', body: w }); }
  async function loeschenWartung(wid) { return jsonFetch(inv(`/wartung/${encodeURIComponent(wid)}`), { method: 'DELETE' }); }
  async function wartungslaufJetzt() { return jsonFetch(inv('/wartungslauf'), { method: 'POST' }); }

  // --- Modul Einwohner (zweite NocoDB-Base, hinter eigener PIN) ---
  //
  // Anders als überall sonst gibt es hier einen Sitzungs-Token. Er kommt aus
  // dem Backend, sobald die PIN stimmt, und muss an JEDER Datenanfrage hängen —
  // ohne ihn antwortet der Server mit 401. Er liegt im sessionStorage und ist
  // damit beim Schließen des Tabs wieder weg; das ist Absicht, ein
  // Melderegister soll nicht dauerhaft offenstehen.
  const EW_TOKEN_KEY = 'gr.einwohnerToken';
  function ewToken() {
    try { return sessionStorage.getItem(EW_TOKEN_KEY) || ''; } catch (_) { return ''; }
  }
  function setEwToken(t) {
    try {
      if (t) sessionStorage.setItem(EW_TOKEN_KEY, t);
      else sessionStorage.removeItem(EW_TOKEN_KEY);
    } catch (_) {}
  }

  const ew = (p) => '/api/einwohner' + p;
  // Eigener Helfer statt jsonFetch: die 401 des Gates ist kein Fehler, den man
  // dem Nutzer als „Backend 401" hinwirft, sondern die Aufforderung, die PIN
  // einzugeben. Sie kommt deshalb als erkennbarer Fehler mit `gesperrt` zurück.
  async function ewFetch(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': CLIENT_ID,
        'X-Einwohner-Token': ewToken(),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      const daten = await res.json().catch(() => ({}));
      const fehler = new Error(daten.error || 'Gesperrt.');
      fehler.gesperrt = true;
      // Ein abgelaufener Token ist wertlos — gleich wegräumen, damit die
      // Oberfläche nicht in einer Schleife aus 401ern hängt.
      if (daten.gesperrt) setEwToken('');
      throw fehler;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${txt.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  }

  async function einwohnerStatus() { return ewFetch(ew('/status')); }
  async function einwohnerAnmelden(pin) {
    const r = await ewFetch(ew('/anmelden'), { method: 'POST', body: { pin } });
    if (r && r.token) setEwToken(r.token);
    return r;
  }
  async function einwohnerAbmelden() {
    try { await ewFetch(ew('/abmelden'), { method: 'POST' }); } catch (_) {}
    setEwToken('');
  }
  async function einwohnerPin(neu, alt) { return ewFetch(ew('/pin'), { method: 'POST', body: { neu, alt } }); }
  async function getEinwohnerConfig() { return ewFetch(ew('/config')); }
  async function putEinwohnerConfig(cfg) { return ewFetch(ew('/config'), { method: 'PUT', body: cfg }); }
  async function einwohnerTabellen() { return ewFetch(ew('/tabellen')); }
  async function einwohnerHealth() { return ewFetch(ew('/health')); }
  async function listEinwohner({ q = '', frisch = false } = {}) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (frisch) p.set('frisch', '1');
    const qs = p.toString();
    return ewFetch(ew('/' + (qs ? '?' + qs : '')));
  }
  async function getEinwohner(id) { return ewFetch(ew(`/${encodeURIComponent(id)}`)); }
  async function anlegenEinwohner(e) { return ewFetch(ew('/'), { method: 'POST', body: e }); }
  async function speichernEinwohner(id, e) { return ewFetch(ew(`/${encodeURIComponent(id)}`), { method: 'PUT', body: e }); }
  async function loeschenEinwohner(id) { return ewFetch(ew(`/${encodeURIComponent(id)}`), { method: 'DELETE' }); }
  async function listEhrungen({ von = '', bis = '' } = {}) {
    const p = new URLSearchParams();
    if (von) p.set('von', von);
    if (bis) p.set('bis', bis);
    const qs = p.toString();
    return ewFetch(ew('/ehrungen' + (qs ? '?' + qs : '')));
  }
  async function listEhrungsHistorie() { return ewFetch(ew('/ehrungen/historie')); }
  async function speichernEhrung(id, e) { return ewFetch(ew(`/ehrungen/${encodeURIComponent(id)}`), { method: 'PUT', body: e }); }
  async function jubilaeumslaufJetzt() { return ewFetch(ew('/jubilaeumslauf'), { method: 'POST' }); }
  async function abgleichGebucht(anzahl) { return ewFetch(ew('/abgleich'), { method: 'POST', body: { anzahl } }); }

  async function listDocNotes(id) { return jsonFetch(`/api/dokumente/${encodeURIComponent(id)}/notes`); }
  async function addDocNote(id, note) { return jsonFetch(`/api/dokumente/${encodeURIComponent(id)}/notes`, { method: 'POST', body: { note } }); }
  async function deleteDocNote(id, noteId) { return jsonFetch(`/api/dokumente/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' }); }

  // --- WebSocket ---
  function connectWs() {
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      wsBackoff = 1000;
      notify({ type: 'ws:open' });
    };
    ws.onclose = () => {
      notify({ type: 'ws:close' });
      scheduleReconnect();
    };
    ws.onerror = () => { /* close folgt */ };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        notify(msg);
      } catch (_) {}
    };
  }
  function scheduleReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      wsBackoff = Math.min(wsBackoff * 2, 15000);
      connectWs();
    }, wsBackoff);
  }
  function subscribe(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function notify(msg) { for (const fn of listeners) { try { fn(msg); } catch (_) {} } }

  GR.api = {
    health, snapshot,
    putSitzung, deleteSitzungRemote,
    listPersonen, putPerson, deletePersonRemote, personenMigration,
    putMitglied, deleteMitgliedRemote,
    putSettings,
    listAttachments, uploadAttachment, deleteAttachment, attachmentUrl,
    importAll,
    docHealth, docMeta, searchDocuments, getDocument, patchDocument, docFileUrl,
    uploadDocument, scanDocument, scanPageUrl, discardScan, commitScan, getDocTask, createCorrespondent, createDocumentType, createTag,
    getDocConfig, putDocConfig,
    getCalConfig, putCalConfig, testCalUrl, listCalEvents,
    getMailConfig, putMailConfig, testMail, listMails, getMail, mailAttachmentUrl, markMailSeen, sendMail,
    getTaskConfig, putTaskConfig, taskHealth, listOpenTasks, listTaskProjects, completeTask, createTask,
    getInventarConfig, putInventarConfig, inventarHealth, listInventarSammlungen, inventarStammdaten,
    suchenInventar, getInventarArtikel, inventarBeiBarcode, anlegenInventarArtikel,
    speichernInventarArtikel, loeschenInventarArtikel, buchenInventarBestand,
    listInventarWartungen, listOffeneWartungen, anlegenWartung, speichernWartung, loeschenWartung,
    wartungslaufJetzt,
    einwohnerStatus, einwohnerAnmelden, einwohnerAbmelden, einwohnerPin,
    getEinwohnerConfig, putEinwohnerConfig, einwohnerTabellen, einwohnerHealth,
    listEinwohner, getEinwohner, anlegenEinwohner, speichernEinwohner, loeschenEinwohner,
    listEhrungen, listEhrungsHistorie, speichernEhrung, jubilaeumslaufJetzt, abgleichGebucht,
    getTask, updateTask, listTaskLabels, addTaskLabel, removeTaskLabel,
    listDocNotes, addDocNote, deleteDocNote,
    putMieter, deleteMieterRemote,
    putRaum, deleteRaumRemote,
    putVermietung, deleteVermietungRemote,
    listVermietungFotos, uploadVermietungFoto, deleteVermietungFoto, vermietungFotoUrl,
    putEmpfaenger, deleteEmpfaengerRemote,
    putHaushaltsstelle, deleteHaushaltsstelleRemote,
    putAuslage, deleteAuslageRemote,
    listBelege, uploadBeleg, deleteBelegFile, belegUrl,
    listScanners, scanHealth, scan,
    putVertragspartner, deleteVertragspartnerRemote,
    putVertrag, deleteVertragRemote,
    putVorgang, deleteVorgangRemote,
    listVorgangFotos, uploadVorgangFoto, deleteVorgangFoto, vorgangFotoUrl,
    putArbeiter, deleteArbeiterRemote,
    putArbeitszeit, deleteArbeitszeitRemote,
    putArbeitsabrechnung, deleteArbeitsabrechnungRemote,
    connectWs, subscribe,
    clientId: CLIENT_ID,
  };
})();
