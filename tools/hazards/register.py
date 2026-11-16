"""Register completed collection pages in the existing homepage and local routes."""
import html
import json
import sys
from collection import REPO

home = REPO / 'sites/index.html'
text = home.read_text(encoding='utf-8')
nginx_path = REPO / 'infra/nginx/webgis.conf'
nginx = nginx_path.read_text(encoding='utf-8')
counter_path = REPO / 'infra/counter/visit_counter.py'
counter = counter_path.read_text(encoding='utf-8')
for slug in sys.argv[1:]:
    config = json.loads((REPO / f'sites/{slug}/data/manifest.json').read_text(encoding='utf-8'))
    title = config.get('homepageTitle',config['title'])
    if f'<a class="catalogue" href="/{slug}/">' not in text:
        card = f'''                    <a class="catalogue" href="/{slug}/">
                        <figure class="catalogue-visual"><img src="/{slug}/map-preview.jpg?v=20260907-1" alt="{html.escape(title)} source coverage" width="1280" height="720" loading="lazy"></figure>
                        <div class="catalogue-copy"><h4>{html.escape(title)}</h4><p>{html.escape(config['intro'])}</p><span class="catalogue-link">View the website <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"></path></svg></span></div>
                    </a>

'''
        text = text.replace('                    <a class="catalogue" href="/Nepal-Flood-2026-Catalogue/">',card+'                    <a class="catalogue" href="/Nepal-Flood-2026-Catalogue/">',1)
        text = text.replace('                    <li><a href="/landslides/">Landslides &amp; Mass Movements</a></li>',f'                    <li><a href="/{slug}/">{html.escape(title)}</a></li>\n                    <li><a href="/landslides/">Landslides &amp; Mass Movements</a></li>',1)
        text = text.replace('{ "@type": "Dataset", "name": "Landslides and Mass Movements",',json.dumps({'@type':'Dataset','name':title,'url':f'https://nkua.cloud/{slug}/'})+',\n            { "@type": "Dataset", "name": "Landslides and Mass Movements",',1)
    if f'location = /{slug} ' not in nginx:
        nginx = nginx.replace('        location = /floods { return 308 /floods/; }',f'        location = /{slug} {{ return 308 /{slug}/; }}\n        location ^~ /{slug}/ {{ try_files $uri $uri/ =404; }}\n        location = /floods {{ return 308 /floods/; }}',1)
    if f'location = /{slug}/api/page-summary' not in nginx:
        start = nginx.index('        location = /floods/api/page-summary')
        end = nginx.index('\n        }',start) + len('\n        }')
        nginx = nginx[:start] + nginx[start:end].replace('/floods/','/'+slug+'/').replace('/visit/floods','/visit/'+slug) + '\n\n' + nginx[start:]
    marker='SUPPORTED_SITES = frozenset({'
    if f'"{slug}"' not in counter[counter.index(marker):counter.index('})',counter.index(marker))]:
        counter=counter.replace(marker,marker+f'"{slug}", ',1)
home.write_text(text,encoding='utf-8')
nginx_path.write_text(nginx,encoding='utf-8')
counter_path.write_text(counter,encoding='utf-8')
