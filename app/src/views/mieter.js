(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog } = GR.ui;
  const { emptyMieter, fullNameMieter } = GR.models;

  const ANREDEN = ['', 'Herr', 'Frau', 'Familie', 'Firma'];

  // Felder eines Mieters als Formular. Liefert ein Objekt mit .node und .read().
  function mieterFormFields(mieter) {
    const m = { ...emptyMieter(), ...mieter };
    const anredeSel = el('select', {});
    for (const a of ANREDEN) anredeSel.appendChild(el('option', { value: a, selected: a === (m.anrede || '') }, a || '—'));
    const vorname = el('input', { type: 'text', value: m.vorname || '' });
    const nachname = el('input', { type: 'text', value: m.nachname || '' });
    const strasse = el('input', { type: 'text', value: m.strasse || '' });
    const plz = el('input', { type: 'text', value: m.plz || '' });
    const ort = el('input', { type: 'text', value: m.ort || '' });
    const telefon = el('input', { type: 'text', value: m.telefon || '' });
    const email = el('input', { type: 'text', value: m.email || '' });
    const notiz = el('textarea', {}, m.notiz || '');
    const ortsfremd = el('input', { type: 'checkbox', checked: !!m.ortsfremd });

    const node = el('div', {}, [
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Anrede'), anredeSel]),
        el('div', {}, [el('label', {}, 'Telefon'), telefon]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Vorname'), vorname]),
        el('div', {}, [el('label', {}, 'Nachname'), nachname]),
      ]),
      el('div', {}, [el('label', {}, 'Straße & Hausnummer'), strasse]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'PLZ'), plz]),
        el('div', {}, [el('label', {}, 'Ort'), ort]),
      ]),
      el('div', {}, [el('label', {}, 'E-Mail'), email]),
      el('label', { style: 'display:flex; gap:8px; align-items:center; margin-top:8px;' }, [ortsfremd, ' Ortsfremd (nicht aus der Gemeinde – höhere Grundmiete)']),
      el('div', { style: 'margin-top:8px;' }, [el('label', {}, 'Notiz'), notiz]),
    ]);

    return {
      node,
      read() {
        return {
          ...m,
          anrede: anredeSel.value,
          vorname: vorname.value.trim(),
          nachname: nachname.value.trim(),
          strasse: strasse.value.trim(),
          plz: plz.value.trim(),
          ort: ort.value.trim(),
          telefon: telefon.value.trim(),
          email: email.value.trim(),
          notiz: notiz.value,
          ortsfremd: ortsfremd.checked,
        };
      },
    };
  }

  // Modaler Dialog zum Anlegen/Bearbeiten. onSaved(mieter) nach dem Speichern.
  function dialog(prefill, onSaved) {
    const isNew = !prefill || !prefill.id;
    const base = isNew ? { ...emptyMieter(), ...(prefill || {}) } : prefill;
    const form = mieterFormFields(base);

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();

    const onSave = () => {
      const m = form.read();
      if (!m.vorname && !m.nachname) return toast('Bitte mindestens einen Namen eingeben');
      store.saveMieter(m);
      toast(isNew ? 'Mieter angelegt' : 'Mieter gespeichert');
      close();
      if (onSaved) onSaved(m);
    };

    const box = el('div', { class: 'modal' }, [
      el('h3', {}, isNew ? 'Neuer Mieter' : 'Mieter bearbeiten'),
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

  function renderMieter(mount) {
    function refresh() { mount.innerHTML = ''; renderMieter(mount); }

    const mieter = store.listMieter().sort((a, b) =>
      (a.nachname || '').localeCompare(b.nachname || '', 'de') || (a.vorname || '').localeCompare(b.vorname || '', 'de'));

    const onDelete = m => {
      if (!confirmDialog(`Mieter „${fullNameMieter(m)}" wirklich löschen?`)) return;
      store.deleteMieter(m.id);
      refresh();
    };

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/vermietung' }, '← Vermietungen'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-primary', onClick: () => dialog(null, refresh) }, '+ Neuer Mieter'),
    ]));

    mount.appendChild(el('h2', {}, 'Mieter'));
    mount.appendChild(el('p', { class: 'help' }, 'Einmal erfasste Mieter stehen bei jeder weiteren Vermietung zur Auswahl.'));

    const listCard = el('div', { class: 'card', style: 'padding:0' });
    if (mieter.length === 0) {
      listCard.appendChild(el('div', { class: 'empty' }, 'Noch keine Mieter angelegt.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Name'), el('th', {}, 'Anschrift'), el('th', {}, 'Kontakt'), el('th', {}, 'Herkunft'), el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      for (const m of mieter) {
        const anschrift = [m.strasse, [m.plz, m.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        const kontakt = [m.telefon, m.email].filter(Boolean).join(' · ');
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [el('strong', {}, fullNameMieter(m) || '—'), m.anrede ? el('div', { class: 'help' }, m.anrede) : null]),
          el('td', {}, anschrift || '—'),
          el('td', {}, kontakt || '—'),
          el('td', {}, [el('span', { class: 'tag ' + (m.ortsfremd ? '' : 'done') }, m.ortsfremd ? 'ortsfremd' : 'Anwohner')]),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm', onClick: () => dialog(m, refresh) }, 'Bearbeiten'),
            ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(m) }, 'Löschen'),
          ]),
        ]));
      }
      table.appendChild(tbody);
      listCard.appendChild(table);
    }
    mount.appendChild(listCard);
  }

  GR.views = GR.views || {};
  GR.views.renderMieter = renderMieter;
  GR.mieter = { dialog, mieterFormFields };
})();
