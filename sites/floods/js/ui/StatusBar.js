/**
 * StatusBar - Full-width status bar at the bottom of the map
 *
 * Displays scale, statistics and connection status.
 * Black background, white text, professional appearance.
 */

import { formatNumber } from '../utils/helpers.js';
import { PARAMETERS, YEAR_METHODS } from '../map/FloodClassification.js?v=20261004-cnih-1';

class StatusBar {
    constructor(eventBus, stateManager, markerManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.markerManager = markerManager;
        this.unsubscribers = [];
        this.container = null;
        this.scaleControl = null;
        this.elements = {
            totalEvents: null,
            filteredEvents: null,
            connectionDot: null,
            scaleContainer: null,
            legendCounts: {}
        };
        this.isOnline = navigator.onLine;
        this.globalTotal = null;
    }

    init(map) {
        this.map = map;
        this.removeDefaultAttribution();
        this.createStatusBar();
        this.setupEventListeners();

        if (window.DEBUG_MODE) {
            console.log('✅ StatusBar: Initialized');
        }
    }

    removeDefaultAttribution() {
        this.map.attributionControl?.remove();
    }

    createStatusBar() {
        const mapContainer = this.map.getContainer();

        this.container = document.createElement('div');
        this.container.className = 'map-status-bar';

        this.container.innerHTML = `
            <div class="status-bar-left-col">
                <div class="status-bar-legend" role="group" aria-label="Flood map legend">
                    <div class="legend-title">
                        <span class="legend-title-main">Water source</span>
                        <span class="legend-title-sub">source records</span>
                        <button class="flood-display-settings-button" type="button" aria-label="Map display settings" aria-haspopup="dialog" aria-controls="display-settings-dialog" title="Map display settings">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/></svg>
                        </button>
                    </div>
                    <div class="flood-display-legend-rows"></div>
                </div>
            </div>
        `;

        (mapContainer.parentNode || mapContainer).appendChild(this.container);
        this.mapReadout = window.NkuaWebGISMap.addMapReadout(this.map, this.container);

        this.elements.totalEvents = this.container.querySelector('#status-total-events');
        this.elements.filteredEvents = this.container.querySelector('#status-filtered-events');
        this.elements.connectionDot = this.container.querySelector('#status-connection-dot');
        this.elements.scaleContainer = this.mapReadout?.element.querySelector('.status-scale') || null;
        this.elements.legendTitle = this.container.querySelector('.legend-title-main');
        this.elements.legendRows = this.container.querySelector('.flood-display-legend-rows');
        this.elements.settingsButton = this.container.querySelector('.flood-display-settings-button');
        this.elements.settingsButton.addEventListener('click', () => {
            this.eventBus.emit('display:open', { opener: this.elements.settingsButton });
        });
        this.renderLegend();
    }

    createScaleBar() {
        this.scaleControl = L.control.scale({
            position: 'bottomleft',
            metric: true,
            imperial: false,
            maxWidth: 100
        });
        this.scaleControl.addTo(this.map);

        const scaleElement = document.querySelector('.leaflet-control-scale');
        if (scaleElement && this.elements.scaleContainer) {
            this.elements.scaleContainer.appendChild(scaleElement);
        }
    }

    setupEventListeners() {
        this.unsubscribers.push(this.eventBus.on('data:loaded', ({ count, data } = {}) => {
            this.updateFilteredEvents(count);
            this.updateLegendCounts(Array.isArray(data) ? data : this.stateManager.get('currentData') || []);

            // First ever load (no filters) acts as the global total
            if (this.globalTotal === null || this.globalTotal === undefined) {
                this.globalTotal = count;
                this.updateTotalEvents(count);
            }
        }));
        this.unsubscribers.push(this.eventBus.on('display:changed', payload => this.renderLegend(payload)));
    }

    updateLegendCounts() { this.renderLegend(); }

    renderLegend(payload) {
        if (!this.elements.legendRows) return;
        const settings = payload?.settings || this.markerManager?.getDisplaySettings();
        const categories = payload?.categories || this.markerManager?.getDisplayCategories() || [];
        const label = settings?.mode === 'year' ? 'Event year' : settings?.mode === 'dataset' ? 'Dataset source'
            : PARAMETERS.find(parameter => parameter.key === settings?.parameter)?.label || 'Water source';
        this.elements.legendTitle.textContent = label;
        this.elements.legendTitle.title = settings?.mode === 'year'
            ? YEAR_METHODS.find(method => method.key === settings.yearMethod)?.label || '' : '';
        this.elements.legendCounts = {};
        this.elements.legendRows.replaceChildren();
        for (const category of categories) {
            const row = document.createElement('div');
            row.className = `legend-row${category.visible ? '' : ' is-hidden'}`;
            row.dataset.category = category.key;
            row.title = category.visible ? 'Matching source records, including reports without coordinates. Only reported locations are mapped.' : 'Hidden on the map; source-record counts include reports without coordinates.';
            const dot = document.createElement('span');
            dot.className = 'legend-dot';
            dot.setAttribute('aria-hidden', 'true');
            dot.style.backgroundColor = category.color;
            dot.style.borderColor = category.border;
            const text = document.createElement('span');
            text.className = 'legend-text';
            text.textContent = category.label;
            const count = document.createElement('span');
            count.className = 'legend-count';
            count.dataset.count = category.key;
            count.textContent = formatNumber(category.count);
            row.append(dot, text, count);
            this.elements.legendRows.append(row);
            this.elements.legendCounts[category.key] = count;
        }
    }

    setupConnectionMonitor() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionStatus(true);
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateConnectionStatus(false);
        });
    }

    updateTotalEvents(count) {
        if (this.elements.totalEvents) {
            this.elements.totalEvents.textContent = formatNumber(count);
        }
    }

    updateFilteredEvents(count) {
        if (this.elements.filteredEvents) {
            this.elements.filteredEvents.textContent = formatNumber(count);
        }
    }

    updateConnectionStatus(isOnline) {
        if (this.elements.connectionDot) {
            this.elements.connectionDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        }
    }

    destroy() {
        this.unsubscribers.forEach(unsubscribe => unsubscribe());
        this.unsubscribers = [];
        this.mapReadout?.remove?.();
        this.container?.remove();
    }
}

export default StatusBar;
