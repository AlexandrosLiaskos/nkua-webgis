import { escapeHtml } from '../utils/helpers.js';
import { hasRecordValue, hasValidCoordinates, CLASSIFICATION_FIELDS } from '../data/recordValues.js?v=20261004-cnih-1';

function safeLink(value, label = value) {
    const url = String(value || '').trim();
    return /^https?:\/\/[^\s]+$/i.test(url)
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
        : escapeHtml(label);
}

function displayValue(value) {
    if (Array.isArray(value)) return value.filter(hasRecordValue).map(displayValue).join('; ');
    return typeof value === 'number'
        ? value.toLocaleString('en-GB', { maximumFractionDigits: 12 })
        : String(value).trim();
}

function row(record, key, label, options = {}) {
    const observations = record.field_observations?.[key];
    const value = options.value ?? record[key];
    if (!observations?.length && !hasRecordValue(value)) return '';
    const format = value => ['year', 'source_record_id', 'source_record_ids', 'source_episode_id'].includes(key) ? String(value) : displayValue(value);
    const html = observations?.length
        ? observations.map(item => `${escapeHtml(format(item.value))} <small>(record ${escapeHtml(item.record_id)})</small>`).join('<br>')
        : options.link ? safeLink(value) : escapeHtml(format(value));
    return `<div class="detail-item" data-field="${key}"><div class="detail-label">${label}</div><div class="detail-value">${html}</div></div>`;
}

function section(title, rows, note = '') {
    const body = rows.filter(Boolean).join('');
    if (!body) return '';
    return `<section class="lagoon-modal-section"><header class="lagoon-modal-section-head"><h4 class="lagoon-modal-section-title">${escapeHtml(title)}</h4></header><div class="lagoon-modal-details-grid">${body}</div>${note ? `<p class="stats-hint">${escapeHtml(note)}</p>` : ''}</section>`;
}

function citations(record) {
    const entries = record.source_citations || [];
    const full = entries.filter(item => hasRecordValue(item.title)).map(item =>
        `<li>${safeLink(item.url, item.title)}${hasRecordValue(item.label) && item.label !== item.title ? ` <small>(${escapeHtml(item.label)})</small>` : ''}</li>`).join('');
    const rows = record.dataset === 'CNIH' ? [
        row(record, 'reference', 'Official catalogue', { link: true }),
        row(record, 'source_reference_count', 'Linked bibliography records'),
        row(record, 'license', 'Reuse terms'),
        row(record, 'license_url', 'Legal notice', { link: true }),
        row(record, 'administrative_location_source', 'Administrative location source', { value: record.display_anchor?.source_url, link: true }),
        row(record, 'source_data_url', 'Source record data (basin file)', { link: true })
    ] : [
        row(record, 'source', record.record_kind === 'affected_regions' ? 'References cited by HANZE' : 'Original source', { link: true }),
        row(record, 'reference', record.record_kind === 'affected_regions' ? 'HANZE dataset' : 'NKUA publication', { link: true }),
        row(record, 'publication', 'HANZE methods publication', { link: true }),
        row(record, 'license', 'Licence')
    ];
    if (full) rows.push(`<div class="detail-item" data-field="source_citations"><div class="detail-label">${record.record_kind === 'affected_regions' || record.dataset === 'CNIH' ? 'Linked bibliography entries' : 'Sources for the combined record'}</div><div class="detail-value"><ul>${full}</ul></div></div>`);
    return section('Sources', rows);
}

function classificationSection(record) {
    const note = record.dataset === 'CNIH'
        ? 'Classes follow selected CNIH origin, mechanism and characteristic categories. Other criteria remain Unclassified.'
        : record.dataset === 'NKUA'
        ? 'Riverine is assigned from the catalogue scope. The other parameters are unclassified.'
        : record.record_kind === 'reported_event'
            ? 'Classes follow NOAA’s recorded event type and flood cause. Parameters not established by these fields remain unclassified.'
            : 'Classes follow HANZE’s recorded type and flood profile, where supplied. Unclassified means the parameter is not established here.';
    const fields = record.dataset === 'CNIH'
        ? CLASSIFICATION_FIELDS.filter(({ key }) => hasRecordValue(record[key]) && record[key] !== 'Unclassified')
        : CLASSIFICATION_FIELDS;
    const rows = fields.map(({ key, label }) =>
        row(record, key, label, { value: record[key] || 'Unclassified' })
    );
    if (!rows.length && record.dataset === 'CNIH') rows.push(row(record, 'classification_status', 'Classification', { value: 'Unclassified' }));
    return section('Flood classification', rows, note);
}

function cnihObservationTable(record, sourceTable, title, columns, note = '') {
    const sourceRows = record.source_tables?.[sourceTable];
    if (!Array.isArray(sourceRows)) return '';
    const valueFor = (item, column) => column.get ? column.get(item) : item[column.field];
    const rows = sourceRows.filter(item => columns.some(column => hasRecordValue(valueFor(item, column))));
    if (!rows.length) return '';
    const headings = columns.map(column => `<th scope="col">${escapeHtml(column.label)}</th>`).join('');
    const body = rows.map(item => `<tr>${columns.map(column => {
        const value = valueFor(item, column);
        return `<td>${hasRecordValue(value) ? escapeHtml(displayValue(value)) : '—'}</td>`;
    }).join('')}</tr>`).join('');
    return `<details class="reference-notes"><summary>${escapeHtml(title)} (${rows.length.toLocaleString('en-GB')})</summary>${note ? `<p class="stats-hint">${escapeHtml(note)}</p>` : ''}<div class="template-table-wrapper"><table class="template-table"><caption class="sr-only">${escapeHtml(title)} supplied by CNIH for this basin-event record</caption><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table></div></details>`;
}

function cnihSections(record) {
    const nativeLabel = values => Array.isArray(values) ? values.map(item =>
        item.label || item.code).filter(hasRecordValue) : [];
    const observations = [
        cnihObservationTable(record, 'CNIH_DAÑO_PERSONA_MUNICIPIO', 'Municipal human impacts', [
            { field: 'CDPM_NOM_MUNICIPIO', label: 'Municipality' },
            { field: 'CDPM_VICTIMAS', label: 'Victims (source value)' },
            { field: 'CDPM_EVACUADOS', label: 'Evacuated' },
            { field: 'CDPM_RESCATADOS', label: 'Rescued' },
            { field: 'CDPM_TIPO_AFECCION', label: 'Reported impact' },
            { field: 'CDPM_NIVEL_DAÑO', label: 'Damage level' }
        ], 'Municipal observations are kept separately; they are not summed into an event total.'),
        cnihObservationTable(record, 'CNIH_DAÑO_ECONOMICO_MUNICIPIO', 'Municipal economic impacts', [
            { field: 'CDEM_NOM_MUNICIPIO', label: 'Municipality' },
            { field: 'CDEM_INDEMNIZACION_CCS', label: 'CCS indemnity (source value)' },
            { field: 'CDEM_TIPO_AFECCION', label: 'Reported impact' },
            { field: 'CDEM_NIVEL_DAÑO', label: 'Damage level' },
            { field: 'CDEM_OBS', label: 'Source notes' }
        ]),
        cnihObservationTable(record, 'CNIH_DAÑO_ECONOMICO_EVENTO', 'Event economic impacts', [
            { field: 'CDE_TIPO_AFECCION', label: 'Reported impact' },
            { field: 'CDE_COSTE_CH', label: 'Basin authority cost' },
            { field: 'CDE_COSTE_NACIONAL', label: 'National cost' },
            { field: 'CDE_COSTE_CCAA', label: 'Regional cost' },
            { field: 'CDE_COSTE_AYTO', label: 'Municipal cost' },
            { field: 'CDE_COSTE_AGRICOLA', label: 'Agricultural cost' },
            { field: 'CDE_OBSERVACIONES', label: 'Source notes' }
        ], 'Monetary amounts retain their source values. Different cost and indemnity categories are not combined.'),
        cnihObservationTable(record, 'CNIH_CAUDAL_PUNTA', 'Peak discharge observations', [
            { field: 'CAU_UBI_CAUDAL', label: 'Observation location' },
            { field: 'CAU_CAUDAL', label: 'Peak discharge (source value)' },
            { field: 'CAU_ORIGEN_DATO', label: 'Recorded / estimated' },
            { field: 'CAU_OBS_CAUDAL', label: 'Source notes' }
        ]),
        cnihObservationTable(record, 'CNIH_CALADO_SIGNIFICATIVO', 'Water marks and levels', [
            { field: 'CAL_UBI_CALADO', label: 'Observation location' },
            { field: 'CAL_CALADO_SIGNIFICATIVO', label: 'Reported value' },
            { field: 'CAL_OBS_CALADO', label: 'Source notes' }
        ], 'The source notes identify what each value measures and its units; gauge levels and flood-water marks are not interchangeable.'),
        cnihObservationTable(record, 'CNIH_PRECIPITACION_MAX', 'Precipitation observations', [
            { get: item => item.CP_Observatorio || item.CP_Indicativo || item.CP_Provincia, label: 'Observation location' },
            { field: 'CP_Fecha', label: 'Source date' },
            { field: 'CP_Imax', label: 'Reported value' },
            { field: 'CP_OBS_PRECIPITACION_MAX', label: 'Source notes' }
        ]),
        cnihObservationTable(record, 'CNIH_DAÑO_AMBIENTAL_EVENTO', 'Environmental impacts', [
            { field: 'CDA_TIPO_AFECCION', label: 'Reported impact' },
            { field: 'CDA_TIPO_AFECCION_TEXTO', label: 'Source description' },
            { field: 'CDA_NIVEL_DAÑO', label: 'Damage level' },
            { field: 'CDA_ DAÑO_PAISAJE', label: 'Landscape damage' }
        ]),
        cnihObservationTable(record, 'CNIH_DAÑO_CULTURAL_EVENTO', 'Cultural impacts', [
            { field: 'CDCM_TIPO_AFECCION', label: 'Reported impact' },
            { field: 'CDCM_TIPO_AFECCION_TEXTO', label: 'Source description' },
            { field: 'CDCM_NIVEL_DAÑO', label: 'Damage level' },
            { field: 'CDCM_COSTE_CULTURAL', label: 'Cost (source value)' },
            { field: 'CDCM_OBSERVACIONES', label: 'Source notes' }
        ])
    ].filter(Boolean).join('');
    const observationSection = observations ? `<section class="lagoon-modal-section"><header class="lagoon-modal-section-head"><h4 class="lagoon-modal-section-title">Supporting observations</h4></header>${observations}</section>` : '';
    const provenanceRows = [
        row(record, 'source_record_id', 'Database record ID'),
        row(record, 'source_date', 'Original date field'),
        row(record, 'legacy_record_reference', 'Legacy record reference', { value: record.source_fields?.MDB_CNIH_2013_DGA })
    ].filter(Boolean).join('');
    const provenance = provenanceRows ? `<details class="reference-notes"><summary>Record provenance</summary><div class="lagoon-modal-details-grid">${provenanceRows}</div></details>` : '';
    return section('Event record', [
        row(record, 'source_event_id', 'CNIH event code'),
        row(record, 'source_release', 'Source release'),
        row(record, 'basin_name', 'River basin district'),
        row(record, 'date_interval', 'Reported date'),
        row(record, 'date_qualification', 'Date qualification'),
        row(record, 'duration_days', 'Reported duration (days)'),
        row(record, 'location_name', 'Affected locations'),
        row(record, 'relevant_information', 'Source description')
    ]) + section('Original CNIH classification', [
        row(record, 'cnih_origin', 'Origin', { value: nativeLabel(record.cnih_origin) }),
        row(record, 'cnih_mechanism', 'Mechanism', { value: nativeLabel(record.cnih_mechanism) }),
        row(record, 'cnih_characteristics', 'Characteristics', { value: nativeLabel(record.cnih_characteristics) })
    ]) + classificationSection(record) + section('Reported impacts', [
        row(record, 'reported_affected_area_km2', 'Reported affected area (km²)')
    ], 'Affected area may use municipal area where inundated extent is unknown; it is not a measured flood footprint.') + section('Location and interpretation', [
        row(record, 'marker_location_basis', 'Map location'),
        row(record, 'administrative_reference', 'Administrative reference', { value: record.display_anchor?.municipality_name }),
        row(record, 'official_map', 'Official map', { value: record.display_anchor?.official_map_url, link: true }),
        row(record, 'counting_unit', 'Record scope')
    ]) + observationSection + provenance + citations(record);
}

function regionalSections(record, context = false) {
    const regionVintage = record.region_vintage || (hasRecordValue(record.regions_2024) ? 2024 : 2021);
    const impactNote = [
        hasRecordValue(record.persons_affected) ? 'Persons affected may include HANZE estimates from flooded households or evacuations.' : '',
        hasRecordValue(record.reported_inundated_area_km2) ? 'Reported flooded area may refer only to agricultural land; it is not calculated from the displayed polygon.' : ''
    ].filter(Boolean).join(' ');
    return section(context ? 'HANZE regional record' : 'Event record', [
        row(record, 'source_record_id', 'HANZE record ID'),
        row(record, 'source_release', 'Source release'),
        row(record, 'country', 'Country / territory as recorded by HANZE'),
        row(record, 'date_interval', 'Reported interval'),
        row(record, 'date_qualification', 'Date qualification'),
        row(record, 'flood_type', 'Original HANZE type'),
        row(record, 'profile_name', 'HANZE flood profile'),
        row(record, 'profile_code', 'Hazard profile code'),
        row(record, 'flood_sources', 'Rivers, lakes or coastal waters'),
        row(record, 'location_name', `Regions affected by floods (${regionVintage} coding)`)
    ]) + classificationSection(record) + section('Reported impacts', [
        row(record, 'impact_availability_note', 'Impact data'),
        row(record, 'deaths_toll_int', 'Fatalities, including missing presumed dead'),
        row(record, 'persons_affected', 'Persons affected'),
        row(record, 'reported_inundated_area_km2', 'Reported flooded area (km²)'),
        row(record, 'losses_nominal', 'Nominal losses', {
            value: hasRecordValue(record.losses_nominal) ? `${displayValue(record.losses_nominal)}${hasRecordValue(record.currency) ? ` ${record.currency}` : ''}` : null
        }),
        row(record, 'losses_2025_eur', 'Adjusted losses (EUR, 2025 prices and exchange rates)'),
        row(record, 'losses_2020_eur', 'Adjusted losses (EUR, 2020 prices and exchange rates)'),
        row(record, 'cause_of_flood', 'Meteorological cause'),
        row(record, 'relevant_information', 'Source notes')
    ], impactNote) + (!context ? section('Location and interpretation', [
        row(record, 'marker_location_basis', 'Pin location'),
        row(record, 'geometry_role', 'Polygon meaning'),
        row(record, 'counting_unit', 'Record scope'),
        row(record, 'related_records', 'Potentially related HANZE records')
    ]) : '') + section('Record provenance', [
        row(record, 'traceability', 'Source traceability'),
        row(record, 'changes', 'Recorded revisions'),
        row(record, 'entry_date', 'Entry date'),
        row(record, 'last_update', 'Last updated')
    ], hasRecordValue(record.traceability) ? (record.traceability_meaning || 'HANZE’s source notes explain which references support individual values; this is not a verification score.') : '') + citations(record);
}

function originalNoaaFields(record) {
    const fields = Object.entries(record.original_fields || {}).filter(([, value]) => hasRecordValue(value));
    if (!fields.length) return '';
    const entries = fields.map(([key, value]) => `<tr><th scope="row"><code>${escapeHtml(key)}</code></th><td>${escapeHtml(String(value))}</td></tr>`).join('');
    return `<details class="reference-notes"><summary>Original NOAA fields</summary><div class="template-table-wrapper"><table class="template-table"><caption class="sr-only">Populated fields from the original NOAA event report</caption><thead><tr><th scope="col">Field</th><th scope="col">Source value</th></tr></thead><tbody>${entries}</tbody></table></div></details>`;
}

function noaaLocations(record) {
    const locations = record.reported_locations || [];
    if (!locations.length) return '';
    const entries = locations.map(location => `<tr><th scope="row">${escapeHtml(location.LOCATION || 'Unnamed location')}</th><td>${hasRecordValue(location.LATITUDE) ? escapeHtml(String(location.LATITUDE)) : '—'}</td><td>${hasRecordValue(location.LONGITUDE) ? escapeHtml(String(location.LONGITUDE)) : '—'}</td></tr>`).join('');
    return `<details class="reference-notes"><summary>Reported locations (${locations.length.toLocaleString('en-GB')})</summary><div class="template-table-wrapper"><table class="template-table"><caption class="sr-only">Locations supplied by NOAA for this event report</caption><thead><tr><th scope="col">Location</th><th scope="col">Latitude</th><th scope="col">Longitude</th></tr></thead><tbody>${entries}</tbody></table></div></details>`;
}

function noaaSections(record) {
    const money = (amount, sourceValue) => hasRecordValue(amount)
        ? `${displayValue(amount)} USD${hasRecordValue(sourceValue) ? ` (source: ${sourceValue})` : ''}`
        : sourceValue;
    return section('Event report', [
        row(record, 'source_record_id', 'NOAA event ID'),
        row(record, 'source_episode_id', 'Storm episode ID'),
        row(record, 'source_release', 'Source release'),
        row(record, 'country', 'Country / territory'),
        row(record, 'state_name', 'State / territory'),
        row(record, 'administrative_area', 'County / reporting zone'),
        row(record, 'administrative_area_type', 'Reporting area type'),
        row(record, 'date_interval', 'Reported local interval'),
        row(record, 'date_timezone', 'Source time zone'),
        row(record, 'event_type_source', 'Original NOAA type'),
        row(record, 'location_name', 'Reported location'),
        row(record, 'cause_of_flood', 'Reported or estimated cause'),
        row(record, 'marker_location_basis', 'Map location'),
        row(record, 'counting_unit', 'Report scope')
    ]) + classificationSection(record) + section('Reported impacts', [
        row(record, 'deaths_direct', 'Direct fatalities'),
        row(record, 'deaths_indirect', 'Indirect fatalities'),
        row(record, 'injuries_direct', 'Direct injuries'),
        row(record, 'injuries_indirect', 'Indirect injuries'),
        row(record, 'damage_property', 'Estimated property damage', { value: money(record.damage_property_usd, record.damage_property) }),
        row(record, 'damage_crops', 'Estimated crop damage', { value: money(record.damage_crops_usd, record.damage_crops) })
    ], 'Damage estimates are nominal US dollars, without adjustment for inflation. Missing values mean unreported; explicit zero is retained.') + section('NOAA narratives', [
        row(record, 'event_narrative', 'Event report'),
        row(record, 'episode_narrative', 'Storm episode')
    ]) + noaaLocations(record) + section('Sources', [
        row(record, 'report_source', 'Original reporting source'),
        row(record, 'reference', 'NOAA Storm Events dataset', { link: true }),
        row(record, 'source_file_url', 'Original annual event file', { link: true }),
        row(record, 'license', 'Usage terms')
    ]) + originalNoaaFields(record);
}

export function renderRecordSections(record) {
    if (record.dataset === 'CNIH') return cnihSections(record);
    if (record.record_kind === 'affected_regions') return regionalSections(record);
    if (record.record_kind === 'reported_event') return noaaSections(record);
    const evidence = record.enrichment;
    const rainfallPresent = hasRecordValue(record.rainfall_duration) || hasRecordValue(record.rainfall_height);
    const rainfallNote = rainfallPresent ? (evidence?.rainfall_note || 'Rainfall values are transcribed from the catalogue. Their units and measurement periods are not specified in the stored record.') : '';
    let html = section('Event record', [
        row(record, 'source_record_ids', 'NKUA record IDs', { value: record.source_record_ids ?? record.id }),
        row(record, 'date_of_commencement', 'Catalogue date'),
        row(record, 'date_interval', 'Publication-supported interval'),
        row(record, 'year', 'Year'), row(record, 'location_name', 'Location'), row(record, 'flood_event_name', 'Event name')
    ]) + classificationSection(record) + section('Recorded impact', [
        row(record, 'deaths_toll_int', 'Death toll'),
        row(record, 'rainfall_duration', `Rainfall duration${evidence?.rainfall_duration_unit ? ` (${escapeHtml(evidence.rainfall_duration_unit)})` : ' (catalogue value)'}`),
        row(record, 'rainfall_height', `Rainfall amount${evidence?.rainfall_height_unit ? ` (${escapeHtml(evidence.rainfall_height_unit)})` : ' (catalogue value)'}`),
        row(record, 'cause_of_flood', 'Reported cause or contributing factors'),
        row(record, 'relevant_information', 'Additional information and cited evidence')
    ], rainfallNote) + citations(record);
    if (evidence) {
        html += section('Supporting publication', [
            row(evidence, 'interval_citation', 'Interval evidence'),
            row(evidence, 'interval_url', 'Publication', { link: true })
        ]);
    }
    if (record.regional_context) {
        html += `<section class="lagoon-modal-section"><header class="lagoon-modal-section-head"><h4 class="lagoon-modal-section-title">Evidence for the wider event</h4></header><p class="stats-hint">${escapeHtml(evidence.context_note)}</p></section>`;
        html += regionalSections(record.regional_context, true);
    }
    return html;
}

export function renderFloodDetails(record) {
    const regional = record.record_kind === 'affected_regions';
    const reported = record.record_kind === 'reported_event';
    if (!hasValidCoordinates(record)) {
        const message = reported ? 'NOAA does not provide coordinates for this report.' : 'Coordinates are not available for this record.';
        return `<section class="lagoon-modal-section"><p class="stats-hint">${escapeHtml(message)}</p></section>` + renderRecordSections(record);
    }
    const preview = `<section class="lagoon-modal-locators">
        <figure class="locator locator-detail"><div id="flood-modal-preview-map" class="lagoon-preview-map lagoon-modal-preview-map"></div><figcaption>${record.dataset === 'CNIH' ? 'Administrative display location' : regional ? 'Administrative regions affected by floods' : reported ? 'Report location' : 'Catalogue location'}</figcaption></figure>
        <figure class="locator locator-greece"><div id="flood-modal-region-map" class="lagoon-preview-map lagoon-modal-locator-map"></div><figcaption>Regional context</figcaption></figure>
        <figure class="locator locator-world"><div id="flood-modal-world-map" class="lagoon-preview-map lagoon-modal-locator-map"></div><figcaption>World</figcaption></figure>
    </section><section class="lagoon-modal-section"><p class="stats-hint" id="flood-geometry-note">${record.dataset === 'CNIH' ? escapeHtml(record.marker_location_basis || 'Administrative display location; not an observed flood site or inundation extent.') : regional ? 'The pin is a display location. Loading the affected-region outline…' : reported ? 'Location supplied by NOAA; the point does not show the flood extent.' : 'Location supplied by NKUA.'}</p></section>`;
    return preview + renderRecordSections(record);
}
