# Gemeindeverwaltung — Sitzungsprotokoll-App

Sitzungsvorbereitung, Live-Protokollierung, PDF-Export und Anhang-Verwaltung
für Gemeinderatssitzungen. Läuft in einem Proxmox-LXC-Container mit
eingebautem Node-Backend (SQLite + WebSocket) und nginx-Frontend.

## Architektur

```
                ┌──────────────────────────────────────────┐
                │  LXC-Container (Debian 12)               │
                │                                          │
   Browser ───► │  nginx :80                               │
                │   ├─ /            → /var/www/sitzungsapp │
                │   ├─ /api/        → 127.0.0.1:3000       │
                │   └─ /ws          → 127.0.0.1:3000/ws    │
                │                                          │
                │  Node-Backend (systemd):                 │
                │   ├─ Express REST                        │
                │   ├─ WebSocket-Broadcast (Live-Sync)     │
                │   ├─ SQLite  /var/lib/.../data.db        │
                │   └─ Files   /var/lib/.../attachments/   │
                │                                          │
                │  Backup  /var/backups/gemeindeverwaltung │
                └──────────────────────────────────────────┘
```

- **Daten leben im Container**, nicht mehr im Browser-`localStorage`.
- **Live-Sync per WebSocket:** Änderungen auf einem Gerät erscheinen sofort
  auf allen anderen geöffneten Browsern.
- **Anhänge:** beliebige Dateien (max. 25 MB), pro Sitzung, **erscheinen nicht
  im Protokoll-PDF**.
- **NocoDB-Auto-Sync** bleibt parallel verfügbar als zusätzliches Off-Site-Backup
  (über die Einstellungen).
- **Backup:** tägliches Snapshot der SQLite-Datei + Anhänge nach
  `/var/backups/gemeindeverwaltung/YYYY-MM-DD/`, letzte 14 Tage werden behalten.

## Oberfläche

Die App nutzt eine **linke Seitenleiste** (gruppiert: *Übersicht*, *Gremien*,
*Liegenschaften*, *Finanzen*, *Bürger*, unten *Stammdaten*/*Einstellungen*), die sich per Knopf
**einklappen** lässt (nur Icons) und auf schmalen Geräten als **Hamburger-Drawer** erscheint.
Die Navigation wird aus einer zentralen Config in `app/src/app.js` (`NAV`) aufgebaut — ein
neues Modul ist dort ein Eintrag.

Die Startseite (`#/`) ist ein **Dashboard** (`app/src/views/uebersicht.js`) mit Karten für
**laufende Vorgänge**, anstehende Saalvermietungen, Vertrags-Kündigungsfristen, **anstehende
Termine** (aus den abonnierten Kalendern) und **offene Aufgaben** (aus Vikunja). Die frühere
Sitzungsliste liegt unter `#/sitzungen`, die vollständige Terminliste unter `#/termine`, die
Aufgaben unter `#/aufgaben`.

Die **Einstellungen** sind in Kategorien gegliedert (Unter-Navigation): Allgemein, Darstellung,
Dokumente, Kalender, Aufgaben, E-Mail, Vorgänge & Projekte, Vermietung, Verträge & Pacht,
Bargeldauslagen, Arbeitszeiten, Inventar, Einwohner, Datensicherung.

Eine Ausnahme in der Navigation ist das Modul **Einwohner**: es liegt hinter einer eigenen,
serverseitig geprüften PIN und zeigt ohne sie nichts an (siehe unten).

## Struktur

```
Gemeindeverwaltung/
├── app/                 # Static Web-App (HTML/JS/CSS)
├── backend/             # Node.js + Express + WebSocket + SQLite
├── deploy/
│   ├── proxmox-install.sh   # Proxmox-Host: legt LXC an, installiert alles
│   ├── container-setup.sh   # Manuelles Setup im bestehenden LXC
│   ├── nginx-site.conf      # nginx-Site (Frontend + Proxy)
│   ├── backend.service      # systemd-Unit fürs Node-Backend
│   ├── backup.sh            # Tägliches Backup
│   └── update.sh            # In-Place-Update aus Git
├── README.md
└── LICENSE
```

### PDF-Kopf (Wappen)

Alle PDF-Bauer in `app/src/export/` setzen das Wappen über **einen** Baustein:
`export/pdf-kopf.js` (`GR.pdfKopf`). Er muss in `index.html` **vor** den übrigen
Export-Skripten geladen werden.

```js
const kopf = GR.pdfKopf.platziere(doc, {
  seite: 'rechts',        // oder 'links'
  x: RIGHT_X,             // bei 'rechts' die RECHTE Kante, bei 'links' die linke
  y: state.y - 2,
  box: { w: 20, h: 24 },  // Höchstmaße, Standard
  inhaltsBreite: CONTENT_W,
});
// kopf.textBreite  → Textbreite ohne die Wappenspalte
// kopf.unterkante  → tatsächliche Unterkante des Bildes
state.y = GR.pdfKopf.unterhalb(kopf, state.y + 20);
```

Zwei Fehler, die das verhindert und die vorher real aufgetreten sind:

- **Verzerrung.** `addImage(..., 20, 24)` quetscht das Wappen in ein festes
  Rechteck. Das Wappen von Hörschhausen ist 140 × 160 Pixel und wurde so um
  gut 5 % gestaucht. `platziere` passt seitenverhältnistreu ein.
- **Überlappung.** Wer die tatsächliche Höhe nicht kennt, rät den Abstand
  darunter. In der Vermietungsübersicht stand `state.y += 20`, während das
  Wappen bis 42 mm reichte — die Tabelle begann 2 mm im Bild. `unterhalb()`
  rechnet mit der echten Unterkante.

Ohne Wappen liefert `platziere` `{ vorhanden: false, unterkante: y }`; die
Aufrufer brauchen keine Sonderbehandlung. Die **Typografie bleibt bei den
einzelnen Bauern** — das Bargeldauslagen-Formular und der VG-Vordruck sind
maßgetreue Nachbauten amtlicher Vorlagen, denen ein gemeinsamer Kopf keine
Schriftgrößen vorschreiben darf.

## 1) Installation auf Proxmox

Auf dem **Proxmox-Host** als root:

```bash
bash -c "$(wget -qO- https://raw.githubusercontent.com/mgoebel89/Gemeindeverwaltung/main/deploy/proxmox-install.sh)"
```

Konfiguration per Env-Variable, z. B.:

```bash
CTID=210 HOSTNAME=sitzungsapp BRIDGE=vmbr0 \
IPV4=192.168.1.50/24 GATEWAY=192.168.1.1 \
bash -c "$(wget -qO- https://raw.githubusercontent.com/mgoebel89/Gemeindeverwaltung/main/deploy/proxmox-install.sh)"
```

Variablen (mit Defaults):

| Variable          | Default       | Bedeutung                                |
|-------------------|---------------|------------------------------------------|
| `CTID`            | nächste freie | LXC-ID                                   |
| `HOSTNAME`        | `sitzungsapp` | Hostname                                 |
| `STORAGE`         | `local-lvm`   | Storage fürs Container-Volume            |
| `TEMPLATE_STORAGE`| `local`       | Storage mit Templates                    |
| `DISK_GB`         | `6`           | Root-Disk in GB                          |
| `MEMORY_MB`       | `512`         | RAM                                      |
| `CORES`           | `1`           | CPU-Kerne                                |
| `BRIDGE`          | `vmbr0`       | Netzwerk-Bridge                          |
| `IPV4`            | `dhcp`        | z. B. `192.168.1.50/24`                  |
| `GATEWAY`         | —             | Pflicht bei statischer IP                |
| `HTTP_PORT`       | `80`          | nginx-Port (leitet auf HTTPS um)         |
| `HTTPS_PORT`      | `443`         | nginx-Port für HTTPS                     |
| `PASSWORD`        | zufällig      | root-Passwort                            |
| `REPO_URL`        | dieses Repo   | aus dem geklont wird                     |
| `REPO_BRANCH`     | `main`        | Branch                                   |

Am Ende zeigt das Skript IP, URL und (falls generiert) root-Passwort.

**HTTPS und das selbstsignierte Zertifikat.** Die App läuft über **https**; der
HTTP-Port leitet dorthin um. Grund ist der Kamera-Zugriff: der Barcode-Scanner
im Inventar funktioniert im Browser nur in einem „secure context" — über
`http://<IP>` bleibt die Kamera am Handy stumm. Der Installer erzeugt dafür ein
selbstsigniertes Zertifikat unter `/etc/ssl/gemeindeverwaltung/`. Beim ersten
Aufruf warnt der Browser einmalig; die Ausnahme ist zu bestätigen. Ein
vorhandenes Zertifikat wird bei Updates **nicht** überschrieben, damit die
Bestätigung erhalten bleibt. Bestandsinstallationen bekommen das Zertifikat
beim nächsten `sitzungsapp-update` automatisch nachgereicht — **danach ändert
sich die Adresse auf `https://`, Lesezeichen sind anzupassen.**

## 2) Updates einspielen

**Am einfachsten – vom Proxmox-Host** (dort bist du root, es wird **kein**
Container-Passwort gebraucht):

```bash
pct exec <CTID> -- update
```

`update` ist ein Kurzbefehl für `sitzungsapp-update` (analog zu den
Proxmox-Helper-Scripts). Die CTID findest du mit `pct list`.

**Oder direkt in der Container-Konsole** (Proxmox-Weboberfläche → Container →
*Console*, oder `pct console <CTID>`) – dort nach dem Login einfach:

```bash
update
```

Das Skript:
1. zieht den aktuellen Git-Stand,
2. installiert ggf. neue Backend-Dependencies,
3. übernimmt geänderte `nginx-site.conf` und `backend.service`,
4. reloadet Backend und nginx.

Browser danach mit **Strg+F5** neu laden.

> **Konsolen-Login / Passwort:** Die Konsole verlangt das **root-Passwort** des
> Containers. Das wurde bei der Installation gesetzt (bei zufälligem Passwort nur
> **einmal** am Ende ausgegeben). Ist es unbekannt, lässt es sich jederzeit vom
> Proxmox-Host **neu setzen** – ohne das alte zu kennen:
>
> ```bash
> pct exec <CTID> -- passwd            # neues root-Passwort interaktiv eingeben
> ```
>
> Für reine Updates brauchst du die Konsole nicht – der Weg über
> `pct exec <CTID> -- update` läuft auch ohne Container-Passwort.
>
> Der Kurzbefehl `update` wird bei der Installation angelegt; **bestehende**
> Container erhalten ihn automatisch beim nächsten `sitzungsapp-update`.

## 3) Migration aus früherer Browser-Version

Wenn du bisher die Vorgänger-Version mit `localStorage` benutzt hast: beim
ersten Öffnen der neuen Version erscheint ein Dialog, der die im Browser
vorhandenen Sitzungen/Mitglieder einmalig ins Backend übernimmt und den
Browser-Speicher leert.

## 4) Backups

- **Automatisch:** Cron-Job `30 3 * * *` ruft `sitzungsapp-backup` auf →
  `/var/backups/gemeindeverwaltung/<DATUM>/data.db` + `attachments.tar.gz`.
- **Manuell:** `pct exec <CTID> -- sitzungsapp-backup`
- **Off-Site:** In den App-Einstellungen NocoDB konfigurieren — der Auto-Sync
  schreibt zusätzlich an deine NocoDB-Instanz.
- **Container-Snapshot:** Proxmox-Snapshots des LXC erfassen alles auf einen
  Schlag.

## 5) Datenhaltung

| Bereich                    | Ort                                          |
|----------------------------|----------------------------------------------|
| Sitzungen, Personen-Stammdaten, Settings | SQLite `/var/lib/gemeindeverwaltung/data.db` |
| Anhänge                    | `/var/lib/gemeindeverwaltung/attachments/<sitzungId>/<attachmentId>` |
| Backups                    | `/var/backups/gemeindeverwaltung/<DATUM>/`   |
| App-Code                   | `/opt/gemeindeverwaltung/`                   |
| **Einwohner**              | **eigene NocoDB-Base** (nicht lokal, nicht im Snapshot) |
| Ehrungen (Status/Notizen)  | SQLite, Tabelle `ehrungen` — nur im Container-Backup |

> Die **Ehrungs-Historie** liegt bewusst nur lokal: sie enthält Namen und würde beim
> NocoDB-Sync in der Sicherungs-Base landen, die von den Einwohnerdaten getrennt bleiben soll.
> Gesichert wird sie über das tägliche Container-Backup. Die Einwohner selbst sichert NocoDB.

## 6) Lokal testen (ohne Proxmox)

```bash
cd backend && npm install && npm start &
cd ../app   && python3 -m http.server 8080
# Anpassung: in app/index.html den Backend-Pfad bzw. nginx-Reverse-Proxy nachbilden,
# oder im Frontend BASE auf http://localhost:3000 hardcoden (src/api.js).
```

Für die einfache lokale Inspektion (ohne Backend) reicht weiterhin
`python3 -m http.server` im `app/`-Verzeichnis — Migrationsdialog wird dann
nicht funktionieren, ist aber für UI-Tests irrelevant.

## Hinweise

- **HTTPS:** Standard ist HTTP. Für HTTPS Caddy oder einen Reverse-Proxy
  vorschalten.
- **CORS für NocoDB:** Wenn NocoDB-Sync genutzt wird, muss die NocoDB-Instanz
  CORS für die Container-Origin erlauben (`NC_CORS_ORIGIN`).
- **Mehrere Geräte gleichzeitig:** WebSocket-Broadcast verteilt Änderungen in
  Echtzeit; letzte Schreibung gewinnt bei gleichzeitigem Tippen auf dasselbe
  Feld.

## Stammdaten (Personen aller Module)

Unter **Stammdaten** (`#/stammdaten`) stehen alle Personen und Firmen an einer
Stelle. Früher gab es dafür fünf getrennte Listen — Ratsmitglieder, Mieter,
Empfänger von Bargeldauslagen, Arbeiter/Firmen und Vertragspartner. Sie sind zu
**einer** Liste zusammengeführt; **Rollen** sagen, wo jemand auftaucht:

| Rolle | Modul | Zusätzliche Felder |
|---|---|---|
| Ratsmitglied | Sitzungen | Funktion (Ortsbürgermeister/Beigeordneter/Ratsmitglied) |
| Mieter | Vermietung | Ortsfremd (höhere Grundmiete) |
| Auslagen-Empfänger | Bargeldauslagen | — (nutzt die Bankverbindung) |
| Arbeiter/Firma | Arbeitszeiten | — (nutzt Bank-, Steuer- und SV-Daten) |
| Vertragspartner | Verträge und Pacht | — (mehrzeilige Anschrift möglich) |

Eine Person kann mehrere Rollen haben: der Bürgermeister ist Ratsmitglied und
gleichzeitig Empfänger einer Bargeldauslage — ein Datensatz, eine Bankverbindung.
Firmen laufen im selben Datensatztyp: Feld **Firma** gefüllt ⇒ die Firma ist der
Anzeigename, die Person darunter der Ansprechpartner.

**Migration ohne Datenverlust.** Beim ersten Start nach dem Update übernimmt das
Backend die fünf alten Tabellen einmalig in `personen`:

- Jede Person **behält die Kennung ihres alten Datensatzes**. Deshalb zeigen alle
  Vermietungen, Auslagen, Arbeitszeiten, Abrechnungen, Verträge und
  Anwesenheitslisten unverändert auf die richtigen Personen — kein Verweis wurde
  umgeschrieben.
- Das Feldschema ist die **Vereinigung** aller fünf Quellen, nicht die
  Schnittmenge. Zwei Namensfallen sind dabei explizit aufgelöst:
  `empfaenger.name` war der **Nachname**, `vertragspartner.name` dagegen die
  **Firma**; die mehrzeilige Vertragspartner-Anschrift bleibt als eigenes Feld
  neben Straße/PLZ/Ort erhalten, statt beim Migrieren zerlegt zu werden.
- **Die alten Tabellen bleiben stehen** (`mitglieder`, `mieter`, `empfaenger`,
  `arbeiter`, `vertragspartner`) und werden nicht mehr beschrieben — sie sind der
  Rückweg. Die Migration ist idempotent (Marker `personenMigration` in den
  Settings, zusätzlich wird jede bereits vorhandene Kennung übersprungen).
- **Doppelt geführte Personen werden NICHT automatisch verschmolzen.** Die
  Stammdaten zeigen die Verdachtsfälle; zusammengeführt wird nur von Hand über
  den Dubletten-Assistenten (siehe unten).

**Kompatibilität:** `store.listMieter()`, `listEmpfaenger()`, `listArbeiter()`,
`listVertragspartner()` und `listMitglieder()` gibt es weiter — sie sind Sichten
auf die Personenliste und liefern die alte Datensatzform. Dieselben Sichten gibt
es im Backend (`db.js`), so dass Routen, PDFs und der NocoDB-Sync unverändert
laufen. Zwei Regeln dabei: `list*()` filtert nach Rolle (das speist die
Auswahllisten), `get*()` bewusst **nicht** — sonst zeigte eine alte Vermietung
ihren Mieter nicht mehr an, nur weil dessen Rolle inzwischen entfernt wurde. Und
`delete*()` entfernt **nur die Rolle**; gelöscht wird eine Person erst, wenn sie
in keinem Modul mehr vorkommt. Die alten Adressen `#/mieter`, `#/arbeiter`,
`#/vertragspartner` und `#/auslagen-stammdaten` leiten auf den passenden
Rollenfilter der Stammdaten um.

**Sensible Daten:** Bankverbindung, Steuer-ID, Sozialversicherungsnummer und
Geburtsdatum sind nur in der **Leitungs-Ansicht** sichtbar und änderbar (Rolle
wie bei den Vorgängen, optional per PIN). Bearbeitet ein Ratsmitglied eine
Person, bleiben diese Felder unangetastet — sie werden gar nicht erst
angezeigt. Die PDFs (Auslagen-Formular, Lohnabrechnung) drucken die IBAN
unverändert, sonst wären Abrechnungen in der Rats-Ansicht nicht erstellbar.
Ohne gesetzten Leitungs-PIN ist das **Blickschutz, kein Zugangsschutz**.

**Löschen** ist nur möglich, wenn die Person in keinem Modul mehr verwendet wird;
andernfalls nennt die App die Fundstellen und verweist auf „Aktiv"-Haken
entfernen oder die einzelne Rolle abwählen.

### Dubletten zusammenführen

Nach dem Zusammenlegen der fünf alten Listen steht dieselbe Person leicht
mehrfach in den Stammdaten — einmal als Mieter, einmal als Empfänger, oft mit
abweichender Schreibweise. Der Knopf **„Doppelte zusammenführen"** am Fuß der
Stammdaten öffnet den Assistenten. Er ist der **Leitungs-Ansicht** vorbehalten,
weil beim Zusammenführen auch IBAN, Steuer-ID, SV-Nummer und Geburtsdatum
abzuwägen sind.

**Erkennung.** Vorschläge werden nach Sicherheit sortiert und einzeln bestätigt.
Bewertet werden gleicher Name (auch über Umlaut-Schreibweisen wie
Müller/Mueller, vertauschte Vor-/Nachnamen und Tippfehler), ein Name der
vollständig im anderen steckt („Bauhof Kelberg" ⊂ „Bauhof Kelberg GmbH"), sowie
gleiche IBAN, E-Mail, Telefonnummer, Geburtsdatum und Anschrift. Ein einzelner
Nachname paart bewusst **nicht** mit einer gleichnamigen Firma („Meyer" ist keine
Dublette von „Karl Meyer"). Ein Vorschlag lässt sich mit **„Kein Duplikat"**
dauerhaft abhaken (gemerkt in `settings.personen.ignorierteDubletten`). Für alles
andere gibt es **„Von Hand zusammenführen"** mit freier Auswahl zweier Personen.

**Was beim Zusammenführen passiert** — und warum nichts verloren geht:

1. **Ein Eintrag bleibt bestehen** und behält seine Kennung. Vorgeschlagen ist
   der mit den meisten Verknüpfungen, umschaltbar per „⇄ Tauschen".
2. **Alle Verweise werden umgeschrieben**, an *jeder* Stelle: `mieterId`,
   `empfaengerId`, `arbeiterId` (Zeiten und Abrechnungen), `partnerId` sowie in
   den Sitzungen Sitzungsleitung, Schriftführer, Anwesenheitsliste, die
   **Anwesenheitszeiten (dort steht die Kennung als Objektschlüssel)** und je TOP
   Sitzungsleitung, Befangenheit, freiwilliger Verzicht und ruhendes Stimmrecht.
   Waren beide Personen in derselben Liste, entsteht kein Doppeleintrag.
   Der Assistent nennt vorab, was er anfassen wird.
3. **Felder verschmelzen:** leere Felder werden still ergänzt, bei echten
   Konflikten stehen beide Werte nebeneinander (vorausgewählt der vollständigere
   bzw. der aus dem zuletzt geänderten Eintrag). Rollen werden vereinigt,
   **beide Notizen** bleiben untereinander erhalten, und aktiv bleibt die Person,
   sobald eine der beiden Seiten aktiv war.
4. **Der aufgegebene Eintrag wandert vollständig ins Archiv** der Zielperson
   (`zusammengefuehrt`) — samt der nicht gewählten Werte und einem Protokoll der
   umgeschriebenen Datensätze. Er läuft im Backup und im NocoDB-Sync mit.
5. **Die aufgegebene Kennung bleibt als Alias** (`aliasIds`) hinterlegt.
   `store.getPerson()` und `db.getPersonAufgeloest()` lösen darüber weiter auf,
   damit ein später eingespieltes Backup nicht ins Leere zeigt. Der
   NocoDB-Restore überspringt Personen, deren Kennung so auflöst — sonst holte er
   die zusammengeführte Dublette als eigenen Eintrag zurück.

**Rückgängig.** Die Karte „Zuletzt zusammengeführt" macht den jeweils jüngsten
Vorgang einer Person umkehrbar: der aufgegebene Eintrag wird wiederhergestellt,
alle umgeschriebenen Verweise zeigen wieder auf ihn, und die Zielperson geht auf
ihren Stand davor zurück. Ältere Vorgänge sind bewusst nicht einzeln umkehrbar —
bei zwischenzeitlichen Änderungen wäre nicht mehr entscheidbar, was gelten soll.

> **Für Entwickler:** Die Zusammenführung liegt im Frontend
> (`models.js`, Abschnitt „Personen zusammenführen" + `store.js`
> `fuehrePersonenZusammen` / `macheZusammenfuehrungRueckgaengig`), weil sie die
> Verweise aller Module mitziehen muss. `backend/personen.js` kennt davon nur das
> Feld `zusammengefuehrt` und die Alias-Auflösung. **Kommt ein Modul mit einem
> Personenverweis dazu, muss es in `M.PERSON_VERWEISE` eingetragen werden** —
> sonst bleibt sein Verweis beim Zusammenführen auf der gelöschten Kennung stehen.

## Modul „Sitzungsprotokoll"

Das ursprüngliche Modul: Vorbereitung (`#/sitzung/vorbereitung`) und laufende Sitzung
(`#/sitzung/live`), Ergebnis ist das **Protokoll-PDF** (`app/src/export/pdf.js`).

Ein Tagesordnungspunkt hat einen **Titel**, eine **Art**, ein großes **Textfeld** und
optional eine **Abstimmung**.

### Art des Punkts: Beschlussfassung oder Beratung

Direkt unter dem Titel steht **„Art des Punkts"** mit zwei Schaltern:
**Beschlussfassung** (Vorgabe für jeden neuen TOP — der Regelfall im Gemeinderat) und
**Beratung** für Punkte wie „Verschiedenes". Die Art lässt sich in der **Vorbereitung** und
in der **laufenden Sitzung** umstellen.

Davon hängen ab: die Beschriftung des Textfelds (**„Beschlussvorlage"** bzw. **„Beratung"**),
ob **Unterpunkte** angeboten werden, ob das **Bemerkungsfeld** erscheint, und ob im Protokoll
die Überschrift „Beschlussvorlage:" gedruckt wird.

> **Zwei Dinge, die man nicht verwechseln darf.** Die **Art** ist die *Absicht* und wird in der
> Vorbereitung festgelegt. Das Häkchen **„Abstimmung wurde durchgeführt"** ist das *Ergebnis*
> und entsteht erst in der Sitzung. Früher gab es nur das Zweite — und weil in der Vorbereitung
> naturgemäß noch nichts abgestimmt ist, sah dort **jeder** TOP wie eine bloße Beratung aus.
> Allein die **Abstimmungsbox** im PDF richtet sich weiterhin nach dem Ergebnis: einen Beschluss,
> den es nicht gab, behauptet das Protokoll nirgends.

**Umschalten verliert nichts.** Wird aus einer Beschlussfassung eine Beratung, bleibt eine schon
getippte Beschlussvorlage stehen und wird gedruckt; umgekehrt bleiben erfasste Unterpunkte
erhalten (nur neue lassen sich dann nicht mehr anlegen). Wurde bereits abgestimmt und der Punkt
danach auf Beratung gestellt, bleibt das Abstimmungsergebnis im Protokoll — mit einem Hinweis
in der Oberfläche.

**Beschluss geplant, aber nicht abgestimmt?** Beim **Abschließen der Sitzung** nennt die App
diese Punkte namentlich und fragt nach. Im Protokoll erscheint dort keine Abstimmungsbox — das
ist richtig, wenn der Punkt vertagt wurde, und ein Versehen, wenn nicht. Gespeichert wird beides
im selben Textfeld; alte Protokolle bleiben unverändert.

**Bestandsdaten** kennen die neue Angabe nicht. Für sie wird die Art aus dem abgeleitet, was
tatsächlich passiert ist: wurde abgestimmt, war es eine Beschlussfassung. Alte Sitzungen sehen
damit genauso aus wie vorher (`M.istBeschlussTop` in `app/src/models.js` — der einzige Ort, an
dem diese Frage beantwortet wird).

### Unterpunkte (für „Verschiedenes")

Unter „Verschiedenes" werden meist mehrere Themen nacheinander besprochen, die im Protokoll
auseinandergehalten werden müssen. Dafür gibt es **Unterpunkte**: je Thema eine **Überschrift**
und ein **Text**, anzulegen über **„+ Unterpunkt"** — in der **Vorbereitung** wie in der
**laufenden Sitzung** (`app/src/ui/unterpunkte.js`, gemeinsam genutzt, damit sich das Feld an
beiden Stellen gleich verhält).

- Im PDF erscheinen sie als **fette Überschrift mit Nummer** — `7.1`, `7.2` … — und dem Text
  darunter, eingerückt. Das große Textfeld bleibt daneben bestehen und eignet sich als
  **Einleitung**; wer nichts einleitet, lässt es leer.
- **Die Nummer wird nicht gespeichert**, sondern aus der Reihenfolge gerechnet. Gespeichert
  stünde sie nach dem ersten Umsortieren falsch da, und niemand denkt daran, sie nachzuziehen.
- **Reihenfolge** über ↑/↓, Löschen über ×. Ein Unterpunkt mit Inhalt wird nur nach Rückfrage
  gelöscht, ein leerer sofort.
- Der **Text eines Unterpunkts** versteht Aufzählungen (`- ` / `* `) und Nummernlisten (`1. `).
- Unterpunkte gibt es **nur bei Punkten der Art „Beratung"** — bei einer Beschlussfassung
  gehört der Text in die Beschlussvorlage. Wird ein Punkt **nachträglich auf Beschlussfassung
  umgestellt**, bleiben vorhandene Unterpunkte stehen und werden weiter gedruckt; nur neue
  lassen sich nicht mehr anlegen. Etwas auszublenden, was gespeichert ist, wäre genau der
  Fehler von unten.

### Vorschau „So steht es im Protokoll"

Die Vorschau zeigt einen TOP so, wie er im Protokoll erscheint: Nummern, Überschriften,
Aufzählungen und den Abstimmungsteil.

- In der **laufenden Sitzung** steht sie immer unter dem TOP.
- In der **Vorbereitung** klappt sie je TOP über den Knopf **„Vorschau"** in der Kopfzeile der
  Karte auf. Bewusst nicht dauerhaft: dort stehen alle TOPs untereinander, und die Seite wäre
  sonst doppelt so lang. Der aufgeklappte Zustand **überlebt das Neuzeichnen** (TOP verschieben,
  Unterpunkt anlegen) — sonst klappte sie bei jedem Handgriff wieder zu.
- Sie **läuft beim Tippen mit**, ohne dass der Cursor aus dem Feld springt (`vorschauFeld` in
  `app/src/ui/unterpunkte.js`: der Behälter wird nachgezogen, nicht die ganze Karte).
- Der **Abstimmungsteil** erscheint bei einer Beschlussfassung. Solange nicht abgestimmt wurde,
  steht dort ein blasser, leerer Kasten mit dem Hinweis „Wird in der Sitzung erfasst" — so sieht
  man der Vorschau die Art des Punkts an. Nach der Abstimmung zeigt er Einstimmig bzw.
  Stimmenmehrheit, die Zahlen, die Bemerkungen und das Ergebnis.
- Sie kann **bewusst genau so viel wie der Druck** und keinen Deut mehr. Hoch- und
  Tiefgestelltes, Fett und Kursiv kommen aus demselben Zerleger wie das PDF
  (`GR.pdfInline.zerlege`), damit die beiden Wege gar nicht erst auseinanderlaufen können.
  Eine Vorschau, die etwas anderes zeigt als das Protokoll, führt in die Irre.

### Was der PDF-Renderer versteht

`drawMarkdown` in `app/src/export/pdf.js` beherrscht zeilenweise: **Überschriften** (`# `, `## `,
`### `), **Aufzählungen** (`- `, `* `), **Nummernlisten** (`1. `) und Leerzeilen als halben
Abstand. Innerhalb einer Zeile kommt `app/src/export/pdf-inline.js` dazu:

| Schreibweise | Ergebnis |
| --- | --- |
| `m^2`, `CO_2` | hoch- und tiefgestellt, ein Zeichen |
| `m^{-2}`, `X_{max}` | hoch- und tiefgestellt, mehrere Zeichen |
| `**fett**` | **fett** |
| `*kursiv*` | *kursiv* |
| `\_`, `\^`, `\*` | das Zeichen wörtlich |

Der Backslash ist wichtig: `Anlage_3` würde sonst als `Anlage₃` gedruckt. `Anlage\_3` bleibt
`Anlage_3`. Unter dem Textfeld steht in beiden Ansichten eine Kurzhilfe mit diesen Zeichen —
eine Auszeichnung, die nur im Handbuch steht, findet niemand.

**Warum das ein eigener Baustein ist.** jsPDF setzt eine Zeile nur in EINER Schrift und EINER
Größe. Sobald sich mitten in der Zeile etwas ändert, muss die Zeile in Stücke zerlegt, jedes
einzeln gemessen und an eigener x-Position gesetzt werden, und der Umbruch muss über die
Stückgrenzen hinweg rechnen — `splitTextToSize` kann das nicht mehr. Genau diese Maschinerie
fehlte, weshalb Fett und Kursiv jahrelang draußen blieben; mit ihr kamen sie fast geschenkt
dazu. Beim Zeichnen werden benachbarte Stücke gleichen Stils wieder zusammengefasst, sonst
gingen Wortabstände verloren.

> **Fertige Sonderzeichen sind keine Abkürzung.** Am Blatt gemessen, was die
> PDF-Standardschrift kann: `¹ ² ³` und `°` drucken korrekt — ein getipptes „1.250 m²" war nie
> kaputt. Aber `⁰` und `⁴`–`⁹` drucken als **falsche Buchstaben** (`p`, `t`, `u`, `v`, …), und
> `₀`–`₉` als **Satzzeichen**: aus „CO₂" wurde „CO,". In beiden Fällen verliert obendrein die
> **ganze Zeile** ihre Laufweite, weil jsPDF auf eine andere Kodierung umschaltet und sämtliche
> Breiten falsch misst. Solche Zeichen werden deshalb eingelesen und über denselben Weg gesetzt
> wie `m^2` — wer aus Word ein „CO₂" einfügt, bekommt es einfach richtig gedruckt.

**In den übrigen Modulen** (Vermietung, Auslagen, Verträge, Vorgänge, Arbeitszeiten, Einwohner,
Urkunde) gibt es die Schreibweise nicht — dort wird nur dafür gesorgt, dass kein eingefügtes
Zeichen die Zeile zerstört: `²` und `³` bleiben stehen, aus `CO₂` wird das lesbare `CO2`. Bei
den vier Modulen ohne eigenen Zeichenfilter hängt sich `GR.pdfInline.schuetze(doc)` einmal an
das Dokument, statt Dutzende Aufrufstellen einzeln anzufassen — so kann keine vergessen werden,
auch keine später hinzugefügte.

### Bemerkungen

Das Feld **Bemerkungen** gehört zur Abstimmung und erscheint im PDF in der Abstimmungsbox. Es
wird deshalb nur bei Punkten der Art **Beschlussfassung** angezeigt — maßgeblich ist die Art,
nicht ob schon abgestimmt wurde, sonst ließe sich erst dann etwas eintragen, wenn das Ergebnis
bereits feststeht.

> **Behobener Fehler:** Vorher war das Feld immer sichtbar, gedruckt wurde es aber nur innerhalb
> der Abstimmungsbox — und die gibt es ohne Abstimmung nicht. Alles, was bei einem TOP wie
> „Verschiedenes" dort eingetippt wurde, fiel **stillschweigend aus dem Protokoll**. Steht in
> einem Altbestand noch Text darin, bleibt das Feld sichtbar und wird jetzt als eigener Absatz
> **„Bemerkungen:"** gedruckt, damit nichts verlorengeht.

### Export

TOP-Unterpunkte laufen als lesbarer Text (`7.1 Titel`, Zeilenumbruch, Text) in **CSV**, in den
**NocoDB-JSON-Export** und in die **Datensicherung** — dort in einer eigenen Spalte
**`Unterpunkte`** der Beschluss-Tabelle. Die Spalte legt der Sync bei Bedarf selbst an
(`ensureColumns`), es ist in NocoDB nichts vorzubereiten.

Die **Art des Punkts** steht als Spalte **`Art`** (Beschlussfassung / Beratung) daneben — so
lässt sich in NocoDB auswerten, welche Punkte Beschlüsse waren. Für die Wiederherstellung ist
sie nicht nötig: Sitzungen kommen vollständig aus der `Payload`-Spalte zurück.

## Modul „Dokumente" (Paperless-ngx)

Der Container ist als **Multi-Modul-Gemeindeverwaltung** angelegt. Neben dem
Sitzungsprotokoll gibt es das Modul **Dokumente**, das die in **Paperless-ngx**
(Docker auf dem NAS) abgelegten Dokumente durchsuchbar macht, das **Bearbeiten der
Metadaten** erlaubt (Titel, Datum, Korrespondent, Dokumenttyp, Tags, Archiv-Nr., Custom Fields)
und **neue Dokumente hochladen** kann.

**Dokument hochladen (geführter Assistent):** „＋ Dokument hochladen" öffnet einen
**Vollbild-Assistenten** in zwei Schritten:
1. **Quelle** – eine **Datei per Drag & Drop** oder Auswahl (PDF/Bild, auf dem Handy auch
   direkt aus der Kamera) **oder** ein **Scan** vom Netzwerkscanner. Gescannte Seiten werden
   **erst als Vorschau gezeigt** und können verworfen/neu gescannt werden, bevor etwas
   gespeichert wird. Bei einer lokalen Datei erscheint sofort eine **Vorschau im Browser**.
2. **Eigenschaften** – Titel (aus dem Dateinamen vorbelegt), Korrespondent, Dokumenttyp, Tags
   **und Custom Fields**; neue Korrespondenten/Typen/Tags lassen sich direkt anlegen.
   „Hochladen" lädt Datei bzw. Scan-PDF **mit** den Metadaten hoch. Mehrseitige Scans werden
   serverseitig zu **einem PDF** gebündelt (Dependency `pdf-lib`).

Paperless verarbeitet den Upload asynchron (OCR); die App **wartet** über die Paperless-Task,
**setzt danach die Custom Fields** (die beim Upload selbst noch nicht möglich sind) und meldet
die Fertigstellung. Wird aus einem **Vertrag** heraus hochgeladen (Modul „Verträge und Pacht"),
verknüpft die App das fertige Dokument **automatisch** mit dem Vertrag.

Der Scan läuft serverseitig in drei Schritten (`POST …/scan` → Seiten im Zwischenspeicher,
`GET …/scan/:id/page/:idx` für die Vorschau, `POST …/scan/:id/commit` bündelt + lädt hoch;
verwaiste Scans werden nach 1 h aufgeräumt).

**Custom Fields:** Im Detailbereich lassen sich die **Zusatzfelder** eines Dokuments nicht
nur ändern, sondern auch **neu zuweisen** (Auswahl aus den in Paperless definierten Feldern)
und wieder **entfernen**. Der Eingabetyp richtet sich nach der Felddefinition (Text/Zahl/Datum/
Ja-Nein). Die Felddefinitionen selbst werden weiterhin in Paperless angelegt.

**Notizen:** Zu jedem Dokument können **Notizen** angezeigt, **hinzugefügt** und **gelöscht**
werden (Paperless-Notes-API `…/documents/{id}/notes/`). Der Notiz-Bereich speichert unabhängig
vom „Speichern"-Button der Metadaten.

**Übersicht als Kachel-Galerie:** Die Dokumente werden als **Kachel-Galerie** mit
**Vorschaubildern** (Thumbnail + Titel + Korrespondent + Datum + farbige Tags) über die volle
Breite dargestellt – kein horizontales Scrollen mehr. Per Umschalter lässt sich zwischen
**Kacheln** und einer kompakten **Liste** wechseln (die Wahl wird gemerkt). Über der Galerie gibt es
eine **Sortierung** (Neueste / Älteste / Titel A–Z / Zuletzt hinzugefügt) und einen **„Mehr
laden"**-Knopf. Ein Klick auf ein Dokument öffnet die Detailansicht als **großes Overlay** über
der Galerie.

**Gespeicherte Ansichten (voreingestellte Filter):** Filter (Suche, Korrespondent, Typ, Tags,
Datum) und Sortierung lassen sich als **benannte Ansicht** speichern und erscheinen oben als
**Reiter/Chips** („Alle" ist immer vorhanden). Eine aktive Ansicht kann **aktualisiert**,
**umbenannt** und **gelöscht** werden. Die Ansichten werden **serverseitig** in den Einstellungen
(`docViews`) gehalten – sie sind damit auf allen Geräten gleich und im Backup enthalten.

**Detailansicht & Bedienung:** Das Detail-Overlay ist in **Reiter** gegliedert –
**Vorschau · Eigenschaften · Notizen** – statt einer langen Scroll-Spalte. Die Vorschau bekommt
den vollen Platz und lässt sich per **Vollbild** öffnen. Auf **Mobilgeräten** erscheinen Galerie
und Overlay **randlos/vollflächig**. Der Upload-Assistent wird auf schmalen Displays ebenfalls
vollflächig dargestellt.

**Architektur:** Das Frontend spricht ausschließlich das eigene Node-Backend an
(`/api/dokumente/...`). Das Backend (`backend/paperless.js` + `backend/routes/dokumente.js`)
proxyt zu Paperless und hält den **API-Token serverseitig** — der Token landet nie im Browser,
CORS muss in Paperless **nicht** geöffnet werden.

**Konfiguration – zwei Wege:**

1. **In der App (empfohlen, einfachster Weg):** **Einstellungen → Dokumente (Paperless-ngx)** →
   URL + API-Token eintragen, **Speichern**, **Verbindung testen**. Die Werte werden
   **serverseitig** in der Datenbank des Containers gehalten (Key `paperless` in der
   `settings`-Tabelle) und **nur vom Backend** verwendet — der Token wird nie im Snapshot
   ausgegeben, nicht nach NocoDB gesynct und beim Laden der Einstellungen **nicht** an den
   Browser zurückgegeben (das Feld zeigt nur „gesetzt"). Leeres Token-Feld beim Speichern
   lässt den bestehenden Token unverändert. Diese App-Konfiguration **überschreibt** die Env-Werte.
   > Hinweis: Der Token liegt damit im Browser-Formular zum Eintippen und serverseitig im
   > Klartext in der DB — bewusst gewählt für den Einsatz in einem **isolierten, privaten
   > Heimnetz mit einem einzigen Nutzer**. In einem Mehrbenutzer-/offenen Netz stattdessen den Env-Weg nutzen.

2. **Über Env-Variablen (Fallback / für automatisiertes Deployment):**

| Variable          | Bedeutung                                                        |
|-------------------|------------------------------------------------------------------|
| `PAPERLESS_URL`   | Basis-URL der Paperless-Instanz, vom Container erreichbar, z. B. `http://192.168.1.20:8000` |
| `PAPERLESS_TOKEN` | API-Token (Paperless: **Mein Profil → API-Token**)              |

Im LXC kommen die Env-Werte aus `/etc/gemeindeverwaltung.env` (root-only, `chmod 600`), die von
der systemd-Unit via `EnvironmentFile=-/etc/gemeindeverwaltung.env` geladen wird:

```bash
cat >/etc/gemeindeverwaltung.env <<'EOF'
PAPERLESS_URL=http://192.168.1.20:8000
PAPERLESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EOF
chmod 600 /etc/gemeindeverwaltung.env
systemctl restart gemeindeverwaltung-backend   # bzw. der konfigurierte Service-Name
```

Verbindungstest: `GET /api/dokumente/health` → `{ "ok": true, ... }`.

**Lokal testen:**

```bash
cd backend && npm install
PAPERLESS_URL=http://<nas>:8000 PAPERLESS_TOKEN=<token> npm start &
cd ../app && python3 -m http.server 8080
# Backend-Proxy nachbilden oder über das nginx-Setup laufen lassen.
```

> **Noch nicht enthalten (Folge-Iterationen):** SMB-Direktzugriff, Dokument-Löschen,
> Massenbearbeitung, gespeicherte Ansichten und eine gemeinsame Benutzeranmeldung.
>
> **Migration:** Das Backend braucht die zusätzliche npm-Dependency `pdf-lib` (für mehrseitige
> Scans → ein PDF); der Deploy zieht sie per `npm install`. Frontend nach dem Update mit **Strg+F5**
> neu laden.

## Modul „Vermietung" (Gemeindehaus & Jugendraum)

Verwaltung der Saalvermietungen über den gesamten Ablauf hinweg. Erreichbar über
den Navigationspunkt **Vermietung**.

**Ablauf (drei Status):**
1. **geplant** – Termin, Objekt, Anlass und Mieter erfassen. Mieter werden dauerhaft
   gespeichert (unter **Stammdaten**, Rolle *Mieter*) und stehen bei jeder weiteren Vermietung per
   Suche zur Auswahl. Anwohner/Ortsfremd wird pro Mieter hinterlegt und je
   Vermietung überschrieben.
2. **Vertrag** – Zähler-Anfangsstände (Strom kWh, Gas cbm) erfassen. Beim Erstellen
   des Vertrags werden die aktuellen Preise **eingefroren** (`preisSnapshot`), damit
   spätere Preisänderungen alte Verträge nicht verändern. → **Mietvertrag als PDF**.
3. **abgerechnet** – Zähler-Endstände + optionale Zusatzposten (z. B. Reinigung).
   → **Kostenabrechnungsbogen als PDF** (Layout der VG-Kelberg-Vorlage) für den
   Versand an die Verbandsgemeindeverwaltung.

**Zählerstand-Fotos (Beweisführung):** Zu jedem der vier Zählerstände (Strom
Anfang/Ende, Gas Anfang/Ende) kann ein Foto hinterlegt werden – über zwei Buttons
**📷 Kamera** (öffnet am Handy direkt die Kamera) oder **🖼 Galerie** (wählt ein
vorhandenes Bild); dieselbe Wahl gibt es bei den Beanstandungsfotos im Protokoll.
Die Fotos dienen als interner Nachweis, sie
werden im Container gespeichert (Tabelle `vermietung_files` + Datei unter
`/var/lib/gemeindeverwaltung/attachments/vermietung/<vermietungId>/`) und
erscheinen **nicht** im PDF. Wie die Beleg-Scans werden sie **nicht** nach NocoDB
gesichert, sind aber vom Container-Backup erfasst.

**Bürgermeister-Unterschrift:** Das unter *Einstellungen → Bargeldauslagen*
hinterlegte Unterschriftsbild wird automatisch über die Bürgermeister-Linie in
**Mietvertrag** und **Kostenabrechnungsbogen** gesetzt. Unter den
Unterschriftslinien steht jeweils der Name: Bürgermeister (aus den
Vermietungs-Absenderdaten) bzw. der Mietername.

**Mieter-Unterschrift direkt am Gerät:** Der Mieter kann **Mietvertrag** und
**Übergabe-/Abnahmeprotokoll** direkt am Handy/Tablet mit **Finger oder Stift**
unterschreiben – ein Ausdruck ist nicht nötig. Der Button „✍ Mieter unterschreibt"
öffnet ein **Vollbild-Unterschriftenfeld**; die Unterschrift wird als transparentes
Bild **im Datensatz gespeichert** (läuft im Backup/NocoDB-Sync mit) und im PDF über
die Mieter-Linie samt „unterschrieben am …" gelegt. Eine bereits geleistete
Unterschrift lässt sich per Knopf **von einem anderen Dokument übernehmen** (z. B.
die Übergabe-Unterschrift in den Vertrag). Die Kostenabrechnung bleibt bewusst
ausgenommen. Die Gemeinde-/Bürgermeister-Unterschrift bleibt das
Einstellungsbild.

**Kostenfreie Nutzung (ortsansässige Vereine):** In den Eckdaten lässt sich eine
Vermietung als **kostenfrei** markieren. Dann entfallen **Mietvertrag** und
**Kostenabrechnung** (Abschnitte 2 und 3) samt Fortschritts-Stepper und
Preisangaben; in Detail und Übersicht erscheint stattdessen ein Tag „kostenfrei".
Das **Übergabe-/Abnahmeprotokoll** bleibt uneingeschränkt möglich. Die
Zählerstände können bei Bedarf weiterhin **rein zur Dokumentation** über eine
schlanke Zusatzkarte erfasst werden (ohne Abrechnung, ohne PDF).

**Preise** (Menü *Einstellungen → Vermietung – Preise*): je Objekt gestaffelte
Grundmiete (1. Tag / jeder weitere Tag, getrennt für Anwohner und Ortsfremde) sowie
Strompreis (€/kWh) und Gaspreis (€/cbm). Absender-/Vertragsdaten für die PDFs
(Ortsgemeinde, Bürgermeister, Anschrift, Satzungsdatum, VG-Empfänger) ebenfalls dort.

**Datenhaltung:** wie beim Sitzungsmodul – primär in der Container-SQLite
(Tabellen `mieter`, `raeume`, `vermietungen`), zusätzlich Auto-Sync nach NocoDB
(Tabellen `Mieter`, `Raeume`, `Vermietungen`, jeweils mit vollständigem `Payload`
zur Rekonstruktion). Die Tabellen werden beim Backend-Start automatisch angelegt;
die zwei Standard-Objekte *Gemeindehaus* und *Jugendraum* werden einmalig
mit Startpreisen aus den Vorlagen geseedet. NocoDB-Zieltabellen legt „Schema
initialisieren" in den Einstellungen an.

> **Migration:** Bestehende Installationen brauchen kein manuelles Update der
> Datenbank – die neuen Tabellen werden per `CREATE TABLE IF NOT EXISTS` beim Start
> ergänzt. Frontend nach dem Update mit **Strg+F5** neu laden.

## Modul „Haushalt"

Zentrale Verwaltung der **Haushaltsstellen** (`#/haushalt`) und die Übersicht, was von jedem
Budget noch übrig ist. Die Haushaltsstellen sind eine **geteilte Liste**: Bargeldauslagen,
Vorgänge und Arbeitszeiten buchen alle auf dieselben Stellen – keine Doppelpflege.

- **Tabelle je Haushaltsstelle** für ein wählbares **Haushaltsjahr**: Nummer, Bezeichnung,
  Budget, Verbrauch und **Restmittel** (rot bei Überschreitung), dazu eine Summenzeile. Die
  Jahresauswahl bietet alle Jahre an, die in Auslagen, Vorgängen oder Abrechnungen vorkommen.
- **Verbrauch** = eingereichte + erstattete **Bargeldauslagen** + alle Kosten aus **Vorgängen**
  + abgerechnete und ausgezahlte **Arbeitszeiten**. Offene Auslagen-Entwürfe und reine
  Zeiterfassungen zählen bewusst noch nicht. Der Tooltip der Spalte schlüsselt auf, welcher
  Anteil woher kommt.
- **Anlegen/Bearbeiten/Löschen** direkt hier (die Empfänger sind in die
  **Stammdaten** umgezogen, Rolle *Auslagen-Empfänger*).

## Modul „Vorgänge & Projekte"

Vorgangsverfolgung und -dokumentation (`#/vorgaenge`): von der Beschaffung bis zum Bauprojekt.
Übersicht als Kacheln (abgeschlossene eingeklappt), Detailseite mit Eckdaten, Budget und
Zeitleiste. Kategorien sind unter *Einstellungen → Vorgänge & Projekte* pflegbar.

- **Zeitleiste (Historie)** mit getippten Einträgen je Datum, absteigend sortiert:
  **Notiz** (Markdown mit Live-Vorschau), **ToDo**, **Foto**, **Dokument**, **Referenz** auf
  einen anderen Vorgang, **Kosten**, **Angebot** und **Auswahl** (Entscheidungsmatrix). Beim
  Ändern des Datums sortiert sich der Eintrag automatisch ein.
- **Die Zeitleiste ist eine Leseansicht.** Jeder Eintrag erscheint als kompakte Karte mit
  Kurzfassung; **ein Klick auf die Karte öffnet das Bearbeiten-Overlay** (Datum, Vertraulich,
  Inhalt, Löschen). Zwei Dinge bleiben bewusst direkt in der Liste, weil sie täglich gebraucht
  werden: **ToDo abhaken** und **ein Foto groß ansehen**. Neue Einträge entstehen über den einen
  Knopf **+ Eintrag**; der Typ wird im Overlay gewählt. Wird ein neu angelegter Eintrag ohne
  jede Eingabe geschlossen, verwirft ihn die App wieder – so bleiben keine leeren Karten übrig.
- **Angebote & Entscheidungsmatrix:** Ein **Angebot** hat Anbieter, Angebotspreis, Beschreibung
  und einen verknüpften **Paperless**-Beleg. Über **⚖ Auswahl** startet ein geführter Assistent:
  Schritt 1 die zu vergleichenden Angebote anhaken, Schritt 2 die Vergleichs­eigenschaften mit
  optionalem **Gewicht** (Nutzwertanalyse) festlegen. Die Punkte (0 = *trifft nicht zu* … 5 =
  *trifft voll zu*) werden anschließend **Anbieter für Anbieter** in einem eigenen Overlay
  vergeben. Die gewichtete Summe ergibt eine **Empfehlung** (höchste Punktzahl); der finale
  Anbieter wird aber **manuell gewählt** und **begründet**. Ist die Auswahl abgeschlossen, lässt
  sich die Matrix als **eigenes PDF** exportieren (Download oder direkt nach Paperless). Alle
  vorliegenden Angebote erscheinen zusätzlich unter *Budget / Kostenstellen*, das gewählte mit ✓.
- **ToDos** werden im app-weit gewählten **Vikunja**-Projekt angelegt (*Einstellungen →
  Aufgaben*); Erledigt-Status, Titel, Fälligkeit und Priorität werden von dort
  zurückgespiegelt. Abhaken geht direkt am Eintrag.
- **Fotos** hängen als echte Dateien am Eintrag (Tabelle `vorgang_files`, Ablage unter
  `attachments/vorgaenge/<id>/`), wahlweise über **📷 Kamera** oder **🖼 Galerie**; sie werden
  vor dem Upload auf 1600 px verkleinert und erscheinen im PDF.
- **Budget/Kostenstellen:** einem Vorgang lassen sich **mehrere Haushaltsstellen** zuweisen,
  jeder Kosten-Eintrag bucht auf genau eine davon. Die Tabelle zeigt je Stelle den eigenen
  Anteil, das Budget, den Gesamtverbrauch und die Restmittel. Dazu ein **Planbetrag mit
  Zieljahr** für künftige Haushalte – gesammelt unter *📊 Haushaltsplanung*
  (`#/vorgaenge?view=planung`), nach Zieljahr gruppiert.
- **Vertraulichkeit:** ganze Vorgänge oder einzelne Einträge lassen sich als *vertraulich*
  markieren; sie sind nur in der **Leitungs-Ansicht** sichtbar. Umschalter oben rechts,
  optional per **PIN** geschützt (*Einstellungen → Vorgänge & Projekte*; SHA-256-Hash, Rolle in
  der Browser-Session). **Wichtig:** Das ist eine Sichtfilterung als Vorstufe zu einer echten
  Nutzerverwaltung – **kein Zugriffsschutz**. Die Daten liegen unverändert im Snapshot und im
  Backup.
- **Ablauf-PDF:** die vollständige Dokumentation eines Vorgangs (Kopf, Beschreibung,
  Budget/Restmittel, chronologischer Verlauf inkl. Fotos) als Download oder direkt **in
  Paperless** – dort abgelegt, erscheint sie als Dokument-Eintrag in der eigenen Zeitleiste.
  In der Rat-Ansicht bleiben vertrauliche Einträge draußen (mit Hinweis auf die Anzahl).
- **Dashboard:** Karte *Laufende Vorgänge*; **NocoDB:** Tabelle `Vorgaenge` wird mitgesichert.

## Modul „Bargeldauslagen"

Digitalisiert die Rückzahlung privat vorgelegter Gelder. Erreichbar über den
Navigationspunkt **Bargeldauslagen**.

**Ablauf je Auslage:**
1. **Eckdaten** – Haushaltsjahr, Haushaltsstelle (mit Budgetüberwachung),
   Empfänger (Name, Vorname, IBAN – wiederverwendbar), Verwendungszweck, Datum,
   Status (`offen` → `eingereicht` → `erstattet`).
2. **Belege** – beliebig viele Einzelbelege, je mit Nummer, Betrag, Beschreibung,
   Belegdatum und Händler. Belege werden **gescannt** (Netzwerkscanner) oder als
   Datei **hochgeladen**. Die Summe aller Belege ergibt den Gesamtbetrag, der als
   „Zu Zahlen sind" ins Formular übernommen wird.
3. **Gesamt-PDF** – das ausgefüllte Bar-Auslage-Formular (Vorlage
   Hörschhausen) plus die Bild-Scans als Folgeseiten, als ein PDF zum
   Herunterladen und manuellen E-Mail-Versand.

Die **Empfänger** stehen unter **Stammdaten** (Rolle *Auslagen-Empfänger*), die
**Haushaltsstellen** im Modul *Haushalt*. Beides wird dauerhaft gespeichert und –
wie alle Module – zusätzlich nach NocoDB gesichert (Tabellen `Empfaenger`,
`Haushaltsstellen`, `Auslagen`, jeweils mit vollständigem `Payload`). Neue
Zieltabellen legt „Schema initialisieren" in den Einstellungen an.

**Netzwerkscanner (eSCL/AirScan **und** SANE/WSD):** In den Einstellungen unter
*Bargeldauslagen* den Scanner **automatisch im Netzwerk suchen** und als Standard
übernehmen, oder die Kennung manuell eintragen. Der Scan läuft serverseitig über das
Backend (`backend/routes/scan.js`), der Browser spricht den Scanner nicht direkt an.
Fällt der Scanner aus, funktioniert der manuelle Datei-Upload weiterhin.

Es werden **zwei Wege** unterstützt (ein einziges Feld `scannerUrl`, per Präfix
unterschieden):

- **eSCL/AirScan** – direkt aus dem Backend per HTTP an `…/eSCL`, Discovery über
  mDNS (`_uscan._tcp`/`_uscans._tcp`). URL z. B. `http://192.168.1.30`. Voraussetzung:
  Scanner vom Container erreichbar, Multicast/mDNS auf der Bridge erlaubt. (So wird
  z. B. der Brother gefunden.)
- **SANE (`scanimage`)** – für Scanner, die **kein** eSCL anbieten, sondern nur
  **WSD** (z. B. **Epson ES-580W**). Das Backend (`backend/sane.js`) ruft `scanimage`
  auf; `sane-airscan` wählt automatisch eSCL oder WSD. Solche Geräte erscheinen in der
  Suche mit „(SANE)" und tragen intern die Kennung `sane:<device>` (z. B.
  `sane:airscan:w1:EPSON ES-580W`); die Geräteliste liefert `scanimage -L`.
  Die Pakete `sane-utils` + `sane-airscan` installieren `container-setup.sh` und –
  idempotent, falls `scanimage` fehlt – auch `sitzungsapp-update` automatisch. Ist
  `scanimage` nicht vorhanden, bleibt nur der eSCL-Weg (ohne Fehler).

**Bürgermeister-Unterschrift:** Ein in den Einstellungen hochgeladenes Bild (PNG
mit Transparenz empfohlen) wird automatisch über die Bürgermeister-Linie gesetzt;
die übrigen Unterschriftsfelder bleiben leer.

> **Grenze v1:** Nur **Bild**-Scans (JPEG/PNG) werden ins Gesamt-PDF eingebettet.
> Ein als **PDF** hochgeladener Beleg wird gespeichert, aber nicht in das
> Gesamt-PDF gemergt (dann als Bild scannen oder separat anhängen).
>
> **Migration:** Neue Tabellen entstehen per `CREATE TABLE IF NOT EXISTS` beim
> Backend-Start; das Backend braucht die zusätzliche npm-Dependency
> `bonjour-service` (Deploy zieht sie per `npm install`). Frontend nach dem Update
> mit **Strg+F5** neu laden.

## Modul „Arbeitszeiten & Vergütung"

Erfasst Arbeitsleistungen für die Gemeinde – von **Gemeindearbeitern** ebenso wie von
**beauftragten Firmen** – und rechnet sie je Person/Firma und Zeitraum ab. Drei Ansichten:
`#/arbeitszeiten` (Erfassung), `#/stammdaten?rolle=arbeiter` (Personen), `#/arbeitsabrechnungen`.

- **Leistungserbringer** sind **ein** Stammdatentyp (kein Person/Firma-Umschalter): immer
  Vor-/Nachname, dazu ein **optionales Feld „Firma"**. Ist es gesetzt, erscheint die Firma als
  Name und die Person als *Ansprechpartner*. Weitere Felder (Anschrift, IBAN, SV-Nummer,
  Steuer-ID, …) sind optional. Wer bereits Zeiten erfasst hat, lässt sich nicht löschen –
  stattdessen den Haken **Aktiv** entfernen (bleibt in alten Abrechnungen erhalten).
- **Stundensatz** gilt **einheitlich für alle**, aber mit **Historie**: Sätze werden mit
  „gültig ab" gepflegt (*Einstellungen → Arbeitszeiten*). Maßgeblich ist der Satz, der am
  **Leistungsdatum** gültig war – ältere Einträge ändern sich also nicht, wenn der Satz später
  steigt. Am einzelnen Eintrag lässt sich ein **abweichender Satz** setzen (z. B. Firmen mit
  eigener Rechnung).
- **Status je Eintrag:** `erfasst` → `abgerechnet` → `ausgezahlt`. Nur „erfasst" ist
  editier-/löschbar; danach ist der Eintrag gesperrt (🔒), Korrektur nur über **Storno**.
- **Abrechnung = genau ein Monat.** Für jeden Monat wird ein eigener Vordruck ausgefüllt.
  Unter *Neue Abrechnung* stehen **alle offenen Einträge der Person, nach Monat gruppiert, mit
  Checkboxen** – standardmäßig alles angehakt. Abwählen lässt Einträge offen; die Kopfzeile
  jeder Monatsgruppe hakt den ganzen Monat an oder ab. Reicht die Auswahl über mehrere Monate,
  legt *Erstellen* nach einer Rückfrage **je Monat eine eigene Abrechnung** an. *Erstellen*
  **friert die Sätze ein** (Snapshot je Position); spätere Satzänderungen wirken sich auf
  fertige Abrechnungen **nicht** mehr aus. *Storno* setzt die Einträge auf „erfasst" zurück und
  löscht die Abrechnung; *Als ausgezahlt markieren* setzt Abrechnung + Einträge auf
  `ausgezahlt`.
- **Kostenerstattungen gehören zu genau einem Monat.** Umfasst die Auswahl mehrere Monate, ist
  *Erstellen* gesperrt, solange Kostenerstattungen erfasst sind – sonst wäre unklar, auf
  welchem Vordruck sie stehen.
- **Sonstige Kostenerstattungen** (z. B. Maschineneinsatz) sind Beträge **ohne** Arbeitsstunden.
  Sie stehen im Vordruck unter dem Arbeitslohn und laufen deshalb **nicht** in die Summe
  „Arbeitslohn insgesamt", belasten den **Haushalt aber genauso**. Eine Abrechnung darf auch
  **nur** aus Kostenerstattungen bestehen (reine Maschinenrechnung, Arbeitslohn 0 €) – dann
  erscheint ein Feld *Abrechnungsmonat*, weil sich der Zeitraum nicht aus Einträgen ableiten lässt.
- **Haushalt:** Abrechnungen mindern ab Status **abgerechnet** die Restmittel ihrer
  Haushaltsstelle – im Modul *Haushalt* und in der Budget-Tabelle der *Vorgänge* fließen sie
  in denselben Topf wie Auslagen und Vorgangskosten (Spalte „Verbrauch", Tooltip schlüsselt
  auf). Die Haushaltsstellen sind **dieselbe geteilte Liste** wie bei den Bargeldauslagen.
- **PDF – *VG-Formular*** ist der maßgetreue Nachbau des Papiervordrucks „Lohnabrechnung" der
  Verbandsgemeinde (A4, Times New Roman 11 pt, kein Wappen; alle Maße aus dem Original
  übernommen). Befüllt werden: Ortsgemeinde, Abrechnungszeitraum, Anschrift, Bankverbindung
  (IBAN; Kontoinhaber nur wenn abweichend), die Tabelle *durchgeführte Arbeiten* (Tätigkeiten
  **nach Bezeichnung zusammengefasst**, Stunden addiert), die Wochentabelle (Stunden je
  Wochentag aus dem Leistungsdatum), Arbeitslohn, Kostenerstattungen, Ort/Datum und die
  Unterschrift des Ortsbürgermeisters (Bild, sofern hinterlegt – sonst leere Linie).
  In die Wochentabelle kommen **nur Wochen, in denen gearbeitet wurde** – arbeitsfreie Wochen
  werden übersprungen. Weil die Zeilen echte Kalenderwochen sind, kann die erste Zeile in den
  Vormonat hineinreichen (Juli 2026 beginnt z. B. mit der Woche 29.06.–05.07.).
  Stecken in einer Woche **verschiedene Stundensätze**, wird die Woche auf zwei Zeilen
  gesplittet – der Vordruck hat je Zeile nur ein „Entgelt pro Stunde". Passt der Inhalt nicht
  auf ein Blatt – mehr als **vier** Tätigkeiten oder mehr als **fünf** Wochenzeilen (ein Monat
  berührt je nach Lage 5 oder 6 Kalenderwochen) – wird ein **zweites Blatt** im selben Layout
  gedruckt („Blatt 1 von 2"); Summe, Kostenerstattungen und Unterschrift stehen nur auf dem
  letzten Blatt.
- **PDF – *Interne PDF*** bleibt daneben bestehen: eine formlose Abrechnung mit
  Positionstabelle je Datum (Leistungserbringer + Bankdaten, Summen, Haushaltsstelle,
  Unterschriftslinien). Beide Ausgaben gibt es als Download oder direkt **in Paperless**.
- **NocoDB:** Alle drei Tabellen (`Arbeiter`, `Arbeitszeiten`, `Arbeitsabrechnungen`) werden
  vom Auto-Sync mitgesichert und beim ersten Sync automatisch angelegt. Sie enthalten
  bewusst **auch IBAN/SV-Nummer/Steuer-ID** – NocoDB ist nur über VPN im privaten Netz
  erreichbar.

> **Migration:** Die drei SQLite-Tabellen legt das Backend beim Start selbst an
> (`CREATE TABLE IF NOT EXISTS`). Frontend nach dem Update mit **Strg+F5** neu laden.

## Modul „Verträge und Pacht"

Überblick über die laufenden Verträge und Pachtverhältnisse der Gemeinde: Kosten
und Einnahmen sowie – im Fokus – die **Kündigungs- und Verlängerungsfristen**.
Erreichbar über den Navigationspunkt **Verträge & Pacht**.

**Startbildschirm/Übersicht** (`#/vertraege`):
- **Fristen-Block** mit Ampel: aktive Verträge, deren spätester Kündigungstermin
  ansteht (überfällig / akut = innerhalb des vertraglichen Vorlaufs / bald =
  ≤ 90 Tage), sortiert nach Termin. Je Eintrag ein `.ics`-Download und Sprung ins Detail.
- **Kennzahlen**: jährliche Kosten (Ausgaben) und jährliche Einnahmen aktiver Verträge.
- **Vollständige Tabelle** aller Verträge, „**+ Neuer Vertrag**" und „**Übersicht als PDF**".

**Vertrag** (Detail): Bezeichnung, Kategorie (aus den Einstellungen), **Art**
(Ausgabe/Einnahme), Vertragspartner, **Betrag + Intervall** (einmalig / monatlich /
quartalsweise / jährlich – die App rechnet Jahresbeträge), Beginn, Laufzeit
(befristet mit festem Ende *oder* automatische Verlängerung), Vertragsende bzw.
nächster Verlängerungsstichtag, **Kündigungsfrist** (Monate) → daraus wird der
**spätester Kündigungstermin** live berechnet, **Erinnerungsvorlauf** (Tage, pro
Vertrag frei), Status (aktiv/gekündigt/ausgelaufen) und Notiz.

**Vertragspartner** (`#/stammdaten?rolle=partner`): wiederverwendbare Stammdaten
(Name/Firma, Ansprechpartner, Kontakt, Anschrift), die bei jedem Vertrag zur
Auswahl stehen — seit der Zusammenführung Teil der zentralen Personenliste.

**Paperless-Verknüpfung:** Zu jedem Vertrag können **mehrere** Dokumente aus
**Paperless-ngx** verknüpft werden – entweder ein **bestehendes** Dokument über den
Dokument-Picker (Volltextsuche) oder ein **neu hochgeladenes** über „＋ Dokument
hochladen" (Datei/Scan; die App verknüpft es nach der Paperless-Verarbeitung
**automatisch**). Gespeichert werden nur Paperless-ID + Titel; die Vorschau läuft über
den Backend-Proxy.

**Erinnerungen:** Bewusst **ohne** Google-/E-Mail-Anbindung. Fristen erscheinen im
Startbildschirm; zusätzlich lässt sich je Vertrag eine **`.ics`-Kalenderdatei** (mit
Alarm um den Vorlauf vor dem Kündigungstermin) herunterladen und in den eigenen
Kalender importieren.

**Datenhaltung:** wie die anderen Module – Container-SQLite (Tabellen
`vertragspartner`, `vertraege`), Live-Sync per WebSocket und Auto-Sync nach NocoDB
(Tabellen `Vertragspartner`, `Vertraege`, jeweils mit vollständigem `Payload`).
Zieltabellen legt „Schema initialisieren" in den Einstellungen an.

**Einstellungen** (*Einstellungen → Verträge und Pacht*): Standard-Erinnerungsvorlauf,
Standard-Kündigungsfrist und die editierbare Kategorienliste.

> **Migration:** Neue Tabellen entstehen per `CREATE TABLE IF NOT EXISTS` beim
> Backend-Start; neue Settings-Defaults werden für Bestandsinstallationen nachgezogen.
> Frontend nach dem Update mit **Strg+F5** neu laden.

## Modul „Inventar" (Homebox)

Das Gemeindeinventar — Rasenmäher, Feuerlöscher, Werkzeug, Verbrauchsmaterial —
wird in **Homebox** geführt. Die App legt **keine eigene Kopie** an, sondern
arbeitet über einen Backend-Proxy direkt darauf (Muster wie Paperless und
Vikunja: Zugangsdaten serverseitig unter eigenem DB-Key `homebox`, nie im
Snapshot oder NocoDB-Sync). Fällt Homebox aus, ist nur dieses Modul betroffen.

Einrichtung unter **Einstellungen → Inventar (Homebox)**: URL, Benutzer,
Passwort. Homebox kennt **keine dauerhaften API-Tokens**, nur
`POST /v1/users/login` mit kurzlebigem Token — deshalb Benutzername und
Passwort statt eines Tokens; der Proxy meldet sich bei Ablauf (401) selbst neu
an. Das Passwort wird nie an den Browser zurückgegeben.

**Sammlungen.** Ein Homebox-Konto kann mehrere vollständig getrennte Bestände
haben. Welcher gemeint ist, entscheidet ein Auswahlfeld in den Einstellungen
(Header `X-Tenant`). Die Liste wird bewusst **ohne** die gespeicherte Sammlung
abgefragt — sonst sperrte eine ungültige Auswahl den Weg, sie zu korrigieren.
Eine gespeicherte, nicht mehr zugängliche Sammlung bleibt sichtbar stehen,
statt still auf die Standard-Sammlung zu fallen; sonst arbeitete die App
unbemerkt im falschen Bestand.

**Die Ansicht** (`#/inventar`): Kachelliste mit Suche und Lagerort-Auswahl,
Detailfenster mit Bestandsbuchung (± Stückzahl), Anlegen, Bearbeiten und
**Löschen** (entfernt den Gegenstand auch aus Homebox). Etiketten/Tags sind zum
Anhaken; Lagerorte kommen als Auswahlliste aus Homebox.

**Barcode.** Der Code steht in einem benutzerdefinierten Feld `Barcode` — nicht
in der Asset-ID, die vergibt Homebox selbst. Gescannt wird mit der Handykamera
(nativer `BarcodeDetector`, sonst vendored ZXing für iOS/Safari); Eintippen ist
immer erreichbar. Ein unbekannter Code führt zum Anlegen **oder** lässt sich
einem vorhandenen Gegenstand zuordnen — ohne diesen zweiten Weg legt man ihn
ein zweites Mal an und führt den Bestand doppelt.

### Wartungen

Wartungspflichtige Gegenstände (Feuerlöscher, Leitern, Rasenmäher) bekommen im
Detailfenster Wartungstermine. **Die Wartungen liegen in Homebox** — es hat
dafür eine eigene Funktion, geprüft am Quelltext
(`/v1/entities/{id}/maintenance`). Damit sind sie auch in Homebox selbst
sichtbar, und es gibt keine zwei Wahrheiten über denselben Gegenstand.

Was Homebox **nicht** kann, führt die Gemeindeverwaltung lokal (Tabelle
`inventar_wartungen`, id = id der Homebox-Wartung):

- **Wiederholung.** Homebox kennt kein „alle 24 Monate". Am Termin steht darum
  ein Intervall in Monaten; ist die Wartung erledigt, entsteht der nächste
  Termin automatisch (Erledigungsdatum + Intervall). So reißt die Kette nie ab.
- **Vorlauffrist.** Standard in den Einstellungen, je Wartung überschreibbar.
- **Verknüpfung zur Aufgabe.** Verhindert, dass täglich dieselbe Aufgabe neu
  entsteht.

**Der tägliche Lauf** (`backend/wartungslauf.js`) läuft im Backend, nicht im
Browser — eine Frist läuft weiter, auch wenn wochenlang niemand die App öffnet.
Einmal täglich (und einmal kurz nach dem Start des Containers):

1. Jede offene Wartung, die in die Vorlauffrist rutscht, bekommt eine Aufgabe im
   Aufgabenmodul — in dem Projekt, das unter „Aufgaben" als synchronisiertes
   Projekt eingestellt ist. Ohne ein solches Projekt kann nichts angelegt werden.
2. Ist die **Aufgabe** abgehakt, gilt die Wartung als erledigt und wird in
   Homebox gebucht.
3. Ist die **Wartung** erledigt (in der App oder direkt in Homebox), schließt
   sich die Aufgabe, und mit Intervall entsteht der Folgetermin.

Beide Richtungen also — egal wo gearbeitet wird, es stimmt überall. Von Hand
anstoßen lässt sich der Lauf unter Einstellungen → Inventar mit „Jetzt prüfen";
er meldet, was er getan hat.

**Fallen, die beim Bauen Zeit gekostet hätten** (alle am Homebox-Quelltext
geprüft, nicht geraten):

- `cost` ist im JSON eine **Zeichenkette** (Go-Tag `,string`). Als Zahl
  geschickt lehnt Homebox den ganzen Datensatz ab.
- Bei `GET /v1/maintenance` ist `status` **Pflicht**; ohne den Parameter
  antwortet Homebox mit „unknown status" statt mit allen Einträgen.
- Ein Eintrag ist **entweder** geplant **oder** erledigt. „Offen" heißt:
  geplantes Datum gesetzt, Erledigungsdatum leer — und leer kommt als **leere
  Zeichenkette**, nicht als `null`.
- Ältere Homebox-Versionen kennen die Wartungspfade nicht. Die App prüft das
  einmal (`wartungenVerfuegbar`) und blendet den Wartungsteil dann mit Hinweis
  aus, statt Fehler zu werfen.
- Wie beim übrigen Homebox-Verkehr gilt die **entities/items-Weiche**: neuere
  Versionen sprechen `/v1/entities`, ältere `/v1/items`. Der Client probiert neu
  zuerst und fällt bei 404 zurück.

> **Für Entwickler:** Löscht man einen Gegenstand, räumt Homebox seine Wartungen
> mit weg — die lokalen Ergänzungen dazu blieben sonst als Waisen liegen und der
> Tageslauf stolperte darüber. Das erledigt
> `db.deleteInventarWartungenZuArtikel()` in der Löschroute.

## Modul „Kalender" (iCal-Abos)

Externe Kalender werden per **Abo-URL (iCal/ICS)** eingebunden – z. B. aus Google Kalender,
Nextcloud oder der Müllabfuhr. Die Kalender werden **serverseitig** geholt und geparst
(`backend/kalender.js`, Route `/api/kalender`), weil externe Kalender im Browser an **CORS**
scheitern und die Abo-URL ein Geheimnis enthalten kann. Der Zugriff ist **nur lesend**.

- **Konfiguration** unter *Einstellungen → Kalender*: beliebig viele Kalender mit Bezeichnung
  und URL; je Eintrag **Testen** (zeigt die Anzahl gefundener Termine) und **Entfernen**.
  Gespeichert wird serverseitig unter dem DB-Key `kalender` (eigener Key, **nicht** im
  Snapshot/NocoDB-Sync). Fallback über die Env-Variable `KALENDER_URLS` (kommagetrennt).
- **Anzeige**: Dashboard-Karte *Anstehende Termine* (nächste 60 Tage) und die vollständige
  Liste unter `#/termine` (nach Tag gruppiert, Zeitraum wählbar).
- **Parser** (`backend/kalender.js`): Zeilen-Unfolding, `VEVENT` mit `SUMMARY`/`LOCATION`/
  `DTSTART`/`DTEND`, Zeitzonen (`Z`=UTC, `TZID`/floating als lokale Wandzeit des Containers),
  **Serientermine** (`RRULE`: `DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY` mit `INTERVAL`/`COUNT`/`UNTIL`/
  `BYDAY`/`BYMONTHDAY`) und `EXDATE`. Serien werden auf ein Zeitfenster expandiert.
  ICS-Antworten werden je URL **5 Minuten** gecacht.

> **Tipp Google Kalender:** *Einstellungen → Kalender → Integration →* „Geheime Adresse im
> iCal-Format". Diese URL enthält ein Token und bleibt deshalb serverseitig.

> **Migration:** Kein neues Schema nötig (nutzt die bestehende `settings`-Tabelle). Frontend
> nach dem Update mit **Strg+F5** neu laden.

## Modul „E-Mail"

Bindet das **Postfach der Gemeinde** (IMAP zum Lesen, SMTP zum Senden) an. Bewusst **kein
Ersatz für das gewohnte Mailprogramm**, sondern die Brücke zwischen Postfach und Vorgangsakte:
Post durchsehen, eine Nachricht einem **Vorgang zuordnen**, aus dem Vorgang heraus antworten.

- **Posteingang** (`#/mail`) zeigt die **INBOX**, 50 Nachrichten je Schritt („Mehr laden"),
  links die Liste und rechts eine **Vorschau**. Jede Listenzeile ist **zweizeilig**: oben der
  Absender, darunter der Betreff, rechts das Datum. Ein **einfacher Klick** zeigt die Nachricht
  in der Vorschau (mit Zuordnen, Antworten und „Großes Fenster"), ein **Doppelklick** – oder
  Enter – öffnet sie im großen Fenster. Auf schmalen Geräten rückt die Vorschau unter die Liste.
- **Sortierung** über die Auswahl neben der Suche: *Neueste zuerst* (Standard), *Älteste
  zuerst*, *Absender A–Z*, *Betreff A–Z*. Sortiert wird im Browser, ohne neu zu laden; die Wahl
  wird gemerkt (`localStorage`). Nachrichten ohne verwertbares Datum landen ans Ende statt
  zufällig dazwischen. Die **Suche** läuft serverseitig über Betreff *und* Absender, findet also
  auch ältere Nachrichten. Ungelesene sind hervorgehoben, Anhänge mit 📎 markiert.
- **Zuordnen** legt im gewählten Vorgang einen Historieneintrag vom Typ **E-Mail** an, mit
  Absender, Datum, Betreff und Text als **Kopie**. Das ist Absicht: wird die Mail im Postfach
  später verschoben oder gelöscht, bleibt die Akte vollständig. Zuordnen geht in **beide
  Richtungen** – aus dem Posteingang heraus oder im Vorgang über *+ Eintrag → E-Mail*.
- **Anhänge** werden beim Zuordnen zum Anhaken angeboten und laufen einzeln durch den
  Paperless-Assistenten (Titel vorbelegt); die abgelegten Dokumente werden am Eintrag
  verknüpft. Bewusst kein Automatismus – sonst landen Signaturbilder und Logos in der Ablage.
- **Gelesen-Kennzeichen:** Sobald eine Nachricht angesehen wurde (Vorschau oder großes
  Fenster), setzt die App im Postfach das `\Seen`-Flag – die Nachricht gilt damit auch im
  gewohnten Mailprogramm als gelesen. Scheitert das Setzen, bleibt es folgenlos.
- **Anhänge per Rechtsklick ablegen:** Ein Rechtsklick auf einen Anhang öffnet ein kleines
  Menü mit *In Paperless speichern* (öffnet den normalen Hochladedialog mit vorbelegtem Titel)
  und *In neuem Tab öffnen*. Linksklick öffnet den Anhang wie gewohnt.
- **Antworten** und **Allen antworten**: Bei *Allen antworten* wandern die übrigen
  An-Empfänger ins An-Feld und die Kopie-Empfänger bleiben in Kopie; die **eigene Adresse
  fällt überall heraus**, Doppelte werden entfernt. Ist ein `Reply-To` gesetzt (Verteiler,
  Ticketsysteme), schlägt es den Absender. Der Knopf erscheint nur, wenn es außer dem Absender
  überhaupt weitere Empfänger gibt.
- **Antworten** aus dem Vorgang heraus: Empfänger, Betreff (`Re: …`) und Zitat sind vorbelegt.
  Die Antwort geht per SMTP raus, wird per `In-Reply-To` korrekt in den Thread eingehängt,
  **zusätzlich in den IMAP-Ordner „Gesendet" gelegt** (sonst fehlte sie im Mailprogramm) und
  als eigener Historieneintrag im Vorgang mitgeführt. Damit steht der ganze Schriftwechsel
  in der Akte – und im **Ablauf-PDF** des Vorgangs.
- **Zugang** unter *Einstellungen → E-Mail*: Server, Benutzer, Passwort, IMAP-/SMTP-Port,
  Absenderadresse, **Absendername** und Name des Ordners „Gesendet". Ohne Absendername sieht
  der Empfänger nur die nackte Adresse – hier gehört z. B. „Ortsgemeinde Hörschhausen" hinein. Alles wird **serverseitig** im Container
  gespeichert (eigener DB-Schlüssel, **nicht** im Snapshot und **nicht** in der
  NocoDB-Sicherung); das Passwort wird nie an den Browser zurückgegeben. Ein leeres
  Passwortfeld lässt das gespeicherte unangetastet. *Verbindung testen* prüft IMAP und SMTP
  getrennt, damit klar wird, welche Seite klemmt.
- Übliche Ports: IMAP **993** (SSL), SMTP **587** (STARTTLS) oder **465** (SSL). Alternativ
  per Env: `MAIL_HOST`, `MAIL_USER`, `MAIL_PASS`, `MAIL_IMAP_PORT`, `MAIL_SMTP_PORT`,
  `MAIL_FROM`, `MAIL_FROM_NAME`, `MAIL_SENT`.

> **Shared-Hosting-Falle (Evanzo):** Als Server gehört der **Servername des Anbieters** hinein
> – bei Hörschhausen `s101.evanzo-server.de` –, **nicht** `mail.hoerschhausen.de` oder
> `imap.hoerschhausen.de`. Beide zeigen auf dieselbe Maschine, aber nur der Anbietername steht
> im TLS-Zertifikat; sonst bricht die Verbindung mit
> `Hostname/IP does not match certificate's altnames` ab, noch vor der Anmeldung. Der richtige
> Name steht in dieser Fehlermeldung selbst, hinter `cert's altnames: DNS:`. Der **Benutzername
> bleibt die vollständige E-Mail-Adresse**.

> **Achtung:** Die App hat **keine Benutzeranmeldung**. Wer sie im Netz erreicht, liest das
> Postfach und kann in dessen Namen senden. Das ist eine bewusste Entscheidung für den Betrieb
> im isolierten privaten Netz – bei einer Öffnung nach außen muss vorher eine Anmeldung her.

> **Migration:** Kein neues Schema nötig (nutzt die bestehende `settings`-Tabelle). Im Container
> `npm install` im `backend/` laufen lassen – neu sind `imapflow`, `nodemailer` und `mailparser`.
> Frontend nach dem Update mit **Strg+F5** neu laden.

## Modul „Aufgaben" (Vikunja)

Aufgaben werden aus einer **Vikunja**-Instanz (Open-Source-Aufgabenverwaltung) über deren
REST-API angebunden. Der Zugriff läuft **serverseitig** (`backend/vikunja.js`, Route
`/api/aufgaben`), damit CORS und der API-Token im Backend bleiben. Authentifizierung per
**Bearer-Token**.

- **Konfiguration** unter *Einstellungen → Aufgaben*: Vikunja-URL (ohne `/api/v1`) und
  API-Token. Gespeichert wird serverseitig unter dem DB-Key `vikunja` (eigener Key, **nicht**
  im Snapshot/NocoDB-Sync); Env-Fallback `VIKUNJA_URL`/`VIKUNJA_TOKEN`. Leeres Token-Feld beim
  Speichern = bestehenden Token behalten. „Verbindung testen" prüft Erreichbarkeit + Token.
- **Token in Vikunja** unter *Einstellungen → API-Tokens* anlegen – mit **Lese- und
  Schreibrecht** für Aufgaben/Projekte, damit Anzeigen, Abhaken und Anlegen funktionieren.
- **Anzeige**: Dashboard-Karte *Offene Aufgaben* (überfällige hervorgehoben) und die
  vollständige Liste unter `#/aufgaben`, nach Zeitbucket gruppiert (Überfällig / Heute /
  Diese Woche / Später / Ohne Datum), fällige zuerst.
- **Interaktion**: Aufgaben direkt **abhaken** (`POST /api/v1/tasks/{id}` mit `done=true`)
  und **neue Aufgaben anlegen** (`PUT /api/v1/projects/{id}/tasks`) mit Titel, Projektwahl,
  optionalem Fälligkeitsdatum und Priorität. Aufgaben werden per Filter `done = false`,
  sortiert nach `due_date`, geladen (durchblättert bis 10 Seiten).

> **Migration:** Kein neues Schema nötig (nutzt die bestehende `settings`-Tabelle). Frontend
> nach dem Update mit **Strg+F5** neu laden.

## Modul „Einwohner"

Einwohnerliste der Ortsgemeinde mit **Altersjubiläen** und **Ehrenurkunde**. Das Modul
unterscheidet sich in zwei Punkten bewusst von allen anderen.

### 1. Eine zweite, getrennte NocoDB-Base

Die Einwohner liegen in einer **eigenen** NocoDB-Base — **nicht** in der, in die unter
*Datensicherung* gesichert wird. Ein Melderegister hat in der Sicherung von Sitzungen,
Vermietungen und Rechnungen nichts verloren, deshalb bleiben beide getrennt.

NocoDB ist die **führende Quelle**; es gibt bewusst **keine lokale Kopie** der Einwohner
(zwei Bestände laufen auseinander, und beim zweiten weiß niemand mehr, welcher stimmt).
Gelesen und geschrieben wird über den Backend-Proxy `backend/einwohner.js`, Route
`/api/einwohner` — Muster wie Paperless/Vikunja/Homebox, damit der API-Token serverseitig
bleibt.

- **Konfiguration** unter *Einstellungen → Einwohner*: NocoDB-URL, API-Token, Base-ID und
  Tabelle. Gespeichert serverseitig unter dem DB-Key `einwohner` (eigener Key, **nicht** im
  Snapshot/NocoDB-Sync); Env-Fallback `EINWOHNER_NOCODB_URL` / `_TOKEN` / `_BASE` / `_TABLE`.
  Leeres Token-Feld beim Speichern = bestehenden Token behalten.
- **Spaltenzuordnung** ebenfalls dort, vorbelegt mit den Spalten der bestehenden Liste.
  Eine **leer gelassene** Zuordnung wird beim Schreiben übersprungen — so lässt sich eine
  Spalte, die es in der eigenen Base nicht gibt (etwa `Zusatz`), einfach abschalten, statt
  jedes Anlegen scheitern zu lassen.
  **Wichtig:** `Name` ist im Melderegister der **Nachname**, `Rufname` der **Vorname** —
  davon hängen Sortierung und Urkundenaufdruck ab. „Verbindung testen" zeigt deshalb eine
  **Beispielzeile** mit der aufgelösten Zuordnung; sonst fällt ein vertauschtes Feld erst
  auf der gedruckten Urkunde auf.

### 2. Ein echtes Zugriffsgate (eigene PIN)

Anders als bei den Vorgängen, wo die Rollen-Umschaltung erst im Browser filtert, entscheidet
hier der **Server**:

- Einwohner stehen **nicht** in `/api/snapshot`. Der Snapshot geht ungefiltert an jeden
  Browser im Netz; ein vollständiges Melderegister gehört dort nicht hinein.
- Der **PIN-Hash liegt serverseitig** unter dem DB-Key `einwohner`, gesalzen und mit 120.000
  PBKDF2-Runden. (Die Leitungs-PIN der Vorgänge steht als SHA-256 im Settings-Blob und fährt
  im Snapshot mit — eine kurze PIN ist daraus zurückrechenbar. Genau das wird hier vermieden.)
- Wer die PIN kennt, erhält einen **zeitlich begrenzten Token** (8 Stunden, im
  `sessionStorage`). Ohne gültigen Token antworten alle Datenrouten mit **401** — egal, was
  der Browser behauptet. Der Knopf „🔒 Sperren" beendet den Zugriff sofort.
- Offen bleiben nur `GET /config` und `GET /status` (enthalten keine Personendaten) sowie
  `PUT /config` und `POST /pin`, **solange keine PIN vergeben ist** — sonst ließe sich das
  Modul nie einrichten. Ab der ersten PIN sind beide zu. Ist **keine** PIN gesetzt, warnt die
  Oberfläche sichtbar.

Das ist keine Benutzerverwaltung und ersetzt keine — aber die Grenze, ab der „im internen
Netz" nicht mehr als Begründung reicht.

> **PIN vergessen?** Über `/etc/gemeindeverwaltung.env` (`EINWOHNER_NOCODB_*`) wieder
> hineinkommen oder den Eintrag zurücksetzen:
> `sqlite3 <datadir>/gemeinde.db "DELETE FROM settings WHERE key='einwohner';"`
> Danach ist das Modul unkonfiguriert und die PIN neu vergebbar.

### Abgleich mit der Papierliste

Die Verbandsgemeinde schickt die Einwohnerliste einmal jährlich auf **Papier**, sortiert nach
**Straße, Hausnummer, Nachname, Vorname**. Einen Datei-Import gibt es deshalb nicht — dafür
zwei Wege, die beide **exakt in dieser Reihenfolge** arbeiten:

> **Korrektur (2026-09-01):** Bis dahin sortierten Prüfliste und Bildschirmliste **ohne**
> Hausnummer, mit der ausdrücklichen Begründung, die Amtsliste täte das genauso. Beim ersten
> echten Abgleich stellte sich heraus: sie tut es nicht. Festgelegt wird die Reihenfolge an
> **einer** Stelle — `amtlichSortiert` in `backend/einwohner.js`. Wer sie ändert, ändert sie
> dort; Bildschirmliste, Prüfliste und Assistent erben sie. Hausnummern sortieren dabei
> **zahlmäßig** (2 vor 10) und ziehen die Spalte `Zusatz` mit ein, damit „12a" vor „12b" steht
> und dieselbe Adresse nicht je nach Erfassung an zwei Stellen auftaucht.

#### Der Abgleichsassistent (Vollbild)

Reiter *Abgleich* → **„Abgleich starten"**. Die Einwohner stehen straßenweise am Bildschirm,
das Papier daneben. Je Zeile drei Schaltflächen:

| | Bedeutung | Wirkung |
|---|---|---|
| ✓ | stimmt so | Zeile gilt als durchgegangen (grün) |
| ✎ | ändern | öffnet den Bearbeiten-Dialog; nach dem Speichern gilt die Zeile als geändert (gelb) |
| ✗ | steht nicht auf der Papierliste | **Vormerkung** zum Löschen (rot) — gelöscht wird erst zum Schluss |

- Dieselbe Schaltfläche noch einmal **nimmt den Haken zurück**.
- Nach einem Haken springt die Auswahl von selbst auf die nächste offene Zeile — die Liste
  lässt sich so mit der Eingabetaste durchklappern, ohne zur Maus zu greifen.
- **„+ Zugezogenen anlegen"** legt sofort an, mit der gerade offenen Straße vorbelegt; der
  neue Eintrag gilt damit auch gleich als abgeglichen.
- Oben zeigen **Straßen-Chips** den Fortschritt je Straße (`3/9`, fertige mit ✓), daneben ein
  Balken für das Ganze.
- **Escape** oder × schließt den Assistenten — der Stand bleibt erhalten.

**Der Stand liegt auf dem Server**, in der Tabelle `einwohner_abgleich` (`backend/abgleich.js`).
Ein Abgleich über mehrere hundert Einwohner läuft über Tage; läge der Haken nur im Speicher der
Seite, wäre er beim ersten Neuladen weg. In dieser Tabelle steht **nur die NocoDB-Kennung und
der Haken** — kein Name, kein Geburtsdatum, keine Anschrift. Die Namen holt die Oberfläche bei
jedem Öffnen frisch aus der Base, hinter dem PIN-Gate. Die Tabelle steht deshalb **weder im
Snapshot noch im NocoDB-Sync**; wer sie dort einträgt, hängt das Modul am Gate vorbei.

**Zum Abschluss** („Abgleich abschließen") zeigt der Assistent alle Vormerkungen einzeln mit
Name und Anschrift. Angehakt wird gelöscht, abgewählt bleibt stehen — und zwar erst nach einer
Rückfrage, die die Anzahl nennt. Dass ✗ nicht sofort löscht, ist Absicht: ein Fingertipp darf
niemanden aus dem Melderegister werfen, und die Löschung geht unwiderruflich nach NocoDB.
Danach werden Datum und Anzahl vermerkt und der Merkzettel geleert.

„Verwerfen" bricht einen laufenden Abgleich ab: die Haken gehen verloren, an den
Einwohnerdaten ändert sich nichts.

#### Die Prüfliste auf Papier

Wer lieber mit dem Stift arbeitet, druckt weiterhin die **Prüfliste**
(`app/src/export/einwohner-pdf.js`) — dieselbe Reihenfolge, nur ausgedruckt.

- Spalten: Ankreuzfeld, Name, Vorname, Anschrift, Geburtsdatum. Straßen als
  Zwischenüberschrift, Tabellenkopf auf jeder Seite, Fußzeile mit Seitenzahl und dem Vermerk
  „vertraulich".
- Das **Geburtsdatum** steht mit drauf, obwohl die Amtsliste keines führt: beim Durchgehen
  fällt ohnehin auf, wenn ein Jahrgang nicht stimmen kann — und die Ehrungen hängen daran.
- „Abgleich als erledigt vermerken" hält Datum und Anzahl fest, wenn auf Papier gearbeitet
  wurde.

Weggezogene werden **gelöscht** (Datensparsamkeit). Bereits vergebene Ehrungen bleiben
trotzdem vollständig in der Historie — siehe unten.

### Wohnungsart und Schreibfehler in NocoDB

Die **Wohnungsart** ist ein Auswahlfeld mit den drei amtlichen Werten **Alleinige Wohnung**,
**Hauptwohnung**, **Nebenwohnung**. Steht in einem Datensatz ein anderer Wert (alte
Schreibweise, in NocoDB von Hand gepflegt), wird er als zusätzliche Möglichkeit **angehängt**
statt verworfen — sonst änderte allein das Öffnen des Dialogs den Wert stillschweigend auf den
ersten Eintrag der Liste.

> **Wenn die Base die Wohnungsart als Auswahlspalte (SingleSelect) führt**, müssen die
> Optionen dort **genauso heißen**. Passt eine Schreibweise nicht, sagt die App das jetzt
> ausdrücklich und zählt die zulässigen Werte auf — zu ergänzen sind sie in NocoDB.

**Zwei Ursachen, an denen das Anlegen freiüber scheitern konnte** — beide beim **Lesen**
unsichtbar, weil eine unbekannte Spalte dort einfach nichts liefert:

1. Eine **leere Spaltenzuordnung** erzeugte ein Feld mit dem Namen `''` und ließ NocoDB den
   ganzen Schreibvorgang zurückweisen. Solche Felder werden jetzt übersprungen.
2. **Leere Werte gingen als `''`** statt als `null`. Bei einer Textspalte ist das
   gleichbedeutend, bei einer **Auswahlspalte** ist `''` aber keine gültige Option — und eine
   neue Person hat zunächst keine Wohnungsart. Jetzt geht `null`, das leert das Feld sauber.

Schlägt ein Schreibvorgang trotzdem fehl, fragt das Backend die Tabellenstruktur ab und sagt,
**welche** zugeordnete Spalte es nicht gibt (samt Liste der vorhandenen) oder **welchen Wert**
eine Auswahlspalte nicht kennt (samt der zulässigen). Nur wenn sich daran nichts erkennen
lässt, bleibt die Originalmeldung von NocoDB stehen.

### Altersjubiläen und Ehrungen

Geehrt wird zur **Vollendung des 80., 90., 95. und 100.** Lebensjahres. Wer wann dran ist,
wird aus dem Geburtsdatum **gerechnet** (`backend/ehrungen.js`) und nirgends gespeichert —
sonst müsste die Liste jedes Jahr gepflegt werden.

Gespeichert wird nur, was die Rechnung nicht weiß: **Status** (offen / Urkunde erstellt /
überreicht), eine **Notiz** und die angelegte **Aufgabe**. Dafür gibt es die Tabelle
`ehrungen` — dasselbe Muster wie die Inventar-Wartungen: die führende Quelle bleibt außerhalb,
hier steht nur die Ergänzung.

- Die **id einer Ehrung ist `einwohnerId-alter`** und damit vorhersagbar. Das ist der einzige
  Schutz davor, dass der Tageslauf morgen dieselbe Ehrung noch einmal anlegt.
- Ein **Namensschnappschuss** liegt mit im Datensatz. Zieht die Person später weg und wird
  gelöscht, stünde in der Historie sonst eine nackte Kennung — und niemand wüsste mehr, wer
  2027 geehrt wurde.
- **29. Februar:** Wer an diesem Tag geboren ist, hat in drei von vier Jahren keinen
  Geburtstag und fiele ohne Behandlung durchs Raster. Gefeiert wird dann am 28.02.

**Täglicher Lauf** (`backend/jubilaeumslauf.js`, Vorbild `wartungslauf.js`) — im Backend, nicht
im Browser: ein 90. Geburtstag rückt näher, ob jemand die App öffnet oder nicht.

1. Jubiläum rückt in die Vorlauffrist (Standard: **ein Kalendermonat**) → **Vikunja-Aufgabe**.
2. Aufgabe abgehakt → Ehrung gilt als **überreicht**. Und umgekehrt: in der App auf
   „überreicht" gesetzt → Aufgabe schließt sich.

Von Hand anstoßbar über *Einstellungen → Einwohner → „Jetzt prüfen"* oder den gleichnamigen
Knopf im Reiter *Ehrungen*.

> **Zu bedenken:** Die Aufgabe enthält standardmäßig **Namen und Anlass** — und Aufgaben sind
> im Aufgabenmodul und im Kalender für **jeden im Netz** sichtbar, auch ohne die PIN dieses
> Moduls. Das ist eine bewusste Entscheidung für Bequemlichkeit. Wer das nicht will, nimmt
> unter *Einstellungen → Einwohner* den Haken „Namen in die Aufgabe schreiben" heraus; dann
> steht dort nur Anlass und Datum, den Namen findet man im Modul.

### Ehrenurkunde

`app/src/export/urkunde-pdf.js` baut die Urkunde nach der ODT-Vorlage der Gemeinde: goldener
**Lorbeerkranz** mit der Jubiläumszahl darin (`app/assets/lorbeerkranz.png`, eingebunden wie
das Wappen über ein verstecktes `<img>` und Canvas), rechts das **Wappen**, darunter mittig
der Glückwunschtext mit dem Namen als größtem Element.

- **Du- und Sie-Fassung** liegen als Textvorlagen unter *Einstellungen → Einwohner*
  (Platzhalter `{name}`, `{alter}`, `{datum}`, `{ortsgemeinde}`). Beim Erzeugen wird gewählt —
  im Dorf duzt man den einen und siezt den anderen.
- **Die Unterschriften bleiben leer.** Das ist keine Auslassung: Ehrungen werden persönlich
  unterschrieben, das hinterlegte Bürgermeisterbild hat hier nichts zu suchen. Gedruckt werden
  nur Linie, Name und Funktion (beides konfigurierbar).
- Das Drucken setzt den Status automatisch auf **„Urkunde erstellt"**, sofern er noch offen war.
- Zwei bewusste Abweichungen von der Vorlage: **Serifenschrift** (Times) statt der
  Fließschrift des Textprogramms, und der Tippfehler „im **Nahmen** des Gemeinderates" ist
  berichtigt.

> **Namen mit Sonderzeichen:** Die PDF-Standardschriften können nur WinAnsi/CP1252. Ein
> Zeichen außerhalb (etwa `ł`, `ş`, `č`) würde die **ganze Zeile** zu Buchstabensalat machen.
> Deshalb wird **umgeschrieben** statt ersetzt: aus `ł` wird `l`, aus `ş` ein `s`. Umlaute und
> `ß` sind in WinAnsi enthalten und unproblematisch. Ein „?" mitten im Namen auf einer
> Ehrenurkunde wäre schlimmer als ein fehlender Akzent — perfekt ist es trotzdem nicht.

> **Migration:** Neue Tabellen `ehrungen` und `einwohner_abgleich` (werden beim Start
> automatisch angelegt) und der neue DB-Key `einwohner`. Keine neuen npm-Abhängigkeiten.
> Frontend nach dem Update mit **Strg+F5** neu laden. Danach *Einstellungen → Einwohner*:
> Verbindung eintragen, Verbindung testen (Beispielzeile prüfen!), **PIN vergeben**.

## Lizenz

Creative Commons **CC BY-NC-SA 4.0** — siehe `LICENSE`.
