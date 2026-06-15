(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog } = GR.ui;
  const { emptyTop, fullName } = GR.models;

  function renderVorbereitung(mount, sitzungId) {
    let sitzung = store.getSitzung(sitzungId);
    if (!sitzung) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('h2', {}, 'Sitzung nicht gefunden'),
        el('a', { href: '#/' }, 'Zur Übersicht'),
      ]));
      return;
    }

    const mitglieder = store.listMitglieder().filter(m => m.aktiv);

    const save = () => store.saveSitzung(sitzung);

    const renumber = () => {
      let n = 1;
      for (const t of sitzung.tops.filter(x => x.bereich === 'oeffentlich')) t.nummer = n++;
      for (const t of sitzung.tops.filter(x => x.bereich === 'nicht_oeffentlich')) t.nummer = n++;
    };

    const rerender = () => {
      mount.innerHTML = '';
      renderVorbereitung(mount, sitzungId);
    };

    const datumInput = el('input', { type: 'date', value: sitzung.datum });
    datumInput.onchange = e => { sitzung.datum = e.target.value; save(); };

    const leiterSelect = el('select', {});
    const schriftSelect = el('select', {});
    for (const sel of [leiterSelect, schriftSelect]) sel.appendChild(el('option', { value: '' }, '— bitte wählen —'));
    for (const m of mitglieder) {
      const label = `${fullName(m)} — ${m.funktion}`;
      leiterSelect.appendChild(el('option', { value: m.id, selected: m.id === sitzung.sitzungsleitungId }, label));
      schriftSelect.appendChild(el('option', { value: m.id, selected: m.id === sitzung.schriftfuehrerId }, label));
    }
    leiterSelect.onchange = e => { sitzung.sitzungsleitungId = e.target.value; save(); };
    schriftSelect.onchange = e => { sitzung.schriftfuehrerId = e.target.value; save(); };

    const gaesteInput = el('textarea', { placeholder: 'Namen der Gäste (z. B. Bürger, Pressevertreter)' });
    gaesteInput.value = sitzung.gaeste;
    gaesteInput.oninput = e => { sitzung.gaeste = e.target.value; save(); };

    const kopfCard = el('div', { class: 'card' }, [
      el('h2', {}, 'Sitzungs-Kopfdaten'),
      el('div', { class: 'grid-3' }, [
        el('div', {}, [el('label', {}, 'Datum'), datumInput]),
        el('div', {}, [el('label', {}, 'Sitzungsleitung'), leiterSelect]),
        el('div', {}, [el('label', {}, 'Schriftführer'), schriftSelect]),
      ]),
      mitglieder.length === 0
        ? el('p', { class: 'help' }, 'Tipp: Legen Sie zuerst unter „Stammdaten" Ratsmitglieder an.')
        : el('p', { class: 'help' }, 'Die Anwesenheit der Ratsmitglieder wird erst zu Beginn der Live-Sitzung erfasst.'),
      el('div', {}, [el('label', {}, 'Gäste'), gaesteInput]),
    ]);

    function topCard(top) {
      const titelI = el('input', { type: 'text', value: top.titel, placeholder: 'TOP-Titel' });
      titelI.oninput = e => { top.titel = e.target.value; save(); };
      const vorlageT = el('textarea', { placeholder: 'Beschlussvorlage (kann hier vorbereitet werden)' });
      vorlageT.value = top.beschlussvorlage;
      vorlageT.oninput = e => { top.beschlussvorlage = e.target.value; save(); };

      const moveUp = () => {
        const sameBereich = sitzung.tops.filter(t => t.bereich === top.bereich);
        const idx = sameBereich.indexOf(top);
        if (idx <= 0) return;
        const other = sameBereich[idx - 1];
        const ai = sitzung.tops.indexOf(top), bi = sitzung.tops.indexOf(other);
        [sitzung.tops[ai], sitzung.tops[bi]] = [sitzung.tops[bi], sitzung.tops[ai]];
        renumber(); save(); rerender();
      };
      const moveDown = () => {
        const sameBereich = sitzung.tops.filter(t => t.bereich === top.bereich);
        const idx = sameBereich.indexOf(top);
        if (idx >= sameBereich.length - 1) return;
        const other = sameBereich[idx + 1];
        const ai = sitzung.tops.indexOf(top), bi = sitzung.tops.indexOf(other);
        [sitzung.tops[ai], sitzung.tops[bi]] = [sitzung.tops[bi], sitzung.tops[ai]];
        renumber(); save(); rerender();
      };
      const del = () => {
        if (!confirmDialog(`TOP ${top.nummer} „${top.titel || ''}" wirklich löschen?`)) return;
        sitzung.tops = sitzung.tops.filter(t => t.id !== top.id);
        renumber(); save(); rerender();
      };

      return el('div', { class: 'card' }, [
        el('div', { class: 'toolbar' }, [
          el('strong', {}, `TOP ${top.nummer}`),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn-sm', onClick: moveUp }, '↑'),
          el('button', { class: 'btn-sm', onClick: moveDown }, '↓'),
          el('button', { class: 'btn-sm btn-danger', onClick: del }, 'Löschen'),
        ]),
        el('label', {}, 'Titel'),
        titelI,
        el('label', { style: 'margin-top:10px' }, 'Beschlussvorlage'),
        vorlageT,
      ]);
    }

    function topBereichBlock(bereich, ueberschrift) {
      const liste = sitzung.tops.filter(t => t.bereich === bereich);
      const onAdd = () => {
        const nummer = (sitzung.tops.length ? Math.max(...sitzung.tops.map(t => t.nummer)) : 0) + 1;
        sitzung.tops.push(emptyTop(nummer, bereich));
        renumber(); save(); rerender();
      };
      return el('section', {}, [
        el('div', { class: 'toolbar' }, [
          el('h2', { style: 'margin:0' }, ueberschrift),
          el('div', { class: 'spacer' }),
          el('button', { onClick: onAdd }, '+ TOP hinzufügen'),
        ]),
        liste.length === 0
          ? el('div', { class: 'card empty' }, 'Noch keine TOPs angelegt.')
          : el('div', {}, liste.map(topCard)),
      ]);
    }

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { href: '#/', class: 'btn' }, '← Übersicht'),
      el('h2', { style: 'margin:0' }, 'Sitzung vorbereiten'),
      el('div', { class: 'spacer' }),
      el('a', { href: `#/sitzung/live?id=${sitzung.id}`, class: 'btn btn-primary' }, 'Zur Live-Protokollierung →'),
    ]));
    mount.appendChild(kopfCard);
    mount.appendChild(topBereichBlock('oeffentlich', 'Öffentlicher Teil'));
    mount.appendChild(topBereichBlock('nicht_oeffentlich', 'Nicht-öffentlicher Teil'));
  }

  GR.views = GR.views || {};
  GR.views.renderVorbereitung = renderVorbereitung;
})();
