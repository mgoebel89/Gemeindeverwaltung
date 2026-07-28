#!/usr/bin/env bash
# Manuelles Setup in einem bestehenden Debian-12-LXC.
# Im Container als root ausführen:
#   REPO_URL=https://github.com/mgoebel89/Gemeindeverwaltung.git bash container-setup.sh

set -euo pipefail

: "${REPO_URL:=https://github.com/mgoebel89/Gemeindeverwaltung.git}"
: "${REPO_BRANCH:=main}"
: "${HTTP_PORT:=80}"
: "${HTTPS_PORT:=443}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# sane-utils + sane-airscan: Netzwerkscanner über SANE/scanimage (auch WSD-only
# wie Epson ES-580W). Ohne diese Pakete funktioniert nur der eSCL-Weg.
# openssl: selbstsigniertes Zertifikat für HTTPS (siehe unten).
apt-get install -y -qq nginx git ca-certificates curl sqlite3 cron openssl sane-utils sane-airscan

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

mkdir -p /opt /var/lib/gemeindeverwaltung /var/backups/gemeindeverwaltung
if [[ ! -d /opt/gemeindeverwaltung/.git ]]; then
  git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" /opt/gemeindeverwaltung
fi

# Backend
(cd /opt/gemeindeverwaltung/backend && npm install --omit=dev --no-audit --no-fund)
cp /opt/gemeindeverwaltung/deploy/backend.service /etc/systemd/system/gemeindeverwaltung-backend.service
systemctl daemon-reload
systemctl enable --now gemeindeverwaltung-backend

# TLS: selbstsigniertes Zertifikat. Der Kamera-Zugriff im Browser (Barcode-Scan
# im Inventar) setzt einen „secure context" voraus — über http bleibt die Kamera
# am Handy stumm. Ein vorhandenes Zertifikat wird NICHT überschrieben, sonst
# müsste der Browser nach jedem Update erneut bestätigt werden.
install -d -m 0700 /etc/ssl/gemeindeverwaltung
if [[ ! -f /etc/ssl/gemeindeverwaltung/server.crt ]]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  : "${IP:=127.0.0.1}"
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout /etc/ssl/gemeindeverwaltung/server.key \
    -out /etc/ssl/gemeindeverwaltung/server.crt \
    -subj "/CN=${IP}" \
    -addext "subjectAltName=IP:${IP},DNS:localhost" >/dev/null 2>&1
  chmod 0600 /etc/ssl/gemeindeverwaltung/server.key
fi

# Frontend + nginx
install -d /var/www
ln -sfn /opt/gemeindeverwaltung/app /var/www/sitzungsapp
# Bei Port 443 bleibt die Adresse ohne Portangabe — sonst hinge an jeder
# Weiterleitung ein „:443".
if [[ "$HTTPS_PORT" == "443" ]]; then HTTPS_SUFFIX=""; else HTTPS_SUFFIX=":${HTTPS_PORT}"; fi
sed -e "s/__HTTP_PORT__/${HTTP_PORT}/g" \
    -e "s/__HTTPS_PORT__/${HTTPS_PORT}/g" \
    -e "s/__HTTPS_SUFFIX__/${HTTPS_SUFFIX}/g" \
  /opt/gemeindeverwaltung/deploy/nginx-site.conf \
  > /etc/nginx/sites-available/sitzungsapp
ln -sfn /etc/nginx/sites-available/sitzungsapp /etc/nginx/sites-enabled/sitzungsapp
rm -f /etc/nginx/sites-enabled/default

install -m 0755 /opt/gemeindeverwaltung/deploy/update.sh /usr/local/bin/sitzungsapp-update
install -m 0755 /opt/gemeindeverwaltung/deploy/backup.sh /usr/local/bin/sitzungsapp-backup

echo '30 3 * * * root /usr/local/bin/sitzungsapp-backup >/var/log/sitzungsapp-backup.log 2>&1' > /etc/cron.d/sitzungsapp-backup
chmod 0644 /etc/cron.d/sitzungsapp-backup

nginx -t
systemctl enable --now nginx
systemctl reload nginx

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
: "${IP:=127.0.0.1}"
if [[ "$HTTPS_PORT" == "443" ]]; then SUFFIX=""; else SUFFIX=":${HTTPS_PORT}"; fi
echo "Installation abgeschlossen. App + Backend laufen."
echo "Aufrufen unter: https://${IP}${SUFFIX}"
echo "Das Zertifikat ist selbstsigniert — der Browser warnt einmalig; Ausnahme bestätigen."
echo "HTTP (Port ${HTTP_PORT}) leitet auf HTTPS um."
