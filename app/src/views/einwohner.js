(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast, confirmDialog } = GR.ui;

  // Modul Einwohner.
  //
  // Die Einwohner liegen in einer eigenen NocoDB-Base und werden NICHT lokal
  // gespeichert — jede Ansicht fragt das Backend. Deshalb ist hier alles
  // asynchron und es gibt keinen store-Cache wie in den übrigen Modulen.
  //
  // DAS GATE prägt den Aufbau: ohne gültigen PIN-Token liefert das Backend
  // nichts. Jede Ansicht beginnt deshalb mit `mitGate(...)`, das entweder die
  // PIN-Abfrage zeigt oder den Inhalt baut. Ein abgelaufener Token äußert sich
  // als Fehler mit `gesperrt` — dann geht es zurück zur PIN-Abfrage, statt eine
  // Fehlermeldung anzuzeigen.
  //
  // Drei Reiter: Einwohner (Liste + Pflege), Ehrungen (Jubiläen + Urkunde),
  // Abgleich (Prüfliste gegen die Papierliste der Verbandsgemeinde).

  const ui = { reiter: 'liste', suche: '', letzteListe: [] };

  const heute = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const datumDe = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
  };
  const vollerName = (e) => [e.vorname, e.nachname].filter(Boolean).join(' ').trim();
  const anschrift = (e) => {
    const nr = [e.hausnummer, e.zusatz].filter(Boolean).join('');
    return [e.strasse, nr].filter(Boolean).join(' ');
  };
  function einstellungen() {
    const s = GR.store.getSettings();
    return s.einwohner || {};
  }
  function vorlaufMonate() {
    const m = Number(einstellungen().vorlaufMonate);
    return Number.isFinite(m) && m >= 0 ? m : 1;
  }

  // Vollendetes Lebensalter an einem Stichtag. Zwillingsrechnung zu
  // backend/ehrungen.js — beide müssen zum selben Ergebnis kommen.
  function alterAm(geburtsdatum, stichtag) {
    const g = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(geburtsdatum || ''));
    const s = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(stichtag || heute()));
    if (!g || !s) return null;
    let a = Number(s[1]) - Number(g[1]);
    if (Number(s[2]) < Number(g[2]) || (Number(s[2]) === Number(g[2]) && Number(s[3]) < Number(g[3]))) a--;
    return a;
  }

  // ===========================================================================
  // Gate
  // ===========================================================================
  // Jede Ansicht läuft hierdurch. `bauen(ziel)` wird nur aufgerufen, wenn das
  // Backend uns durchlässt.
  async function mitGate(mount, bauen) {
    let status;
    try {
      status = await GR.api.einwohnerStatus();
    } catch (e) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, 'Einwohner'),
        el('p', { class: 'warn' }, 'Das Backend antwortet nicht: ' + (e.message || e)),
      ]));
      return;
    }
    if (!status.konfiguriert && !status.hasPin) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, 'Einwohner'),
        el('p', {}, 'Das Modul ist noch nicht eingerichtet. Hinterlege in den Einstellungen die Verbindung zur Einwohner-Base und vergib eine PIN.'),
        el('button', { class: 'btn-primary', onClick: () => location.hash = '#/einstellungen?kategorie=einwohner' }, 'Zu den Einstellungen'),
      ]));
      return;
    }
    if (status.hasPin && !status.angemeldet) {
      pinAbfrage(mount, () => renderEinwohner(mount, {}));
      return;
    }
    if (status.offen) {
      // Ohne PIN steht das Melderegister jedem im Netz offen. Das darf nicht
      // still passieren.
      mount.appendChild(el('div', { class: 'card ew-warnung' }, [
        el('strong', {}, 'Keine PIN vergeben. '),
        el('span', {}, 'Die Einwohnerdaten sind derzeit für jeden im Netz abrufbar. '),
        el('a', { href: '#/einstellungen?kategorie=einwohner' }, 'Jetzt PIN setzen'),
      ]));
    }
    await bauen(mount);
  }

  function pinAbfrage(mount, weiter) {
    const feld = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: 'PIN' });
    const meldung = el('p', { class: 'warn', style: 'display:none' });
    const absenden = async () => {
      meldung.style.display = 'none';
      try {
        await GR.api.einwohnerAnmelden(feld.value);
        mount.innerHTML = '';
        weiter();
      } catch (e) {
        meldung.textContent = e.message || 'PIN falsch.';
        meldung.style.display = '';
        feld.value = '';
        feld.focus();
      }
    };
    mount.appendChild(el('div', { class: 'card ew-pin' }, [
      el('h2', {}, '🔒 Einwohner'),
      el('p', { class: 'help' }, 'Die Einwohnerdaten sind gesondert geschützt. Ohne PIN gibt der Server sie nicht heraus — auch nicht an diese Seite.'),
      el('div', { class: 'ew-pin-row' }, [
        feld,
        el('button', { class: 'btn-primary', onClick: absenden }, 'Entsperren'),
      ]),
      meldung,
      el('p', { class: 'help' }, 'Die Freigabe gilt für dieses Browserfenster und endet spätestens nach acht Stunden.'),
    ]));
    feld.addEventListener('keydown', ev => { if (ev.key === 'Enter') absenden(); });
    setTimeout(() => feld.focus(), 50);
  }

  // Einheitliche Fehlerbehandlung: ein abgelaufener Token führt zurück zur
  // PIN-Abfrage, alles andere wird gemeldet.
  function fehler(mount, e) {
    if (e && e.gesperrt) {
      mount.innerHTML = '';
      pinAbfrage(mount, () => renderEinwohner(mount, {}));
      return;
    }
    toast(e && e.message ? e.message : String(e));
  }

  // ===========================================================================
  // Einstieg
  // ===========================================================================
  function renderEinwohner(mount, params) {
    params = params || {};
    if (params.reiter) ui.reiter = params.reiter;
    mount.innerHTML = '';
    mitGate(mount, async (ziel) => {
      ziel.appendChild(el('div', { class: 'toolbar' }, [
        el('h2', { style: 'margin:0' }, 'Einwohner'),
        el('div', { class: 'spacer' }),
        el('button', {
          onClick: async () => { await GR.api.einwohnerAbmelden(); toast('Gesperrt.'); renderEinwohner(mount, {}); },
          title: 'Zugriff in diesem Fenster sofort beenden',
        }, '🔒 Sperren'),
        el('button', { onClick: () => location.hash = '#/einstellungen?kategorie=einwohner' }, 'Einstellungen'),
      ]));

      const reiter = el('div', { class: 'doc-tabs ew-tabs' });
      const inhalt = el('div', {});
      const setze = (name) => {
        ui.reiter = name;
        for (const b of reiter.querySelectorAll('button')) {
          b.classList.toggle('is-active', b.dataset.reiter === name);
        }
        inhalt.innerHTML = '';
        if (name === 'ehrungen') ehrungenAnsicht(inhalt, mount);
        else if (name === 'abgleich') abgleichAnsicht(inhalt, mount);
        else listenAnsicht(inhalt, mount);
      };
      for (const [name, label] of [['liste', 'Einwohner'], ['ehrungen', 'Ehrungen'], ['abgleich', 'Abgleich']]) {
        reiter.appendChild(el('button', { 'data-reiter': name, onClick: () => setze(name) }, label));
      }
      ziel.appendChild(reiter);
      ziel.appendChild(inhalt);
      setze(ui.reiter);
    });
  }

  // ===========================================================================
  // Reiter 1: Liste
  // ===========================================================================
  async function listenAnsicht(ziel, mount) {
    const suchfeld = el('input', { type: 'search', placeholder: 'Name, Straße oder Ort …', value: ui.suche });
    const tabelle = el('div', {});
    const zaehler = el('span', { class: 'help' });

    const laden = async (frisch) => {
      tabelle.innerHTML = '';
      tabelle.appendChild(el('p', { class: 'help' }, 'Wird geladen …'));
      try {
        const liste = await GR.api.listEinwohner({ q: ui.suche, frisch: !!frisch });
        ui.letzteListe = liste;
        tabelle.innerHTML = '';
        zaehler.textContent = ui.suche
          ? `${liste.length} Treffer`
          : `${liste.length} Einwohner`;
        tabelle.appendChild(bauTabelle(liste, mount, () => laden(true)));
      } catch (e) {
        tabelle.innerHTML = '';
        fehler(mount, e);
        if (!(e && e.gesperrt)) tabelle.appendChild(el('p', { class: 'warn' }, e.message || String(e)));
      }
    };

    let tippTimer = null;
    suchfeld.addEventListener('input', () => {
      ui.suche = suchfeld.value;
      clearTimeout(tippTimer);
      tippTimer = setTimeout(() => laden(false), 250);
    });

    ziel.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { class: 'btn-primary', onClick: () => bearbeiten(mount, null, () => laden(true)) }, '+ Neuer Einwohner'),
      suchfeld,
      el('div', { class: 'spacer' }),
      zaehler,
      el('button', { onClick: () => laden(true), title: 'Aus NocoDB neu laden' }, '↻'),
    ]));
    ziel.appendChild(tabelle);
    await laden(false);
  }

  function bauTabelle(liste, mount, neuLaden) {
    if (!liste.length) {
      return el('p', { class: 'help' }, 'Keine Einträge.');
    }
    const zeilen = liste.map(e => el('tr', { class: 'ew-row', onClick: () => bearbeiten(mount, e, neuLaden) }, [
      el('td', {}, e.nachname || '—'),
      el('td', {}, e.vorname || ''),
      el('td', {}, anschrift(e) || '—'),
      el('td', {}, e.wohnort || ''),
      el('td', {}, datumDe(e.geburtsdatum) || '—'),
      el('td', {}, alterAm(e.geburtsdatum) == null ? '' : String(alterAm(e.geburtsdatum))),
      el('td', { class: 'ew-wohnungsart' }, e.wohnungsart || ''),
    ]));
    return el('div', { class: 'ew-tabelle-wrap' }, [
      el('table', { class: 'ew-tabelle' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Name'), el('th', {}, 'Vorname'), el('th', {}, 'Anschrift'),
          el('th', {}, 'Ort'), el('th', {}, 'Geburtsdatum'), el('th', {}, 'Alter'),
          el('th', {}, 'Wohnungsart'),
        ])),
        el('tbody', {}, zeilen),
      ]),
    ]);
  }

  // --- Anlegen / Bearbeiten -------------------------------------------------
  // opts.vorbelegung  Felder für einen NEUEN Eintrag vorbelegen (der Assistent
  //                   setzt so die Straße, in der man gerade steht) — der
  //                   Eintrag gilt trotzdem als neu.
  // opts.ueberWiz     über dem Vollbild-Assistenten anzeigen. Ohne das läge der
  //                   Dialog HINTER ihm: .modal-overlay hat z-index 1000,
  //                   .wiz-overlay 1100.
  // `fertig` bekommt jetzt mit, was passiert ist ({ gespeichert, geloescht }).
  // Die übrigen Aufrufer ignorieren das Argument und bleiben unverändert.
  function bearbeiten(mount, e, fertig, opts = {}) {
    const neu = !e;
    const daten = Object.assign({
      id: '', nachname: '', vorname: '', geburtsdatum: '', wohnungsart: '',
      wohnort: einstellungen().standardWohnort || GR.store.getSettings().ortsname || '',
      strasse: '', hausnummer: '', zusatz: '',
    }, e || {}, neu ? (opts.vorbelegung || {}) : {});

    const overlay = el('div', { class: 'modal-overlay' + (opts.ueberWiz ? ' modal-ueber-wiz' : '') });
    const schliessen = () => overlay.remove();

    const feld = (label, key, opts = {}) => {
      const input = el('input', Object.assign({
        type: opts.type || 'text',
        value: daten[key] || '',
        onInput: (ev) => { daten[key] = ev.target.value; },
      }, opts.attrs || {}));
      return el('div', { class: 'ew-feld' }, [el('label', {}, label), input]);
    };

    const koerper = el('div', { class: 'ew-form' }, [
      feld('Name (Nachname)', 'nachname'),
      feld('Rufname (Vorname)', 'vorname'),
      feld('Geburtsdatum', 'geburtsdatum', { type: 'date' }),
      feld('Wohnungsart', 'wohnungsart'),
      feld('Straße', 'strasse'),
      feld('Hausnummer', 'hausnummer'),
      feld('Zusatz', 'zusatz'),
      feld('Wohnort', 'wohnort'),
    ]);

    const speichern = async () => {
      try {
        const ergebnis = neu
          ? await GR.api.anlegenEinwohner(daten)
          : await GR.api.speichernEinwohner(daten.id, daten);
        toast(neu ? 'Angelegt.' : 'Gespeichert.');
        schliessen();
        fertig({ gespeichert: true, neu, eintrag: ergebnis || daten });
      } catch (err) { fehler(mount, err); }
    };

    const loeschen = async () => {
      const ok = confirmDialog(
        `${vollerName(daten) || 'Diesen Eintrag'} wirklich aus der Einwohnerliste löschen?\n\n`
        + 'Der Datensatz wird in NocoDB entfernt. Bereits vergebene Ehrungen bleiben in der Historie erhalten.',
      );
      if (!ok) return;
      try {
        await GR.api.loeschenEinwohner(daten.id);
        toast('Gelöscht.');
        schliessen();
        fertig({ geloescht: true, eintrag: daten });
      } catch (err) { fehler(mount, err); }
    };

    const fusszeile = el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
      el('button', { class: 'btn-primary', onClick: speichern }, 'Speichern'),
      el('button', { onClick: schliessen }, 'Abbrechen'),
      el('div', { class: 'spacer' }),
      neu ? null : el('button', { class: 'btn-danger', onClick: loeschen }, 'Löschen'),
    ].filter(Boolean));

    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h3', {}, neu ? 'Neuer Einwohner' : vollerName(daten) || 'Einwohner'),
      koerper,
      neu ? null : el('p', { class: 'help' }, jubilaeumsHinweis(daten)),
      fusszeile,
    ].filter(Boolean)));
    document.body.appendChild(overlay);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) schliessen(); });
  }

  function jubilaeumsHinweis(e) {
    if (!e.geburtsdatum) return 'Ohne Geburtsdatum kann kein Jubiläum berechnet werden.';
    const a = alterAm(e.geburtsdatum);
    const naechstes = [80, 90, 95, 100].find(x => x > a);
    if (!naechstes) return `Aktuell ${a} Jahre — alle vorgesehenen Jubiläen liegen zurück.`;
    return `Aktuell ${a} Jahre — nächstes Jubiläum: ${naechstes}. Geburtstag.`;
  }

  // ===========================================================================
  // Reiter 2: Ehrungen
  // ===========================================================================
  async function ehrungenAnsicht(ziel, mount) {
    const inhalt = el('div', {});
    const zeitraum = el('select', {}, [
      el('option', { value: '12' }, 'Nächste 12 Monate'),
      el('option', { value: '3' }, 'Nächste 3 Monate'),
      el('option', { value: '24' }, 'Nächste 24 Monate'),
    ]);

    const laden = async () => {
      inhalt.innerHTML = '';
      inhalt.appendChild(el('p', { class: 'help' }, 'Wird geladen …'));
      try {
        const monate = Number(zeitraum.value) || 12;
        const von = heute();
        const bis = plusMonate(von, monate);
        const [anstehend, historie] = await Promise.all([
          GR.api.listEhrungen({ von, bis }),
          GR.api.listEhrungsHistorie(),
        ]);
        inhalt.innerHTML = '';
        inhalt.appendChild(bauEhrungen(anstehend, historie, mount, laden));
      } catch (e) {
        inhalt.innerHTML = '';
        fehler(mount, e);
        if (!(e && e.gesperrt)) inhalt.appendChild(el('p', { class: 'warn' }, e.message || String(e)));
      }
    };
    zeitraum.addEventListener('change', laden);

    ziel.appendChild(el('div', { class: 'toolbar' }, [
      zeitraum,
      el('div', { class: 'spacer' }),
      el('button', {
        title: 'Den täglichen Lauf sofort ausführen — legt fällige Aufgaben an und gleicht abgehakte ab',
        onClick: async (ev) => {
          const b = ev.target;
          b.disabled = true; b.textContent = 'Prüfe …';
          try {
            const bericht = await GR.api.jubilaeumslaufJetzt();
            toast(laufBericht(bericht));
            await laden();
          } catch (e) { fehler(mount, e); }
          b.disabled = false; b.textContent = '↻ Jetzt prüfen';
        },
      }, '↻ Jetzt prüfen'),
    ]));
    ziel.appendChild(el('p', { class: 'help' }, 'Geehrt wird zur Vollendung des 80., 90., 95. und 100. Lebensjahres. Einen Monat vorher legt der Server von selbst eine Aufgabe an.'));
    ziel.appendChild(inhalt);
    await laden();
  }

  function laufBericht(b) {
    if (!b) return 'Kein Bericht.';
    if (b.uebersprungen) return b.uebersprungen;
    const teile = [];
    if (b.aufgabenAngelegt) teile.push(`${b.aufgabenAngelegt} Aufgabe(n) angelegt`);
    if (b.ehrungenErledigt) teile.push(`${b.ehrungenErledigt} als überreicht gebucht`);
    if (b.aufgabenGeschlossen) teile.push(`${b.aufgabenGeschlossen} Aufgabe(n) geschlossen`);
    if (b.fehler && b.fehler.length) teile.push(`${b.fehler.length} Fehler`);
    return teile.length ? teile.join(', ') : `${b.geprueft || 0} geprüft, nichts zu tun.`;
  }

  function plusMonate(iso, monate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    const ziel = new Date(Number(m[1]), Number(m[2]) - 1 + Number(monate), 1);
    const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
    ziel.setDate(Math.min(Number(m[3]), letzter));
    return `${ziel.getFullYear()}-${String(ziel.getMonth() + 1).padStart(2, '0')}-${String(ziel.getDate()).padStart(2, '0')}`;
  }

  function bauEhrungen(anstehend, historie, mount, neuLaden) {
    const wrap = el('div', {});

    if (!anstehend.length) {
      wrap.appendChild(el('p', { class: 'help' }, 'In diesem Zeitraum steht keine Ehrung an.'));
    } else {
      wrap.appendChild(el('div', { class: 'ew-ehrungen' },
        anstehend.map(eh => ehrungsKarte(eh, mount, neuLaden))));
    }

    // Historie: alles, was jemals gebucht wurde — auch zu Personen, die
    // inzwischen weggezogen sind. Deshalb nicht aus `anstehend` ableitbar.
    const erledigt = (historie || []).filter(h => h.status === 'ueberreicht');
    if (erledigt.length) {
      const liste = el('div', { class: 'ew-historie', hidden: true },
        erledigt.map(h => el('div', { class: 'ew-hist-zeile' }, [
          el('strong', {}, `${h.alter}. Geburtstag`),
          el('span', {}, [h.vorname, h.nachname].filter(Boolean).join(' ') || '—'),
          el('span', { class: 'help' }, datumDe(h.datum)),
          el('span', { class: 'help' }, h.ueberreichtAm ? `überreicht ${datumDe(h.ueberreichtAm)}` : ''),
          h.notiz ? el('span', { class: 'ew-hist-notiz' }, h.notiz) : null,
        ].filter(Boolean))));
      const knopf = el('button', { class: 'ew-klapp', onClick: () => {
        liste.hidden = !liste.hidden;
        knopf.textContent = (liste.hidden ? '▸' : '▾') + ` Bereits überreicht (${erledigt.length})`;
      } }, `▸ Bereits überreicht (${erledigt.length})`);
      wrap.appendChild(knopf);
      wrap.appendChild(liste);
    }
    return wrap;
  }

  const STATUS_LABEL = { offen: 'Offen', urkunde: 'Urkunde erstellt', ueberreicht: 'Überreicht' };

  function ehrungsKarte(eh, mount, neuLaden) {
    const speichern = async (patch) => {
      try {
        await GR.api.speichernEhrung(eh.id, Object.assign({
          einwohnerId: eh.einwohnerId, alter: eh.alter, datum: eh.datum,
          nachname: eh.nachname, vorname: eh.vorname,
        }, patch));
        await neuLaden();
      } catch (e) { fehler(mount, e); }
    };

    const status = el('select', { onChange: (ev) => speichern({ status: ev.target.value }) },
      Object.keys(STATUS_LABEL).map(k => el('option', {
        value: k, selected: eh.status === k,
      }, STATUS_LABEL[k])));

    const notiz = el('input', {
      type: 'text', value: eh.notiz || '', placeholder: 'Notiz (z. B. Besuch am 3.5., Blumen mitgebracht)',
      onChange: (ev) => speichern({ notiz: ev.target.value }),
    });

    const frist = eh.tageBis == null ? ''
      : eh.tageBis < 0 ? `vor ${Math.abs(eh.tageBis)} Tagen`
        : eh.tageBis === 0 ? 'heute'
          : `in ${eh.tageBis} Tagen`;
    // Die Ampel folgt der eingestellten Vorlauffrist, nicht einer festen
    // Tageszahl — sonst zeigte die Liste „bald fällig" an, während der
    // Tageslauf noch gar nichts tut (oder umgekehrt).
    const bisWann = plusMonate(heute(), vorlaufMonate());
    const klasse = eh.status === 'ueberreicht' ? 'ok'
      : (eh.tageBis != null && eh.tageBis < 0) ? 'warn'
        : (eh.datum && eh.datum <= bisWann) ? 'prep' : '';

    return el('div', { class: 'card ew-ehrung' }, [
      el('div', { class: 'ew-ehrung-kopf' }, [
        el('span', { class: 'ew-alter' }, String(eh.alter)),
        el('div', {}, [
          el('strong', {}, [eh.vorname, eh.nachname].filter(Boolean).join(' ') || '—'),
          el('div', { class: 'help' }, `${eh.alter}. Geburtstag am ${datumDe(eh.datum)}`),
          anschrift(eh) ? el('div', { class: 'help' }, anschrift(eh) + (eh.wohnort ? ', ' + eh.wohnort : '')) : null,
        ].filter(Boolean)),
        el('div', { class: 'spacer' }),
        frist ? el('span', { class: 'tag ' + klasse }, frist) : null,
      ].filter(Boolean)),
      el('div', { class: 'ew-ehrung-zeile' }, [
        el('label', {}, 'Status'), status,
        el('div', { class: 'spacer' }),
        el('button', { onClick: () => urkundeErzeugen(eh, mount, neuLaden) }, '📄 Urkunde'),
      ]),
      notiz,
      eh.aufgabeId ? el('p', { class: 'help' }, `Aufgabe im Aufgabenmodul angelegt (Nr. ${eh.aufgabeId}).`) : null,
    ].filter(Boolean));
  }

  // --- Urkunde --------------------------------------------------------------
  // Vor dem Erzeugen wird die Anrede gewählt: im Dorf duzt man den einen und
  // siezt den anderen, und beides steht als Vorlage in den Einstellungen.
  function urkundeErzeugen(eh, mount, neuLaden) {
    const s = einstellungen();
    const overlay = el('div', { class: 'modal-overlay' });
    const schliessen = () => overlay.remove();
    let anrede = s.urkundeAnrede === 'sie' ? 'sie' : 'du';

    const wahl = el('div', { class: 'ew-anrede' });
    const bauWahl = () => {
      wahl.innerHTML = '';
      for (const [wert, label] of [['du', 'Du-Form'], ['sie', 'Sie-Form']]) {
        wahl.appendChild(el('button', {
          class: anrede === wert ? 'is-active' : '',
          onClick: () => { anrede = wert; bauWahl(); vorschau(); },
        }, label));
      }
    };
    const text = el('p', { class: 'ew-vorschau' });
    const vorschau = () => {
      const vorlage = anrede === 'sie' ? s.urkundeTextSie : s.urkundeTextDu;
      text.textContent = GR.urkundePdf.fuelle(vorlage, eh, GR.store.getSettings());
    };
    bauWahl();
    vorschau();

    const erzeugen = async (ziel) => {
      await GR.urkundePdf.buildUrkunde(eh, { anrede, target: ziel });
      schliessen();
    };

    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h3', {}, `Urkunde — ${eh.alter}. Geburtstag`),
      el('p', { class: 'help' }, [eh.vorname, eh.nachname].filter(Boolean).join(' ') + ' · ' + datumDe(eh.datum)),
      el('label', {}, 'Anrede'), wahl,
      text,
      el('p', { class: 'help' }, 'Die Unterschriftszeilen bleiben leer — Ehrungen werden persönlich unterschrieben.'),
      el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('div', { class: 'spacer' }),
        el('button', { onClick: schliessen }, 'Abbrechen'),
        el('button', { class: 'btn-primary', onClick: async () => {
          try {
            await erzeugen('download');
          } catch (e) {
            toast('Die Urkunde konnte nicht erzeugt werden: ' + (e.message || e));
            return;
          }
          // Der Druck ist der Beleg dafür, dass die Urkunde vorbereitet ist.
          // Scheitert nur das Buchen, bleibt das PDF trotzdem erzeugt.
          if (eh.status === 'offen') {
            try {
              await GR.api.speichernEhrung(eh.id, {
                einwohnerId: eh.einwohnerId, alter: eh.alter, datum: eh.datum,
                nachname: eh.nachname, vorname: eh.vorname, status: 'urkunde',
              });
              await neuLaden();
            } catch (_) { /* nicht schlimm — der Status lässt sich von Hand setzen */ }
          }
        } }, '📄 Erzeugen und drucken'),
      ]),
    ]));
    document.body.appendChild(overlay);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) schliessen(); });
  }

  // ===========================================================================
  // Reiter 3: Abgleich
  // ===========================================================================
  // Die Verbandsgemeinde schickt die Liste einmal im Jahr auf PAPIER, sortiert
  // nach Straße, Hausnummer, Nachname, Vorname. Es gibt deshalb keinen
  // Datei-Import, sondern zwei Wege, die dieselbe Reihenfolge benutzen:
  //
  //   * den Abgleichsassistenten — die Liste steht am Bildschirm, das Papier
  //     daneben, und jede Zeile wird direkt abgehakt oder geändert;
  //   * die Prüfliste als PDF — für alle, die lieber mit dem Stift arbeiten,
  //     und als Rückfallebene, wenn der Rechner nicht dort steht, wo gearbeitet
  //     wird.
  //
  // Der Stand des Assistenten liegt auf dem Server (backend/abgleich.js) und
  // übersteht deshalb das Schließen des Fensters. Ein Abgleich über mehrere
  // hundert Einwohner läuft über Tage.
  async function abgleichAnsicht(ziel, mount) {
    const s = einstellungen();
    const kopf = el('div', { class: 'card' });
    ziel.appendChild(kopf);

    const neuZeichnen = () => { ziel.innerHTML = ''; abgleichAnsicht(ziel, mount); };

    let stand = null;
    try {
      stand = await GR.api.abgleichStand();
    } catch (e) {
      fehler(mount, e);
      if (!(e && e.gesperrt)) kopf.appendChild(el('p', { class: 'warn' }, e.message || String(e)));
      return;
    }
    const lauf = stand && stand.lauf;
    const erledigt = Object.keys((stand && stand.marken) || {}).length;

    kopf.appendChild(el('h3', {}, 'Abgleich mit der Liste der Verbandsgemeinde'));
    kopf.appendChild(el('p', {}, 'Die Reihenfolge ist dieselbe wie auf dem Papier: Straße, Hausnummer, dann Name und Vorname. Im Assistenten stehen die Einwohner straßenweise am Bildschirm — abhaken, ändern oder Zugezogene gleich anlegen.'));

    if (lauf) {
      kopf.appendChild(el('p', { class: 'ab-hinweis' }, [
        el('strong', {}, 'Ein Abgleich läuft. '),
        el('span', {}, `Begonnen am ${datumDe(lauf.startAm)}, ${erledigt} Zeile(n) bereits durchgegangen.`),
      ]));
    } else if (s.letzterAbgleich) {
      kopf.appendChild(el('p', { class: 'help' }, `Zuletzt abgeglichen am ${datumDe(s.letzterAbgleich)}${s.letzterAbgleichAnzahl ? ` (${s.letzterAbgleichAnzahl} Einwohner)` : ''}.`));
    } else {
      kopf.appendChild(el('p', { class: 'help' }, 'Bisher kein Abgleich vermerkt.'));
    }

    kopf.appendChild(el('div', { class: 'toolbar' }, [
      el('button', {
        class: 'btn-primary',
        onClick: async () => {
          try {
            // Ein neuer Lauf leert den Merkzettel. Läuft schon einer, wird er
            // fortgesetzt statt neu begonnen — sonst wäre die Arbeit von
            // gestern mit einem Klick weg.
            if (!lauf) await GR.api.abgleichStarten();
            abgleichAssistent(mount, neuZeichnen);
          } catch (e) { fehler(mount, e); }
        },
      }, lauf ? `▶ Abgleich fortsetzen (${erledigt} erledigt)` : '▶ Abgleich starten'),
      lauf ? el('button', {
        title: 'Den laufenden Abgleich verwerfen — die Haken gehen verloren, die Einwohnerdaten bleiben unberührt',
        onClick: async () => {
          if (!confirmDialog('Den laufenden Abgleich verwerfen?\n\nAlle gesetzten Haken gehen verloren. An den Einwohnerdaten selbst ändert sich nichts.')) return;
          try { await GR.api.abgleichAbbrechen(); toast('Abgleich verworfen.'); neuZeichnen(); }
          catch (e) { fehler(mount, e); }
        },
      }, 'Verwerfen') : null,
    ].filter(Boolean)));

    // --- Papierweg: Prüfliste und reiner Vermerk ---
    ziel.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Auf Papier arbeiten'),
      el('p', { class: 'help' }, 'Die Prüfliste hat dieselbe Reihenfolge wie der Assistent und dieselbe wie die Amtsliste. Wer sie mit dem Stift abarbeitet, vermerkt den Abgleich hinterher von Hand.'),
      el('div', { class: 'toolbar' }, [
        el('button', {
          onClick: async () => {
            try {
              const liste = await GR.api.listEinwohner({ frisch: true });
              await GR.einwohnerPdf.buildPruefliste(liste, { target: 'download' });
            } catch (e) { fehler(mount, e); }
          },
        }, '📄 Prüfliste drucken'),
        el('button', {
          onClick: async () => {
            try {
              const liste = await GR.api.listEinwohner({ frisch: true });
              await GR.api.abgleichGebucht(liste.length);
              toast('Abgleich vermerkt.');
              neuZeichnen();
            } catch (e) { fehler(mount, e); }
          },
        }, '✓ Abgleich als erledigt vermerken'),
      ]),
    ]));
  }

  // ===========================================================================
  // Der Abgleichsassistent (Vollbild)
  // ===========================================================================
  // Eine Straße auf einmal, in Papierreihenfolge. Drei Schaltflächen je Zeile:
  //
  //   ✓  stimmt              →  'ok'
  //   ✎  ändern              →  öffnet den Bearbeiten-Dialog, danach 'geaendert'
  //   ✗  nicht auf der Liste →  'fehlt' (VORMERKUNG, gelöscht wird erst am Ende)
  //
  // Dass ✗ nicht sofort löscht, ist Absicht: ein Fingertipp darf niemanden aus
  // dem Melderegister werfen. Zum Abschluss werden alle Vormerkungen gesammelt
  // gezeigt und einzeln bestätigt.
  //
  // Jede Betätigung geht sofort an den Server. Wer das Fenster schließt, findet
  // den Stand beim nächsten Öffnen wieder vor.
  async function abgleichAssistent(mount, onFertig) {
    const z = { liste: [], marken: {}, strassen: [], aktiv: 0 };

    const fortschritt = el('div', { class: 'ab-fortschritt' });
    const strassenLeiste = el('div', { class: 'ab-strassen' });
    const koerper = el('div', { class: 'wiz-body' });
    const fuss = el('div', { class: 'wiz-foot' });
    const overlay = el('div', { class: 'wiz-overlay' });

    const schliessen = () => {
      document.removeEventListener('keydown', aufTaste);
      overlay.remove();
      if (onFertig) onFertig();
    };
    // Nur schließen, wenn kein Dialog darüber liegt — sonst nähme Escape dem
    // Bearbeiten-Dialog die Eingabe weg und schlösse den Assistenten gleich mit.
    const aufTaste = (ev) => {
      if (ev.key === 'Escape' && !document.querySelector('.modal-ueber-wiz')) schliessen();
    };
    document.addEventListener('keydown', aufTaste);

    overlay.appendChild(el('div', { class: 'wiz ab-wiz' }, [
      el('div', { class: 'wiz-head' }, [
        el('h3', {}, 'Abgleich mit der Papierliste'),
        fortschritt,
        el('button', { class: 'wiz-close', title: 'Schließen — der Stand bleibt gespeichert', onClick: schliessen }, '×'),
      ]),
      strassenLeiste,
      koerper,
      fuss,
    ]));
    document.body.appendChild(overlay);

    const statusVon = (id) => (z.marken[id] && z.marken[id].status) || '';
    const istDurch = (id) => !!statusVon(id);

    // Gruppierung, die die Reihenfolge der Liste übernimmt — die kommt bereits
    // amtlich sortiert aus dem Backend und darf hier nicht neu sortiert werden.
    function gruppieren(liste) {
      const gruppen = [];
      let letzte = null;
      for (const e of liste) {
        const name = e.strasse || '';
        if (!letzte || letzte.name !== name) {
          letzte = { name, personen: [] };
          gruppen.push(letzte);
        }
        letzte.personen.push(e);
      }
      return gruppen;
    }

    async function laden(ersterAufruf) {
      koerper.innerHTML = '';
      koerper.appendChild(el('p', { class: 'help' }, 'Wird geladen …'));
      try {
        const [liste, stand] = await Promise.all([
          GR.api.listEinwohner({ frisch: true }),
          GR.api.abgleichStand(),
        ]);
        z.liste = liste;
        z.marken = (stand && stand.marken) || {};
        const vorher = z.strassen[z.aktiv] ? z.strassen[z.aktiv].name : null;
        z.strassen = gruppieren(liste);
        // Nach dem Neuladen dieselbe Straße wiederfinden — die Reihenfolge kann
        // sich verschoben haben, wenn jemand angelegt oder umgezogen wurde.
        if (vorher != null) {
          const i = z.strassen.findIndex(g => g.name === vorher);
          z.aktiv = i >= 0 ? i : Math.min(z.aktiv, Math.max(0, z.strassen.length - 1));
        }
        if (ersterAufruf) {
          // Da weitermachen, wo noch etwas offen ist.
          const i = z.strassen.findIndex(g => g.personen.some(e => !istDurch(e.id)));
          z.aktiv = i >= 0 ? i : 0;
        }
        zeichnen();
      } catch (e) {
        koerper.innerHTML = '';
        if (e && e.gesperrt) { schliessen(); fehler(mount, e); return; }
        koerper.appendChild(el('p', { class: 'warn' }, e.message || String(e)));
      }
    }

    // --- Zeichnen -----------------------------------------------------------
    function zeichnen() {
      const gesamt = z.liste.length;
      const durch = z.liste.filter(e => istDurch(e.id)).length;
      const offen = gesamt - durch;

      fortschritt.innerHTML = '';
      fortschritt.appendChild(el('div', { class: 'ab-balken' }, [
        el('div', { class: 'ab-balken-fuell', style: `width:${gesamt ? Math.round(durch / gesamt * 100) : 0}%` }),
      ]));
      fortschritt.appendChild(el('span', { class: 'ab-zahl' }, `${durch} von ${gesamt} durchgegangen`));

      strassenLeiste.innerHTML = '';
      z.strassen.forEach((g, i) => {
        const fertig = g.personen.every(e => istDurch(e.id));
        const anzahl = g.personen.filter(e => istDurch(e.id)).length;
        strassenLeiste.appendChild(el('button', {
          class: 'ab-chip' + (i === z.aktiv ? ' is-active' : '') + (fertig ? ' is-fertig' : ''),
          onClick: () => { z.aktiv = i; zeichnen(); },
        }, [
          el('span', {}, g.name || '(ohne Straßenangabe)'),
          el('span', { class: 'ab-chip-zahl' }, fertig ? '✓' : `${anzahl}/${g.personen.length}`),
        ]));
      });

      koerper.innerHTML = '';
      const gruppe = z.strassen[z.aktiv];
      if (!gruppe) {
        koerper.appendChild(el('p', { class: 'help' }, 'Keine Einwohner erfasst.'));
      } else {
        koerper.appendChild(el('h4', { class: 'ab-strassen-titel' }, gruppe.name || '(ohne Straßenangabe)'));
        koerper.appendChild(el('p', { class: 'help' }, 'Zeile für Zeile mit dem Papier vergleichen. Nach einem Haken springt die Auswahl von selbst zur nächsten offenen Zeile.'));
        koerper.appendChild(el('div', { class: 'ab-zeilen' }, gruppe.personen.map(zeileBauen)));
      }

      fussBauen(offen);
    }

    function zeileBauen(e) {
      const status = statusVon(e.id);
      const knopf = (zeichen, wert, titel, klasse) => el('button', {
        class: 'ab-knopf ' + klasse + (status === wert ? ' is-an' : ''),
        title: titel,
        onClick: () => (wert === 'geaendert' ? aendern(e) : umschalten(e, wert)),
      }, zeichen);

      return el('div', { class: 'ab-zeile' + (status ? ' status-' + status : ''), 'data-id': e.id }, [
        el('span', { class: 'ab-hn' }, [e.hausnummer, e.zusatz].filter(Boolean).join('') || '—'),
        el('span', { class: 'ab-name' }, [
          el('strong', {}, e.nachname || '—'),
          el('span', {}, e.vorname ? ', ' + e.vorname : ''),
        ]),
        el('span', { class: 'ab-geb' }, datumDe(e.geburtsdatum) || '— kein Geburtsdatum —'),
        el('span', { class: 'ab-art' }, e.wohnungsart || ''),
        el('div', { class: 'ab-aktionen' }, [
          knopf('✓', 'ok', 'Stimmt so', 'ab-ok'),
          knopf('✎', 'geaendert', 'Ändern — Umzug, Schreibfehler, Geburtsdatum', 'ab-aendern'),
          knopf('✗', 'fehlt', 'Steht nicht auf der Papierliste — zum Löschen vormerken', 'ab-fehlt'),
        ]),
      ]);
    }

    function fussBauen(offen) {
      fuss.innerHTML = '';
      const gruppe = z.strassen[z.aktiv];
      fuss.appendChild(el('button', {
        onClick: () => bearbeiten(mount, null, async (erg) => {
          // Wer während des Laufs zuzieht, ist damit auch gleich abgeglichen.
          if (erg && erg.gespeichert && erg.eintrag && erg.eintrag.id) {
            try { await GR.api.abgleichMarke(erg.eintrag.id, 'neu'); } catch (_) {}
          }
          await laden(false);
        }, {
          ueberWiz: true,
          vorbelegung: gruppe ? { strasse: gruppe.name } : {},
        }),
      }, '+ Zugezogenen anlegen'));

      fuss.appendChild(el('span', { class: 'wiz-status' },
        offen ? `${offen} Zeile(n) noch offen` : 'Alle Zeilen durchgegangen'));

      fuss.appendChild(el('div', { class: 'spacer' }));

      fuss.appendChild(el('button', {
        disabled: z.aktiv <= 0,
        onClick: () => { z.aktiv = Math.max(0, z.aktiv - 1); zeichnen(); },
      }, '← Zurück'));
      fuss.appendChild(el('button', {
        disabled: z.aktiv >= z.strassen.length - 1,
        onClick: () => { z.aktiv = Math.min(z.strassen.length - 1, z.aktiv + 1); zeichnen(); },
      }, 'Nächste Straße →'));
      fuss.appendChild(el('button', { class: 'btn-primary', onClick: abschluss }, 'Abgleich abschließen'));
    }

    // --- Haken setzen -------------------------------------------------------
    async function umschalten(e, wert) {
      // Dieselbe Schaltfläche noch einmal nimmt den Haken zurück.
      const ziel = statusVon(e.id) === wert ? '' : wert;
      try {
        await GR.api.abgleichMarke(e.id, ziel);
        if (ziel) z.marken[e.id] = { status: ziel, am: new Date().toISOString() };
        else delete z.marken[e.id];
        zeichnen();
        if (ziel) weiterZurNaechsten(e.id);
      } catch (err) {
        if (err && err.gesperrt) schliessen();
        fehler(mount, err);
      }
    }

    function aendern(e) {
      bearbeiten(mount, e, async (erg) => {
        if (erg && erg.gespeichert) {
          try { await GR.api.abgleichMarke(e.id, 'geaendert'); } catch (_) {}
        } else if (erg && erg.geloescht) {
          // Wer hier gelöscht wird, ist weg — die Marke wäre eine Karteileiche.
          try { await GR.api.abgleichMarke(e.id, ''); } catch (_) {}
        }
        await laden(false);
      }, { ueberWiz: true });
    }

    // Nach einem Haken den Finger auf die nächste offene Zeile derselben Straße
    // legen. Damit lässt sich die Liste mit Enter durchklappern, ohne dass die
    // Hand zur Maus muss.
    function weiterZurNaechsten(idAktuell) {
      const gruppe = z.strassen[z.aktiv];
      if (!gruppe) return;
      const i = gruppe.personen.findIndex(p => p.id === idAktuell);
      const naechste = gruppe.personen.slice(i + 1).find(p => !istDurch(p.id))
        || gruppe.personen.find(p => !istDurch(p.id));
      if (!naechste) return;
      const zeilen = koerper.querySelectorAll('.ab-zeile');
      for (const zeile of zeilen) {
        if (zeile.getAttribute('data-id') === String(naechste.id)) {
          const knopf = zeile.querySelector('.ab-ok');
          if (knopf) knopf.focus();
          return;
        }
      }
    }

    // --- Abschluss ----------------------------------------------------------
    // Hier und nur hier wird gelöscht. Die Vormerkungen stehen einzeln zur
    // Bestätigung; abgewählt bleibt die Person unverändert stehen.
    function abschluss() {
      const vorgemerkt = z.liste.filter(e => statusVon(e.id) === 'fehlt');
      const offen = z.liste.filter(e => !istDurch(e.id)).length;
      const auswahl = new Set(vorgemerkt.map(e => e.id));

      const modal = el('div', { class: 'modal-overlay modal-ueber-wiz' });
      const zu = () => modal.remove();

      const liste = el('div', { class: 'ab-abschluss-liste' }, vorgemerkt.map(e => el('label', { class: 'ab-abschluss-zeile' }, [
        el('input', {
          type: 'checkbox',
          checked: true,
          onChange: (ev) => { if (ev.target.checked) auswahl.add(e.id); else auswahl.delete(e.id); },
        }),
        el('span', {}, [
          el('strong', {}, e.nachname || '—'),
          el('span', {}, e.vorname ? ', ' + e.vorname : ''),
          el('span', { class: 'help' }, ' · ' + (anschrift(e) || 'ohne Anschrift')
            + (e.geburtsdatum ? ' · ' + datumDe(e.geburtsdatum) : '')),
        ]),
      ])));

      const melden = el('p', { class: 'help' });

      const durchfuehren = async (ev) => {
        const knopf = ev.target;
        const zuLoeschen = vorgemerkt.filter(e => auswahl.has(e.id));
        const text = zuLoeschen.length
          ? `${zuLoeschen.length} Person(en) endgültig aus der Einwohnerliste löschen und den Abgleich abschließen?\n\nDie Datensätze werden in NocoDB entfernt. Bereits vergebene Ehrungen bleiben in der Historie erhalten.`
          : 'Abgleich abschließen? Es wird niemand gelöscht.';
        if (!confirmDialog(text)) return;
        knopf.disabled = true;
        let fehlgeschlagen = 0;
        for (const e of zuLoeschen) {
          melden.textContent = `Lösche ${vollerName(e) || e.id} …`;
          try { await GR.api.loeschenEinwohner(e.id); }
          catch (_) { fehlgeschlagen++; }
        }
        try {
          await GR.api.abgleichAbschluss(z.liste.length - (zuLoeschen.length - fehlgeschlagen));
        } catch (err) {
          knopf.disabled = false;
          fehler(mount, err);
          return;
        }
        zu();
        toast(fehlgeschlagen
          ? `Abgleich abgeschlossen — ${fehlgeschlagen} Löschung(en) sind fehlgeschlagen.`
          : 'Abgleich abgeschlossen.', fehlgeschlagen ? 6000 : 3000);
        schliessen();
      };

      modal.appendChild(el('div', { class: 'modal modal-breit' }, [
        el('h3', {}, 'Abgleich abschließen'),
        offen
          ? el('p', { class: 'warn' }, `${offen} Zeile(n) sind noch nicht durchgegangen. Abschließen geht trotzdem — der Merkzettel wird dabei geleert.`)
          : el('p', { class: 'help' }, 'Alle Zeilen sind durchgegangen.'),
        vorgemerkt.length
          ? el('div', {}, [
            el('p', {}, [
              el('strong', {}, `${vorgemerkt.length} Person(en) stehen nicht mehr auf der Papierliste. `),
              el('span', {}, 'Angehakt wird gelöscht — wer abgewählt bleibt, bleibt in der Liste stehen.'),
            ]),
            liste,
          ])
          : el('p', { class: 'help' }, 'Es ist niemand zum Löschen vorgemerkt.'),
        melden,
        el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
          el('button', { class: 'btn-primary', onClick: durchfuehren }, 'Abschließen'),
          el('button', { onClick: zu }, 'Zurück zum Abgleich'),
        ]),
      ]));
      document.body.appendChild(modal);
      modal.addEventListener('click', ev => { if (ev.target === modal) zu(); });
    }

    await laden(true);
  }

  GR.views = GR.views || {};
  GR.views.renderEinwohner = renderEinwohner;
})();
