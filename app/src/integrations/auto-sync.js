(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;

  // Status: 'unconfigured' | 'idle' | 'syncing' | 'ok' | 'error'
  let state = {
    status: 'idle',
    lastSyncAt: '',
    lastError: '',
    pending: 0,
  };
  const listeners = [];
  let timer = null;
  let running = false;
  let unsubscribeChange = null;
  let debounceTimer = null;

  function emit() {
    for (const fn of listeners) {
      try { fn(state); } catch (e) { console.warn('auto-sync listener', e); }
    }
  }

  function subscribe(fn) {
    listeners.push(fn);
    try { fn(state); } catch (_) {}
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
  }

  function computePending() {
    const sitzungen = store.listSitzungen();
    const mitglieder = store.listMitglieder();
    let n = 0;
    for (const s of sitzungen) if (store.isDirty('sitzungen', s)) n++;
    for (const m of mitglieder) if (store.isDirty('mitglieder', m)) n++;
    return n;
  }

  async function tick() {
    if (running) return;
    const client = GR.nocodb_client;
    if (!client || !client.isConfigured()) {
      setState({ status: 'unconfigured', pending: 0, lastError: '' });
      return;
    }
    running = true;

    let pendingNow = computePending();
    if (pendingNow === 0 && (state.lastError || state.status === 'syncing')) {
      // Nichts zu tun und kein offener Fehler → idle/ok
    }
    if (pendingNow === 0) {
      setState({ status: state.lastSyncAt ? 'ok' : 'idle', pending: 0 });
      running = false;
      return;
    }
    setState({ status: 'syncing', pending: pendingNow });

    let lastError = '';
    let anySuccess = false;

    // 1) Bestehende Queue zuerst
    try {
      const res = await client.syncQueue();
      if (res.errors.length) lastError = res.errors[0];
      if (res.ok > 0) anySuccess = true;
    } catch (e) {
      lastError = e.message;
    }

    // 2) Dirty-Sitzungen syncen
    const sitzungen = store.listSitzungen();
    for (const s of sitzungen) {
      if (!store.isDirty('sitzungen', s)) continue;
      try {
        await client.syncSitzungComplete(s);
        store.markSynced('sitzungen', s.id);
        anySuccess = true;
      } catch (e) {
        lastError = e.message;
        store.markSyncError('sitzungen', s.id, e.message);
        store.enqueueSync(s.id, e.message);
      }
    }

    // 3) Dirty-Mitglieder syncen
    const mitglieder = store.listMitglieder();
    for (const m of mitglieder) {
      if (!store.isDirty('mitglieder', m)) continue;
      try {
        await client.syncMitglied(m);
        store.markSynced('mitglieder', m.id);
        anySuccess = true;
      } catch (e) {
        lastError = e.message;
        store.markSyncError('mitglieder', m.id, e.message);
      }
    }

    const remaining = computePending();
    setState({
      status: lastError ? 'error' : (remaining === 0 ? 'ok' : 'syncing'),
      lastSyncAt: anySuccess ? new Date().toISOString() : state.lastSyncAt,
      lastError,
      pending: remaining,
    });
    running = false;
  }

  function start() {
    stop();
    const interval = Math.max(15, (store.getSettings().autoSyncIntervalSec || 60));
    timer = setInterval(tick, interval * 1000);
    setTimeout(tick, 1000);
    unsubscribeChange = store.onChange(() => {
      const pending = computePending();
      setState({ pending });
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(tick, 5000);
    });
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (unsubscribeChange) { unsubscribeChange(); unsubscribeChange = null; }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  function triggerNow() { return tick(); }

  GR.auto_sync = { start, stop, subscribe, triggerNow, getState: () => state };
})();
