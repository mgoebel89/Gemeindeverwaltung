#!/usr/bin/env bash
# Aktualisiert die App im Container: zieht den aktuellen Stand aus Git,
# installiert ggf. neue Backend-Dependencies, übernimmt nginx-Config und
# reloadet Backend + nginx.

set -euo pipefail

REPO_DIR="/opt/gemeindeverwaltung"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Repo nicht gefunden unter $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"
git fetch --depth=1 origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git reset --hard "origin/${BRANCH}"

# Backend-Abhängigkeiten installieren, falls package.json sich geändert hat
if [[ -f backend/package.json ]]; then
  if [[ ! -d backend/node_modules ]] || ! diff -q backend/package.json backend/node_modules/.package.json.last >/dev/null 2>&1; then
    (cd backend && npm install --omit=dev --no-audit --no-fund)
    cp backend/package.json backend/node_modules/.package.json.last 2>/dev/null || true
  fi
  systemctl restart gemeindeverwaltung-backend || true
fi

# nginx-Site übernehmen, falls geändert
if ! diff -q deploy/nginx-site.conf /etc/nginx/sites-available/sitzungsapp >/dev/null 2>&1; then
  PORT=$(awk '/listen / && $2 !~ /\[/ {sub(";","",$2); print $2; exit}' /etc/nginx/sites-available/sitzungsapp 2>/dev/null || echo 80)
  sed "s/__HTTP_PORT__/${PORT}/g" deploy/nginx-site.conf > /etc/nginx/sites-available/sitzungsapp
  nginx -t && systemctl reload nginx
fi

# systemd-Unit übernehmen, falls geändert
if ! diff -q deploy/backend.service /etc/systemd/system/gemeindeverwaltung-backend.service >/dev/null 2>&1; then
  cp deploy/backend.service /etc/systemd/system/gemeindeverwaltung-backend.service
  systemctl daemon-reload
  systemctl restart gemeindeverwaltung-backend
fi

# Backup-Skript aktualisieren
install -m 0755 deploy/backup.sh /usr/local/bin/sitzungsapp-backup
install -m 0755 deploy/update.sh /usr/local/bin/sitzungsapp-update

echo "Update abgeschlossen: $(git log -1 --pretty=format:'%h %s')"
