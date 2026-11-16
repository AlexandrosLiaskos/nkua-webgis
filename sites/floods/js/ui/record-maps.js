import { buildRecordSurfaces } from './record-surfaces.js?v=20261005-record-maps-3';

// The three reader maps use all source records, independent of the main map filters.
const sections = new Map();
const surfaceCache = new Map();
const countFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const palettes = {
    density: ['#ffffff', '#c7e2f2', '#5b9dcc', '#1b578f', '#0b2545'],
    dates: ['#fff1a6', '#f29f4b', '#d14c47', '#75284d'],
    sources: ['#00cfd4', '#9b65c3', '#ee262b']
};
let catalogueIdentity = null;
let catalogueVersion = 0;
let catalogueRecords = [];
let readyPromise = null;
let visibilityFrame = null;
let smoothingDistance = 75;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function visible(node) {
    const modal = node.closest('.modal');
    return Boolean(node.isConnected && (!modal || modal.classList.contains('active'))
        && !node.closest('[hidden]') && node.getClientRects().length);
}

function nullableNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function readCatalogue() {
    const manager = window.app?.dataManager;
    if (!manager) return null;
    const records = Array.isArray(manager.catalogueRecords) ? manager.catalogueRecords : null;
    const greek = Array.isArray(manager.greekRecords) ? manager.greekRecords : [];
    const hanze = Array.isArray(manager.hanzeRecords) ? manager.hanzeRecords : [];
    const identity = records || `${greek.length}:${hanze.length}`;
    const all = records || (greek.length || hanze.length ? greek.concat(hanze) : null);
    if (!all?.length) return null;
    if (catalogueIdentity !== identity) {
        catalogueIdentity = identity;
        catalogueVersion += 1;
        surfaceCache.clear();
        catalogueRecords = all.flatMap(record => {
            const lat = nullableNumber(record.latitude);
            const lon = nullableNumber(record.longitude);
            const source = String(record.dataset || '').trim().toUpperCase();
            if (lat === null || lon === null || Math.abs(lat) > 85.05112878 || Math.abs(lon) > 180
                || !['NKUA', 'HANZE'].includes(source)) return [];
            return [{ lat, lon, year: nullableNumber(record.year), source }];
        });
    }
    return catalogueRecords;
}

function waitForCatalogue() {
    const records = readCatalogue();
    if (records) return Promise.resolve(records);
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve, reject) => {
        const start = performance.now();
        function check() {
            const ready = readCatalogue();
            if (ready) resolve(ready);
            else if (performance.now() - start > 30000) reject(new Error('The flood catalogue has not loaded.'));
            else setTimeout(check, 250);
        }
        check();
    }).finally(() => { readyPromise = null; });
    return readyPromise;
}

async function surface(bandwidthKm, progress) {
    const records = await waitForCatalogue();
    if (!records.length) throw new Error('No catalogue records have map coordinates.');
    const key = `${catalogueVersion}:${bandwidthKm}`;
    if (!surfaceCache.has(key)) {
        const entry = { listeners: new Set(), promise: null, progress: 0 };
        entry.promise = buildRecordSurfaces(records, {
            bandwidthKm,
            maxWidth: 360,
            onProgress: value => {
                entry.progress = value;
                entry.listeners.forEach(listener => listener(value));
            }
        }).catch(error => { surfaceCache.delete(key); throw error; });
        surfaceCache.set(key, entry);
    }
    const entry = surfaceCache.get(key);
    entry.listeners.add(progress);
    progress(entry.progress);
    try { return await entry.promise; }
    finally { entry.listeners.delete(progress); }
}

function mercatorY(latitude) {
    return Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
}

function latitudeFromMercator(y) {
    return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}

function sample(values, width, height, x, y) {
    x = Math.max(0, Math.min(width - 1, x));
    y = Math.max(0, Math.min(height - 1, y));
    const left = Math.floor(x);
    const top = Math.floor(y);
    const right = Math.min(width - 1, left + 1);
    const bottom = Math.min(height - 1, top + 1);
    const dx = x - left;
    const dy = y - top;
    const cells = [
        [top * width + left, (1 - dx) * (1 - dy)],
        [top * width + right, dx * (1 - dy)],
        [bottom * width + left, (1 - dx) * dy],
        [bottom * width + right, dx * dy]
    ];
    let total = 0;
    let weight = 0;
    for (const [index, contribution] of cells) {
        if (Number.isFinite(values[index]) && contribution > 0) {
            total += values[index] * contribution;
            weight += contribution;
        }
    }
    return weight ? total / weight : NaN;
}

function colourStops(kind) {
    return palettes[kind].map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)));
}

function colour(value, stops) {
    const position = Math.max(0, Math.min(1, value)) * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(position));
    const amount = position - index;
    return stops[index].map((channel, channelIndex) => Math.round(channel + (stops[index + 1][channelIndex] - channel) * amount));
}

function dateValues(state) {
    return state.surface[`${state.dateSummary}Year`];
}

function valueAt(state, values, x, y) {
    const { width, height } = state.surface;
    // Extremes are observed years. Interpolating adjacent minima/maxima would
    // manufacture a year absent from both neighbourhoods.
    if (state.kind === 'dates' && state.dateSummary !== 'mean') {
        const column = Math.max(0, Math.min(width - 1, Math.round(x)));
        const row = Math.max(0, Math.min(height - 1, Math.round(y)));
        return values[row * width + column];
    }
    return sample(values, width, height, x, y);
}

function dateTitle(state) {
    return { mean: 'Mean year', earliest: 'Earliest nearby year', latest: 'Latest nearby year' }[state.dateSummary];
}

function densityColourPosition(state, value) {
    const maximum = state.surface.stats.maxDensity || 1;
    return state.colourScale === 'logarithmic'
        ? Math.log1p(value) / Math.log1p(maximum) : value / maximum;
}

function renderImage(state) {
    const result = state.surface;
    const values = state.kind === 'density' ? result.density
        : state.kind === 'sources' ? result.sourceFraction : dateValues(state);
    const { width, height, bounds, stats } = result;
    const [[south], [north]] = bounds;
    const northY = mercatorY(north);
    const southY = mercatorY(south);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(width, height);
    const stops = colourStops(state.kind);
    // Leaflet image overlays are rectangular in Mercator, while the engine's rows
    // are equally spaced in latitude. Reproject each output row before painting.
    for (let row = 0; row < height; row += 1) {
        const latitude = latitudeFromMercator(northY - (row + 0.5) / height * (northY - southY));
        const engineRow = (north - latitude) / (north - south) * height - 0.5;
        for (let column = 0; column < width; column += 1) {
            const value = valueAt(state, values, column, engineRow);
            if (!Number.isFinite(value)) continue;
            const normalized = state.kind === 'density' ? densityColourPosition(state, value)
                : state.kind === 'sources' ? value
                    : stats.minYear === stats.maxYear ? 0.5 : (value - stats.minYear) / (stats.maxYear - stats.minYear);
            const pixel = (row * width + column) * 4;
            const rgb = colour(normalized, stops);
            pixels.data[pixel] = rgb[0];
            pixels.data[pixel + 1] = rgb[1];
            pixels.data[pixel + 2] = rgb[2];
            const support = sample(result.density, width, height, column, engineRow)
                * 2 * Math.PI * stats.bandwidthKm ** 2 * (1 - Math.exp(-4.5)) / 10000;
            pixels.data[pixel + 3] = state.kind === 'density'
                ? Math.round(205 * Math.min(1, normalized * 3))
                : Math.round(195 * Math.min(1, support));
        }
    }
    context.putImageData(pixels, 0, 0);
    const url = canvas.toDataURL('image/png');
    if (state.overlay) state.overlay.setUrl(url).setBounds(bounds);
    else state.overlay = window.L.imageOverlay(url, bounds, { interactive: false, className: 'record-map-surface' }).addTo(state.map);
}

function legend(state) {
    const node = state.legend;
    const stats = state.surface.stats;
    const title = state.kind === 'density' ? 'Records per 10,000 km²'
        : state.kind === 'dates' ? dateTitle(state)
            : 'Local share of source records';
    const heading = element('div', 'record-map-legend-heading', title);
    const bar = element('div', `record-map-gradient record-map-gradient-${state.kind}`);
    bar.style.backgroundImage = `linear-gradient(to right, ${palettes[state.kind].join(', ')})`;
    const labels = element('div', 'record-map-legend-labels');
    if (state.kind === 'sources') {
        labels.append(element('span', '', 'HANZE'), element('span', 'record-map-legend-middle', 'Equal share'), element('span', '', 'NKUA'));
    } else {
        labels.append(element('span', '', state.kind === 'density' ? '0' : String(stats.minYear)));
        if (state.kind === 'density') {
            const midpoint = state.colourScale === 'logarithmic'
                ? Math.expm1(Math.log1p(stats.maxDensity) / 2) : stats.maxDensity / 2;
            labels.append(element('span', 'record-map-legend-middle', countFormat.format(midpoint)));
        }
        labels.append(element('span', '', state.kind === 'density' ? countFormat.format(stats.maxDensity) : String(stats.maxYear)));
    }
    node.replaceChildren(heading, bar, labels);
}

function tooltipValue(state, latlng) {
    if (!state.surface) return null;
    const result = state.surface;
    const [[south, west], [north, east]] = result.bounds;
    if (latlng.lat < south || latlng.lat > north || latlng.lng < west || latlng.lng > east) return null;
    const x = (latlng.lng - west) / (east - west) * result.width - 0.5;
    const y = (north - latlng.lat) / (north - south) * result.height - 0.5;
    const localDensity = sample(result.density, result.width, result.height, x, y);
    if (state.kind === 'density') return `Records per 10,000 km²: ${countFormat.format(localDensity)}`;
    const value = valueAt(state, state.kind === 'sources' ? result.sourceFraction : dateValues(state), x, y);
    if (!Number.isFinite(value)) return null;
    if (state.kind === 'sources') return `HANZE ${Math.round((1 - value) * 100)}% · NKUA ${Math.round(value * 100)}%`;
    return `${dateTitle(state)}: ${integerFormat.format(value)}`;
}

function addBasemap(state) {
    const L = window.L;
    let available = {};
    try { available = window.NkuaWebGISMap?.createBasemaps() || {}; } catch { /* Use the existing raster provider. */ }
    const vector = available['OpenFreeMap Positron'];
    const satellite = available['ESRI Satellite'] || L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
    state.basemap = vector || satellite;
    try { state.basemap.addTo(state.map); }
    catch {
        try {
            if (state.basemap.getEvents) state.map.off(state.basemap.getEvents(), state.basemap);
            if (state.map.hasLayer(state.basemap)) state.map.removeLayer(state.basemap);
        } catch { /* A failed vector initializer may already have detached its renderer. */ }
        state.basemap = satellite.addTo(state.map);
    }
    if (vector && typeof vector.getMaplibreMap === 'function') {
        try {
            const glMap = vector.getMaplibreMap();
            let recoveryTimer;
            glMap?.on('error', () => {
                // Tile errors can be temporary. Fallback only if the style fails.
                if (glMap.isStyleLoaded?.() || recoveryTimer) return;
                recoveryTimer = setTimeout(() => {
                    if (!glMap.isStyleLoaded?.() && state.map.hasLayer(vector)) {
                        state.map.removeLayer(vector);
                        state.basemap = satellite.addTo(state.map);
                    }
                }, 1500);
            });
        } catch { /* A loaded style does not require an error listener. */ }
    }
}

function field(label, options, value, onChange) {
    const wrapper = element('label', 'record-map-field');
    wrapper.append(element('span', '', label));
    const select = element('select', 'record-map-select');
    for (const [id, text] of options) {
        const option = element('option', '', text);
        option.value = String(id);
        select.append(option);
    }
    select.value = String(value);
    select.addEventListener('change', () => onChange(select.value));
    wrapper.append(select);
    return wrapper;
}

function buildControls(state) {
    const controls = state.container.querySelector('.record-map-controls');
    const smoothing = field('Smoothing', [25, 50, 75, 100, 150].map(value => [value, `${value} km`]), state.bandwidthKm, value => {
        smoothingDistance = Number(value);
        // Keep all three maps comparable when the smoothing scale changes.
        sections.forEach(item => {
            item.bandwidthKm = smoothingDistance;
            item.smoothingSelect.value = String(smoothingDistance);
            update(item);
        });
    });
    state.smoothingSelect = smoothing.querySelector('select');
    controls.append(smoothing);
}

function createMap(state) {
    const L = window.L;
    const canvas = state.container.querySelector('.record-map-canvas');
    state.map = L.map(canvas, {
        zoomControl: true,
        attributionControl: true,
        minZoom: 2,
        maxZoom: 12,
        zoomSnap: 0.25,
        scrollWheelZoom: false,
        zoomAnimation: false,
        fadeAnimation: false,
        keyboard: true
    }).setView([49, 14], 4);
    canvas.setAttribute('aria-label', `${{ density: 'Number of records', dates: 'Dates of records', sources: 'Dataset sources' }[state.kind]} map`);
    addBasemap(state);
    state.tooltip = L.tooltip({ className: 'record-map-tooltip', direction: 'auto', sticky: true, opacity: 1 });
    const showValue = event => {
        const value = tooltipValue(state, event.latlng);
        if (!value) { state.map.closeTooltip(state.tooltip); return; }
        state.tooltip.setLatLng(event.latlng).setContent(element('span', '', value));
        if (!state.map.hasLayer(state.tooltip)) state.tooltip.addTo(state.map);
    };
    state.map.on('mousemove', showValue);
    state.map.on('click', showValue);
    state.map.on('keypress', event => {
        if (event.originalEvent?.key === 'Enter') showValue({ latlng: state.map.getCenter() });
        else if (event.originalEvent?.key === 'Escape') state.map.closeTooltip(state.tooltip);
    });
    state.map.on('mouseout movestart', () => state.map.closeTooltip(state.tooltip));
    if (window.ResizeObserver) {
        let width = 0;
        let height = 0;
        state.resizeObserver = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            if (visible(state.container) && rect.width > 0 && (width !== rect.width || height !== rect.height)) {
                width = rect.width;
                height = rect.height;
                state.map.invalidateSize({ animate: false, pan: false });
            }
        });
        state.resizeObserver.observe(canvas);
    }
}

async function update(state) {
    const generation = ++state.generation;
    state.status.textContent = 'Preparing map…';
    state.container.setAttribute('aria-busy', 'true');
    try {
        const result = await surface(state.bandwidthKm, value => {
            if (generation === state.generation) state.status.textContent = value > 0 && value < 1
                ? `Preparing map… ${Math.round(value * 100)}%` : 'Preparing map…';
        });
        if (generation !== state.generation) return;
        if (state.kind === 'sources' && (!result.stats.sources.NKUA || !result.stats.sources.HANZE)) {
            throw new Error('Both catalogues must load to compare their sources.');
        }
        if (state.kind === 'dates' && (!Number.isFinite(result.stats.minYear) || !Number.isFinite(result.stats.maxYear))) {
            throw new Error('No mapped records have a recorded year.');
        }
        state.surface = result;
        renderImage(state);
        legend(state);
        if (!state.hasView && visible(state.container)) {
            state.map.invalidateSize({ animate: false, pan: false });
            state.map.fitBounds(result.bounds, { padding: [12, 12], maxZoom: 8, animate: false });
            state.hasView = true;
        }
        state.status.textContent = !result.stats.sources.NKUA || !result.stats.sources.HANZE
            ? 'One catalogue is unavailable; showing the loaded records.' : '';
        state.container.removeAttribute('aria-busy');
    } catch (error) {
        if (generation !== state.generation) return;
        state.container.removeAttribute('aria-busy');
        state.status.replaceChildren(element('span', '', error.message || 'The map could not be prepared.'), element('span', '', ' '));
        const retry = element('button', 'record-map-retry', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', () => update(state));
        state.status.append(retry);
    }
}

function activate(container) {
    let state = sections.get(container);
    if (!state) {
        if (!window.L || !['density', 'dates', 'sources'].includes(container.dataset.recordMap)) return;
        state = {
            container, kind: container.dataset.recordMap, bandwidthKm: smoothingDistance,
            dateSummary: 'mean', colourScale: 'logarithmic', generation: 0, hasView: false,
            legend: container.querySelector('.record-map-legend'),
            status: container.querySelector('.record-map-status')
        };
        sections.set(container, state);
        buildControls(state);
        createMap(state);
        update(state);
    }
    requestAnimationFrame(() => {
        state.map.invalidateSize({ animate: false, pan: false });
        // A panel may finish computing while hidden. Fit once, then retain its view.
        if (state.surface && !state.hasView && visible(state.container)) {
            state.map.fitBounds(state.surface.bounds, { padding: [12, 12], maxZoom: 8, animate: false });
            state.hasView = true;
        }
        state.wasVisible = true;
    });
}

function inspectVisibility() {
    visibilityFrame = null;
    document.querySelectorAll('[data-record-map]').forEach(container => {
        if (visible(container)) activate(container);
        else {
            const state = sections.get(container);
            if (state) state.wasVisible = false;
        }
    });
}

function scheduleVisibility() {
    if (visibilityFrame === null) visibilityFrame = requestAnimationFrame(inspectVisibility);
}

function start() {
    const modal = document.getElementById('source-reader-modal');
    if (!modal) return;
    new MutationObserver(mutations => {
        if (mutations.some(({ target }) => target === modal || target.matches?.('.source-document, .source-reader-panel'))) scheduleVisibility();
    }).observe(modal, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    document.addEventListener('click', event => {
        if (event.target.closest?.('[data-reader-topic], [data-open-source]')) scheduleVisibility();
    });
    scheduleVisibility();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
