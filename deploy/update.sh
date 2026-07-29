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

# Merker VOR dem Pull: dieses Skript aktualisiert sich selbst mit.
SELBST_VORHER=$(sha1sum deploy/update.sh 2>/dev/null | awk '{print $1}' || true)

git fetch --depth=1 origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git reset --hard "origin/${BRANCH}"

# Hat der Pull DIESES Skript verändert, ist die laufende Fassung veraltet —
# bash hat sie längst eingelesen und arbeitet sie zu Ende ab. Dann rendert eine
# alte Fassung womöglich eine neue Vorlage und hinterlässt Unfug (real passiert:
# __HTTPS_PORT__ blieb in der nginx-Konfiguration stehen, weil das alte sed den
# Platzhalter nicht kannte). Also einmal mit der neuen Fassung neu starten.
SELBST_NACHHER=$(sha1sum deploy/update.sh 2>/dev/null | awk '{print $1}' || true)
if [[ "${UPDATE_NEUSTART:-0}" != "1" && -n "$SELBST_VORHER" && "$SELBST_VORHER" != "$SELBST_NACHHER" ]]; then
  echo "Das Update-Skript wurde selbst erneuert — es startet sich mit der neuen Fassung neu."
  UPDATE_NEUSTART=1 exec bash "$REPO_DIR/deploy/update.sh"
fi

# Scanner-Unterstützung (SANE) sicherstellen – nötig für Netzwerkscanner ohne
# eSCL (nur WSD), z. B. Epson ES-580W. Idempotent: nur wenn scanimage fehlt.
if ! command -v scanimage >/dev/null 2>&1; then
  echo "Installiere Scanner-Unterstützung (sane-utils, sane-airscan)…"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sane-utils sane-airscan \
    || echo "Hinweis: SANE-Installation fehlgeschlagen — ggf. manuell 'apt install sane-utils sane-airscan'." >&2
fi

# Backend-Abhängigkeiten installieren, falls package.json sich geändert hat
if [[ -f backend/package.json ]]; then
  if [[ ! -d backend/node_modules ]] || ! diff -q backend/package.json backend/node_modules/.package.json.last >/dev/null 2>&1; then
    (cd backend && npm install --omit=dev --no-audit --no-fund)
    cp backend/package.json backend/node_modules/.package.json.last 2>/dev/null || true
  fi
  systemctl restart gemeindeverwaltung-backend || true
fi

# nginx-Site übernehmen, falls geändert.
# Die Ports aus der INSTALLIERTEN Konfiguration übernehmen, damit eine
# abweichende Portwahl ein Update überlebt. Erste listen-Zeile ohne „ssl" ist
# HTTP, erste mit „ssl" ist HTTPS.
if ! diff -q deploy/nginx-site.conf /etc/nginx/sites-available/sitzungsapp >/dev/null 2>&1; then
  CONF=/etc/nginx/sites-available/sitzungsapp
  PORT=$(awk '/listen / && $2 !~ /\[/ && $0 !~ /ssl/ {sub(";","",$2); print $2; exit}' "$CONF" 2>/dev/null || echo 80)
  HTTPS_PORT=$(awk '/listen / && $2 !~ /\[/ && $0 ~ /ssl/ {sub(";","",$2); print $2; exit}' "$CONF" 2>/dev/null || true)
  # Nur Zahlen gelten. Steht in der installierten Konfiguration ein nicht
  # ersetzter Platzhalter (weil ein früherer Lauf sie kaputt hinterlassen hat),
  # würde er sonst als „Port" übernommen und der Schaden bliebe für immer.
  [[ "$PORT" =~ ^[0-9]+$ ]] || PORT=80
  [[ "$HTTPS_PORT" =~ ^[0-9]+$ ]] || HTTPS_PORT=443

  # Erstes Update einer Installation, die noch kein HTTPS hatte: Zertifikat
  # nachlegen, sonst scheitert nginx -t am fehlenden Schlüssel und die Seite
  # bliebe nach dem Reload tot.
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
    echo "HTTPS eingerichtet — die App ist ab jetzt unter https://${IP} erreichbar."
  fi

  if [[ "$HTTPS_PORT" == "443" ]]; then HTTPS_SUFFIX=""; else HTTPS_SUFFIX=":${HTTPS_PORT}"; fi

  # Erst in eine Zwischendatei rendern und prüfen. Eine Konfiguration mit
  # übrig gebliebenen Platzhaltern darf gar nicht erst installiert werden —
  # nginx startet damit nach dem nächsten Neustart nicht mehr.
  NEU=$(mktemp)
  sed -e "s/__HTTP_PORT__/${PORT}/g" \
      -e "s/__HTTPS_PORT__/${HTTPS_PORT}/g" \
      -e "s/__HTTPS_SUFFIX__/${HTTPS_SUFFIX}/g" \
    deploy/nginx-site.conf > "$NEU"
  if grep -q '__[A-Z_]\+__' "$NEU"; then
    rm -f "$NEU"
    echo "FEHLER: Platzhalter in der nginx-Vorlage nicht ersetzt — Konfiguration NICHT übernommen." >&2
    exit 1
  fi

  # Mit Sicherungskopie tauschen: schlägt der Test fehl, bleibt die alte,
  # funktionierende Konfiguration stehen statt einer kaputten.
  cp "$CONF" "${CONF}.bak" 2>/dev/null || true
  cp "$NEU" "$CONF"
  rm -f "$NEU"
  if nginx -t; then
    systemctl reload nginx
  else
    echo "nginx-Test fehlgeschlagen — vorherige Konfiguration wiederhergestellt." >&2
    [[ -f "${CONF}.bak" ]] && cp "${CONF}.bak" "$CONF"
    exit 1
  fi
fi

# systemd-Unit übernehmen, falls geändert
if ! diff -q deploy/backend.service /etc/systemd/system/gemeindeverwaltung-backend.service >/dev/null 2>&1; then
  cp deploy/backend.service /etc/systemd/system/gemeindeverwaltung-backend.service
  systemctl daemon-reload
  systemctl restart gemeindeverwaltung-backend
fi

# Backup-/Update-Skripte aktualisieren
install -m 0755 deploy/backup.sh /usr/local/bin/sitzungsapp-backup
install -m 0755 deploy/update.sh /usr/local/bin/sitzungsapp-update
# Kurzbefehl 'update' + Konsolen-Hinweis für Bestandsinstallationen nachziehen
ln -sfn /usr/local/bin/sitzungsapp-update /usr/local/bin/update
printf 'Gemeindeverwaltung-Container\n  App aktualisieren:  update\n  Backup jetzt:       sitzungsapp-backup\n' > /etc/motd

echo "Update abgeschlossen: $(git log -1 --pretty=format:'%h %s')"
