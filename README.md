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
**laufende Vorgänge**, anstehende Saalvermietungen, Vertrags-Kündigungsfristen, **anstehende
Termine** (aus den abonnierten Kalendern) und **offene Aufgaben** (aus Vikunja). Die frühere
Sitzungsliste liegt unter `#/sitzungen`, die vollständige Terminliste unter `#/termine`, die
Aufgaben unter `#/aufgaben`.

Die **Einstellungen** sind in Kategorien gegliedert (Unter-Navigation): Allgemein, Darstellung,
Dokumente, Kalender, Aufgaben, Vorgänge & Projekte, Vermietung, Verträge & Pacht,
Bargeldauslagen, Arbeitszeiten, Datensicherung.

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
- **Anlegen/Bearbeiten/Löschen** direkt hier (derselbe Dialog wie früher unter den
  Auslagen-Stammdaten; dort stehen jetzt nur noch die Empfänger).

## Modul „Vorgänge & Projekte"

Vorgangsverfolgung und -dokumentation (`#/vorgaenge`): von der Beschaffung bis zum Bauprojekt.
Übersicht als Kacheln (abgeschlossene eingeklappt), Detailseite mit Eckdaten, Budget und
Zeitleiste. Kategorien sind unter *Einstellungen → Vorgänge & Projekte* pflegbar.

- **Zeitleiste (Historie)** mit getippten Einträgen je Datum, absteigend sortiert:
  **Notiz** (Markdown mit Live-Vorschau), **ToDo**, **Foto**, **Dokument**, **Referenz** auf
  einen anderen Vorgang und **Kosten**. Beim Ändern des Datums sortiert sich der Eintrag
  automatisch ein.
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

## Modul „Arbeitszeiten & Vergütung"

Erfasst Arbeitsleistungen für die Gemeinde – von **Gemeindearbeitern** ebenso wie von
**beauftragten Firmen** – und rechnet sie je Person/Firma und Zeitraum ab. Drei Ansichten:
`#/arbeitszeiten` (Erfassung), `#/arbeiter` (Stammdaten), `#/arbeitsabrechnungen`.

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
- **Abrechnung:** Person + Zeitraum wählen → alle offenen Einträge werden automatisch
  übernommen (Vorschau mit Summe), Haushaltsstelle + Haushaltsjahr wählen → *Erstellen*
  **friert die Sätze ein** (Snapshot je Position). Spätere Satzänderungen wirken sich auf
  fertige Abrechnungen **nicht** mehr aus. *Storno* setzt die Einträge auf „erfasst" zurück
  und löscht die Abrechnung; *Als ausgezahlt markieren* setzt Abrechnung + Einträge auf
  `ausgezahlt`.
- **Haushalt:** Abrechnungen mindern ab Status **abgerechnet** die Restmittel ihrer
  Haushaltsstelle – im Modul *Haushalt* und in der Budget-Tabelle der *Vorgänge* fließen sie
  in denselben Topf wie Auslagen und Vorgangskosten (Spalte „Verbrauch", Tooltip schlüsselt
  auf). Die Haushaltsstellen sind **dieselbe geteilte Liste** wie bei den Bargeldauslagen.
- **PDF:** *Vorläufige PDF* erzeugt eine interne Abrechnung (Leistungserbringer + Bankdaten,
  Positionstabelle, Summen, Haushaltsstelle, Unterschriftslinien inkl. Bürgermeisterbild) –
  wahlweise als Download oder direkt **in Paperless**. Das **Formular der Verbandsgemeinde**
  ist noch nicht umgesetzt und kommt später als zweite Ausgabe daneben.
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
