"""Publish numerical observations without changing source geometries or records."""
import gzip
import json
import math
import sqlite3
import sys
import zlib
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORK = REPO.parent / 'research' / '2026-09-07-landslides'
OUT = REPO / 'sites' / 'landslides' / 'data'
sys.path.insert(0, str(WORK / 'python-packages'))
from pyproj import Geod
from shapely.geometry import shape


def publish():
    manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
    with gzip.open(OUT / manifest['tiles_file'], 'rt', encoding='utf-8') as stream:
        coverage = json.load(stream)
    sources = {source['id'] for source in manifest['sources']}
    groups = defaultdict(list)
    group_id = 0
    for tile in coverage['tiles']:
        for group in tile['groups']:
            if group[0] not in sources:
                continue
            groups[(tile['id'].split('-')[0], *group[:8])].append((group_id, tile['bbox']))
            group_id += 1

    destination = OUT / 'statistics'
    destination.mkdir(exist_ok=True)
    keys = ['footprintArea', 'footprintPerimeter', 'accuracy']
    streams = {key: gzip.open(destination / (key + '.json.gz.tmp'), 'wt', encoding='utf-8', compresslevel=6) for key in keys}
    counts = Counter()
    omitted = Counter()
    geod = Geod(ellps='WGS84')

    def emit(key, ident, group, value):
        if value is None or not math.isfinite(value) or value < 0:
            return
        if counts[key]:
            streams[key].write(',')
        streams[key].write(json.dumps([ident, group, value], separators=(',', ':')))
        counts[key] += 1

    for stream in streams.values():
        stream.write('{"fields":["record_id","coverage_group","value"],"records":[')
    database = sqlite3.connect((WORK / 'catalogue.sqlite').as_uri() + '?mode=ro', uri=True)
    try:
        for index, (ident, tile, source, compact, blob) in enumerate(database.execute('SELECT id,tile,source,compact,detail FROM records ORDER BY id'), 1):
            if source not in sources:
                continue
            row = json.loads(compact)
            candidates = groups.get((tile, row[3], row[4], row[5], row[6], row[7], row[12], row[8], row[9]), [])
            group = next((gid for gid, box in candidates if box[0] <= row[1] < box[2] and box[1] <= row[2] < box[3]), None)
            if group is None:
                raise ValueError(f'Published record {ident} has no coverage group')
            emit('accuracy', ident, group, row[10])
            if row[7] == 'footprint':
                try:
                    geometry = shape(json.loads(zlib.decompress(blob))['geometry'])
                    if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ('Polygon', 'MultiPolygon'):
                        omitted['invalid_or_nonpolygon'] += 1
                        continue
                    area = perimeter = 0.0
                    polygons = geometry.geoms if geometry.geom_type == 'MultiPolygon' else [geometry]
                    for polygon in polygons:
                        lon, lat = zip(*[(point[0], point[1]) for point in polygon.exterior.coords])
                        exterior_area, exterior_length = geod.polygon_area_perimeter(lon, lat)
                        polygon_area = abs(exterior_area)
                        perimeter += exterior_length
                        for ring in polygon.interiors:
                            lon, lat = zip(*[(point[0], point[1]) for point in ring.coords])
                            hole_area, hole_length = geod.polygon_area_perimeter(lon, lat)
                            polygon_area -= abs(hole_area)
                            perimeter += hole_length
                        area += polygon_area
                    if area > 0 and perimeter > 0 and math.isfinite(area) and math.isfinite(perimeter):
                        emit('footprintArea', ident, group, float(f'{area / 1e6:.10g}'))
                        emit('footprintPerimeter', ident, group, round(perimeter, 3))
                    else:
                        omitted['unusable_measurement'] += 1
                except (ValueError, TypeError, KeyError, OverflowError):
                    omitted['unreadable_geometry'] += 1
            if index % 100000 == 0:
                print(f'Processed {index:,} records; numerical observations: {dict(counts)}', flush=True)
    finally:
        database.close()
        for stream in streams.values():
            stream.write(']}')
            stream.close()

    for key in keys:
        (destination / (key + '.json.gz.tmp')).replace(destination / (key + '.json.gz'))
    metadata = {
        'prepared_at': datetime.now(timezone.utc).isoformat(),
        'coverage_file': manifest['tiles_file'], 'coverage_groups': group_id,
        'record_fields': ['record_id', 'coverage_group', 'value'],
        'variables': {key: {'file': f'statistics/{key}.json.gz', 'count': counts[key]} for key in keys},
        'methods': {
            'footprintArea': 'WGS84 ellipsoidal area of the original valid polygon or multipolygon, excluding holes, in km². Invalid, empty and nonpolygon geometries are excluded. This is mapped footprint area, not displaced volume, runout distance or a deduplicated affected area.',
            'footprintPerimeter': 'WGS84 ellipsoidal length of all exterior and interior footprint rings in metres. Sensitive to mapping resolution and fragmentation; not runout distance.',
            'accuracy': 'Nonnegative location accuracy in metres as supplied in the compact source record. The interface charts only positive values: zero codes do not demonstrate measured zero positional error. Extreme source values are retained on a logarithmic scale. This is reported precision, not independently measured error.'
        },
        'excluded_footprints': dict(omitted),
        'counting_note': manifest['counting_note'],
        'reuse': 'Source terms in ../manifest.json and the NASA notice in ../licenses/nasa-coolr.txt apply. Numerical geometry measurements are NKUA derivatives; source geometry remains unchanged.'
    }
    (destination / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Published numerical observations: {dict(counts)}; omitted footprints: {dict(omitted)}', flush=True)


if __name__ == '__main__':
    publish()
