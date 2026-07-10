(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog, formatDatum } = GR.ui;
  const M = GR.models;

  // Ampel-Metadaten für den Fristen-Block.
  const AMPEL = {
    ueberfaellig: { label: 'überfällig', bg: '#c0392b', fg: '#fff' },
    akut: { label: 'akut', bg: '#e67e22', fg: '#fff' },
    bald: { label: 'bald fällig', bg: '#f1c40f', fg: '#333' },
  };

  function eur(n) { return (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
  function isoToDatum(d) { return d ? formatDatum(M.dateToIso(d)) : '—'; }
  function partnerName(id) { const p = store.getVertragspartner(id); return p ? p.name : ''; }

  function restlaufzeitText(v) {
    const tage = M.tageBisKuendigung(v);
    if (tage === null) return '';
    if (tage < 0) return `seit ${Math.abs(tage)} Tag(en) überfällig`;
    if (tage === 0) return 'heute fällig';
    return `in ${tage} Tag(en)`;
  }

  // =================== Übersicht / Startbildschirm ===================
  function renderOverview(mount) {
    function refresh() { mount.innerHTML = ''; renderOverview(mount); }

    const vertraege = store.listVertraege();

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vertragspartner' }, 'Vertragspartner'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => onPdf(vertraege) }, 'Übersicht als PDF'),
      el('button', { class: 'btn-primary', onClick: () => onNew() }, '+ Neuer Vertrag'),
    ]));

    mount.appendChild(el('h2', {}, 'Verträge und Pacht'));
    mount.appendChild(el('p', { class: 'help' }, 'Überblick über laufende Verträge, Kosten/Einnahmen und anstehende Kündigungsfristen.'));

    // --- Kennzahlen ---
    const aktive = vertraege.filter(v => v.status === 'aktiv');
    const kostenJahr = aktive.filter(v => v.richtung === 'ausgabe').reduce((s, v) => s + M.jahresbetrag(v), 0);
    const einnahmenJahr = aktive.filter(v => v.richtung === 'einnahme').reduce((s, v) => s + M.jahresbetrag(v), 0);
    mount.appendChild(el('div', { style: 'display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px;' }, [
      kpiCard('Jährliche Kosten', eur(kostenJahr), 'laufende Ausgaben aktiver Verträge'),
      kpiCard('Jährliche Einnahmen', eur(einnahmenJahr), 'laufende Einnahmen (u. a. Pacht)'),
      kpiCard('Aktive Verträge', String(aktive.length), `${vertraege.length} insgesamt`),
    ]));

    // --- Fristen-Block ---
    const faellig = aktive
      .map(v => ({ v, ampel: M.fristStatus(v) }))
      .filter(x => x.ampel && x.ampel !== 'ok')
      .sort((a, b) => {
        const ta = M.spaetesterKuendigungstermin(a.v), tb = M.spaetesterKuendigungstermin(b.v);
        return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
      });

    const fristenCard = el('div', { class: 'card' });
    fristenCard.appendChild(el('h3', { style: 'margin-top:0;' }, '⏰ Anstehende Fristen'));
    if (faellig.length === 0) {
      fristenCard.appendChild(el('div', { class: 'empty' }, 'Keine Kündigungsfristen in den nächsten 90 Tagen.'));
    } else {
      for (const { v, ampel } of faellig) {
        const meta = AMPEL[ampel];
        const termin = M.spaetesterKuendigungstermin(v);
        fristenCard.appendChild(el('div', { style: 'display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid rgba(0,0,0,0.08); flex-wrap:wrap;' }, [
          el('span', { style: `display:inline-block; min-width:92px; text-align:center; padding:3px 8px; border-radius:12px; font-size:12px; background:${meta.bg}; color:${meta.fg};` }, meta.label),
          el('div', { style: 'flex:1 1 200px;' }, [
            el('strong', {}, v.bezeichnung || '(ohne Bezeichnung)'),
            el('div', { class: 'help', style: 'margin:0;' }, [
              partnerName(v.partnerId) ? partnerName(v.partnerId) + ' · ' : '',
              `Kündigung bis ${isoToDatum(termin)} · ${restlaufzeitText(v)}`,
            ].join('')),
          ]),
          el('div', { style: 'display:flex; gap:6px; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm', onClick: () => onIcs(v) }, '📅 .ics'),
            el('a', { class: 'btn-sm', href: `#/vertraege?id=${encodeURIComponent(v.id)}` }, 'Öffnen'),
          ]),
        ]));
      }
    }
    mount.appendChild(fristenCard);

    // --- Vollständige Tabelle ---
    const listCard = el('div', { class: 'card', style: 'padding:0' });
    if (vertraege.length === 0) {
      listCard.appendChild(el('div', { class: 'empty' }, 'Noch keine Verträge angelegt.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Bezeichnung'), el('th', {}, 'Kategorie'), el('th', {}, 'Partner'),
        el('th', {}, 'Richtung'), el('th', { style: 'text-align:right;' }, 'Jahresbetrag'),
        el('th', {}, 'Ende'), el('th', {}, 'Status'), el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      const sorted = vertraege.slice().sort((a, b) => (a.bezeichnung || '').localeCompare(b.bezeichnung || '', 'de'));
      for (const v of sorted) {
        const richtungLabel = M.RICHTUNG_LABEL[v.richtung] || v.richtung;
        tbody.appendChild(el('tr', {}, [
          el('td', {}, el('a', { href: `#/vertraege?id=${encodeURIComponent(v.id)}` }, v.bezeichnung || '(ohne Bezeichnung)')),
          el('td', {}, v.kategorie || '—'),
          el('td', {}, partnerName(v.partnerId) || '—'),
          el('td', {}, richtungLabel),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, v.intervall === 'einmalig' ? `${eur(v.betrag)} (einmalig)` : eur(M.jahresbetrag(v))),
          el('td', { style: 'white-space:nowrap;' }, v.ende ? formatDatum(v.ende) : '—'),
          el('td', {}, statusTag(v.status)),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('a', { class: 'btn-sm', href: `#/vertraege?id=${encodeURIComponent(v.id)}` }, 'Öffnen'),
            ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(v, refresh) }, 'Löschen'),
          ]),
        ]));
      }
      table.appendChild(tbody);
      listCard.appendChild(table);
    }
    mount.appendChild(listCard);
  }

  function kpiCard(titel, wert, sub) {
    return el('div', { class: 'card', style: 'flex:1 1 200px; min-width:180px; margin:0;' }, [
      el('div', { class: 'help', style: 'margin:0;' }, titel),
      el('div', { style: 'font-size:24px; font-weight:700; margin:4px 0;' }, wert),
      el('div', { class: 'help', style: 'margin:0;' }, sub),
    ]);
  }

  function statusTag(status) {
    const cls = status === 'aktiv' ? 'tag done' : 'tag';
    const label = { aktiv: 'aktiv', gekuendigt: 'gekündigt', ausgelaufen: 'ausgelaufen' }[status] || status;
    return el('span', { class: cls }, label);
  }

  function onNew() {
    const s = store.getSettings().vertraege || {};
    const v = M.emptyVertrag();
    if (s.standardVorlaufTage != null) v.erinnerungVorlaufTage = s.standardVorlaufTage;
    if (s.standardKuendigungsfristMonate != null) v.kuendigungsfristMonate = s.standardKuendigungsfristMonate;
    store.saveVertrag(v);
    location.hash = `#/vertraege?id=${encodeURIComponent(v.id)}`;
  }

  function onDelete(v, after) {
    if (!confirmDialog(`Vertrag „${v.bezeichnung || ''}" wirklich löschen?`)) return;
    store.deleteVertrag(v.id);
    if (after) after();
  }

  function onIcs(v) {
    if (!M.spaetesterKuendigungstermin(v)) { toast('Kein Vertragsende gesetzt – keine Frist.'); return; }
    GR.vertraegeIcs.downloadFristIcs(v, partnerName(v.partnerId));
  }

  function onPdf(vertraege) {
    if (!vertraege.length) { toast('Keine Verträge vorhanden.'); return; }
    const partnerById = {};
    for (const p of store.listVertragspartner()) partnerById[p.id] = p;
    GR.vertraegePdf.buildVertragsUebersicht(vertraege, partnerById);
  }

  // =================== Detail / Bearbeiten ===================
  function renderDetail(mount, id) {
    const stored = store.getVertrag(id);
    if (!stored) { mount.appendChild(el('div', { class: 'card' }, [el('h2', {}, 'Vertrag nicht gefunden'), el('a', { href: '#/vertraege' }, '← Zurück')])); return; }
    const v = JSON.parse(JSON.stringify(stored));
    const settings = store.getSettings().vertraege || {};
    const kategorien = settings.kategorien || ['Sonstiges'];

    function persist() { store.saveVertrag(v); }
    function field(label, node, hint) {
      return el('div', { style: 'margin-bottom:12px;' }, [el('label', {}, label), node, hint ? el('div', { class: 'help', style: 'margin:2px 0 0;' }, hint) : null]);
    }

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vertraege' }, '← Übersicht'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => onIcs(v) }, '📅 Frist als .ics'),
    ]));

    // --- Eckdaten ---
    const bezeichnung = el('input', { type: 'text', value: v.bezeichnung || '', style: 'width:100%;' });
    bezeichnung.oninput = () => { v.bezeichnung = bezeichnung.value; };
    bezeichnung.onchange = () => { v.bezeichnung = bezeichnung.value.trim(); persist(); };

    const kategorieSel = el('select', { style: 'width:100%;' });
    for (const k of kategorien) kategorieSel.appendChild(el('option', { value: k, selected: k === v.kategorie }, k));
    if (!kategorien.includes(v.kategorie) && v.kategorie) kategorieSel.appendChild(el('option', { value: v.kategorie, selected: true }, v.kategorie));
    kategorieSel.onchange = () => { v.kategorie = kategorieSel.value; persist(); };

    const richtungSel = el('select', { style: 'width:100%;' });
    for (const r of M.VERTRAG_RICHTUNGEN) richtungSel.appendChild(el('option', { value: r, selected: r === v.richtung }, M.RICHTUNG_LABEL[r]));
    richtungSel.onchange = () => { v.richtung = richtungSel.value; persist(); };

    // Partner-Auswahl (Select + Neu-Button)
    const partnerSel = el('select', { style: 'flex:1;' });
    function fillPartner() {
      partnerSel.innerHTML = '';
      partnerSel.appendChild(el('option', { value: '', selected: !v.partnerId }, '— kein Partner —'));
      for (const p of store.listVertragspartner().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'))) {
        partnerSel.appendChild(el('option', { value: p.id, selected: p.id === v.partnerId }, p.name));
      }
    }
    fillPartner();
    partnerSel.onchange = () => { v.partnerId = partnerSel.value; persist(); };
    const partnerRow = el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
      partnerSel,
      el('button', { class: 'btn-sm', onClick: () => GR.vertragspartner.dialog(null, (p) => { v.partnerId = p.id; fillPartner(); partnerSel.value = p.id; persist(); }) }, '+ Neu'),
    ]);

    // --- Kosten ---
    const betrag = el('input', { type: 'number', step: '0.01', value: v.betrag != null ? v.betrag : 0, style: 'width:160px;' });
    betrag.oninput = () => { v.betrag = betrag.value === '' ? 0 : Number(betrag.value); updateLive(); };
    betrag.onchange = persist;
    const intervallSel = el('select', {});
    for (const i of M.VERTRAG_INTERVALLE) intervallSel.appendChild(el('option', { value: i, selected: i === v.intervall }, M.INTERVALL_LABEL[i]));
    intervallSel.onchange = () => { v.intervall = intervallSel.value; updateLive(); persist(); };
    const jahresInfo = el('span', { class: 'help', style: 'margin:0;' });

    // --- Laufzeit / Fristen ---
    const beginn = el('input', { type: 'date', value: v.beginn || '' });
    beginn.onchange = () => { v.beginn = beginn.value; persist(); };
    const laufzeitSel = el('select', { style: 'width:100%;' });
    for (const t of M.VERTRAG_LAUFZEIT_TYPEN) laufzeitSel.appendChild(el('option', { value: t, selected: t === v.laufzeitTyp }, t === 'befristet' ? 'befristet (festes Ende)' : 'unbefristet mit automatischer Verlängerung'));
    laufzeitSel.onchange = () => { v.laufzeitTyp = laufzeitSel.value; renderDetailRefresh(); persist(); };
    const ende = el('input', { type: 'date', value: v.ende || '' });
    ende.onchange = () => { v.ende = ende.value; updateLive(); persist(); };
    const kfrist = el('input', { type: 'number', min: '0', value: v.kuendigungsfristMonate != null ? v.kuendigungsfristMonate : 0, style: 'width:100px;' });
    kfrist.oninput = () => { v.kuendigungsfristMonate = kfrist.value === '' ? 0 : Number(kfrist.value); updateLive(); };
    kfrist.onchange = persist;
    const verlaeng = el('input', { type: 'number', min: '0', value: v.verlaengerungMonate != null ? v.verlaengerungMonate : 0, style: 'width:100px;' });
    verlaeng.oninput = () => { v.verlaengerungMonate = verlaeng.value === '' ? 0 : Number(verlaeng.value); };
    verlaeng.onchange = persist;
    const vorlauf = el('input', { type: 'number', min: '0', value: v.erinnerungVorlaufTage != null ? v.erinnerungVorlaufTage : 0, style: 'width:100px;' });
    vorlauf.oninput = () => { v.erinnerungVorlaufTage = vorlauf.value === '' ? 0 : Number(vorlauf.value); };
    vorlauf.onchange = persist;

    const kuendLive = el('div', { style: 'padding:10px 12px; border-radius:6px; background:rgba(0,0,0,0.05); margin-top:6px;' });

    const statusSel = el('select', { style: 'width:100%;' });
    for (const s of M.VERTRAG_STATUS) statusSel.appendChild(el('option', { value: s, selected: s === v.status }, { aktiv: 'aktiv', gekuendigt: 'gekündigt', ausgelaufen: 'ausgelaufen' }[s]));
    statusSel.onchange = () => { v.status = statusSel.value; updateLive(); persist(); };

    const notiz = el('textarea', { style: 'width:100%;' }, v.notiz || '');
    notiz.oninput = () => { v.notiz = notiz.value; };
    notiz.onchange = persist;

    function updateLive() {
      jahresInfo.textContent = v.intervall === 'einmalig'
        ? `Einmaliger Betrag: ${eur(v.betrag)} (zählt nicht zu den Jahreskosten)`
        : `Entspricht ${eur(M.jahresbetrag(v))} pro Jahr`;
      const termin = M.spaetesterKuendigungstermin(v);
      const ampel = M.fristStatus(v);
      kuendLive.innerHTML = '';
      if (!termin) {
        kuendLive.appendChild(el('span', { class: 'help', style: 'margin:0;' }, 'Kein Vertragsende gesetzt – kein Kündigungstermin berechenbar.'));
      } else {
        const meta = ampel && AMPEL[ampel];
        kuendLive.appendChild(el('div', {}, [
          el('strong', {}, `Spätester Kündigungstermin: ${isoToDatum(termin)}`),
          meta ? el('span', { style: `margin-left:10px; padding:2px 8px; border-radius:12px; font-size:12px; background:${meta.bg}; color:${meta.fg};` }, meta.label) : null,
          el('div', { class: 'help', style: 'margin:2px 0 0;' }, restlaufzeitText(v) + (v.status !== 'aktiv' ? ' · Vertrag ist nicht aktiv' : '')),
        ]));
      }
    }

    function renderDetailRefresh() { mount.innerHTML = ''; renderDetail(mount, id); }

    // Aufbau
    mount.appendChild(el('h2', {}, v.bezeichnung || 'Neuer Vertrag'));

    const card1 = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;' }, 'Eckdaten'),
      field('Bezeichnung', bezeichnung),
      el('div', { class: 'grid-2' }, [
        field('Kategorie', kategorieSel),
        field('Art', richtungSel),
      ]),
      field('Vertragspartner', partnerRow),
    ]);
    mount.appendChild(card1);

    const card2 = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;' }, 'Kosten'),
      el('div', { style: 'display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;' }, [
        el('div', {}, [el('label', {}, 'Betrag (€)'), betrag]),
        el('div', {}, [el('label', {}, 'Intervall'), intervallSel]),
      ]),
      el('div', { style: 'margin-top:6px;' }, jahresInfo),
    ]);
    mount.appendChild(card2);

    const card3 = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;' }, 'Laufzeit & Fristen'),
      el('div', { class: 'grid-2' }, [
        field('Vertragsbeginn', beginn),
        field('Laufzeit', laufzeitSel),
      ]),
      el('div', { class: 'grid-2' }, [
        field(v.laufzeitTyp === 'auto_verlaengerung' ? 'Nächster Verlängerungsstichtag' : 'Vertragsende', ende),
        field('Kündigungsfrist (Monate)', kfrist),
      ]),
      el('div', { class: 'grid-2' }, [
        v.laufzeitTyp === 'auto_verlaengerung' ? field('Verlängerung um (Monate)', verlaeng) : el('div'),
        field('Erinnerung (Tage vorher)', vorlauf),
      ]),
      kuendLive,
    ]);
    mount.appendChild(card3);

    const card4 = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;' }, 'Vertragsdokumente (Paperless)'),
      buildDocsSection(v, persist),
    ]);
    mount.appendChild(card4);

    const card5 = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;' }, 'Status & Notiz'),
      field('Status', statusSel),
      field('Notiz', notiz),
    ]);
    mount.appendChild(card5);

    updateLive();
  }

  // Abschnitt „Vertragsdokumente": Liste verknüpfter Paperless-Docs + Picker.
  function buildDocsSection(v, persist) {
    const wrap = el('div', {});
    const listBox = el('div', {});
    function renderList() {
      listBox.innerHTML = '';
      const docs = v.paperlessDocs || [];
      if (docs.length === 0) {
        listBox.appendChild(el('div', { class: 'help', style: 'margin:0 0 8px;' }, 'Noch keine Dokumente verknüpft.'));
      } else {
        for (const d of docs) {
          listBox.appendChild(el('div', { style: 'display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid rgba(0,0,0,0.08);' }, [
            el('span', { style: 'flex:1;' }, '📄 ' + (d.title || ('Dokument ' + d.id))),
            el('a', { class: 'btn-sm', href: GR.api.docFileUrl(d.id, 'preview'), target: '_blank', rel: 'noopener' }, 'Vorschau'),
            el('button', { class: 'btn-sm btn-danger', onClick: () => { v.paperlessDocs = (v.paperlessDocs || []).filter(x => String(x.id) !== String(d.id)); persist(); renderList(); } }, 'Entfernen'),
          ]));
        }
      }
    }
    renderList();

    const addBtn = el('button', { class: 'btn-sm btn-primary', style: 'margin-top:8px;', onClick: () => {
      GR.ui.pickPaperlessDocument((doc) => {
        if (!v.paperlessDocs) v.paperlessDocs = [];
        if (v.paperlessDocs.some(x => String(x.id) === String(doc.id))) { toast('Dokument ist bereits verknüpft.'); return; }
        v.paperlessDocs.push(doc);
        persist();
        renderList();
        toast('Dokument verknüpft');
      });
    } }, '+ Dokument verknüpfen');

    wrap.appendChild(listBox);
    wrap.appendChild(addBtn);
    return wrap;
  }

  // =================== Einstieg ===================
  function renderVertraege(mount, params) {
    if (params && params.id) return renderDetail(mount, params.id);
    return renderOverview(mount);
  }

  GR.views = GR.views || {};
  GR.views.renderVertraege = renderVertraege;
})();
