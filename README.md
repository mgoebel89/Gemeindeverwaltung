# Gemeindeverwaltung — Sitzungsprotokoll-App

Statische Web-App zur Vorbereitung, Live-Protokollierung und PDF-Ausgabe von
Gemeinderatssitzungen. Daten werden im Browser (localStorage) gespeichert,
optional über NocoDB synchronisiert.

Dieses Repo enthält die App selbst (`app/`) sowie Deploy-Skripte (`deploy/`),
mit denen die App in einem **Proxmox-LXC-Container** installiert werden kann.

## Struktur

```
Gemeindeverwaltung/
├── app/                 # Statische Web-App (index.html, src/, vendor/, assets/, styles.css)
├── deploy/
│   ├── proxmox-install.sh   # auf Proxmox-Host: legt LXC an und installiert die App
│   ├── container-setup.sh   # (optional) manuelles Setup innerhalb eines bestehenden LXC
│   ├── nginx-site.conf      # nginx-Site-Vorlage
│   └── update.sh            # zieht aktuellen Stand aus Git und reloaded nginx
├── README.md
└── .gitignore
```

## 1) Auf GitHub veröffentlichen

```powershell
cd C:\Users\mgoebel\Documents\ClaudeCode\SitzungsApp\Gemeindeverwaltung
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main
```

## 2) Installation auf Proxmox

Auf dem **Proxmox-Host** als root:

```bash
bash -c "$(wget -qO- https://raw.githubusercontent.com/<USER>/<REPO>/main/deploy/proxmox-install.sh)"
```

Mit eigenen Werten:

```bash
CTID=210 \
HOSTNAME=sitzungsapp \
BRIDGE=vmbr0 \
IPV4=192.168.1.50/24 \
GATEWAY=192.168.1.1 \
REPO_URL=https://github.com/<USER>/<REPO>.git \
bash -c "$(wget -qO- https://raw.githubusercontent.com/<USER>/<REPO>/main/deploy/proxmox-install.sh)"
```

Konfigurierbare Variablen (mit Defaults):

| Variable          | Default         | Bedeutung                                |
|-------------------|-----------------|------------------------------------------|
| `CTID`            | nächste freie   | LXC-ID                                   |
| `HOSTNAME`        | `sitzungsapp`   | Hostname des Containers                  |
| `STORAGE`         | `local-lvm`     | Storage fürs Container-Volume            |
| `TEMPLATE_STORAGE`| `local`         | Storage mit Templates                    |
| `DISK_GB`         | `4`             | Root-Disk in GB                          |
| `MEMORY_MB`       | `512`           | RAM                                      |
| `SWAP_MB`         | `512`           | Swap                                     |
| `CORES`           | `1`             | CPU-Kerne                                |
| `BRIDGE`          | `vmbr0`         | Netzwerk-Bridge                          |
| `IPV4`            | `dhcp`          | z. B. `192.168.1.50/24` für statisch     |
| `GATEWAY`         | —               | bei statischer IP pflicht                |
| `UNPRIVILEGED`    | `1`             | unprivilegierter Container               |
| `HTTP_PORT`       | `80`            | Port, auf dem nginx hört                 |
| `PASSWORD`        | zufällig        | root-Passwort des Containers             |
| `REPO_URL`        | dieses Repo     | aus dem geklont wird                     |
| `REPO_BRANCH`     | `main`          | Branch                                   |

Am Ende gibt das Skript IP, URL und (falls generiert) das root-Passwort aus.

## 3) Updates einspielen

Im Container:

```bash
pct exec <CTID> -- sitzungsapp-update
```

Das Skript zieht den aktuellen Stand aus Git und reloaded nginx, wenn sich
die Site-Config geändert hat.

## 4) Lokal testen (ohne Proxmox)

Statt LXC reicht jeder kleine Webserver, der `app/` ausliefert:

```bash
cd app
python3 -m http.server 8000
# Browser: http://localhost:8000
```

Windows-Variante: `py -m http.server 8000`

## Hinweise

- **Datenhaltung:** Sitzungen liegen pro Browser im `localStorage`. Für zentrale
  Datenhaltung den NocoDB-Direktexport in den App-Einstellungen konfigurieren.
- **HTTPS:** Standard-Setup ist HTTP. Für HTTPS Caddy oder einen Reverse-Proxy
  (Traefik, nginx-proxy-manager) vorschalten.
- **NocoDB-CORS:** Wenn NocoDB-Sync genutzt wird, muss die NocoDB-Instanz CORS
  für die Container-Origin erlauben (`NC_CORS_ORIGIN`).
- **Backup:** Über die App-Einstellungen `Backup herunterladen (JSON)` nutzen.
  Container selbst ist zustandslos — kann jederzeit neu erzeugt werden.

## Lizenz

License CC BY-NC-SA
