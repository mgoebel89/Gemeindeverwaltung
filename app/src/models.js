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

  // ===== Personen-Stammdaten (zentral für alle Module) =====
  // Ratsmitglieder, Mieter, Empfänger, Arbeiter/Firmen und Vertragspartner sind
  // EINE Liste; die Rollen-Flags sagen, wo eine Person auftaucht. Jede Person
  // behält die id ihres alten Datensatzes, darum lösen mieterId, empfaengerId,
  // arbeiterId, partnerId und die Anwesenheitslisten unverändert auf.
  //
  // ACHTUNG: Dieselbe Abbildung gibt es ein zweites Mal im Backend
  // (backend/personen.js). Browser-Skript und Node-Modul können sich keine
  // Datei teilen – Änderungen hier müssen dort nachgezogen werden.
  const PERSON_ROLLEN = ['rat', 'mieter', 'empfaenger', 'arbeiter', 'partner'];
  const PERSON_ROLLEN_LABEL = {
    rat: 'Ratsmitglied',
    mieter: 'Mieter',
    empfaenger: 'Auslagen-Empfänger',
    arbeiter: 'Arbeiter/Firma',
    partner: 'Vertragspartner',
  };
  // Welches Modul führt die Rolle? (für Hinweise und Verlinkung)
  const PERSON_ROLLEN_MODUL = {
    rat: { label: 'Sitzungen', href: '#/sitzungen' },
    mieter: { label: 'Vermietung', href: '#/vermietung' },
    empfaenger: { label: 'Bargeldauslagen', href: '#/auslagen' },
    arbeiter: { label: 'Arbeitszeiten', href: '#/arbeitszeiten' },
    partner: { label: 'Verträge', href: '#/vertraege' },
  };

  function emptyPersonRollen() {
    return { rat: false, mieter: false, empfaenger: false, arbeiter: false, partner: false };
  }

  function emptyPerson(id) {
    return {
      id: id || uuid(),
      anrede: '', vorname: '', nachname: '',
      firma: '',              // gesetzt ⇒ Anzeigename; die Person ist Ansprechpartner
      ansprechpartner: '',    // Freitext aus den alten Vertragspartnern
      strasse: '', plz: '', ort: '',
      anschriftFreitext: '',  // mehrzeilig, aus den alten Vertragspartnern
      telefon: '', email: '',
      iban: '', kontoinhaber: '',
      svNummer: '', steuerId: '', geburtsdatum: '',
      rollen: emptyPersonRollen(),
      funktion: '',           // nur Rolle rat
      ortsfremd: false,       // nur Rolle mieter
      notiz: '', aktiv: true,
      aliasIds: [],           // ids zusammengeführter Dubletten
      herkunft: [],
      zusammengefuehrt: [],   // Archiv je Zusammenführung (Rückgängig-Grundlage)
      schemaVersion: 1,
    };
  }

  function normalizePerson(p) {
    const out = Object.assign(emptyPerson((p && p.id) || ''), p || {});
    out.rollen = Object.assign(emptyPersonRollen(), (p && p.rollen) || {});
    out.aliasIds = Array.isArray(out.aliasIds) ? out.aliasIds : [];
    out.herkunft = Array.isArray(out.herkunft) ? out.herkunft : [];
    out.zusammengefuehrt = Array.isArray(out.zusammengefuehrt) ? out.zusammengefuehrt : [];
    return out;
  }

  function setPersonRolle(p, rolle, an) {
    p.rollen = Object.assign(emptyPersonRollen(), p.rollen || {});
    p.rollen[rolle] = !!an;
    return p;
  }
  function hatRolle(p, rolle) { return !!(p && p.rollen && p.rollen[rolle]); }
  function hatIrgendeineRolle(p) { return PERSON_ROLLEN.some(r => hatRolle(p, r)); }
  function personRollen(p) { return PERSON_ROLLEN.filter(r => hatRolle(p, r)); }

  const trim = (v) => String(v == null ? '' : v).trim();

  // Anzeigename: Firma falls gesetzt, sonst „Vorname Nachname".
  function personName(p) {
    if (!p) return '';
    const firma = trim(p.firma);
    if (firma) return firma;
    return [trim(p.vorname), trim(p.nachname)].filter(Boolean).join(' ');
  }
  function personLangname(p) {
    if (!p) return '';
    return [trim(p.vorname), trim(p.nachname)].filter(Boolean).join(' ');
  }
  // Zusatzzeile: bei Firmen der Ansprechpartner.
  function personZusatz(p) {
    if (!p || !trim(p.firma)) return '';
    const name = trim(p.ansprechpartner) || personLangname(p);
    return name ? 'Ansprechpartner: ' + name : '';
  }
  function personAnschrift(p) {
    if (!p) return '';
    const strukturiert = [trim(p.strasse), [trim(p.plz), trim(p.ort)].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');
    if (strukturiert) return strukturiert;
    return trim(p.anschriftFreitext).split('\n').map(x => x.trim()).filter(Boolean).join(', ');
  }
  function personKontakt(p) {
    return [trim(p && p.telefon), trim(p && p.email)].filter(Boolean).join(' · ');
  }

  // --- Sichten auf die alten Datensatzformen (und zurück) ---
  function toMitglied(p) {
    return {
      id: p.id, vorname: trim(p.vorname), nachname: trim(p.nachname),
      funktion: trim(p.funktion) || 'Ratsmitglied', aktiv: p.aktiv !== false,
      lastModifiedAt: p.lastModifiedAt,
    };
  }
  function applyMitglied(person, m) {
    const p = normalizePerson(person || emptyPerson(m.id));
    p.id = m.id;
    p.vorname = trim(m.vorname);
    p.nachname = trim(m.nachname);
    p.funktion = trim(m.funktion) || 'Ratsmitglied';
    if (m.aktiv !== undefined) p.aktiv = !!m.aktiv;
    return setPersonRolle(p, 'rat', true);
  }

  function toMieter(p) {
    return {
      id: p.id, anrede: trim(p.anrede), vorname: trim(p.vorname), nachname: trim(p.nachname),
      strasse: trim(p.strasse), plz: trim(p.plz), ort: trim(p.ort),
      telefon: trim(p.telefon), email: trim(p.email),
      ortsfremd: !!p.ortsfremd, notiz: p.notiz || '',
      lastModifiedAt: p.lastModifiedAt,
    };
  }
  function applyMieter(person, m) {
    const p = normalizePerson(person || emptyPerson(m.id));
    p.id = m.id;
    p.anrede = trim(m.anrede);
    p.vorname = trim(m.vorname);
    p.nachname = trim(m.nachname);
    p.strasse = trim(m.strasse);
    p.plz = trim(m.plz);
    p.ort = trim(m.ort);
    p.telefon = trim(m.telefon);
    p.email = trim(m.email);
    p.ortsfremd = !!m.ortsfremd;
    if (m.notiz !== undefined) p.notiz = m.notiz;
    return setPersonRolle(p, 'mieter', true);
  }

  // Falle: `name` ist beim Empfänger der NACHNAME.
  function toEmpfaenger(p) {
    return {
      id: p.id, name: trim(p.nachname) || trim(p.firma), vorname: trim(p.vorname), iban: trim(p.iban),
      lastModifiedAt: p.lastModifiedAt,
    };
  }
  function applyEmpfaenger(person, e) {
    const p = normalizePerson(person || emptyPerson(e.id));
    p.id = e.id;
    if (trim(p.firma) && trim(e.name) === trim(p.firma)) { /* Firmenname nicht doppeln */ }
    else p.nachname = trim(e.name);
    p.vorname = trim(e.vorname);
    p.iban = trim(e.iban);
    return setPersonRolle(p, 'empfaenger', true);
  }

  function toArbeiter(p) {
    return {
      id: p.id, vorname: trim(p.vorname), nachname: trim(p.nachname), firma: trim(p.firma),
      strasse: trim(p.strasse), plz: trim(p.plz), ort: trim(p.ort),
      iban: trim(p.iban), kontoinhaber: trim(p.kontoinhaber),
      svNummer: trim(p.svNummer), steuerId: trim(p.steuerId), geburtsdatum: trim(p.geburtsdatum),
      telefon: trim(p.telefon), email: trim(p.email),
      notiz: p.notiz || '', aktiv: p.aktiv !== false,
      lastModifiedAt: p.lastModifiedAt,
    };
  }
  function applyArbeiter(person, a) {
    const p = normalizePerson(person || emptyPerson(a.id));
    p.id = a.id;
    p.vorname = trim(a.vorname);
    p.nachname = trim(a.nachname);
    p.firma = trim(a.firma);
    p.strasse = trim(a.strasse);
    p.plz = trim(a.plz);
    p.ort = trim(a.ort);
    p.iban = trim(a.iban);
    p.kontoinhaber = trim(a.kontoinhaber);
    p.svNummer = trim(a.svNummer);
    p.steuerId = trim(a.steuerId);
    p.geburtsdatum = trim(a.geburtsdatum);
    p.telefon = trim(a.telefon);
    p.email = trim(a.email);
    if (a.notiz !== undefined) p.notiz = a.notiz;
    if (a.aktiv !== undefined) p.aktiv = !!a.aktiv;
    return setPersonRolle(p, 'arbeiter', true);
  }

  // Falle: `name` ist beim Vertragspartner die FIRMA, `anschrift` Freitext.
  function toVertragspartner(p) {
    const anschrift = trim(p.anschriftFreitext)
      || [trim(p.strasse), [trim(p.plz), trim(p.ort)].filter(Boolean).join(' ')].filter(Boolean).join('\n');
    return {
      id: p.id, name: personName(p), anschrift,
      ansprechpartner: trim(p.ansprechpartner) || (trim(p.firma) ? personLangname(p) : ''),
      telefon: trim(p.telefon), email: trim(p.email), notiz: p.notiz || '',
      lastModifiedAt: p.lastModifiedAt,
    };
  }
  function applyVertragspartner(person, v) {
    const p = normalizePerson(person || emptyPerson(v.id));
    p.id = v.id;
    const name = trim(v.name);
    if (name && name === personLangname(p)) { /* Personenname unverändert */ }
    else p.firma = name;
    p.ansprechpartner = trim(v.ansprechpartner);
    p.anschriftFreitext = v.anschrift || '';
    p.telefon = trim(v.telefon);
    p.email = trim(v.email);
    if (v.notiz !== undefined) p.notiz = v.notiz;
    return setPersonRolle(p, 'partner', true);
  }

  // ===== Personen zusammenführen (Dubletten) =====
  // Nach dem Zusammenlegen der fünf alten Listen steht dieselbe Person leicht
  // mehrfach in den Stammdaten – einmal als Mieter, einmal als Empfänger, mit
  // abweichender Schreibweise. Diese Helfer finden solche Paare und rechnen
  // zwei Datensätze zu einem zusammen, OHNE dass etwas verloren geht:
  //
  //  * Felder, die nur eine Seite gefüllt hat, wandern still herüber.
  //  * Bei echten Konflikten entscheidet die Auswahl des Nutzers; der nicht
  //    gewählte Wert bleibt im Archiv (`zusammengefuehrt`) erhalten.
  //  * Alle Verweise der Module werden auf die Zielperson umgeschrieben, und
  //    zwar an ALLEN Stellen – auch in den TOPs einer Sitzung und in den
  //    Anwesenheitszeiten, wo die id als Objekt-SCHLÜSSEL steht.
  //  * Die aufgegebene id bleibt als Alias stehen, damit ein später
  //    eingespieltes Backup weiterhin auflöst.

  // Felder, die beim Zusammenführen abgeglichen werden. `sensibel` = nur in der
  // Leitungs-Ansicht sichtbar (IBAN, Steuer/SV) – siehe views/stammdaten.js.
  const PERSON_FELDER = [
    { key: 'anrede', label: 'Anrede' },
    { key: 'firma', label: 'Firma' },
    { key: 'vorname', label: 'Vorname' },
    { key: 'nachname', label: 'Nachname' },
    { key: 'ansprechpartner', label: 'Ansprechpartner' },
    { key: 'strasse', label: 'Straße & Hausnummer' },
    { key: 'plz', label: 'PLZ' },
    { key: 'ort', label: 'Ort' },
    { key: 'anschriftFreitext', label: 'Abweichende Anschrift', mehrzeilig: true },
    { key: 'telefon', label: 'Telefon' },
    { key: 'email', label: 'E-Mail' },
    { key: 'iban', label: 'IBAN', sensibel: true },
    { key: 'kontoinhaber', label: 'Kontoinhaber', sensibel: true },
    { key: 'svNummer', label: 'Sozialversicherungsnummer', sensibel: true },
    { key: 'steuerId', label: 'Steuer-ID', sensibel: true },
    { key: 'geburtsdatum', label: 'Geburtsdatum', sensibel: true },
    { key: 'funktion', label: 'Funktion im Rat' },
    { key: 'ortsfremd', label: 'Ortsfremd', bool: true },
  ];

  // Wo in den Modulen Personen-ids stecken. Die Sitzung ist der Sonderfall:
  // dort hängen Verweise zusätzlich in jedem TOP und als Schlüssel der
  // Anwesenheitszeiten.
  const PERSON_VERWEISE = [
    { art: 'sitzungen', label: 'Sitzung', labelMehrzahl: 'Sitzungen', rolle: 'rat' },
    { art: 'vermietungen', label: 'Vermietung', labelMehrzahl: 'Vermietungen', rolle: 'mieter', felder: ['mieterId'] },
    { art: 'auslagen', label: 'Bargeldauslage', labelMehrzahl: 'Bargeldauslagen', rolle: 'empfaenger', felder: ['empfaengerId'] },
    { art: 'arbeitszeiten', label: 'Arbeitszeit', labelMehrzahl: 'Arbeitszeiten', rolle: 'arbeiter', felder: ['arbeiterId'] },
    { art: 'arbeitsabrechnungen', label: 'Abrechnung', labelMehrzahl: 'Abrechnungen', rolle: 'arbeiter', felder: ['arbeiterId'] },
    { art: 'vertraege', label: 'Vertrag', labelMehrzahl: 'Verträge', rolle: 'partner', felder: ['partnerId'] },
  ];

  const TOP_PERSON_LISTEN = ['befangenheitsIds', 'freiwilligerVerzichtIds', 'stimmrechtRuhtIds'];

  function verweisArt(art) { return PERSON_VERWEISE.find(v => v.art === art) || null; }

  // --- Vergleichs-Normalisierung ---
  // Umlaute falten, damit „Müller" und „Mueller" zusammenfinden.
  function faltUmlaute(text) {
    return String(text || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  }
  function namensTeile(p) {
    const roh = [p && p.firma, p && p.vorname, p && p.nachname].map(x => faltUmlaute(x));
    return roh.join(' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  }
  // Reihenfolge-unabhängiger Namensschlüssel: „Hans Müller" == „Müller, Hans".
  function personNameSchluessel(p) { return namensTeile(p).slice().sort().join(' '); }
  function nurZiffern(text) { return String(text || '').replace(/\D+/g, ''); }
  function ibanSchluessel(p) { return String((p && p.iban) || '').replace(/\s+/g, '').toUpperCase(); }
  function emailSchluessel(p) { return String((p && p.email) || '').trim().toLowerCase(); }
  // Telefonnummern nur über die letzten Stellen vergleichen – Vorwahl-
  // Schreibweisen (0049, +49, 02692) gehen sonst auseinander.
  function telefonSchluessel(p) {
    const z = nurZiffern(p && p.telefon);
    return z.length >= 6 ? z.slice(-8) : '';
  }
  function anschriftSchluessel(p) {
    const s = faltUmlaute([p && p.strasse, p && p.plz, p && p.ort].filter(Boolean).join(' '))
      .replace(/stra(ss|s)e\b/g, 'str').replace(/[^a-z0-9]+/g, '');
    return s.length >= 6 ? s : '';
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let zeile = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let vorher = zeile[0];
      zeile[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const temp = zeile[j];
        zeile[j] = Math.min(zeile[j] + 1, zeile[j - 1] + 1, vorher + (a[i - 1] === b[j - 1] ? 0 : 1));
        vorher = temp;
      }
    }
    return zeile[b.length];
  }
  function namensAehnlichkeit(a, b) {
    if (!a || !b) return 0;
    const max = Math.max(a.length, b.length);
    return max ? 1 - levenshtein(a, b) / max : 0;
  }

  // Rechtsformen zählen beim Namensvergleich nicht als eigenes Namenswort.
  const RECHTSFORMEN = ['gmbh', 'mbh', 'ag', 'kg', 'ohg', 'gbr', 'ug', 'se', 'kgaa', 'co', 'e', 'v', 'ev'];

  // Steckt der eine Name vollständig im anderen? „Bauhof Kelberg" ⊂ „Bauhof
  // Kelberg GmbH". Bei nur EINEM gemeinsamen Wort darf der Rest ausschließlich
  // aus Rechtsformen bestehen – sonst wäre „Meyer" eine Dublette jedes
  // „Karl Meyer", und das ist es gerade nicht.
  function nameEnthalten(a, b) {
    const tA = namensTeile(a), tB = namensTeile(b);
    if (!tA.length || !tB.length) return false;
    const klein = tA.length <= tB.length ? tA : tB;
    const gross = tA.length <= tB.length ? tB : tA;
    if (!klein.every(w => gross.includes(w))) return false;
    if (klein.length >= 2) return true;
    const rest = gross.filter(w => !klein.includes(w));
    return rest.length > 0 && rest.every(w => RECHTSFORMEN.includes(w));
  }

  const DUBLETTE_SICHER = 80;
  const DUBLETTE_WAHRSCHEINLICH = 55;
  const DUBLETTE_SCHWELLE = 35;

  // Bewertet zwei Personen als mögliche Dublette. Rückgabe {score, gruende[]}.
  // Die Punkte sind bewusst grob: sie sortieren die Vorschläge, entscheiden
  // aber nichts – zusammengeführt wird nur, was bestätigt wurde.
  function personDublettenScore(a, b) {
    const gruende = [];
    let score = 0;
    const iban = ibanSchluessel(a);
    if (iban && iban === ibanSchluessel(b)) { score += 50; gruende.push('gleiche IBAN'); }
    const mail = emailSchluessel(a);
    if (mail && mail === emailSchluessel(b)) { score += 40; gruende.push('gleiche E-Mail'); }
    const tel = telefonSchluessel(a);
    if (tel && tel === telefonSchluessel(b)) { score += 25; gruende.push('gleiche Telefonnummer'); }
    const gebA = String(a.geburtsdatum || '').trim();
    if (gebA && gebA === String(b.geburtsdatum || '').trim()) { score += 25; gruende.push('gleiches Geburtsdatum'); }
    const adr = anschriftSchluessel(a);
    if (adr && adr === anschriftSchluessel(b)) { score += 15; gruende.push('gleiche Anschrift'); }

    const nA = personNameSchluessel(a);
    const nB = personNameSchluessel(b);
    let nameTrifft = false;
    if (nA && nB) {
      // Ein exakt gleicher Name reicht allein für „wahrscheinlich" – genau so
      // sehen die Dubletten aus, die beim Zusammenlegen der fünf alten Listen
      // entstanden sind (dieselbe Person einmal als Mieter, einmal als
      // Empfänger). Zusammen mit IBAN, E-Mail oder Geburtsdatum wird daraus
      // „sehr wahrscheinlich".
      if (nA === nB) { score += 55; gruende.push('gleicher Name'); nameTrifft = true; }
      // Muss VOR den Zeichenabstand: der Zusatz verlängert die Zeichenkette
      // stark, „Bauhof Kelberg" gegen „Bauhof Kelberg GmbH" käme sonst nur als
      // schwacher Zufallstreffer durch.
      else if (nameEnthalten(a, b)) { score += 35; gruende.push('Name im anderen enthalten'); nameTrifft = true; }
      else {
        const aehnlich = namensAehnlichkeit(nA, nB);
        if (aehnlich >= 0.85) { score += 35; gruende.push('fast gleicher Name'); nameTrifft = true; }
        else if (aehnlich >= 0.72) { score += 15; gruende.push('ähnlicher Name'); nameTrifft = true; }
      }
    }

    // Nachname gleich und Vorname mit demselben Buchstaben („H. Müller").
    if (!nameTrifft) {
      const nnA = faltUmlaute(a.nachname).trim();
      const nnB = faltUmlaute(b.nachname).trim();
      const vA = faltUmlaute(a.vorname).trim();
      const vB = faltUmlaute(b.vorname).trim();
      if (nnA && nnA === nnB && vA && vB && vA[0] === vB[0]) {
        score += 20; gruende.push('gleicher Nachname, gleiche Anfangsbuchstaben');
      }
    }
    return { score, gruende };
  }

  function dublettenStufe(score) {
    if (score >= DUBLETTE_SICHER) return 'sicher';
    if (score >= DUBLETTE_WAHRSCHEINLICH) return 'wahrscheinlich';
    return 'moeglich';
  }
  const DUBLETTE_STUFE_LABEL = { sicher: 'sehr wahrscheinlich', wahrscheinlich: 'wahrscheinlich', moeglich: 'möglich' };

  function paarSchluessel(idA, idB) { return [idA, idB].sort().join('|'); }

  // Alle Verdachtspaare, stärkster Verdacht zuerst. `ignoriert` ist die Liste
  // der als „kein Duplikat" abgehakten Paare (Paarschlüssel).
  function findePersonenDubletten(personen, ignoriert) {
    const weg = new Set(ignoriert || []);
    const paare = [];
    for (let i = 0; i < personen.length; i++) {
      for (let j = i + 1; j < personen.length; j++) {
        const a = personen[i], b = personen[j];
        if (weg.has(paarSchluessel(a.id, b.id))) continue;
        const { score, gruende } = personDublettenScore(a, b);
        if (score < DUBLETTE_SCHWELLE || !gruende.length) continue;
        paare.push({ schluessel: paarSchluessel(a.id, b.id), a, b, score, gruende, stufe: dublettenStufe(score) });
      }
    }
    return paare.sort((x, y) => y.score - x.score
      || personName(x.a).localeCompare(personName(y.a), 'de'));
  }

  const wert = (p, key, feld) => (feld && feld.bool ? !!(p && p[key]) : trim(p && p[key]));
  const gefuellt = (p, key, feld) => (feld && feld.bool ? !!(p && p[key]) : !!trim(p && p[key]));

  function anzahlGefuellt(p) {
    return PERSON_FELDER.filter(f => gefuellt(p, f.key, f)).length + (trim(p && p.notiz) ? 1 : 0);
  }

  // Welcher der beiden Datensätze soll bestehen bleiben? Es gewinnt, wer mehr
  // Einträge in den Modulen hat (dann sind weniger Verweise umzuschreiben);
  // bei Gleichstand der vollständigere, dann der ältere.
  function besseresZiel(a, b, verweiseA, verweiseB) {
    if ((verweiseA || 0) !== (verweiseB || 0)) return (verweiseA || 0) > (verweiseB || 0) ? a : b;
    const fa = anzahlGefuellt(a), fb = anzahlGefuellt(b);
    if (fa !== fb) return fa > fb ? a : b;
    const za = String(a.lastModifiedAt || ''), zb = String(b.lastModifiedAt || '');
    if (za && zb && za !== zb) return za < zb ? a : b;
    return a;
  }

  // Welcher Wert steht bei einem Konflikt vorne? Der längere (meist der
  // vollständigere), sonst der aus dem zuletzt geänderten Datensatz.
  function vorauswahl(ziel, quelle, key, feld) {
    const zw = wert(ziel, key, feld), qw = wert(quelle, key, feld);
    if (feld && feld.bool) return 'ziel';
    if (String(qw).length !== String(zw).length) return String(qw).length > String(zw).length ? 'quelle' : 'ziel';
    const zz = String(ziel.lastModifiedAt || ''), qz = String(quelle.lastModifiedAt || '');
    return (qz && zz && qz > zz) ? 'quelle' : 'ziel';
  }

  // Feldweiser Vergleich als Grundlage der Assistenten-Oberfläche.
  // `konflikt` = beide Seiten gefüllt und verschieden; `ergaenzt` = nur die
  // Quelle hat einen Wert, er wandert ohne Rückfrage herüber.
  function mergeVorschlag(ziel, quelle) {
    const felder = [];
    for (const feld of PERSON_FELDER) {
      const zw = wert(ziel, feld.key, feld), qw = wert(quelle, feld.key, feld);
      const zGefuellt = gefuellt(ziel, feld.key, feld), qGefuellt = gefuellt(quelle, feld.key, feld);
      if (!zGefuellt && !qGefuellt) continue;
      const zeile = { key: feld.key, label: feld.label, feld, zielWert: zw, quelleWert: qw };
      if (String(zw) === String(qw)) zeile.gleich = true;
      else if (!zGefuellt) { zeile.ergaenzt = true; zeile.auswahl = 'quelle'; }
      else if (!qGefuellt) { zeile.nurZiel = true; zeile.auswahl = 'ziel'; }
      else { zeile.konflikt = true; zeile.auswahl = vorauswahl(ziel, quelle, feld.key, feld); }
      felder.push(zeile);
    }
    const rollenNeu = PERSON_ROLLEN.filter(r => hatRolle(quelle, r) && !hatRolle(ziel, r));
    return { felder, konflikte: felder.filter(f => f.konflikt), rollenNeu };
  }

  // Notizen gehen nie verloren: unterschiedliche Texte werden aneinandergehängt.
  function notizenVerbinden(zielNotiz, quelleNotiz, quelleName) {
    const z = trim(zielNotiz), q = trim(quelleNotiz);
    if (!q || z === q) return zielNotiz || '';
    if (!z) return quelleNotiz || '';
    return z + '\n\n— aus zusammengeführtem Eintrag' + (quelleName ? ' „' + quelleName + '"' : '') + ':\n' + q;
  }

  function vereinige(a, b) {
    const out = [];
    for (const x of [].concat(a || [], b || [])) if (x && !out.includes(x)) out.push(x);
    return out;
  }

  const kopie = (o) => JSON.parse(JSON.stringify(o == null ? null : o));

  // Baut die zusammengeführte Person. `wahl` = {feldKey: 'ziel'|'quelle'},
  // `verweise` = das Protokoll der umgeschriebenen Datensätze (fürs Rückgängig).
  // Verändert die übergebenen Objekte nicht.
  function mergePersonen(ziel, quelle, wahl, verweise) {
    const z = normalizePerson(kopie(ziel));
    const q = normalizePerson(kopie(quelle));
    const vorher = normalizePerson(kopie(ziel));
    delete vorher.zusammengefuehrt;  // sonst schachtelt sich das Archiv bei jeder Zusammenführung neu

    for (const feld of PERSON_FELDER) {
      const w = wahl && wahl[feld.key];
      if (w === 'quelle') z[feld.key] = q[feld.key];
      else if (w === 'ziel') continue;
      else if (!gefuellt(z, feld.key, feld) && gefuellt(q, feld.key, feld)) z[feld.key] = q[feld.key];
    }
    z.notiz = notizenVerbinden(ziel.notiz, quelle.notiz, personName(quelle));
    for (const r of PERSON_ROLLEN) if (hatRolle(q, r)) setPersonRolle(z, r, true);
    // Aktiv, sobald eine der beiden Seiten aktiv war – sonst verschwände die
    // Person unbemerkt aus allen Auswahllisten.
    z.aktiv = (ziel.aktiv !== false) || (quelle.aktiv !== false);
    z.aliasIds = vereinige(vereinige(z.aliasIds, q.aliasIds), [q.id]);
    z.herkunft = vereinige(z.herkunft, q.herkunft);
    z.zusammengefuehrt = (Array.isArray(ziel.zusammengefuehrt) ? ziel.zusammengefuehrt.slice() : []).concat([{
      id: uuid(),
      at: new Date().toISOString(),
      quelleId: q.id,
      quelleName: personName(q),
      quelle: q,            // vollständige Kopie des aufgegebenen Datensatzes
      zielVorher: vorher,   // Zielperson vor der Zusammenführung
      wahl: Object.assign({}, wahl || {}),
      verweise: verweise || {},
    }]);
    return z;
  }

  // --- Verweise in den Modul-Datensätzen ---
  function istPersonImDatensatz(rec, art, id) {
    if (!rec || !id) return false;
    if (art === 'sitzungen') {
      if (rec.sitzungsleitungId === id || rec.schriftfuehrerId === id) return true;
      if (Array.isArray(rec.anwesendIds) && rec.anwesendIds.includes(id)) return true;
      const zeiten = rec.anwesenheitsZeiten;
      if (zeiten && typeof zeiten === 'object' && Object.prototype.hasOwnProperty.call(zeiten, id)) return true;
      return (rec.tops || []).some(t => t.sitzungsleitungId === id
        || TOP_PERSON_LISTEN.some(k => Array.isArray(t[k]) && t[k].includes(id)));
    }
    const def = verweisArt(art);
    return !!(def && (def.felder || []).some(f => rec[f] === id));
  }

  // Schreibt alle Verweise von `altId` auf `neuId` um. Rückgabe
  // {geaendert, vorher} – `vorher` enthält NUR die angefassten Felder und ist
  // die Grundlage für stellePersonVerweiseHer().
  function ersetzePersonVerweise(rec, art, altId, neuId) {
    const vorher = {};
    let geaendert = false;
    const skalar = (obj, key, ziel) => {
      if (obj[key] !== altId) return;
      ziel[key] = obj[key];
      obj[key] = neuId;
      geaendert = true;
    };
    // In Listen kann die Zielperson schon stehen (beide waren anwesend) –
    // dann darf sie nicht doppelt auftauchen.
    const liste = (obj, key, ziel) => {
      const arr = obj[key];
      if (!Array.isArray(arr) || !arr.includes(altId)) return;
      ziel[key] = arr.slice();
      const neu = [];
      for (const id of arr) {
        const x = id === altId ? neuId : id;
        if (!neu.includes(x)) neu.push(x);
      }
      obj[key] = neu;
      geaendert = true;
    };

    if (art === 'sitzungen') {
      skalar(rec, 'sitzungsleitungId', vorher);
      skalar(rec, 'schriftfuehrerId', vorher);
      liste(rec, 'anwesendIds', vorher);
      const zeiten = rec.anwesenheitsZeiten;
      if (zeiten && typeof zeiten === 'object' && Object.prototype.hasOwnProperty.call(zeiten, altId)) {
        vorher.anwesenheitsZeiten = Object.assign({}, zeiten);
        // Hat die Zielperson eigene Zeiten, behalten sie Vorrang.
        if (!Object.prototype.hasOwnProperty.call(zeiten, neuId)) zeiten[neuId] = zeiten[altId];
        delete zeiten[altId];
        geaendert = true;
      }
      const tops = [];
      for (const t of (rec.tops || [])) {
        const tv = {};
        skalar(t, 'sitzungsleitungId', tv);
        for (const k of TOP_PERSON_LISTEN) liste(t, k, tv);
        if (Object.keys(tv).length) tops.push(Object.assign({ id: t.id }, tv));
      }
      if (tops.length) vorher.tops = tops;
    } else {
      const def = verweisArt(art);
      for (const f of ((def && def.felder) || [])) skalar(rec, f, vorher);
    }
    return { geaendert, vorher };
  }

  function stellePersonVerweiseHer(rec, art, vorher) {
    if (!rec || !vorher) return;
    for (const [key, alt] of Object.entries(vorher)) {
      if (key === 'tops') {
        for (const tv of alt) {
          const t = (rec.tops || []).find(x => x.id === tv.id);
          if (!t) continue;
          for (const [tk, tw] of Object.entries(tv)) if (tk !== 'id') t[tk] = tw;
        }
      } else rec[key] = alt;
    }
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
  const HISTORIE_TYPEN = ['notiz', 'todo', 'foto', 'dokument', 'referenz', 'kosten', 'angebot', 'entscheidung', 'email'];
  const HISTORIE_TYP_LABEL = {
    notiz: 'Notiz', todo: 'ToDo', foto: 'Foto', dokument: 'Dokument',
    referenz: 'Referenz', kosten: 'Kosten', angebot: 'Angebot', entscheidung: 'Auswahl',
    email: 'E-Mail',
  };
  // Klartext-Skala der Bewertungspunkte in der Entscheidungsmatrix (0–5).
  const SCORE_MIN = 0, SCORE_MAX = 5;
  const SCORE_LABEL = {
    0: 'trifft nicht zu', 1: 'trifft kaum zu', 2: 'trifft wenig zu',
    3: 'trifft teilweise zu', 4: 'trifft weitgehend zu', 5: 'trifft voll zu',
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

  // ===== Angebote & Entscheidungsmatrix (Vorgangshistorie) =====
  // Alle Angebots-Historieneinträge eines Vorgangs.
  function vorgangAngebote(v) {
    return (v && v.historie || []).filter(e => e.typ === 'angebot');
  }

  // Gewichtete Gesamtpunktzahl eines Teilnehmers in einer Entscheidungsmatrix:
  // Σ (Punkt 0–5 × Gewicht der Eigenschaft). Fehlende Punkte zählen als 0.
  function entscheidungScore(e, angebotId) {
    if (!e || !Array.isArray(e.eigenschaften)) return 0;
    const zeile = (e.bewertung && e.bewertung[angebotId]) || {};
    let sum = 0;
    for (const eig of e.eigenschaften) {
      const p = Number(zeile[eig.id]) || 0;
      const g = eig.gewicht != null ? Number(eig.gewicht) : 1;
      sum += p * (isNaN(g) ? 1 : g);
    }
    return sum;
  }

  // Maximal erreichbare Punktzahl (SCORE_MAX × Σ Gewichte) – für Prozentanzeige.
  function entscheidungMaxScore(e) {
    if (!e || !Array.isArray(e.eigenschaften)) return 0;
    const gsum = e.eigenschaften.reduce((s, eig) => s + (eig.gewicht != null ? (Number(eig.gewicht) || 0) : 1), 0);
    return SCORE_MAX * gsum;
  }

  // angebotId des punkthöchsten Teilnehmers (Empfehlung). Bei Gleichstand der
  // erste in der Teilnehmerreihenfolge. null, wenn keine Teilnehmer.
  function entscheidungGewinner(e) {
    if (!e || !Array.isArray(e.teilnehmer) || e.teilnehmer.length === 0) return null;
    let best = null, bestScore = -Infinity;
    for (const t of e.teilnehmer) {
      const s = entscheidungScore(e, t.angebotId);
      if (s > bestScore) { bestScore = s; best = t.angebotId; }
    }
    return best;
  }

  // Ist der Auswahlprozess abgeschlossen? (Anbieter gewählt + Begründung gesetzt)
  function entscheidungAbgeschlossen(e) {
    return !!(e && e.gewaehltId && String(e.begruendung || '').trim());
  }

  // ===== Modul Arbeitszeiten & Vergütung =====
  // Leistungserbringer sind EIN Stammdatentyp (kein Person/Firma-Umschalter):
  // immer Vor-/Nachname, zusätzlich ein optionales Feld „Firma". Ist es gesetzt,
  // ist die Firma der Anzeigename und der Name der Ansprechpartner.
  const ARBEITSZEIT_STATUS = ['erfasst', 'abgerechnet', 'ausgezahlt'];
  const ARBEITSZEIT_STATUS_LABEL = {
    erfasst: 'Erfasst', abgerechnet: 'Abgerechnet', ausgezahlt: 'Ausgezahlt',
  };
  // Arbeitszeiten, die das Budget einer Haushaltsstelle mindern: ab „abgerechnet"
  // (reine Erfassungen zählen noch nicht) – analog zu ABGERECHNET_STATUS.
  const ARBEITSZEIT_GEBUCHT_STATUS = ['abgerechnet', 'ausgezahlt'];

  function emptyArbeiter() {
    return {
      id: uuid(),
      vorname: '', nachname: '',
      firma: '',            // optional; gesetzt ⇒ Anzeigename, Name = Ansprechpartner
      strasse: '', plz: '', ort: '',
      iban: '', kontoinhaber: '',
      svNummer: '', steuerId: '', geburtsdatum: '',
      telefon: '', email: '', notiz: '',
      aktiv: true,
    };
  }

  // Anzeigename: Firma falls gesetzt, sonst „Vorname Nachname".
  function arbeiterName(a) {
    if (!a) return '';
    const firma = (a.firma || '').trim();
    if (firma) return firma;
    return [(a.vorname || '').trim(), (a.nachname || '').trim()].filter(Boolean).join(' ') || '(ohne Namen)';
  }
  // Zusatzzeile: bei Firma der Ansprechpartner, sonst leer.
  function arbeiterZusatz(a) {
    if (!a || !(a.firma || '').trim()) return '';
    const p = [(a.vorname || '').trim(), (a.nachname || '').trim()].filter(Boolean).join(' ');
    return p ? 'Ansprechpartner: ' + p : '';
  }

  function emptyArbeitszeit() {
    return {
      id: uuid(),
      arbeiterId: '',
      datum: heuteIso(),      // Leistungsdatum – bestimmt den gültigen Satz
      taetigkeit: '',
      stunden: 0,
      satzManuell: null,      // überschreibt den einheitlichen Satz (z. B. Firmen)
      notiz: '',
      status: 'erfasst',      // 'erfasst' | 'abgerechnet' | 'ausgezahlt'
      abrechnungId: null,
      satzSnapshot: null,     // beim Abrechnen eingefroren
      betragSnapshot: null,
    };
  }

  function emptyArbeitsabrechnung() {
    return {
      id: uuid(),
      arbeiterId: '',
      zeitraumVon: '', zeitraumBis: '',
      erstelltAm: heuteIso(),
      haushaltsstelleId: '',
      haushaltsjahr: new Date().getFullYear(),
      positionen: [],         // [{arbeitszeitId, datum, taetigkeit, stunden, satz, betrag}]
      // Feld 8 des VG-Vordrucks: Beträge ohne Arbeitsstunden (z. B. Maschineneinsatz).
      // Läuft bewusst NICHT in summeBetrag – der Vordruck weist es unter dem
      // Arbeitslohn aus –, zählt im Haushalt aber mit (arbeitszeitenVerbrauch).
      kostenerstattungen: [],  // [{id, beschreibung, betrag}]
      summeKostenerstattung: 0,
      summeStunden: 0, summeBetrag: 0,
      status: 'abgerechnet',  // 'abgerechnet' | 'ausgezahlt'
      ausgezahltAm: '', notiz: '',
    };
  }

  function emptyKostenerstattung() {
    return { id: uuid(), beschreibung: '', betrag: 0 };
  }

  function heuteIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Einheitlicher Stundensatz zum Leistungsdatum: jüngster Satz mit gueltigAb ≤ datum.
  // historie = [{gueltigAb:'YYYY-MM-DD', betrag:Number}]
  function satzFuer(historie, datum) {
    const liste = (historie || [])
      .filter(s => s && s.gueltigAb && Number(s.betrag) >= 0)
      .filter(s => String(s.gueltigAb) <= String(datum || ''))
      .sort((a, b) => String(a.gueltigAb).localeCompare(String(b.gueltigAb)));
    return liste.length ? Number(liste[liste.length - 1].betrag) : null;
  }

  // Effektiver Satz eines Eintrags: manueller Satz schlägt den einheitlichen.
  function arbeitszeitSatz(z, historie) {
    if (z && z.satzSnapshot != null) return Number(z.satzSnapshot); // eingefroren
    if (z && z.satzManuell != null && z.satzManuell !== '') return Number(z.satzManuell);
    return satzFuer(historie, z && z.datum);
  }
  function arbeitszeitBetrag(z, historie) {
    if (z && z.betragSnapshot != null) return Number(z.betragSnapshot);
    const satz = arbeitszeitSatz(z, historie);
    if (satz == null) return null;
    return Math.round(satz * (Number(z && z.stunden) || 0) * 100) / 100;
  }

  // Summe der Kostenerstattungen einer Abrechnung (Feld 8 des VG-Vordrucks).
  function abrechnungKostenSumme(abr) {
    return Math.round(((abr && abr.kostenerstattungen) || [])
      .reduce((s, k) => s + (Number(k.betrag) || 0), 0) * 100) / 100;
  }

  // Verbrauch der Arbeitsabrechnungen auf einer Haushaltsstelle (fürs Modul
  // Haushalt). Zählt ab Status „abgerechnet" – Erfassungen noch nicht.
  // Kostenerstattungen stehen im Vordruck neben dem Arbeitslohn, belasten den
  // Haushalt aber genauso – daher hier addiert.
  function arbeitszeitenVerbrauch(abrechnungen, haushaltsstelleId, jahr) {
    return (abrechnungen || [])
      .filter(a => a.haushaltsstelleId === haushaltsstelleId
        && String(a.haushaltsjahr) === String(jahr)
        && ARBEITSZEIT_GEBUCHT_STATUS.includes(a.status || 'abgerechnet'))
      .reduce((s, a) => s + (Number(a.summeBetrag) || 0)
        + (a.summeKostenerstattung != null ? Number(a.summeKostenerstattung) || 0 : abrechnungKostenSumme(a)), 0);
  }

  // --- Kalenderwochen (ISO 8601, Montag = erster Tag) -----------------------
  // Durchweg über lokale Datumskomponenten: `new Date('YYYY-MM-DD')` liest UTC
  // und verschiebt die Woche um einen Tag.
  function isoZuDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  // Montag der Woche, in der `datum` liegt.
  function wochenMontag(datum) {
    const d = isoZuDate(datum);
    if (!d) return '';
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // So=0 → 6, Mo=1 → 0
    return dateToIso(d);
  }
  function wochenSonntag(datum) {
    const mo = isoZuDate(wochenMontag(datum));
    if (!mo) return '';
    mo.setDate(mo.getDate() + 6);
    return dateToIso(mo);
  }
  // ISO-Kalenderwoche: der Donnerstag der Woche bestimmt Woche und Jahr.
  function isoKw(datum) {
    const d = isoZuDate(datum);
    if (!d) return null;
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
    const jahr = d.getFullYear();
    const jan4 = new Date(jahr, 0, 4);
    const ersterDo = new Date(jahr, 0, 4 - ((jan4.getDay() + 6) % 7) + 3);
    const kw = Math.round((d - ersterDo) / (7 * 24 * 3600 * 1000)) + 1;
    return { kw, jahr };
  }
  // „KW 28 · 06.07.–12.07.2026“ – Beschriftung der Wochenauswahl.
  function wochenLabel(datum) {
    const k = isoKw(datum);
    const mo = wochenMontag(datum), so = wochenSonntag(datum);
    if (!k || !mo) return '';
    const kurz = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
    return `KW ${k.kw} · ${kurz(mo)}–${kurz(so)}${so.slice(0, 4)}`;
  }
  function wochePlus(datum, n) {
    const mo = isoZuDate(wochenMontag(datum));
    if (!mo) return '';
    mo.setDate(mo.getDate() + 7 * (Number(n) || 0));
    return dateToIso(mo);
  }

  // --- Monate (Abrechnungszeitraum: ein Formular je Monat) ------------------
  const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  function monatsSchluessel(datum) { return String(datum || '').slice(0, 7); } // 'YYYY-MM'
  function monatsErster(datum) { return monatsSchluessel(datum) + '-01'; }
  function monatsLetzter(datum) {
    const k = monatsSchluessel(datum);
    if (!/^\d{4}-\d{2}$/.test(k)) return '';
    const [j, m] = k.split('-').map(Number);
    return dateToIso(new Date(j, m, 0)); // Tag 0 des Folgemonats = letzter Tag
  }
  function monatsLabel(datum) {
    const k = monatsSchluessel(datum);
    if (!/^\d{4}-\d{2}$/.test(k)) return '';
    const [j, m] = k.split('-').map(Number);
    return MONATSNAMEN[m - 1] + ' ' + j;
  }
  function monatPlus(datum, n) {
    const k = monatsSchluessel(datum);
    if (!/^\d{4}-\d{2}$/.test(k)) return '';
    const [j, m] = k.split('-').map(Number);
    return dateToIso(new Date(j, m - 1 + (Number(n) || 0), 1));
  }

  // --- Aufbereitung für den VG-Vordruck ------------------------------------
  // Feld 5: Positionen nach Tätigkeitsbezeichnung zusammenfassen, Stunden
  // addiert. Reihenfolge = erstes Auftreten, damit sie zur Erfassung passt.
  function abrechnungArbeiten(abr) {
    const map = new Map();
    for (const p of ((abr && abr.positionen) || [])) {
      const key = (p.taetigkeit || '').trim() || '(ohne Bezeichnung)';
      const e = map.get(key) || { taetigkeit: key, stunden: 0 };
      e.stunden += Number(p.stunden) || 0;
      map.set(key, e);
    }
    return [...map.values()].map(e => ({ ...e, stunden: Math.round(e.stunden * 100) / 100 }));
  }

  // Feld 6: Positionen auf Kalenderwochen und Wochentage aggregieren.
  // Stecken in einer Woche verschiedene Stundensätze, wird die Woche auf
  // mehrere Zeilen gesplittet – der Vordruck hat je Zeile nur EIN „Entgelt pro
  // Stunde". Rückgabe je Zeile: {von, bis, satz, tage:[Mo..So], stunden, betrag}.
  function abrechnungWochenzeilen(abr) {
    const zeilen = new Map(); // 'montag|satz' → Zeile
    for (const p of ((abr && abr.positionen) || [])) {
      const mo = wochenMontag(p.datum);
      if (!mo) continue;
      const satz = Number(p.satz) || 0;
      const key = mo + '|' + satz;
      let z = zeilen.get(key);
      if (!z) {
        z = { von: mo, bis: wochenSonntag(p.datum), satz, tage: [0, 0, 0, 0, 0, 0, 0], stunden: 0, betrag: 0 };
        zeilen.set(key, z);
      }
      const d = isoZuDate(p.datum);
      z.tage[(d.getDay() + 6) % 7] += Number(p.stunden) || 0;
      z.stunden += Number(p.stunden) || 0;
      z.betrag += Number(p.betrag) || 0;
    }
    return [...zeilen.values()]
      .sort((a, b) => a.von.localeCompare(b.von) || a.satz - b.satz)
      .map(z => ({
        ...z,
        tage: z.tage.map(t => Math.round(t * 100) / 100),
        stunden: Math.round(z.stunden * 100) / 100,
        betrag: Math.round(z.betrag * 100) / 100,
      }));
  }

  GR.models = {
    SCHEMA_VERSION, uuid,
    emptyAbstimmung, emptyTop, emptySitzung,
    ergebnisAbstimmung, isEinstimmig, einstimmigRichtung,
    MITGLIED_FUNKTIONEN, fullName, emptyMitglied,
    PERSON_ROLLEN, PERSON_ROLLEN_LABEL, PERSON_ROLLEN_MODUL,
    emptyPerson, emptyPersonRollen, normalizePerson, setPersonRolle,
    hatRolle, hatIrgendeineRolle, personRollen,
    personName, personLangname, personZusatz, personAnschrift, personKontakt,
    toMitglied, applyMitglied, toMieter, applyMieter, toEmpfaenger, applyEmpfaenger,
    toArbeiter, applyArbeiter, toVertragspartner, applyVertragspartner,
    PERSON_FELDER, PERSON_VERWEISE, DUBLETTE_STUFE_LABEL,
    personNameSchluessel, personDublettenScore, findePersonenDubletten, paarSchluessel,
    besseresZiel, mergeVorschlag, mergePersonen, notizenVerbinden, anzahlGefuellt,
    istPersonImDatensatz, ersetzePersonVerweise, stellePersonVerweiseHer, verweisArt,
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
    SCORE_MIN, SCORE_MAX, SCORE_LABEL,
    emptyVorgang, emptyHistorieEintrag, vorgangKosten, vorgangKostenAuf, vorgaengeVerbrauch,
    vorgangAngebote, entscheidungScore, entscheidungMaxScore, entscheidungGewinner, entscheidungAbgeschlossen,
    ARBEITSZEIT_STATUS, ARBEITSZEIT_STATUS_LABEL, ARBEITSZEIT_GEBUCHT_STATUS,
    emptyArbeiter, arbeiterName, arbeiterZusatz,
    emptyArbeitszeit, emptyArbeitsabrechnung, emptyKostenerstattung,
    satzFuer, arbeitszeitSatz, arbeitszeitBetrag, arbeitszeitenVerbrauch,
    abrechnungKostenSumme, abrechnungArbeiten, abrechnungWochenzeilen,
    wochenMontag, wochenSonntag, isoKw, wochenLabel, wochePlus,
    monatsSchluessel, monatsErster, monatsLetzter, monatsLabel, monatPlus,
  };
})();
