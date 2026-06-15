#!/usr/bin/env bash
# Manuelles Setup in einem bestehenden Debian-12-LXC.
# Verwende dies, wenn du den Container nicht über proxmox-install.sh erzeugt hast.
# Im Container als root ausführen:
#   REPO_URL=https://github.com/<USER>/<REPO>.git bash container-setup.sh

set -euo pipefail

: "${REPO_URL:?REPO_URL muss gesetzt sein (z. B. https://github.com/<USER>/<REPO>.git)}"
: "${REPO_BRANCH:=main}"
: "${HTTP_PORT:=80}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx git ca-certificates curl

if [[ ! -d /opt/gemeindeverwaltung/.git ]]; then
  git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" /opt/gemeindeverwaltung
fi

install -d /var/www
ln -sfn /opt/gemeindeverwaltung/app /var/www/sitzungsapp

sed "s/__HTTP_PORT__/${HTTP_PORT}/g" \
  /opt/gemeindeverwaltung/deploy/nginx-site.conf \
  > /etc/nginx/sites-available/sitzungsapp
ln -sfn /etc/nginx/sites-available/sitzungsapp /etc/nginx/sites-enabled/sitzungsapp
rm -f /etc/nginx/sites-enabled/default

install -m 0755 /opt/gemeindeverwaltung/deploy/update.sh /usr/local/bin/sitzungsapp-update

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "Installation abgeschlossen. App erreichbar auf Port ${HTTP_PORT}."
