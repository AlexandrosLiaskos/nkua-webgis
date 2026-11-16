/**
 * MarkerManager - Manages flood markers and clustering on the map
 *
 * Handles marker creation, clustering, tooltips, interactions, and visibility.
 * Uses Leaflet.markercluster for efficient display of many markers.
 *
 * @example
 * const markerManager = new MarkerManager(map, eventBus, stateManager);
 * markerManager.init();
 * markerManager.updateMarkers(floodData);
 */

import { escapeHtml } from '../utils/helpers.js';
import { hasValidCoordinates } from '../data/recordValues.js?v=20261004-cnih-1';
import { createDisplayModel, DEFAULT_DISPLAY_SETTINGS, getObservationYear, groupDisplayRecords } from './FloodClassification.js?v=20261013-month-display-1';
import LagoonPreviewMap from '/lagoons/js/map/LagoonPreviewMap.js';
import { pinTooltipInsideMap } from '/lagoons/js/map/LagoonHoverCard.js';

export const FLOOD_MAP_CATEGORIES = [
    { key: 'recent', label: '2000–2022', color: '#dc2626', border: '#f87171' },
    { key: 'late20c', label: '1980–1999', color: '#f97316', border: '#fdba74' },
    // { key: 'historic', label: '1870–1979', color: '#0d9488', border: '#5eead4' } // European catalogue range retained for restoration.
    { key: 'historic', label: '1886–1979', color: '#0d9488', border: '#5eead4' }
];

export function getFloodMapCategory(flood) {
    const year = getObservationYear(flood);
    if (year === null) return null;
    if (year <= 1979) return FLOOD_MAP_CATEGORIES[2];
    if (year <= 1999) return FLOOD_MAP_CATEGORIES[1];
    return FLOOD_MAP_CATEGORIES[0];
}

class MarkerManager {
    constructor(map, eventBus, stateManager) {
        if (!map) {
            throw new Error('MarkerManager: Map instance is required');
        }

        this.map = map;
        this.eventBus = eventBus;
        this.stateManager = stateManager;

        this.markerCluster = null;
        this.currentMarkers = [];
        this.currentData = [];
        this.catalogueRecords = [];
        this.hasCatalogue = false;
        this.categoryVisibility = new Map();
        this.displayModel = createDisplayModel([], DEFAULT_DISPLAY_SETTINGS);
        this.storageKey = 'nkua-floods-display-settings-v1';
        try {
            const saved = window.localStorage.getItem(this.storageKey);
            this.savedDisplaySettings = saved ? JSON.parse(saved) : null;
            const colors = this.savedDisplaySettings?.colors;
            const oldKey = 'dataset:source:HANZE%20v2.1.1';
            if (colors?.[oldKey] && !colors['dataset:source:HANZE']) {
                colors['dataset:source:HANZE'] = colors[oldKey];
                delete colors[oldKey];
            }
        } catch { this.savedDisplaySettings = null; }
        this.previewMap = new LagoonPreviewMap();
        this.tooltipPreviews = new WeakMap();
        this.loadGeometry = null;
        this.renderGeneration = 0;
        this.renderTimer = null;
        this.markerIcons = new Map();
    }

    /**
     * Initialize marker cluster group and add to map
     */
    init() {
        // Initialize marker cluster with custom styling
        this.markerCluster = L.markerClusterGroup({
            chunkedLoading: false,
            spiderfyOnMaxZoom: true,
            spiderLegPolylineOptions: {
                weight: 1.5,
                color: '#333',
                opacity: 0.5
            },
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: zoom => {
                if (zoom <= 5) return 100;
                if (zoom <= 7) return 85;
                if (zoom <= 9) return 70;
                return 60;
            },
            singleMarkerMode: false,
            iconCreateFunction: this.createClusterIcon.bind(this)
        });

        // Add cluster to map
        this.map.addLayer(this.markerCluster);

        // Store reference in state
        this.stateManager.set('markerCluster', this.markerCluster);

        if (window.DEBUG_MODE) {
            console.log('✅ MarkerManager: Initialized with clustering');
        }
    }

    /**
     * Create custom cluster icon
     * @param {L.MarkerCluster} cluster - Marker cluster
     * @returns {L.DivIcon} Custom icon for cluster
     * @private
     */
    createClusterIcon(cluster) {
        const counts = new Map();
        let total = 0;
        cluster.getAllChildMarkers().forEach(marker => {
            const count = marker._sourceRecordCount || 1;
            total += count;
            counts.set(marker._mapCategory, (counts.get(marker._mapCategory) || 0) + count);
        });
        let offset = 0;
        const slices = this.displayModel.categories.filter(category => counts.has(category.key)).map(category => {
            const start = offset;
            offset += counts.get(category.key) / total * 100;
            return `${category.color} ${start}% ${offset}%`;
        });
        const description = this.displayModel.categories.filter(category => counts.has(category.key))
            .map(category => `${category.label}: ${counts.get(category.key)}`).join('; ');
        const size = total >= 100 ? 48 : total >= 10 ? 42 : 36;
        return L.divIcon({
            className: 'minimal-cluster flood-display-cluster', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
            html: `<div class="flood-display-pie" role="img" aria-label="${escapeHtml(`${total} source records. ${description}`)}" title="${escapeHtml(description)}" style="width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:conic-gradient(${slices.join(', ') || '#737373 0% 100%'});box-shadow:0 1px 5px #0006"><span style="display:flex;align-items:center;justify-content:center;width:${size - 10}px;height:${size - 10}px;border-radius:50%;background:#171717;color:#fff;font:600 12px var(--font-sans,Arial,sans-serif)">${total}</span></div>`
        });
    }

    /**
     * Create custom marker icon (looks like a single-count cluster)
     * @returns {L.DivIcon} Custom icon for single marker
     * @private
     */
    createMarkerIcon(flood) {
        const category = this.displayModel.categoryForRecord(flood);
        if (!this.markerIcons.has(category.key)) {
            this.markerIcons.set(category.key, window.NkuaWebGISMap.createCategoryMarkerIcon(category));
        }
        return this.markerIcons.get(category.key);
    }

    setCatalogueRecords(records = []) {
        const catalogue = Array.isArray(records) ? records : [];
        const draft = this.savedDisplaySettings || this.displayModel.settings;
        try { this.displayModel = createDisplayModel(catalogue, draft); }
        catch { this.displayModel = createDisplayModel(catalogue, DEFAULT_DISPLAY_SETTINGS); }
        this.catalogueRecords = catalogue;
        this.hasCatalogue = true;
        this.savedDisplaySettings = null;
        if (this.markerCluster && this.currentData.length) this.updateMarkers(this.currentData, { fitBounds: false });
        else this.emitDisplayChanged();
        return this.getDisplaySettings();
    }

    getAllDisplayRecords() { return [...this.catalogueRecords]; }

    getDisplaySettings() { return JSON.parse(JSON.stringify(this.displayModel.settings)); }

    categoriesForModel(model) {
        const counts = new Map();
        this.currentData.forEach(record => {
            const key = model.categoryForRecord(record).key;
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return model.categories.filter(category => category.key !== 'unclassified' || category.totalCount > 0)
            .map(category => ({
                key: category.key, id: category.key, label: category.label, color: category.color, border: category.border,
                count: counts.get(category.key) || 0, totalCount: category.totalCount,
                visible: this.categoryVisibility.get(category.key) !== false
            }));
    }

    getDisplayCategories() { return this.categoriesForModel(this.displayModel); }

    previewDisplaySettings(draft) {
        const model = createDisplayModel(this.catalogueRecords, draft);
        return { settings: JSON.parse(JSON.stringify(model.settings)), categories: this.categoriesForModel(model) };
    }

    setDisplaySettings(draft) {
        // Validate the entire active configuration before touching layers, settings or saved preferences.
        const model = createDisplayModel(this.catalogueRecords, draft);
        this.displayModel = model;
        try { window.localStorage.setItem(this.storageKey, JSON.stringify(model.settings)); } catch { /* Storage can be unavailable in private browsing. */ }
        if (this.markerCluster) this.updateMarkers(this.currentData, { fitBounds: false });
        else this.emitDisplayChanged();
        return this.getDisplaySettings();
    }

    setCategoryVisibility(key, visible) {
        if (!this.displayModel.categories.some(category => category.key === key)) return;
        this.categoryVisibility.set(key, Boolean(visible));
        if (this.markerCluster) this.updateMarkers(this.currentData, { fitBounds: false });
        else this.emitDisplayChanged();
    }

    emitDisplayChanged() {
        this.eventBus.emit('display:changed', { settings: this.getDisplaySettings(), categories: this.getDisplayCategories() });
    }

    /**
     * Create tooltip content for a flood marker
     * @param {Object} flood - Flood data object
     * @returns {string} HTML content for tooltip
     * @private
     */
    geometryRecords(flood) {
        return [flood, ...(flood.regional_records || [])]
            .filter(record => record.geometry_file && record.geometry_feature_id != null);
    }

    createTooltipContent(flood, showPreview = this.geometryRecords(flood).length > 0) {
        const titleRaw = flood.flood_event_name || flood.location_name || 'Flood event';
        const locationRaw = (flood.record_kind === 'affected_regions' ? flood.country : flood.location_name) || '';
        const dateRaw = flood.date_interval || flood.date_of_commencement || flood.year || '—';
        const deathsRaw = flood.deaths_toll_int ?? flood.deaths_toll;
        const causeRaw = String(flood.cause_of_flood || '').trim();
        const causeShort = causeRaw.length > 48 ? `${causeRaw.slice(0, 48)}…` : (causeRaw || '—');
        const showLocation = locationRaw && locationRaw.toLowerCase() !== String(titleRaw).toLowerCase();

        return `
            <div class="lagoon-hover-card${showPreview ? '' : ' is-text-only'}">
                ${showPreview ? `<div class="lagoon-hover-preview">
                    <div class="lagoon-preview-map" data-tooltip-preview-map aria-label="Map preview of regions affected by floods">
                        <span class="flood-preview-loading" role="status">Loading map…</span>
                    </div>
                </div>` : ''}
                <div class="lagoon-hover-body">
                    <span class="lagoon-hover-eyebrow">${escapeHtml(flood.dataset || (flood.record_kind === 'affected_regions' ? 'HANZE' : 'NKUA'))}</span>
                    <h3 class="lagoon-hover-name">
                        <span class="lagoon-hover-name-en">${escapeHtml(titleRaw)}</span>
                    </h3>
                    ${showLocation ? `
                        <div class="lagoon-hover-locality">
                            <svg class="lagoon-hover-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                            </svg>
                            <span class="lagoon-hover-loc-main">${escapeHtml(locationRaw)}</span>
                        </div>
                    ` : ''}
                    <div class="lagoon-hover-stats">
                        <div class="lagoon-hover-stat">
                            <span class="lagoon-hover-stat-label">Date</span>
                            <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                            <span class="lagoon-hover-stat-value">${escapeHtml(dateRaw)}</span>
                        </div>
                        <div class="lagoon-hover-stat">
                            <span class="lagoon-hover-stat-label">Death toll</span>
                            <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                            <span class="lagoon-hover-stat-value">${escapeHtml(deathsRaw == null || deathsRaw === '' ? '—' : deathsRaw)}</span>
                        </div>
                        <div class="lagoon-hover-stat">
                            <span class="lagoon-hover-stat-label">Cause</span>
                            <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                            <span class="lagoon-hover-stat-value">${escapeHtml(causeShort)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderTooltipPreview(tooltip, flood) {
        this.destroyTooltipPreview(tooltip);
        const element = tooltip.getElement();
        if (element) element.style.translate = '';
        if (this.geometryRecords(flood).length && !element?.querySelector('[data-tooltip-preview-map]')) {
            tooltip.setContent(this.createTooltipContent(flood));
        }
        // Clamp before creating the mini map: a tooltip flip rebuilds its contents.
        pinTooltipInsideMap(tooltip, this.map);
        const container = tooltip.getElement()?.querySelector('[data-tooltip-preview-map]');
        if (!container) return;
        const state = { container, timer: null };
        this.tooltipPreviews.set(tooltip, state);
        state.timer = setTimeout(async () => {
            try {
                const features = await Promise.all(this.geometryRecords(flood).map(record => this.loadGeometry(record)));
                if (this.tooltipPreviews.get(tooltip) !== state || !container.isConnected) return;
                if (!features.length || features.some(feature => !feature)) throw new Error('Preview geometry unavailable');
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);
                this.previewMap.render(container, {
                    id: flood.id,
                    geojson: { type: 'FeatureCollection', features }
                });
            } catch (error) {
                if (this.tooltipPreviews.get(tooltip) !== state) return;
                this.destroyTooltipPreview(tooltip);
                tooltip.setContent(this.createTooltipContent(flood, false));
                pinTooltipInsideMap(tooltip, this.map);
                if (window.DEBUG_MODE) console.warn('Flood hover map could not be loaded', error);
            }
        }, 100);
    }

    destroyTooltipPreview(tooltip) {
        const state = tooltip && this.tooltipPreviews.get(tooltip);
        if (!state) return;
        this.tooltipPreviews.delete(tooltip);
        clearTimeout(state.timer);
        this.previewMap.destroy(state.container);
    }

    /**
     * Create a marker for a single flood event
     * @param {Object} flood - Flood data object
     * @returns {L.Marker} Leaflet marker
     * @private
     */
    createMarker(flood) {
        if (!hasValidCoordinates(flood)) return null;

        // Create marker with custom icon
        const icon = this.createMarkerIcon(flood);
        const marker = L.marker([flood.latitude, flood.longitude], { icon });
        marker._mapCategory = this.displayModel.categoryForRecord(flood).key;
        marker._sourceRecordCount = flood.source_record_count || 1;

        // Store flood data in marker for reference
        marker.floodData = flood;

        // Add click handler - emit event instead of direct modal call
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            this.eventBus.emit('marker:clicked', { floodId: flood.id, flood });

            if (window.DEBUG_MODE) {
                console.log('🖱️ MarkerManager: Marker clicked for flood ID', flood.id);
            }
        });

        // Add tooltip
        // Share event handlers and create a tooltip only for markers that are actually opened.
        marker.on('mouseover', this.openMarkerTooltip, this);
        return marker;
    }

    ensureMarkerTooltip(marker) {
        if (marker.getTooltip()) return marker;
        const flood = marker.floodData;
        marker.bindTooltip(() => this.createTooltipContent(flood), {
            direction: 'top',
            offset: [0, -14],
            opacity: 1,
            className: flood.record_kind === 'affected_regions' ? 'custom-tooltip hanze-tooltip' : 'custom-tooltip'
        });
        marker.on('tooltipopen', this.onMarkerTooltipOpen, this);
        marker.on('tooltipclose', this.onMarkerTooltipClose, this);
        return marker;
    }

    openMarkerTooltip({ target }) { this.ensureMarkerTooltip(target).openTooltip(); }

    onMarkerTooltipOpen({ tooltip, target }) { this.renderTooltipPreview(tooltip, target.floodData); }

    onMarkerTooltipClose({ tooltip }) { this.destroyTooltipPreview(tooltip); }

    /**
     * Update markers on the map with new flood data
     * @param {Array<Object>} floodData - Array of flood objects
     * @param {Object} options - Update options
     * @param {boolean} options.fitBounds - Whether to fit map bounds to markers
     * @param {boolean} options.animate - Whether to animate bounds change
     */
    updateMarkers(floodData = [], options = {}) {
        const { fitBounds = true, animate = false } = options;
        if (!this.hasCatalogue) this.setCatalogueRecords(floodData);
        this.clearMarkers();
        const generation = this.renderGeneration;
        this.currentData = floodData;
        this.stateManager.set('visibleFloodData', floodData);

        const regionalRecords = [], reportedEvents = [];
        let mappedRecordCount = 0;
        for (const record of floodData) {
            if (!hasValidCoordinates(record) || this.categoryVisibility.get(this.displayModel.categoryForRecord(record).key) === false) continue;
            mappedRecordCount++;
            // NOAA EVENT_IDs are individual reports; reviewed regional pins retain their existing grouping.
            (record.record_kind === 'reported_event' ? reportedEvents : regionalRecords).push(record);
        }
        const records = groupDisplayRecords(regionalRecords, this.displayModel.categoryForRecord).concat(reportedEvents);
        this.stateManager.set('isRenderingMarkers', records.length > 0);
        this.emitDisplayChanged();

        let offset = 0;
        const incremental = records.length > 5000;
        const renderBatch = () => {
            this.renderTimer = null;
            if (generation !== this.renderGeneration) return;
            const batch = [];
            const deadline = performance.now() + 16;
            while (offset < records.length && (!incremental || (batch.length < 400 && performance.now() < deadline))) {
                const marker = this.createMarker(records[offset++]);
                if (marker) {
                    batch.push(marker);
                    this.currentMarkers.push(marker);
                }
            }
            if (batch.length) this.markerCluster.addLayers(batch);
            if (offset < records.length) {
                this.renderTimer = setTimeout(renderBatch, 0);
                return;
            }
            if (fitBounds && this.currentMarkers.length) {
                const bounds = this.markerCluster.getBounds();
                if (bounds.isValid()) this.map.fitBounds(bounds.pad(0.05), { animate, duration: 0.5 });
            }
            this.stateManager.set('markerCount', this.currentMarkers.length);
            this.stateManager.set('isRenderingMarkers', false);
            this.eventBus.emit('markers:updated', {
                count: this.currentMarkers.length, mappedRecordCount,
                unlocatedRecordCount: floodData.filter(record => !hasValidCoordinates(record)).length,
                bounds: this.markerCluster.getBounds()
            });
        };
        // Own the batch timer so filtering can cancel all pending work before replacing the layer.
        if (incremental) this.renderTimer = setTimeout(renderBatch, 0);
        else renderBatch();
    }

    /**
     * Clear all markers from the map
     */
    clearMarkers() {
        this.renderGeneration++;
        clearTimeout(this.renderTimer);
        this.renderTimer = null;
        this.stateManager.set('isRenderingMarkers', false);
        this.currentMarkers.forEach(marker => this.destroyTooltipPreview(marker.getTooltip()));
        if (this.markerCluster) {
            this.markerCluster.clearLayers();
        }
        this.currentMarkers = [];
        this.currentData = [];
        this.markerIcons.clear();

        this.stateManager.set('markerCount', 0);
        this.stateManager.set('visibleFloodData', []);

        if (window.DEBUG_MODE) {
            console.log('🗑️ MarkerManager: Cleared all markers');
        }
    }

    /**
     * Get current markers
     * @returns {Array<L.Marker>} Array of current markers
     */
    getMarkers() {
        return this.currentMarkers;
    }

    /**
     * Get current flood data
     * @returns {Array<Object>} Array of flood data objects
     */
    getData() {
        return this.currentData;
    }

    /**
     * Get marker count
     * @returns {number} Number of markers on map
     */
    getMarkerCount() {
        return this.currentMarkers.length;
    }

    /**
     * Get bounds of all markers
     * @returns {L.LatLngBounds|null} Bounds of markers or null if no markers
     */
    getBounds() {
        if (!this.markerCluster || this.currentMarkers.length === 0) {
            return null;
        }
        return this.markerCluster.getBounds();
    }

    /**
     * Fit map to marker bounds
     * @param {Object} options - Fit bounds options
     */
    fitBounds(options = {}) {
        const bounds = this.getBounds();
        if (bounds && bounds.isValid()) {
            this.map.fitBounds(bounds.pad(0.05), {
                animate: true,
                duration: 0.5,
                ...options
            });
        }
    }

    /**
     * Find marker by flood ID
     * @param {number} floodId - Flood ID
     * @returns {L.Marker|null} Marker or null if not found
     */
    findMarkerById(floodId) {
        return this.currentMarkers.find(marker =>
            marker.floodData && (marker.floodData.id === floodId || marker.floodData.source_record_ids?.includes(floodId))
        ) || null;
    }

    /**
     * Highlight a specific marker (e.g., when selected)
     * @param {number} floodId - Flood ID to highlight
     */
    highlightMarker(floodId) {
        const marker = this.findMarkerById(floodId);
        if (marker) {
            // Zoom to marker
            this.map.setView(marker.getLatLng(), 13, { animate: true });

            // Open tooltip
            this.ensureMarkerTooltip(marker).openTooltip();

            // Emit event
            this.eventBus.emit('marker:highlighted', { floodId, marker });
        }
    }

    /**
     * Remove highlight from all markers
     */
    clearHighlight() {
        this.currentMarkers.forEach(marker => {
            marker.closeTooltip();
        });
    }

    /**
     * Get cluster at specific location
     * @param {L.LatLng} latlng - Location
     * @returns {L.MarkerCluster|null} Cluster or null
     */
    getClusterAt(latlng) {
        if (!this.markerCluster) {
            return null;
        }
        return this.markerCluster.getVisibleParent(latlng);
    }

    /**
     * Refresh clusters (useful after zoom or pan)
     */
    refreshClusters() {
        if (this.markerCluster) {
            this.markerCluster.refreshClusters();
        }
    }

    /**
     * Destroy marker manager and clean up
     */
    destroy() {
        this.clearMarkers();

        if (this.markerCluster && this.map) {
            this.map.removeLayer(this.markerCluster);
        }

        this.markerCluster = null;
        this.map = null;

        if (window.DEBUG_MODE) {
            console.log('🗑️ MarkerManager: Destroyed');
        }
    }
}

// Export for ES modules
export default MarkerManager;
