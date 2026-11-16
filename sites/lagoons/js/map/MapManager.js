/**
 * MapManager - Leaflet map initialisation for Greek Lagoons
 */

import MeasurementTool from './MeasurementTool.js';

class MapManager {
    constructor(eventBus, stateManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.map = null;
        this.basemaps = {};
        this.currentBasemap = null;
        this.measurementTool = null;
    }

    init(containerId) {
        this.map = L.map(containerId, {
            center: [39.0742, 21.8243],
            zoom: 7,
            maxZoom: 19,
            zoomControl: true,
            attributionControl: true,
            // Allow quarter-zoom steps so the scale fraction updates smoothly
            // when scrolling, instead of jumping in big discrete bands.
            zoomSnap: 0.25,
            zoomDelta: 0.5,
            wheelPxPerZoomLevel: 80
        });

        this._initBasemaps();
        this._initControls();
        this.stateManager.set('mapInstance', this.map);

        this.map.on('moveend zoomend', () => {
            this.stateManager.set('mapBounds', this.map.getBounds());
        });

        if (window.DEBUG_MODE) console.log('✅ MapManager: Initialized');
    }

    _initBasemaps() {
        this.basemaps = window.NkuaWebGISMap.createBasemaps();
        this.currentBasemap = window.NkuaWebGISMap.addDefault(this.map, this.basemaps);
    }

    _initControls() {
        window.NkuaWebGISMap.addBasemapPicker(this.map, this.basemaps, {
            defaultName: this.currentBasemap,
            onChange: (name) => { this.currentBasemap = name; }
        });
        window.NkuaWebGISMap.addNorthArrow(this.map);

        if (typeof MeasurementTool !== 'undefined') {
            this.measurementTool = new MeasurementTool(this.map);
        }
    }

    _addBasemapPicker() {
        const basemapNames = Object.keys(this.basemaps);
        if (!basemapNames.length) return;

        const BasemapPickerControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: () => {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control basemap-picker');
                const btn = L.DomUtil.create('button', 'basemap-picker-btn', container);
                btn.type = 'button';
                btn.setAttribute('aria-label', 'Select basemap');
                btn.title = 'Select basemap';
                btn.innerHTML = `
                    <svg class="basemap-picker-icon" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                         stroke-linejoin="round" aria-hidden="true" focusable="false">
                        <rect x="3" y="4" width="18" height="16" rx="1.5"/>
                        <polyline points="3 15 8 10 13 14 16 11 21 15"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                    </svg>
                `;

                const panel = L.DomUtil.create('div', 'basemap-picker-panel', container);
                panel.setAttribute('role', 'menu');
                panel.style.display = 'none';

                const closePanel = () => {
                    panel.style.display = 'none';
                    container.classList.remove('basemap-picker-open');
                };

                const openPanel = () => {
                    panel.style.display = 'block';
                    container.classList.add('basemap-picker-open');
                };

                const togglePanel = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (panel.style.display === 'none') openPanel();
                    else closePanel();
                };

                basemapNames.forEach(name => {
                    const item = L.DomUtil.create('button', 'basemap-picker-item', panel);
                    item.type = 'button';
                    item.textContent = name;
                    item.addEventListener('click', e => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.switchBasemap(name);
                        closePanel();
                    });
                });

                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                btn.addEventListener('click', togglePanel);

                document.addEventListener('click', e => {
                    if (!container.contains(e.target)) closePanel();
                });

                return container;
            }
        });

        this.map.addControl(new BasemapPickerControl());
    }

    switchBasemap(name) {
        if (!this.basemaps[name]) return;
        if (this.currentBasemap && this.basemaps[this.currentBasemap]) {
            this.map.removeLayer(this.basemaps[this.currentBasemap]);
        }
        this.basemaps[name].addTo(this.map);
        this.currentBasemap = name;
    }

    getMap() { return this.map; }
}

export default MapManager;
