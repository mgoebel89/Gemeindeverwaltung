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

  function defaultSettings() {
    return {
      ortsname: 'Hörschhausen',
      nocodb: defaultNocoDbSettings(),
      autoSync: true,
      autoSyncIntervalSec: 60,
      vermietung: defaultVermietungSettings(),
    };
  }
  function defaultNocoDbSettings() {
    return {
      serverUrl: '', token: '', baseId: '',
      tableSitzungenName: 'Sitzungen', tableBeschluesseName: 'Beschluesse', tableMitgliederName: 'Mitglieder',
      tableSitzungenId: '', tableBeschluesseId: '', tableMitgliederId: '',
      tableMieterName: 'Mieter', tableRaeumeName: 'Raeume', tableVermietungenName: 'Vermietungen',
      tableMieterId: '', tableRaeumeId: '', tableVermietungenId: '',
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

  // ----- Bootstrap (Snapshot vom Backend) -----
  async function bootstrap() {
    try {
      const snap = await GR.api.snapshot();
      cache.sitzungen = (snap.sitzungen || []).map(migrateSitzung);
      cache.mitglieder = (snap.mitglieder || []).map(migrateMitglied);
      cache.settings = snap.settings || defaultSettings();
      cache.attachments = snap.attachments || {};
      cache.mieter = snap.mieter || [];
      cache.raeume = snap.raeume || [];
      cache.vermietungen = snap.vermietungen || [];
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
    for (const k of ['tableMieterName', 'tableRaeumeName', 'tableVermietungenName', 'tableMieterId', 'tableRaeumeId', 'tableVermietungenId']) {
      if (cache.settings.nocodb[k] === undefined) cache.settings.nocodb[k] = dn[k];
    }
    if (!cache.settings.vermietung) cache.settings.vermietung = defaultVermietungSettings();
    else {
      const dv = defaultVermietungSettings();
      for (const k of Object.keys(dv)) if (cache.settings.vermietung[k] === undefined) cache.settings.vermietung[k] = dv[k];
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
      case 'vermietung:delete': { cache.vermietungen = cache.vermietungen.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
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
      GR.api.deleteVermietungRemote(id).catch(e => console.warn('deleteVermietung Backend-Fehler', e));
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
      for (const k of ['sitzungen', 'mitglieder', 'mieter', 'raeume', 'vermietungen']) {
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
