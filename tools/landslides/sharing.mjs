// Produce the requested sharing artwork from the published coverage data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require(path.join(process.env.NODE_PATH, 'sharp'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const site = path.join(root, 'sites/landslides');
const manifest = JSON.parse(fs.readFileSync(path.join(site, 'data/manifest.json'), 'utf8'));
const coverage = JSON.parse(gunzipSync(fs.readFileSync(path.join(site, 'data', manifest.tiles_file))));
const sources = new Map(manifest.sources.map(source => [source.id, source.family]));
const colors = { uglc: '#1e3a5f', nasa: '#9a642b', peloponnese: '#0d9488' };
const bins = new Map();
for (const tile of coverage.tiles) {
  const [west, south, east, north] = tile.bbox;
  const lon = (west + east) / 2, lat = (south + north) / 2;
  for (const group of tile.groups) {
    const family = sources.get(group[0]);
    if (!colors[family]) continue;
    const key = `${family}:${Math.floor(lon / 1.5)}:${Math.floor(lat / 1.5)}`;
    if (!bins.has(key)) bins.set(key, { family, count: 0, lon: 0, lat: 0 });
    const bin = bins.get(key), count = group.at(-1);
    bin.count += count; bin.lon += lon * count; bin.lat += lat * count;
  }
}
const plot = { x: 536, y: 243, width: 684, height: 325 };
const x = lon => plot.x + (lon + 180) / 360 * plot.width;
const y = lat => plot.y + (85 - lat) / 145 * plot.height;
const grid = [];
for (let lon = -180; lon <= 180; lon += 60) grid.push(`<path d="M${x(lon)} ${plot.y}V${plot.y + plot.height}"/>`);
for (let lat = -60; lat <= 80; lat += 30) grid.push(`<path d="M${plot.x} ${y(lat)}H${plot.x + plot.width}"/>`);
const dots = [];
for (const family of ['uglc', 'nasa', 'peloponnese']) {
  for (const bin of bins.values()) {
    if (bin.family !== family) continue;
    const radius = Math.min(4.4, 1.05 + Math.log10(bin.count + 1) * .85);
    dots.push(`<circle cx="${x(bin.lon / bin.count).toFixed(2)}" cy="${y(bin.lat / bin.count).toFixed(2)}" r="${radius.toFixed(2)}" fill="${colors[family]}" fill-opacity=".72"/>`);
  }
}
const logo = fs.readFileSync(path.join(root, 'sites/webgis-shared/nkua-190-en-horizontal.png')).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><clipPath id="map"><rect x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}"/></clipPath></defs>
  <rect width="1280" height="720" fill="#f7f6f2"/>
  <image x="60" y="36" width="420" height="82" preserveAspectRatio="xMinYMid meet" xlink:href="data:image/png;base64,${logo}"/>
  <text x="1220" y="64" text-anchor="end" fill="#1e3a5f" font-family="Arial,sans-serif" font-size="14" letter-spacing="2.2">NKUA GEOCOLLECTIONS</text>
  <text x="1220" y="91" text-anchor="end" fill="#656967" font-family="Arial,sans-serif" font-size="16">nkua.cloud/landslides</text>
  <path d="M60 142H1220" stroke="#c7ccc5"/>
  <text x="60" y="197" fill="#606960" font-family="Arial,sans-serif" font-size="13" letter-spacing="2.2">A GLOBAL WEBGIS</text>
  <text x="56" y="287" fill="#142c43" font-family="Georgia,serif" font-size="78" letter-spacing="-3">Landslides</text>
  <text x="60" y="365" fill="#142c43" font-family="Georgia,serif" font-size="73" font-style="italic">of Earth</text>
  <text x="60" y="418" fill="#535d61" font-family="Arial,sans-serif" font-size="19">Explore mapped footprints,</text>
  <text x="60" y="447" fill="#535d61" font-family="Arial,sans-serif" font-size="19">reported locations and original evidence.</text>
  <circle cx="68" cy="501" r="7" fill="${colors.uglc}"/><text x="87" y="507" fill="#243b4a" font-family="Arial,sans-serif" font-size="16">UGLC v2</text>
  <circle cx="68" cy="533" r="7" fill="${colors.nasa}"/><text x="87" y="539" fill="#243b4a" font-family="Arial,sans-serif" font-size="16">NASA COOLR</text>
  <circle cx="68" cy="565" r="7" fill="${colors.peloponnese}"/><text x="87" y="571" fill="#243b4a" font-family="Arial,sans-serif" font-size="16">Northern Peloponnese</text>
  <text x="536" y="211" fill="#606960" font-family="Arial,sans-serif" font-size="12" letter-spacing="1.6">WORLDWIDE INVENTORY COVERAGE</text>
  <g clip-path="url(#map)"><g stroke="#d5dcd7" stroke-width=".65" fill="none">${grid.join('')}</g>${dots.join('')}</g>
  <text x="536" y="600" fill="#727974" font-family="Arial,sans-serif" font-size="12">Published source records · Inventories may overlap</text>
  <path d="M60 641H1220" stroke="#c7ccc5"/>
  <text x="60" y="681" fill="#4e5a62" font-family="Arial,sans-serif" font-size="14">National and Kapodistrian University of Athens</text>
  <text x="1220" y="681" text-anchor="end" fill="#1e3a5f" font-family="Arial,sans-serif" font-size="14">Maps · Filters · Statistics · Sources</text>
</svg>`;
fs.writeFileSync(path.join(site, 'social-preview.svg'), svg);
await sharp(Buffer.from(svg)).jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toFile(path.join(site, 'social-preview.jpg'));
