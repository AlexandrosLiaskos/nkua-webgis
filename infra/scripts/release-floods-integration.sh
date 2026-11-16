#!/usr/bin/env bash
# Correct the flood UI without rebuilding or reapplying catalogue SQL.
set -euo pipefail
cd "$(dirname "$0")/../.."
revision=$(git rev-parse HEAD)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
release="floods-integration-${revision:0:12}-$stamp"
backup_dir="/opt/nkua-webgis/backups/$release"
stage="/tmp/$release"
web=nkua-webgis-web
umask 077
mkdir -p "$backup_dir"
docker commit --pause=false "$web" "nkua-webgis-web:before-$release" > "$backup_dir/previous-web-image.txt"
docker exec "$web" mkdir -p "$stage/js"
docker cp sites/floods/js/. "$web:$stage/js/"
docker cp sites/floods/data/hanze/v2.1.1/map-records.json "$web:$stage/map-records.json"
docker cp sites/floods/index.html "$web:$stage/index.html"
docker cp sites/webgis-shared/research/2026-09-05/index.html "$web:$stage/provenance.html"
docker exec -e RELEASE_STAGE="$stage" "$web" sh -eu -c '
    cp -a "$RELEASE_STAGE/js/." /srv/sites/floods/js/
    cp "$RELEASE_STAGE/map-records.json" /srv/sites/floods/data/hanze/v2.1.1/map-records.json
    cp "$RELEASE_STAGE/provenance.html" /srv/sites/webgis-shared/research/2026-09-05/index.html
    cp "$RELEASE_STAGE/index.html" /srv/sites/floods/index.html.next
    mv /srv/sites/floods/index.html.next /srv/sites/floods/index.html
    rm -f /srv/sites/floods/hanze.css /srv/sites/floods/js/map/HanzeLayer.js
    find "$RELEASE_STAGE" -depth -delete
'
docker commit --pause=false "$web" "nkua-webgis-web:$release" > "$backup_dir/released-web-image.txt"
docker tag "nkua-webgis-web:$release" nkua-webgis-web:latest
printf 'Revision: %s\nRelease: %s\nFlood UI: shared pins, sidebar, record cards and Sources modal\nChecks: not run by user instruction\n' "$revision" "$release" > "$backup_dir/release.txt"
printf 'Published flood integration %s\nRecovery files: %s\n' "$revision" "$backup_dir"
