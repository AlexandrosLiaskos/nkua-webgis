import { MONTH_NAMES } from '../data/monthValues.js?v=20261013-month-1';

/** Source-supported flood classifications and cartographic groupings of observation years. */
export const PARAMETERS = [
    { key: 'waterSource', label: 'Water source', inputId: 'water-source-filter', optionsKey: 'waterSources' },
    { key: 'onset', label: 'Onset / response', inputId: 'onset-filter', optionsKey: 'onsets' },
    { key: 'process', label: 'Generating process', inputId: 'process-filter', optionsKey: 'processes' },
    { key: 'mechanism', label: 'Inundation mechanism', inputId: 'mechanism-filter', optionsKey: 'mechanisms' },
    { key: 'sediment', label: 'Sediment behaviour', inputId: 'sediment-filter', optionsKey: 'sediments' },
    { key: 'setting', label: 'Setting', inputId: 'setting-filter', optionsKey: 'settings' },
    { key: 'compound', label: 'Interacting drivers', inputId: 'compound-filter', optionsKey: 'compounds' }
];
export const FLOOD_PARAMETERS = PARAMETERS;
export const YEAR_METHODS = [
    { key: 'legacy', label: 'Original periods', description: 'Preset year periods used by this map.' },
    { key: 'jenks', label: 'Natural breaks (Jenks)', description: 'Minimises variation within classes of similar years.' },
    { key: 'quantile', label: 'Quantiles', description: 'Aims for similar source-record counts; identical years stay together.' },
    { key: 'equalInterval', label: 'Equal intervals', description: 'Divides the observed year range into equally sized spans.' },
    { key: 'decades', label: 'Calendar decades', description: 'Groups years into calendar decades, such as 1990–1999.' },
    { key: 'fixedInterval', label: 'Fixed year span', description: 'Groups years into fixed spans aligned to calendar boundaries.' },
    { key: 'standardDeviation', label: 'Standard deviation', description: 'Places boundaries at one-standard-deviation intervals around the mean year.' },
    { key: 'custom', label: 'Custom boundaries', description: 'Each boundary is the last year of a class; later years form the final class.' }
];
export const DEFAULT_DISPLAY_SETTINGS = {
    mode: 'classification', parameter: 'waterSource', yearMethod: 'legacy',
    classCount: 5, interval: 10, customBreaks: [1900, 1950, 1980, 2000], colors: {}
};
const UNCLASSIFIED = 'Unclassified';
const GRAY = '#737373';
const PALETTE = ['#2563eb', '#0d9488', '#9333ea', '#ea580c', '#dc2626', '#a16207', '#0891b2', '#4f46e5', '#be185d', '#4d7c0f', '#7c3aed', '#475569'];
// Keep existing default source colours stable when a new alphabetically earlier source appears.
const SOURCE_COLORS = { HANZE: '#2563eb', NKUA: '#0d9488', CNIH: '#9333ea' };
const VALUE_ORDER = ['Riverine', 'Pluvial', 'Coastal', 'Groundwater', 'Riverine + Coastal', 'Lake'];
const MAX_INTERVAL_CLASSES = 40;

/** Never infer an undocumented axis from weather, impacts or a generic cause. */
export function classifyFloodRecord(record = {}) {
    const result = Object.fromEntries(PARAMETERS.map(({ key }) => [key, [UNCLASSIFIED]]));
    const dataset = String(record.dataset || '').trim();
    if (dataset === 'CNIH') {
        // Lookup IDs are resolved against the actual provider dictionaries during ingestion.
        // In particular, CNIH origin ID 3 is A14 (Coastal), not A13 (Groundwater).
        const codes = field => [...new Set((Array.isArray(record[field]) ? record[field] : [])
            .map(value => value?.code).filter(value => typeof value === 'string'))];
        const origin = { A11: 'Riverine', A12: 'Pluvial', A13: 'Groundwater', A14: 'Coastal', A15: 'Artificial systems' };
        const mechanisms = { A21: 'Natural exceedance', A22: 'Defence overtopping', A23: 'Defence or infrastructure failure', A24: 'Blockage' };
        const onset = { A31: 'Flash', A33: 'Other rapid onset', A34: 'Moderate onset', A35: 'Slow onset' };
        const assign = (key, sourceCodes, lookup) => {
            const values = [...new Set(sourceCodes.map(code => lookup[code]).filter(Boolean))];
            if (values.length) result[key] = values;
        };
        assign('waterSource', codes('cnih_origin'), origin);
        assign('mechanism', codes('cnih_mechanism'), mechanisms);
        const characteristics = codes('cnih_characteristics');
        assign('onset', characteristics, onset);
        if (characteristics.includes('A32')) result.process = ['Snowmelt'];
        if (characteristics.includes('A36')) result.sediment = ['Hyperconcentrated flow'];
        // Multiple origins do not alone establish interacting drivers; preserve unsupported axes.
    } else if (dataset === 'NOAA' || record.record_kind === 'reported_event') {
        const type = String(record.event_type_source ?? record.flood_type ?? '').trim();
        if (type === 'Flash Flood') result.onset = ['Flash'];
        if (type === 'Coastal Flood') result.waterSource = ['Coastal'];
        if (type === 'Lakeshore Flood') result.waterSource = ['Lake'];
        // Harmonise explicit reported/estimated cause codes, never narrative inference.
        const cause = String(record.cause_of_flood || '').trim().replace(/\s*\/\s*/g, '/').toLowerCase();
        if (['heavy rain', 'heavy rain/tropical system', 'heavy rain/burn area'].includes(cause)) result.process = ['Rainfall'];
        if (cause === 'heavy rain/snow melt') result.process = ['Rainfall', 'Snowmelt'];
        if (cause === 'snow melt') result.process = ['Snowmelt'];
        if (cause === 'ice jam') result.mechanism = ['Ice jam'];
        if (cause === 'dam/levee break') result.mechanism = ['Dam or levee failure'];
        if (cause === 'planned dam release') result.mechanism = ['Controlled reservoir release'];
        if (cause === 'heavy rain/burn area') result.setting = ['Post-fire'];
    } else if (/^NKUA\b/i.test(dataset) || record.record_kind === 'catalogue_location') {
        result.waterSource = ['Riverine'];
    } else if (/^HANZE\b/i.test(dataset) || record.record_kind === 'affected_regions') {
        const type = String(record.event_type_source ?? record.flood_type ?? '').trim();
        // HANZE defines Flash as short-duration overflow of small rivers (not pluvial flash flooding).
        if (type === 'River' || type === 'Flash') result.waterSource = ['Riverine'];
        if (type === 'Flash') result.onset = ['Flash'];
        if (type === 'Coastal') result.waterSource = ['Coastal'];
        if (type === 'River/Coastal') {
            result.waterSource = ['Riverine', 'Coastal'];
            result.compound = ['Compound'];
        }
        // v3 supplies explicit hazard profiles in addition to the historical four-type field.
        // Codes identify the provider's classes; generic cause or notes never add another axis.
        const profileCode = String(record.profile_code || '').trim().toUpperCase();
        const profileName = String(record.profile_name || record.source_profile || '').trim();
        const profileMatches = (code, name) => profileCode ? profileCode === code : profileName === name;
        if (profileMatches('MH0604', 'Fluvial (Riverine) Flooding')) result.waterSource = ['Riverine'];
        if (profileMatches('MH0603', 'Flash Flooding')) {
            result.waterSource = ['Riverine'];
            result.onset = ['Flash'];
        }
        if (profileMatches('MH0601', 'Coastal Flooding')) result.waterSource = ['Coastal'];
        if (profileMatches('MH0602', 'Estuarine (Coastal) Flooding')) {
            // In this release all estuarine profiles retain the original River/Coastal type.
            if (type === 'River/Coastal') {
                result.waterSource = ['Riverine', 'Coastal'];
                result.compound = ['Compound'];
            }
        }
        if (profileMatches('MH0610', 'Snowmelt Flooding')) result.process = ['Snowmelt'];
        if (profileMatches('MH0608', 'Ice-Jam Flooding Including Debris')) result.mechanism = ['Ice jam'];
        // “Including Debris” in the profile title does not establish debris flow for this record.
    }
    return result;
}

function normalizeValues(values) {
    const distinct = [...new Set((Array.isArray(values) ? values : []).map(value => String(value).trim()).filter(Boolean))];
    const known = distinct.filter(value => value !== UNCLASSIFIED);
    if (!known.length) return [UNCLASSIFIED];
    return known.sort((a, b) => {
        const ai = VALUE_ORDER.indexOf(a), bi = VALUE_ORDER.indexOf(b);
        if (ai >= 0 || bi >= 0) return (ai < 0 ? VALUE_ORDER.length : ai) - (bi < 0 ? VALUE_ORDER.length : bi) || a.localeCompare(b);
        return a.localeCompare(b);
    });
}

export function getClassificationLabel(record, parameterKey) {
    if (!PARAMETERS.some(({ key }) => key === parameterKey)) return UNCLASSIFIED;
    const values = record?.flood_classification?.[parameterKey] ?? classifyFloodRecord(record)[parameterKey];
    return normalizeValues(values).join(' + ');
}

export function getObservationYear(record) {
    const raw = record?.year;
    if (raw == null || (typeof raw === 'string' && !raw.trim())) return null;
    const year = Number(raw);
    return Number.isInteger(year) && year >= 1 && year <= 9999 ? year : null;
}

function parseBreaks(value) {
    if (Array.isArray(value)) return value.map(Number);
    if (typeof value === 'string') return value.trim() ? value.split(',').map(part => part.trim() ? Number(part.trim()) : NaN) : [];
    return [];
}

/** Only active controls are validated, so an unfinished inactive text field cannot block another mode. */
export function normalizeDisplaySettings(draft = {}) {
    const defaults = DEFAULT_DISPLAY_SETTINGS;
    const settings = {
        mode: draft.mode ?? defaults.mode,
        parameter: draft.parameter ?? defaults.parameter,
        yearMethod: draft.yearMethod ?? defaults.yearMethod,
        classCount: Number(draft.classCount ?? defaults.classCount),
        interval: Number(draft.interval ?? draft.fixedInterval ?? defaults.interval),
        customBreaks: parseBreaks(draft.customBreaks ?? defaults.customBreaks),
        colors: { ...(draft.colors || {}) }
    };
    if (!['classification', 'year', 'month', 'dataset'].includes(settings.mode)) throw new Error('Choose a valid colour mode.');
    if (settings.mode === 'classification' && !PARAMETERS.some(({ key }) => key === settings.parameter)) throw new Error('Choose a valid flood classification criterion.');
    if (settings.mode === 'year') {
        if (!YEAR_METHODS.some(({ key }) => key === settings.yearMethod)) throw new Error('Choose a valid year grouping method.');
        if (['jenks', 'quantile', 'equalInterval', 'standardDeviation'].includes(settings.yearMethod) && (!Number.isInteger(settings.classCount) || settings.classCount < 2 || settings.classCount > 12)) {
            throw new Error('Choose between 2 and 12 year classes.');
        }
        if (settings.yearMethod === 'fixedInterval' && (!Number.isInteger(settings.interval) || settings.interval < 1 || settings.interval > 200)) throw new Error('The year span must be a whole number between 1 and 200.');
        if (settings.yearMethod === 'custom') {
            if (!settings.customBreaks.length) throw new Error('Enter at least one class boundary year.');
            if (settings.customBreaks.length > MAX_INTERVAL_CLASSES - 1) throw new Error(`Use at most ${MAX_INTERVAL_CLASSES - 1} class boundaries.`);
            if (settings.customBreaks.some((year, index, years) => !Number.isInteger(year) || year < 1 || year > 9999 || (index > 0 && year <= years[index - 1]))) throw new Error('Class boundaries must be whole years in strictly increasing order.');
        }
    }
    // Keep the saved draft serialisable and usable when the inactive control becomes active later.
    if (!Number.isInteger(settings.classCount) || settings.classCount < 2 || settings.classCount > 12) settings.classCount = defaults.classCount;
    if (!Number.isInteger(settings.interval) || settings.interval < 1 || settings.interval > 200) settings.interval = defaults.interval;
    if (settings.mode !== 'year' || settings.yearMethod !== 'custom') {
        if (!settings.customBreaks.length || settings.customBreaks.some((year, index, years) => !Number.isInteger(year) || year < 1 || year > 9999 || (index && year <= years[index - 1]))) settings.customBreaks = [...defaults.customBreaks];
    }
    for (const color of Object.values(settings.colors)) {
        if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Choose valid six-digit hexadecimal colours.');
    }
    return settings;
}

/** Frequency-weighted Jenks over unique years: tied years always stay in the same class. */
export function jenksUpperBounds(years, requestedClasses) {
    if (!years.length) return [];
    const frequencies = new Map();
    years.forEach(year => frequencies.set(year, (frequencies.get(year) || 0) + 1));
    const values = [...frequencies.keys()].sort((a, b) => a - b);
    const n = values.length, k = Math.min(requestedClasses, n);
    const counts = [0], sums = [0], squares = [0];
    values.forEach((year, index) => {
        const count = frequencies.get(year);
        counts.push(counts[index] + count);
        sums.push(sums[index] + year * count);
        squares.push(squares[index] + year * year * count);
    });
    const cost = (start, end) => {
        const weight = counts[end] - counts[start], sum = sums[end] - sums[start];
        return Math.max(0, squares[end] - squares[start] - sum * sum / weight);
    };
    const dp = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity));
    const previous = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0));
    dp[0][0] = 0;
    for (let classes = 1; classes <= k; classes++) {
        for (let end = classes; end <= n; end++) {
            for (let start = classes - 1; start < end; start++) {
                const candidate = dp[classes - 1][start] + cost(start, end);
                if (candidate < dp[classes][end]) {
                    dp[classes][end] = candidate;
                    previous[classes][end] = start;
                }
            }
        }
    }
    const cuts = [];
    let end = n;
    for (let classes = k; classes > 1; classes--) {
        const start = previous[classes][end];
        cuts.unshift(values[start - 1]);
        end = start;
    }
    return cuts;
}

export function getYearSummary(records) {
    const years = records.map(getObservationYear).filter(year => year !== null).sort((a, b) => a - b);
    if (!years.length) return { count: 0, min: null, max: null, mean: null, median: null, standardDeviation: null };
    const mean = years.reduce((sum, year) => sum + year, 0) / years.length;
    const middle = Math.floor(years.length / 2);
    return {
        count: years.length, min: years[0], max: years[years.length - 1], mean,
        median: years.length % 2 ? years[middle] : (years[middle - 1] + years[middle]) / 2,
        standardDeviation: Math.sqrt(years.reduce((sum, year) => sum + (year - mean) ** 2, 0) / years.length)
    };
}

/** All boundaries are upper-inclusive integer years; the next class begins at boundary + 1. */
export function buildYearClasses(records, settings) {
    const years = records.map(getObservationYear).filter(year => year !== null).sort((a, b) => a - b);
    const min = years[0], max = years[years.length - 1];
    if (!years.length) return [];
    if (settings.yearMethod === 'legacy') return [
        { key: 'recent', label: max >= 2000 ? `2000–${max}` : '2000 onward', min: 2000, max: Infinity, color: '#dc2626', border: '#f87171' },
        { key: 'late20c', label: '1980–1999', min: 1980, max: 1999, color: '#f97316', border: '#fdba74' },
        { key: 'historic', label: min <= 1979 ? `${min}–1979` : 'Up to 1979', min: -Infinity, max: 1979, color: '#0d9488', border: '#5eead4' }
    ];
    if (['decades', 'fixedInterval'].includes(settings.yearMethod)) {
        const interval = settings.yearMethod === 'decades' ? 10 : settings.interval;
        const start = Math.floor(min / interval) * interval;
        const count = Math.floor((max - start) / interval) + 1;
        if (count > MAX_INTERVAL_CLASSES) throw new Error(`This span creates ${count} year classes. Increase the span to use at most ${MAX_INTERVAL_CLASSES} classes.`);
        return Array.from({ length: count }, (_, index) => {
            const low = start + index * interval, high = low + interval - 1;
            return { key: `year:${settings.yearMethod}:${low}:${high}`, label: low === high ? String(low) : `${low}–${high}`, min: index ? low : -Infinity, max: index === count - 1 ? Infinity : high };
        });
    }
    const uniqueCount = new Set(years).size;
    const classCount = Math.min(settings.classCount, uniqueCount);
    let cuts = [];
    if (settings.yearMethod === 'custom') {
        if (settings.customBreaks.some(year => year < min || year >= max)) throw new Error(`Class boundaries must be between ${min} and ${max - 1}, within the loaded catalogue.`);
        cuts = settings.customBreaks;
    } else if (settings.yearMethod === 'jenks') {
        cuts = jenksUpperBounds(years, classCount);
    } else if (settings.yearMethod === 'quantile') {
        for (let index = 1; index < classCount; index++) cuts.push(years[Math.ceil(index * years.length / classCount) - 1]);
    } else if (settings.yearMethod === 'equalInterval') {
        for (let index = 1; index < classCount; index++) cuts.push(Math.floor(min + (max - min) * index / classCount));
    } else if (settings.yearMethod === 'standardDeviation') {
        const { mean, standardDeviation } = getYearSummary(records);
        for (let index = 1; index < classCount; index++) cuts.push(Math.floor(mean + (index - classCount / 2) * standardDeviation));
    }
    cuts = [...new Set(cuts.filter(year => Number.isInteger(year) && year >= min && year < max))].sort((a, b) => a - b);
    return [...cuts, max].map((high, index) => {
        const low = index ? cuts[index - 1] + 1 : min;
        return {
            key: `year:${settings.yearMethod}:${low}:${high}`, label: low === high ? String(low) : `${low}–${high}`,
            min: index ? low : -Infinity, max: index === cuts.length ? Infinity : high
        };
    });
}

function categoricalLabel(record, settings) {
    if (settings.mode === 'month') return MONTH_NAMES[Number(record?.month) - 1] || UNCLASSIFIED;
    if (settings.mode === 'dataset') return String(record?.dataset || '').trim() || UNCLASSIFIED;
    return getClassificationLabel(record, settings.parameter);
}

function chronologicalColor(index, count) {
    // Light-to-dark blue encodes increasing observation years without repeating a qualitative palette.
    const start = [198, 219, 239], end = [8, 48, 107];
    const position = count > 1 ? index / (count - 1) : 0.55;
    return `#${start.map((channel, axis) => Math.round(channel + (end[axis] - channel) * position).toString(16).padStart(2, '0')).join('')}`;
}

/** Build from the full catalogue, once per settings change, so filtering never shifts colours or boundaries. */
export function createDisplayModel(records = [], draft = DEFAULT_DISPLAY_SETTINGS) {
    const settings = normalizeDisplaySettings(draft);
    let categories;
    if (settings.mode === 'year') categories = buildYearClasses(records, settings);
    else if (settings.mode === 'month') categories = MONTH_NAMES.map((label, index) => ({
        key: `month:${index + 1}`, label
    }));
    else {
        const labels = [...new Set(records.map(record => categoricalLabel(record, settings)))].filter(label => label !== UNCLASSIFIED);
        labels.sort((a, b) => {
            const ai = VALUE_ORDER.indexOf(a), bi = VALUE_ORDER.indexOf(b);
            return (ai < 0 ? VALUE_ORDER.length : ai) - (bi < 0 ? VALUE_ORDER.length : bi) || a.localeCompare(b);
        });
        categories = labels.map(label => ({
            key: `${settings.mode}:${settings.mode === 'classification' ? settings.parameter : 'source'}:${encodeURIComponent(label)}`,
            label, ...(settings.mode === 'dataset' && SOURCE_COLORS[label] ? { color: SOURCE_COLORS[label] } : {})
        }));
    }
    const yearCategoryCount = categories.length;
    const useYearRamp = settings.mode === 'year' && settings.yearMethod !== 'legacy';
    categories = [...categories, { key: 'unclassified', label: settings.mode === 'month' ? 'Unknown month' : UNCLASSIFIED, color: GRAY, border: '#a3a3a3' }].map((category, index) => ({
        ...category, id: category.key, color: settings.colors[category.key] || category.color || (useYearRamp ? chronologicalColor(index, yearCategoryCount) : PALETTE[index % PALETTE.length]),
        border: category.border || '#d4d4d4', count: 0, totalCount: 0, visible: true
    }));
    const unclassified = categories[categories.length - 1];
    const labelLookup = new Map(categories.map(category => [category.label, category]));
    const categoryForRecord = record => {
        if (settings.mode !== 'year') return labelLookup.get(categoricalLabel(record, settings)) || unclassified;
        const year = getObservationYear(record);
        if (year === null) return unclassified;
        return categories.find(category => category.key !== 'unclassified' && year >= category.min && year <= category.max) || unclassified;
    };
    records.forEach(record => categoryForRecord(record).totalCount++);
    return { settings, categories, categoryForRecord };
}

/** Split a reviewed pin only when its source records belong to different display categories. */
export function groupDisplayRecords(records, categoryForRecord) {
    const groups = new Map();
    records.forEach(record => {
        const category = categoryForRecord(record);
        const pinId = record.event_pin_id ?? record.id;
        const key = JSON.stringify([category.key, pinId]);
        let group = groups.get(key);
        if (!group) {
            group = { ...record, source_record_count: 0, source_record_ids: [], _displayCategoryKey: category.key, regional_records: [...(record.regional_records || [])] };
            groups.set(key, group);
        } else if (record.record_kind === 'affected_regions') group.regional_records.push(record);
        group.source_record_count++;
        group.source_record_ids.push(record.id);
    });
    return [...groups.values()];
}
