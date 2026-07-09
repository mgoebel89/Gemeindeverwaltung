(function () {
  'use strict';
  window.GR = window.GR || {};

  const SCHEMA_VERSION = 3;

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

  // ===== Modul Vermietung =====
  const KOSTENBOGEN_TYPEN = ['gemeindehaus', 'grillhuette', 'sonstiges'];

  function emptyMieter() {
    return {
      id: uuid(), anrede: '', vorname: '', nachname: '',
      strasse: '', plz: '', ort: '', telefon: '', email: '',
      ortsfremd: false, notiz: '',
    };
  }

  function emptyRaumPreise() {
    return {
      grund: { anwohnerTag1: 0, anwohnerWeitererTag: 0, ortsfremdTag1: 0, ortsfremdWeitererTag: 0 },
      stromProKwh: 0,
      gasProCbm: 0,
    };
  }

  // Abrechnungsart je Objekt:
  //  'verbrauch' – gestaffelte Grundmiete + Strom/Gas nach Verbrauch (Gemeindehaus)
  //  'pauschal'  – ein fester Betrag je Herkunft, Strom/Gas inklusive (Jugendraum)
  const RAUM_ABRECHNUNGSARTEN = ['verbrauch', 'pauschal'];

  function emptyRaum() {
    return { id: uuid(), name: '', aktiv: true, abrechnungsart: 'verbrauch', preise: emptyRaumPreise(), kostenbogenTyp: 'gemeindehaus' };
  }

  function istPauschal(raum) { return !!raum && raum.abrechnungsart === 'pauschal'; }

  function emptyVermietung() {
    return {
      id: uuid(),
      raumId: '',
      mieterId: '',
      anlass: '',
      startDatum: '',
      endDatum: '',
      ortsfremd: false,
      status: 'geplant', // 'geplant' | 'vertrag' | 'abgerechnet'
      zaehler: { stromStart: null, stromEnde: null, gasStart: null, gasEnde: null },
      preisSnapshot: null, // { grundMiete, stromProKwh, gasProCbm } — eingefroren ab Status 'vertrag'
      zusatzposten: [],    // [{ bezeichnung, betrag }]
      vertragDatum: '',
      abrechnungDatum: '',
    };
  }

  function fullNameMieter(m) {
    if (!m) return '';
    const v = (m.vorname || '').trim();
    const n = (m.nachname || '').trim();
    return [v, n].filter(Boolean).join(' ') || '';
  }

  // Anzahl Nutzungstage inkl. Start- und Endtag (mind. 1).
  function anzahlTage(startDatum, endDatum) {
    if (!startDatum) return 0;
    const start = new Date(startDatum + 'T00:00:00');
    const end = new Date((endDatum || startDatum) + 'T00:00:00');
    if (isNaN(start) || isNaN(end)) return 0;
    const diff = Math.round((end - start) / 86400000);
    return Math.max(1, diff + 1);
  }

  // Grundmiete je nach Abrechnungsart:
  //  pauschal  – ein fester Betrag je Herkunft (keine Tagesstaffelung)
  //  verbrauch – 1. Tag + (Tage-1) × weiterer Tag, je nach Anwohner/Ortsfremd
  function berechneGrundmiete(raum, ortsfremd, tage) {
    if (!raum || !raum.preise || !raum.preise.grund) return 0;
    const g = raum.preise.grund;
    const pauschal = ortsfremd ? (g.ortsfremdTag1 || 0) : (g.anwohnerTag1 || 0);
    if (istPauschal(raum)) return pauschal;
    if (tage <= 0) return 0;
    const weiter = ortsfremd ? (g.ortsfremdWeitererTag || 0) : (g.anwohnerWeitererTag || 0);
    return pauschal + Math.max(0, tage - 1) * weiter;
  }

  // Verbrauch (Menge + Kosten). Bei Pauschale sind Strom/Gas in der Miete
  // enthalten – es fallen keine separaten Verbrauchskosten an.
  function berechneVerbrauch(vermietung, raum) {
    if (istPauschal(raum)) return { stromMenge: 0, gasMenge: 0, stromKosten: 0, gasKosten: 0 };
    const z = (vermietung && vermietung.zaehler) || {};
    const snap = (vermietung && vermietung.preisSnapshot) || (raum ? { stromProKwh: raum.preise.stromProKwh, gasProCbm: raum.preise.gasProCbm } : { stromProKwh: 0, gasProCbm: 0 });
    const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
    const stromMenge = (num(z.stromEnde) !== null && num(z.stromStart) !== null) ? Math.max(0, num(z.stromEnde) - num(z.stromStart)) : 0;
    const gasMenge = (num(z.gasEnde) !== null && num(z.gasStart) !== null) ? Math.max(0, num(z.gasEnde) - num(z.gasStart)) : 0;
    return {
      stromMenge, gasMenge,
      stromKosten: stromMenge * (snap.stromProKwh || 0),
      gasKosten: gasMenge * (snap.gasProCbm || 0),
    };
  }

  // Gesamtsumme für den Kostenbogen (Grundmiete + Verbrauch + Zusatzposten).
  function berechneGesamt(vermietung, raum) {
    const grund = (vermietung.preisSnapshot && vermietung.preisSnapshot.grundMiete != null)
      ? vermietung.preisSnapshot.grundMiete
      : berechneGrundmiete(raum, vermietung.ortsfremd, anzahlTage(vermietung.startDatum, vermietung.endDatum));
    const v = berechneVerbrauch(vermietung, raum);
    const zusatz = (vermietung.zusatzposten || []).reduce((s, p) => s + (Number(p.betrag) || 0), 0);
    return {
      grundMiete: grund,
      stromMenge: v.stromMenge, gasMenge: v.gasMenge,
      stromKosten: v.stromKosten, gasKosten: v.gasKosten,
      zusatz,
      gesamt: grund + v.stromKosten + v.gasKosten + zusatz,
    };
  }

  // ===== Modul Bargeldauslagen =====
  const AUSLAGE_STATUS = ['offen', 'erstattet'];

  function emptyEmpfaenger() {
    return { id: uuid(), name: '', vorname: '', iban: '' };
  }
  // IBAN für Menschen lesbar in Viererblöcken (z. B. „DE12 3456 7890 …").
  function formatIban(iban) {
    const compact = String(iban || '').replace(/\s+/g, '').toUpperCase();
    if (!compact) return '';
    return compact.replace(/(.{4})/g, '$1 ').trim();
  }

  // Formular-Anzeige „Empfänger:" = „Nachname, Vorname"
  function fullNameEmpfaenger(e) {
    if (!e) return '';
    const n = (e.name || '').trim();
    const v = (e.vorname || '').trim();
    if (n && v) return `${n}, ${v}`;
    return n || v || '';
  }

  function emptyHaushaltsstelle() {
    return { id: uuid(), nummer: '', bezeichnung: '', budget: null };
  }

  function emptyBeleg(nr) {
    return { id: uuid(), nr: nr || 1, betrag: 0, beschreibung: '', belegdatum: '', haendler: '', scanFileId: null };
  }

  function emptyAuslage() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      id: uuid(),
      status: 'offen', // 'offen' | 'erstattet'
      haushaltsjahr: new Date().getFullYear(),
      haushaltsstelleId: '',
      empfaengerId: '',
      verwendungszweck: '',   // → Formularfeld „Bezeichnung"
      datum: today,           // „Hörschhausen, den …"
      belege: [],             // [{ id, nr, betrag, beschreibung, belegdatum, haendler, scanFileId }]
    };
  }

  // Gesamtbetrag = Summe aller Einzelbelege (nur dieser Wert steht im Formular).
  function gesamtbetrag(auslage) {
    return (auslage && auslage.belege || []).reduce((s, b) => s + (Number(b.betrag) || 0), 0);
  }

  // Budgetverbrauch einer Haushaltsstelle in einem Haushaltsjahr über eine
  // Liste von Auslagen (Store-unabhängig gehalten).
  function budgetVerbrauch(auslagen, haushaltsstelleId, jahr) {
    return (auslagen || [])
      .filter(a => a.haushaltsstelleId === haushaltsstelleId && String(a.haushaltsjahr) === String(jahr))
      .reduce((s, a) => s + gesamtbetrag(a), 0);
  }

  GR.models = {
    SCHEMA_VERSION, uuid,
    emptyAbstimmung, emptyTop, emptySitzung,
    ergebnisAbstimmung, isEinstimmig, einstimmigRichtung,
    MITGLIED_FUNKTIONEN, fullName, emptyMitglied,
    KOSTENBOGEN_TYPEN, RAUM_ABRECHNUNGSARTEN, istPauschal,
    emptyMieter, emptyRaum, emptyRaumPreise, emptyVermietung,
    fullNameMieter, anzahlTage, berechneGrundmiete, berechneVerbrauch, berechneGesamt,
    AUSLAGE_STATUS, emptyEmpfaenger, fullNameEmpfaenger, formatIban, emptyHaushaltsstelle,
    emptyBeleg, emptyAuslage, gesamtbetrag, budgetVerbrauch,
  };
})();
