(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog, formatDatum } = GR.ui;
  const M = GR.models;

  // Abrechnungen je Person/Woche (Modul Arbeitszeiten & Vergütung).
  // EINE ABRECHNUNG = EINE KALENDERWOCHE – so verlangt es der VG-Vordruck
  // „Lohnabrechnung", dessen Arbeitszeit-Tabelle je Zeile eine Woche abbildet.
  // Ablauf: Person + Woche wählen → alle offenen Einträge der Woche kommen
  // automatisch in die Vorschau → Haushaltsstelle wählen → „Abrechnung
  // erstellen" friert die Sätze ein und sperrt die Einträge. Danach: PDF,
  // als ausgezahlt markieren, oder Storno (Einträge zurück auf „erfasst").

  const euro = (n) => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const stundenFmt = (n) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function heuteIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function stelleName(id) {
    const h = store.getHaushaltsstelle(id);
    return h ? ((h.nummer ? h.nummer + ' · ' : '') + (h.bezeichnung || '(ohne)')) : '(keine Haushaltsstelle)';
  }
  // Deckt der Zeitraum genau einen Monat ab, reicht der Monatsname.
  function monatOderZeitraum(abr) {
    if (abr.zeitraumVon && abr.zeitraumVon === M.monatsErster(abr.zeitraumVon)
      && abr.zeitraumBis === M.monatsLetzter(abr.zeitraumVon)) {
      return M.monatsLabel(abr.zeitraumVon);
    }
    return `${formatDatum(abr.zeitraumVon)} – ${formatDatum(abr.zeitraumBis)}`;
  }
  // Bestandsabrechnungen kennen summeKostenerstattung noch nicht – dann rechnen.
  function kostenSummeVon(abr) {
    return abr.summeKostenerstattung != null
      ? Number(abr.summeKostenerstattung) || 0
      : M.abrechnungKostenSumme(abr);
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

    // Auswahl per Checkbox über ALLE offenen Einträge, nach Monat gruppiert.
    // Standard: alles angehakt. Beim Erstellen wird die Auswahl nach Monaten
    // aufgeteilt – je Monat ein eigener Vordruck.
    const auswahl = new Set();
    const monatsBox = el('div', {});
    const offenHinweis = el('span', { class: 'help' }, '');

    const stellen = store.listHaushaltsstellen();
    const stelleSel = el('select', {}, [el('option', { value: '' }, '— keine —')]
      .concat(stellen.map(h => el('option', { value: h.id }, stelleName(h.id)))));
    const jahrI = el('input', { type: 'number', step: '1', value: new Date().getFullYear(), style: 'max-width:110px;' });
    const notizI = el('input', { type: 'text', placeholder: 'Notiz (optional)' });

    const vorschau = el('div', { style: 'margin-top:10px;' });
    const erstellenBtn = el('button', { class: 'btn-primary' }, 'Abrechnung erstellen');
    // Monat für den Sonderfall „reine Kostenerstattung ohne Arbeitsstunden“ –
    // dann lässt sich der Zeitraum nicht aus Einträgen ableiten.
    const monatSel = el('select', {}, Array.from({ length: 14 }, (_, i) => {
      const d = M.monatPlus(heuteIso(), i - 12);
      return el('option', { value: d }, M.monatsLabel(d));
    }));
    monatSel.value = M.monatsErster(heuteIso());
    const monatZeile = el('div', { style: 'margin-top:8px;' },
      [el('label', {}, 'Abrechnungsmonat (ohne Arbeitsstunden)'), monatSel]);

    // --- Kostenerstattungen (Feld 8 des Vordrucks): Beträge ohne Arbeitsstunden ---
    let kostenListe = [];
    const kostenBox = el('div', {});
    function renderKosten() {
      kostenBox.innerHTML = '';
      for (const k of kostenListe) {
        const besI = el('input', { type: 'text', placeholder: 'z. B. Maschineneinsatz Häcksler', value: k.beschreibung });
        besI.oninput = e => { k.beschreibung = e.target.value; };
        const betI = el('input', { type: 'number', step: '0.01', value: k.betrag || '', style: 'max-width:120px;' });
        betI.oninput = e => { k.betrag = Number(e.target.value) || 0; refreshVorschau(); };
        kostenBox.appendChild(el('div', { class: 'toolbar', style: 'margin:0 0 6px;' }, [
          el('div', { style: 'flex:1;' }, besI), betI,
          el('button', {
            class: 'btn-sm btn-danger', type: 'button',
            onClick: () => { kostenListe = kostenListe.filter(x => x !== k); renderKosten(); refreshVorschau(); },
          }, '✕'),
        ]));
      }
      kostenBox.appendChild(el('button', {
        class: 'btn-sm', type: 'button',
        onClick: () => { kostenListe.push(M.emptyKostenerstattung()); renderKosten(); },
      }, '+ Kostenerstattung'));
    }

    function kostenSumme() {
      return Math.round(kostenListe.reduce((s, k) => s + (Number(k.betrag) || 0), 0) * 100) / 100;
    }

    const hist = () => (store.getSettings().arbeitszeiten || {}).satzHistorie || [];

    // Alle offenen Einträge, nach Monat gruppiert, mit Checkboxen.
    function renderAuswahl() {
      monatsBox.innerHTML = '';
      const monate = store.offeneMonate(arbeiterSel.value);
      if (!monate.length) {
        monatsBox.appendChild(el('div', { class: 'empty' }, 'Keine offenen Einträge für diese Person.'));
        return;
      }
      for (const m of monate) {
        const alleAn = m.eintraege.every(z => auswahl.has(z.id));
        const kopfCb = el('input', { type: 'checkbox' });
        kopfCb.checked = alleAn;
        kopfCb.indeterminate = !alleAn && m.eintraege.some(z => auswahl.has(z.id));
        kopfCb.onchange = () => {
          for (const z of m.eintraege) { if (kopfCb.checked) auswahl.add(z.id); else auswahl.delete(z.id); }
          renderAuswahl(); refreshVorschau();
        };
        const gruppe = el('div', { style: 'margin:0 0 10px;' }, [
          el('label', { style: 'display:flex; align-items:center; gap:8px; font-weight:600;' }, [
            kopfCb, el('span', {}, `${m.label} — ${m.eintraege.length} Eintrag/Einträge, ${stundenFmt(m.stunden)} Std.`),
          ]),
        ]);
        for (const z of m.eintraege) {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = auswahl.has(z.id);
          cb.onchange = () => {
            if (cb.checked) auswahl.add(z.id); else auswahl.delete(z.id);
            const an = m.eintraege.every(x => auswahl.has(x.id));
            kopfCb.checked = an;
            kopfCb.indeterminate = !an && m.eintraege.some(x => auswahl.has(x.id));
            refreshVorschau();
          };
          const satz = M.arbeitszeitSatz(z, hist());
          const betrag = M.arbeitszeitBetrag(z, hist());
          gruppe.appendChild(el('label', {
            style: 'display:flex; align-items:center; gap:8px; padding:2px 0 2px 24px;',
          }, [
            cb,
            el('span', { style: 'min-width:88px;' }, formatDatum(z.datum)),
            el('span', { style: 'flex:1;' }, z.taetigkeit || '—'),
            el('span', { style: 'min-width:70px; text-align:right;' }, stundenFmt(z.stunden) + ' Std.'),
            el('span', { class: 'help', style: 'min-width:80px; text-align:right;' },
              satz == null ? 'kein Satz' : euro(betrag)),
          ]));
        }
        monatsBox.appendChild(gruppe);
      }
    }

    // Ausgewählte Einträge nach Monat – je Monat entsteht ein eigener Vordruck.
    function gewaehlteMonate() {
      return store.offeneMonate(arbeiterSel.value)
        .map(m => {
          const gewaehlt = m.eintraege.filter(z => auswahl.has(z.id));
          const stunden = gewaehlt.reduce((s, z) => s + (Number(z.stunden) || 0), 0);
          const betrag = gewaehlt.reduce((s, z) => s + (M.arbeitszeitBetrag(z, hist()) || 0), 0);
          return { ...m, gewaehlt, stunden: Math.round(stunden * 100) / 100, betrag: Math.round(betrag * 100) / 100 };
        })
        .filter(m => m.gewaehlt.length);
    }

    function refreshVorschau() {
      const monate = gewaehlteMonate();
      const kSum = kostenSumme();
      const offeneGesamt = store.offeneMonate(arbeiterSel.value);
      offenHinweis.textContent = offeneGesamt.length
        ? `${offeneGesamt.length} Monat(e) mit offenen Einträgen: ${offeneGesamt.map(m => m.label).join(', ')}`
        : 'Keine offenen Einträge für diese Person.';

      // Ohne Arbeitsstunden braucht die reine Kostenerstattung einen Monat.
      monatZeile.style.display = monate.length ? 'none' : '';
      jahrI.value = monate.length
        ? Number(monate[monate.length - 1].von.slice(0, 4))
        : Number(monatSel.value.slice(0, 4));

      vorschau.innerHTML = '';
      if (!monate.length) {
        const nurKosten = kSum !== 0;
        vorschau.appendChild(el('div', { class: nurKosten ? 'warn' : 'empty' }, nurKosten
          ? `Kein Eintrag ausgewählt – es wird eine reine Kostenerstattung über ${euro(kSum)} für ${M.monatsLabel(monatSel.value)} abgerechnet.`
          : 'Kein Eintrag ausgewählt.'));
        erstellenBtn.disabled = !nurKosten;
        erstellenBtn.textContent = 'Abrechnung erstellen';
        return;
      }

      // Ohne Satz keine Abrechnung – früh und deutlich melden.
      const ohneSatz = monate.flatMap(m => m.gewaehlt).filter(z => M.arbeitszeitSatz(z, hist()) == null);
      if (ohneSatz.length) {
        vorschau.appendChild(el('div', { class: 'warn' },
          `Für ${ohneSatz.length} Eintrag/Einträge ist kein Stundensatz hinterlegt (z. B. ${formatDatum(ohneSatz[0].datum)}). Bitte in den Einstellungen einen Satz mit passendem „gültig ab" anlegen oder am Eintrag einen abweichenden Satz setzen.`));
        erstellenBtn.disabled = true;
        return;
      }
      // Kostenerstattungen gehören zu genau einem Monat – sonst wäre unklar,
      // auf welchem der Vordrucke sie stehen.
      if (kSum !== 0 && monate.length > 1) {
        vorschau.appendChild(el('div', { class: 'warn' },
          `Die Auswahl umfasst ${monate.length} Monate, die Kostenerstattungen gehören aber zu genau einem Monat. Bitte nur Einträge eines Monats auswählen oder die Kostenerstattungen entfernen.`));
        erstellenBtn.disabled = true;
        return;
      }
      erstellenBtn.disabled = false;
      erstellenBtn.textContent = monate.length > 1
        ? `${monate.length} Abrechnungen erstellen` : 'Abrechnung erstellen';

      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Monat (ein Vordruck je Zeile)'),
        el('th', { style: 'text-align:right;' }, 'Einträge'),
        el('th', { style: 'text-align:right;' }, 'Stunden'),
        el('th', { style: 'text-align:right;' }, 'Betrag'),
      ])));
      const tbody = el('tbody');
      for (const m of monate) {
        tbody.appendChild(el('tr', {}, [
          el('td', {}, m.label),
          el('td', { style: 'text-align:right;' }, String(m.gewaehlt.length)),
          el('td', { style: 'text-align:right;' }, stundenFmt(m.stunden)),
          el('td', { style: 'text-align:right;' }, euro(m.betrag)),
        ]));
      }
      table.appendChild(tbody);
      table.appendChild(el('tfoot', {}, [
        el('tr', {}, [
          el('td', {}, el('strong', {}, 'Arbeitslohn gesamt')),
          el('td', { style: 'text-align:right;' }, el('strong', {}, String(monate.reduce((s, m) => s + m.gewaehlt.length, 0)))),
          el('td', { style: 'text-align:right;' }, el('strong', {}, stundenFmt(monate.reduce((s, m) => s + m.stunden, 0)))),
          el('td', { style: 'text-align:right;' }, el('strong', {}, euro(monate.reduce((s, m) => s + m.betrag, 0)))),
        ]),
        kSum ? el('tr', {}, [
          el('td', { colspan: '3' }, 'zzgl. Kostenerstattungen'),
          el('td', { style: 'text-align:right;' }, euro(kSum)),
        ]) : null,
      ].filter(Boolean)));
      vorschau.appendChild(table);
    }

    arbeiterSel.onchange = () => {
      auswahl.clear();
      for (const m of store.offeneMonate(arbeiterSel.value)) for (const z of m.eintraege) auswahl.add(z.id);
      renderAuswahl(); refreshVorschau();
    };
    monatSel.onchange = refreshVorschau;

    // Je Monat eine eigene Abrechnung – ein Vordruck deckt genau einen Monat ab.
    erstellenBtn.onclick = () => {
      const monate = gewaehlteMonate();
      try {
        if (!monate.length) {
          const von = monatSel.value;
          const abr = store.erstelleArbeitsabrechnung({
            arbeiterId: arbeiterSel.value,
            von, bis: M.monatsLetzter(von),
            haushaltsstelleId: stelleSel.value,
            haushaltsjahr: Number(jahrI.value) || new Date().getFullYear(),
            notiz: notizI.value.trim(),
            kostenerstattungen: kostenListe,
          });
          toast(`Abrechnung erstellt: ${euro(abr.summeKostenerstattung)} Kostenerstattung`);
          refresh();
          return;
        }
        if (monate.length > 1) {
          const liste = monate.map(m => `• ${m.label} — ${m.gewaehlt.length} Eintrag/Einträge, ${stundenFmt(m.stunden)} Std., ${euro(m.betrag)}`).join('\n');
          if (!confirmDialog(`${monate.length} Abrechnungen anlegen – je Monat eine?\n\n${liste}\n\nHaushaltsstelle: ${stelleName(stelleSel.value)}`)) return;
        }
        let ok = 0; const fehler = [];
        for (const m of monate) {
          try {
            store.erstelleArbeitsabrechnung({
              arbeiterId: arbeiterSel.value,
              von: m.von, bis: m.bis,
              arbeitszeitIds: m.gewaehlt.map(z => z.id),
              haushaltsstelleId: stelleSel.value,
              haushaltsjahr: monate.length === 1
                ? (Number(jahrI.value) || Number(m.von.slice(0, 4)))
                : Number(m.von.slice(0, 4)),
              notiz: notizI.value.trim(),
              // Kostenerstattungen sind nur bei genau einem Monat zugelassen.
              kostenerstattungen: monate.length === 1 ? kostenListe : [],
            });
            ok++;
          } catch (e) { fehler.push(`${m.label}: ${e.message}`); }
        }
        if (fehler.length) alert(`${ok} Abrechnung(en) erstellt.\n\nNicht möglich:\n` + fehler.join('\n'));
        else toast(ok > 1 ? `${ok} Abrechnungen erstellt` : 'Abrechnung erstellt');
        refresh();
      } catch (e) { alert(e.message); }
    };

    card.appendChild(el('div', { class: 'az-form' }, [
      el('div', { style: 'grid-column: span 2;' }, [el('label', {}, 'Arbeiter / Firma'), arbeiterSel]),
      el('div', {}, [el('label', {}, 'Haushaltsjahr'), jahrI]),
    ]));
    card.appendChild(el('p', { class: 'help', style: 'margin:8px 0 0;' },
      'Ein Vordruck deckt genau einen Monat ab. Hake an, was abgerechnet werden soll – reicht die Auswahl über mehrere Monate, entsteht je Monat eine eigene Abrechnung. Nicht angehakte Einträge bleiben offen. Beim Erstellen wird der Stundensatz eingefroren, spätere Satzänderungen wirken sich auf fertige Abrechnungen nicht mehr aus.'));
    card.appendChild(el('div', { style: 'margin-top:10px;' }, [
      el('label', {}, 'Offene Einträge'), monatsBox,
    ]));
    card.appendChild(el('div', { class: 'az-form', style: 'margin-top:8px;' }, [
      el('div', { style: 'grid-column: span 2;' }, [el('label', {}, 'Haushaltsstelle'), stelleSel]),
      el('div', { style: 'grid-column: span 2;' }, [el('label', {}, 'Notiz'), notizI]),
    ]));
    card.appendChild(el('div', { style: 'margin-top:10px;' }, [
      el('label', {}, 'Sonstige Kostenerstattungen (z. B. Maschineneinsatz)'),
      kostenBox,
    ]));
    card.appendChild(monatZeile);
    card.appendChild(el('p', { class: 'help', style: 'margin:8px 0 0;' }, offenHinweis));
    card.appendChild(vorschau);
    card.appendChild(el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [erstellenBtn]));
    // Standard: alles angehakt – abwählen ist der Sonderfall.
    for (const m of store.offeneMonate(arbeiterSel.value)) for (const z of m.eintraege) auswahl.add(z.id);
    renderAuswahl();
    renderKosten();
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
        el('span', { class: 'help' }, monatOderZeitraum(abr)),
        el('span', { class: 'tag ' + (bezahlt ? 'done' : 'ok') },
          bezahlt ? 'Ausgezahlt' + (abr.ausgezahltAm ? ' am ' + formatDatum(abr.ausgezahltAm) : '') : 'Abgerechnet'),
        el('div', { class: 'spacer' }),
        el('strong', {}, euro(abr.summeBetrag)),
        el('span', { class: 'help' }, stundenFmt(abr.summeStunden) + ' Std.'),
        kostenSummeVon(abr) ? el('span', { class: 'help' }, '+ ' + euro(kostenSummeVon(abr)) + ' Kosten') : null,
      ].filter(Boolean));

      const aktionen = el('div', { class: 'toolbar', style: 'margin:8px 0 0;' }, [
        el('button', {
          class: 'btn-sm btn-primary', onClick: () => GR.arbeitszeitenPdf.buildVgFormular(abr, { target: 'download' }),
        }, '📄 VG-Formular'),
        el('button', {
          class: 'btn-sm', onClick: () => GR.arbeitszeitenPdf.buildVgFormular(abr, { target: 'paperless' }),
        }, '📥 VG-Formular in Paperless'),
        el('button', {
          class: 'btn-sm', onClick: () => GR.arbeitszeitenPdf.buildVorlaeufigeAbrechnung(abr, { target: 'download' }),
        }, '📄 Interne PDF'),
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
      if ((abr.kostenerstattungen || []).length) {
        details.appendChild(el('p', { style: 'margin:8px 0 2px;' }, el('strong', {}, 'Sonstige Kostenerstattungen')));
        const kt = el('table');
        kt.appendChild(el('tbody', {}, (abr.kostenerstattungen || []).map(k => el('tr', {}, [
          el('td', {}, k.beschreibung || '—'),
          el('td', { style: 'text-align:right;' }, euro(k.betrag)),
        ]))));
        details.appendChild(kt);
      }
      if (abr.notiz) details.appendChild(el('p', { class: 'help' }, abr.notiz));

      card.appendChild(el('div', { class: 'az-abr-box' }, [kopf, details, aktionen]));
    }
    return card;
  }

  GR.views = GR.views || {};
  GR.views.renderArbeitsabrechnungen = renderArbeitsabrechnungen;
})();
