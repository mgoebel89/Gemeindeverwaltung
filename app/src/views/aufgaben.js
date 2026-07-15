(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { el, formatDatum, toast } = GR.ui;

  function globalProjektId() { const s = store.getSettings(); return s && s.vikunjaProjektId ? s.vikunjaProjektId : null; }

  // ---- Aufgaben (Vikunja) ----
  // Offene Aufgaben aus Vikunja, fällige zuerst, nach Zeitbucket gruppiert.
  // Abhaken (done) und neue Aufgaben anlegen laufen über den Backend-Proxy.
  function renderAufgaben(mount) {
    mount.appendChild(el('div', { class: 'toolbar', style: 'align-items:center;' }, [
      el('h2', { style: 'margin:0;' }, 'Aufgaben'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn-sm btn-primary', onClick: () => toggleForm() }, '＋ Aufgabe'),
      el('a', { class: 'btn btn-sm', href: '#/einstellungen' }, 'Vikunja verwalten'),
    ]));

    const formBox = el('div', {});
    mount.appendChild(formBox);
    const listBox = el('div', {});
    mount.appendChild(listBox);
    listBox.appendChild(el('p', { class: 'help' }, 'Aufgaben werden geladen…'));

    let formOpen = false;
    function toggleForm() { formOpen = !formOpen; renderForm(); }
    function renderForm() {
      formBox.innerHTML = '';
      if (!formOpen) return;
      formBox.appendChild(buildCreateForm(() => { formOpen = false; renderForm(); load(); }));
    }

    function load() {
      listBox.innerHTML = '';
      const pid = globalProjektId();
      if (!pid) {
        listBox.appendChild(el('div', { class: 'card' }, [
          el('p', { class: 'help', style: 'margin:0;' }, 'Es ist noch kein synchronisiertes Vikunja-Projekt gewählt. Bitte unter Einstellungen → Aufgaben ein Projekt festlegen.'),
        ]));
        return;
      }
      listBox.appendChild(el('p', { class: 'help' }, 'Aufgaben werden geladen…'));
      GR.api.listOpenTasks().then(res => {
        // Nur Aufgaben des app-weit gewählten Projekts anzeigen.
        const tasks = (res.tasks || []).filter(t => String(t.projectId) === String(pid));
        renderList(listBox, tasks, load);
      }).catch(err => {
        listBox.innerHTML = '';
        listBox.appendChild(el('div', { class: 'warn' }, 'Aufgaben konnten nicht geladen werden: ' + err.message +
          ' — Zugang unter Einstellungen → Aufgaben prüfen.'));
      });
    }
    load();
  }

  // --- Zeit-Buckets ---
  function isoDay(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function pad(n) { return String(n).padStart(2, '0'); }

  function bucketOf(dueIso, today, weekEnd) {
    if (!dueIso) return 4; // ohne Datum
    const d = new Date(dueIso); d.setHours(0, 0, 0, 0);
    if (d < today) return 0;        // überfällig
    if (d.getTime() === today.getTime()) return 1; // heute
    if (d <= weekEnd) return 2;     // diese Woche
    return 3;                        // später
  }
  const BUCKETS = [
    { key: 0, label: 'Überfällig', cls: 'is-overdue' },
    { key: 1, label: 'Heute', cls: 'is-today' },
    { key: 2, label: 'Diese Woche', cls: '' },
    { key: 3, label: 'Später', cls: '' },
    { key: 4, label: 'Ohne Datum', cls: '' },
  ];

  function renderList(mount, tasks, reload) {
    mount.innerHTML = '';
    if (!tasks.length) {
      mount.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'help', style: 'margin:0;' }, 'Keine offenen Aufgaben. 🎉'),
      ]));
      return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);

    const groups = new Map();
    for (const t of tasks) {
      const b = bucketOf(t.dueDate, today, weekEnd);
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b).push(t);
    }
    for (const def of BUCKETS) {
      const items = groups.get(def.key);
      if (!items || !items.length) continue;
      mount.appendChild(el('div', { class: 'aufg-group' }, [
        el('div', { class: 'aufg-group-head ' + def.cls }, [
          el('span', {}, def.label),
          el('span', { class: 'aufg-count' }, String(items.length)),
        ]),
        el('ul', { class: 'aufg-list' }, items.map(t => taskItem(t, def, reload))),
      ]));
    }
  }

  function taskItem(t, bucketDef, reload) {
    const cb = el('input', { type: 'checkbox', class: 'aufg-check', title: 'Als erledigt markieren' });
    const li = el('li', { class: 'aufg-item' });
    cb.onchange = () => {
      if (!cb.checked) return;
      cb.disabled = true;
      li.classList.add('is-done');
      GR.api.completeTask(t.id, true).then(() => {
        toast('Erledigt: ' + t.title);
        setTimeout(reload, 350);
      }).catch(err => {
        cb.disabled = false; cb.checked = false; li.classList.remove('is-done');
        toast('Fehler: ' + err.message);
      });
    };

    const meta = [];
    if (t.dueDate) meta.push((bucketDef.key === 0 ? '⚠ ' : '') + formatDatum(isoDay(new Date(t.dueDate))));
    if (t.identifier) meta.push(t.identifier);
    for (const l of (t.labels || [])) meta.push('🏷 ' + l.title);

    const main = el('span', {
      class: 'aufg-main',
      title: 'Zum Bearbeiten öffnen',
      onClick: () => openTaskDetail(t, reload),
    }, [
      el('span', { class: 'aufg-title' }, [
        priorityFlag(t.priority),
        el('span', {}, t.title),
      ]),
      meta.length ? el('span', { class: 'help', style: 'margin:0; display:block;' }, meta.join(' · ')) : null,
    ]);

    li.appendChild(cb);
    li.appendChild(main);
    return li;
  }

  function priorityFlag(p) {
    if (!p || p < 3) return null;
    const map = { 3: ['🟧', 'Hoch'], 4: ['🟥', 'Dringend'], 5: ['🟥', 'Sofort'] };
    const [icon, lbl] = map[p] || map[5];
    return el('span', { class: 'aufg-prio', title: 'Priorität: ' + lbl }, icon + ' ');
  }

  // --- Neue Aufgabe anlegen (immer im app-weit gewählten Projekt) ---
  function buildCreateForm(onCreated) {
    const titleI = el('input', { type: 'text', placeholder: 'Was ist zu tun?' });
    const dueI = el('input', { type: 'date' });
    const prioSel = el('select', {});
    [['', 'Keine Priorität'], ['3', 'Hoch'], ['4', 'Dringend'], ['5', 'Sofort']]
      .forEach(([v, l]) => prioSel.appendChild(el('option', { value: v }, l)));
    const status = el('div', { class: 'help', style: 'margin-top:6px;' }, '');

    const saveBtn = el('button', { class: 'btn-primary' }, 'Anlegen');
    saveBtn.onclick = () => {
      const title = titleI.value.trim();
      const projectId = globalProjektId();
      if (!title) { status.textContent = 'Bitte einen Titel eingeben.'; status.style.color = '#c53030'; return; }
      if (!projectId) { status.textContent = 'Kein Vikunja-Projekt gewählt (Einstellungen → Aufgaben).'; status.style.color = '#c53030'; return; }
      saveBtn.disabled = true; status.textContent = 'Wird angelegt…'; status.style.color = '';
      GR.api.createTask(projectId, {
        title,
        dueDate: dueI.value || undefined,
        priority: prioSel.value || undefined,
      }).then(() => {
        toast('Aufgabe angelegt');
        onCreated();
      }).catch(err => {
        saveBtn.disabled = false;
        status.textContent = 'Fehler: ' + err.message; status.style.color = '#c53030';
      });
    };

    return el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0;' }, 'Neue Aufgabe'),
      el('div', {}, [el('label', {}, 'Titel'), titleI]),
      el('div', { class: 'grid-2', style: 'margin-top:10px;' }, [
        el('div', {}, [el('label', {}, 'Fällig am (optional)'), dueI]),
        el('div', {}, [el('label', {}, 'Priorität (optional)'), prioSel]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [saveBtn]),
      status,
    ]);
  }

  // --- Detailkarte (Aufgabe bearbeiten) ---
  const PRIO_OPTS = [
    ['0', 'Keine Priorität'], ['1', 'Niedrig'], ['2', 'Mittel'],
    ['3', 'Hoch'], ['4', 'Dringend'], ['5', 'Sofort'],
  ];

  // ISO (UTC, aus Vikunja) → Wert fürs <input type=datetime-local> (lokale Zeit).
  function isoToLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Markdown → HTML für die reine Vorschau (maßgeblich konvertiert das Backend).
  function mdRender(md) {
    const m = window.marked;
    const fn = m && (m.parse || m);
    if (typeof fn !== 'function') return '<p class="help">Vorschau nicht verfügbar.</p>';
    try { return fn(String(md || ''), { breaks: true, gfm: true }); } catch (_) { return ''; }
  }

  function openTaskDetail(taskStub, reload) {
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    const body = el('div', {}, el('p', { class: 'help' }, 'Aufgabe wird geladen…'));
    const box = el('div', { class: 'modal aufg-detail', style: 'max-width:640px; width:94vw;' }, [
      el('h3', {}, 'Aufgabe bearbeiten'),
      body,
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Frische Vollansicht (Beschreibung als Markdown, aktuelle Labels) + Labelliste.
    Promise.all([
      GR.api.getTask(taskStub.id),
      GR.api.listTaskLabels().catch(() => ({ labels: [] })),
    ]).then(([task, labelRes]) => {
      renderDetail(box, body, task, (labelRes && labelRes.labels) || [], close, reload);
    }).catch(err => {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'warn' }, 'Aufgabe konnte nicht geladen werden: ' + err.message));
      body.appendChild(el('div', { class: 'toolbar', style: 'margin-top:12px;' }, [
        el('div', { class: 'spacer' }),
        el('button', { onClick: close }, 'Schließen'),
      ]));
    });
  }

  function renderDetail(box, body, task, allLabels, close, reload) {
    body.innerHTML = '';
    if (task.identifier) box.querySelector('h3').textContent = 'Aufgabe bearbeiten · ' + task.identifier;

    // Titel
    const titleI = el('input', { type: 'text', value: task.title || '' });

    // Beschreibung (Markdown) + Vorschau
    const descI = el('textarea', { rows: '6', class: 'aufg-desc', placeholder: 'Beschreibung (Markdown)…' }, task.description || '');
    const preview = el('div', { class: 'aufg-preview md-body', hidden: true });
    let previewOn = false;
    const previewBtn = el('button', { type: 'button', class: 'btn-sm' }, 'Vorschau');
    previewBtn.onclick = () => {
      previewOn = !previewOn;
      if (previewOn) { preview.innerHTML = mdRender(descI.value); preview.hidden = false; descI.hidden = true; previewBtn.textContent = 'Bearbeiten'; }
      else { preview.hidden = true; descI.hidden = false; previewBtn.textContent = 'Vorschau'; }
    };

    // Fälligkeit + Priorität
    const dueI = el('input', { type: 'datetime-local', value: isoToLocalInput(task.dueDate) });
    const prioSel = el('select', {});
    PRIO_OPTS.forEach(([v, l]) => prioSel.appendChild(el('option', { value: v, selected: String(task.priority || 0) === v }, l)));

    // Labels (zuweisen/entfernen aus den vorhandenen)
    const staged = (task.labels || []).map(l => ({ id: l.id, title: l.title, hexColor: l.hexColor }));
    const originalIds = new Set(staged.map(l => l.id));
    const chipsBox = el('div', { class: 'aufg-chips' });
    const addSel = el('select', { class: 'aufg-label-add' });
    function renderChips() {
      chipsBox.innerHTML = '';
      if (!staged.length) chipsBox.appendChild(el('span', { class: 'help', style: 'margin:0;' }, 'Keine Labels.'));
      staged.forEach(l => {
        const chip = el('span', { class: 'chip' }, [
          l.hexColor ? el('span', { class: 'chip-dot', style: 'background:' + l.hexColor + ';' }) : null,
          el('span', {}, l.title),
          el('button', { type: 'button', class: 'chip-x', title: 'Entfernen', onClick: () => { const i = staged.findIndex(x => x.id === l.id); if (i >= 0) staged.splice(i, 1); renderChips(); renderAddOptions(); } }, '×'),
        ]);
        chipsBox.appendChild(chip);
      });
    }
    function renderAddOptions() {
      addSel.innerHTML = '';
      const stagedIds = new Set(staged.map(l => l.id));
      const avail = allLabels.filter(l => !stagedIds.has(l.id));
      addSel.appendChild(el('option', { value: '' }, avail.length ? '+ Label hinzufügen…' : 'Keine weiteren Labels'));
      avail.forEach(l => addSel.appendChild(el('option', { value: l.id }, l.title)));
      addSel.disabled = !avail.length;
    }
    addSel.onchange = () => {
      const id = parseInt(addSel.value, 10);
      if (!Number.isFinite(id)) return;
      const lab = allLabels.find(l => l.id === id);
      if (lab && !staged.some(x => x.id === id)) staged.push({ id: lab.id, title: lab.title, hexColor: lab.hexColor });
      renderChips(); renderAddOptions();
    };
    renderChips(); renderAddOptions();

    const status = el('div', { class: 'help', style: 'margin-top:6px;' }, '');
    const saveBtn = el('button', { class: 'btn-primary' }, 'Speichern');
    const cancelBtn = el('button', { onClick: close }, 'Abbrechen');

    saveBtn.onclick = async () => {
      const title = titleI.value.trim();
      if (!title) { status.textContent = 'Bitte einen Titel eingeben.'; status.style.color = '#c53030'; return; }
      saveBtn.disabled = true; cancelBtn.disabled = true;
      status.style.color = ''; status.textContent = 'Wird gespeichert…';
      try {
        await GR.api.updateTask(task.id, {
          title,
          description: descI.value,
          dueDate: dueI.value || '',
          priority: prioSel.value,
        });
        // Label-Diff
        const nowIds = new Set(staged.map(l => l.id));
        const toAdd = [...nowIds].filter(id => !originalIds.has(id));
        const toRemove = [...originalIds].filter(id => !nowIds.has(id));
        for (const id of toAdd) await GR.api.addTaskLabel(task.id, id);
        for (const id of toRemove) await GR.api.removeTaskLabel(task.id, id);
        toast('Aufgabe gespeichert');
        close();
        reload();
      } catch (err) {
        saveBtn.disabled = false; cancelBtn.disabled = false;
        status.textContent = 'Fehler: ' + err.message; status.style.color = '#c53030';
      }
    };

    body.appendChild(el('div', {}, [el('label', {}, 'Titel'), titleI]));
    body.appendChild(el('div', { style: 'margin-top:10px;' }, [
      el('div', { style: 'display:flex; align-items:center; gap:8px;' }, [
        el('label', { style: 'margin:0;' }, 'Beschreibung'),
        el('span', { class: 'help', style: 'margin:0;' }, 'Markdown'),
        el('div', { class: 'spacer' }),
        previewBtn,
      ]),
      descI, preview,
    ]));
    body.appendChild(el('div', { class: 'grid-2', style: 'margin-top:10px;' }, [
      el('div', {}, [el('label', {}, 'Fällig am'), dueI]),
      el('div', {}, [el('label', {}, 'Priorität'), prioSel]),
    ]));
    body.appendChild(el('div', { style: 'margin-top:10px;' }, [
      el('label', {}, 'Labels'),
      chipsBox,
      el('div', { style: 'margin-top:6px;' }, addSel),
    ]));
    body.appendChild(el('div', { class: 'toolbar', style: 'margin-top:16px; margin-bottom:0;' }, [
      el('div', { class: 'spacer' }),
      cancelBtn, saveBtn,
    ]));
    body.appendChild(status);
  }

  GR.views = GR.views || {};
  GR.views.renderAufgaben = renderAufgaben;
})();
