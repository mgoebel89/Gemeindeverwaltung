#!/usr/bin/env bash
# Manuelles Setup in einem bestehenden Debian-12-LXC.
# Im Container als root ausführen:
#   REPO_URL=https://github.com/mgoebel89/Gemeindeverwaltung.git bash container-setup.sh

set -euo pipefail

: "${REPO_URL:=https://github.com/mgoebel89/Gemeindeverwaltung.git}"
: "${REPO_BRANCH:=main}"
: "${HTTP_PORT:=80}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# sane-utils + sane-airscan: Netzwerkscanner über SANE/scanimage (auch WSD-only
# wie Epson ES-580W). Ohne diese Pakete funktioniert nur der eSCL-Weg.
apt-get install -y -qq nginx git ca-certificates curl sqlite3 cron sane-utils sane-airscan

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

# Frontend + nginx
install -d /var/www
ln -sfn /opt/gemeindeverwaltung/app /var/www/sitzungsapp
sed "s/__HTTP_PORT__/${HTTP_PORT}/g" \
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

echo "Installation abgeschlossen. App + Backend laufen, Port ${HTTP_PORT}."
