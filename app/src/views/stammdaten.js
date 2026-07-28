(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog } = GR.ui;
  const M = GR.models;

  // Zentrale Personen-Stammdaten. Früher standen hier nur die Ratsmitglieder;
  // Mieter, Empfänger, Arbeiter/Firmen und Vertragspartner lagen in eigenen
  // Listen der jeweiligen Module. Jetzt ist alles EINE Liste, die Rollen sagen,
  // wo eine Person auftaucht.
  //
  // Bankverbindung und Steuer-/SV-Daten sind nur in der Leitungs-Ansicht
  // sichtbar (GR.roles). Das ist Blickschutz, kein echter Zugangsschutz – ohne
  // gesetzten Leitungs-PIN kann jeder die Rolle umschalten. Die PDFs (Auslagen,
  // Lohnabrechnung) drucken die IBAN unverändert, sonst wären Abrechnungen in
  // der Rats-Ansicht nicht mehr erstellbar.

  const ANREDEN = ['', 'Herr', 'Frau', 'Familie', 'Firma'];
  const ROLLEN = M.PERSON_ROLLEN;
  const ROLLEN_LABEL = M.PERSON_ROLLEN_LABEL;

  const istLeitung = () => !!(GR.roles && GR.roles.isLeitung());

  // ------------------------------------------------ Verwendung in den Modulen
  // Zeigt, woran eine Person hängt – Grundlage dafür, dass Löschen und das
  // Entfernen einer Rolle keine Verweise ins Leere laufen lassen.
  function verwendungen(id) {
    const out = [];
    const zahl = (n, ein, viele) => `${n} ${n === 1 ? ein : viele}`;
    const sitzungen = store.listSitzungen().filter(s =>
      (s.anwesendIds || []).includes(id) || s.sitzungsleitungId === id || s.schriftfuehrerId === id);
    if (sitzungen.length) out.push({ rolle: 'rat', text: zahl(sitzungen.length, 'Sitzung', 'Sitzungen') });
    const verm = store.listVermietungen().filter(v => v.mieterId === id);
    if (verm.length) out.push({ rolle: 'mieter', text: zahl(verm.length, 'Vermietung', 'Vermietungen') });
    const ausl = store.listAuslagen().filter(a => a.empfaengerId === id);
    if (ausl.length) out.push({ rolle: 'empfaenger', text: zahl(ausl.length, 'Bargeldauslage', 'Bargeldauslagen') });
    const zeiten = store.listArbeitszeiten().filter(z => z.arbeiterId === id);
    const abr = store.listArbeitsabrechnungen().filter(a => a.arbeiterId === id);
    if (zeiten.length || abr.length) {
      out.push({ rolle: 'arbeiter', text: [
        zeiten.length ? zahl(zeiten.length, 'Arbeitszeit', 'Arbeitszeiten') : '',
        abr.length ? zahl(abr.length, 'Abrechnung', 'Abrechnungen') : '',
      ].filter(Boolean).join(', ') });
    }
    const vertr = store.listVertraege().filter(v => v.partnerId === id);
    if (vertr.length) out.push({ rolle: 'partner', text: zahl(vertr.length, 'Vertrag', 'Verträge') });
    return out;
  }

  // ------------------------------------------------------ Dubletten-Assistent
  // Sucht Verdachtspaare (Bewertung in models.js) ohne die bereits als „kein
  // Duplikat" abgehakten. Zusammengeführt wird nur, was bestätigt wurde.
  function ignorierteDubletten() {
    const s = store.getSettings();
    return ((s.personen || {}).ignorierteDubletten || []).slice();
  }
  function merkeIgnoriert(schluessel) {
    const s = store.getSettings();
    if (!s.personen) s.personen = { ignorierteDubletten: [] };
    if (!Array.isArray(s.personen.ignorierteDubletten)) s.personen.ignorierteDubletten = [];
    if (!s.personen.ignorierteDubletten.includes(schluessel)) s.personen.ignorierteDubletten.push(schluessel);
    store.saveSettings(s);
  }
  function dublettenVerdacht(personen) {
    return M.findePersonenDubletten(personen || store.listPersonen(), ignorierteDubletten());
  }

  // Kurzsteckbrief einer Person für die Gegenüberstellung.
  function personKarte(p, extra) {
    const anzahl = store.personVerweiseAnzahl(p.id);
    return el('div', { class: 'dub-person' }, [
      el('div', { class: 'dub-person-name' }, M.personName(p) || '—'),
      M.personZusatz(p) ? el('div', { class: 'help' }, M.personZusatz(p)) : null,
      el('div', { class: 'pers-rollen-tags' }, M.personRollen(p).length
        ? M.personRollen(p).map(r => el('span', { class: 'tag' }, ROLLEN_LABEL[r]))
        : [el('span', { class: 'help' }, 'keine Rolle')]),
      el('div', { class: 'help' }, M.personAnschrift(p) || 'keine Anschrift'),
      el('div', { class: 'help' }, M.personKontakt(p) || 'kein Kontakt'),
      p.iban ? el('div', { class: 'help' }, '🔒 ' + M.formatIban(p.iban)) : null,
      el('div', { class: 'help' }, anzahl
        ? `${anzahl} ${anzahl === 1 ? 'Eintrag' : 'Einträge'} in den Modulen`
        : 'keine Einträge in den Modulen'),
      extra || null,
    ].filter(Boolean));
  }

  // Welche Datensätze das Zusammenführen anfassen wird – im Klartext, damit
  // vorher klar ist, was passiert.
  function verweisZusammenfassung(id) {
    const v = store.personVerweise(id);
    const teile = [];
    for (const def of M.PERSON_VERWEISE) {
      const n = (v[def.art] || []).length;
      if (n) teile.push(`${n} ${n === 1 ? def.label : def.labelMehrzahl}`);
    }
    return teile;
  }

  function feldWertText(zeile, seite) {
    const w = seite === 'ziel' ? zeile.zielWert : zeile.quelleWert;
    if (zeile.feld.bool) return w ? 'ja' : 'nein';
    return String(w || '') || '—';
  }

  // Schritt 2: zwei konkrete Personen zusammenführen.
  function openZusammenfuehren(a, b, onFertig) {
    // Vorschlag: es bleibt der Eintrag mit mehr Modul-Einträgen bestehen.
    let ziel = M.besseresZiel(a, b, store.personVerweiseAnzahl(a.id), store.personVerweiseAnzahl(b.id));
    let quelle = ziel.id === a.id ? b : a;
    const wahl = {};

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    const box = el('div', { class: 'modal modal-breit' });
    overlay.appendChild(box);

    function zeichne() {
      const vorschlag = M.mergeVorschlag(ziel, quelle);
      // Auswahl merken, solange die Seiten nicht getauscht wurden
      for (const z of vorschlag.felder) if (wahl[z.key]) z.auswahl = wahl[z.key];

      const umzuschreiben = verweisZusammenfassung(quelle.id);

      box.innerHTML = '';
      box.appendChild(el('h3', {}, 'Personen zusammenführen'));

      // --- Welcher Eintrag bleibt bestehen?
      box.appendChild(el('h4', { style: 'margin:14px 0 4px;' }, '1 · Welcher Eintrag bleibt bestehen?'));
      box.appendChild(el('p', { class: 'help', style: 'margin:0 0 8px;' }, 'Der bestehende Eintrag behält seine Kennung; alle Einträge des anderen werden auf ihn umgeschrieben. Vorgeschlagen ist der Eintrag mit den meisten Verknüpfungen – so ist am wenigsten umzuschreiben.'));
      box.appendChild(el('div', { class: 'dub-gegenueber' }, [
        personKarte(ziel, el('span', { class: 'tag ok' }, 'bleibt bestehen')),
        el('div', { class: 'dub-pfeil' }, [
          el('div', {}, '←'),
          el('button', { class: 'btn-sm', onClick: () => { const t = ziel; ziel = quelle; quelle = t; zeichne(); } }, '⇄ Tauschen'),
        ]),
        personKarte(quelle, el('span', { class: 'tag' }, 'wird eingerechnet')),
      ]));

      // --- Verweise
      box.appendChild(el('h4', { style: 'margin:16px 0 4px;' }, '2 · Was umgeschrieben wird'));
      box.appendChild(umzuschreiben.length
        ? el('ul', { class: 'dub-liste' }, umzuschreiben.map(t => el('li', {}, t)))
        : el('p', { class: 'help' }, `„${M.personName(quelle)}" ist in keinem Modul eingetragen – es sind nur die Stammdaten zusammenzuführen.`));

      // --- Felder
      box.appendChild(el('h4', { style: 'margin:16px 0 4px;' }, '3 · Angaben'));
      const konflikte = vorschlag.felder.filter(z => z.konflikt);
      if (konflikte.length) {
        box.appendChild(el('p', { class: 'help', style: 'margin:0 0 6px;' }, 'Beide Einträge haben hier einen Wert. Der vorausgewählte ist der vollständigere bzw. der aus dem zuletzt geänderten Eintrag – der nicht gewählte geht nicht verloren, er bleibt im Archiv der Zusammenführung.'));
        const tabelle = el('table', { class: 'dub-felder' });
        tabelle.appendChild(el('thead', {}, el('tr', {}, [
          el('th', {}, 'Feld'),
          el('th', {}, M.personName(ziel) || 'bleibt bestehen'),
          el('th', {}, M.personName(quelle) || 'wird eingerechnet'),
        ])));
        const tbody = el('tbody');
        for (const z of konflikte) {
          const mk = (seite) => {
            const rb = el('input', { type: 'radio', name: 'dub_' + z.key, checked: z.auswahl === seite });
            rb.onchange = () => { if (rb.checked) wahl[z.key] = seite; };
            return el('label', { class: 'dub-wahl' }, [rb, ' ', el('span', {}, feldWertText(z, seite))]);
          };
          tbody.appendChild(el('tr', {}, [
            el('td', {}, [z.label, z.feld.sensibel ? el('span', { class: 'help' }, ' 🔒') : null].filter(Boolean)),
            el('td', {}, mk('ziel')),
            el('td', {}, mk('quelle')),
          ]));
          wahl[z.key] = z.auswahl;
        }
        tabelle.appendChild(tbody);
        box.appendChild(tabelle);
      } else {
        box.appendChild(el('p', { class: 'help' }, 'Keine widersprüchlichen Angaben – nichts zu entscheiden.'));
      }

      const ergaenzt = vorschlag.felder.filter(z => z.ergaenzt);
      if (ergaenzt.length) {
        box.appendChild(el('p', { class: 'help', style: 'margin-top:8px;' },
          'Wird ergänzt (bisher leer): ' + ergaenzt.map(z => `${z.label} → ${feldWertText(z, 'quelle')}`).join(' · ')));
      }
      if (vorschlag.rollenNeu.length) {
        box.appendChild(el('p', { class: 'help' },
          'Rollen kommen hinzu: ' + vorschlag.rollenNeu.map(r => ROLLEN_LABEL[r]).join(', ')));
      }
      const beideNotizen = String(ziel.notiz || '').trim() && String(quelle.notiz || '').trim()
        && String(ziel.notiz).trim() !== String(quelle.notiz).trim();
      if (beideNotizen) box.appendChild(el('p', { class: 'help' }, 'Beide Notizen bleiben erhalten und werden untereinander gestellt.'));

      box.appendChild(el('p', { class: 'help', style: 'margin-top:10px;' },
        `Die aufgegebene Kennung bleibt als Verweis hinterlegt, der komplette Eintrag „${M.personName(quelle)}" im Archiv – die Zusammenführung ist danach rückgängig zu machen.`));

      box.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: ausfuehren }, 'Zusammenführen'),
        el('button', { onClick: close }, 'Abbrechen'),
      ]));
    }

    function ausfuehren() {
      if (!confirmDialog(`„${M.personName(quelle)}" in „${M.personName(ziel)}" zusammenführen?\n\n` +
        (verweisZusammenfassung(quelle.id).join(', ') || 'Keine Modul-Einträge') + ' werden umgeschrieben.')) return;
      let bericht;
      try {
        bericht = store.fuehrePersonenZusammen(ziel.id, quelle.id, wahl);
      } catch (e) {
        toast('Zusammenführen fehlgeschlagen: ' + e.message, 5000);
        return;
      }
      const n = Object.values(bericht.verweise).reduce((s, l) => s + l.length, 0);
      toast(n ? `Zusammengeführt – ${n} Datensätze umgeschrieben` : 'Zusammengeführt', 3500);
      close();
      if (onFertig) onFertig(bericht);
    }

    zeichne();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  // Schritt 1: Übersicht der Verdachtsfälle.
  function openDublettenAssistent(onFertig) {
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => { overlay.remove(); if (onFertig) onFertig(); };
    const box = el('div', { class: 'modal modal-breit' });
    overlay.appendChild(box);

    function zeichne() {
      const paare = dublettenVerdacht(store.listPersonen());
      box.innerHTML = '';
      box.appendChild(el('h3', {}, 'Doppelte Personen zusammenführen'));
      box.appendChild(el('p', { class: 'help' }, 'Vorschläge nach Sicherheit sortiert. Geprüft werden Namen (auch abweichende Schreibweisen), IBAN, E-Mail, Telefon, Geburtsdatum und Anschrift. Nichts wird ohne Bestätigung zusammengeführt.'));

      if (!paare.length) {
        box.appendChild(el('div', { class: 'empty' }, 'Keine Verdachtsfälle mehr offen.'));
      } else {
        const liste = el('div', { class: 'dub-vorschlaege' });
        for (const paar of paare) {
          liste.appendChild(el('div', { class: 'dub-vorschlag' }, [
            el('div', { class: 'dub-vorschlag-kopf' }, [
              el('span', { class: 'tag ' + (paar.stufe === 'sicher' ? 'ok' : paar.stufe === 'wahrscheinlich' ? 'prep' : '') },
                M.DUBLETTE_STUFE_LABEL[paar.stufe]),
              el('span', { class: 'help' }, ' ' + paar.gruende.join(' · ')),
            ]),
            el('div', { class: 'dub-vorschlag-namen' }, [
              el('strong', {}, M.personName(paar.a) || '—'),
              el('span', { class: 'help' }, ' ↔ '),
              el('strong', {}, M.personName(paar.b) || '—'),
            ]),
            el('div', { class: 'dub-vorschlag-aktionen' }, [
              el('button', { class: 'btn-sm btn-primary', onClick: () => openZusammenfuehren(paar.a, paar.b, () => zeichne()) }, 'Prüfen & zusammenführen'),
              ' ',
              el('button', { class: 'btn-sm', onClick: () => { merkeIgnoriert(paar.schluessel); toast('Als „kein Duplikat" gemerkt'); zeichne(); } }, 'Kein Duplikat'),
            ]),
          ]));
        }
        box.appendChild(liste);
      }

      // Von Hand: zwei beliebige Personen
      box.appendChild(el('h4', { style: 'margin:18px 0 4px;' }, 'Von Hand zusammenführen'));
      box.appendChild(el('p', { class: 'help', style: 'margin:0 0 6px;' }, 'Für Dubletten, die der Vorschlagsliste entgehen – etwa bei völlig verschiedenen Schreibweisen.'));
      const alle = store.listPersonen().slice().sort((x, y) => M.personName(x).localeCompare(M.personName(y), 'de'));
      const mkSel = () => {
        const s = el('select', {});
        s.appendChild(el('option', { value: '' }, '— Person wählen —'));
        for (const p of alle) s.appendChild(el('option', { value: p.id }, M.personName(p) || p.id));
        return s;
      };
      const selA = mkSel(), selB = mkSel();
      box.appendChild(el('div', { class: 'dub-manuell' }, [
        selA, el('span', { class: 'help' }, 'und'), selB,
        el('button', {
          class: 'btn-sm',
          onClick: () => {
            const a = store.getPerson(selA.value), b = store.getPerson(selB.value);
            if (!a || !b) return toast('Bitte zwei Personen wählen');
            if (a.id === b.id) return toast('Zweimal dieselbe Person');
            openZusammenfuehren(a, b, () => zeichne());
          },
        }, 'Prüfen'),
      ]));

      box.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { onClick: close }, 'Schließen'),
      ]));
    }

    zeichne();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  // Zuletzt zusammengeführt – je Person ist der jüngste Vorgang umkehrbar.
  function letzteZusammenfuehrungen(personen) {
    return personen
      .filter(p => (p.zusammengefuehrt || []).length)
      .map(p => ({ person: p, eintrag: p.zusammengefuehrt[p.zusammengefuehrt.length - 1] }))
      .sort((x, y) => String(y.eintrag.at || '').localeCompare(String(x.eintrag.at || '')));
  }

  // --------------------------------------------------------------- Formular
  function personForm(person) {
    const p = M.normalizePerson(person);
    const f = {};
    const mk = (key, type = 'text') => (f[key] = el('input', { type, value: p[key] || '' }));

    const anredeSel = el('select', {});
    for (const a of ANREDEN) anredeSel.appendChild(el('option', { value: a, selected: a === (p.anrede || '') }, a || '—'));

    mk('firma'); mk('vorname'); mk('nachname'); mk('ansprechpartner');
    mk('strasse'); mk('plz'); mk('ort');
    mk('telefon'); mk('email');
    mk('iban'); mk('kontoinhaber');
    mk('svNummer'); mk('steuerId'); mk('geburtsdatum', 'date');
    const anschriftFreitext = el('textarea', { rows: '3' }, p.anschriftFreitext || '');
    const notiz = el('textarea', {}, p.notiz || '');
    const aktiv = el('input', { type: 'checkbox', checked: p.aktiv !== false });

    // Rollen + rollenspezifische Felder
    const funktionSel = el('select', {});
    for (const fn of M.MITGLIED_FUNKTIONEN) {
      funktionSel.appendChild(el('option', { value: fn, selected: fn === (p.funktion || 'Ratsmitglied') }, fn));
    }
    const ortsfremd = el('input', { type: 'checkbox', checked: !!p.ortsfremd });
    const rollenBoxen = {};
    const rollenExtra = el('div', { class: 'pers-rollen-extra' });
    function renderRollenExtra() {
      rollenExtra.innerHTML = '';
      if (rollenBoxen.rat.checked) {
        rollenExtra.appendChild(el('div', {}, [el('label', {}, 'Funktion im Rat'), funktionSel]));
      }
      if (rollenBoxen.mieter.checked) {
        rollenExtra.appendChild(el('label', { class: 'pers-check' }, [
          ortsfremd, ' Ortsfremd (nicht aus der Gemeinde – höhere Grundmiete)',
        ]));
      }
    }
    const rollenGrid = el('div', { class: 'pers-rollen-grid' }, ROLLEN.map(r => {
      const cb = el('input', { type: 'checkbox', checked: M.hatRolle(p, r) });
      cb.onchange = renderRollenExtra;
      rollenBoxen[r] = cb;
      const modul = M.PERSON_ROLLEN_MODUL[r];
      return el('label', { class: 'pers-check' }, [cb, ` ${ROLLEN_LABEL[r]}`,
        el('span', { class: 'help' }, ` (${modul ? modul.label : ''})`)]);
    }));
    renderRollenExtra();

    // Sensible Abschnitte nur in der Leitungs-Ansicht. Gesperrte Felder werden
    // NICHT gerendert – read() lässt die vorhandenen Werte damit unberührt.
    const bankBlock = istLeitung()
      ? el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'IBAN'), f.iban]),
        el('div', {}, [el('label', {}, 'Kontoinhaber (falls abweichend)'), f.kontoinhaber]),
      ])
      : el('p', { class: 'help' }, p.iban
        ? '🔒 Bankverbindung hinterlegt – sichtbar in der Leitungs-Ansicht.'
        : '🔒 Nur in der Leitungs-Ansicht zu sehen und zu ändern.');

    const steuerBlock = istLeitung()
      ? el('div', {}, [
        el('div', { class: 'grid-2' }, [
          el('div', {}, [el('label', {}, 'Sozialversicherungsnummer'), f.svNummer]),
          el('div', {}, [el('label', {}, 'Steuer-ID'), f.steuerId]),
        ]),
        el('div', { class: 'grid-2' }, [
          el('div', {}, [el('label', {}, 'Geburtsdatum'), f.geburtsdatum]),
          el('div', {}, []),
        ]),
      ])
      : el('p', { class: 'help' }, '🔒 Steuer- und Sozialversicherungsdaten sind nur in der Leitungs-Ansicht sichtbar.');

    const node = el('div', {}, [
      el('div', {}, [
        el('label', {}, 'Firma (optional)'),
        f.firma,
        el('p', { class: 'help', style: 'margin:2px 0 0;' }, 'Ausgefüllt = die Firma ist der Anzeigename, die Person darunter der Ansprechpartner.'),
      ]),
      el('div', { class: 'grid-2', style: 'margin-top:10px;' }, [
        el('div', {}, [el('label', {}, 'Anrede'), anredeSel]),
        el('div', {}, [el('label', {}, 'Ansprechpartner (falls abweichend)'), f.ansprechpartner]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Vorname'), f.vorname]),
        el('div', {}, [el('label', {}, 'Nachname'), f.nachname]),
      ]),

      el('h4', { style: 'margin:14px 0 4px;' }, 'Anschrift'),
      el('div', {}, [el('label', {}, 'Straße & Hausnummer'), f.strasse]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'PLZ'), f.plz]),
        el('div', {}, [el('label', {}, 'Ort'), f.ort]),
      ]),
      el('div', { style: 'margin-top:8px;' }, [
        el('label', {}, 'Abweichende Anschrift (mehrzeilig, z. B. bei Firmen)'),
        anschriftFreitext,
      ]),

      el('h4', { style: 'margin:14px 0 4px;' }, 'Kontakt'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Telefon'), f.telefon]),
        el('div', {}, [el('label', {}, 'E-Mail'), f.email]),
      ]),

      el('h4', { style: 'margin:14px 0 4px;' }, 'Bankverbindung'),
      bankBlock,

      el('h4', { style: 'margin:14px 0 4px;' }, 'Steuer & Sozialversicherung'),
      steuerBlock,

      el('h4', { style: 'margin:14px 0 4px;' }, 'Rollen'),
      el('p', { class: 'help', style: 'margin:0 0 6px;' }, 'Die Rolle entscheidet, in welchem Modul die Person zur Auswahl steht.'),
      rollenGrid,
      rollenExtra,

      el('div', { style: 'margin-top:10px;' }, [el('label', {}, 'Notiz'), notiz]),
      el('label', { class: 'pers-check', style: 'margin-top:8px;' }, [aktiv, ' Aktiv (erscheint bei der Auswahl in den Modulen)']),
    ]);

    return {
      node,
      read() {
        const out = M.normalizePerson(p);
        for (const [k, input] of Object.entries(f)) {
          // Gesperrte Felder wurden nicht gerendert → Altwert behalten.
          if (!istLeitung() && ['iban', 'kontoinhaber', 'svNummer', 'steuerId', 'geburtsdatum'].includes(k)) continue;
          out[k] = input.value.trim();
        }
        out.anrede = anredeSel.value;
        out.anschriftFreitext = anschriftFreitext.value;
        out.notiz = notiz.value;
        out.aktiv = aktiv.checked;
        out.funktion = funktionSel.value;
        out.ortsfremd = ortsfremd.checked;
        for (const r of ROLLEN) M.setPersonRolle(out, r, rollenBoxen[r].checked);
        return out;
      },
    };
  }

  // ----------------------------------------------------------------- Dialog
  function dialog(prefill, onSaved) {
    const isNew = !prefill || !prefill.id;
    const basis = M.normalizePerson(isNew ? Object.assign(M.emptyPerson(), prefill || {}) : prefill);
    const form = personForm(basis);

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();

    const onSave = () => {
      const p = form.read();
      if (!M.personName(p)) return toast('Bitte einen Namen oder eine Firma eingeben');
      // Entfernte Rollen, die noch verwendet werden, nur nach Rückfrage.
      if (!isNew) {
        const genutzt = verwendungen(p.id);
        const entzogen = ROLLEN.filter(r => M.hatRolle(basis, r) && !M.hatRolle(p, r));
        for (const r of entzogen) {
          const v = genutzt.find(x => x.rolle === r);
          if (v && !confirmDialog(`„${M.personName(p)}" ist noch in ${v.text} als ${ROLLEN_LABEL[r]} eingetragen.\n\nRolle trotzdem entfernen? Die vorhandenen Einträge bleiben erhalten und zeigen weiter auf diese Person.`)) return;
        }
      }
      store.savePerson(p);
      toast(isNew ? 'Person angelegt' : 'Gespeichert');
      close();
      if (onSaved) onSaved(p);
    };

    const box = el('div', { class: 'modal' }, [
      el('h3', {}, isNew ? 'Neue Person' : 'Stammdaten bearbeiten'),
      form.node,
      el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', { class: 'btn-primary', onClick: onSave }, 'Speichern'),
        el('button', { onClick: close }, 'Abbrechen'),
      ]),
    ]);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  // ------------------------------------------------------------------ Ansicht
  // Filter überleben das Neuzeichnen (modulglobal, wie in den anderen Ansichten).
  const uiState = { rolle: '', suche: '' };

  function renderStammdaten(mount, params) {
    if (params && params.rolle !== undefined) uiState.rolle = params.rolle || '';
    function refresh() { mount.innerHTML = ''; renderStammdaten(mount); }

    const alle = store.listPersonen();
    const zaehler = { '': alle.length };
    for (const r of ROLLEN) zaehler[r] = alle.filter(p => M.hatRolle(p, r)).length;

    // --- Kopf
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { class: 'btn-primary', onClick: () => dialog(uiState.rolle ? M.setPersonRolle(M.emptyPerson(), uiState.rolle, true) : null, refresh) }, '+ Neue Person'),
      el('div', { class: 'spacer' }),
      istLeitung()
        ? el('span', { class: 'tag ok' }, 'Leitungs-Ansicht')
        : el('span', { class: 'tag' }, 'Rats-Ansicht'),
    ]));
    mount.appendChild(el('h2', {}, 'Stammdaten'));
    mount.appendChild(el('p', { class: 'help' }, 'Alle Personen und Firmen an einer Stelle – Ratsmitglieder, Mieter, Empfänger von Bargeldauslagen, Arbeiter/Firmen und Vertragspartner. Die Rollen entscheiden, wo jemand zur Auswahl steht.'));

    // --- Filterleiste
    const chips = el('div', { class: 'pers-chips' });
    const chip = (key, label) => {
      const b = el('button', {
        class: 'pers-chip' + (uiState.rolle === key ? ' is-active' : ''),
        onClick: () => { uiState.rolle = key; refresh(); },
      }, `${label} (${zaehler[key] || 0})`);
      chips.appendChild(b);
    };
    chip('', 'Alle');
    for (const r of ROLLEN) chip(r, ROLLEN_LABEL[r]);

    const sucheInput = el('input', { type: 'search', placeholder: 'Suchen (Name, Ort, Kontakt)…', value: uiState.suche });
    sucheInput.oninput = e => {
      uiState.suche = e.target.value;
      zeichneTabelle();
    };

    mount.appendChild(el('div', { class: 'pers-filterbar' }, [chips, sucheInput]));

    // --- Tabelle (eigener Container, damit die Suche nicht den Fokus verliert)
    const tabellenBox = el('div', {});
    mount.appendChild(tabellenBox);

    function zeichneTabelle() {
      const q = uiState.suche.trim().toLowerCase();
      const gefiltert = alle
        .filter(p => !uiState.rolle || M.hatRolle(p, uiState.rolle))
        .filter(p => {
          if (!q) return true;
          const heuhaufen = [
            M.personName(p), M.personLangname(p), M.personAnschrift(p), M.personKontakt(p),
            istLeitung() ? p.iban : '',
          ].join(' ').toLowerCase();
          return heuhaufen.includes(q);
        })
        .sort((a, b) => M.personName(a).localeCompare(M.personName(b), 'de'));

      tabellenBox.innerHTML = '';
      const card = el('div', { class: 'card', style: 'padding:0' });
      if (!gefiltert.length) {
        card.appendChild(el('div', { class: 'empty' }, alle.length
          ? 'Keine Person passt zu Filter und Suche.'
          : 'Noch keine Personen angelegt.'));
        tabellenBox.appendChild(card);
        return;
      }
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Name'), el('th', {}, 'Rollen'), el('th', {}, 'Anschrift'), el('th', {}, 'Kontakt'),
        istLeitung() ? el('th', {}, 'Bankverbindung') : null,
        el('th', {}, ''),
      ].filter(Boolean))));
      const tbody = el('tbody');
      for (const p of gefiltert) {
        const zusatz = M.personZusatz(p);
        const rollen = M.personRollen(p);
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [
            el('strong', {}, M.personName(p) || '—'),
            zusatz ? el('div', { class: 'help' }, zusatz) : null,
            p.aktiv === false ? el('div', {}, el('span', { class: 'tag' }, 'inaktiv')) : null,
          ]),
          el('td', {}, rollen.length
            ? el('div', { class: 'pers-rollen-tags' }, rollen.map(r => el('span', { class: 'tag ' + (r === 'rat' ? 'done' : '') }, ROLLEN_LABEL[r])))
            : el('span', { class: 'help' }, 'keine Rolle')),
          el('td', {}, M.personAnschrift(p) || '—'),
          el('td', {}, M.personKontakt(p) || '—'),
          istLeitung() ? el('td', {}, p.iban ? M.formatIban(p.iban) : '—') : null,
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm', onClick: () => dialog(p, refresh) }, 'Bearbeiten'),
            ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(p) }, 'Löschen'),
          ]),
        ].filter(Boolean)));
      }
      table.appendChild(tbody);
      card.appendChild(table);
      tabellenBox.appendChild(card);
    }

    function onDelete(p) {
      const genutzt = verwendungen(p.id);
      if (genutzt.length) {
        alert(`„${M.personName(p)}" wird noch verwendet:\n\n` +
          genutzt.map(v => `• ${ROLLEN_LABEL[v.rolle]}: ${v.text}`).join('\n') +
          '\n\nDeshalb nicht löschbar – sonst zeigten diese Einträge ins Leere.\n\n' +
          'Stattdessen entweder den Haken „Aktiv" entfernen (erscheint dann nicht mehr zur Auswahl) oder im Bearbeiten-Dialog nur die nicht mehr benötigte Rolle abwählen.');
        return;
      }
      if (!confirmDialog(`„${M.personName(p)}" wirklich löschen?`)) return;
      store.deletePerson(p.id);
      toast('Person gelöscht');
      refresh();
    }

    zeichneTabelle();

    // --- Fuß: Zusammenführung und Dubletten
    const info = el('div', { class: 'card', style: 'margin-top:16px;' });
    const verdacht = dublettenVerdacht(alle);
    const anzahlVerdacht = verdacht.length;
    info.appendChild(el('h3', {}, 'Zusammengeführte Listen'));
    info.appendChild(el('p', { class: 'help' }, 'Ratsmitglieder, Mieter, Empfänger, Arbeiter/Firmen und Vertragspartner sind zu dieser einen Liste zusammengefasst. Jede Person hat ihre bisherige Kennung behalten, darum zeigen alle Vermietungen, Auslagen, Abrechnungen, Verträge und Sitzungen unverändert auf die richtigen Datensätze.'));
    const zeilen = el('div', { class: 'pers-stat' }, ROLLEN.map(r =>
      el('div', {}, [el('strong', {}, String(zaehler[r] || 0)), el('div', { class: 'help' }, ROLLEN_LABEL[r])])));
    info.appendChild(zeilen);

    // --- Dubletten
    if (!anzahlVerdacht) {
      info.appendChild(el('p', { class: 'help', style: 'margin-top:10px;' }, 'Keine möglichen Doppeleinträge gefunden.'));
    } else if (!istLeitung()) {
      info.appendChild(el('p', { class: 'help', style: 'margin-top:10px;' },
        `${anzahlVerdacht} ${anzahlVerdacht === 1 ? 'möglicher Doppeleintrag' : 'mögliche Doppeleinträge'} gefunden. Zum Zusammenführen in die Leitungs-Ansicht wechseln – dabei sind auch Bankverbindung und Steuerdaten abzugleichen, die hier ausgeblendet sind.`));
    } else {
      info.appendChild(el('p', { style: 'margin-top:10px;' },
        `${anzahlVerdacht} ${anzahlVerdacht === 1 ? 'möglicher Doppeleintrag' : 'mögliche Doppeleinträge'}: ` +
        verdacht.slice(0, 5).map(p => `${M.personName(p.a)} ↔ ${M.personName(p.b)}`).join(', ') +
        (verdacht.length > 5 ? ' …' : '')));
      info.appendChild(el('button', { class: 'btn-primary', onClick: () => openDublettenAssistent(refresh) }, 'Doppelte zusammenführen'));
    }
    if (istLeitung() && !anzahlVerdacht) {
      info.appendChild(el('button', { class: 'btn-sm', onClick: () => openDublettenAssistent(refresh) }, 'Von Hand zusammenführen…'));
    }
    mount.appendChild(info);

    // --- Rückgängig
    const rueck = letzteZusammenfuehrungen(alle);
    if (istLeitung() && rueck.length) {
      const karte = el('div', { class: 'card', style: 'margin-top:16px;' });
      karte.appendChild(el('h3', {}, 'Zuletzt zusammengeführt'));
      karte.appendChild(el('p', { class: 'help' }, 'Der jeweils jüngste Vorgang ist umkehrbar: der aufgegebene Eintrag wird wiederhergestellt und alle umgeschriebenen Verweise zeigen wieder auf ihn.'));
      const t = el('table');
      const tb = el('tbody');
      for (const { person, eintrag } of rueck.slice(0, 10)) {
        const anzahl = Object.values(eintrag.verweise || {}).reduce((s, l) => s + l.length, 0);
        tb.appendChild(el('tr', {}, [
          el('td', {}, [
            el('div', {}, [el('strong', {}, eintrag.quelleName || '—'), ' → ', el('strong', {}, M.personName(person))]),
            el('div', { class: 'help' }, new Date(eintrag.at).toLocaleString('de-DE')
              + (anzahl ? ` · ${anzahl} ${anzahl === 1 ? 'Datensatz' : 'Datensätze'} umgeschrieben` : ' · keine Verweise')),
          ]),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, el('button', {
            class: 'btn-sm',
            onClick: () => {
              if (!confirmDialog(`Zusammenführung rückgängig machen?\n\n„${eintrag.quelleName}" wird als eigener Eintrag wiederhergestellt.`)) return;
              try {
                store.macheZusammenfuehrungRueckgaengig(person.id, eintrag.id);
                toast('Zusammenführung rückgängig gemacht');
                refresh();
              } catch (e) { toast('Nicht möglich: ' + e.message, 5000); }
            },
          }, 'Rückgängig')),
        ]));
      }
      t.appendChild(tb);
      karte.appendChild(t);
      mount.appendChild(karte);
    }

    // Stand der einmaligen Migration (nur mit Backend verfügbar)
    if (GR.api && GR.api.personenMigration) {
      GR.api.personenMigration().then(st => {
        if (!st || !st.version || !st.quellen) return;
        const teile = Object.entries(st.quellen)
          .map(([k, v]) => `${k}: ${v.uebernommen} von ${v.gefunden}`).join(' · ');
        info.appendChild(el('p', { class: 'help' }, `Zusammengeführt am ${new Date(st.at).toLocaleString('de-DE')} — ${teile}. Die alten Listen bleiben in der Datenbank als Sicherung bestehen.`));
      }).catch(() => {});
    }
  }

  GR.views = GR.views || {};
  GR.views.renderStammdaten = renderStammdaten;
  GR.stammdaten = {
    dialog, verwendungen, dublettenVerdacht,
    openDublettenAssistent, openZusammenfuehren, letzteZusammenfuehrungen,
  };
})();
