import LagoonPreviewMap from '/lagoons/js/map/LagoonPreviewMap.js?v=20260907-7';
import { pinTooltipInsideMap } from '/lagoons/js/map/LagoonHoverCard.js?v=20260907-5';

// The shared interface consumes exact frequency weights, avoiding millions of DOM records.

const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en');
const PAGE_SIZE = 40;
const MAX_AREA_RECORDS = 20000;
const state = { manifest: null, tiles: [], sources: new Map(), summaries: [], active: [], rows: [], filtered: [], page: 0, generation: 0, selected: null, detailGeneration: 0, advanced: [] };
const cache = new Map(), notices = new Map();
const preview = new LagoonPreviewMap();
const hoverPreviews = new WeakMap();
const numericalCache = new Map();
const numericalFields = [
  { key: 'singleDateYear', label: 'Single-date records: year', group: 'Chronology', scale: 'linear', binCount: 12, description: 'Year of records whose reported start and end dates coincide. Unknown and placeholder dates are excluded. Inventory dates may reflect surveying; counts describe source records, not a trend in unique landslide occurrence.' },
  { key: 'intervalDays', label: 'Reported date interval', group: 'Chronology', unit: 'days', scale: 'log', allowNonPositiveLog: true, description: 'Elapsed days between usable source start and end dates. Zero means the dates coincide. An interval may describe a survey period; it does not measure landslide movement duration.' },
  { key: 'startYear', label: 'Interval start year', group: 'Chronology', scale: 'linear', description: 'Start year of the reported interval. Survey intervals are retained; missing and placeholder dates are excluded.' },
  { key: 'endYear', label: 'Interval end year', group: 'Chronology', scale: 'linear', description: 'End year of the reported interval. Survey intervals are retained; missing and placeholder dates are excluded.' },
  { key: 'footprintArea', label: 'Mapped footprint area', group: 'Footprint dimensions', unit: 'km²', scale: 'log', allowNonPositiveLog: true, filterable: false, observations: true, description: 'Area calculated on the WGS84 ellipsoid from each original valid footprint, excluding holes. Points and invalid polygons have no value. Overlapping source footprints remain separate; this is not a deduplicated affected area or displaced volume.' },
  { key: 'footprintPerimeter', label: 'Mapped footprint perimeter', group: 'Footprint dimensions', unit: 'm', scale: 'log', allowNonPositiveLog: true, filterable: false, observations: true, description: 'Length of all footprint boundaries on the WGS84 ellipsoid, including holes. Sensitive to mapping detail and fragmentation. This is not landslide travel distance.' },
  { key: 'accuracy', label: 'Reported location accuracy', group: 'Location precision', unit: 'm', scale: 'log', filterable: false, observations: true, description: 'Positive location-accuracy values supplied by the inventory, in metres. Zero codes are excluded: they do not demonstrate measured zero positional error. Extreme source values remain visible on a logarithmic scale. These are source reports, not independently measured errors.' }
].map(field => ({ type: 'numeric', dataField: field.key, ...field }));
const sourceFamilies = [
  { key: 'uglc', label: 'UGLC v2', color: '#1e3a5f' },
  { key: 'nasa', label: 'NASA COOLR', color: '#9a642b' },
  { key: 'peloponnese', label: 'Northern Peloponnese', color: '#0d9488' }
];
const categories = [
  { key: 'earthquake', label: 'Earthquake-related', color: '#dc2626', border: '#f87171' },
  { key: 'rain-storm', label: 'Rain / storm-related', color: '#f97316', border: '#fdba74' },
  { key: 'other-unreported', label: 'Other / unreported', color: '#0d9488', border: '#5eead4' }
];
const rainFactors = new Set(['rain', 'rainfall', 'heavy rain', 'downpour', 'monsoon', 'continuous rain', 'cyclone', 'tropical cyclone', 'storm', 'rainstorm', 'hurricane', 'typhoon']);
const mapClassDescription = 'Reported contributing factors grouped as earthquake-related, rain/storm-related, or other/unreported. Mixed and unspecified factors stay in the neutral class. Original factor wording remains available; a reported association is not an independent causal determination.';
function classifyFactor(value) {
  const factor = String(value ?? '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (factor === 'seismic' || factor === 'earthquake') return 'earthquake';
  return rainFactors.has(factor) ? 'rain-storm' : 'other-unreported';
}
function categoryForFactor(value) { return categories.find(category => category.key === classifyFactor(value)); }
let map, atlas, coverageLayer, recordsLayer, selectedLayer, renderTimer, searchTimer, legend, lasso;
let coverageDrawn = false;
let searchWorker, globalSearchRequest = 0, globalSearchTimer, selectionRequest = 0;
const modalFocus = new WeakMap();
const fields = [
  { key: 'mapClass', label: 'Reported factor group', group: 'Map classes', valueLabels: Object.fromEntries(categories.map(category => [category.key, category.label])) },
  { key: 'country', label: 'Country', group: 'Location' },
  { key: 'family', label: 'Collection', group: 'Provenance', formatValue: value => sourceFamilies.find(category => category.key === value)?.label || value },
  { key: 'source', label: 'Source inventory', group: 'Provenance', formatValue: value => state.sources.get(value)?.name || value },
  { key: 'kind', label: 'Record geometry', group: 'Mapping', valueLabels: { point: 'Point record', footprint: 'Mapped footprint' } },
  { key: 'movement', label: 'Movement type', group: 'Landslide' },
  { key: 'factor', label: 'Reported contributing factor', group: 'Landslide' },
  { key: 'precision', label: 'Reported date and location precision', group: 'Mapping', valueLabels: { '1': 'Known single date and accuracy below 100 m', '0': 'Other or unspecified precision' } },
  { key: 'startYear', label: 'Interval start year', group: 'Date', sort: 'desc' },
  { key: 'endYear', label: 'Interval end year', group: 'Date', sort: 'desc' }
].map(field => ({ ...field, dataField: field.key, filterKey: field.key, inputId: field.key + '-filter' }));

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function recordedText(value) {
  const text = String(value ?? '').trim();
  return /^(?:|ND|N\/A|NaN|null|None|undefined|Unknown|Not recorded|Not reported|-99999)$/i.test(text) ? '' : text;
}

function recordName(id, originalName, country, family) {
  const name = recordedText(originalName);
  const fallback = `Landslide ${id}`;
  // UGLC NOTES combine a locality with source codes and descriptive attributes.
  // Only the recorded locality belongs in the title; the full wording stays below.
  if (family === 'uglc' && /\blocality\s*:/i.test(name)) {
    const locality = name.split(/\blocality\s*:/i)[1]
      .split(/\s*(?:,|-)\s*(?:description|area|perimeter|volume)\s*:/i)[0];
    const parts = locality.replace(/\s*-\s*\(/g, ', ').replace(/[()]/g, '')
      .split(',').map(part => recordedText(part.replace(/^\s*(?:region|province|city)\s*:/i, '')))
      .filter(part => part && part.toLocaleLowerCase() !== String(country || '').toLocaleLowerCase());
    return [...new Set(parts)].join(', ') || fallback;
  }
  if (family === 'peloponnese') {
    const locality = name.match(/^(.+?)\s*\/\s*\d+$/);
    if (locality) return locality[1].trim();
  }
  if (!name || /\b(?:inventory|catalogue|catalog)\b/i.test(name)
    || /^(?:landslide|slide|fall|flow|rockslide|rockfall|debris flow|unknown movement)$/i.test(name)) return fallback;
  return name;
}

function recordLabel(row) {
  return recordName(row[0], row[14], row[4], state.sources.get(row[3])?.family);
}

function recordDate(row) {
  const start = usableDate(row[8]), end = usableDate(row[9]);
  if (start && end) return start === end ? start : `${start} – ${end}`;
  if (start) return `From ${start} (end not recorded)`;
  if (end) return `Until ${end} (start not recorded)`;
  return '';
}

function localityPin(className) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ class: className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(name, value);
  const path = document.createElementNS(icon.namespaceURI, 'path');
  path.setAttribute('d', 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z');
  const circle = document.createElementNS(icon.namespaceURI, 'circle');
  for (const [name, value] of Object.entries({ cx: '12', cy: '10', r: '3' })) circle.setAttribute(name, value);
  icon.append(path, circle);
  return icon;
}

function recordTitle(row) {
  const block = $('landslide-modal-titleblock');
  const category = categoryForFactor(row[6]);
  const title = element('h2', null, 'lagoon-name'); title.id = 'landslide-record-name';
  title.append(element('span', recordLabel(row), 'lagoon-name-en'));
  block.replaceChildren(element('span', category?.label || 'Landslide', 'lagoon-eyebrow'), title);
  const country = recordedText(row[4]), date = recordDate(row);
  if (country || date) {
    const locality = element('p', null, 'lagoon-locality');
    if (country) locality.append(localityPin('lagoon-locality-pin'), element('span', country, 'lagoon-locality-main'));
    if (country && date) {
      const separator = element('span', '·', 'lagoon-locality-dot'); separator.setAttribute('aria-hidden', 'true'); locality.append(separator);
    }
    if (date) locality.append(element('span', date, 'lagoon-locality-island'));
    block.append(locality);
  }
}

function recordTooltip(row, showPreview = true) {
  const card = element('div', null, 'lagoon-hover-card' + (showPreview ? '' : ' is-text-only'));
  if (showPreview) {
    const wrapper = element('div', null, 'lagoon-hover-preview');
    const container = element('div', null, 'lagoon-preview-map');
    container.dataset.tooltipPreviewMap = '';
    container.setAttribute('aria-label', row[7] === 'footprint' ? 'Mapped landslide footprint' : 'Recorded landslide location');
    wrapper.append(container); card.append(wrapper);
  }
  const body = element('div', null, 'lagoon-hover-body');
  const category = categoryForFactor(row[6]);
  const title = element('h3', null, 'lagoon-hover-name');
  title.append(element('span', recordLabel(row), 'lagoon-hover-name-en'));
  body.append(element('span', category?.label || 'Landslide', 'lagoon-hover-eyebrow'), title);
  if (recordedText(row[4])) {
    const locality = element('div', null, 'lagoon-hover-locality');
    locality.append(localityPin('lagoon-hover-pin'), element('span', row[4], 'lagoon-hover-loc-main')); body.append(locality);
  }
  const stats = element('div', null, 'lagoon-hover-stats');
  for (const [label, value] of [['Reported date', recordDate(row)], ['Movement', recordedText(row[5])], ['Geometry', row[7] === 'footprint' ? 'Mapped footprint' : 'Point record']]) {
    const stat = element('div', null, 'lagoon-hover-stat');
    const spacer = element('span', null, 'lagoon-hover-basis-tag is-empty'); spacer.setAttribute('aria-hidden', 'true');
    stat.append(element('span', label, 'lagoon-hover-stat-label'), spacer, element('span', value || '—', 'lagoon-hover-stat-value'));
    stats.append(stat);
  }
  body.append(stats); card.append(body);
  return card;
}

function destroyHoverPreview(tooltip) {
  const active = hoverPreviews.get(tooltip);
  if (!active) return;
  hoverPreviews.delete(tooltip); clearTimeout(active.timer); preview.destroy(active.container);
}

function renderHoverPreview(tooltip, row) {
  destroyHoverPreview(tooltip);
  tooltip.setContent(recordTooltip(row));
  tooltip.getElement().style.translate = '';
  pinTooltipInsideMap(tooltip, map);
  const container = tooltip.getElement()?.querySelector('[data-tooltip-preview-map]');
  if (!container) return;
  const active = { container, timer: null }; hoverPreviews.set(tooltip, active);
  active.timer = setTimeout(async () => {
    try {
      let geometry = null;
      if (row[7] === 'footprint') {
        const records = await cachedJSON(`records/${Math.floor((row[0] - 1) / state.manifest.detail_shard_size)}.json.gz`);
        geometry = records[row[0]]?.geometry;
        if (!geometry) throw new Error('Footprint unavailable');
      }
      if (hoverPreviews.get(tooltip) !== active || !container.isConnected) return;
      L.DomEvent.disableClickPropagation(container); L.DomEvent.disableScrollPropagation(container);
      preview.render(container, { centroid_lat: row[2], centroid_lng: row[1], geojson: geometry }, { pointZoom: 13 });
    } catch {
      if (hoverPreviews.get(tooltip) !== active) return;
      destroyHoverPreview(tooltip); tooltip.setContent(recordTooltip(row, false)); pinTooltipInsideMap(tooltip, map);
    }
  }, 100);
}

function link(text, url) {
  const node = element('a', text);
  try {
    const parsed = new URL(url, location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) return element('span', text);
    node.href = parsed.href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  } catch { return element('span', text); }
  return node;
}

async function readJSON(path, signal) {
  const response = await fetch(path + '?v=20260907-7', { signal });
  if (!response.ok) throw new Error(`The requested catalogue file could not be loaded (${response.status}).`);
  if (!path.endsWith('.gz')) return response.json();
  if (!('DecompressionStream' in window)) throw new Error('This browser cannot read the compressed catalogue. Please use a current version of Chrome, Edge, Firefox or Safari.');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

async function cachedJSON(path) {
  if (cache.has(path)) {
    const value = cache.get(path);
    cache.delete(path); cache.set(path, value);
    return value;
  }
  const value = await readJSON('./data/' + path);
  cache.set(path, value);
  while (cache.size > 35) cache.delete(cache.keys().next().value);
  return value;
}

function normalizedLongitude(value) { return ((value + 180) % 360 + 360) % 360 - 180; }

function longitudeInside(lon, bounds) {
  if (bounds.getEast() - bounds.getWest() >= 360) return true;
  const west = normalizedLongitude(bounds.getWest()), east = normalizedLongitude(bounds.getEast());
  return west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
}

function intersects(bbox, bounds) {
  if (bbox[3] < bounds.getSouth() || bbox[1] > bounds.getNorth()) return false;
  if (bounds.getEast() - bounds.getWest() >= 360) return true;
  const west = normalizedLongitude(bounds.getWest()), east = normalizedLongitude(bounds.getEast());
  return west <= east ? bbox[2] >= west && bbox[0] <= east : bbox[2] >= west || bbox[0] <= east;
}

function inViewport(row) {
  const bounds = map.getBounds();
  return row[2] >= bounds.getSouth() && row[2] <= bounds.getNorth() && longitudeInside(row[1], bounds);
}

function saveBlob(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = element('a'); anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sourceNotice(source) {
  if (!source.license_notice) return '';
  if (!notices.has(source.license_notice)) {
    const response = await fetch('./data/' + source.license_notice);
    if (!response.ok) throw new Error('The required source notice could not be loaded. Please retry the download.');
    notices.set(source.license_notice, await response.text());
  }
  return notices.get(source.license_notice);
}

async function downloadRecord(detail) {
  const source = state.sources.get(detail.source);
  const notice = await sourceNotice(source);
  const feature = { type: 'Feature', id: detail.id, geometry: detail.geometry,
    properties: { ...detail.original_attributes, nkua_record_id: detail.id, original_id: detail.native_id,
      source_inventory: source.name, source_url: source.url, source_paper: source.paper,
      source_license: source.license, source_license_url: new URL(source.license_url, location.href).href,
      source_citation: source.citation, source_locator: detail.source_locator,
      source_copyright: source.copyright || null, source_permission_notice: notice || null,
      geometry_note: detail.geometry_role, date_note: detail.date_note,
      transformations: 'CRS transformed to WGS84 where required. Source geometry is not simplified. Original geometry encoding remains in the upstream archive.' } };
  saveBlob(`landslide-${detail.id}.geojson`, JSON.stringify(feature, null, 2), 'application/geo+json');
}

async function exportCSV() {
  const rows = [...state.filtered];
  const exportSources = new Map(rows.map((row) => [row[3], state.sources.get(row[3])]));
  for (const source of exportSources.values()) await sourceNotice(source);
  const includedNotices = new Set();
  const cell = (value) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const header = [...state.manifest.fields, 'source_name', 'source_url', 'source_license', 'source_license_url', 'source_citation', 'source_copyright', 'source_permission_notice', 'modifications', 'counting_note'];
  const lines = [header.map(cell).join(',')];
  for (const row of rows) {
    const source = state.sources.get(row[3]);
    const notice = source.license_notice && !includedNotices.has(source.license_notice) ? notices.get(source.license_notice) : '';
    if (notice) includedNotices.add(source.license_notice);
    lines.push([...row, source.name, source.url, source.license, new URL(source.license_url, location.href).href, source.citation, source.copyright, notice,
      'Normalised attributes; polygon locations are derived interior display anchors. Original records remain in the upstream dataset.', state.manifest.counting_note].map(cell).join(','));
  }
  saveBlob('landslides-loaded-view.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

function summaryRecord(group, tile) {
  const [source, country, movement, factor, kind, precise, rawStart, rawEnd, count] = group;
  const start = usableDate(rawStart), end = usableDate(rawEnd);
  const interval = start && end ? (Date.parse(end) - Date.parse(start)) / 86400000 : null;
  return { source, country, movement, factor, mapClass: classifyFactor(factor), kind, precision: String(precise && start && start === end ? 1 : 0), start, end, count,
    family: state.sources.get(source)?.family || '', tile,
    startYear: start ? Number(start.slice(0, 4)) : null,
    endYear: end ? Number(end.slice(0, 4)) : null,
    singleDateYear: start && start === end ? Number(start.slice(0, 4)) : null,
    intervalDays: interval !== null && interval >= 0 ? interval : null };
}

function usableDate(value) {
  if (!value || /^(?:1677-12-31|1678-01-01)/.test(String(value))) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) ? text : null;
}

function getStatisticsRecords(field, summaries) {
  if (!field.observations) return summaries;
  return loadNumericalRecords(field.key, summaries);
}

async function loadNumericalRecords(key, summaries) {
  let promise = numericalCache.get(key);
  if (!promise) {
    promise = readJSON(`./data/statistics/${key}.json.gz`);
    numericalCache.set(key, promise);
    promise.catch(() => { if (numericalCache.get(key) === promise) numericalCache.delete(key); });
    while (numericalCache.size > 1) numericalCache.delete(numericalCache.keys().next().value);
  }
  const data = await promise;
  const selectedId = summaries.length === 1 && summaries[0].id;
  const byGroup = new Map(summaries.map(record => [record.groupId, record]));
  const counts = new Map(), records = [];
  for (const [id, groupId, value] of data.records) {
    if (key === 'accuracy' && value <= 0) continue;
    const base = selectedId ? id === selectedId ? summaries[0] : null : byGroup.get(groupId);
    if (!base) continue;
    records.push(Object.assign(Object.create(base), { id, count: 1, [key]: value }));
    counts.set(base, (counts.get(base) || 0) + 1);
  }
  for (const base of summaries) {
    const missing = base.count - (counts.get(base) || 0);
    if (missing > 0) records.push(Object.assign(Object.create(base), { count: missing, [key]: null }));
  }
  return records;
}

function rowSummary(row) {
  return { ...summaryRecord([row[3], row[4], row[5], row[6], row[7], row[12], row[8], row[9], 1]), id: row[0], name: recordLabel(row) };
}

function matches(record) {
  if (!fields.every(field => window.NkuaWebGISUI.matchesFilterValue(record[field.key] ?? '', $(field.inputId).value))) return false;
  let result = null;
  for (const condition of state.advanced) {
    const match = atlas.filterPanel.matchesAdvancedCondition(record, condition);
    result = result === null ? match : condition.logic === 'OR' ? result || match : result && match;
  }
  return result !== false;
}

// Global statistics are summarised per 0.25° coverage cell, so the lasso
// selects whole cells by their centre; loaded area records are tested exactly.
function tileInsideLasso(tile) {
  const [west, south, east, north] = tile.bbox;
  return !lasso || lasso.contains((south + north) / 2, (west + east) / 2);
}

function rowInsideLasso(row) { return !lasso || lasso.contains(row[2], row[1]); }

function applyFilters() {
  renderSearchSelected();
  coverageDrawn = false;
  if (state.recordFilter) {
    const record = rowSummary(state.recordFilter);
    state.active = matches(record) && rowInsideLasso(state.recordFilter) ? [record] : [];
    atlas.setRecords(state.active); legend.update(state.active); scheduleRender();
    return;
  }
  state.active = [];
  const counts = { point: 0, footprint: 0 };
  for (const tile of state.tiles) {
    tile.matchCount = 0;
    tile.classCounts = {};
    if (!tileInsideLasso(tile)) continue;
    for (const record of tile.summaries) {
      if (!matches(record)) continue;
      state.active.push(record);
      tile.matchCount += record.count;
      const colourKey = legend.classify(record).key;
      tile.classCounts[colourKey] = (tile.classCounts[colourKey] || 0) + record.count;
      counts[record.kind] += record.count;
    }
  }
  atlas.setRecords(state.active);
  legend.update(state.active);
  $('map-status').textContent = `${fmt.format(counts.point)} point records · ${fmt.format(counts.footprint)} footprint records in the global selection.`;
  scheduleRender();
}

function clearFilters(refresh = true) {
  ++globalSearchRequest;
  clearTimeout(globalSearchTimer);
  searchWorker?.postMessage({ query: '', request: globalSearchRequest });
  ++selectionRequest;
  state.recordFilter = null;
  $('record-filter-note')?.remove();
  lasso?.clear(true);
  for (const field of fields) $(field.inputId).value = '';
  state.advanced = [];
  atlas?.filterPanel.resetAdvanced(false);
  $('global-search-selected').replaceChildren();
  $('global-search-selected').classList.add('hidden');
  $('global-search-input').value = '';
  $('global-search-results').classList.add('hidden');
  $('record-search').value = '';
  if (refresh) applyFilters();
}

function extentFor(tiles) {
  const extent = [180, 90, -180, -90];
  for (const { bbox } of tiles) {
    extent[0] = Math.min(extent[0], bbox[0]); extent[1] = Math.min(extent[1], bbox[1]);
    extent[2] = Math.max(extent[2], bbox[2]); extent[3] = Math.max(extent[3], bbox[3]);
  }
  return [[extent[1], extent[0]], [extent[3], extent[2]]];
}

function fitSelection() {
  const tiles = state.tiles.filter(tile => tile.matchCount > 0);
  if (tiles.length) map.fitBounds(extentFor(tiles), { padding: [35, 35], maxZoom: 11 });
}

function clusterOptions(iconCreateFunction) {
  return {
    chunkedLoading: false,
    spiderfyOnMaxZoom: true,
    spiderLegPolylineOptions: { weight: 1.5, color: '#333', opacity: .5 },
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: zoom => zoom <= 5 ? 100 : zoom <= 7 ? 85 : zoom <= 9 ? 70 : 60,
    singleMarkerMode: false,
    iconCreateFunction
  };
}

// Cell totals by the legend colour classes; classes hidden in the legend are left out.
function visibleCellCount(tile) {
  return legend.visibleCategories().reduce((sum, category) => sum + (tile.classCounts[category.key] || 0), 0);
}

function coverageIcon(cluster) {
  const shown = legend.visibleCategories();
  const counts = Object.fromEntries(shown.map(category => [category.key, 0]));
  let count = 0;
  for (const marker of cluster.getAllChildMarkers()) {
    for (const category of shown) {
      const value = marker._coverageTile.classCounts[category.key] || 0;
      counts[category.key] += value;
      count += value;
    }
  }
  return window.NkuaWebGISMap.createCategoryClusterIcon(cluster, shown, {
    count, counts
  });
}

function clearCoverage() {
  coverageLayer.clearLayers();
  coverageDrawn = false;
}

function drawCoverage() {
  if (coverageDrawn) return;
  clearCoverage();
  const markers = [];
  // Keep the global overview in one spatial cluster tree, including points
  // outside the viewport, as in the other WebGIS maps.
  for (const tile of state.tiles) {
    if (!tile.matchCount || !visibleCellCount(tile)) continue;
    const [west, south, east, north] = tile.bbox;
    const marker = L.marker([(south + north) / 2, (west + east) / 2]);
    marker._coverageTile = tile;
    marker.setIcon(coverageIcon({ getAllChildMarkers: () => [marker] }));
    marker.bindTooltip(element('span', `${fmt.format(tile.matchCount)} source records. Select to explore.`));
    marker.on('click', () => map.fitBounds(extentFor([tile]), { padding: [40, 40], maxZoom: Math.max(7, map.getZoom() + 2) }));
    markers.push(marker);
  }
  coverageLayer.addLayers(markers);
  coverageDrawn = true;
}

function updateRows() {
  const query = $('record-search').value.trim().toLocaleLowerCase();
  const matchingRows = state.rows.filter(row => state.sources.has(row[3]) && rowInsideLasso(row) && matches(rowSummary(row))
    && (!query || `${recordLabel(row)} ${row[0]} ${row[13]} ${row[14]} ${row[4]} ${row[5]}`.toLocaleLowerCase().includes(query)));
  state.filtered = matchingRows.filter(inViewport);
  state.filtered.sort((a, b) => b[12] - a[12] || (a[10] ?? Infinity) - (b[10] ?? Infinity) || a[0] - b[0]);
  state.page = 0;
  recordsLayer.clearLayers();
  const shown = new Set(legend.visibleCategories());
  const markers = matchingRows.flatMap(row => {
    const category = legend.classify(rowSummary(row));
    if (!shown.has(category)) return [];
    const marker = L.marker([row[2], row[1]], { icon: window.NkuaWebGISMap.createCategoryMarkerIcon(category) });
    marker._mapCategory = category.key;
    marker.bindTooltip(() => recordTooltip(row), { direction: 'top', offset: [0, -14], opacity: 1, className: 'custom-tooltip' });
    marker.on('tooltipopen', ({ tooltip }) => renderHoverPreview(tooltip, row));
    marker.on('tooltipclose', ({ tooltip }) => destroyHoverPreview(tooltip));
    marker.on('remove', () => destroyHoverPreview(marker.getTooltip()));
    marker.on('click', () => { marker.closeTooltip(); openRecord(row[0]); });
    return marker;
  });
  recordsLayer.addLayers(markers);
  $('download-view').disabled = !state.filtered.length;
  $('map-status').textContent = `${fmt.format(state.filtered.length)} source records in this map area. Statistics describe the global filter selection.`;
  renderList();
}

function renderList() {
  const list = $('record-list'); list.replaceChildren();
  const pages = Math.ceil(state.filtered.length / PAGE_SIZE);
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  for (const row of state.filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE)) {
    const button = element('button', null, 'search-result search-result-item'); button.type = 'button';
    button.append(element('strong', recordLabel(row), 'search-result-name'), element('span', [recordedText(row[4]), recordDate(row), state.sources.get(row[3])?.name, `Record ${row[0]}`].filter(Boolean).join(' · '), 'search-result-meta'));
    button.addEventListener('click', () => openRecord(row[0])); list.append(button);
  }
  $('record-status').textContent = state.rows.length
    ? `${fmt.format(state.filtered.length)} matches among ${fmt.format(state.rows.length)} loaded source records. Name search affects this area list and its pins; global statistics retain the catalogue filters.`
    : 'Zoom in or select Load this area to browse individual records. Global filters and statistics cover the complete catalogue.';
  $('pagination').hidden = pages <= 1;
  $('page-label').textContent = `${state.page + 1} / ${Math.max(1, pages)}`;
  $('previous-page').disabled = state.page === 0; $('next-page').disabled = state.page >= pages - 1;
}

async function renderMap(force = false) {
  if (!state.manifest || !atlas || $('sidebar').classList.contains('active')) return;
  const generation = ++state.generation;
  if (state.recordFilter) {
    clearCoverage(); state.rows = [state.recordFilter]; updateRows();
    $('load-area').disabled = true;
    return;
  }
  const bounds = map.getBounds();
  const tiles = state.tiles.filter(tile => tile.matchCount && intersects(tile.bbox, bounds));
  recordsLayer.clearLayers(); state.rows = []; state.filtered = []; renderList();
  $('download-view').disabled = true;
  drawCoverage();
  const selectedCount = tiles.reduce((sum, tile) => sum + tile.matchCount, 0);
  const rawCount = tiles.reduce((sum, tile) => sum + tile.count, 0);
  const canLoad = rawCount > 0 && rawCount <= MAX_AREA_RECORDS;
  $('load-area').disabled = !canLoad;
  $('load-area').textContent = rawCount > MAX_AREA_RECORDS ? 'Zoom for records' : 'Load this area';
  $('map-status').textContent = selectedCount
    ? `${fmt.format(selectedCount)} matching source records in intersecting coverage cells. ${canLoad ? 'Select a cluster or load this area.' : 'Zoom closer for individual records.'}`
    : 'No matching source records in this area. Try a wider view or fewer filters.';
  if (!canLoad || (!force && map.getZoom() < 7)) return;
  $('map-status').textContent = 'Loading source records for this area…';
  const files = tiles.flatMap(tile => tile.files), loaded = [];
  let cursor = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (cursor < files.length && generation === state.generation) {
        const data = await cachedJSON(files[cursor++]);
        if (generation !== state.generation) return;
        loaded.push(...data.records);
      }
    }));
    if (generation !== state.generation) return;
    state.rows = loaded; clearCoverage(); updateRows();
  } catch (error) {
    if (generation === state.generation) {
      $('map-status').textContent = 'Records could not be loaded. Select Load this area to retry.';
      showError(error);
    }
  }
}

function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => renderMap(), 180); }

function showError(error) {
  $('error-banner-message').textContent = error.message || String(error);
  $('error-banner').classList.remove('hidden');
}

function showModal(id) {
  const modal = $(id);
  const title = modal.querySelector('.modal-header h2, .modal-header h3, .wm-title');
  if (title && !modal.hasAttribute('aria-labelledby')) {
    title.id ||= id + '-title'; modal.setAttribute('aria-labelledby', title.id);
  }
  modalFocus.set(modal, document.activeElement);
  modal.classList.add('active'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  document.body.classList.add('modal-open');
  modal.querySelector('button, input, [href]')?.focus({ preventScroll: true });
}

function destroyPreviews() {
  for (const id of ['landslide-preview-map', 'landslide-region-map', 'landslide-world-map']) preview.destroy($(id));
}

function hideModal(id) {
  const modal = $(id);
  modal.classList.remove('active');
  if (id === 'landslide-modal') {
    ++state.detailGeneration; destroyPreviews(); selectedLayer?.clearLayers();
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!document.querySelector('.modal.active')) document.body.classList.remove('modal-open');
  modalFocus.get(modal)?.focus?.({ preventScroll: true });
}

function detailSection(title, pairs, note, includeMissing = false) {
  const section = element('section', null, 'lagoon-modal-section');
  const head = element('header', null, 'lagoon-modal-section-head');
  head.append(element('h4', title, 'lagoon-modal-section-title')); section.append(head);
  const grid = element('div', null, 'lagoon-modal-details-grid');
  for (const [label, value] of pairs) {
    if (!includeMissing && !(value instanceof Node) && !recordedText(value)) continue;
    const item = element('div', null, 'detail-item');
    const body = element('div', null, 'detail-value');
    if (value instanceof Node) body.append(value);
    else body.textContent = value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
    item.append(element('div', label, 'detail-label'), body); grid.append(item);
  }
  section.append(grid);
  if (note) section.append(element('p', note, 'stats-hint'));
  return section;
}

function sourceLinks(source) {
  const links = element('div', null, 'landslide-source-links');
  links.append(link('Official source & downloads', source.url));
  if (source.paper) links.append(link(source.paper_label || 'Research paper', source.paper));
  if (source.license_url) links.append(link(source.license, source.license_url));
  if (source.original_source_url) links.append(link('Original inventory reference', source.original_source_url));
  return links;
}

async function openRecord(id, moveMap = false) {
  const generation = ++state.detailGeneration;
  const content = $('landslide-details');
  destroyPreviews(); content.replaceChildren(element('p', 'Loading original source record…', 'stats-hint'));
  recordTitle([id]);
  closeSidebar(); showModal('landslide-modal');
  try {
    const records = await cachedJSON(`records/${Math.floor((id - 1) / state.manifest.detail_shard_size)}.json.gz`);
    if (generation !== state.detailGeneration) return;
    const detail = records[id];
    if (!detail) throw new Error('This record number is not present in this catalogue release.');
    const row = detail.summary, source = state.sources.get(detail.source);
    state.selected = detail;
    recordTitle(row);
    content.replaceChildren();
    const locators = element('section', null, 'lagoon-modal-locators');
    for (const [id, className, caption] of [['landslide-preview-map', 'locator-detail', row[7] === 'footprint' ? 'Source footprint' : 'Source point'], ['landslide-region-map', 'locator-greece', 'Regional context'], ['landslide-world-map', 'locator-world', 'World']]) {
      const figure = element('figure', null, 'locator ' + className);
      const container = element('div', null, 'lagoon-preview-map ' + (className === 'locator-detail' ? 'lagoon-modal-preview-map' : 'lagoon-modal-locator-map'));
      container.id = id; figure.append(container, element('figcaption', caption)); locators.append(figure);
    }
    const geometryNote = element('section', null, 'lagoon-modal-section');
    geometryNote.append(element('p', detail.geometry_role, 'stats-hint'));
    content.append(locators, geometryNote);
    content.append(detailSection('Landslide record', [
      ['Record ID', id], ['Original source ID', detail.native_id], ['Name / locality', recordLabel(row)],
      ['Country', row[4]], ['Reported date / interval', recordDate(row)],
      ['Movement type', recordedText(row[5]) || detail.original_attributes.Type],
      ['Reported contributing factor', row[6]],
      ['Original title / source notes', row[14] !== recordLabel(row) ? row[14] : null]
    ], detail.date_note));
    content.append(detailSection('Location and mapping', [
      ['Record geometry', row[7] === 'footprint' ? 'Mapped footprint' : 'Point record'],
      ['Recorded location', detail.original_attributes.location_description],
      ['Mapping method', detail.original_attributes.method], ['Source location precision', detail.original_attributes.location_accuracy],
      ['Reported accuracy', row[10] == null ? null : row[10] === 0 ? '0 (source code; not demonstrated zero positional error)' : `${row[10]} m`],
      ['UGLC precision class', row[11] == null ? null : `${row[11]} (upstream classification)`],
      ['Latitude (WGS84)', row[2]], ['Longitude (WGS84)', row[1]]
    ], 'Reported spatial and temporal precision is not an independent quality score. Coordinates for footprints are display anchors.'));
    content.append(detailSection('Sources', [['Inventory', source.name], ['Provider', source.provider], ['Citation', source.citation], ['Licence', source.license], ['Links', sourceLinks(source)]], source.evidence_note));
    const report = detail.original_attributes.source_link || detail.original_attributes.LINK;
    if (report && /^https?:\/\//i.test(String(report).trim())) content.append(detailSection('Record reference', [['Original evidence', link('Open report or study', report)]]));
    const actions = element('div', null, 'submit-data-actions');
    const download = element('button', 'Download GeoJSON', 'btn-primary'); download.type = 'button';
    download.addEventListener('click', () => downloadRecord(detail).catch(showError));
    const locate = element('button', 'Show on map', 'btn-secondary'); locate.type = 'button';
    locate.addEventListener('click', () => { hideModal('landslide-modal'); map.setView([row[2], row[1]], 12); drawGeometry(detail); });
    const share = element('button', 'Copy record link', 'btn-secondary'); share.type = 'button';
    share.addEventListener('click', async () => {
      const url = new URL(location.href); url.hash = `record=${id}`;
      try { await navigator.clipboard.writeText(url.href); share.textContent = 'Link copied'; }
      catch { actions.append(link('Record link', url.href)); }
    });
    actions.append(download, locate, share); content.append(actions);
    const disclosure = element('details', null, 'landslide-original-fields');
    disclosure.append(element('summary', 'All original source attributes'));
    disclosure.append(detailSection('Original attributes', Object.entries(detail.original_attributes).map(([key, value]) => [key, typeof value === 'object' && value !== null ? JSON.stringify(value) : value]), null, true));
    disclosure.append(detailSection('Provenance', [['Source locator', JSON.stringify(detail.source_locator)]])); content.append(disclosure);
    const record = { centroid_lat: row[2], centroid_lng: row[1], geojson: row[7] === 'footprint' ? detail.geometry : null };
    preview.render($('landslide-preview-map'), record, { pointZoom: 13 });
    preview.render($('landslide-region-map'), record, { locator: true, center: [row[2], row[1]], zoom: 4 });
    preview.render($('landslide-world-map'), record, { locator: true, fitBounds: [[-65, -175], [80, 175]] });
    drawGeometry(detail);
    if (moveMap) map.setView([row[2], row[1]], 10);
    history.replaceState(null, '', '#record=' + id);
  } catch (error) {
    if (generation !== state.detailGeneration) return;
    content.replaceChildren(element('p', error.message, 'stats-hint'));
    const retry = element('button', 'Try again', 'btn-primary');
    retry.addEventListener('click', () => openRecord(id, moveMap)); content.append(retry);
  }
}

function drawGeometry(detail) {
  selectedLayer.clearLayers();
  const color = categoryForFactor(detail.summary[6]).color;
  L.geoJSON(detail.geometry, { style: { color, weight: 3, fillColor: color, fillOpacity: .25 },
    pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 8, color, weight: 2 }) }).addTo(selectedLayer);
}

function openStatisticsGroup(field, selection, panel) {
  const records = selection.records || [];
  const total = records.reduce((sum, record) => sum + record.count, 0);
  panel.elements.binTitle.textContent = `${field.label}: ${selection.label}`;
  if (field.observations) {
    panel.elements.binSummary.replaceChildren(element('span', `${fmt.format(total)} source records`, 'stats-bin-summary-count'));
    panel.elements.binList.replaceChildren();
    let offset = 0;
    const more = element('button', 'Show more records', 'btn-secondary'); more.type = 'button';
    const appendPage = () => {
      more.remove();
      for (const record of records.slice(offset, offset + 100)) {
        const button = element('button', null, 'filter-modal-option stats-bin-option'); button.type = 'button';
        const main = element('span', null, 'stats-bin-main');
        main.append(element('span', `Landslide record ${record.id}`, 'stats-bin-name'), element('span', [record.country, state.sources.get(record.source)?.name].filter(Boolean).join(' · '), 'stats-bin-sub'));
        button.append(main, element('span', `${new Intl.NumberFormat('en', { maximumSignificantDigits: 5 }).format(record[field.key])} ${field.unit || ''}`, 'stats-bin-value'));
        button.addEventListener('click', () => { panel.closeModal(panel.elements.binModal); openRecord(record.id, true); });
        panel.elements.binList.append(button);
      }
      offset += 100;
      if (offset < records.length) panel.elements.binList.append(more);
    };
    more.addEventListener('click', appendPage); appendPage(); panel.openModal(panel.elements.binModal); return;
  }
  panel.elements.binSummary.replaceChildren(element('span', `${fmt.format(total)} source records in ${fmt.format(records.length)} coverage groups`, 'stats-bin-summary-count'));
  panel.elements.binSummary.append(element('p', 'Groups retain exact record counts. Select a group to load its source records and open their individual details.', 'stats-hint'));
  panel.elements.binList.replaceChildren();
  if (state.recordFilter) {
    panel.elements.binSummary.replaceChildren(element('span', `${total} source record`, 'stats-bin-summary-count'));
    const record = records[0];
    const button = element('button', record.name, 'filter-modal-option stats-bin-option'); button.type = 'button';
    button.addEventListener('click', () => { panel.closeModal(panel.elements.binModal); openRecord(record.id); });
    panel.elements.binList.append(button); panel.openModal(panel.elements.binModal); return;
  }
  let offset = 0;
  const more = element('button', 'Show more groups', 'btn-secondary');
  function appendPage() {
    more.remove();
    for (const record of records.slice(offset, offset + 100)) {
      const row = element('button', null, 'filter-modal-option stats-bin-option'); row.type = 'button';
      const main = element('span', null, 'stats-bin-main');
      main.append(element('span', `${record.country} · ${record.movement}`, 'stats-bin-name'),
        element('span', `${state.sources.get(record.source)?.name} · ${record.start || 'Unknown date'}${record.end && record.end !== record.start ? ' – ' + record.end : ''} · ${record.kind}`, 'stats-bin-sub'));
      row.append(main, element('span', `${fmt.format(record.count)} records`, 'stats-bin-value'));
      row.addEventListener('click', () => {
        panel.closeModal(panel.elements.binModal);
        clearFilters(false);
        for (const key of ['source', 'country', 'movement', 'factor', 'kind', 'precision', 'startYear', 'endYear']) $(key + '-filter').value = String(record[key] ?? '');
        applyFilters(); closeSidebar();
        map.fitBounds(extentFor([record.tile]), { padding: [35, 35], maxZoom: 15 });
        renderMap(true);
      });
      panel.elements.binList.append(row);
    }
    offset += 100;
    if (offset < records.length) panel.elements.binList.append(more);
  }
  more.addEventListener('click', appendPage); appendPage(); panel.openModal(panel.elements.binModal);
}

function setupAtlas() {
  const descriptions = {
    mapClass: mapClassDescription,
    family: 'Collection that supplied the record. Collections can include overlapping inventories.',
    source: 'Original inventory or source layer. Source records are not deduplicated across inventories.',
    country: 'Country supplied or normalised from the inventory. Missing countries are excluded.',
    kind: 'Points are source locations. Footprints are mapped areas represented by interior pins on the overview.',
    movement: 'Movement classification recorded by the source; vocabulary and mapping methods differ.',
    factor: 'Reported contributing factor. An unspecified factor does not mean a landslide had no trigger.',
    precision: 'The first class requires a known single date and reported spatial accuracy below 100 m. This is a precision filter, not a reliability rating.'
  };
  const statisticsFields = [...numericalFields, ...fields.filter(field => !['startYear', 'endYear'].includes(field.key)).map(field => ({ ...field, type: 'categorical', description: descriptions[field.key], missingValues: ['', 'ND', 'N/A', 'Unknown', 'Not recorded', 'Not reported', 'None', '-99999'] }))];
  atlas = window.NkuaWebGISUI.createAtlasInterface({
    getRecords: () => state.active,
    getRecordWeight: record => record.count,
    filterFields: fields,
    advancedFields: statisticsFields.filter(field => field.type === 'numeric' && field.filterable !== false),
    statisticsFields,
    getStatisticsRecords,
    onApply: applyFilters,
    onAdvancedApply: (_records, conditions) => { state.advanced = conditions; applyFilters(); },
    onAdvancedClear: () => { state.advanced = []; applyFilters(); },
    onStatisticsGroupSelect: openStatisticsGroup,
    text: {
      statisticsHint: 'Filters apply to the full catalogue. Choose a variable; hover bars for counts or select a bar to explore records.',
      logScaleDefinition: 'Footprint dimensions, date intervals and location accuracy use logarithmic bins so small and large values remain readable. When zero or negative values occur, a symmetric log scale includes them and is linear near zero. Calendar years remain linear. The chart badge identifies the scale; labels, hover values and summary statistics use original units.',
      statisticsCoverage: '{valid} of {total} filtered source records have a value ({percent}).',
      statisticsGuideText: 'Statistics cover all source records matching the global filters, regardless of map zoom or the loaded-area search. Overlapping inventories can describe the same landslide. Missing values are excluded, never treated as zero. Numerical charts show individual reported values or measurements of the original footprints; date charts retain source intervals.',
      visibleRecords: 'Filtered source records',
      visibleRecordsDefinition: 'Source records remaining after the catalogue filters. These are not independently deduplicated landslides.'
    }
  });
  // Keep the complete frequency table available in the shared filter picker.
  atlas.filterPanel.allRecords = state.summaries;
  legend.attach(atlas);
  // Summaries carry no coordinates; the lasso tests their coverage cell.
  lasso.attach(atlas, record => {
    if (!record.tile) return null;
    const [west, south, east, north] = record.tile.bbox;
    return [(south + north) / 2, (west + east) / 2];
  });
  applyFilters();
}

function renderSources() {
  const query = $('source-search').value.trim().toLocaleLowerCase();
  const library = $('source-library'); library.replaceChildren();
  for (const source of state.manifest.sources.filter(entry => `${entry.name} ${entry.provider} ${entry.license}`.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name))) {
    const article = element('section', null, 'reference-section'), head = element('header', null, 'reference-section-heading'), body = element('div', null, 'reference-section-copy');
    const heading = element('h4', sourceFamilies.find(family => family.key === source.family)?.label || source.name); heading.id = 'reference-source-' + source.id; article.setAttribute('aria-labelledby', heading.id);
    head.append(heading, element('p', [source.provider, source.version].filter(Boolean).join(' · ')), element('p', `${fmt.format(source.counts.point || 0)} point records · ${fmt.format(source.counts.footprint || 0)} footprint records`));
    const title = element('p'); title.append(element('em', source.name)); body.append(title, element('p', source.citation));
    if (source.evidence_note) body.append(element('p', source.evidence_note));
    const actions = element('p', null, 'reference-actions'); actions.append(...sourceLinks(source).childNodes);
    if (source.family === 'peloponnese') actions.append(link('Archived layer metadata', './data/metadata/' + source.id + '.json'));
    const explore = element('button', 'Explore this inventory', 'reference-action'); explore.type = 'button';
    explore.disabled = !atlas;
    explore.addEventListener('click', () => { clearFilters(false); $('source-filter').value = source.id; applyFilters(); hideModal('references-modal'); closeSidebar(); fitSelection(); });
    actions.append(explore); body.append(actions); article.append(head, body); library.append(article);
  }
  if (!library.childElementCount) { const empty = element('div', null, 'reference-section-copy'); empty.append(element('p', 'No inventories match this search.')); library.append(empty); }
}

function clearSearch() {
  ++globalSearchRequest;
  clearTimeout(globalSearchTimer);
  searchWorker?.postMessage({ query: '', request: globalSearchRequest });
  $('global-search-input').value = '';
  $('global-search-results').replaceChildren();
  $('global-search-results').classList.add('hidden');
}

function renderSearchSelected() {
  const box = $('global-search-selected'); box.replaceChildren();
  const selections = [
    { key: 'country', label: 'Country', value: $('country-filter')?.value },
    { key: 'source', label: 'Source catalogue', value: $('source-filter')?.value },
    { key: 'record', label: 'Record', value: state.recordFilter ? recordLabel(state.recordFilter) : '' }
  ];
  for (const { key, label, value } of selections) {
    if (!value) continue;
    const badge = element('div', null, 'filter-badge');
    const remove = element('button', '×', 'filter-badge-remove'); remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${label}`);
    remove.addEventListener('click', () => {
      ++selectionRequest;
      if (key === 'record') { state.recordFilter = null; $('record-filter-note')?.remove(); }
      else $(key + '-filter').value = '';
      clearSearch(); applyFilters();
    });
    badge.append(element('span', label + ':', 'filter-badge-label'), element('span', key === 'source' ? state.sources.get(value)?.name || value : value, 'filter-badge-value'), remove);
    box.append(badge);
  }
  box.classList.toggle('hidden', !box.childElementCount);
}

function searchCatalogue() {
  const request = ++globalSearchRequest;
  clearTimeout(globalSearchTimer);
  searchWorker?.postMessage({ query: '', request });
  const query = $('global-search-input').value.trim().toLocaleLowerCase();
  const results = $('global-search-results'); results.replaceChildren(); results.classList.toggle('hidden', !query);
  if (!query) return;
  if (!state.manifest || !atlas) { results.append(element('p', 'Loading catalogue…', 'search-no-results')); return; }
  const addSection = title => {
    const section = element('div', null, 'search-section'), list = element('div', null, 'search-section-list');
    section.append(element('div', title, 'search-section-title'), list); results.append(section); return list;
  };
  const addResult = (list, name, meta, action) => {
    const row = element('button', null, 'search-result search-result-item'); row.type = 'button';
    row.append(element('strong', name, 'search-result-name'));
    if (meta) row.append(element('span', meta, 'search-result-meta'));
    row.addEventListener('click', action); list.append(row);
  };
  const select = (field, value, name) => {
    clearSearch(); ++selectionRequest;
    state.recordFilter = null; $('record-filter-note')?.remove();
    $(field + '-filter').value = value; $('global-search-input').value = name;
    applyFilters(); closeSidebar(); fitSelection();
  };
  const countries = state.manifest.countries.filter(country => country.toLocaleLowerCase().includes(query)).slice(0, 20);
  if (countries.length) {
    const list = addSection('Countries / territories');
    for (const country of countries) addResult(list, country, '', () => select('country', country, country));
  }
  const sources = state.manifest.sources.filter(source => `${source.id} ${source.name} ${source.provider}`.toLocaleLowerCase().includes(query)).slice(0, 20);
  if (sources.length) {
    const list = addSection('Source catalogues');
    for (const source of sources) addResult(list, source.name, '', () => select('source', source.id, source.name));
  }
  const recordResults = addSection('Records');
  if (/^#?\d+$/.test(query)) {
    const id = Number(query.replace('#', ''));
    if (Number.isSafeInteger(id) && id > 0) addResult(recordResults, `Catalogue record ${id}`, 'Open this record', () => selectSearchRecord(id));
  }
  const progress = element('p', Array.from(query).length < 3 ? 'Enter at least three characters to find record names and original IDs.' : 'Searching records…', 'search-no-results');
  recordResults.after(progress);
  if (Array.from(query).length < 3) return;
  globalSearchTimer = setTimeout(() => {
    try {
      searchWorker ||= new Worker(new URL('./search-worker.js?v=20260907-4', import.meta.url));
      let found = 0;
      searchWorker.onmessage = ({ data }) => {
        if (data.request !== request || request !== globalSearchRequest) return;
        if (data.error) { progress.textContent = data.error; return; }
        for (const [id, nativeId, name, country, source] of data.records || []) {
          const button = element('button', null, 'search-result search-result-item'); button.type = 'button';
          button.append(element('strong', recordName(id, name, country, state.sources.get(source)?.family), 'search-result-name'), element('span', [recordedText(country), state.sources.get(source)?.name, `Record ${id}`, recordedText(nativeId) ? `Original ID ${nativeId}` : ''].filter(Boolean).join(' · '), 'search-result-meta'));
          button.addEventListener('click', () => selectSearchRecord(id)); recordResults.append(button); found++;
        }
        progress.textContent = data.done
          ? data.limited ? 'First 50 matching records. Refine your search to see more.' : found ? '' : 'No matching records.'
          : 'Searching records…';
        progress.hidden = data.done && found > 0 && !data.limited;
      };
      searchWorker.onerror = () => { if (request === globalSearchRequest) progress.textContent = 'Catalogue search could not start. Reload the page to try again.'; };
      searchWorker.postMessage({ query, request });
    } catch { progress.textContent = 'This browser could not start catalogue search. Source, country and numeric catalogue-ID lookup remain available.'; }
  }, 300);
}

async function selectSearchRecord(id) {
  clearSearch();
  const request = ++selectionRequest;
  try {
    const records = await cachedJSON(`records/${Math.floor((id - 1) / state.manifest.detail_shard_size)}.json.gz`);
    if (request !== selectionRequest) return;
    const detail = records[id];
    if (!detail) throw new Error('This record number is not present in the catalogue.');
    clearFilters(false); state.recordFilter = detail.summary;
    const name = recordLabel(detail.summary);
    $('global-search-input').value = name;
    const note = element('button', `Record filter: ${id} · Clear`, 'btn-secondary'); note.id = 'record-filter-note'; note.type = 'button';
    note.addEventListener('click', () => clearFilters()); $('filters-tab').prepend(note);
    applyFilters(); closeSidebar(); map.setView([detail.summary[2], detail.summary[1]], 12); openRecord(id);
  } catch (error) { if (request === selectionRequest) showError(error); }
}

function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    const active = tab.id === name + '-tab'; tab.classList.toggle('active', active);
    tab.setAttribute('aria-hidden', String(!active));
  });
  document.querySelectorAll('.tab-button').forEach(button => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function closeSidebar() {
  const wasOpen = $('sidebar').classList.contains('active');
  const trigger = document.querySelector('.mobile-toggle-btn.active');
  $('sidebar').classList.remove('active'); document.body.classList.remove('sidebar-open');
  $('sidebar').removeAttribute('role'); $('sidebar').removeAttribute('aria-modal');
  for (const name of ['filters', 'search', 'stats']) {
    const button = $('mobile-' + name + '-toggle'); button.classList.remove('active'); button.setAttribute('aria-expanded', 'false');
  }
  if (wasOpen) trigger?.focus({ preventScroll: true });
  requestAnimationFrame(() => { map?.invalidateSize(); scheduleRender(); });
}

function bindControls() {
  const tabs = [...document.querySelectorAll('.tab-button')];
  document.querySelector('.tab-nav').setAttribute('role', 'tablist');
  tabs.forEach((button, index) => {
    const panel = $(button.dataset.tab + '-tab');
    button.id = button.dataset.tab + '-tab-button'; button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panel.id); panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => switchTab(button.dataset.tab));
    button.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); switchTab(tabs[next].dataset.tab); tabs[next].focus();
    });
  });
  switchTab('filters');
  for (const name of ['filters', 'search', 'stats']) {
    $('mobile-' + name + '-toggle').setAttribute('aria-controls', 'sidebar');
    $('mobile-' + name + '-toggle').setAttribute('aria-expanded', 'false');
  }
  for (const name of ['filters', 'search', 'stats']) $('mobile-' + name + '-toggle').addEventListener('click', () => {
    const button = $('mobile-' + name + '-toggle');
    if ($('sidebar').classList.contains('active') && button.classList.contains('active')) return closeSidebar();
    closeSidebar(); switchTab(name); $('sidebar').classList.add('active'); document.body.classList.add('sidebar-open'); button.classList.add('active'); button.setAttribute('aria-expanded', 'true');
    $('sidebar').setAttribute('role', 'dialog'); $('sidebar').setAttribute('aria-modal', 'true');
    $('sidebar').setAttribute('aria-label', name === 'stats' ? 'Statistics' : name === 'search' ? 'Search' : 'Filters');
    $('mobile-sidebar-close').focus({ preventScroll: true });
  });
  $('mobile-sidebar-close').addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => { if (innerWidth > 768 && $('sidebar').classList.contains('active')) closeSidebar(); });
  for (const [trigger, modal] of [['about-btn', 'welcome-modal'], ['references-btn', 'references-modal'], ['submit-data-btn', 'submit-data-modal']]) $(trigger).addEventListener('click', () => showModal(modal));
  for (const modal of document.querySelectorAll('#welcome-modal, #landslide-modal, #references-modal, #submit-data-modal')) {
    const close = () => modal.id === 'welcome-modal'
      ? window.NkuaWebGISUI.revealWelcomeModal(modal, () => { hideModal(modal.id); map?.invalidateSize(); })
      : hideModal(modal.id);
    modal.querySelector('[id^="close-"]')?.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
  }
  document.addEventListener('keydown', event => {
    if ($('feature-guide-modal').open) return;
    const modal = [...document.querySelectorAll('.modal.active')].at(-1) || ($('sidebar').classList.contains('active') ? $('sidebar') : null);
    if (!modal) { if (event.key === 'Escape') closeSidebar(); return; }
    if (event.key === 'Escape' && modal.id === 'sidebar') { closeSidebar(); return; }
    if (event.key === 'Escape') { modal.querySelector('.modal-close, .wm-close')?.click(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')].filter(node => !node.disabled && node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  $('error-banner-close').addEventListener('click', () => $('error-banner').classList.add('hidden'));
  $('clear-filters').addEventListener('click', () => { if (atlas) clearFilters(); });
  $('record-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(updateRows, 200); });
  $('global-search-input').addEventListener('input', searchCatalogue);
  $('global-search-input').addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); clearSearch(); } });
  $('global-search-input').addEventListener('focus', () => { if ($('global-search-input').value.trim()) searchCatalogue(); });
  document.addEventListener('click', event => {
    if (event.target.closest('#search-tab')) return;
    ++globalSearchRequest; clearTimeout(globalSearchTimer);
    searchWorker?.postMessage({ query: '', request: globalSearchRequest });
    $('global-search-results').classList.add('hidden');
  });
  $('source-search').addEventListener('input', () => { if (state.manifest) renderSources(); });
  $('previous-page').addEventListener('click', () => { state.page--; renderList(); });
  $('next-page').addEventListener('click', () => { state.page++; renderList(); });
  $('load-area').addEventListener('click', () => {
    closeSidebar();
    requestAnimationFrame(() => { clearTimeout(renderTimer); renderMap(true); });
  });
  $('download-view').addEventListener('click', () => exportCSV().catch(showError));
  window.addEventListener('hashchange', () => { const match = location.hash.match(/^#record=(\d+)$/); if (match && state.manifest) openRecord(Number(match[1]), true); });
}

async function init() {
  bindControls(); showModal('welcome-modal');
  if (!window.L || !window.NkuaWebGISUI || !window.NkuaWebGISMap) throw new Error('A shared map component could not load. Refresh to try again.');
  map = L.map('map', { minZoom: 2, maxZoom: 19, preferCanvas: false, renderer: L.svg({ padding: .5 }),
    zoomAnimation: true, zoomAnimationThreshold: 4, fadeAnimation: true, markerZoomAnimation: true,
    zoomSnap: .25, zoomDelta: .5, wheelPxPerZoomLevel: 80, worldCopyJump: true }).setView([20, 12], 2);
  const basemaps = window.NkuaWebGISMap.createBasemaps();
  const defaultName = window.NkuaWebGISMap.addDefault(map, basemaps);
  window.NkuaWebGISMap.addBasemapPicker(map, basemaps, { defaultName });
  window.NkuaWebGISMap.addNorthArrow(map);
  if (window.MeasurementTool) new window.MeasurementTool(map);
  lasso = window.NkuaWebGISMap.addLassoSelection(map, { onChange: () => { if (atlas) applyFilters(); } });
  coverageLayer =L.markerClusterGroup(clusterOptions(coverageIcon)).addTo(map);
  recordsLayer = L.markerClusterGroup(clusterOptions(cluster => window.NkuaWebGISMap.createCategoryClusterIcon(cluster, legend.visibleCategories()))).addTo(map);
  selectedLayer = L.layerGroup().addTo(map);
  legend = window.NkuaWebGISDisplay.create(map, { storageKey: 'nkua-landslides-display-v1', categories, classify: record => record.mapClass,
    getRecordWeight: record => record.count, title: 'Reported contributing factor', defaultLabel: 'Reported contributing factor',
    onChange: () => { if (atlas) applyFilters(); } });
  const status = element('span', 'Loading global source coverage…', 'sr-only'); status.id = 'map-status'; status.setAttribute('role', 'status');
  map.getContainer().append(status);
  state.manifest = await readJSON('./data/manifest.json');
  for (const source of state.manifest.sources) state.sources.set(source.id, source);
  const counts = state.manifest.counts;
  $('welcome-record-count').textContent = fmt.format((counts.point || 0) + (counts.footprint || 0));
  $('coverage-totals').textContent = `${fmt.format(counts.footprint || 0)} footprint records · ${fmt.format(counts.point || 0)} point records`;
  $('prepared-date').textContent = 'Data prepared ' + new Date(state.manifest.prepared_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '. Observation periods vary by source.';
  renderSources();
  state.tiles = (await readJSON('./data/' + state.manifest.tiles_file)).tiles;
  let groupId = 0;
  for (const tile of state.tiles) {
    tile.summaries = tile.groups.filter(group => state.sources.has(group[0])).map(group => summaryRecord(group, tile));
    for (const record of tile.summaries) record.groupId = groupId++;
    state.summaries.push(...tile.summaries);
  }
  state.active = state.summaries;
  setupAtlas();
  renderSources();
  $('loading').classList.add('hidden');
  map.on('moveend', scheduleRender);
  await renderMap();
  const match = location.hash.match(/^#record=(\d+)$/);
  if (match) { hideModal('welcome-modal'); openRecord(Number(match[1]), true); }
  try {
    const register = await readJSON('./data/source-access.json');
    for (const source of register.sources) {
      const entry = element('div', null, 'reference-additional-source'), title = element('p'), actions = element('p', null, 'reference-actions'); title.append(element('em', source.name)); actions.append(link('Source and access information', source.url)); entry.append(title, element('p', source.status + ' — ' + source.note), actions); $('additional-sources').append(entry);
    }
  } catch { $('additional-sources').textContent = 'The additional-source register is temporarily unavailable. The library above describes the loaded inventories.'; }
}

init().catch(error => {
  $('loading').classList.add('hidden'); showError(error);
  const retry = element('button', 'Reload catalogue', 'btn-secondary'); retry.addEventListener('click', () => location.reload()); $('error-banner-message').append(retry);
});

