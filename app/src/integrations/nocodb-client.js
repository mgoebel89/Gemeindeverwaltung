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

  async function testConnection() {
    const tables = await listTables();
    // Cache IDs der beiden Zieltabellen, falls bereits vorhanden
    const s = store.getSettings();
    let updated = false;
    const findId = name => {
      const t = tables.find(t => (t.title || t.table_name) === name);
      return t ? (t.id || t.table_id) : '';
    };
    const sitzId = findId(s.nocodb.tableSitzungenName);
    const beschId = findId(s.nocodb.tableBeschluesseName);
    if (sitzId && sitzId !== s.nocodb.tableSitzungenId) { s.nocodb.tableSitzungenId = sitzId; updated = true; }
    if (beschId && beschId !== s.nocodb.tableBeschluesseId) { s.nocodb.tableBeschluesseId = beschId; updated = true; }
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
    { title: 'BeginnOeffentlich', uidt: 'SingleLineText' },
    { title: 'EndeOeffentlich', uidt: 'SingleLineText' },
    { title: 'BeginnNichtOeffentlich', uidt: 'SingleLineText' },
    { title: 'EndeSitzung', uidt: 'SingleLineText' },
    { title: 'Anwesende', uidt: 'LongText' },
    { title: 'Entschuldigt', uidt: 'LongText' },
    { title: 'Gaeste', uidt: 'LongText' },
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

  async function createTable(title, columns) {
    const s = settings();
    const body = { table_name: title, title, columns };
    return api(`/api/v2/meta/bases/${encodeURIComponent(s.baseId)}/tables`, { method: 'POST', body });
  }

  async function initSchema() {
    const tables = await listTables();
    const s = store.getSettings();
    const log = [];
    const sitzExists = tables.find(t => (t.title || t.table_name) === s.nocodb.tableSitzungenName);
    if (!sitzExists) {
      const created = await createTable(s.nocodb.tableSitzungenName, SITZUNGEN_COLUMNS);
      s.nocodb.tableSitzungenId = created.id || created.table_id || '';
      log.push(`Tabelle „${s.nocodb.tableSitzungenName}" angelegt.`);
    } else {
      s.nocodb.tableSitzungenId = sitzExists.id || sitzExists.table_id || s.nocodb.tableSitzungenId;
      log.push(`Tabelle „${s.nocodb.tableSitzungenName}" existiert bereits.`);
    }
    const beschExists = tables.find(t => (t.title || t.table_name) === s.nocodb.tableBeschluesseName);
    if (!beschExists) {
      const created = await createTable(s.nocodb.tableBeschluesseName, BESCHLUESSE_COLUMNS);
      s.nocodb.tableBeschluesseId = created.id || created.table_id || '';
      log.push(`Tabelle „${s.nocodb.tableBeschluesseName}" angelegt.`);
    } else {
      s.nocodb.tableBeschluesseId = beschExists.id || beschExists.table_id || s.nocodb.tableBeschluesseId;
      log.push(`Tabelle „${s.nocodb.tableBeschluesseName}" existiert bereits.`);
    }
    store.saveSettings(s);
    return log;
  }

  // --- Records (Upsert über externe UUID) ---
  async function findByExternalId(tableId, field, value) {
    const where = `(${field},eq,${value})`;
    const data = await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records?where=${encodeURIComponent(where)}&limit=1`);
    const list = data.list || data.records || data || [];
    return list[0] || null;
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

  function buildSitzungRow(sitzung) {
    const mitglieder = store.listMitglieder();
    const nameOf = id => fullName(mitglieder.find(m => m.id === id) || null);
    return {
      SitzungId: sitzung.id,
      Datum: sitzung.datum,
      Ort: sitzung.ort,
      Sitzungsleitung: nameOf(sitzung.sitzungsleitungId),
      Schriftfuehrer: nameOf(sitzung.schriftfuehrerId),
      BeginnOeffentlich: sitzung.beginnOeffentlich,
      EndeOeffentlich: sitzung.endeOeffentlich,
      BeginnNichtOeffentlich: sitzung.beginnNichtOeffentlich,
      EndeSitzung: sitzung.endeSitzung,
      Anwesende: (sitzung.anwesendIds || []).map(nameOf).filter(Boolean).join('; '),
      Abwesend: mitglieder.filter(m => m.aktiv && !(sitzung.anwesendIds || []).includes(m.id)).map(m => fullName(m)).join('; '),
      Gaeste: sitzung.gaeste || '',
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

  async function syncSitzungComplete(sitzung) {
    const s = store.getSettings().nocodb;
    if (!s.tableSitzungenId || !s.tableBeschluesseId) {
      // Versuch, IDs aus den vorhandenen Tabellen zu ziehen.
      await testConnection();
      const fresh = store.getSettings().nocodb;
      if (!fresh.tableSitzungenId || !fresh.tableBeschluesseId) {
        throw new Error('Zieltabellen unbekannt. Bitte zuerst „Schema initialisieren" oder „Verbindung testen".');
      }
    }
    const sNow = store.getSettings().nocodb;
    await upsertRecord(sNow.tableSitzungenId, 'SitzungId', buildSitzungRow(sitzung));
    for (const top of sitzung.tops) {
      await upsertRecord(sNow.tableBeschluesseId, 'BeschlussId', buildBeschlussRow(sitzung, top));
    }
    return { sitzungen: 1, beschluesse: sitzung.tops.length };
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
        store.removeFromQueue(item.id);
        ok++;
      } catch (e) {
        store.markQueueError(item.id, e.message);
        errors.push(`${sitzung.datum}: ${e.message}`);
        fail++;
      }
    }
    return { ok, fail, errors };
  }

  GR.nocodb_client = {
    testConnection,
    initSchema,
    syncSitzungComplete,
    syncQueue,
  };
})();
