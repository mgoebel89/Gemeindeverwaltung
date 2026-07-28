(function () {
  'use strict';
  window.GR = window.GR || {};
  const { SCHEMA_VERSION, MITGLIED_FUNKTIONEN, uuid } = GR.models;
  const M = GR.models;

  // Cache (Single Source of Truth im Frontend; Backend ist autoritativ)
  const cache = {
    sitzungen: [],        // [{...}]
    // Zentrale Personen-Stammdaten: Ratsmitglieder, Mieter, Empfänger,
    // Arbeiter/Firmen und Vertragspartner in EINER Liste (Rollen-Flags).
    // Die alten list*/get*/save*-Funktionen sind Sichten darauf.
    personen: [],         // [{...}]
    settings: null,       // {...} oder null
    attachments: {},      // sitzungId -> [{id, filename, ...}]
    raeume: [],           // [{...}]
    vermietungen: [],     // [{...}]
    vermietungFiles: {},  // vermietungId -> [{id, kind, filename, ...}]
    haushaltsstellen: [], // [{...}]
    auslagen: [],         // [{...}]
    belege: {},           // auslageId -> [{id, filename, ...}]
    vertraege: [],        // [{...}]
    vorgaenge: [],        // [{...}] Modul Vorgänge & Projekte
    vorgangFiles: {},     // vorgangId -> [{id, kind, filename, ...}] Verlaufsfotos
    arbeiter: [],         // [{...}] Modul Arbeitszeiten: Leistungserbringer
    arbeitszeiten: [],    // [{...}] Tätigkeitseinträge
    arbeitsabrechnungen: [], // [{...}] Abrechnungen je Person/Zeitraum
    ready: false,
    backendAvailable: false,
  };

  const changeListeners = [];
  const remoteChangeListeners = [];
  const readyListeners = [];

  function nowIso() { return new Date().toISOString(); }
  function isoOrZero(s) { return s || ''; }

  function upsertInto(arr, obj) {
    if (!obj || !obj.id) return;
    const idx = arr.findIndex(x => x.id === obj.id);
    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
  }

  // --- Personen: gemeinsame Helfer für Cache und Server-Ereignisse ---
  function findPerson(id) { return cache.personen.find(p => p.id === id) || null; }

  // Wie findPerson, löst aber zusätzlich die ids zusammengeführter Dubletten
  // über `aliasIds` auf. NUR für lesende Sichten: beim Speichern muss die id
  // exakt bleiben, sonst bekäme die Zielperson die id des Altdatensatzes.
  function findPersonAufgeloest(id) {
    if (!id) return null;
    return findPerson(id)
      || cache.personen.find(p => Array.isArray(p.aliasIds) && p.aliasIds.includes(id))
      || null;
  }

  // Einen Datensatz in der alten Modul-Form in die Personenliste einrechnen.
  function applyRemote(apply, datensatz) {
    if (!datensatz || !datensatz.id) return;
    upsertInto(cache.personen, apply(findPerson(datensatz.id), datensatz));
    notifyChange(); notifyRemote();
  }

  // Rolle entfernen; ohne verbleibende Rolle verschwindet die Person ganz.
  // Nie direkt löschen – sonst risse das Entfernen eines Mieters denselben
  // Menschen aus den Arbeitszeiten.
  function entferneRolleLokal(id, rolle) {
    const p = findPerson(id);
    if (!p) return;
    M.setPersonRolle(p, rolle, false);
    if (!M.hatIrgendeineRolle(p)) cache.personen = cache.personen.filter(x => x.id !== p.id);
    notifyChange(); notifyRemote();
  }

  function personenMitRolle(rolle) { return cache.personen.filter(p => M.hatRolle(p, rolle)); }

  // Speichern aus einem Modul heraus: die bestehende Person wird ERGÄNZT, nie
  // ersetzt – die Felder der anderen Rollen bleiben unangetastet.
  function speichereAlsRolle(apply, datensatz) {
    if (!datensatz || !datensatz.id) return null;
    const person = apply(findPerson(datensatz.id), datensatz);
    person.lastModifiedAt = nowIso();
    upsertInto(cache.personen, person);
    bgPutPerson(person);
    notifyChange();
    return person;
  }

  // Löschen aus einem Modul heraus entfernt nur die Rolle (siehe oben).
  function entferneRolle(id, rolle) {
    const p = findPerson(id);
    if (!p) return;
    M.setPersonRolle(p, rolle, false);
    p.lastModifiedAt = nowIso();
    if (M.hatIrgendeineRolle(p)) { upsertInto(cache.personen, p); bgPutPerson(p); }
    else { cache.personen = cache.personen.filter(x => x.id !== p.id); bgDeletePerson(p.id); }
    notifyChange();
  }

  function notifyChange() {
    for (const fn of changeListeners) { try { fn(); } catch (e) { console.warn(e); } }
  }
  function notifyRemote() {
    for (const fn of remoteChangeListeners) { try { fn(); } catch (e) { console.warn(e); } }
  }

  // ----- Migration / Defaults -----
  function migrateSitzung(sitzung) {
    const v = sitzung.schemaVersion || 1;
    if (v < 2) {
      if ('entschuldigtIds' in sitzung) delete sitzung.entschuldigtIds;
      if (!sitzung.anwesenheitsZeiten || typeof sitzung.anwesenheitsZeiten !== 'object') sitzung.anwesenheitsZeiten = {};
      if (!sitzung.antraegeTagesordnung || typeof sitzung.antraegeTagesordnung !== 'object') sitzung.antraegeTagesordnung = { modus: 'keine', text: '' };
      if (!['keine', 'antraege'].includes(sitzung.antraegeTagesordnung.modus)) sitzung.antraegeTagesordnung.modus = 'keine';
      if (typeof sitzung.antraegeTagesordnung.text !== 'string') sitzung.antraegeTagesordnung.text = '';
      if (Array.isArray(sitzung.tops)) {
        for (const t of sitzung.tops) {
          if (typeof t.sitzungsleitungId !== 'string') t.sitzungsleitungId = '';
          if (!Array.isArray(t.freiwilligerVerzichtIds)) t.freiwilligerVerzichtIds = [];
          if (!Array.isArray(t.stimmrechtRuhtIds)) t.stimmrechtRuhtIds = [];
          if (!Array.isArray(t.befangenheitsIds)) t.befangenheitsIds = [];
        }
      }
      sitzung.schemaVersion = 2;
    }
    if ((sitzung.schemaVersion || 2) < 3) {
      // TOP-Nummerierung pro Bereich neu starten (öffentlich beginnt bei 1, nicht-öffentlich ebenfalls)
      if (Array.isArray(sitzung.tops)) {
        let n = 1;
        for (const t of sitzung.tops.filter(x => x.bereich === 'oeffentlich')) t.nummer = n++;
        n = 1;
        for (const t of sitzung.tops.filter(x => x.bereich === 'nicht_oeffentlich')) t.nummer = n++;
      }
      sitzung.schemaVersion = 3;
    }
    return sitzung;
  }

  function migrateMitglied(m) {
    if ((!m.vorname && !m.nachname) && m.name) {
      const parts = m.name.trim().split(/\s+/);
      m.nachname = parts.length > 1 ? parts.pop() : parts[0] || '';
      m.vorname = parts.join(' ');
    }
    if (m.vorname === undefined) m.vorname = '';
    if (m.nachname === undefined) m.nachname = '';
    if (!MITGLIED_FUNKTIONEN.includes(m.funktion)) m.funktion = 'Ratsmitglied';
    if ('name' in m) delete m.name;
    return m;
  }

  // Bestandsobjekte ohne Übergabe-Checkliste einmalig mit der Startvorlage
  // versehen (in-memory; persistiert beim ersten Speichern des Objekts).
  function migrateRaum(r) {
    if (r && r.uebergabeCheckliste === undefined && GR.models && GR.models.defaultUebergabeCheckliste) {
      r.uebergabeCheckliste = GR.models.defaultUebergabeCheckliste();
    }
    return r;
  }

  // Vorgänge: Einzel-Kostenstelle → Liste; Kosten-Einträge erben die alte Stelle.
  // In-memory beim Laden/Speichern (persistiert beim nächsten Save des Vorgangs).
  function migrateVorgang(v) {
    if (!v) return v;
    if (!Array.isArray(v.haushaltsstellen)) {
      v.haushaltsstellen = v.haushaltsstelleId ? [v.haushaltsstelleId] : [];
    }
    if (Array.isArray(v.historie)) {
      for (const e of v.historie) {
        if (e && e.typ === 'kosten' && e.haushaltsstelleId === undefined) {
          e.haushaltsstelleId = v.haushaltsstelleId || (v.haushaltsstellen[0] || '');
        }
      }
    }
    if ('haushaltsstelleId' in v) delete v.haushaltsstelleId;
    return v;
  }

  function defaultSettings() {
    return {
      ortsname: 'Hörschhausen',
      nocodb: defaultNocoDbSettings(),
      autoSync: true,
      autoSyncIntervalSec: 60,
      vikunjaProjektId: null, // globales Vikunja-Projekt (app-weit: Aufgaben-Modul + Vorgangs-ToDos)
      vermietung: defaultVermietungSettings(),
      auslagen: defaultAuslagenSettings(),
      vertraege: defaultVertraegeSettings(),
      vorgaenge: defaultVorgaengeSettings(),
      arbeitszeiten: defaultArbeitszeitenSettings(),
      personen: defaultPersonenSettings(),
      inventar: defaultInventarSettings(),
    };
  }
  // Modul Inventar: die Gegenstände selbst liegen in Homebox. Hier steht nur,
  // wie früh eine fällige Wartung zur Aufgabe werden soll. Der Homebox-Zugang
  // liegt bewusst NICHT hier, sondern serverseitig unter eigenem DB-Key —
  // dieser Block läuft im Snapshot und im NocoDB-Backup mit.
  function defaultInventarSettings() {
    return { vorlaufTage: 30, wartungsaufgaben: true };
  }
  // Stammdaten: Paare, die der Dubletten-Assistent vorgeschlagen hat und die
  // als „kein Duplikat" abgehakt wurden. Sonst stünde derselbe Vorschlag bei
  // jedem Aufruf wieder da. Schlüssel = beide ids sortiert, mit | verbunden.
  function defaultPersonenSettings() {
    return { ignorierteDubletten: [] };
  }
  // Modul-Einstellungen „Vorgänge & Projekte": Kategorienliste, festes Vikunja-
  // Projekt für ToDos und der Hash des Leitungs-PIN (schaltet vertrauliche
  // Inhalte frei; leer = kein PIN gesetzt, Leitungs-Ansicht frei wählbar).
  function defaultVorgaengeSettings() {
    return {
      kategorien: ['Bauprojekt', 'Beschaffung', 'Veranstaltung', 'Personal', 'Förderung', 'Sonstiges'],
      vikunjaProjektId: null,
      leitungPinHash: '',
    };
  }
  // Modul Arbeitszeiten: EIN einheitlicher Stundensatz, aber mit Historie
  // („gültig ab"). Maßgeblich ist der Satz zum Leistungsdatum; beim Abrechnen
  // wird er eingefroren. Am Einzeleintrag überschreibbar (z. B. Firmen).
  function defaultArbeitszeitenSettings() {
    return {
      satzHistorie: [],   // [{ gueltigAb: 'YYYY-MM-DD', betrag: Number }]
      taetigkeiten: ['Rasen mähen', 'Hecke schneiden', 'Winterdienst', 'Reparatur', 'Reinigung', 'Sonstiges'],
    };
  }
  function defaultNocoDbSettings() {
    return {
      serverUrl: '', token: '', baseId: '',
      tableSitzungenName: 'Sitzungen', tableBeschluesseName: 'Beschluesse', tableMitgliederName: 'Mitglieder',
      tableSitzungenId: '', tableBeschluesseId: '', tableMitgliederId: '',
      tableMieterName: 'Mieter', tableRaeumeName: 'Raeume', tableVermietungenName: 'Vermietungen',
      tableMieterId: '', tableRaeumeId: '', tableVermietungenId: '',
      tableEmpfaengerName: 'Empfaenger', tableHaushaltsstellenName: 'Haushaltsstellen', tableAuslagenName: 'Auslagen',
      tableEmpfaengerId: '', tableHaushaltsstellenId: '', tableAuslagenId: '',
      tableVertragspartnerName: 'Vertragspartner', tableVertraegeName: 'Vertraege',
      tableVertragspartnerId: '', tableVertraegeId: '',
      tableVorgaengeName: 'Vorgaenge', tableVorgaengeId: '',
      tableArbeiterName: 'Arbeiter', tableArbeiterId: '',
      tableArbeitszeitenName: 'Arbeitszeiten', tableArbeitszeitenId: '',
      tableArbeitsabrechnungenName: 'Arbeitsabrechnungen', tableArbeitsabrechnungenId: '',
    };
  }
  // Absender-/Formulardaten für die Bargeldauslagen-PDFs (Defaults aus der Vorlage Hörschhausen).
  function defaultAuslagenSettings() {
    return {
      ortsgemeinde: 'Hörschhausen',
      buergermeisterName: 'M. Göbel',
      ortsbeigeordneterName: 'C. Arenz',
      quittungOrt: 'Kelberg',
      unterschriftDataUrl: '',
      unterschriftW: null,   // Pixelmaße der Unterschrift – ohne sie zeichnen
      unterschriftH: null,   // die PDFs einen festen Kasten (kann verzerren)
      scannerUrl: '',
    };
  }
  // Absender-/Vertragsdaten für die PDFs (Defaults aus der Mietvertrag-Vorlage Hörschhausen).
  function defaultVermietungSettings() {
    return {
      ortsgemeinde: 'Hörschhausen',
      buergermeister: 'Matthias Göbel',
      anschrift: 'Uessbachstr. 15\n54552 Hörschhausen',
      telefon: '02692 93 27 63 5',
      email: 'matthias.goebel@hoerschhausen.de',
      satzungsDatum: '22.10.1999',
      vgEmpfaenger: 'Verbandsgemeindeverwaltung Kelberg\nFachbereich Finanzen und Abgaben\nDauner Straße 22\n53539 Kelberg',
    };
  }
  // Modul-Einstellungen „Verträge und Pacht": Standardwerte für neue Verträge
  // und die editierbare Kategorienliste.
  function defaultVertraegeSettings() {
    return {
      standardVorlaufTage: 30,
      standardKuendigungsfristMonate: 3,
      kategorien: ['Pacht', 'Wartung', 'Versicherung', 'Energie', 'Dienstleistung', 'Miete', 'Sonstiges'],
    };
  }

  // Personen aus dem Snapshot. Fehlt `personen` (Backend noch nicht aktualisiert),
  // werden sie aus den fünf alten Listen zusammengesetzt – dieselbe Abbildung wie
  // die Server-Migration, nur in-memory. So läuft die Oberfläche auch dann, wenn
  // Frontend und Backend beim Deploy kurz auseinanderliegen.
  function personenAusSnapshot(snap) {
    if (Array.isArray(snap.personen) && snap.personen.length) {
      return snap.personen.map(M.normalizePerson);
    }
    const nachId = new Map();
    const uebernehmen = (liste, apply) => {
      for (const eintrag of liste || []) {
        if (!eintrag || !eintrag.id) continue;
        nachId.set(eintrag.id, apply(nachId.get(eintrag.id) || null, eintrag));
      }
    };
    uebernehmen((snap.mitglieder || []).map(migrateMitglied), M.applyMitglied);
    uebernehmen(snap.mieter, M.applyMieter);
    uebernehmen(snap.empfaenger, M.applyEmpfaenger);
    uebernehmen(snap.arbeiter, M.applyArbeiter);
    uebernehmen(snap.vertragspartner, M.applyVertragspartner);
    return Array.from(nachId.values());
  }

  // ----- Bootstrap (Snapshot vom Backend) -----
  async function bootstrap() {
    try {
      const snap = await GR.api.snapshot();
      cache.sitzungen = (snap.sitzungen || []).map(migrateSitzung);
      cache.personen = personenAusSnapshot(snap);
      cache.settings = snap.settings || defaultSettings();
      cache.attachments = snap.attachments || {};
      cache.raeume = (snap.raeume || []).map(migrateRaum);
      cache.vermietungen = snap.vermietungen || [];
      cache.vermietungFiles = snap.vermietungFiles || {};
      cache.haushaltsstellen = snap.haushaltsstellen || [];
      cache.auslagen = snap.auslagen || [];
      cache.belege = snap.belege || {};
      cache.vertraege = snap.vertraege || [];
      cache.vorgaenge = (snap.vorgaenge || []).map(migrateVorgang);
      cache.vorgangFiles = snap.vorgangFiles || {};
      cache.arbeitszeiten = snap.arbeitszeiten || [];
      cache.arbeitsabrechnungen = snap.arbeitsabrechnungen || [];
      cache.backendAvailable = true;
      cache.ready = true;
      mergeSettingsDefaults();
      notifyChange();
      for (const fn of readyListeners) { try { fn(); } catch (e) { console.warn(e); } }
    } catch (e) {
      console.error('Backend nicht erreichbar:', e);
      cache.backendAvailable = false;
      cache.settings = defaultSettings();
      cache.ready = true;
      notifyChange();
      for (const fn of readyListeners) { try { fn(); } catch (e) { console.warn(e); } }
    }
  }

  function mergeSettingsDefaults() {
    if (!cache.settings) cache.settings = defaultSettings();
    if (!cache.settings.nocodb) cache.settings.nocodb = defaultNocoDbSettings();
    else {
      const d = defaultNocoDbSettings();
      for (const k of Object.keys(d)) if (cache.settings.nocodb[k] === undefined) cache.settings.nocodb[k] = d[k];
    }
    if (cache.settings.autoSync === undefined) cache.settings.autoSync = true;
    if (cache.settings.autoSyncIntervalSec === undefined) cache.settings.autoSyncIntervalSec = 60;
    // NocoDB-Defaults für neue Tabellen nachziehen (Bestandsinstallationen)
    const dn = defaultNocoDbSettings();
    for (const k of ['tableMieterName', 'tableRaeumeName', 'tableVermietungenName', 'tableMieterId', 'tableRaeumeId', 'tableVermietungenId',
      'tableEmpfaengerName', 'tableHaushaltsstellenName', 'tableAuslagenName', 'tableEmpfaengerId', 'tableHaushaltsstellenId', 'tableAuslagenId',
      'tableVertragspartnerName', 'tableVertraegeName', 'tableVertragspartnerId', 'tableVertraegeId',
      'tableVorgaengeName', 'tableVorgaengeId',
      'tableArbeiterName', 'tableArbeiterId', 'tableArbeitszeitenName', 'tableArbeitszeitenId',
      'tableArbeitsabrechnungenName', 'tableArbeitsabrechnungenId']) {
      if (cache.settings.nocodb[k] === undefined) cache.settings.nocodb[k] = dn[k];
    }
    if (!cache.settings.vermietung) cache.settings.vermietung = defaultVermietungSettings();
    else {
      const dv = defaultVermietungSettings();
      for (const k of Object.keys(dv)) if (cache.settings.vermietung[k] === undefined) cache.settings.vermietung[k] = dv[k];
    }
    if (!cache.settings.auslagen) cache.settings.auslagen = defaultAuslagenSettings();
    else {
      const da = defaultAuslagenSettings();
      for (const k of Object.keys(da)) if (cache.settings.auslagen[k] === undefined) cache.settings.auslagen[k] = da[k];
    }
    if (!cache.settings.vertraege) cache.settings.vertraege = defaultVertraegeSettings();
    else {
      const dvt = defaultVertraegeSettings();
      for (const k of Object.keys(dvt)) if (cache.settings.vertraege[k] === undefined) cache.settings.vertraege[k] = dvt[k];
    }
    if (!cache.settings.vorgaenge) cache.settings.vorgaenge = defaultVorgaengeSettings();
    else {
      const dvg = defaultVorgaengeSettings();
      for (const k of Object.keys(dvg)) if (cache.settings.vorgaenge[k] === undefined) cache.settings.vorgaenge[k] = dvg[k];
    }
    if (!cache.settings.arbeitszeiten) cache.settings.arbeitszeiten = defaultArbeitszeitenSettings();
    else {
      const daz = defaultArbeitszeitenSettings();
      for (const k of Object.keys(daz)) if (cache.settings.arbeitszeiten[k] === undefined) cache.settings.arbeitszeiten[k] = daz[k];
    }
    if (!cache.settings.inventar) cache.settings.inventar = defaultInventarSettings();
    else {
      const di = defaultInventarSettings();
      for (const k of Object.keys(di)) if (cache.settings.inventar[k] === undefined) cache.settings.inventar[k] = di[k];
    }
    if (!cache.settings.personen) cache.settings.personen = defaultPersonenSettings();
    else if (!Array.isArray(cache.settings.personen.ignorierteDubletten)) {
      cache.settings.personen.ignorierteDubletten = [];
    }
    // Globales Vikunja-Projekt: einmalig aus dem früheren Vorgänge-spezifischen
    // Wert übernehmen (nur wenn das Feld noch gar nicht existiert).
    if (cache.settings.vikunjaProjektId === undefined) {
      const legacy = cache.settings.vorgaenge && cache.settings.vorgaenge.vikunjaProjektId;
      cache.settings.vikunjaProjektId = legacy || null;
    }
  }

  // ----- WebSocket-Apply -----
  function applyServerMessage(msg) {
    if (!msg || !msg.type) return;
    // Eigene Echos ignorieren — sonst rerendert das UI während der User tippt.
    if (msg.origin && GR.api && GR.api.clientId && msg.origin === GR.api.clientId) return;
    switch (msg.type) {
      case 'sitzung:save': {
        const s = migrateSitzung(msg.sitzung);
        const idx = cache.sitzungen.findIndex(x => x.id === s.id);
        if (idx >= 0) cache.sitzungen[idx] = s; else cache.sitzungen.unshift(s);
        notifyChange(); notifyRemote();
        break;
      }
      case 'sitzung:delete': {
        cache.sitzungen = cache.sitzungen.filter(s => s.id !== msg.id);
        delete cache.attachments[msg.id];
        notifyChange(); notifyRemote();
        break;
      }
      // --- Personen-Stammdaten ---
      case 'person:save': { upsertInto(cache.personen, M.normalizePerson(msg.person)); notifyChange(); notifyRemote(); break; }
      case 'person:delete': { cache.personen = cache.personen.filter(p => p.id !== msg.id); notifyChange(); notifyRemote(); break; }
      // Die alten Modul-Ereignisse kommen weiter an (Browser mit altem
      // Skriptstand, alte Routen) und werden in die Personenliste eingerechnet.
      case 'mitglied:save': { applyRemote(M.applyMitglied, migrateMitglied(msg.mitglied)); break; }
      case 'mieter:save': { applyRemote(M.applyMieter, msg.mieter); break; }
      case 'empfaenger:save': { applyRemote(M.applyEmpfaenger, msg.empfaenger); break; }
      case 'arbeiter:save': { applyRemote(M.applyArbeiter, msg.arbeiter); break; }
      case 'vertragspartner:save': { applyRemote(M.applyVertragspartner, msg.vertragspartner); break; }
      case 'mitglied:delete': { entferneRolleLokal(msg.id, 'rat'); break; }
      case 'mieter:delete': { entferneRolleLokal(msg.id, 'mieter'); break; }
      case 'empfaenger:delete': { entferneRolleLokal(msg.id, 'empfaenger'); break; }
      case 'arbeiter:delete': { entferneRolleLokal(msg.id, 'arbeiter'); break; }
      case 'vertragspartner:delete': { entferneRolleLokal(msg.id, 'partner'); break; }
      case 'settings:save': {
        cache.settings = msg.settings || cache.settings;
        mergeSettingsDefaults();
        notifyChange(); notifyRemote();
        break;
      }
      case 'attachment:add': {
        const a = msg.attachment;
        if (!cache.attachments[a.sitzungId]) cache.attachments[a.sitzungId] = [];
        if (!cache.attachments[a.sitzungId].some(x => x.id === a.id)) {
          cache.attachments[a.sitzungId].push(a);
        }
        notifyChange(); notifyRemote();
        break;
      }
      case 'attachment:delete': {
        if (cache.attachments[msg.sitzungId]) {
          cache.attachments[msg.sitzungId] = cache.attachments[msg.sitzungId].filter(a => a.id !== msg.id);
        }
        notifyChange(); notifyRemote();
        break;
      }
      case 'raum:save': { upsertInto(cache.raeume, msg.raum); notifyChange(); notifyRemote(); break; }
      case 'raum:delete': { cache.raeume = cache.raeume.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'vermietung:save': { upsertInto(cache.vermietungen, msg.vermietung); notifyChange(); notifyRemote(); break; }
      case 'vermietung:delete': { cache.vermietungen = cache.vermietungen.filter(x => x.id !== msg.id); delete cache.vermietungFiles[msg.id]; notifyChange(); notifyRemote(); break; }
      case 'vermietungFoto:add': {
        const f = msg.foto;
        if (!cache.vermietungFiles[f.vermietungId]) cache.vermietungFiles[f.vermietungId] = [];
        if (!cache.vermietungFiles[f.vermietungId].some(x => x.id === f.id)) cache.vermietungFiles[f.vermietungId].push(f);
        notifyChange(); notifyRemote();
        break;
      }
      case 'vermietungFoto:delete': {
        if (cache.vermietungFiles[msg.vermietungId]) cache.vermietungFiles[msg.vermietungId] = cache.vermietungFiles[msg.vermietungId].filter(f => f.id !== msg.id);
        notifyChange(); notifyRemote();
        break;
      }
      case 'haushaltsstelle:save': { upsertInto(cache.haushaltsstellen, msg.haushaltsstelle); notifyChange(); notifyRemote(); break; }
      case 'haushaltsstelle:delete': { cache.haushaltsstellen = cache.haushaltsstellen.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'auslage:save': { upsertInto(cache.auslagen, msg.auslage); notifyChange(); notifyRemote(); break; }
      case 'auslage:delete': { cache.auslagen = cache.auslagen.filter(x => x.id !== msg.id); delete cache.belege[msg.id]; notifyChange(); notifyRemote(); break; }
      case 'beleg:add': {
        const b = msg.beleg;
        if (!cache.belege[b.auslageId]) cache.belege[b.auslageId] = [];
        if (!cache.belege[b.auslageId].some(x => x.id === b.id)) cache.belege[b.auslageId].push(b);
        notifyChange(); notifyRemote();
        break;
      }
      case 'beleg:delete': {
        if (cache.belege[msg.auslageId]) cache.belege[msg.auslageId] = cache.belege[msg.auslageId].filter(f => f.id !== msg.id);
        notifyChange(); notifyRemote();
        break;
      }
      case 'vertrag:save': { upsertInto(cache.vertraege, msg.vertrag); notifyChange(); notifyRemote(); break; }
      case 'vertrag:delete': { cache.vertraege = cache.vertraege.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'vorgang:save': { upsertInto(cache.vorgaenge, migrateVorgang(msg.vorgang)); notifyChange(); notifyRemote(); break; }
      case 'vorgang:delete': { cache.vorgaenge = cache.vorgaenge.filter(x => x.id !== msg.id); delete cache.vorgangFiles[msg.id]; notifyChange(); notifyRemote(); break; }
      case 'vorgangFoto:add': {
        const f = msg.foto;
        if (!cache.vorgangFiles[f.vorgangId]) cache.vorgangFiles[f.vorgangId] = [];
        if (!cache.vorgangFiles[f.vorgangId].some(x => x.id === f.id)) cache.vorgangFiles[f.vorgangId].push(f);
        notifyChange(); notifyRemote();
        break;
      }
      case 'vorgangFoto:delete': {
        if (cache.vorgangFiles[msg.vorgangId]) cache.vorgangFiles[msg.vorgangId] = cache.vorgangFiles[msg.vorgangId].filter(f => f.id !== msg.id);
        notifyChange(); notifyRemote();
        break;
      }
      case 'arbeitszeit:save': { upsertInto(cache.arbeitszeiten, msg.arbeitszeit); notifyChange(); notifyRemote(); break; }
      case 'arbeitszeit:delete': { cache.arbeitszeiten = cache.arbeitszeiten.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'arbeitsabrechnung:save': { upsertInto(cache.arbeitsabrechnungen, msg.arbeitsabrechnung); notifyChange(); notifyRemote(); break; }
      case 'arbeitsabrechnung:delete': { cache.arbeitsabrechnungen = cache.arbeitsabrechnungen.filter(x => x.id !== msg.id); notifyChange(); notifyRemote(); break; }
      case 'bulk:imported': {
        // Komplettes Re-Bootstrap, damit alle Daten konsistent kommen
        bootstrap();
        break;
      }
    }
  }

  // ----- Hintergrund-Speicherungen (fire-and-forget mit toast bei Fehler) -----
  function bgPutSitzung(s) {
    GR.api.putSitzung(s).catch(e => {
      console.warn('saveSitzung Backend-Fehler', e);
      if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000);
    });
  }
  function bgDeleteSitzung(id) {
    GR.api.deleteSitzungRemote(id).catch(e => console.warn('deleteSitzung Backend-Fehler', e));
  }
  function bgPutPerson(p) {
    GR.api.putPerson(p).catch(e => {
      console.warn('savePerson Backend-Fehler', e);
      if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000);
    });
  }
  function bgDeletePerson(id) {
    GR.api.deletePersonRemote(id).catch(e => console.warn('deletePerson Backend-Fehler', e));
  }
  function bgPutMitglied(m) {
    GR.api.putMitglied(m).catch(e => {
      console.warn('saveMitglied Backend-Fehler', e);
      if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000);
    });
  }
  function bgDeleteMitglied(id) {
    GR.api.deleteMitgliedRemote(id).catch(e => console.warn('deleteMitglied Backend-Fehler', e));
  }
  function bgPutSettings(s) {
    GR.api.putSettings(s).catch(e => console.warn('saveSettings Backend-Fehler', e));
  }

  // Einen Modul-Datensatz über die reguläre Speicherfunktion sichern. Wird beim
  // Zusammenführen von Personen gebraucht: so laufen Backend-PUT, WebSocket-
  // Broadcast und Sync-Markierung genauso wie bei einer Bearbeitung von Hand.
  const SPEICHERN_JE_ART = {
    sitzungen: (s, rec) => s.saveSitzung(rec),
    vermietungen: (s, rec) => s.saveVermietung(rec),
    auslagen: (s, rec) => s.saveAuslage(rec),
    arbeitszeiten: (s, rec) => s.saveArbeitszeit(rec),
    arbeitsabrechnungen: (s, rec) => s.saveArbeitsabrechnung(rec),
    vertraege: (s, rec) => s.saveVertrag(rec),
  };
  function speichereDatensatz(store, art, rec) {
    const fn = SPEICHERN_JE_ART[art];
    if (!fn) throw new Error('Unbekannte Datensatzart: ' + art);
    fn(store, rec);
  }

  // ----- Öffentliches Store-API (synchron lesend, Schreiben triggert Backend im Hintergrund) -----
  const store = {
    onReady(fn) { if (cache.ready) try { fn(); } catch (_) {} else readyListeners.push(fn); },
    isReady() { return cache.ready; },
    isBackendAvailable() { return cache.backendAvailable; },

    // --- Sitzungen ---
    listSitzungen() { return cache.sitzungen.slice(); },
    getSitzung(id) { return cache.sitzungen.find(s => s.id === id) || null; },
    saveSitzung(sitzung) {
      sitzung.lastModifiedAt = nowIso();
      migrateSitzung(sitzung);
      const idx = cache.sitzungen.findIndex(s => s.id === sitzung.id);
      if (idx >= 0) cache.sitzungen[idx] = sitzung; else cache.sitzungen.unshift(sitzung);
      bgPutSitzung(sitzung);
      notifyChange();
    },
    deleteSitzung(id) {
      cache.sitzungen = cache.sitzungen.filter(s => s.id !== id);
      delete cache.attachments[id];
      bgDeleteSitzung(id);
      notifyChange();
    },

    // --- Personen-Stammdaten (zentral) ---
    // list*() der einzelnen Module filtert nach Rolle, get*() bewusst NICHT:
    // sonst zeigte eine alte Vermietung ihren Mieter nicht mehr an, nur weil
    // dessen Mieter-Rolle inzwischen entfernt wurde.
    listPersonen() { return cache.personen.slice(); },
    getPerson(id) { return findPersonAufgeloest(id); },
    personenMitRolle(rolle) { return personenMitRolle(rolle); },
    savePerson(p) {
      const person = M.normalizePerson(p);
      person.lastModifiedAt = nowIso();
      upsertInto(cache.personen, person);
      bgPutPerson(person);
      notifyChange();
      return person;
    },
    deletePerson(id) {
      cache.personen = cache.personen.filter(p => p.id !== id);
      bgDeletePerson(id);
      notifyChange();
    },
    entfernePersonRolle(id, rolle) { entferneRolle(id, rolle); },

    // --- Dubletten zusammenführen ---
    // Alle Datensätze der Module, die auf diese Person zeigen – nach Art
    // gruppiert. Grundlage für die Anzeige im Assistenten und fürs Umschreiben.
    personVerweise(id) {
      const out = {};
      for (const def of M.PERSON_VERWEISE) {
        out[def.art] = (cache[def.art] || []).filter(rec => M.istPersonImDatensatz(rec, def.art, id));
      }
      return out;
    },
    personVerweiseAnzahl(id) {
      const v = this.personVerweise(id);
      return M.PERSON_VERWEISE.reduce((n, def) => n + (v[def.art] || []).length, 0);
    },

    // Führt `quelleId` in `zielId` zusammen: Verweise umschreiben, Felder nach
    // `wahl` verschmelzen, Quelle löschen. Die Quelle bleibt vollständig im
    // Archiv der Zielperson erhalten, deshalb ist der Schritt umkehrbar.
    fuehrePersonenZusammen(zielId, quelleId, wahl) {
      if (!zielId || !quelleId || zielId === quelleId) throw new Error('Zwei verschiedene Personen wählen');
      const ziel = findPerson(zielId);
      const quelle = findPerson(quelleId);
      if (!ziel || !quelle) throw new Error('Person nicht gefunden');

      // Erst die Verweise – schlägt hier etwas fehl, ist noch nichts gelöscht.
      const betroffen = this.personVerweise(quelleId);
      const protokoll = {};
      for (const def of M.PERSON_VERWEISE) {
        const eintraege = [];
        for (const rec of (betroffen[def.art] || [])) {
          const { geaendert, vorher } = M.ersetzePersonVerweise(rec, def.art, quelleId, zielId);
          if (!geaendert) continue;
          eintraege.push({ id: rec.id, vorher });
          speichereDatensatz(this, def.art, rec);
        }
        if (eintraege.length) protokoll[def.art] = eintraege;
      }

      const neu = M.mergePersonen(ziel, quelle, wahl, protokoll);
      this.deletePerson(quelleId);
      this.savePerson(neu);
      return {
        person: neu,
        verweise: protokoll,
        mergeId: neu.zusammengefuehrt[neu.zusammengefuehrt.length - 1].id,
      };
    },

    // Macht eine Zusammenführung rückgängig: Verweise zurückschreiben, den
    // aufgegebenen Datensatz aus dem Archiv wiederherstellen, die Zielperson auf
    // ihren Stand davor zurücksetzen. Nur die zuletzt durchgeführte
    // Zusammenführung einer Person ist umkehrbar – bei älteren wüsste niemand,
    // welche der späteren Änderungen daraufhin gelten sollen.
    macheZusammenfuehrungRueckgaengig(personId, mergeId) {
      const person = findPerson(personId);
      if (!person) throw new Error('Person nicht gefunden');
      const liste = person.zusammengefuehrt || [];
      const idx = liste.findIndex(e => e.id === mergeId);
      if (idx < 0) throw new Error('Zusammenführung nicht gefunden');
      if (idx !== liste.length - 1) throw new Error('Nur die zuletzt durchgeführte Zusammenführung ist rückgängig zu machen');
      const eintrag = liste[idx];

      for (const [art, eintraege] of Object.entries(eintrag.verweise || {})) {
        for (const e of eintraege) {
          const rec = (cache[art] || []).find(x => x.id === e.id);
          if (!rec) continue;
          M.stellePersonVerweiseHer(rec, art, e.vorher);
          speichereDatensatz(this, art, rec);
        }
      }

      const zurueck = M.normalizePerson(eintrag.zielVorher);
      zurueck.zusammengefuehrt = liste.slice(0, idx);
      const quelle = M.normalizePerson(eintrag.quelle);
      this.savePerson(quelle);
      this.savePerson(zurueck);
      return { ziel: zurueck, quelle };
    },

    // --- Mitglieder (Sicht: Rolle „rat") ---
    listMitglieder() { return personenMitRolle('rat').map(M.toMitglied); },
    getMitglied(id) { const p = findPersonAufgeloest(id); return p ? M.toMitglied(p) : null; },
    saveMitglied(m) { speichereAlsRolle(M.applyMitglied, migrateMitglied(m)); },
    deleteMitglied(id) { entferneRolle(id, 'rat'); },

    // --- Settings ---
    getSettings() { mergeSettingsDefaults(); return cache.settings; },
    saveSettings(s) {
      cache.settings = s;
      mergeSettingsDefaults();
      bgPutSettings(cache.settings);
      notifyChange();
    },

    // --- Attachments (async) ---
    listAttachments(sitzungId) { return (cache.attachments[sitzungId] || []).slice(); },
    async uploadAttachment(sitzungId, file) {
      const rec = await GR.api.uploadAttachment(sitzungId, file);
      if (!cache.attachments[sitzungId]) cache.attachments[sitzungId] = [];
      cache.attachments[sitzungId].push(rec);
      notifyChange();
      return rec;
    },
    async deleteAttachment(sitzungId, id) {
      await GR.api.deleteAttachment(id);
      if (cache.attachments[sitzungId]) {
        cache.attachments[sitzungId] = cache.attachments[sitzungId].filter(a => a.id !== id);
      }
      notifyChange();
    },
    attachmentUrl(id) { return GR.api.attachmentUrl(id); },

    // --- Mieter (Sicht: Rolle „mieter") ---
    listMieter() { return personenMitRolle('mieter').map(M.toMieter); },
    getMieter(id) { const p = findPersonAufgeloest(id); return p ? M.toMieter(p) : null; },
    saveMieter(m) { speichereAlsRolle(M.applyMieter, m); },
    deleteMieter(id) { entferneRolle(id, 'mieter'); },

    // --- Räume ---
    listRaeume() { return cache.raeume.slice(); },
    getRaum(id) { return cache.raeume.find(r => r.id === id) || null; },
    saveRaum(r) {
      r.lastModifiedAt = nowIso();
      upsertInto(cache.raeume, r);
      GR.api.putRaum(r).catch(e => { console.warn('saveRaum Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteRaum(id) {
      cache.raeume = cache.raeume.filter(r => r.id !== id);
      GR.api.deleteRaumRemote(id).catch(e => console.warn('deleteRaum Backend-Fehler', e));
      notifyChange();
    },

    // --- Vermietungen ---
    listVermietungen() { return cache.vermietungen.slice(); },
    getVermietung(id) { return cache.vermietungen.find(v => v.id === id) || null; },
    saveVermietung(v) {
      v.lastModifiedAt = nowIso();
      upsertInto(cache.vermietungen, v);
      GR.api.putVermietung(v).catch(e => { console.warn('saveVermietung Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteVermietung(id) {
      cache.vermietungen = cache.vermietungen.filter(v => v.id !== id);
      delete cache.vermietungFiles[id];
      GR.api.deleteVermietungRemote(id).catch(e => console.warn('deleteVermietung Backend-Fehler', e));
      notifyChange();
    },

    // --- Zählerstand-Fotos (zu einer Vermietung; async) ---
    listVermietungFotos(vermietungId) { return (cache.vermietungFiles[vermietungId] || []).slice(); },
    getVermietungFoto(vermietungId, fileId) { return (cache.vermietungFiles[vermietungId] || []).find(f => f.id === fileId) || null; },
    async uploadVermietungFoto(vermietungId, file, kind) {
      const rec = await GR.api.uploadVermietungFoto(vermietungId, file, kind);
      if (!cache.vermietungFiles[vermietungId]) cache.vermietungFiles[vermietungId] = [];
      cache.vermietungFiles[vermietungId].push(rec);
      notifyChange();
      return rec;
    },
    async deleteVermietungFoto(vermietungId, fileId) {
      await GR.api.deleteVermietungFoto(fileId);
      if (cache.vermietungFiles[vermietungId]) cache.vermietungFiles[vermietungId] = cache.vermietungFiles[vermietungId].filter(f => f.id !== fileId);
      notifyChange();
    },
    vermietungFotoUrl(fileId) { return GR.api.vermietungFotoUrl(fileId); },

    // --- Empfänger, Bargeldauslagen (Sicht: Rolle „empfaenger") ---
    listEmpfaenger() { return personenMitRolle('empfaenger').map(M.toEmpfaenger); },
    getEmpfaenger(id) { const p = findPersonAufgeloest(id); return p ? M.toEmpfaenger(p) : null; },
    saveEmpfaenger(e) { speichereAlsRolle(M.applyEmpfaenger, e); },
    deleteEmpfaenger(id) { entferneRolle(id, 'empfaenger'); },

    // --- Haushaltsstellen ---
    listHaushaltsstellen() { return cache.haushaltsstellen.slice(); },
    getHaushaltsstelle(id) { return cache.haushaltsstellen.find(h => h.id === id) || null; },
    saveHaushaltsstelle(h) {
      h.lastModifiedAt = nowIso();
      upsertInto(cache.haushaltsstellen, h);
      GR.api.putHaushaltsstelle(h).catch(err => { console.warn('saveHaushaltsstelle Backend-Fehler', err); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + err.message, 4000); });
      notifyChange();
    },
    deleteHaushaltsstelle(id) {
      cache.haushaltsstellen = cache.haushaltsstellen.filter(h => h.id !== id);
      GR.api.deleteHaushaltsstelleRemote(id).catch(e => console.warn('deleteHaushaltsstelle Backend-Fehler', e));
      notifyChange();
    },

    // --- Auslagen ---
    listAuslagen() { return cache.auslagen.slice(); },
    getAuslage(id) { return cache.auslagen.find(a => a.id === id) || null; },
    saveAuslage(a) {
      a.lastModifiedAt = nowIso();
      upsertInto(cache.auslagen, a);
      GR.api.putAuslage(a).catch(err => { console.warn('saveAuslage Backend-Fehler', err); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + err.message, 4000); });
      notifyChange();
    },
    deleteAuslage(id) {
      cache.auslagen = cache.auslagen.filter(a => a.id !== id);
      delete cache.belege[id];
      GR.api.deleteAuslageRemote(id).catch(e => console.warn('deleteAuslage Backend-Fehler', e));
      notifyChange();
    },

    // --- Belege (Scan-Dateien zu einer Auslage; async) ---
    listBelegFiles(auslageId) { return (cache.belege[auslageId] || []).slice(); },
    getBelegFile(auslageId, fileId) { return (cache.belege[auslageId] || []).find(f => f.id === fileId) || null; },
    async uploadBeleg(auslageId, file) {
      const rec = await GR.api.uploadBeleg(auslageId, file);
      if (!cache.belege[auslageId]) cache.belege[auslageId] = [];
      cache.belege[auslageId].push(rec);
      notifyChange();
      return rec;
    },
    async scanBeleg(auslageId, scannerUrl, source) {
      const recs = await GR.api.scan(auslageId, scannerUrl, source);
      if (!cache.belege[auslageId]) cache.belege[auslageId] = [];
      for (const rec of (recs || [])) {
        if (!cache.belege[auslageId].some(f => f.id === rec.id)) cache.belege[auslageId].push(rec);
      }
      notifyChange();
      return recs || [];
    },
    async deleteBelegFile(auslageId, fileId) {
      await GR.api.deleteBelegFile(fileId);
      if (cache.belege[auslageId]) cache.belege[auslageId] = cache.belege[auslageId].filter(f => f.id !== fileId);
      notifyChange();
    },
    belegUrl(fileId) { return GR.api.belegUrl(fileId); },

    // --- Vertragspartner, Modul Verträge (Sicht: Rolle „partner") ---
    listVertragspartner() { return personenMitRolle('partner').map(M.toVertragspartner); },
    getVertragspartner(id) { const p = findPersonAufgeloest(id); return p ? M.toVertragspartner(p) : null; },
    saveVertragspartner(p) { speichereAlsRolle(M.applyVertragspartner, p); },
    deleteVertragspartner(id) { entferneRolle(id, 'partner'); },

    // --- Verträge ---
    listVertraege() { return cache.vertraege.slice(); },
    getVertrag(id) { return cache.vertraege.find(v => v.id === id) || null; },
    saveVertrag(v) {
      v.lastModifiedAt = nowIso();
      upsertInto(cache.vertraege, v);
      GR.api.putVertrag(v).catch(e => { console.warn('saveVertrag Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteVertrag(id) {
      cache.vertraege = cache.vertraege.filter(v => v.id !== id);
      GR.api.deleteVertragRemote(id).catch(e => console.warn('deleteVertrag Backend-Fehler', e));
      notifyChange();
    },

    // --- Vorgänge & Projekte ---
    listVorgaenge() { return cache.vorgaenge.slice(); },
    getVorgang(id) { return cache.vorgaenge.find(v => v.id === id) || null; },
    saveVorgang(v) {
      v.lastModifiedAt = nowIso();
      migrateVorgang(v);
      upsertInto(cache.vorgaenge, v);
      GR.api.putVorgang(v).catch(e => { console.warn('saveVorgang Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteVorgang(id) {
      cache.vorgaenge = cache.vorgaenge.filter(v => v.id !== id);
      delete cache.vorgangFiles[id];
      GR.api.deleteVorgangRemote(id).catch(e => console.warn('deleteVorgang Backend-Fehler', e));
      notifyChange();
    },

    // --- Modul Arbeitszeiten & Vergütung ---
    // Arbeiter/Firmen (Sicht: Rolle „arbeiter")
    listArbeiter() { return personenMitRolle('arbeiter').map(M.toArbeiter); },
    getArbeiter(id) { const p = findPersonAufgeloest(id); return p ? M.toArbeiter(p) : null; },
    saveArbeiter(a) { speichereAlsRolle(M.applyArbeiter, a); },
    deleteArbeiter(id) { entferneRolle(id, 'arbeiter'); },

    listArbeitszeiten() { return cache.arbeitszeiten.slice(); },
    getArbeitszeit(id) { return cache.arbeitszeiten.find(z => z.id === id) || null; },
    saveArbeitszeit(z) {
      z.lastModifiedAt = nowIso();
      upsertInto(cache.arbeitszeiten, z);
      GR.api.putArbeitszeit(z).catch(e => { console.warn('saveArbeitszeit Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteArbeitszeit(id) {
      cache.arbeitszeiten = cache.arbeitszeiten.filter(z => z.id !== id);
      GR.api.deleteArbeitszeitRemote(id).catch(e => console.warn('deleteArbeitszeit Backend-Fehler', e));
      notifyChange();
    },

    listArbeitsabrechnungen() { return cache.arbeitsabrechnungen.slice(); },
    getArbeitsabrechnung(id) { return cache.arbeitsabrechnungen.find(a => a.id === id) || null; },
    saveArbeitsabrechnung(a) {
      a.lastModifiedAt = nowIso();
      upsertInto(cache.arbeitsabrechnungen, a);
      GR.api.putArbeitsabrechnung(a).catch(e => { console.warn('saveArbeitsabrechnung Backend-Fehler', e); if (GR.ui && GR.ui.toast) GR.ui.toast('Backend-Fehler: ' + e.message, 4000); });
      notifyChange();
    },
    deleteArbeitsabrechnung(id) {
      cache.arbeitsabrechnungen = cache.arbeitsabrechnungen.filter(a => a.id !== id);
      GR.api.deleteArbeitsabrechnungRemote(id).catch(e => console.warn('deleteArbeitsabrechnung Backend-Fehler', e));
      notifyChange();
    },

    // Offene (erfasste) Einträge einer Person in einem Zeitraum – Grundlage der
    // automatischen Abrechnungsauswahl.
    offeneArbeitszeiten(arbeiterId, von, bis) {
      return cache.arbeitszeiten
        .filter(z => z.arbeiterId === arbeiterId && (z.status || 'erfasst') === 'erfasst'
          && (!von || String(z.datum) >= String(von)) && (!bis || String(z.datum) <= String(bis)))
        .sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    },

    // Offene Einträge einer Person nach Monat gruppiert – Grundlage der
    // Auswahlliste. Eine Abrechnung deckt genau einen Monat ab, darum ist der
    // Monat die Klammer, in der ausgewählt wird.
    offeneMonate(arbeiterId) {
      const M = GR.models;
      const monate = new Map();
      for (const z of this.offeneArbeitszeiten(arbeiterId)) {
        const key = M.monatsSchluessel(z.datum);
        if (!/^\d{4}-\d{2}$/.test(key)) continue;
        let m = monate.get(key);
        if (!m) {
          m = {
            key, von: M.monatsErster(z.datum), bis: M.monatsLetzter(z.datum),
            label: M.monatsLabel(z.datum), eintraege: [], stunden: 0,
          };
          monate.set(key, m);
        }
        m.eintraege.push(z);
        m.stunden += Number(z.stunden) || 0;
      }
      return [...monate.values()]
        .map(m => ({ ...m, stunden: Math.round(m.stunden * 100) / 100 }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },

    // Abrechnung erstellen: friert je Position den zum Leistungsdatum gültigen
    // Satz ein (bzw. den manuell gesetzten) und sperrt die Einträge. Spätere
    // Satzänderungen wirken dadurch NICHT mehr auf fertige Abrechnungen.
    // `arbeitszeitIds` (Checkbox-Auswahl) hat Vorrang; ohne sie werden wie
    // früher alle offenen Einträge des Zeitraums genommen.
    erstelleArbeitsabrechnung({ arbeiterId, von, bis, haushaltsstelleId, haushaltsjahr, notiz, kostenerstattungen, arbeitszeitIds }) {
      const M = GR.models;
      const historie = (this.getSettings().arbeitszeiten || {}).satzHistorie || [];
      let eintraege;
      if (arbeitszeitIds) {
        const erlaubt = new Set(arbeitszeitIds);
        eintraege = this.offeneArbeitszeiten(arbeiterId, von, bis).filter(z => erlaubt.has(z.id));
      } else {
        eintraege = this.offeneArbeitszeiten(arbeiterId, von, bis);
      }
      // Reine Kostenerstattungen (z. B. Maschineneinsatz ohne Arbeitsstunden)
      // sind eine gültige Abrechnung – nur beides zusammen leer ist ein Fehler.
      const kosten = (kostenerstattungen || []).filter(k => k && (Number(k.betrag) || 0) !== 0);
      if (!eintraege.length && !kosten.length) {
        throw new Error('Keine offenen Einträge im Zeitraum und keine Kostenerstattung erfasst.');
      }

      const abr = Object.assign(M.emptyArbeitsabrechnung(), {
        arbeiterId, zeitraumVon: von, zeitraumBis: bis,
        haushaltsstelleId: haushaltsstelleId || '',
        haushaltsjahr: haushaltsjahr || new Date(bis || Date.now()).getFullYear(),
        notiz: notiz || '',
        kostenerstattungen: kosten.map(k => ({
          id: k.id || M.uuid(),
          beschreibung: String(k.beschreibung || '').trim(),
          betrag: Math.round((Number(k.betrag) || 0) * 100) / 100,
        })),
      });
      for (const z of eintraege) {
        const satz = M.arbeitszeitSatz(z, historie);
        if (satz == null) throw new Error(`Für den ${z.datum} ist kein Stundensatz hinterlegt.`);
        const betrag = Math.round(satz * (Number(z.stunden) || 0) * 100) / 100;
        abr.positionen.push({
          arbeitszeitId: z.id, datum: z.datum, taetigkeit: z.taetigkeit,
          stunden: Number(z.stunden) || 0, satz, betrag,
        });
      }
      abr.summeStunden = Math.round(abr.positionen.reduce((s, p) => s + p.stunden, 0) * 100) / 100;
      abr.summeBetrag = Math.round(abr.positionen.reduce((s, p) => s + p.betrag, 0) * 100) / 100;
      abr.summeKostenerstattung = M.abrechnungKostenSumme(abr);
      this.saveArbeitsabrechnung(abr);

      for (const p of abr.positionen) {
        const z = this.getArbeitszeit(p.arbeitszeitId);
        if (!z) continue;
        z.status = 'abgerechnet';
        z.abrechnungId = abr.id;
        z.satzSnapshot = p.satz;
        z.betragSnapshot = p.betrag;
        this.saveArbeitszeit(z);
      }
      return abr;
    },

    // Storno: Einträge zurück auf „erfasst" (Snapshots weg), Abrechnung löschen.
    storniereArbeitsabrechnung(id) {
      const abr = this.getArbeitsabrechnung(id);
      if (!abr) return;
      for (const p of (abr.positionen || [])) {
        const z = this.getArbeitszeit(p.arbeitszeitId);
        if (!z) continue;
        z.status = 'erfasst';
        z.abrechnungId = null;
        z.satzSnapshot = null;
        z.betragSnapshot = null;
        this.saveArbeitszeit(z);
      }
      this.deleteArbeitsabrechnung(id);
    },

    // Auszahlung: gilt für die ganze Abrechnung inkl. ihrer Einträge.
    markiereAbrechnungAusgezahlt(id, datum) {
      const abr = this.getArbeitsabrechnung(id);
      if (!abr) return;
      abr.status = 'ausgezahlt';
      abr.ausgezahltAm = datum || nowIso().slice(0, 10);
      this.saveArbeitsabrechnung(abr);
      for (const p of (abr.positionen || [])) {
        const z = this.getArbeitszeit(p.arbeitszeitId);
        if (!z) continue;
        z.status = 'ausgezahlt';
        this.saveArbeitszeit(z);
      }
    },

    // --- Verlaufsfotos (zu einem Vorgang; async) ---
    listVorgangFotos(vorgangId) { return (cache.vorgangFiles[vorgangId] || []).slice(); },
    async uploadVorgangFoto(vorgangId, file, kind) {
      const rec = await GR.api.uploadVorgangFoto(vorgangId, file, kind);
      if (!cache.vorgangFiles[vorgangId]) cache.vorgangFiles[vorgangId] = [];
      cache.vorgangFiles[vorgangId].push(rec);
      notifyChange();
      return rec;
    },
    async deleteVorgangFoto(vorgangId, fileId) {
      await GR.api.deleteVorgangFoto(fileId);
      if (cache.vorgangFiles[vorgangId]) cache.vorgangFiles[vorgangId] = cache.vorgangFiles[vorgangId].filter(f => f.id !== fileId);
      notifyChange();
    },
    vorgangFotoUrl(fileId) { return GR.api.vorgangFotoUrl(fileId); },

    // --- Sync-Queue (NocoDB-Backup; bleibt im localStorage als Browser-eigener Cache) ---
    listQueue() { try { return JSON.parse(localStorage.getItem('gr.syncQueue') || '[]'); } catch (_) { return []; } },
    enqueueSync(sitzungId, lastError) {
      const all = this.listQueue();
      const existing = all.find(q => q.sitzungId === sitzungId);
      if (existing) { existing.lastError = lastError || existing.lastError || ''; existing.lastAttemptAt = nowIso(); }
      else { all.push({ id: uuid(), type: 'sitzung-complete', sitzungId, queuedAt: nowIso(), lastError: lastError || '' }); }
      localStorage.setItem('gr.syncQueue', JSON.stringify(all));
    },
    removeFromQueue(qid) {
      localStorage.setItem('gr.syncQueue', JSON.stringify(this.listQueue().filter(q => q.id !== qid)));
    },
    clearQueue() { localStorage.removeItem('gr.syncQueue'); },
    markQueueError(qid, msg) {
      const all = this.listQueue();
      const it = all.find(q => q.id === qid);
      if (it) { it.lastError = msg; it.lastAttemptAt = nowIso(); localStorage.setItem('gr.syncQueue', JSON.stringify(all)); }
    },

    // --- Sync-State (NocoDB) ---
    getSyncState() {
      let s;
      try { s = JSON.parse(localStorage.getItem('gr.syncState') || '{}'); }
      catch (_) { s = {}; }
      // Jede sync-fähige Entität braucht hier ihren Eimer — fehlt er, laufen
      // markSynced/isDirty in „Cannot set properties of undefined".
      for (const k of ['sitzungen', 'personen', 'mitglieder', 'mieter', 'raeume', 'vermietungen', 'empfaenger',
        'haushaltsstellen', 'auslagen', 'vertragspartner', 'vertraege', 'vorgaenge',
        'arbeiter', 'arbeitszeiten', 'arbeitsabrechnungen']) {
        if (!s[k] || typeof s[k] !== 'object') s[k] = {};
      }
      return s;
    },
    markSynced(kind, id) {
      const s = this.getSyncState();
      s[kind][id] = { lastSyncedAt: nowIso(), lastError: '' };
      localStorage.setItem('gr.syncState', JSON.stringify(s));
    },
    markSyncError(kind, id, msg) {
      const s = this.getSyncState();
      const prev = s[kind][id] || {};
      s[kind][id] = { lastSyncedAt: prev.lastSyncedAt || '', lastError: msg, lastAttemptAt: nowIso() };
      localStorage.setItem('gr.syncState', JSON.stringify(s));
    },
    isDirty(kind, item) {
      if (!item || !item.lastModifiedAt) return true;
      const s = this.getSyncState();
      const rec = s[kind][item.id];
      if (!rec || !rec.lastSyncedAt) return true;
      return item.lastModifiedAt > rec.lastSyncedAt;
    },

    // --- Change-Listener ---
    onChange(fn) { changeListeners.push(fn); return () => { const i = changeListeners.indexOf(fn); if (i >= 0) changeListeners.splice(i, 1); }; },
    onRemoteChange(fn) { remoteChangeListeners.push(fn); return () => { const i = remoteChangeListeners.indexOf(fn); if (i >= 0) remoteChangeListeners.splice(i, 1); }; },
    _notifyChange: notifyChange,

    // --- Backup (JSON-Export bleibt verfügbar) ---
    exportAll() {
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: nowIso(),
        sitzungen: this.listSitzungen(),
        mitglieder: this.listMitglieder(),
        settings: this.getSettings(),
      };
    },
    async importAll(data) {
      if (!data || typeof data !== 'object') throw new Error('Ungültige Importdatei');
      await GR.api.importAll({
        sitzungen: Array.isArray(data.sitzungen) ? data.sitzungen : [],
        mitglieder: Array.isArray(data.mitglieder) ? data.mitglieder : [],
        settings: data.settings || null,
      });
      // bootstrap übernimmt den frischen Stand
      await bootstrap();
    },

    // --- Bootstrap-Hooks (für app.js) ---
    bootstrap,
    applyServerMessage,
  };

  GR.store = store;
})();
