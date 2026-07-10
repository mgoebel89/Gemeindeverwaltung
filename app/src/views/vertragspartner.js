(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog } = GR.ui;
  const { emptyVertragspartner } = GR.models;

  // Felder eines Vertragspartners als Formular. Liefert ein Objekt mit .node und .read().
  function vertragspartnerFormFields(partner) {
    const p = { ...emptyVertragspartner(), ...partner };
    const name = el('input', { type: 'text', value: p.name || '' });
    const ansprechpartner = el('input', { type: 'text', value: p.ansprechpartner || '' });
    const telefon = el('input', { type: 'text', value: p.telefon || '' });
    const email = el('input', { type: 'text', value: p.email || '' });
    const anschrift = el('textarea', {}, p.anschrift || '');
    const notiz = el('textarea', {}, p.notiz || '');

    const node = el('div', {}, [
      el('div', {}, [el('label', {}, 'Name / Firma'), name]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Ansprechpartner'), ansprechpartner]),
        el('div', {}, [el('label', {}, 'Telefon'), telefon]),
      ]),
      el('div', {}, [el('label', {}, 'E-Mail'), email]),
      el('div', {}, [el('label', {}, 'Anschrift'), anschrift]),
      el('div', { style: 'margin-top:8px;' }, [el('label', {}, 'Notiz'), notiz]),
    ]);

    return {
      node,
      read() {
        return {
          ...p,
          name: name.value.trim(),
          ansprechpartner: ansprechpartner.value.trim(),
          telefon: telefon.value.trim(),
          email: email.value.trim(),
          anschrift: anschrift.value,
          notiz: notiz.value,
        };
      },
    };
  }

  // Modaler Dialog zum Anlegen/Bearbeiten. onSaved(partner) nach dem Speichern.
  function dialog(prefill, onSaved) {
    const isNew = !prefill || !prefill.id;
    const base = isNew ? { ...emptyVertragspartner(), ...(prefill || {}) } : prefill;
    const form = vertragspartnerFormFields(base);

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();

    const onSave = () => {
      const p = form.read();
      if (!p.name) return toast('Bitte einen Namen eingeben');
      store.saveVertragspartner(p);
      toast(isNew ? 'Vertragspartner angelegt' : 'Vertragspartner gespeichert');
      close();
      if (onSaved) onSaved(p);
    };

    const box = el('div', { class: 'modal' }, [
      el('h3', {}, isNew ? 'Neuer Vertragspartner' : 'Vertragspartner bearbeiten'),
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

  function renderVertragspartner(mount) {
    function refresh() { mount.innerHTML = ''; renderVertragspartner(mount); }

    const partner = store.listVertragspartner().sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'de'));

    const onDelete = p => {
      if (!confirmDialog(`Vertragspartner „${p.name}" wirklich löschen?`)) return;
      store.deleteVertragspartner(p.id);
      refresh();
    };

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vertraege' }, '← Verträge'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-primary', onClick: () => dialog(null, refresh) }, '+ Neuer Vertragspartner'),
    ]));

    mount.appendChild(el('h2', {}, 'Vertragspartner'));
    mount.appendChild(el('p', { class: 'help' }, 'Einmal erfasste Partner stehen bei jedem weiteren Vertrag zur Auswahl.'));

    const listCard = el('div', { class: 'card', style: 'padding:0' });
    if (partner.length === 0) {
      listCard.appendChild(el('div', { class: 'empty' }, 'Noch keine Vertragspartner angelegt.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Name'), el('th', {}, 'Ansprechpartner'), el('th', {}, 'Kontakt'), el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      for (const p of partner) {
        const kontakt = [p.telefon, p.email].filter(Boolean).join(' · ');
        tbody.appendChild(el('tr', {}, [
          el('td', {}, el('strong', {}, p.name || '—')),
          el('td', {}, p.ansprechpartner || '—'),
          el('td', {}, kontakt || '—'),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm', onClick: () => dialog(p, refresh) }, 'Bearbeiten'),
            ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(p) }, 'Löschen'),
          ]),
        ]));
      }
      table.appendChild(tbody);
      listCard.appendChild(table);
    }
    mount.appendChild(listCard);
  }

  GR.views = GR.views || {};
  GR.views.renderVertragspartner = renderVertragspartner;
  GR.vertragspartner = { dialog, vertragspartnerFormFields };
})();
