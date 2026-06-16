(function () {
  'use strict';
  window.GR = window.GR || {};

  const SCHEMA_VERSION = 2;

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function emptyAbstimmung() {
    return { durchgefuehrt: false, ja: 0, nein: 0, enthaltung: 0 };
  }

  function emptyTop(nummer, bereich) {
    return {
      id: uuid(),
      nummer,
      bereich,
      titel: '',
      beschlussvorlage: '',
      bemerkungen: '',
      befangenheitsText: '',
      befangenheitsIds: [],
      sitzungsleitungId: '',
      freiwilligerVerzichtIds: [],
      stimmrechtRuhtIds: [],
      abstimmung: emptyAbstimmung(),
    };
  }

  function emptySitzung() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      id: uuid(),
      datum: today,
      ort: 'Hörschhausen',
      sitzungsleitungId: '',
      schriftfuehrerId: '',
      anwesendIds: [],
      anwesenheitsZeiten: {},
      gaeste: '',
      antraegeTagesordnung: { modus: 'keine', text: '' },
      beginnOeffentlich: '',
      endeOeffentlich: '',
      beginnNichtOeffentlich: '',
      endeSitzung: '',
      tops: [],
      status: 'vorbereitung',
      schemaVersion: SCHEMA_VERSION,
    };
  }

  function ergebnisAbstimmung(a) {
    if (!a || !a.durchgefuehrt) return '—';
    if (a.ja > a.nein) return 'angenommen';
    if (a.nein > a.ja) return 'abgelehnt';
    return 'Stimmengleichheit';
  }

  // Einstimmig strikt: alle ja oder alle nein, keine Enthaltungen.
  function isEinstimmig(a) {
    if (!a || !a.durchgefuehrt) return false;
    const enth = a.enthaltung || 0;
    if (enth > 0) return false;
    const ja = a.ja || 0, nein = a.nein || 0;
    return (ja > 0 && nein === 0) || (nein > 0 && ja === 0);
  }

  function einstimmigRichtung(a) {
    if (!isEinstimmig(a)) return null;
    return (a.ja || 0) > 0 ? 'dafuer' : 'dagegen';
  }

  const MITGLIED_FUNKTIONEN = ['Ortsbürgermeister', 'Beigeordneter', 'Ratsmitglied'];

  function fullName(m) {
    if (!m) return '';
    const v = (m.vorname || '').trim();
    const n = (m.nachname || '').trim();
    if (v && n) return `${v} ${n}`;
    return v || n || m.name || '';
  }

  function emptyMitglied() {
    return { id: uuid(), vorname: '', nachname: '', funktion: 'Ratsmitglied', aktiv: true };
  }

  GR.models = {
    SCHEMA_VERSION, uuid,
    emptyAbstimmung, emptyTop, emptySitzung,
    ergebnisAbstimmung, isEinstimmig, einstimmigRichtung,
    MITGLIED_FUNKTIONEN, fullName, emptyMitglied,
  };
})();
