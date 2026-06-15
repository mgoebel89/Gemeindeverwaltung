(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog } = GR.ui;
  const { uuid, MITGLIED_FUNKTIONEN, fullName } = GR.models;

  function renderStammdaten(mount) {
    function refresh() {
      mount.innerHTML = '';
      renderStammdaten(mount);
    }

    const mitglieder = store.listMitglieder();

    let neuVorname = '';
    let neuNachname = '';
    let neuFunktion = 'Ratsmitglied';

    const onAdd = () => {
      if (!neuVorname.trim() && !neuNachname.trim()) return toast('Bitte Vor- und Nachname eingeben');
      store.saveMitglied({
        id: uuid(),
        vorname: neuVorname.trim(),
        nachname: neuNachname.trim(),
        funktion: neuFunktion,
        aktiv: true,
      });
      toast('Mitglied hinzugefügt');
      refresh();
    };

    const onToggle = m => { store.saveMitglied({ ...m, aktiv: !m.aktiv }); refresh(); };
    const onDelete = m => {
      if (!confirmDialog(`„${fullName(m)}" wirklich löschen?`)) return;
      store.deleteMitglied(m.id);
      refresh();
    };
    const onEdit = m => {
      const v = prompt('Vorname:', m.vorname || '');
      if (v === null) return;
      const n = prompt('Nachname:', m.nachname || '');
      if (n === null) return;
      let f = prompt(`Funktion (${MITGLIED_FUNKTIONEN.join(' / ')}):`, m.funktion || 'Ratsmitglied');
      if (!MITGLIED_FUNKTIONEN.includes(f)) f = 'Ratsmitglied';
      store.saveMitglied({ ...m, vorname: v.trim(), nachname: n.trim(), funktion: f });
      refresh();
    };

    const vornameInput = el('input', { type: 'text', placeholder: 'Vorname' });
    vornameInput.oninput = e => neuVorname = e.target.value;
    const nachnameInput = el('input', { type: 'text', placeholder: 'Nachname' });
    nachnameInput.oninput = e => neuNachname = e.target.value;

    const funktionSelect = el('select', {});
    for (const f of MITGLIED_FUNKTIONEN) {
      funktionSelect.appendChild(el('option', { value: f, selected: f === neuFunktion }, f));
    }
    funktionSelect.onchange = e => neuFunktion = e.target.value;

    const formCard = el('div', { class: 'card' }, [
      el('h2', {}, 'Neues Mitglied'),
      el('div', { class: 'row' }, [
        el('div', {}, [el('label', {}, 'Vorname'), vornameInput]),
        el('div', {}, [el('label', {}, 'Nachname'), nachnameInput]),
        el('div', {}, [el('label', {}, 'Funktion'), funktionSelect]),
        el('div', { style: 'display:flex; align-items:flex-end;' }, el('button', { class: 'btn-primary', onClick: onAdd }, 'Hinzufügen')),
      ]),
    ]);

    const listCard = el('div', { class: 'card', style: 'padding:0' });
    if (mitglieder.length === 0) {
      listCard.appendChild(el('div', { class: 'empty' }, 'Noch keine Ratsmitglieder angelegt.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Vorname'),
        el('th', {}, 'Nachname'),
        el('th', {}, 'Funktion'),
        el('th', {}, 'Status'),
        el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      for (const m of mitglieder) {
        tbody.appendChild(el('tr', {}, [
          el('td', {}, m.vorname || '—'),
          el('td', {}, m.nachname || '—'),
          el('td', {}, [el('span', { class: 'tag' }, m.funktion || 'Ratsmitglied')]),
          el('td', {}, [el('span', { class: 'tag ' + (m.aktiv ? 'done' : '') }, m.aktiv ? 'aktiv' : 'inaktiv')]),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm', onClick: () => onEdit(m) }, 'Bearbeiten'),
            ' ',
            el('button', { class: 'btn-sm', onClick: () => onToggle(m) }, m.aktiv ? 'Deaktivieren' : 'Aktivieren'),
            ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(m) }, 'Löschen'),
          ]),
        ]));
      }
      table.appendChild(tbody);
      listCard.appendChild(table);
    }

    mount.appendChild(el('h2', {}, 'Ratsmitglieder'));
    mount.appendChild(el('p', { class: 'help' }, 'Einmalig pflegen — pro Sitzung wird dann nur noch An-/Abwesenheit gesetzt.'));
    mount.appendChild(formCard);
    mount.appendChild(listCard);
  }

  GR.views = GR.views || {};
  GR.views.renderStammdaten = renderStammdaten;
})();
