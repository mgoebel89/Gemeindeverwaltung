#!/usr/bin/env bash
# Tägliches Backup der SQLite-Datenbank + Anhänge.
# Wird per Cron einmal pro Tag ausgeführt. Hält die letzten 14 Snapshots.

set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/gemeindeverwaltung}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gemeindeverwaltung}"
KEEP="${KEEP:-14}"

DATE=$(date +%F)
TARGET="${BACKUP_DIR}/${DATE}"
mkdir -p "$TARGET"

# Konsistentes SQLite-Backup über den sqlite3-Befehl (online-safe).
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DATA_DIR}/data.db" ".backup '${TARGET}/data.db'"
else
  cp -a "${DATA_DIR}/data.db" "${TARGET}/data.db"
fi

# Anhänge als tar.gz
if [ -d "${DATA_DIR}/attachments" ]; then
  tar -czf "${TARGET}/attachments.tar.gz" -C "${DATA_DIR}" attachments
fi

# Alte Backups aufräumen
cd "$BACKUP_DIR"
ls -1 | sort | head -n -"${KEEP}" | xargs -r rm -rf

echo "Backup nach ${TARGET} abgeschlossen."
