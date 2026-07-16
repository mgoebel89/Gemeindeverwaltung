(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog, formatDatum } = GR.ui;
  const M = GR.models;

  // Zeiterfassung (Modul Arbeitszeiten & Vergütung).
  // Oben ein schnelles Erfassungsformular, darunter die gefilterte Liste.
  // Regel: nur „erfasst" ist editier-/löschbar; ab „abgerechnet" ist der Eintrag
  // gesperrt (Korrektur nur über Storno der Abrechnung).

  const euro = (n) => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const stunden = (n) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function heuteIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const STATUS_CLS = { erfasst: 'prep', abgerechnet: 'ok', ausgezahlt: 'done' };
  // Filter überleben Re-Renders (nur diese Session).
  const uiState = { arbeiterId: '', status: '', von: '', bis: '' };

  function satzHistorie() { return (store.getSettings().arbeitszeiten || {}).satzHistorie || []; }
  function katalog() { return (store.getSettings().arbeitszeiten || {}).taetigkeiten || []; }
  function aktiveArbeiter() {
    return store.listArbeiter()
      .filter(a => a.aktiv !== false)
      .sort((a, b) => M.arbeiterName(a).localeCompare(M.arbeiterName(b), 'de'));
  }

  function renderArbeitszeiten(mount) {
    function refresh() { mount.innerHTML = ''; renderArbeitszeiten(mount); }

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('h2', { style: 'margin:0;' }, 'Arbeitszeiten'),
      el('div', { class: 'spacer' }),
      el('a', { class: 'btn btn-sm', href: '#/arbeiter' }, 'Arbeiter & Firmen'),
      el('a', { class: 'btn btn-sm', href: '#/arbeitsabrechnungen' }, 'Abrechnungen'),
      el('a', { class: 'btn btn-sm', href: '#/einstellungen' }, 'Stundensatz'),
    ]));

    const arbeiter = aktiveArbeiter();
    if (!arbeiter.length) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'help', style: 'margin:0 0 8px;' }, 'Es ist noch kein Arbeiter und keine Firma angelegt. Ohne Leistungserbringer lässt sich keine Zeit erfassen.'),
        el('a', { class: 'btn btn-primary', href: '#/arbeiter' }, 'Arbeiter & Firmen anlegen'),
      ]));
      return;
    }
    if (!satzHistorie().length) {
      mount.appendChild(el('div', { class: 'warn' }, [
        'Es ist noch kein Stundensatz hinterlegt. Erfassen geht, abrechnen erst mit Satz — ',
        el('a', { href: '#/einstellungen' }, 'Einstellungen → Arbeitszeiten'),
      ]));
    }

    mount.appendChild(erfassungsKarte(refresh));
    mount.appendChild(listenKarte(refresh));
  }

  // --- Schnellerfassung ---
  function erfassungsKarte(refresh) {
    const arbeiterSel = el('select', {}, aktiveArbeiter().map(a =>
      el('option', { value: a.id, selected: a.id === uiState.arbeiterId }, M.arbeiterName(a))));
    const datumI = el('input', { type: 'date', value: heuteIso() });
    const stundenI = el('input', { type: 'number', step: '0.25', min: '0', placeholder: 'z. B. 2,5' });

    // Tätigkeit: Katalog-Auswahl ODER freier Text.
    const katSel = el('select', {}, [el('option', { value: '' }, '— aus Katalog wählen —')]
      .concat(katalog().map(t => el('option', { value: t }, t))));
    const freiI = el('input', { type: 'text', placeholder: 'oder frei eintippen' });
    katSel.onchange = () => { if (katSel.value) freiI.value = katSel.value; };

    const notizI = el('input', { type: 'text', placeholder: 'Notiz (optional)' });

    // Abweichender Satz (z. B. Firmen); leer = einheitlicher Satz zum Datum.
    const satzI = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Standard' });
    const satzInfo = el('span', { class: 'help' }, '');
    function refreshSatzInfo() {
      const s = M.satzFuer(satzHistorie(), datumI.value);
      satzInfo.textContent = s == null
        ? 'Für dieses Datum ist kein Satz hinterlegt.'
        : `Einheitlicher Satz am ${formatDatum(datumI.value)}: ${euro(s)} / Std.`;
    }
    refreshSatzInfo();
    datumI.onchange = refreshSatzInfo;

    const onAdd = () => {
      const taetigkeit = (freiI.value || katSel.value || '').trim();
      const std = Number(String(stundenI.value).replace(',', '.'));
      if (!taetigkeit) return toast('Bitte eine Tätigkeit angeben');
      if (!(std > 0)) return toast('Bitte die Stunden angeben');
      const z = Object.assign(M.emptyArbeitszeit(), {
        arbeiterId: arbeiterSel.value,
        datum: datumI.value || heuteIso(),
        taetigkeit,
        stunden: std,
        notiz: notizI.value.trim(),
        satzManuell: satzI.value === '' ? null : Number(String(satzI.value).replace(',', '.')),
      });
      store.saveArbeitszeit(z);
      uiState.arbeiterId = z.arbeiterId; // Filter/Vorauswahl merken
      toast('Eingetragen');
      refresh();
    };

    return el('div', { class: 'card' }, [
      el('h3', {}, 'Zeit erfassen'),
      el('div', { class: 'az-form' }, [
        el('div', {}, [el('label', {}, 'Arbeiter / Firma'), arbeiterSel]),
        el('div', {}, [el('label', {}, 'Datum (Leistung)'), datumI]),
        el('div', {}, [el('label', {}, 'Stunden'), stundenI]),
        el('div', {}, [el('label', {}, 'Abw. Satz (€/Std.)'), satzI]),
      ]),
      el('div', { class: 'az-form', style: 'margin-top:8px;' }, [
        el('div', {}, [el('label', {}, 'Tätigkeit (Katalog)'), katSel]),
        el('div', { style: 'grid-column: span 2;' }, [el('label', {}, 'Tätigkeit (Text)'), freiI]),
        el('div', {}, [el('label', {}, 'Notiz'), notizI]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px; align-items:center;' }, [
        el('button', { class: 'btn-primary', onClick: onAdd }, 'Eintragen'),
        satzInfo,
      ]),
    ]);
  }

  // --- Liste mit Filtern ---
  function listenKarte(refresh) {
    const card = el('div', { class: 'card' });

    const fArbeiter = el('select', {}, [el('option', { value: '' }, 'Alle Arbeiter/Firmen')]
      .concat(store.listArbeiter().map(a => el('option', { value: a.id, selected: a.id === uiState.arbeiterId }, M.arbeiterName(a)))));
    const fStatus = el('select', {}, [el('option', { value: '' }, 'Alle Status')]
      .concat(M.ARBEITSZEIT_STATUS.map(s => el('option', { value: s, selected: s === uiState.status }, M.ARBEITSZEIT_STATUS_LABEL[s]))));
    const fVon = el('input', { type: 'date', value: uiState.von });
    const fBis = el('input', { type: 'date', value: uiState.bis });
    const apply = () => {
      uiState.arbeiterId = fArbeiter.value; uiState.status = fStatus.value;
      uiState.von = fVon.value; uiState.bis = fBis.value;
      refresh();
    };
    for (const f of [fArbeiter, fStatus, fVon, fBis]) f.onchange = apply;

    card.appendChild(el('div', { class: 'toolbar', style: 'align-items:flex-end;' }, [
      el('h3', { style: 'margin:0;' }, 'Einträge'),
      el('div', { class: 'spacer' }),
      fArbeiter, fStatus,
      el('div', {}, [el('label', { class: 'help' }, 'von'), fVon]),
      el('div', {}, [el('label', { class: 'help' }, 'bis'), fBis]),
    ]));

    const hist = satzHistorie();
    const liste = store.listArbeitszeiten()
      .filter(z => !uiState.arbeiterId || z.arbeiterId === uiState.arbeiterId)
      .filter(z => !uiState.status || (z.status || 'erfasst') === uiState.status)
      .filter(z => !uiState.von || String(z.datum) >= uiState.von)
      .filter(z => !uiState.bis || String(z.datum) <= uiState.bis)
      .sort((a, b) => String(b.datum).localeCompare(String(a.datum)));

    if (!liste.length) {
      card.appendChild(el('div', { class: 'empty' }, 'Keine Einträge für diese Auswahl.'));
      return card;
    }

    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Datum'), el('th', {}, 'Arbeiter / Firma'), el('th', {}, 'Tätigkeit'),
      el('th', { style: 'text-align:right;' }, 'Stunden'), el('th', { style: 'text-align:right;' }, 'Satz'),
      el('th', { style: 'text-align:right;' }, 'Betrag'), el('th', {}, 'Status'), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    let sumStd = 0, sumBetrag = 0;

    for (const z of liste) {
      const a = store.getArbeiter(z.arbeiterId);
      const satz = M.arbeitszeitSatz(z, hist);
      const betrag = M.arbeitszeitBetrag(z, hist);
      const st = z.status || 'erfasst';
      const gesperrt = st !== 'erfasst';
      sumStd += Number(z.stunden) || 0;
      sumBetrag += betrag || 0;

      tbody.appendChild(el('tr', {}, [
        el('td', {}, formatDatum(z.datum)),
        el('td', {}, a ? M.arbeiterName(a) : '(gelöscht)'),
        el('td', {}, [
          el('span', {}, z.taetigkeit || '—'),
          z.notiz ? el('div', { class: 'help' }, z.notiz) : null,
        ]),
        el('td', { style: 'text-align:right;' }, stunden(z.stunden)),
        el('td', { style: 'text-align:right;' }, [
          satz == null ? el('span', { class: 'warn-inline' }, 'kein Satz') : el('span', {}, euro(satz)),
          (z.satzManuell != null && z.satzManuell !== '' && z.satzSnapshot == null)
            ? el('div', { class: 'help' }, 'abweichend') : null,
        ]),
        el('td', { style: 'text-align:right;' }, betrag == null ? '—' : euro(betrag)),
        el('td', {}, el('span', { class: 'tag ' + (STATUS_CLS[st] || '') }, M.ARBEITSZEIT_STATUS_LABEL[st] || st)),
        el('td', { style: 'text-align:right; white-space:nowrap;' }, gesperrt
          ? el('span', { class: 'help', title: 'Abgerechnete Einträge sind gesperrt. Korrektur nur über Storno der Abrechnung.' }, '🔒')
          : [
            el('button', { class: 'btn-sm', onClick: () => bearbeitenDialog(z, refresh) }, 'Bearbeiten'),
            ' ',
            el('button', {
              class: 'btn-sm btn-danger', onClick: () => {
                if (!confirmDialog('Diesen Eintrag löschen?')) return;
                store.deleteArbeitszeit(z.id); refresh();
              },
            }, '✕'),
          ]),
      ]));
    }
    table.appendChild(tbody);
    table.appendChild(el('tfoot', {}, el('tr', {}, [
      el('td', { colspan: '3' }, el('strong', {}, 'Summe')),
      el('td', { style: 'text-align:right;' }, el('strong', {}, stunden(sumStd))),
      el('td', {}, ''),
      el('td', { style: 'text-align:right;' }, el('strong', {}, euro(sumBetrag))),
      el('td', { colspan: '2' }, ''),
    ])));
    card.appendChild(table);
    return card;
  }

  // --- Bearbeiten (nur solange „erfasst") ---
  function bearbeitenDialog(z, onSaved) {
    const arbeiterSel = el('select', {}, store.listArbeiter().map(a =>
      el('option', { value: a.id, selected: a.id === z.arbeiterId }, M.arbeiterName(a))));
    const datumI = el('input', { type: 'date', value: z.datum || '' });
    const taetI = el('input', { type: 'text', value: z.taetigkeit || '' });
    const katSel = el('select', {}, [el('option', { value: '' }, '— aus Katalog —')]
      .concat(katalog().map(t => el('option', { value: t }, t))));
    katSel.onchange = () => { if (katSel.value) taetI.value = katSel.value; };
    const stundenI = el('input', { type: 'number', step: '0.25', min: '0', value: z.stunden || 0 });
    const satzI = el('input', { type: 'number', step: '0.01', min: '0', value: z.satzManuell == null ? '' : z.satzManuell, placeholder: 'Standard' });
    const notizI = el('input', { type: 'text', value: z.notiz || '' });

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    const onSave = () => {
      const std = Number(String(stundenI.value).replace(',', '.'));
      if (!taetI.value.trim()) return toast('Bitte eine Tätigkeit angeben');
      if (!(std > 0)) return toast('Bitte die Stunden angeben');
      z.arbeiterId = arbeiterSel.value;
      z.datum = datumI.value;
      z.taetigkeit = taetI.value.trim();
      z.stunden = std;
      z.satzManuell = satzI.value === '' ? null : Number(String(satzI.value).replace(',', '.'));
      z.notiz = notizI.value.trim();
      store.saveArbeitszeit(z);
      toast('Gespeichert');
      close();
      if (onSaved) onSaved();
    };

    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h3', {}, 'Eintrag bearbeiten'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Arbeiter / Firma'), arbeiterSel]),
        el('div', {}, [el('label', {}, 'Datum'), datumI]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Tätigkeit (Katalog)'), katSel]),
        el('div', {}, [el('label', {}, 'Tätigkeit'), taetI]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Stunden'), stundenI]),
        el('div', {}, [el('label', {}, 'Abweichender Satz (€/Std.)'), satzI]),
      ]),
      el('div', {}, [el('label', {}, 'Notiz'), notizI]),
      el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: onSave }, 'Speichern'),
        el('button', { onClick: close }, 'Abbrechen'),
      ]),
    ]));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  GR.views = GR.views || {};
  GR.views.renderArbeitszeiten = renderArbeitszeiten;
})();
