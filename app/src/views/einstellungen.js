(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const M = GR.models;
  const { el, toast, downloadFile, pickFile, readFileAsText, readFileAsDataUrl, confirmDialog, formatDatum } = GR.ui;

  const euro = (n) => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  function heuteIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

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

    // Einstellungen nach Kategorien gegliedert – je Bereich ein eigener Container.
    const C = {
      allgemein: el('div'), darstellung: el('div'), dokumente: el('div'), kalender: el('div'), aufgaben: el('div'),
      mail: el('div'),
      vorgaenge: el('div'), vermietung: el('div'), vertraege: el('div'), auslagen: el('div'),
      arbeitszeiten: el('div'), inventar: el('div'), einwohner: el('div'), daten: el('div'),
    };

    C.allgemein.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Allgemein'),
      el('label', {}, 'Ortsname (erscheint im Protokoll-Footer)'),
      ortsInput,
    ]));

    C.darstellung.appendChild(el('div', { class: 'card' }, [
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
      if (!confirmDialog('Fehlende Zieltabellen (Sitzungen, Beschluesse, Mitglieder, Mieter, Raeume, Vermietungen, Empfaenger, Haushaltsstellen, Auslagen) in der konfigurierten NocoDB-Base anlegen?')) return;
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
      if (!confirmDialog('Den gesamten Datenbestand aus NocoDB ziehen?\n\nAlle Module (Sitzungen, Mitglieder, Vermietung, Auslagen, Verträge, Vorgänge, Arbeitszeiten …) werden geprüft.\n\nLokal vorhandene Datensätze bleiben unverändert; nur fehlende werden ergänzt.')) return;
      try {
        setStatus('Lade aus NocoDB…', '');
        const res = await GR.nocodb_client.restoreFromNocoDb();
        const txt = res.details && res.details.length
          ? 'Wiederhergestellt: ' + res.details.join(' · ')
          : 'Wiederherstellung abgeschlossen – es fehlte lokal nichts.';
        const fehler = (res.fehler && res.fehler.length) ? ' — Hinweise: ' + res.fehler.join(' · ') : '';
        setStatus(txt + fehler, fehler ? '#b7791f' : '#2f855a');
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

    C.daten.appendChild(el('div', { class: 'card' }, [
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

    // --- Dokumente / Paperless-Zugang (serverseitig gespeichert) ---
    const api = GR.api;
    const ppUrlInput = el('input', { type: 'text', placeholder: 'http://192.168.1.20:8000' });
    const ppTokenInput = el('input', { type: 'password', placeholder: 'Token laden…', autocomplete: 'new-password' });
    const ppStatus = el('div', { class: 'help', style: 'margin-top:6px;' }, '');
    const setPpStatus = (t, c) => { ppStatus.textContent = t; ppStatus.style.color = c || ''; };
    const tokenPlaceholder = has => (has ? '•••••••• (gesetzt – leer lassen = behalten)' : 'API-Token aus Paperless einfügen');

    function loadPpConfig() {
      api.getDocConfig().then(cfg => {
        ppUrlInput.value = cfg.url || '';
        ppTokenInput.value = '';
        ppTokenInput.placeholder = tokenPlaceholder(cfg.hasToken);
        setPpStatus(cfg.source === 'env' ? 'Aktuell aus der Server-Umgebung (Env). Speichern hier überschreibt sie dauerhaft.' : '', '');
      }).catch(e => setPpStatus('Konfiguration konnte nicht geladen werden: ' + e.message, '#c53030'));
    }

    const onPpSave = async () => {
      try {
        const body = { url: ppUrlInput.value.trim() };
        const tok = ppTokenInput.value.trim();
        if (tok) body.token = tok; // leer => bestehenden Token behalten
        const cfg = await api.putDocConfig(body);
        toast('Paperless-Zugang gespeichert');
        ppTokenInput.value = '';
        ppTokenInput.placeholder = tokenPlaceholder(cfg.hasToken);
        setPpStatus('Gespeichert. Mit „Verbindung testen" prüfen.', '#2f855a');
      } catch (e) { setPpStatus('Speichern fehlgeschlagen: ' + e.message, '#c53030'); }
    };

    const onPpTest = async () => {
      setPpStatus('Teste Verbindung…', '');
      try {
        const h = await api.docHealth();
        if (h && h.ok) setPpStatus('Verbindung OK — Paperless erreichbar (' + (h.url || '') + ').', '#2f855a');
        else setPpStatus('Fehler: ' + ((h && h.error) || 'unbekannt'), '#c53030');
      } catch (e) { setPpStatus('Fehler: ' + e.message, '#c53030'); }
    };

    C.dokumente.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Dokumente (Paperless-ngx)'),
      el('p', { class: 'help' }, 'Zugang zur Paperless-Instanz. URL und Token werden serverseitig im Container gespeichert (nicht im Browser) und ausschließlich vom Backend verwendet.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Paperless-URL (vom Container erreichbar)'), ppUrlInput]),
        el('div', {}, [el('label', {}, 'API-Token (Paperless: Mein Profil → API-Token)'), ppTokenInput]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onPpSave }, 'Speichern'),
        el('button', { onClick: onPpTest }, 'Verbindung testen'),
      ]),
      ppStatus,
    ]));
    loadPpConfig();

    // --- Kalender: iCal-Abos (serverseitig geladen) ---
    const calListBox = el('div', {});
    const calStatus = el('div', { class: 'help', style: 'margin-top:6px;' }, '');
    const setCalStatus = (t, c) => { calStatus.textContent = t; calStatus.style.color = c || ''; };
    let calItems = []; // [{ id, name, url }]

    function renderCalList() {
      calListBox.innerHTML = '';
      if (!calItems.length) {
        calListBox.appendChild(el('p', { class: 'help' }, 'Noch keine Kalender abonniert. Mit „+ Kalender" eine iCal-Abo-URL hinzufügen.'));
        return;
      }
      calItems.forEach((item, idx) => {
        const nameI = el('input', { type: 'text', value: item.name || '', placeholder: 'Bezeichnung (z. B. Müllabfuhr)' });
        nameI.oninput = e => { item.name = e.target.value; };
        const urlI = el('input', { type: 'text', value: item.url || '', placeholder: 'https://…/basic.ics' });
        urlI.oninput = e => { item.url = e.target.value.trim(); };
        const testBtn = el('button', { class: 'btn-sm', onClick: async () => {
          if (!item.url) { setCalStatus('Bitte zuerst eine URL eintragen.', '#c53030'); return; }
          setCalStatus('Teste „' + (item.name || item.url) + '“…', '');
          try {
            const r = await GR.api.testCalUrl(item.url);
            if (r.ok) setCalStatus(`„${item.name || item.url}“ OK — ${r.events} Termin(e) gefunden.`, '#2f855a');
            else setCalStatus('Fehler: ' + (r.error || 'unbekannt'), '#c53030');
          } catch (e) { setCalStatus('Fehler: ' + e.message, '#c53030'); }
        } }, 'Testen');
        const delBtn = el('button', { class: 'btn-sm btn-danger', onClick: () => { calItems.splice(idx, 1); renderCalList(); } }, 'Entfernen');
        calListBox.appendChild(el('div', { class: 'card', style: 'background:#fafbfc; margin-bottom:8px;' }, [
          el('div', { class: 'grid-2' }, [
            el('div', {}, [el('label', {}, 'Bezeichnung'), nameI]),
            el('div', {}, [el('label', {}, 'iCal-Abo-URL'), urlI]),
          ]),
          el('div', { class: 'toolbar', style: 'margin-top:8px;' }, [testBtn, el('div', { class: 'spacer' }), delBtn]),
        ]));
      });
    }

    function loadCalConfig() {
      GR.api.getCalConfig().then(cfg => {
        calItems = (cfg.calendars || []).map(c => ({ id: c.id, name: c.name || '', url: c.url || '' }));
        renderCalList();
        if (cfg.source === 'env') setCalStatus('Aktuell aus der Server-Umgebung (Env). Speichern hier überschreibt sie dauerhaft.', '');
      }).catch(e => setCalStatus('Konfiguration konnte nicht geladen werden: ' + e.message, '#c53030'));
    }

    const onCalAdd = () => { calItems.push({ id: '', name: '', url: '' }); renderCalList(); };
    const onCalSave = async () => {
      const clean = calItems.filter(c => c.url).map(c => ({ id: c.id || '', name: c.name || '', url: c.url }));
      try {
        const cfg = await GR.api.putCalConfig(clean);
        calItems = (cfg.calendars || []).map(c => ({ id: c.id, name: c.name || '', url: c.url || '' }));
        renderCalList();
        toast('Kalender gespeichert');
        setCalStatus('Gespeichert. Die Termine erscheinen im Dashboard und unter „Termine".', '#2f855a');
      } catch (e) { setCalStatus('Speichern fehlgeschlagen: ' + e.message, '#c53030'); }
    };

    C.kalender.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Kalender (iCal-Abos)'),
      el('p', { class: 'help' }, 'Externe Kalender per Abo-URL (iCal/ICS) einbinden – z. B. aus Google Kalender, Nextcloud oder der Müllabfuhr. Die Kalender werden serverseitig geladen (nur lesend) und im Dashboard sowie unter „Termine" angezeigt. URLs werden serverseitig im Container gespeichert.'),
      el('div', { class: 'help', style: 'margin-bottom:8px;' }, 'Tipp: In Google Kalender unter „Einstellungen → Kalender → Integration“ die „Geheime Adresse im iCal-Format“ kopieren.'),
      calListBox,
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { onClick: onCalAdd }, '+ Kalender'),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn-primary', onClick: onCalSave }, 'Speichern'),
      ]),
      calStatus,
    ]));
    loadCalConfig();

    // --- Aufgaben / Vikunja-Zugang (serverseitig gespeichert) ---
    const vkUrlInput = el('input', { type: 'text', placeholder: 'http://192.168.1.40:3456' });
    const vkTokenInput = el('input', { type: 'password', placeholder: 'API-Token…', autocomplete: 'new-password' });
    const vkStatus = el('div', { class: 'help', style: 'margin-top:6px;' }, '');
    const setVkStatus = (t, c) => { vkStatus.textContent = t; vkStatus.style.color = c || ''; };
    const vkTokenPlaceholder = has => (has ? '•••••••• (gesetzt – leer lassen = behalten)' : 'API-Token aus Vikunja einfügen');

    function loadVkConfig() {
      api.getTaskConfig().then(cfg => {
        vkUrlInput.value = cfg.url || '';
        vkTokenInput.value = '';
        vkTokenInput.placeholder = vkTokenPlaceholder(cfg.hasToken);
        setVkStatus(cfg.source === 'env' ? 'Aktuell aus der Server-Umgebung (Env). Speichern hier überschreibt sie dauerhaft.' : '', '');
      }).catch(e => setVkStatus('Konfiguration konnte nicht geladen werden: ' + e.message, '#c53030'));
    }

    const onVkSave = async () => {
      try {
        const body = { url: vkUrlInput.value.trim() };
        const tok = vkTokenInput.value.trim();
        if (tok) body.token = tok;
        const cfg = await api.putTaskConfig(body);
        toast('Vikunja-Zugang gespeichert');
        vkTokenInput.value = '';
        vkTokenInput.placeholder = vkTokenPlaceholder(cfg.hasToken);
        setVkStatus('Gespeichert. Mit „Verbindung testen" prüfen.', '#2f855a');
      } catch (e) { setVkStatus('Speichern fehlgeschlagen: ' + e.message, '#c53030'); }
    };

    const onVkTest = async () => {
      setVkStatus('Teste Verbindung…', '');
      try {
        const h = await api.taskHealth();
        if (h && h.ok) setVkStatus('Verbindung OK — Vikunja erreichbar (' + (h.url || '') + ').', '#2f855a');
        else setVkStatus('Fehler: ' + ((h && h.error) || 'unbekannt'), '#c53030');
      } catch (e) { setVkStatus('Fehler: ' + e.message, '#c53030'); }
    };

    C.aufgaben.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Aufgaben (Vikunja)'),
      el('p', { class: 'help' }, 'Zugang zur Vikunja-Instanz. URL und API-Token werden serverseitig im Container gespeichert (nicht im Browser) und ausschließlich vom Backend verwendet.'),
      el('div', { class: 'help', style: 'margin-bottom:8px;' }, 'Token in Vikunja unter „Einstellungen → API-Tokens" anlegen – mit Lese- UND Schreibrecht für Aufgaben/Projekte, damit Abhaken und Anlegen funktionieren.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Vikunja-URL (ohne /api/v1)'), vkUrlInput]),
        el('div', {}, [el('label', {}, 'API-Token'), vkTokenInput]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onVkSave }, 'Speichern'),
        el('button', { onClick: onVkTest }, 'Verbindung testen'),
      ]),
      vkStatus,
    ]));
    loadVkConfig();

    // Synchronisiertes Projekt (app-weit: Aufgaben-Modul + Vorgangs-ToDos)
    const syncProjSel = el('select', {}, [el('option', { value: '' }, 'Projekt lädt…')]);
    GR.api.listTaskProjects().then(res => {
      syncProjSel.innerHTML = '';
      syncProjSel.appendChild(el('option', { value: '' }, '– kein Projekt –'));
      (res.projects || []).forEach(p => syncProjSel.appendChild(el('option', { value: String(p.id), selected: String(settings.vikunjaProjektId || '') === String(p.id) }, p.title)));
    }).catch(() => { syncProjSel.innerHTML = ''; syncProjSel.appendChild(el('option', { value: '' }, 'Projekte nicht ladbar (Zugang prüfen)')); });
    syncProjSel.onchange = () => {
      settings.vikunjaProjektId = syncProjSel.value ? (isNaN(Number(syncProjSel.value)) ? syncProjSel.value : Number(syncProjSel.value)) : null;
      store.saveSettings(settings);
    };
    // --- E-Mail (IMAP/SMTP des Gemeinde-Postfachs) ---
    const mlHost = el('input', { type: 'text', placeholder: 's101.evanzo-server.de' });
    const mlUser = el('input', { type: 'text', placeholder: 'buergermeister@meine-domain.de' });
    const mlPass = el('input', { type: 'password', placeholder: 'Passwort' });
    const mlImap = el('input', { type: 'number', step: '1', value: '993', style: 'max-width:120px;' });
    const mlSmtp = el('input', { type: 'number', step: '1', value: '587', style: 'max-width:120px;' });
    const mlFrom = el('input', { type: 'text', placeholder: 'leer = Benutzeradresse' });
    const mlFromName = el('input', { type: 'text', placeholder: 'Ortsgemeinde Hörschhausen' });
    const mlSent = el('input', { type: 'text', placeholder: 'Sent', style: 'max-width:200px;' });
    const mlStatus = el('div', { class: 'help', style: 'margin-top:8px;' }, '');
    function setMlStatus(t, c) { mlStatus.textContent = t; mlStatus.style.color = c || ''; }

    function loadMlConfig() {
      GR.api.getMailConfig().then(c => {
        mlHost.value = c.host || '';
        mlUser.value = c.user || '';
        mlImap.value = c.imapPort || 993;
        mlSmtp.value = c.smtpPort || 587;
        mlFrom.value = c.from || '';
        mlFromName.value = c.fromName || '';
        mlSent.value = c.sentBox || 'Sent';
        mlPass.placeholder = c.hasPass ? '(gesetzt – leer lassen zum Behalten)' : 'Passwort';
        setMlStatus(c.hasPass ? 'Zugang hinterlegt (Quelle: ' + c.source + ')' : 'Noch kein Passwort hinterlegt.');
      }).catch(e => setMlStatus('Konfiguration nicht ladbar: ' + e.message, '#c53030'));
    }
    const onMlSave = async () => {
      try {
        await GR.api.putMailConfig({
          host: mlHost.value.trim(), user: mlUser.value.trim(), pass: mlPass.value,
          imapPort: Number(mlImap.value) || 993, smtpPort: Number(mlSmtp.value) || 587,
          from: mlFrom.value.trim(), fromName: mlFromName.value.trim(),
          sentBox: mlSent.value.trim() || 'Sent',
        });
        mlPass.value = '';
        setMlStatus('Gespeichert.', '#2f855a');
        loadMlConfig();
      } catch (e) { setMlStatus('Fehler: ' + e.message, '#c53030'); }
    };
    const onMlTest = async () => {
      setMlStatus('Wird geprüft …');
      try {
        const r = await GR.api.testMail();
        const teile = [
          'IMAP: ' + (r.imap && r.imap.ok ? ('ok' + (r.imap.nachrichten != null ? ' (' + r.imap.nachrichten + ' Nachrichten)' : '')) : ('Fehler – ' + ((r.imap && r.imap.error) || '?'))),
          'SMTP: ' + (r.smtp && r.smtp.ok ? 'ok' : ('Fehler – ' + ((r.smtp && r.smtp.error) || '?'))),
        ];
        setMlStatus(teile.join('  ·  '), r.ok ? '#2f855a' : '#c53030');
      } catch (e) { setMlStatus('Fehler: ' + e.message, '#c53030'); }
    };

    C.mail.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'E-Mail-Postfach'),
      el('p', { class: 'help' }, 'Zugang zum Postfach der Gemeinde (IMAP zum Lesen, SMTP zum Senden). Host, Benutzer und Passwort werden serverseitig im Container gespeichert – nicht im Browser – und laufen nicht in die NocoDB-Sicherung.'),
      el('div', { class: 'help', style: 'margin-bottom:8px;' }, 'Übliche Ports: IMAP 993 (SSL), SMTP 587 (STARTTLS) oder 465 (SSL).'),
      el('div', { class: 'help', style: 'margin-bottom:8px;' }, 'Wichtig bei Evanzo und anderem Shared-Hosting: Hier gehört der Servername des Anbieters hinein (z. B. s101.evanzo-server.de), NICHT mail.eigene-domain.de. Beide zeigen zwar auf dieselbe Maschine, aber nur der Anbietername steht im TLS-Zertifikat. Meldet der Test „does not match certificate\'s altnames", steht der richtige Name in der Fehlermeldung hinter „cert\'s altnames: DNS:" – den hier eintragen. Der Benutzername bleibt die vollständige E-Mail-Adresse.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Server (IMAP und SMTP)'), mlHost]),
        el('div', {}, [el('label', {}, 'Benutzer / E-Mail-Adresse'), mlUser]),
        el('div', {}, [el('label', {}, 'Passwort'), mlPass]),
        el('div', {}, [el('label', {}, 'Absenderadresse (optional, sonst Benutzer)'), mlFrom]),
        el('div', {}, [el('label', {}, 'Absendername (erscheint beim Empfänger)'), mlFromName]),
      ]),
      el('div', { class: 'grid-2', style: 'margin-top:8px;' }, [
        el('div', {}, [el('label', {}, 'IMAP-Port'), mlImap]),
        el('div', {}, [el('label', {}, 'SMTP-Port'), mlSmtp]),
        el('div', {}, [el('label', {}, 'Ordner „Gesendet"'), mlSent]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onMlSave }, 'Speichern'),
        el('button', { onClick: onMlTest }, 'Verbindung testen'),
      ]),
      mlStatus,
    ]));
    loadMlConfig();

    C.aufgaben.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Synchronisiertes Projekt'),
      el('p', { class: 'help' }, 'Nur die Aufgaben dieses Projekts werden in der Gemeindeverwaltung angezeigt; das Aufgaben-Modul und ToDos aus Vorgängen legen neue Aufgaben hier an. Gilt app-weit.'),
      el('div', {}, [el('label', {}, 'Projekt'), syncProjSel]),
    ]));

    // --- Vermietung: Preise & Absenderdaten ---
    const numInput = (obj, key, step = '0.01') => {
      const i = el('input', { type: 'number', step, value: obj[key] ?? 0 });
      i.oninput = () => { obj[key] = i.value === '' ? 0 : Number(i.value); };
      return i;
    };
    const raeume = store.listRaeume();
    const raumCards = raeume.map(r => {
      const save = () => store.saveRaum(r);
      const artSel = el('select', {});
      [['verbrauch', 'Verbrauchsabrechnung (Grundmiete + Strom/Gas)'], ['pauschal', 'Pauschale (fester Betrag, Strom/Gas inkl.)']]
        .forEach(([val, lbl]) => artSel.appendChild(el('option', { value: val, selected: (r.abrechnungsart || 'verbrauch') === val }, lbl)));

      const fieldsBox = el('div', {});
      function renderFields() {
        fieldsBox.innerHTML = '';
        const g = r.preise.grund;
        if (r.abrechnungsart === 'pauschal') {
          const a = numInput(g, 'anwohnerTag1'); const o = numInput(g, 'ortsfremdTag1');
          a.onchange = save; o.onchange = save;
          fieldsBox.appendChild(el('div', { class: 'grid-2' }, [
            el('div', {}, [el('label', {}, 'Pauschale Anwohner (€)'), a]),
            el('div', {}, [el('label', {}, 'Pauschale Ortsfremd (€)'), o]),
          ]));
          fieldsBox.appendChild(el('p', { class: 'help' }, 'Ein fester Betrag je Vermietung. Strom und Gas sind in der Pauschale enthalten – es werden keine Zählerstände erfasst.'));
        } else {
          const f = [
            numInput(g, 'anwohnerTag1'), numInput(g, 'anwohnerWeitererTag'),
            numInput(g, 'ortsfremdTag1'), numInput(g, 'ortsfremdWeitererTag'),
            numInput(r.preise, 'stromProKwh', '0.001'), numInput(r.preise, 'gasProCbm', '0.001'),
          ];
          f.forEach(x => x.onchange = save);
          fieldsBox.appendChild(el('div', { class: 'grid-2' }, [
            el('div', {}, [el('label', {}, 'Anwohner – 1. Tag (€)'), f[0]]),
            el('div', {}, [el('label', {}, 'Anwohner – jeder weitere Tag (€)'), f[1]]),
            el('div', {}, [el('label', {}, 'Ortsfremd – 1. Tag (€)'), f[2]]),
            el('div', {}, [el('label', {}, 'Ortsfremd – jeder weitere Tag (€)'), f[3]]),
            el('div', {}, [el('label', {}, 'Strom (€/kWh)'), f[4]]),
            el('div', {}, [el('label', {}, 'Gas (€/cbm)'), f[5]]),
          ]));
        }
      }
      artSel.onchange = () => { r.abrechnungsart = artSel.value; save(); renderFields(); };
      renderFields();

      return el('div', { class: 'card', style: 'background:#fafbfc;' }, [
        el('h4', { style: 'margin:0 0 10px;' }, r.name),
        el('div', { style: 'margin-bottom:10px;' }, [el('label', {}, 'Abrechnungsart'), artSel]),
        fieldsBox,
      ]);
    });

    const vm = settings.vermietung;
    const bindVm = (key, textarea = false) => {
      const i = textarea ? el('textarea', {}, vm[key] || '') : el('input', { type: 'text', value: vm[key] || '' });
      i.oninput = e => { vm[key] = e.target.value; };
      i.onchange = () => store.saveSettings(settings);
      return i;
    };

    C.vermietung.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Vermietung – Preise'),
      el('p', { class: 'help' }, 'Grundmiete gestaffelt nach 1. Tag / jedem weiteren Tag und getrennt für Anwohner und Ortsfremde. Änderungen gelten nur für neue Verträge – bereits erstellte Verträge behalten ihre eingefrorenen Preise.'),
      raeume.length ? el('div', {}, raumCards) : el('p', { class: 'help' }, 'Keine Objekte vorhanden.'),
    ]));

    C.vermietung.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Vermietung – Absender & Vertragsdaten'),
      el('p', { class: 'help' }, 'Diese Angaben erscheinen im Mietvertrag und Kostenabrechnungsbogen.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Ortsgemeinde'), bindVm('ortsgemeinde')]),
        el('div', {}, [el('label', {}, 'Ortsbürgermeister/in'), bindVm('buergermeister')]),
        el('div', {}, [el('label', {}, 'Telefon'), bindVm('telefon')]),
        el('div', {}, [el('label', {}, 'E-Mail'), bindVm('email')]),
        el('div', {}, [el('label', {}, 'Satzungsdatum'), bindVm('satzungsDatum')]),
      ]),
      el('div', { style: 'margin-top:10px;' }, [el('label', {}, 'Anschrift (mehrzeilig)'), bindVm('anschrift', true)]),
      el('div', { style: 'margin-top:10px;' }, [el('label', {}, 'Empfänger Kostenabrechnungsbogen (VG)'), bindVm('vgEmpfaenger', true)]),
    ]));

    // --- Bargeldauslagen: Absender, Unterschrift, Scanner ---
    const au = settings.auslagen;
    const bindAu = (key) => {
      const i = el('input', { type: 'text', value: au[key] || '' });
      i.oninput = e => { au[key] = e.target.value; };
      i.onchange = () => store.saveSettings(settings);
      return i;
    };

    // Unterschrift Bürgermeister: direkt unterschreiben (wie bei den
    // Vermietungen) ODER ein Bild hochladen. Beide Wege legen zusätzlich die
    // Pixelmaße (w/h) ab, damit die PDFs seitenverhältnistreu einbetten können
    // statt in einen festen Kasten zu quetschen.
    const sigPreview = el('div', { style: 'margin:8px 0;' });
    function refreshSigPreview() {
      sigPreview.innerHTML = '';
      if (au.unterschriftDataUrl) {
        sigPreview.appendChild(el('img', {
          src: au.unterschriftDataUrl,
          style: 'max-height:70px; border:1px solid var(--border); border-radius:4px; background:white; padding:4px;',
        }));
        if (!(au.unterschriftW > 0 && au.unterschriftH > 0)) {
          sigPreview.appendChild(el('div', { class: 'help', style: 'margin-top:4px;' },
            'Ältere Unterschrift ohne Maßangabe – wird im PDF in einen festen Kasten gezeichnet und kann verzerrt wirken. Einmal neu unterschreiben oder neu hochladen behebt das.'));
        }
      } else {
        sigPreview.appendChild(el('div', { class: 'help' }, 'Keine Unterschrift hinterlegt – die Bürgermeister-Linie bleibt im PDF leer.'));
      }
    }
    refreshSigPreview();

    function saveSig(dataUrl, w, h) {
      au.unterschriftDataUrl = dataUrl;
      au.unterschriftW = w || null;
      au.unterschriftH = h || null;
      store.saveSettings(settings);
      toast('Unterschrift gespeichert');
      refreshSigPreview();
    }

    const onSignSig = () => {
      GR.ui.captureSignature({
        title: 'Unterschrift Bürgermeister',
        subtitle: 'Wird in Kostenabrechnung, Mietvertrag und Auslagen-PDF über die Bürgermeister-Linie gesetzt.',
        name: au.buergermeisterName || '',
        onDone: (res) => { if (res && res.dataUrl) saveSig(res.dataUrl, res.w, res.h); },
      });
    };

    const onUploadSig = async () => {
      const file = await pickFile('image/png,image/*');
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        // Naturmaße messen, damit auch hochgeladene Bilder unverzerrt bleiben.
        const masse = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: null, h: null });
          img.src = dataUrl;
        });
        saveSig(dataUrl, masse.w, masse.h);
      } catch (e) { alert('Datei konnte nicht gelesen werden: ' + e.message); }
    };

    const onResetSig = () => {
      au.unterschriftDataUrl = '';
      au.unterschriftW = null;
      au.unterschriftH = null;
      store.saveSettings(settings);
      toast('Unterschrift entfernt');
      refreshSigPreview();
    };

    // Scanner
    const scannerInput = el('input', { type: 'text', value: au.scannerUrl || '', placeholder: 'z. B. http://192.168.1.30' });
    scannerInput.oninput = () => { au.scannerUrl = scannerInput.value.trim(); };
    scannerInput.onchange = () => store.saveSettings(settings);
    const scannerStatus = el('div', { class: 'help', style: 'margin-top:6px;' }, '');
    const scannerList = el('div', { style: 'margin-top:6px;' });
    const onDiscover = async () => {
      scannerStatus.textContent = 'Suche Scanner im Netzwerk…'; scannerStatus.style.color = '';
      scannerList.innerHTML = '';
      try {
        const found = await GR.api.listScanners();
        if (!found.length) { scannerStatus.textContent = 'Keine Scanner gefunden. URL bitte manuell eintragen.'; return; }
        scannerStatus.textContent = `${found.length} Scanner gefunden:`; scannerStatus.style.color = '#2f855a';
        for (const sc of found) {
          scannerList.appendChild(el('div', { class: 'toolbar', style: 'margin:4px 0;' }, [
            el('span', { style: 'align-self:center;' }, `${sc.name} (${sc.url})`),
            el('button', { class: 'btn-sm', onClick: () => { au.scannerUrl = sc.url; scannerInput.value = sc.url; store.saveSettings(settings); toast('Scanner übernommen'); } }, 'Auswählen'),
          ]));
        }
      } catch (e) { scannerStatus.textContent = 'Fehler: ' + e.message; scannerStatus.style.color = '#c53030'; }
    };
    const onTestScanner = async () => {
      if (!au.scannerUrl) { scannerStatus.textContent = 'Bitte zuerst eine Scanner-URL eintragen.'; scannerStatus.style.color = '#c53030'; return; }
      scannerStatus.textContent = 'Teste Verbindung…'; scannerStatus.style.color = '';
      try {
        const res = await GR.api.scanHealth(au.scannerUrl);
        scannerStatus.textContent = res.ok ? 'Scanner erreichbar ✓' : 'Fehler: ' + (res.error || 'unbekannt');
        scannerStatus.style.color = res.ok ? '#2f855a' : '#c53030';
      } catch (e) { scannerStatus.textContent = 'Fehler: ' + e.message; scannerStatus.style.color = '#c53030'; }
    };

    C.auslagen.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Bargeldauslagen'),
      el('p', { class: 'help' }, 'Absenderangaben und Namen für das Bar-Auslage-Formular, Bürgermeister-Unterschrift und der Netzwerkscanner.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Ortsgemeinde'), bindAu('ortsgemeinde')]),
        el('div', {}, [el('label', {}, 'Quittungs-Ort (z. B. Kelberg)'), bindAu('quittungOrt')]),
        el('div', {}, [el('label', {}, 'Name Bürgermeister (unter der Linie)'), bindAu('buergermeisterName')]),
        el('div', {}, [el('label', {}, 'Name Ortsbeigeordneter (unter der Linie)'), bindAu('ortsbeigeordneterName')]),
      ]),
      el('h4', { style: 'margin:14px 0 4px;' }, 'Unterschrift Bürgermeister'),
      el('p', { class: 'help' }, 'Wird automatisch über die Bürgermeister-Linie ins PDF gesetzt (Auslagen-Formular, Mietvertrag, Kostenabrechnung). Am einfachsten direkt hier unterschreiben – mit Finger oder Stift auf Handy/Tablet. Alternativ ein Bild hochladen (PNG mit transparentem Hintergrund empfohlen).'),
      sigPreview,
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn-primary', onClick: onSignSig }, '✍ Jetzt unterschreiben'),
        el('button', { onClick: onUploadSig }, 'Bild hochladen…'),
        el('button', { onClick: onResetSig }, 'Entfernen'),
      ]),
      el('h4', { style: 'margin:14px 0 4px;' }, 'Netzwerkscanner (eSCL/AirScan · SANE/WSD)'),
      el('p', { class: 'help' }, 'Scanner automatisch suchen und als Standard übernehmen oder die URL manuell eintragen. Beim Scannen werden die Seiten als Belege angelegt.'),
      el('p', { class: 'help' }, 'Es werden zwei Wege durchsucht: eSCL/AirScan-Geräte (wie der Brother) und – falls auf dem Server „scanimage" installiert ist – SANE-Geräte (mit „(SANE)" markiert). Über SANE werden auch reine WSD-Scanner wie der Epson ES-580W eingebunden. SANE-Geräte tragen intern die Kennung „sane:…".'),
      el('label', {}, 'Scanner-URL bzw. -Kennung'),
      scannerInput,
      el('div', { class: 'toolbar', style: 'margin-top:8px;' }, [
        el('button', { class: 'btn-primary', onClick: onDiscover }, 'Scanner im Netzwerk suchen'),
        el('button', { onClick: onTestScanner }, 'Scanner testen'),
      ]),
      scannerStatus,
      scannerList,
    ]));

    // --- Verträge und Pacht: Standardwerte + Kategorien ---
    const vt = settings.vertraege;
    const bindVtNum = (key) => {
      const i = el('input', { type: 'number', min: '0', value: vt[key] != null ? vt[key] : 0, style: 'width:120px;' });
      i.oninput = e => { vt[key] = e.target.value === '' ? 0 : Number(e.target.value); };
      i.onchange = () => store.saveSettings(settings);
      return i;
    };
    const kategorienInput = el('textarea', { style: 'width:100%;' }, (vt.kategorien || []).join('\n'));
    kategorienInput.oninput = e => {
      vt.kategorien = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
    };
    kategorienInput.onchange = () => store.saveSettings(settings);

    C.vertraege.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Verträge und Pacht'),
      el('p', { class: 'help' }, 'Vorgaben für neue Verträge und die Auswahlliste der Kategorien.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Standard-Erinnerung (Tage vor Kündigungstermin)'), bindVtNum('standardVorlaufTage')]),
        el('div', {}, [el('label', {}, 'Standard-Kündigungsfrist (Monate)'), bindVtNum('standardKuendigungsfristMonate')]),
      ]),
      el('div', { style: 'margin-top:10px;' }, [
        el('label', {}, 'Kategorien (eine pro Zeile)'),
        kategorienInput,
      ]),
    ]));

    // --- Vorgänge & Projekte: Kategorien, Leitungs-PIN ---
    // (Das Vikunja-Projekt wird app-weit unter „Aufgaben" gesetzt.)
    const vg = settings.vorgaenge || (settings.vorgaenge = { kategorien: [], vikunjaProjektId: null, leitungPinHash: '' });
    const vgKatInput = el('textarea', { style: 'width:100%;' }, (vg.kategorien || []).join('\n'));
    vgKatInput.oninput = e => { vg.kategorien = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); };
    vgKatInput.onchange = () => store.saveSettings(settings);

    const pinInput = el('input', { type: 'password', autocomplete: 'new-password', placeholder: GR.roles.hasPin() ? '•••• (gesetzt) – neuen PIN eingeben zum Ändern' : 'PIN festlegen' });
    const pinStatus = el('span', { class: 'help' }, GR.roles.hasPin() ? 'PIN ist gesetzt.' : 'Kein PIN – die Leitungs-Ansicht ist frei wählbar.');
    const pinSave = el('button', { class: 'btn-primary', onClick: async () => {
      if (!pinInput.value) { toast('Bitte einen PIN eingeben.'); return; }
      await GR.roles.setPin(pinInput.value); pinInput.value = '';
      pinStatus.textContent = 'PIN ist gesetzt.'; toast('Leitungs-PIN gespeichert');
    } }, 'PIN speichern');
    const pinClear = el('button', { class: 'btn-danger', onClick: async () => {
      await GR.roles.setPin(''); pinStatus.textContent = 'Kein PIN – die Leitungs-Ansicht ist frei wählbar.'; toast('Leitungs-PIN entfernt');
    } }, 'PIN entfernen');

    C.vorgaenge.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Vorgänge & Projekte'),
      el('p', { class: 'help' }, 'Kategorienliste und der PIN für die Leitungs-Ansicht (vertrauliche Vorgänge/Einträge). Das Vikunja-Projekt für ToDos wird app-weit unter „Aufgaben" gesetzt.'),
      el('div', {}, [el('label', {}, 'Kategorien (eine pro Zeile)'), vgKatInput]),
      el('div', { style: 'margin-top:10px;' }, [
        el('label', {}, 'Leitungs-PIN'),
        el('div', { class: 'toolbar', style: 'margin:4px 0 0;' }, [pinInput, pinSave, pinClear]),
        pinStatus,
      ]),
    ]));

    // --- Arbeitszeiten: Stundensatz-Historie + Tätigkeitskatalog ---
    const az = settings.arbeitszeiten || (settings.arbeitszeiten = { satzHistorie: [], taetigkeiten: [] });
    const satzBox = el('div', { style: 'margin-top:4px;' });

    function refreshSatz() {
      satzBox.innerHTML = '';
      const liste = (az.satzHistorie || []).slice()
        .sort((a, b) => String(b.gueltigAb || '').localeCompare(String(a.gueltigAb || '')));
      if (!liste.length) {
        satzBox.appendChild(el('p', { class: 'help', style: 'margin:4px 0;' },
          'Noch kein Stundensatz hinterlegt – ohne Satz lässt sich keine Abrechnung erstellen.'));
      }
      for (const s of liste) {
        const aktuell = M.satzFuer(az.satzHistorie, heuteIso()) === Number(s.betrag)
          && String(s.gueltigAb) <= heuteIso();
        satzBox.appendChild(el('div', { class: 'toolbar', style: 'margin:4px 0; align-items:center;' }, [
          el('span', { style: 'min-width:150px;' }, 'ab ' + formatDatum(s.gueltigAb)),
          el('strong', { style: 'min-width:90px;' }, euro(s.betrag) + ' / Std.'),
          aktuell ? el('span', { class: 'tag ok' }, 'aktuell gültig') : null,
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn-sm btn-danger', onClick: () => {
              if (!confirmDialog(`Stundensatz ab ${formatDatum(s.gueltigAb)} löschen?`)) return;
              az.satzHistorie = az.satzHistorie.filter(x => x !== s);
              store.saveSettings(settings); refreshSatz(); toast('Satz gelöscht');
            },
          }, '✕'),
        ]));
      }
    }
    refreshSatz();

    const satzAbI = el('input', { type: 'date', value: heuteIso() });
    const satzBetragI = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'z. B. 15,00' });
    const satzAddBtn = el('button', {
      class: 'btn-primary', onClick: () => {
        const gueltigAb = satzAbI.value;
        const betrag = Number(String(satzBetragI.value).replace(',', '.'));
        if (!gueltigAb) { alert('Bitte ein „gültig ab"-Datum wählen.'); return; }
        if (!(betrag >= 0)) { alert('Bitte einen gültigen Betrag eingeben.'); return; }
        if (!Array.isArray(az.satzHistorie)) az.satzHistorie = [];
        const vorhanden = az.satzHistorie.find(s => s.gueltigAb === gueltigAb);
        if (vorhanden) vorhanden.betrag = betrag;
        else az.satzHistorie.push({ gueltigAb, betrag });
        store.saveSettings(settings);
        satzBetragI.value = '';
        refreshSatz();
        toast('Stundensatz gespeichert');
      },
    }, 'Satz hinzufügen');

    const azKatInput = el('textarea', { style: 'width:100%;' }, (az.taetigkeiten || []).join('\n'));
    azKatInput.oninput = e => { az.taetigkeiten = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); };
    azKatInput.onchange = () => store.saveSettings(settings);

    C.arbeitszeiten.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Arbeitszeiten & Vergütung'),
      el('p', { class: 'help' }, 'Der Stundensatz gilt einheitlich für alle Leistungserbringer. Maßgeblich ist der Satz, der am Leistungsdatum gültig war – ältere Einträge ändern sich also nicht, wenn der Satz später steigt. Beim Abrechnen wird der Satz zusätzlich eingefroren. Am einzelnen Eintrag lässt sich ein abweichender Satz setzen (z. B. bei Firmen).'),
      el('h4', { style: 'margin:14px 0 4px;' }, 'Stundensatz (mit Historie)'),
      satzBox,
      el('div', { class: 'toolbar', style: 'margin-top:8px; align-items:flex-end;' }, [
        el('div', {}, [el('label', {}, 'gültig ab'), satzAbI]),
        el('div', {}, [el('label', {}, 'Betrag (€/Std.)'), satzBetragI]),
        satzAddBtn,
      ]),
      el('h4', { style: 'margin:16px 0 4px;' }, 'Tätigkeitskatalog'),
      el('p', { class: 'help' }, 'Auswahlliste bei der Erfassung. Freier Text bleibt zusätzlich möglich.'),
      azKatInput,
    ]));

    C.daten.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Backup'),
      el('p', { class: 'help' }, 'Sichern Sie regelmäßig den gesamten Datenbestand als JSON. Sie können diese Datei jederzeit wieder einspielen — z. B. nach Browserwechsel.'),
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn-primary', onClick: onBackup }, 'Backup herunterladen (JSON)'),
        el('button', { onClick: onRestore }, 'Backup einspielen…'),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn-danger', onClick: onWipe }, 'Alle Daten löschen'),
      ]),
    ]));

    // --- Inventar (Homebox) ---
    // Homebox kennt keine dauerhaften API-Tokens, nur Benutzername + Passwort.
    // Beides bleibt serverseitig; das Passwort wird nie zurückgeliefert.
    const hbUrl = el('input', { type: 'text', placeholder: 'https://homebox.example.de' });
    const hbUser = el('input', { type: 'text', placeholder: 'benutzer@example.de' });
    const hbPass = el('input', { type: 'password', placeholder: 'Passwort' });
    const hbSammlung = el('select', {}, [el('option', { value: '' }, 'Standard-Sammlung des Kontos')]);
    const hbStatus = el('div', { class: 'help', style: 'margin-top:8px;' }, '');
    const setHbStatus = (t, c) => { hbStatus.textContent = t; hbStatus.style.color = c || ''; };

    // Die Sammlungsliste wird OHNE gespeicherte Sammlung abgefragt — sonst
    // sperrte eine ungültige Auswahl den Weg, sie zu korrigieren.
    function ladeSammlungen(aktivId) {
      GR.api.listInventarSammlungen().then(liste => {
        hbSammlung.innerHTML = '';
        hbSammlung.appendChild(el('option', { value: '' }, 'Standard-Sammlung des Kontos'));
        for (const g of liste) {
          hbSammlung.appendChild(el('option', { value: g.id, selected: g.id === aktivId }, g.name));
        }
        // Eine gespeicherte, nicht mehr zugängliche Sammlung bleibt sichtbar
        // stehen, statt still auf Standard zu fallen — sonst arbeitete die App
        // unbemerkt im falschen Bestand.
        if (aktivId && !liste.some(g => g.id === aktivId)) {
          hbSammlung.appendChild(el('option', { value: aktivId, selected: true }, 'Gespeicherte Sammlung (nicht mehr zugänglich)'));
        }
      }).catch(() => {
        hbSammlung.innerHTML = '';
        hbSammlung.appendChild(el('option', { value: aktivId || '' }, 'Sammlungen nicht ladbar (Zugang prüfen)'));
      });
    }

    function ladeHbConfig() {
      GR.api.getInventarConfig().then(c => {
        hbUrl.value = c.url || '';
        hbUser.value = c.username || '';
        hbPass.placeholder = c.hasPassword ? '(gesetzt – leer lassen zum Behalten)' : 'Passwort';
        setHbStatus(c.hasPassword ? 'Zugang hinterlegt (Quelle: ' + c.source + ')' : 'Noch kein Zugang hinterlegt.');
        if (c.url && c.username) ladeSammlungen(c.groupId || '');
      }).catch(e => setHbStatus('Konfiguration nicht ladbar: ' + e.message, '#c53030'));
    }

    const onHbSave = async () => {
      try {
        const gewaehlt = hbSammlung.options[hbSammlung.selectedIndex];
        await GR.api.putInventarConfig({
          url: hbUrl.value.trim(),
          username: hbUser.value.trim(),
          password: hbPass.value,
          groupId: hbSammlung.value || '',
          groupName: hbSammlung.value ? (gewaehlt ? gewaehlt.textContent : '') : '',
        });
        hbPass.value = '';
        // Lagerorte und Etiketten gehören zur Sammlung — nach einem Wechsel
        // wären die zwischengespeicherten falsch.
        if (GR.inventar) GR.inventar.zuruecksetzen();
        setHbStatus('Gespeichert.', '#2f855a');
        ladeHbConfig();
      } catch (e) { setHbStatus('Fehler: ' + e.message, '#c53030'); }
    };

    const onHbTest = async () => {
      setHbStatus('Verbindung wird geprüft…');
      try {
        const h = await GR.api.inventarHealth();
        if (!h || h.ok !== true) { setHbStatus('Keine Verbindung: ' + ((h && h.error) || 'unbekannt'), '#c53030'); return; }
        setHbStatus(`Verbunden — Sammlung „${h.sammlung || 'Standard'}"`
          + (h.wartungen === false ? '. Achtung: Diese Homebox-Version kennt keine Wartungen.' : ', Wartungen werden unterstützt.'),
          h.wartungen === false ? '#b7791f' : '#2f855a');
      } catch (e) { setHbStatus('Fehler: ' + e.message, '#c53030'); }
    };

    if (!settings.inventar) settings.inventar = { vorlaufTage: 30, wartungsaufgaben: true };
    const invVorlauf = el('input', {
      type: 'number', min: '0', step: '1', style: 'max-width:120px;',
      value: String(settings.inventar.vorlaufTage == null ? 30 : settings.inventar.vorlaufTage),
    });
    invVorlauf.onchange = () => {
      const n = Number(invVorlauf.value);
      settings.inventar.vorlaufTage = Number.isFinite(n) && n >= 0 ? n : 30;
      invVorlauf.value = String(settings.inventar.vorlaufTage);
      store.saveSettings(settings);
      toast('Vorlauffrist gespeichert');
    };
    const invAktiv = el('input', { type: 'checkbox', checked: settings.inventar.wartungsaufgaben !== false });
    invAktiv.onchange = () => {
      settings.inventar.wartungsaufgaben = invAktiv.checked;
      store.saveSettings(settings);
    };
    const laufStatus = el('div', { class: 'help', style: 'margin-top:8px;' }, '');
    const onLauf = async () => {
      laufStatus.textContent = 'Wird geprüft…';
      try {
        const b = await GR.api.wartungslaufJetzt();
        if (b.uebersprungen) { laufStatus.textContent = b.uebersprungen; return; }
        laufStatus.textContent = `${b.geprueft} offene Wartungen geprüft · ${b.aufgabenAngelegt} Aufgaben angelegt · `
          + `${b.wartungenErledigt} Wartungen erledigt · ${b.folgetermine} Folgetermine · ${b.aufgabenGeschlossen} Aufgaben geschlossen`
          + (b.fehler && b.fehler.length ? ` · Fehler: ${b.fehler.join('; ')}` : '');
      } catch (e) { laufStatus.textContent = 'Fehler: ' + e.message; }
    };

    C.inventar.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Inventar (Homebox)'),
      el('p', { class: 'help' }, 'Das Gemeindeinventar wird in Homebox geführt; diese App arbeitet direkt darauf und legt keine eigene Kopie an. Homebox kennt keine dauerhaften Tokens — deshalb Benutzername und Passwort. Beides wird serverseitig im Container gespeichert und nie an den Browser zurückgegeben.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Homebox-URL (ohne /api)'), hbUrl]),
        el('div', {}, [el('label', {}, 'Benutzer (E-Mail)'), hbUser]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Passwort'), hbPass]),
        el('div', {}, [
          el('label', {}, 'Sammlung'),
          hbSammlung,
          el('p', { class: 'help', style: 'margin:2px 0 0;' }, 'Ein Konto kann mehrere getrennte Bestände haben. Die Auswahl entscheidet, welcher hier erscheint.'),
        ]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onHbSave }, 'Speichern'),
        el('button', { onClick: onHbTest }, 'Verbindung testen'),
      ]),
      hbStatus,
    ]));

    C.inventar.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Wartungen und Aufgaben'),
      el('p', { class: 'help' }, 'Wird eine Wartung fällig, legt der Server im Aufgabenmodul automatisch eine Aufgabe an — einmal täglich, auch wenn niemand die App öffnet. Erledigt sich die Wartung, schließt sich die Aufgabe, und mit hinterlegtem Intervall entsteht sofort der nächste Termin. Umgekehrt gilt dasselbe: eine abgehakte Aufgabe bucht die Wartung als erledigt.'),
      el('div', {}, [
        el('label', {}, 'Vorlauf: wie viele Tage vorher soll die Aufgabe erscheinen?'),
        invVorlauf,
        el('p', { class: 'help', style: 'margin:2px 0 0;' }, 'Gilt als Standard; an einer einzelnen Wartung lässt sich davon abweichen.'),
      ]),
      el('label', { class: 'pers-check', style: 'margin-top:10px;' }, [invAktiv, ' Aufgaben automatisch anlegen']),
      el('p', { class: 'help', style: 'margin-top:8px;' }, 'Die Aufgaben landen im Projekt, das unter „Aufgaben" als synchronisiertes Projekt eingestellt ist. Ohne ein solches Projekt kann der Lauf nichts anlegen.'),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { onClick: onLauf }, 'Jetzt prüfen'),
      ]),
      laufStatus,
    ]));
    ladeHbConfig();

    // ===== Einwohner =========================================================
    // Zwei Besonderheiten gegenüber allen anderen Modulen:
    //  * Die Verbindungsdaten gehören zu einer ZWEITEN NocoDB-Base, nicht zu
    //    der aus der Datensicherung. Beides bleibt bewusst getrennt.
    //  * Das Modul hat eine eigene PIN, die der Server prüft. Ohne sie liefert
    //    er die Einwohner nicht aus — auch nicht an diese Seite.
    const ewUrl = el('input', { type: 'text', placeholder: 'https://nocodb.example.de' });
    const ewToken = el('input', { type: 'password', placeholder: 'API-Token' });
    const ewBase = el('input', { type: 'text', placeholder: 'Base-ID (z. B. p1a2b3c4d5)' });
    const ewTabelle = el('select', {});
    const ewTabelleId = el('input', { type: 'text', placeholder: 'Tabellen-ID' });
    const ewStatus = el('p', { class: 'help' });

    const ewFeld = {};
    for (const k of ['nachname', 'vorname', 'geburtsdatum', 'wohnungsart', 'wohnort', 'strasse', 'hausnummer', 'zusatz']) {
      ewFeld[k] = el('input', { type: 'text' });
    }

    async function ladeEwConfig() {
      try {
        const c = await GR.api.getEinwohnerConfig();
        ewUrl.value = c.url || '';
        ewBase.value = c.baseId || '';
        ewTabelleId.value = c.tableId || '';
        ewToken.placeholder = c.hasToken ? 'gesetzt — leer lassen, um ihn zu behalten' : 'API-Token';
        for (const k of Object.keys(ewFeld)) {
          ewFeld[k].value = (c.felder && c.felder[k]) || (c.standardFelder && c.standardFelder[k]) || '';
        }
        // Was noch fehlt, steht sofort da — nicht erst nach „Verbindung testen".
        if (c.fehlt && c.fehlt.length) {
          ewStatus.textContent = `Noch nicht vollständig — es fehlt: ${c.fehlt.join(', ')}.`;
          ewStatus.className = 'warn';
        } else if (!c.hasPin) {
          ewStatus.textContent = 'Zugang vollständig. Achtung: Es ist keine PIN vergeben — die Einwohnerdaten sind derzeit ungeschützt.';
          ewStatus.className = 'warn';
        } else {
          ewStatus.textContent = 'Zugang vollständig, PIN ist gesetzt.';
          ewStatus.className = 'help';
        }
      } catch (e) {
        ewStatus.textContent = e && e.gesperrt
          ? 'Gesperrt — zum Ändern der Verbindung erst im Modul „Einwohner" die PIN eingeben.'
          : 'Konnte nicht geladen werden: ' + e.message;
        ewStatus.className = 'warn';
      }
    }

    const onEwSave = async () => {
      try {
        const felder = {};
        for (const k of Object.keys(ewFeld)) felder[k] = ewFeld[k].value.trim();
        await GR.api.putEinwohnerConfig({
          url: ewUrl.value.trim(),
          token: ewToken.value,          // leer = bestehenden behalten
          baseId: ewBase.value.trim(),
          tableId: ewTabelleId.value.trim(),
          felder,
        });
        ewToken.value = '';
        toast('Gespeichert.');
        ladeEwConfig();
      } catch (e) {
        toast(e && e.gesperrt ? 'Gesperrt — erst im Modul „Einwohner" die PIN eingeben.' : 'Fehler: ' + e.message);
      }
    };

    const onEwTabellen = async () => {
      ewTabelle.innerHTML = '';
      try {
        const liste = await GR.api.einwohnerTabellen();
        ewTabelle.appendChild(el('option', { value: '' }, '— Tabelle wählen —'));
        for (const t of liste) {
          ewTabelle.appendChild(el('option', {
            value: t.id, selected: t.id === ewTabelleId.value,
          }, `${t.title} (${t.id})`));
        }
        ewStatus.textContent = `${liste.length} Tabellen gefunden — die richtige auswählen.`;
        ewStatus.className = 'help';
      } catch (e) {
        ewStatus.textContent = 'Tabellen konnten nicht geladen werden: ' + e.message;
        ewStatus.className = 'warn';
      }
    };
    // Die Auswahl speichert sich selbst. Sonst wählt man die Tabelle, drückt
    // „Verbindung testen" und bekommt zu hören, sie fehle noch — weil die
    // Prüfung über den gespeicherten Zugang läuft, nicht über das Formular.
    ewTabelle.addEventListener('change', async () => {
      if (!ewTabelle.value) return;
      ewTabelleId.value = ewTabelle.value;
      await onEwSave();
    });

    const onEwTest = async () => {
      ewStatus.textContent = 'Prüfe …';
      ewStatus.className = 'help';
      try {
        const h = await GR.api.einwohnerHealth();
        if (!h.ok) { ewStatus.textContent = 'Fehler: ' + (h.error || 'unbekannt'); ewStatus.className = 'warn'; return; }
        // Die Beispielzeile ist der einzige verlässliche Weg zu prüfen, ob
        // „Name" wirklich der Nachname ist — auf der Urkunde fiele es erst auf,
        // wenn sie gedruckt ist.
        const b = h.beispiel;
        ewStatus.innerHTML = '';
        ewStatus.className = 'help';
        ewStatus.appendChild(el('span', {}, `Verbindung steht — ${h.anzahl} Datensätze. `));
        if (b) {
          ewStatus.appendChild(el('br'));
          ewStatus.appendChild(el('span', {}, `Erste Zeile: Nachname „${b.nachname}", Vorname „${b.vorname}", geboren ${b.geburtsdatum || '—'}, ${b.strasse || ''} ${b.hausnummer || ''}${b.zusatz || ''}.`));
          ewStatus.appendChild(el('br'));
          ewStatus.appendChild(el('em', {}, 'Stimmt die Zuordnung von Nachname und Vorname? Sonst unten die Spaltennamen tauschen.'));
        }
      } catch (e) {
        ewStatus.textContent = e && e.gesperrt
          ? 'Gesperrt — erst im Modul „Einwohner" die PIN eingeben.'
          : 'Fehler: ' + e.message;
        ewStatus.className = 'warn';
      }
    };

    C.einwohner.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Verbindung zur Einwohnerliste'),
      el('p', { class: 'help' }, 'Die Einwohner liegen in einer eigenen NocoDB-Base — nicht in der, in die unter „Datensicherung" gesichert wird. Beide bleiben getrennt: ein Melderegister hat in der Sicherung von Sitzungen und Rechnungen nichts verloren. Token und PIN werden serverseitig im Container gespeichert und nie an den Browser zurückgegeben.'),
      // Die Reihenfolge ist nicht beliebig: „Tabellen laden" und „Verbindung
      // testen" laufen über den GESPEICHERTEN Zugang, nicht über die
      // Eingabefelder. Ohne diesen Hinweis drückt man testen, bevor gespeichert
      // ist, und bekommt nur „es fehlt noch …".
      el('p', { class: 'help' }, 'Reihenfolge: 1. URL, Token und Base-ID eintragen → Speichern. 2. Tabellen laden und die richtige wählen → Speichern. 3. Verbindung testen.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, '1 · NocoDB-URL'), ewUrl]),
        el('div', {}, [el('label', {}, '1 · API-Token'), ewToken]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, '1 · Base-ID'), ewBase]),
        el('div', {}, [
          el('label', {}, '2 · Tabelle'),
          ewTabelle,
          ewTabelleId,
          el('p', { class: 'help', style: 'margin:2px 0 0;' }, 'Die Liste kommt über den gespeicherten Zugang — vorher einmal speichern.'),
        ]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onEwSave }, 'Speichern'),
        el('button', { onClick: onEwTabellen }, 'Tabellen laden'),
        el('button', { onClick: onEwTest }, 'Verbindung testen'),
      ]),
      ewStatus,
    ]));

    C.einwohner.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Spaltenzuordnung'),
      el('p', { class: 'help' }, 'Welche Spalte der Base welches Feld ist. Vorbelegt mit den Namen der bestehenden Liste. Wichtig: „Name" ist im Melderegister der NACHNAME, „Rufname" der Vorname — davon hängen Sortierung und Urkundenaufdruck ab.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Nachname'), ewFeld.nachname]),
        el('div', {}, [el('label', {}, 'Vorname'), ewFeld.vorname]),
        el('div', {}, [el('label', {}, 'Geburtsdatum'), ewFeld.geburtsdatum]),
        el('div', {}, [el('label', {}, 'Wohnungsart'), ewFeld.wohnungsart]),
        el('div', {}, [el('label', {}, 'Straße'), ewFeld.strasse]),
        el('div', {}, [el('label', {}, 'Hausnummer'), ewFeld.hausnummer]),
        el('div', {}, [el('label', {}, 'Zusatz'), ewFeld.zusatz]),
        el('div', {}, [el('label', {}, 'Wohnort'), ewFeld.wohnort]),
      ]),
      el('p', { class: 'help', style: 'margin-top:8px;' }, 'Änderungen mit „Speichern" oben übernehmen.'),
    ]));

    // --- PIN ---
    const ewPinAlt = el('input', { type: 'password', placeholder: 'Bisherige PIN (falls gesetzt)' });
    const ewPinNeu = el('input', { type: 'password', placeholder: 'Neue PIN (mind. 4 Zeichen)' });
    const ewPinStatus = el('p', { class: 'help' });

    const onPinSetzen = async () => {
      try {
        const r = await GR.api.einwohnerPin(ewPinNeu.value, ewPinAlt.value);
        ewPinAlt.value = ''; ewPinNeu.value = '';
        ewPinStatus.textContent = r.hasPin ? 'PIN gesetzt. Bestehende Freigaben wurden beendet.' : 'PIN entfernt.';
        ewPinStatus.className = r.hasPin ? 'help' : 'warn';
        ladeEwConfig();
      } catch (e) {
        ewPinStatus.textContent = 'Fehler: ' + e.message;
        ewPinStatus.className = 'warn';
      }
    };
    const onPinEntfernen = async () => {
      const ok = confirmDialog(
        'PIN wirklich entfernen?\n\n'
        + 'Danach kann jeder im Netz die Einwohnerdaten abrufen. Das ist bei einem Melderegister nicht zu empfehlen.',
      );
      if (!ok) return;
      try {
        await GR.api.einwohnerPin('', ewPinAlt.value);
        ewPinAlt.value = '';
        ewPinStatus.textContent = 'PIN entfernt — die Daten sind jetzt ungeschützt.';
        ewPinStatus.className = 'warn';
        ladeEwConfig();
      } catch (e) {
        ewPinStatus.textContent = 'Fehler: ' + e.message;
        ewPinStatus.className = 'warn';
      }
    };

    C.einwohner.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'PIN des Moduls'),
      el('p', { class: 'help' }, 'Die Einwohnerdaten liegen bewusst nicht im allgemeinen Datenbestand, den jeder Browser im Netz bekommt. Der Server gibt sie erst nach Eingabe dieser PIN heraus; die Freigabe gilt für ein Browserfenster und endet nach acht Stunden. Sie wird gesalzen und mit 120.000 Runden gespeichert und verlässt den Server nie.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Bisherige PIN'), ewPinAlt]),
        el('div', {}, [el('label', {}, 'Neue PIN'), ewPinNeu]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onPinSetzen }, 'PIN setzen'),
        el('button', { class: 'btn-danger', onClick: onPinEntfernen }, 'PIN entfernen'),
      ]),
      ewPinStatus,
      el('p', { class: 'help', style: 'margin-top:8px;' }, 'PIN vergessen? Dann in /etc/gemeindeverwaltung.env die EINWOHNER_NOCODB_*-Variablen setzen oder den Datenbank-Eintrag zurücksetzen (siehe README).'),
    ]));

    // --- Jubiläen und Urkunde ---
    const s0 = store.getSettings();
    const ewEinst = s0.einwohner || {};
    const jubVorlauf = el('input', { type: 'number', min: '0', max: '12', value: String(ewEinst.vorlaufMonate == null ? 1 : ewEinst.vorlaufMonate) });
    const jubAktiv = el('input', { type: 'checkbox' });
    jubAktiv.checked = ewEinst.jubilaeumsaufgaben !== false;
    const jubNamen = el('input', { type: 'checkbox' });
    jubNamen.checked = ewEinst.aufgabeMitNamen !== false;
    const jubStatus = el('p', { class: 'help' });

    const urkDu = el('textarea', { rows: '4' }, ewEinst.urkundeTextDu || '');
    const urkSie = el('textarea', { rows: '4' }, ewEinst.urkundeTextSie || '');
    const urkAnrede = el('select', {}, [
      el('option', { value: 'du', selected: ewEinst.urkundeAnrede !== 'sie' }, 'Du-Form'),
      el('option', { value: 'sie', selected: ewEinst.urkundeAnrede === 'sie' }, 'Sie-Form'),
    ]);
    const urkU1 = el('input', { type: 'text', value: ewEinst.urkundeUnterschrift1 || '' });
    const urkF1 = el('input', { type: 'text', value: ewEinst.urkundeFunktion1 || '' });
    const urkU2 = el('input', { type: 'text', value: ewEinst.urkundeUnterschrift2 || '' });
    const urkF2 = el('input', { type: 'text', value: ewEinst.urkundeFunktion2 || '' });

    const onEwEinstSave = () => {
      const s = store.getSettings();
      s.einwohner = Object.assign({}, s.einwohner, {
        vorlaufMonate: Math.max(0, Number(jubVorlauf.value) || 0),
        jubilaeumsaufgaben: jubAktiv.checked,
        aufgabeMitNamen: jubNamen.checked,
        urkundeTextDu: urkDu.value,
        urkundeTextSie: urkSie.value,
        urkundeAnrede: urkAnrede.value,
        urkundeUnterschrift1: urkU1.value,
        urkundeFunktion1: urkF1.value,
        urkundeUnterschrift2: urkU2.value,
        urkundeFunktion2: urkF2.value,
      });
      store.saveSettings(s);
      toast('Gespeichert.');
    };

    const onJubLauf = async () => {
      jubStatus.textContent = 'Prüfe …';
      jubStatus.className = 'help';
      try {
        const b = await GR.api.jubilaeumslaufJetzt();
        if (b.uebersprungen) { jubStatus.textContent = b.uebersprungen; return; }
        jubStatus.textContent = `${b.geprueft} Jubiläen geprüft · ${b.aufgabenAngelegt} Aufgaben angelegt · `
          + `${b.ehrungenErledigt} als überreicht gebucht · ${b.aufgabenGeschlossen} Aufgaben geschlossen`
          + (b.fehler && b.fehler.length ? ` · Fehler: ${b.fehler.join('; ')}` : '');
      } catch (e) {
        jubStatus.textContent = e && e.gesperrt
          ? 'Gesperrt — erst im Modul „Einwohner" die PIN eingeben.'
          : 'Fehler: ' + e.message;
        jubStatus.className = 'warn';
      }
    };

    C.einwohner.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Altersjubiläen'),
      el('p', { class: 'help' }, 'Geehrt wird zur Vollendung des 80., 90., 95. und 100. Lebensjahres. Der Server prüft das einmal täglich selbst und legt rechtzeitig eine Aufgabe an — auch wenn wochenlang niemand die App öffnet.'),
      el('div', {}, [
        el('label', {}, 'Vorlauf in Monaten'),
        jubVorlauf,
      ]),
      el('label', { class: 'pers-check', style: 'margin-top:10px;' }, [jubAktiv, ' Aufgaben automatisch anlegen']),
      el('label', { class: 'pers-check' }, [jubNamen, ' Namen in die Aufgabe schreiben']),
      el('p', { class: 'help' }, 'Zu bedenken: Aufgaben sind im Aufgabenmodul und im Kalender für jeden im Netz sichtbar — ohne die PIN dieses Moduls. Ohne Haken steht in der Aufgabe nur Anlass und Datum, den Namen findet man dann hier.'),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onEwEinstSave }, 'Speichern'),
        el('button', { onClick: onJubLauf }, 'Jetzt prüfen'),
      ]),
      jubStatus,
    ]));

    C.einwohner.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Urkunde'),
      el('p', { class: 'help' }, 'Der Glückwunschtext der Ehrenurkunde. Platzhalter: {name}, {alter}, {datum}, {ortsgemeinde}. Beim Erzeugen wird zwischen beiden Fassungen gewählt.'),
      el('div', {}, [el('label', {}, 'Du-Fassung'), urkDu]),
      el('div', { style: 'margin-top:8px;' }, [el('label', {}, 'Sie-Fassung'), urkSie]),
      el('div', { style: 'margin-top:8px;' }, [el('label', {}, 'Vorbelegung beim Erzeugen'), urkAnrede]),
      el('h4', { style: 'margin-top:14px;' }, 'Unterschriftszeilen'),
      el('p', { class: 'help' }, 'Es wird bewusst KEIN hinterlegtes Unterschriftsbild eingesetzt — Ehrungen werden persönlich unterschrieben. Gedruckt werden nur Linie, Name und Funktion.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Name links'), urkU1]),
        el('div', {}, [el('label', {}, 'Funktion links'), urkF1]),
        el('div', {}, [el('label', {}, 'Name rechts'), urkU2]),
        el('div', {}, [el('label', {}, 'Funktion rechts'), urkF2]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn-primary', onClick: onEwEinstSave }, 'Speichern'),
      ]),
    ]));
    ladeEwConfig();

    // --- Kategorie-Unternavigation zusammenbauen ---
    const catDefs = [
      ['allgemein', 'Allgemein'],
      ['darstellung', 'Darstellung'],
      ['dokumente', 'Dokumente'],
      ['kalender', 'Kalender'],
      ['aufgaben', 'Aufgaben'],
      ['mail', 'E-Mail'],
      ['vorgaenge', 'Vorgänge & Projekte'],
      ['vermietung', 'Vermietung'],
      ['vertraege', 'Verträge & Pacht'],
      ['auslagen', 'Bargeldauslagen'],
      ['arbeitszeiten', 'Arbeitszeiten'],
      ['inventar', 'Inventar (Homebox)'],
      ['einwohner', 'Einwohner'],
      ['daten', 'Datensicherung'],
    ];
    const content = el('div', { class: 'settings-content' });
    const navBox = el('div', { class: 'settings-nav' });
    const buttons = {};
    function showCat(key) {
      content.innerHTML = '';
      content.appendChild(C[key]);
      Object.entries(buttons).forEach(([k, b]) => b.classList.toggle('active', k === key));
      try { sessionStorage.setItem('gr.settingsCat', key); } catch (_) {}
    }
    catDefs.forEach(([key, label]) => {
      const b = el('button', { onClick: () => showCat(key) }, label);
      buttons[key] = b;
      navBox.appendChild(b);
    });
    mount.appendChild(el('div', { class: 'settings-layout' }, [navBox, content]));

    let initial = 'allgemein';
    try { const s = sessionStorage.getItem('gr.settingsCat'); if (s && C[s]) initial = s; } catch (_) {}
    showCat(initial);
  }

  GR.views = GR.views || {};
  GR.views.renderEinstellungen = renderEinstellungen;
})();
