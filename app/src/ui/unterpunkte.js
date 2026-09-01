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

  // Wann darf der TOP Unterpunkte bekommen? Nur solange nicht abgestimmt wurde
  // — bei einem Beschluss-TOP gehört der Text in die Beschlussvorlage.
  //
  // Bereits erfasste Unterpunkte bleiben aber sichtbar und werden weiter
  // gedruckt, auch wenn nachträglich abgestimmt wird. Alles andere wäre genau
  // der Fehler, den das Bemerkungsfeld jahrelang hatte: der Text ist gespeichert,
  // und niemand bekommt ihn je wieder zu sehen.
  function abgestimmt(top) {
    return !!(top && top.abstimmung && top.abstimmung.durchgefuehrt);
  }
  function zeigen(top) {
    return !abgestimmt(top) || M.unterpunkteVon(top).length > 0;
  }
  function bearbeitbar(top) {
    return !abgestimmt(top);
  }

  // Beschriftung des großen Textfelds. Ohne Abstimmung wird nichts beschlossen,
  // dann ist „Beschlussvorlage" schlicht der falsche Name.
  function textfeldLabel(top) {
    return abgestimmt(top) ? 'Beschlussvorlage' : 'Beratung';
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
        'Für diesen TOP wurde abgestimmt. Die vorhandenen Unterpunkte bleiben erhalten und '
        + 'werden gedruckt; neue lassen sich hier nicht mehr anlegen.'));
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
  // Bewusst ein eigener, winziger Renderer statt `marked`: das PDF versteht nur
  // Aufzählungen und Nummernlisten (siehe drawMarkdown in export/pdf.js). Eine
  // Vorschau, die mehr kann als der Druck, führt in die Irre — sie würde
  // Fettdruck zeigen, den das Protokoll nachher nicht hat.
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
      if (punkt) {
        if (liste !== 'ul') { schliesse(); raus.push('<ul>'); liste = 'ul'; }
        raus.push(`<li>${sicher(punkt[1])}</li>`);
      } else if (zahl) {
        if (liste !== 'ol') { schliesse(); raus.push('<ol>'); liste = 'ol'; }
        raus.push(`<li>${sicher(zahl[1])}</li>`);
      } else {
        schliesse();
        raus.push(`<p>${sicher(roh)}</p>`);
      }
    }
    schliesse();
    return raus.join('');
  }

  function vorschau(top) {
    const box = el('div', { class: 'card up-vorschau' });
    box.appendChild(el('div', { class: 'up-vorschau-fahne' }, 'So steht es im Protokoll'));

    const nummer = String(top.nummer == null ? '' : top.nummer).trim();
    box.appendChild(el('h4', { class: 'up-v-top' },
      (nummer ? `TOP ${nummer}` : 'TOP') + (top.titel ? ' · ' + top.titel : '')));

    const einleitung = (top.beschlussvorlage || '').trim();
    if (abgestimmt(top)) box.appendChild(el('div', { class: 'up-v-label' }, 'Beschlussvorlage:'));
    if (einleitung) {
      box.appendChild(el('div', { class: 'up-v-text', html: listenHtml(einleitung) }));
    } else if (abgestimmt(top)) {
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

    if (!einleitung && !liste.length && !abgestimmt(top)) {
      box.appendChild(el('p', { class: 'help' }, 'Noch nichts erfasst.'));
    }

    // Bemerkungen erscheinen im Protokoll nur bei einem Beschluss-TOP (dort in
    // der Abstimmungsbox). Steht bei einem TOP ohne Abstimmung noch Text darin,
    // wird er ausnahmsweise gedruckt — sonst verschwände er unbemerkt.
    const bem = (top.bemerkungen || '').trim();
    if (bem) {
      box.appendChild(el('div', { class: 'up-v-unterpunkt' }, [
        el('div', { class: 'up-v-ueberschrift' }, 'Bemerkungen:'),
        el('div', { class: 'up-v-text', html: listenHtml(bem) }),
      ]));
    }
    return box;
  }

  GR.unterpunkte = {
    editor, vorschau, zeigen, bearbeitbar, textfeldLabel, abgestimmt,
    // für Tests
    _listenHtml: listenHtml,
  };
})();
