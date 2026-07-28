(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast, confirmDialog } = GR.ui;

  // Gemeindeinventar als Fassade auf Homebox. Es wird nichts lokal gespeichert —
  // jede Ansicht fragt Homebox. Deshalb ist hier alles asynchron und jeder
  // Ladevorgang braucht seinen eigenen Zustand.
  //
  // Die Wartungen liegen ebenfalls in Homebox. Was die Gemeindeverwaltung dazu
  // beisteuert, ist das Wiederholungsintervall und die Vorlauffrist — beides
  // kennt Homebox nicht. Aus einer fälligen Wartung macht der tägliche Lauf im
  // Backend (backend/wartungslauf.js) eine Aufgabe im Aufgabenmodul.

  const ui = { suche: '', ortId: '', stammdaten: { orte: [], marken: [] }, geladen: false };
  let kannWartungen = true;     // ältere Homebox-Versionen können keine

  function zuruecksetzen() {
    ui.stammdaten = { orte: [], marken: [] };
    ui.geladen = false;
    ui.ortId = '';
    ui.suche = '';
  }

  const heute = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function tageBis(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    const ziel = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const h = new Date();
    return Math.round((ziel - new Date(h.getFullYear(), h.getMonth(), h.getDate())) / 86400000);
  }
  function fristText(iso) {
    const t = tageBis(iso);
    if (t == null) return '';
    if (t < 0) return `${Math.abs(t)} ${Math.abs(t) === 1 ? 'Tag' : 'Tage'} überfällig`;
    if (t === 0) return 'heute fällig';
    return `in ${t} ${t === 1 ? 'Tag' : 'Tagen'}`;
  }
  // Ampel wie in den Verträgen: überfällig rot, innerhalb der Frist gelb.
  function fristKlasse(iso, vorlauf) {
    const t = tageBis(iso);
    if (t == null) return '';
    if (t < 0) return 'warn';
    if (t <= (vorlauf == null ? 30 : vorlauf)) return 'prep';
    return 'ok';
  }
  const datumDe = (iso) => (GR.ui.formatDatum ? GR.ui.formatDatum(iso) : iso || '—');

  function vorlaufStandard() {
    const s = GR.store.getSettings();
    const v = Number((s.inventar || {}).vorlaufTage);
    return Number.isFinite(v) && v >= 0 ? v : 30;
  }

  // ===========================================================================
  // Einstieg
  // ===========================================================================
  function renderInventar(mount, params) {
    params = params || {};

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { class: 'btn-primary', onClick: () => artikelBearbeiten(mount, null, {}) }, '+ Neuer Gegenstand'),
      GR.ui.scannerBereit && GR.ui.scannerBereit()
        ? el('button', { onClick: () => scanStarten(mount) }, '📷 Scannen')
        : el('button', { onClick: () => GR.ui.codeEintippen(code => codeGesucht(mount, code)) }, '⌨ Barcode eingeben'),
      el('div', { class: 'spacer' }),
      el('button', { onClick: () => location.hash = '#/einstellungen?kategorie=inventar' }, 'Einstellungen'),
    ]));
    mount.appendChild(el('h2', {}, 'Inventar'));
    mount.appendChild(el('p', { class: 'help' }, 'Das Gemeindeinventar wird in Homebox geführt — diese Ansicht arbeitet direkt darauf. Wartungspflichtige Gegenstände melden sich rechtzeitig im Aufgabenmodul.'));

    const inhalt = el('div', {});
    mount.appendChild(inhalt);

    // Erst die Verbindung prüfen: ohne Homebox wäre eine leere Liste
    // irreführend — sie sähe aus wie „nichts erfasst".
    inhalt.appendChild(el('div', { class: 'empty' }, 'Verbindung zu Homebox wird geprüft…'));
    GR.api.inventarHealth().then(async h => {
      inhalt.innerHTML = '';
      if (!h || h.ok !== true) { inhalt.appendChild(nichtVerbunden(h && h.error)); return; }
      kannWartungen = h.wartungen !== false;
      if (!ui.geladen) {
        try { ui.stammdaten = await GR.api.inventarStammdaten(); ui.geladen = true; } catch (_) { /* Filter bleibt leer */ }
      }
      if (h.mehrereSammlungen && h.sammlung) {
        inhalt.appendChild(el('p', { class: 'help' }, 'Sammlung: ' + h.sammlung));
      }
      if (!kannWartungen) {
        inhalt.appendChild(el('div', { class: 'card' },
          el('p', { class: 'help' }, 'Diese Homebox-Version kennt noch keine Wartungen. Gegenstände lassen sich verwalten, Wartungstermine aber nicht hinterlegen — dafür wäre ein Homebox-Update nötig.')));
      }
      await wartungsUebersicht(mount, inhalt);
      renderListe(mount, inhalt);
    }).catch(e => {
      inhalt.innerHTML = '';
      inhalt.appendChild(nichtVerbunden(e.message));
    });
  }

  function nichtVerbunden(fehler) {
    return el('div', { class: 'card' }, [
      el('h3', {}, 'Homebox nicht verbunden'),
      el('p', {}, 'Das Inventar wird in Homebox geführt. Ohne Verbindung lässt sich hier nichts anzeigen.'),
      fehler ? el('p', { class: 'help' }, fehler) : null,
      el('button', { class: 'btn-primary', onClick: () => location.hash = '#/einstellungen?kategorie=inventar' }, 'Zugang einrichten'),
    ].filter(Boolean));
  }

  // ===========================================================================
  // Anstehende Wartungen (Kopf der Ansicht)
  // ===========================================================================
  async function wartungsUebersicht(mount, inhalt) {
    if (!kannWartungen) return;
    let offen = [];
    try { offen = await GR.api.listOffeneWartungen('scheduled'); } catch (_) { return; }
    const vorlauf = vorlaufStandard();
    const anstehend = offen
      .filter(w => {
        const t = tageBis(w.geplantAm);
        return t != null && t <= (w.vorlaufTage == null ? vorlauf : w.vorlaufTage);
      })
      .sort((a, b) => String(a.geplantAm).localeCompare(String(b.geplantAm)));
    if (!anstehend.length) return;

    const karte = el('div', { class: 'card' });
    karte.appendChild(el('h3', {}, `Anstehende Wartungen (${anstehend.length})`));
    const t = el('table');
    const tb = el('tbody');
    for (const w of anstehend) {
      tb.appendChild(el('tr', {}, [
        el('td', {}, [
          el('strong', {}, w.itemName || '—'),
          el('div', { class: 'help' }, w.name || 'Prüfung'),
        ]),
        el('td', {}, [
          el('div', {}, datumDe(w.geplantAm)),
          el('span', { class: 'tag ' + fristKlasse(w.geplantAm, w.vorlaufTage) }, fristText(w.geplantAm)),
        ]),
        el('td', { style: 'text-align:right; white-space:nowrap;' }, [
          w.aufgabeId ? el('span', { class: 'help' }, 'Aufgabe angelegt ') : null,
          el('button', { class: 'btn-sm', onClick: () => artikelDetail(mount, w.itemId) }, 'Öffnen'),
        ].filter(Boolean)),
      ]));
    }
    t.appendChild(tb);
    karte.appendChild(t);
    inhalt.appendChild(karte);
  }

  // ===========================================================================
  // Liste
  // ===========================================================================
  function renderListe(mount, inhalt) {
    const sucheFeld = el('input', { type: 'search', placeholder: 'Gegenstand suchen…', value: ui.suche });
    const suchen = () => { ui.suche = sucheFeld.value.trim(); laden(); };
    sucheFeld.addEventListener('keydown', e => { if (e.key === 'Enter') suchen(); });

    const ortSel = el('select', {});
    ortSel.appendChild(el('option', { value: '' }, 'Alle Lagerorte'));
    for (const o of ui.stammdaten.orte) {
      ortSel.appendChild(el('option', { value: o.id, selected: o.id === ui.ortId }, o.name));
    }
    ortSel.onchange = () => { ui.ortId = ortSel.value; laden(); };

    inhalt.appendChild(el('div', { class: 'pers-filterbar' }, [
      el('div', { class: 'inv-suchzeile' }, [sucheFeld, el('button', { onClick: suchen }, 'Suchen')]),
      ortSel,
    ]));

    const listeBox = el('div', {});
    inhalt.appendChild(listeBox);

    async function laden() {
      listeBox.innerHTML = '';
      listeBox.appendChild(el('div', { class: 'empty' }, 'Wird geladen…'));
      try {
        const res = await GR.api.suchenInventar({ q: ui.suche, ortId: ui.ortId, proSeite: 50 });
        listeBox.innerHTML = '';
        if (!res.artikel.length) {
          listeBox.appendChild(el('div', { class: 'card' }, el('div', { class: 'empty' },
            ui.suche || ui.ortId ? 'Kein Gegenstand passt zu dieser Suche.' : 'Im Inventar ist noch nichts erfasst.')));
          return;
        }
        listeBox.appendChild(el('p', { class: 'help' }, `${res.gesamt} ${res.gesamt === 1 ? 'Gegenstand' : 'Gegenstände'}`));
        const grid = el('div', { class: 'inv-grid' });
        for (const a of res.artikel) grid.appendChild(kachel(mount, a));
        listeBox.appendChild(grid);
      } catch (e) {
        listeBox.innerHTML = '';
        listeBox.appendChild(el('div', { class: 'card' }, el('p', { class: 'help' }, 'Fehler: ' + e.message)));
      }
    }
    laden();
    inhalt._neuLaden = laden;
  }

  function kachel(mount, a) {
    return el('div', { class: 'inv-kachel', onClick: () => artikelDetail(mount, a.id) }, [
      el('div', { class: 'inv-kachel-name' }, a.name || '(ohne Namen)'),
      el('div', { class: 'help' }, a.ortName || 'ohne Lagerort'),
      el('div', { class: 'inv-kachel-fuss' }, [
        el('span', { class: 'inv-menge' }, `${a.menge} Stück`),
        a.barcode ? el('span', { class: 'help' }, '▮▮ ' + a.barcode) : null,
      ].filter(Boolean)),
    ]);
  }

  function auffrischen(mount) {
    const box = [...mount.querySelectorAll('div')].find(d => d._neuLaden);
    if (box) box._neuLaden();
  }

  // ===========================================================================
  // Scannen
  // ===========================================================================
  function scanStarten(mount) {
    GR.ui.scannen(code => codeGesucht(mount, code));
  }

  async function codeGesucht(mount, code) {
    try {
      const artikel = await GR.api.inventarBeiBarcode(code);
      artikelDetail(mount, artikel.id, artikel, code);
    } catch (e) {
      if (e.message && /404|not found/i.test(e.message)) return unbekannterCode(mount, code);
      toast('Fehler: ' + e.message, 5000);
    }
  }

  // Ein unbekannter Barcode ist beim ersten Erfassen der Normalfall — deshalb
  // führt er zum Anlegen, nicht in eine Fehlermeldung.
  function unbekannterCode(mount, code) {
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h3', {}, 'Unbekannter Barcode'),
      el('p', {}, `Zum Code ${code} ist in Homebox kein Gegenstand hinterlegt.`),
      el('p', { class: 'help' }, 'Entweder neu anlegen — oder den Code einem Gegenstand geben, den es schon gibt.'),
      el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: () => { close(); artikelBearbeiten(mount, null, { barcode: code }); } }, 'Neu anlegen'),
        el('button', { onClick: () => { close(); codeVerknuepfen(mount, code); } }, 'Vorhandenem geben'),
        el('button', { onClick: close }, 'Abbrechen'),
      ]),
    ]));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  // Barcode an einen bestehenden Gegenstand hängen. Ohne diesen Weg legt man
  // ihn ein zweites Mal an und führt den Bestand doppelt.
  function codeVerknuepfen(mount, code) {
    const sucheFeld = el('input', { type: 'search', placeholder: 'Gegenstand suchen…' });
    const treffer = el('div', { class: 'inv-treffer' });
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();

    async function suchen() {
      treffer.innerHTML = '';
      const q = sucheFeld.value.trim();
      if (!q) return;
      treffer.appendChild(el('div', { class: 'empty' }, 'Wird gesucht…'));
      try {
        const res = await GR.api.suchenInventar({ q, proSeite: 20 });
        treffer.innerHTML = '';
        if (!res.artikel.length) { treffer.appendChild(el('div', { class: 'empty' }, 'Nichts gefunden.')); return; }
        for (const a of res.artikel) {
          treffer.appendChild(el('button', {
            class: 'inv-treffer-zeile',
            onClick: async () => {
              try {
                await GR.api.speichernInventarArtikel(a.id, { barcode: code });
                close();
                toast('Barcode zugeordnet');
                artikelDetail(mount, a.id, null, code);
              } catch (e) { toast('Fehler: ' + e.message, 5000); }
            },
          }, [el('strong', {}, a.name), el('span', { class: 'help' }, ' · ' + (a.ortName || 'ohne Lagerort'))]));
        }
      } catch (e) {
        treffer.innerHTML = '';
        treffer.appendChild(el('div', { class: 'empty' }, 'Fehler: ' + e.message));
      }
    }
    sucheFeld.addEventListener('keydown', e => { if (e.key === 'Enter') suchen(); });

    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h3', {}, `Code ${code} zuordnen`),
      el('p', { class: 'help' }, 'Den Gegenstand suchen, der diesen Barcode bekommen soll.'),
      el('div', { class: 'inv-suchzeile' }, [sucheFeld, el('button', { onClick: suchen }, 'Suchen')]),
      treffer,
      el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { onClick: close }, 'Abbrechen'),
      ]),
    ]));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    setTimeout(() => sucheFeld.focus(), 50);
  }

  // ===========================================================================
  // Detail
  // ===========================================================================
  async function artikelDetail(mount, id, vorgeladen, gescannterCode) {
    let a = vorgeladen || null;
    let wartungen = [];
    let anzahl = 1;

    const overlay = el('div', { class: 'modal-overlay' });
    const box = el('div', { class: 'modal modal-breit' });
    overlay.appendChild(box);
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    box.appendChild(el('div', { class: 'empty' }, 'Wird geladen…'));

    async function neuLaden() {
      try {
        a = await GR.api.getInventarArtikel(id);
        wartungen = kannWartungen ? await GR.api.listInventarWartungen(id, 'both').catch(() => []) : [];
        zeichne();
      } catch (e) {
        box.innerHTML = '';
        box.appendChild(el('p', { class: 'help' }, 'Fehler: ' + e.message));
      }
    }

    function zeichne() {
      box.innerHTML = '';
      box.appendChild(el('h3', {}, a.name || 'Gegenstand'));
      if (gescannterCode) box.appendChild(el('p', { class: 'help' }, '▮▮ ' + gescannterCode + ' erkannt'));

      box.appendChild(el('div', { class: 'inv-bestand' }, [
        el('strong', {}, String(a.menge)),
        el('span', { class: 'help' }, ' Stück · ' + (a.ortName || 'ohne Lagerort')),
      ]));

      // --- Bestand buchen
      box.appendChild(el('h4', { style: 'margin:14px 0 4px;' }, 'Bestand buchen'));
      const anzeige = el('input', { type: 'number', min: '1', inputmode: 'numeric', value: String(anzahl), class: 'inv-anzahl' });
      anzeige.oninput = () => {
        const n = parseInt(anzeige.value, 10);
        anzahl = Number.isFinite(n) && n > 0 ? n : 1;
      };
      const setzeAnzahl = (n) => { anzahl = Math.max(1, n); anzeige.value = String(anzahl); };
      box.appendChild(el('div', { class: 'inv-buchen' }, [
        el('button', { onClick: () => setzeAnzahl(anzahl - 1) }, '−'),
        anzeige,
        el('button', { onClick: () => setzeAnzahl(anzahl + 1) }, '+'),
        el('button', { class: 'btn-danger', onClick: () => buchen({ delta: -anzahl }, `${anzahl} entnommen`) }, 'Entnehmen'),
        el('button', { class: 'btn-primary', onClick: () => buchen({ delta: anzahl }, `${anzahl} eingelagert`) }, 'Einlagern'),
      ]));

      // --- Wartungen
      if (kannWartungen) {
        box.appendChild(el('h4', { style: 'margin:16px 0 4px;' }, 'Wartungen'));
        box.appendChild(el('p', { class: 'help', style: 'margin:0 0 6px;' },
          `Eine offene Wartung meldet sich ${vorlaufStandard()} Tage vorher als Aufgabe. Mit einem Intervall entsteht der nächste Termin automatisch, sobald diese erledigt ist.`));
        box.appendChild(wartungsListe());
        box.appendChild(el('button', { class: 'btn-sm', onClick: () => wartungBearbeiten(null) }, '+ Wartung planen'));
      }

      // --- Angaben
      box.appendChild(el('h4', { style: 'margin:16px 0 4px;' }, 'Angaben'));
      const dl = el('table', { class: 'inv-daten' });
      const tb = el('tbody');
      const zeile = (k, v) => tb.appendChild(el('tr', {}, [el('th', {}, k), el('td', {}, String(v || '—'))]));
      zeile('Lagerort', a.ortName);
      zeile('Barcode', a.barcode);
      zeile('Hersteller', a.hersteller);
      zeile('Kaufpreis', a.kaufpreis ? GR.models.formatEuro ? GR.models.formatEuro(a.kaufpreis) : a.kaufpreis + ' €' : '');
      zeile('Etiketten', (a.marken || []).map(x => x.name).join(', '));
      zeile('Kennung', a.assetId);
      dl.appendChild(tb);
      box.appendChild(dl);
      if (a.beschreibung) box.appendChild(el('p', {}, a.beschreibung));

      box.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: () => { close(); artikelBearbeiten(mount, a, {}); } }, 'Bearbeiten'),
        el('button', { onClick: close }, 'Schließen'),
        el('div', { class: 'spacer' }),
        // Eindeutig beschriftet: in diesem Fenster gibt es auch ein „Löschen"
        // für eine einzelne Wartung. Zwei gleich benannte Knöpfe, von denen
        // einer den ganzen Gegenstand entfernt, sind eine Falle.
        el('button', { class: 'btn-danger', onClick: loeschen }, 'Gegenstand löschen'),
      ]));
    }

    function wartungsListe() {
      const offen = wartungen.filter(w => w.offen).sort((x, y) => String(x.geplantAm).localeCompare(String(y.geplantAm)));
      const erledigt = wartungen.filter(w => !w.offen).sort((x, y) => String(y.erledigtAm).localeCompare(String(x.erledigtAm)));
      if (!wartungen.length) return el('div', { class: 'empty' }, 'Keine Wartung hinterlegt.');

      const wrap = el('div', {});
      const t = el('table');
      const tb = el('tbody');
      for (const w of offen) {
        tb.appendChild(el('tr', {}, [
          el('td', {}, [
            el('strong', {}, w.name),
            w.intervallMonate ? el('div', { class: 'help' }, `wiederholt sich alle ${w.intervallMonate} Monate`) : null,
            w.beschreibung ? el('div', { class: 'help' }, w.beschreibung) : null,
          ].filter(Boolean)),
          el('td', {}, [
            el('div', {}, datumDe(w.geplantAm)),
            el('span', { class: 'tag ' + fristKlasse(w.geplantAm, w.vorlaufTage) }, fristText(w.geplantAm)),
            w.aufgabeId ? el('div', { class: 'help' }, 'Aufgabe angelegt') : null,
          ].filter(Boolean)),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm btn-primary', onClick: () => erledigen(w) }, 'Erledigt'),
            ' ',
            el('button', { class: 'btn-sm', onClick: () => wartungBearbeiten(w) }, 'Ändern'),
          ]),
        ]));
      }
      t.appendChild(tb);
      wrap.appendChild(t);

      if (erledigt.length) {
        const auf = el('details', {});
        auf.appendChild(el('summary', {}, `Erledigt (${erledigt.length})`));
        const t2 = el('table');
        const tb2 = el('tbody');
        for (const w of erledigt) {
          tb2.appendChild(el('tr', {}, [
            el('td', {}, w.name),
            el('td', {}, datumDe(w.erledigtAm)),
            el('td', {}, w.kosten ? w.kosten.toFixed(2).replace('.', ',') + ' €' : '—'),
            el('td', { style: 'text-align:right;' },
              el('button', { class: 'btn-sm', onClick: () => wartungLoeschen(w) }, 'Eintrag entfernen')),
          ]));
        }
        t2.appendChild(tb2);
        auf.appendChild(t2);
        wrap.appendChild(auf);
      }
      return wrap;
    }

    // Erledigen bucht das Datum in Homebox. Den Folgetermin legt der tägliche
    // Lauf an — die Intervall-Logik steht bewusst nur an EINER Stelle.
    async function erledigen(w) {
      const datum = window.prompt(`„${w.name}" erledigt am (JJJJ-MM-TT):`, heute());
      if (!datum) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datum.trim())) return toast('Bitte im Format JJJJ-MM-TT eingeben');
      try {
        await GR.api.speichernWartung(w.id, {
          itemId: id, name: w.name, beschreibung: w.beschreibung,
          geplantAm: '', erledigtAm: datum.trim(), kosten: w.kosten,
          intervallMonate: w.intervallMonate, vorlaufTage: w.vorlaufTage,
        });
        toast(w.intervallMonate ? 'Erledigt — der Folgetermin entsteht beim nächsten Abgleich' : 'Als erledigt gebucht', 4000);
        await neuLaden();
      } catch (e) { toast('Fehler: ' + e.message, 5000); }
    }

    async function wartungLoeschen(w) {
      if (!confirmDialog(`Wartung „${w.name}" wirklich löschen?`)) return;
      try {
        await GR.api.loeschenWartung(w.id);
        toast('Wartung gelöscht');
        await neuLaden();
      } catch (e) { toast('Fehler: ' + e.message, 5000); }
    }

    function wartungBearbeiten(w) {
      const istNeu = !w;
      const f = {
        name: el('input', { type: 'text', value: w ? w.name : '' }),
        geplantAm: el('input', { type: 'date', value: w ? w.geplantAm : '' }),
        intervallMonate: el('input', { type: 'number', min: '0', value: w ? String(w.intervallMonate || 0) : '0' }),
        vorlaufTage: el('input', { type: 'number', min: '0', placeholder: String(vorlaufStandard()), value: w && w.vorlaufTage != null ? String(w.vorlaufTage) : '' }),
        beschreibung: el('textarea', { rows: '2' }, w ? w.beschreibung || '' : ''),
      };
      const ov = el('div', { class: 'modal-overlay' });
      const zu = () => ov.remove();
      const speichern = async () => {
        const daten = {
          itemId: id,
          name: f.name.value.trim(),
          beschreibung: f.beschreibung.value,
          geplantAm: f.geplantAm.value,
          erledigtAm: w ? w.erledigtAm : '',
          kosten: w ? w.kosten : null,
          intervallMonate: Number(f.intervallMonate.value) || 0,
          vorlaufTage: f.vorlaufTage.value === '' ? null : Number(f.vorlaufTage.value),
        };
        if (!daten.name) return toast('Bitte eine Bezeichnung angeben');
        if (!daten.geplantAm && !daten.erledigtAm) return toast('Bitte ein Datum angeben');
        try {
          if (istNeu) await GR.api.anlegenWartung(id, daten);
          else await GR.api.speichernWartung(w.id, daten);
          zu();
          toast(istNeu ? 'Wartung geplant' : 'Gespeichert');
          await neuLaden();
        } catch (e) { toast('Fehler: ' + e.message, 5000); }
      };

      ov.appendChild(el('div', { class: 'modal' }, [
        el('h3', {}, istNeu ? 'Wartung planen' : 'Wartung ändern'),
        el('div', {}, [el('label', {}, 'Bezeichnung (z. B. Prüfung nach DIN 14406)'), f.name]),
        el('div', { class: 'grid-2', style: 'margin-top:8px;' }, [
          el('div', {}, [el('label', {}, 'Fällig am'), f.geplantAm]),
          el('div', {}, [el('label', {}, 'Wiederholung (Monate, 0 = einmalig)'), f.intervallMonate]),
        ]),
        el('div', { style: 'margin-top:8px;' }, [
          el('label', {}, 'Vorlauf für die Aufgabe (Tage)'), f.vorlaufTage,
          el('p', { class: 'help', style: 'margin:2px 0 0;' }, `Leer = Standard aus den Einstellungen (${vorlaufStandard()} Tage).`),
        ]),
        el('div', { style: 'margin-top:8px;' }, [el('label', {}, 'Hinweis'), f.beschreibung]),
        el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
          el('button', { class: 'btn-primary', onClick: speichern }, istNeu ? 'Planen' : 'Speichern'),
          el('button', { onClick: zu }, 'Abbrechen'),
        ]),
      ]));
      ov.addEventListener('click', e => { if (e.target === ov) zu(); });
      document.body.appendChild(ov);
    }

    async function buchen(arg, text) {
      box.querySelectorAll('button').forEach(b => b.disabled = true);
      try {
        a = await GR.api.buchenInventarBestand(a.id, arg);
        anzahl = 1;
        zeichne();
        toast(`${text} — Bestand: ${a.menge}`);
        auffrischen(mount);
      } catch (e) {
        toast('Fehler: ' + e.message, 5000);
        box.querySelectorAll('button').forEach(b => b.disabled = false);
      }
    }

    async function loeschen() {
      const offene = wartungen.filter(w => w.offen).length;
      if (!confirmDialog(`„${a.name}" wirklich aus dem Inventar löschen?\n\n`
        + (offene ? `${offene} geplante ${offene === 1 ? 'Wartung wird' : 'Wartungen werden'} mit gelöscht.\n\n` : '')
        + 'Der Gegenstand verschwindet auch aus Homebox. Das lässt sich nicht rückgängig machen.')) return;
      try {
        await GR.api.loeschenInventarArtikel(a.id);
        close();
        toast('Gegenstand gelöscht');
        auffrischen(mount);
      } catch (e) { toast('Fehler: ' + e.message, 5000); }
    }

    if (a) { neuLaden(); } else { neuLaden(); }
  }

  // ===========================================================================
  // Anlegen / Bearbeiten
  // ===========================================================================
  function artikelBearbeiten(mount, original, vorgabe) {
    const istNeu = !original;
    const a = istNeu
      ? { name: '', beschreibung: '', menge: 1, ortId: '', barcode: vorgabe.barcode || '', markenIds: [], hersteller: '', kaufpreis: null, notizen: '' }
      : {
        name: original.name, beschreibung: original.beschreibung, menge: original.menge,
        ortId: original.ortId, barcode: original.barcode,
        markenIds: (original.marken || []).map(x => x.id),
        hersteller: original.hersteller, kaufpreis: original.kaufpreis, notizen: original.notizen,
      };

    const f = {
      name: el('input', { type: 'text', value: a.name }),
      barcode: el('input', { type: 'text', value: a.barcode || '' }),
      menge: el('input', { type: 'number', min: '0', inputmode: 'numeric', value: String(a.menge) }),
      hersteller: el('input', { type: 'text', value: a.hersteller || '' }),
      kaufpreis: el('input', { type: 'number', step: '0.01', min: '0', value: a.kaufpreis == null ? '' : String(a.kaufpreis) }),
      beschreibung: el('input', { type: 'text', value: a.beschreibung || '' }),
      notizen: el('textarea', { rows: '2' }, a.notizen || ''),
    };
    const ortSel = el('select', {});
    ortSel.appendChild(el('option', { value: '' }, '— kein Lagerort —'));
    for (const o of ui.stammdaten.orte) {
      ortSel.appendChild(el('option', { value: o.id, selected: o.id === a.ortId }, o.name));
    }

    // Etiketten als Mehrfachauswahl über Chips (wie die Rollen in den Stammdaten).
    const markenIds = a.markenIds.slice();
    const markenBox = el('div', { class: 'pers-rollen-grid' }, ui.stammdaten.marken.map(m => {
      const cb = el('input', { type: 'checkbox', checked: markenIds.includes(m.id) });
      cb.onchange = () => {
        if (cb.checked) { if (!markenIds.includes(m.id)) markenIds.push(m.id); }
        else { const i = markenIds.indexOf(m.id); if (i >= 0) markenIds.splice(i, 1); }
      };
      return el('label', { class: 'pers-check' }, [cb, ' ' + m.name]);
    }));

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    const speichern = async (btn) => {
      const daten = {
        name: f.name.value.trim(),
        beschreibung: f.beschreibung.value,
        menge: f.menge.value === '' ? 0 : Number(f.menge.value),
        ortId: ortSel.value,
        barcode: f.barcode.value.trim(),
        markenIds,
        hersteller: f.hersteller.value.trim(),
        kaufpreis: f.kaufpreis.value === '' ? null : Number(f.kaufpreis.value),
        notizen: f.notizen.value,
      };
      if (!daten.name) return toast('Bitte eine Bezeichnung angeben');
      btn.disabled = true;
      btn.textContent = istNeu ? 'Lege an…' : 'Speichere…';
      try {
        const gespeichert = istNeu
          ? await GR.api.anlegenInventarArtikel(daten)
          : await GR.api.speichernInventarArtikel(original.id, daten);
        close();
        toast(istNeu ? 'Gegenstand angelegt' : 'Gespeichert');
        // Ohne gespeicherten Barcode findet der nächste Scan ihn nicht wieder —
        // das muss man sofort erfahren, nicht erst vor Ort.
        if (daten.barcode && gespeichert && gespeichert.barcode !== daten.barcode) {
          toast('Achtung: Der Barcode wurde nicht übernommen — diese Homebox-Version speichert ihn womöglich nicht.', 6000);
        }
        auffrischen(mount);
        artikelDetail(mount, gespeichert.id, gespeichert, daten.barcode || '');
      } catch (e) {
        toast('Fehler: ' + e.message, 5000);
        btn.disabled = false;
        btn.textContent = istNeu ? 'Anlegen' : 'Speichern';
      }
    };
    const speichernBtn = el('button', { class: 'btn-primary' }, istNeu ? 'Anlegen' : 'Speichern');
    speichernBtn.onclick = () => speichern(speichernBtn);

    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h3', {}, istNeu ? 'Neuer Gegenstand' : 'Gegenstand bearbeiten'),
      el('div', {}, [el('label', {}, 'Bezeichnung'), f.name]),
      el('div', { style: 'margin-top:8px;' }, [
        el('label', {}, 'Barcode'),
        el('div', { class: 'inv-suchzeile' }, [
          f.barcode,
          GR.ui.scannerBereit && GR.ui.scannerBereit()
            ? el('button', { type: 'button', onClick: () => GR.ui.scannen(c => { f.barcode.value = c; }) }, '📷')
            : el('button', { type: 'button', onClick: () => GR.ui.codeEintippen(c => { f.barcode.value = c; }) }, '⌨'),
        ]),
      ]),
      el('div', { class: 'grid-2', style: 'margin-top:8px;' }, [
        el('div', {}, [el('label', {}, 'Bestand'), f.menge]),
        el('div', {}, [el('label', {}, 'Lagerort'), ortSel]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Hersteller'), f.hersteller]),
        el('div', {}, [el('label', {}, 'Kaufpreis (€)'), f.kaufpreis]),
      ]),
      el('div', {}, [el('label', {}, 'Beschreibung'), f.beschreibung]),
      ui.stammdaten.marken.length ? el('h4', { style: 'margin:14px 0 4px;' }, 'Etiketten') : null,
      ui.stammdaten.marken.length ? markenBox : null,
      el('div', { style: 'margin-top:10px;' }, [el('label', {}, 'Notiz'), f.notizen]),
      el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        speichernBtn,
        el('button', { onClick: close }, 'Abbrechen'),
      ]),
    ].filter(Boolean)));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  GR.views = GR.views || {};
  GR.views.renderInventar = renderInventar;
  GR.inventar = { zuruecksetzen, artikelDetail, tageBis, fristText, fristKlasse };
})();
