"""Acquire the published S1/S2 vector inventory without downloading training imagery."""
import hashlib
import io
import json
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO.parent / 'research' / '2026-09-07-landslides' / 'raw' / '17007637'
OUT.mkdir(parents=True, exist_ok=True)


class RemoteArchive(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.position = url, size, 0

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        return self.position

    def read(self, size=-1):
        stop = self.size if size < 0 else min(self.size, self.position + size)
        if stop <= self.position:
            return b''
        request = urllib.request.Request(self.url, headers={'Range': f'bytes={self.position}-{stop - 1}'})
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status != 206:
                raise RuntimeError('The archive server does not provide selective range access.')
            data = response.read()
        self.position += len(data)
        return data


with urllib.request.urlopen('https://zenodo.org/api/records/17007637', timeout=90) as response:
    metadata = json.load(response)
(OUT / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
entry = next(item for item in metadata['files'] if item['key'] == 's1s2_landslide_reference_data.zip')
receipts = []
with zipfile.ZipFile(RemoteArchive(entry['links']['self'], entry['size'])) as archive:
    for member in archive.infolist():
        if '/vector_data/' not in member.filename or member.is_dir():
            continue
        if Path(member.filename).suffix.lower() not in ('.gpkg', '.txt'):
            continue
        target = OUT / Path(member.filename).name
        data = archive.read(member)
        target.write_bytes(data)
        receipt = {'member': member.filename, 'file': target.name, 'bytes': len(data),
                   'sha256': hashlib.sha256(data).hexdigest(), 'archive': entry['links']['self'],
                   'archive_checksum': entry.get('checksum')}
        receipts.append(receipt)
        print(json.dumps(receipt), flush=True)
readme = next(item for item in metadata['files'] if item['key'] == 'README.txt')
with urllib.request.urlopen(readme['links']['self'], timeout=90) as response:
    (OUT / 'README.txt').write_bytes(response.read())
(OUT / 'acquisition.json').write_text(json.dumps({'retrieved_at': datetime.now(timezone.utc).isoformat(),
    'record': 'https://zenodo.org/records/17007637', 'scope': 'Complete vector_data directory; imagery and training tensors omitted.',
    'files': receipts}, indent=2), encoding='utf-8')
