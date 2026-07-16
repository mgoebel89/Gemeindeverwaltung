(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, toast, confirmDialog } = GR.ui;
  const { emptyArbeiter, arbeiterName, arbeiterZusatz, formatIban } = GR.models;

  // Stammdaten der Leistungserbringer (Modul Arbeitszeiten).
  // Bewusst EIN Typ statt Person/Firma-Umschalter: immer Vor-/Nachname, dazu ein
  // optionales Feld „Firma". Ist es gesetzt, ist die Firma der Anzeigename und
  // der Name der Ansprechpartner.

  function formFields(arbeiter) {
    const a = { ...emptyArbeiter(), ...arbeiter };
    const f = {};
    const mk = (key, type = 'text') => (f[key] = el('input', { type, value: a[key] || '' }));

    mk('firma'); mk('vorname'); mk('nachname');
    mk('strasse'); mk('plz'); mk('ort');
    mk('iban'); mk('kontoinhaber');
    mk('svNummer'); mk('steuerId'); mk('geburtsdatum', 'date');
    mk('telefon'); mk('email');
    const notiz = el('textarea', {}, a.notiz || '');
    const aktiv = el('input', { type: 'checkbox', checked: a.aktiv !== false });

    const node = el('div', {}, [
      el('div', {}, [
        el('label', {}, 'Firma (optional)'),
        f.firma,
        el('p', { class: 'help', style: 'margin:2px 0 0;' }, 'Ausgefüllt = die Firma erscheint als Name, die Person darunter als Ansprechpartner. Leer = normaler Gemeindearbeiter.'),
      ]),
      el('div', { class: 'grid-2', style: 'margin-top:10px;' }, [
        el('div', {}, [el('label', {}, 'Vorname'), f.vorname]),
        el('div', {}, [el('label', {}, 'Nachname'), f.nachname]),
      ]),
      el('div', {}, [el('label', {}, 'Straße & Hausnummer'), f.strasse]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'PLZ'), f.plz]),
        el('div', {}, [el('label', {}, 'Ort'), f.ort]),
      ]),
      el('h4', { style: 'margin:14px 0 4px;' }, 'Bankverbindung'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'IBAN'), f.iban]),
        el('div', {}, [el('label', {}, 'Kontoinhaber (falls abweichend)'), f.kontoinhaber]),
      ]),
      el('h4', { style: 'margin:14px 0 4px;' }, 'Weitere Angaben'),
      el('p', { class: 'help', style: 'margin:0 0 6px;' }, 'Alle optional – für die Abrechnung über die Verbandsgemeinde ggf. nötig.'),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Sozialversicherungsnummer'), f.svNummer]),
        el('div', {}, [el('label', {}, 'Steuer-ID'), f.steuerId]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', {}, [el('label', {}, 'Geburtsdatum'), f.geburtsdatum]),
        el('div', {}, [el('label', {}, 'Telefon'), f.telefon]),
      ]),
      el('div', {}, [el('label', {}, 'E-Mail'), f.email]),
      el('div', { style: 'margin-top:8px;' }, [el('label', {}, 'Notiz'), notiz]),
      el('label', { style: 'display:flex; gap:8px; align-items:center; margin-top:8px;' },
        [aktiv, ' Aktiv (erscheint bei der Erfassung zur Auswahl)']),
    ]);

    return {
      node,
      read() {
        const out = { ...a };
        for (const [k, input] of Object.entries(f)) out[k] = input.value.trim();
        out.notiz = notiz.value;
        out.aktiv = aktiv.checked;
        return out;
      },
    };
  }

  function dialog(prefill, onSaved) {
    const isNew = !prefill || !prefill.id;
    const base = isNew ? { ...emptyArbeiter(), ...(prefill || {}) } : prefill;
    const form = formFields(base);

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();

    const onSave = () => {
      const a = form.read();
      if (!a.vorname && !a.nachname && !a.firma) return toast('Bitte einen Namen oder eine Firma eingeben');
      store.saveArbeiter(a);
      toast(isNew ? 'Angelegt' : 'Gespeichert');
      close();
      if (onSaved) onSaved(a);
    };

    const box = el('div', { class: 'modal' }, [
      el('h3', {}, isNew ? 'Neuer Arbeiter / neue Firma' : 'Stammdaten bearbeiten'),
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

  function renderArbeiter(mount) {
    function refresh() { mount.innerHTML = ''; renderArbeiter(mount); }

    const liste = store.listArbeiter()
      .sort((a, b) => arbeiterName(a).localeCompare(arbeiterName(b), 'de'));

    const onDelete = (a) => {
      // Vorhandene Einträge würden ins Leere zeigen → nur ohne Erfassungen löschbar.
      const benutzt = store.listArbeitszeiten().some(z => z.arbeiterId === a.id);
      if (benutzt) {
        alert(`„${arbeiterName(a)}" hat bereits erfasste Arbeitszeiten und kann nicht gelöscht werden.\n\nStattdessen in den Stammdaten den Haken „Aktiv" entfernen – dann erscheint der Eintrag nicht mehr zur Auswahl, bleibt aber in alten Abrechnungen erhalten.`);
        return;
      }
      if (!confirmDialog(`„${arbeiterName(a)}" wirklich löschen?`)) return;
      store.deleteArbeiter(a.id);
      refresh();
    };

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn', href: '#/arbeitszeiten' }, '← Arbeitszeiten'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-primary', onClick: () => dialog(null, refresh) }, '+ Neuer Arbeiter / Firma'),
    ]));

    mount.appendChild(el('h2', {}, 'Arbeiter & Firmen'));
    mount.appendChild(el('p', { class: 'help' }, 'Wer Leistungen für die Gemeinde erbringt – Gemeindearbeiter oder beauftragte Firmen. Einmal erfasst, stehen sie bei jeder Zeiterfassung zur Auswahl.'));

    const listCard = el('div', { class: 'card', style: 'padding:0' });
    if (liste.length === 0) {
      listCard.appendChild(el('div', { class: 'empty' }, 'Noch niemand angelegt.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Name'), el('th', {}, 'Anschrift'), el('th', {}, 'Bankverbindung'),
        el('th', {}, 'Kontakt'), el('th', {}, 'Status'), el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      for (const a of liste) {
        const anschrift = [a.strasse, [a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        const kontakt = [a.telefon, a.email].filter(Boolean).join(' · ');
        const zusatz = arbeiterZusatz(a);
        const stunden = store.listArbeitszeiten()
          .filter(z => z.arbeiterId === a.id)
          .reduce((s, z) => s + (Number(z.stunden) || 0), 0);
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [
            el('strong', {}, arbeiterName(a)),
            zusatz ? el('div', { class: 'help' }, zusatz) : null,
            stunden ? el('div', { class: 'help' }, stunden.toLocaleString('de-DE') + ' Std. erfasst') : null,
          ]),
          el('td', {}, anschrift || '—'),
          el('td', {}, a.iban ? formatIban(a.iban) : '—'),
          el('td', {}, kontakt || '—'),
          el('td', {}, a.aktiv === false ? el('span', { class: 'tag' }, 'inaktiv') : el('span', { class: 'tag ok' }, 'aktiv')),
          el('td', { style: 'text-align:right; white-space:nowrap;' }, [
            el('button', { class: 'btn-sm', onClick: () => dialog(a, refresh) }, 'Bearbeiten'),
            ' ',
            el('button', { class: 'btn-sm btn-danger', onClick: () => onDelete(a) }, 'Löschen'),
          ]),
        ]));
      }
      table.appendChild(tbody);
      listCard.appendChild(table);
    }
    mount.appendChild(listCard);
  }

  GR.views = GR.views || {};
  GR.views.renderArbeiter = renderArbeiter;
  GR.arbeiterView = { dialog };
})();
