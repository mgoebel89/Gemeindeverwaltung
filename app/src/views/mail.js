(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store, roles } = GR;
  const { el, toast, formatDatum } = GR.ui;
  const M = GR.models;

  // Modul „E-Mail": bewusst KEIN Mailclient-Ersatz, sondern die Brücke zwischen
  // Postfach und Vorgangsakte. Angezeigt wird nur die INBOX; der Gewinn liegt im
  // Zuordnen: eine Nachricht wandert als Historieneintrag in einen Vorgang,
  // ausgewählte Anhänge nach Paperless, und geantwortet wird aus dem Vorgang
  // heraus. Zugangsdaten liegen serverseitig (backend/mail.js).

  const SEITE = 50;

  function datumZeit(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const heute = new Date();
    const gleicherTag = d.toDateString() === heute.toDateString();
    const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return gleicherTag ? uhr : d.toLocaleDateString('de-DE') + ' ' + uhr;
  }
  function kuerzen(s, n) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + ' …' : t;
  }

  // Sortierung explizit statt implizit: das Umschlagsdatum mancher Server ist
  // unzuverlässig, deshalb soll nachvollziehbar sein, wonach geordnet wird.
  const SORTEN = {
    '-datum': { label: 'Neueste zuerst', cmp: (a, b) => zeit(b) - zeit(a) },
    'datum': { label: 'Älteste zuerst', cmp: (a, b) => zeit(a) - zeit(b) },
    'von': { label: 'Absender A–Z', cmp: (a, b) => String(a.von || '').localeCompare(String(b.von || ''), 'de') },
    'betreff': { label: 'Betreff A–Z', cmp: (a, b) => String(a.betreff || '').localeCompare(String(b.betreff || ''), 'de') },
  };
  // Ohne Datum ans Ende sortieren statt zufällig dazwischen.
  function zeit(m) {
    const t = m && m.datum ? Date.parse(m.datum) : NaN;
    return isNaN(t) ? 0 : t;
  }

  // ===================== Posteingang =====================
  function renderMail(mount) {
    function refresh() { mount.innerHTML = ''; renderMail(mount); }

    const sucheI = el('input', { type: 'search', placeholder: 'Betreff oder Absender suchen …' });
    let sortKey = '-datum';
    try { sortKey = localStorage.getItem('gr.mailSort') || '-datum'; } catch (_) {}
    if (!SORTEN[sortKey]) sortKey = '-datum';
    const sortSel = el('select', {}, Object.keys(SORTEN).map(k =>
      el('option', { value: k, selected: k === sortKey }, SORTEN[k].label)));
    const ladenBtn = el('button', { class: 'btn-sm' }, '↻ Aktualisieren');
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('h2', { style: 'margin:0;' }, 'Posteingang'),
      el('div', { class: 'spacer' }),
      sucheI, sortSel, ladenBtn,
      el('a', { class: 'btn btn-sm', href: '#/einstellungen' }, 'Zugang'),
    ]));

    // Zweispaltig: Liste links, Vorschau rechts. Auf schmalen Geräten stapeln
    // sich beide (siehe styles.css) und die Vorschau rückt unter die Liste.
    const card = el('div', { class: 'card mail-split' });
    const linkeSpalte = el('div', { class: 'mail-spalte' });
    const liste = el('div', { class: 'mail-liste' });
    const status = el('div', { class: 'empty' }, 'Wird geladen …');
    const mehrBtn = el('button', { class: 'btn-sm', style: 'margin-top:10px;' }, 'Mehr laden');
    mehrBtn.style.display = 'none';
    linkeSpalte.appendChild(status);
    linkeSpalte.appendChild(liste);
    linkeSpalte.appendChild(mehrBtn);
    const vorschau = el('div', { class: 'mail-vorschau' });
    card.appendChild(linkeSpalte);
    card.appendChild(vorschau);
    mount.appendChild(card);

    let limit = SEITE;
    let geladen = [];
    let aktiveUid = null;

    const zeilenNachUid = new Map();

    // Auswahl nur ummarkieren statt die Liste neu zu bauen – sonst springt bei
    // jedem Klick die Scroll-Position zurück.
    function markiere(uid) {
      aktiveUid = uid;
      for (const [u, row] of zeilenNachUid) row.classList.toggle('mail-aktiv', u === uid);
    }

    function zeichneListe() {
      liste.innerHTML = '';
      zeilenNachUid.clear();
      const sortiert = geladen.slice().sort(SORTEN[sortKey].cmp);
      for (const m of sortiert) {
        const row = zeile(m);
        row.classList.toggle('mail-aktiv', m.uid === aktiveUid);
        // Einfacher Klick zeigt die Vorschau, Doppelklick öffnet das Fenster.
        row.addEventListener('click', () => { markiere(m.uid); zeigeVorschau(m); });
        row.addEventListener('dblclick', () => openNachricht(m.uid, refresh));
        row.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); openNachricht(m.uid, refresh); }
        });
        zeilenNachUid.set(m.uid, row);
        liste.appendChild(row);
      }
    }

    function leereVorschau(text) {
      vorschau.innerHTML = '';
      vorschau.appendChild(el('div', { class: 'empty' }, text));
    }

    let vorschauLauf = 0;
    async function zeigeVorschau(m) {
      const lauf = ++vorschauLauf;
      vorschau.innerHTML = '';
      vorschau.appendChild(el('div', { class: 'empty' }, 'Wird geladen …'));
      try {
        const voll = await GR.api.getMail(m.uid);
        if (lauf !== vorschauLauf) return; // schneller Klick weiter – Antwort verwerfen
        vorschau.innerHTML = '';
        vorschau.appendChild(el('div', { class: 'mail-vorschau-kopf' }, [
          el('strong', {}, voll.betreff || '(kein Betreff)'),
          el('div', { class: 'help' }, voll.von || '—'),
          el('div', { class: 'help' }, datumZeit(voll.datum)),
        ]));
        vorschau.appendChild(el('pre', { class: 'mail-text mail-vorschau-text' }, voll.text || '(kein Textinhalt)'));
        if ((voll.anhaenge || []).length) {
          vorschau.appendChild(el('div', { class: 'mail-anhaenge' }, voll.anhaenge.map(a =>
            el('a', {
              class: 'mail-anhang', href: GR.api.mailAttachmentUrl(voll.uid, a.index),
              target: '_blank', rel: 'noopener',
            }, `📎 ${a.filename}`))));
        }
        vorschau.appendChild(el('div', { class: 'toolbar', style: 'margin:12px 0 0;' }, [
          el('button', { class: 'btn-sm btn-primary', onClick: () => openZuordnen(voll) }, '📁 Zu Vorgang'),
          el('button', { class: 'btn-sm', onClick: () => openAntwort(voll, null) }, '↩ Antworten'),
          el('div', { class: 'spacer', style: 'flex:1;' }),
          el('button', { class: 'btn-sm', onClick: () => openNachricht(voll.uid, refresh) }, '⤢ Großes Fenster'),
        ]));
      } catch (err) {
        if (lauf !== vorschauLauf) return;
        vorschau.innerHTML = '';
        vorschau.appendChild(el('div', { class: 'warn' }, 'Nachricht konnte nicht geladen werden: ' + err.message));
      }
    }

    async function laden() {
      status.style.display = '';
      status.className = 'empty';
      status.textContent = 'Wird geladen …';
      liste.innerHTML = '';
      mehrBtn.style.display = 'none';
      leereVorschau('Nachricht anklicken für die Vorschau, Doppelklick öffnet sie groß.');
      try {
        const res = await GR.api.listMails({ limit, search: sucheI.value.trim() });
        geladen = res.messages || [];
        if (!geladen.length) {
          status.textContent = sucheI.value.trim() ? 'Keine Treffer.' : 'Posteingang ist leer.';
          return;
        }
        status.style.display = 'none';
        aktiveUid = null;
        zeichneListe();
        mehrBtn.style.display = geladen.length >= limit ? '' : 'none';
      } catch (err) {
        status.className = 'warn';
        status.textContent = 'Postfach nicht erreichbar: ' + err.message
          + ' — Zugang unter Einstellungen → E-Mail prüfen.';
      }
    }

    sortSel.onchange = () => {
      sortKey = SORTEN[sortSel.value] ? sortSel.value : '-datum';
      try { localStorage.setItem('gr.mailSort', sortKey); } catch (_) {}
      zeichneListe();
    };
    ladenBtn.onclick = laden;
    mehrBtn.onclick = () => { limit += SEITE; laden(); };
    let t = null;
    sucheI.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { limit = SEITE; laden(); }, 400); });
    sucheI.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { clearTimeout(t); limit = SEITE; laden(); } });

    laden();
    return mount;
  }

  // Reine Zeilendarstellung – die Klick-Behandlung hängt der Aufrufer an, weil
  // sie sich zwischen Posteingang (Vorschau) und Auswahlliste unterscheidet.
  function zeile(m) {
    const row = el('div', {
      class: 'mail-zeile' + (m.gelesen ? '' : ' mail-ungelesen'),
      role: 'button', tabindex: '0', title: 'Klicken für Vorschau, Doppelklick öffnet die Nachricht',
    });
    row.appendChild(el('div', { class: 'mail-von' }, kuerzen(m.von, 40)));
    row.appendChild(el('div', { class: 'mail-betreff' }, [
      el('span', {}, kuerzen(m.betreff, 90)),
      m.hatAnhang ? el('span', { class: 'mail-clip', title: 'Anhang' }, '📎') : null,
    ].filter(Boolean)));
    row.appendChild(el('div', { class: 'mail-datum' }, datumZeit(m.datum)));
    return row;
  }

  // ===================== Nachricht ansehen =====================
  function openNachricht(uid, onGeaendert) {
    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal mail-modal' });
    overlay.appendChild(modal);
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); if (onGeaendert) onGeaendert(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

    modal.appendChild(el('div', { class: 'empty' }, 'Nachricht wird geladen …'));
    document.body.appendChild(overlay);

    GR.api.getMail(uid).then(msg => {
      modal.innerHTML = '';
      modal.appendChild(el('h3', {}, msg.betreff || '(kein Betreff)'));
      modal.appendChild(el('div', { class: 'mail-kopf' }, [
        el('div', {}, [el('span', { class: 'mail-label' }, 'Von'), el('span', {}, msg.von || '—')]),
        el('div', {}, [el('span', { class: 'mail-label' }, 'An'), el('span', {}, msg.an || '—')]),
        msg.cc ? el('div', {}, [el('span', { class: 'mail-label' }, 'Kopie'), el('span', {}, msg.cc)]) : null,
        el('div', {}, [el('span', { class: 'mail-label' }, 'Datum'), el('span', {}, datumZeit(msg.datum))]),
      ].filter(Boolean)));

      modal.appendChild(el('pre', { class: 'mail-text' }, msg.text || '(kein Textinhalt)'));

      if ((msg.anhaenge || []).length) {
        modal.appendChild(el('div', { class: 'vg-label', style: 'margin-top:10px;' }, 'Anhänge'));
        modal.appendChild(el('div', { class: 'mail-anhaenge' }, msg.anhaenge.map(a =>
          el('a', {
            class: 'mail-anhang', href: GR.api.mailAttachmentUrl(msg.uid, a.index),
            target: '_blank', rel: 'noopener',
          }, `📎 ${a.filename}${a.size ? ' (' + Math.round(a.size / 1024) + ' kB)' : ''}`))));
      }

      modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
        el('button', {
          class: 'btn-primary',
          onClick: () => { close(); openZuordnen(msg); },
        }, '📁 Zu Vorgang zuordnen'),
        el('button', { onClick: () => { close(); openAntwort(msg, null); } }, '↩ Antworten'),
        el('div', { class: 'spacer', style: 'flex:1;' }),
        el('button', { onClick: close }, 'Schließen'),
      ]));
    }).catch(err => {
      modal.innerHTML = '';
      modal.appendChild(el('div', { class: 'warn' }, 'Nachricht konnte nicht geladen werden: ' + err.message));
      modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:12px; margin-bottom:0;' }, [
        el('button', { onClick: close }, 'Schließen'),
      ]));
    });
  }

  // ===================== Zuordnen =====================
  // Vorgang wählen + Anhänge anhaken. Angehakte Anhänge laufen nacheinander
  // durch den Paperless-Assistenten und werden am Eintrag verknüpft.
  function openZuordnen(msg, vorgangVorgabe) {
    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal mail-modal' });
    overlay.appendChild(modal);
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

    modal.appendChild(el('h3', {}, 'E-Mail einem Vorgang zuordnen'));
    modal.appendChild(el('p', { class: 'help' }, kuerzen(msg.betreff, 90) + ' · ' + kuerzen(msg.von, 50)));

    const kandidaten = roles.filterVorgaenge(store.listVorgaenge())
      .slice().sort((a, b) => String(a.titel || '').localeCompare(String(b.titel || ''), 'de'));
    const sel = el('select', { class: 'input' }, [
      el('option', { value: '' }, '– Vorgang wählen –'),
      ...kandidaten.map(x => el('option', {
        value: x.id, selected: vorgangVorgabe === x.id,
      }, (x.titel || '(ohne Titel)') + (x.kategorie ? ' · ' + x.kategorie : ''))),
    ]);
    modal.appendChild(el('div', { class: 'vg-field', style: 'margin-top:10px;' }, [
      el('label', { class: 'vg-label' }, 'Vorgang'), sel,
    ]));

    const anhSet = new Set();
    if ((msg.anhaenge || []).length) {
      modal.appendChild(el('div', { class: 'vg-label', style: 'margin-top:12px;' }, 'Anhänge nach Paperless'));
      modal.appendChild(el('p', { class: 'help', style: 'margin:0 0 6px;' },
        'Nur anhaken, was in die Ablage gehört – Signaturbilder und Logos besser nicht.'));
      const box = el('div', {});
      for (const a of msg.anhaenge) {
        const cb = el('input', { type: 'checkbox' });
        cb.onchange = () => { if (cb.checked) anhSet.add(a.index); else anhSet.delete(a.index); };
        box.appendChild(el('label', { class: 'mail-anhang-wahl' }, [
          cb, el('span', {}, `📎 ${a.filename}`),
          el('span', { class: 'help' }, a.size ? Math.round(a.size / 1024) + ' kB' : ''),
        ]));
      }
      modal.appendChild(box);
    }

    const status = el('div', { class: 'help', style: 'margin-top:8px;' }, '');
    modal.appendChild(status);

    const okBtn = el('button', { class: 'btn-primary' }, 'Zuordnen');
    okBtn.onclick = () => {
      const v = store.getVorgang(sel.value);
      if (!v) { status.textContent = 'Bitte einen Vorgang wählen.'; return; }
      okBtn.disabled = true;
      const eintrag = eintragAusNachricht(msg);
      v.historie.push(eintrag);
      store.saveVorgang(v);
      close();
      toast('E-Mail dem Vorgang „' + (v.titel || '') + '" zugeordnet');
      anhaengeAblegen(v, eintrag, msg, [...anhSet]);
    };
    modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
      okBtn, el('button', { onClick: close }, 'Abbrechen'),
    ]));
    document.body.appendChild(overlay);
  }

  // Eingehende Nachricht → Historieneintrag. Die Kopie im Vorgang ist Absicht:
  // wird die Mail im Postfach später verschoben oder gelöscht, bleibt die Akte
  // vollständig.
  function eintragAusNachricht(msg) {
    return Object.assign(M.emptyHistorieEintrag('email'), {
      datum: (msg.datum || new Date().toISOString()).slice(0, 10),
      richtung: 'ein',
      von: msg.von || '', an: msg.an || '', cc: msg.cc || '',
      betreff: msg.betreff || '',
      text: msg.text || '',
      messageId: msg.messageId || '',
      references: msg.references || [],
      paperlessDocs: [],
    });
  }

  // Angehakte Anhänge nacheinander durch den Paperless-Assistenten schicken.
  async function anhaengeAblegen(v, eintrag, msg, indizes) {
    for (const idx of indizes) {
      const a = (msg.anhaenge || []).find(x => x.index === idx);
      if (!a) continue;
      try {
        const res = await fetch(GR.api.mailAttachmentUrl(msg.uid, idx));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const file = new File([blob], a.filename, { type: a.contentType || blob.type });
        await new Promise((fertig) => {
          GR.ui.uploadPaperlessDocument({
            presetFile: file,
            title: 'Anhang ablegen: ' + a.filename,
            prefillTitle: (v.titel ? v.titel + ' – ' : '') + String(a.filename).replace(/\.[^.]+$/, ''),
            onUploaded: (doc) => {
              // Frischen Vorgang holen – zwischenzeitliche WS-Updates nicht überschreiben.
              const akt = store.getVorgang(v.id);
              const e = akt && (akt.historie || []).find(x => x.id === eintrag.id);
              if (e) {
                if (!Array.isArray(e.paperlessDocs)) e.paperlessDocs = [];
                e.paperlessDocs.push({ id: doc.id, title: doc.title || a.filename });
                store.saveVorgang(akt);
              }
              fertig();
            },
          });
          // Bricht der Nutzer den Assistenten ab, hängt die Kette sonst fest.
          const beobachter = setInterval(() => {
            if (!document.querySelector('.wiz-overlay, .wiz')) { clearInterval(beobachter); fertig(); }
          }, 800);
        });
      } catch (err) {
        toast('Anhang „' + a.filename + '" konnte nicht abgelegt werden: ' + err.message, 4000);
      }
    }
  }

  // ===================== Antworten =====================
  // `vorgang` gesetzt ⇒ die gesendete Nachricht wandert als Historieneintrag
  // in genau diesen Vorgang.
  function openAntwort(msg, vorgang, onFertig) {
    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal mail-modal' });
    overlay.appendChild(modal);
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

    const empfaenger = (msg.vonListe && msg.vonListe.length)
      ? msg.vonListe.map(x => x.address).filter(Boolean).join(', ')
      : (msg.von || '');
    const betreffVor = /^re:/i.test(msg.betreff || '') ? (msg.betreff || '') : 'Re: ' + (msg.betreff || '');
    const zitat = String(msg.text || '').split('\n').map(z => '> ' + z).join('\n');

    const anI = el('input', { class: 'input', type: 'text', value: empfaenger });
    const ccI = el('input', { class: 'input', type: 'text', placeholder: 'Kopie (optional)' });
    const betreffI = el('input', { class: 'input', type: 'text', value: betreffVor });
    const textI = el('textarea', { class: 'input', rows: '10' });
    textI.value = '\n\n' + (msg.von ? `Am ${datumZeit(msg.datum)} schrieb ${msg.von}:\n` : '') + zitat;

    modal.appendChild(el('h3', {}, 'Antwort schreiben'));
    modal.appendChild(el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'An'), anI]));
    modal.appendChild(el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Kopie'), ccI]));
    modal.appendChild(el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Betreff'), betreffI]));
    modal.appendChild(el('div', { class: 'vg-field' }, [el('label', { class: 'vg-label' }, 'Text'), textI]));
    if (vorgang) {
      modal.appendChild(el('p', { class: 'help' },
        'Die gesendete Nachricht wird im Vorgang „' + (vorgang.titel || '') + '" mitgeführt.'));
    }
    const status = el('div', { class: 'help', style: 'margin-top:8px;' }, '');
    modal.appendChild(status);

    const sendBtn = el('button', { class: 'btn-primary' }, 'Senden');
    sendBtn.onclick = async () => {
      if (!anI.value.trim()) { status.textContent = 'Bitte einen Empfänger angeben.'; return; }
      sendBtn.disabled = true;
      status.textContent = 'Wird gesendet …';
      try {
        const res = await GR.api.sendMail({
          an: anI.value.trim(), cc: ccI.value.trim(),
          betreff: betreffI.value.trim(), text: textI.value,
          inReplyTo: msg.messageId || undefined,
          references: msg.references || [],
        });
        if (vorgang) {
          const akt = store.getVorgang(vorgang.id);
          if (akt) {
            akt.historie.push(Object.assign(M.emptyHistorieEintrag('email'), {
              datum: (res.gesendetAm || new Date().toISOString()).slice(0, 10),
              richtung: 'aus',
              von: '', an: res.an || anI.value.trim(), cc: ccI.value.trim(),
              betreff: res.betreff || betreffI.value.trim(),
              text: textI.value,
              messageId: res.messageId || '',
              references: [],
              paperlessDocs: [],
            }));
            store.saveVorgang(akt);
          }
        }
        close();
        toast(res.inSentOrdner ? 'Gesendet und in „Gesendet" abgelegt' : 'Gesendet (Ablage in „Gesendet" nicht möglich)');
        if (onFertig) onFertig();
      } catch (err) {
        sendBtn.disabled = false;
        status.textContent = 'Versand fehlgeschlagen: ' + err.message;
      }
    };
    modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
      sendBtn, el('button', { onClick: close }, 'Abbrechen'),
    ]));
    document.body.appendChild(overlay);
  }

  // ===================== Auswahl aus dem Vorgang heraus =====================
  // Öffnet den Posteingang als Auswahlliste; `cb(vollNachricht)` bekommt die
  // geladene Nachricht. Wird von views/vorgaenge.js genutzt.
  function openNachrichtenWahl(cb) {
    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal mail-modal' });
    overlay.appendChild(modal);
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

    modal.appendChild(el('h3', {}, 'E-Mail aus dem Posteingang wählen'));
    const sucheI = el('input', { class: 'input', type: 'search', placeholder: 'Betreff oder Absender suchen …' });
    modal.appendChild(el('div', { class: 'vg-field' }, [sucheI]));
    const status = el('div', { class: 'empty' }, 'Wird geladen …');
    const liste = el('div', { class: 'mail-liste' });
    modal.appendChild(status);
    modal.appendChild(liste);
    modal.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
      el('button', { onClick: close }, 'Abbrechen'),
    ]));

    async function laden() {
      status.style.display = ''; status.className = 'empty'; status.textContent = 'Wird geladen …';
      liste.innerHTML = '';
      try {
        const res = await GR.api.listMails({ limit: SEITE, search: sucheI.value.trim() });
        const msgs = res.messages || [];
        if (!msgs.length) { status.textContent = 'Keine Nachrichten gefunden.'; return; }
        status.style.display = 'none';
        for (const m of msgs) {
          const row = zeile(m);
          row.title = 'Diese Nachricht zuordnen';
          row.addEventListener('click', async () => {
            status.style.display = ''; status.textContent = 'Nachricht wird geladen …';
            try {
              const voll = await GR.api.getMail(m.uid);
              close();
              cb(voll);
            } catch (err) { status.className = 'warn'; status.textContent = 'Fehler: ' + err.message; }
          });
          liste.appendChild(row);
        }
      } catch (err) {
        status.className = 'warn';
        status.textContent = 'Postfach nicht erreichbar: ' + err.message;
      }
    }
    let t = null;
    sucheI.addEventListener('input', () => { clearTimeout(t); t = setTimeout(laden, 400); });
    laden();
    document.body.appendChild(overlay);
  }

  GR.views = GR.views || {};
  GR.views.renderMail = renderMail;
  // Für das Vorgangs-Modul
  GR.mailUi = { openNachrichtenWahl, openZuordnen, openAntwort, eintragAusNachricht, anhaengeAblegen, datumZeit };
})();
