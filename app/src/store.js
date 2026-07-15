(function () {
  'use strict';
  window.GR = window.GR || {};
  const { SCHEMA_VERSION, MITGLIED_FUNKTIONEN, uuid } = GR.models;

  // Cache (Single Source of Truth im Frontend; Backend ist autoritativ)
  const cache = {
    sitzungen: [],        // [{...}]
    mitglieder: [],       // [{...}]
    settings: null,       // {...} oder null
    attachments: {},      // sitzungId -> [{id, filename, ...}]
    mieter: [],           // [{...}]
    raeume: [],           // [{...}]
    vermietungen: [],     // [{...}]
    vermietungFiles: {},  // vermietungId -> [{id, kind, filename, ...}]
    empfaenger: [],       // [{...}]
    haushaltsstellen: [], // [{...}]
    auslagen: [],         // [{...}]
    belege: {},           // auslageId -> [{id, filename, ...}]
    vertragspartner: [],  // [{...}]
    vertraege: [],        // [{...}]
    vorgaenge: [],        // [{...}] Modul Vorgänge & Projekte
    ready: false,
    backendAvailable: false,
  };

  const changeListeners = [];
  const remoteChangeListeners = [];
  const readyListeners = [];

  function nowIso() { return new Date().toISOString(); }
  function isoOrZero(s) { return s || ''; }

  function upsertInto(arr, obj) {
    if (!obj || !obj.id) return;
    const idx = arr.findIndex(x => x.id === obj.id);
    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
  }

  function notifyChange() {
    for (const fn of changeListeners) { try { fn(); } catch (e) { console.warn(e); } }
  }
  function notifyRemote() {
    for (const fn of remoteChangeListeners) { try { fn(); } catch (e) { console.warn(e); } }
  }

  // ----- Migration / Defaults -----
  function migrateSitzung(sitzung) {
    const v = sitzung.schemaVersion || 1;
    if (v < 2) {
      if ('entschuldigtIds' in sitzung) delete sitzung.entschuldigtIds;
      if (!sitzung.anwesenheitsZeiten || typeof sitzung.anwesenheitsZeiten !== 'object') sitzung.anwesenheitsZeiten = {};
      if (!sitzung.antraegeTagesordnung || typeof sitzung.antraegeTagesordnung !== 'object') sitzung.antraegeTagesordnung = { modus: 'keine', text: '' };
      if (!['keine', 'antraege'].includes(sitzung.antraegeTagesordnung.modus)) sitzung.antraegeTagesordnung.modus = 'keine';
      if (typeof sitzung.antraegeTagesordnung.text !== 'string') sitzung.antraegeTagesordnung.text = '';
      if (Array.isArray(sitzung.tops)) {
        for (const t of sitzung.tops) {
          if (typeof t.sitzungsleitungId !== 'string') t.sitzungsleitungId = '';
          if (!Array.isArray(t.freiwilligerVerzichtIds)) t.freiwilligerVerzichtIds = [];
          if (!Array.isArray(t.stimmrechtRuhtIds)) t.stimmrechtRuhtIds = [];
          if (!Array.isArray(t.befangenheitsIds)) t.befangenheitsIds = [];
        }
      }
      sitzung.schemaVersion = 2;
    }
    if ((sitzung.schemaVersion || 2) < 3) {
      // TOP-Nummerierung pro Bereich neu starten (öffentlich beginnt bei 1, nicht-öffentlich ebenfalls)
      if (Array.isArray(sitzung.tops)) {
        let n = 1;
        for (const t of sitzung.tops.filter(x => x.bereich === 'oeffentlich')) t.nummer = n++;
        n = 1;
        for (const t of sitzung.tops.filter(x => x.bereich === 'nicht_oeffentlich')) t.nummer = n++;
      }
      sitzung.schemaVersion = 3;
    }
    return sitzung;
  }

  function migrateMitglied(m) {
    if ((!m.vorname && !m.nachname) && m.name) {
      const parts = m.name.trim().split(/\s+/);
      m.nachname = parts.length > 1 ? parts.pop() : parts[0] || '';
      m.vorname = parts.join(' ');
    }
    if (m.vorname === undefined) m.vorname = '';
    if (m.nachname === undefined) m.nachname = '';
    if (!MITGLIED_FUNKTIONEN.includes(m.funktion)) m.funktion = 'Ratsmitglied';
    if ('name' in m) delete m.name;
    return m;
  }

  // Bestandsobjekte ohne Übergabe-Checkliste einmalig mit der Startvorlage
  // versehen (in-memory; persistiert beim ersten Speichern des Objekts).
  function migrateRaum(r) {
    if (r && r.uebergabeCheckliste === undefined && GR.models && GR.models.defaultUebergabeCheckliste) {
      r.uebergabeCheckliste = GR.models.defaultUebergabeCheckliste();
    }
    return r;
  }

  // Vorgänge: Einzel-Kostenstelle → Liste; Kosten-Einträge erben die alte Stelle.
  // In-memory beim Laden/Speichern (persistiert beim nächsten Save des Vorgangs).
  function migrateVorgang(v) {
    if (!v) return v;
    if (!Array.isArray(v.haushaltsstellen)) {
      v.haushaltsstellen = v.haushaltsstelleId ? [v.haushaltsstelleId] : [];
    }
    if (Array.isArray(v.historie)) {
      for (const e of v.historie) {
        if (e && e.typ === 'kosten' && e.haushaltsstelleId === undefined) {
          e.haushaltsstelleId = v.haushaltsstelleId || (v.haushaltsstellen[0] || '');
        }
      }
    }
    if ('haushaltsstelleId' in v) delete v.haushaltsstelleId;
    return v;
  }

  function defaultSettings() {
    return {
      ortsname: 'Hörschhausen',
      nocodb: defaultNocoDbSettings(),
      autoSync: true,
      autoSyncIntervalSec: 60,
      vikunjaProjektId: null, // globales Vikunja-Projekt (app-weit: Aufgaben-Modul + Vorgangs-ToDos)
      vermietung: defaultVermietungSettings(),
      auslagen: defaultAuslagenSettings(),
      vertraege: defaultVertraegeSettings(),
      vorgaenge: defaultVorgaengeSettings(),
    };
  }
  // Modul-Einstellungen „Vorgänge & Projekte": Kategorienliste, festes Vikunja-
  // Projekt für ToDos und der Hash des Leitungs-PIN (schaltet vertrauliche
  // Inhalte frei; leer = kein PIN gesetzt, Leitungs-Ansicht frei wählbar).
  function defaultVorgaengeSettings() {
    return {
      kategorien: ['Bauprojekt', 'Beschaffung', 'Veranstaltung', 'Personal', 'Förderung', 'Sonstiges'],
      vikunjaProjektId: null,
      leitungPinHash: '',
    };
  }
  function defaultNocoDbSettings() {
    return {
      serverUrl: '', token: '', baseId: '',
      tableSitzungenName: 'Sitzungen', tableBeschluesseName: 'Beschluesse', tableMitgliederName: 'Mitglieder',
      tableSitzungenId: '', tableBeschluesseId: '', tableMitgliederId: '',
      tableMieterName: 'Mieter', tableRaeumeName: 'Raeume', tableVermietungenName: 'Vermietungen',
      tableMieterId: '', tableRaeumeId: '', tableVermietungenId: '',
      tableEmpfaengerName: 'Empfaenger', tableHaushaltsstellenName: 'Haushaltsstellen', tableAuslagenName: 'Auslagen',
      tableEmpfaengerId: '', tableHaushaltsstellenId: '', tableAuslagenId: '',
      tableVertragspartnerName: 'Vertragspartner', tableVertraegeName: 'Vertraege',
      tableVertragspartnerId: '', tableVertraegeId: '',
      tableVorgaengeName: 'Vorgaenge', tableVorgaengeId: '',
    };
  }
  // Absender-/Formulardaten für die Bargeldauslagen-PDFs (Defaults aus der Vorlage Hörschhausen).
  function defaultAuslagenSettings() {
    return {
      ortsgemeinde: 'Hörschhausen',
      buergermeisterName: 'M. Göbel',
      ortsbeigeordneterName: 'C. Arenz',
      quittungOrt: 'Kelberg',
      unterschriftDataUrl: '',
      scannerUrl: '',
    };
  }
  // Absender-/Vertragsdaten für die PDFs (Defaults aus der Mietvertrag-Vorlage Hörschhausen).
  function defaultVermietungSettings() {
    return {
      ortsgemeinde: 'Hörschhausen',
      buergermeister: 'Matthias Göbel',
      anschrift: 'Uessbachstr. 15\n54552 Hörschhausen',
      telefon: '02692 93 27 63 5',
      email: 'matthias.goebel@hoerschhausen.de',
      satzungsDatum: '22.10.1999',
      vgEmpfaenger: 'Verbandsgemeindeverwaltung Kelberg\nFachbereich Finanzen und Abgaben\nDauner Straße 22\n53539 Kelberg',
    };
  }
  // Modul-Einstellungen „Verträge und Pacht": Standardwerte für neue Verträge
  // und die editierbare Kategorienliste.
  function defaultVertraegeSettings() {
    return {
      standardVorlaufTage: 30,
      standardKuendigungsfristMonate: 3,
      kategorien: ['Pacht', 'Wartung', 'Versicherung', 'Energie', 'Dienstleistung', 'Miete', 'Sonstiges'],
    };
  }

  // ----- Bootstrap (Snapshot vom Backend) -----
  async function bootstrap() {
    try {
      const snap = await GR.api.snapshot();
      cache.sitzungen = (snap.sitzungen || []).map(migrateSitzung);
      cache.mitglieder = (snap.mitglieder || []).map(migrateMitglied);
      cache.settings = snap.settings || defaultSettings();
      cache.attachments = snap.attachments || {};
      cache.mieter = snap.mieter || [];
      cache.raeume = (snap.raeume || []).map(migrateRaum);
      cache.vermietungen = snap.vermietungen || [];
      cache.vermietungFiles = snap.vermietungFiles || {};
      cache.empfaenger = snap.empfaenger || [];
      cache.haushaltsstellen = snap.haushaltsstellen || [];
      cache.auslagen = snap.auslagen || [];
      cache.belege = snap.belege || {};
      cache.vertragspartner = snap.vertragspartner || [];
      cache.vertraege = snap.vertraege || [];
      cache.vorgaenge = (snap.vorgaenge || []).map(migrateVorgang);
      cache.backendAvailable = true;
      cache.ready = true;
      mergeSettingsDefaults();
      notifyChange();
      for (const fn of readyListeners) { try { fn(); } catch (e) { console.warn(e); } }
    } catch (e) {
      console.error('Backend nicht erreichbar:', e);
      cache.backendAvailable = false;
      cache.settings = defaultSettings();
      cache.ready = true;
      notifyChange();
      for (const fn of readyListeners) { try { fn(); } catch (e) { console.warn(e); } }
    }
  }

  function mergeSettingsDefaults() {
    if (!cache.settings) cache.settings = defaultSettings();
    if (!cache.settings.nocodb) cache.settings.nocodb = defaultNocoDbSettings();
    else {
      const d = defaultNocoDbSettings();
      for (const k of Object.keys(d)) if (cache.settings.nocodb[k] === undefined) cache.settings.nocodb[k] = d[k];
    }
    if (cache.settings.autoSync === undefined) cache.settings.autoSync = true;
    if (cache.settings.autoSyncIntervalSec === undefined) cache.settings.autoSyncIntervalSec = 60;
    // NocoDB-Defaults für neue Tabellen nachziehen (Bestandsinstallationen)
    const dn = defaultNocoDbSettings();
    for (const k of ['tableMieterName', 'tableRaeumeName', 'tableVermietungenName', 'tableMieterId', 'tableRaeumeId', 'tableVermietungenId',
      'tableEmpfaengerName', 'tableHaushaltsstellenName', 'tableAuslagenName', 'tableEmpfaengerId', 'tableHaushaltsstellenId', 'tableAuslagenId',
      'tableVertragspartnerName', 'tableVertraegeName', 'tableVertragspartnerId', 'tableVertraegeId',
      'tableVorgaengeName', 'tableVorgaengeId']) {
      if (cache.settings.nocodb[k] === undefined) cache.settings.nocodb[k] = dn[k];
    }
    if (!cache.settings.vermietung) cache.settings.vermietung = defaultVermietungSettings();
    else {
      const dv = defaultVermietungSettings();
      for (const k of Object.keys(dv)) if (cache.settings.vermietung[k] === undefined) cache.settings.vermietung[k] = dv[k];
    }
    if (!cache.settings.auslagen) cache.settings.auslagen = defaultAuslagenSettings();
    else {
      const da = defaultAuslagenSettings();
      for (const k of Object.keys(da)) if (cache.settings.auslagen[k] === undefined) cache.settings.auslagen[k] = da[k];
    }
    if (!cache.settings.vertraege) cache.settings.vertraege = defaultVertraegeSettings();
    else {
      const dvt = defaultVertraegeSettings();
      for (const k of Object.keys(dvt)) if (cache.settings.vertraege[k] === undefined) cache.settings.vertraege[k] = dvt[k];
    }
    if (!cache.settings.vorgaenge) cache.settings.vorgaenge = defaultVorgaengeSettings();
    else {
      const dvg = defaultVorgaengeSettings();
      for (const k of Object.keys(dvg)) if (cache.settings.vorgaenge[k] === undefined) cache.settings.vorgaenge[k] = dvg[k];
    }
    // Globales Vikunja-Projekt: einmalig aus dem früheren Vorgänge-spezifischen
    // Wert übernehmen (nur wenn das Feld noch gar nicht existiert).
    if (cache.settings.vikunjaProjektId === undefined) {
      const legacy = cache.settings.vorgaenge && cache.settings.vorgaenge.vikunjaProjektId;
      cache.settings.vikunjaProjektId = legacy || null;
    }
  }

  // ----- WebSocket-Apply -----
  function applyServerMessage(msg) {
    if (!msg || !msg.type) return;
    // Eigene Echos ignorieren — sonst rerendert das UI während der User tippt.
    if (msg.origin && GR.api && GR.api.clientId && msg.origin === GR.api.clientId) return;
    switch (msg.type) {
      case 'sitzung:save': {
        const s = migrateSitzung(msg.sitzung);
        const idx = cache.sitzungen.findIndex(x => x.id === s.id);
        if (idx >= 0) cache.sitzungen[idx] = s; else cache.sitzungen.unshift(s);
        notifyChange(); notifyRemote();
        break;
      }
      case 'sitzung:delete': {
        cache.sitzungen = cache.sitzungen.filter(s => s.id !== msg.id);
        delete cache.attachments[msg.id];
        notifyChange(); notifyRemote();
        break;
      }
      case 'mitglied:save': {
        const m = migrateMitglied(msg.mitglied);
        const idx = cache.mitglieder.findIndex(x => x.id === m.id);
        if (idx >= 0) cache.mitglieder[idx] = m; else cache.mitglieder.push(m);
        notifyChange(); notifyRemote();
        break;
      }
      case 'mitglied:delete': {
        cache.mitglieder = cache.mitglieder.filter(m => m.id !== msg.id);
        notifyChange(); notifyRemote();
        break;
      }
      case 'settings:save': {
        cache.settings = msg.settings || cache.settings;
        mergeSettingsDefaults();
        notifyChange(); notifyRemote();
        break;
      }
      case 'attachment:add': {
        const a = msg.attachment;
        if (!cache.attachments[a.sitzungId]) cache.attachments[a.sitzungId] = [];
        if (!cache.attachments[a.sitzungId].some(x => x.id === a.id)) {
          cache.attachments[a.sitzungId].push(a);
        }
        notifyChange(); notifyRemote();
        break;
      }
      case 'attachment:delete': {
        if (cache.attachments[msg.sitzungId]) {
          cache.attachments[msg.sitzungId] = cache.attachments[msg.sitzungId].filter(a => a.id !== msg.id);
        }
        notifyChange(); notifyRemote();
        break;
      }
      case 'mieter:save': { upsertInto(cache.mieter, msg.mieter); notifyChange(); notifyRemote(); break; }
      case 'mieter:delete': { cache.mieter = cache.mieter.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'raum:save': { upsertInto(cache.raeume, msg.raum); notifyChange(); notifyRemote(); break; }
      case 'raum:delete': { cache.raeume = cache.raeume.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'vermietung:save': { upsertInto(cache.vermietungen, msg.vermietung); notifyChange(); notifyRemote(); break; }
      case 'vermietung:delete': { cache.vermietungen = cache.vermietungen.filter(x => x.id !== msg.id); delete cache.vermietungFiles[msg.id]; notifyChange(); notifyRemote(); break; }
      case 'vermietungFoto:add': {
        const f = msg.foto;
        if (!cache.vermietungFiles[f.vermietungId]) cache.vermietungFiles[f.vermietungId] = [];
        if (!cache.vermietungFiles[f.vermietungId].some(x => x.id === f.id)) cache.vermietungFiles[f.vermietungId].push(f);
        notifyChange(); notifyRemote();
        break;
      }
      case 'vermietungFoto:delete': {
        if (cache.vermietungFiles[msg.vermietungId]) cache.vermietungFiles[msg.vermietungId] = cache.vermietungFiles[msg.vermietungId].filter(f => f.id !== msg.id);
        notifyChange(); notifyRemote();
        break;
      }
      case 'empfaenger:save': { upsertInto(cache.empfaenger, msg.empfaenger); notifyChange(); notifyRemote(); break; }
      case 'empfaenger:delete': { cache.empfaenger = cache.empfaenger.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'haushaltsstelle:save': { upsertInto(cache.haushaltsstellen, msg.haushaltsstelle); notifyChange(); notifyRemote(); break; }
      case 'haushaltsstelle:delete': { cache.haushaltsstellen = cache.haushaltsstellen.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'auslage:save': { upsertInto(cache.auslagen, msg.auslage); notifyChange(); notifyRemote(); break; }
      case 'auslage:delete': { cache.auslagen = cache.auslagen.filter(x => x.id !== msg.id); delete cache.belege[msg.id]; notifyChange(); notifyRemote(); break; }
      case 'beleg:add': {
        const b = msg.beleg;
        if (!cache.belege[b.auslageId]) cache.belege[b.auslageId] = [];
        if (!cache.belege[b.auslageId].some(x => x.id === b.id)) cache.belege[b.auslageId].push(b);
        notifyChange(); notifyRemote();
        break;
      }
      case 'beleg:delete': {
        if (cache.belege[msg.auslageId]) cache.belege[msg.auslageId] = cache.belege[msg.auslageId].filter(f => f.id !== msg.id);
        notifyChange(); notifyRemote();
        break;
      }
      case 'vertragspartner:save': { upsertInto(cache.vertragspartner, msg.vertragspartner); notifyChange(); notifyRemote(); break; }
      case 'vertragspartner:delete': { cache.vertragspartner = cache.vertragspartner.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'vertrag:save': { upsertInto(cache.vertraege, msg.vertrag); notifyChange(); notifyRemote(); break; }
      case 'vertrag:delete': { cache.vertraege = cache.vertraege.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'vorgang:save': { upsertInto(cache.vorgaenge, migrateVorgang(msg.vorgang)); notifyChange(); notifyRemote(); break; }
      case 'vorgang:delete': { cache.vorgaenge = cache.vorgaenge.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'bulk:imported': {
        // Komplettes Re-Bootstrap, damit alle Daten konsistent kommen
        bootstrap();
        break;
      }
    }
  }

  // ----- Hintergrund-Speicherungen (fire-and-forget mit toast bei Fehler) -----
  function bgPutSitzung(s) {
    GR.api.putSitzung(s).catch(e => {
      console.warn('saveSitzung Backend-Fehler', e);
      if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000);
    });
  }
  function bgDeleteSitzung(id) {
    GR.api.deleteSitzungRemote(id).catch(e => console.warn('deleteSitzung Backend-Fehler', e));
  }
  function bgPutMitglied(m) {
    GR.api.putMitglied(m).catch(e => {
      console.warn('saveMitglied Backend-Fehler', e);
      if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000);
    });
  }
  function bgDeleteMitglied(id) {
    GR.api.deleteMitgliedRemote(id).catch(e => console.warn('deleteMitglied Backend-Fehler', e));
  }
  function bgPutSettings(s) {
    GR.api.putSettings(s).catch(e => console.warn('saveSettings Backend-Fehler', e));
  }

  // ----- Öffentliches Store-API (synchron lesend, Schreiben triggert Backend im Hintergrund) -----
  const store = {
    onReady(fn) { if (cache.ready) try { fn(); } catch (_) {} else readyListeners.push(fn); },
    isReady() { return cache.ready; },
    isBackendAvailable() { return cache.backendAvailable; },

    // --- Sitzungen ---
    listSitzungen() { return cache.sitzungen.slice(); },
    getSitzung(id) { return cache.sitzungen.find(s => s.id === id) || null; },
    saveSitzung(sitzung) {
      sitzung.lastModifiedAt = nowIso();
      migrateSitzung(sitzung);
      const idx = cache.sitzungen.findIndex(s => s.id === sitzung.id);
      if (idx >= 0) cache.sitzungen[idx] = sitzung; else cache.sitzungen.unshift(sitzung);
      bgPutSitzung(sitzung);
      notifyChange();
    },
    deleteSitzung(id) {
      cache.sitzungen = cache.sitzungen.filter(s => s.id !== id);
      delete cache.attachments[id];
      bgDeleteSitzung(id);
      notifyChange();
    },

    // --- Mitglieder ---
    listMitglieder() { return cache.mitglieder.slice(); },
    getMitglied(id) { return cache.mitglieder.find(m => m.id === id) || null; },
    saveMitglied(m) {
      m.lastModifiedAt = nowIso();
      migrateMitglied(m);
      const idx = cache.mitglieder.findIndex(x => x.id === m.id);
      if (idx >= 0) cache.mitglieder[idx] = m; else cache.mitglieder.push(m);
      bgPutMitglied(m);
      notifyChange();
    },
    deleteMitglied(id) {
      cache.mitglieder = cache.mitglieder.filter(m => m.id !== id);
      bgDeleteMitglied(id);
      notifyChange();
    },

    // --- Settings ---
    getSettings() { mergeSettingsDefaults(); return cache.settings; },
    saveSettings(s) {
      cache.settings = s;
      mergeSettingsDefaults();
      bgPutSettings(cache.settings);
      notifyChange();
    },

    // --- Attachments (async) ---
    listAttachments(sitzungId) { return (cache.attachments[sitzungId] || []).slice(); },
    async uploadAttachment(sitzungId, file) {
      const rec = await GR.api.uploadAttachment(sitzungId, file);
      if (!cache.attachments[sitzungId]) cache.attachments[sitzungId] = [];
      cache.attachments[sitzungId].push(rec);
      notifyChange();
      return rec;
    },
    async deleteAttachment(sitzungId, id) {
      await GR.api.deleteAttachment(id);
      if (cache.attachments[sitzungId]) {
        cache.attachments[sitzungId] = cache.attachments[sitzungId].filter(a => a.id !== id);
      }
      notifyChange();
    },
    attachmentUrl(id) { return GR.api.attachmentUrl(id); },

    // --- Mieter ---
    listMieter() { return cache.mieter.slice(); },
    getMieter(id) { return cache.mieter.find(m => m.id === id) || null; },
    saveMieter(m) {
      m.lastModifiedAt = nowIso();
      upsertInto(cache.mieter, m);
      GR.api.putMieter(m).catch(e => { console.warn('saveMieter Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteMieter(id) {
      cache.mieter = cache.mieter.filter(m => m.id !== id);
      GR.api.deleteMieterRemote(id).catch(e => console.warn('deleteMieter Backend-Fehler', e));
      notifyChange();
    },

    // --- Räume ---
    listRaeume() { return cache.raeume.slice(); },
    getRaum(id) { return cache.raeume.find(r => r.id === id) || null; },
    saveRaum(r) {
      r.lastModifiedAt = nowIso();
      upsertInto(cache.raeume, r);
      GR.api.putRaum(r).catch(e => { console.warn('saveRaum Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteRaum(id) {
      cache.raeume = cache.raeume.filter(r => r.id !== id);
      GR.api.deleteRaumRemote(id).catch(e => console.warn('deleteRaum Backend-Fehler', e));
      notifyChange();
    },

    // --- Vermietungen ---
    listVermietungen() { return cache.vermietungen.slice(); },
    getVermietung(id) { return cache.vermietungen.find(v => v.id === id) || null; },
    saveVermietung(v) {
      v.lastModifiedAt = nowIso();
      upsertInto(cache.vermietungen, v);
      GR.api.putVermietung(v).catch(e => { console.warn('saveVermietung Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteVermietung(id) {
      cache.vermietungen = cache.vermietungen.filter(v => v.id !== id);
      delete cache.vermietungFiles[id];
      GR.api.deleteVermietungRemote(id).catch(e => console.warn('deleteVermietung Backend-Fehler', e));
      notifyChange();
    },

    // --- Zählerstand-Fotos (zu einer Vermietung; async) ---
    listVermietungFotos(vermietungId) { return (cache.vermietungFiles[vermietungId] || []).slice(); },
    getVermietungFoto(vermietungId, fileId) { return (cache.vermietungFiles[vermietungId] || []).find(f => f.id === fileId) || null; },
    async uploadVermietungFoto(vermietungId, file, kind) {
      const rec = await GR.api.uploadVermietungFoto(vermietungId, file, kind);
      if (!cache.vermietungFiles[vermietungId]) cache.vermietungFiles[vermietungId] = [];
      cache.vermietungFiles[vermietungId].push(rec);
      notifyChange();
      return rec;
    },
    async deleteVermietungFoto(vermietungId, fileId) {
      await GR.api.deleteVermietungFoto(fileId);
      if (cache.vermietungFiles[vermietungId]) cache.vermietungFiles[vermietungId] = cache.vermietungFiles[vermietungId].filter(f => f.id !== fileId);
      notifyChange();
    },
    vermietungFotoUrl(fileId) { return GR.api.vermietungFotoUrl(fileId); },

    // --- Empfänger (Bargeldauslagen) ---
    listEmpfaenger() { return cache.empfaenger.slice(); },
    getEmpfaenger(id) { return cache.empfaenger.find(e => e.id === id) || null; },
    saveEmpfaenger(e) {
      e.lastModifiedAt = nowIso();
      upsertInto(cache.empfaenger, e);
      GR.api.putEmpfaenger(e).catch(err => { console.warn('saveEmpfaenger Backend-Fehler', err); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + err.message, 4000); });
      notifyChange();
    },
    deleteEmpfaenger(id) {
      cache.empfaenger = cache.empfaenger.filter(e => e.id !== id);
      GR.api.deleteEmpfaengerRemote(id).catch(e => console.warn('deleteEmpfaenger Backend-Fehler', e));
      notifyChange();
    },

    // --- Haushaltsstellen ---
    listHaushaltsstellen() { return cache.haushaltsstellen.slice(); },
    getHaushaltsstelle(id) { return cache.haushaltsstellen.find(h => h.id === id) || null; },
    saveHaushaltsstelle(h) {
      h.lastModifiedAt = nowIso();
      upsertInto(cache.haushaltsstellen, h);
      GR.api.putHaushaltsstelle(h).catch(err => { console.warn('saveHaushaltsstelle Backend-Fehler', err); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + err.message, 4000); });
      notifyChange();
    },
    deleteHaushaltsstelle(id) {
      cache.haushaltsstellen = cache.haushaltsstellen.filter(h => h.id !== id);
      GR.api.deleteHaushaltsstelleRemote(id).catch(e => console.warn('deleteHaushaltsstelle Backend-Fehler', e));
      notifyChange();
    },

    // --- Auslagen ---
    listAuslagen() { return cache.auslagen.slice(); },
    getAuslage(id) { return cache.auslagen.find(a => a.id === id) || null; },
    saveAuslage(a) {
      a.lastModifiedAt = nowIso();
      upsertInto(cache.auslagen, a);
      GR.api.putAuslage(a).catch(err => { console.warn('saveAuslage Backend-Fehler', err); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + err.message, 4000); });
      notifyChange();
    },
    deleteAuslage(id) {
      cache.auslagen = cache.auslagen.filter(a => a.id !== id);
      delete cache.belege[id];
      GR.api.deleteAuslageRemote(id).catch(e => console.warn('deleteAuslage Backend-Fehler', e));
      notifyChange();
    },

    // --- Belege (Scan-Dateien zu einer Auslage; async) ---
    listBelegFiles(auslageId) { return (cache.belege[auslageId] || []).slice(); },
    getBelegFile(auslageId, fileId) { return (cache.belege[auslageId] || []).find(f => f.id === fileId) || null; },
    async uploadBeleg(auslageId, file) {
      const rec = await GR.api.uploadBeleg(auslageId, file);
      if (!cache.belege[auslageId]) cache.belege[auslageId] = [];
      cache.belege[auslageId].push(rec);
      notifyChange();
      return rec;
    },
    async scanBeleg(auslageId, scannerUrl, source) {
      const recs = await GR.api.scan(auslageId, scannerUrl, source);
      if (!cache.belege[auslageId]) cache.belege[auslageId] = [];
      for (const rec of (recs || [])) {
        if (!cache.belege[auslageId].some(f => f.id === rec.id)) cache.belege[auslageId].push(rec);
      }
      notifyChange();
      return recs || [];
    },
    async deleteBelegFile(auslageId, fileId) {
      await GR.api.deleteBelegFile(fileId);
      if (cache.belege[auslageId]) cache.belege[auslageId] = cache.belege[auslageId].filter(f => f.id !== fileId);
      notifyChange();
    },
    belegUrl(fileId) { return GR.api.belegUrl(fileId); },

    // --- Vertragspartner (Modul Verträge) ---
    listVertragspartner() { return cache.vertragspartner.slice(); },
    getVertragspartner(id) { return cache.vertragspartner.find(p => p.id === id) || null; },
    saveVertragspartner(p) {
      p.lastModifiedAt = nowIso();
      upsertInto(cache.vertragspartner, p);
      GR.api.putVertragspartner(p).catch(e => { console.warn('saveVertragspartner Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteVertragspartner(id) {
      cache.vertragspartner = cache.vertragspartner.filter(p => p.id !== id);
      GR.api.deleteVertragspartnerRemote(id).catch(e => console.warn('deleteVertragspartner Backend-Fehler', e));
      notifyChange();
    },

    // --- Verträge ---
    listVertraege() { return cache.vertraege.slice(); },
    getVertrag(id) { return cache.vertraege.find(v => v.id === id) || null; },
    saveVertrag(v) {
      v.lastModifiedAt = nowIso();
      upsertInto(cache.vertraege, v);
      GR.api.putVertrag(v).catch(e => { console.warn('saveVertrag Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteVertrag(id) {
      cache.vertraege = cache.vertraege.filter(v => v.id !== id);
      GR.api.deleteVertragRemote(id).catch(e => console.warn('deleteVertrag Backend-Fehler', e));
      notifyChange();
    },

    // --- Vorgänge & Projekte ---
    listVorgaenge() { return cache.vorgaenge.slice(); },
    getVorgang(id) { return cache.vorgaenge.find(v => v.id === id) || null; },
    saveVorgang(v) {
      v.lastModifiedAt = nowIso();
      migrateVorgang(v);
      upsertInto(cache.vorgaenge, v);
      GR.api.putVorgang(v).catch(e => { console.warn('saveVorgang Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteVorgang(id) {
      cache.vorgaenge = cache.vorgaenge.filter(v => v.id !== id);
      GR.api.deleteVorgangRemote(id).catch(e => console.warn('deleteVorgang Backend-Fehler', e));
      notifyChange();
    },

    // --- Sync-Queue (NocoDB-Backup; bleibt im localStorage als Browser-eigener Cache) ---
    listQueue() { try { return JSON.parse(localStorage.getItem('gr.syncQueue') || '[]'); } catch (_) { return []; } },
    enqueueSync(sitzungId, lastError) {
      const all = this.listQueue();
      const existing = all.find(q => q.sitzungId === sitzungId);
      if (existing) { existing.lastError = lastError || existing.lastError || ''; existing.lastAttemptAt = nowIso(); }
      else { all.push({ id: uuid(), type: 'sitzung-complete', sitzungId, queuedAt: nowIso(), lastError: lastError || '' }); }
      localStorage.setItem('gr.syncQueue', JSON.stringify(all));
    },
    removeFromQueue(qid) {
      localStorage.setItem('gr.syncQueue', JSON.stringify(this.listQueue().filter(q => q.id !== qid)));
    },
    clearQueue() { localStorage.removeItem('gr.syncQueue'); },
    markQueueError(qid, msg) {
      const all = this.listQueue();
      const it = all.find(q => q.id === qid);
      if (it) { it.lastError = msg; it.lastAttemptAt = nowIso(); localStorage.setItem('gr.syncQueue', JSON.stringify(all)); }
    },

    // --- Sync-State (NocoDB) ---
    getSyncState() {
      let s;
      try { s = JSON.parse(localStorage.getItem('gr.syncState') || '{}'); }
      catch (_) { s = {}; }
      for (const k of ['sitzungen', 'mitglieder', 'mieter', 'raeume', 'vermietungen', 'empfaenger', 'haushaltsstellen', 'auslagen', 'vertragspartner', 'vertraege', 'vorgaenge']) {
        if (!s[k] || typeof s[k] !== 'object') s[k] = {};
      }
      return s;
    },
    markSynced(kind, id) {
      const s = this.getSyncState();
      s[kind][id] = { lastSyncedAt: nowIso(), lastError: '' };
      localStorage.setItem('gr.syncState', JSON.stringify(s));
    },
    markSyncError(kind, id, msg) {
      const s = this.getSyncState();
      const prev = s[kind][id] || {};
      s[kind][id] = { lastSyncedAt: prev.lastSyncedAt || '', lastError: msg, lastAttemptAt: nowIso() };
      localStorage.setItem('gr.syncState', JSON.stringify(s));
    },
    isDirty(kind, item) {
      if (!item || !item.lastModifiedAt) return true;
      const s = this.getSyncState();
      const rec = s[kind][item.id];
      if (!rec || !rec.lastSyncedAt) return true;
      return item.lastModifiedAt > rec.lastSyncedAt;
    },

    // --- Change-Listener ---
    onChange(fn) { changeListeners.push(fn); return () => { const i = changeListeners.indexOf(fn); if (i >= 0) changeListeners.splice(i, 1); }; },
    onRemoteChange(fn) { remoteChangeListeners.push(fn); return () => { const i = remoteChangeListeners.indexOf(fn); if (i >= 0) remoteChangeListeners.splice(i, 1); }; },
    _notifyChange: notifyChange,

    // --- Backup (JSON-Export bleibt verfügbar) ---
    exportAll() {
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: nowIso(),
        sitzungen: this.listSitzungen(),
        mitglieder: this.listMitglieder(),
        settings: this.getSettings(),
      };
    },
    async importAll(data) {
      if (!data || typeof data !== 'object') throw new Error('Ungültige Importdatei');
      await GR.api.importAll({
        sitzungen: Array.isArray(data.sitzungen) ? data.sitzungen : [],
        mitglieder: Array.isArray(data.mitglieder) ? data.mitglieder : [],
        settings: data.settings || null,
      });
      // bootstrap übernimmt den frischen Stand
      await bootstrap();
    },

    // --- Bootstrap-Hooks (für app.js) ---
    bootstrap,
    applyServerMessage,
  };

  GR.store = store;
})();
