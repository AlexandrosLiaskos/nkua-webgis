import { classifyFloodRecord } from '../map/FloodClassification.js?v=20261004-cnih-1';

export const CLASSIFICATION_FIELDS = [
    { key: 'waterSource', label: 'Water source', optionsKey: 'waterSources', inputId: 'water-source-filter' },
    { key: 'onset', label: 'Onset / response', optionsKey: 'onsets', inputId: 'onset-filter' },
    { key: 'process', label: 'Generating process', optionsKey: 'processes', inputId: 'process-filter' },
    { key: 'mechanism', label: 'Inundation mechanism', optionsKey: 'mechanisms', inputId: 'mechanism-filter' },
    { key: 'sediment', label: 'Sediment behaviour', optionsKey: 'sediments', inputId: 'sediment-filter' },
    { key: 'setting', label: 'Setting', optionsKey: 'settings', inputId: 'setting-filter' },
    { key: 'compound', label: 'Interacting drivers', optionsKey: 'compounds', inputId: 'compound-filter' }
];

export function applyFloodClassification(record) {
    const flood_classification = classifyFloodRecord(record);
    const fields = Object.fromEntries(CLASSIFICATION_FIELDS.map(({ key }) => [
        key, flood_classification[key]?.length ? flood_classification[key].join(' + ') : 'Unclassified'
    ]));
    return { ...record, flood_classification, ...fields };
}

// The Greek catalogue uses underscores for missing values. Zero is an observation.
export function hasRecordValue(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(hasRecordValue);
    if (typeof value === 'number') return Number.isFinite(value);
    return !/^(?:\s*|[_–—-]+)$/u.test(String(value).trim());
}

export function hasValidCoordinates(record) {
    if (!hasRecordValue(record?.latitude) || !hasRecordValue(record?.longitude)) return false;
    const latitude = Number(record.latitude), longitude = Number(record.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
        && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function mapHanzeRecord(p) {
    // Region vintages and price bases belong to their release; never relabel old values.
    const regionVintage = hasRecordValue(p.regions_2024) ? 2024 : 2021;
    const regions = String(p[`regions_${regionVintage}`] || '').split(';')
        .map(region => region.trim().replace(/^[A-Z]{2}[A-Z0-9]{3}\s+/, ''))
        .filter(Boolean);
    const otherRegions = regions.length - 1;
    const eventName = (regions[0] || p.country_name_source) + (otherRegions > 0
        ? ` +${otherRegions} ${otherRegions === 1 ? 'region' : 'regions'}` : '');
    const dateInterval = hasRecordValue(p.start_date) && hasRecordValue(p.end_date) && p.end_date !== p.start_date
        ? `${p.start_date} – ${p.end_date}`
        : hasRecordValue(p.start_date) ? p.start_date : hasRecordValue(p.end_date) ? p.end_date : null;
    return applyFloodClassification({
        id: `hanze-${p.source_event_id}`, source_record_id: p.source_event_id,
        country: p.country_name_source, dataset: 'HANZE', flood_type: p.event_type_source,
        source_release: p.source_release || 'Flood-impact database v2.1.1',
        source_list: p.source_list || null,
        impact_availability_note: p.impact_availability_note || null,
        event_type_source: p.event_type_source, country_code_source: p.country_code_source,
        profile_code: p.profile_code || null, profile_name: p.profile_name || null,
        source_profile: p.profile_name || null,
        traceability: p.traceability || null,
        traceability_meaning: p.traceability_meaning || null,
        source_fields: p.source_fields || null,
        entry_date: p.entry_date || null, last_update: p.last_update || null, changes: p.changes || null,
        latitude: p.display_anchor?.latitude, longitude: p.display_anchor?.longitude,
        year: p.year, date_of_commencement: p.start_date, end_date: p.end_date,
        date_interval: dateInterval,
        date_qualification: p.date_qualification || (String(p.date_precision).includes('source_explicitly_approximate')
            ? 'Approximate dates; see source notes' : null),
        location_name: regions.join('; '),
        region_vintage: regionVintage,
        regions_2024: p.regions_2024, regions_2021: p.regions_2021, regions_2010: p.regions_2010,
        flood_event_name: eventName,
        deaths_toll_int: p.fatalities_including_missing_presumed_dead,
        flood_sources: p.flood_sources, cause: p.cause, cause_of_flood: p.cause, relevant_information: p.notes,
        source: p.references, source_citations: p.source_citations,
        reference: p.source_url, publication: `https://doi.org/${p.publication_doi}`,
        geometry_role: 'Affected administrative regions; not an inundation footprint',
        marker_location_basis: 'Display point inside an affected region, not an observed flood location.',
        counting_unit: 'Regional source record; may cover part of a wider flood episode',
        related_records: p.possible_related_record_ids?.map(id => String(id).replace('P1-HANZE-', 'HANZE ')).join(', ') || null,
        persons_affected: p.persons_affected, reported_inundated_area_km2: p.reported_inundated_area_km2,
        losses_nominal: p.losses_nominal, currency: p.currency,
        losses_2025_eur: p.losses_2025_eur, losses_2020_eur: p.losses_2020_eur,
        geometry_file: p.geometry_file ? `${p.geometry_root || 'v2.1.1'}/${p.geometry_file}` : null,
        geometry_feature_id: p.geometry_feature_id,
        license: p.license, record_kind: 'affected_regions'
    });
}

/** Keep CNIH basin-event identity and native classifications independent of HANZE. */
export function mapCnihRecord(p) {
    const code = String(p.source_event_id ?? p.source_fields?.CE_COD_EVENTO ?? '').trim();
    if (!code) throw new Error('CNIH source event code is missing');
    const native = key => Array.isArray(p[key]) ? p[key] : [];
    const municipalities = Array.isArray(p.municipalities) ? p.municipalities : [];
    const names = [...new Set(municipalities.map(value => value.name).filter(hasRecordValue))];
    const location = p.location_name || (names.length ? names.slice(0, 3).join('; ')
        + (names.length > 3 ? ` +${names.length - 3} municipalities` : '') : p.basin_name);
    const year = hasRecordValue(p.year) ? Number(p.year) : null;
    const monthOnly = String(p.date_display || '').match(/^00\/(\d{2})\/(\d{4})$/);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const knownYear = Number.isInteger(year) && year > 0 && year <= 9999;
    let dateDisplay = p.date_display || p.date_interval || p.start_date || null;
    if (['reported_year', 'partial_or_invalid'].includes(p.date_precision)) dateDisplay = knownYear ? String(year) : null;
    else if (p.date_precision === 'reported_month') dateDisplay = monthOnly && months[Number(monthOnly[1]) - 1]
        ? `${months[Number(monthOnly[1]) - 1]} ${monthOnly[2]}` : knownYear ? String(year) : null;
    else if (p.date_precision === 'reported_day' && p.start_date) dateDisplay = p.start_date;
    return applyFloodClassification({
        ...p,
        id: `cnih-${code}`, source_event_id: code,
        source_record_id: p.source_record_id ?? null,
        dataset: 'CNIH', record_kind: 'historical_event', country: p.country_name_source || p.country || 'Spain',
        country_code_source: p.country_code_source || 'ES',
        source_release: p.source_release || 'CNIH v27',
        year: Number.isInteger(year) && year >= 1 && year <= 9999 ? year : null,
        date_of_commencement: p.start_date || p.date_of_commencement || null,
        end_date: p.end_date || null,
        date_interval: dateDisplay,
        source_date: p.source_fields?.CE_INICIO ?? p.source_date ?? p.date_display ?? null,
        date_qualification: p.date_qualification || null,
        duration_days: p.duration_days ?? null,
        cnih_origin: native('cnih_origin'), cnih_mechanism: native('cnih_mechanism'),
        cnih_characteristics: native('cnih_characteristics'),
        flood_type: p.flood_type || native('cnih_characteristics').map(value => value.label).filter(hasRecordValue).join(' + ') || null,
        flood_event_name: p.event_name || p.flood_event_name || p.source_fields?.CE_NOMBRE_EVENTO || `CNIH ${code}`,
        location_name: location || null,
        latitude: p.display_anchor?.latitude ?? p.latitude ?? null,
        longitude: p.display_anchor?.longitude ?? p.longitude ?? null,
        marker_location_basis: p.marker_location_basis || p.display_anchor_basis
            || 'CNIH identifies affected areas; the event record does not provide an observed flood location.',
        counting_unit: p.counting_unit || 'Basin-event source record; may describe part of a wider flood episode.',
        deaths_toll_int: p.deaths_toll_int ?? null,
        persons_affected: p.persons_affected ?? null,
        cause_of_flood: p.cause_of_flood || null,
        relevant_information: p.relevant_information || p.description || p.source_fields?.CE_DESCRIPCION || null,
        reported_affected_area_km2: p.reported_affected_area_km2 ?? null,
        source_reference_count: p.source_reference_count ?? null,
        source_citations: Array.isArray(p.source_citations) ? p.source_citations : [],
        reference: p.reference || p.source_url || null,
        license: p.license || 'MITECO public-sector information reuse terms',
        license_url: p.license_url || p.terms_url || 'https://www.miteco.gob.es/es/atencion-al-ciudadano/aviso-legal.html',
        source_fields: p.source_fields || null,
        source_tables: p.source_tables || null
    });
}

// Reviewed matches only. Do not infer event identity from overlapping dates or polygons.
export function groupEventPins(records) {
    const result = new Map();
    for (const record of records) {
        const id = record.event_pin_id ?? record.id;
        const existing = result.get(id);
        if (existing) {
            existing.source_record_count += 1;
            if (record.record_kind === 'affected_regions') {
                (existing.regional_records ||= []).push(record);
            }
        }
        else result.set(id, { ...record, id, source_record_count: 1 });
    }
    return [...result.values()];
}
