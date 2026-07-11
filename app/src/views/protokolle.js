(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, toast } = GR.ui;
  const { store } = GR;
  const { defaultUebergabeCheckliste } = GR.models;

  function pid() { return (crypto.randomUUID && crypto.randomUUID()) || ('p-' + Math.random().toString(36).slice(2) + Date.now().toString(36)); }

  // Konfiguration der Übergabe-/Abnahme-Checklisten je Objekt (Vorlage).
  // Die Vorlage wird beim Start eines Protokolls in die Vermietung kopiert.
  function renderProtokolle(mount) {
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vermietung' }, '← Vermietung'),
    ]));
    mount.appendChild(el('h2', {}, 'Übergabeprotokolle – Checklisten je Objekt'));
    mount.appendChild(el('p', { class: 'help' }, 'Lege je Objekt die Prüfpunkte für Übergabe und Abnahme fest. Diese Vorlage wird beim Start eines Protokolls in die jeweilige Vermietung kopiert (eingefroren) – spätere Änderungen wirken nur auf neue Protokolle.'));

    const raeume = store.listRaeume();
    if (!raeume.length) {
      mount.appendChild(el('div', { class: 'card empty' }, 'Keine Objekte vorhanden. Objekte werden unter Einstellungen → Vermietung angelegt.'));
      return;
    }
    for (const r of raeume) mount.appendChild(buildObjektCard(r));
  }

  function buildObjektCard(r) {
    if (!r.uebergabeCheckliste) r.uebergabeCheckliste = defaultUebergabeCheckliste();
    const save = () => store.saveRaum(r);
    const listBox = el('div', {});

    function renderPoints() {
      listBox.innerHTML = '';
      const pts = r.uebergabeCheckliste;
      if (!pts.length) { listBox.appendChild(el('p', { class: 'help', style: 'margin:0 0 8px;' }, 'Noch keine Punkte – füge welche hinzu.')); return; }
      pts.forEach((p, i) => {
        const input = el('input', { type: 'text', value: p.text || '', placeholder: 'Prüfpunkt' });
        input.oninput = () => { p.text = input.value; };
        input.onchange = save;
        const up = el('button', { class: 'btn-sm', title: 'nach oben', disabled: i === 0, onClick: () => { [pts[i - 1], pts[i]] = [pts[i], pts[i - 1]]; save(); renderPoints(); } }, '↑');
        const down = el('button', { class: 'btn-sm', title: 'nach unten', disabled: i === pts.length - 1, onClick: () => { [pts[i + 1], pts[i]] = [pts[i], pts[i + 1]]; save(); renderPoints(); } }, '↓');
        const del = el('button', { class: 'btn-sm btn-danger', title: 'löschen', onClick: () => { pts.splice(i, 1); save(); renderPoints(); } }, '✕');
        listBox.appendChild(el('div', { class: 'prot-edit-row' }, [
          el('div', { style: 'flex:1; min-width:0;' }, input), up, down, del,
        ]));
      });
    }
    renderPoints();

    const addBtn = el('button', { class: 'btn-sm', onClick: () => {
      r.uebergabeCheckliste.push({ id: pid(), text: '' });
      save(); renderPoints();
      const inputs = listBox.querySelectorAll('input'); if (inputs.length) inputs[inputs.length - 1].focus();
    } }, '+ Punkt hinzufügen');

    return el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;' }, r.name || 'Objekt'),
      listBox,
      el('div', { style: 'margin-top:8px;' }, addBtn),
    ]);
  }

  GR.views = GR.views || {};
  GR.views.renderProtokolle = renderProtokolle;
})();
