#!/bin/sh
set -eu

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=authenticator_password="$WEBGIS_API_PASSWORD" \
  --file=/docker-entrypoint-initdb.d/sql/001-schema.sql
