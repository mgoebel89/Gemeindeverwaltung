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
(Docker auf dem NAS) abgelegten Dokumente durchsuchbar macht und das **Bearbeiten der
Metadaten** erlaubt (Titel, Datum, Korrespondent, Dokumenttyp, Tags, Archiv-Nr., Custom Fields).

**Architektur:** Das Frontend spricht ausschließlich das eigene Node-Backend an
(`/api/dokumente/...`). Das Backend (`backend/paperless.js` + `backend/routes/dokumente.js`)
proxyt zu Paperless und hält den **API-Token serverseitig** — der Token landet nie im Browser,
CORS muss in Paperless **nicht** geöffnet werden.

**Konfiguration (Env-Variablen):**

| Variable          | Bedeutung                                                        |
|-------------------|------------------------------------------------------------------|
| `PAPERLESS_URL`   | Basis-URL der Paperless-Instanz, vom Container erreichbar, z. B. `http://192.168.1.20:8000` |
| `PAPERLESS_TOKEN` | API-Token (Paperless: **Einstellungen → API-Token**)             |

Im LXC kommen die Werte aus `/etc/gemeindeverwaltung.env` (root-only, `chmod 600`), die von
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

> **Noch nicht enthalten (Folge-Iterationen):** SMB-Direktzugriff, Upload neuer Dokumente,
> Löschen, Notizen-Bearbeitung und eine gemeinsame Benutzeranmeldung.

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

**Netzwerkscanner (eSCL/AirScan):** In den Einstellungen unter *Bargeldauslagen*
den Scanner **automatisch im Netzwerk suchen** (mDNS `_uscan._tcp`) und als
Standard übernehmen, oder die URL (z. B. `http://192.168.1.30`) manuell
eintragen. Der Scan läuft serverseitig über das Backend (`backend/routes/scan.js`),
der Browser spricht den Scanner nicht direkt an. Voraussetzung: Der Scanner ist
vom Container erreichbar und Multicast/mDNS ist auf der Bridge erlaubt. Fällt der
Scanner aus, funktioniert der manuelle Datei-Upload weiterhin.

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

## Lizenz

Creative Commons **CC BY-NC-SA 4.0** — siehe `LICENSE`.
