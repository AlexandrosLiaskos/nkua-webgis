#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="/opt/nkua-webgis"
ENV_FILE="$STATE_DIR/.env"

if [[ $EUID -ne 0 ]]; then
  echo "deploy.sh must run as root" >&2
  exit 1
fi

mkdir -p "$STATE_DIR/backups"
install -d -m 0750 -o 65534 -g 65534 "$STATE_DIR/visits"

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
    echo "WEBGIS_API_PASSWORD=$(openssl rand -hex 32)"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "generated $ENV_FILE (0600)"
fi

docker network inspect nkua-proxy >/dev/null 2>&1 ||
  docker network create nkua-proxy >/dev/null

install -m 0755 infra/scripts/backup.sh "$STATE_DIR/backup.sh"
install -m 0644 infra/systemd/nkua-webgis-backup.service /etc/systemd/system/
install -m 0644 infra/systemd/nkua-webgis-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nkua-webgis-backup.timer

docker compose --env-file "$ENV_FILE" -f compose.yaml up -d --build

echo "deployed nkua-webgis"
