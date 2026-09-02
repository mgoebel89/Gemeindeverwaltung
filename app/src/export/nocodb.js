(function () {
  'use strict';
  window.GR = window.GR || {};
  const { store } = GR;
  const { ergebnisAbstimmung, uuid, fullName, istBeschlussTop } = GR.models;

  function nameOf(id, mitglieder) {
    const m = mitglieder.find(x => x.id === id);
    return m ? fullName(m) : '';
  }

  function buildNocoDbJson(sitzung) {
    const mitglieder = store.listMitglieder();

    const sitzungRow = {
      SitzungId: sitzung.id,
      Datum: sitzung.datum,
      Ort: sitzung.ort,
      Sitzungsleitung: nameOf(sitzung.sitzungsleitungId, mitglieder),
      Schriftfuehrer: nameOf(sitzung.schriftfuehrerId, mitglieder),
      BeginnOeffentlich: sitzung.beginnOeffentlich,
      EndeOeffentlich: sitzung.endeOeffentlich,
      BeginnNichtOeffentlich: sitzung.beginnNichtOeffentlich,
      EndeSitzung: sitzung.endeSitzung,
      Anwesende: (sitzung.anwesendIds || []).map(id => nameOf(id, mitglieder)).filter(Boolean).join('; '),
      Abwesend: mitglieder.filter(m => m.aktiv && !(sitzung.anwesendIds || []).includes(m.id)).map(m => fullName(m)).join('; '),
      Gaeste: sitzung.gaeste,
    };

  // Unterpunkte als lesbaren Text — für Sicherung und Tabellenexport, wo eine
  // verschachtelte Struktur nichts nützt. Nummern wie im Protokoll.
  function unterpunkteText(top) {
    const liste = GR.models.unterpunkteVon(top);
    if (!liste.length) return '';
    return liste.map((up, i) => {
      const kopf = `${GR.models.unterpunktNummer(top, i)} ${(up.titel || '').trim()}`.trim();
      const text = (up.text || '').trim();
      return text ? `${kopf}\n${text}` : kopf;
    }).join('\n\n');
  }

    const beschluesse = sitzung.tops.map(t => ({
      BeschlussId: t.id || uuid(),
      SitzungId: sitzung.id,
      Bereich: t.bereich === 'oeffentlich' ? 'öffentlich' : 'nicht-öffentlich',
      TopNr: t.nummer,
      Titel: t.titel,
      Art: istBeschlussTop(t) ? 'Beschlussfassung' : 'Beratung',
      Beschlussvorlage: t.beschlussvorlage,
      Ja: t.abstimmung?.durchgefuehrt ? t.abstimmung.ja : null,
      Nein: t.abstimmung?.durchgefuehrt ? t.abstimmung.nein : null,
      Enthaltung: t.abstimmung?.durchgefuehrt ? t.abstimmung.enthaltung : null,
      Ergebnis: ergebnisAbstimmung(t.abstimmung),
      Befangenheit: t.befangenheitsText,
      Bemerkungen: t.bemerkungen,
      Unterpunkte: unterpunkteText(t),
    }));

    return { Sitzungen: [sitzungRow], Beschluesse: beschluesse };
  }

  GR.nocodb = { buildNocoDbJson };
})();
