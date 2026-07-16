(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog, formatDatum } = GR.ui;
  const M = GR.models;

  // Abrechnungen je Person/Zeitraum (Modul Arbeitszeiten & Vergütung).
  // Ablauf: Person + Zeitraum wählen → alle offenen Einträge kommen automatisch
  // in die Vorschau → Haushaltsstelle wählen → „Abrechnung erstellen" friert die
  // Sätze ein und sperrt die Einträge. Danach: PDF, als ausgezahlt markieren,
  // oder Storno (setzt die Einträge zurück auf „erfasst").

  const euro = (n) => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const stundenFmt = (n) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function heuteIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // Monatsanfang als Vorbelegung des Zeitraums.
  function monatsanfang() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  function stelleName(id) {
    const h = store.getHaushaltsstelle(id);
    return h ? ((h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)')) : '(keine Haushaltsstelle)';
  }

  function renderArbeitsabrechnungen(mount) {
    function refresh() { mount.innerHTML = ''; renderArbeitsabrechnungen(mount); }

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('h2', { style: 'margin:0;' }, 'Abrechnungen'),
      el('div', { class: 'spacer' }),
      el('a', { class: 'btn btn-sm', href: '#/arbeitszeiten' }, '← Arbeitszeiten'),
    ]));

    mount.appendChild(neueAbrechnungKarte(refresh));
    mount.appendChild(listenKarte(refresh));
  }

  // --- Neue Abrechnung: Auswahl + Vorschau ---
  function neueAbrechnungKarte(refresh) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, 'Neue Abrechnung'));

    const arbeiter = store.listArbeiter()
      .sort((a, b) => M.arbeiterName(a).localeCompare(M.arbeiterName(b), 'de'));
    if (!arbeiter.length) {
      card.appendChild(el('p', { class: 'help', style: 'margin:0;' }, 'Noch kein Arbeiter angelegt.'));
      return card;
    }

    const arbeiterSel = el('select', {}, arbeiter.map(a => el('option', { value: a.id }, M.arbeiterName(a))));
    const vonI = el('input', { type: 'date', value: monatsanfang() });
    const bisI = el('input', { type: 'date', value: heuteIso() });
    const stellen = store.listHaushaltsstellen();
    const stelleSel = el('select', {}, [el('option', { value: '' }, '— keine —')]
      .concat(stellen.map(h => el('option', { value: h.id }, stelleName(h.id)))));
    const jahrI = el('input', { type: 'number', step: '1', value: new Date().getFullYear(), style: 'max-width:110px;' });
    const notizI = el('input', { type: 'text', placeholder: 'Notiz (optional)' });

    const vorschau = el('div', { style: 'margin-top:10px;' });
    const erstellenBtn = el('button', { class: 'btn-primary' }, 'Abrechnung erstellen');

    function refreshVorschau() {
      vorschau.innerHTML = '';
      const hist = (store.getSettings().arbeitszeiten || {}).satzHistorie || [];
      const offene = store.offeneArbeitszeiten(arbeiterSel.value, vonI.value, bisI.value);
      if (!offene.length) {
        vorschau.appendChild(el('div', { class: 'empty' }, 'Keine offenen Einträge in diesem Zeitraum.'));
        erstellenBtn.disabled = true;
        return;
      }
      // Ohne Satz keine Abrechnung – früh und deutlich melden.
      const ohneSatz = offene.filter(z => M.arbeitszeitSatz(z, hist) == null);
      if (ohneSatz.length) {
        vorschau.appendChild(el('div', { class: 'warn' },
          `Für ${ohneSatz.length} Eintrag/Einträge ist kein Stundensatz hinterlegt (z. B. ${formatDatum(ohneSatz[0].datum)}). Bitte in den Einstellungen einen Satz mit passendem „gültig ab" anlegen oder am Eintrag einen abweichenden Satz setzen.`));
        erstellenBtn.disabled = true;
        return;
      }
      erstellenBtn.disabled = false;

      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Datum'), el('th', {}, 'Tätigkeit'),
        el('th', { style: 'text-align:right;' }, 'Stunden'),
        el('th', { style: 'text-align:right;' }, 'Satz'),
        el('th', { style: 'text-align:right;' }, 'Betrag'),
      ])));
      const tbody = el('tbody');
      let sStd = 0, sBetrag = 0;
      for (const z of offene) {
        const satz = M.arbeitszeitSatz(z, hist);
        const betrag = M.arbeitszeitBetrag(z, hist);
        sStd += Number(z.stunden) || 0; sBetrag += betrag || 0;
        tbody.appendChild(el('tr', {}, [
          el('td', {}, formatDatum(z.datum)),
          el('td', {}, z.taetigkeit || '—'),
          el('td', { style: 'text-align:right;' }, stundenFmt(z.stunden)),
          el('td', { style: 'text-align:right;' }, euro(satz)),
          el('td', { style: 'text-align:right;' }, euro(betrag)),
        ]));
      }
      table.appendChild(tbody);
      table.appendChild(el('tfoot', {}, el('tr', {}, [
        el('td', { colspan: '2' }, el('strong', {}, `Summe (${offene.length} Einträge)`)),
        el('td', { style: 'text-align:right;' }, el('strong', {}, stundenFmt(sStd))),
        el('td', {}, ''),
        el('td', { style: 'text-align:right;' }, el('strong', {}, euro(sBetrag))),
      ])));
      vorschau.appendChild(table);
    }

    for (const f of [arbeiterSel, vonI, bisI]) f.onchange = refreshVorschau;
    // Zeitraumende bestimmt das Haushaltsjahr – Vorbelegung mitziehen.
    bisI.addEventListener('change', () => { if (bisI.value) jahrI.value = Number(bisI.value.slice(0, 4)); });

    erstellenBtn.onclick = () => {
      try {
        const abr = store.erstelleArbeitsabrechnung({
          arbeiterId: arbeiterSel.value,
          von: vonI.value, bis: bisI.value,
          haushaltsstelleId: stelleSel.value,
          haushaltsjahr: Number(jahrI.value) || new Date().getFullYear(),
          notiz: notizI.value.trim(),
        });
        toast(`Abrechnung erstellt: ${euro(abr.summeBetrag)}`);
        refresh();
      } catch (e) { alert(e.message); }
    };

    card.appendChild(el('div', { class: 'az-form' }, [
      el('div', {}, [el('label', {}, 'Arbeiter / Firma'), arbeiterSel]),
      el('div', {}, [el('label', {}, 'Zeitraum von'), vonI]),
      el('div', {}, [el('label', {}, 'bis'), bisI]),
      el('div', {}, [el('label', {}, 'Haushaltsjahr'), jahrI]),
    ]));
    card.appendChild(el('div', { class: 'az-form', style: 'margin-top:8px;' }, [
      el('div', { style: 'grid-column: span 2;' }, [el('label', {}, 'Haushaltsstelle'), stelleSel]),
      el('div', { style: 'grid-column: span 2;' }, [el('label', {}, 'Notiz'), notizI]),
    ]));
    card.appendChild(el('p', { class: 'help', style: 'margin:8px 0 0;' },
      'Alle offenen Einträge im Zeitraum werden übernommen. Beim Erstellen wird der Stundensatz eingefroren – spätere Satzänderungen wirken sich auf diese Abrechnung nicht mehr aus.'));
    card.appendChild(vorschau);
    card.appendChild(el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [erstellenBtn]));
    refreshVorschau();
    return card;
  }

  // --- Liste der Abrechnungen ---
  function listenKarte(refresh) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, 'Erstellte Abrechnungen'));

    const liste = store.listArbeitsabrechnungen()
      .sort((a, b) => String(b.erstelltAm || '').localeCompare(String(a.erstelltAm || '')));
    if (!liste.length) {
      card.appendChild(el('div', { class: 'empty' }, 'Noch keine Abrechnung erstellt.'));
      return card;
    }

    for (const abr of liste) {
      const a = store.getArbeiter(abr.arbeiterId);
      const bezahlt = abr.status === 'ausgezahlt';
      const kopf = el('div', { class: 'toolbar', style: 'margin:0; align-items:center;' }, [
        el('strong', {}, a ? M.arbeiterName(a) : '(gelöscht)'),
        el('span', { class: 'help' }, `${formatDatum(abr.zeitraumVon)} – ${formatDatum(abr.zeitraumBis)}`),
        el('span', { class: 'tag ' + (bezahlt ? 'done' : 'ok') },
          bezahlt ? 'Ausgezahlt' + (abr.ausgezahltAm ? ' am ' + formatDatum(abr.ausgezahltAm) : '') : 'Abgerechnet'),
        el('div', { class: 'spacer' }),
        el('strong', {}, euro(abr.summeBetrag)),
        el('span', { class: 'help' }, stundenFmt(abr.summeStunden) + ' Std.'),
      ]);

      const aktionen = el('div', { class: 'toolbar', style: 'margin:8px 0 0;' }, [
        el('button', {
          class: 'btn-sm', onClick: () => GR.arbeitszeitenPdf.buildVorlaeufigeAbrechnung(abr, { target: 'download' }),
        }, '📄 Vorläufige PDF'),
        el('button', {
          class: 'btn-sm', onClick: () => GR.arbeitszeitenPdf.buildVorlaeufigeAbrechnung(abr, { target: 'paperless' }),
        }, '📥 In Paperless'),
        bezahlt ? null : el('button', {
          class: 'btn-sm btn-primary', onClick: () => {
            const datum = window.prompt('Auszahlungsdatum (JJJJ-MM-TT):', heuteIso());
            if (!datum) return;
            store.markiereAbrechnungAusgezahlt(abr.id, datum);
            toast('Als ausgezahlt markiert');
            refresh();
          },
        }, '✓ Als ausgezahlt markieren'),
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'btn-sm btn-danger', onClick: () => {
            if (!confirmDialog('Abrechnung stornieren?\n\nDie Einträge werden wieder auf „erfasst" gesetzt und können erneut abgerechnet werden. Die Abrechnung selbst wird gelöscht.')) return;
            store.storniereArbeitsabrechnung(abr.id);
            toast('Storniert');
            refresh();
          },
        }, 'Storno'),
      ]);

      const details = el('details', { class: 'az-abr' }, [
        el('summary', {}, `${abr.positionen.length} Positionen · ${stelleName(abr.haushaltsstelleId)} · Haushaltsjahr ${abr.haushaltsjahr || '—'}`),
      ]);
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Datum'), el('th', {}, 'Tätigkeit'),
        el('th', { style: 'text-align:right;' }, 'Stunden'),
        el('th', { style: 'text-align:right;' }, 'Satz'),
        el('th', { style: 'text-align:right;' }, 'Betrag'),
      ])));
      const tbody = el('tbody');
      for (const p of abr.positionen) {
        tbody.appendChild(el('tr', {}, [
          el('td', {}, formatDatum(p.datum)),
          el('td', {}, p.taetigkeit || '—'),
          el('td', { style: 'text-align:right;' }, stundenFmt(p.stunden)),
          el('td', { style: 'text-align:right;' }, euro(p.satz)),
          el('td', { style: 'text-align:right;' }, euro(p.betrag)),
        ]));
      }
      table.appendChild(tbody);
      details.appendChild(table);
      if (abr.notiz) details.appendChild(el('p', { class: 'help' }, abr.notiz));

      card.appendChild(el('div', { class: 'az-abr-box' }, [kopf, details, aktionen]));
    }
    return card;
  }

  GR.views = GR.views || {};
  GR.views.renderArbeitsabrechnungen = renderArbeitsabrechnungen;
})();
