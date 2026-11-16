"""Shared static collection preparation using the established landslide shell."""
import csv
import gzip
import html
import json
import re
import shutil
from pathlib import Path
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parents[2]

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if path.suffix == '.gz':
        with gzip.open(path, 'wb', compresslevel=6) as out:
            out.write(data)
    else:
        path.write_bytes(data)

def number(value, nonnegative=False):
    try:
        result = float(value)
        if result != result or abs(result) == float('inf') or (nonnegative and result < 0):
            return None
        return int(result) if result.is_integer() else result
    except (ValueError, TypeError):
        return None

def clean(value):
    return html.unescape(re.sub(r'<[^>]+>', ' ', str(value or ''))).strip()

def date_label(year, month=None, day=None):
    if year is None:
        return ''
    suffix = ' BCE' if year < 0 else ''
    return str(abs(int(year))) + (f'-{int(month):02d}' if month else '') + (f'-{int(day):02d}' if month and day else '') + suffix

def field(key, label, description, unit=None, categorical=False, group=None, **kwargs):
    return dict(key=key, label=label, description=description, type='categorical' if categorical else 'numeric', **({'unit':unit} if unit else {}), group=group or ('Provenance' if categorical else 'Measurements'), **kwargs)

def prepare(config, rows, details):
    site = REPO / 'sites' / config['slug']
    site.mkdir(parents=True, exist_ok=True)
    config['shardSize'] = 250
    config['acquired'] = '7 September 2026'
    config['preparedAt'] = datetime.now(timezone.utc).isoformat()
    config['recordCount'] = len(rows)
    write_json(site / 'data/manifest.json', config)
    write_json(site / 'data/catalogue.json.gz', {'records': rows})
    if details is not None:
        for offset in range(0, len(rows), config['shardSize']):
            write_json(site / f'data/records/{offset // config["shardSize"]}.json.gz', {r['id']:details[r['id']] for r in rows[offset:offset+config['shardSize']]})
    render_shell(config, site)
    print(config['slug'], 'prepared', len(rows), 'source records', flush=True)

def render_shell(config, site):
    title, slug, singular = config['title'], config['slug'], config['singular']
    h = (REPO / 'sites/landslides/index.html').read_text(encoding='utf-8')
    h = h.replace('landslides', slug).replace('landslide', 'hazard').replace('Landslides', title).replace('Landslide', singular.title())
    h = h.replace(f'./{slug}.css?v=20260907-8', './collection.css?v=20260907-1')
    h = h.replace('Submit hazard data', 'Submit ' + singular + ' data').replace('Loading hazard inventories…', 'Loading catalogue…')
    h = re.sub(r'(<span class="stats-figure-title">).*?(</span>)', lambda m:m[1]+html.escape(config['fields'][0]['label'])+m[2],h,count=1)
    h = re.sub(r'<p class="wm-deck">.*?</p>', '<p class="wm-deck">'+html.escape(config['intro'])+'</p>', h, flags=re.S)
    h = h.replace('Regions covered</span>', 'Coverage</span>').replace('<span class="wm-cov-value-text">Worldwide</span>', '<span class="wm-cov-value-text">'+html.escape(config.get('coverageLabel','Worldwide'))+'</span>')
    h = re.sub(r'(<meta (?:name="description"|property="og:description"|name="twitter:description")\s+content=")[^"]*(")', lambda m:m[1]+html.escape(config['intro'],quote=True)+m[2], h)
    h = re.sub(r'(<meta (?:property="og:image:alt"|name="twitter:image:alt") content=")[^"]*(")', lambda m:m[1]+html.escape(title+' of Earth — NKUA GeoCollections',quote=True)+m[2], h)
    h = re.sub(r'<input type="hidden" id="[^"]+-filter" value="">\s*', '', h)
    h = h.replace('<button id="load-area" class="btn-primary" type="button" disabled>Load this area</button>', '')
    h = h.replace('Records in the loaded area', 'Records in this area').replace('Zoom in to load individual records.', 'Loading catalogue…')
    h = re.sub(r'<div class="reference-sections">.*?(?=\n                    </div>\n                </div>\n            </div>\n        </div>)', '''<div class="reference-sections">
      <section class="reference-section"><header class="reference-section-heading"><h4>Catalogue coverage</h4><p id="coverage-totals"></p></header><div class="reference-section-copy"><p id="prepared-date"></p><p>'''+html.escape(config['countNote'])+'''</p><p>'''+html.escape(config['statisticsNote'])+'''</p></div></section>
      <section class="reference-section"><header class="reference-section-heading"><h4>Source library</h4><p>Use the citation and reuse terms of each inventory.</p></header><div class="reference-section-copy"><label for="source-search" class="search-label">Find an inventory</label><input id="source-search" class="search-input" type="search" placeholder="Search inventory, provider or licence…"></div></section>
      <div id="source-library"></div>
      <section class="reference-section"><header class="reference-section-heading"><h4>Methods and reuse</h4><p>Preserve attribution with downloads.</p></header><div class="reference-section-copy"><p>'''+html.escape(config['methods'])+'''</p><p>Original platform text and interface design are CC BY 4.0, except separately credited source data, imagery, basemaps and logos. Source materials retain their original reuse terms.</p><p><a href="./data/manifest.json">Catalogue manifest and methods</a> · <a href="./data/catalogue.json.gz" download>Complete compressed catalogue</a></p></div></section>''', h, count=1, flags=re.S)
    start = h.index('                <div class="modal-body"><div class="submit-data-intro">')
    end = h.index('\n        <dialog id="feature-guide-modal"', start)
    h = h[:start] + '''                <div class="modal-body"><div class="submit-data-intro"><p>Contribute a documented record, an inventory or a correction, with its original evidence.</p></div>
      <div class="submit-data-section"><h4>Prepare your submission</h4><p>Use one row per source record. Leave unknown values blank; include the original identifier and reuse terms. Attach original geometry with its coordinate reference system where available.</p><div class="submit-data-actions"><a class="btn-primary" href="./templates/data-template.csv" download>Download CSV</a><a class="btn-primary" href="mailto:alexliaskos@geol.uoa.gr,evelpidou@geol.uoa.gr?subject='''+slug+'''%20data%20submission">Send by email</a></div></div>
      <div class="submit-data-section"><h4>Required information</h4><div class="template-table-wrapper"><table class="template-table submission-field-guide"><thead><tr><th>Field</th><th>What to provide</th></tr></thead><tbody><tr><th>name, country</th><td>Recorded locality and country.</td></tr><tr><th>latitude, longitude</th><td>WGS84 coordinates; explain any uncertainty.</td></tr><tr><th>source, licence</th><td>Publication, DOI, agency report or dataset URL and its reuse terms.</td></tr></tbody></table></div></div>
      <details class="submit-data-section submission-optional"><summary>Optional fields and corrections</summary><div class="template-table-wrapper"><table class="template-table submission-field-guide"><thead><tr><th>Field</th><th>What to provide</th></tr></thead><tbody><tr><th>date, original_id, event_id</th><td>Reported date, source record ID and documented related event ID.</td></tr><tr><th>measurements, units</th><td>Reported measurements with units, method and uncertainty.</td></tr><tr><th>geometry_file, notes</th><td>Geometry filename and explanatory notes. For a correction, give the existing catalogue ID.</td></tr></tbody></table></div></details>
      <div class="submit-data-section"><h4>Send your contribution</h4><ul class="notes-list"><li>Include contributor names, affiliation and contact details.</li><li>Attach the completed file and evidence to the email draft.</li><li>The research team reviews submissions before publication.</li></ul></div>
      </div></div></div>
''' + h[end:]
    h = h.replace('What is a hazard?', 'What is ' + config.get('article','a') + ' ' + singular + '?')
    start = h.index('            <div class="feature-guide-body">')
    end = h.index('\n        </dialog>', start)
    h = h[:start] + '''            <div class="feature-guide-body"><p class="feature-guide-definition">'''+html.escape(config['definition'])+'''</p><figure class="feature-guide-figure"><img src="./explanation.svg" width="1200" height="700" alt="'''+html.escape(config['diagramAlt'],quote=True)+'''" loading="lazy"><figcaption><span>'''+html.escape(config['diagramCaption'])+'''</span><span>Diagram: NKUA GeoCollections · CC BY 4.0.</span></figcaption></figure><p class="feature-guide-source">Definition source: <a href="'''+html.escape(config['definitionUrl'],quote=True)+'''" target="_blank" rel="noopener noreferrer">'''+html.escape(config['definitionSource'])+'''</a>.</p></div>''' + h[end:]
    h = h.replace('src="./app.js?v=20260907-8"', 'src="/webgis-shared/hazard-atlas.js?v=20260907-3"')
    (site / 'index.html').write_text(h, encoding='utf-8')
    css = (REPO / 'sites/landslides/landslides.css').read_text(encoding='utf-8').replace('landslide','hazard')
    (site / 'collection.css').write_text(css, encoding='utf-8')
    for file in ['favicon.svg','favicon.png','apple-touch-icon.png']:
        shutil.copy2(REPO / 'sites/landslides' / file, site / file)
    write_json(site / 'site.webmanifest', {'name':title+' of Earth | NKUA GeoCollections','short_name':title,'start_url':'./','display':'standalone','background_color':'#ffffff','theme_color':'#000000','icons':[{'src':'./favicon.png','sizes':'48x48','type':'image/png'},{'src':'./apple-touch-icon.png','sizes':'180x180','type':'image/png'}]})
    (site / 'templates').mkdir(exist_ok=True)
    with (site / 'templates/data-template.csv').open('w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f).writerow(['name','country','latitude','longitude','source','licence','date','original_id','event_id','measurements','units','geometry_file','notes'])
    (site / 'explanation.svg').write_text(config['diagram'],encoding='utf-8')
