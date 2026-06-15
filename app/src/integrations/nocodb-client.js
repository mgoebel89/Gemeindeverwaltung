(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { ergebnisAbstimmung, fullName } = GR.models;

  // --- HTTP-Helfer ---
  function settings() {
    const s = store.getSettings().nocodb;
    if (!s || !s.serverUrl || !s.token || !s.baseId) {
      throw new Error('NocoDB-Verbindung unvollständig konfiguriert (Server-URL, Token, Base-ID).');
    }
    return s;
  }

  function isConfigured() {
    const s = store.getSettings().nocodb;
    return !!(s && s.serverUrl && s.token && s.baseId);
  }

  function baseUrl() {
    return settings().serverUrl.replace(/\/$/, '');
  }

  async function api(path, opts = {}) {
    const s = settings();
    const url = baseUrl() + path;
    let res;
    try {
      res = await fetch(url, {
        method: opts.method || 'GET',
        headers: {
          'xc-token': s.token,
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new Error('Netzwerkfehler / CORS-blockiert (NC_CORS_ORIGIN=* setzen?): ' + e.message);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`NocoDB ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const ctype = res.headers.get('Content-Type') || '';
    if (ctype.includes('application/json')) return res.json();
    return res.text();
  }

  // --- Tabellen-Discovery ---
  async function listTables() {
    const s = settings();
    const data = await api(`/api/v2/meta/bases/${encodeURIComponent(s.baseId)}/tables`);
    return data.list || data || [];
  }

  async function getTableMeta(tableId) {
    return api(`/api/v2/meta/tables/${encodeURIComponent(tableId)}`);
  }

  async function testConnection() {
    const tables = await listTables();
    const s = store.getSettings();
    let updated = false;
    const findId = name => {
      const t = tables.find(t => (t.title || t.table_name) === name);
      return t ? (t.id || t.table_id) : '';
    };
    const sitzId = findId(s.nocodb.tableSitzungenName);
    const beschId = findId(s.nocodb.tableBeschluesseName);
    const mitgId = findId(s.nocodb.tableMitgliederName);
    if (sitzId && sitzId !== s.nocodb.tableSitzungenId) { s.nocodb.tableSitzungenId = sitzId; updated = true; }
    if (beschId && beschId !== s.nocodb.tableBeschluesseId) { s.nocodb.tableBeschluesseId = beschId; updated = true; }
    if (mitgId && mitgId !== s.nocodb.tableMitgliederId) { s.nocodb.tableMitgliederId = mitgId; updated = true; }
    if (updated) store.saveSettings(s);
    return { tables, count: tables.length };
  }

  // --- Schema-Init ---
  const SITZUNGEN_COLUMNS = [
    { title: 'SitzungId', uidt: 'SingleLineText' },
    { title: 'Datum', uidt: 'Date' },
    { title: 'Ort', uidt: 'SingleLineText' },
    { title: 'Sitzungsleitung', uidt: 'SingleLineText' },
    { title: 'Schriftfuehrer', uidt: 'SingleLineText' },
    { title: 'Status', uidt: 'SingleLineText' },
    { title: 'BeginnOeffentlich', uidt: 'SingleLineText' },
    { title: 'EndeOeffentlich', uidt: 'SingleLineText' },
    { title: 'BeginnNichtOeffentlich', uidt: 'SingleLineText' },
    { title: 'EndeSitzung', uidt: 'SingleLineText' },
    { title: 'Anwesende', uidt: 'LongText' },
    { title: 'Abwesend', uidt: 'LongText' },
    { title: 'Gaeste', uidt: 'LongText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const BESCHLUESSE_COLUMNS = [
    { title: 'BeschlussId', uidt: 'SingleLineText' },
    { title: 'SitzungId', uidt: 'SingleLineText' },
    { title: 'Bereich', uidt: 'SingleLineText' },
    { title: 'TopNr', uidt: 'Number' },
    { title: 'Titel', uidt: 'SingleLineText' },
    { title: 'Beschlussvorlage', uidt: 'LongText' },
    { title: 'Ja', uidt: 'Number' },
    { title: 'Nein', uidt: 'Number' },
    { title: 'Enthaltung', uidt: 'Number' },
    { title: 'Ergebnis', uidt: 'SingleLineText' },
    { title: 'Befangenheit', uidt: 'LongText' },
    { title: 'Bemerkungen', uidt: 'LongText' },
  ];
  const MITGLIEDER_COLUMNS = [
    { title: 'MitgliedId', uidt: 'SingleLineText' },
    { title: 'Vorname', uidt: 'SingleLineText' },
    { title: 'Nachname', uidt: 'SingleLineText' },
    { title: 'Funktion', uidt: 'SingleLineText' },
    { title: 'Aktiv', uidt: 'Checkbox' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
  ];

  async function createTable(title, columns) {
    const s = settings();
    const body = { table_name: title, title, columns };
    return api(`/api/v2/meta/bases/${encodeURIComponent(s.baseId)}/tables`, { method: 'POST', body });
  }

  async function addColumn(tableId, col) {
    return api(`/api/v2/meta/tables/${encodeURIComponent(tableId)}/columns`, { method: 'POST', body: col });
  }

  async function ensureColumns(tableId, expectedCols, log) {
    let meta;
    try { meta = await getTableMeta(tableId); } catch (e) { return; }
    const existing = new Set((meta.columns || []).map(c => c.title || c.column_name));
    for (const col of expectedCols) {
      if (!existing.has(col.title)) {
        try {
          await addColumn(tableId, col);
          log && log.push(`Spalte „${col.title}" ergänzt.`);
        } catch (e) {
          log && log.push(`Spalte „${col.title}" konnte nicht angelegt werden: ${e.message}`);
        }
      }
    }
  }

  async function initSchema() {
    const tables = await listTables();
    const s = store.getSettings();
    const log = [];

    async function ensureTable(name, columns, idField) {
      const exists = tables.find(t => (t.title || t.table_name) === name);
      if (!exists) {
        const created = await createTable(name, columns);
        s.nocodb[idField] = created.id || created.table_id || '';
        log.push(`Tabelle „${name}" angelegt.`);
      } else {
        s.nocodb[idField] = exists.id || exists.table_id || s.nocodb[idField];
        log.push(`Tabelle „${name}" existiert bereits.`);
        await ensureColumns(s.nocodb[idField], columns, log);
      }
    }

    await ensureTable(s.nocodb.tableSitzungenName, SITZUNGEN_COLUMNS, 'tableSitzungenId');
    await ensureTable(s.nocodb.tableBeschluesseName, BESCHLUESSE_COLUMNS, 'tableBeschluesseId');
    await ensureTable(s.nocodb.tableMitgliederName, MITGLIEDER_COLUMNS, 'tableMitgliederId');

    store.saveSettings(s);
    return log;
  }

  // --- Records ---
  async function findByExternalId(tableId, field, value) {
    const where = `(${field},eq,${value})`;
    const data = await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records?where=${encodeURIComponent(where)}&limit=1`);
    const list = data.list || data.records || data || [];
    return list[0] || null;
  }

  async function fetchAllRecords(tableId) {
    const out = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const data = await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records?limit=${limit}&offset=${offset}`);
      const list = data.list || data.records || [];
      out.push(...list);
      const info = data.pageInfo || data.page_info || {};
      if (list.length < limit || info.isLastPage) break;
      offset += limit;
      if (offset > 50000) break;
    }
    return out;
  }

  async function upsertRecord(tableId, externalIdField, row) {
    const existing = await findByExternalId(tableId, externalIdField, row[externalIdField]);
    if (existing) {
      const internalId = existing.Id || existing.id;
      await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records`, {
        method: 'PATCH',
        body: [{ Id: internalId, ...row }],
      });
      return 'updated';
    }
    await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records`, {
      method: 'POST',
      body: [row],
    });
    return 'created';
  }

  // --- Row-Builder ---
  function buildSitzungRow(sitzung) {
    const mitglieder = store.listMitglieder();
    const nameOf = id => fullName(mitglieder.find(m => m.id === id) || null);
    return {
      SitzungId: sitzung.id,
      Datum: sitzung.datum,
      Ort: sitzung.ort,
      Sitzungsleitung: nameOf(sitzung.sitzungsleitungId),
      Schriftfuehrer: nameOf(sitzung.schriftfuehrerId),
      Status: sitzung.status || '',
      BeginnOeffentlich: sitzung.beginnOeffentlich,
      EndeOeffentlich: sitzung.endeOeffentlich,
      BeginnNichtOeffentlich: sitzung.beginnNichtOeffentlich,
      EndeSitzung: sitzung.endeSitzung,
      Anwesende: (sitzung.anwesendIds || []).map(nameOf).filter(Boolean).join('; '),
      Abwesend: mitglieder.filter(m => m.aktiv && !(sitzung.anwesendIds || []).includes(m.id)).map(m => fullName(m)).join('; '),
      Gaeste: sitzung.gaeste || '',
      LastModifiedAt: sitzung.lastModifiedAt || '',
      Payload: JSON.stringify(sitzung),
    };
  }

  function buildBeschlussRow(sitzung, top) {
    const a = top.abstimmung || {};
    return {
      BeschlussId: top.id,
      SitzungId: sitzung.id,
      Bereich: top.bereich === 'oeffentlich' ? 'öffentlich' : 'nicht-öffentlich',
      TopNr: top.nummer,
      Titel: top.titel || '',
      Beschlussvorlage: top.beschlussvorlage || '',
      Ja: a.durchgefuehrt ? (a.ja || 0) : null,
      Nein: a.durchgefuehrt ? (a.nein || 0) : null,
      Enthaltung: a.durchgefuehrt ? (a.enthaltung || 0) : null,
      Ergebnis: ergebnisAbstimmung(a),
      Befangenheit: top.befangenheitsText || '',
      Bemerkungen: top.bemerkungen || '',
    };
  }

  function buildMitgliedRow(m) {
    return {
      MitgliedId: m.id,
      Vorname: m.vorname || '',
      Nachname: m.nachname || '',
      Funktion: m.funktion || '',
      Aktiv: !!m.aktiv,
      LastModifiedAt: m.lastModifiedAt || '',
    };
  }

  async function ensureTableIds() {
    const s = store.getSettings().nocodb;
    if (!s.tableSitzungenId || !s.tableBeschluesseId || !s.tableMitgliederId) {
      await testConnection();
    }
    const fresh = store.getSettings().nocodb;
    if (!fresh.tableSitzungenId || !fresh.tableBeschluesseId) {
      throw new Error('Zieltabellen unbekannt. Bitte zuerst „Schema initialisieren" oder „Verbindung testen".');
    }
    return fresh;
  }

  async function syncSitzungComplete(sitzung) {
    const cfg = await ensureTableIds();
    await upsertRecord(cfg.tableSitzungenId, 'SitzungId', buildSitzungRow(sitzung));
    for (const top of sitzung.tops) {
      await upsertRecord(cfg.tableBeschluesseId, 'BeschlussId', buildBeschlussRow(sitzung, top));
    }
    return { sitzungen: 1, beschluesse: sitzung.tops.length };
  }

  async function syncMitglied(mitglied) {
    const cfg = await ensureTableIds();
    if (!cfg.tableMitgliederId) {
      throw new Error('Tabelle „Mitglieder" fehlt. Bitte „Schema initialisieren" ausführen.');
    }
    await upsertRecord(cfg.tableMitgliederId, 'MitgliedId', buildMitgliedRow(mitglied));
    return { mitglieder: 1 };
  }

  async function syncQueue() {
    const queue = store.listQueue();
    let ok = 0, fail = 0;
    const errors = [];
    for (const item of queue) {
      const sitzung = store.getSitzung(item.sitzungId);
      if (!sitzung) {
        store.removeFromQueue(item.id);
        continue;
      }
      try {
        await syncSitzungComplete(sitzung);
        store.markSynced('sitzungen', sitzung.id);
        store.removeFromQueue(item.id);
        ok++;
      } catch (e) {
        store.markQueueError(item.id, e.message);
        store.markSyncError('sitzungen', sitzung.id, e.message);
        errors.push(`${sitzung.datum}: ${e.message}`);
        fail++;
      }
    }
    return { ok, fail, errors };
  }

  // --- Restore (alle Sitzungen + Mitglieder aus NocoDB ziehen) ---
  async function fetchAllFromNocoDb() {
    const cfg = await ensureTableIds();
    const sitzRows = await fetchAllRecords(cfg.tableSitzungenId);
    const sitzungen = [];
    for (const r of sitzRows) {
      if (!r.Payload) continue;
      try {
        const parsed = JSON.parse(r.Payload);
        if (parsed && parsed.id) sitzungen.push(parsed);
      } catch (e) { /* ignore broken payload */ }
    }
    const mitglieder = [];
    if (cfg.tableMitgliederId) {
      const mRows = await fetchAllRecords(cfg.tableMitgliederId);
      for (const r of mRows) {
        if (!r.MitgliedId) continue;
        mitglieder.push({
          id: r.MitgliedId,
          vorname: r.Vorname || '',
          nachname: r.Nachname || '',
          funktion: r.Funktion || 'Ratsmitglied',
          aktiv: r.Aktiv === true || r.Aktiv === 1 || r.Aktiv === 'true',
          lastModifiedAt: r.LastModifiedAt || '',
        });
      }
    }
    return { sitzungen, mitglieder };
  }

  // Merge per ID, lokaler Stand gewinnt bei Konflikt
  function restoreLocalWins(remote) {
    const localSitzungen = store.listSitzungen();
    const localIds = new Set(localSitzungen.map(s => s.id));
    let addedS = 0;
    for (const r of remote.sitzungen) {
      if (!localIds.has(r.id)) {
        store.saveSitzung(r);
        store.markSynced('sitzungen', r.id);
        addedS++;
      }
    }
    const localMitglieder = store.listMitglieder();
    const localMIds = new Set(localMitglieder.map(m => m.id));
    let addedM = 0;
    for (const r of remote.mitglieder) {
      if (!localMIds.has(r.id)) {
        store.saveMitglied(r);
        store.markSynced('mitglieder', r.id);
        addedM++;
      }
    }
    return { sitzungenHinzugefuegt: addedS, mitgliederHinzugefuegt: addedM };
  }

  async function restoreFromNocoDb() {
    const remote = await fetchAllFromNocoDb();
    return restoreLocalWins(remote);
  }

  GR.nocodb_client = {
    testConnection,
    initSchema,
    syncSitzungComplete,
    syncMitglied,
    syncQueue,
    restoreFromNocoDb,
    isConfigured,
  };
})();
