(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el, formatDatum, toast } = GR.ui;

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
      listBox.appendChild(el('p', { class: 'help' }, 'Aufgaben werden geladen…'));
      GR.api.listOpenTasks().then(res => {
        renderList(listBox, res.tasks || [], load);
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

    li.appendChild(cb);
    li.appendChild(el('span', { class: 'aufg-main' }, [
      el('span', { class: 'aufg-title' }, [
        priorityFlag(t.priority),
        el('span', {}, t.title),
      ]),
      meta.length ? el('span', { class: 'help', style: 'margin:0; display:block;' }, meta.join(' · ')) : null,
    ]));
    return li;
  }

  function priorityFlag(p) {
    if (!p || p < 3) return null;
    const map = { 3: ['🟧', 'Hoch'], 4: ['🟥', 'Dringend'], 5: ['🟥', 'Sofort'] };
    const [icon, lbl] = map[p] || map[5];
    return el('span', { class: 'aufg-prio', title: 'Priorität: ' + lbl }, icon + ' ');
  }

  // --- Neue Aufgabe anlegen ---
  function buildCreateForm(onCreated) {
    const titleI = el('input', { type: 'text', placeholder: 'Was ist zu tun?' });
    const projSel = el('select', {});
    projSel.appendChild(el('option', { value: '' }, 'Projekt lädt…'));
    const dueI = el('input', { type: 'date' });
    const prioSel = el('select', {});
    [['', 'Keine Priorität'], ['3', 'Hoch'], ['4', 'Dringend'], ['5', 'Sofort']]
      .forEach(([v, l]) => prioSel.appendChild(el('option', { value: v }, l)));
    const status = el('div', { class: 'help', style: 'margin-top:6px;' }, '');

    GR.api.listTaskProjects().then(res => {
      projSel.innerHTML = '';
      const projs = res.projects || [];
      if (!projs.length) { projSel.appendChild(el('option', { value: '' }, 'Keine Projekte gefunden')); return; }
      projs.forEach(p => projSel.appendChild(el('option', { value: p.id }, p.title)));
    }).catch(() => { projSel.innerHTML = ''; projSel.appendChild(el('option', { value: '' }, 'Projekte nicht ladbar')); });

    const saveBtn = el('button', { class: 'btn-primary' }, 'Anlegen');
    saveBtn.onclick = () => {
      const title = titleI.value.trim();
      const projectId = projSel.value;
      if (!title) { status.textContent = 'Bitte einen Titel eingeben.'; status.style.color = '#c53030'; return; }
      if (!projectId) { status.textContent = 'Bitte ein Projekt wählen.'; status.style.color = '#c53030'; return; }
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
        el('div', {}, [el('label', {}, 'Projekt'), projSel]),
        el('div', {}, [el('label', {}, 'Fällig am (optional)'), dueI]),
        el('div', {}, [el('label', {}, 'Priorität (optional)'), prioSel]),
      ]),
      el('div', { class: 'toolbar', style: 'margin-top:10px;' }, [saveBtn]),
      status,
    ]);
  }

  GR.views = GR.views || {};
  GR.views.renderAufgaben = renderAufgaben;
})();
