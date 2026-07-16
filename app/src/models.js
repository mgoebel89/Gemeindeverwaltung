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

  // Standard-Punkte für die Übergabe-/Abnahme-Checkliste eines neuen Objekts.
  // Jeder Punkt bekommt eine eigene id (frische Kopie).
  function defaultUebergabeCheckliste() {
    return [
      'Küche / Kochbereich (sauber, vollständig)',
      'Sanitäranlagen / WC',
      'Tische und Stühle (Anzahl, Zustand)',
      'Böden gereinigt',
      'Müll entsorgt / Behälter',
      'Geschirr / Inventar vollständig',
      'Heizung / Licht / Fenster',
      'Schlüssel zurückgegeben',
    ].map(text => ({ id: uuid(), text }));
  }

  function emptyRaum() {
    return { id: uuid(), name: '', aktiv: true, abrechnungsart: 'verbrauch', preise: emptyRaumPreise(), kostenbogenTyp: 'gemeindehaus', uebergabeCheckliste: defaultUebergabeCheckliste() };
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
      zaehlerFotos: { stromStart: null, stromEnde: null, gasStart: null, gasEnde: null }, // fileId je Zählerstand-Foto (Beweisführung)
      preisSnapshot: null, // { grundMiete, stromProKwh, gasProCbm } — eingefroren ab Status 'vertrag'
      zusatzposten: [],    // [{ bezeichnung, betrag }]
      // Übergabe-/Abnahmeprotokoll; Punkte werden beim Start aus der Objekt-
      // Vorlage eingefroren: { datum, punkte:[{id,text,status,notiz,fotoId}] }
      protokolle: { uebergabe: null, abnahme: null },
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
  const AUSLAGE_STATUS = ['offen', 'eingereicht', 'erstattet'];

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
      status: 'offen', // 'offen' | 'eingereicht' | 'erstattet'
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

  // Auslagen, die das Budget einer Haushaltsstelle mindern: eingereicht + erstattet
  // (offene Entwürfe zählen noch nicht).
  const ABGERECHNET_STATUS = ['eingereicht', 'erstattet'];

  // Budgetverbrauch einer Haushaltsstelle in einem Haushaltsjahr über eine
  // Liste von Auslagen (Store-unabhängig gehalten). `statusFilter` (optional)
  // schränkt auf bestimmte Auslage-Status ein; ohne Filter zählen alle.
  function budgetVerbrauch(auslagen, haushaltsstelleId, jahr, statusFilter) {
    return (auslagen || [])
      .filter(a => a.haushaltsstelleId === haushaltsstelleId && String(a.haushaltsjahr) === String(jahr)
        && (!statusFilter || statusFilter.includes(a.status || 'offen')))
      .reduce((s, a) => s + gesamtbetrag(a), 0);
  }

  // ===== Modul Verträge und Pacht =====
  const VERTRAG_RICHTUNGEN = ['ausgabe', 'einnahme'];
  const VERTRAG_INTERVALLE = ['einmalig', 'monatlich', 'quartalsweise', 'jaehrlich'];
  const VERTRAG_LAUFZEIT_TYPEN = ['befristet', 'auto_verlaengerung'];
  const VERTRAG_STATUS = ['aktiv', 'gekuendigt', 'ausgelaufen'];

  const INTERVALL_LABEL = {
    einmalig: 'einmalig', monatlich: 'monatlich',
    quartalsweise: 'quartalsweise', jaehrlich: 'jährlich',
  };
  const RICHTUNG_LABEL = { ausgabe: 'Ausgabe', einnahme: 'Einnahme' };

  function emptyVertragspartner() {
    return {
      id: uuid(), name: '', anschrift: '', ansprechpartner: '',
      telefon: '', email: '', notiz: '',
    };
  }

  function emptyVertrag() {
    return {
      id: uuid(),
      bezeichnung: '',
      kategorie: 'Sonstiges',
      richtung: 'ausgabe',            // 'ausgabe' | 'einnahme'
      partnerId: '',
      betrag: 0,
      intervall: 'jaehrlich',         // 'einmalig' | 'monatlich' | 'quartalsweise' | 'jaehrlich'
      beginn: '',                     // ISO-Datum
      laufzeitTyp: 'befristet',       // 'befristet' | 'auto_verlaengerung'
      ende: '',                       // ISO-Datum: festes Ende bzw. nächster Verlängerungsstichtag
      kuendigungsfristMonate: 3,
      verlaengerungMonate: 12,        // nur bei auto_verlaengerung relevant
      erinnerungVorlaufTage: 30,
      paperlessDocs: [],              // [{ id, title }]
      status: 'aktiv',               // 'aktiv' | 'gekuendigt' | 'ausgelaufen'
      notiz: '',
    };
  }

  // Betrag aufs Jahr normalisiert. Einmalige Beträge zählen nicht zu den
  // laufenden Jahreskosten (gesondert ausweisen).
  function jahresbetrag(v) {
    const b = Number(v && v.betrag) || 0;
    switch (v && v.intervall) {
      case 'monatlich': return b * 12;
      case 'quartalsweise': return b * 4;
      case 'jaehrlich': return b;
      case 'einmalig': return 0;
      default: return 0;
    }
  }

  // Datum n Monate verschieben (ISO 'YYYY-MM-DD' -> Date), robust bei Monatsenden.
  function addMonths(iso, months) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return null;
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    // Tag zurücksetzen, ohne in den Folgemonat zu springen
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d;
  }

  // Date -> 'YYYY-MM-DD' anhand LOKALER Komponenten (nicht toISOString, das in
  // Zeitzonen mit positivem UTC-Offset um einen Tag zurückspringt).
  function dateToIso(d) {
    if (!d) return null;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // Spätester Kündigungstermin = Vertragsende minus Kündigungsfrist.
  // Rückgabe: Date oder null.
  function spaetesterKuendigungstermin(v) {
    if (!v || !v.ende) return null;
    return addMonths(v.ende, -(Number(v.kuendigungsfristMonate) || 0));
  }

  function daysBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  // Ampel-Status für den Fristen-Startbildschirm.
  //  'ueberfaellig' – Kündigungstermin liegt in der Vergangenheit (noch aktiv)
  //  'akut'         – innerhalb des vertraglichen Erinnerungsvorlaufs
  //  'bald'         – innerhalb der nächsten 90 Tage
  //  'ok'           – weiter entfernt
  //  null           – kein aktiver Vertrag oder kein Termin
  function fristStatus(v, today) {
    if (!v || v.status !== 'aktiv') return null;
    const termin = spaetesterKuendigungstermin(v);
    if (!termin) return null;
    const heute = today ? new Date(today) : new Date();
    heute.setHours(0, 0, 0, 0);
    const diff = daysBetween(heute, termin);
    if (diff < 0) return 'ueberfaellig';
    const vorlauf = Number(v.erinnerungVorlaufTage) || 0;
    if (diff <= vorlauf) return 'akut';
    if (diff <= 90) return 'bald';
    return 'ok';
  }

  // Tage bis zum spätesten Kündigungstermin (negativ = überfällig), oder null.
  function tageBisKuendigung(v, today) {
    const termin = spaetesterKuendigungstermin(v);
    if (!termin) return null;
    const heute = today ? new Date(today) : new Date();
    heute.setHours(0, 0, 0, 0);
    return daysBetween(heute, termin);
  }

  // ===== Modul Vorgänge & Projekte =====
  const VORGANG_STATUS = ['geplant', 'bearbeitung', 'pausiert', 'beendet'];
  const VORGANG_STATUS_LABEL = {
    geplant: 'Geplant', bearbeitung: 'In Bearbeitung',
    pausiert: 'Pausiert', beendet: 'Beendet',
  };
  // Typen der getippten Vorgangshistorie (Zeitleiste).
  const HISTORIE_TYPEN = ['notiz', 'todo', 'foto', 'dokument', 'referenz', 'kosten'];
  const HISTORIE_TYP_LABEL = {
    notiz: 'Notiz', todo: 'ToDo', foto: 'Foto', dokument: 'Dokument',
    referenz: 'Referenz', kosten: 'Kosten',
  };

  function emptyVorgang() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      id: uuid(),
      titel: '',
      beschreibung: '',
      kategorie: '',
      status: 'geplant',            // 'geplant' | 'bearbeitung' | 'pausiert' | 'beendet'
      vertraulich: false,           // ganzer Vorgang nur für die Leitung sichtbar
      haushaltsstellen: [],         // [hhId, …] – dem Projekt zugewiesene Kostenstellen
      haushaltsjahr: new Date().getFullYear(),
      planung: { betrag: null, zieljahr: '' }, // geplanter Bedarf für künftigen Haushalt
      historie: [],                 // [ …getippte Einträge… ]
      paperlessDocs: [],            // [{ id, title }] – vorgangsweite Dokumente
      erstelltAm: today,
      schemaVersion: 1,
    };
  }

  // Ein getippter Historieneintrag. Typ-spezifische Felder werden je nach `typ`
  // beim Anlegen ergänzt (siehe Modul Phase 2/3).
  function emptyHistorieEintrag(typ) {
    const today = new Date().toISOString().slice(0, 10);
    return { id: uuid(), datum: today, typ: typ || 'notiz', vertraulich: false };
  }

  // Ist-Verbrauch eines Vorgangs = Summe aller Kosten-Historieneinträge.
  function vorgangKosten(v) {
    return (v && v.historie || [])
      .filter(e => e.typ === 'kosten')
      .reduce((s, e) => s + (Number(e.betrag) || 0), 0);
  }

  // Ist-Verbrauch eines Vorgangs, der auf EINE Haushaltsstelle gebucht ist.
  function vorgangKostenAuf(v, haushaltsstelleId) {
    return (v && v.historie || [])
      .filter(e => e.typ === 'kosten' && e.haushaltsstelleId === haushaltsstelleId)
      .reduce((s, e) => s + (Number(e.betrag) || 0), 0);
  }

  // Budgetverbrauch aus Vorgängen für eine Haushaltsstelle in einem Jahr.
  // Kosten sind je Eintrag einer Stelle zugeordnet; das Haushaltsjahr gilt fürs
  // ganze Projekt. Store-unabhängig gehalten (analog budgetVerbrauch für Auslagen).
  function vorgaengeVerbrauch(vorgaenge, haushaltsstelleId, jahr) {
    let sum = 0;
    for (const v of (vorgaenge || [])) {
      if (String(v.haushaltsjahr) !== String(jahr)) continue;
      sum += vorgangKostenAuf(v, haushaltsstelleId);
    }
    return sum;
  }

  GR.models = {
    SCHEMA_VERSION, uuid,
    emptyAbstimmung, emptyTop, emptySitzung,
    ergebnisAbstimmung, isEinstimmig, einstimmigRichtung,
    MITGLIED_FUNKTIONEN, fullName, emptyMitglied,
    KOSTENBOGEN_TYPEN, RAUM_ABRECHNUNGSARTEN, istPauschal,
    emptyMieter, emptyRaum, emptyRaumPreise, emptyVermietung, defaultUebergabeCheckliste,
    fullNameMieter, anzahlTage, berechneGrundmiete, berechneVerbrauch, berechneGesamt,
    AUSLAGE_STATUS, emptyEmpfaenger, fullNameEmpfaenger, formatIban, emptyHaushaltsstelle,
    emptyBeleg, emptyAuslage, gesamtbetrag, budgetVerbrauch, ABGERECHNET_STATUS,
    VERTRAG_RICHTUNGEN, VERTRAG_INTERVALLE, VERTRAG_LAUFZEIT_TYPEN, VERTRAG_STATUS,
    INTERVALL_LABEL, RICHTUNG_LABEL,
    emptyVertragspartner, emptyVertrag,
    jahresbetrag, addMonths, dateToIso, spaetesterKuendigungstermin, fristStatus, tageBisKuendigung,
    VORGANG_STATUS, VORGANG_STATUS_LABEL, HISTORIE_TYPEN, HISTORIE_TYP_LABEL,
    emptyVorgang, emptyHistorieEintrag, vorgangKosten, vorgangKostenAuf, vorgaengeVerbrauch,
  };
})();
