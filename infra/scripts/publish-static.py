"""Publish an uploaded static overlay without building images or changing databases.

Run on the VPS: python3 publish-static.py RELEASE ARCHIVE COLLECTION...
The first release preserves the currently served assets; subsequent releases use
hard links and replace only uploaded files. All previous releases remain intact.
"""
import os
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path


def run(*args):
    subprocess.run(args, check=True)


release, archive, *collections = sys.argv[1:]
if not re.fullmatch(r"[a-z0-9-]+", release) or not collections or any(not re.fullmatch(r"[a-z0-9-]+", c) for c in collections):
    raise SystemExit("Invalid release or collection name")
root = Path('/opt/nkua-webgis')
source = root / 'src'
static = root / 'static'
static.mkdir(exist_ok=True)
target = static / release
target.mkdir()
backup = root / 'backups' / release
backup.mkdir(parents=True)
current = static / 'current'
previous = str(current.resolve()) if current.exists() else None
(backup / 'previous-release.txt').write_text(previous or 'image-assets')
shutil.copy2(source / 'compose.yaml', backup / 'compose.yaml')
shutil.copy2(source / 'infra/nginx/webgis.conf', backup / 'source-nginx.conf')
shutil.copy2(source / 'infra/counter/visit_counter.py', backup / 'visit_counter.py')

if previous:
    run('cp', '-al', previous + '/.', str(target))
else:
    (target / 'sites').mkdir()
    run('docker', 'cp', 'nkua-webgis-web:/srv/sites/.', str(target / 'sites'))
    run('docker', 'cp', 'nkua-webgis-web:/etc/nginx/nginx.conf', str(target / 'nginx.conf'))
    # Keep the image-era site intact as a rollback release before applying files.
    baseline = static / (release + '-baseline')
    run('cp', '-al', str(target), str(baseline))
    previous = str(baseline)
    (backup / 'previous-release.txt').write_text(previous)

with tarfile.open(archive) as package:
    for member in package:
        relative = Path(member.name)
        if relative.is_absolute() or '..' in relative.parts or not member.isfile():
            continue
        if relative.parts[0] != 'sites':
            raise RuntimeError('Only static site files are accepted')
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Unlink breaks the hard link before replacement, preserving older releases.
        destination.unlink(missing_ok=True)
        with package.extractfile(member) as inp, destination.open('wb') as out:
            shutil.copyfileobj(inp, out)
        os.chmod(destination, 0o644)
        source_file = source / relative
        source_file.parent.mkdir(parents=True, exist_ok=True)
        if source_file.exists():
            saved = backup / 'source' / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, saved)
        shutil.copy2(destination, source_file)

nginx = (target / 'nginx.conf').read_text()
for collection in collections:
    if f'location = /{collection} ' not in nginx:
        anchor = '        location = /floods { return 308 /floods/; }'
        if anchor not in nginx:
            raise RuntimeError('Expected WebGIS route anchor is absent')
        nginx = nginx.replace(anchor, f'        location = /{collection} {{ return 308 /{collection}/; }}\n        location ^~ /{collection}/ {{ try_files $uri $uri/ =404; }}\n' + anchor)
    if f'location = /{collection}/api/page-summary' not in nginx:
        start = nginx.index('        location = /floods/api/page-summary')
        end = nginx.index('\n        }', start) + len('\n        }')
        nginx = nginx[:start] + nginx[start:end].replace('/floods/', f'/{collection}/').replace('/visit/floods', f'/visit/{collection}') + '\n\n' + nginx[start:]
(target / 'nginx.conf').unlink()
(target / 'nginx.conf').write_text(nginx)
(source / 'infra/nginx/webgis.conf').write_text(nginx)

counter_path = source / 'infra/counter/visit_counter.py'
counter = counter_path.read_text()
marker = 'SUPPORTED_SITES = frozenset({'
if marker not in counter:
    raise RuntimeError('Expected counter site registry is absent')
existing = counter[counter.index(marker):counter.index('})', counter.index(marker))]
added = [c for c in collections if f'"{c}"' not in existing and f"'{c}'" not in existing]
if added:
    counter = counter.replace(marker, marker + ''.join(f'"{c}", ' for c in added), 1)
    counter_path.write_text(counter)

compose_path = source / 'compose.yaml'
compose = compose_path.read_text()
if '/opt/nkua-webgis/static/current/sites:/srv/sites:ro' not in compose:
    anchor = '    container_name: nkua-webgis-web\n'
    if anchor not in compose:
        raise RuntimeError('Expected WebGIS service is absent')
    compose = compose.replace(anchor, anchor + '    volumes:\n      - /opt/nkua-webgis/static/current/sites:/srv/sites:ro\n      - /opt/nkua-webgis/static/current/nginx.conf:/etc/nginx/nginx.conf:ro\n', 1)
    compose_path.write_text(compose)

pending = static / 'current-pending'
pending.unlink(missing_ok=True)
pending.symlink_to(target.name, target_is_directory=True)
pending.replace(current)
try:
    if added:
        run('docker', 'restart', 'nkua-webgis-counter')
    run('docker', 'compose', '--env-file', str(root / '.env'), '-f', str(compose_path), 'up', '-d', '--no-build', '--no-deps', '--force-recreate', 'web')
except Exception:
    pending.symlink_to(previous, target_is_directory=True)
    pending.replace(current)
    shutil.copy2(backup / 'compose.yaml', compose_path)
    shutil.copy2(backup / 'source-nginx.conf', source / 'infra/nginx/webgis.conf')
    shutil.copy2(backup / 'visit_counter.py', counter_path)
    run('docker', 'restart', 'nkua-webgis-counter')
    run('docker', 'compose', '--env-file', str(root / '.env'), '-f', str(compose_path), 'up', '-d', '--no-build', '--no-deps', '--force-recreate', 'web')
    raise
print(f'Published {release}. Previous release: {previous}. Backups: {backup}')
