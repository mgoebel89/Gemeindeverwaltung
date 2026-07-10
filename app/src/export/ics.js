(function () {
  'use strict';
  window.GR = window.GR || {};
  const M = GR.models;
  const { downloadFile, toast } = GR.ui;

  function pad(n) { return String(n).padStart(2, '0'); }
  function icsDate(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
  function icsStamp(d) { return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; }
  function esc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function slug(s) { return String(s || 'vertrag').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vertrag'; }

  // Erzeugt eine iCalendar-Datei mit einem ganztägigen Termin am spätesten
  // Kündigungstermin und einer Erinnerung (VALARM) um den vertraglichen Vorlauf
  // davor. Zum manuellen Import in Google/Outlook o. ä.
  function buildFristIcs(v, partnerName) {
    const termin = M.spaetesterKuendigungstermin(v);
    if (!termin) return null;
    const dtStart = icsDate(termin);
    const dtEndDate = new Date(termin.getTime() + 86400000); // ganztägig -> Folgetag als DTEND
    const dtEnd = icsDate(dtEndDate);
    const vorlauf = Number(v.erinnerungVorlaufTage) || 0;
    const uid = `vertrag-${v.id}-kuendigung@gemeindeverwaltung`;
    const descParts = [];
    if (partnerName) descParts.push('Partner: ' + partnerName);
    if (v.ende) descParts.push('Vertragsende: ' + v.ende);
    if (v.kuendigungsfristMonate != null) descParts.push('Kündigungsfrist: ' + v.kuendigungsfristMonate + ' Monate');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Gemeindeverwaltung//Vertraege und Pacht//DE',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${icsStamp(new Date())}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${esc('Kündigungsfrist: ' + (v.bezeichnung || 'Vertrag'))}`,
      `DESCRIPTION:${esc(descParts.join('\n'))}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-P${vorlauf}D`,
      `DESCRIPTION:${esc('Erinnerung Kündigungsfrist: ' + (v.bezeichnung || 'Vertrag'))}`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return lines.join('\r\n');
  }

  function downloadFristIcs(v, partnerName) {
    const ics = buildFristIcs(v, partnerName);
    if (!ics) { toast('Kein Vertragsende gesetzt – keine Frist.'); return; }
    downloadFile(`frist-${slug(v.bezeichnung)}.ics`, ics, 'text/calendar');
    toast('Kalenderdatei (.ics) heruntergeladen');
  }

  GR.vertraegeIcs = { buildFristIcs, downloadFristIcs };
})();
