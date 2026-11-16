import { applyFloodClassification, CLASSIFICATION_FIELDS } from './recordValues.js?v=20261004-cnih-1';

const ROOT = new URL('../../data/noaa/storm-events/20261004/', import.meta.url);
const BULK = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
const TERRITORIES = {
    'PUERTO RICO': 'Puerto Rico', 'VIRGIN ISLANDS': 'U.S. Virgin Islands',
    GUAM: 'Guam', 'AMERICAN SAMOA': 'American Samoa'
};
const classificationCache = new Map();
const titleCase = value => String(value || '').toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
const numeric = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

export function damageUsd(value) {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
    return match ? Number(match[1]) * ({ K: 1000, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] || 1) : null;
}

export async function readGzipJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('NOAA source file could not be loaded');
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Fetch may already decode gzip when a server supplies Content-Encoding.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}

export function mapNoaaRecord(p, sourceFileUrl = '') {
    const type = p.EVENT_TYPE;
    const cause = p.FLOOD_CAUSE || null;
    const classificationKey = `${type}\0${cause || ''}`;
    if (!classificationCache.has(classificationKey)) {
        const classified = applyFloodClassification({ dataset: 'NOAA', record_kind: 'reported_event', flood_type: type, cause_of_flood: cause });
        classificationCache.set(classificationKey, {
            flood_classification: classified.flood_classification,
            ...Object.fromEntries(CLASSIFICATION_FIELDS.map(({ key }) => [key, classified[key]]))
        });
    }
    const start = p._BEGIN_DATE;
    const end = p._END_DATE;
    const state = titleCase(p.STATE);
    const area = titleCase(p.CZ_NAME);
    const place = titleCase(p._MAP_LOCATION || p.BEGIN_LOCATION || p.CZ_NAME);
    const direct = numeric(p.DEATHS_DIRECT), indirect = numeric(p.DEATHS_INDIRECT);
    return {
        id: `noaa-${p.EVENT_ID}`, source_record_id: p.EVENT_ID, source_episode_id: p.EPISODE_ID,
        dataset: 'NOAA', record_kind: 'reported_event', source_release: 'NCEI snapshot · 4 October 2026',
        country: TERRITORIES[p.STATE] || 'United States', state_name: state,
        administrative_area: area, administrative_area_type: ({ C: 'County / parish', Z: 'Forecast zone', M: 'Marine zone' })[p.CZ_TYPE] || p.CZ_TYPE,
        year: numeric(p.YEAR), date_of_commencement: start, end_date: end,
        date_interval: [start?.replace('T', ' '), end && end !== start ? end.replace('T', ' ') : null].filter(Boolean).join(' – '),
        date_timezone: p.CZ_TIMEZONE || null,
        flood_type: type, event_type_source: type, cause_of_flood: cause,
        latitude: p._MAP_LAT, longitude: p._MAP_LON,
        location_name: `${place}, ${state}`,
        flood_event_name: `${type} · ${area}, ${state} · ${start?.slice(0, 10) || p.YEAR}`,
        deaths_direct: direct, deaths_indirect: indirect,
        deaths_toll_int: direct !== null && indirect !== null ? direct + indirect : null,
        injuries_direct: numeric(p.INJURIES_DIRECT), injuries_indirect: numeric(p.INJURIES_INDIRECT),
        damage_property: p.DAMAGE_PROPERTY || null, damage_crops: p.DAMAGE_CROPS || null,
        damage_property_usd: damageUsd(p.DAMAGE_PROPERTY), damage_crops_usd: damageUsd(p.DAMAGE_CROPS),
        report_source: p.SOURCE || null, source_file_url: sourceFileUrl,
        reference: 'https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc:C00510/html',
        license: 'U.S. government data; NOAA usage terms',
        counting_unit: 'NOAA event report for a county or forecast zone; several reports can belong to one storm episode.',
        marker_location_basis: p._MAP_BASIS || 'NOAA does not provide coordinates for this report.',
        classification_basis: 'Event type and explicit NOAA flood-cause field. Causes are reported or estimated; classification axes are harmonised in this WebGIS.',
        ...classificationCache.get(classificationKey)
    };
}

export default class NoaaData {
    constructor() {
        this.records = [];
        this.byId = new Map();
        this.details = new Map();
    }

    async init() {
        const [index, manifest] = await Promise.all([
            readGzipJson(new URL('map-records.json.gz', ROOT)),
            fetch(new URL('manifest.json', ROOT)).then(response => {
                if (!response.ok) throw new Error('NOAA provenance could not be loaded');
                return response.json();
            })
        ]);
        this.manifest = manifest;
        const sourceByYear = new Map(manifest.source_files.flatMap(file => {
            const match = file.name.match(/^StormEvents_details.*_d(\d{4})_/);
            return match ? [[Number(match[1]), file.url]] : [];
        }));
        for (let offset = 0; offset < index.records.length; offset += 4000) {
            for (const row of index.records.slice(offset, offset + 4000)) {
                const raw = Object.fromEntries(index.columns.map((column, position) => [column, row[position]]));
                this.records.push(mapNoaaRecord(raw, sourceByYear.get(Number(raw.YEAR))));
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        this.byId = new Map(this.records.map(record => [record.id, record]));
        if (this.byId.size !== index.record_count) throw new Error('NOAA record index is incomplete or contains duplicate IDs');
        return this.records;
    }

    async fetchDetails(id) {
        const record = this.byId.get(String(id));
        if (!record) throw new Error('NOAA report not found');
        const year = record.year;
        let request = this.details.get(year);
        if (request) this.details.delete(year);
        else request = readGzipJson(new URL(`details/${year}.json.gz`, ROOT));
        this.details.set(year, request);
        while (this.details.size > 2) this.details.delete(this.details.keys().next().value);
        const data = await request.catch(error => { this.details.delete(year); throw error; });
        const detail = data.records[record.source_record_id];
        if (!detail) throw new Error('NOAA report detail is unavailable');
        return {
            ...record, event_narrative: detail.original.EVENT_NARRATIVE || null,
            episode_narrative: detail.original.EPISODE_NARRATIVE || null,
            reported_locations: detail.locations, original_fields: detail.original,
            source_file_url: BULK + data.source_details_file
        };
    }
}
