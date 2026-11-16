#!/usr/bin/env bash
# Publish this static/data release through the existing deployment without a build.
set -euo pipefail
cd "$(dirname "$0")/../.."

state_dir=/opt/nkua-webgis
web_container=nkua-webgis-web
revision=$(git rev-parse HEAD)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
release="research-20260905-${revision:0:12}-$stamp"
backup_dir="$state_dir/backups/$release"
stage="/tmp/$release"
umask 077
mkdir -p "$backup_dir"

# Capture the live database and static image before applying release mutations.
docker exec nkua-webgis-db pg_dump --username=webgis_owner --dbname=webgis --format=custom > "$backup_dir/webgis.dump.partial"
mv "$backup_dir/webgis.dump.partial" "$backup_dir/webgis.dump"
docker commit --pause=false "$web_container" "nkua-webgis-web:before-$release" > "$backup_dir/previous-web-image.txt"
cp infra/db/releases/20260905-research-expansion-rollback.sql "$backup_dir/rollback.sql"

# Transfer new assets completely before exposing the new entry points.
docker exec "$web_container" mkdir -p "$stage/floods/data" "$stage/floods/js/map" "$stage/webgis-shared/research"
docker cp sites/floods/data/hanze "$web_container:$stage/floods/data/"
docker cp sites/floods/js/. "$web_container:$stage/floods/js/"
docker cp sites/floods/index.html "$web_container:$stage/floods/index.html"
docker cp sites/index.html "$web_container:$stage/index.html"
docker cp sites/webgis-shared/research/2026-09-05 "$web_container:$stage/webgis-shared/research/"
docker cp infra/nginx/webgis.conf "$web_container:$stage/nginx.conf"

docker exec -i nkua-webgis-db psql -X --set=ON_ERROR_STOP=1 --username=webgis_owner --dbname=webgis < infra/db/releases/20260905-research-expansion.sql

docker exec -e RELEASE_STAGE="$stage" "$web_container" sh -eu -c '
    mkdir -p /srv/sites/floods/data /srv/sites/webgis-shared/research
    cp -a "$RELEASE_STAGE/floods/data/hanze" /srv/sites/floods/data/
    cp -a "$RELEASE_STAGE/webgis-shared/research/2026-09-05" /srv/sites/webgis-shared/research/
    cp -a "$RELEASE_STAGE/floods/js/." /srv/sites/floods/js/
    cp "$RELEASE_STAGE/floods/js/main.js" /srv/sites/floods/js/main.js.next
    mv /srv/sites/floods/js/main.js.next /srv/sites/floods/js/main.js
    cp "$RELEASE_STAGE/nginx.conf" /etc/nginx/nginx.conf.next
    mv /etc/nginx/nginx.conf.next /etc/nginx/nginx.conf
    nginx -s reload
    find /var/cache/nginx/webgis-api -type f -delete
    cp "$RELEASE_STAGE/floods/index.html" /srv/sites/floods/index.html.next
    mv /srv/sites/floods/index.html.next /srv/sites/floods/index.html
    cp "$RELEASE_STAGE/index.html" /srv/sites/index.html.next
    mv /srv/sites/index.html.next /srv/sites/index.html
    find "$RELEASE_STAGE" -depth -delete
'

# Preserve the deployed filesystem in both a release tag and the Compose image tag.
docker commit --pause=false "$web_container" "nkua-webgis-web:$release" > "$backup_dir/released-web-image.txt"
docker tag "nkua-webgis-web:$release" nkua-webgis-web:latest
printf 'Revision: %s\nRelease: %s\nDatabase patch: 12 records, 23 fields\nHANZE: 2412 source records, 39 countries\nChecks: not run by user instruction\n' "$revision" "$release" > "$backup_dir/release.txt"
printf 'Published revision %s\nRecovery files: %s\n' "$revision" "$backup_dir"
