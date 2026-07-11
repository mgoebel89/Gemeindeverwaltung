(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog, formatDatum } = GR.ui;
  const {
    AUSLAGE_STATUS, emptyAuslage, emptyBeleg, emptyEmpfaenger, emptyHaushaltsstelle,
    fullNameEmpfaenger, formatIban, gesamtbetrag, budgetVerbrauch,
  } = GR.models;

  // Session-Cache der im Netzwerk gefundenen Scanner (für die Beleg-Maske).
  let scannerCache = [];

  const STATUS_META = {
    offen: { label: 'offen', tag: 'prep' },
    eingereicht: { label: 'eingereicht', tag: 'live' },
    erstattet: { label: 'erstattet', tag: 'done' },
  };

  function euro(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
  function jahre() {
    const y = new Date().getFullYear();
    const set = new Set([y - 1, y, y + 1]);
    for (const a of store.listAuslagen()) if (a.haushaltsjahr) set.add(Number(a.haushaltsjahr));
    return Array.from(set).sort((a, b) => b - a);
  }
  function hsLabel(h) { return h ? [h.nummer, h.bezeichnung].filter(Boolean).join(' – ') : '—'; }

  // =========================================================== Empfänger-Dialog
  function empfaengerDialog(prefill, onSaved) {
    const isNew = !prefill || !prefill.id;
    const e = isNew ? { ...emptyEmpfaenger(), ...(prefill || {}) } : { ...prefill };
    const name = el('input', { type: 'text', value: e.name || '' });
    const vorname = el('input', { type: 'text', value: e.vorname || '' });
    const iban = el('input', { type: 'text', value: formatIban(e.iban), placeholder: 'DE00 0000 0000 0000 0000 00' });

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    const onSave = () => {
      e.name = name.value.trim();
      e.vorname = vorname.value.trim();
      e.iban = formatIban(iban.value);
      if (!e.name && !e.vorname) return toast('Bitte mindestens einen Namen eingeben');
      store.saveEmpfaenger(e);
      toast(isNew ? 'Empfänger angelegt' : 'Empfänger gespeichert');
      close();
      if (onSaved) onSaved(e);
    };
    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h3', {}, isNew ? 'Neuer Empfänger' : 'Empfänger bearbeiten'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Name (Nachname)'), name]),
        el('div', {}, [el('label', {}, 'Vorname'), vorname]),
      ]),
      el('div', { style: 'margin-top:8px;' }, [el('label', {}, 'IBAN'), iban]),
      el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: onSave }, 'Speichern'),
        el('button', { onClick: close }, 'Abbrechen'),
      ]),
    ]));
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  // ====================================================== Haushaltsstelle-Dialog
  function haushaltsstelleDialog(prefill, onSaved) {
    const isNew = !prefill || !prefill.id;
    const h = isNew ? { ...emptyHaushaltsstelle(), ...(prefill || {}) } : { ...prefill };
    const nummer = el('input', { type: 'text', value: h.nummer || '', placeholder: 'z. B. 5.5.5.3' });
    const bezeichnung = el('input', { type: 'text', value: h.bezeichnung || '', placeholder: 'z. B. Landwirtschaftliche Grundstücke' });
    const budget = el('input', { type: 'number', step: '0.01', value: (h.budget ?? '') === null ? '' : (h.budget ?? ''), placeholder: 'optional (€)' });

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    const onSave = () => {
      h.nummer = nummer.value.trim();
      h.bezeichnung = bezeichnung.value.trim();
      h.budget = budget.value === '' ? null : Number(budget.value);
      if (!h.nummer) return toast('Bitte eine Haushaltsstellen-Nummer eingeben');
      store.saveHaushaltsstelle(h);
      toast(isNew ? 'Haushaltsstelle angelegt' : 'Haushaltsstelle gespeichert');
      close();
      if (onSaved) onSaved(h);
    };
    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h3', {}, isNew ? 'Neue Haushaltsstelle' : 'Haushaltsstelle bearbeiten'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Nummer'), nummer]),
        el('div', {}, [el('label', {}, 'Budget (optional)'), budget]),
      ]),
      el('div', { style: 'margin-top:8px;' }, [el('label', {}, 'Bezeichnung'), bezeichnung]),
      el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: onSave }, 'Speichern'),
        el('button', { onClick: close }, 'Abbrechen'),
      ]),
    ]));
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  // =============================================================== Übersicht
  function renderList(mount) {
    function refresh() { mount.innerHTML = ''; renderList(mount); }

    let auslagen = store.listAuslagen().slice().sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
    const filter = renderList._filter || (renderList._filter = { status: '', jahr: '' });
    if (filter.status) auslagen = auslagen.filter(a => (a.status || 'offen') === filter.status);
    if (filter.jahr) auslagen = auslagen.filter(a => String(a.haushaltsjahr) === String(filter.jahr));

    const onNew = () => {
      const a = emptyAuslage();
      store.saveAuslage(a);
      location.hash = `#/auslagen?id=${a.id}`;
    };
    const onDelete = a => {
      if (!confirmDialog('Diese Bargeldauslage wirklich löschen?')) return;
      store.deleteAuslage(a.id);
      refresh();
    };

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { class: 'btn-primary', onClick: onNew }, '+ Neue Bargeldauslage'),
      el('a', { class: 'btn', href: '#/auslagen-stammdaten' }, 'Empfänger & Haushaltsstellen'),
    ]));
    mount.appendChild(el('h2', {}, 'Bargeldauslagen'));

    // Filter
    const statusSel = el('select', {});
    statusSel.appendChild(el('option', { value: '', selected: filter.status === '' }, 'Alle Status'));
    for (const s of AUSLAGE_STATUS) statusSel.appendChild(el('option', { value: s, selected: filter.status === s }, STATUS_META[s].label));
    statusSel.onchange = () => { filter.status = statusSel.value; refresh(); };
    const jahrSel = el('select', {});
    jahrSel.appendChild(el('option', { value: '', selected: filter.jahr === '' }, 'Alle Jahre'));
    for (const y of jahre()) jahrSel.appendChild(el('option', { value: y, selected: String(filter.jahr) === String(y) }, String(y)));
    jahrSel.onchange = () => { filter.jahr = jahrSel.value; refresh(); };
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('span', { class: 'help', style: 'align-self:center;' }, 'Filter:'), statusSel, jahrSel,
    ]));

    const card = el('div', { class: 'card', style: 'padding:0' });
    if (auslagen.length === 0) {
      card.appendChild(el('div', { class: 'empty' }, 'Keine Bargeldauslagen. Oben „Neue Bargeldauslage" anlegen.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Datum'), el('th', {}, 'Empfänger'), el('th', {}, 'Haushaltsjahr'),
        el('th', {}, 'Haushaltsstelle'), el('th', { style: 'text-align:right' }, 'Betrag'), el('th', {}, 'Status'), el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      for (const a of auslagen) {
        const emp = store.getEmpfaenger(a.empfaengerId);
        const hs = store.getHaushaltsstelle(a.haushaltsstelleId);
        const meta = STATUS_META[a.status] || STATUS_META.offen;
        tbody.appendChild(el('tr', {}, [
          el('td', {}, a.datum ? formatDatum(a.datum) : '—'),
          el('td', {}, emp ? fullNameEmpfaenger(emp) : '—'),
          el('td', {}, String(a.haushaltsjahr || '—')),
          el('td', {}, hs ? (hs.nummer || '—') : '—'),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, euro(gesamtbetrag(a))),
          el('td', {}, [el('span', { class: 'tag ' + meta.tag }, meta.label)]),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('a', { class: 'btn btn-sm', href: `#/auslagen?id=${a.id}` }, 'Öffnen'),
            ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(a) }, 'Löschen'),
          ]),
        ]));
      }
      table.appendChild(tbody);
      card.appendChild(table);
    }
    mount.appendChild(card);
  }

  // ================================================================== Detail
  function renderDetail(mount, id) {
    const stored = store.getAuslage(id);
    if (!stored) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, 'Bargeldauslage nicht gefunden'),
        el('a', { href: '#/auslagen' }, '← Zurück zur Übersicht'),
      ]));
      return;
    }
    // Arbeitskopie – Tippen aktualisiert nur die Live-Anzeige, Speichern bei change.
    const a = JSON.parse(JSON.stringify(stored));
    a.belege = a.belege || [];

    function persist() { store.saveAuslage(a); }
    function refresh() { mount.innerHTML = ''; renderDetail(mount, id); }

    const meta = STATUS_META[a.status] || STATUS_META.offen;

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/auslagen' }, '← Übersicht'),
      el('div', { class: 'spacer' }),
      el('span', { class: 'tag ' + meta.tag }, 'Status: ' + meta.label),
    ]));

    // ---- Live-Anzeigen ----
    const liveSumme = el('strong', {}, '');
    const budgetBox = el('div', { class: 'help', style: 'margin-top:6px;' }, '');
    function updateLive() {
      liveSumme.textContent = euro(gesamtbetrag(a));
      renderBudget();
    }
    function renderBudget() {
      budgetBox.innerHTML = '';
      const hs = store.getHaushaltsstelle(a.haushaltsstelleId);
      if (!hs || hs.budget === null || hs.budget === undefined || hs.budget === '') {
        budgetBox.textContent = hs ? 'Für diese Haushaltsstelle ist kein Budget hinterlegt.' : '';
        budgetBox.style.color = '';
        return;
      }
      // Verbrauch inkl. der aktuellen (gespeicherten) Auslage.
      const list = store.listAuslagen().map(x => x.id === a.id ? a : x);
      const verbraucht = budgetVerbrauch(list, hs.id, a.haushaltsjahr);
      const rest = Number(hs.budget) - verbraucht;
      const ueber = rest < 0;
      budgetBox.textContent = `Budget ${a.haushaltsjahr}: ${euro(hs.budget)} · verbraucht ${euro(verbraucht)} · ${ueber ? 'überschritten um ' + euro(-rest) : 'Rest ' + euro(rest)}`;
      budgetBox.style.color = ueber ? '#c53030' : '#2f855a';
    }

    // ---- Abschnitt 1: Eckdaten ----
    const jahrInput = el('input', { type: 'number', step: '1', value: a.haushaltsjahr || new Date().getFullYear() });
    jahrInput.oninput = () => { a.haushaltsjahr = jahrInput.value === '' ? '' : Number(jahrInput.value); updateLive(); };
    jahrInput.onchange = persist;

    const hsSel = el('select', {});
    hsSel.appendChild(el('option', { value: '', selected: !a.haushaltsstelleId }, '— Haushaltsstelle wählen —'));
    for (const h of store.listHaushaltsstellen().sort((x, y) => (x.nummer || '').localeCompare(y.nummer || '', 'de'))) {
      hsSel.appendChild(el('option', { value: h.id, selected: h.id === a.haushaltsstelleId }, hsLabel(h)));
    }
    hsSel.onchange = () => { a.haushaltsstelleId = hsSel.value; persist(); renderBudget(); };

    const verwInput = el('input', { type: 'text', value: a.verwendungszweck || '', placeholder: 'z. B. Material Blumenbeet Dorfplatz' });
    verwInput.oninput = () => { a.verwendungszweck = verwInput.value; };
    verwInput.onchange = persist;

    const datumInput = el('input', { type: 'date', value: a.datum || '' });
    datumInput.oninput = () => { a.datum = datumInput.value; };
    datumInput.onchange = persist;

    const statusSel = el('select', {});
    for (const s of AUSLAGE_STATUS) statusSel.appendChild(el('option', { value: s, selected: (a.status || 'offen') === s }, STATUS_META[s].label));
    statusSel.onchange = () => { a.status = statusSel.value; persist(); refresh(); };

    // Empfänger-Auswahl
    const empfBox = el('div', {});
    function renderEmpfBox() {
      empfBox.innerHTML = '';
      const sel = store.getEmpfaenger(a.empfaengerId);
      if (sel) {
        empfBox.appendChild(el('div', { class: 'verm-mieter-sel' }, [
          el('div', {}, [
            el('strong', {}, fullNameEmpfaenger(sel)),
            sel.iban ? el('div', { class: 'help' }, 'IBAN: ' + formatIban(sel.iban)) : el('div', { class: 'help', style: 'color:#c53030;' }, 'Keine IBAN hinterlegt'),
          ]),
          el('div', { class: 'toolbar', style: 'margin:0;' }, [
            el('button', { class: 'btn-sm', onClick: () => empfaengerDialog(sel, () => renderEmpfBox()) }, 'Bearbeiten'),
            el('button', { class: 'btn-sm', onClick: () => { a.empfaengerId = ''; persist(); renderEmpfBox(); } }, 'Wechseln'),
          ]),
        ]));
      } else {
        empfBox.appendChild(empfCombo());
      }
    }
    function empfCombo() {
      const wrap = el('div', { class: 'verm-combo' });
      const input = el('input', { type: 'text', placeholder: 'Empfänger suchen…' });
      const results = el('div', { class: 'verm-combo-results', style: 'display:none;' });
      function pick(e) { a.empfaengerId = e.id; persist(); renderEmpfBox(); }
      function renderResults() {
        const q = input.value.trim().toLowerCase();
        const all = store.listEmpfaenger().sort((x, y) => (x.name || '').localeCompare(y.name || '', 'de'));
        const matches = (q ? all.filter(e => fullNameEmpfaenger(e).toLowerCase().includes(q)) : all).slice(0, 8);
        results.innerHTML = '';
        for (const e of matches) {
          results.appendChild(el('div', { class: 'verm-combo-item', onClick: () => pick(e) }, [
            el('span', {}, fullNameEmpfaenger(e)),
            e.iban ? el('span', { class: 'help' }, ' — ' + formatIban(e.iban)) : null,
          ]));
        }
        results.appendChild(el('div', { class: 'verm-combo-item verm-combo-new', onClick: () => {
          empfaengerDialog({ name: input.value.trim() }, e => pick(e));
        } }, '+ Neuen Empfänger anlegen'));
        results.style.display = 'block';
      }
      input.onfocus = renderResults;
      input.oninput = renderResults;
      const onDocClick = ev => { if (!wrap.contains(ev.target)) results.style.display = 'none'; };
      document.addEventListener('click', onDocClick);
      wrap.appendChild(input);
      wrap.appendChild(results);
      return wrap;
    }
    renderEmpfBox();

    mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, '1 · Eckdaten'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Haushaltsjahr'), jahrInput]),
        el('div', {}, [el('label', {}, 'Status'), statusSel]),
      ]),
      el('div', { style: 'margin-top:10px;' }, [el('label', {}, 'Haushaltsstelle'), hsSel, budgetBox]),
      el('div', { style: 'margin-top:12px;' }, [el('label', {}, 'Empfänger'), empfBox]),
      el('div', { class: 'grid-2', style: 'margin-top:12px;' }, [
        el('div', {}, [el('label', {}, 'Verwendungszweck (Formularfeld „Bezeichnung")'), verwInput]),
        el('div', {}, [el('label', {}, 'Datum (Hörschhausen, den …)'), datumInput]),
      ]),
    ]));

    // ---- Abschnitt 2: Belege ----
    const belegeWrap = el('div', {});
    function nextNr() { return (a.belege.reduce((m, b) => Math.max(m, Number(b.nr) || 0), 0) || 0) + 1; }

    function renderBelege() {
      belegeWrap.innerHTML = '';
      if (a.belege.length === 0) {
        belegeWrap.appendChild(el('p', { class: 'help' }, 'Noch keine Belege erfasst. Oben scannen oder hochladen, oder einen leeren Beleg hinzufügen.'));
      }
      a.belege.sort((x, y) => (Number(x.nr) || 0) - (Number(y.nr) || 0));
      a.belege.forEach((b) => {
        const nrIn = el('input', { type: 'number', step: '1', value: b.nr || '', style: 'width:60px;' });
        nrIn.oninput = () => { b.nr = nrIn.value === '' ? '' : Number(nrIn.value); };
        nrIn.onchange = persist;
        const betragIn = el('input', { type: 'number', step: '0.01', value: b.betrag ?? '', placeholder: '€', style: 'width:110px;' });
        betragIn.oninput = () => { b.betrag = betragIn.value === '' ? 0 : Number(betragIn.value); updateLive(); };
        betragIn.onchange = persist;
        const beschrIn = el('input', { type: 'text', value: b.beschreibung || '', placeholder: 'Beschreibung' });
        beschrIn.oninput = () => { b.beschreibung = beschrIn.value; };
        beschrIn.onchange = persist;
        const datumIn = el('input', { type: 'date', value: b.belegdatum || '', style: 'width:150px;' });
        datumIn.oninput = () => { b.belegdatum = datumIn.value; };
        datumIn.onchange = persist;
        const haendlerIn = el('input', { type: 'text', value: b.haendler || '', placeholder: 'Händler/Lieferant' });
        haendlerIn.oninput = () => { b.haendler = haendlerIn.value; };
        haendlerIn.onchange = persist;

        // Scan/Datei-Bereich
        const scanBox = el('div', { class: 'toolbar', style: 'margin:0;' });
        if (b.scanFileId && store.getBelegFile(a.id, b.scanFileId)) {
          scanBox.appendChild(el('a', { class: 'btn btn-sm', href: store.belegUrl(b.scanFileId), target: '_blank', rel: 'noopener' }, '📎 Scan ansehen'));
          scanBox.appendChild(el('button', { class: 'btn-sm', onClick: async () => {
            try { await store.deleteBelegFile(a.id, b.scanFileId); } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message); }
            b.scanFileId = null; persist(); renderBelege();
          } }, 'Scan entfernen'));
        } else {
          scanBox.appendChild(el('button', { class: 'btn-sm', onClick: () => attachToBeleg(b) }, '📎 Scan/Datei anhängen'));
        }

        belegeWrap.appendChild(el('div', { class: 'card', style: 'background:#fafbfc; padding:12px; margin-bottom:8px;' }, [
          el('div', { class: 'toolbar', style: 'margin:0 0 8px; align-items:center;' }, [
            el('label', { style: 'margin:0;' }, 'Nr.'), nrIn,
            el('label', { style: 'margin:0 0 0 8px;' }, 'Betrag'), betragIn,
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn-sm btn-danger', onClick: async () => {
              if (b.scanFileId) { try { await store.deleteBelegFile(a.id, b.scanFileId); } catch (_) {} }
              a.belege = a.belege.filter(x => x.id !== b.id); persist(); renderBelege(); updateLive();
            } }, '✕ Beleg entfernen'),
          ]),
          el('div', { class: 'grid-2' }, [
            el('div', {}, [el('label', {}, 'Beschreibung'), beschrIn]),
            el('div', {}, [el('label', {}, 'Händler/Lieferant'), haendlerIn]),
          ]),
          el('div', { class: 'grid-2', style: 'margin-top:8px; align-items:end;' }, [
            el('div', {}, [el('label', {}, 'Belegdatum'), datumIn]),
            el('div', {}, [el('label', {}, 'Scan'), scanBox]),
          ]),
        ]));
      });
      belegeWrap.appendChild(el('div', { class: 'verm-total', style: 'margin-top:12px;' }, ['Gesamtbetrag: ', liveSumme]));
    }

    // Einzelnen Beleg mit einer Datei verknüpfen (Upload).
    async function attachToBeleg(b) {
      const file = await GR.ui.pickFile('image/*,application/pdf');
      if (!file) return;
      try {
        const rec = await store.uploadBeleg(a.id, file);
        b.scanFileId = rec.id;
        persist();
        renderBelege();
      } catch (e) { toast('Upload fehlgeschlagen: ' + e.message); }
    }

    // Scanner-Auswahl (Standard aus Einstellungen + im Netzwerk gefundene).
    let chosenScannerUrl = (store.getSettings().auslagen || {}).scannerUrl || '';
    const scanSelect = el('select', { style: 'max-width:100%;' });
    function rebuildScanOptions() {
      scanSelect.innerHTML = '';
      const def = (store.getSettings().auslagen || {}).scannerUrl || '';
      const opts = [];
      const seen = new Set();
      if (def) { opts.push({ url: def, name: 'Standard (' + def + ')' }); seen.add(def); }
      for (const sc of scannerCache) if (!seen.has(sc.url)) { opts.push({ url: sc.url, name: sc.name + ' (' + sc.url + ')' }); seen.add(sc.url); }
      if (!opts.length) opts.push({ url: '', name: '— kein Scanner konfiguriert —' });
      if (!seen.has(chosenScannerUrl)) chosenScannerUrl = opts[0].url;
      for (const o of opts) scanSelect.appendChild(el('option', { value: o.url, selected: o.url === chosenScannerUrl }, o.name));
    }
    rebuildScanOptions();
    scanSelect.onchange = () => { chosenScannerUrl = scanSelect.value; };
    async function onDiscoverScanners() {
      toast('Suche Scanner im Netzwerk…');
      try {
        scannerCache = await GR.api.listScanners();
        rebuildScanOptions();
        toast(scannerCache.length ? `${scannerCache.length} Scanner gefunden` : 'Kein Scanner gefunden');
      } catch (e) { toast('Suche fehlgeschlagen: ' + e.message); }
    }

    // Bulk: Netzwerkscanner → je Seite ein Beleg
    async function onScan() {
      const scannerUrl = chosenScannerUrl;
      if (!scannerUrl) {
        toast('Kein Scanner gewählt – bitte suchen oder in den Einstellungen einrichten.');
        return;
      }
      toast('Scanne… bitte Papier einlegen', 4000);
      try {
        const recs = await store.scanBeleg(a.id, scannerUrl);
        for (const rec of recs) a.belege.push({ ...emptyBeleg(nextNr()), scanFileId: rec.id });
        persist();
        renderBelege(); updateLive();
        toast(`${recs.length} Seite(n) gescannt`);
      } catch (e) { toast('Scan fehlgeschlagen: ' + e.message, 5000); }
    }

    // Bulk: Datei(en) hochladen → je Datei ein Beleg
    async function onUpload() {
      const file = await GR.ui.pickFile('image/*,application/pdf');
      if (!file) return;
      try {
        const rec = await store.uploadBeleg(a.id, file);
        a.belege.push({ ...emptyBeleg(nextNr()), scanFileId: rec.id });
        persist();
        renderBelege(); updateLive();
      } catch (e) { toast('Upload fehlgeschlagen: ' + e.message); }
    }

    function onLeererBeleg() {
      a.belege.push(emptyBeleg(nextNr()));
      persist();
      renderBelege();
    }

    renderBelege();

    mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, '2 · Belege'),
      el('p', { class: 'help' }, 'Jeder Einzelbeleg wird nummeriert und erfasst; die Summe aller Belege wird als Gesamtbetrag ins Formular übernommen. Bild-Scans werden dem Gesamt-PDF als Seiten angehängt.'),
      el('div', { class: 'toolbar', style: 'align-items:center;' }, [
        el('label', { style: 'margin:0; align-self:center;' }, 'Scanner:'),
        scanSelect,
        el('button', { class: 'btn-sm', onClick: onDiscoverScanners }, '🔎 Suchen'),
      ]),
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn-primary', onClick: onScan }, '🖨 Belege scannen'),
        el('button', { onClick: onUpload }, 'Beleg-Datei hochladen'),
        el('button', { onClick: onLeererBeleg }, '+ Leerer Beleg'),
      ]),
      belegeWrap,
    ]));

    // ---- Abschnitt 3: PDF ----
    const emp = store.getEmpfaenger(a.empfaengerId);
    const pdfPrefillTitle = ('Bargeldauslage ' + (emp ? fullNameEmpfaenger(emp) + ' ' : '') + (a.datum || '')).trim();
    const docsSection = GR.ui.renderPaperlessDocsSection
      ? GR.ui.renderPaperlessDocsSection(a, persist, { showAdd: false, emptyText: 'Noch kein PDF in Paperless abgelegt.' })
      : null;

    mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, '3 · Gesamt-PDF'),
      el('p', { class: 'help' }, 'Erzeugt das ausgefüllte Formular mit angehängten Bild-Scans als ein PDF zum Herunterladen/Versenden – oder direkt in Paperless ablegen.'),
      el('div', { class: 'toolbar', style: 'margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: () => GR.auslagenPdf.buildGesamtPdf(a) }, 'Gesamt-PDF erzeugen'),
        GR.ui.savePdfToPaperless ? el('button', { onClick: () => GR.auslagenPdf.buildGesamtPdf(a, {
          target: 'paperless', prefillTitle: pdfPrefillTitle,
          onUploaded: (doc) => { if (docsSection) docsSection.linkDoc(doc); },
        }) }, '📥 In Paperless speichern') : null,
      ]),
    ]));

    if (docsSection) mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'In Paperless abgelegt'),
      docsSection,
    ]));

    updateLive();
  }

  function renderAuslagen(mount, params) {
    if (params && params.id) return renderDetail(mount, params.id);
    return renderList(mount);
  }

  // ======================================================= Stammdaten-Verwaltung
  function renderAuslagenStammdaten(mount) {
    function refresh() { mount.innerHTML = ''; renderAuslagenStammdaten(mount); }

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/auslagen' }, '← Bargeldauslagen'),
    ]));
    mount.appendChild(el('h2', {}, 'Empfänger & Haushaltsstellen'));

    // Empfänger
    const empfCard = el('div', { class: 'card', style: 'padding:0' });
    const empf = store.listEmpfaenger().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
    if (empf.length === 0) {
      empfCard.appendChild(el('div', { class: 'empty' }, 'Noch keine Empfänger angelegt.'));
    } else {
      const t = el('table');
      t.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, 'Name'), el('th', {}, 'IBAN'), el('th', {}, '')])));
      const tb = el('tbody');
      for (const e of empf) {
        tb.appendChild(el('tr', {}, [
          el('td', {}, el('strong', {}, fullNameEmpfaenger(e) || '—')),
          el('td', {}, formatIban(e.iban) || '—'),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm', onClick: () => empfaengerDialog(e, refresh) }, 'Bearbeiten'), ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => { if (confirmDialog(`Empfänger „${fullNameEmpfaenger(e)}" löschen?`)) { store.deleteEmpfaenger(e.id); refresh(); } } }, 'Löschen'),
          ]),
        ]));
      }
      t.appendChild(tb); empfCard.appendChild(t);
    }
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('h3', { style: 'margin:0;' }, 'Empfänger'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-primary', onClick: () => empfaengerDialog(null, refresh) }, '+ Neuer Empfänger'),
    ]));
    mount.appendChild(empfCard);

    // Haushaltsstellen
    const hsCard = el('div', { class: 'card', style: 'padding:0; margin-top:16px;' });
    const hss = store.listHaushaltsstellen().sort((a, b) => (a.nummer || '').localeCompare(b.nummer || '', 'de'));
    if (hss.length === 0) {
      hsCard.appendChild(el('div', { class: 'empty' }, 'Noch keine Haushaltsstellen angelegt.'));
    } else {
      const t = el('table');
      t.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, 'Nummer'), el('th', {}, 'Bezeichnung'), el('th', { style: 'text-align:right' }, 'Budget'), el('th', {}, '')])));
      const tb = el('tbody');
      for (const h of hss) {
        tb.appendChild(el('tr', {}, [
          el('td', {}, el('strong', {}, h.nummer || '—')),
          el('td', {}, h.bezeichnung || '—'),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, (h.budget === null || h.budget === undefined || h.budget === '') ? '—' : euro(h.budget)),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm', onClick: () => haushaltsstelleDialog(h, refresh) }, 'Bearbeiten'), ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => { if (confirmDialog(`Haushaltsstelle „${hsLabel(h)}" löschen?`)) { store.deleteHaushaltsstelle(h.id); refresh(); } } }, 'Löschen'),
          ]),
        ]));
      }
      t.appendChild(tb); hsCard.appendChild(t);
    }
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px;' }, [
      el('h3', { style: 'margin:0;' }, 'Haushaltsstellen'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-primary', onClick: () => haushaltsstelleDialog(null, refresh) }, '+ Neue Haushaltsstelle'),
    ]));
    mount.appendChild(hsCard);
  }

  GR.views = GR.views || {};
  GR.views.renderAuslagen = renderAuslagen;
  GR.views.renderAuslagenStammdaten = renderAuslagenStammdaten;
  GR.auslagen = { empfaengerDialog, haushaltsstelleDialog };
})();
