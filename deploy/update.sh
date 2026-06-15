#!/usr/bin/env bash
# Aktualisiert die App im Container: zieht den aktuellen Stand aus Git
# und lädt nginx neu. Innerhalb des LXC ausführen (z. B. via `pct exec <CTID> -- sitzungsapp-update`).

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

# nginx ggf. neue Site-Config übernehmen
if ! diff -q deploy/nginx-site.conf /etc/nginx/sites-available/sitzungsapp >/dev/null 2>&1; then
  # Port aus aktueller Konfig übernehmen (verhindert ungewollten Wechsel)
  PORT=$(awk '/listen / && $2 !~ /\[/ {sub(";","",$2); print $2; exit}' /etc/nginx/sites-available/sitzungsapp 2>/dev/null || echo 80)
  sed "s/__HTTP_PORT__/${PORT}/g" deploy/nginx-site.conf > /etc/nginx/sites-available/sitzungsapp
  nginx -t && systemctl reload nginx
fi

echo "Update abgeschlossen: $(git log -1 --pretty=format:'%h %s')"
