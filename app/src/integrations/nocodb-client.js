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
    const resolve = (nameKey, idKey) => {
      const id = findId(s.nocodb[nameKey]);
      if (id && id !== s.nocodb[idKey]) { s.nocodb[idKey] = id; updated = true; }
    };
    resolve('tableSitzungenName', 'tableSitzungenId');
    resolve('tableBeschluesseName', 'tableBeschluesseId');
    resolve('tableMitgliederName', 'tableMitgliederId');
    resolve('tableMieterName', 'tableMieterId');
    resolve('tableRaeumeName', 'tableRaeumeId');
    resolve('tableVermietungenName', 'tableVermietungenId');
    resolve('tableEmpfaengerName', 'tableEmpfaengerId');
    resolve('tableHaushaltsstellenName', 'tableHaushaltsstellenId');
    resolve('tableAuslagenName', 'tableAuslagenId');
    resolve('tableVertragspartnerName', 'tableVertragspartnerId');
    resolve('tableVertraegeName', 'tableVertraegeId');
    resolve('tableVorgaengeName', 'tableVorgaengeId');
    resolve('tableArbeiterName', 'tableArbeiterId');
    resolve('tableArbeitszeitenName', 'tableArbeitszeitenId');
    resolve('tableArbeitsabrechnungenName', 'tableArbeitsabrechnungenId');
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
  const MIETER_COLUMNS = [
    { title: 'MieterId', uidt: 'SingleLineText' },
    { title: 'Vorname', uidt: 'SingleLineText' },
    { title: 'Nachname', uidt: 'SingleLineText' },
    { title: 'Anschrift', uidt: 'SingleLineText' },
    { title: 'Telefon', uidt: 'SingleLineText' },
    { title: 'Email', uidt: 'SingleLineText' },
    { title: 'Ortsfremd', uidt: 'Checkbox' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const RAEUME_COLUMNS = [
    { title: 'RaumId', uidt: 'SingleLineText' },
    { title: 'Name', uidt: 'SingleLineText' },
    { title: 'Aktiv', uidt: 'Checkbox' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const VERMIETUNGEN_COLUMNS = [
    { title: 'VermietungId', uidt: 'SingleLineText' },
    { title: 'Objekt', uidt: 'SingleLineText' },
    { title: 'Mieter', uidt: 'SingleLineText' },
    { title: 'Anlass', uidt: 'SingleLineText' },
    { title: 'StartDatum', uidt: 'Date' },
    { title: 'EndDatum', uidt: 'Date' },
    { title: 'Status', uidt: 'SingleLineText' },
    { title: 'Ortsfremd', uidt: 'Checkbox' },
    { title: 'Grundmiete', uidt: 'Number' },
    { title: 'Gesamtbetrag', uidt: 'Number' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const EMPFAENGER_COLUMNS = [
    { title: 'EmpfaengerId', uidt: 'SingleLineText' },
    { title: 'Name', uidt: 'SingleLineText' },
    { title: 'Vorname', uidt: 'SingleLineText' },
    { title: 'IBAN', uidt: 'SingleLineText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const HAUSHALTSSTELLEN_COLUMNS = [
    { title: 'HaushaltsstelleId', uidt: 'SingleLineText' },
    { title: 'Nummer', uidt: 'SingleLineText' },
    { title: 'Bezeichnung', uidt: 'SingleLineText' },
    { title: 'Budget', uidt: 'Number' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const AUSLAGEN_COLUMNS = [
    { title: 'AuslageId', uidt: 'SingleLineText' },
    { title: 'Haushaltsjahr', uidt: 'Number' },
    { title: 'Haushaltsstelle', uidt: 'SingleLineText' },
    { title: 'Empfaenger', uidt: 'SingleLineText' },
    { title: 'Verwendungszweck', uidt: 'LongText' },
    { title: 'Datum', uidt: 'Date' },
    { title: 'Gesamtbetrag', uidt: 'Number' },
    { title: 'AnzahlBelege', uidt: 'Number' },
    { title: 'Status', uidt: 'SingleLineText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];

  const VERTRAGSPARTNER_COLUMNS = [
    { title: 'PartnerId', uidt: 'SingleLineText' },
    { title: 'Name', uidt: 'SingleLineText' },
    { title: 'Ansprechpartner', uidt: 'SingleLineText' },
    { title: 'Telefon', uidt: 'SingleLineText' },
    { title: 'Email', uidt: 'SingleLineText' },
    { title: 'Anschrift', uidt: 'LongText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const VERTRAEGE_COLUMNS = [
    { title: 'VertragId', uidt: 'SingleLineText' },
    { title: 'Bezeichnung', uidt: 'SingleLineText' },
    { title: 'Kategorie', uidt: 'SingleLineText' },
    { title: 'Richtung', uidt: 'SingleLineText' },
    { title: 'Partner', uidt: 'SingleLineText' },
    { title: 'Betrag', uidt: 'Number' },
    { title: 'Intervall', uidt: 'SingleLineText' },
    { title: 'Jahresbetrag', uidt: 'Number' },
    { title: 'Beginn', uidt: 'Date' },
    { title: 'Ende', uidt: 'Date' },
    { title: 'KuendigungBis', uidt: 'Date' },
    { title: 'KuendigungsfristMonate', uidt: 'Number' },
    { title: 'Status', uidt: 'SingleLineText' },
    { title: 'AnzahlDokumente', uidt: 'Number' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  // Vorgänge & Projekte: Spalten passend zu buildVorgangRow. (Fehlten bisher —
  // dadurch schlug der Sync mit „Tabelle Vorgaenge fehlt" fehl.)
  const VORGAENGE_COLUMNS = [
    { title: 'VorgangId', uidt: 'SingleLineText' },
    { title: 'Titel', uidt: 'SingleLineText' },
    { title: 'Status', uidt: 'SingleLineText' },
    { title: 'Kategorie', uidt: 'SingleLineText' },
    { title: 'Vertraulich', uidt: 'SingleLineText' },
    { title: 'Haushaltsjahr', uidt: 'Number' },
    { title: 'Kostenstellen', uidt: 'LongText' },
    { title: 'KostenIst', uidt: 'Number' },
    { title: 'PlanBetrag', uidt: 'Number' },
    { title: 'PlanZieljahr', uidt: 'SingleLineText' },
    { title: 'AnzahlHistorie', uidt: 'Number' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  // Modul Arbeitszeiten & Vergütung
  const ARBEITER_COLUMNS = [
    { title: 'ArbeiterId', uidt: 'SingleLineText' },
    { title: 'Anzeigename', uidt: 'SingleLineText' },
    { title: 'Firma', uidt: 'SingleLineText' },
    { title: 'Vorname', uidt: 'SingleLineText' },
    { title: 'Nachname', uidt: 'SingleLineText' },
    { title: 'Strasse', uidt: 'SingleLineText' },
    { title: 'Plz', uidt: 'SingleLineText' },
    { title: 'Ort', uidt: 'SingleLineText' },
    { title: 'Iban', uidt: 'SingleLineText' },
    { title: 'Kontoinhaber', uidt: 'SingleLineText' },
    { title: 'SvNummer', uidt: 'SingleLineText' },
    { title: 'SteuerId', uidt: 'SingleLineText' },
    { title: 'Geburtsdatum', uidt: 'SingleLineText' },
    { title: 'Telefon', uidt: 'SingleLineText' },
    { title: 'Email', uidt: 'SingleLineText' },
    { title: 'Aktiv', uidt: 'SingleLineText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const ARBEITSZEITEN_COLUMNS = [
    { title: 'ArbeitszeitId', uidt: 'SingleLineText' },
    { title: 'Arbeiter', uidt: 'SingleLineText' },
    { title: 'Datum', uidt: 'Date' },
    { title: 'Taetigkeit', uidt: 'SingleLineText' },
    { title: 'Stunden', uidt: 'Number' },
    { title: 'Satz', uidt: 'Number' },
    { title: 'Betrag', uidt: 'Number' },
    { title: 'Status', uidt: 'SingleLineText' },
    { title: 'AbrechnungId', uidt: 'SingleLineText' },
    { title: 'Notiz', uidt: 'LongText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];
  const ARBEITSABRECHNUNGEN_COLUMNS = [
    { title: 'AbrechnungId', uidt: 'SingleLineText' },
    { title: 'Arbeiter', uidt: 'SingleLineText' },
    { title: 'ZeitraumVon', uidt: 'Date' },
    { title: 'ZeitraumBis', uidt: 'Date' },
    { title: 'ErstelltAm', uidt: 'Date' },
    { title: 'Haushaltsstelle', uidt: 'SingleLineText' },
    { title: 'Haushaltsjahr', uidt: 'Number' },
    { title: 'SummeStunden', uidt: 'Number' },
    { title: 'SummeBetrag', uidt: 'Number' },
    { title: 'AnzahlPositionen', uidt: 'Number' },
    { title: 'Status', uidt: 'SingleLineText' },
    { title: 'AusgezahltAm', uidt: 'SingleLineText' },
    { title: 'Notiz', uidt: 'LongText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
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
    await ensureTable(s.nocodb.tableMieterName || 'Mieter', MIETER_COLUMNS, 'tableMieterId');
    await ensureTable(s.nocodb.tableRaeumeName || 'Raeume', RAEUME_COLUMNS, 'tableRaeumeId');
    await ensureTable(s.nocodb.tableVermietungenName || 'Vermietungen', VERMIETUNGEN_COLUMNS, 'tableVermietungenId');
    await ensureTable(s.nocodb.tableEmpfaengerName || 'Empfaenger', EMPFAENGER_COLUMNS, 'tableEmpfaengerId');
    await ensureTable(s.nocodb.tableHaushaltsstellenName || 'Haushaltsstellen', HAUSHALTSSTELLEN_COLUMNS, 'tableHaushaltsstellenId');
    await ensureTable(s.nocodb.tableAuslagenName || 'Auslagen', AUSLAGEN_COLUMNS, 'tableAuslagenId');
    await ensureTable(s.nocodb.tableVertragspartnerName || 'Vertragspartner', VERTRAGSPARTNER_COLUMNS, 'tableVertragspartnerId');
    await ensureTable(s.nocodb.tableVertraegeName || 'Vertraege', VERTRAEGE_COLUMNS, 'tableVertraegeId');
    await ensureTable(s.nocodb.tableVorgaengeName || 'Vorgaenge', VORGAENGE_COLUMNS, 'tableVorgaengeId');
    await ensureTable(s.nocodb.tableArbeiterName || 'Arbeiter', ARBEITER_COLUMNS, 'tableArbeiterId');
    await ensureTable(s.nocodb.tableArbeitszeitenName || 'Arbeitszeiten', ARBEITSZEITEN_COLUMNS, 'tableArbeitszeitenId');
    await ensureTable(s.nocodb.tableArbeitsabrechnungenName || 'Arbeitsabrechnungen', ARBEITSABRECHNUNGEN_COLUMNS, 'tableArbeitsabrechnungenId');

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

  // --- Vermietungs-Modul: Row-Builder + Sync ---
  let lastSchemaHealAt = 0;
  async function ensureTableId(idKey, nameLabel) {
    let cfg = store.getSettings().nocodb;
    if (!cfg[idKey]) { await testConnection(); cfg = store.getSettings().nocodb; }
    // Selbstheilung: fehlt die Tabelle noch (z. B. nach dem Update, das die
    // Vermietungs-Tabellen neu eingeführt hat), automatisch anlegen. Höchstens
    // alle 30 s, damit ein Sync-Durchlauf initSchema nicht mehrfach anstößt und
    // transiente Fehler später erneut versucht werden.
    if (!cfg[idKey] && Date.now() - lastSchemaHealAt > 30000) {
      lastSchemaHealAt = Date.now();
      try { await initSchema(); } catch (e) { /* Fehler wird unten ausgewertet */ }
      cfg = store.getSettings().nocodb;
    }
    if (!cfg[idKey]) throw new Error(`Tabelle „${nameLabel}" fehlt. Bitte in den Einstellungen „Schema initialisieren" ausführen.`);
    return cfg[idKey];
  }

  function mieterAnschrift(m) {
    return [m.strasse, [m.plz, m.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
  function buildMieterRow(m) {
    return {
      MieterId: m.id,
      Vorname: m.vorname || '', Nachname: m.nachname || '',
      Anschrift: mieterAnschrift(m), Telefon: m.telefon || '', Email: m.email || '',
      Ortsfremd: !!m.ortsfremd, LastModifiedAt: m.lastModifiedAt || '', Payload: JSON.stringify(m),
    };
  }
  function buildRaumRow(r) {
    return {
      RaumId: r.id, Name: r.name || '', Aktiv: !!r.aktiv,
      LastModifiedAt: r.lastModifiedAt || '', Payload: JSON.stringify(r),
    };
  }
  function buildVermietungRow(v) {
    const raum = store.getRaum(v.raumId);
    const mieter = store.getMieter(v.mieterId);
    const g = GR.models.berechneGesamt(v, raum);
    return {
      VermietungId: v.id,
      Objekt: raum ? raum.name : '',
      Mieter: mieter ? GR.models.fullNameMieter(mieter) : '',
      Anlass: v.anlass || '',
      StartDatum: v.startDatum || null,
      EndDatum: v.endDatum || null,
      Status: v.status || '',
      Ortsfremd: !!v.ortsfremd,
      Grundmiete: g.grundMiete,
      Gesamtbetrag: g.gesamt,
      LastModifiedAt: v.lastModifiedAt || '',
      Payload: JSON.stringify(v),
    };
  }
  async function syncMieter(m) {
    await upsertRecord(await ensureTableId('tableMieterId', 'Mieter'), 'MieterId', buildMieterRow(m));
    return { mieter: 1 };
  }
  async function syncRaum(r) {
    await upsertRecord(await ensureTableId('tableRaeumeId', 'Raeume'), 'RaumId', buildRaumRow(r));
    return { raeume: 1 };
  }
  async function syncVermietung(v) {
    await upsertRecord(await ensureTableId('tableVermietungenId', 'Vermietungen'), 'VermietungId', buildVermietungRow(v));
    return { vermietungen: 1 };
  }

  // --- Bargeldauslagen-Modul: Row-Builder + Sync ---
  function buildEmpfaengerRow(e) {
    return {
      EmpfaengerId: e.id, Name: e.name || '', Vorname: e.vorname || '', IBAN: e.iban || '',
      LastModifiedAt: e.lastModifiedAt || '', Payload: JSON.stringify(e),
    };
  }
  function buildHaushaltsstelleRow(h) {
    return {
      HaushaltsstelleId: h.id, Nummer: h.nummer || '', Bezeichnung: h.bezeichnung || '',
      Budget: (h.budget === null || h.budget === undefined || h.budget === '') ? null : Number(h.budget),
      LastModifiedAt: h.lastModifiedAt || '', Payload: JSON.stringify(h),
    };
  }
  function buildAuslageRow(a) {
    const emp = store.getEmpfaenger(a.empfaengerId);
    const hs = store.getHaushaltsstelle(a.haushaltsstelleId);
    return {
      AuslageId: a.id,
      Haushaltsjahr: a.haushaltsjahr ? Number(a.haushaltsjahr) : null,
      Haushaltsstelle: hs ? (hs.nummer || '') : '',
      Empfaenger: emp ? GR.models.fullNameEmpfaenger(emp) : '',
      Verwendungszweck: a.verwendungszweck || '',
      Datum: a.datum || null,
      Gesamtbetrag: GR.models.gesamtbetrag(a),
      AnzahlBelege: (a.belege || []).length,
      Status: a.status || 'offen',
      LastModifiedAt: a.lastModifiedAt || '',
      Payload: JSON.stringify(a),
    };
  }
  async function syncEmpfaenger(e) {
    await upsertRecord(await ensureTableId('tableEmpfaengerId', 'Empfaenger'), 'EmpfaengerId', buildEmpfaengerRow(e));
    return { empfaenger: 1 };
  }
  async function syncHaushaltsstelle(h) {
    await upsertRecord(await ensureTableId('tableHaushaltsstellenId', 'Haushaltsstellen'), 'HaushaltsstelleId', buildHaushaltsstelleRow(h));
    return { haushaltsstellen: 1 };
  }
  async function syncAuslage(a) {
    await upsertRecord(await ensureTableId('tableAuslagenId', 'Auslagen'), 'AuslageId', buildAuslageRow(a));
    return { auslagen: 1 };
  }

  // --- Modul Verträge und Pacht: Row-Builder + Sync ---
  function isoDateOrNull(d) { return d ? GR.models.dateToIso(d) : null; }
  function buildVertragspartnerRow(p) {
    return {
      PartnerId: p.id, Name: p.name || '', Ansprechpartner: p.ansprechpartner || '',
      Telefon: p.telefon || '', Email: p.email || '', Anschrift: p.anschrift || '',
      LastModifiedAt: p.lastModifiedAt || '', Payload: JSON.stringify(p),
    };
  }
  function buildVertragRow(v) {
    const partner = store.getVertragspartner(v.partnerId);
    const termin = GR.models.spaetesterKuendigungstermin(v);
    return {
      VertragId: v.id,
      Bezeichnung: v.bezeichnung || '',
      Kategorie: v.kategorie || '',
      Richtung: GR.models.RICHTUNG_LABEL[v.richtung] || v.richtung || '',
      Partner: partner ? partner.name : '',
      Betrag: Number(v.betrag) || 0,
      Intervall: v.intervall || '',
      Jahresbetrag: GR.models.jahresbetrag(v),
      Beginn: v.beginn || null,
      Ende: v.ende || null,
      KuendigungBis: isoDateOrNull(termin),
      KuendigungsfristMonate: Number(v.kuendigungsfristMonate) || 0,
      Status: v.status || '',
      AnzahlDokumente: (v.paperlessDocs || []).length,
      LastModifiedAt: v.lastModifiedAt || '',
      Payload: JSON.stringify(v),
    };
  }
  async function syncVertragspartner(p) {
    await upsertRecord(await ensureTableId('tableVertragspartnerId', 'Vertragspartner'), 'PartnerId', buildVertragspartnerRow(p));
    return { vertragspartner: 1 };
  }
  async function syncVertrag(v) {
    await upsertRecord(await ensureTableId('tableVertraegeId', 'Vertraege'), 'VertragId', buildVertragRow(v));
    return { vertraege: 1 };
  }

  // --- Modul Vorgänge & Projekte ---
  function buildVorgangRow(v) {
    const stellen = (v.haushaltsstellen || []).map(id => {
      const h = store.getHaushaltsstelle(id);
      return h ? ((h.nummer ? h.nummer + ' ' : '') + (h.bezeichnung || '')).trim() : id;
    }).filter(Boolean).join('; ');
    return {
      VorgangId: v.id,
      Titel: v.titel || '',
      Status: GR.models.VORGANG_STATUS_LABEL[v.status] || v.status || '',
      Kategorie: v.kategorie || '',
      Vertraulich: v.vertraulich ? 'ja' : 'nein',
      Haushaltsjahr: v.haushaltsjahr || '',
      Kostenstellen: stellen,
      KostenIst: GR.models.vorgangKosten(v),
      PlanBetrag: (v.planung && v.planung.betrag != null) ? Number(v.planung.betrag) : 0,
      PlanZieljahr: (v.planung && v.planung.zieljahr) || '',
      AnzahlHistorie: (v.historie || []).length,
      LastModifiedAt: v.lastModifiedAt || '',
      Payload: JSON.stringify(v),
    };
  }
  async function syncVorgang(v) {
    await upsertRecord(await ensureTableId('tableVorgaengeId', 'Vorgaenge'), 'VorgangId', buildVorgangRow(v));
    return { vorgaenge: 1 };
  }

  // --- Modul Arbeitszeiten & Vergütung ---
  // Auf Matthias' ausdrücklichen Wunsch werden auch IBAN/SV-Nummer/Steuer-ID
  // mitgesichert – NocoDB ist nur über VPN im isolierten Heimnetz erreichbar.
  function buildArbeiterRow(a) {
    return {
      ArbeiterId: a.id,
      Anzeigename: GR.models.arbeiterName(a),
      Firma: a.firma || '',
      Vorname: a.vorname || '',
      Nachname: a.nachname || '',
      Strasse: a.strasse || '',
      Plz: a.plz || '',
      Ort: a.ort || '',
      Iban: a.iban || '',
      Kontoinhaber: a.kontoinhaber || '',
      SvNummer: a.svNummer || '',
      SteuerId: a.steuerId || '',
      Geburtsdatum: a.geburtsdatum || '',
      Telefon: a.telefon || '',
      Email: a.email || '',
      Aktiv: a.aktiv === false ? 'nein' : 'ja',
      LastModifiedAt: a.lastModifiedAt || '',
      Payload: JSON.stringify(a),
    };
  }
  function buildArbeitszeitRow(z) {
    const a = store.getArbeiter(z.arbeiterId);
    return {
      ArbeitszeitId: z.id,
      Arbeiter: a ? GR.models.arbeiterName(a) : '',
      Datum: z.datum || '',
      Taetigkeit: z.taetigkeit || '',
      Stunden: Number(z.stunden) || 0,
      Satz: z.satzSnapshot != null ? Number(z.satzSnapshot) : (z.satzManuell != null ? Number(z.satzManuell) : ''),
      Betrag: z.betragSnapshot != null ? Number(z.betragSnapshot) : '',
      Status: GR.models.ARBEITSZEIT_STATUS_LABEL[z.status || 'erfasst'] || z.status || '',
      AbrechnungId: z.abrechnungId || '',
      Notiz: z.notiz || '',
      LastModifiedAt: z.lastModifiedAt || '',
      Payload: JSON.stringify(z),
    };
  }
  function buildArbeitsabrechnungRow(abr) {
    const a = store.getArbeiter(abr.arbeiterId);
    const h = store.getHaushaltsstelle(abr.haushaltsstelleId);
    return {
      AbrechnungId: abr.id,
      Arbeiter: a ? GR.models.arbeiterName(a) : '',
      ZeitraumVon: abr.zeitraumVon || '',
      ZeitraumBis: abr.zeitraumBis || '',
      ErstelltAm: abr.erstelltAm || '',
      Haushaltsstelle: h ? ((h.nummer ? h.nummer + ' ' : '') + (h.bezeichnung || '')).trim() : '',
      Haushaltsjahr: abr.haushaltsjahr || '',
      SummeStunden: Number(abr.summeStunden) || 0,
      SummeBetrag: Number(abr.summeBetrag) || 0,
      AnzahlPositionen: (abr.positionen || []).length,
      Status: abr.status === 'ausgezahlt' ? 'Ausgezahlt' : 'Abgerechnet',
      AusgezahltAm: abr.ausgezahltAm || '',
      Notiz: abr.notiz || '',
      LastModifiedAt: abr.lastModifiedAt || '',
      Payload: JSON.stringify(abr),
    };
  }
  async function syncArbeiter(a) {
    await upsertRecord(await ensureTableId('tableArbeiterId', 'Arbeiter'), 'ArbeiterId', buildArbeiterRow(a));
    return { arbeiter: 1 };
  }
  async function syncArbeitszeit(z) {
    await upsertRecord(await ensureTableId('tableArbeitszeitenId', 'Arbeitszeiten'), 'ArbeitszeitId', buildArbeitszeitRow(z));
    return { arbeitszeiten: 1 };
  }
  async function syncArbeitsabrechnung(abr) {
    await upsertRecord(await ensureTableId('tableArbeitsabrechnungenId', 'Arbeitsabrechnungen'), 'AbrechnungId', buildArbeitsabrechnungRow(abr));
    return { arbeitsabrechnungen: 1 };
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

  // --- Wiederherstellung der Payload-Module ---------------------------------
  // Jede Modul-Tabelle führt eine Payload-Spalte mit dem vollständigen
  // Datensatz als JSON. Damit lässt sich jedes Modul generisch zurückholen –
  // vorher konnte die Wiederherstellung NUR Sitzungen und Mitglieder.
  function payloadModule() {
    return [
      { kind: 'mieter', label: 'Mieter', idKey: 'tableMieterId', nameKey: 'tableMieterName', fallback: 'Mieter', list: () => store.listMieter(), save: (o) => store.saveMieter(o) },
      { kind: 'raeume', label: 'Objekte', idKey: 'tableRaeumeId', nameKey: 'tableRaeumeName', fallback: 'Raeume', list: () => store.listRaeume(), save: (o) => store.saveRaum(o) },
      { kind: 'vermietungen', label: 'Vermietungen', idKey: 'tableVermietungenId', nameKey: 'tableVermietungenName', fallback: 'Vermietungen', list: () => store.listVermietungen(), save: (o) => store.saveVermietung(o) },
      { kind: 'empfaenger', label: 'Empfänger', idKey: 'tableEmpfaengerId', nameKey: 'tableEmpfaengerName', fallback: 'Empfaenger', list: () => store.listEmpfaenger(), save: (o) => store.saveEmpfaenger(o) },
      { kind: 'haushaltsstellen', label: 'Haushaltsstellen', idKey: 'tableHaushaltsstellenId', nameKey: 'tableHaushaltsstellenName', fallback: 'Haushaltsstellen', list: () => store.listHaushaltsstellen(), save: (o) => store.saveHaushaltsstelle(o) },
      { kind: 'auslagen', label: 'Auslagen', idKey: 'tableAuslagenId', nameKey: 'tableAuslagenName', fallback: 'Auslagen', list: () => store.listAuslagen(), save: (o) => store.saveAuslage(o) },
      { kind: 'vertragspartner', label: 'Vertragspartner', idKey: 'tableVertragspartnerId', nameKey: 'tableVertragspartnerName', fallback: 'Vertragspartner', list: () => store.listVertragspartner(), save: (o) => store.saveVertragspartner(o) },
      { kind: 'vertraege', label: 'Verträge', idKey: 'tableVertraegeId', nameKey: 'tableVertraegeName', fallback: 'Vertraege', list: () => store.listVertraege(), save: (o) => store.saveVertrag(o) },
      { kind: 'vorgaenge', label: 'Vorgänge', idKey: 'tableVorgaengeId', nameKey: 'tableVorgaengeName', fallback: 'Vorgaenge', list: () => store.listVorgaenge(), save: (o) => store.saveVorgang(o) },
      { kind: 'arbeiter', label: 'Arbeiter/Firmen', idKey: 'tableArbeiterId', nameKey: 'tableArbeiterName', fallback: 'Arbeiter', list: () => store.listArbeiter(), save: (o) => store.saveArbeiter(o) },
      { kind: 'arbeitszeiten', label: 'Arbeitszeiten', idKey: 'tableArbeitszeitenId', nameKey: 'tableArbeitszeitenName', fallback: 'Arbeitszeiten', list: () => store.listArbeitszeiten(), save: (o) => store.saveArbeitszeit(o) },
      { kind: 'arbeitsabrechnungen', label: 'Abrechnungen', idKey: 'tableArbeitsabrechnungenId', nameKey: 'tableArbeitsabrechnungenName', fallback: 'Arbeitsabrechnungen', list: () => store.listArbeitsabrechnungen(), save: (o) => store.saveArbeitsabrechnung(o) },
    ];
  }

  // Holt ein Modul zurück. Lokal vorhandene IDs bleiben unangetastet (local
  // wins) – es werden nur fehlende Datensätze ergänzt. Fehlt die Tabelle in
  // NocoDB (Modul nie gesynct), wird das Modul stillschweigend übersprungen.
  async function restoreModul(mod, tables) {
    const s = store.getSettings().nocodb;
    const tabName = s[mod.nameKey] || mod.fallback;
    const t = tables.find(t => (t.title || t.table_name) === tabName);
    const tableId = t ? (t.id || t.table_id) : s[mod.idKey];
    if (!tableId) return { label: mod.label, added: 0, skipped: true };

    const rows = await fetchAllRecords(tableId);
    const lokaleIds = new Set(mod.list().map(x => x.id));
    let added = 0, kaputt = 0;
    for (const r of rows) {
      if (!r.Payload) continue;
      let parsed = null;
      try { parsed = JSON.parse(r.Payload); } catch (_) { kaputt++; continue; }
      if (!parsed || !parsed.id || lokaleIds.has(parsed.id)) continue;
      mod.save(parsed);
      store.markSynced(mod.kind, parsed.id);
      added++;
    }
    return { label: mod.label, added, kaputt };
  }

  // Vollständige Wiederherstellung: Sitzungen/Mitglieder + alle Payload-Module.
  // Einzelne Module dürfen scheitern, ohne den Rest zu verhindern.
  async function restoreFromNocoDb() {
    const remote = await fetchAllFromNocoDb();
    const basis = restoreLocalWins(remote);
    const tables = await listTables();
    const details = [];
    const fehler = [];
    for (const mod of payloadModule()) {
      try {
        const res = await restoreModul(mod, tables);
        if (!res.skipped && res.added > 0) details.push(`${res.added}× ${res.label}`);
        if (res.kaputt) fehler.push(`${res.label}: ${res.kaputt} unlesbare(r) Datensatz/Datensätze`);
      } catch (e) {
        fehler.push(`${mod.label}: ${e.message}`);
      }
    }
    if (basis.sitzungenHinzugefuegt) details.unshift(`${basis.sitzungenHinzugefuegt}× Sitzungen`);
    if (basis.mitgliederHinzugefuegt) details.unshift(`${basis.mitgliederHinzugefuegt}× Mitglieder`);
    return { ...basis, details, fehler };
  }

  GR.nocodb_client = {
    testConnection,
    initSchema,
    syncSitzungComplete,
    syncMitglied,
    syncMieter,
    syncRaum,
    syncVermietung,
    syncEmpfaenger,
    syncHaushaltsstelle,
    syncAuslage,
    syncVertragspartner,
    syncVertrag,
    syncVorgang,
    syncArbeiter, syncArbeitszeit, syncArbeitsabrechnung,
    syncQueue,
    restoreFromNocoDb,
    isConfigured,
  };
})();
