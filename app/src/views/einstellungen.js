(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, downloadFile, pickFile, readFileAsText, readFileAsDataUrl, confirmDialog } = GR.ui;

  function renderEinstellungen(mount) {
    const settings = store.getSettings();

    const ortsInput = el('input', { type: 'text', value: settings.ortsname || '' });
    ortsInput.oninput = e => { settings.ortsname = e.target.value; store.saveSettings(settings); };

    const onBackup = () => {
      const data = store.exportAll();
      const filename = `gr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      downloadFile(filename, JSON.stringify(data, null, 2), 'application/json');
      toast('Backup heruntergeladen');
    };

    const onRestore = async () => {
      const file = await pickFile('.json');
      if (!file) return;
      if (!confirmDialog('Backup einspielen? Dadurch werden ALLE aktuellen Daten überschrieben.')) return;
      try {
        const text = await readFileAsText(file);
        const data = JSON.parse(text);
        store.importAll(data);
        toast('Backup eingespielt');
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        alert('Fehler beim Einlesen: ' + e.message);
      }
    };

    const onWipe = () => {
      if (!confirmDialog('Wirklich ALLE Daten (Sitzungen, Mitglieder, Einstellungen) löschen?')) return;
      localStorage.clear();
      toast('Alle Daten gelöscht');
      setTimeout(() => location.reload(), 600);
    };

    // --- Wappen-Upload ---
    const wappenPreview = el('div', { style: 'margin:8px 0;' });
    function refreshWappenPreview() {
      wappenPreview.innerHTML = '';
      const s = store.getSettings();
      if (s.wappenDataUrl) {
        wappenPreview.appendChild(el('img', { src: s.wappenDataUrl, style: 'max-height:80px; border:1px solid var(--border); border-radius:4px; background:white; padding:4px;' }));
        wappenPreview.appendChild(el('div', { class: 'help' }, 'Aktuell wird das hochgeladene Wappen verwendet.'));
      } else {
        wappenPreview.appendChild(el('img', { src: 'assets/wappen.png', style: 'max-height:80px; border:1px solid var(--border); border-radius:4px; background:white; padding:4px;', onerror: function () { this.style.display='none'; } }));
        wappenPreview.appendChild(el('div', { class: 'help' }, 'Aktuell wird (falls vorhanden) assets/wappen.png verwendet.'));
      }
    }
    refreshWappenPreview();

    const onUploadWappen = async () => {
      const file = await pickFile('image/*');
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const s = store.getSettings();
        s.wappenDataUrl = dataUrl;
        store.saveSettings(s);
        toast('Wappen gespeichert');
        refreshWappenPreview();
      } catch (e) {
        alert('Datei konnte nicht gelesen werden: ' + e.message);
      }
    };

    const onResetWappen = () => {
      const s = store.getSettings();
      delete s.wappenDataUrl;
      store.saveSettings(s);
      toast('Wappen zurückgesetzt');
      refreshWappenPreview();
    };

    mount.appendChild(el('h2', {}, 'Einstellungen'));
    mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Allgemein'),
      el('label', {}, 'Ortsname (erscheint im Protokoll-Footer)'),
      ortsInput,
    ]));

    mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Wappen'),
      el('p', { class: 'help' }, 'Das Wappen kann entweder fest unter assets/wappen.png liegen oder hier hochgeladen werden. Hochgeladene Wappen überschreiben die Datei und werden lokal im Browser gespeichert.'),
      wappenPreview,
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn-primary', onClick: onUploadWappen }, 'Wappen hochladen…'),
        el('button', { onClick: onResetWappen }, 'Auf Datei zurücksetzen'),
      ]),
    ]));

    // --- NocoDB-Direktexport ---
    const nc = settings.nocodb;
    const bindNocoInput = (key, type = 'text') => {
      const i = el('input', { type, value: nc[key] || '' });
      i.oninput = e => { nc[key] = e.target.value; store.saveSettings(settings); };
      return i;
    };
    const ncStatus = el('div', { class: 'help', style: 'margin-top:6px;' }, '');
    function setStatus(text, color) {
      ncStatus.textContent = text;
      ncStatus.style.color = color || '';
    }

    const onTest = async () => {
      try {
        const res = await GR.nocodb_client.testConnection();
        setStatus(`Verbindung OK — ${res.count} Tabelle(n) in der Base gefunden.`, '#2f855a');
      } catch (e) {
        setStatus('Fehler: ' + e.message, '#c53030');
      }
    };
    const onInitSchema = async () => {
      if (!confirmDialog('Fehlende Zieltabellen (Sitzungen / Beschluesse) in der konfigurierten NocoDB-Base anlegen?')) return;
      try {
        const log = await GR.nocodb_client.initSchema();
        setStatus(log.join(' · '), '#2f855a');
        toast('Schema initialisiert');
      } catch (e) {
        setStatus('Fehler: ' + e.message, '#c53030');
      }
    };
    const renderQueueList = () => {
      const queue = store.listQueue();
      if (queue.length === 0) return el('p', { class: 'help' }, 'Sync-Queue ist leer.');
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, 'Sitzung'), el('th', {}, 'Eingereiht'), el('th', {}, 'Letzter Fehler'), el('th', {}, '')])));
      const tbody = el('tbody');
      for (const item of queue) {
        const s = store.getSitzung(item.sitzungId);
        tbody.appendChild(el('tr', {}, [
          el('td', {}, s ? s.datum : '(gelöscht)'),
          el('td', {}, item.queuedAt.slice(0, 10)),
          el('td', { style: 'max-width:300px; word-break:break-word; font-size:0.85em; color:var(--muted);' }, item.lastError || ''),
          el('td', { style: 'text-align:right' }, [
            el('button', { class: 'btn-sm btn-danger', onClick: () => { store.removeFromQueue(item.id); refreshQueueBlock(); } }, 'Entfernen'),
          ]),
        ]));
      }
      table.appendChild(tbody);
      return table;
    };
    const queueContainer = el('div', { style: 'margin-top:10px;' });
    function refreshQueueBlock() {
      queueContainer.innerHTML = '';
      queueContainer.appendChild(renderQueueList());
    }
    refreshQueueBlock();

    const onRestoreFromNocoDb = async () => {
      if (!confirmDialog('Alle Sitzungen und Mitglieder aus NocoDB ziehen?\n\nLokal vorhandene Datensätze bleiben unverändert; nur fehlende werden ergänzt.')) return;
      try {
        setStatus('Lade aus NocoDB…', '');
        const res = await GR.nocodb_client.restoreFromNocoDb();
        setStatus(`Wiederherstellung: ${res.sitzungenHinzugefuegt} Sitzung(en) und ${res.mitgliederHinzugefuegt} Mitglied(er) hinzugefügt.`, '#2f855a');
        toast('Wiederherstellung abgeschlossen');
      } catch (e) {
        setStatus('Fehler: ' + e.message, '#c53030');
      }
    };

    const onToggleAutoSync = (checked) => {
      const s = store.getSettings();
      s.autoSync = !!checked;
      store.saveSettings(s);
      if (GR.auto_sync) {
        if (s.autoSync) GR.auto_sync.start();
        else GR.auto_sync.stop();
      }
    };

    const onSyncQueue = async () => {
      try {
        const res = await GR.nocodb_client.syncQueue();
        if (res.ok > 0 && res.fail === 0) toast(`${res.ok} Sitzung(en) synchronisiert`);
        else if (res.ok > 0) toast(`${res.ok} synchronisiert, ${res.fail} Fehler`);
        else toast(`${res.fail} Fehler beim Sync`);
        if (res.errors.length) setStatus('Fehler: ' + res.errors[0], '#c53030');
        refreshQueueBlock();
      } catch (e) {
        setStatus('Fehler: ' + e.message, '#c53030');
      }
    };

    mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'NocoDB-Direktexport'),
      el('p', { class: 'help' }, 'Sitzungen können nach Abschluss direkt in eine NocoDB-Instanz gepusht werden (API v2, Upsert per UUID). Token und URL werden ausschließlich im Browser gespeichert.'),
      el('div', { class: 'warn' }, 'Wichtig: Die NocoDB-Instanz muss CORS für diese App erlauben (Env-Variable NC_CORS_ORIGIN=*), sonst blockiert der Browser jeden Request.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Server-URL (z. B. https://nocodb.example.com)'), bindNocoInput('serverUrl')]),
        el('div', {}, [el('label', {}, 'API-Token'), bindNocoInput('token', 'password')]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Base-ID'), bindNocoInput('baseId')]),
        el('div', {}, [el('label', {}, 'Tabelle Sitzungen'), bindNocoInput('tableSitzungenName')]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Tabelle Beschluesse'), bindNocoInput('tableBeschluesseName')]),
        el('div', {}, [el('label', {}, 'Tabelle Mitglieder'), bindNocoInput('tableMitgliederName')]),
      ]),
      (() => {
        const cb = el('input', { type: 'checkbox', checked: !!settings.autoSync });
        cb.onchange = () => onToggleAutoSync(cb.checked);
        return el('label', { style: 'display:flex; gap:8px; align-items:center; margin-top:10px;' }, [
          cb, ' Automatisch im Hintergrund sichern (ca. alle ' + (settings.autoSyncIntervalSec || 60) + ' s)',
        ]);
      })(),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onTest }, 'Verbindung testen'),
        el('button', { onClick: onInitSchema }, 'Schema initialisieren'),
        el('div', { class: 'spacer' }),
        el('button', { onClick: onSyncQueue }, 'Queue jetzt synchronisieren'),
        el('button', { onClick: onRestoreFromNocoDb }, 'Aus NocoDB wiederherstellen…'),
      ]),
      ncStatus,
      el('h3', { style: 'margin-top:16px;' }, 'Offline-Queue'),
      el('p', { class: 'help' }, 'Sitzungen, die beim Push-Versuch nicht hochgeladen werden konnten, landen hier und können später erneut synchronisiert werden.'),
      queueContainer,
    ]));

    mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Backup'),
      el('p', { class: 'help' }, 'Sichern Sie regelmäßig den gesamten Datenbestand als JSON. Sie können diese Datei jederzeit wieder einspielen — z. B. nach Browserwechsel.'),
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn-primary', onClick: onBackup }, 'Backup herunterladen (JSON)'),
        el('button', { onClick: onRestore }, 'Backup einspielen…'),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn-danger', onClick: onWipe }, 'Alle Daten löschen'),
      ]),
    ]));
  }

  GR.views = GR.views || {};
  GR.views.renderEinstellungen = renderEinstellungen;
})();
