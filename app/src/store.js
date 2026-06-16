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
    ready: false,
    backendAvailable: false,
  };

  const changeListeners = [];
  const readyListeners = [];

  function nowIso() { return new Date().toISOString(); }
  function isoOrZero(s) { return s || ''; }

  function notifyChange() {
    for (const fn of changeListeners) { try { fn(); } catch (e) { console.warn(e); } }
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
    };
  }
  function defaultNocoDbSettings() {
    return {
      serverUrl: '', token: '', baseId: '',
      tableSitzungenName: 'Sitzungen', tableBeschluesseName: 'Beschluesse', tableMitgliederName: 'Mitglieder',
      tableSitzungenId: '', tableBeschluesseId: '', tableMitgliederId: '',
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
  }

  // ----- WebSocket-Apply -----
  function applyServerMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'sitzung:save': {
        const s = migrateSitzung(msg.sitzung);
        const idx = cache.sitzungen.findIndex(x => x.id === s.id);
        if (idx >= 0) cache.sitzungen[idx] = s; else cache.sitzungen.unshift(s);
        notifyChange();
        break;
      }
      case 'sitzung:delete': {
        cache.sitzungen = cache.sitzungen.filter(s => s.id !== msg.id);
        delete cache.attachments[msg.id];
        notifyChange();
        break;
      }
      case 'mitglied:save': {
        const m = migrateMitglied(msg.mitglied);
        const idx = cache.mitglieder.findIndex(x => x.id === m.id);
        if (idx >= 0) cache.mitglieder[idx] = m; else cache.mitglieder.push(m);
        notifyChange();
        break;
      }
      case 'mitglied:delete': {
        cache.mitglieder = cache.mitglieder.filter(m => m.id !== msg.id);
        notifyChange();
        break;
      }
      case 'settings:save': {
        cache.settings = msg.settings || cache.settings;
        mergeSettingsDefaults();
        notifyChange();
        break;
      }
      case 'attachment:add': {
        const a = msg.attachment;
        if (!cache.attachments[a.sitzungId]) cache.attachments[a.sitzungId] = [];
        if (!cache.attachments[a.sitzungId].some(x => x.id === a.id)) {
          cache.attachments[a.sitzungId].push(a);
        }
        notifyChange();
        break;
      }
      case 'attachment:delete': {
        if (cache.attachments[msg.sitzungId]) {
          cache.attachments[msg.sitzungId] = cache.attachments[msg.sitzungId].filter(a => a.id !== msg.id);
        }
        notifyChange();
        break;
      }
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
      try { return JSON.parse(localStorage.getItem('gr.syncState') || '{"sitzungen":{},"mitglieder":{}}'); }
      catch (_) { return { sitzungen: {}, mitglieder: {} }; }
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
