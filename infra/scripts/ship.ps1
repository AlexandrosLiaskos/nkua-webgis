# Retired on 16 November 2026.
#
# This script deployed the sites by copying a git bundle of a local clone to
# the server and forcing a checkout of it in /opt/nkua-webgis/src. A bundle of
# an older clone carries the earlier history, which contains the datasets, and
# the forced checkout overwrites the files on the server.
#
# Changes now go through git: commit and push to
# https://github.com/AlexandrosLiaskos/nkua-webgis, pull on the server, and
# publish the page files with infra/scripts/publish-static.py.
Write-Error "ship.ps1 is retired. Deploy with git push and git pull, and publish the page files with infra/scripts/publish-static.py on the server."
exit 1
