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
*Liegenschaften*, *Finanzen*, unten *Stammdaten*/*Einstellungen*), die sich per Knopf
**einklappen** lässt (nur Icons) und auf schmalen Geräten als **Hamburger-Drawer** erscheint.
Die Navigation wird aus einer zentralen Config in `app/src/app.js` (`NAV`) aufgebaut — ein
neues Modul ist dort ein Eintrag.

Die Startseite (`#/`) ist ein **Dashboard** (`app/src/views/uebersicht.js`) mit Karten für
anstehende Saalvermietungen, Vertrags-Kündigungsfristen, **anstehende Termine** (aus den
abonnierten Kalendern) und **offene Aufgaben** (aus Vikunja). Die frühere Sitzungsliste liegt
unter `#/sitzungen`, die vollständige Terminliste unter `#/termine`, die Aufgaben unter `#/aufgaben`.

Die **Einstellungen** sind in Kategorien gegliedert (Unter-Navigation): Allgemein, Darstellung,
Dokumente, Kalender, Aufgaben, Vermietung, Verträge & Pacht, Bargeldauslagen, Datensicherung.

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
| `HTTP_PORT`       | `80`          | nginx-Port                               |
| `PASSWORD`        | zufällig      | root-Passwort                            |
| `REPO_URL`        | dieses Repo   | aus dem geklont wird                     |
| `REPO_BRANCH`     | `main`        | Branch                                   |

Am Ende zeigt das Skript IP, URL und (falls generiert) root-Passwort.

## 2) Updates einspielen

Auf dem Proxmox-Host:

```bash
pct exec <CTID> -- sitzungsapp-update
```

Das Skript:
1. zieht den aktuellen Git-Stand,
2. installiert ggf. neue Backend-Dependencies (`npm ci`),
3. übernimmt geänderte `nginx-site.conf` und `backend.service`,
4. reloadet Backend und nginx.

Browser danach mit **Strg+F5** neu laden.

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
| Sitzungen, Mitglieder, Settings | SQLite `/var/lib/gemeindeverwaltung/data.db` |
| Anhänge                    | `/var/lib/gemeindeverwaltung/attachments/<sitzungId>/<attachmentId>` |
| Backups                    | `/var/backups/gemeindeverwaltung/<DATUM>/`   |
| App-Code                   | `/opt/gemeindeverwaltung/`                   |

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

**Detailansicht & Bedienung:** Der Detailbereich ist in **Reiter** gegliedert –
**Vorschau · Eigenschaften · Notizen** – statt einer langen Scroll-Spalte. Die Vorschau bekommt
den vollen Platz und lässt sich per **Vollbild** öffnen. Auf **Mobilgeräten** arbeitet das Modul
als **Master-Detail**: erst die Trefferliste, ein Tipp öffnet das Dokument als eigene Ansicht mit
„‹ Zurück". Der Assistent wird auf schmalen Displays randlos/vollflächig dargestellt.

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
   gespeichert (Menü **Mieter**) und stehen bei jeder weiteren Vermietung per
   Suche zur Auswahl. Anwohner/Ortsfremd wird pro Mieter hinterlegt und je
   Vermietung überschrieben.
2. **Vertrag** – Zähler-Anfangsstände (Strom kWh, Gas cbm) erfassen. Beim Erstellen
   des Vertrags werden die aktuellen Preise **eingefroren** (`preisSnapshot`), damit
   spätere Preisänderungen alte Verträge nicht verändern. → **Mietvertrag als PDF**.
3. **abgerechnet** – Zähler-Endstände + optionale Zusatzposten (z. B. Reinigung).
   → **Kostenabrechnungsbogen als PDF** (Layout der VG-Kelberg-Vorlage) für den
   Versand an die Verbandsgemeindeverwaltung.

**Zählerstand-Fotos (Beweisführung):** Zu jedem der vier Zählerstände (Strom
Anfang/Ende, Gas Anfang/Ende) kann ein Foto hinterlegt werden – auf dem Handy
öffnet der Button direkt die Kamera. Die Fotos dienen als interner Nachweis, sie
werden im Container gespeichert (Tabelle `vermietung_files` + Datei unter
`/var/lib/gemeindeverwaltung/attachments/vermietung/<vermietungId>/`) und
erscheinen **nicht** im PDF. Wie die Beleg-Scans werden sie **nicht** nach NocoDB
gesichert, sind aber vom Container-Backup erfasst.

**Bürgermeister-Unterschrift:** Das unter *Einstellungen → Bargeldauslagen*
hinterlegte Unterschriftsbild wird automatisch über die Bürgermeister-Linie in
**Mietvertrag** und **Kostenabrechnungsbogen** gesetzt. Unter den
Unterschriftslinien steht jeweils der Name: Bürgermeister (aus den
Vermietungs-Absenderdaten) bzw. der Mietername.

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

**Stammdaten** (Empfänger, Haushaltsstellen) werden dauerhaft gespeichert und –
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

**Vertragspartner** (`#/vertragspartner`): wiederverwendbare Stammdaten (Name,
Ansprechpartner, Kontakt, Anschrift), die bei jedem Vertrag zur Auswahl stehen.

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

## Lizenz

Creative Commons **CC BY-NC-SA 4.0** — siehe `LICENSE`.
