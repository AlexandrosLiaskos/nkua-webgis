(function () {
    'use strict';

    // Map display settings shared by the atlases, after the Historic Floods
    // legend: the settings button opens a dialog that chooses the variable that
    // colours the map, how numeric values are grouped and each class colour.
    // Legend rows show or hide their class on the map.

    var PALETTE = ['#2563eb', '#0d9488', '#9333ea', '#ea580c', '#dc2626', '#a16207', '#0891b2', '#4f46e5', '#be185d', '#4d7c0f', '#7c3aed', '#475569'];
    var GRAY = '#737373';
    var OTHER_COLOR = '#a3a3a3';
    var MAX_VALUE_CLASSES = 11;
    var MAX_CLASSES = 40;
    var JENKS_SAMPLE = 1000;
    var METHODS = [
        ['jenks', 'Natural breaks (Jenks)'], ['quantile', 'Quantiles'], ['equalInterval', 'Equal intervals'],
        ['fixedInterval', 'Fixed interval'], ['standardDeviation', 'Standard deviation'], ['custom', 'Custom boundaries']
    ];
    var METHOD_NOTES = {
        jenks: 'Groups similar values while reducing variation within classes.',
        quantile: 'Aims for similar record counts in each class. Identical values stay together.',
        equalInterval: 'Divides the observed range into equally sized spans.',
        fixedInterval: 'Groups values into spans of a fixed size, aligned to round boundaries.',
        standardDeviation: 'Groups values by their distance from the mean.',
        custom: 'Each boundary is the upper value of a class. The final class covers higher values.'
    };
    var SETTINGS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><path d="M4 7h16M4 17h16"></path><circle cx="9" cy="7" r="3"></circle><circle cx="15" cy="17" r="3"></circle></svg>';

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function fieldValue(record, field) {
        var source = field.dataField || field.key;
        if (typeof source === 'function') return source(record);
        return record ? record[source] : undefined;
    }

    function isMissing(value, field) {
        if (value === null || value === undefined) return true;
        var text = String(value).trim();
        return !text || (field.missingValues || []).indexOf(text) !== -1;
    }

    function valueLabel(field, value) {
        if (typeof field.formatValue === 'function') return String(field.formatValue(value));
        if (field.valueLabels && Object.prototype.hasOwnProperty.call(field.valueLabels, String(value))) return field.valueLabels[String(value)];
        return String(value);
    }

    // Light-to-dark blue for ordered numeric classes.
    function rampColor(index, count) {
        var start = [198, 219, 239], end = [8, 48, 107];
        var position = count > 1 ? index / (count - 1) : 0.55;
        return '#' + start.map(function (channel, axis) {
            var value = Math.round(channel + (end[axis] - channel) * position).toString(16);
            return value.length < 2 ? '0' + value : value;
        }).join('');
    }

    // Frequency-weighted Jenks over unique values; tied values stay together.
    function jenksUpperBounds(values, requestedClasses) {
        var frequencies = new Map();
        values.forEach(function (value) { frequencies.set(value, (frequencies.get(value) || 0) + 1); });
        var unique = Array.from(frequencies.keys()).sort(function (a, b) { return a - b; });
        // Large catalogues: run on evenly spaced unique values to keep it interactive.
        if (unique.length > JENKS_SAMPLE) {
            var step = (unique.length - 1) / (JENKS_SAMPLE - 1);
            var sampled = new Map();
            for (var s = 0; s < JENKS_SAMPLE; s++) {
                var value = unique[Math.round(s * step)];
                sampled.set(value, frequencies.get(value));
            }
            frequencies = sampled;
            unique = Array.from(sampled.keys());
        }
        var n = unique.length, k = Math.min(requestedClasses, n);
        var counts = [0], sums = [0], squares = [0];
        unique.forEach(function (value, index) {
            var count = frequencies.get(value);
            counts.push(counts[index] + count);
            sums.push(sums[index] + value * count);
            squares.push(squares[index] + value * value * count);
        });
        function cost(start, end) {
            var weight = counts[end] - counts[start], sum = sums[end] - sums[start];
            return Math.max(0, squares[end] - squares[start] - sum * sum / weight);
        }
        var dp = [], previous = [];
        for (var c = 0; c <= k; c++) {
            dp.push(new Array(n + 1).fill(Infinity));
            previous.push(new Array(n + 1).fill(0));
        }
        dp[0][0] = 0;
        for (var classes = 1; classes <= k; classes++) {
            for (var end = classes; end <= n; end++) {
                for (var start = classes - 1; start < end; start++) {
                    var candidate = dp[classes - 1][start] + cost(start, end);
                    if (candidate < dp[classes][end]) {
                        dp[classes][end] = candidate;
                        previous[classes][end] = start;
                    }
                }
            }
        }
        var cuts = [];
        var last = n;
        for (var remaining = k; remaining > 1; remaining--) {
            var first = previous[remaining][last];
            cuts.unshift(unique[first - 1]);
            last = first;
        }
        return cuts;
    }

    function parseBreaks(value) {
        if (Array.isArray(value)) return value.map(Number);
        if (typeof value !== 'string' || !value.trim()) return [];
        return value.split(',').map(function (part) {
            return /^\s*-?\d+(\.\d+)?\s*$/.test(part) ? Number(part) : NaN;
        });
    }

    function normalizeSettings(draft, fieldsByKey) {
        draft = draft || {};
        var settings = {
            field: draft.field || 'default',
            method: draft.method || 'jenks',
            classCount: Number(draft.classCount === undefined ? 5 : draft.classCount),
            interval: Number(draft.interval === undefined ? 10 : draft.interval),
            customBreaks: parseBreaks(draft.customBreaks),
            colors: Object.assign({}, draft.colors || {})
        };
        var field = fieldsByKey[settings.field];
        if (settings.field !== 'default' && !field) throw new Error('Choose a variable available in this atlas.');
        if (field && field.type === 'numeric') {
            if (!METHODS.some(function (entry) { return entry[0] === settings.method; })) throw new Error('Choose a valid grouping method.');
            if (['jenks', 'quantile', 'equalInterval', 'standardDeviation'].indexOf(settings.method) !== -1
                && (!Number.isInteger(settings.classCount) || settings.classCount < 2 || settings.classCount > 12)) {
                throw new Error('Choose between 2 and 12 classes.');
            }
            if (settings.method === 'fixedInterval' && !(settings.interval > 0)) throw new Error('The class span must be a positive number.');
            if (settings.method === 'custom') {
                if (!settings.customBreaks.length) throw new Error('Enter at least one class boundary.');
                if (settings.customBreaks.length > MAX_CLASSES - 1) throw new Error('Use at most ' + (MAX_CLASSES - 1) + ' class boundaries.');
                if (settings.customBreaks.some(function (value, index, values) { return !isFinite(value) || (index > 0 && value <= values[index - 1]); })) {
                    throw new Error('Class boundaries must be numbers in strictly increasing order.');
                }
            }
        }
        if (!Number.isInteger(settings.classCount) || settings.classCount < 2 || settings.classCount > 12) settings.classCount = 5;
        if (!(settings.interval > 0)) settings.interval = 10;
        Object.keys(settings.colors).forEach(function (key) {
            if (!/^#[0-9a-f]{6}$/i.test(settings.colors[key])) throw new Error('Choose valid six-digit hexadecimal colours.');
        });
        return settings;
    }

    function numericCuts(values, settings) {
        var min = values[0], max = values[values.length - 1];
        var integer = values.every(function (value) { return Number.isInteger(value); });
        var round = integer ? Math.floor : function (value) { return value; };
        var cuts = [];
        if (settings.method === 'fixedInterval') {
            var interval = settings.interval;
            var start = Math.floor(min / interval) * interval;
            var count = Math.floor((max - start) / interval) + 1;
            if (count > MAX_CLASSES) throw new Error('This span creates ' + count + ' classes. Increase the span to use at most ' + MAX_CLASSES + ' classes.');
            for (var i = 1; i < count; i++) cuts.push(integer ? start + i * interval - 1 : start + i * interval);
        } else if (settings.method === 'custom') {
            if (settings.customBreaks.some(function (value) { return value < min || value >= max; })) {
                throw new Error('Class boundaries must lie between ' + min + ' and ' + max + ' (exclusive), the range in this catalogue.');
            }
            cuts = settings.customBreaks.slice();
        } else {
            var classCount = Math.min(settings.classCount, new Set(values).size);
            if (settings.method === 'jenks') {
                cuts = jenksUpperBounds(values, classCount);
            } else if (settings.method === 'quantile') {
                for (var q = 1; q < classCount; q++) cuts.push(values[Math.ceil(q * values.length / classCount) - 1]);
            } else if (settings.method === 'equalInterval') {
                for (var e = 1; e < classCount; e++) cuts.push(round(min + (max - min) * e / classCount));
            } else if (settings.method === 'standardDeviation') {
                var mean = values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
                var sd = Math.sqrt(values.reduce(function (sum, value) { return sum + Math.pow(value - mean, 2); }, 0) / values.length);
                for (var d = 1; d < classCount; d++) cuts.push(round(mean + (d - classCount / 2) * sd));
            }
        }
        return { integer: integer, min: min, max: max, cuts: Array.from(new Set(cuts.filter(function (value) {
            return isFinite(value) && value >= min && value < max;
        }))).sort(function (a, b) { return a - b; }) };
    }

    // Builds classes from the whole catalogue, so filtering never shifts colours or boundaries.
    function buildModel(records, draft, config, fieldsByKey) {
        var settings = normalizeSettings(draft, fieldsByKey);
        var weight = typeof config.getRecordWeight === 'function' ? config.getRecordWeight : function () { return 1; };
        var format = new Intl.NumberFormat(config.locale || undefined, { maximumFractionDigits: 2 });
        var missing = { key: '__missing', label: config.missingLabel || 'Not recorded', color: GRAY };
        var field = fieldsByKey[settings.field];
        var categories;
        var categoryFor;

        if (!field) {
            var byKey = {};
            categories = (config.categories || []).map(function (category) {
                var copy = Object.assign({}, category);
                byKey[copy.key] = copy;
                return copy;
            });
            missing.label = config.unclassifiedLabel || 'Unclassified';
            categoryFor = function (record) {
                var result = typeof config.classify === 'function' ? config.classify(record) : null;
                var key = result && typeof result === 'object' ? result.key : result;
                return byKey[key] || missing;
            };
        } else if (field.type === 'numeric') {
            var values = [];
            records.forEach(function (record) {
                var raw = fieldValue(record, field);
                if (isMissing(raw, field)) return;
                var number = Number(raw);
                if (isFinite(number)) values.push(number);
            });
            values.sort(function (a, b) { return a - b; });
            var bins = [];
            if (values.length) {
                var result = numericCuts(values, settings);
                var uppers = result.cuts.concat([result.max]);
                bins = uppers.map(function (upper, index) {
                    var lower = index ? (result.integer ? result.cuts[index - 1] + 1 : result.cuts[index - 1]) : result.min;
                    var label = lower === upper ? format.format(lower) : format.format(lower) + '–' + format.format(upper);
                    return {
                        key: field.key + ':' + settings.method + ':' + lower + ':' + upper,
                        label: label,
                        upper: index === uppers.length - 1 ? Infinity : upper,
                        color: rampColor(index, uppers.length)
                    };
                });
            }
            categories = bins;
            categoryFor = function (record) {
                var raw = fieldValue(record, field);
                if (isMissing(raw, field)) return missing;
                var number = Number(raw);
                if (!isFinite(number)) return missing;
                for (var i = 0; i < bins.length; i++) if (number <= bins[i].upper) return bins[i];
                return missing;
            };
        } else {
            var counts = {};
            records.forEach(function (record) {
                var raw = fieldValue(record, field);
                if (isMissing(raw, field)) return;
                var key = String(raw);
                counts[key] = (counts[key] || 0) + weight(record);
            });
            var keys = Object.keys(counts).sort(function (a, b) {
                return counts[b] - counts[a] || a.localeCompare(b, config.locale || undefined, { numeric: true });
            });
            var shown = keys.length > MAX_VALUE_CLASSES + 1 ? keys.slice(0, MAX_VALUE_CLASSES) : keys;
            var lookup = {};
            categories = shown.map(function (value, index) {
                var category = { key: field.key + '=' + value, label: valueLabel(field, value), color: PALETTE[index % PALETTE.length] };
                lookup[value] = category;
                return category;
            });
            var other = null;
            if (shown.length < keys.length) {
                other = { key: field.key + ':other', label: config.otherLabel || 'Other values', color: OTHER_COLOR };
                categories.push(other);
            }
            categoryFor = function (record) {
                var raw = fieldValue(record, field);
                if (isMissing(raw, field)) return missing;
                return lookup[String(raw)] || other || missing;
            };
        }

        categories = categories.concat([missing]).map(function (category) {
            category.color = settings.colors[category.key] || category.color || GRAY;
            category.border = category.border || '#ffffff';
            category.totalCount = 0;
            return category;
        });
        records.forEach(function (record) { categoryFor(record).totalCount += weight(record); });
        // The empty fallback class is only listed when some records fall in it.
        categories = categories.filter(function (category) { return category !== missing || missing.totalCount > 0; });
        return { settings: settings, field: field || null, categories: categories, categoryFor: categoryFor };
    }

    function create(map, config) {
        config = config || {};
        var locale = config.locale || undefined;
        var text = function (key, fallback) { return config.text && config.text[key] ? config.text[key] : fallback; };
        var fields = [];
        var fieldsByKey = {};
        var catalogue = [];
        var currentRecords = [];
        var hidden = {};
        var saved = null;
        var api;

        // Method names and notes can be translated through config.text (method.<key>, note.<key>).
        function methodLabel(key) {
            var entry = METHODS.find(function (item) { return item[0] === key; });
            return entry ? text('method.' + key, entry[1]) : '';
        }

        try {
            saved = config.storageKey ? JSON.parse(window.localStorage.getItem(config.storageKey) || 'null') : null;
        } catch (_error) { saved = null; }

        var model = buildModel([], { field: 'default', colors: saved && saved.field === 'default' ? saved.colors : {} }, config, fieldsByKey);

        // Legend (same structure and classes as addCategoryLegend).
        var mapContainer = map.getContainer();
        var outer = mapContainer.parentNode || mapContainer;
        var status = element('div', 'map-status-bar');
        var left = element('div', 'status-bar-left-col');
        var legend = element('div', 'status-bar-legend map-display-legend');
        legend.setAttribute('role', 'group');
        legend.setAttribute('aria-label', config.ariaLabel || config.title || 'Map legend');
        var title = element('div', 'legend-title');
        var titleMain = element('span', 'legend-title-main');
        var titleSub = element('span', 'legend-title-sub');
        var settingsButton = element('button', 'map-display-settings-button');
        settingsButton.type = 'button';
        settingsButton.title = text('displaySettings', 'Map display settings');
        settingsButton.setAttribute('aria-label', settingsButton.title);
        settingsButton.setAttribute('aria-haspopup', 'dialog');
        settingsButton.innerHTML = SETTINGS_ICON;
        title.appendChild(titleMain);
        title.appendChild(titleSub);
        title.appendChild(settingsButton);
        var rows = element('div', 'map-display-legend-rows');
        legend.appendChild(title);
        legend.appendChild(rows);
        var readout = null;
        if (config.legendParent) {
            // The atlas keeps its own status bar; only the legend is placed.
            config.legendParent.appendChild(legend);
            status = legend;
        } else {
            left.appendChild(legend);
            status.appendChild(left);
            outer.appendChild(status);
            readout = window.NkuaWebGISMap && window.NkuaWebGISMap.addMapReadout
                ? window.NkuaWebGISMap.addMapReadout(map, status) : null;
        }

        function legendTitle() {
            if (!model.field) return { main: config.title || '', sub: config.subtitle || '' };
            var method = model.field.type === 'numeric' ? methodLabel(model.settings.method) : '';
            return {
                main: model.field.unit ? model.field.label + ' (' + model.field.unit + ')' : model.field.label,
                sub: method || text('recordsSubtitle', 'records')
            };
        }

        function renderLegend() {
            var heading = legendTitle();
            titleMain.textContent = heading.main;
            titleSub.textContent = heading.sub;
            titleSub.hidden = !heading.sub;
            var counts = {};
            var weight = typeof config.getRecordWeight === 'function' ? config.getRecordWeight : function () { return 1; };
            currentRecords.forEach(function (record) {
                var key = model.categoryFor(record).key;
                counts[key] = (counts[key] || 0) + weight(record);
            });
            rows.replaceChildren();
            model.categories.forEach(function (category) {
                var visible = !hidden[category.key];
                var row = element('button', 'legend-row' + (visible ? '' : ' is-hidden'));
                row.type = 'button';
                row.setAttribute('aria-pressed', String(visible));
                row.title = visible ? text('hideClass', 'Hide this class on the map') : text('showClass', 'Show this class on the map');
                var dot = element('span', 'legend-dot');
                dot.setAttribute('aria-hidden', 'true');
                dot.style.background = category.color;
                dot.style.borderColor = category.border || '#ffffff';
                var label = element('span', 'legend-text', category.label);
                var count = element('span', 'legend-count', (counts[category.key] || 0).toLocaleString(locale));
                row.appendChild(dot);
                row.appendChild(label);
                row.appendChild(count);
                row.addEventListener('click', function () {
                    if (hidden[category.key]) delete hidden[category.key];
                    else hidden[category.key] = true;
                    renderLegend();
                    changed();
                });
                rows.appendChild(row);
            });
        }

        function changed() {
            if (typeof config.onChange === 'function') config.onChange(api);
        }

        function save(settings) {
            if (!config.storageKey) return;
            try { window.localStorage.setItem(config.storageKey, JSON.stringify(settings)); } catch (_error) { /* Storage can be unavailable. */ }
        }

        // Rebuilds classes; a saved choice is restored once its variable and the catalogue are known.
        function rebuild(draft) {
            var next;
            try { next = buildModel(catalogue, draft, config, fieldsByKey); }
            catch (_error) { next = buildModel(catalogue, { field: 'default' }, config, fieldsByKey); }
            var before = JSON.stringify(model.categories.map(function (category) { return [category.key, category.color]; }));
            model = next;
            renderLegend();
            return before !== JSON.stringify(model.categories.map(function (category) { return [category.key, category.color]; }));
        }

        function setFields(list) {
            fields = (list || []).filter(function (field) {
                return field && field.key && !field.observations && (field.type === 'numeric' || field.type === 'categorical');
            });
            fieldsByKey = {};
            fields.forEach(function (field) { fieldsByKey[field.key] = field; });
            if (rebuild(saved || model.settings)) changed();
            return api;
        }

        function update(records) {
            currentRecords = Array.isArray(records) ? records : [];
            if (currentRecords.length > catalogue.length) {
                catalogue = currentRecords.slice();
                if (rebuild(saved || model.settings) && model.field) changed();
            } else {
                renderLegend();
            }
        }

        // ----- Settings dialog -----
        var dialog = null;
        var controls = {};
        var draft = null;
        var opener = null;

        function field(labelText, name, options, parent) {
            var wrapper = element('div', 'display-settings-field');
            var caption = element('label', '', labelText);
            caption.htmlFor = 'map-display-' + name;
            var input = element(options ? 'select' : 'input');
            input.id = 'map-display-' + name;
            input.name = name;
            if (options) {
                input.dataset.dropdownLimit = '100';
                options(input);
            }
            wrapper.appendChild(caption);
            wrapper.appendChild(input);
            parent.appendChild(wrapper);
            return { input: input, wrapper: wrapper };
        }

        function fillFieldOptions(select) {
            select.replaceChildren();
            var preset = element('option', '', config.defaultLabel || config.title || text('defaultScheme', 'Default classification'));
            preset.value = 'default';
            select.appendChild(preset);
            var groups = {};
            fields.forEach(function (item) {
                var groupName = item.group || text('variables', 'Variables');
                if (!groups[groupName]) {
                    groups[groupName] = element('optgroup');
                    groups[groupName].label = groupName;
                    select.appendChild(groups[groupName]);
                }
                var option = element('option', '', item.unit ? item.label + ' (' + item.unit + ')' : item.label);
                option.value = item.key;
                groups[groupName].appendChild(option);
            });
        }

        function buildDialog() {
            dialog = element('dialog', 'display-settings-dialog');
            dialog.setAttribute('aria-labelledby', 'map-display-title');
            var header = element('header', 'display-settings-header modal-header');
            var heading = element('h2', '', text('displayTitle', 'Map display'));
            heading.id = 'map-display-title';
            var close = element('button', 'display-settings-close modal-close', '×');
            close.type = 'button';
            close.setAttribute('aria-label', text('closeDisplay', 'Close map display settings'));
            close.addEventListener('click', function () { dialog.close(); });
            header.appendChild(heading);
            header.appendChild(close);

            var form = element('form', 'display-settings-form');
            form.noValidate = true;
            var body = element('div', 'display-settings-body modal-body');
            var grid = element('div', 'display-settings-controls');
            body.appendChild(grid);
            controls.field = field(text('colourBy', 'Colour by'), 'field', fillFieldOptions, grid);
            controls.method = field(text('grouping', 'Grouping'), 'method', function (select) {
                METHODS.forEach(function (entry) {
                    var option = element('option', '', methodLabel(entry[0]));
                    option.value = entry[0];
                    select.appendChild(option);
                });
            }, grid);
            var numeric = element('div', 'display-settings-numeric');
            controls.numeric = numeric;
            controls.classCount = field(text('classes', 'Classes'), 'classCount', null, numeric);
            Object.assign(controls.classCount.input, { type: 'number', min: '2', max: '12', step: '1', inputMode: 'numeric' });
            controls.interval = field(text('classSpan', 'Span per class'), 'interval', null, numeric);
            Object.assign(controls.interval.input, { type: 'number', min: '0', step: 'any', inputMode: 'decimal' });
            body.appendChild(numeric);
            controls.breaks = field(text('boundaries', 'Class boundaries'), 'customBreaks', null, body);
            controls.breaks.input.type = 'text';
            controls.breaks.input.autocomplete = 'off';
            controls.breaks.input.spellcheck = false;
            controls.context = element('p', 'display-settings-context');
            body.appendChild(controls.context);

            var preview = element('section', 'display-settings-preview');
            var wrapper = element('div', 'template-table-wrapper');
            var table = element('table', 'template-table display-settings-table');
            table.setAttribute('aria-label', text('classTable', 'Colour classes and record counts'));
            var thead = element('thead');
            var headings = element('tr');
            [text('colour', 'Colour'), text('class', 'Class'), text('records', 'Records')].forEach(function (label) {
                var cell = element('th', '', label);
                cell.scope = 'col';
                headings.appendChild(cell);
            });
            thead.appendChild(headings);
            controls.list = element('tbody', 'display-settings-class-list');
            table.appendChild(thead);
            table.appendChild(controls.list);
            wrapper.appendChild(table);
            preview.appendChild(wrapper);
            body.appendChild(preview);
            controls.error = element('p', 'display-settings-error');
            controls.error.setAttribute('role', 'alert');
            controls.error.hidden = true;
            body.appendChild(controls.error);

            var footer = element('footer', 'display-settings-footer');
            var cancel = element('button', 'display-settings-cancel btn-secondary', text('cancel', 'Cancel'));
            cancel.type = 'button';
            cancel.addEventListener('click', function () { dialog.close(); });
            controls.apply = element('button', 'display-settings-apply btn-primary', text('apply', 'Apply'));
            controls.apply.type = 'submit';
            footer.appendChild(cancel);
            footer.appendChild(controls.apply);
            form.appendChild(body);
            form.appendChild(footer);
            dialog.appendChild(header);
            dialog.appendChild(form);
            document.body.appendChild(dialog);

            controls.field.input.addEventListener('change', function () {
                draft.colors = {};
                refreshPreview();
            });
            [controls.method, controls.classCount, controls.interval, controls.breaks].forEach(function (item) {
                item.input.addEventListener(item.input.tagName === 'SELECT' ? 'change' : 'input', refreshPreview);
            });
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                try {
                    var next = buildModel(catalogue, readDraft(), config, fieldsByKey);
                    model = next;
                    saved = next.settings;
                    hidden = {};
                    save(next.settings);
                    renderLegend();
                    changed();
                    dialog.close();
                } catch (error) { showError(error); }
            });
            dialog.addEventListener('click', function (event) {
                if (event.target !== dialog) return;
                var rect = dialog.getBoundingClientRect();
                if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
            });
            dialog.addEventListener('close', function () {
                draft = null;
                if (opener && opener.isConnected) opener.focus({ preventScroll: true });
            });
        }

        function readDraft() {
            var raw = controls.breaks.input.value.trim();
            return {
                field: controls.field.input.value,
                method: controls.method.input.value,
                classCount: Number(controls.classCount.input.value),
                interval: Number(controls.interval.input.value),
                customBreaks: raw,
                colors: Object.assign({}, draft && draft.colors || {})
            };
        }

        function showError(error) {
            controls.error.textContent = (error && error.message) || text('checkSettings', 'Check the class settings.');
            controls.error.hidden = false;
            controls.apply.disabled = true;
        }

        function refreshPreview() {
            if (!draft) return;
            var selected = fieldsByKey[controls.field.input.value];
            var numeric = Boolean(selected && selected.type === 'numeric');
            var method = controls.method.input.value;
            controls.method.wrapper.hidden = !numeric;
            controls.classCount.wrapper.hidden = !numeric || ['jenks', 'quantile', 'equalInterval', 'standardDeviation'].indexOf(method) === -1;
            controls.interval.wrapper.hidden = !numeric || method !== 'fixedInterval';
            controls.numeric.hidden = controls.classCount.wrapper.hidden && controls.interval.wrapper.hidden;
            controls.breaks.wrapper.hidden = !numeric || method !== 'custom';
            controls.context.textContent = numeric ? text('note.' + method, METHOD_NOTES[method])
                : selected ? text('categoricalNote', 'Each value has its own colour; less frequent values are combined. Classes cover the whole catalogue.')
                    : (config.defaultNote || text('defaultNote', 'The atlas’s standard classification.'));
            try {
                var preview = buildModel(catalogue, readDraft(), config, fieldsByKey);
                draft = { colors: Object.assign({}, preview.settings.colors) };
                controls.error.hidden = true;
                controls.error.textContent = '';
                controls.apply.disabled = false;
                renderClasses(preview.categories);
            } catch (error) { showError(error); }
        }

        function renderClasses(categories) {
            controls.list.replaceChildren();
            categories.forEach(function (category) {
                var row = element('tr', 'display-settings-class');
                var picker = element('input', 'display-settings-color');
                picker.type = 'color';
                picker.value = /^#[0-9a-f]{6}$/i.test(category.color) ? category.color : '#777777';
                picker.setAttribute('aria-label', text('colourFor', 'Colour for') + ' ' + category.label);
                picker.addEventListener('input', function () { draft.colors[category.key] = picker.value; });
                var name = element('span', 'display-settings-class-label', category.label);
                var count = element('span', 'display-settings-class-count', Number(category.totalCount || 0).toLocaleString(locale));
                [picker, name, count].forEach(function (content) {
                    var cell = element('td');
                    cell.appendChild(content);
                    row.appendChild(cell);
                });
                controls.list.appendChild(row);
            });
            if (!categories.length) {
                var empty = element('tr');
                var cell = element('td', 'display-settings-empty', text('noClasses', 'No classes available.'));
                cell.colSpan = 3;
                empty.appendChild(cell);
                controls.list.appendChild(empty);
            }
        }

        function open() {
            if (!dialog) buildDialog();
            if (dialog.open) return;
            opener = settingsButton;
            fillFieldOptions(controls.field.input);
            var settings = model.settings;
            draft = { colors: Object.assign({}, settings.colors) };
            controls.field.input.value = fieldsByKey[settings.field] ? settings.field : 'default';
            controls.method.input.value = settings.method;
            controls.classCount.input.value = settings.classCount;
            controls.interval.input.value = settings.interval;
            controls.breaks.input.value = settings.customBreaks.join(', ');
            refreshPreview();
            dialog.showModal();
            controls.field.input.focus({ preventScroll: true });
        }

        settingsButton.addEventListener('click', open);
        renderLegend();

        api = {
            element: status,
            readout: readout,
            update: update,
            setFields: setFields,
            // Reads statistics variables and the full catalogue from an NkuaWebGISUI atlas interface.
            attach: function (atlas) {
                if (!atlas) return api;
                // Catalogue first, so a saved numeric grouping is rebuilt once with its full range.
                if (atlas.filterPanel && atlas.filterPanel.allRecords.length > catalogue.length) {
                    catalogue = atlas.filterPanel.allRecords.slice();
                }
                if (atlas.statisticsPanel) setFields(atlas.statisticsPanel.fields);
                else if (rebuild(saved || model.settings) && model.field) changed();
                return api;
            },
            classify: function (record) { return model.categoryFor(record); },
            categories: function () { return model.categories; },
            visibleCategories: function () {
                return model.categories.filter(function (category) { return !hidden[category.key]; });
            },
            isVisible: function (record) { return !hidden[model.categoryFor(record).key]; },
            visible: function (records) {
                if (!Object.keys(hidden).length) return records;
                return records.filter(function (record) { return !hidden[model.categoryFor(record).key]; });
            },
            open: open
        };
        return api;
    }

    window.NkuaWebGISDisplay = { create: create };
}());
