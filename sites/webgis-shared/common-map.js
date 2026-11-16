(function () {
    'use strict';

    // Keep the applications usable when the optional clustering bundle is
    // delayed or blocked. The normal MarkerCluster implementation remains the
    // preferred path; this feature-group fallback preserves the same API used
    // by the five atlases without stopping application initialization.
    if (window.L && typeof L.markerClusterGroup !== 'function') {
        L.markerClusterGroup = function () {
            var group = L.featureGroup();
            group.addLayers = function (layers) {
                (layers || []).forEach(function (layer) { group.addLayer(layer); });
                return group;
            };
            group.getVisibleParent = function (layer) { return layer; };
            group.refreshClusters = function () { return group; };
            return group;
        };
    }

    var DEFAULT_BASEMAP = 'OpenFreeMap Positron';
    var BASEMAP_CREDITS = {
        'OpenStreetMap': '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
        'Topographic': '<a href="https://opentopomap.org/about" target="_blank" rel="noopener noreferrer">© OpenTopoMap contributors</a>',
        'ESRI Satellite': '<a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Tiles © Esri</a>',
        'OpenFreeMap Positron': '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
    };
    var creditsId = 0;

    function addAttributionDisclosure(map, basemapName) {
        if (map.attributionControl && typeof map.attributionControl.setPrefix === 'function') {
            map.attributionControl.setPrefix(false);
        }

        if (map._nkuaMapCredits) {
            map._nkuaMapCredits.update(basemapName);
            return map._nkuaMapCredits;
        }

        var button;
        var panel;
        var panelId = 'map-credits-panel-' + (++creditsId);
        var documentClickHandler;
        var documentKeyHandler;

        function closePanel() {
            if (!button || !panel) return;
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        }

        var CreditsControl = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd: function () {
                var container = L.DomUtil.create('div', 'leaflet-control map-credits-control');
                button = L.DomUtil.create('button', 'map-credits-button', container);
                button.type = 'button';
                button.setAttribute('aria-label', 'Map credits');
                button.setAttribute('aria-expanded', 'false');
                button.setAttribute('aria-controls', panelId);
                button.title = 'Map credits';
                button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6"></path><path d="M12 7.25h.01"></path></svg>';

                panel = L.DomUtil.create('div', 'map-credits-panel', container);
                panel.id = panelId;
                panel.hidden = true;
                panel.setAttribute('role', 'group');
                panel.setAttribute('aria-label', 'Basemap attribution');

                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                button.addEventListener('click', function () {
                    var willOpen = panel.hidden;
                    panel.hidden = !willOpen;
                    button.setAttribute('aria-expanded', String(willOpen));
                });

                documentClickHandler = function (event) {
                    if (!container.contains(event.target)) closePanel();
                };
                documentKeyHandler = function (event) {
                    if (event.key === 'Escape' && !panel.hidden) {
                        closePanel();
                        button.focus();
                    }
                };
                document.addEventListener('click', documentClickHandler);
                document.addEventListener('keydown', documentKeyHandler);

                return container;
            },
            onRemove: function () {
                document.removeEventListener('click', documentClickHandler);
                document.removeEventListener('keydown', documentKeyHandler);
            }
        });

        var control = new CreditsControl();
        control.addTo(map);

        map._nkuaMapCredits = {
            control: control,
            update: function (name) {
                if (!panel) return;
                panel.innerHTML = BASEMAP_CREDITS[name] || BASEMAP_CREDITS[DEFAULT_BASEMAP];
                closePanel();
            }
        };
        map._nkuaMapCredits.update(basemapName);
        return map._nkuaMapCredits;
    }

    var vectorMapsAvailable;

    function supportsVectorMaps() {
        if (vectorMapsAvailable !== undefined) return vectorMapsAvailable;
        vectorMapsAvailable = false;
        if (typeof L.maplibreGL !== 'function' || !window.maplibregl) return false;
        try {
            var context = document.createElement('canvas').getContext('webgl2');
            vectorMapsAvailable = !!context;
            var release = context && context.getExtension('WEBGL_lose_context');
            if (release) release.loseContext();
        } catch (_error) { vectorMapsAvailable = false; }
        return vectorMapsAvailable;
    }

    function discardVectorLayer(map, layer) {
        // Leaflet attaches these handlers before the vector renderer initializes.
        if (typeof layer.getEvents === 'function') map.off(layer.getEvents(), layer);
        try { map.removeLayer(layer); } catch (_error) { /* Renderer did not finish initialization. */ }
    }

    function addPreviewBasemap(map) {
        if (supportsVectorMaps()) {
            var vector = L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/positron', attribution: '' });
            try { vector.addTo(map); return vector; }
            catch (_error) {
                vectorMapsAvailable = false;
                discardVectorLayer(map, vector);
            }
        }
        return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors', maxZoom: 19
        }).addTo(map);
    }

    function createBasemaps() {
        var basemaps = {
            'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }),
            'Topographic': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenTopoMap contributors',
                maxZoom: 17
            }),
            'ESRI Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles © Esri',
                maxZoom: 19
            })
        };
        if (supportsVectorMaps()) {
            basemaps[DEFAULT_BASEMAP] = L.maplibreGL({
                style: 'https://tiles.openfreemap.org/styles/positron',
                attribution: 'OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors'
            });
        }
        return basemaps;
    }

    function applyWorldLimits(map) {
        if (map._nkuaWorldLimits) return;
        map._nkuaWorldLimits = true;
        map.options.maxBoundsViscosity = 1;
        map.setMaxBounds([[-85.0511287798, -Infinity], [85.0511287798, Infinity]]);
        var configuredMinZoom = Number.isFinite(map.options.minZoom) ? map.options.minZoom : 0;
        function updateLimits() {
            var worldHeight = map.getPixelWorldBounds(0).getSize().y;
            var viewportHeight = Math.max(1, map.getSize().y);
            var snap = map.options.zoomSnap || 1;
            var minZoom = Math.max(configuredMinZoom, Math.ceil(Math.log2(viewportHeight / worldHeight) / snap) * snap);
            map.setMinZoom(minZoom);
            map.panInsideBounds(map.options.maxBounds, { animate: false });
        }
        updateLimits();
        map.on('resize', updateLimits);
    }

    function addDefault(map, basemaps) {
        applyWorldLimits(map);
        var name = basemaps[DEFAULT_BASEMAP] ? DEFAULT_BASEMAP : 'OpenStreetMap';
        try { basemaps[name].addTo(map); }
        catch (_error) {
            if (name !== DEFAULT_BASEMAP) throw _error;
            vectorMapsAvailable = false;
            discardVectorLayer(map, basemaps[name]);
            delete basemaps[name];
            name = 'OpenStreetMap';
            basemaps[name].addTo(map);
        }
        addAttributionDisclosure(map, name);
        return name;
    }

    function addBasemapPicker(map, basemaps, options) {
        options = options || {};
        var names = Object.keys(basemaps || {});
        if (!names.length) return null;
        var current = options.defaultName || DEFAULT_BASEMAP;
        var label = options.label || 'Select basemap';

        var Picker = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: function () {
                var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control basemap-picker');
                var button = L.DomUtil.create('button', 'basemap-picker-btn', container);
                button.type = 'button';
                button.setAttribute('aria-label', label);
                button.title = label;
                button.innerHTML = '<svg class="basemap-picker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="1.5"></rect><polyline points="3 15 8 10 13 14 16 11 21 15"></polyline><circle cx="8.5" cy="8.5" r="1.5"></circle></svg>';

                var panel = L.DomUtil.create('div', 'basemap-picker-panel', container);
                panel.setAttribute('role', 'menu');
                panel.style.display = 'none';

                function closePanel() {
                    panel.style.display = 'none';
                    container.classList.remove('basemap-picker-open');
                }

                names.forEach(function (name) {
                    var item = L.DomUtil.create('button', 'basemap-picker-item', panel);
                    item.type = 'button';
                    item.textContent = name;
                    item.setAttribute('role', 'menuitem');
                    item.addEventListener('click', function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                        names.forEach(function (otherName) {
                            if (map.hasLayer(basemaps[otherName])) map.removeLayer(basemaps[otherName]);
                        });
                        basemaps[name].addTo(map);
                        current = name;
                        if (map._nkuaMapCredits) map._nkuaMapCredits.update(name);
                        if (typeof options.onChange === 'function') options.onChange(name);
                        closePanel();
                    });
                });

                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);
                button.addEventListener('click', function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    var isClosed = panel.style.display === 'none';
                    panel.style.display = isClosed ? 'block' : 'none';
                    container.classList.toggle('basemap-picker-open', isClosed);
                });
                document.addEventListener('click', function (event) {
                    if (!container.contains(event.target)) closePanel();
                });
                return container;
            }
        });

        var control = new Picker();
        map.addControl(control);
        return {
            control: control,
            getCurrent: function () { return current; }
        };
    }

    function addNorthArrow(map, options) {
        options = options || {};
        var label = options.label || 'N';
        var title = options.title || 'North';
        var NorthArrow = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd: function () {
                var div = L.DomUtil.create('div', 'north-arrow-control');
                div.title = title;
                div.setAttribute('aria-label', title);
                div.innerHTML = '<svg viewBox="0 0 40 60" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polygon points="20,2 28,38 20,32 12,38" fill="black"></polygon><polygon points="20,58 28,22 20,28 12,22" fill="white" stroke="black" stroke-width="1"></polygon><text x="20" y="54" text-anchor="middle" font-size="10" font-weight="bold" fill="black">' + label + '</text></svg>';
                return div;
            }
        });
        var control = new NorthArrow();
        control.addTo(map);
        return control;
    }

    function createCategoryMarkerIcon(category, options) {
        options = options || {};
        var size = options.size || 18;
        var anchor = size / 2;
        var fill = category && category.color ? category.color : '#000000';
        var border = category && category.border ? category.border : '#ffffff';

        return L.divIcon({
            className: '',
            html: '<div class="map-category-marker" style="background:' + fill + ';border-color:' + border + '"></div>',
            iconSize: [size, size],
            iconAnchor: [anchor, anchor]
        });
    }

    var compactPinCount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

    function formatPinCount(count) {
        return count >= 1000 ? compactPinCount.format(count).replace(/([KMBT])$/, '\u202f$1') : String(count);
    }

    // Historic Floods shows full counts; only five-digit totals are compacted
    // so they still fit inside the cluster disc.
    function formatClusterCount(count) {
        return count >= 10000 ? formatPinCount(count) : String(count);
    }

    function escapeAttribute(value) {
        return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Same ring as the Historic Floods atlas: a conic-gradient slice per
    // category (in legend order) around a dark count disc.
    function createCategoryClusterIcon(cluster, categories, summary) {
        categories = Array.isArray(categories) ? categories : [];
        var children = typeof cluster.getAllChildMarkers === 'function'
            ? cluster.getAllChildMarkers()
            : [];
        var count = summary ? summary.count : (children.length || cluster.getChildCount());
        var counts = summary ? summary.counts : Object.create(null);
        var formatCount = summary && summary.formatCount ? summary.formatCount : formatClusterCount;

        if (!summary) children.forEach(function (marker) {
            var key = marker && marker._mapCategory;
            if (key) counts[key] = (counts[key] || 0) + 1;
        });

        var offset = 0;
        var slices = [];
        var parts = [];
        categories.forEach(function (category) {
            var categoryCount = counts[category.key] || 0;
            if (!categoryCount || !count) return;
            var start = offset;
            offset = Math.min(100, offset + categoryCount / count * 100);
            slices.push(category.color + ' ' + start + '% ' + offset + '%');
            parts.push((category.label || category.key) + ': ' + categoryCount.toLocaleString('en-US'));
        });
        if (offset < 99.5) slices.push('#737373 ' + offset + '% 100%');

        var description = parts.join('; ');
        var label = count.toLocaleString('en-US') + ' records' + (description ? '. ' + description : '');
        var size = count >= 100 ? 48 : count >= 10 ? 42 : 36;
        return L.divIcon({
            html: '<div class="map-category-cluster" role="img" aria-label="' + escapeAttribute(label) + '" title="' + escapeAttribute(description) + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:conic-gradient(' + slices.join(', ') + ');box-shadow:0 1px 5px #0006"><span style="display:flex;align-items:center;justify-content:center;width:' + (size - 10) + 'px;height:' + (size - 10) + 'px;border-radius:50%;background:#171717;color:#fff;font:600 12px var(--font-sans,Arial,sans-serif)">' + formatCount(count) + '</span></div>',
            className: 'minimal-cluster',
            iconSize: L.point(size, size),
            iconAnchor: L.point(size / 2, size / 2)
        });
    }

    var LASSO_ICON = '<svg class="basemap-picker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7.2 15.8C4.7 14.8 3 13 3 10.9 3 7.6 7 5 12 5s9 2.6 9 5.9-4 5.9-9 5.9c-1.1 0-2.2-.1-3.2-.4"></path><circle cx="7.6" cy="16.6" r="1.4"></circle><path d="M7 18c-.6 1.3-.2 2.6 1 3.2"></path></svg>';
    var LASSO_CLEAR_ICON = '<svg class="basemap-picker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"></path></svg>';
    var LASSO_TRACE_STYLE = { color: '#111111', weight: 2, opacity: 0.85, dashArray: '4 4', fill: false, interactive: false };
    var LASSO_SHAPE_STYLE = { color: '#111111', weight: 1.5, opacity: 0.9, dashArray: '6 4', fillColor: '#111111', fillOpacity: 0.06, interactive: false };

    // Proportional to Web Mercator y; with longitude as x this keeps the
    // drawn shape's geometry as seen on the map.
    function mercatorY(lat) {
        var limit = 85.0511287798;
        var sine = Math.sin(Math.max(-limit, Math.min(limit, lat)) * Math.PI / 180);
        return 0.5 * Math.log((1 + sine) / (1 - sine));
    }

    // Freehand lasso. Each atlas keeps its own filter pipeline and asks
    // lasso.filter() / lasso.contains() whether a record lies inside the shape;
    // onChange fires when a shape is drawn or cleared.
    function addLassoSelection(map, options) {
        options = options || {};
        var label = options.label || 'Lasso selection: draw around records';
        var clearLabel = options.clearLabel || 'Clear lasso selection';
        var container = map.getContainer();
        var armed = false;
        var drawing = null;
        var shape = null;
        var ring = null;
        var box = null;
        var handlers = null;
        var linked = null;
        var button;
        var clearButton;
        var api;

        // Shows the selection as a removable filter tag and narrows the
        // filter-value counts of a linked NkuaWebGISUI atlas interface.
        function syncLinked() {
            if (!linked || typeof linked.atlas.setSpatialFilter !== 'function') return;
            linked.atlas.setSpatialFilter(ring ? {
                label: linked.label,
                test: function (record) {
                    var latlng = linked.getLatLng(record);
                    return Boolean(latlng) && contains(latlng[0], latlng[1]);
                },
                clear: function () { clear(); }
            } : null);
        }

        function attach(atlas, getLatLng, chipLabel) {
            if (!atlas) return api;
            linked = { atlas: atlas, getLatLng: getLatLng, label: chipLabel || options.chipLabel || 'Lasso selection' };
            syncLinked();
            return api;
        }

        function notify() {
            syncLinked();
            if (typeof options.onChange === 'function') options.onChange(api);
        }

        function setArmed(next) {
            if (armed === next) return;
            armed = next;
            container.classList.toggle('lasso-armed', armed);
            button.classList.toggle('is-active', armed);
            button.setAttribute('aria-pressed', String(armed));
            if (armed) {
                handlers = {};
                ['dragging', 'doubleClickZoom', 'boxZoom'].forEach(function (name) {
                    handlers[name] = Boolean(map[name] && map[name].enabled());
                    if (handlers[name]) map[name].disable();
                });
                document.addEventListener('keydown', onKeyDown);
            } else {
                Object.keys(handlers || {}).forEach(function (name) {
                    if (handlers[name]) map[name].enable();
                });
                handlers = null;
                document.removeEventListener('keydown', onKeyDown);
            }
        }

        function stopDrawing(pointerId) {
            if (!drawing) return null;
            var latlngs = drawing.latlngs;
            map.removeLayer(drawing.trace);
            try { container.releasePointerCapture(pointerId); } catch (_error) { /* Capture already released. */ }
            drawing = null;
            return latlngs;
        }

        function onKeyDown(event) {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            if (drawing) stopDrawing(drawing.pointerId);
            setArmed(false);
        }

        function onPointerDown(event) {
            if (!armed || drawing || event.button > 0) return;
            if (event.target.closest && event.target.closest('.leaflet-control')) return;
            event.preventDefault();
            event.stopPropagation();
            var point = map.mouseEventToContainerPoint(event);
            drawing = {
                pointerId: event.pointerId,
                last: point,
                latlngs: [map.containerPointToLatLng(point)],
                trace: L.polyline([], LASSO_TRACE_STYLE).addTo(map)
            };
            try { container.setPointerCapture(event.pointerId); } catch (_error) { /* Drawing still follows the map container. */ }
        }

        function onPointerMove(event) {
            if (!drawing || event.pointerId !== drawing.pointerId) return;
            event.preventDefault();
            var point = map.mouseEventToContainerPoint(event);
            if (point.distanceTo(drawing.last) < 4) return;
            drawing.last = point;
            drawing.latlngs.push(map.containerPointToLatLng(point));
            drawing.trace.setLatLngs(drawing.latlngs);
        }

        function onPointerUp(event) {
            if (!drawing || event.pointerId !== drawing.pointerId) return;
            var latlngs = stopDrawing(event.pointerId);
            // A click or a scribble too small to enclose anything keeps the tool armed.
            if (event.type === 'pointercancel' || latlngs.length < 3) return;
            setArmed(false);
            select(latlngs);
        }

        function removeShape() {
            if (shape) map.removeLayer(shape);
            shape = null;
        }

        function select(latlngs) {
            removeShape();
            ring = latlngs.map(function (latlng) { return [latlng.lng, mercatorY(latlng.lat)]; });
            box = ring.reduce(function (extent, point) {
                return {
                    west: Math.min(extent.west, point[0]),
                    east: Math.max(extent.east, point[0]),
                    south: Math.min(extent.south, point[1]),
                    north: Math.max(extent.north, point[1])
                };
            }, { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity });
            shape = L.polygon(latlngs, LASSO_SHAPE_STYLE).addTo(map);
            clearButton.hidden = false;
            notify();
        }

        function clear(silent) {
            if (!ring) return;
            removeShape();
            ring = null;
            box = null;
            clearButton.hidden = true;
            if (silent !== true) notify();
            else syncLinked();
        }

        function contains(lat, lng) {
            if (!ring) return true;
            lat = Number(lat);
            lng = Number(lng);
            if (!isFinite(lat) || !isFinite(lng)) return false;
            // Records use -180..180; the shape may lie on a wrapped world copy.
            lng += Math.ceil((box.west - lng) / 360) * 360;
            if (lng > box.east) return false;
            var y = mercatorY(lat);
            if (y < box.south || y > box.north) return false;
            var inside = false;
            for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
                if ((yi > y) !== (yj > y) && lng < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
            }
            return inside;
        }

        function filter(records, getLatLng) {
            if (!ring || !Array.isArray(records)) return records;
            return records.filter(function (record) {
                var latlng = getLatLng(record);
                return Boolean(latlng) && contains(latlng[0], latlng[1]);
            });
        }

        var LassoControl = L.Control.extend({
            options: { position: options.position || 'topleft' },
            onAdd: function () {
                var bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control lasso-control');
                button = L.DomUtil.create('button', 'lasso-btn', bar);
                button.type = 'button';
                button.title = label;
                button.setAttribute('aria-label', label);
                button.setAttribute('aria-pressed', 'false');
                button.innerHTML = LASSO_ICON;
                clearButton = L.DomUtil.create('button', 'lasso-btn lasso-clear-btn', bar);
                clearButton.type = 'button';
                clearButton.title = clearLabel;
                clearButton.setAttribute('aria-label', clearLabel);
                clearButton.innerHTML = LASSO_CLEAR_ICON;
                clearButton.hidden = true;
                L.DomEvent.disableClickPropagation(bar);
                L.DomEvent.disableScrollPropagation(bar);
                button.addEventListener('click', function (event) {
                    event.preventDefault();
                    setArmed(!armed);
                });
                clearButton.addEventListener('click', function (event) {
                    event.preventDefault();
                    clear();
                });
                return bar;
            }
        });

        // Capture phase, so Leaflet's own pointer handlers never see a lasso stroke.
        container.addEventListener('pointerdown', onPointerDown, true);
        container.addEventListener('pointermove', onPointerMove, true);
        container.addEventListener('pointerup', onPointerUp, true);
        container.addEventListener('pointercancel', onPointerUp, true);

        api = {
            control: new LassoControl(),
            contains: contains,
            filter: filter,
            clear: clear,
            attach: attach,
            isActive: function () { return Boolean(ring); }
        };
        map.addControl(api.control);
        return api;
    }

    function addMapReadout(map, container) {
        var right = document.createElement('div');
        right.className = 'status-bar-right';

        var coords = document.createElement('div');
        coords.className = 'status-coords';
        coords.setAttribute('aria-live', 'polite');

        var latPair = document.createElement('span');
        latPair.className = 'coord-pair';
        var latLabel = document.createElement('span');
        latLabel.className = 'coord-label';
        latLabel.textContent = 'Lat';
        var latValue = document.createElement('span');
        latValue.className = 'coord-value';
        latValue.textContent = '—';
        latPair.append(latLabel, latValue);

        var lngPair = document.createElement('span');
        lngPair.className = 'coord-pair';
        var lngLabel = document.createElement('span');
        lngLabel.className = 'coord-label';
        lngLabel.textContent = 'Lng';
        var lngValue = document.createElement('span');
        lngValue.className = 'coord-value';
        lngValue.textContent = '—';
        lngPair.append(lngLabel, lngValue);
        coords.append(latPair, lngPair);

        var scale = document.createElement('div');
        scale.className = 'status-scale';
        right.append(coords, scale);
        container.appendChild(right);

        function formatCoordinate(value) {
            return (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(4) + '°';
        }

        function clearCoordinates() {
            latValue.textContent = '—';
            lngValue.textContent = '—';
        }

        function niceDenominator(raw) {
            if (!isFinite(raw) || raw <= 0) return 1;
            var exponent = Math.floor(Math.log10(raw));
            var base = Math.pow(10, exponent);
            var normalized = raw / base;
            var steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10];
            var pick = steps[0];
            for (var index = 0; index < steps.length - 1; index += 1) {
                var midpoint = Math.sqrt(steps[index] * steps[index + 1]);
                if (normalized >= midpoint) pick = steps[index + 1];
                else break;
            }
            return Math.round(pick * base);
        }

        function updateScale() {
            var size = map.getSize();
            var samplePx = 200;
            var meters = map.distance(
                map.containerPointToLatLng([0, size.y / 2]),
                map.containerPointToLatLng([samplePx, size.y / 2])
            );
            if (!meters || !isFinite(meters)) return;

            var metersPerPx = meters / samplePx;
            var screenMmPerPx = 25.4 / 96;
            var denominator = niceDenominator((metersPerPx * 1000) / screenMmPerPx);

            scale.replaceChildren();
            var fraction = document.createElement('span');
            fraction.className = 'carto-scale-fraction';
            var one = document.createElement('span');
            one.className = 'carto-scale-numer';
            one.textContent = '1';
            var colon = document.createElement('span');
            colon.className = 'carto-scale-colon';
            colon.textContent = ':';
            colon.setAttribute('aria-hidden', 'true');
            var denominatorElement = document.createElement('span');
            denominatorElement.className = 'carto-scale-denom';
            denominatorElement.textContent = denominator.toLocaleString('en-US');
            fraction.append(one, colon, denominatorElement);
            scale.appendChild(fraction);
        }

        map.on('mousemove', function (event) {
            latValue.textContent = formatCoordinate(event.latlng.lat);
            lngValue.textContent = formatCoordinate(event.latlng.lng);
        });
        map.on('mouseout', clearCoordinates);
        map.on('zoom zoomend moveend resize', updateScale);
        updateScale();

        return {
            element: right,
            updateScale: updateScale,
            clearCoordinates: clearCoordinates
        };
    }

    function addCategoryLegend(map, options) {
        options = options || {};
        var categories = Array.isArray(options.categories) ? options.categories.slice(0, 3) : [];
        var classify = typeof options.classify === 'function' ? options.classify : function () { return null; };
        var mapContainer = map.getContainer();
        var outer = mapContainer.parentNode || mapContainer;
        var status = document.createElement('div');
        status.className = 'map-status-bar';

        var left = document.createElement('div');
        left.className = 'status-bar-left-col';
        var legend = document.createElement('div');
        legend.className = 'status-bar-legend';
        legend.setAttribute('role', 'group');
        legend.setAttribute('aria-label', options.ariaLabel || options.title || 'Map legend');

        if (options.title || options.subtitle) {
            var title = document.createElement('div');
            title.className = 'legend-title';
            if (options.title) {
                var main = document.createElement('span');
                main.className = 'legend-title-main';
                main.textContent = options.title;
                title.appendChild(main);
            }
            if (options.subtitle) {
                var sub = document.createElement('span');
                sub.className = 'legend-title-sub';
                sub.textContent = options.subtitle;
                title.appendChild(sub);
            }
            legend.appendChild(title);
        }

        var countElements = Object.create(null);
        categories.forEach(function (category) {
            var row = document.createElement('div');
            row.className = 'legend-row';

            var dot = document.createElement('span');
            dot.className = 'legend-dot';
            dot.style.background = category.color;
            dot.style.borderColor = category.border || '#ffffff';
            dot.setAttribute('aria-hidden', 'true');

            var label = document.createElement('span');
            label.className = 'legend-text';
            label.textContent = category.label;

            var count = document.createElement('span');
            count.className = 'legend-count';
            count.textContent = '0';
            countElements[category.key] = count;

            row.append(dot, label, count);
            legend.appendChild(row);
        });

        left.appendChild(legend);
        status.appendChild(left);
        outer.appendChild(status);
        var readout = addMapReadout(map, status);

        return {
            element: status,
            readout: readout,
            update: function (records) {
                var counts = Object.create(null);
                categories.forEach(function (category) { counts[category.key] = 0; });
                (Array.isArray(records) ? records : []).forEach(function (record) {
                    var result = classify(record);
                    var key = result && typeof result === 'object' ? result.key : result;
                    if (Object.prototype.hasOwnProperty.call(counts, key)) {
                        counts[key] += typeof options.getRecordWeight === 'function' ? options.getRecordWeight(record) : 1;
                    }
                });
                categories.forEach(function (category) {
                    countElements[category.key].textContent = counts[category.key].toLocaleString('en-US');
                });
            }
        };
    }

    window.NkuaWebGISMap = {
        addPreviewBasemap: addPreviewBasemap,
        DEFAULT_BASEMAP: DEFAULT_BASEMAP,
        createBasemaps: createBasemaps,
        addDefault: addDefault,
        addBasemapPicker: addBasemapPicker,
        addNorthArrow: addNorthArrow,
        createCategoryMarkerIcon: createCategoryMarkerIcon,
        createCategoryClusterIcon: createCategoryClusterIcon,
        formatPinCount: formatPinCount,
        addLassoSelection: addLassoSelection,
        addMapReadout: addMapReadout,
        addCategoryLegend: addCategoryLegend
    };
}());
