/**
 * MarkerManager - Centroid dot markers for Greek Lagoons
 */

import LagoonPreviewMap from './LagoonPreviewMap.js';
import { buildLagoonHoverHTML, pinTooltipInsideMap } from './LagoonHoverCard.js';

// Ring slices follow the status-bar legend order and marker colours.
const LAGOON_CLUSTER_CATEGORIES = [
    { key: 'high', label: 'Both SSP1-2.6 & SSP5-8.5', color: '#dc2626' },
    { key: 'medium', label: 'SSP5-8.5 only', color: '#f97316' },
    { key: 'low', label: 'Not inundated', color: '#0d9488' }
];

class MarkerManager {
    constructor(map, eventBus, stateManager, dataManager = null) {
        this.map = map;
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.dataManager = dataManager;
        this.clusterGroup = null;
        this.markers = [];
        this.previewMap = new LagoonPreviewMap();
        this.tooltipCloseTimers = new Map();
        this.geometryCache = new Map();
    }

    init() {
        this.clusterGroup = L.markerClusterGroup({
            maxClusterRadius: 60,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            // Ring slices follow the legend display classes (markers carry _mapCategory).
            iconCreateFunction: cluster => window.NkuaWebGISMap.createCategoryClusterIcon(cluster,
                this.display ? this.display.categories() : LAGOON_CLUSTER_CATEGORIES)
        });
        this.map.addLayer(this.clusterGroup);

        this._loadGeometries();

        if (window.DEBUG_MODE) console.log('✅ MarkerManager: Initialized');
    }

    updateMarkers(data) {
        this.clusterGroup.clearLayers();
        this.markers = [];
        if (!data || data.length === 0) { this.eventBus.emit('markers:updated', { count: 0 }); return; }
        // Classes hidden in the legend are left off the map.
        (this.display ? this.display.visible(data) : data).forEach(lagoon => {
            const lat = lagoon.centroid_lat;
            const lng = lagoon.centroid_lng;
            if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;
            const marker = this.createMarker(lagoon);
            this.markers.push(marker);
            this.clusterGroup.addLayer(marker);
        });
        this.eventBus.emit('markers:updated', { count: this.markers.length });
    }

    createMarker(lagoon) {
        const rcp85 = lagoon.rcp8_5_inundated?.toLowerCase();
        const rcp26 = lagoon.rcp2_6_inundated?.toLowerCase();
        let fill = '#0d9488';
        let border = '#5eead4';
        if (rcp85 === 'yes') {
            if (rcp26 === 'yes') { fill = '#dc2626'; border = '#f87171'; }
            else                 { fill = '#f97316'; border = '#fdba74'; }
        }

        // Colour from the legend display settings (StatusBar sets this.display).
        const category = this.display ? this.display.classify(lagoon) : null;
        if (category) {
            fill = category.color;
            border = category.border || '#ffffff';
        }

        const icon = L.divIcon({
            className: '',
            html: `<div class="lagoon-marker" style="background:${fill};border-color:${border}"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        const marker = L.marker([lagoon.centroid_lat, lagoon.centroid_lng], { icon });

        // Store category so cluster icons can read it
        if (rcp85 === 'yes' && rcp26 === 'yes') marker._rcpCategory = 'high';
        else if (rcp85 === 'yes')                marker._rcpCategory = 'medium';
        else                                     marker._rcpCategory = 'low';
        marker._mapCategory = category ? category.key : marker._rcpCategory;

        marker.bindTooltip(buildLagoonHoverHTML(lagoon), {
            className: 'custom-tooltip',
            direction: 'top',
            offset: [0, -14],
            interactive: true
        });

        marker.on('mouseover', () => {
            this._clearCloseTimer(marker);
            if (!marker.isTooltipOpen()) marker.openTooltip();
        });

        marker.on('mouseout', () => {
            this._scheduleClose(marker, 320);
        });

        marker.on('tooltipopen', e => {
            this._bindTooltipHover(marker);
            this.renderTooltipPreview(e.tooltip, lagoon);
            // Wait one frame so the preview map paints, then clamp to viewport
            requestAnimationFrame(() => pinTooltipInsideMap(e.tooltip, this.map));
        });

        marker.on('tooltipclose', e => {
            this.destroyTooltipPreview(e.tooltip);
        });

        marker.on('click', () => {
            this.eventBus.emit('marker:clicked', {
                lagoonId: lagoon.id,
                previewGeojson: this.geometryCache.get(lagoon.id) || null,
                centroidLat: lagoon.centroid_lat,
                centroidLng: lagoon.centroid_lng
            });
        });

        return marker;
    }

    renderTooltipPreview(tooltip, lagoon) {
        const tooltipEl = tooltip?.getElement?.();
        const previewContainer = tooltipEl?.querySelector('[data-tooltip-preview-map]');
        if (!previewContainer) return;

        this.previewMap.render(previewContainer, {
            id: lagoon.id,
            geojson: this.geometryCache.get(lagoon.id) || null,
            centroid_lat: lagoon.centroid_lat,
            centroid_lng: lagoon.centroid_lng
        });
    }

    destroyTooltipPreview(tooltip) {
        const tooltipEl = tooltip?.getElement?.();
        const previewContainer = tooltipEl?.querySelector('[data-tooltip-preview-map]');
        if (previewContainer) this.previewMap.destroy(previewContainer);
    }

    async _loadGeometries() {
        if (!this.dataManager?.fetchPolygonData) return;
        try {
            const polygonData = await this.dataManager.fetchPolygonData({});
            if (polygonData) {
                polygonData.forEach(r => {
                    if (r.geojson) this.geometryCache.set(r.id, r.geojson);
                });
            }
        } catch (e) {
            if (window.DEBUG_MODE) console.warn('MarkerManager: Failed to load geometries', e);
        }
    }

    _bindTooltipHover(marker) {
        const tooltipEl = marker?.getTooltip?.()?.getElement?.();
        if (!tooltipEl || tooltipEl.dataset.hoverBound === '1') return;
        tooltipEl.dataset.hoverBound = '1';
        tooltipEl.addEventListener('mouseenter', () => this._clearCloseTimer(marker));
        tooltipEl.addEventListener('mouseleave', () => this._scheduleClose(marker, 180));
    }

    _scheduleClose(marker, delay) {
        this._clearCloseTimer(marker);
        const id = setTimeout(() => { marker.closeTooltip(); this.tooltipCloseTimers.delete(marker); }, delay);
        this.tooltipCloseTimers.set(marker, id);
    }

    _clearCloseTimer(marker) {
        const id = this.tooltipCloseTimers.get(marker);
        if (id) { clearTimeout(id); this.tooltipCloseTimers.delete(marker); }
    }

    getMarkers()  { return this.markers; }

    clearMarkers() {
        this.clusterGroup?.clearLayers();
        this.markers = [];
    }
}

export default MarkerManager;
