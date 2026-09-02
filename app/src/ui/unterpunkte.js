(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, confirmDialog } = GR.ui;
  const M = GR.models;

  // Unterpunkte eines TOPs — Editor und Vorschau.
  //
  // Gedacht für „Verschiedenes": mehrere Themen werden nacheinander besprochen
  // und müssen im Protokoll auseinandergehalten werden. Jeder Unterpunkt hat
  // eine Überschrift und einen Text; im PDF erscheint er als „7.1 Titel" mit
  // dem Text darunter.
  //
  // WARUM DAS HIER UND NICHT ZWEIMAL IN DEN ANSICHTEN LIEGT: Unterpunkte lassen
  // sich in der Vorbereitung UND in der laufenden Sitzung bearbeiten. Zwei
  // Kopien desselben Editors laufen mit dem ersten Änderungswunsch auseinander,
  // und dann verhält sich dasselbe Feld an zwei Stellen verschieden.
  //
  // DIE NUMMER WIRD NICHT GESPEICHERT. Sie ergibt sich aus der Reihenfolge
  // (`M.unterpunktNummer`) — gespeichert stimmte sie nach dem ersten Umsortieren
  // nicht mehr, und niemand denkt daran, sie nachzuziehen.

  // ZWEI FLAGGEN, DIE MAN NICHT VERWECHSELN DARF:
  //
  //   beschluss(top)  — die ABSICHT, in der Vorbereitung festgelegt: über
  //                     diesen Punkt soll ein Beschluss gefasst werden.
  //   abgestimmt(top) — das ERGEBNIS, erst in der Sitzung entstanden: es wurde
  //                     tatsächlich abgestimmt, die Zahlen stehen fest.
  //
  // Früher gab es nur die zweite. Da sie in der Vorbereitung zwangsläufig
  // überall `false` ist, sah dort jeder TOP wie eine bloße Beratung aus.
  // Die Darstellung richtet sich deshalb nach der ABSICHT; allein die
  // Abstimmungsbox im Protokoll richtet sich nach dem ERGEBNIS — ein Beschluss,
  // den es nicht gab, darf nirgends gedruckt werden.
  function beschluss(top) {
    return M.istBeschlussTop(top);
  }
  function abgestimmt(top) {
    return !!(top && top.abstimmung && top.abstimmung.durchgefuehrt);
  }

  // Wann darf der TOP Unterpunkte bekommen? Nur bei einem Beratungspunkt — bei
  // einer Beschlussfassung gehört der Text in die Beschlussvorlage.
  //
  // Bereits erfasste Unterpunkte bleiben aber sichtbar und werden weiter
  // gedruckt, auch wenn der TOP nachträglich auf Beschlussfassung umgestellt
  // wird. Alles andere wäre genau der Fehler, den das Bemerkungsfeld jahrelang
  // hatte: der Text ist gespeichert, und niemand bekommt ihn je wieder zu sehen.
  function zeigen(top) {
    return !beschluss(top) || M.unterpunkteVon(top).length > 0;
  }
  function bearbeitbar(top) {
    return !beschluss(top);
  }

  // Beschriftung des großen Textfelds. Bei einem Beratungspunkt wird nichts
  // beschlossen, dann ist „Beschlussvorlage" schlicht der falsche Name.
  function textfeldLabel(top) {
    return beschluss(top) ? 'Beschlussvorlage' : 'Beratung';
  }

  // --- Art des Punkts -------------------------------------------------------
  // Der Umschalter liegt hier und nicht zweimal in den Ansichten, aus demselben
  // Grund wie der Editor: Vorbereitung und laufende Sitzung brauchen ihn beide.
  //
  // Umschalten verliert NIE etwas. Wird aus einer Beschlussfassung eine
  // Beratung, bleibt eine bereits getippte Beschlussvorlage stehen und wird
  // gedruckt; umgekehrt bleiben erfasste Unterpunkte erhalten.
  function artWaehler(top, { onChange }) {
    const zeile = el('div', { class: 'top-art' });
    const setze = (wert) => {
      if (beschluss(top) === wert) return;
      top.beschlussfassung = wert;
      onChange();
    };
    const knopf = (wert, text, titel) => el('button', {
      type: 'button',
      class: 'top-art-btn' + (beschluss(top) === wert ? ' aktiv' : ''),
      title: titel,
      onClick: () => setze(wert),
    }, text);

    zeile.appendChild(el('span', { class: 'top-art-label' }, 'Art des Punkts'));
    zeile.appendChild(el('div', { class: 'top-art-gruppe' }, [
      knopf(true, 'Beschlussfassung', 'Über diesen Punkt wird abgestimmt. Das Protokoll zeigt eine Beschlussvorlage und die Abstimmungsbox.'),
      knopf(false, 'Beratung', 'Nur Aussprache, kein Beschluss. Für Punkte wie „Verschiedenes" — hier stehen die Unterpunkte zur Verfügung.'),
    ]));

    // Nachträglich umgestellt, obwohl schon abgestimmt wurde? Dann bleibt die
    // Abstimmung im Protokoll — sie hat stattgefunden. Nicht kommentarlos.
    if (abgestimmt(top) && !beschluss(top)) {
      zeile.appendChild(el('p', { class: 'help warn-mild' },
        'Für diesen Punkt wurde bereits abgestimmt. Das Ergebnis bleibt im Protokoll erhalten, '
        + 'auch wenn er jetzt als Beratung geführt wird.'));
    }
    return zeile;
  }

  // Kurzhilfe zur Schreibweise, direkt unter dem grossen Textfeld. Ohne Hinweis
  // in der Oberflaeche findet niemand eine Auszeichnung, die es nur im Handbuch
  // gibt — genau das war beim alten Aufzaehlungs-Markdown der Fall.
  function schreibhilfe() {
    return el('p', { class: 'help schreibhilfe' }, [
      'Schreibweise: ',
      el('code', {}, '- '), ' Aufzaehlung · ',
      el('code', {}, '# '), ' Überschrift · ',
      el('code', {}, '**fett**'), ' · ',
      el('code', {}, '*kursiv*'), ' · ',
      el('code', {}, 'm^2'), ' hochgestellt · ',
      el('code', {}, 'CO_2'), ' tiefgestellt. ',
      'Mehrere Zeichen in geschweifte Klammern: ',
      el('code', {}, 'm^{-2}'), '. Ein wörtlicher Unterstrich: ',
      // Zwei Backslashes im Quelltext, damit EINER auf dem Bildschirm steht —
      // ausgerechnet in der Zeile, die den Backslash erklaert.
      el('code', {}, '\\_'), '.',
    ]);
  }

  // --- Editor ---------------------------------------------------------------
  // onChange() wird nach jeder Änderung gerufen (speichern), onStruktur() nach
  // Änderungen, die die Liste umbauen (anlegen, löschen, verschieben) und daher
  // ein Neuzeichnen brauchen.
  function editor(top, { onChange, onStruktur }) {
    const liste = M.unterpunkteVon(top);
    // Bewusst KEINE 'card'-Klasse: der Editor steht in der Vorbereitung
    // innerhalb einer Karte und wuerde sonst als Karte in der Karte erscheinen.
    const karte = el('div', { class: 'up-karte' });

    karte.appendChild(el('div', { class: 'toolbar' }, [
      el('h3', { style: 'margin:0' }, 'Unterpunkte'),
      el('div', { class: 'spacer' }),
      bearbeitbar(top)
        ? el('button', {
          class: 'btn-primary',
          onClick: () => {
            if (!Array.isArray(top.unterpunkte)) top.unterpunkte = [];
            top.unterpunkte.push(M.emptyUnterpunkt());
            onStruktur();
          },
        }, '+ Unterpunkt')
        : null,
    ].filter(Boolean)));

    if (!liste.length) {
      karte.appendChild(el('p', { class: 'help' },
        'Für TOPs wie „Verschiedenes": je Thema ein Unterpunkt mit eigener Überschrift. '
        + 'Im Protokoll erscheinen sie nummeriert als ' + M.unterpunktNummer(top, 0) + ', '
        + M.unterpunktNummer(top, 1) + ' und so fort.'));
      return karte;
    }

    if (!bearbeitbar(top)) {
      karte.appendChild(el('p', { class: 'help warn-mild' },
        'Dieser Punkt ist eine Beschlussfassung. Die vorhandenen Unterpunkte bleiben erhalten '
        + 'und werden gedruckt; neue lassen sich erst wieder anlegen, wenn er als Beratung '
        + 'geführt wird.'));
    }

    liste.forEach((up, i) => {
      const titelI = el('input', {
        type: 'text', value: up.titel || '', placeholder: 'Überschrift des Unterpunkts',
        onInput: (ev) => { up.titel = ev.target.value; onChange(); },
      });
      const textT = el('textarea', {
        rows: '3',
        placeholder: 'Was wurde besprochen? (Aufzählungen mit „- " am Zeilenanfang)',
        onInput: (ev) => { up.text = ev.target.value; onChange(); },
      });
      textT.value = up.text || '';

      const verschieben = (richtung) => {
        const ziel = i + richtung;
        if (ziel < 0 || ziel >= top.unterpunkte.length) return;
        const a = top.unterpunkte[i];
        top.unterpunkte[i] = top.unterpunkte[ziel];
        top.unterpunkte[ziel] = a;
        onStruktur();
      };

      karte.appendChild(el('div', { class: 'up-zeile' }, [
        el('div', { class: 'up-kopf' }, [
          el('span', { class: 'up-nummer' }, M.unterpunktNummer(top, i)),
          titelI,
          el('div', { class: 'up-knoepfe' }, [
            el('button', { title: 'Nach oben', disabled: i === 0, onClick: () => verschieben(-1) }, '↑'),
            el('button', { title: 'Nach unten', disabled: i === liste.length - 1, onClick: () => verschieben(1) }, '↓'),
            el('button', {
              class: 'btn-danger', title: 'Unterpunkt löschen',
              onClick: () => {
                const name = up.titel || M.unterpunktNummer(top, i);
                if ((up.titel || up.text) && !confirmDialog(`Unterpunkt „${name}" wirklich löschen?`)) return;
                top.unterpunkte.splice(i, 1);
                onStruktur();
              },
            }, '×'),
          ]),
        ]),
        textT,
      ]));
    });

    return karte;
  }

  // --- Vorschau -------------------------------------------------------------
  // Zeigt den TOP so, wie er im Protokoll erscheint. Der Zweck ist die
  // Gliederung, nicht das Aussehen: Nummern, Überschriften, Aufzählungen.
  //
  // Bewusst ein eigener, winziger Renderer statt `marked`: er kann GENAU so
  // viel wie `drawMarkdown` in export/pdf.js und keinen Deut mehr. Eine
  // Vorschau, die mehr kann als der Druck, fuehrt in die Irre.
  //
  // Die Auszeichnungen INNERHALB einer Zeile (m^2, CO_2, **fett**, *kursiv*)
  // kommen aus demselben Zerleger wie das PDF (`GR.pdfInline.zerlege`), damit
  // die beiden Wege gar nicht erst auseinanderlaufen koennen.
  function auszeichnungHtml(text, sicher) {
    if (!GR.pdfInline) return sicher(text);
    return GR.pdfInline.zerlege(text).map(t => {
      let h = sicher(t.text);
      if (t.stil.fett) h = '<strong>' + h + '</strong>';
      if (t.stil.kursiv) h = '<em>' + h + '</em>';
      if (t.stil.hoch) h = '<sup>' + h + '</sup>';
      if (t.stil.tief) h = '<sub>' + h + '</sub>';
      return h;
    }).join('');
  }

  function listenHtml(text) {
    const zeilen = String(text || '').split(/\r?\n/);
    const raus = [];
    let liste = null;          // 'ul' | 'ol' | null
    const schliesse = () => { if (liste) { raus.push(`</${liste}>`); liste = null; } };
    const sicher = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    for (const roh of zeilen) {
      if (!roh.trim()) { schliesse(); continue; }
      const punkt = roh.match(/^\s*[-*]\s+(.*)$/);
      const zahl = roh.match(/^\s*\d+\.\s+(.*)$/);
      const ueber = roh.match(/^\s*(#{1,3})\s+(.*)$/);
      if (ueber) {
        schliesse();
        const stufe = ueber[1].length;
        raus.push(`<h${stufe + 3} class="up-v-h">${auszeichnungHtml(ueber[2], sicher)}</h${stufe + 3}>`);
      } else if (punkt) {
        if (liste !== 'ul') { schliesse(); raus.push('<ul>'); liste = 'ul'; }
        raus.push(`<li>${auszeichnungHtml(punkt[1], sicher)}</li>`);
      } else if (zahl) {
        if (liste !== 'ol') { schliesse(); raus.push('<ol>'); liste = 'ol'; }
        raus.push(`<li>${auszeichnungHtml(zahl[1], sicher)}</li>`);
      } else {
        schliesse();
        raus.push(`<p>${auszeichnungHtml(roh, sicher)}</p>`);
      }
    }
    schliesse();
    return raus.join('');
  }

  // Der Abstimmungsteil, so wie ihn `drawAbstimmungBox` im PDF setzt — nur
  // grob, es geht um Wiedererkennung, nicht um ein Faksimile.
  //
  // Wurde noch nicht abgestimmt, steht hier ein ausgegrauter Platzhalter: der
  // Kasten ist im fertigen Protokoll vorgesehen, aber noch leer. So sieht man
  // der Vorschau schon in der Vorbereitung an, welche Art von Punkt vorliegt.
  function abstimmungBlock(top) {
    const ist = abgestimmt(top);
    if (!ist && !beschluss(top)) return null;

    const a = (top.abstimmung || {});
    const einst = M.isEinstimmig(a);
    const richtung = M.einstimmigRichtung(a);
    const haken = (an) => (an ? '☒' : '☐');
    const zahl = (n) => (ist ? String(n || 0) : '');

    const kasten = el('div', { class: 'up-v-abst' + (ist ? '' : ' leer') });
    kasten.appendChild(el('div', { class: 'up-v-abst-kopf' }, [
      el('span', {}, `${haken(einst)} Einstimmig`),
      el('span', {}, `${haken(ist && !einst)} Mit Stimmenmehrheit`),
    ]));
    kasten.appendChild(el('div', { class: 'up-v-abst-zeile' }, [
      el('span', {}, `${haken(einst && richtung === 'dafuer')} dafür`),
      el('span', {}, `${haken(einst && richtung === 'dagegen')} dagegen`),
      el('span', {}, `Ja: ${zahl(a.ja)}`),
      el('span', {}, `Nein: ${zahl(a.nein)}`),
      el('span', {}, `Enthaltungen: ${zahl(a.enthaltung)}`),
    ]));

    // Die Bemerkungen sind im Protokoll die letzte Zeile dieses Kastens —
    // deshalb stehen sie hier drin und nicht darunter.
    const bem = (top.bemerkungen || '').trim();
    if (ist) {
      kasten.appendChild(el('div', { class: 'up-v-abst-bem' }, 'Bemerkungen: ' + bem));
      kasten.appendChild(el('div', { class: 'up-v-abst-fuss' }, 'Ergebnis: ' + M.ergebnisAbstimmung(a)));
    } else {
      kasten.appendChild(el('div', { class: 'up-v-abst-fuss' },
        'Wird in der Sitzung erfasst.'));
    }
    return kasten;
  }

  function vorschau(top) {
    const box = el('div', { class: 'card up-vorschau' });
    box.appendChild(el('div', { class: 'up-vorschau-fahne' }, 'So steht es im Protokoll'));

    const nummer = String(top.nummer == null ? '' : top.nummer).trim();
    box.appendChild(el('h4', { class: 'up-v-top' },
      (nummer ? `TOP ${nummer}` : 'TOP') + (top.titel ? ' · ' + top.titel : '')));

    const einleitung = (top.beschlussvorlage || '').trim();
    if (beschluss(top)) box.appendChild(el('div', { class: 'up-v-label' }, 'Beschlussvorlage:'));
    if (einleitung) {
      box.appendChild(el('div', { class: 'up-v-text', html: listenHtml(einleitung) }));
    } else if (beschluss(top)) {
      box.appendChild(el('div', { class: 'up-v-text' }, '—'));
    }

    const liste = M.unterpunkteVon(top);
    liste.forEach((up, i) => {
      box.appendChild(el('div', { class: 'up-v-unterpunkt' }, [
        el('div', { class: 'up-v-ueberschrift' },
          `${M.unterpunktNummer(top, i)} ${up.titel || '(ohne Überschrift)'}`),
        (up.text || '').trim()
          ? el('div', { class: 'up-v-text', html: listenHtml(up.text) })
          : el('div', { class: 'up-v-leer' }, '(noch kein Text)'),
      ]));
    });

    if (!einleitung && !liste.length && !beschluss(top)) {
      box.appendChild(el('p', { class: 'help' }, 'Noch nichts erfasst.'));
    }

    // Bemerkungen stehen im Protokoll in der Abstimmungsbox — die zeichnet
    // `abstimmungBlock` mit. NUR wenn nicht abgestimmt wurde, gibt es die Box
    // nicht, und dann druckt das PDF sie als eigenen Absatz. Genau so hier.
    const bem = (top.bemerkungen || '').trim();
    if (bem && !abgestimmt(top)) {
      box.appendChild(el('div', { class: 'up-v-unterpunkt' }, [
        el('div', { class: 'up-v-ueberschrift' }, 'Bemerkungen:'),
        el('div', { class: 'up-v-text', html: listenHtml(bem) }),
      ]));
    }

    const abst = abstimmungBlock(top);
    if (abst) box.appendChild(abst);
    return box;
  }

  // --- Vorschau-Feld --------------------------------------------------------
  // Die Vorschau muss beim Tippen mitlaufen. Die Ansichten speichern bei jedem
  // Tastendruck (`oninput`), zeichnen sich aber nur bei Strukturänderungen neu
  // — eine einmal gebaute Vorschau stünde also veraltet daneben, und eine
  // Vorschau, die etwas anderes zeigt als das Feld darüber, ist schlimmer als
  // gar keine. Deshalb gibt es hier einen Behälter, den die Ansicht nachziehen
  // kann, ohne die ganze Karte neu zu bauen (was den Cursor aus dem Feld risse).
  function vorschauFeld(top, { offen = false } = {}) {
    const behaelter = el('div', { class: 'up-vorschau-feld' });
    let sichtbar = !!offen;
    const aktualisieren = () => {
      behaelter.innerHTML = '';
      if (sichtbar) behaelter.appendChild(vorschau(top));
    };
    const umschalten = (wert) => {
      sichtbar = (wert === undefined) ? !sichtbar : !!wert;
      aktualisieren();
      return sichtbar;
    };
    aktualisieren();
    return { el: behaelter, aktualisieren, umschalten, istOffen: () => sichtbar };
  }

  GR.unterpunkte = {
    editor, vorschau, vorschauFeld, artWaehler, schreibhilfe,
    zeigen, bearbeitbar, textfeldLabel, abgestimmt, beschluss,
    // für Tests
    _listenHtml: listenHtml,
  };
})();
