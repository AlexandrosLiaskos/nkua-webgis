"""Archive NOAA's published event and observation layers with complete pagination."""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3] / 'research' / '2026-09-07-tsunamis'
ROOT.mkdir(parents=True, exist_ok=True)
BASE = 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/'

def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                result = json.load(response)
            if 'error' in result:
                raise RuntimeError(str(result['error']))
            return result
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)

for key, service in [('events', 'tsunami_events'), ('observations', 'tsunami_observations'), ('earthquakes', 'Significant_Earthquakes')]:
    layer = BASE + service + '/FeatureServer/0'
    metadata = get(layer + '?f=json')
    (ROOT / (key + '-layer.json')).write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
    oid = metadata.get('objectIdField') or next(f['name'] for f in metadata['fields'] if f['type'] == 'esriFieldTypeOID')
    rows, offset = [], 0
    while True:
        params = dict(f='json', where='1=1', outFields='*', outSR=4326, returnGeometry='true', resultOffset=offset, resultRecordCount=1000, orderByFields=oid+' ASC')
        filename = ROOT / f'{key}-page-{offset}.json'
        if filename.exists():
            page = json.loads(filename.read_text(encoding='utf-8'))
        else:
            page = get(layer + '/query?' + urllib.parse.urlencode(params))
            filename.write_text(json.dumps(page, ensure_ascii=False), encoding='utf-8')
        features = page.get('features', [])
        rows.extend(features)
        print(key, 'downloaded', len(rows), flush=True)
        if not page.get('exceededTransferLimit'):
            break
        if not features:
            raise RuntimeError('Provider returned an empty page before the end')
        offset += len(features)
    (ROOT / (key + '.json')).write_text(json.dumps({'source':layer,'retrieved_at':datetime.now(timezone.utc).isoformat(),'fields':metadata['fields'],'features':rows}, ensure_ascii=False), encoding='utf-8')
    print(key, 'archive complete', len(rows), flush=True)
