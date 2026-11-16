const DATA_URL = './data/stations.geojson';
const EVENT_DATE = '2026-08-15';
const SURVEY_DATE = '2026-08-18';
const SETTING_LABELS = Object.freeze({
    road_upslope: 'Road, upslope side',
    road_downslope: 'Road, downslope side',
    road_edge: 'Road edge',
    road: 'On the road',
    channel: 'Stream bed or gully',
    field: 'Field, grove or yard',
    building: 'Building',
    beach: 'Beach'
});
const POSITION_METHOD_LABELS = Object.freeze({
    manual_google_earth_streetview: 'Placed by hand in Google Earth Pro by the survey team (field photographs, ' +
        'field memory, Google Street View); not camera GPS'
});
// Points are filtered by whether reference images are attached to them, not by the images.
const REFERENCE_LABELS = Object.freeze({
    with: 'Points with reference images',
    without: 'Points without reference images'
});

// Default map colouring: one colour per survey location.
const LOCATION_CATEGORIES = Object.freeze([
    { key: 'L01', label: 'L01 Οίτυλο', color: '#2563eb', border: '#ffffff' },
    { key: 'L02', label: 'L02 Καραβοστάσι', color: '#9333ea', border: '#ffffff' },
    { key: 'L03', label: 'L03 Νέο Οίτυλο', color: '#ea580c', border: '#ffffff' },
    { key: 'L04', label: 'L04 Αλύπα', color: '#0d9488', border: '#ffffff' },
    { key: 'L05', label: 'L05 Κοκκάλα', color: '#dc2626', border: '#ffffff' },
    { key: 'L06', label: 'L06 Έξω Νύμφιο', color: '#a16207', border: '#ffffff' }
]);

const labelFrom = labels => value => labels[value] || value;

// Point filters, all properties of the survey points. order lists the values in display order;
// other filters list the values present in the data, sorted by label.
const FILTERS = Object.freeze([
    { key: 'location', inputId: 'location-filter', dataField: 'locationCode', label: 'Location', all: 'All locations',
        group: 'Survey', format: value => locationLabel(value) },
    { key: 'station', inputId: 'station-filter', dataField: 'stationKey', label: 'Station', all: 'All stations',
        group: 'Survey', format: value => stationLabel(value) },
    { key: 'setting', inputId: 'setting-filter', dataField: 'setting', label: 'Setting', all: 'All settings',
        group: 'Observation', format: labelFrom(SETTING_LABELS), labels: SETTING_LABELS, order: Object.keys(SETTING_LABELS) },
    { key: 'reference', inputId: 'reference-filter', dataField: 'referenceStatus', label: 'Reference images', all: 'All points',
        group: 'Survey', format: labelFrom(REFERENCE_LABELS), labels: REFERENCE_LABELS, order: Object.keys(REFERENCE_LABELS) },
    { key: 'municipalUnit', inputId: 'municipal-unit-filter', dataField: 'municipalUnitShort', label: 'Municipal unit',
        all: 'All municipal units', group: 'Administrative unit (ELSTAT 2021)', format: value => value },
    { key: 'community', inputId: 'community-filter', dataField: 'communityShort', label: 'Community',
        all: 'All communities', group: 'Administrative unit (ELSTAT 2021)', format: value => value }
]);

const state = {
    metadata: {},
    records: [],
    visible: [],
    filters: {},
    viewer: { images: [], index: 0, record: null },
    map: null,
    clusterLayer: null,
    legend: null,
    markersById: new Map(),
    initialBounds: null
};

const elements = {};

function byId(id) {
    return document.getElementById(id);
}

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function escapeHtml(value) {
    return text(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function validWebUrl(value) {
    if (!value || typeof value !== 'string') return '';
    const candidate = value.trim();
    if (!candidate || /^(?:file|javascript|data):/i.test(candidate)) return '';
    try {
        const resolved = new URL(candidate, window.location.href);
        if (!['http:', 'https:'].includes(resolved.protocol)) return '';
        return candidate;
    } catch (_error) {
        return '';
    }
}

function imageKind(value) {
    const normal = text(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ['field_photo', 'primary', 'photo'].includes(normal) ? 'field_photo' : 'reference';
}

function normalizeImage(raw, recordId, index) {
    if (!raw || typeof raw !== 'object') return null;
    const previewUrl = validWebUrl(raw.preview_url || raw.preview || raw.thumbnail_url || raw.thumbnail);
    const fullUrl = validWebUrl(raw.full_url || raw.full || raw.png_url || raw.href || raw.url);
    if (!previewUrl && !fullUrl) return null;

    const kind = imageKind(raw.kind || raw.type);
    return {
        kind: kind,
        previewUrl: previewUrl || fullUrl,
        fullUrl: fullUrl || previewUrl,
        captureTime: text(raw.capture_time || raw.captured_at || raw.timestamp).trim(),
        alt: text(raw.alt).trim() ||
            (kind === 'field_photo' ? 'Field photograph' : 'Reference image') +
            ' assigned to ' + recordId,
        caption: text(raw.caption || raw.title).trim() || recordId + ' · image ' + (index + 1),
        occurrence: Number.isFinite(Number(raw.occurrence)) ? Number(raw.occurrence) : null
    };
}

function normalizeFeature(feature, index) {
    if (!feature || feature.type !== 'Feature') {
        throw new Error('Feature ' + (index + 1) + ' is not a GeoJSON Feature.');
    }
    if (!feature.geometry || feature.geometry.type !== 'Point' ||
        !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) {
        throw new Error('Feature ' + (index + 1) + ' must have Point geometry.');
    }

    const longitude = Number(feature.geometry.coordinates[0]);
    const latitude = Number(feature.geometry.coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        throw new Error('Feature ' + (index + 1) + ' has invalid longitude or latitude.');
    }

    const properties = feature.properties || {};
    const id = text(properties.placemark_id || properties.id || feature.id).trim();
    const point = text(properties.point).trim();
    const station = text(properties.station_code || properties.station).trim().toUpperCase();
    const locationCode = text(properties.location_code).trim().toUpperCase();
    const eventDate = text(properties.event_date).slice(0, 10);
    const surveyDate = text(properties.survey_date).slice(0, 10);

    if (!/^L\d{2}_S\d{2}[a-z]?$/.test(id)) {
        throw new Error('Feature ' + (index + 1) + ' has invalid point id "' + id + '".');
    }
    if (id !== locationCode + '_' + point || !point.startsWith(station)) {
        throw new Error(id + ' does not match its location ' + locationCode + ' and station ' + station + '.');
    }
    if (eventDate !== EVENT_DATE) throw new Error(id + ' has an unexpected event date.');
    if (surveyDate !== SURVEY_DATE) throw new Error(id + ' has an unexpected survey date.');

    const sourceImages = Array.isArray(properties.images)
        ? properties.images
        : Array.isArray(properties.photos) ? properties.photos : [];
    const images = sourceImages
        .map((item, imageIndex) => normalizeImage(item, id, imageIndex))
        .filter(Boolean);
    const inferredPhotoCount = images.filter(item => item.kind === 'field_photo').length;
    const suppliedPhotoCount = Number(properties.photo_count);
    const photoCount = Number.isInteger(suppliedPhotoCount) && suppliedPhotoCount >= 0
        ? suppliedPhotoCount : inferredPhotoCount;
    // Count the distinct reference images the gallery shows.
    const referenceImageCount = uniqueGalleryImages(images.filter(item => item.kind === 'reference')).length;
    const captureTimes = images
        .filter(item => item.kind === 'field_photo' && item.captureTime)
        .map(item => item.captureTime)
        .sort();
    const firstCapture = text(properties.first_photo_time).trim() || captureTimes[0] || '';
    const lastCapture = text(properties.last_photo_time).trim() || captureTimes[captureTimes.length - 1] || '';
    const hourMatch = firstCapture.match(/T(\d{2}):/);
    const numberOrNull = value => value === null || value === undefined || value === '' ||
        !Number.isFinite(Number(value)) ? null : Number(value);

    return {
        id: id,
        point: point,
        station: station,
        stationKey: locationCode + '_' + station,
        locationCode: locationCode,
        locationNameEl: text(properties.location_name_el).trim(),
        locationNameEn: text(properties.location_name_en).trim(),
        // Administrative units, ELSTAT Census 2021 names and codes.
        settlementName: text(properties.settlement_name).trim(),
        settlementCode: text(properties.settlement_code).trim(),
        settlementPopulation: numberOrNull(properties.settlement_population_2021),
        communityName: text(properties.community_name).trim(),
        communityCode: text(properties.community_code).trim(),
        // Official abbreviations, e.g. "Δημοτική Κοινότητα Οιτύλου" -> "Δ.Κ. Οιτύλου".
        communityShort: text(properties.community_name).trim()
            .replace(/^Δημοτική Κοινότητα /, 'Δ.Κ. ').replace(/^Τοπική Κοινότητα /, 'Τ.Κ. '),
        municipalUnitName: text(properties.municipal_unit_name).trim(),
        municipalUnitCode: text(properties.municipal_unit_code).trim(),
        municipalUnitShort: text(properties.municipal_unit_name).trim().replace(/^ΔΗΜΟΤΙΚΗ ΕΝΟΤΗΤΑ /i, 'Δ.Ε. '),
        municipalityName: text(properties.municipality_name).trim(),
        municipalityCode: text(properties.municipality_code).trim(),
        regionalUnitName: text(properties.regional_unit_name).trim(),
        regionName: text(properties.region_name).trim(),
        setting: text(properties.setting).trim(),
        note: text(properties.note).trim(),
        eventDate: eventDate,
        surveyDate: surveyDate,
        longitude: longitude,
        latitude: latitude,
        easting: numberOrNull(properties.easting_egsa87),
        northing: numberOrNull(properties.northing_egsa87),
        photoCount: photoCount,
        referenceImageCount: referenceImageCount,
        referenceStatus: referenceImageCount > 0 ? 'with' : 'without',
        firstCapture: firstCapture,
        lastCapture: lastCapture,
        surveyHour: hourMatch ? hourMatch[1] + ':00–' + hourMatch[1] + ':59' : null,
        positionMethod: text(properties.position_method).trim(),
        positionAccuracy: numberOrNull(properties.position_accuracy_m),
        coordinateSource: text(properties.coordinate_source).trim(),
        coordinatePrecision: text(properties.coordinate_precision_status).trim(),
        images: images,
        sourceProperties: properties
    };
}

function validateCollection(collection) {
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
        throw new Error('stations.geojson must be a GeoJSON FeatureCollection.');
    }

    const records = collection.features.map(normalizeFeature);
    const ids = new Set();
    records.forEach(record => {
        if (ids.has(record.id)) throw new Error('Duplicate point id: ' + record.id + '.');
        ids.add(record.id);
    });

    const metadata = collection.metadata && typeof collection.metadata === 'object'
        ? collection.metadata : {};
    if (metadata.point_count !== undefined && Number(metadata.point_count) !== records.length) {
        throw new Error('Metadata lists ' + metadata.point_count + ' points; the file has ' + records.length + '.');
    }
    const locations = new Set(records.map(record => record.locationCode));
    if (metadata.location_count !== undefined && Number(metadata.location_count) !== locations.size) {
        throw new Error('Metadata lists ' + metadata.location_count + ' locations; the file has ' + locations.size + '.');
    }

    return { metadata: metadata, records: records };
}

function categoryFor(record) {
    return LOCATION_CATEGORIES.find(category => category.key === record.locationCode) || LOCATION_CATEGORIES[0];
}

function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorBanner.classList.remove('hidden');
}

function clearError() {
    elements.errorBanner.classList.add('hidden');
    elements.errorMessage.textContent = '';
}

function setLoading(isLoading) {
    elements.loading.classList.toggle('hidden', !isLoading);
    elements.loading.setAttribute('aria-hidden', String(!isLoading));
}

function createMap() {
    state.map = L.map('map', {
        zoomControl: false,
        preferCanvas: true,
        zoomSnap: 0.25,
        minZoom: 2,
        maxZoom: 20
    });
    state.map.setView([36.708, 22.387], 15);
    L.control.zoom({ position: 'topleft' }).addTo(state.map);

    const mapTools = window.NkuaWebGISMap;
    if (mapTools) {
        const basemaps = mapTools.createBasemaps();
        const defaultName = mapTools.addDefault(state.map, basemaps);
        mapTools.addBasemapPicker(state.map, basemaps, {
            defaultName: defaultName,
            label: 'Select basemap'
        });
        mapTools.addNorthArrow(state.map, { label: 'N', title: 'North' });
        state.legend = window.NkuaWebGISDisplay.create(state.map, {
            storageKey: 'nkua-mani-floods-display-v3',
            defaultLabel: 'Location',
            onChange: () => updateMarkers(),
            title: 'Location',
            subtitle: 'Survey points',
            ariaLabel: 'Survey points by location legend',
            categories: LOCATION_CATEGORIES,
            classify: record => record.locationCode
        });
    } else {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(state.map);
    }

    state.clusterLayer = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 34,
        spiderfyOnMaxZoom: true,
        iconCreateFunction: cluster => {
            if (mapTools) return mapTools.createCategoryClusterIcon(cluster, state.legend ? state.legend.categories() : LOCATION_CATEGORIES);
            return L.divIcon({
                className: 'minimal-cluster',
                html: '<div class="cluster-icon">' + cluster.getChildCount() + '</div>'
            });
        }
    });
    state.map.addLayer(state.clusterLayer);

    const FitControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const button = L.DomUtil.create('button', 'mani-fit-control', container);
            button.type = 'button';
            button.title = 'Fit visible placemarks';
            button.setAttribute('aria-label', 'Fit visible placemarks');
            button.innerHTML =
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"></path></svg>';
            button.addEventListener('click', event => {
                event.preventDefault();
                fitVisible();
            });
            L.DomEvent.disableClickPropagation(container);
            return container;
        }
    });
    state.map.addControl(new FitControl());

    if (window.MeasurementTool) new window.MeasurementTool(state.map);
    if (mapTools?.addLassoSelection) {
        state.lasso = mapTools.addLassoSelection(state.map, { onChange: () => applyFilters() });
    }
}

function pinTooltipInsideMap(tooltip, map, opts = {}) {
    const el = tooltip?.getElement?.();
    if (!el || !map) return;

    const margin = opts.margin ?? 8;
    const topOffset = opts.topOffset ?? [0, -14];
    const botOffset = opts.botOffset ?? [0, 14];

    const mapRect = map.getContainer().getBoundingClientRect();
    let elRect = el.getBoundingClientRect();

    const overflowsTop = elRect.top < mapRect.top + margin;
    const overflowsBottom = elRect.bottom > mapRect.bottom - margin;
    const dir = tooltip.options.direction;

    if (overflowsTop && dir !== 'bottom') {
        tooltip.options.direction = 'bottom';
        tooltip.options.offset = botOffset;
        tooltip.update();
        elRect = el.getBoundingClientRect();
    } else if (overflowsBottom && dir !== 'top') {
        tooltip.options.direction = 'top';
        tooltip.options.offset = topOffset;
        tooltip.update();
        elRect = el.getBoundingClientRect();
    }

    let dx = 0, dy = 0;
    if (elRect.left < mapRect.left + margin) dx = (mapRect.left + margin) - elRect.left;
    if (elRect.right > mapRect.right - margin) dx = (mapRect.right - margin) - elRect.right;
    if (elRect.top < mapRect.top + margin) dy = (mapRect.top + margin) - elRect.top;
    if (elRect.bottom > mapRect.bottom - margin) dy = (mapRect.bottom - margin) - elRect.bottom;

    el.style.translate = (dx || dy) ? `${dx}px ${dy}px` : '';
}

function buildPlacemarkHoverHTML(record) {
    const primaryImage = (record.images && record.images.find(img => img.kind === 'field_photo')) ||
        (record.images && record.images[0]);
    const previewUrl = primaryImage ? (primaryImage.previewUrl || primaryImage.fullUrl) : '';
    const captureTime = primaryImage && primaryImage.captureTime ? readableCaptureTime(primaryImage.captureTime) : '';

    return `
        <div class="lagoon-hover-card${previewUrl ? '' : ' is-text-only'}">
            ${previewUrl ? `
                <div class="lagoon-hover-preview">
                    <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(record.id)}" loading="lazy" decoding="async">
                </div>
            ` : ''}
            <div class="lagoon-hover-body">
                <span class="lagoon-hover-eyebrow">${escapeHtml(record.locationCode)} · Station ${escapeHtml(record.station)}</span>
                <h3 class="lagoon-hover-name">
                    <span class="lagoon-hover-name-en">${escapeHtml(record.point)}</span>
                    <span class="lagoon-hover-name-sep" aria-hidden="true">·</span>
                    <span class="lagoon-hover-name-gr">${escapeHtml(record.locationNameEl)}</span>
                </h3>
                <div class="lagoon-hover-locality">
                    <svg class="lagoon-hover-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span class="lagoon-hover-loc-main">${escapeHtml(record.locationNameEn)}</span>
                    <span class="lagoon-hover-loc-dot" aria-hidden="true">·</span>
                    <span class="lagoon-hover-loc-island">${escapeHtml(SETTING_LABELS[record.setting] || record.setting)}</span>
                </div>
                <div class="lagoon-hover-stats">
                    <div class="lagoon-hover-stat">
                        <span class="lagoon-hover-stat-label">Field photographs</span>
                        <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                        <span class="lagoon-hover-stat-value">${record.photoCount} photo${record.photoCount === 1 ? '' : 's'}</span>
                    </div>
                    <div class="lagoon-hover-stat">
                        <span class="lagoon-hover-stat-label">Settlement</span>
                        <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                        <span class="lagoon-hover-stat-value">${escapeHtml(record.settlementName)}</span>
                    </div>
                    <div class="lagoon-hover-stat">
                        <span class="lagoon-hover-stat-label">${captureTime ? 'Capture time' : 'Survey date'}</span>
                        <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                        <span class="lagoon-hover-stat-value">${escapeHtml(captureTime || '18 Aug 2026')}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function createMarker(record) {
    const mapTools = window.NkuaWebGISMap;
    const category = state.legend ? state.legend.classify(record) : categoryFor(record);
    const marker = L.marker([record.latitude, record.longitude], {
        icon: mapTools ? mapTools.createCategoryMarkerIcon(category, { size: 18 }) : undefined,
        title: record.point + ', ' + record.locationNameEn,
        keyboard: true,
        riseOnHover: true
    });
    marker._mapCategory = category.key;
    marker.bindTooltip(
        () => buildPlacemarkHoverHTML(record),
        {
            className: 'custom-tooltip',
            direction: 'top',
            offset: [0, -14],
            opacity: 1
        }
    );
    marker.on('tooltipopen', e => {
        requestAnimationFrame(() => pinTooltipInsideMap(e.tooltip, state.map));
    });
    marker.on('click', () => openPlacemark(record));
    return marker;
}

function updateMarkers() {
    state.clusterLayer.clearLayers();
    state.markersById.clear();
    const shown = state.legend ? state.legend.visible(state.visible) : state.visible;
    const markers = shown.map(record => {
        const marker = createMarker(record);
        state.markersById.set(record.id, marker);
        return marker;
    });
    state.clusterLayer.addLayers(markers);
    if (state.legend) state.legend.update(state.visible);
}

function visibleBounds() {
    if (!state.visible.length) return null;
    return L.latLngBounds(state.visible.map(record => [record.latitude, record.longitude]));
}

function fitVisible(options) {
    const bounds = visibleBounds();
    if (!bounds) return;
    state.map.fitBounds(bounds, Object.assign({
        paddingTopLeft: [30, 30],
        paddingBottomRight: [30, 74],
        maxZoom: 18
    }, options));
}

// Opening view: half a zoom level out from the closest whole-level fit of all points,
// so the locations sit in some surrounding landscape.
function fitDefault() {
    if (!state.visible.length) return;
    fitVisible({ animate: false });
    state.map.setZoom(Math.floor(state.map.getZoom()) - 0.5, { animate: false });
}

function filterInputs() {
    return FILTERS.map(filter => byId(filter.inputId)).filter(Boolean);
}

function filterOptions(filter) {
    const present = [...new Set(state.records.map(record => record[filter.dataField]).filter(Boolean))];
    if (filter.order) return filter.order.filter(value => present.includes(value));
    return present.sort((a, b) => filter.format(a).localeCompare(filter.format(b), 'el', { numeric: true }));
}

function locationLabel(code) {
    const record = state.records.find(item => item.locationCode === code);
    return record ? code + ' ' + record.locationNameEl : code;
}

function stationLabel(key) {
    const [code, station] = text(key).split('_');
    return locationLabel(code) + ' · ' + station;
}

// Filter selects can hold several values (multi-select); see NkuaWebGISUI.
function readFilter(input) {
    if (!input) return '';
    return window.NkuaWebGISUI ? window.NkuaWebGISUI.readFilterInput(input) : input.value;
}

function filterMatches(value, raw) {
    if (window.NkuaWebGISUI) return window.NkuaWebGISUI.matchesFilterValue(value, raw);
    return !raw || String(value) === raw;
}

function applyFilters(options) {
    const fit = options && options.fit;
    FILTERS.forEach(filter => {
        state.filters[filter.key] = readFilter(byId(filter.inputId));
    });

    filterInputs().forEach(input => input.classList.toggle('has-value', Boolean(readFilter(input))));

    state.visible = state.records.filter(record => {
        if (!FILTERS.every(filter => filterMatches(record[filter.dataField], state.filters[filter.key]))) return false;
        if (state.lasso && !state.lasso.contains(record.latitude, record.longitude)) return false;
        return true;
    });
    updateMarkers();
    renderActiveFilters();
    renderSearchResults(elements.searchInput.value);
    if (state.commonInterface) {
        state.commonInterface.setRecords(state.visible);
    }
    if (fit) fitVisible();
}

function renderActiveFilters() {
    if (!elements.activeFiltersList || !elements.activeFiltersSummary) return;
    elements.activeFiltersList.replaceChildren();
    const filters = FILTERS.filter(filter => state.filters[filter.key]).map(filter => {
        const raw = state.filters[filter.key];
        const values = window.NkuaWebGISUI ? window.NkuaWebGISUI.parseFilterValue(raw) : [raw];
        return [filter.label, values.map(filter.format).join(', ')];
    });

    elements.activeFiltersSummary.classList.toggle('hidden', filters.length === 0);
    filters.forEach(([label, value]) => {
        const item = document.createElement('span');
        item.className = 'filter-badge';
        item.textContent = label + ': ' + value;
        elements.activeFiltersList.appendChild(item);
    });
}

function searchHaystack(record) {
    return [
        record.id,
        record.point,
        record.station,
        record.locationCode,
        record.locationNameEl,
        record.locationNameEn,
        record.settlementName,
        record.settlementCode,
        record.communityName,
        record.communityShort,
        record.municipalUnitName,
        record.municipalUnitShort,
        record.note,
        SETTING_LABELS[record.setting],
        record.eventDate,
        record.surveyDate,
        ...record.images.flatMap(image => [image.caption, image.captureTime, image.kind])
    ].join(' ').toLocaleLowerCase('en-GB');
}

function renderSearchResults(query) {
    const needle = text(query).trim().toLocaleLowerCase('en-GB');
    elements.searchResults.replaceChildren();
    if (!needle) {
        elements.searchResults.classList.add('hidden');
        return;
    }

    const matches = state.visible.filter(record => searchHaystack(record).includes(needle));
    elements.searchResults.classList.remove('hidden');
    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'search-no-results';
        empty.setAttribute('role', 'option');
        empty.setAttribute('aria-disabled', 'true');
        empty.textContent = 'No visible survey point matches this search.';
        elements.searchResults.appendChild(empty);
        return;
    }

    matches.forEach(record => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-result-item';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', 'false');
        const name = document.createElement('span');
        name.className = 'search-result-name';
        name.textContent = record.point + ' · ' + record.locationNameEl;
        const meta = document.createElement('span');
        meta.className = 'search-result-meta';
        meta.textContent =
            record.locationCode + ' ' + record.locationNameEn + ' · ' + (SETTING_LABELS[record.setting] || record.setting);
        button.append(name, meta);
        button.addEventListener('click', () => {
            elements.searchResults.querySelectorAll('[aria-selected="true"]')
                .forEach(item => item.setAttribute('aria-selected', 'false'));
            button.setAttribute('aria-selected', 'true');
            focusRecord(record);
        });
        elements.searchResults.appendChild(button);
    });
}

function focusRecord(record) {
    const marker = state.markersById.get(record.id);
    if (!marker) return;
    state.map.setView(marker.getLatLng(), Math.max(state.map.getZoom(), 18), { animate: true });
    const visibleParent = state.clusterLayer.getVisibleParent
        ? state.clusterLayer.getVisibleParent(marker) : marker;
    if (visibleParent && visibleParent !== marker && typeof visibleParent.spiderfy === 'function') {
        visibleParent.spiderfy();
    }
    window.setTimeout(() => openPlacemark(record), 220);
}

function readableDate(isoDate) {
    const parts = text(isoDate).slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return text(isoDate);
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
}

function readableCaptureTime(value) {
    const match = text(value).match(
        /^(\d{4})-(\d{2})-(\d{2})[T_ ](\d{2}):?(\d{2})/
    );
    if (!match) return text(value);
    const date = readableDate(match[1] + '-' + match[2] + '-' + match[3]);
    const time = match[4] + ':' + match[5];
    return date + ', ' + time;
}

function uniqueGalleryImages(images) {
    const seen = new Set();
    return images.filter(image => {
        const key = image.fullUrl || image.previewUrl;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}


function imageSourceLabel(image) {
    if (image.kind === 'field_photo') return 'NKUA field survey';
    const raw = text(image.caption || image.alt).toLowerCase();
    return raw.includes('google') ? 'Google Street View' : 'Ground reference';
}

// Street View references carry the month of the imagery as YYYY-MM.
function referenceMonth(image) {
    const match = image.kind !== 'field_photo' && image.captureTime.match(/^(\d{4})-(\d{2})$/);
    if (!match) return '';
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function photoCard(image, record, index, gallery) {
    const figure = document.createElement('figure');
    figure.className = 'mani-photo-card';
    figure.dataset.kind = image.kind;

    const link = document.createElement('a');
    link.className = 'mani-photo-link';
    link.href = image.fullUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'View photograph ' + (index + 1) + ' of ' + gallery.length + ': ' + image.alt);
    link.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        openViewer(gallery, index, record, link);
    });

    const picture = document.createElement('picture');
    if (image.previewUrl && image.previewUrl.endsWith('.jpg')) {
        const webpSource = document.createElement('source');
        webpSource.srcset = image.previewUrl.replace(/\.jpg$/, '.webp');
        webpSource.type = 'image/webp';
        picture.appendChild(webpSource);
    }

    const imageElement = document.createElement('img');
    imageElement.src = image.previewUrl;
    imageElement.alt = image.alt;
    imageElement.decoding = 'async';

    if (index < 4) {
        imageElement.loading = 'eager';
        imageElement.fetchPriority = 'high';
    } else {
        imageElement.loading = 'lazy';
        imageElement.fetchPriority = 'low';
    }

    if (imageElement.complete) {
        imageElement.classList.add('is-loaded');
    } else {
        imageElement.addEventListener('load', () => {
            imageElement.classList.add('is-loaded');
        }, { once: true });
    }

    imageElement.addEventListener('error', () => {
        imageElement.alt = image.alt + ' (preview unavailable)';
        figure.classList.add('is-image-unavailable');
    }, { once: true });
    picture.appendChild(imageElement);
    link.appendChild(picture);

    const caption = document.createElement('figcaption');
    const isFieldPhoto = image.kind === 'field_photo';
    const timeString = isFieldPhoto && image.captureTime ? readableCaptureTime(image.captureTime) : '';
    const meta = document.createElement('span');
    meta.className = 'mani-photo-meta';
    if (timeString) {
        meta.textContent = timeString;
        caption.appendChild(meta);
    } else if (!isFieldPhoto) {
        meta.textContent = [imageSourceLabel(image), referenceMonth(image)].filter(Boolean).join(' · ');
        caption.appendChild(meta);
    }

    if (caption.hasChildNodes()) {
        figure.append(link, caption);
    } else {
        figure.appendChild(link);
    }
    return figure;
}

function captureClock(value) {
    const match = text(value).match(/T(\d{2}):(\d{2})/);
    return match ? match[1] + ':' + match[2] : '';
}

function captureWindow(record) {
    const first = captureClock(record.firstCapture);
    const last = captureClock(record.lastCapture);
    if (!first) return '';
    return first === last ? first : first + '–' + last;
}

function renderPlacemarkTitle(record) {
    const nameEn = document.createElement('span');
    nameEn.className = 'lagoon-name-en';
    nameEn.textContent = record.point;
    const separator = document.createElement('span');
    separator.className = 'lagoon-name-sep';
    separator.setAttribute('aria-hidden', 'true');
    separator.textContent = '·';
    const nameEl = document.createElement('span');
    nameEl.className = 'lagoon-name-gr';
    nameEl.textContent = record.locationNameEl;
    elements.placemarkTitle.replaceChildren(nameEn, separator, nameEl);

    elements.placemarkTitleblock.querySelector('.lagoon-locality')?.remove();
    const locality = document.createElement('p');
    locality.className = 'lagoon-locality';
    locality.innerHTML =
        '<svg class="lagoon-locality-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>' +
        '<circle cx="12" cy="10" r="3"></circle></svg>';
    [
        ['lagoon-locality-main', record.locationNameEn + ', Mani'],
        ['lagoon-locality-island', record.locationCode + ' · Station ' + record.station]
    ].forEach(([className, value], index) => {
        if (index) {
            const dot = document.createElement('span');
            dot.className = 'lagoon-locality-dot';
            dot.setAttribute('aria-hidden', 'true');
            dot.textContent = '·';
            locality.appendChild(dot);
        }
        const part = document.createElement('span');
        part.className = className;
        part.textContent = value;
        locality.appendChild(part);
    });
    elements.placemarkTitleblock.appendChild(locality);
}

function detailSection(title, rows) {
    const section = document.createElement('section');
    section.className = 'lagoon-modal-section';
    const head = document.createElement('header');
    head.className = 'lagoon-modal-section-head';
    const heading = document.createElement('h4');
    heading.className = 'lagoon-modal-section-title';
    heading.textContent = title;
    head.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'lagoon-modal-details-grid';
    rows.forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'detail-item';
        const labelElement = document.createElement('div');
        labelElement.className = 'detail-label';
        labelElement.textContent = label;
        const valueElement = document.createElement('div');
        valueElement.className = 'detail-value';
        valueElement.textContent = text(value).trim() || '—';
        item.append(labelElement, valueElement);
        grid.appendChild(item);
    });
    section.append(head, grid);
    return section;
}

function gallerySection(title, images, record, viewerList) {
    const section = document.createElement('section');
    section.className = 'lagoon-modal-section mani-gallery-section';
    const head = document.createElement('header');
    head.className = 'lagoon-modal-section-head';
    const heading = document.createElement('h4');
    heading.className = 'lagoon-modal-section-title';
    heading.textContent = title;
    const count = document.createElement('span');
    count.className = 'mani-section-count';
    count.textContent = images.length.toLocaleString('en-GB');
    heading.append(' ', count);
    head.appendChild(heading);
    const gallery = document.createElement('div');
    gallery.className = 'mani-photo-gallery';
    images.forEach(image => {
        gallery.appendChild(photoCard(image, record, viewerList.indexOf(image), viewerList));
    });
    section.append(head, gallery);
    return section;
}

function openPlacemark(record) {
    renderPlacemarkTitle(record);
    elements.placemarkDetails.replaceChildren();

    const galleryImages = uniqueGalleryImages(record.images);
    const fieldImages = galleryImages.filter(image => image.kind === 'field_photo');
    const referenceImages = galleryImages.filter(image => image.kind !== 'field_photo');
    const viewerList = fieldImages.concat(referenceImages);

    if (fieldImages.length) {
        elements.placemarkDetails.appendChild(
            gallerySection('Field photographs', fieldImages, record, viewerList)
        );
    }
    if (referenceImages.length) {
        elements.placemarkDetails.appendChild(
            gallerySection('Reference images', referenceImages, record, viewerList)
        );
    }
    if (!galleryImages.length) {
        const empty = document.createElement('p');
        empty.className = 'mani-empty';
        empty.textContent = 'No published photograph is assigned to this point.';
        elements.placemarkDetails.appendChild(empty);
    }

    const withCode = (name, code) => [name, code && '(' + code + ')'].filter(Boolean).join(' ');
    const metres = value => value === null ? '' : value.toFixed(1) + ' m';
    // One section per group of the survey database's points table.
    elements.placemarkDetails.append(
        detailSection('Observation', [
            ['Setting', SETTING_LABELS[record.setting] || record.setting],
            ['Observation note', record.note]
        ]),
        detailSection('Survey', [
            ['Point ID', record.id],
            ['Location', record.locationCode + ' · ' + record.locationNameEl + ' (' + record.locationNameEn + ')'],
            ['Station', record.station],
            ['Flood event', readableDate(record.eventDate)],
            ['Field survey', readableDate(record.surveyDate)],
            ['Photographs captured', captureWindow(record) && captureWindow(record) + ' (EEST)'],
            ['Field photographs', record.photoCount.toLocaleString('en-GB')],
            ['Reference images', record.referenceImageCount.toLocaleString('en-GB')]
        ]),
        detailSection('Administrative units (ELSTAT Census 2021)', [
            ['Settlement', withCode(record.settlementName, record.settlementCode)],
            ['Settlement population 2021', record.settlementPopulation === null
                ? '' : record.settlementPopulation.toLocaleString('en-GB') + ' persons'],
            ['Community', withCode(record.communityName, record.communityCode)],
            ['Municipal unit', withCode(record.municipalUnitName, record.municipalUnitCode)],
            ['Municipality', withCode(record.municipalityName, record.municipalityCode)],
            ['Regional unit', record.regionalUnitName],
            ['Region', record.regionName]
        ]),
        detailSection('Position', [
            ['Latitude (WGS84)', record.latitude.toFixed(6) + '°'],
            ['Longitude (WGS84)', record.longitude.toFixed(6) + '°'],
            ['Easting (EGSA87, EPSG:2100)', metres(record.easting)],
            ['Northing (EGSA87, EPSG:2100)', metres(record.northing)],
            ['Position method', POSITION_METHOD_LABELS[record.positionMethod] || record.positionMethod ||
                record.coordinateSource],
            ['Position accuracy', record.positionAccuracy === null
                ? record.coordinatePrecision
                : 'Better than ' + record.positionAccuracy + ' m (checked against Google Street View)']
        ])
    );
    elements.placemarkDetails.scrollTop = 0;
    openDialog(elements.placemarkModal);
}

function renderViewer() {
    const { images, index, record } = state.viewer;
    const image = images[index];
    if (!image) return;
    elements.viewerImage.classList.remove('is-loaded');
    elements.viewerImage.onload = () => elements.viewerImage.classList.add('is-loaded');
    elements.viewerImage.src = image.previewUrl;
    elements.viewerImage.alt = image.alt;
    elements.viewerTitle.textContent = record.point + ' · ' + record.locationNameEl;
    elements.viewerCounter.textContent = (index + 1) + ' / ' + images.length;
    const time = image.kind === 'field_photo' && image.captureTime ? readableCaptureTime(image.captureTime) : '';
    elements.viewerCaption.textContent = referenceMonth(image)
        ? image.caption
        : [imageSourceLabel(image), time].filter(Boolean).join(' · ');
    elements.viewerFull.href = image.fullUrl;
    elements.viewerFull.hidden = !image.fullUrl || image.fullUrl === image.previewUrl;
    const single = images.length < 2;
    elements.viewerPrev.hidden = single;
    elements.viewerNext.hidden = single;
    [images[index - 1], images[index + 1]].forEach(neighbour => {
        if (neighbour) new Image().src = neighbour.previewUrl;
    });
}

function stepViewer(delta) {
    const count = state.viewer.images.length;
    if (count < 2) return;
    state.viewer.index = (state.viewer.index + delta + count) % count;
    renderViewer();
}

function openViewer(images, index, record, opener) {
    state.viewer = { images: images, index: Math.max(0, index), record: record };
    renderViewer();
    // Focus the panel itself so arrow keys work at once without a focus ring on the first link.
    openDialog(elements.photoViewer, opener, elements.photoViewer.querySelector('.modal-content'));
}

const dialogState = new WeakMap();

function focusableElements(dialog) {
    return [...dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden && element.getClientRects().length > 0);
}

function openDialog(dialog, opener, focusTarget) {
    dialogState.set(dialog, { opener: opener || document.activeElement });
    dialog.classList.add('active');
    dialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    window.requestAnimationFrame(() => {
        const first = focusTarget || focusableElements(dialog)[0] || dialog.querySelector('.modal-content');
        if (first) first.focus({ preventScroll: true });
    });
}

function closeDialog(dialog) {
    dialog.classList.remove('active', 'is-revealing');
    dialog.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal.active')) document.body.classList.remove('modal-open');
    const saved = dialogState.get(dialog);
    if (saved && saved.opener && typeof saved.opener.focus === 'function' && saved.opener.isConnected) {
        saved.opener.focus({ preventScroll: true });
    }
}

function revealAndCloseWelcome() {
    if (window.NkuaWebGISUI &&
        typeof window.NkuaWebGISUI.revealWelcomeModal === 'function') {
        window.NkuaWebGISUI.revealWelcomeModal(
            elements.welcomeModal,
            () => closeDialog(elements.welcomeModal)
        );
    } else {
        closeDialog(elements.welcomeModal);
    }
}

function setupDialogs() {
    dialogState.set(elements.welcomeModal, { opener: null });
    elements.closeWelcome.addEventListener('click', revealAndCloseWelcome);
    elements.enterWebgis?.addEventListener('click', revealAndCloseWelcome);
    elements.closePlacemark.addEventListener('click', () => closeDialog(elements.placemarkModal));
    elements.closeReferences.addEventListener('click', () => closeDialog(elements.referencesModal));
    elements.closeSubmitData.addEventListener('click', () => closeDialog(elements.submitDataModal));
    elements.closePhotoViewer.addEventListener('click', () => closeDialog(elements.photoViewer));
    elements.viewerPrev.addEventListener('click', () => stepViewer(-1));
    elements.viewerNext.addEventListener('click', () => stepViewer(1));
    elements.aboutButton.addEventListener('click', () => {
        openDialog(elements.welcomeModal, elements.aboutButton);
    });
    elements.referencesButton.addEventListener('click', () => {
        openDialog(elements.referencesModal, elements.referencesButton);
    });
    elements.submitDataButton.addEventListener('click', () => {
        openDialog(elements.submitDataModal, elements.submitDataButton);
    });

    [
        elements.welcomeModal,
        elements.placemarkModal,
        elements.referencesModal,
        elements.submitDataModal,
        elements.photoViewer
    ].forEach(dialog => {
        dialog.addEventListener('mousedown', event => {
            if (event.target === dialog) {
                dialog === elements.welcomeModal ? revealAndCloseWelcome() : closeDialog(dialog);
            }
        });
    });

    document.addEventListener('keydown', event => {
        const activeDialogs = [...document.querySelectorAll('.modal.active')];
        const dialog = activeDialogs[activeDialogs.length - 1];
        if (!dialog) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            dialog === elements.welcomeModal
                ? revealAndCloseWelcome()
                : closeDialog(dialog);
            return;
        }
        if (dialog === elements.photoViewer && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            stepViewer(event.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusables = focusableElements(dialog);
        if (!focusables.length) {
            event.preventDefault();
            const content = dialog.querySelector('.modal-content');
            if (content) content.focus();
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

function activateTab(name, focus) {
    const buttons = [...document.querySelectorAll('.tab-button[data-tab]')];
    const panels = [...document.querySelectorAll('.tab-content[role="tabpanel"]')];
    buttons.forEach(button => {
        const active = button.dataset.tab === name;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        if (active && focus) button.focus();
    });
    panels.forEach(panel => {
        const active = panel.id === name + '-tab';
        panel.classList.toggle('active', active);
        panel.hidden = !active;
    });
    document.body.dataset.activeTab = name;
    if (name === 'statistics' && state.commonInterface?.statisticsPanel) {
        state.commonInterface.statisticsPanel.render();
    }
}

function setupTabs() {
    const buttons = [...document.querySelectorAll('.tab-button[data-tab]')];
    buttons.forEach((button, index) => {
        button.addEventListener('click', () => activateTab(button.dataset.tab));
        button.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            let next = index;
            if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
            if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = buttons.length - 1;
            activateTab(buttons[next].dataset.tab, true);
        });
    });
    activateTab('filters');
}

function setupMobileControls() {
    const controls = [
        [elements.mobileFilters, 'filters'],
        [elements.mobileSearch, 'search'],
        [elements.mobileStats, 'statistics']
    ];
    let activeTrigger = elements.mobileFilters;
    controls.forEach(([button, tab]) => {
        button.setAttribute('aria-controls', 'sidebar');
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', () => {
            const opening = !elements.sidebar.classList.contains('active') ||
                !button.classList.contains('active');
            controls.forEach(([other]) => {
                other.classList.remove('active');
                other.setAttribute('aria-expanded', 'false');
            });
            if (opening) {
                activeTrigger = button;
                activateTab(tab);
                elements.sidebar.classList.add('active');
                button.classList.add('active');
                button.setAttribute('aria-expanded', 'true');
                window.setTimeout(() => {
                    const target = elements.sidebar.querySelector(
                        '.tab-content.active select, .tab-content.active input, .tab-content.active button'
                    );
                    if (target) target.focus();
                }, 0);
            } else {
                elements.sidebar.classList.remove('active');
            }
            window.setTimeout(() => {
                if (state.map) state.map.invalidateSize();
            }, 220);
        });
    });

    elements.mobileSidebarClose.addEventListener('click', () => {
        elements.sidebar.classList.remove('active');
        controls.forEach(([button]) => {
            button.classList.remove('active');
            button.setAttribute('aria-expanded', 'false');
        });
        activeTrigger.focus();
        window.setTimeout(() => {
            if (state.map) state.map.invalidateSize();
        }, 220);
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            elements.sidebar.classList.remove('active');
            controls.forEach(([button]) => {
                button.classList.remove('active');
                button.setAttribute('aria-expanded', 'false');
            });
        }
        window.setTimeout(() => {
            if (state.map) state.map.invalidateSize();
        }, 80);
    });
}

function locationCodes() {
    return [...new Set(state.records.map(record => record.locationCode))].sort();
}

function stationKeys() {
    return [...new Set(state.records.map(record => record.stationKey))].sort();
}

function fillSelect(select, allLabel, values, label) {
    if (!select) return;
    select.innerHTML = '';
    select.appendChild(new Option(allLabel, ''));
    values.forEach(value => select.appendChild(new Option(label(value), value)));
}

function populateFilters() {
    FILTERS.forEach(filter => fillSelect(byId(filter.inputId), filter.all, filterOptions(filter), filter.format));
}

function updateDatasetSummaries() {
    const suppliedPhotos = Number(state.metadata.field_photo_count);
    const uniqueMapped = new Set(
        state.records.flatMap(record => record.images)
            .filter(image => image.kind === 'field_photo')
            .map(image => image.fullUrl || image.previewUrl)
    ).size;
    elements.welcomePointCount.textContent = state.records.length.toLocaleString('en-GB');
    elements.welcomeLocationCount.textContent = locationCodes().length.toLocaleString('en-GB');
    elements.welcomePhotoCount.textContent =
        (Number.isFinite(suppliedPhotos) ? suppliedPhotos : uniqueMapped).toLocaleString('en-GB');
}

function cacheElements() {
    Object.assign(elements, {
        welcomeModal: byId('welcome-modal'),
        closeWelcome: byId('close-welcome'),
        enterWebgis: byId('enter-webgis'),
        welcomePointCount: byId('welcome-point-count'),
        welcomeLocationCount: byId('welcome-location-count'),
        welcomePhotoCount: byId('welcome-photo-count'),
        errorBanner: byId('error-banner'),
        errorMessage: byId('error-banner-message'),
        errorClose: byId('error-banner-close'),
        sidebar: byId('sidebar'),
        activeFiltersSummary: byId('active-filters-summary'),
        activeFiltersList: byId('active-filters-list'),
        clearFilters: byId('clear-filters'),
        searchInput: byId('global-search-input'),
        searchResults: byId('global-search-results'),
        statsSummary: byId('stats-summary'),
        stationStats: byId('station-stats'),
        loading: byId('loading'),
        placemarkModal: byId('placemark-modal'),
        closePlacemark: byId('close-placemark'),
        placemarkTitleblock: byId('placemark-modal-titleblock'),
        placemarkTitle: byId('placemark-modal-title'),
        placemarkDetails: byId('placemark-details'),
        referencesModal: byId('references-modal'),
        closeReferences: byId('close-references'),
        submitDataModal: byId('submit-data-modal'),
        closeSubmitData: byId('close-submit-data'),
        photoViewer: byId('photo-viewer'),
        closePhotoViewer: byId('close-photo-viewer'),
        viewerImage: byId('photo-viewer-image'),
        viewerTitle: byId('photo-viewer-title'),
        viewerCounter: byId('photo-viewer-counter'),
        viewerCaption: byId('photo-viewer-caption'),
        viewerFull: byId('photo-viewer-full'),
        viewerPrev: byId('photo-viewer-prev'),
        viewerNext: byId('photo-viewer-next'),
        aboutButton: byId('about-btn'),
        referencesButton: byId('references-btn'),
        submitDataButton: byId('submit-data-btn'),
        mobileFilters: byId('mobile-filters-toggle'),
        mobileSearch: byId('mobile-search-toggle'),
        mobileStats: byId('mobile-stats-toggle'),
        mobileSidebarClose: byId('mobile-sidebar-close')
    });
}

function initCommonInterface() {
    if (!window.NkuaWebGISUI?.createAtlasInterface) return;
    state.commonInterface = window.NkuaWebGISUI.createAtlasInterface({
        statisticsContainerId: 'statistics-tab',
        getRecords: () => state.records,
        getOptions: (field) => {
            const filter = FILTERS.find(item => item.key === field.key);
            if (filter) return filterOptions(filter);
            const input = document.getElementById(field.inputId);
            return input?.options ? Array.from(input.options).map(o => o.value).filter(Boolean) : [];
        },
        onApply: async (field, value) => {
            const input = document.getElementById(field.inputId);
            if (input) {
                window.NkuaWebGISUI.writeFilterInput(input, value);
                input.classList.toggle('has-value', Boolean(value));
            }
            applyFilters({ fit: true });
        },
        onAdvancedApply: records => {
            state.visible = records;
            updateMarkers();
            renderActiveFilters();
            renderSearchResults(elements.searchInput.value);
            if (state.commonInterface?.statisticsPanel) {
                state.commonInterface.statisticsPanel.setRecords(state.visible);
            }
            fitVisible();
        },
        onAdvancedClear: () => applyFilters({ fit: true }),
        statisticsRecordLabel: record => record.point + ' · ' + record.locationNameEl,
        statisticsRecordMeta: record => [record.locationCode, SETTING_LABELS[record.setting] || record.setting].filter(Boolean).join(' · '),
        onStatisticsRecordSelect: record => focusRecord(record),
        filterFields: FILTERS.map(filter => ({
            key: filter.key,
            dataField: filter.dataField,
            inputId: filter.inputId,
            label: filter.label,
            group: filter.group,
            formatValue: filter.format,
            ...(filter.labels ? { valueLabels: filter.labels } : {})
        })),
        // Statistics variables: every survey point field that varies between points. Fields that
        // are the same for all 50 points (region, regional unit, municipality, dates, position
        // method and accuracy) are shown in each point's record instead. The shared Map display
        // offers every variable under "Colour by" except those flagged observations: true: Location
        // is the default colouring; settlement population only repeats it (each location is one
        // ELSTAT settlement); and the photograph counts and survey hour describe the documentation
        // of a point, not the point itself.
        statisticsFields: [
            {
                key: 'locationStats',
                dataField: 'locationCode',
                label: 'Location',
                type: 'categorical',
                group: 'Survey',
                maxItems: 10,
                filterable: false,
                observations: true,
                formatValue: locationLabel,
                description: 'Survey points at each of the six locations.'
            },
            {
                key: 'settingStats',
                dataField: 'setting',
                label: 'Setting',
                type: 'categorical',
                group: 'Observation',
                filterable: false,
                formatValue: labelFrom(SETTING_LABELS),
                valueLabels: SETTING_LABELS,
                description: 'Where the observation was made, relative to the road or landform.'
            },
            {
                key: 'municipalUnitStats',
                dataField: 'municipalUnitShort',
                label: 'Municipal unit',
                type: 'categorical',
                group: 'Administrative unit (ELSTAT 2021)',
                filterable: false,
                description: 'Municipal unit (Δημοτική Ενότητα) containing each survey point, ELSTAT Census 2021.'
            },
            {
                key: 'communityStats',
                dataField: 'communityShort',
                label: 'Community',
                type: 'categorical',
                group: 'Administrative unit (ELSTAT 2021)',
                filterable: false,
                description: 'Community (Δημοτική/Τοπική Κοινότητα) containing each survey point, ELSTAT Census 2021; ' +
                    'boundaries from Eurostat GISCO LAU 2024.'
            },
            {
                key: 'settlementPopulation',
                dataField: 'settlementPopulation',
                label: 'Settlement population 2021',
                type: 'numeric',
                unit: 'persons',
                group: 'Administrative unit (ELSTAT 2021)',
                observations: true,
                description: 'Permanent population of the settlement each survey point belongs to, ' +
                    'ELSTAT Population-Housing Census 2021.'
            },
            {
                key: 'photoCount',
                dataField: 'photoCount',
                label: 'Field photographs per point',
                type: 'numeric',
                unit: 'photos',
                group: 'Documentation',
                filterable: false,
                observations: true,
                description: 'Field photographs of each survey point taken on 18 August 2026; a photograph ' +
                    'shared by two points counts for both.'
            },
            {
                key: 'referenceImageCount',
                dataField: 'referenceImageCount',
                label: 'Reference images per point',
                type: 'numeric',
                unit: 'images',
                group: 'Documentation',
                filterable: false,
                observations: true,
                description: 'Reference images attached to each survey point (Google Street View or earlier ground photographs).'
            },
            {
                key: 'surveyHour',
                dataField: 'surveyHour',
                label: 'Survey hour',
                type: 'categorical',
                group: 'Documentation',
                filterable: false,
                observations: true,
                description: 'Local time (EEST) of the first field photograph at each point on 18 August 2026.'
            }
        ]
    });
    state.legend?.attach(state.commonInterface);
    state.lasso?.attach(state.commonInterface, record => [record.latitude, record.longitude]);
}

function setupEvents() {
    elements.errorClose.addEventListener('click', clearError);
    filterInputs().forEach(input => input.addEventListener('change', () => {
        input.classList.toggle('has-value', Boolean(input.value));
        applyFilters({ fit: true });
        if (state.commonInterface?.filterPanel) {
            state.commonInterface.filterPanel.render();
        }
    }));
    elements.clearFilters?.addEventListener('click', () => {
        state.lasso?.clear(true);
        filterInputs().forEach(input => {
            input.value = '';
            input.classList.remove('has-value');
        });
        applyFilters({ fit: true });
        if (state.commonInterface?.filterPanel) {
            state.commonInterface.filterPanel.render();
        }
    });
    elements.searchInput.addEventListener(
        'input',
        event => renderSearchResults(event.target.value)
    );
    setupTabs();
    setupMobileControls();
    setupDialogs();
}

async function loadData() {
    const response = await fetch(DATA_URL, {
        headers: { Accept: 'application/geo+json, application/json' },
        cache: 'no-store'
    });
    if (!response.ok) {
        throw new Error('stations.geojson returned HTTP ' + response.status + '.');
    }
    return response.json();
}

async function initialise() {
    cacheElements();
    setupEvents();
    createMap();
    setLoading(true);

    try {
        clearError();
        const collection = await loadData();
        const validated = validateCollection(collection);
        state.metadata = validated.metadata;
        state.records = validated.records;
        state.visible = state.records.slice();
        populateFilters();
        updateDatasetSummaries();
        initCommonInterface();
        applyFilters();
        state.initialBounds = visibleBounds();
        fitDefault();

        const params = new URLSearchParams(window.location.search);
        if (!params.has('embed') && !params.has('nomodal')) {
            openDialog(elements.welcomeModal);
        }
    } catch (error) {
        console.error('Unable to initialise the Mani flood WebGIS:', error);
        showError(
            'The survey dataset could not be loaded. The map remains available, but ' +
            'point counts and records are withheld until the data pass validation.'
        );
    } finally {
        setLoading(false);
        // Fit again once layout has settled: the first fit can run against a container
        // that has not reached its final size yet, which leaves every pin out of view.
        window.requestAnimationFrame(() => {
            if (!state.map) return;
            state.map.invalidateSize();
            fitDefault();
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
} else {
    initialise();
}

export {
    DATA_URL,
    EVENT_DATE,
    SURVEY_DATE,
    normalizeFeature,
    validateCollection,
    uniqueGalleryImages
};
