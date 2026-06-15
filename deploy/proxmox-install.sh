#!/usr/bin/env bash
# Gemeindeverwaltung / SitzungsApp — Proxmox-LXC-Installer
# Auf dem Proxmox-Host ausführen (als root). Legt einen unprivilegierten Debian-LXC an
# und installiert die App. Konfiguration über Environment-Variablen — Defaults siehe unten.
#
# Schnellaufruf (auf dem Proxmox-Host):
#   bash -c "$(wget -qO- https://raw.githubusercontent.com/<USER>/<REPO>/main/deploy/proxmox-install.sh)"
#
# Mit Konfiguration:
#   CTID=210 HOSTNAME=sitzungsapp BRIDGE=vmbr0 IPV4=dhcp \
#     REPO_URL=https://github.com/<USER>/<REPO>.git \
#     bash -c "$(wget -qO- https://raw.githubusercontent.com/<USER>/<REPO>/main/deploy/proxmox-install.sh)"

set -euo pipefail

# -------- Defaults (per Env überschreibbar) --------
: "${CTID:=}"                              # leer = nächste freie ID
: "${HOSTNAME:=sitzungsapp}"
: "${STORAGE:=local-lvm}"                  # Storage für das Container-Volume
: "${TEMPLATE_STORAGE:=local}"             # Storage, in dem die Templates liegen
: "${DISK_GB:=4}"
: "${MEMORY_MB:=512}"
: "${SWAP_MB:=512}"
: "${CORES:=1}"
: "${BRIDGE:=vmbr0}"
: "${IPV4:=dhcp}"                          # z. B. 192.168.1.50/24  (mit GATEWAY)
: "${GATEWAY:=}"                           # nur bei statischer IP nötig
: "${UNPRIVILEGED:=1}"
: "${PASSWORD:=}"                          # leer = zufälliges Passwort wird gesetzt + ausgegeben
: "${REPO_URL:=https://github.com/mgoebel89/Gemeindeverwaltung.git}"
: "${REPO_BRANCH:=main}"
: "${HTTP_PORT:=80}"

log()  { printf '\033[1;34m[*]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[✓]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }

require_root() {
  if [[ $EUID -ne 0 ]]; then err "Bitte als root auf dem Proxmox-Host ausführen."; exit 1; fi
}
require_cmd() { command -v "$1" >/dev/null 2>&1 || { err "Befehl fehlt: $1"; exit 1; }; }

require_root
require_cmd pct
require_cmd pveam

# -------- CTID bestimmen --------
if [[ -z "$CTID" ]]; then
  CTID=$(pvesh get /cluster/nextid)
fi
if pct status "$CTID" >/dev/null 2>&1; then
  err "Container $CTID existiert bereits."
  exit 1
fi

# -------- Template sicherstellen --------
log "Suche Debian-12-Template…"
pveam update >/dev/null
TEMPLATE_NAME=$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -n1)
if [[ -z "$TEMPLATE_NAME" ]]; then
  err "Kein debian-12-standard-Template verfügbar."
  exit 1
fi

TEMPLATE_PATH="/var/lib/vz/template/cache/${TEMPLATE_NAME}"
if [[ ! -f "$TEMPLATE_PATH" ]]; then
  log "Lade Template ${TEMPLATE_NAME} (${TEMPLATE_STORAGE})…"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME"
fi
TEMPLATE_REF="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE_NAME}"

# -------- Passwort --------
if [[ -z "$PASSWORD" ]]; then
  PASSWORD=$(tr -dc 'A-Za-z0-9!@%_+-' </dev/urandom | head -c 16 || true)
  GENERATED_PW=1
else
  GENERATED_PW=0
fi

# -------- Netzwerk --------
NET_OPTS="name=eth0,bridge=${BRIDGE}"
if [[ "$IPV4" == "dhcp" ]]; then
  NET_OPTS="${NET_OPTS},ip=dhcp"
else
  if [[ -z "$GATEWAY" ]]; then
    err "Bei statischer IPV4 muss GATEWAY gesetzt sein."
    exit 1
  fi
  NET_OPTS="${NET_OPTS},ip=${IPV4},gw=${GATEWAY}"
fi

log "Erzeuge LXC ${CTID} (${HOSTNAME})…"
pct create "$CTID" "$TEMPLATE_REF" \
  --hostname "$HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY_MB" \
  --swap "$SWAP_MB" \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "$NET_OPTS" \
  --features nesting=1 \
  --unprivileged "$UNPRIVILEGED" \
  --password "$PASSWORD" \
  --onboot 1 \
  --start 0

ok  "Container angelegt."
log "Starte Container…"
pct start "$CTID"

# Warte bis Netz da ist
log "Warte auf Netzwerk im Container…"
for i in {1..30}; do
  if pct exec "$CTID" -- bash -lc 'getent hosts deb.debian.org >/dev/null 2>&1 || ping -c1 -W1 1.1.1.1 >/dev/null 2>&1'; then
    break
  fi
  sleep 1
done

# -------- Setup im Container --------
log "Installiere App im Container…"
pct exec "$CTID" -- bash -lc "
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq nginx git ca-certificates curl >/dev/null
  mkdir -p /opt
  if [ ! -d /opt/gemeindeverwaltung/.git ]; then
    git clone --depth=1 --branch '${REPO_BRANCH}' '${REPO_URL}' /opt/gemeindeverwaltung
  fi
  install -d /var/www
  ln -sfn /opt/gemeindeverwaltung/app /var/www/sitzungsapp
  cp /opt/gemeindeverwaltung/deploy/nginx-site.conf /etc/nginx/sites-available/sitzungsapp
  sed -i 's/__HTTP_PORT__/${HTTP_PORT}/g' /etc/nginx/sites-available/sitzungsapp
  ln -sfn /etc/nginx/sites-available/sitzungsapp /etc/nginx/sites-enabled/sitzungsapp
  rm -f /etc/nginx/sites-enabled/default
  install -m 0755 /opt/gemeindeverwaltung/deploy/update.sh /usr/local/bin/sitzungsapp-update
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
"

# IP ermitteln
sleep 2
CT_IP=$(pct exec "$CTID" -- bash -lc "hostname -I | awk '{print \$1}'" || true)

ok "Fertig."
echo
echo "─────────────────────────────────────────────"
echo "  Container-ID : $CTID"
echo "  Hostname     : $HOSTNAME"
echo "  IP           : ${CT_IP:-(noch nicht verfügbar)}"
echo "  URL          : http://${CT_IP:-<IP>}:${HTTP_PORT}"
if [[ "$GENERATED_PW" -eq 1 ]]; then
  echo "  root-Passwort: $PASSWORD"
fi
echo
echo "  Update später im Container ausführen mit:"
echo "    pct exec $CTID -- sitzungsapp-update"
echo "─────────────────────────────────────────────"
