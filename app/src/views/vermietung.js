(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog, formatDatum } = GR.ui;
  const {
    emptyVermietung, fullNameMieter, anzahlTage, istPauschal,
    berechneGrundmiete, berechneVerbrauch, berechneGesamt,
  } = GR.models;

  const STATUS_META = {
    geplant: { label: 'geplant', tag: 'prep', step: 1 },
    vertrag: { label: 'Vertrag', tag: 'live', step: 2 },
    abgerechnet: { label: 'abgerechnet', tag: 'done', step: 3 },
  };

  function euro(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
  function num3(n) { return (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 3 }); }
  function todayIso() { return new Date().toISOString().slice(0, 10); }

  function raumName(id) { const r = store.getRaum(id); return r ? r.name : '—'; }

  // ---------------------------------------------------------------- Übersicht
  function renderList(mount) {
    function refresh() { mount.innerHTML = ''; renderList(mount); }

    const vermietungen = store.listVermietungen().sort((a, b) => (b.startDatum || '').localeCompare(a.startDatum || ''));

    const onNew = () => {
      const v = emptyVermietung();
      const raeume = store.listRaeume().filter(r => r.aktiv);
      if (raeume.length) v.raumId = raeume[0].id;
      store.saveVermietung(v);
      location.hash = `#/vermietung?id=${v.id}`;
    };

    const onDelete = v => {
      if (!confirmDialog('Diese Vermietung wirklich löschen?')) return;
      store.deleteVermietung(v.id);
      refresh();
    };

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { class: 'btn-primary', onClick: onNew }, '+ Neue Vermietung'),
      el('a', { class: 'btn', href: '#/mieter' }, 'Mieter verwalten'),
    ]));
    mount.appendChild(el('h2', {}, 'Vermietungen'));

    const card = el('div', { class: 'card', style: 'padding:0' });
    if (vermietungen.length === 0) {
      card.appendChild(el('div', { class: 'empty' }, 'Noch keine Vermietungen erfasst. Oben „Neue Vermietung" anlegen.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Zeitraum'), el('th', {}, 'Objekt'), el('th', {}, 'Mieter'), el('th', {}, 'Anlass'), el('th', {}, 'Status'), el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      for (const v of vermietungen) {
        const mieter = store.getMieter(v.mieterId);
        const meta = STATUS_META[v.status] || STATUS_META.geplant;
        const zeitraum = v.startDatum
          ? formatDatum(v.startDatum) + (v.endDatum && v.endDatum !== v.startDatum ? '–' + formatDatum(v.endDatum) : '')
          : '—';
        tbody.appendChild(el('tr', {}, [
          el('td', {}, zeitraum),
          el('td', {}, raumName(v.raumId)),
          el('td', {}, mieter ? fullNameMieter(mieter) : '—'),
          el('td', {}, v.anlass || '—'),
          el('td', {}, [el('span', { class: 'tag ' + meta.tag }, meta.label)]),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('a', { class: 'btn btn-sm', href: `#/vermietung?id=${v.id}` }, 'Öffnen'),
            ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(v) }, 'Löschen'),
          ]),
        ]));
      }
      table.appendChild(tbody);
      card.appendChild(table);
    }
    mount.appendChild(card);
  }

  // ------------------------------------------------------------------ Detail
  function renderDetail(mount, id) {
    const stored = store.getVermietung(id);
    if (!stored) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, 'Vermietung nicht gefunden'),
        el('a', { href: '#/vermietung' }, '← Zurück zur Übersicht'),
      ]));
      return;
    }
    // Arbeitskopie – Tippen aktualisiert nur die Live-Anzeige, Speichern bei change.
    const v = JSON.parse(JSON.stringify(stored));
    v.zaehler = v.zaehler || { stromStart: null, stromEnde: null, gasStart: null, gasEnde: null };
    v.zusatzposten = v.zusatzposten || [];

    function persist() { store.saveVermietung(v); }
    function refresh() { mount.innerHTML = ''; renderDetail(mount, id); }

    const raeume = store.listRaeume().filter(r => r.aktiv || r.id === v.raumId);
    const meta = STATUS_META[v.status] || STATUS_META.geplant;
    const pauschal = istPauschal(store.getRaum(v.raumId));

    // ---- Kopf: Stepper + Status ----
    const steps = ['geplant', 'vertrag', 'abgerechnet'];
    const stepper = el('div', { class: 'verm-stepper' }, steps.map((s, i) => {
      const sm = STATUS_META[s];
      const cls = meta.step > sm.step ? 'done' : (meta.step === sm.step ? 'active' : '');
      return el('div', { class: 'verm-step ' + cls }, [
        el('span', { class: 'verm-step-num' }, String(i + 1)),
        el('span', {}, sm.label),
      ]);
    }));

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vermietung' }, '← Übersicht'),
      el('div', { class: 'spacer' }),
      el('span', { class: 'tag ' + meta.tag }, 'Status: ' + meta.label),
    ]));
    mount.appendChild(stepper);

    // ---- Live-Berechnung ----
    const liveTage = el('strong', {}, '');
    const liveGrund = el('strong', {}, '');
    const liveStrom = el('span', {}, '');
    const liveGas = el('span', {}, '');
    const liveGesamt = el('strong', {}, '');

    function currentRaum() { return store.getRaum(v.raumId); }
    function updateLive() {
      const raum = currentRaum();
      const tage = anzahlTage(v.startDatum, v.endDatum);
      liveTage.textContent = tage ? `${tage} Tag${tage === 1 ? '' : 'e'}` : '—';
      const grund = (v.preisSnapshot && v.preisSnapshot.grundMiete != null)
        ? v.preisSnapshot.grundMiete
        : berechneGrundmiete(raum, v.ortsfremd, tage);
      liveGrund.textContent = euro(grund);
      const g = berechneGesamt(v, raum);
      liveStrom.textContent = `${num3(g.stromMenge)} kWh → ${euro(g.stromKosten)}`;
      liveGas.textContent = `${num3(g.gasMenge)} cbm → ${euro(g.gasKosten)}`;
      liveGesamt.textContent = euro(g.gesamt);
    }

    // ---- Abschnitt 1: Eckdaten ----
    const raumSel = el('select', {});
    if (!v.raumId) raumSel.appendChild(el('option', { value: '', selected: true }, '— Objekt wählen —'));
    for (const r of raeume) raumSel.appendChild(el('option', { value: r.id, selected: r.id === v.raumId }, r.name));
    raumSel.onchange = () => { v.raumId = raumSel.value; persist(); refresh(); };

    const anlassInput = el('input', { type: 'text', value: v.anlass || '', placeholder: 'z. B. Geburtstagsfeier' });
    anlassInput.oninput = () => { v.anlass = anlassInput.value; };
    anlassInput.onchange = persist;

    const startInput = el('input', { type: 'date', value: v.startDatum || '' });
    startInput.oninput = () => { v.startDatum = startInput.value; if (!v.endDatum) { v.endDatum = startInput.value; endInput.value = startInput.value; } updateLive(); };
    startInput.onchange = persist;
    const endInput = el('input', { type: 'date', value: v.endDatum || '' });
    endInput.oninput = () => { v.endDatum = endInput.value; updateLive(); };
    endInput.onchange = persist;

    // Mieter-Auswahl (Combobox) + Ortsfremd
    const ortsfremdCb = el('input', { type: 'checkbox', checked: !!v.ortsfremd });
    ortsfremdCb.onchange = () => { v.ortsfremd = ortsfremdCb.checked; persist(); updateLive(); };

    const mieterBox = el('div', {});
    function renderMieterBox() {
      mieterBox.innerHTML = '';
      const sel = store.getMieter(v.mieterId);
      if (sel) {
        const anschrift = [sel.strasse, [sel.plz, sel.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        mieterBox.appendChild(el('div', { class: 'verm-mieter-sel' }, [
          el('div', {}, [
            el('strong', {}, fullNameMieter(sel)),
            anschrift ? el('div', { class: 'help' }, anschrift) : null,
            el('div', { class: 'help' }, sel.ortsfremd ? 'ortsfremd' : 'Anwohner'),
          ]),
          el('div', { class: 'toolbar', style: 'margin:0;' }, [
            el('button', { class: 'btn-sm', onClick: () => GR.mieter.dialog(sel, () => { renderMieterBox(); }) }, 'Bearbeiten'),
            el('button', { class: 'btn-sm', onClick: () => { v.mieterId = ''; persist(); renderMieterBox(); } }, 'Wechseln'),
          ]),
        ]));
      } else {
        mieterBox.appendChild(mieterCombo());
      }
    }

    function mieterCombo() {
      const wrap = el('div', { class: 'verm-combo' });
      const input = el('input', { type: 'text', placeholder: 'Mieter suchen…' });
      const results = el('div', { class: 'verm-combo-results', style: 'display:none;' });
      function pick(m) {
        v.mieterId = m.id;
        v.ortsfremd = !!m.ortsfremd;
        ortsfremdCb.checked = v.ortsfremd;
        persist();
        renderMieterBox();
        updateLive();
      }
      function renderResults() {
        const q = input.value.trim().toLowerCase();
        const all = store.listMieter().sort((a, b) => (a.nachname || '').localeCompare(b.nachname || '', 'de'));
        const matches = (q
          ? all.filter(m => fullNameMieter(m).toLowerCase().includes(q) || (m.ort || '').toLowerCase().includes(q))
          : all).slice(0, 8);
        results.innerHTML = '';
        for (const m of matches) {
          const anschrift = [m.strasse, m.ort].filter(Boolean).join(', ');
          results.appendChild(el('div', { class: 'verm-combo-item', onClick: () => pick(m) }, [
            el('span', {}, fullNameMieter(m)),
            anschrift ? el('span', { class: 'help' }, ' — ' + anschrift) : null,
          ]));
        }
        results.appendChild(el('div', { class: 'verm-combo-item verm-combo-new', onClick: () => {
          GR.mieter.dialog({ nachname: input.value.trim() }, m => pick(m));
        } }, '+ Neuen Mieter anlegen'));
        results.style.display = 'block';
      }
      input.onfocus = renderResults;
      input.oninput = renderResults;
      const onDocClick = e => { if (!wrap.contains(e.target)) results.style.display = 'none'; };
      document.addEventListener('click', onDocClick);
      wrap.appendChild(input);
      wrap.appendChild(results);
      return wrap;
    }
    renderMieterBox();

    mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, '1 · Eckdaten'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Objekt'), raumSel]),
        el('div', {}, [el('label', {}, 'Anlass'), anlassInput]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Von'), startInput]),
        el('div', {}, [el('label', {}, 'Bis'), endInput]),
      ]),
      el('div', { style: 'margin-top:12px;' }, [el('label', {}, 'Mieter'), mieterBox]),
      el('label', { style: 'display:flex; gap:8px; align-items:center; margin-top:10px;' }, [ortsfremdCb, ' Ortsfremd (höhere Grundmiete)']),
      el('div', { class: 'verm-summary', style: 'margin-top:14px;' }, [
        el('div', {}, ['Dauer: ', liveTage]),
        el('div', {}, ['Grundmiete: ', liveGrund]),
      ]),
    ]));

    // ---- Abschnitt 2: Vertrag / Anfangsstände ----
    const stromStart = el('input', { type: 'number', step: '0.001', value: v.zaehler.stromStart ?? '', placeholder: 'kWh' });
    stromStart.oninput = () => { v.zaehler.stromStart = stromStart.value === '' ? null : Number(stromStart.value); };
    stromStart.onchange = persist;
    const gasStart = el('input', { type: 'number', step: '0.001', value: v.zaehler.gasStart ?? '', placeholder: 'cbm' });
    gasStart.oninput = () => { v.zaehler.gasStart = gasStart.value === '' ? null : Number(gasStart.value); };
    gasStart.onchange = persist;

    const onVertrag = () => {
      if (!v.raumId) return toast('Bitte ein Objekt wählen');
      if (!v.mieterId) return toast('Bitte einen Mieter wählen');
      if (!v.startDatum) return toast('Bitte ein Startdatum wählen');
      const raum = currentRaum();
      const tage = anzahlTage(v.startDatum, v.endDatum);
      v.preisSnapshot = {
        grundMiete: berechneGrundmiete(raum, v.ortsfremd, tage),
        stromProKwh: raum.preise.stromProKwh || 0,
        gasProCbm: raum.preise.gasProCbm || 0,
      };
      v.vertragDatum = todayIso();
      v.status = 'vertrag';
      persist();
      toast('Vertrag erstellt – Preise eingefroren');
      refresh();
    };

    const vertragCard = el('div', { class: 'card' }, [
      el('h3', {}, '2 · Mietvertrag (Tag vor der Nutzung)'),
      el('p', { class: 'help' }, pauschal
        ? 'Pauschalmiete – Strom und Gas sind enthalten, es werden keine Zählerstände erfasst. Beim Erstellen des Vertrags wird der Preis eingefroren.'
        : 'Zählerstände zu Beginn erfassen. Beim Erstellen des Vertrags werden die aktuellen Preise eingefroren.'),
      pauschal ? null : el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Stromzähler Anfang (kWh)'), stromStart]),
        el('div', {}, [el('label', {}, 'Gaszähler Anfang (cbm)'), gasStart]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:14px; margin-bottom:0;' },
        v.status === 'geplant'
          ? [el('button', { class: 'btn-primary', onClick: onVertrag }, 'Vertrag erstellen & Preise einfrieren')]
          : [
              el('button', { class: 'btn-primary', onClick: () => GR.vermietungPdf.buildMietvertrag(v) }, 'Mietvertrag als PDF'),
              v.vertragDatum ? el('span', { class: 'help', style: 'align-self:center;' }, 'erstellt am ' + formatDatum(v.vertragDatum)) : null,
            ]
      ),
    ]);
    mount.appendChild(vertragCard);

    // ---- Abschnitt 3: Abrechnung / Endstände ----
    if (v.status !== 'geplant') {
      const stromEnde = el('input', { type: 'number', step: '0.001', value: v.zaehler.stromEnde ?? '', placeholder: 'kWh' });
      stromEnde.oninput = () => { v.zaehler.stromEnde = stromEnde.value === '' ? null : Number(stromEnde.value); updateLive(); };
      stromEnde.onchange = persist;
      const gasEnde = el('input', { type: 'number', step: '0.001', value: v.zaehler.gasEnde ?? '', placeholder: 'cbm' });
      gasEnde.oninput = () => { v.zaehler.gasEnde = gasEnde.value === '' ? null : Number(gasEnde.value); updateLive(); };
      gasEnde.onchange = persist;

      // Zusatzposten
      const zusatzWrap = el('div', {});
      function renderZusatz() {
        zusatzWrap.innerHTML = '';
        v.zusatzposten.forEach((p, i) => {
          const bez = el('input', { type: 'text', value: p.bezeichnung || '', placeholder: 'z. B. Reinigung, Küchennutzung' });
          bez.oninput = () => { p.bezeichnung = bez.value; };
          bez.onchange = persist;
          const betr = el('input', { type: 'number', step: '0.01', value: p.betrag ?? '', placeholder: '€' });
          betr.oninput = () => { p.betrag = betr.value === '' ? 0 : Number(betr.value); updateLive(); };
          betr.onchange = persist;
          zusatzWrap.appendChild(el('div', { class: 'row', style: 'margin-bottom:6px;' }, [
            el('div', { style: 'flex:2' }, bez),
            el('div', { style: 'flex:1' }, betr),
            el('div', { style: 'flex:0 0 auto; min-width:auto; display:flex; align-items:center;' }, [
              el('button', { class: 'btn-sm btn-danger', onClick: () => { v.zusatzposten.splice(i, 1); persist(); renderZusatz(); updateLive(); } }, '✕'),
            ]),
          ]));
        });
        zusatzWrap.appendChild(el('button', { class: 'btn-sm', onClick: () => { v.zusatzposten.push({ bezeichnung: '', betrag: 0 }); persist(); renderZusatz(); } }, '+ Posten hinzufügen'));
      }
      renderZusatz();

      const onAbrechnen = () => {
        v.abrechnungDatum = todayIso();
        v.status = 'abgerechnet';
        persist();
        toast('Als abgerechnet markiert');
        refresh();
      };

      mount.appendChild(el('div', { class: 'card' }, [
        el('h3', {}, '3 · Abrechnung (Tag nach der Nutzung)'),
        el('p', { class: 'help' }, pauschal
          ? 'Pauschalmiete – kein Strom-/Gasverbrauch. Optionale Zusatzposten für den Kostenbogen ergänzen.'
          : 'Zähler-Endstände erfassen; optionale Zusatzposten für den Kostenbogen ergänzen.'),
        pauschal ? null : el('div', { class: 'grid-2' }, [
          el('div', {}, [el('label', {}, 'Stromzähler Ende (kWh)'), stromEnde]),
          el('div', {}, [el('label', {}, 'Gaszähler Ende (cbm)'), gasEnde]),
        ]),
        pauschal ? null : el('div', { class: 'verm-summary', style: 'margin:12px 0;' }, [
          el('div', {}, ['Strom: ', liveStrom]),
          el('div', {}, ['Gas: ', liveGas]),
        ]),
        el('label', { style: 'margin-top:8px;' }, 'Zusatzposten'),
        zusatzWrap,
        el('div', { class: 'verm-total', style: 'margin-top:16px;' }, ['Gesamtbetrag: ', liveGesamt]),
        el('div', { class: 'toolbar', style: 'margin-top:14px; margin-bottom:0;' }, [
          el('button', { class: 'btn-primary', onClick: () => GR.vermietungPdf.buildKostenabrechnung(v) }, 'Kostenabrechnungsbogen als PDF'),
          v.status === 'vertrag' ? el('button', { onClick: onAbrechnen }, 'Als abgerechnet markieren') : null,
          v.abrechnungDatum ? el('span', { class: 'help', style: 'align-self:center;' }, 'abgerechnet am ' + formatDatum(v.abrechnungDatum)) : null,
        ]),
      ]));
    }

    updateLive();
  }

  function renderVermietung(mount, params) {
    if (params && params.id) return renderDetail(mount, params.id);
    return renderList(mount);
  }

  GR.views = GR.views || {};
  GR.views.renderVermietung = renderVermietung;
})();
