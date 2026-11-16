"""Prepare public provenance metadata and the local release note from ingestion outcomes."""
import json
import shutil
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORK = REPO.parent / 'research' / '2026-09-07-landslides'
DATA = REPO / 'sites' / 'landslides' / 'data'
manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
bibliography = json.loads((DATA / 'source-bibliography.json').read_text(encoding='utf-8'))

for source in manifest['sources']:
    if source['family'] == 'uglc' and not source.get('original_source_url'):
        for reference in bibliography.get('uglc_reference_patterns', []):
            if reference['contains'] in source['name'].lower():
                source['original_source_url'] = reference['url']
                break

metadata_dir = DATA / 'metadata'
metadata_dir.mkdir(exist_ok=True)
metadata_index = []
for record in ('18643456', '18279421', 'usgs-v3'):
    source = WORK / 'raw' / record / 'repository-metadata.json'
    if source.exists():
        target = metadata_dir / (record + '-repository.json')
        shutil.copyfile(source, target)
        metadata_index.append({'source': record, 'file': 'metadata/' + target.name})
for source in (WORK / 'raw' / 'nasa-coolr').glob('*.metadata.json'):
    target = metadata_dir / source.name
    shutil.copyfile(source, target)
    metadata_index.append({'source': 'NASA COOLR', 'file': 'metadata/' + target.name})

receipts = []
for source in (WORK / 'raw').glob('*/*.acquisition.json'):
    receipt = json.loads(source.read_text(encoding='utf-8'))
    receipt.pop('local_file', None)
    receipts.append(receipt)
(DATA / 'provenance.json').write_text(json.dumps({'metadata': metadata_index, 'acquisition_receipts': receipts,
    'note': 'Acquisition metadata and processing outcomes document source retrieval and transformation. They do not establish independent accuracy or unique-event counts.'}, ensure_ascii=False, indent=2), encoding='utf-8')
manifest['provenance_file'] = 'provenance.json'
(DATA / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

families = defaultdict(Counter)
for source in manifest['sources']:
    families[source['family']].update(source['counts'])
names = {'uglc': 'UGLC v2', 'nasa': 'NASA COOLR direct snapshot', 'peloponnese': 'Northern Peloponnese v3'}
lines = [
    '# Landslides & Mass Movements — local collection, 7 September 2026', '',
    'Implemented locally in `sites/landslides/`, with a homepage catalogue entry and the internal nginx route `/landslides/`. No deployment has been performed.', '',
    'The map provides global coverage, filters by native inventory, collection, country, movement, physical factor, year and reported precision, and record details with original geometry, attributes, references and licences. CSV export covers the currently loaded filtered area; each selected record can be downloaded as GeoJSON.', '',
    '## Prepared records', '',
    '| Collection | Point records | Footprint records |',
    '|---|---:|---:|'
]
for family in ('uglc', 'nasa', 'peloponnese'):
    counts = families[family]
    lines.append(f"| {names[family]} | {counts['point']:,} | {counts['footprint']:,} |")
lines += [f"| Total source representations | {manifest['counts'].get('point', 0):,} | {manifest['counts'].get('footprint', 0):,} |", '',
    '**These are source records, not unique landslides or disasters.** NASA/UGLC and other inventories overlap, and points and polygons can represent the same landslide. No deduplication by proximity or summation of casualties is performed.', '',
    '## Ingestion outcomes', '',
    '| Input | Source rows | Mapped before editorial exclusions | Unmappable rows | Other ground failures omitted |',
    '|---|---:|---:|---:|---:|'
]
for outcome in manifest['inputs']:
    lines.append(f"| {outcome['input']} | {outcome.get('source_rows', 0):,} | {outcome.get('mapped_rows', 0):,} | {outcome.get('unmapped_rows', 0):,} | {outcome.get('other_ground_failure_rows', 0):,} |")
lines += ['', 'Original archives remain intact. Unmappable rows are recorded in `../research/2026-09-07-landslides/unmapped-records.jsonl`; their coordinates are not invented or silently repaired. Published headline counts can differ from the actual versioned files. The figures above come from processing the downloaded files.', '']
for item in manifest.get('withheld_from_occurrence_map', []):
    lines.append(f"- {item['source']}: {item['records']:,} records retained in the raw archive and processing database but withheld from the occurrence map. {item['reason']}")
lines += ['', '## Sources and scientific interpretation', '',
    '- [UGLC v2 data](https://zenodo.org/records/18643456) and [Mancino et al. (2026)](https://doi.org/10.5194/essd-18-4697-2026): complete point and polygon CSVs. Retains native inventory IDs, dataset versions and attributes. CC BY-NC 4.0.',
    '- [NASA COOLR](https://gpm.nasa.gov/applications/landslides/coolr): four public report/event point/polygon layers, with individual source attributions. Native feature identity uses layer + object ID; an event ID can be shared by multiple footprints. The complete repository permission notice is retained at `sites/landslides/data/licenses/nasa-coolr.txt` and included in NASA record downloads.',
    '- [Northern Peloponnese v3](https://zenodo.org/records/18279421): Aigio–Derveni, Glafkos, Peneus and Xerias event layers. The archives also contain hazard, flood and contextual layers, which are not counted as landslide occurrences. CC BY 4.0. Regional, not national, coverage.',
    '- UGLC precision classes describe reported spatial/temporal precision, not independent validation. The optional precision filter requires accuracy below 100 m and equal non-sentinel start/end dates. It does not certify accuracy or rank publication quality.',
    '- The UGLC 1678-01-01 placeholder is interpreted as unknown; date intervals can describe survey coverage. No event date is inferred from a repository publication date.',
    '- Polygons are retained without simplification; pins represent derived interior anchors. Coverage circles summarise records and are not affected-area or hazard estimates.', '',
    '## Access limits retained in the source register', '',
    '- USGS national inventory v3: CC0 release identified; public metadata, ancillary data and reference files acquired. The bulk geometry file returned the File Manager HTML page, and its download-resolution API required authentication. No authentication was attempted and v3 geometries are not included. UGLC preserves its earlier USGS inventory versions.',
    '- CLIMPACT / National Observatory of Athens Western Greece data: download endpoints returned expired TLS-certificate errors. The published description mixes landslide and non-landslide training samples; these have not been imported as occurrences.',
    '- ELSUS v2: registration/request required and a susceptibility model, not an event inventory. No request submitted.',
    '- HSGME national bulk data and direct Lefkada case-study redistribution: access/licence issues remain unresolved; no request or contact was sent.', '',
    '## Local processing and maintenance', '',
    'Python dependencies are pinned in `tools/landslides/requirements.txt` and were installed only into `../research/2026-09-07-landslides/python-packages`. Raw downloads, acquisition receipts, source metadata and the SQLite processing database are outside the served site. Source snapshots are fixed to this research release; changing a source version requires a new release and explicit provenance.', '',
    'Data preparation commands, from this repository:', '',
    '```powershell',
    '$landslidePython = "C:\\Users\\alexl\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe"',
    '& $landslidePython tools/landslides/acquire.py',
    '& $landslidePython tools/landslides/acquire_nasa.py',
    '& $landslidePython tools/landslides/acquire_reference.py',
    '& $landslidePython tools/landslides/prepare.py',
    '& $landslidePython tools/landslides/document.py',
    '```', '',
    '`acquire_usgs.py` records the separately documented v3 access limitation; it is not an input to the prepared occurrence map. Acquisition routines reject mismatched payload sizes during transfer, rather than treating a download-page response as dataset content.', '',
    'Static data use compressed geographic partitions, a filtered coverage index and 200-record detail shards. Dense 0.25-degree cells subdivide further. The browser loads detailed areas with at most 60,000 candidate records and caches a bounded number of files. Full source geometry is retrieved only when a record is selected. Current browsers with DecompressionStream support are required. Leaflet, CARTO/OSM basemaps and Google Fonts are external dependencies.', '',
    '## Publication boundary', '',
    'This release remains local. The shared COMS outer proxy must route `/landslides/` to the WebGIS upstream when publication is separately requested. Its configuration has not been changed. The existing WebGIS ship wrapper packages committed HEAD, not uncommitted working files, and the site is baked into the web image. The large prepared static data therefore need an explicit packaging decision at publication time. No database migration is needed.', '',
    'No tests, builds, linters, type checks, Git status/diff checks, browser/visual checks or post-write verification were run, following the user’s instructions. Processing completion is not a claim that application behavior was tested.', '',
    'Public provenance: `sites/landslides/data/manifest.json`, `provenance.json`, `source-access.json` and `source-bibliography.json`.', ''
]
release = REPO / 'docs' / 'releases' / '2026-09-07-landslides.md'
release.write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps({'release_note': str(release), 'counts': manifest['counts'],
                  'source_entries': len(manifest['sources']), 'families': dict(families),
                  'withheld': manifest.get('withheld_from_occurrence_map')}, ensure_ascii=False), flush=True)
