import LagoonPreviewMap from '/lagoons/js/map/LagoonPreviewMap.js?v=20260907-7';
import { pinTooltipInsideMap } from '/lagoons/js/map/LagoonHoverCard.js?v=20260907-5';

const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const preview = new LagoonPreviewMap(), modalFocus = new WeakMap(), cache = new Map();
let config, records = [], active = [], fields = [], sources, categories, atlas, map, markers, legend, selectedLayer, lasso;
let advanced = [], page = 0, visible = [], detailGeneration = 0, renderGeneration = 0;
let globalSearchTimer, searchCountries = [];
const previewContainers = new Set();
const hoverPreviews = new WeakMap();
const element = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
const recordedText = value => value == null || value === '' ? '' : String(value);
const located = r => Number.isFinite(r.lat) && Number.isFinite(r.lon) && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180;
const mapClassifications = {
  tsunamis: {
    title: 'Observed local height',
    description: 'Local observed water height: below 3 m, at least 3 m, or not reported. Event-wide maxima are not substituted for local measurements. These are display bands, not warning levels.',
    categories: [
      { key: 'below-3m', label: 'Below 3 m', color: '#f97316', border: '#fdba74' },
      { key: 'at-least-3m', label: '3 m or more', color: '#dc2626', border: '#f87171' },
      { key: 'height-unreported', label: 'Local height unreported', color: '#0d9488', border: '#5eead4' }
    ],
    classify: r => !Number.isFinite(r.waterHeight) ? 'height-unreported' : r.waterHeight < 3 ? 'below-3m' : 'at-least-3m'
  },
  wildfires: {
    title: 'Reported burned area',
    description: 'Provider-reported burned area in hectares: below 100 ha, 100 to below 1,000 ha, or at least 1,000 ha. Every record in this release has a reported area; source-reported zeros are retained. These bands describe mapped size, not fire severity or independent fire events.',
    categories: [
      { key: 'under-100ha', label: 'Below 100 ha', color: '#0d9488', border: '#5eead4' },
      { key: '100-1000ha', label: '100 to <1,000 ha', color: '#f97316', border: '#fdba74' },
      { key: 'at-least-1000ha', label: '1,000 ha or more', color: '#dc2626', border: '#f87171' }
    ],
    classify: r => r.areaHa < 100 ? 'under-100ha' : r.areaHa < 1000 ? '100-1000ha' : 'at-least-1000ha'
  },
  earthquakes: {
    title: 'Moment magnitude (Mw)',
    description: 'Reported moment magnitude below 7, at least 7, or unavailable. Other magnitude scales are not substituted for Mw; their values remain in the record details. Classes describe earthquake size, not local shaking or damage.',
    categories: [
      { key: 'mw-below-7', label: 'Mw below 7', color: '#f97316', border: '#fdba74' },
      { key: 'mw-at-least-7', label: 'Mw 7 or more', color: '#dc2626', border: '#f87171' },
      { key: 'mw-unreported', label: 'Mw unreported', color: '#0d9488', border: '#5eead4' }
    ],
    classify: r => !Number.isFinite(r.momentMagnitude) ? 'mw-unreported' : r.momentMagnitude < 7 ? 'mw-below-7' : 'mw-at-least-7'
  }
};
function link(text, url) {
  try { const u = new URL(url, location.href); if (!['http:', 'https:'].includes(u.protocol)) return element('span', text);
    const a = element('a', text); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  } catch { return element('span', text); }
}
async function readJSON(path) {
  const response = await fetch(path + '?v=20260907-2');
  if (!response.ok) throw new Error(`Catalogue file unavailable (${response.status}). Please retry.`);
  if (!path.endsWith('.gz')) return response.json();
  if (!window.DecompressionStream) throw new Error('Please use a current browser that supports compressed catalogue files.');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
}
async function detailFor(r) {
  const file = Math.floor(r.index / config.shardSize);
  if (!cache.has(file)) { const promise = readJSON(`./data/records/${file}.json.gz`); cache.set(file, promise); promise.catch(() => cache.delete(file)); }
  while (cache.size > 8) cache.delete(cache.keys().next().value);
  return (await cache.get(file))[r.id];
}
function save(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = element('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showError(e) { $('error-banner-message').textContent = e.message || String(e); $('error-banner').classList.remove('hidden'); }
function showModal(id) {
  const modal = $(id), title = modal.querySelector('.modal-header h2, .modal-header h3, .wm-title');
  if (title && !modal.hasAttribute('aria-labelledby')) { title.id ||= id + '-title'; modal.setAttribute('aria-labelledby', title.id); }
  modalFocus.set(modal, document.activeElement); modal.classList.add('active'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  document.body.classList.add('modal-open'); modal.querySelector('button, input, [href]')?.focus({ preventScroll: true });
}
function destroyPreviews() { for (const container of previewContainers) preview.destroy(container); previewContainers.clear(); }
function hideModal(id) {
  const modal = $(id); modal.classList.remove('active');
  if (id === 'hazard-modal') { detailGeneration++; destroyPreviews(); selectedLayer?.clearLayers(); history.replaceState(null, '', location.pathname + location.search); }
  if (!document.querySelector('.modal.active')) document.body.classList.remove('modal-open'); modalFocus.get(modal)?.focus?.({ preventScroll: true });
}
function detailSection(title, pairs, note, includeMissing = false) {
  const section = element('section', null, 'lagoon-modal-section'), head = element('header', null, 'lagoon-modal-section-head');
  head.append(element('h4', title, 'lagoon-modal-section-title')); section.append(head);
  const grid = element('div', null, 'lagoon-modal-details-grid');
  for (const [label, value] of pairs) {
    if (!includeMissing && !(value instanceof Node) && !recordedText(value)) continue;
    const item = element('div', null, 'detail-item'), body = element('div', null, 'detail-value');
    if (value instanceof Node) body.append(value); else body.textContent = value == null || value === '' ? 'Not recorded' : String(value);
    item.append(element('div', label, 'detail-label'), body); grid.append(item);
  }
  section.append(grid); if (note) section.append(element('p', note, 'stats-hint')); return section;
}
function mapClass(r) { return categories.find(c => c.key === r.mapClass) || categories[0]; }
// Colour class from the legend display settings (the map class by default).
function category(r) { return legend.classify(r); }
function fieldValue(field, value) {
  if (value == null || value === '') return null;
  if (field.key === 'source') return sources.get(value)?.label || value;
  if (field.valueLabels && Object.prototype.hasOwnProperty.call(field.valueLabels, String(value))) return field.valueLabels[String(value)];
  return typeof value === 'number' ? fmt.format(value) + (field.unit ? ' ' + field.unit : '') : String(value);
}
function titleBlock(r) {
  const block = $('hazard-modal-titleblock'), h = element('h2', null, 'lagoon-name'); h.id = 'hazard-record-name';
  h.append(element('span', r.name, 'lagoon-name-en'));
  block.replaceChildren(element('span', mapClass(r).label, 'lagoon-eyebrow'), h, element('p', [r.country, r.date].filter(Boolean).join(' · '), 'lagoon-locality'));
}
function drawGeometry(r, detail) {
  selectedLayer.clearLayers();
  const geometry = detail.geometry || (located(r) ? { type: 'Point', coordinates: [r.lon, r.lat] } : null);
  if (!geometry) return;
  const color = category(r).color;
  L.geoJSON(geometry, { style: { color, weight: 2, fillOpacity: .18 }, pointToLayer: (_, ll) => L.circleMarker(ll, { radius: 8, color }) }).addTo(selectedLayer);
}
async function openRecord(id, move = false) {
  const r = records.find(r => r.id === String(id)); if (!r) { showError(new Error('This record is not present in this release.')); return; }
  closeSidebar(); destroyPreviews(); titleBlock(r); showModal('hazard-modal');
  const generation = ++detailGeneration, content = $('hazard-details'); content.replaceChildren(element('p', 'Loading source evidence…', 'stats-hint'));
  history.replaceState(null, '', '#record=' + encodeURIComponent(r.id));
  try {
    const detail = await detailFor(r); if (generation !== detailGeneration) return;
    content.replaceChildren();
    if (located(r)) {
      const locators = element('section', null, 'lagoon-modal-locators');
      for (const [cls, caption] of [['locator-detail', r.kind === 'Burned area' ? 'Mapped boundary' : 'Source location'], ['locator-greece', 'Regional context'], ['locator-world', 'World']]) {
        const figure = element('figure', null, 'locator ' + cls), container = element('div', null, 'lagoon-preview-map ' + (cls === 'locator-detail' ? 'lagoon-modal-preview-map' : 'lagoon-modal-locator-map'));
        figure.append(container, element('figcaption', caption)); locators.append(figure); previewContainers.add(container);
      }
      content.append(locators);
    }
    content.append(detailSection('Record', [['Catalogue ID', r.id], ['Original ID', r.nativeId], ['Record type', r.kind], ['Locality', r.name], ['Country', r.country], ['Reported date', r.date], ['Event association', r.eventId], ['Geometry and location', detail.geometryNote]], detail.note));
    content.append(detailSection('Measurements and reported impacts', config.fields.map(f => [f.label, fieldValue(f, r[f.key])]), config.measurementNote));
    const source = sources.get(r.source);
    content.append(detailSection('Sources', [['Inventory', source.name], ['Provider', source.provider], ['Citation', source.citation], ['Reuse', source.license], ['Source', link('Official dataset and documentation', source.url)], ['Original record', detail.url ? link('Open original record', detail.url) : null]], source.note));
    const related = r.eventId ? records.filter(x => x.eventId === r.eventId && x.id !== r.id) : [];
    if (related.length) {
      const section = detailSection('Related source records', [['Association', `${fmt.format(related.length)} records linked through ${r.eventId}`]], 'This relationship connects observations to their documented event. It does not make their locations or measurements interchangeable.');
      let offset = 0; const more = element('button', 'Show more related records', 'btn-secondary');
      function appendRelated() { more.remove(); for (const other of related.slice(offset, offset + 40)) section.append(resultButton(other)); offset += 40; if (offset < related.length) section.append(more); }
      more.addEventListener('click', appendRelated); appendRelated(); content.append(section);
    }
    const actions = element('div', null, 'submit-data-actions');
    const download = element('button', 'Download GeoJSON', 'btn-primary'); download.addEventListener('click', () => save(r.id + '.geojson', JSON.stringify({ type: 'Feature', geometry: detail.geometry || (located(r) ? { type: 'Point', coordinates: [r.lon, r.lat] } : null), properties: { ...r, original_attributes: detail.attributes, source_citation: source.citation, source_license: source.license, source_url: source.url, interpretation: detail.note, geometry_note: detail.geometryNote } }, null, 2), 'application/geo+json'));
    const locate = element('button', 'Show on map', 'btn-secondary'); locate.disabled = !located(r); locate.addEventListener('click', () => { hideModal('hazard-modal'); map.setView([r.lat, r.lon], 11); drawGeometry(r, detail); });
    const share = element('button', 'Copy record link', 'btn-secondary'); share.addEventListener('click', async () => { const u = new URL(location.href); u.hash = 'record=' + encodeURIComponent(r.id); try { await navigator.clipboard.writeText(u.href); share.textContent = 'Link copied'; } catch { actions.append(link('Record link', u.href)); } });
    actions.append(download, locate, share); content.append(actions);
    const disclosure = element('details', null, 'hazard-original-fields'); disclosure.append(element('summary', 'All original source attributes'));
    disclosure.append(detailSection('Original attributes', Object.entries(detail.attributes).map(([k, v]) => [k, v != null && typeof v === 'object' ? JSON.stringify(v) : v]), null, true)); content.append(disclosure);
    if (located(r)) {
      const containers = [...previewContainers], record = { centroid_lat: r.lat, centroid_lng: r.lon, geojson: detail.geometry?.type === 'Point' ? null : detail.geometry };
      preview.render(containers[0], record, { pointZoom: 11 }); preview.render(containers[1], record, { locator: true, center: [r.lat, r.lon], zoom: 4 }); preview.render(containers[2], record, { locator: true, fitBounds: [[-65, -175], [80, 175]] });
      drawGeometry(r, detail); if (move) map.setView([r.lat, r.lon], 9);
    }
  } catch (e) { if (generation !== detailGeneration) return; content.replaceChildren(element('p', e.message, 'stats-hint')); const retry = element('button', 'Try again', 'btn-primary'); retry.addEventListener('click', () => openRecord(r.id, move)); content.append(retry); }
}
function tooltip(r, withPreview = true) {
  const card = element('div', null, 'lagoon-hover-card' + (withPreview ? '' : ' is-text-only')), body = element('div', null, 'lagoon-hover-body');
  if (withPreview) { const wrapper = element('div', null, 'lagoon-hover-preview'), container = element('div', null, 'lagoon-preview-map'); container.dataset.tooltipPreviewMap = ''; container.setAttribute('aria-label', 'Source geometry preview'); wrapper.append(container); card.append(wrapper); }
  body.append(element('span', mapClass(r).label, 'lagoon-hover-eyebrow'), element('h3', r.name, 'lagoon-hover-name'), element('div', [r.country, r.date].filter(Boolean).join(' · '), 'lagoon-hover-locality'));
  const stats = element('div', null, 'lagoon-hover-stats');
  for (const [label, value] of [['Record', r.kind], ...config.fields.filter(f => f.type === 'numeric' && r[f.key] != null).slice(0, 2).map(f => [f.label, fmt.format(r[f.key]) + ' ' + (f.unit || '')])]) {
    const stat = element('div', null, 'lagoon-hover-stat'); stat.append(element('span', label, 'lagoon-hover-stat-label'), element('span', value, 'lagoon-hover-stat-value')); stats.append(stat);
  }
  body.append(stats); card.append(body); return card;
}
function closeHover(tip) { const current = hoverPreviews.get(tip); if (!current) return; hoverPreviews.delete(tip); clearTimeout(current.timer); preview.destroy(current.container); }
function openHover(tip, r) {
  closeHover(tip); tip.setContent(tooltip(r)); pinTooltipInsideMap(tip, map);
  const container = tip.getElement()?.querySelector('[data-tooltip-preview-map]'); if (!container) return;
  const current = { container, timer: null }; hoverPreviews.set(tip, current);
  current.timer = setTimeout(async () => { try {
    const detail = r.kind === 'Burned area' ? await detailFor(r) : null;
    if (hoverPreviews.get(tip) !== current || !container.isConnected) return;
    L.DomEvent.disableClickPropagation(container); L.DomEvent.disableScrollPropagation(container);
    preview.render(container, { centroid_lat: r.lat, centroid_lng: r.lon, geojson: detail?.geometry || null }, { pointZoom: 11 });
  } catch { if (hoverPreviews.get(tip) === current) { closeHover(tip); tip.setContent(tooltip(r, false)); pinTooltipInsideMap(tip, map); } } }, 100);
}
function clusterIcon(cluster) {
  return window.NkuaWebGISMap.createCategoryClusterIcon(cluster, legend.categories());
}
async function renderMap() {
  const generation = ++renderGeneration; markers.clearLayers();
  map.getContainer().setAttribute('aria-busy', 'true');
  const shown = legend.visible(active);
  for (let offset = 0; offset < shown.length; offset += 1200) {
    if (generation !== renderGeneration) return;
    const batch = shown.slice(offset, offset + 1200).filter(located).map(r => {
      const c = category(r), marker = L.marker([r.lat, r.lon], { icon: window.NkuaWebGISMap.createCategoryMarkerIcon(c) }); marker._mapCategory = c.key;
      marker.bindTooltip(() => tooltip(r), { className: 'lagoon-tooltip', direction: 'top', offset: [0, -10], opacity: 1 });
      marker.on('tooltipopen', e => openHover(e.tooltip, r)); marker.on('tooltipclose', e => closeHover(e.tooltip)); marker.on('click', () => openRecord(r.id)); return marker;
    });
    markers.addLayers(batch); await new Promise(resolve => requestAnimationFrame(resolve));
  }
  if (generation === renderGeneration) map.getContainer().setAttribute('aria-busy', 'false');
}
function matches(r) {
  if (lasso && !lasso.contains(r.lat, r.lon)) return false;
  if (!fields.every(f => window.NkuaWebGISUI.matchesFilterValue(r[f.key] ?? '', $(f.inputId).value))) return false;
  let result = null; for (const c of advanced) { const ok = atlas.filterPanel.matchesAdvancedCondition(r, c); result = result === null ? ok : c.logic === 'OR' ? result || ok : result && ok; } return result !== false;
}
function applyFilters() { active = records.filter(matches); atlas.setRecords(active); legend.update(active); renderSearchSelected(); page = 0; renderList(); renderMap(); }
function clearFilters() { lasso?.clear(true); for (const f of fields) $(f.inputId).value = ''; advanced = []; atlas.filterPanel.resetAdvanced(false); clearSearch(); $('record-search').value = ''; applyFilters(); }
function inViewport(r) {
  if (!located(r)) return false; const b = map.getBounds(); if (r.lat < b.getSouth() || r.lat > b.getNorth()) return false;
  if (b.getEast() - b.getWest() >= 360) return true; const normal = x => ((x + 180) % 360 + 360) % 360 - 180, w = normal(b.getWest()), e = normal(b.getEast()); return w <= e ? r.lon >= w && r.lon <= e : r.lon >= w || r.lon <= e;
}
function resultButton(r) {
  const button = element('button', null, 'search-result search-result-item'); button.type = 'button';
  button.append(element('strong', r.name, 'search-result-name'), element('span', [r.country, r.date, mapClass(r).label, sources.get(r.source)?.label, r.id].filter(Boolean).join(' · '), 'search-result-meta'));
  button.addEventListener('click', () => openRecord(r.id, true)); return button;
}
function renderList() {
  const q = $('record-search').value.trim().toLocaleLowerCase();
  visible = active.filter(r => inViewport(r) && (!q || r.search.includes(q))); const pages = Math.max(1, Math.ceil(visible.length / 40)); page = Math.min(page, pages - 1);
  $('record-list').replaceChildren(...visible.slice(page * 40, page * 40 + 40).map(resultButton));
  $('record-status').textContent = `${fmt.format(visible.length)} source records in this area · ${fmt.format(active.length)} matching globally`;
  $('pagination').hidden = pages <= 1; $('page-label').textContent = `${page + 1} / ${pages}`; $('previous-page').disabled = page === 0; $('next-page').disabled = page + 1 >= pages;
  $('download-view').disabled = !visible.length;
}
function clearSearch() {
  clearTimeout(globalSearchTimer);
  $('global-search-input').value = '';
  $('global-search-results').replaceChildren();
  $('global-search-results').classList.add('hidden');
}
function renderSearchSelected() {
  const box = $('global-search-selected'); box.replaceChildren();
  for (const key of ['country', 'source']) {
    const field = fields.find(f => f.key === key), value = field && $(field.inputId).value;
    if (!value) continue;
    const label = key === 'country' ? 'Country' : 'Source catalogue';
    const badge = element('div', null, 'filter-badge');
    const remove = element('button', '×', 'filter-badge-remove'); remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${label}`);
    remove.addEventListener('click', () => { $(field.inputId).value = ''; clearSearch(); applyFilters(); });
    badge.append(element('span', label + ':', 'filter-badge-label'), element('span', key === 'source' ? sources.get(value)?.name || value : value, 'filter-badge-value'), remove);
    box.append(badge);
  }
  box.classList.toggle('hidden', !box.childElementCount);
}
function selectSearchFilter(key, value, label) {
  const field = fields.find(f => f.key === key); if (!field) return;
  clearSearch(); $(field.inputId).value = value;
  $('global-search-input').value = label;
  applyFilters(); closeSidebar();
  const locations = active.filter(located);
  if (locations.length) map.fitBounds(L.latLngBounds(locations.map(r => [r.lat, r.lon])), { padding: [35, 35], maxZoom: 11 });
}
function searchCatalogue() {
  const q = $('global-search-input').value.trim().toLocaleLowerCase(), box = $('global-search-results');
  box.replaceChildren(); box.classList.toggle('hidden', !q); if (!q) return;
  if (!atlas) { box.append(element('p', 'Loading catalogue…', 'search-no-results')); return; }
  const addSection = (title, buttons) => {
    if (!buttons.length) return;
    const section = element('div', null, 'search-section'), list = element('div', null, 'search-section-list');
    list.append(...buttons); section.append(element('div', title, 'search-section-title'), list); box.append(section);
  };
  const filterButton = (key, value, label) => {
    const button = element('button', null, 'search-result search-result-item'); button.type = 'button';
    button.append(element('strong', label, 'search-result-name'));
    button.addEventListener('click', () => selectSearchFilter(key, value, label)); return button;
  };
  addSection('Countries / territories', searchCountries.filter(country => country.toLocaleLowerCase().includes(q)).slice(0, 20).map(country => filterButton('country', country, country)));
  addSection('Source catalogues', config.sources.filter(source => [source.id, source.name, source.label, source.provider].join(' ').toLocaleLowerCase().includes(q)).slice(0, 20).map(source => filterButton('source', source.id, source.name)));
  const found = records.filter(r => r.search.includes(q));
  addSection('Records', found.slice(0, 30).map(r => {
    const button = resultButton(r); button.addEventListener('click', clearSearch); return button;
  }));
  if (found.length > 30) box.append(element('p', 'First 30 matching records. Refine your search to see more.', 'search-no-results'));
  if (!box.childElementCount) box.append(element('p', 'No matches', 'search-empty'));
}
function exportCSV() {
  const keys = ['id', 'nativeId', 'name', 'country', 'date', 'lat', 'lon', 'kind', 'eventId', ...config.fields.map(f => f.key)];
  const headers = [...new Set(keys)].concat(['source_citation', 'source_license', 'source_url']);
  const cell = value => { let s = String(value ?? ''); if (/^[=+@\t\r]/.test(s) || /^-\D/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  save(config.slug + '-area.csv', '\uFEFF' + [headers, ...visible.map(r => { const s = sources.get(r.source); return headers.map(k => k === 'source_citation' ? s.citation : k === 'source_license' ? s.license : k === 'source_url' ? s.url : r[k]); })].map(row => row.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function openStatisticsGroup(field, selection, panel) {
  const found = selection.records || []; panel.elements.binTitle.textContent = `${field.label}: ${selection.label}`;
  panel.elements.binSummary.replaceChildren(element('span', `${fmt.format(found.length)} source records`, 'stats-bin-summary-count')); panel.elements.binList.replaceChildren();
  let offset = 0; const more = element('button', 'Show more records', 'btn-secondary');
  function append() { more.remove(); for (const r of found.slice(offset, offset + 100)) { const b = element('button', null, 'filter-modal-option stats-bin-option'), main = element('span', null, 'stats-bin-main'); main.append(element('span', r.name, 'stats-bin-name'), element('span', [r.country, r.date, r.id].filter(Boolean).join(' · '), 'stats-bin-sub')); b.append(main, element('span', fieldValue(field, r[field.key]) || 'Not recorded', 'stats-bin-value')); b.addEventListener('click', () => { panel.closeModal(panel.elements.binModal); openRecord(r.id, true); }); panel.elements.binList.append(b); } offset += 100; if (offset < found.length) panel.elements.binList.append(more); }
  more.addEventListener('click', append); append(); panel.openModal(panel.elements.binModal);
}
function renderSources() {
  if (!config) return; const q = $('source-search').value.toLocaleLowerCase(), box = $('source-library'); box.replaceChildren();
  for (const s of config.sources.filter(s => (s.name + ' ' + s.provider + ' ' + s.license).toLocaleLowerCase().includes(q))) {
    const section = element('section', null, 'reference-section'), head = element('header', null, 'reference-section-heading'), body = element('div', null, 'reference-section-copy');
    const heading = element('h4', s.label || s.name); heading.id = 'reference-source-' + s.id; section.setAttribute('aria-labelledby', heading.id);
    head.append(heading, element('p', `${fmt.format(records.filter(r => r.source === s.id).length)} source records`));
    const title = element('p'); title.append(element('em', s.name)); body.append(title, element('p', s.citation));
    if (s.note) body.append(element('p', s.note));
    if (s.license) body.append(element('p', s.license));
    const actions = element('p', null, 'reference-actions'); actions.append(link('Official source and documentation', s.url));
    const explore = element('button', 'Explore this inventory', 'reference-action'); explore.type = 'button'; explore.addEventListener('click', () => { clearFilters(); $('source-filter').value = s.id; applyFilters(); hideModal('references-modal'); closeSidebar(); }); actions.append(explore); body.append(actions); section.append(head, body); box.append(section);
  }
  if (!box.childElementCount) { const empty = element('div', null, 'reference-section-copy'); empty.append(element('p', 'No inventories match this search.')); box.append(empty); }
}
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(tab => { const on = tab.id === name + '-tab'; tab.classList.toggle('active', on); tab.setAttribute('aria-hidden', String(!on)); });
  document.querySelectorAll('.tab-button').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
}
function closeSidebar() {
  const was = $('sidebar').classList.contains('active'), trigger = document.querySelector('.mobile-toggle-btn.active'); $('sidebar').classList.remove('active'); document.body.classList.remove('sidebar-open'); $('sidebar').removeAttribute('role'); $('sidebar').removeAttribute('aria-modal');
  for (const name of ['filters', 'search', 'stats']) { const b = $('mobile-' + name + '-toggle'); b.classList.remove('active'); b.setAttribute('aria-expanded', 'false'); }
  if (was) trigger?.focus({ preventScroll: true }); requestAnimationFrame(() => map?.invalidateSize());
}
function bindControls() {
  const tabs = [...document.querySelectorAll('.tab-button')]; document.querySelector('.tab-nav').setAttribute('role', 'tablist');
  tabs.forEach((b, i) => { const panel = $(b.dataset.tab + '-tab'); b.id = b.dataset.tab + '-tab-button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', panel.id); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', b.id); b.addEventListener('click', () => switchTab(b.dataset.tab)); b.addEventListener('keydown', e => { const n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1; if (n < 0) return; e.preventDefault(); switchTab(tabs[n].dataset.tab); tabs[n].focus(); }); }); switchTab('filters');
  for (const name of ['filters', 'search', 'stats']) { const b = $('mobile-' + name + '-toggle'); b.setAttribute('aria-controls', 'sidebar'); b.setAttribute('aria-expanded', 'false'); b.addEventListener('click', () => { if (b.classList.contains('active')) return closeSidebar(); closeSidebar(); switchTab(name); $('sidebar').classList.add('active'); document.body.classList.add('sidebar-open'); b.classList.add('active'); b.setAttribute('aria-expanded', 'true'); $('sidebar').setAttribute('role', 'dialog'); $('sidebar').setAttribute('aria-modal', 'true'); $('sidebar').setAttribute('aria-label', name === 'stats' ? 'Statistics' : name); $('mobile-sidebar-close').focus(); }); }
  $('mobile-sidebar-close').addEventListener('click', closeSidebar); window.addEventListener('resize', () => { if (innerWidth > 768) closeSidebar(); });
  for (const [trigger, modal] of [['about-btn', 'welcome-modal'], ['references-btn', 'references-modal'], ['submit-data-btn', 'submit-data-modal']]) $(trigger).addEventListener('click', () => showModal(modal));
  for (const modal of document.querySelectorAll('#welcome-modal, #hazard-modal, #references-modal, #submit-data-modal')) { const close = () => modal.id === 'welcome-modal' ? window.NkuaWebGISUI.revealWelcomeModal(modal, () => { hideModal(modal.id); map?.invalidateSize(); }) : hideModal(modal.id); modal.querySelector('[id^="close-"]')?.addEventListener('click', close); modal.addEventListener('click', e => { if (e.target === modal) close(); }); }
  document.addEventListener('keydown', e => { if ($('feature-guide-modal').open) return; const modal = [...document.querySelectorAll('.modal.active')].at(-1) || ($('sidebar').classList.contains('active') ? $('sidebar') : null); if (!modal) return; if (e.key === 'Escape') { modal.id === 'sidebar' ? closeSidebar() : modal.querySelector('.modal-close, .wm-close')?.click(); return; } if (e.key !== 'Tab') return; const nodes = [...modal.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')].filter(n => !n.disabled && n.getClientRects().length), first = nodes[0], last = nodes.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } });
  $('error-banner-close').addEventListener('click', () => $('error-banner').classList.add('hidden'));
  $('clear-filters').addEventListener('click', () => atlas && clearFilters()); $('record-search').addEventListener('input', () => { page = 0; renderList(); }); $('source-search').addEventListener('input', renderSources);
  $('global-search-input').addEventListener('input', () => { clearTimeout(globalSearchTimer); $('global-search-results').replaceChildren(); $('global-search-results').classList.add('hidden'); globalSearchTimer = setTimeout(searchCatalogue, 150); });
  $('global-search-input').addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); clearSearch(); } });
  $('global-search-input').addEventListener('focus', () => { if ($('global-search-input').value.trim()) searchCatalogue(); });
  document.addEventListener('click', event => { if (!event.target.closest('#search-tab')) { clearTimeout(globalSearchTimer); $('global-search-results').classList.add('hidden'); } });
  $('previous-page').addEventListener('click', () => { page--; renderList(); }); $('next-page').addEventListener('click', () => { page++; renderList(); }); $('download-view').addEventListener('click', exportCSV);
  window.addEventListener('hashchange', () => { if (config && location.hash.startsWith('#record=')) openRecord(decodeURIComponent(location.hash.slice(8)), true); });
}
async function init() {
  bindControls(); showModal('welcome-modal');
  if (!window.L || !window.NkuaWebGISMap || !window.NkuaWebGISUI) throw new Error('A shared component could not load. Refresh to try again.');
  map = L.map('map', { minZoom: 2, maxZoom: 19, preferCanvas: false, renderer: L.svg({ padding: .5 }), zoomAnimation: true, zoomAnimationThreshold: 4, zoomSnap: .25, zoomDelta: .5, wheelPxPerZoomLevel: 80, worldCopyJump: true }).setView([25, 15], 2);
  const basemaps = window.NkuaWebGISMap.createBasemaps(), defaultName = window.NkuaWebGISMap.addDefault(map, basemaps); window.NkuaWebGISMap.addBasemapPicker(map, basemaps, { defaultName }); window.NkuaWebGISMap.addNorthArrow(map); if (window.MeasurementTool) new window.MeasurementTool(map);
  lasso = window.NkuaWebGISMap.addLassoSelection(map, { onChange: () => { if (atlas) applyFilters(); } });
  config = await readJSON('./data/manifest.json'); sources = new Map(config.sources.map(s => [s.id, s]));
  const classification = mapClassifications[config.slug]; categories = classification.categories;
  const mapClassField = { key: 'mapClass', label: classification.title + ' class', type: 'categorical', group: 'Map classes', description: classification.description, valueLabels: Object.fromEntries(categories.map(c => [c.key, c.label])) };
  records = (await readJSON('./data/catalogue.json.gz')).records; records.forEach((r, index) => { r.index = index; r.mapClass = classification.classify(r); r.search = [r.id, r.nativeId, r.name, r.country, r.date, r.eventId, sources.get(r.source)?.name].filter(Boolean).join(' ').toLocaleLowerCase(); }); active = records;
  searchCountries = [...new Set(records.map(r => r.country).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fields = [mapClassField, ...config.fields.filter(f => f.type === 'categorical')].map(f => ({ ...f, dataField: f.key, filterKey: f.key, inputId: f.key + '-filter', formatValue: f.key === 'source' ? v => sources.get(v)?.label || v : undefined }));
  for (const f of fields) { const n = element('input'); n.type = 'hidden'; n.id = f.inputId; $('filter-controls').prepend(n); }
  markers = L.markerClusterGroup({ chunkedLoading: false, spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true, maxClusterRadius: z => z <= 5 ? 100 : z <= 7 ? 85 : z <= 9 ? 70 : 60, iconCreateFunction: clusterIcon }).addTo(map); selectedLayer = L.layerGroup().addTo(map);
  legend = window.NkuaWebGISDisplay.create(map, { storageKey: `nkua-${config.slug}-display-v1`, categories, classify: r => r.mapClass, title: classification.title, defaultLabel: classification.title, onChange: () => { if (atlas) renderMap(); } });
  const logarithmicFields = new Set(['waterHeight', 'eventMaxHeight', 'inundation', 'travelMinutes', 'distance', 'period', 'depth', 'deaths', 'injuries', 'areaHa', 'computedAreaHa', 'perimeter', 'intervalDays', 'feltResponses', 'housesDestroyed', 'housesDamaged', 'damageMillions']);
  const statisticsFields = [...config.fields, mapClassField].map(f => ({ ...f, ...(f.type === 'numeric' && logarithmicFields.has(f.key) ? { scale: 'log', allowNonPositiveLog: true } : {}), dataField: f.key, missingValues: ['', 'Unknown', 'Not recorded'], formatValue: f.key === 'source' ? v => sources.get(v)?.label || v : undefined }));
  atlas = window.NkuaWebGISUI.createAtlasInterface({ getRecords: () => active, filterFields: fields, advancedFields: statisticsFields.filter(f => f.type === 'numeric'), statisticsFields, onApply: applyFilters, onAdvancedApply: (_r, c) => { advanced = c; applyFilters(); }, onAdvancedClear: () => { advanced = []; applyFilters(); }, onStatisticsGroupSelect: openStatisticsGroup,
    text: { statisticsHint: 'Filters apply to the complete catalogue. Select a bar to explore its records.', statisticsCoverage: '{valid} of {total} filtered source records have a value ({percent}).', statisticsGuideText: config.statisticsNote, logScaleDefinition: 'Sizes, distances, durations and impact counts use logarithmic bins so small and large values remain readable. When zero or negative values occur, a symmetric log scale includes them and is linear near zero. Years, earthquake magnitudes and intensity scales remain linear. The chart badge identifies the scale; labels, hover values and summary statistics use original units.', visibleRecords: 'Filtered source records', visibleRecordsDefinition: config.countNote } });
  atlas.filterPanel.allRecords = records; lasso.attach(atlas, r => [r.lat, r.lon]); legend.attach(atlas);
  $('welcome-record-count').textContent = fmt.format(records.length); $('coverage-totals').textContent = `${fmt.format(records.length)} source records · ${fmt.format(records.filter(located).length)} mapped locations`;
  $('prepared-date').textContent = 'Data acquired ' + config.acquired + '. ' + config.coverage;
  renderSources(); applyFilters(); searchCatalogue(); $('loading').classList.add('hidden'); map.on('moveend', () => { page = 0; renderList(); });
  if (location.hash.startsWith('#record=')) { hideModal('welcome-modal'); openRecord(decodeURIComponent(location.hash.slice(8)), true); }
}
init().catch(e => { $('loading').classList.add('hidden'); showError(e); const retry = element('button', 'Reload catalogue', 'btn-secondary'); retry.addEventListener('click', () => location.reload()); $('error-banner-message').append(retry); });
