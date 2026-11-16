"""Download versioned public research inputs; never touches the live services."""
import concurrent.futures
import hashlib
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORK = REPO.parent / 'research' / '2026-09-07-landslides'
RAW = WORK / 'raw'
RECORDS = {'18643456': {'UGLC_point.csv', 'UGLC_poly.csv'},
           '18279421': {'Peneus River Elis.zip', 'Aigio-Derveni.zip',
                        'Xerias River Corinth.zip', 'Glafkos River Landslides.zip'}}
HEADERS = {'User-Agent': 'NKUA-GeoCollections-research/1.0'}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=120) as response:
        return json.load(response)


def download(job):
    record_id, item = job
    destination = RAW / record_id / item['key']
    destination.parent.mkdir(parents=True, exist_ok=True)
    receipt = destination.with_name(destination.name + '.acquisition.json')
    if destination.exists() and receipt.exists():
        previous = json.loads(receipt.read_text(encoding='utf-8'))
        if previous.get('bytes_received') == item['size']:
            print('Reusing archived input: ' + item['key'], flush=True)
            return previous
    part = destination.with_name(destination.name + '.part')
    url = item['links']['self']
    start = time.monotonic()
    digest = hashlib.sha256()
    count = 0
    last_progress = 0
    request = urllib.request.Request(url, headers=HEADERS)
    print('Downloading ' + item['key'], flush=True)
    with urllib.request.urlopen(request, timeout=180) as response, part.open('wb') as output:
        while chunk := response.read(4 * 1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
            count += len(chunk)
            if count - last_progress >= 64 * 1024 * 1024:
                print(f"{item['key']}: received {count:,} of {item['size']:,} bytes", flush=True)
                last_progress = count
    if count != item['size']:
        raise RuntimeError(f"{item['key']}: received {count:,} bytes; the publisher describes {item['size']:,}. The response remains a partial input and is not imported.")
    part.replace(destination)
    result = {'record_id': record_id, 'file': item['key'], 'url': url,
              'bytes_received': count, 'publisher_bytes': item['size'],
              'publisher_checksum': item.get('checksum'), 'sha256': digest.hexdigest(),
              'retrieved_at': datetime.now(timezone.utc).isoformat(),
              'local_file': str(destination), 'seconds': round(time.monotonic() - start, 1)}
    receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Archived {item['key']}: {count:,} bytes", flush=True)
    return result


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    jobs = []
    for record_id, wanted in RECORDS.items():
        meta = get_json('https://zenodo.org/api/records/' + record_id)
        (RAW / record_id).mkdir(exist_ok=True)
        (RAW / record_id / 'repository-metadata.json').write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
        jobs.extend((record_id, item) for item in meta['files'] if item['key'] in wanted)
    results, failures = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pending = {pool.submit(download, job): job for job in jobs}
        for future in concurrent.futures.as_completed(pending):
            try:
                results.append(future.result())
            except Exception as error:
                record_id, item = pending[future]
                failures.append({'record_id': record_id, 'file': item['key'], 'error': str(error)})
                print(f"Acquisition failed for {item['key']}: {error}", flush=True)
    (WORK / 'acquisition.json').write_text(json.dumps({'files': results, 'failures': failures},
                                                    ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Acquisition finished: {len(results)} files archived, {len(failures)} failures.', flush=True)
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
