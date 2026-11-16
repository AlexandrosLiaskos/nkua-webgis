"""Derive display anchors for the existing marker UI, retaining regional provenance."""
import csv
import json
from pathlib import Path
from shapely.geometry import shape

root = Path(__file__).resolve().parents[1] / 'sites/floods/data/hanze/v2.1.1'
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
with (root / 'source-events.csv').open(encoding='utf-8-sig', newline='') as source:
    source_records = {row['ID']: row for row in csv.DictReader(source)}
bibliography = json.loads((root / 'bibliography.json').read_text(encoding='utf-8'))['records']
reference_links = [json.loads(line) for line in (root / 'reference-links.jsonl').read_text(encoding='utf-8').splitlines()]
bibliography_by_id = {row['No.']: row for row in bibliography}
links_by_label = {row['short_citation']: row for row in reference_links}
# Reviewed abbreviation/full-author matches in the supplied bibliography.
# Brakenridge (2022) is deliberately unresolved: bibliography entry 102 says 2017.
reviewed_reference_aliases = {'CRED (2023)': '135', 'UNDRR (2022)': '707', 'Papagiannaki et al. (2022)': '506'}


def source_fields(event_id):
    row = source_records[str(event_id)]
    citations = []
    for label in row['References'].split(';'):
        label = label.strip()
        link = links_by_label.get(label, {})
        numbers = link.get('bibliography_record_numbers', [])
        number = reviewed_reference_aliases.get(label)
        if not number and link.get('match_status') == 'unique_bibliographic_match' and len(numbers) == 1:
            number = numbers[0]
        if number:
            entry = bibliography_by_id[number]
            citations.append({'label': label, 'title': entry['Name'], 'url': entry['URL'], 'bibliography_record_number': number})
    return {
        'references': '; '.join(label.strip() for label in row['References'].split(';') if label.strip()),
        'flood_sources': row['Flood source'] or None,
        'regions_2010': row['Regions affected (v2010)'],
        'source_citations': citations,
    }
records = []
for country in manifest['countries']:
    collection = json.loads((root / country['file']).read_text(encoding='utf-8'))
    for feature in collection['features']:
        geometry = shape(feature['geometry'])
        component = max(geometry.geoms, key=lambda part: part.area) if geometry.geom_type == 'MultiPolygon' else geometry
        point = component.representative_point()
        records.append({
            **feature['properties'],
            **source_fields(feature['properties']['source_event_id']),
            'display_anchor': {'longitude': point.x, 'latitude': point.y},
            'display_anchor_basis': 'Map display anchor inside the largest polygon component by EPSG:4326 coordinate area. Not an observed flood location or an inundation boundary.',
            'geometry_file': country['file'],
            'geometry_feature_id': feature['id'],
        })
output = {'version': '2.1.1', 'source': manifest['source'], 'attribution': manifest['attribution'],
          'record_count': len(records), 'records': records}
(root / 'map-records.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Created a map index for {len(records)} source records with explicitly derived display anchors.')
