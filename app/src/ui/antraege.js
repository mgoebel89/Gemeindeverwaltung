(function () {
  'use strict';
  window.GR = window.GR || {};
  const { el } = GR.ui;

  function renderAntraegeCard(sitzung, save) {
    if (!sitzung.antraegeTagesordnung) sitzung.antraegeTagesordnung = { modus: 'keine', text: '' };
    const at = sitzung.antraegeTagesordnung;

    const radioName = 'antraege-modus-' + sitzung.id;

    const rKeine = el('input', { type: 'radio', name: radioName, value: 'keine' });
    rKeine.checked = at.modus !== 'antraege';
    const rAntr = el('input', { type: 'radio', name: radioName, value: 'antraege' });
    rAntr.checked = at.modus === 'antraege';

    const textarea = el('textarea', {
      placeholder: 'Antragstext (mehrzeilig, wird im Protokoll wörtlich übernommen)',
      style: 'margin-top:8px;',
    });
    textarea.value = at.text || '';
    textarea.disabled = at.modus !== 'antraege';
    textarea.oninput = e => { at.text = e.target.value; save(); };

    const update = () => {
      textarea.disabled = at.modus !== 'antraege';
      save();
    };
    rKeine.onchange = () => { if (rKeine.checked) { at.modus = 'keine'; update(); } };
    rAntr.onchange = () => { if (rAntr.checked) { at.modus = 'antraege'; update(); } };

    return el('div', { class: 'card' }, [
      el('h3', {}, 'Anträge zur Tagesordnung'),
      el('label', { style: 'display:flex; gap:8px; align-items:center; font-size:0.95rem; color:var(--text); margin-bottom:6px;' },
        [rKeine, ' Es gibt keine Anträge zur Tagesordnung.']),
      el('label', { style: 'display:flex; gap:8px; align-items:center; font-size:0.95rem; color:var(--text);' },
        [rAntr, ' Nachfolgende Anträge zur Tagesordnung werden vorgebracht:']),
      textarea,
    ]);
  }

  GR.ui.renderAntraegeCard = renderAntraegeCard;
})();
