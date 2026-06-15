(function () {
  'use strict';
  window.GR = window.GR || {};
  const { ergebnisAbstimmung } = GR.models;

  function esc(v) {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[";\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv(sitzung) {
    const header = ['Sitzungsdatum', 'Bereich', 'TOP-Nr', 'Titel', 'Beschlussvorlage', 'Ja', 'Nein', 'Enthaltung', 'Ergebnis', 'Bemerkungen'];
    const lines = [header.join(';')];
    for (const t of sitzung.tops) {
      const a = t.abstimmung || {};
      const row = [
        sitzung.datum,
        t.bereich === 'oeffentlich' ? 'öffentlich' : 'nicht-öffentlich',
        t.nummer,
        t.titel,
        t.beschlussvorlage,
        a.durchgefuehrt ? a.ja : '',
        a.durchgefuehrt ? a.nein : '',
        a.durchgefuehrt ? a.enthaltung : '',
        ergebnisAbstimmung(a),
        t.bemerkungen,
      ].map(esc);
      lines.push(row.join(';'));
    }
    return lines.join('\r\n');
  }

  GR.csv = { buildCsv };
})();
