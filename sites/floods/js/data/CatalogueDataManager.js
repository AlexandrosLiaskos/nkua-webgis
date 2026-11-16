import DataManager from './DataManager.js';
import { getFloodMonth } from './monthValues.js?v=20261013-month-1';
import NoaaData from './NoaaData.js?v=20261004-cnih-1';
import CnihData from './CnihData.js?v=20261004-cnih-1';
import { mapHanzeRecord, hasRecordValue, applyFloodClassification, CLASSIFICATION_FIELDS } from './recordValues.js?v=20261004-cnih-1';

// Previous impact release: ../../data/hanze/v2.1.1/map-records.json (retained on disk).
const INDEX_URLS = ['v3.0.1-beta', 'historical-list-b/v1.2'].map(release =>
    new URL(`../../data/hanze/${release}/map-records.json?v=20261004-hanze-list-b-1`, import.meta.url));
const RECONCILIATION_URL = new URL('../../data/event-reconciliation.json?v=20260905-6', import.meta.url);
const GREEK = 'NKUA';
// Catalogue-scope classification only; NKUA's other parameters remain unclassified.
const NKUA_FLOOD_TYPE = 'Riverine';
const FIELDS = {
    month: ['month', 'months'], year: ['year', 'years'], location: ['location_name', 'locations'],
    deathsToll: ['deaths_toll_int', 'deathsToll'], eventName: ['flood_event_name', 'eventNames'],
    country: ['country', 'countries'], dataset: ['dataset', 'datasets'], floodType: ['flood_type', 'floodTypes'],
    ...Object.fromEntries(CLASSIFICATION_FIELDS.map(({ key, optionsKey }) => [key, [key, optionsKey]]))
};

/** Use the existing marker/filter/modal flow for each enabled source catalogue. */
export default class CatalogueDataManager extends DataManager {
    constructor(eventBus, cacheManager, stateManager) {
        super(eventBus, cacheManager, stateManager);
        this.greek = new DataManager({ emit: (name, payload) => {
            if (name === 'data:error') eventBus.emit(name, payload);
        } }, cacheManager, { set() {} });
        this.greekRecords = [];
        this.hanzeRecords = [];
        this.hanzeById = new Map();
        // CNIH is preserved but inactive: a peer-reviewed validation study is required.
        this.cnihEnabled = false;
        this.cnih = new CnihData();
        this.cnihRecords = [];
        // NOAA is retained for future use, pending record-level evidence of flood occurrence.
        this.noaaEnabled = false;
        this.noaa = new NoaaData();
        this.noaaRecords = [];
        this.reconciliation = { groups: [], enrichments: {} };
    }

    async init() {
        const response = await fetch(RECONCILIATION_URL);
        if (!response.ok) throw new Error('Reviewed event links could not be loaded');
        this.reconciliation = await response.json();
        const sources = [
            { name: 'NKUA', availability: 'greekAvailable', load: () => this.loadGreek() },
            { name: 'HANZE', availability: 'hanzeAvailable', load: () => this.loadHanze() },
            ...(this.cnihEnabled ? [{ name: 'CNIH', availability: 'cnihAvailable', load: () => this.loadCnih() }] : []),
            ...(this.noaaEnabled ? [{ name: 'NOAA', availability: 'noaaAvailable', load: () => this.loadNoaa() }] : [])
        ];
        this.cnihAvailable = false;
        this.noaaAvailable = false;
        const outcomes = await Promise.allSettled(sources.map(source => source.load()));
        const unavailable = [];
        sources.forEach((source, index) => {
            this[source.availability] = outcomes[index].status === 'fulfilled' && outcomes[index].value !== false;
            if (!this[source.availability]) unavailable.push(source.name);
        });
        if (unavailable.length) {
            this.eventBus.emit('catalogue:partial', {
                message: `${unavailable.join(', ')} could not be loaded. Showing the available catalogue records.`
            });
        }
        return sources.some(source => this[source.availability]);
    }

    async loadGreek() {
        if (!await this.greek.init()) return false;
        const [records, months] = await Promise.all([this.greek.fetchFloodData({}), this.getGreekMonths()]);
        this.greekRecords = records.map(record => applyFloodClassification({
            ...record, month: months.get(String(record.id)) ?? null,
            event_pin_id: this.reconciliation.groups.find(group => group.record_ids.includes(record.id))?.record_ids[0] ?? record.id,
            country: 'Greece', dataset: GREEK, flood_type: NKUA_FLOOD_TYPE, record_kind: 'catalogue_location'
        }));
        return true;
    }

    async loadHanze() {
        const outcomes = await Promise.allSettled(INDEX_URLS.map(async url => {
            const response = await fetch(url);
            if (!response.ok) throw new Error('HANZE map index unavailable');
            const index = await response.json();
            return index.records.map(mapHanzeRecord);
        }));
        const available = outcomes.filter(result => result.status === 'fulfilled');
        if (!available.length) throw new Error('HANZE map indexes unavailable');
        // Same original IDs must not be silently merged; promotions need source-level review.
        const records = available.flatMap(result => result.value).map(record => ({
            ...record, month: getFloodMonth(record.date_of_commencement)
        }));
        const byId = new Map(records.map(record => [record.id, record]));
        if (byId.size !== records.length) throw new Error('Duplicate HANZE source record IDs');
        this.hanzeRecords = records;
        this.hanzeById = byId;
        if (available.length !== INDEX_URLS.length) {
            this.eventBus.emit('catalogue:partial', {
                message: 'Some HANZE records could not be loaded. Showing the available catalogue records.'
            });
        }
    }

    async loadNoaa() {
        if (!this.noaaEnabled) return;
        this.noaaRecords = await this.noaa.init();
    }

    async loadCnih() {
        if (!this.cnihEnabled) return;
        this.cnihRecords = await this.cnih.init();
    }

    async getGreekMonths() {
        if (!this.greekMonths) {
            const rows = await this.greek.fetchAllRecords(this.greek.supabase.rpc('api_floods_months'));
            this.greekMonths = new Map(rows.map(record => [String(record.id), record.month]));
        }
        return this.greekMonths;
    }

    greekFilters(filters) {
        return Object.fromEntries(['year', 'location', 'deathsToll', 'eventName'].filter(key => filters[key] !== undefined && filters[key] !== null && filters[key] !== '').map(key => [key, filters[key]]));
    }

    // A filter may hold several values (multi-select); a record matches any of them.
    matchesFilters(record, filters) {
        return Object.entries(filters).every(([key, value]) => {
            const field = FIELDS[key]?.[0];
            return !field || window.NkuaWebGISUI.matchesFilterValue(record[field], value);
        });
    }

    filterHanze(filters) {
        return this.hanzeRecords.filter(record => this.matchesFilters(record, filters));
    }

    async fetchFloodData(filters = {}) {
        const greek = this.greekRecords.filter(record => this.matchesFilters(record, filters));
        let rows = [
            ...greek,
            ...this.filterHanze(filters),
            ...this.cnihRecords.filter(record => this.matchesFilters(record, filters)),
            ...this.noaaRecords.filter(record => this.matchesFilters(record, filters))
        ];
        // The reviewed Mandra context is already included in its NKUA detail card.
        // Keep one pin when both records are visible, and retain the HANZE pin when filtered alone.
        const visibleNkuaIds = new Set(greek.map(record => Number(record.id)));
        for (const [id, enrichment] of Object.entries(this.reconciliation.enrichments)) {
            const regionalId = enrichment.regional_context?.source_event_id;
            if (!regionalId || !visibleNkuaIds.has(Number(id))) continue;
            const index = rows.findIndex(record => record.id === `hanze-${regionalId}`);
            if (index !== -1) rows[index] = { ...rows[index], event_pin_id: Number(id) };
        }
        if (this.lasso) rows = this.lasso.filter(rows, record => [record.latitude, record.longitude]);
        this.stateManager.set('currentData', rows);
        this.eventBus.emit('data:loaded', { data: rows, filters, count: rows.length });
        return rows;
    }

    calculateOptionsFromData(data) {
        return { ...super.calculateOptionsFromData(data),
            months: this.getUniqueValues(data, 'month').sort((a, b) => a - b),
            countries: this.getUniqueValues(data, 'country'),
            datasets: this.getUniqueValues(data, 'dataset'),
            floodTypes: this.getUniqueValues(data, 'flood_type'),
            ...Object.fromEntries(CLASSIFICATION_FIELDS.map(({ key, optionsKey }) => [optionsKey, this.getUniqueValues(data, key)])) };
    }

    mergeOptions(left, right) {
        const merged = {};
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
            merged[key] = [...new Set([...(left[key] || []), ...(right[key] || [])])].sort((a, b) =>
                typeof a === 'number' && typeof b === 'number' ? (['months', 'deathsToll'].includes(key) ? a - b : b - a) : String(a).localeCompare(String(b)));
        }
        return merged;
    }

    async fetchFilterOptions(filters = {}) {
        const records = this.catalogueRecords ||= [...this.greekRecords, ...this.hanzeRecords, ...this.cnihRecords, ...this.noaaRecords];
        this.allOptions ||= this.calculateOptionsFromData(records);
        const active = Object.entries(FIELDS).filter(([key]) => filters[key] !== undefined && filters[key] !== null && filters[key] !== '');
        let options = this.allOptions;
        if (active.length) {
            const entries = Object.entries(FIELDS);
            const values = new Map(entries.map(([key]) => [key, new Set()]));
            const matching = [];
            for (const record of records) {
                const mismatches = [];
                for (const [key, [field]] of active) {
                    if (!window.NkuaWebGISUI.matchesFilterValue(record[field], filters[key])) mismatches.push(key);
                    if (mismatches.length > 1) break;
                }
                if (mismatches.length > 1) continue;
                if (!mismatches.length) matching.push(record);
                for (const [key, [field]] of entries) {
                    if (mismatches.length && mismatches[0] !== key) continue;
                    const raw = record[field];
                    const value = typeof raw === 'string' ? raw.trim() : raw;
                    if (value !== undefined && value !== null && value !== '') values.get(key).add(value);
                }
            }
            options = { causeOfFlood: this.getUniqueValues(matching, 'cause_of_flood') };
            for (const [key, [field, optionsKey]] of entries) {
                options[optionsKey] = [...values.get(key)].sort((a, b) =>
                    typeof a === 'number' && typeof b === 'number' ? (['month', 'deaths_toll_int'].includes(field) ? a - b : b - a) : String(a).localeCompare(String(b)));
            }
        }
        this.eventBus.emit('filterOptions:loaded', { options, allOptions: this.allOptions, selectedFilters: filters });
        return options;
    }

    async fetchFloodDetails(id) {
        if (String(id).startsWith('cnih-')) {
            if (!this.cnihEnabled) throw new Error('CNIH is not active in this catalogue');
            return this.cnih.fetchDetails(id);
        }
        if (String(id).startsWith('noaa-')) {
            if (!this.noaaEnabled) throw new Error('NOAA is not active in this catalogue');
            return this.noaa.fetchDetails(id);
        }
        if (this.hanzeById.has(String(id))) return this.hanzeById.get(String(id));
        if (!Number.isInteger(Number(id))) throw new Error('Source record not found');
        const group = this.reconciliation.groups.find(item => item.record_ids.includes(Number(id)));
        const ids = group?.record_ids || [Number(id)];
        const observations = await Promise.all(ids.map(recordId => this.greek.fetchFloodDetails(recordId)));
        const record = { ...observations[0], country: 'Greece', dataset: GREEK, flood_type: NKUA_FLOOD_TYPE, record_kind: 'catalogue_location' };
        if (group) {
            record.source_record_ids = ids.join(', ');
            record.source_citations = observations.filter(row => hasRecordValue(row.source)).map(row => ({
                label: `NKUA record ${row.id}`, title: row.source, url: row.source
            }));
            record.field_observations = {};
            for (const key of Object.keys(record)) {
                if (['id', 'source', 'reference'].includes(key)) continue;
                const values = observations.filter(row => hasRecordValue(row[key])).map(row => ({ value: row[key], record_id: row.id }));
                if (new Set(values.map(item => String(item.value).trim())).size > 1) record.field_observations[key] = values;
                else if (values.length) record[key] = values[0].value;
            }
            record.source = null;
        }
        const enrichment = this.reconciliation.enrichments[String(record.id)];
        if (enrichment) {
            record.enrichment = enrichment;
            record.date_interval = enrichment.reported_interval;
            if (enrichment.regional_context) record.regional_context = mapHanzeRecord(enrichment.regional_context);
        }
        return applyFloodClassification(record);
    }

    invalidateCache() {
        super.invalidateCache();
        this.greek.invalidateCache();
        this.cnih.invalidateCache();
        this.catalogueRecords = null;
        this.greekMonths = null;
    }
}
