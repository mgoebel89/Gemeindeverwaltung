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
      el('a', { class: 'btn', href: '#/protokolle' }, 'Protokolle (Checklisten)'),
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
          el('td', {}, [v.kostenfrei ? el('span', { class: 'tag prep' }, 'kostenfrei') : el('span', { class: 'tag ' + meta.tag }, meta.label)]),
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
    v.zaehlerFotos = v.zaehlerFotos || { stromStart: null, stromEnde: null, gasStart: null, gasEnde: null };
    v.zusatzposten = v.zusatzposten || [];
    v.protokolle = v.protokolle || { uebergabe: null, abnahme: null };

    function persist() { store.saveVermietung(v); }
    function refresh() { mount.innerHTML = ''; renderDetail(mount, id); }

    function mieterName() { const m = store.getMieter(v.mieterId); return m ? fullNameMieter(m) : 'Mieter/in'; }

    // Unterschriften-Steuerung für ein Dokument (Vertrag oder Protokoll).
    // holder trägt `holder.mieterUnterschrift = {dataUrl, datum}` inline im
    // Datensatz (läuft im Payload/Backup/NocoDB mit). Nur der Mieter unterschreibt
    // live; die Gemeinde/Bürgermeister bleibt das Einstellungsbild.
    function signaturControl(holder, opts = {}) {
      const box = el('div', { class: 'sig-inline' });
      function capture() {
        GR.ui.captureSignature({
          title: opts.title || 'Unterschrift Mieter',
          subtitle: opts.subtitle || '',
          name: mieterName(),
          consent: opts.consent || 'Mit der Unterschrift bestätigt der Mieter die Angaben dieses Dokuments.',
          onDone: (res) => {
            if (!res || !res.dataUrl) return;
            holder.mieterUnterschrift = { dataUrl: res.dataUrl, datum: todayIso(), w: res.w, h: res.h };
            persist(); draw(); toast('Unterschrift gespeichert');
          },
        });
      }
      function draw() {
        box.innerHTML = '';
        const sig = holder.mieterUnterschrift;
        if (sig && sig.dataUrl) {
          box.appendChild(el('img', { class: 'sig-thumb', src: sig.dataUrl, alt: 'Unterschrift' }));
          box.appendChild(el('span', { class: 'help' }, 'unterschrieben' + (sig.datum ? ' am ' + formatDatum(sig.datum) : '')));
          box.appendChild(el('button', { class: 'btn-sm', type: 'button', onClick: capture }, 'Ändern'));
          box.appendChild(el('button', { class: 'btn-sm btn-danger', type: 'button', onClick: () => { holder.mieterUnterschrift = null; persist(); draw(); } }, 'Entfernen'));
        } else {
          box.appendChild(el('button', { class: 'btn-sm btn-primary', type: 'button', onClick: capture }, '✍ Mieter unterschreibt'));
          for (const s of (opts.reuseSources || [])) {
            if (!s || !s.sig || !s.sig.dataUrl) continue;
            box.appendChild(el('button', { class: 'btn-sm', type: 'button', onClick: () => {
              holder.mieterUnterschrift = { dataUrl: s.sig.dataUrl, datum: s.sig.datum || todayIso(), w: s.sig.w, h: s.sig.h };
              persist(); draw(); toast('Unterschrift übernommen');
            } }, '↩ ' + s.label));
          }
        }
      }
      draw();
      return el('div', { class: 'sig-row' }, [
        el('span', { class: 'sig-row-label' }, opts.label || 'Unterschrift Mieter:'),
        box,
      ]);
    }

    // Zwei Buttons „📷 Kamera" (erzwingt Kameraaufnahme via capture) und
    // „🖼 Galerie" (Dateiauswahl). Am Desktop wird capture ignoriert → beide
    // öffnen den normalen Dateidialog. onPick(file) bekommt die gewählte Datei.
    function fotoPickButtons(onPick, kamLabel = '📷 Kamera') {
      const pick = async (capture) => { const f = await GR.ui.pickFile('image/*', capture); if (f) onPick(f); };
      return [
        el('button', { class: 'btn-sm', type: 'button', onClick: () => pick('environment') }, kamLabel),
        el('button', { class: 'btn-sm', type: 'button', onClick: () => pick(null) }, '🖼 Galerie'),
      ];
    }

    // Foto-Steuerung für einen Zählerstand (Beweisführung). Zeigt Miniatur +
    // „Entfernen", solange ein Foto hinterlegt ist, sonst die Aufnahme-Buttons.
    function fotoControl(kind) {
      const box = el('div', { class: 'verm-foto', style: 'display:flex; gap:8px; align-items:center; margin-top:6px;' });
      function render() {
        box.innerHTML = '';
        const fid = v.zaehlerFotos && v.zaehlerFotos[kind];
        const file = fid ? store.getVermietungFoto(id, fid) : null;
        if (file) {
          const url = store.vermietungFotoUrl(fid);
          box.appendChild(el('a', { href: url, target: '_blank', rel: 'noopener', title: 'Foto ansehen' }, [
            el('img', { src: url, style: 'height:44px; width:44px; object-fit:cover; border:1px solid var(--border); border-radius:4px;' }),
          ]));
          box.appendChild(el('span', { class: 'help' }, 'Foto hinterlegt'));
          box.appendChild(el('button', { class: 'btn-sm btn-danger', type: 'button', onClick: async () => {
            try { await store.deleteVermietungFoto(id, fid); } catch (e) { return toast('Löschen fehlgeschlagen: ' + e.message); }
            v.zaehlerFotos[kind] = null; persist(); render();
          } }, 'Entfernen'));
        } else {
          const onPick = async (f) => {
            try {
              const rec = await store.uploadVermietungFoto(id, f, kind);
              if (!v.zaehlerFotos) v.zaehlerFotos = { stromStart: null, stromEnde: null, gasStart: null, gasEnde: null };
              v.zaehlerFotos[kind] = rec.id; persist(); render();
              toast('Foto gespeichert');
            } catch (e) { toast('Upload fehlgeschlagen: ' + e.message); }
          };
          for (const b of fotoPickButtons(onPick)) box.appendChild(b);
        }
      }
      render();
      return box;
    }

    // ---- Übergabe-/Abnahmeprotokoll (Checkliste ausfüllen) ----
    function buildProtokollCard() {
      const raum = store.getRaum(v.raumId);
      const newId = () => (crypto.randomUUID && crypto.randomUUID()) || ('p-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      const TYPES = [['uebergabe', 'Übergabe (Ausgabe)'], ['abnahme', 'Abnahme (Rückgabe)']];
      const content = el('div', {});

      function startProtokoll(type) {
        // Punkte einfrieren: Abnahme übernimmt die Punkte der Übergabe (falls
        // vorhanden), sonst die aktuelle Objekt-Vorlage.
        let source;
        if (type === 'abnahme' && v.protokolle.uebergabe && (v.protokolle.uebergabe.punkte || []).length) {
          source = v.protokolle.uebergabe.punkte.map(p => ({ text: p.text }));
        } else {
          source = ((raum && raum.uebergabeCheckliste) || []).map(p => ({ text: p.text }));
        }
        v.protokolle[type] = {
          datum: todayIso(),
          punkte: source.map(p => ({ id: newId(), text: p.text, status: 'offen', notiz: '', fotoId: null })),
        };
        persist(); render();
      }

      async function resetProtokoll(type) {
        const proto = v.protokolle[type];
        if (!proto) return;
        if (!confirmDialog('Dieses Protokoll wirklich zurücksetzen? Bewertungen, Notizen und Fotos gehen verloren.')) return;
        for (const p of (proto.punkte || [])) {
          if (p.fotoId) { try { await store.deleteVermietungFoto(id, p.fotoId); } catch (_) {} }
        }
        v.protokolle[type] = null; persist(); render();
      }

      function punktFotoControl(punkt, type) {
        const box = el('div', { style: 'display:flex; gap:8px; align-items:center; margin-top:4px;' });
        function draw() {
          box.innerHTML = '';
          const file = punkt.fotoId ? store.getVermietungFoto(id, punkt.fotoId) : null;
          if (file) {
            const url = store.vermietungFotoUrl(punkt.fotoId);
            box.appendChild(el('a', { href: url, target: '_blank', rel: 'noopener' }, [
              el('img', { src: url, style: 'height:40px; width:40px; object-fit:cover; border:1px solid var(--border); border-radius:4px;' }),
            ]));
            box.appendChild(el('button', { class: 'btn-sm btn-danger', type: 'button', onClick: async () => {
              try { await store.deleteVermietungFoto(id, punkt.fotoId); } catch (e) { return toast('Löschen fehlgeschlagen: ' + e.message); }
              punkt.fotoId = null; persist(); draw();
            } }, 'Foto entfernen'));
          } else {
            const onPick = async (f) => {
              try {
                const rec = await store.uploadVermietungFoto(id, f, 'protokoll_' + type + '_' + punkt.id);
                punkt.fotoId = rec.id; persist(); draw();
                toast('Foto gespeichert');
              } catch (e) { toast('Upload fehlgeschlagen: ' + e.message); }
            };
            for (const b of fotoPickButtons(onPick, '📷 Kamera (Beanstandung)')) box.appendChild(b);
          }
        }
        draw();
        return box;
      }

      function renderProto(type, proto) {
        const section = el('div', { class: 'prot-section' });
        const datumI = el('input', { type: 'date', value: proto.datum || '' });
        datumI.onchange = () => { proto.datum = datumI.value; persist(); };
        const nokCount = proto.punkte.filter(p => p.status === 'nichtok').length;
        const okCount = proto.punkte.filter(p => p.status === 'ok').length;
        section.appendChild(el('div', { class: 'toolbar', style: 'align-items:center; margin-bottom:8px; flex-wrap:wrap;' }, [
          el('label', { style: 'margin:0;' }, 'Datum:'), datumI,
          el('span', { class: 'help', style: 'margin:0;' }, `${okCount} OK · ${nokCount} Beanstandung${nokCount === 1 ? '' : 'en'} · ${proto.punkte.length} Punkte`),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn-sm', onClick: () => GR.vermietungPdf.buildUebergabeprotokoll(v, type) }, 'Als PDF'),
          GR.ui.savePdfToPaperless ? el('button', { class: 'btn-sm', onClick: () => GR.vermietungPdf.buildUebergabeprotokoll(v, type, {
            target: 'paperless',
            prefillTitle: (type === 'uebergabe' ? 'Übergabeprotokoll ' : 'Abnahmeprotokoll ') + raumName(v.raumId) + ' ' + (v.startDatum || ''),
            onUploaded: (doc) => { if (docsSection) docsSection.linkDoc(doc); },
          }) }, '📥 Paperless') : null,
          el('button', { class: 'btn-sm btn-danger', onClick: () => resetProtokoll(type) }, 'Zurücksetzen'),
        ]));

        if (!proto.punkte.length) {
          section.appendChild(el('p', { class: 'help' }, 'Keine Punkte in der Vorlage – unter „Protokolle (Checklisten)" anlegen und Protokoll neu starten.'));
        }
        proto.punkte.forEach(p => {
          const row = el('div', { class: 'prot-row status-' + p.status });
          const setStatus = (s) => { p.status = (p.status === s ? 'offen' : s); persist(); render(); };
          const okBtn = el('button', { class: 'btn-sm prot-ok' + (p.status === 'ok' ? ' active' : ''), type: 'button', onClick: () => setStatus('ok') }, 'OK');
          const nokBtn = el('button', { class: 'btn-sm prot-nok' + (p.status === 'nichtok' ? ' active' : ''), type: 'button', onClick: () => setStatus('nichtok') }, 'nicht OK');
          row.appendChild(el('div', { class: 'prot-row-head' }, [
            el('span', { class: 'prot-text' }, p.text || '(ohne Text)'),
            el('span', { class: 'prot-btns' }, [okBtn, nokBtn]),
          ]));
          if (p.status === 'nichtok') {
            const notiz = el('input', { type: 'text', value: p.notiz || '', placeholder: 'Was ist zu beanstanden?' });
            notiz.oninput = () => { p.notiz = notiz.value; };
            notiz.onchange = persist;
            row.appendChild(el('div', { class: 'prot-beanstand' }, [notiz, punktFotoControl(p, type)]));
          }
          section.appendChild(row);
        });
        section.appendChild(signaturControl(proto, {
          title: (type === 'uebergabe' ? 'Übergabeprotokoll' : 'Abnahmeprotokoll') + ' – Unterschrift Mieter',
          subtitle: raumName(v.raumId),
          reuseSources: [
            { label: 'Aus Mietvertrag übernehmen', sig: v.mieterUnterschrift },
            type === 'abnahme' ? { label: 'Aus Übergabe übernehmen', sig: v.protokolle.uebergabe && v.protokolle.uebergabe.mieterUnterschrift } : null,
          ],
        }));
        return section;
      }

      function render() {
        content.innerHTML = '';
        for (const [type, label] of TYPES) {
          const proto = v.protokolle[type];
          content.appendChild(el('div', { class: 'prot-head' }, [el('h4', { style: 'margin:0;' }, label)]));
          if (!proto) {
            content.appendChild(el('div', { style: 'margin:6px 0 16px;' }, [
              el('button', { class: 'btn-sm btn-primary', onClick: () => startProtokoll(type) }, 'Protokoll starten'),
              el('span', { class: 'help', style: 'margin-left:10px;' }, 'Übernimmt die aktuelle Checkliste des Objekts.'),
            ]));
          } else {
            content.appendChild(renderProto(type, proto));
          }
        }
      }
      render();

      return el('div', { class: 'card' }, [
        el('h3', { style: 'margin-top:0;' }, 'Übergabe-/Abnahmeprotokoll'),
        el('p', { class: 'help' }, 'Checkliste bei Ausgabe (Übergabe) und Rückgabe (Abnahme). Bei „nicht OK" sind Notiz und Foto möglich. Punkte-Vorlage je Objekt unter „Protokolle (Checklisten)".'),
        content,
      ]);
    }

    const raeume = store.listRaeume().filter(r => r.aktiv || r.id === v.raumId);
    const meta = STATUS_META[v.status] || STATUS_META.geplant;
    const pauschal = istPauschal(store.getRaum(v.raumId));
    const kostenfrei = !!v.kostenfrei;

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
      kostenfrei
        ? el('span', { class: 'tag prep' }, 'kostenfrei')
        : el('span', { class: 'tag ' + meta.tag }, 'Status: ' + meta.label),
    ]));
    // Bei kostenfreier Nutzung passt der geplant→Vertrag→abgerechnet-Ablauf nicht.
    if (!kostenfrei) mount.appendChild(stepper);

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

    // Kostenfrei (ortsansässiger Verein): blendet Vertrag + Abrechnung aus.
    const kostenfreiCb = el('input', { type: 'checkbox', checked: kostenfrei });
    kostenfreiCb.onchange = () => { v.kostenfrei = kostenfreiCb.checked; persist(); refresh(); };

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
      el('label', { style: 'display:flex; gap:8px; align-items:center; margin-top:10px;' }, [kostenfreiCb, ' Kostenfrei (ortsansässiger Verein) – ohne Vertrag/Abrechnung']),
      kostenfrei ? null : el('label', { style: 'display:flex; gap:8px; align-items:center; margin-top:10px;' }, [ortsfremdCb, ' Ortsfremd (höhere Grundmiete)']),
      el('div', { class: 'verm-summary', style: 'margin-top:14px;' }, [
        el('div', {}, ['Dauer: ', liveTage]),
        kostenfrei ? null : el('div', {}, ['Grundmiete: ', liveGrund]),
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

    // Rück-Verknüpfung: in Paperless abgelegte PDFs dieser Vermietung (nur Liste).
    const docsSection = GR.ui.renderPaperlessDocsSection
      ? GR.ui.renderPaperlessDocsSection(v, persist, { showAdd: false, emptyText: 'Noch kein PDF in Paperless abgelegt.' })
      : null;

    const vertragCard = el('div', { class: 'card' }, [
      el('h3', {}, '2 · Mietvertrag (Tag vor der Nutzung)'),
      el('p', { class: 'help' }, pauschal
        ? 'Pauschalmiete – Strom und Gas sind enthalten, es werden keine Zählerstände erfasst. Beim Erstellen des Vertrags wird der Preis eingefroren.'
        : 'Zählerstände zu Beginn erfassen. Beim Erstellen des Vertrags werden die aktuellen Preise eingefroren.'),
      pauschal ? null : el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Stromzähler Anfang (kWh)'), stromStart, fotoControl('stromStart')]),
        el('div', {}, [el('label', {}, 'Gaszähler Anfang (cbm)'), gasStart, fotoControl('gasStart')]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:14px; margin-bottom:0;' },
        v.status === 'geplant'
          ? [el('button', { class: 'btn-primary', onClick: onVertrag }, 'Vertrag erstellen & Preise einfrieren')]
          : [
              el('button', { class: 'btn-primary', onClick: () => GR.vermietungPdf.buildMietvertrag(v) }, 'Mietvertrag als PDF'),
              GR.ui.savePdfToPaperless ? el('button', { onClick: () => GR.vermietungPdf.buildMietvertrag(v, {
                target: 'paperless', prefillTitle: ('Mietvertrag ' + (v.startDatum || '')).trim(),
                onUploaded: (doc) => { if (docsSection) docsSection.linkDoc(doc); },
              }) }, '📥 In Paperless speichern') : null,
              v.vertragDatum ? el('span', { class: 'help', style: 'align-self:center;' }, 'erstellt am ' + formatDatum(v.vertragDatum)) : null,
            ]
      ),
    ]);
    // Mieter-Unterschrift zum Mietvertrag (erst ab erstelltem Vertrag sinnvoll)
    if (v.status !== 'geplant') {
      vertragCard.appendChild(signaturControl(v, {
        title: 'Mietvertrag – Unterschrift Mieter',
        subtitle: raumName(v.raumId) + (v.startDatum ? ' · ' + formatDatum(v.startDatum) : ''),
        consent: 'Mit der Unterschrift erkennt der Mieter die Bedingungen des Mietvertrags an.',
        reuseSources: [
          { label: 'Aus Übergabe übernehmen', sig: v.protokolle.uebergabe && v.protokolle.uebergabe.mieterUnterschrift },
        ],
      }));
    }
    if (!kostenfrei) mount.appendChild(vertragCard);

    // ---- Abschnitt 3: Abrechnung / Endstände ----
    if (!kostenfrei && v.status !== 'geplant') {
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
          el('div', {}, [el('label', {}, 'Stromzähler Ende (kWh)'), stromEnde, fotoControl('stromEnde')]),
          el('div', {}, [el('label', {}, 'Gaszähler Ende (cbm)'), gasEnde, fotoControl('gasEnde')]),
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
          GR.ui.savePdfToPaperless ? el('button', { onClick: () => GR.vermietungPdf.buildKostenabrechnung(v, {
            target: 'paperless', prefillTitle: ('Kostenabrechnung ' + (v.startDatum || '')).trim(),
            onUploaded: (doc) => { if (docsSection) docsSection.linkDoc(doc); },
          }) }, '📥 In Paperless speichern') : null,
          v.status === 'vertrag' ? el('button', { onClick: onAbrechnen }, 'Als abgerechnet markieren') : null,
          v.abrechnungDatum ? el('span', { class: 'help', style: 'align-self:center;' }, 'abgerechnet am ' + formatDatum(v.abrechnungDatum)) : null,
        ]),
      ]));
    }

    // Kostenfrei: schlanke, optionale Zählerstände-Karte (nur Dokumentation,
    // ersetzt die ausgeblendeten Vertrags-/Abrechnungskarten). Bei Pauschalobjekten
    // gibt es keine Zähler.
    if (kostenfrei && !pauschal) {
      const mkZ = (key, ph) => {
        const i = el('input', { type: 'number', step: '0.001', value: v.zaehler[key] ?? '', placeholder: ph });
        i.oninput = () => { v.zaehler[key] = i.value === '' ? null : Number(i.value); };
        i.onchange = persist;
        return i;
      };
      mount.appendChild(el('div', { class: 'card' }, [
        el('h3', {}, 'Zählerstände (optional)'),
        el('p', { class: 'help' }, 'Bei kostenfreier Nutzung erfolgt keine Abrechnung – diese Werte dienen nur der Dokumentation und erscheinen in keinem PDF.'),
        el('div', { class: 'grid-2' }, [
          el('div', {}, [el('label', {}, 'Stromzähler Anfang (kWh)'), mkZ('stromStart', 'kWh'), fotoControl('stromStart')]),
          el('div', {}, [el('label', {}, 'Stromzähler Ende (kWh)'), mkZ('stromEnde', 'kWh'), fotoControl('stromEnde')]),
        ]),
        el('div', { class: 'grid-2' }, [
          el('div', {}, [el('label', {}, 'Gaszähler Anfang (cbm)'), mkZ('gasStart', 'cbm'), fotoControl('gasStart')]),
          el('div', {}, [el('label', {}, 'Gaszähler Ende (cbm)'), mkZ('gasEnde', 'cbm'), fotoControl('gasEnde')]),
        ]),
      ]));
    }

    mount.appendChild(buildProtokollCard());

    if (docsSection) mount.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'In Paperless abgelegt'),
      docsSection,
    ]));

    updateLive();
  }

  function renderVermietung(mount, params) {
    if (params && params.id) return renderDetail(mount, params.id);
    return renderList(mount);
  }

  GR.views = GR.views || {};
  GR.views.renderVermietung = renderVermietung;
})();
