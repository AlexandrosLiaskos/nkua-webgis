"""Add the prepared Greek HANZE records and their original GIS geometry to the map."""
import argparse
import json
import runpy
from pathlib import Path

import fiona
from fiona.model import to_dict
from fiona.transform import transform_geom

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--records', type=Path, required=True)
parser.add_argument('--geometry', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / 'sites/floods/data/hanze/v2.1.1'
records = {record['source_event_id']: record for record in
           (json.loads(line) for line in args.records.read_text(encoding='utf-8').splitlines() if line.strip())}

features = []
with fiona.open('zip://' + args.geometry.resolve().as_posix()) as layer:
    for source in layer:
        record = records.get(str(source['properties']['ID']))
        if record is None:
            continue
        properties = {key: record[key] for key in (
            'record_id', 'source_event_id', 'country_name_source', 'country_code_source',
            'year', 'event_type_source', 'geometry_role', 'source_url', 'publication_doi', 'license')}
        properties.update(
            start_date=record['time']['start'], end_date=record['time']['end'],
            date_precision=record['time']['precision'],
            regions_2021='; '.join(region['code'] + ' ' + (region['name'] or '') for region in record['regions_2021']),
            references='; '.join(record['references_source']),
            cause=record['cause_source'], notes=record['notes_source'], **record['impacts'])
        features.append({'type': 'Feature', 'id': record['record_id'], 'properties': properties,
                         'geometry': to_dict(transform_geom(layer.crs, 'EPSG:4326', source['geometry']))})

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
attribution = 'Paprotny (dataset v2.1.1); Paprotny, Terefenko and Śledziowski (2024). CC BY 4.0. Geometry transformed from EPSG:3035 to EPSG:4326.'
write_json(root / 'EL.geojson', {
    'type': 'FeatureCollection', 'name': 'HANZE v2.1.1 — Greece',
    'description': 'Source flood records represented by affected administrative regions, not inundation boundaries. Reported area is a source statistic, not polygon area. Wider episodes may have several records.',
    'source': manifest['source']['url'], 'attribution': attribution, 'features': features,
})
years = [feature['properties']['year'] for feature in features]
countries = [country for country in manifest['countries'] if country['code'] != 'EL']
countries.append({'code': 'EL', 'name': 'Greece', 'records': len(features),
                  'first_year': min(years), 'last_year': max(years), 'file': 'EL.geojson'})
manifest.update(countries=sorted(countries, key=lambda country: country['name']),
                record_count=sum(country['records'] for country in countries), attribution=attribution,
                selection='All HANZE source-country records, including Greece. Confirmed shared-event evidence is retained with NKUA; unresolved source records are not automatically merged.')
write_json(root / 'manifest.json', manifest)
runpy.run_path(str(Path(__file__).with_name('create-hanze-map-index.py')), run_name='__main__')
