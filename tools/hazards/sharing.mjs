import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), sharp = require(path.join(process.env.NODE_PATH, 'sharp'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
for (const slug of process.argv.slice(2)) {
  const site = path.join(root, 'sites', slug), meta = JSON.parse(fs.readFileSync(path.join(site, 'data/manifest.json'), 'utf8'));
  const { records } = JSON.parse(gunzipSync(fs.readFileSync(path.join(site, 'data/catalogue.json.gz'))));
  const bins = new Map(), colors = new Map(meta.sources.map(s => [s.id, s.color]));
  for (const r of records) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    const key = `${r.source}:${Math.floor(r.lon)}:${Math.floor(r.lat)}`;
    if (!bins.has(key)) bins.set(key, { source:r.source, lon:0, lat:0, n:0 });
    const b = bins.get(key); b.lon += r.lon; b.lat += r.lat; b.n++;
  }
  const plot = { x:536, y:243, w:684, h:325 }, x = lon => plot.x + (lon + 180)/360*plot.w, y = lat => plot.y + (85-lat)/145*plot.h;
  const grid = []; for (let lon=-180;lon<=180;lon+=60) grid.push(`<path d="M${x(lon)} ${plot.y}V${plot.y+plot.h}"/>`); for(let lat=-60;lat<=80;lat+=30) grid.push(`<path d="M${plot.x} ${y(lat)}H${plot.x+plot.w}"/>`);
  const dots = [...bins.values()].map(b=>`<circle cx="${x(b.lon/b.n).toFixed(2)}" cy="${y(b.lat/b.n).toFixed(2)}" r="${Math.min(4.5,1.1+Math.log10(b.n+1)).toFixed(2)}" fill="${colors.get(b.source)}" opacity=".7"/>`).join('');
  const logo = fs.readFileSync(path.join(root,'sites/webgis-shared/nkua-190-en-horizontal.png')).toString('base64');
  const legend = meta.sources.map((s,i)=>`<circle cx="68" cy="${501+i*32}" r="7" fill="${s.color}"/><text x="87" y="${507+i*32}" font-family="Arial,sans-serif" font-size="16" fill="#243b4a">${esc(s.label)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><clipPath id="map"><rect x="536" y="243" width="684" height="325"/></clipPath></defs><rect width="1280" height="720" fill="#f7f6f2"/><image x="60" y="36" width="420" height="82" preserveAspectRatio="xMinYMid meet" href="data:image/png;base64,${logo}"/><g font-family="Arial,sans-serif" fill="#1e3a5f"><text x="1220" y="64" text-anchor="end" font-size="14" letter-spacing="2.2">NKUA GEOCOLLECTIONS</text><text x="1220" y="91" text-anchor="end" font-size="16">nkua.cloud/${esc(slug)}</text></g><path d="M60 142H1220M60 641H1220" stroke="#c7ccc5"/><text x="60" y="197" fill="#606960" font-family="Arial,sans-serif" font-size="13" letter-spacing="2.2">A RESEARCH WEBGIS</text><g fill="#142c43" font-family="Georgia,serif"><text x="56" y="287" font-size="${meta.title.length>10?62:78}" letter-spacing="-3">${esc(meta.title)}</text><text x="60" y="365" font-size="73" font-style="italic">of Earth</text></g><g font-family="Arial,sans-serif" font-size="19" fill="#535d61"><text x="60" y="418">Explore source records,</text><text x="60" y="447">mapped evidence and statistics.</text></g>${legend}<text x="536" y="211" fill="#606960" font-family="Arial,sans-serif" font-size="12" letter-spacing="1.6">PUBLISHED SOURCE COVERAGE</text><g clip-path="url(#map)"><g stroke="#d5dcd7" stroke-width=".65" fill="none">${grid.join('')}</g>${dots}</g><text x="536" y="600" fill="#727974" font-family="Arial,sans-serif" font-size="12">${records.length.toLocaleString('en-US')} source records · Coverage varies by inventory</text><g fill="#4e5a62" font-family="Arial,sans-serif" font-size="14"><text x="60" y="681">National and Kapodistrian University of Athens</text><text x="1220" y="681" text-anchor="end">Maps · Filters · Statistics · Sources</text></g></svg>`;
  fs.writeFileSync(path.join(site,'social-preview.svg'),svg);
  await sharp(Buffer.from(svg)).jpeg({quality:93,chromaSubsampling:'4:4:4'}).toFile(path.join(site,'social-preview.jpg'));
  process.stdout.write(slug + ' sharing artwork prepared\n');
}
