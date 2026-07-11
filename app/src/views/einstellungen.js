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

    // Einstellungen nach Kategorien gegliedert – je Bereich ein eigener Container.
    const C = {
      allgemein: el('div'), darstellung: el('div'), dokumente: el('div'), kalender: el('div'), aufgaben: el('div'),
      vermietung: el('div'), vertraege: el('div'), auslagen: el('div'), daten: el('div'),
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

    // Unterschrift-Bild
    const sigPreview = el('div', { style: 'margin:8px 0;' });
    function refreshSigPreview() {
      sigPreview.innerHTML = '';
      if (au.unterschriftDataUrl) {
        sigPreview.appendChild(el('img', { src: au.unterschriftDataUrl, style: 'max-height:70px; border:1px solid var(--border); border-radius:4px; background:white; padding:4px;' }));
      } else {
        sigPreview.appendChild(el('div', { class: 'help' }, 'Keine Unterschrift hinterlegt – die Bürgermeister-Linie bleibt im PDF leer.'));
      }
    }
    refreshSigPreview();
    const onUploadSig = async () => {
      const file = await pickFile('image/png,image/*');
      if (!file) return;
      try {
        au.unterschriftDataUrl = await readFileAsDataUrl(file);
        store.saveSettings(settings);
        toast('Unterschrift gespeichert');
        refreshSigPreview();
      } catch (e) { alert('Datei konnte nicht gelesen werden: ' + e.message); }
    };
    const onResetSig = () => { au.unterschriftDataUrl = ''; store.saveSettings(settings); toast('Unterschrift entfernt'); refreshSigPreview(); };

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
      el('p', { class: 'help' }, 'Wird automatisch über die Bürgermeister-Linie ins PDF gesetzt. PNG mit transparentem Hintergrund empfohlen.'),
      sigPreview,
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn-primary', onClick: onUploadSig }, 'Unterschrift hochladen…'),
        el('button', { onClick: onResetSig }, 'Entfernen'),
      ]),
      el('h4', { style: 'margin:14px 0 4px;' }, 'Netzwerkscanner (eSCL/AirScan)'),
      el('p', { class: 'help' }, 'Scanner automatisch suchen und als Standard übernehmen oder die URL manuell eintragen. Beim Scannen werden die Seiten als Belege angelegt.'),
      el('label', {}, 'Scanner-URL'),
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

    // --- Kategorie-Unternavigation zusammenbauen ---
    const catDefs = [
      ['allgemein', 'Allgemein'],
      ['darstellung', 'Darstellung'],
      ['dokumente', 'Dokumente'],
      ['kalender', 'Kalender'],
      ['aufgaben', 'Aufgaben'],
      ['vermietung', 'Vermietung'],
      ['vertraege', 'Verträge & Pacht'],
      ['auslagen', 'Bargeldauslagen'],
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
