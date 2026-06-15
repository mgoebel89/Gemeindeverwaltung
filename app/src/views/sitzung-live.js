(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, nowTime, downloadFile, confirmDialog } = GR.ui;
  const { ergebnisAbstimmung, fullName } = GR.models;

  const SNIPPETS = [
    { label: '§22 Befangenheit', text: '<<Name>> hat wegen §22 Abs. 1 GemO nicht teilgenommen und zuvor im Zuhörerbereich Platz genommen / den Sitzungsraum verlassen.' },
    { label: 'Freiwilliger Verzicht', text: '<<Name>> hat freiwillig auf Teilnahme verzichtet.' },
    { label: '§36 Vorsitz ruht', text: 'Das Stimmrecht des/der Vorsitzenden ruht gemäß §36 Abs. 3 GemO.' },
  ];

  let keyController = null;
  const activeTopBySitzung = new Map();
  const anwesenheitOpenBySitzung = new Map();

  function orderedTops(sitzung) {
    return [
      ...sitzung.tops.filter(t => t.bereich === 'oeffentlich'),
      ...sitzung.tops.filter(t => t.bereich === 'nicht_oeffentlich'),
    ];
  }

  function isLockedFunktionstraeger(sitzung, mitgliedId) {
    return mitgliedId && (mitgliedId === sitzung.sitzungsleitungId || mitgliedId === sitzung.schriftfuehrerId);
  }

  // Mini HH:MM-Validator: leerer String erlaubt (=löschen), sonst HH:MM
  function normalizeZeit(raw) {
    if (raw === null || raw === undefined) return undefined; // Abbruch
    const t = String(raw).trim();
    if (!t) return '';
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return undefined;
    const h = Math.min(23, parseInt(m[1], 10));
    const mi = Math.min(59, parseInt(m[2], 10));
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }

  function askZeit(frage, defaultWert) {
    while (true) {
      const r = window.prompt(frage + '\n\n(HH:MM eingeben, leer lassen = keine Zeitangabe, Abbrechen = unverändert)', defaultWert || '');
      if (r === null) return undefined; // Abbruch
      const n = normalizeZeit(r);
      if (n === undefined) { alert('Bitte im Format HH:MM eingeben, z. B. 19:15.'); continue; }
      return n;
    }
  }

  function renderLive(mount, sitzungId) {
    if (keyController) { keyController.abort(); keyController = null; }

    let sitzung = store.getSitzung(sitzungId);
    if (!sitzung) {
      mount.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'Sitzung nicht gefunden'), el('a', { href: '#/' }, 'Zur Übersicht')]));
      return;
    }
    if (sitzung.status === 'vorbereitung') {
      // Beim ersten Übergang in den Live-Status: alle aktiven Mitglieder starten als anwesend.
      const aktive = store.listMitglieder().filter(m => m.aktiv).map(m => m.id);
      const known = new Set(sitzung.anwesendIds || []);
      const haveAny = known.size > 0;
      if (!haveAny) sitzung.anwesendIds = aktive.slice();
      sitzung.status = 'live';
      store.saveSitzung(sitzung);
    }
    if (!sitzung.anwesenheitsZeiten || typeof sitzung.anwesenheitsZeiten !== 'object') {
      sitzung.anwesenheitsZeiten = {};
    }

    const mitglieder = store.listMitglieder().filter(m => m.aktiv);
    const ordered = orderedTops(sitzung);
    let activeTopId = activeTopBySitzung.get(sitzungId);
    if (!activeTopId || !ordered.some(t => t.id === activeTopId)) {
      activeTopId = ordered[0]?.id || null;
    }
    activeTopBySitzung.set(sitzungId, activeTopId);

    const hasNichtOeff = sitzung.tops.some(t => t.bereich === 'nicht_oeffentlich');

    const save = () => store.saveSitzung(sitzung);
    const rerender = () => { mount.innerHTML = ''; renderLive(mount, sitzungId); };

    function goToTop(id) {
      activeTopId = id;
      activeTopBySitzung.set(sitzungId, id);
      rerender();
    }
    function step(delta) {
      const list = orderedTops(sitzung);
      if (!list.length) return;
      const idx = list.findIndex(t => t.id === activeTopId);
      const next = idx < 0 ? 0 : idx + delta;
      if (next < 0) { toast('Erster TOP erreicht'); return; }
      if (next >= list.length) { toast('Letzter TOP erreicht'); return; }
      goToTop(list[next].id);
    }

    keyController = new AbortController();
    window.addEventListener('keydown', e => {
      if (!location.hash.startsWith('#/sitzung/live')) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'PageDown') { e.preventDefault(); step(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
    }, { signal: keyController.signal });
    window.addEventListener('hashchange', () => {
      if (!location.hash.startsWith('#/sitzung/live') && keyController) {
        keyController.abort();
        keyController = null;
      }
    }, { signal: keyController.signal });

    // ---------- Anwesenheit ----------
    function setAnwesend(mitgliedId, anwesend) {
      const inListe = sitzung.anwesendIds.includes(mitgliedId);
      if (anwesend && !inListe) sitzung.anwesendIds.push(mitgliedId);
      if (!anwesend && inListe) sitzung.anwesendIds = sitzung.anwesendIds.filter(x => x !== mitgliedId);
    }

    function handleVerschieben(mitgliedId, ziel /* 'anwesend' | 'abwesend' */) {
      if (isLockedFunktionstraeger(sitzung, mitgliedId)) {
        // Locked: Sitzungsleiter/Schriftführer dürfen laut Vorgabe doch verschoben werden — kein Lock mehr.
      }
      const istAnwesend = sitzung.anwesendIds.includes(mitgliedId);
      const willAnwesend = ziel === 'anwesend';
      if (istAnwesend === willAnwesend) return; // keine Änderung
      const zeiten = sitzung.anwesenheitsZeiten[mitgliedId] || {};
      const m = mitglieder.find(x => x.id === mitgliedId);
      const name = m ? fullName(m) : '';
      if (willAnwesend) {
        const v = askZeit(`Wann ist ${name} eingetroffen?`, zeiten.kamUm || nowTime());
        if (v === undefined) return; // Abbruch → keine Änderung
        setAnwesend(mitgliedId, true);
        const z = { ...zeiten };
        if (v) z.kamUm = v; else delete z.kamUm;
        if (z.kamUm || z.gingUm) sitzung.anwesenheitsZeiten[mitgliedId] = z;
        else delete sitzung.anwesenheitsZeiten[mitgliedId];
      } else {
        const v = askZeit(`Wann hat ${name} die Sitzung verlassen?`, zeiten.gingUm || nowTime());
        if (v === undefined) return;
        setAnwesend(mitgliedId, false);
        const z = { ...zeiten };
        if (v) z.gingUm = v; else delete z.gingUm;
        if (z.kamUm || z.gingUm) sitzung.anwesenheitsZeiten[mitgliedId] = z;
        else delete sitzung.anwesenheitsZeiten[mitgliedId];
      }
      save(); rerender();
    }

    function editZeiten(mitgliedId) {
      const zeiten = sitzung.anwesenheitsZeiten[mitgliedId] || {};
      const m = mitglieder.find(x => x.id === mitgliedId);
      const name = m ? fullName(m) : '';
      const kam = askZeit(`Ankunftszeit für ${name}`, zeiten.kamUm || '');
      if (kam === undefined) return;
      const ging = askZeit(`Gehzeit für ${name}`, zeiten.gingUm || '');
      if (ging === undefined) return;
      const z = {};
      if (kam) z.kamUm = kam;
      if (ging) z.gingUm = ging;
      if (z.kamUm || z.gingUm) sitzung.anwesenheitsZeiten[mitgliedId] = z;
      else delete sitzung.anwesenheitsZeiten[mitgliedId];
      save(); rerender();
    }

    function setOneZeit(mitgliedId, key, frage) {
      const zeiten = sitzung.anwesenheitsZeiten[mitgliedId] || {};
      const v = askZeit(frage, zeiten[key] || nowTime());
      if (v === undefined) return;
      const nz = { ...zeiten };
      if (v) nz[key] = v; else delete nz[key];
      if (nz.kamUm || nz.gingUm) sitzung.anwesenheitsZeiten[mitgliedId] = nz;
      else delete sitzung.anwesenheitsZeiten[mitgliedId];
      save(); rerender();
    }

    function clearZeiten(mitgliedId) {
      delete sitzung.anwesenheitsZeiten[mitgliedId];
      save(); rerender();
    }

    function openZeitMenu(x, y, mitglied) {
      document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
      const z = sitzung.anwesenheitsZeiten[mitglied.id] || {};
      const name = fullName(mitglied);
      const menu = document.createElement('div');
      menu.className = 'ctx-menu';

      function close() {
        menu.remove();
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onKey, true);
      }
      function onOutside(ev) { if (!menu.contains(ev.target)) close(); }
      function onKey(ev) { if (ev.key === 'Escape') close(); }

      function addItem(label, action, danger) {
        const it = document.createElement('div');
        it.className = 'ctx-item' + (danger ? ' ctx-item--danger' : '');
        it.textContent = label;
        it.addEventListener('click', () => { close(); try { action(); } catch (err) { console.warn(err); } });
        menu.appendChild(it);
      }
      function addHeader(label) {
        const h = document.createElement('div');
        h.className = 'ctx-header';
        h.textContent = label;
        menu.appendChild(h);
      }
      function addSep() { const s = document.createElement('div'); s.className = 'ctx-sep'; menu.appendChild(s); }

      addHeader(name);
      addItem(
        z.kamUm ? `Später gekommen ändern (aktuell ${z.kamUm} Uhr)…` : 'Später gekommen…',
        () => setOneZeit(mitglied.id, 'kamUm', `Ankunftszeit für ${name}`),
      );
      addItem(
        z.gingUm ? `Früher gegangen ändern (aktuell ${z.gingUm} Uhr)…` : 'Früher gegangen…',
        () => setOneZeit(mitglied.id, 'gingUm', `Gehzeit für ${name}`),
      );
      addSep();
      addItem('Beide Zeiten bearbeiten…', () => editZeiten(mitglied.id));
      if (z.kamUm || z.gingUm) addItem('Zeiten löschen', () => clearZeiten(mitglied.id), true);

      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      const px = Math.min(x, window.innerWidth - rect.width - 8);
      const py = Math.min(y, window.innerHeight - rect.height - 8);
      menu.style.left = Math.max(4, px) + 'px';
      menu.style.top = Math.max(4, py) + 'px';
      setTimeout(() => {
        document.addEventListener('mousedown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
    }

    // Pointer-basiertes Drag (funktioniert für Maus UND Touch)
    function makeDraggableChip(mitglied) {
      const z = sitzung.anwesenheitsZeiten[mitglied.id] || {};
      const istAnw = sitzung.anwesendIds.includes(mitglied.id);
      const subline = [];
      if (z.kamUm) subline.push('ab ' + z.kamUm);
      if (z.gingUm) subline.push('bis ' + z.gingUm);

      const chip = el('div', {
        class: 'pers-chip' + (isLockedFunktionstraeger(sitzung, mitglied.id) ? ' funktion' : ''),
        'data-mid': mitglied.id,
        title: 'Ziehen / Klick: andere Spalte. Rechtsklick: Zeiten. Doppelklick: beide Zeiten.',
      }, [
        el('span', { class: 'pers-name' }, fullName(mitglied)),
        subline.length ? el('span', { class: 'pers-time' }, '(' + subline.join(', ') + ')') : null,
      ]);

      chip.addEventListener('dblclick', () => editZeiten(mitglied.id));

      // Kontextmenü (Rechtsklick / Long-Press)
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openZeitMenu(e.clientX, e.clientY, mitglied);
      });
      // Long-Press auf Touch (fallback, falls contextmenu nicht zuverlässig feuert)
      let pressTimer = null;
      chip.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          openZeitMenu(e.clientX, e.clientY, mitglied);
          // Drag-Initialisierung abbrechen, falls schon gestartet
          dragging = false;
          if (ghost) { ghost.remove(); ghost = null; }
          chip.classList.remove('pers-chip--dragging');
          pointerId = null;
        }, 550);
      });
      const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      chip.addEventListener('pointermove', cancelPress);
      chip.addEventListener('pointerup', cancelPress);
      chip.addEventListener('pointercancel', cancelPress);

      let dragging = false;
      let ghost = null;
      let startX = 0, startY = 0;
      let pointerId = null;
      const THRESHOLD = 6;

      chip.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        startX = e.clientX; startY = e.clientY;
        pointerId = e.pointerId;
        chip.setPointerCapture(pointerId);
        dragging = false;
      });

      chip.addEventListener('pointermove', (e) => {
        if (pointerId === null) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          ghost = chip.cloneNode(true);
          ghost.classList.add('pers-chip--ghost');
          ghost.style.position = 'fixed';
          ghost.style.pointerEvents = 'none';
          ghost.style.zIndex = '999';
          document.body.appendChild(ghost);
          chip.classList.add('pers-chip--dragging');
        }
        ghost.style.left = (e.clientX + 6) + 'px';
        ghost.style.top = (e.clientY + 6) + 'px';
        const over = document.elementFromPoint(e.clientX, e.clientY);
        document.querySelectorAll('.anw-col.drop-target').forEach(c => c.classList.remove('drop-target'));
        const col = over && over.closest && over.closest('.anw-col');
        if (col) col.classList.add('drop-target');
      });

      const finish = (e) => {
        if (pointerId === null) return;
        try { chip.releasePointerCapture(pointerId); } catch (_) {}
        const wasDragging = dragging;
        const upX = e.clientX, upY = e.clientY;
        pointerId = null;
        dragging = false;
        chip.classList.remove('pers-chip--dragging');
        if (ghost) { ghost.remove(); ghost = null; }
        document.querySelectorAll('.anw-col.drop-target').forEach(c => c.classList.remove('drop-target'));
        if (wasDragging) {
          const dropEl = document.elementFromPoint(upX, upY);
          const col = dropEl && dropEl.closest && dropEl.closest('.anw-col');
          if (col) {
            const ziel = col.getAttribute('data-col');
            handleVerschieben(mitglied.id, ziel);
          }
        } else {
          // Klick = umschalten
          handleVerschieben(mitglied.id, istAnw ? 'abwesend' : 'anwesend');
        }
      };
      chip.addEventListener('pointerup', finish);
      chip.addEventListener('pointercancel', finish);

      return chip;
    }

    function anwesenheitsCard() {
      const open = !!anwesenheitOpenBySitzung.get(sitzungId);
      const anwesende = mitglieder.filter(m => sitzung.anwesendIds.includes(m.id));
      const abwesende = mitglieder.filter(m => !sitzung.anwesendIds.includes(m.id));

      const toggleBtn = el('button', { class: 'btn-sm', onClick: () => {
        anwesenheitOpenBySitzung.set(sitzungId, !open);
        rerender();
      } }, open ? 'Einklappen' : 'Aufklappen');

      const header = el('div', { class: 'toolbar', style: 'margin-bottom:0' }, [
        el('h3', { style: 'margin:0' }, 'Anwesenheit'),
        el('span', { class: 'help' }, `${anwesende.length} anwesend / ${abwesende.length} abwesend`),
        el('div', { class: 'spacer' }),
        toggleBtn,
      ]);

      if (!open) return el('div', { class: 'card' }, [header]);

      const colAnw = el('div', { class: 'anw-col', 'data-col': 'anwesend' }, [
        el('div', { class: 'anw-col-head anw-col-head--in' }, `Anwesend (${anwesende.length})`),
        el('div', { class: 'anw-col-body' }, anwesende.length
          ? anwesende.map(makeDraggableChip)
          : [el('div', { class: 'help', style: 'padding:8px' }, 'Niemand anwesend')]),
      ]);
      const colAbw = el('div', { class: 'anw-col', 'data-col': 'abwesend' }, [
        el('div', { class: 'anw-col-head anw-col-head--out' }, `Abwesend (${abwesende.length})`),
        el('div', { class: 'anw-col-body' }, abwesende.length
          ? abwesende.map(makeDraggableChip)
          : [el('div', { class: 'help', style: 'padding:8px' }, 'Niemand abwesend')]),
      ]);

      const hint = el('p', { class: 'help', style: 'margin-top:8px' },
        'Ziehen oder klicken, um Mitglieder zwischen den Spalten zu verschieben. Doppelklick öffnet die Zeit-Eingabe.');

      return el('div', { class: 'card' }, [
        header,
        el('div', { class: 'anw-grid' }, [colAnw, colAbw]),
        hint,
      ]);
    }

    function timeRow(label, key) {
      const i = el('input', { type: 'time', value: sitzung[key] || '' });
      i.onchange = e => { sitzung[key] = e.target.value; save(); };
      const now = el('button', { class: 'btn-sm', onClick: () => { sitzung[key] = nowTime(); save(); rerender(); } }, 'Jetzt');
      return el('div', { style: 'padding:4px 10px;' }, [
        el('label', { style: 'font-size:0.75rem' }, label),
        el('div', { style: 'display:flex; gap:4px' }, [i, now]),
      ]);
    }

    function sidebar() {
      const list = el('div', { class: 'top-list' });
      list.appendChild(el('div', { class: 'section-label' }, 'Öffentlicher Teil'));
      const oeff = sitzung.tops.filter(t => t.bereich === 'oeffentlich');
      if (oeff.length === 0) list.appendChild(el('div', { class: 'help', style: 'padding:4px 10px' }, '— keine —'));
      for (const t of oeff) {
        list.appendChild(el('div', { class: 'top-item' + (t.id === activeTopId ? ' active' : ''), onClick: () => goToTop(t.id) }, `TOP ${t.nummer}: ${t.titel || '(ohne Titel)'}`));
      }
      if (hasNichtOeff) {
        list.appendChild(el('div', { class: 'section-label' }, 'Nicht-öffentlicher Teil'));
        const nicht = sitzung.tops.filter(t => t.bereich === 'nicht_oeffentlich');
        for (const t of nicht) {
          list.appendChild(el('div', { class: 'top-item' + (t.id === activeTopId ? ' active' : ''), onClick: () => goToTop(t.id) }, `TOP ${t.nummer}: ${t.titel || '(ohne Titel)'}`));
        }
      }

      const zeitenBlock = el('div', { style: 'border-top:1px solid var(--border); margin-top:8px; padding-top:8px' });
      zeitenBlock.appendChild(el('div', { class: 'section-label' }, 'Zeiten'));
      zeitenBlock.appendChild(timeRow('Beginn öffentlich', 'beginnOeffentlich'));
      if (hasNichtOeff) {
        zeitenBlock.appendChild(timeRow('Ende öffentlich', 'endeOeffentlich'));
        zeitenBlock.appendChild(timeRow('Beginn nicht-öffentlich', 'beginnNichtOeffentlich'));
      }
      zeitenBlock.appendChild(timeRow('Ende Sitzung', 'endeSitzung'));
      if (!hasNichtOeff) {
        zeitenBlock.appendChild(el('div', { class: 'help', style: 'padding:4px 10px' }, 'Kein nicht-öffentlicher Teil — „Ende Sitzung" gilt auch als Ende des öffentlichen Teils.'));
      }
      list.appendChild(zeitenBlock);

      list.appendChild(el('div', { class: 'help', style: 'padding:8px 10px; border-top:1px solid var(--border); margin-top:8px' }, 'Bild ↑ / Bild ↓: vorheriger / nächster TOP'));
      return list;
    }

    function multiSelectMitglieder(label, ausgewaehlteIds, onChange) {
      const wrap = el('div', { class: 'multi-mitglieder' });
      wrap.appendChild(el('label', {}, label));
      const list = el('div', { class: 'checkbox-list' });
      for (const m of mitglieder) {
        const cb = el('input', { type: 'checkbox', checked: ausgewaehlteIds.includes(m.id) });
        cb.onchange = () => {
          const next = cb.checked
            ? [...new Set([...ausgewaehlteIds, m.id])]
            : ausgewaehlteIds.filter(x => x !== m.id);
          onChange(next);
        };
        list.appendChild(el('label', {}, [cb, ' ', fullName(m)]));
      }
      wrap.appendChild(list);
      return wrap;
    }

    function sitzungsleitungSelect(top) {
      const sel = el('select', {});
      sel.appendChild(el('option', { value: '', selected: !top.sitzungsleitungId }, '— Standard (keine Abweichung) —'));
      const anwesende = mitglieder.filter(m => sitzung.anwesendIds.includes(m.id));
      // Falls bisher gespeicherter Wert nicht mehr anwesend ist: trotzdem als Option zeigen (mit Hinweis), damit nichts stumm verschwindet
      const knownIds = new Set(anwesende.map(m => m.id));
      if (top.sitzungsleitungId && !knownIds.has(top.sitzungsleitungId)) {
        const m = mitglieder.find(x => x.id === top.sitzungsleitungId);
        if (m) sel.appendChild(el('option', { value: m.id, selected: true }, fullName(m) + ' (zurzeit abwesend)'));
      }
      for (const m of anwesende) {
        sel.appendChild(el('option', { value: m.id, selected: m.id === top.sitzungsleitungId }, fullName(m)));
      }
      sel.onchange = e => { top.sitzungsleitungId = e.target.value; save(); rerender(); };
      return sel;
    }

    function abstimmungCard(top) {
      const abst = top.abstimmung;
      const anwAnzahl = sitzung.anwesendIds.length;

      const cbDurch = el('input', { type: 'checkbox', checked: abst.durchgefuehrt });
      cbDurch.onchange = () => { abst.durchgefuehrt = cbDurch.checked; save(); rerender(); };

      const iJa = el('input', { type: 'number', min: '0', value: abst.ja, disabled: !abst.durchgefuehrt });
      iJa.oninput = e => { abst.ja = +e.target.value || 0; save(); };
      const iNein = el('input', { type: 'number', min: '0', value: abst.nein, disabled: !abst.durchgefuehrt });
      iNein.oninput = e => { abst.nein = +e.target.value || 0; save(); };
      const iEnth = el('input', { type: 'number', min: '0', value: abst.enthaltung, disabled: !abst.durchgefuehrt });
      iEnth.oninput = e => { abst.enthaltung = +e.target.value || 0; save(); };

      const setEinstimmigDafuer = () => {
        abst.durchgefuehrt = true; abst.ja = anwAnzahl; abst.nein = 0; abst.enthaltung = 0;
        save(); rerender();
      };
      const setEinstimmigDagegen = () => {
        abst.durchgefuehrt = true; abst.ja = 0; abst.nein = anwAnzahl; abst.enthaltung = 0;
        save(); rerender();
      };
      const setStimmenmehrheit = () => {
        abst.durchgefuehrt = true; abst.ja = 0; abst.nein = 0; abst.enthaltung = 0;
        save(); rerender();
      };

      const onBestaetigen = () => {
        toast('Beschluss bestätigt');
        step(1);
      };

      const children = [
        el('h3', {}, 'Abstimmung'),
        el('label', {}, [cbDurch, ' Abstimmung wurde durchgeführt']),
        el('div', { class: 'toolbar', style: 'margin-top:8px; flex-wrap:wrap; gap:6px;' }, [
          el('button', { class: 'btn-sm btn-primary', onClick: setEinstimmigDafuer }, 'Einstimmig dafür'),
          el('button', { class: 'btn-sm', onClick: setEinstimmigDagegen }, 'Einstimmig dagegen'),
          el('button', { class: 'btn-sm', onClick: setStimmenmehrheit }, 'Stimmenmehrheit'),
          el('span', { class: 'help', style: 'margin-left:6px' }, `Anwesende: ${anwAnzahl}`),
        ]),
        el('div', { class: 'grid-3', style: 'margin-top:8px' }, [
          el('div', {}, [el('label', {}, 'Ja-Stimmen'), iJa]),
          el('div', {}, [el('label', {}, 'Nein-Stimmen'), iNein]),
          el('div', {}, [el('label', {}, 'Enthaltungen'), iEnth]),
        ]),
        el('p', { class: 'help', style: 'margin-top:8px' }, 'Ergebnis: ' + ergebnisAbstimmung(abst)),
      ];

      if (abst.durchgefuehrt) {
        children.push(el('div', { style: 'margin-top:10px' }, [
          el('button', { class: 'btn-primary', onClick: onBestaetigen }, '✓ Beschluss bestätigt → nächster TOP'),
        ]));
      }

      return el('div', { class: 'card' }, children);
    }

    function topDetail() {
      if (!activeTopId) {
        return el('div', { class: 'card empty' }, 'Bitte links einen TOP wählen oder über „Vorbereitung" hinzufügen.');
      }
      const top = sitzung.tops.find(t => t.id === activeTopId);
      if (!top) return el('div', { class: 'card empty' }, 'TOP nicht gefunden.');

      const titel = el('input', { type: 'text', value: top.titel });
      titel.oninput = e => { top.titel = e.target.value; save(); };

      const vorlage = el('textarea', { style: 'min-height:140px' });
      vorlage.value = top.beschlussvorlage;
      vorlage.oninput = e => { top.beschlussvorlage = e.target.value; save(); };

      const bemerk = el('textarea');
      bemerk.value = top.bemerkungen;
      bemerk.oninput = e => { top.bemerkungen = e.target.value; save(); };

      const children = [
        el('div', { class: 'card' }, [
          el('div', { class: 'toolbar' }, [
            el('span', { class: 'tag ' + (top.bereich === 'oeffentlich' ? 'prep' : 'live') }, top.bereich === 'oeffentlich' ? 'öffentlich' : 'nicht-öffentlich'),
            el('strong', {}, `TOP ${top.nummer}`),
          ]),
          el('label', {}, 'Titel'),
          titel,
          el('label', { style: 'margin-top:10px' }, 'Beschlussvorlage'),
          vorlage,
          el('label', { style: 'margin-top:10px' }, 'Sitzungsleitung für diesen TOP (abweichend)'),
          sitzungsleitungSelect(top),
          el('p', { class: 'help' }, 'Leer = Standard-Sitzungsleitung. Auswahl ist auf aktuell Anwesende beschränkt.'),
        ]),
        abstimmungCard(top),
      ];

      if (top.abstimmung && top.abstimmung.durchgefuehrt) {
        children.push(el('div', { class: 'card' }, [
          el('h3', {}, 'Vermerke zur Abstimmung'),
          multiSelectMitglieder(
            'Ratsmitglieder, die wegen §22 Abs. 1 GemO nicht teilgenommen haben',
            top.befangenheitsIds || [],
            (next) => { top.befangenheitsIds = next; save(); rerender(); },
          ),
          el('div', { style: 'margin-top:12px' }, [
            multiSelectMitglieder(
              'Ratsmitglieder, die freiwillig auf Teilnahme verzichtet haben',
              top.freiwilligerVerzichtIds || [],
              (next) => { top.freiwilligerVerzichtIds = next; save(); rerender(); },
            ),
          ]),
          el('div', { style: 'margin-top:12px' }, [
            multiSelectMitglieder(
              'Mitglieder, deren Stimmrecht gemäß §36 Abs. 3 GemO ruht',
              top.stimmrechtRuhtIds || [],
              (next) => { top.stimmrechtRuhtIds = next; save(); rerender(); },
            ),
          ]),
        ]));
      }

      return el('div', {}, [
        ...children,
        el('div', { class: 'card' }, [
          el('h3', {}, 'Bemerkungen'),
          bemerk,
        ]),
      ]);
    }

    function exportToolbar() {
      return el('div', { class: 'toolbar' }, [
        el('a', { href: '#/', class: 'btn' }, '← Übersicht'),
        el('a', { href: `#/sitzung/vorbereitung?id=${sitzung.id}`, class: 'btn' }, 'Vorbereitung'),
        el('div', { class: 'spacer' }),
        (() => {
          const abgeschlossen = sitzung.status === 'abgeschlossen';
          const btn = el('button', {
            class: 'btn-primary',
            title: abgeschlossen ? 'Endgültiges Protokoll erzeugen' : 'Erst nach Sitzungsabschluss verfügbar',
            disabled: !abgeschlossen,
            onClick: () => abgeschlossen && GR.pdf.buildPdf(sitzung, { draft: false }),
          }, 'PDF exportieren');
          return btn;
        })(),
        sitzung.status !== 'abgeschlossen'
          ? el('button', {
              title: 'Vorläufige Version mit Wasserzeichen (ENTWURF)',
              onClick: () => GR.pdf.buildPdf(sitzung, { draft: true }),
            }, 'Entwurfs-PDF')
          : null,
        el('button', { onClick: () => {
          const csv = GR.csv.buildCsv(sitzung);
          downloadFile(`Beschluesse-${sitzung.datum}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
        } }, 'CSV (Beschlüsse)'),
        el('button', { onClick: () => {
          const json = GR.nocodb.buildNocoDbJson(sitzung);
          downloadFile(`NocoDB-${sitzung.datum}.json`, JSON.stringify(json, null, 2), 'application/json');
        } }, 'NocoDB-Export (JSON)'),
        (() => {
          const settings = store.getSettings();
          const cfg = settings.nocodb || {};
          const configured = !!(cfg.serverUrl && cfg.token && cfg.baseId);
          const abgeschlossen = sitzung.status === 'abgeschlossen';
          const enabled = configured && abgeschlossen;
          let title = 'Direkt in die NocoDB hochladen';
          if (!configured) title = 'NocoDB nicht konfiguriert — siehe Einstellungen';
          else if (!abgeschlossen) title = 'Erst nach Sitzungsabschluss verfügbar';
          return el('button', {
            class: 'btn-primary',
            disabled: !enabled,
            title,
            onClick: async () => {
              if (!enabled) return;
              try {
                const res = await GR.nocodb_client.syncSitzungComplete(sitzung);
                toast(`NocoDB: ${res.sitzungen} Sitzung + ${res.beschluesse} Beschlüsse synchronisiert`);
              } catch (e) {
                if (confirmDialog('Sync fehlgeschlagen:\n\n' + e.message + '\n\nFür späteren Sync in Queue legen?')) {
                  store.enqueueSync(sitzung.id, e.message);
                  toast('In Sync-Queue gelegt');
                }
              }
            },
          }, 'Zu NocoDB pushen');
        })(),
        el('button', { onClick: () => {
          const blob = { schemaVersion: sitzung.schemaVersion, sitzung };
          downloadFile(`Sitzung-${sitzung.datum}.json`, JSON.stringify(blob, null, 2), 'application/json');
        } }, 'Sitzung als JSON sichern'),
        el('button', { class: sitzung.status === 'abgeschlossen' ? 'btn-primary' : '', onClick: () => {
          if (sitzung.status !== 'abgeschlossen') {
            if (!confirmDialog('Sitzung als abgeschlossen markieren?')) return;
            sitzung.status = 'abgeschlossen';
          } else {
            sitzung.status = 'live';
          }
          save(); rerender();
        } }, sitzung.status === 'abgeschlossen' ? 'Wieder öffnen' : 'Sitzung abschließen'),
      ]);
    }

    mount.appendChild(exportToolbar());
    mount.appendChild(anwesenheitsCard());
    mount.appendChild(el('div', { class: 'live-layout' }, [sidebar(), topDetail()]));
  }

  GR.views = GR.views || {};
  GR.views.renderLive = renderLive;
})();
