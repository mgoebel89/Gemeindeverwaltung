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
  function bearbeiten(mount, e, fertig) {
    const neu = !e;
    const daten = Object.assign({
      id: '', nachname: '', vorname: '', geburtsdatum: '', wohnungsart: '',
      wohnort: einstellungen().standardWohnort || GR.store.getSettings().ortsname || '',
      strasse: '', hausnummer: '', zusatz: '',
    }, e || {});

    const overlay = el('div', { class: 'modal-overlay' });
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
        if (neu) await GR.api.anlegenEinwohner(daten);
        else await GR.api.speichernEinwohner(daten.id, daten);
        toast(neu ? 'Angelegt.' : 'Gespeichert.');
        schliessen();
        fertig();
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
        fertig();
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
  // nach Straße, Nachname, Vorname. Deshalb gibt es hier keinen Datei-Import,
  // sondern eine Prüfliste in exakt derselben Sortierung — beide liegen dann
  // nebeneinander und werden Zeile für Zeile durchgegangen.
  async function abgleichAnsicht(ziel, mount) {
    const s = einstellungen();
    const inhalt = el('div', {});

    ziel.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Abgleich mit der Liste der Verbandsgemeinde'),
      el('p', {}, 'Die Prüfliste ist genauso sortiert wie die Papierliste: Straße, dann Nachname, dann Vorname. Ausdrucken, nebeneinanderlegen, durchgehen — Abweichungen anschließend hier eintragen.'),
      s.letzterAbgleich
        ? el('p', { class: 'help' }, `Zuletzt abgeglichen am ${datumDe(s.letzterAbgleich)}${s.letzterAbgleichAnzahl ? ` (${s.letzterAbgleichAnzahl} Einwohner)` : ''}.`)
        : el('p', { class: 'help' }, 'Bisher kein Abgleich vermerkt.'),
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn-primary', onClick: async () => {
          try {
            const liste = await GR.api.listEinwohner({ frisch: true });
            await GR.einwohnerPdf.buildPruefliste(liste, { target: 'download' });
          } catch (e) { fehler(mount, e); }
        } }, '📄 Prüfliste drucken'),
        el('button', { onClick: async () => {
          try {
            const liste = await GR.api.listEinwohner({ frisch: true });
            await GR.api.abgleichGebucht(liste.length);
            toast('Abgleich vermerkt.');
            ziel.innerHTML = '';
            abgleichAnsicht(ziel, mount);
          } catch (e) { fehler(mount, e); }
        } }, '✓ Abgleich als erledigt vermerken'),
      ]),
    ]));

    ziel.appendChild(el('div', { class: 'card' }, [
      el('h3', {}, 'Abweichungen eintragen'),
      el('p', { class: 'help' }, 'Zugezogene anlegen, Weggezogene löschen, Umzüge und Schreibfehler direkt in der Zeile ändern. Alles wird sofort in die NocoDB-Liste geschrieben.'),
      inhalt,
    ]));

    const suchfeld = el('input', { type: 'search', placeholder: 'Person suchen …' });
    const treffer = el('div', {});
    let tippTimer = null;
    suchfeld.addEventListener('input', () => {
      clearTimeout(tippTimer);
      tippTimer = setTimeout(async () => {
        treffer.innerHTML = '';
        if (!suchfeld.value.trim()) return;
        try {
          const liste = await GR.api.listEinwohner({ q: suchfeld.value });
          treffer.appendChild(bauTabelle(liste, mount, async () => {
            treffer.innerHTML = '';
            suchfeld.dispatchEvent(new Event('input'));
          }));
        } catch (e) { fehler(mount, e); }
      }, 250);
    });

    inhalt.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { class: 'btn-primary', onClick: () => bearbeiten(mount, null, () => {
        toast('Angelegt.');
      }) }, '+ Zugezogenen anlegen'),
      suchfeld,
    ]));
    inhalt.appendChild(treffer);
  }

  GR.views = GR.views || {};
  GR.views.renderEinwohner = renderEinwohner;
})();
