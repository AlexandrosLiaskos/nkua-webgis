/* Cyprus irrigation consumption WebGIS — NKUA.
 * Static site. Every map layer is a value grid (Web Mercator PNG with a 16-bit code in R+G, see 10_webgis.py) that
 * is decoded and drawn here with the viewer's legend settings, so several layers can be on at once, each with its
 * own classification, colours, hidden classes and transparency. Per-pixel records load in chunks on click.
 * Shared look and controls come from /webgis-shared/. */
(function () {
    'use strict';

    var NODATA = 65535;
    var state = {
        meta: null, map: null, items: {}, order: [], cfg: {}, overlays: {}, grids: {}, decoded: {}, cells: {}, ztop: 100,
        period: -1, relief: null, districts: null, styleKey: null
    };
    if (location.hostname === 'localhost') window.ciState = state;   // local inspection only
    var $ = function (id) { return document.getElementById(id); };
    var fmt = function (v, d) { return Number(v).toLocaleString('el-GR', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); };
    var hyLabel = function (y) { return String(y - 1).slice(2) + '/' + String(y).slice(2); };
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var plain = function (html) { var d = document.createElement('div'); d.innerHTML = html; return d.textContent; };

    /* ---------------- modals, tabs, mobile ---------------- */
    function openModal(el) { el.classList.add('active'); document.body.classList.add('modal-open'); }
    function closeModal(el) { el.classList.remove('active'); document.body.classList.remove('modal-open'); }
    function closeWelcome() {
        var modal = $('welcome-modal');
        if (window.NkuaWebGISUI && window.NkuaWebGISUI.revealWelcomeModal) {
            window.NkuaWebGISUI.revealWelcomeModal(modal, function () { closeModal(modal); });
        } else {
            closeModal(modal);
        }
    }
    function setupChrome() {
        var welcome = $('welcome-modal');
        if (new URLSearchParams(location.search).get('embed') !== '1') {
            setTimeout(function () { openModal(welcome); }, 300);
        }
        $('close-welcome').addEventListener('click', closeWelcome);
        welcome.addEventListener('click', function (e) { if (e.target === welcome) closeWelcome(); });
        $('about-btn').addEventListener('click', function () { openModal(welcome); });
        [['references-modal', 'references-btn', 'close-references'], ['ci-style-modal', null, 'close-style']].forEach(function (m) {
            var el = $(m[0]);
            if (m[1]) $(m[1]).addEventListener('click', function () { openModal(el); });
            $(m[2]).addEventListener('click', function () { closeModal(el); });
            el.addEventListener('click', function (e) { if (e.target === el) closeModal(el); });
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (welcome.classList.contains('active')) closeWelcome();
            ['references-modal', 'ci-style-modal'].forEach(function (id) { if ($(id).classList.contains('active')) closeModal($(id)); });
        });

        function switchTab(tab) {
            document.querySelectorAll('.tab-button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
            document.querySelectorAll('.sidebar .tab-content').forEach(function (c) { c.classList.toggle('active', c.id === tab + '-tab'); });
            document.querySelectorAll('.mobile-toggle-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
        }
        document.querySelectorAll('.tab-button').forEach(function (b) {
            b.addEventListener('click', function () { switchTab(b.dataset.tab); });
        });
        var sidebar = $('sidebar');
        document.querySelectorAll('.mobile-toggle-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                var open = sidebar.classList.contains('active') && b.classList.contains('active');
                if (open) { sidebar.classList.remove('active'); b.classList.remove('active'); return; }
                switchTab(b.dataset.tab);
                sidebar.classList.add('active');
            });
        });
        $('mobile-sidebar-close').addEventListener('click', function () {
            sidebar.classList.remove('active');
            document.querySelectorAll('.mobile-toggle-btn').forEach(function (b) { b.classList.remove('active'); });
        });
    }

    /* ---------------- colour ramps and classification ---------------- */
    function hexRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
    function rgbHex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
    function rampColors(name, n, reverse) {
        var stops = state.meta.ramps[name].map(hexRgb), out = [];
        for (var i = 0; i < n; i++) {
            var t = n === 1 ? 1 : i / (n - 1), x = t * (stops.length - 1), k = Math.min(Math.floor(x), stops.length - 2), f = x - k;
            out.push(rgbHex(stops[k].map(function (v, j) { return v + (stops[k + 1][j] - v) * f; })));
        }
        return reverse ? out.reverse() : out;
    }
    var RAMP_LABELS = { etblue: 'ET μπλε (αφίσα)', prob: 'Πιθανότητα', terrain: 'Ανάγλυφο' };
    var METHODS = [['preset', 'Προκαθορισμένα όρια'], ['quantile', 'Ποσοστημόρια'], ['equal', 'Ίσα διαστήματα'],
        ['jenks', 'Φυσικές διακοπές (Jenks)'], ['custom', 'Προσαρμοσμένα όρια']];

    function niceRound(v, d) { var p = Math.pow(10, d); return Math.round(v * p) / p; }
    function sampleValues(item, g) {
        var vals = [], step = Math.max(1, Math.floor(g.n / 20000));
        for (var i = 0; i < g.codes.length; i += step) {
            var c = g.codes[i];
            if (c !== NODATA) vals.push(c * item.scale + item.offset);
        }
        return vals.sort(function (a, b) { return a - b; });
    }
    function jenks(data, k) {
        var n = data.length, lower = [], variance = [], i, j, m;
        for (i = 0; i <= n; i++) { lower.push(new Array(k + 1).fill(0)); variance.push(new Array(k + 1).fill(Infinity)); }
        for (j = 1; j <= k; j++) { lower[1][j] = 1; variance[1][j] = 0; }
        for (i = 2; i <= n; i++) {
            var s1 = 0, s2 = 0, w = 0, v = 0;
            for (m = 1; m <= i; m++) {
                var lo = i - m + 1, val = data[lo - 1];
                s2 += val * val; s1 += val; w++;
                v = s2 - (s1 * s1) / w;
                if (lo > 1) for (j = 2; j <= k; j++) {
                    if (variance[i][j] >= v + variance[lo - 1][j - 1]) { lower[i][j] = lo; variance[i][j] = v + variance[lo - 1][j - 1]; }
                }
            }
            lower[i][1] = 1; variance[i][1] = v;
        }
        var b = [], kk = n;
        for (j = k; j >= 2; j--) { kk = lower[kk][j] - 1; b.unshift(data[kk]); }
        return [data[0]].concat(b);
    }
    /* lower bounds of the classes for the layer's current settings and period */
    function computeBreaks(key, g) {
        var it = state.items[key], cf = state.cfg[key];
        if (cf.method === 'preset') return it.breaks.slice();
        if (cf.method === 'custom') return cf.breaks.slice();
        var v = sampleValues(it, g), n = cf.classes, d = it.decimals || 0, b = [];
        if (!v.length) return it.breaks.slice();
        if (cf.method === 'quantile') {
            for (var i = 0; i < n; i++) b.push(v[Math.floor(i / n * (v.length - 1))]);
        } else if (cf.method === 'equal') {
            for (var j = 0; j < n; j++) b.push(v[0] + (v[v.length - 1] - v[0]) * j / n);
        } else {
            var s = [], st = Math.max(1, Math.floor(v.length / 800));
            for (var q = 0; q < v.length; q += st) s.push(v[q]);
            b = jenks(s, Math.min(n, s.length));
        }
        b = b.map(function (x) { return niceRound(x, d); });
        return b.filter(function (x, i) { return i === 0 || x > b[i - 1]; });
    }
    function classLabel(b, i, d) {
        return i < b.length - 1 ? fmt(b[i], d) + '–' + fmt(b[i + 1], d) : '≥ ' + fmt(b[i], d);
    }

    /* ---------------- grids ---------------- */
    function gridUrl(item) {
        var yr = state.period >= 0 && item.year ? state.meta.years[state.period] : null;
        return './' + (yr ? item.year.replace('{year}', yr) : item.mean);
    }
    function geoOf(item) { return item.geo || state.meta.geo; }
    function loadGrid(url) {
        if (state.grids[url]) return state.grids[url];
        state.grids[url] = fetch(url).then(function (r) { return r.blob(); })
            .then(function (b) { return createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); })
            .then(function (bmp) {
                var cv = document.createElement('canvas');
                cv.width = bmp.width; cv.height = bmp.height;
                var ctx = cv.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(bmp, 0, 0);
                var px = ctx.getImageData(0, 0, bmp.width, bmp.height).data, n = bmp.width * bmp.height;
                var codes = new Uint16Array(n), valid = 0;
                for (var i = 0; i < n; i++) { codes[i] = (px[i * 4] << 8) | px[i * 4 + 1]; if (codes[i] !== NODATA) valid++; }
                state.decoded[url] = { codes: codes, w: bmp.width, h: bmp.height, n: valid };
                return state.decoded[url];
            });
        return state.grids[url];
    }
    function boundsOf(geo) {
        var crs = L.CRS.EPSG3857;
        return L.latLngBounds(crs.unproject(L.point(geo.x0, geo.y0)), crs.unproject(L.point(geo.x0 + geo.w * geo.dx, geo.y0 - geo.h * geo.dy)));
    }
    /* class palette and code → class lookup for the layer's settings */
    function styleOf(key, g) {
        var it = state.items[key], cf = state.cfg[key], lut = new Uint8Array(65536).fill(255), cols, labels, i;
        if (it.kind === 'cont') {
            var b = computeBreaks(key, g);
            cf.current = b;
            if (!cf.colors || cf.colors.length !== b.length) cf.colors = rampColors(cf.ramp, b.length, cf.reverse);
            cols = cf.colors;
            labels = b.map(function (_, k) { return classLabel(b, k, it.decimals || 0); });
            for (var c = 0; c < NODATA; c++) {
                var v = c * it.scale + it.offset;
                if (v < b[0]) continue;
                for (i = b.length - 1; i > 0 && v < b[i]; i--);
                if (!cf.hidden[i]) lut[c] = i;
            }
        } else {
            cols = cf.colors;
            labels = it.classes.map(function (k) { return k.label; });
            it.classes.forEach(function (k, j) {
                if (!cf.hidden[j]) lut[Math.round((k.code - it.offset) / it.scale)] = j;
            });
        }
        return { lut: lut, colors: cols.map(hexRgb), hex: cols, labels: labels };
    }
    function render(key) {
        var it = state.items[key], cf = state.cfg[key], url = gridUrl(it), token = (cf.token || 0) + 1;
        cf.token = token;
        return loadGrid(url).then(function (g) {
            if (cf.token !== token || !cf.on) return;
            var st = styleOf(key, g), cv = document.createElement('canvas');
            cv.width = g.w; cv.height = g.h;
            var ctx = cv.getContext('2d'), img = ctx.createImageData(g.w, g.h), d = img.data;
            for (var i = 0; i < g.codes.length; i++) {
                var k = st.lut[g.codes[i]];
                if (k === 255) continue;
                var c = st.colors[k], p = i * 4;
                d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
            }
            ctx.putImageData(img, 0, 0);
            cv.toBlob(function (blob) {
                if (cf.token !== token || !cf.on) return;
                var u = URL.createObjectURL(blob), ov = state.overlays[key];
                if (ov) {
                    var old = ov._url;
                    ov.setUrl(u);
                    if (old && old.indexOf('blob:') === 0) setTimeout(function () { URL.revokeObjectURL(old); }, 2000);
                } else {
                    state.overlays[key] = L.imageOverlay(u, boundsOf(geoOf(it)), {
                        opacity: 1 - cf.transparency, className: 'ci-raster', interactive: false, zIndex: cf.z
                    }).addTo(state.map);
                }
                hideLoading();
            });
            renderLegend();
            if (state.styleKey === key) renderStyleDialog();
        });
    }
    function hideLoading() { var l = $('loading'); if (l) { l.classList.add('hidden'); l.style.display = 'none'; } }

    /* ---------------- layer catalogue (data/meta.json → sidebar) ---------------- */
    function defaults(it, z) {
        var cf = { on: !!it.on, transparency: it.transparency !== undefined ? it.transparency : 0.15, z: z, hidden: {} };
        if (it.kind === 'cont') {
            cf.method = 'preset'; cf.classes = it.breaks.length; cf.ramp = it.ramp; cf.reverse = false;
            cf.breaks = it.breaks.slice(); cf.colors = null;
        } else {
            cf.colors = it.classes.map(function (k) { return k.color; });
        }
        return cf;
    }
    function layerRow(it) {
        return '<div class="ci-layer" data-layer="' + it.key + '">' +
            '<label class="ci-layer-row"><input type="checkbox" class="ci-layer-check"><span class="ci-layer-name">' + it.name + '</span>' +
            '<span class="ci-layer-meta">' + it.unit + (it.year ? ' · ' + state.meta.years.length + ' έτη' : '') + '</span></label>' +
            '<div class="ci-layer-options" hidden>' +
            '<div class="ci-opt ci-opt-inline"><span class="ci-opt-label">Διαφάνεια</span>' +
            '<input type="range" class="ci-transp" min="0" max="0.95" step="0.05" aria-label="Διαφάνεια επιπέδου">' +
            '<output class="ci-opt-value"></output></div>' +
            '<button type="button" class="ci-style-open">Ρυθμίσεις υπομνήματος</button></div></div>';
    }
    function renderCatalog(meta) {
        var groups = meta.catalog, n = 0;
        groups.forEach(function (g) { n += g.items.length; });
        var z = n + 10;
        groups.forEach(function (g) {
            g.items.forEach(function (it) {
                state.items[it.key] = it;
                state.order.push(it.key);
                state.cfg[it.key] = defaults(it, g.id === 'context' ? 1 : z--);
            });
            var html = g.items.map(layerRow).join('');
            if (g.id === 'main') {
                $('layers-main').innerHTML = html;
            } else if (g.id === 'context') {
                $('layers-context').insertAdjacentHTML('afterbegin', html);
            } else {
                $('layers-secondary').insertAdjacentHTML('beforeend',
                    '<details class="ci-group" data-group="' + g.id + '"><summary><span>' + g.title + '</span>' +
                    '<span class="ci-group-count">' + g.items.length + '</span></summary>' +
                    '<div class="ci-layers ci-layers-sub">' + html + '</div></details>');
            }
        });
        document.querySelectorAll('.ci-layer').forEach(function (el) {
            var key = el.dataset.layer, cf = state.cfg[key];
            var chk = el.querySelector('.ci-layer-check'), tr = el.querySelector('.ci-transp');
            chk.checked = cf.on;
            tr.value = cf.transparency;
            el.querySelector('output').textContent = Math.round(cf.transparency * 100) + '%';
            chk.addEventListener('change', function () { setLayer(key, chk.checked); });
            tr.addEventListener('input', function () { setTransparency(key, +tr.value); });
            el.querySelector('.ci-style-open').addEventListener('click', function () { openStyle(key); });
        });
        syncRows();
    }
    function syncRows() {
        document.querySelectorAll('.ci-layer').forEach(function (el) {
            var cf = state.cfg[el.dataset.layer];
            el.classList.toggle('is-active', cf.on);
            el.querySelector('.ci-layer-check').checked = cf.on;
            el.querySelector('.ci-layer-options').hidden = !cf.on;
            el.querySelector('.ci-transp').value = cf.transparency;
            el.querySelector('output').textContent = Math.round(cf.transparency * 100) + '%';
            if (cf.on) { var grp = el.closest('details'); if (grp) grp.open = true; }
        });
    }
    function setLayer(key, on) {
        var cf = state.cfg[key];
        cf.on = on;
        if (on) {
            if (cf.z > 1) {                                   // the layer switched on last is drawn on top
                cf.z = ++state.ztop;
                if (state.overlays[key]) state.overlays[key].setZIndex(cf.z);
            }
            render(key);
        } else {
            cf.token = (cf.token || 0) + 1;
            if (state.overlays[key]) { state.map.removeLayer(state.overlays[key]); delete state.overlays[key]; }
            renderLegend();
        }
        syncRows();
    }
    function setTransparency(key, t) {
        state.cfg[key].transparency = t;
        if (state.overlays[key]) state.overlays[key].setOpacity(1 - t);
        syncRows();
        if (state.styleKey === key) { var s = $('ci-style-transp'); if (s) { s.value = t; $('ci-style-transp-v').textContent = Math.round(t * 100) + '%'; } }
    }
    function activeKeys() {
        return state.order.filter(function (k) { return state.cfg[k].on; })
            .sort(function (a, b) { return state.cfg[b].z - state.cfg[a].z; });
    }

    /* ---------------- period (mean or one hydrological year) ---------------- */
    function renderPeriod(meta) {
        $('year-grid').innerHTML = '<button type="button" class="ci-year-chip ci-year-mean" role="radio" data-idx="-1">Μ.Ο. ' +
            hyLabel(meta.years[0]) + '–' + hyLabel(meta.years[meta.years.length - 1]) + '</button>' +
            meta.years.map(function (y, i) {
                return '<button type="button" class="ci-year-chip" role="radio" data-idx="' + i + '" title="Υδρολογικό έτος ' +
                    hyLabel(y) + ' (Οκτ–Σεπ)">' + hyLabel(y) + '</button>';
            }).join('');
        document.querySelectorAll('.ci-year-chip').forEach(function (b) {
            b.addEventListener('click', function () { setPeriod(+b.dataset.idx); });
        });
        syncPeriod();
    }
    function syncPeriod() {
        document.querySelectorAll('.ci-year-chip').forEach(function (b) {
            var on = +b.dataset.idx === state.period;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
    }
    function setPeriod(i) {
        state.period = i;
        syncPeriod();
        activeKeys().forEach(function (k) { if (state.items[k].year) render(k); });
        renderLegend();
        if (state.map) state.map.closePopup();
    }
    function periodLabel(it) {
        if (state.period >= 0 && it.year) return hyLabel(state.meta.years[state.period]);
        return 'μ.ο. ' + hyLabel(state.meta.years[0]) + '–' + hyLabel(state.meta.years[state.meta.years.length - 1]);
    }

    /* ---------------- map ---------------- */
    function setupMap() {
        var map = L.map('map', { maxZoom: 15, minZoom: 7, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 80 });
        var island = [[34.55, 32.25], [35.72, 34.62]];
        map.setView([35.15, 33.4], 8);
        // fit the island while the page settles and on window resizes, until the viewer moves the map (later
        // container changes, e.g. a sidebar scrollbar, only resize the map)
        var touched = false, el = map.getContainer(), settle = Date.now() + 2500;
        ['mousedown', 'wheel', 'touchstart', 'keydown'].forEach(function (ev) { el.addEventListener(ev, function () { touched = true; }, { passive: true }); });
        var fit = function (force) {
            map.invalidateSize();
            if (force !== true && Date.now() > settle) return;
            var s = map.getSize();
            var bar = document.querySelector('.map-status-bar');
            var below = bar && getComputedStyle(bar).position === 'absolute' ? bar.getBoundingClientRect().height : 0;
            // keep the island clear of the legend and readout that overlay the bottom of the map
            if (!touched && s.x > 80 && s.y > below + 160) map.fitBounds(island, { paddingTopLeft: [10, 10], paddingBottomRight: [10, below + 10], animate: false });
        };
        if (window.ResizeObserver) new ResizeObserver(fit).observe(el);
        requestAnimationFrame(fit);
        window.addEventListener('load', fit);
        window.addEventListener('resize', function () { fit(true); });
        var bases = window.NkuaWebGISMap.createBasemaps();
        var current = window.NkuaWebGISMap.addDefault(map, bases);
        state.bases = bases;
        state.basemap = current;
        var gl = bases[window.NkuaWebGISMap.DEFAULT_BASEMAP];
        if (gl) gl.on('add', function () { applyPlaceLabels(); });
        applyPlaceLabels();
        window.NkuaWebGISMap.addBasemapPicker(map, bases, {
            defaultName: current, label: 'Επιλογή υποβάθρου',
            onChange: function (name) { state.basemap = name; syncLabelsControl(); applyPlaceLabels(); }
        });
        window.NkuaWebGISMap.addNorthArrow(map, { title: 'Βορράς' });
        addStatusBar(map);

        // relief: hillshade multiplied over basemap and data, so terrain reads through the classes
        var pane = map.createPane('ci-relief');
        pane.style.zIndex = 450; pane.style.mixBlendMode = 'multiply'; pane.style.pointerEvents = 'none';
        state.relief = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
            pane: 'ci-relief', maxNativeZoom: 15, opacity: 0.4, attribution: 'Σκίαση αναγλύφου: Esri, USGS, NGA, NASA, CGIAR'
        });
        if ($('relief-toggle').checked) state.relief.addTo(map);

        fetch('./data/districts.geojson').then(function (r) { return r.json(); }).then(function (gj) {
            state.districts = L.geoJSON(gj, { interactive: false, style: { color: '#222', weight: 1, opacity: 0.7, fill: false } });
            if ($('districts-toggle').checked) state.districts.addTo(map);
        });
        map.on('click', onMapClick);
        state.map = map;
    }

    /* vector basemap: place names follow the «Τοπωνύμια» toggle; its administrative boundaries (dotted, also
       offshore) are not part of this map and stay hidden. Re-applied on every style change of the GL map. */
    function styleBasemap(glMap) {
        var style;
        try { style = glMap.getStyle(); } catch (e) { return; }   // style JSON not parsed yet (tiles may still load)
        var show = $('labels-toggle').checked;
        ((style && style.layers) || []).forEach(function (l) {
            var want = l.type === 'symbol' ? (show ? 'visible' : 'none') : (l['source-layer'] === 'boundary' ? 'none' : null);
            try {
                if (want && (glMap.getLayoutProperty(l.id, 'visibility') || 'visible') !== want) glMap.setLayoutProperty(l.id, 'visibility', want);
            } catch (e) { /* layer not ready; the next styledata event retries */ }
        });
    }
    function applyPlaceLabels(tries) {
        var gl = state.bases && state.bases[window.NkuaWebGISMap.DEFAULT_BASEMAP];
        var glMap = gl && gl.getMaplibreMap && gl.getMaplibreMap();
        if (!glMap) {                                    // the GL map is created asynchronously when the layer is added
            tries = typeof tries === 'number' ? tries : 0;
            if (state.basemap === window.NkuaWebGISMap.DEFAULT_BASEMAP && tries < 50) setTimeout(function () { applyPlaceLabels(tries + 1); }, 200);
            return;
        }
        if (!glMap.ciStyled) {
            glMap.ciStyled = true;
            glMap.on('styledata', function () { styleBasemap(glMap); });
            glMap.on('load', function () { styleBasemap(glMap); });
        }
        styleBasemap(glMap);
    }
    function syncLabelsControl() {
        var vector = state.basemap === window.NkuaWebGISMap.DEFAULT_BASEMAP;
        $('labels-toggle').disabled = !vector;
        $('labels-item').classList.toggle('is-disabled', !vector);
        $('labels-item').title = vector ? '' : 'Στο επιλεγμένο υπόβαθρο τα τοπωνύμια είναι μέρος της εικόνας';
    }

    /* house map status bar: legend card (left), Lat/Lng and 1:N readout (right) plus a graphic scale bar */
    function addStatusBar(map) {
        var status = document.createElement('div');
        status.className = 'map-status-bar';
        var left = document.createElement('div');
        left.className = 'status-bar-left-col';
        var legend = document.createElement('div');
        legend.className = 'status-bar-legend ci-map-legend';
        legend.id = 'ci-legend';
        legend.setAttribute('role', 'group');
        legend.setAttribute('aria-label', 'Υπόμνημα χάρτη');
        left.appendChild(legend);
        status.appendChild(left);
        map.getContainer().parentNode.appendChild(status);
        var readout = window.NkuaWebGISMap.addMapReadout(map, status);
        var bar = document.createElement('div');
        bar.className = 'ci-scalebar';
        bar.setAttribute('aria-label', 'Γραφική κλίμακα');
        readout.element.insertBefore(bar, readout.element.firstChild);
        function updateBar() {
            var y = map.getSize().y / 2;
            var mpp = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([100, y])) / 100;
            if (!mpp || !isFinite(mpp)) return;
            var maxM = mpp * 96, pow = Math.pow(10, Math.floor(Math.log10(maxM))), nice = pow;
            [1, 2, 5, 10].forEach(function (f) { if (f * pow <= maxM) nice = f * pow; });
            var label = nice >= 1000 ? (nice / 1000) + ' km' : nice + ' m';
            bar.innerHTML = '<span class="ci-scalebar-track" style="width:' + (nice / mpp).toFixed(0) + 'px"><i></i><i></i></span>' +
                '<span class="ci-scalebar-label">' + label + '</span>';
        }
        map.on('zoomend moveend resize', updateBar);
        updateBar();
    }

    /* ---------------- legend: one block per visible layer, top layer first ---------------- */
    var GEAR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>';
    function legendBlock(key) {
        var it = state.items[key], cf = state.cfg[key], g = state.decoded[gridUrl(it)];
        var html = '<section class="ci-lg" data-layer="' + key + '"><header class="ci-lg-head"><span class="ci-lg-title">' + it.name +
            '<span class="ci-lg-period">' + (it.kind === 'cont' || it.year ? periodLabel(it) : '') + '</span></span>' +
            '<span class="ci-lg-unit">' + it.unit + '</span>' +
            '<button type="button" class="ci-lg-btn" data-act="style" title="Ρυθμίσεις υπομνήματος" aria-label="Ρυθμίσεις υπομνήματος: ' + esc(plain(it.name)) + '">' + GEAR + '</button></header>';
        var hid = function (i) { return cf.hidden[i] ? ' is-hidden' : ''; };
        if (it.kind === 'cont') {
            var b = cf.current || it.breaks, cols = cf.colors || rampColors(cf.ramp, b.length, cf.reverse);
            html += '<div class="ci-ramp" role="group" aria-label="Κλάσεις">' + b.map(function (_, i) {
                return '<button type="button" class="ci-ramp-seg' + hid(i) + '" data-cls="' + i + '" style="background:' + cols[i] +
                    '" title="' + classLabel(b, i, it.decimals || 0) + ' ' + plain(it.unit) + ' · κλικ για απόκρυψη/εμφάνιση" aria-pressed="' + !cf.hidden[i] + '"></button>';
            }).join('') + '</div><div class="ci-ramp-ticks">' + b.map(function (v, i) {
                return '<span>' + fmt(v, it.decimals || 0) + (i === b.length - 1 ? '+' : '') + '</span>';
            }).join('') + '</div>';
        } else if (it.kind === 'biv') {
            var cell = function (e, w) {
                var i = e * 3 + w;
                return '<button type="button" class="ci-biv-cell' + hid(i) + '" data-cls="' + i + '" style="background:' + cf.colors[i] +
                    '" title="' + esc(plain(it.classes[i].label)) + ' · κλικ για απόκρυψη/εμφάνιση" aria-pressed="' + !cf.hidden[i] + '"></button>';
            };
            html += '<div class="ci-biv"><div class="ci-biv-y">ET<sub>μπλε</sub> →</div><div class="ci-biv-grid">' +
                [2, 1, 0].map(function (e) { return [0, 1, 2].map(function (w) { return cell(e, w); }).join(''); }).join('') +
                '</div><div class="ci-biv-x">Παραγωγικότητα νερού →</div></div>' +
                [[6, 'Υψηλή κατανάλωση, χαμηλή παραγωγικότητα νερού'], [8, 'Υψηλή κατανάλωση, υψηλή παραγωγικότητα νερού']].map(function (r) {
                    return '<button type="button" class="ci-lg-row' + hid(r[0]) + '" data-cls="' + r[0] + '"><span class="ci-lg-dot" style="background:' + cf.colors[r[0]] + '"></span><span>' + r[1] + '</span></button>';
                }).join('');
        } else {
            html += it.classes.map(function (k, i) {
                return '<button type="button" class="ci-lg-row' + hid(i) + '" data-cls="' + i + '"><span class="ci-lg-dot" style="background:' + cf.colors[i] + '"></span><span>' + k.label + '</span></button>';
            }).join('');
        }
        if (it.source) html += '<div class="ci-legend-source">' + it.source + (g ? '' : ' · φόρτωση…') + '</div>';
        return html + '</section>';
    }
    function renderLegend() {
        var el = $('ci-legend');
        if (!el) return;
        var keys = activeKeys(), html = keys.map(legendBlock).join('');
        if (state.relief && state.map && state.map.hasLayer(state.relief)) {
            html += '<section class="ci-lg ci-lg-ref"><div class="ci-lg-row is-static"><span class="ci-lg-dot ci-lg-relief"></span><span>Σκίαση αναγλύφου</span></div></section>';
        }
        if (state.districts && state.map && state.map.hasLayer(state.districts)) {
            html += '<section class="ci-lg ci-lg-ref"><div class="ci-lg-row is-static"><span class="ci-lg-line"></span><span>Όρια επαρχιών</span></div></section>';
        }
        el.innerHTML = html || '<p class="ci-lg-empty">Κανένα ενεργό επίπεδο.</p>';
        el.querySelectorAll('.ci-lg[data-layer]').forEach(function (sec) {
            var key = sec.dataset.layer;
            sec.querySelector('[data-act=style]').addEventListener('click', function () { openStyle(key); });
            sec.querySelectorAll('[data-cls]').forEach(function (b) {
                b.addEventListener('click', function () { toggleClass(key, +b.dataset.cls); });
            });
        });
    }
    function toggleClass(key, i) {
        var cf = state.cfg[key];
        cf.hidden[i] = !cf.hidden[i];
        render(key);
    }

    /* ---------------- legend settings dialog ---------------- */
    function openStyle(key) {
        state.styleKey = key;
        var cf = state.cfg[key];
        if (!cf.on) setLayer(key, true);
        renderStyleDialog();
        openModal($('ci-style-modal'));
    }
    function histogram(key, g) {
        var it = state.items[key], v = sampleValues(it, g);
        if (!v.length) return '';
        var lo = v[Math.floor(v.length * 0.005)], hi = v[Math.floor(v.length * 0.995)], nb = 48, cnt = new Array(nb).fill(0);
        if (hi <= lo) hi = lo + 1;
        v.forEach(function (x) { var i = Math.floor((x - lo) / (hi - lo) * nb); if (i >= 0 && i < nb) cnt[i]++; });
        var max = Math.max.apply(null, cnt), W = 420, H = 90, bw = W / nb, b = state.cfg[key].current || [];
        var cols = state.cfg[key].colors || [];
        var colorAt = function (x) { var k = -1; b.forEach(function (bb, j) { if (x >= bb) k = j; }); return k >= 0 ? cols[k] : '#ddd'; };
        var bars = cnt.map(function (c, i) {
            var h = (H - 16) * c / max, x0 = lo + (hi - lo) * (i + 0.5) / nb;
            return '<rect x="' + (i * bw + 0.5) + '" y="' + (H - 14 - h) + '" width="' + (bw - 1) + '" height="' + h + '" fill="' + colorAt(x0) + '"></rect>';
        }).join('');
        var lines = b.filter(function (x) { return x > lo && x < hi; }).map(function (x) {
            var px = (x - lo) / (hi - lo) * W;
            return '<line x1="' + px + '" x2="' + px + '" y1="0" y2="' + (H - 14) + '" stroke="#111" stroke-dasharray="2 2"></line>';
        }).join('');
        return '<svg class="ci-hist" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Κατανομή τιμών">' + bars + lines +
            '<line x1="0" x2="' + W + '" y1="' + (H - 14) + '" y2="' + (H - 14) + '" stroke="#999"></line>' +
            '<text x="0" y="' + (H - 2) + '">' + fmt(lo, it.decimals || 0) + '</text><text x="' + W + '" y="' + (H - 2) + '" text-anchor="end">' + fmt(hi, it.decimals || 0) + '</text></svg>';
    }
    function renderStyleDialog() {
        var key = state.styleKey, it = state.items[key], cf = state.cfg[key], body = $('ci-style-body');
        if (!key || !body) return;
        $('ci-style-title').innerHTML = it.name;
        $('ci-style-sub').textContent = plain(it.unit) + ' · ' + periodLabel(it);
        var g = state.decoded[gridUrl(it)], html = '';
        if (it.kind === 'cont') {
            var b = cf.current || it.breaks;
            html += '<div class="ci-form-row"><label for="ci-st-method">Μέθοδος ταξινόμησης</label><select id="ci-st-method">' +
                METHODS.map(function (m) { return '<option value="' + m[0] + '"' + (cf.method === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></div>' +
                '<div class="ci-form-row"><label for="ci-st-n">Αριθμός κλάσεων</label><input id="ci-st-n" type="number" min="2" max="10" value="' + b.length + '"' +
                (cf.method === 'preset' || cf.method === 'custom' ? ' disabled' : '') + '></div>' +
                '<div class="ci-form-row"><label for="ci-st-breaks">Κατώτατα όρια κλάσεων</label><input id="ci-st-breaks" type="text" inputmode="decimal" value="' +
                b.map(function (x) { return String(x); }).join('; ') + '"><small>Τιμές κάτω από το πρώτο όριο δεν εμφανίζονται. Η τελευταία κλάση περιλαμβάνει όλες τις μεγαλύτερες τιμές.</small></div>' +
                '<div class="ci-form-row"><label for="ci-st-ramp">Χρωματική κλίμακα</label><div class="ci-form-inline"><select id="ci-st-ramp">' +
                Object.keys(state.meta.ramps).map(function (r) { return '<option value="' + r + '"' + (cf.ramp === r ? ' selected' : '') + '>' + (RAMP_LABELS[r] || r) + '</option>'; }).join('') +
                '</select><label class="ci-check"><input id="ci-st-rev" type="checkbox"' + (cf.reverse ? ' checked' : '') + '> Αντιστροφή</label></div></div>' +
                (g ? '<div class="ci-form-row"><span class="ci-form-label">Κατανομή τιμών · ' + periodLabel(it) + '</span>' + histogram(key, g) + '</div>' : '');
        }
        var labels = it.kind === 'cont' ? (cf.current || it.breaks).map(function (_, i, b) { return classLabel(b, i, it.decimals || 0) + ' ' + plain(it.unit); })
            : it.classes.map(function (k) { return plain(k.label); });
        var cols = cf.colors || rampColors(cf.ramp, labels.length, cf.reverse);
        html += '<div class="ci-form-row"><span class="ci-form-label">Κλάσεις</span><div class="ci-classes">' + labels.map(function (l, i) {
            return '<div class="ci-class"><input type="color" data-cls="' + i + '" value="' + cols[i] + '" aria-label="Χρώμα κλάσης ' + esc(l) + '">' +
                '<span>' + esc(l) + '</span><label class="ci-check"><input type="checkbox" data-vis="' + i + '"' + (cf.hidden[i] ? '' : ' checked') + '> ορατή</label></div>';
        }).join('') + '</div></div>' +
            '<div class="ci-form-row"><span class="ci-form-label">Διαφάνεια</span><div class="ci-opt-inline ci-form-inline"><input id="ci-style-transp" type="range" min="0" max="0.95" step="0.05" value="' + cf.transparency +
            '"><output id="ci-style-transp-v" class="ci-opt-value">' + Math.round(cf.transparency * 100) + '%</output></div></div>' +
            '<div class="ci-form-actions"><button type="button" id="ci-st-reset">Επαναφορά προεπιλογών</button></div>';
        body.innerHTML = html;

        var restyle = function () { cf.colors = null; render(key); };
        if (it.kind === 'cont') {
            $('ci-st-method').addEventListener('change', function (e) {
                cf.method = e.target.value;
                if (cf.method === 'custom') cf.breaks = (cf.current || it.breaks).slice();
                cf.hidden = {};
                restyle();
            });
            $('ci-st-n').addEventListener('change', function (e) { cf.classes = Math.max(2, Math.min(10, +e.target.value || 5)); cf.hidden = {}; restyle(); });
            $('ci-st-breaks').addEventListener('change', function (e) {
                var b = e.target.value.split(/[;\s]+/).map(function (x) { return parseFloat(x.replace(',', '.')); })
                    .filter(function (x) { return isFinite(x); }).sort(function (a, c) { return a - c; });
                if (b.length < 1) return;
                cf.method = 'custom'; cf.breaks = b; cf.hidden = {};
                restyle();
            });
            $('ci-st-ramp').addEventListener('change', function (e) { cf.ramp = e.target.value; restyle(); });
            $('ci-st-rev').addEventListener('change', function (e) { cf.reverse = e.target.checked; restyle(); });
        }
        body.querySelectorAll('input[type=color]').forEach(function (inp) {
            inp.addEventListener('input', function () {
                if (!cf.colors) cf.colors = cols.slice();
                cf.colors[+inp.dataset.cls] = inp.value;
                render(key);
            });
        });
        body.querySelectorAll('input[data-vis]').forEach(function (inp) {
            inp.addEventListener('change', function () { cf.hidden[+inp.dataset.vis] = !inp.checked; render(key); });
        });
        $('ci-style-transp').addEventListener('input', function (e) { setTransparency(key, +e.target.value); });
        $('ci-st-reset').addEventListener('click', function () {
            var z = cf.z, on = cf.on;
            state.cfg[key] = defaults(it, z);
            state.cfg[key].on = on;
            if (state.overlays[key]) state.overlays[key].setOpacity(1 - state.cfg[key].transparency);
            syncRows();
            render(key);
        });
    }

    /* ---------------- popup ---------------- */
    function sampleGrid(it, latlng) {
        var g = state.grids[gridUrl(it)];
        if (!g || !g.then) return null;
        return g.then(function (gr) {
            var geo = geoOf(it), p = L.CRS.EPSG3857.project(latlng);
            var c = Math.floor((p.x - geo.x0) / geo.dx), r = Math.floor((geo.y0 - p.y) / geo.dy);
            if (c < 0 || r < 0 || c >= gr.w || r >= gr.h) return null;
            var code = gr.codes[r * gr.w + c];
            return code === NODATA ? null : code * it.scale + it.offset;
        });
    }
    function loadCell(latlng) {
        var C = state.meta.cells;
        var r = Math.floor((C.y0 - latlng.lat) / C.dy), c = Math.floor((latlng.lng - C.x0) / C.dx);
        var key = Math.floor(r / C.chunk) + '_' + Math.floor(c / C.chunk);
        if (!state.cells[key]) {
            state.cells[key] = fetch('./data/cells/' + key + '.json').then(function (res) { return res.ok ? res.json() : {}; }).catch(function () { return {}; });
        }
        return state.cells[key].then(function (ch) { return ch[r + '_' + c] || null; });
    }
    function unpack(rec) {
        var C = state.meta.cells, n = state.meta.years.length, o = {}, i = 0;
        C.fields.forEach(function (f) { o[f] = rec[i++]; });
        o.y = {};
        C.yfields.forEach(function (f) {
            var s = C.yscale[f] || 1;
            o.y[f] = rec.slice(i, i + n).map(function (v) { return v === null ? null : v / s; });
            i += n;
        });
        o.m = {};
        C.mfields.forEach(function (f) { o.m[f] = rec.slice(i, i + 12); i += 12; });
        return o;
    }
    function avg(a) { var s = 0, k = 0; a.forEach(function (v) { if (v !== null) { s += v; k++; } }); return k ? s / k : null; }
    function yearBars(o) {
        var years = state.meta.years, W = 300, H = 118, L0 = 26, B0 = 16, T0 = 8, R0 = 26, n = years.length;
        var etb = o.y.etb.map(function (v) { return v || 0; }), P = o.y.pcp;
        var vmax = Math.max.apply(null, etb.concat([10])) * 1.15, pmax = Math.max.apply(null, P.map(function (v) { return v || 0; }).concat([100])) * 1.1;
        var bw = (W - L0 - R0) / n, y = function (v) { return T0 + (H - T0 - B0) * (1 - v / vmax); }, yp = function (v) { return T0 + (H - T0 - B0) * (1 - v / pmax); };
        var s = '<line x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + (H - B0) + '" y2="' + (H - B0) + '" stroke="#999"></line>' +
            '<text x="' + (L0 - 3) + '" y="' + (T0 + 6) + '" text-anchor="end">' + fmt(vmax / 1.15) + '</text>' +
            '<text x="' + (W - R0 + 3) + '" y="' + (T0 + 6) + '" fill="#c96a1b">' + fmt(pmax / 1.1) + '</text>';
        etb.forEach(function (v, i) {
            var x = L0 + i * bw + 2;
            s += '<rect x="' + x + '" y="' + y(v) + '" width="' + (bw - 4) + '" height="' + (H - B0 - y(v)) + '" fill="' + (i === state.period ? '#0b3b5e' : '#3a9fc0') + '"><title>ETμπλε ' + hyLabel(years[i]) + ': ' + fmt(v) + ' mm</title></rect>' +
                '<text x="' + (x + (bw - 4) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + hyLabel(years[i]) + '</text>';
        });
        s += '<polyline points="' + P.map(function (v, i) { return (L0 + i * bw + bw / 2) + ',' + yp(v || 0); }).join(' ') + '" fill="none" stroke="#c96a1b" stroke-width="1.5"></polyline>';
        return '<figure class="ci-pfig"><figcaption>ET<sub>μπλε</sub> ανά έτος (mm) · <span class="ci-key-p">βροχή</span></figcaption><svg class="ci-spark" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg></figure>';
    }
    function monthChart(o) {
        var W = 300, H = 108, L0 = 26, B0 = 16, T0 = 8, R0 = 6, ord = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8];
        var M = ['Ο', 'Ν', 'Δ', 'Ι', 'Φ', 'Μ', 'Α', 'Μ', 'Ι', 'Ι', 'Α', 'Σ'];
        var a = ord.map(function (i) { return o.m.aeti[i] || 0; }), g = ord.map(function (i) { return o.m.etg[i] || 0; });
        var max = Math.max.apply(null, a.concat(g).concat([10])) * 1.1, bw = (W - L0 - R0) / 12;
        var y = function (v) { return T0 + (H - T0 - B0) * (1 - v / max); }, x = function (i) { return L0 + i * bw + bw / 2; };
        var area = a.map(function (v, i) { return x(i) + ',' + y(Math.max(v, g[i])); }).join(' ') + ' ' +
            g.slice().reverse().map(function (v, j) { var i = 11 - j; return x(i) + ',' + y(v); }).join(' ');
        var s = '<line x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + (H - B0) + '" y2="' + (H - B0) + '" stroke="#999"></line>' +
            '<text x="' + (L0 - 3) + '" y="' + (T0 + 6) + '" text-anchor="end">' + fmt(max / 1.1) + '</text>' +
            '<polygon points="' + area + '" fill="#6fc0d6" opacity=".55"></polygon>' +
            '<polyline points="' + a.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ') + '" fill="none" stroke="#0b3b5e" stroke-width="1.6"></polyline>' +
            '<polyline points="' + g.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ') + '" fill="none" stroke="#4E7D3A" stroke-width="1.6" stroke-dasharray="3 2"></polyline>' +
            M.map(function (m, i) { return '<text x="' + x(i) + '" y="' + (H - 4) + '" text-anchor="middle">' + m + '</text>'; }).join('');
        return '<figure class="ci-pfig"><figcaption>Μηνιαίο ισοζύγιο, μ.ο. (mm) · <span class="ci-key-a">δορυφορική ET</span> · <span class="ci-key-g">χωρίς άρδευση</span></figcaption>' +
            '<svg class="ci-spark" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg></figure>';
    }
    function csvFor(latlng, o) {
        var C = state.meta.cells, years = state.meta.years, rows = [];
        rows.push('# Κατανάλωση νερού άρδευσης στην Κύπρο · εικονοστοιχείο 300 m · ' + latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5));
        rows.push(['hydrological_year'].concat(C.yfields.map(function (f) { return f; })).join(','));
        years.forEach(function (y, i) { rows.push([hyLabel(y)].concat(C.yfields.map(function (f) { var v = o.y[f][i]; return v === null ? '' : v; })).join(',')); });
        rows.push('');
        rows.push(['month'].concat(C.mfields).join(','));
        for (var m = 0; m < 12; m++) rows.push([m + 1].concat(C.mfields.map(function (f) { var v = o.m[f][m]; return v === null ? '' : v; })).join(','));
        rows.push('');
        C.fields.forEach(function (f) { rows.push(f + ',' + (o[f] === null ? '' : o[f])); });
        return rows.join('\n');
    }
    function onMapClick(e) {
        var ll = e.latlng, keys = activeKeys();
        var samples = keys.map(function (k) { return sampleGrid(state.items[k], ll); });
        Promise.all([loadCell(ll), Promise.all(samples.map(function (p) { return p || Promise.resolve(null); }))]).then(function (res) {
            var rec = res[0], vals = res[1], html = '<div class="ci-popup"><div class="ci-popup-coord">' + ll.lat.toFixed(4) + '°, ' + ll.lng.toFixed(4) + '°';
            var o = rec ? unpack(rec) : null, yi = state.period, row = function (label, value, unit) {
                return '<tr><th>' + label + '</th><td>' + value + '</td><td>' + (unit || '') + '</td></tr>';
            };
            var v = function (x, d) { return x === null || x === undefined ? '—' : fmt(x, d || 0); };
            if (o && o.dem !== null) html += ' · ' + fmt(o.dem) + ' m';
            html += '</div>';
            if (o) {
                var per = yi >= 0 ? hyLabel(state.meta.years[yi]) : 'μ.ο. 2018/19–2025/26';
                var pick = function (f) { return yi >= 0 ? o.y[f][yi] : avg(o.y[f]); };
                var etbv = yi >= 0 ? o.y.etb[yi] : o.etb;
                var status = !o.farm ? 'εκτός γεωργικής γης' : (o.sig ? 'σημαντική άρδευση' : 'μη σημαντική') + ' (όριο ' + v(o.floor) + ' mm)';
                html += '<div class="ci-popup-value">' + v(etbv) + ' <small>mm/έτος ET<sub>μπλε</sub> · ' + per + '</small></div>' +
                    '<div class="ci-popup-status' + (o.farm && o.sig ? ' is-sig' : '') + '">' + status + '</div>' +
                    '<div class="ci-popup-meta">εύρος 90% (μ.ο.): ' + v(o.p05) + '–' + v(o.p95) + ' mm · P(άρδευσης) ' + v(o.prob) + '%</div>' +
                    '<table class="ci-popup-table"><caption>Ισοζύγιο · ' + per + '</caption>' +
                    row('Δορυφορική ET', v(pick('aeti')), 'mm') + row('Διαπνοή', v(pick('t')), 'mm') +
                    row('ET χωρίς άρδευση', v(pick('etg')), 'mm') + row('Διόρθωση αναφοράς (μ.ο.)', v(o.bias), 'mm') +
                    row('Βροχόπτωση', v(pick('pcp')), 'mm') + row('ET αναφοράς', v(pick('ret')), 'mm') +
                    row('Διαθέσιμο νερό', v(o.taw), 'mm') + row('Βιομάζα', v(pick('tbp'), 1), 't/ha') +
                    row('Παραγωγικότητα νερού', v(pick('wp'), 2), 'kg/m³') + row('Γεωργική γη', v(o.agri), '%') +
                    (o.ref ? row('Πεδίο αναφοράς', ['', 'ξηρικά σιτηρά', 'ξηρικοί δενδρώνες', 'μακκία', 'δάσος'][o.ref], '') : '') + '</table>' +
                    yearBars(o) + monthChart(o);
            } else {
                html += '<p class="ci-popup-note">Εκτός γεωργικής γης και πεδίων αναφοράς του μοντέλου.</p>';
            }
            var other = keys.map(function (k, i) {
                var it = state.items[k], x = vals[i];
                if (x === null) return '';
                var shown = it.kind === 'cont' ? fmt(x, it.decimals || 0) : plain((it.classes.filter(function (c) { return c.code === Math.round(x); })[0] || {}).label || '—');
                return row(it.name + (it.year ? ' <small>' + periodLabel(it) + '</small>' : ''), shown, it.kind === 'cont' ? it.unit : '');
            }).join('');
            if (other) html += '<table class="ci-popup-table"><caption>Ενεργά επίπεδα σε αυτό το σημείο</caption>' + other + '</table>';
            if (o) html += '<button type="button" class="ci-popup-dl">Λήψη δεδομένων εικονοστοιχείου (CSV)</button>';
            html += '</div>';
            var bar = document.querySelector('.map-status-bar');
            var below = bar && getComputedStyle(bar).position === 'absolute' ? bar.getBoundingClientRect().height : 0;
            var pop = L.popup({ maxWidth: 340, minWidth: 300, className: 'ci-leaflet-popup', autoPanPaddingTopLeft: [10, 10],
                autoPanPaddingBottomRight: [10, below + 10], maxHeight: Math.max(220, state.map.getSize().y - below - 70) }).setLatLng(ll).setContent(html).openOn(state.map);
            var btn = pop.getElement() && pop.getElement().querySelector('.ci-popup-dl');
            if (btn) btn.addEventListener('click', function () {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob(['﻿' + csvFor(ll, o)], { type: 'text/csv;charset=utf-8' }));
                a.download = 'cyprus-irrigation-' + ll.lat.toFixed(4) + '_' + ll.lng.toFixed(4) + '.csv';
                a.click();
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
            });
        });
    }

    /* ---------------- statistics ---------------- */
    function renderStats(m) {
        var years = m.years, dist = m.districts, isl = m.island;
        var W = 300, H = 190, L0 = 34, B0 = 26, T0 = 10, R0 = 30;
        var tot = years.map(function (_, i) { return dist.reduce(function (s, d) { return s + d.values[i]; }, 0); });
        var vmax = Math.max.apply(null, isl.p95.concat(tot)) * 1.1;
        var pmax = Math.max.apply(null, isl.rain) * 1.15;
        var bw = (W - L0 - R0) / years.length;
        var y = function (v) { return T0 + (H - T0 - B0) * (1 - v / vmax); };
        var yp = function (v) { return T0 + (H - T0 - B0) * (1 - v / pmax); };
        var svg = '';
        [0, 50, 100, 150, 200].filter(function (t) { return t < vmax; }).forEach(function (t) {
            svg += '<line class="stats-gridline" x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + y(t) + '" y2="' + y(t) + '"></line>' +
                '<text class="stats-tick-label" x="' + (L0 - 4) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + t + '</text>';
        });
        years.forEach(function (yr, i) {
            var x = L0 + i * bw + 3, acc = 0;
            dist.forEach(function (d) {
                var v = d.values[i];
                svg += '<rect x="' + x + '" y="' + y(acc + v) + '" width="' + (bw - 6) + '" height="' + (y(acc) - y(acc + v)) + '" fill="' + d.color + '"><title>' + d.name + ' ' + hyLabel(yr) + ': ' + fmt(v, 1) + ' hm³</title></rect>';
                acc += v;
            });
            var cx = x + (bw - 6) / 2;
            svg += '<line x1="' + cx + '" x2="' + cx + '" y1="' + y(isl.p05[i]) + '" y2="' + y(isl.p95[i]) + '" stroke="#111" stroke-width="1.2"></line>' +
                '<text class="stats-tick-label" x="' + cx + '" y="' + (H - B0 + 13) + '" text-anchor="middle">' + hyLabel(yr) + '</text>';
        });
        var pts = years.map(function (_, i) { return (L0 + i * bw + bw / 2) + ',' + yp(isl.rain[i]); }).join(' ');
        svg += '<polyline points="' + pts + '" fill="none" stroke="#c96a1b" stroke-width="2"></polyline>' +
            years.map(function (_, i) { return '<circle cx="' + (L0 + i * bw + bw / 2) + '" cy="' + yp(isl.rain[i]) + '" r="2.6" fill="#c96a1b"><title>Βροχή ' + hyLabel(years[i]) + ': ' + fmt(isl.rain[i]) + ' mm</title></circle>'; }).join('') +
            '<text class="stats-tick-label" x="' + (W - R0 + 4) + '" y="' + (yp(pmax / 1.15) + 3) + '" fill="#c96a1b">' + fmt(pmax / 1.15) + '</text>' +
            '<text class="stats-tick-label" x="' + (W - R0 + 4) + '" y="' + (H - B0 + 3) + '" fill="#c96a1b">0 mm</text>';
        $('chart-volumes').innerHTML = '<svg class="stats-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ετήσιοι όγκοι ανά επαρχία">' + svg + '</svg>';
        $('chart-volumes-legend').innerHTML = dist.map(function (d) { return '<span><i style="background:' + d.color + '"></i>' + d.name + '</span>'; }).join('') +
            '<span><i class="ci-line"></i>Βροχή (mm)</span><span><i class="ci-whisker"></i>Εύρος 5–95%</span>';

        var row = function (label, value) {
            return '<div class="stats-row"><span class="stats-row-label">' + label + '</span><span class="stats-row-leader" aria-hidden="true"></span><span class="stats-row-value">' + value + '</span></div>';
        };
        var s = m.summary;
        $('stats-summary').innerHTML =
            row('Καθαρή κατανάλωση, σημαντική άρδευση', fmt(s.volume) + ' hm³/έτος') +
            row('Εύρος 5–95%', fmt(s.volume_lo) + '–' + fmt(s.volume_hi) + ' hm³') +
            row('Καθαρή κατανάλωση, όλη η γεωργική γη', fmt(s.volume_all) + ' hm³/έτος') +
            row('Εύρος 5–95%', fmt(s.volume_all_lo) + '–' + fmt(s.volume_all_hi) + ' hm³') +
            row('Γη με σημαντική άρδευση', fmt(s.area) + ' km²') +
            row('AUC (ROC)', fmt(s.auc, 2)) +
            row('Εντοπισμός, αρδευόμενες καλλιέργειες', fmt(s.detection_irr * 100) + '%') +
            row('Εντοπισμός, θερινή βλάστηση (Sentinel-2)', fmt(s.detection * 100) + '%') +
            row('Ψευδώς θετικά (ξηρικά)', fmt(s.fp * 100) + '%') +
            row('Συσχέτιση με βροχή', 'r = ' + fmt(s.r_rain, 2)) +
            row('Ζώνες προτεραιότητας', fmt(s.hot_share * 100) + '% του όγκου');
        $('stats-districts').innerHTML = dist.slice().sort(function (a, b) { return b.mean - a.mean; })
            .map(function (d) { return row(d.name, fmt(d.mean, 1) + ' hm³/έτος'); }).join('');
        $('stats-table').innerHTML = '<table class="ci-year-table"><thead><tr><th>Έτος</th><th>Διάμεσος</th><th>Εύρος 90%</th><th>Βροχή</th></tr></thead><tbody>' +
            years.map(function (yr, i) {
                return '<tr><td>' + hyLabel(yr) + '</td><td>' + fmt(isl.p50[i]) + '</td><td>' + fmt(isl.p05[i]) + '–' + fmt(isl.p95[i]) + '</td><td>' + fmt(isl.rain[i]) + '</td></tr>';
            }).join('') + '</tbody></table>';
        var g = s.detection_by_green || {};
        $('method-validation').innerHTML = 'Καμπύλη ROC του ελέγχου σημαντικότητας: <strong>AUC ' + fmt(s.auc, 2) + '</strong>. Εντοπίζεται το <strong>' +
            fmt(s.detection_irr * 100) + '%</strong> των αρδευόμενων καλλιεργειών με θερινή βλάστηση (Sentinel-2 και CORINE: μόνιμα αρδευόμενη γη, οπωρώνες) και το ' +
            fmt(s.detection * 100) + '% κάθε γης με θερινή βλάστηση, με <strong>' + fmt(s.fp * 100) +
            '%</strong> ψευδώς θετικά σε ανεξάρτητα ξηρικά πεδία (έλεγχος ανά μπλοκ 0,25°, με όριο από τα υπόλοιπα μπλοκ). ' +
            (g['0.4-0.5'] && g['0.8-1.0'] ? 'Ο εντοπισμός αυξάνεται από ' + fmt(g['0.4-0.5'][0] * 100) + '% σε ' + fmt(g['0.8-1.0'][0] * 100) +
            '% όσο μεγαλώνει το αρδευόμενο τμήμα του εικονοστοιχείου 300 m (μικτά εικονοστοιχεία). ' : '') +
            'Ο όγκος χωρίς όριο σημαντικότητας, άθροισμα σε όλη τη γεωργική γη, είναι ' + fmt(s.volume_all) + ' hm³/έτος.';
        $('kpi-volume').textContent = fmt(s.volume) + ' hm³/έτος';
        $('kpi-area').textContent = fmt(s.area) + ' km²';
    }

    /* ---------------- init ---------------- */
    function init() {
        setupChrome();
        fetch('./data/meta.json').then(function (r) { return r.json(); }).then(function (meta) {
            state.meta = meta;
            renderPeriod(meta);
            renderCatalog(meta);
            setupMap();
            renderStats(meta);
            activeKeys().forEach(render);
            renderLegend();
            $('relief-toggle').addEventListener('change', function (e) {
                if (e.target.checked) state.relief.addTo(state.map); else state.map.removeLayer(state.relief);
                $('relief-options').hidden = !e.target.checked;
                renderLegend();
            });
            $('relief-transp').addEventListener('input', function (e) {
                state.relief.setOpacity(1 - e.target.value);
                $('relief-transp-v').textContent = Math.round(e.target.value * 100) + '%';
            });
            $('districts-toggle').addEventListener('change', function (e) {
                if (!state.districts) return;
                if (e.target.checked) state.districts.addTo(state.map); else state.map.removeLayer(state.districts);
                renderLegend();
            });
            $('labels-toggle').addEventListener('change', function () { applyPlaceLabels(); });
            syncLabelsControl();
        }).catch(function (err) {
            console.error(err);
            $('loading').innerHTML = '<p>Τα δεδομένα δεν φορτώθηκαν. Δοκιμάστε ανανέωση της σελίδας.</p>';
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
