"""Archive the current published US national inventory and its provenance files."""
import concurrent.futures
import json
from acquire import RAW, get_json, download

record = '671eef1fd34ed0f827ea9f12'
metadata = get_json('https://www.sciencebase.gov/catalog/item/' + record + '?format=json')
folder = RAW / 'usgs-v3'
folder.mkdir(parents=True, exist_ok=True)
(folder / 'repository-metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
jobs = []
for item in metadata['files']:
    name = item['name']
    if name in ('US_Landslide_v3_shp.zip', 'US_Landslide_v3_ancillary.zip') or not name.endswith('.zip'):
        jobs.append(('usgs-v3', {'key': name, 'size': item['size'], 'checksum': item.get('checksum'),
                                 'links': {'self': item['downloadUri']}}))
outcomes, failures = [], []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    pending = {pool.submit(download, job): job for job in jobs}
    for future in concurrent.futures.as_completed(pending):
        try:
            outcomes.append(future.result())
        except Exception as error:
            failures.append({'file': pending[future][1]['key'], 'reason': str(error)})
            print(str(error), flush=True)
(folder / 'acquisition.json').write_text(json.dumps({'files': outcomes, 'failures': failures}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'USGS acquisition: {len(outcomes)} files archived, {len(failures)} unavailable.', flush=True)
if failures:
    raise SystemExit(1)
