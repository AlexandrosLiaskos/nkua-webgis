"""Transform archived landslide inputs into a static, source-preserving catalogue.

Data processing only. This command does not run application checks or deploy.
"""
import csv
import argparse
import gzip
import hashlib
import io
import json
import math
import re
import sqlite3
import struct
import sys
import zipfile
import zlib
from collections import Counter
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORK = REPO.parent / 'research' / '2026-09-07-landslides'
sys.path.insert(0, str(WORK / 'python-packages'))
from shapely import wkt, from_wkb
from shapely.errors import GEOSException
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import CRS, Transformer
import shapefile

RAW = WORK / 'raw'
OUT = REPO / 'sites' / 'landslides' / 'data'
UNKNOWN = {'', 'ND', 'NAN', 'NONE', 'NULL', '-99999', '-99999.0', 'N/A'}
FIELDS = ['id', 'lon', 'lat', 'source', 'country', 'movement', 'factor',
          'kind', 'start', 'end', 'accuracy', 'reliability', 'precise', 'native_id', 'name']
PART_SIZE = 4000
DETAIL_SIZE = 200
CELL_DEGREES = 0.25
MODIFICATIONS = 'NKUA derivative: normalised attributes, WGS84 geometries, interior display anchors and spatial partitions. Preserve source citations and licences from manifest.json, including licenses/nasa-coolr.txt for NASA records.'
csv.field_size_limit(128 * 1024 * 1024)


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False, default=str)


def clean(value):
    if value is None:
        return None
    value = str(value).strip()
    return None if value.upper() in UNKNOWN else value


def number(value):
    value = clean(value)
    if value is None:
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def event_date(value):
    value = clean(value)
    if not value or value.startswith(('1678/01/01', '1678-01-01')):
        return None
    normalized = value[:10].replace('/', '-')
    try:
        return date.fromisoformat(normalized).isoformat()
    except ValueError:
        return None


def write_gzip(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, 'wt', encoding='utf-8', compresslevel=6) as output:
        output.write(dumps(value))


class Catalogue:
    def __init__(self):
        OUT.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(WORK / 'catalogue.sqlite')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=NORMAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, tile TEXT, source TEXT, country TEXT, movement TEXT, factor TEXT, kind TEXT, precise INTEGER, compact TEXT, detail BLOB)')
        self.db.execute('CREATE TABLE IF NOT EXISTS completed (input TEXT PRIMARY KEY, outcome TEXT)')
        self.sources = {}
        self.outcomes = []
        self.counter = self.db.execute('SELECT COALESCE(MAX(id),0) FROM records').fetchone()[0]
        self.batch = []
        self.source_file = WORK / 'source-registry.json'
        if self.source_file.exists():
            self.sources = json.loads(self.source_file.read_text(encoding='utf-8'))

    def register(self, native, family, **extra):
        key = family + '-' + hashlib.sha1(native.encode('utf-8')).hexdigest()[:12]
        defaults = ({'provider': 'UGLC / University of Bari and collaborators',
                     'url': 'https://zenodo.org/records/18643456', 'version': 'v2',
                     'license': 'CC BY-NC 4.0',
                     'license_url': 'https://creativecommons.org/licenses/by-nc/4.0/',
                     'paper': 'https://doi.org/10.5194/essd-18-4697-2026',
                     'evidence_note': 'Harmonised from the named original inventory. Mapping methods and completeness vary; the UGLC precision class is not independent validation.'}
                    if family == 'uglc' else
                    {'provider': 'University of Patras / HOMEROS',
                     'url': 'https://zenodo.org/records/18279421', 'version': 'v3',
                     'license': 'CC BY 4.0',
                     'license_url': 'https://creativecommons.org/licenses/by/4.0/',
                     'paper': 'https://doi.org/10.1007/s12665-018-8003-4',
                     'evidence_note': 'Published regional research archive. Per-file source metadata are retained; positional and temporal precision are not inferred from publication status.'})
        self.sources[key] = {'id': key, 'name': native, 'family': family, **defaults, **extra}
        return key

    def append(self, geometry, source, native_id, raw, country=None, movement=None,
               factor=None, start=None, end=None, accuracy=None, reliability=None,
               name=None, locator=None):
        if geometry.is_empty:
            raise ValueError('Empty source geometry')
        kind = 'footprint' if geometry.geom_type in ('Polygon', 'MultiPolygon') else 'point'
        if geometry.geom_type not in ('Point', 'MultiPoint', 'Polygon', 'MultiPolygon'):
            raise ValueError('Unsupported event geometry: ' + geometry.geom_type)
        point = geometry if geometry.geom_type == 'Point' else geometry.representative_point()
        lon, lat = float(point.x), float(point.y)
        if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError('Source coordinate cannot be mapped in WGS84')
        self.counter += 1
        ident = self.counter
        country = clean(country) or 'Not recorded'
        movement = clean(movement) or 'Not recorded'
        factor = clean(factor) or 'Not recorded'
        precise = int(start is not None and start == end and accuracy is not None and accuracy < 100)
        name = (clean(name) or movement)[:180]
        native_id = str(native_id)
        row = [ident, round(lon, 7), round(lat, 7), source, country, movement,
               factor, kind, start, end, accuracy, reliability, precise, native_id, name]
        detail = {'id': ident, 'source': source, 'native_id': native_id,
                  'source_locator': locator, 'geometry': mapping(geometry), 'summary': row,
                  'geometry_role': ('Original mapped footprint; map pin is a derived interior display anchor.'
                                    if kind == 'footprint' else 'Source point location; precision depends on the original inventory.'),
                  'original_attributes': raw,
                  'date_note': 'An interval can describe an inventory acquisition period. It is not necessarily the date of an individual landslide. The UGLC 1678-01-01 sentinel is treated as unknown.'}
        tile = f'{min(1439, int((lon + 180) / CELL_DEGREES))}_{min(719, int((lat + 90) / CELL_DEGREES))}'
        self.batch.append((ident, tile, source, country, movement, factor, kind, precise,
                           dumps(row), zlib.compress(dumps(detail).encode('utf-8'), 3)))
        if len(self.batch) >= 2500:
            self.flush()

    def flush(self):
        self.db.executemany('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)', self.batch)
        self.batch.clear()

    def begin(self, key):
        previous = self.db.execute('SELECT outcome FROM completed WHERE input=?', (key,)).fetchone()
        if previous:
            self.outcomes.append(json.loads(previous[0]))
            print('Using previously processed input: ' + key, flush=True)
            return False
        self.db.execute('BEGIN')
        return True

    def finish(self, key, outcome):
        self.flush()
        self.db.execute('INSERT INTO completed VALUES (?,?)', (key, dumps(outcome)))
        self.db.commit()
        self.source_file.write_text(dumps(self.sources), encoding='utf-8')
        self.outcomes.append(outcome)
        print(dumps(outcome), flush=True)

    def uglc(self, filename):
        path = RAW / '18643456' / filename
        if not path.exists():
            raise FileNotFoundError('Required complete source file not available: ' + str(path))
        if not self.begin(filename):
            return
        counts = Counter()
        examples = []
        with path.open(encoding='utf-8-sig', newline='') as handle:
            for ordinal, raw in enumerate(csv.DictReader(handle, delimiter='|'), 1):
                counts['source_rows'] += 1
                movement = clean(raw.get('TYPE'))
                if movement and movement.lower() in ('sinkhole', 'liquefaction'):
                    counts['other_ground_failure_rows'] += 1
                    continue
                try:
                    geometry = wkt.loads(raw['WKT_GEOM'])
                    source = self.register(clean(raw.get('OLD DATASET')) or 'Unspecified original inventory', 'uglc')
                    original = {k: v for k, v in raw.items() if k != 'WKT_GEOM'}
                    self.append(geometry, source, raw.get('OLD ID') or raw['ID'], original,
                                raw.get('COUNTRY'), movement, raw.get('PHYSICAL FACTORS'),
                                event_date(raw.get('START DATE')), event_date(raw.get('END DATE')),
                                number(raw.get('ACCURACY')), number(raw.get('RELIABILITY')),
                                name=clean(raw.get('NOTES')) or movement,
                                locator={'file': filename, 'row': ordinal, 'uglc_id': raw['ID']})
                    counts['mapped_rows'] += 1
                except (ValueError, TypeError, KeyError, GEOSException) as error:
                    # Keep the original archive and an explicit rejection trail; never invent geometry.
                    counts['unmapped_rows'] += 1
                    rejection = {'file': filename, 'row': ordinal, 'id': raw.get('ID'), 'reason': str(error)}
                    with (WORK / 'unmapped-records.jsonl').open('a', encoding='utf-8') as rejected:
                        rejected.write(dumps(rejection) + '\n')
                    if len(examples) < 5:
                        examples.append(rejection)
                if ordinal % 100000 == 0:
                    print(f'{filename}: processed {ordinal:,} source rows', flush=True)
        self.finish(filename, {'input': filename, **counts, 'unmapped_examples': examples})

    def greek(self):
        folder = RAW / '18279421'
        for archive in sorted(folder.glob('*.zip')):
            if not self.begin(archive.name):
                continue
            counts = Counter()
            included, contextual = [], []
            with zipfile.ZipFile(archive) as package:
                names = package.namelist()
                for member in names:
                    lower = Path(member).name.lower()
                    if not lower.endswith('.shp'):
                        continue
                    if 'landslide' not in lower or any(word in lower for word in ('hazard', 'suscept', 'zone')):
                        contextual.append(member)
                        continue
                    base = member[:-4]
                    parts = {extension: next((n for n in names if n.lower() == (base + extension).lower()), None)
                             for extension in ('.shp', '.shx', '.dbf', '.prj', '.cpg')}
                    if not parts['.prj']:
                        counts['layers_without_crs'] += 1
                        continue
                    source_crs = CRS.from_wkt(package.read(parts['.prj']).decode('utf-8-sig'))
                    transformer = Transformer.from_crs(source_crs, 'EPSG:4326', always_xy=True)
                    encoding = package.read(parts['.cpg']).decode().strip() if parts['.cpg'] else 'utf-8'
                    encoding = {'1253': 'cp1253', '1252': 'cp1252', '65001': 'utf-8'}.get(encoding, encoding)
                    reader = shapefile.Reader(shp=io.BytesIO(package.read(parts['.shp'])),
                                              shx=io.BytesIO(package.read(parts['.shx'])),
                                              dbf=io.BytesIO(package.read(parts['.dbf'])), encoding=encoding)
                    label = 'Northern Peloponnese / ' + archive.stem
                    metadata = {n: package.read(n).decode('utf-8', errors='replace') for n in names
                                if n.startswith(base) and n.lower().endswith(('.xml', '.html'))}
                    source = self.register(label, 'peloponnese', archive=archive.name,
                                           layer=member, source_crs=source_crs.to_string())
                    metadata_dir = OUT / 'metadata'
                    metadata_dir.mkdir(exist_ok=True)
                    (metadata_dir / (source + '.json')).write_text(dumps(metadata), encoding='utf-8')
                    for ordinal, record in enumerate(reader.iterShapeRecords(), 1):
                        counts['source_rows'] += 1
                        properties = record.record.as_dict()
                        try:
                            geom = transform(transformer.transform, shape(record.shape.__geo_interface__))
                            self.append(geom, source, ordinal, properties, country='Greece',
                                        name=archive.stem + ' / ' + str(ordinal),
                                        locator={'archive': archive.name, 'layer': member, 'row': ordinal})
                            counts['mapped_rows'] += 1
                        except (ValueError, TypeError) as error:
                            counts['unmapped_rows'] += 1
                            with (WORK / 'unmapped-records.jsonl').open('a', encoding='utf-8') as rejected:
                                rejected.write(dumps({'archive': archive.name, 'layer': member,
                                                       'row': ordinal, 'reason': str(error)}) + '\n')
                    included.append(member)
            self.finish(archive.name, {'input': archive.name, **counts,
                                      'event_layers': included, 'context_layers_not_counted': contextual})

    def nasa(self):
        for path in sorted((RAW / 'nasa-coolr').glob('*.jsonl')):
            key = path.stem
            if not self.begin(key):
                continue
            counts = Counter()
            metadata = json.loads(path.with_suffix('.metadata.json').read_text(encoding='utf-8'))
            for ordinal, line in enumerate(path.open(encoding='utf-8'), 1):
                feature = json.loads(line)
                properties = feature.get('properties') or {}
                counts['source_rows'] += 1
                category = clean(properties.get('landslide_category') or properties.get('TYPE'))
                if category and category.lower() in ('sinkhole', 'liquefaction'):
                    counts['other_ground_failure_rows'] += 1
                    continue
                if 'Events' in key:
                    native = clean(properties.get('event_title') or properties.get('inventory_name')) or key
                else:
                    native = clean(properties.get('event_import_source')) or 'Individual reports'
                source = self.register('NASA COOLR / ' + native, 'nasa',
                                       provider='NASA Goddard Space Flight Center and original inventory contributors',
                                       url='https://gpm.nasa.gov/applications/landslides/coolr',
                                       version='Public feature-service snapshot, 7 September 2026',
                                       license='NASA repository terms',
                                       license_url='https://landslides.nasa.gov/viewer',
                                       paper='https://doi.org/10.1371/journal.pone.0218657',
                                       evidence_note=('Direct COOLR snapshot. Report layers combine media, scientific and citizen sources; event inventories have their own mapping methods. Also overlaps with COOLR records in UGLC.'),
                                       service=metadata.get('name'), copyright=metadata.get('copyrightText'))
                try:
                    geom = shape(feature['geometry'])
                    timestamp = properties.get('event_date')
                    day = None
                    if isinstance(timestamp, (int, float)):
                        try:
                            day = (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=timestamp)).date().isoformat()
                        except (ValueError, OverflowError):
                            day = None
                    elif timestamp:
                        day = event_date(timestamp)
                    self.append(geom, source, properties.get('objectid') or ordinal,
                                properties, country=properties.get('country_name'), movement=category,
                                factor=properties.get('landslide_trigger'), start=day, end=day,
                                name=properties.get('event_title') or properties.get('location_description'),
                                locator={'layer': key, 'objectid': properties.get('objectid'), 'row': ordinal})
                    counts['mapped_rows'] += 1
                except (ValueError, TypeError, KeyError, GEOSException) as error:
                    counts['unmapped_rows'] += 1
                    with (WORK / 'unmapped-records.jsonl').open('a', encoding='utf-8') as rejected:
                        rejected.write(dumps({'layer': key, 'row': ordinal, 'reason': str(error)}) + '\n')
            self.finish(key, {'input': key, **counts})

    def reference(self):
        key = 'S1S2_reference_17007637'
        if not self.begin(key):
            return
        path = RAW / '17007637' / 'landslide_inventory.gpkg'
        original = sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True)
        original.row_factory = sqlite3.Row
        source = self.register('Sentinel-1 / Sentinel-2 landslide reference inventory', 's1s2',
            provider='Orynbaikyzy et al. / DLR and GFZ',
            url='https://zenodo.org/records/17007637', version='Zenodo record 17007637',
            license='CC BY 4.0', license_url='https://creativecommons.org/licenses/by/4.0/',
            paper='https://doi.org/10.1080/15481603.2025.2502214',
            evidence_note='Curated large-landslide reference inventory. Most locations were discovered through reports and visually interpreted using pre/post-event satellite imagery; the southern Kyrgyzstan subset draws on earlier studies and manual corrections. Includes human-induced mass movements. Selection favours large, observable events and is not globally complete. GeoPackage CRS metadata are used; the accompanying text reports a different CRS.')
        counts = Counter()
        for layer in original.execute('SELECT * FROM gpkg_geometry_columns'):
            table = '"' + layer['table_name'].replace('"', '""') + '"'
            for feature in original.execute('SELECT * FROM ' + table):
                counts['source_rows'] += 1
                raw = dict(feature)
                encoded = raw.pop(layer['column_name'])
                try:
                    if encoded[:2] != b'GP':
                        raise ValueError('Unsupported GeoPackage geometry encoding')
                    flags = encoded[3]
                    envelope = (flags >> 1) & 7
                    offset = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]
                    srs = struct.unpack('<i' if flags & 1 else '>i', encoded[4:8])[0]
                    geometry = from_wkb(encoded[offset:])
                    if srs != 4326:
                        transformer = Transformer.from_crs('EPSG:' + str(srs), 'EPSG:4326', always_xy=True)
                        geometry = transform(transformer.transform, geometry)
                    day = event_date(raw.get('date'))
                    self.append(geometry, source, raw['fid'], raw, country=raw.get('country'),
                        movement=raw.get('ls_type'), factor=raw.get('trigger'), start=day, end=day,
                        name=' / '.join(str(value) for value in [raw.get('region'), raw.get('EID')] if value),
                        locator={'file': path.name, 'layer': layer['table_name'], 'fid': raw['fid'], 'geometry_srs_id': srs})
                    counts['mapped_rows'] += 1
                except (ValueError, TypeError, KeyError, GEOSException) as error:
                    counts['unmapped_rows'] += 1
                    with (WORK / 'unmapped-records.jsonl').open('a', encoding='utf-8') as rejected:
                        rejected.write(dumps({'input': key, 'fid': raw.get('fid'), 'reason': str(error)}) + '\n')
        original.close()
        self.finish(key, {'input': key, **counts})

    def export(self):
        self.db.execute('CREATE INDEX IF NOT EXISTS records_tile ON records(tile,id)')
        self.db.commit()
        withheld_name = 'French Landslide Observatory – OMIV (Temporary data)'
        withheld_id = 'uglc-' + hashlib.sha1(withheld_name.encode('utf-8')).hexdigest()[:12]
        withheld_count = self.db.execute('SELECT COUNT(*) FROM records WHERE source=?', (withheld_id,)).fetchone()[0]
        self.db.execute("CREATE TEMP VIEW published_records AS SELECT * FROM records WHERE source != '" + withheld_id + "' AND source NOT LIKE 's1s2-%'")
        tiles = []

        def emit_tile(tile, bbox, rows, depth=0):
            # Subdivide dense areas so zooming can always reduce the records fetched.
            if len(rows) > 20000 and depth < 12:
                west, south, east, north = bbox
                mid_lon, mid_lat = (west + east) / 2, (south + north) / 2
                buckets = [[], [], [], []]
                for row in rows:
                    buckets[int(row[1] >= mid_lon) + 2 * int(row[2] >= mid_lat)].append(row)
                boxes = [[west, south, mid_lon, mid_lat], [mid_lon, south, east, mid_lat],
                         [west, mid_lat, mid_lon, north], [mid_lon, mid_lat, east, north]]
                for index, bucket in enumerate(buckets):
                    if bucket:
                        emit_tile(tile + '-' + str(index), boxes[index], bucket, depth + 1)
                return
            files = []
            for start in range(0, len(rows), PART_SIZE):
                filename = f'tiles/{tile}-{len(files)}.json.gz'
                write_gzip(OUT / filename, {'modifications': MODIFICATIONS, 'records': rows[start:start + PART_SIZE]})
                files.append(filename)
            grouped = Counter((row[3], row[4], row[5], row[6], row[7], row[12], row[8], row[9]) for row in rows)
            groups = [list(group) + [count] for group, count in grouped.items()]
            tiles.append({'id': tile, 'bbox': bbox, 'count': len(rows), 'files': files, 'groups': groups})

        for tile, count in self.db.execute('SELECT tile,COUNT(*) FROM published_records GROUP BY tile'):
            x, y = map(int, tile.split('_'))
            rows = [json.loads(row[0]) for row in self.db.execute('SELECT compact FROM published_records WHERE tile=? ORDER BY id', (tile,))]
            emit_tile(tile, [x * CELL_DEGREES - 180, y * CELL_DEGREES - 90, (x + 1) * CELL_DEGREES - 180, (y + 1) * CELL_DEGREES - 90], rows)
        print(f'Wrote map partitions for {len(tiles)} geographic cells.', flush=True)
        current, writer, first = None, None, True
        details_dir = OUT / 'records'
        details_dir.mkdir(exist_ok=True)
        try:
            for ident, detail in self.db.execute('SELECT id,detail FROM published_records ORDER BY id'):
                shard = (ident - 1) // DETAIL_SIZE
                if shard != current:
                    if writer:
                        writer.write('}')
                        writer.close()
                    writer = gzip.open(details_dir / f'{shard}.json.gz', 'wt', encoding='utf-8', compresslevel=5)
                    writer.write('{"modifications":' + dumps(MODIFICATIONS))
                    first, current = False, shard
                writer.write(('' if first else ',') + '"' + str(ident) + '":' + zlib.decompress(detail).decode('utf-8'))
                first = False
        finally:
            if writer:
                writer.write('}')
                writer.close()
        counts = dict(self.db.execute('SELECT kind,COUNT(*) FROM published_records GROUP BY kind'))
        source_counts = {}
        for source, kind, count in self.db.execute('SELECT source,kind,COUNT(*) FROM published_records GROUP BY source,kind'):
            source_counts.setdefault(source, {})[kind] = count
        supplements = json.loads((OUT / 'source-bibliography.json').read_text(encoding='utf-8'))
        for source in self.sources.values():
            source['counts'] = source_counts.get(source['id'], {})
            source.update(supplements.get('families', {}).get(source['family'], {}))
            source.update(supplements.get('inventories', {}).get(source['name'], {}))
            if source['family'] == 'uglc' and not source.get('original_source_url'):
                for reference in supplements.get('uglc_reference_patterns', []):
                    if reference['contains'] in source['name'].lower():
                        source['original_source_url'] = reference['url']
                        break
        manifest = {'schema_version': 1, 'prepared_at': datetime.now(timezone.utc).isoformat(),
                    'fields': FIELDS, 'group_fields': ['source','country','movement','factor','kind','precise','start','end','count'],
                    'detail_shard_size': DETAIL_SIZE, 'cell_degrees': CELL_DEGREES, 'counts': counts,
                    'sources': [source for source in self.sources.values() if sum(source['counts'].values())], 'tiles_file': 'coverage.json.gz',
                    'countries': [row[0] for row in self.db.execute('SELECT DISTINCT country FROM published_records ORDER BY country')],
                    'movements': [row[0] for row in self.db.execute('SELECT DISTINCT movement FROM published_records ORDER BY movement')],
                    'factors': [row[0] for row in self.db.execute('SELECT DISTINCT factor FROM published_records ORDER BY factor')],
                    'inputs': [outcome for outcome in self.outcomes if outcome['input'] != 'S1S2_reference_17007637'],
                    'withheld_from_occurrence_map': [{'source': withheld_name, 'records': withheld_count,
                        'reason': 'The native reference describes a seismic monitoring network. These entries require clarification before interpretation as distinct landslide occurrences.'}],
                    'modifications': MODIFICATIONS,
                    'counting_note': 'Counts describe source records/representations, not distinct disasters. Point and polygon catalogues and different native inventories can overlap.',
                    'precision_note': 'The precise filter selects reported positional accuracy below 100 m and a single non-sentinel date. It is not a quality certification.',
                    'licensing_note': 'UGLC-derived data: CC BY-NC 4.0. Peloponnese data: CC BY 4.0. NASA data retain the accompanying repository permission notice. Consult each source before reuse.'}
        write_gzip(OUT / 'coverage.json.gz', {'modifications': MODIFICATIONS, 'tiles': tiles})
        (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        (WORK / 'processing-outcomes.json').write_text(json.dumps({'counts': counts, 'inputs': self.outcomes, 'withheld': manifest['withheld_from_occurrence_map']},
                                                                ensure_ascii=False, indent=2), encoding='utf-8')
        print('Data preparation finished: ' + dumps(counts), flush=True)
        bins = Counter()
        for tile in tiles:
            west, south, east, north = tile['bbox']
            bins[(int(((west + east) / 2 + 180) // 2), int(((south + north) / 2 + 90) // 2))] += tile['count']
        circles = []
        for (x, y), count in bins.items():
            px, py = 60 + (x * 2 + 1) / 360 * 1160, 92 + (180 - y * 2 - 1) / 180 * 540
            radius = 1.2 + min(5, math.log10(count + 1)) * .7
            circles.append(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="{radius:.2f}"/>')
        (OUT.parent / 'map-preview.svg').write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">'
            '<rect width="1280" height="720" fill="#f1f3ed"/><text x="60" y="62" fill="#252c23" font-family="Georgia,serif" font-size="32">Landslides of Earth</text>'
            '<g fill="#495540" fill-opacity=".6">' + ''.join(circles) + '</g>'
            '<text x="60" y="682" fill="#50584b" font-family="sans-serif" font-size="15">Global source coverage · UGLC, NASA COOLR and Greek research inventories</text></svg>', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inputs', nargs='+', choices=['greek', 'nasa', 'point', 'polygon', 'reference'], default=['greek', 'nasa', 'point', 'polygon'])
    parser.add_argument('--no-export', action='store_true')
    parser.add_argument('--refresh-nasa', action='store_true', help='Replace the locally processed NASA snapshot from its archived inputs.')
    parser.add_argument('--retry-empty-greek', action='store_true', help='Process Greek archives previously classified as containing no event layers.')
    args = parser.parse_args()
    catalogue = Catalogue()
    if args.refresh_nasa:
        catalogue.db.execute("DELETE FROM records WHERE source LIKE 'nasa-%'")
        catalogue.db.execute("DELETE FROM completed WHERE input LIKE 'COOLR_%'")
        catalogue.db.commit()
    if args.retry_empty_greek:
        for key, outcome in catalogue.db.execute('SELECT input,outcome FROM completed').fetchall():
            prior = json.loads(outcome)
            if key.endswith('.zip') and prior.get('event_layers') == [] and not prior.get('mapped_rows'):
                catalogue.db.execute('DELETE FROM completed WHERE input=?', (key,))
        catalogue.db.commit()
    for kind in args.inputs:
        if kind == 'greek': catalogue.greek()
        elif kind == 'nasa': catalogue.nasa()
        elif kind == 'reference': catalogue.reference()
        elif kind == 'point': catalogue.uglc('UGLC_point.csv')
        else: catalogue.uglc('UGLC_poly.csv')
    if not args.no_export:
        catalogue.export()
        import runpy
        runpy.run_path(str(Path(__file__).with_name('statistics.py')), run_name='__main__')
