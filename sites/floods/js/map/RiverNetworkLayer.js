/**
 * Official Greek WFD reference layers. These do not assign floods to rivers
 * or modify flood records, filters and statistics. Full river geometry is
 * loaded at zoom 10; basin and district boundaries load only on request.
 */
const DATA_ROOT = new URL('../../data/rivers/ypeka/', import.meta.url);
const SOURCE_URL = 'https://wfdver.ypeka.gr/el/geoportal-gr/';
const DETAIL_ZOOM = 10;
const ATTRIBUTION = '<a href="https://wfdver.ypeka.gr/el/geoportal-gr/" target="_blank" rel="noopener noreferrer">Greek Ministry of Environment and Energy (ΥΠΕΝ) · WFD geoportal</a>';
const CONTEXT = {
    basins: { label: 'Greek river basins', color: '#987144', dash: '4 4', nameKeys: ['namenl', 'name'], idKey: 'eu_cd' },
    // districts: { label: 'Water districts', color: '#775681', dash: '9 4', nameKeys: ['rbdnamenl', 'rbdname'], idKey: 'eurbdcode' }
};

export default class RiverNetworkLayer {
    constructor(map, { overlays = [], markerManager = null, eventBus = null } = {}) {
        this.map = map;
        this.overlays = overlays;
        this.markerManager = markerManager;
        this.eventBus = eventBus || markerManager?.eventBus;
        this._onOverlayLayerChange = () => {
            for (const overlay of this.overlays) {
                if (overlay.input) overlay.input.checked = this.map.hasLayer(overlay.layer);
            }
        };
        this.enabled = false;
        this.ready = false;
        this.loading = false;
        this.mode = 'off';
        this.visibleRecordCount = 0;
        this.panelOpen = false;
        this.loadPromise = Promise.resolve();
        this.contextLayers = Object.fromEntries(Object.keys(CONTEXT).map(key => [key, {
            enabled: false, ready: false, loading: false, layer: null,
            visibleRecordCount: 0, generation: 0, loadPromise: Promise.resolve()
        }]));
        this._requests = new Map();
        this._generation = 0;
        this._destroyed = false;
        this._onViewChange = () => {
            // Invalidate before debouncing, so old requests cannot paint a new view.
            ++this._generation;
            clearTimeout(this._viewTimer);
            this._viewTimer = setTimeout(() => this._requestRefresh(), 100);
        };
    }

    init() {
        if (this.control || this._destroyed) return this;
        const pane = this.map.getPane('riverNetworkPane') || this.map.createPane('riverNetworkPane');
        pane.style.zIndex = '350';
        this.renderer = L.canvas({ pane: 'riverNetworkPane', padding: 0.3 });
        // Canvas hit testing does not pass through to a lower Canvas. A shared
        // renderer lets river and boundary strokes both receive pointer events.
        this.boundaryRenderer = this.renderer;
        this._createControl();
        this.map.attributionControl?.addAttribution(ATTRIBUTION);
        this.map.on('moveend zoomend', this._onViewChange);
        this.loadPromise = this._initialize();
        return this;
    }

    async _getManifest() {
        if (!this._manifestPromise) {
            this._manifestPromise = this._fetchJson('manifest.json').then(manifest => {
                if (!manifest.overview?.file || !manifest.detail?.file) throw new Error('Invalid river manifest.');
                this._fileUrl(manifest.overview.file);
                this._fileUrl(manifest.detail.file);
                this.manifest = manifest;
                return manifest;
            }).catch(error => {
                this._manifestPromise = null;
                throw error;
            });
        }
        return this._manifestPromise;
    }

    async _initialize() {
        this.loading = true;
        this._setStatus(this.enabled ? 'Loading river water bodies…' : 'Hidden');
        try {
            const manifest = await this._getManifest();
            this.overview = await this._fetchCollection(manifest.overview.file);
            if (this._destroyed) return;
            this.ready = true;
            await this._refresh();
        } catch (error) {
            if (!this._destroyed) this._showError('River water bodies unavailable.', error);
        } finally {
            if (!this.ready || !this.enabled) this.loading = false;
        }
    }

    _createControl() {
        const owner = this;
        const Control = L.Control.extend({
            options: { position: 'topleft' },
            onAdd() {
                const container = L.DomUtil.create('div', 'leaflet-bar river-network-control');
                owner.button = document.createElement('button');
                owner.button.type = 'button';
                owner.button.id = 'river-network-button';
                owner.button.className = 'river-network-button';
                owner.button.title = 'Map layers';
                owner.button.setAttribute('aria-label', 'Map layers');
                owner.button.setAttribute('aria-expanded', 'false');
                owner.button.setAttribute('aria-controls', 'river-network-panel');
                owner.button.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2L2 7l10 5 10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>';
                owner.button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    owner.setPanelOpen(!owner.panelOpen);
                });
                container.append(owner.button);
                const panel = document.createElement('div');
                panel.id = 'river-network-panel';
                panel.className = 'river-network-panel';
                panel.hidden = true;
                panel.setAttribute('role', 'group');
                panel.setAttribute('aria-labelledby', 'river-network-panel-title');
                owner.panel = panel;
                container.append(panel);
                const header = document.createElement('div');
                header.id = 'river-network-panel-title';
                header.className = 'river-network-panel-header';
                header.textContent = 'Map layers';
                panel.append(header);
                const makeToggle = (text, id, color, checked, onChange, parent = panel, point = false) => {
                    const label = document.createElement('label');
                    label.className = 'river-network-toggle';
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.id = id;
                    input.checked = checked;
                    input.addEventListener('change', () => onChange(input.checked));
                    const swatch = document.createElement('span');
                    swatch.className = 'river-network-swatch';
                    swatch.style.borderColor = color;
                    if (point) {
                        swatch.style.borderRadius = '50%';
                        swatch.style.background = color;
                    }
                    swatch.setAttribute('aria-hidden', 'true');
                    const name = document.createElement('span');
                    name.textContent = text;
                    label.append(input, swatch, name);
                    parent.append(label);
                    return input;
                };
                for (const overlay of owner.overlays) {
                    if (overlay.id === 'floods' && owner.markerManager) {
                        owner._createFloodControls(panel, makeToggle);
                        continue;
                    }
                    overlay.input = makeToggle(overlay.label, `${overlay.id}-layer-toggle`, overlay.color,
                        owner.map.hasLayer(overlay.layer), enabled => owner.setOverlayEnabled(overlay, enabled),
                        panel, overlay.id === 'floods');
                }
                owner.map.on('layeradd layerremove', owner._onOverlayLayerChange);
                owner.input = makeToggle('Greek rivers', 'river-network-toggle', '#277bb7', owner.enabled,
                    enabled => owner.setEnabled(enabled));
                owner.input.dataset.riverNetworkToggle = '';
                owner.status = document.createElement('p');
                owner.status.id = 'river-network-status';
                owner.status.className = 'river-network-status';
                owner.status.setAttribute('role', 'status');
                owner.status.setAttribute('aria-live', 'polite');
                panel.append(owner.status);
                owner.retryButton = owner._retryButton(() => {
                    owner.loadPromise = owner.ready ? owner._refresh() : owner._initialize();
                });
                panel.append(owner.retryButton);
                const boundaries = document.createElement('div');
                boundaries.className = 'river-network-boundaries';
                panel.append(boundaries);
                for (const [key, config] of Object.entries(CONTEXT)) {
                    const state = owner.contextLayers[key];
                    state.input = makeToggle(config.label, `river-network-${key}-toggle`, config.color, false,
                        enabled => owner.setContextEnabled(key, enabled), boundaries);
                    state.status = document.createElement('p');
                    state.status.id = `river-network-${key}-status`;
                    state.status.className = 'river-network-context-status';
                    state.status.setAttribute('role', 'status');
                    state.status.setAttribute('aria-live', 'polite');
                    state.status.hidden = true;
                    state.retryButton = owner._retryButton(() => owner.setContextEnabled(key, true));
                    boundaries.append(state.status, state.retryButton);
                }
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);
                return container;
            },
            onRemove() {
                owner._removeControlHandlers();
            }
        });
        this.control = new Control().addTo(this.map);
        this._onOutsidePointerDown = event => {
            if (this.panelOpen && !this.control.getContainer().contains(event.target)) this.setPanelOpen(false);
        };
        this._onPanelKeyDown = event => {
            if (this.panelOpen && event.key === 'Escape') {
                event.preventDefault();
                this.setPanelOpen(false);
                this.button.focus({ preventScroll: true });
            }
        };
        this._onPanelResize = () => {
            if (this.panelOpen) this._updatePanelLayout();
        };
        document.addEventListener('pointerdown', this._onOutsidePointerDown);
        document.addEventListener('keydown', this._onPanelKeyDown);
        window.addEventListener('resize', this._onPanelResize);
        this.map.on('resize', this._onPanelResize);
        this._placeAfterMeasurement();
        this._controlObserver = new MutationObserver(() => this._placeAfterMeasurement());
        this._controlObserver.observe(this.control.getContainer().parentElement, { childList: true });
    }

    _createFloodControls(panel, makeToggle) {
        const section = document.createElement('section');
        section.className = 'river-network-floods';
        const heading = document.createElement('div');
        heading.className = 'river-network-floods-heading';
        const title = document.createElement('strong');
        title.textContent = 'Floods';
        const settingsButton = document.createElement('button');
        settingsButton.type = 'button';
        settingsButton.className = 'river-network-display-button';
        settingsButton.textContent = 'Display settings';
        settingsButton.setAttribute('aria-haspopup', 'dialog');
        settingsButton.setAttribute('aria-controls', 'display-settings-dialog');
        settingsButton.addEventListener('click', () => {
            this.setPanelOpen(false);
            this.eventBus?.emit('display:open', { opener: this.button });
        });
        heading.append(title, settingsButton);
        section.append(heading);
        this.floodCriterion = document.createElement('p');
        this.floodCriterion.className = 'river-network-display-criterion';
        section.append(this.floodCriterion);
        this.floodClassList = document.createElement('div');
        this.floodClassList.className = 'river-network-flood-classes';
        section.append(this.floodClassList);
        const note = document.createElement('p');
        note.className = 'river-network-visibility-note';
        note.textContent = 'Map visibility · source-record counts include reports without coordinates';
        section.append(note);
        panel.append(section);
        this._makeFloodClassToggle = makeToggle;
        this._renderFloodCategories();
        this._displayUnsubscribe = this.eventBus?.on('display:changed', () => this._renderFloodCategories());
    }

    _renderFloodCategories() {
        if (!this.floodClassList || !this.markerManager) return;
        const settings = this.markerManager.getDisplaySettings();
        const parameters = {
            waterSource: 'Water source', onset: 'Onset / response', process: 'Generating process',
            mechanism: 'Inundation mechanism', sediment: 'Sediment behaviour',
            setting: 'Setting', compound: 'Interacting drivers'
        };
        const methods = {
            legacy: 'Original periods', jenks: 'Natural breaks', quantile: 'Quantiles',
            equalInterval: 'Equal intervals', decades: 'Calendar decades',
            fixedInterval: `${settings.interval || 10}-year spans`,
            standardDeviation: 'Standard deviation', custom: 'Custom boundaries'
        };
        this.floodCriterion.textContent = settings.mode === 'classification'
            ? parameters[settings.parameter] || 'Flood classification'
            : settings.mode === 'dataset' ? 'Dataset source' : `Year · ${methods[settings.yearMethod] || 'Year groups'}`;
        const focusedKey = document.activeElement?.dataset?.floodCategory;
        this.floodClassList.replaceChildren();
        for (const category of this.markerManager.getDisplayCategories()) {
            const key = category.key ?? category.id;
            const input = this._makeFloodClassToggle(category.label, `flood-class-${key}`,
                category.color, category.visible !== false,
                visible => this.markerManager.setCategoryVisibility(key, visible), this.floodClassList, true);
            input.dataset.floodCategory = key;
            const label = input.closest('label');
            label.querySelector('span:last-child').className = 'river-network-class-name';
            const count = document.createElement('span');
            count.className = 'river-network-class-count';
            count.textContent = Number(category.count || 0).toLocaleString();
            label.append(count);
            input.setAttribute('aria-label', `${category.label}: ${Number(category.count || 0).toLocaleString()} source records`);
            if (key === focusedKey) input.focus({ preventScroll: true });
        }
        if (this.panelOpen) this._updatePanelLayout();
    }

    setPanelOpen(open) {
        if (!this.panel || this._destroyed) return;
        this.panelOpen = Boolean(open);
        this.panel.hidden = !this.panelOpen;
        this.button.classList.toggle('active', this.panelOpen);
        this.button.setAttribute('aria-expanded', String(this.panelOpen));
        if (this.panelOpen) this._updatePanelLayout();
    }

    _placeAfterMeasurement() {
        const container = this.control?.getContainer();
        const corner = container?.parentElement;
        const measurement = corner?.querySelector('.measurement-control');
        if (measurement && measurement.parentElement === corner && measurement.nextElementSibling !== container) {
            measurement.insertAdjacentElement('afterend', container);
            if (this.panelOpen) this._updatePanelLayout();
        }
    }

    _updatePanelLayout() {
        const mapBounds = this.map.getContainer().getBoundingClientRect();
        const buttonBounds = this.control.getContainer().getBoundingClientRect();
        const visibleTop = Math.max(0, mapBounds.top);
        const visibleRight = Math.min(mapBounds.right, window.innerWidth);
        let visibleBottom = Math.min(mapBounds.bottom, window.innerHeight);
        const footer = document.querySelector('footer.footer');
        if (footer) {
            const footerBounds = footer.getBoundingClientRect();
            if (footerBounds.top > visibleTop && footerBounds.top < visibleBottom &&
                footerBounds.right > mapBounds.left && footerBounds.left < visibleRight) {
                visibleBottom = footerBounds.top;
            }
        }
        const belowButton = window.innerWidth <= 480;
        const desiredWidth = belowButton ? 190 : 210;
        const leftOffset = Math.max(0, Math.min(belowButton ? 0 : 38,
            visibleRight - buttonBounds.left - desiredWidth - 12));
        const availableWidth = Math.max(0, visibleRight - buttonBounds.left - leftOffset - 12);
        this.panel.style.left = `${leftOffset}px`;
        this.panel.style.width = `${Math.min(desiredWidth, availableWidth)}px`;
        this.panel.style.maxWidth = `${availableWidth}px`;
        const topOffset = belowButton ? 38 : 0;
        let availableHeight = visibleBottom - buttonBounds.top - topOffset - 20;
        const aboveBottom = Math.min(belowButton ? buttonBounds.top - 2 : buttonBounds.bottom, visibleBottom - 20);
        const aboveHeight = aboveBottom - visibleTop - 20;
        if (availableHeight < 100 && aboveHeight > availableHeight) {
            this.panel.style.top = 'auto';
            this.panel.style.bottom = `${buttonBounds.bottom - aboveBottom}px`;
            availableHeight = aboveHeight;
        } else {
            this.panel.style.top = `${topOffset}px`;
            this.panel.style.bottom = 'auto';
        }
        // The panel scrolls in actual free space; no minimum can push it
        // outside a short or narrow map. Normal mobile placement stays below.
        this.panel.style.maxHeight = `${Math.max(0, Math.min(420, availableHeight))}px`;
    }

    _removeControlHandlers() {
        this._controlObserver?.disconnect();
        this._displayUnsubscribe?.();
        this._displayUnsubscribe = null;
        this.map.off('layeradd layerremove', this._onOverlayLayerChange);
        document.removeEventListener('pointerdown', this._onOutsidePointerDown);
        document.removeEventListener('keydown', this._onPanelKeyDown);
        window.removeEventListener('resize', this._onPanelResize);
        if (this._onPanelResize) this.map.off('resize', this._onPanelResize);
    }

    _retryButton(onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'river-network-retry';
        button.textContent = 'Retry';
        button.hidden = true;
        button.addEventListener('click', onClick);
        return button;
    }

    setOverlayEnabled(overlay, enabled) {
        if (this._destroyed) return;
        if (enabled) {
            if (!this.map.hasLayer(overlay.layer)) this.map.addLayer(overlay.layer);
        } else {
            overlay.layer.eachLayer?.(layer => layer.closeTooltip?.());
            overlay.layer.unspiderfy?.();
            if (this.map.hasLayer(overlay.layer)) this.map.removeLayer(overlay.layer);
        }
        this._onOverlayLayerChange();
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (this.input) this.input.checked = this.enabled;
        if (!this.enabled) {
            ++this._generation;
            this.loading = false;
            this._clearDisplay();
            this._setStatus('Hidden');
        } else if (this.ready) {
            this._requestRefresh();
        } else {
            this._setStatus(this.loading ? 'Loading river water bodies…' : 'River water bodies unavailable.', !this.loading);
        }
    }

    _requestRefresh() {
        if (!this.ready || this._destroyed) return;
        this.loadPromise = this._refresh();
    }

    async _refresh() {
        const generation = ++this._generation;
        if (!this.enabled || this._destroyed || !this.ready) return;
        const isCurrent = () => this.enabled && !this._destroyed && generation === this._generation;
        if (this.map.getZoom() < DETAIL_ZOOM) {
            this.loading = false;
            this._showCollection(this.overview, 'overview');
            this.error = null;
            this._setStatus(`${this.visibleRecordCount.toLocaleString()} sections · zoom in for detail`);
            return;
        }
        if (this.mode === 'detail') {
            this.loading = false;
            this._setStatus(`${this.visibleRecordCount.toLocaleString()} water-body sections`);
            return;
        }
        this.loading = true;
        this._showCollection(this.overview, 'overview');
        this._setStatus('Loading detailed water bodies…');
        try {
            const collection = await this._fetchCollection(this.manifest.detail.file);
            if (!isCurrent()) return;
            this._showCollection(collection, 'detail');
            this.error = null;
            this._setStatus(`${this.visibleRecordCount.toLocaleString()} water-body sections`);
        } catch (error) {
            if (isCurrent()) this._showError('Detailed water bodies unavailable.', error);
        } finally {
            if (isCurrent()) this.loading = false;
        }
    }

    _showCollection(collection, mode) {
        if (!this.enabled || this._destroyed || (this.layer && this.mode === mode)) return;
        const layer = L.geoJSON(collection, {
            pane: 'riverNetworkPane', renderer: this.renderer,
            smoothFactor: mode === 'detail' ? 0 : 0.5,
            style: { color: '#277bb7', opacity: 0.85, weight: mode === 'detail' ? 1.8 : 1.5 },
            onEachFeature: (feature, reach) => {
                const properties = feature.properties || {};
                const name = this._name(properties.nametext) || this._name(properties.nametxtint) || 'Unnamed river water body';
                this._bindDetails(reach, name, () => this._riverDetails(properties, name));
            }
        });
        // Every source feature is retained: localid codes are not unique, while
        // gid identifies each section. No deduplication by water-body code.
        layer.addTo(this.map);
        if (this.layer) this.map.removeLayer(this.layer);
        this.layer = layer;
        this.mode = mode;
        this.visibleRecordCount = collection.features.length;
    }

    setContextEnabled(key, enabled) {
        const state = this.contextLayers[key];
        if (!state || this._destroyed) return;
        state.enabled = Boolean(enabled);
        if (state.input) state.input.checked = state.enabled;
        ++state.generation;
        if (!state.enabled) {
            state.loading = false;
            if (state.layer) this.map.removeLayer(state.layer);
            state.visibleRecordCount = 0;
            this._contextStatus(key, '');
        } else {
            state.loadPromise = this._loadContext(key);
        }
    }

    async _loadContext(key) {
        const state = this.contextLayers[key];
        const generation = state.generation;
        const isCurrent = () => state.enabled && !this._destroyed && state.generation === generation;
        state.loading = true;
        this._contextStatus(key, 'Loading…');
        try {
            const manifest = await this._getManifest();
            const file = manifest.contextLayers?.[key]?.file;
            if (!file) throw new Error('Missing boundary layer manifest.');
            const collection = await this._fetchCollection(file);
            if (!isCurrent()) return;
            if (!state.layer) {
                const config = CONTEXT[key];
                // Draw polygon rings as lines so unfilled polygon interiors
                // cannot intercept map pointer events or flood marker clicks.
                const boundaries = {
                    type: 'FeatureCollection',
                    features: collection.features.map(feature => {
                        let geometry = feature.geometry;
                        if (geometry?.type === 'Polygon') geometry = { type: 'MultiLineString', coordinates: geometry.coordinates };
                        if (geometry?.type === 'MultiPolygon') geometry = { type: 'MultiLineString', coordinates: geometry.coordinates.flat() };
                        return { ...feature, geometry };
                    })
                };
                state.layer = L.geoJSON(boundaries, {
                    pane: 'riverNetworkPane', renderer: this.boundaryRenderer, smoothFactor: 0,
                    style: { color: config.color, weight: 1.4, opacity: 0.75, dashArray: config.dash, fill: false },
                    onEachFeature: (feature, boundary) => {
                        const properties = feature.properties || {};
                        const name = config.nameKeys.map(field => this._name(properties[field])).find(Boolean) || config.label;
                        this._bindDetails(boundary, name, () => this._boundaryDetails(properties, name, key));
                    }
                });
            }
            state.layer.addTo(this.map);
            state.layer.bringToBack();
            state.ready = true;
            state.visibleRecordCount = collection.features.length;
            state.error = null;
            this._contextStatus(key, '');
        } catch (error) {
            if (isCurrent()) {
                state.error = error;
                this._contextStatus(key, this._errorText('Unavailable.', error), true);
                console.warn(`WFD ${CONTEXT[key].label}:`, error.message);
            }
        } finally {
            if (isCurrent()) state.loading = false;
        }
    }

    _bindDetails(layer, name, popup) {
        const tooltip = document.createElement('span');
        tooltip.textContent = name;
        layer.bindTooltip(tooltip, { className: 'river-network-tooltip', sticky: true, direction: 'top' });
        layer.bindPopup(() => {
            // Calculate at opening time, including after a viewport resize.
            // Leaflet applies these before sizing and automatically panning.
            this.setPanelOpen(false);
            Object.assign(layer.getPopup().options, this._popupOptions());
            return popup();
        }, { className: 'river-network-popup', ...this._popupOptions() });
    }

    _popupOptions() {
        const size = this.map.getSize();
        const mobile = window.innerWidth < 600;
        const topReserve = 10;
        const bottomReserve = mobile ? 90 : 30;
        const leftReserve = 45;
        const rightReserve = mobile ? 5 : 10;
        return {
            pane: 'popupPane',
            autoPan: true,
            autoPanPaddingTopLeft: [leftReserve, topReserve],
            autoPanPaddingBottomRight: [rightReserve, bottomReserve],
            maxHeight: Math.max(80, Math.min(420, size.y - topReserve - bottomReserve - 50)),
            maxWidth: Math.max(140, Math.min(300, size.x - leftReserve - rightReserve - 45))
        };
    }

    _name(value) {
        if (typeof value !== 'string') return '';
        const text = value.trim();
        return /^(null|none|n\/a|-)$/i.test(text) ? '' : text;
    }

    _detailsBase(name) {
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = name;
        content.append(title);
        return content;
    }

    _detailRow(content, label, value) {
        const row = document.createElement('p');
        const display = value === null || value === undefined || value === '' ? 'Not recorded' : String(value).replace(/_x000D_/gi, '\n');
        row.textContent = `${label}: ${display}`;
        content.append(row);
    }

    _detailSource(content) {
        const source = document.createElement('a');
        source.href = SOURCE_URL;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = 'ΥΠΕΝ · River basin plans';
        content.append(source);
    }

    _riverDetails(properties, name) {
        const content = this._detailsBase(name);
        const international = this._name(properties.nametxtint);
        if (international && international !== name) this._detailRow(content, 'International name', international);
        this._detailRow(content, 'Water-body designation', this._waterBodyDesignation(properties.localid));
        for (const [field, label] of [
            ['localid', 'Official water-body code'], ['gid', 'Source section ID'],
            ['rzoneid', 'Water district code'], ['spzonetype', 'Source water-body type'],
            ['ecological', 'Ecological status / potential'], ['chemical', 'Chemical status'],
            ['total', 'Overall environmental status']
        ]) this._detailRow(content, label, properties[field]);
        const note = document.createElement('p');
        note.className = 'river-network-quality-note';
        note.textContent = 'Environmental quality classifications; they do not describe flood hazard.';
        content.append(note);
        this._detailSource(content);
        return content;
    }

    _waterBodyDesignation(code) {
        // Official WFD coding convention: final N / H / A. Do not infer a
        // designation from water-quality classes, geometry or river names.
        const suffix = typeof code === 'string' ? code.trim().slice(-1).toUpperCase() : '';
        return { N: 'Natural', H: 'Heavily modified', A: 'Artificial' }[suffix] || 'Not recorded';
    }

    _boundaryDetails(properties, name, key) {
        const content = this._detailsBase(name);
        const config = CONTEXT[key];
        const international = this._name(properties[config.nameKeys[1]]);
        if (international && international !== name) this._detailRow(content, 'International name', international);
        this._detailRow(content, 'Official ID', properties[config.idKey]);
        if (key === 'basins') this._detailRow(content, 'Water district code (source)', properties.dist_cd);
        this._detailSource(content);
        return content;
    }

    _fileUrl(file) {
        if (typeof file !== 'string' || !/^[a-zA-Z0-9_./-]+\.json(?:\.gz)?$/.test(file) ||
            file.startsWith('/') || file.split('/').includes('..')) throw new Error('Invalid reference data file path.');
        return new URL(file, DATA_ROOT).href;
    }

    async _fetchJson(file) {
        const response = await fetch(this._fileUrl(file));
        if (!response.ok) throw new Error(`Reference data request failed (${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        // HTTP Content-Encoding may have decoded a gzip file already. Detect
        // the payload magic rather than assuming the suffix means raw gzip.
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
            if (typeof DecompressionStream !== 'function') {
                const error = new Error('This browser cannot decompress the reference network.');
                error.code = 'GZIP_UNSUPPORTED';
                throw error;
            }
            return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
        }
        return JSON.parse(new TextDecoder().decode(bytes));
    }

    _fetchCollection(file) {
        if (!this._requests.has(file)) {
            this._requests.set(file, this._fetchJson(file).then(collection => {
                if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Invalid reference geometry collection.');
                return collection;
            }).catch(error => {
                this._requests.delete(file);
                throw error;
            }));
        }
        return this._requests.get(file);
    }

    _setStatus(message, error = false) {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.classList.toggle('river-network-error', error);
        this.retryButton.hidden = !error;
    }

    _contextStatus(key, message, error = false) {
        const state = this.contextLayers[key];
        if (!state.status) return;
        state.status.textContent = message;
        state.status.hidden = !message;
        state.status.classList.toggle('river-network-error', error);
        state.retryButton.hidden = !error;
    }

    _errorText(message, error) {
        return error.code === 'GZIP_UNSUPPORTED' ? 'Update browser to load this layer.' : message;
    }

    _showError(message, error) {
        this.error = error;
        this.loading = false;
        this._setStatus(this.enabled ? this._errorText(message, error) : 'Hidden', this.enabled);
        console.warn('Greek WFD river overlay:', error.message);
    }

    _clearDisplay() {
        if (this.layer) this.map.removeLayer(this.layer);
        this.layer = null;
        this.mode = 'off';
        this.visibleRecordCount = 0;
    }

    destroy() {
        this._destroyed = true;
        this.enabled = false;
        ++this._generation;
        clearTimeout(this._viewTimer);
        this.map.off('moveend zoomend', this._onViewChange);
        this._clearDisplay();
        this._removeControlHandlers();
        for (const state of Object.values(this.contextLayers)) {
            state.enabled = false;
            ++state.generation;
            if (state.layer) this.map.removeLayer(state.layer);
        }
        this.control?.remove();
        this.map.attributionControl?.removeAttribution(ATTRIBUTION);
        for (const renderer of new Set([this.renderer, this.boundaryRenderer])) {
            if (renderer && this.map.hasLayer(renderer)) this.map.removeLayer(renderer);
        }
    }
}
