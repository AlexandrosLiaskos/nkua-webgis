#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/opt/nkua-webgis/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL_PATH="$BACKUP_DIR/webgis-$STAMP.dump"
TEMP_PATH="$FINAL_PATH.tmp"
VISITS_SOURCE="/opt/nkua-webgis/visits/visits.json"
VISITS_FINAL_PATH="$BACKUP_DIR/webgis-visits-$STAMP.json"
VISITS_TEMP_PATH="$VISITS_FINAL_PATH.tmp"

mkdir -p "$BACKUP_DIR"
umask 077

docker exec nkua-webgis-db \
  pg_dump --username=webgis_owner --dbname=webgis --format=custom \
  > "$TEMP_PATH"
mv "$TEMP_PATH" "$FINAL_PATH"

if [[ -f "$VISITS_SOURCE" ]]; then
  cp "$VISITS_SOURCE" "$VISITS_TEMP_PATH"
  chmod 0600 "$VISITS_TEMP_PATH"
  mv "$VISITS_TEMP_PATH" "$VISITS_FINAL_PATH"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'webgis-*.dump' -mtime +13 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'webgis-visits-*.json' -mtime +13 -delete
