"""Archive the four public COOLR feature layers, retaining server metadata."""
import concurrent.futures
import json
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from acquire import RAW, get_json

LAYERS = ['COOLR_Reports_Points', 'COOLR_Reports_Polygons',
          'COOLR_Events_Points', 'COOLR_Events_Polygons']
BASE = 'https://gis.earthdata.nasa.gov/portal/rest/services/Landslides/'


def acquire_layer(name):
    folder = RAW / 'nasa-coolr'
    folder.mkdir(parents=True, exist_ok=True)
    final = folder / (name + '.jsonl')
    receipt = folder / (name + '.acquisition.json')
    if final.exists() and receipt.exists():
        return json.loads(receipt.read_text(encoding='utf-8'))
    service = BASE + name + '/FeatureServer/0'
    metadata = get_json(service + '?f=json')
    if metadata.get('error'):
        raise RuntimeError(str(metadata['error']))
    (folder / (name + '.metadata.json')).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    identifiers = get_json(service + '/query?' + urllib.parse.urlencode({'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'}))
    if identifiers.get('error'):
        raise RuntimeError(str(identifiers['error']))
    ids = sorted(identifiers.get('objectIds') or [])
    count = 0
    part = final.with_suffix('.jsonl.part')
    with part.open('w', encoding='utf-8') as output:
        for start in range(0, len(ids), 500):
            query = {'objectIds': ','.join(map(str, ids[start:start + 500])),
                     'outFields': '*', 'outSR': '4326', 'returnGeometry': 'true', 'f': 'geojson'}
            data = get_json(service + '/query?' + urllib.parse.urlencode(query))
            if data.get('error') or data.get('exceededTransferLimit'):
                raise RuntimeError('Layer did not supply the requested complete batch: ' + str(data.get('error')))
            for feature in data['features']:
                output.write(json.dumps(feature, ensure_ascii=False, separators=(',', ':')) + '\n')
                count += 1
            if start % 5000 == 0:
                print(f'{name}: archived {count:,} / {len(ids):,} records', flush=True)
    part.replace(final)
    result = {'layer': name, 'url': service, 'records_received': count,
              'object_ids_requested': len(ids), 'retrieved_at': datetime.now(timezone.utc).isoformat(),
              'copyright': metadata.get('copyrightText'),
              'license_note': 'NASA Landslide Viewer Permission to Use, Reproduce, and Distribute; retain original inventory attributions and notices.'}
    receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Archived NASA layer: ' + name, flush=True)
    return result


if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(acquire_layer, LAYERS):
            print(json.dumps(result), flush=True)
