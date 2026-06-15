(function () {
  'use strict';
  window.GR = window.GR || {};
  const { SCHEMA_VERSION, MITGLIED_FUNKTIONEN, uuid } = GR.models;

  const KEYS = {
    sitzungen: 'gr.sitzungen',
    mitglieder: 'gr.mitglieder',
    settings: 'gr.settings',
    syncQueue: 'gr.syncQueue',
    syncState: 'gr.syncState',
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Store read failed', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function nowIso() { return new Date().toISOString(); }

  function migrateSitzung(sitzung) {
    const v = sitzung.schemaVersion || 1;
    if (v < 2) {
      if ('entschuldigtIds' in sitzung) delete sitzung.entschuldigtIds;
      if (!sitzung.anwesenheitsZeiten || typeof sitzung.anwesenheitsZeiten !== 'object') {
        sitzung.anwesenheitsZeiten = {};
      }
      if (Array.isArray(sitzung.tops)) {
        for (const t of sitzung.tops) {
          if (typeof t.sitzungsleitungId !== 'string') t.sitzungsleitungId = '';
          if (!Array.isArray(t.freiwilligerVerzichtIds)) t.freiwilligerVerzichtIds = [];
          if (!Array.isArray(t.stimmrechtRuhtIds)) t.stimmrechtRuhtIds = [];
        }
      }
      sitzung.schemaVersion = 2;
    }
    return sitzung;
  }

  function migrateMitglied(m) {
    let changed = false;
    if ((!m.vorname && !m.nachname) && m.name) {
      const parts = m.name.trim().split(/\s+/);
      m.nachname = parts.length > 1 ? parts.pop() : parts[0] || '';
      m.vorname = parts.join(' ');
      changed = true;
    }
    if (m.vorname === undefined) { m.vorname = ''; changed = true; }
    if (m.nachname === undefined) { m.nachname = ''; changed = true; }
    if (!MITGLIED_FUNKTIONEN.includes(m.funktion)) {
      m.funktion = 'Ratsmitglied';
      changed = true;
    }
    if ('name' in m) { delete m.name; changed = true; }
    return changed;
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
      serverUrl: '',
      token: '',
      baseId: '',
      tableSitzungenName: 'Sitzungen',
      tableBeschluesseName: 'Beschluesse',
      tableMitgliederName: 'Mitglieder',
      tableSitzungenId: '',
      tableBeschluesseId: '',
      tableMitgliederId: '',
    };
  }

  function emptySyncState() {
    return { sitzungen: {}, mitglieder: {} };
  }

  const store = {
    // --- Sitzungen ---
    listSitzungen() { return read(KEYS.sitzungen, []).map(migrateSitzung); },
    getSitzung(id) { return this.listSitzungen().find(s => s.id === id) || null; },
    saveSitzung(sitzung) {
      sitzung.lastModifiedAt = nowIso();
      const all = this.listSitzungen();
      const idx = all.findIndex(s => s.id === sitzung.id);
      if (idx >= 0) all[idx] = sitzung;
      else all.unshift(sitzung);
      write(KEYS.sitzungen, all);
      this._notifyChange();
    },
    deleteSitzung(id) {
      write(KEYS.sitzungen, this.listSitzungen().filter(s => s.id !== id));
      const st = this.getSyncState();
      delete st.sitzungen[id];
      write(KEYS.syncState, st);
      this._notifyChange();
    },

    // --- Mitglieder mit Lazy-Migration ---
    listMitglieder() {
      const arr = read(KEYS.mitglieder, []);
      let mutated = false;
      for (const m of arr) {
        if (migrateMitglied(m)) mutated = true;
      }
      if (mutated) write(KEYS.mitglieder, arr);
      return arr;
    },
    saveMitglied(m) {
      m.lastModifiedAt = nowIso();
      const all = this.listMitglieder();
      const idx = all.findIndex(x => x.id === m.id);
      if (idx >= 0) all[idx] = m;
      else all.push(m);
      write(KEYS.mitglieder, all);
      this._notifyChange();
    },
    deleteMitglied(id) {
      write(KEYS.mitglieder, this.listMitglieder().filter(m => m.id !== id));
      const st = this.getSyncState();
      delete st.mitglieder[id];
      write(KEYS.syncState, st);
      this._notifyChange();
    },
    getMitglied(id) { return this.listMitglieder().find(m => m.id === id) || null; },

    // --- Settings (mit NocoDB-Defaults nach-mergen) ---
    getSettings() {
      const s = read(KEYS.settings, defaultSettings());
      if (!s.nocodb) s.nocodb = defaultNocoDbSettings();
      else {
        const d = defaultNocoDbSettings();
        for (const k of Object.keys(d)) if (s.nocodb[k] === undefined) s.nocodb[k] = d[k];
      }
      if (s.autoSync === undefined) s.autoSync = true;
      if (s.autoSyncIntervalSec === undefined) s.autoSyncIntervalSec = 60;
      return s;
    },
    saveSettings(s) { write(KEYS.settings, s); },

    // --- Sync-Queue (für manuell eingereihte Versuche) ---
    listQueue() { return read(KEYS.syncQueue, []); },
    enqueueSync(sitzungId, lastError) {
      const all = this.listQueue();
      const existing = all.find(q => q.sitzungId === sitzungId);
      if (existing) {
        existing.lastError = lastError || existing.lastError || '';
        existing.lastAttemptAt = nowIso();
      } else {
        all.push({
          id: uuid(),
          type: 'sitzung-complete',
          sitzungId,
          queuedAt: nowIso(),
          lastError: lastError || '',
        });
      }
      write(KEYS.syncQueue, all);
    },
    removeFromQueue(queueId) {
      write(KEYS.syncQueue, this.listQueue().filter(q => q.id !== queueId));
    },
    clearQueue() { write(KEYS.syncQueue, []); },
    markQueueError(queueId, msg) {
      const all = this.listQueue();
      const it = all.find(q => q.id === queueId);
      if (it) { it.lastError = msg; it.lastAttemptAt = nowIso(); write(KEYS.syncQueue, all); }
    },

    // --- Sync-State (lastSyncedAt + lastError pro Item) ---
    getSyncState() {
      const s = read(KEYS.syncState, emptySyncState());
      if (!s.sitzungen) s.sitzungen = {};
      if (!s.mitglieder) s.mitglieder = {};
      return s;
    },
    markSynced(kind, id) {
      const s = this.getSyncState();
      s[kind][id] = { lastSyncedAt: nowIso(), lastError: '' };
      write(KEYS.syncState, s);
    },
    markSyncError(kind, id, msg) {
      const s = this.getSyncState();
      const prev = s[kind][id] || {};
      s[kind][id] = { lastSyncedAt: prev.lastSyncedAt || '', lastError: msg, lastAttemptAt: nowIso() };
      write(KEYS.syncState, s);
    },
    isDirty(kind, item) {
      if (!item || !item.lastModifiedAt) return true; // unbekannt → sicherheitshalber syncen
      const s = this.getSyncState();
      const rec = s[kind][item.id];
      if (!rec || !rec.lastSyncedAt) return true;
      return item.lastModifiedAt > rec.lastSyncedAt;
    },

    // --- Change-Listener (für Auto-Sync) ---
    _changeListeners: [],
    onChange(fn) { this._changeListeners.push(fn); return () => { this._changeListeners = this._changeListeners.filter(f => f !== fn); }; },
    _notifyChange() {
      for (const fn of this._changeListeners) {
        try { fn(); } catch (e) { console.warn('Change-Listener Fehler', e); }
      }
    },

    // --- Backup ---
    exportAll() {
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: nowIso(),
        sitzungen: this.listSitzungen(),
        mitglieder: this.listMitglieder(),
        settings: this.getSettings(),
      };
    },
    importAll(data) {
      if (!data || typeof data !== 'object') throw new Error('Ungültige Importdatei');
      if (Array.isArray(data.sitzungen)) write(KEYS.sitzungen, data.sitzungen);
      if (Array.isArray(data.mitglieder)) write(KEYS.mitglieder, data.mitglieder);
      if (data.settings) write(KEYS.settings, data.settings);
    },
  };

  GR.store = store;
})();
