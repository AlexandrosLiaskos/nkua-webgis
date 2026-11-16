import { mapCnihRecord } from './recordValues.js?v=20261004-cnih-1';

const INDEX_URL = new URL('../../data/cnih/v27-20261004/map-records.json', import.meta.url);

/** CNIH basin-event records and immutable, lazily loaded source-detail shards. */
export default class CnihData {
    constructor() {
        this.records = [];
        this.byId = new Map();
        this.detailShards = new Map();
        this.source = null;
    }

    async init() {
        const response = await fetch(INDEX_URL);
        if (!response.ok) throw new Error('CNIH catalogue index unavailable');
        const index = await response.json();
        if (!Array.isArray(index.records)) throw new Error('CNIH catalogue index is invalid');
        const records = index.records.map(record => mapCnihRecord({
            source_url: index.source?.url,
            source_release: index.source?.source_release || index.source?.release || index.source?.version,
            license: index.source?.license,
            license_url: index.source?.license_url || index.source?.terms_url,
            ...record
        }));
        const byId = new Map(records.map(record => [record.id, record]));
        if (byId.size !== records.length) throw new Error('Duplicate CNIH source event codes');
        this.source = index.source || null;
        this.records = records;
        this.byId = byId;
        this.detailShards.clear();
        return records;
    }

    async loadDetailsFile(file) {
        // Shard paths come from the published index, never user-entered URLs or IDs.
        if (typeof file !== 'string' || !/^details\/[A-Za-z0-9_-]+\.json$/.test(file)) {
            throw new Error('CNIH detail file is invalid');
        }
        if (!this.detailShards.has(file)) {
            const request = fetch(new URL(file, INDEX_URL))
                .then(response => {
                    if (!response.ok) throw new Error('CNIH source details unavailable');
                    return response.json();
                })
                .then(shard => {
                    if (!shard.records || Array.isArray(shard.records) || typeof shard.records !== 'object') {
                        throw new Error('CNIH source detail file is invalid');
                    }
                    return shard.records;
                })
                .catch(error => {
                    this.detailShards.delete(file);
                    throw error;
                });
            this.detailShards.set(file, request);
        }
        return this.detailShards.get(file);
    }

    async fetchDetails(id) {
        const record = this.byId.get(String(id));
        if (!record) throw new Error('CNIH source event not found');
        const shard = await this.loadDetailsFile(record.details_file);
        const code = String(record.source_event_id);
        if (!Object.hasOwn(shard, code)) throw new Error('CNIH source event details not found');
        const details = shard[code];
        return mapCnihRecord({ ...record, ...details,
            source_event_id: record.source_event_id, source_record_id: record.source_record_id,
            details_file: record.details_file,
            source_data_url: new URL(record.details_file, INDEX_URL).href
        });
    }

    invalidateCache() {
        this.detailShards.clear();
    }
}
