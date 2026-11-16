/**
 * StatusBar - Floating map status bar.
 *
 * Layout:
 *   left   → inundation legend (with live category counts)
 *   right  → real-time mouse latitude / longitude + cartographic scale fraction
 */

// Default legend classes, matching the lagoon marker colours.
export const LAGOON_INUNDATION_CATEGORIES = [
    { key: 'high', label: 'Both SSP1-2.6 & SSP5-8.5', color: '#dc2626', border: '#f87171' },
    { key: 'medium', label: 'SSP5-8.5 only', color: '#f97316', border: '#fdba74' },
    { key: 'low', label: 'Not inundated', color: '#0d9488', border: '#5eead4' }
];

export function lagoonInundationCategory(lagoon) {
    const yes = value => String(value ?? '').toLowerCase().startsWith('yes');
    if (yes(lagoon?.rcp8_5_inundated) && yes(lagoon?.rcp2_6_inundated)) return LAGOON_INUNDATION_CATEGORIES[0];
    if (yes(lagoon?.rcp8_5_inundated)) return LAGOON_INUNDATION_CATEGORIES[1];
    return LAGOON_INUNDATION_CATEGORIES[2];
}

class StatusBar {
    constructor(eventBus, stateManager) {
        this.eventBus     = eventBus;
        this.stateManager = stateManager;
        this.container    = null;

        this.elements = {
            lat:            null,
            lng:            null,
            scaleContainer: null,
            legendCounts:   { high: null, medium: null, low: null }
        };
    }

    init(map) {
        this.map = map;
        this.map.attributionControl?.remove();
        this.createStatusBar();
        this._wireMapEvents();
        this.setupEventListeners();

        if (window.DEBUG_MODE) console.log('✅ StatusBar: Initialized');
    }

    createStatusBar() {
        const mapContainer = this.map.getContainer();

        this.container = document.createElement('div');
        this.container.className = 'map-status-bar';

        // Left column: shared legend with display settings (colour variable,
        // classes, colours) and per-class visibility; MarkerManager reads this.display.
        const leftCol = el('div', 'status-bar-left-col');
        this.display = window.NkuaWebGISDisplay.create(this.map, {
            legendParent: leftCol,
            storageKey: 'nkua-lagoons-display-v1',
            title: 'Inundation',
            subtitle: 'by 2100',
            ariaLabel: 'Inundation legend',
            defaultLabel: 'Inundation by 2100',
            categories: LAGOON_INUNDATION_CATEGORIES,
            classify: lagoonInundationCategory,
            onChange: () => this.eventBus.emit('display:changed')
        });

        // Right column: live coords + scale fraction
        const right = el('div', 'status-bar-right');

        const coords = el('div', 'status-coords');
        coords.setAttribute('aria-live', 'polite');

        const latPair = el('span', 'coord-pair');
        latPair.append(
            elText('span', 'coord-label', 'Lat'),
            (() => { const v = elText('span', 'coord-value', '—'); v.id = 'status-lat'; return v; })()
        );
        const lngPair = el('span', 'coord-pair');
        lngPair.append(
            elText('span', 'coord-label', 'Lng'),
            (() => { const v = elText('span', 'coord-value', '—'); v.id = 'status-lng'; return v; })()
        );
        coords.append(latPair, lngPair);

        const scale = el('div', 'status-scale');
        scale.id = 'status-scale';

        right.append(coords, scale);

        this.container.append(leftCol, right);
        // Append as a sibling of #map inside .map-container, NOT inside the
        // Leaflet container. This lets mobile lay it out as a normal block
        // strip below the map (CSS turns .map-container into a flex column
        // at narrow widths) while desktop still sees it as an absolute overlay
        // on top of the map (.map-container is position:relative).
        const outer = mapContainer.parentNode || mapContainer;
        outer.appendChild(this.container);

        this.elements.lat            = this.container.querySelector('#status-lat');
        this.elements.lng            = this.container.querySelector('#status-lng');
        this.elements.scaleContainer = this.container.querySelector('#status-scale');
    }

    _wireMapEvents() {
        this.map.on('mousemove', e => this._updateCoords(e.latlng));
        this.map.on('mouseout',  () => this._clearCoords());

        this._updateScaleFraction();
        const refresh = () => this._updateScaleFraction();
        this.map.on('zoom',     refresh);
        this.map.on('zoomend',  refresh);
        this.map.on('moveend',  refresh);
        this.map.on('resize',   refresh);
    }

    _updateCoords(latlng) {
        if (!latlng) return;
        const fmt = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(4)}°`;
        if (this.elements.lat) this.elements.lat.textContent = fmt(latlng.lat);
        if (this.elements.lng) this.elements.lng.textContent = fmt(latlng.lng);
    }

    _clearCoords() {
        if (this.elements.lat) this.elements.lat.textContent = '—';
        if (this.elements.lng) this.elements.lng.textContent = '—';
    }

    _updateScaleFraction() {
        const el = this.elements.scaleContainer;
        if (!el || !this.map) return;

        const size = this.map.getSize();
        const samplePx = 200;
        const meters = this.map.distance(
            this.map.containerPointToLatLng([0, size.y / 2]),
            this.map.containerPointToLatLng([samplePx, size.y / 2])
        );
        if (!meters || !isFinite(meters)) return;

        const metersPerPx = meters / samplePx;
        const SCREEN_MM_PER_PX = 25.4 / 96; // 1 CSS px ≈ 0.2646 mm at 96 DPI
        const raw = (metersPerPx * 1000) / SCREEN_MM_PER_PX;
        const denom = this._niceFractionDenominator(raw);

        el.replaceChildren();
        const fraction = document.createElement('span');
        fraction.className = 'carto-scale-fraction';
        const one = elText('span', 'carto-scale-numer', '1');
        const colon = elText('span', 'carto-scale-colon', ':');
        colon.setAttribute('aria-hidden', 'true');
        const denomEl = elText('span', 'carto-scale-denom', denom.toLocaleString('en-US'));
        fraction.append(one, colon, denomEl);
        el.appendChild(fraction);
    }

    _niceFractionDenominator(raw) {
        if (!isFinite(raw) || raw <= 0) return 1;
        const exp  = Math.floor(Math.log10(raw));
        const base = Math.pow(10, exp);
        const norm = raw / base;
        // Finer granularity so half-zoom steps produce visible changes.
        const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10];
        let pick = steps[0];
        for (let i = 0; i < steps.length - 1; i++) {
            const mid = Math.sqrt(steps[i] * steps[i + 1]); // geometric midpoint
            if (norm >= mid) pick = steps[i + 1];
            else break;
        }
        return Math.round(pick * base);
    }

    setupEventListeners() {
        this.eventBus.on('data:loaded', () => {
            this.updateLegendCounts(this.stateManager.get('currentData') || []);
        });
    }

    updateLegendCounts(records) {
        if (!Array.isArray(records)) return;
        this.display.update(records);
    }
}

function el(tag, className) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    return n;
}

function elText(tag, className, text) {
    const n = el(tag, className);
    if (text != null) n.textContent = text;
    return n;
}

export default StatusBar;
