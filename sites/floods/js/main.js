import { formatMonth } from './data/monthValues.js?v=20261013-month-1';

/**
 * Greek Floods Web Map Atlas - Main Entry Point
 *
 * Initializes and wires together all application modules using ES6 imports.
 * This is the main application orchestrator.
 */

import { installCatalogueLists, handleStatisticsGroupSelect } from './ui/CatalogueLists.js?v=20261026-filters-display-1';
import { hasValidCoordinates } from './data/recordValues.js?v=20261004-cnih-1';

import EventBus from './core/EventBus.js?v=20261004-display-1';
import StateManager from './core/StateManager.js?v=20261004-display-1';
import CacheManager from './core/CacheManager.js?v=20261004-display-1';
import DataManager from './data/CatalogueDataManager.js?v=20261026-filters-display-1';
import StatsManager from './data/StatsManager.js?v=20261004-cnih-disabled-1';
import MapManager from './map/MapManager.js?v=20261004-display-1';
import DisplaySettings from './ui/DisplaySettings.js?v=20261013-month-display-1';
import { CLASSIFICATION_FIELDS as PARAMETERS } from './data/recordValues.js?v=20261004-cnih-1';
import RiverNetworkLayer from './map/RiverNetworkLayer.js?v=20261004-noaa-1';
import MarkerManager from './map/MarkerManager.js?v=20261013-month-display-1';
import HanzeGeometry from './map/HanzeGeometry.js?v=20261004-hanze-list-b-1';
import ModalManager from './ui/ModalManager.js?v=20261004-cnih-1';
import UIController from './ui/UIController.js?v=20261004-display-1';
import FilterManager from './ui/FilterManager.js?v=20261026-filters-display-1';
import FilterDisplay from './ui/FilterDisplay.js?v=20261013-month-1';
import GlobalSearch from './ui/GlobalSearch.js?v=20261004-display-1';
import QueryBuilder from './ui/QueryBuilder.js?v=20261004-cnih-1';
import MobileControls from './ui/MobileControls.js?v=20261004-display-1';
import StatusBar from './ui/StatusBar.js?v=20261004-cnih-1';
import EmailHelper from './utils/EmailHelper.js?v=20261004-display-1';
import DropdownLimiter from './utils/DropdownLimiter.js?v=20261004-display-1';

class FloodMapApplication {
    constructor() {
        this.eventBus = new EventBus();
        this.cacheManager = new CacheManager();
        this.stateManager = new StateManager(this.eventBus);

        this.dataManager = null;
        this.statsManager = null;
        this.mapManager = null;
        this.markerManager = null;
        this.modalManager = null;
        this.uiController = null;
        this.filterManager = null;
        this.filterDisplay = null;
        this.globalSearch = null;
        this.queryBuilder = null;
        this.mobileControls = null;
        this.statusBar = null;
        this.emailHelper = null;
        this.dropdownLimiter = null;
    }

    async init() {
        try {
            if (window.DEBUG_MODE) {
                console.log('🚀 FloodMapApplication: Starting initialization...');
            }

            this.dataManager = new DataManager(this.eventBus, this.cacheManager, this.stateManager);
            this.statsManager = new StatsManager(this.eventBus, this.dataManager);
            this.mapManager = new MapManager(this.eventBus, this.stateManager);
            this.modalManager = new ModalManager(this.eventBus, this.cacheManager);
            this.uiController = new UIController(this.eventBus, this.stateManager);
            this.filterManager = new FilterManager(this.eventBus, this.stateManager, this.dataManager);
            this.filterDisplay = new FilterDisplay(this.eventBus, this.stateManager);
            this.globalSearch = new GlobalSearch(this.eventBus, this.stateManager, this.filterManager);
            this.queryBuilder = new QueryBuilder(this.eventBus, this.stateManager, this.dataManager);
            this.mobileControls = new MobileControls(this.eventBus, this.stateManager);
            this.emailHelper = new EmailHelper();
            this.dropdownLimiter = new DropdownLimiter();

            this.mapManager.init('map');

            const map = this.mapManager.getMap();
            this.dataManager.lasso = window.NkuaWebGISMap?.addLassoSelection(map, {
                onChange: () => this.filterManager.applyFilters()
            }) || null;
            this.markerManager = new MarkerManager(map, this.eventBus, this.stateManager);
            this.markerManager.init();
            this.riverNetwork = new RiverNetworkLayer(map, {
                markerManager: this.markerManager, eventBus: this.eventBus,
                overlays: [{ id: 'floods', label: 'Floods', layer: this.markerManager.markerCluster, color: '#dc2626' }]
            });
            this.riverNetwork.init();

            this.statusBar = new StatusBar(this.eventBus, this.stateManager, this.markerManager);
            this.statusBar.init(map);
            this.displaySettings = new DisplaySettings(this.markerManager, this.eventBus);
            this.displaySettings.init();

            this.modalManager.init();
            this.uiController.init();
            this.filterManager.init();
            this.filterDisplay.init();
            this.globalSearch.init();
            this.queryBuilder.init();
            this.statsManager.init();
            this.mobileControls.init();
            this.dropdownLimiter.init();

            this.hanzeGeometry = new HanzeGeometry(map, this.markerManager.markerCluster);
            this.markerManager.loadGeometry = async record => {
                const country = await this.hanzeGeometry.loadCountry(record.geometry_file);
                return country.get(String(record.geometry_feature_id));
            };

            this.commonInterface = window.NkuaWebGISUI?.createAtlasInterface({
                eventBus: this.eventBus,
                getRecords: () => this.stateManager.get('currentData') || [],
                getOptions: (field) => this.filterManager.currentOptions?.[field.optionsKey] || [],
                onApply: (field, value) => this.filterManager.applyFilterValue(field.filterKey, value),
                statisticsRecordLabel: record => record.flood_event_name || record.location_name || `Flood ${record.id}`,
                statisticsRecordMeta: record => [record.location_name, record.year].filter(value => value !== null && value !== undefined && value !== '').join(' · '),
                onStatisticsGroupSelect: handleStatisticsGroupSelect,
                onStatisticsRecordSelect: record => {
                    const latitude = Number(record.latitude);
                    const longitude = Number(record.longitude);
                    if (hasValidCoordinates(record)) {
                        this.mapManager.setView(latitude, longitude, 11);
                    }
                    this.eventBus.emit('marker:clicked', { floodId: record.id, flood: record });
                },
                filterFields: [
                    { key: 'country', dataField: 'country', filterKey: 'country', inputId: 'country-filter', optionsKey: 'countries', label: 'Country / territory', group: 'Geography' },
                    { key: 'dataset', dataField: 'dataset', filterKey: 'dataset', inputId: 'dataset-filter', optionsKey: 'datasets', label: 'Source catalogue', group: 'Identification' },
                    { key: 'year', dataField: 'year', filterKey: 'year', inputId: 'year-filter', optionsKey: 'years', label: 'Year', group: 'Chronology', sort: 'desc' },
                    { key: 'month', dataField: 'month', filterKey: 'month', inputId: 'month-filter', optionsKey: 'months', label: 'Month', group: 'Chronology', sort: 'asc', formatValue: formatMonth },
                    { key: 'floodType', dataField: 'flood_type', filterKey: 'floodType', inputId: 'flood-type-filter', optionsKey: 'floodTypes', label: 'Source flood type', group: 'Classification' },
                    ...PARAMETERS.map(parameter => ({
                        key: parameter.key, dataField: parameter.key, filterKey: parameter.key,
                        inputId: parameter.inputId, optionsKey: parameter.optionsKey,
                        label: parameter.label, group: 'Flood classification'
                    })),
                    { key: 'location', dataField: 'location_name', filterKey: 'location', inputId: 'location-filter', optionsKey: 'locations', label: 'Location', group: 'Geography' },
                    { key: 'deathsToll', dataField: 'deaths_toll_int', filterKey: 'deathsToll', inputId: 'deaths-toll-filter', optionsKey: 'deathsToll', label: 'Death toll', group: 'Impact', sort: 'desc', formatValue: (value) => String(value) === '0' ? '0 (none)' : String(value) },
                    { key: 'eventName', dataField: 'flood_event_name', filterKey: 'eventName', inputId: 'event-name-filter', optionsKey: 'eventNames', label: 'Event name', group: 'Identification' }
                ],
                statisticsFields: [
                    { key: 'dataset', dataField: 'dataset', label: 'Source catalogue', type: 'categorical', group: 'Identification', description: 'Counts of source records in each catalogue. Related records can describe the same wider flood episode. Administrative display locations do not identify exact flood sites.' },
                    { key: 'country', dataField: 'country', label: 'Country / territory', type: 'categorical', group: 'Geography', description: 'Source-country or territory assignment. Records can belong to the same wider flood episode.' },
                    {
                        key: 'year',
                        dataField: 'year',
                        label: 'Year',
                        type: 'numeric',
                        group: 'Chronology',
                        binCount: 9,
                        scale: 'linear',
                        description: 'Source-reported year. Counts describe catalogue records, which may belong to the same wider flood episode. Histogram bars group nearby years into ranges.'
                    },
                    ...PARAMETERS.map(parameter => ({
                        key: parameter.key, dataField: parameter.key, label: parameter.label,
                        type: 'categorical', group: 'Flood classification',
                        description: 'Source records grouped by this classification criterion. NKUA is Riverine by water source and Unclassified for other criteria. HANZE retains classifications supported by its source fields and definitions.'
                            + (this.dataManager.noaaEnabled ? ' NOAA event types and explicit flood causes are harmonised to these criteria; undocumented criteria remain Unclassified.' : '')
                            + ' Combined labels count each record once.'
                    })),
                    ...(this.dataManager.noaaEnabled ? [
                    { key: 'noaaFloodType', dataField: record => record.dataset === 'NOAA' ? record.flood_type : null,
                        label: 'Source flood type', type: 'categorical', group: 'NOAA · Event characteristics',
                        description: 'NOAA Flood, Flash Flood, Coastal Flood and Lakeshore Flood event reports. Several county or zone reports can describe one wider flood.' },
                    { key: 'noaaCause', dataField: record => record.dataset === 'NOAA' ? record.cause_of_flood : null,
                        label: 'Reported flood cause', type: 'categorical', group: 'NOAA · Event characteristics',
                        description: 'Reported or estimated causes retained from the NOAA flood-cause field.' },
                    ...[['deaths_direct', 'Direct fatalities', 'people'], ['deaths_indirect', 'Indirect fatalities', 'people'],
                        ['injuries_direct', 'Direct injuries', 'people'], ['injuries_indirect', 'Indirect injuries', 'people'],
                        ['damage_property_usd', 'Property damage', 'USD'], ['damage_crops_usd', 'Crop damage', 'USD']].map(([key, label, unit]) => ({
                        key: `noaa_${key}`, dataField: record => record.dataset === 'NOAA' ? record[key] : null,
                        label, unit, type: 'numeric', group: unit === 'USD' ? 'NOAA · Economic impact' : 'NOAA · Human impact',
                        description: unit === 'USD' ? 'Reported damage in nominal US dollars at the time of the event. Missing values are excluded; explicit zeros are retained.'
                            : 'NOAA direct and indirect impacts are kept separate. Missing values are excluded; explicit zeros are retained.'
                    })),
                    ] : []),
                    {
                        key: 'hanzeFloodType', dataField: record => record.dataset === 'HANZE' ? record.flood_type : null,
                        label: 'Source flood type', type: 'categorical', group: 'HANZE · Event characteristics',
                        description: 'HANZE classification: river, flash, coastal or combined river/coastal flooding. Counts refer to source records, which may describe parts of a wider event.'
                    },
                    {
                        key: 'hanzeFloodProfile', dataField: record => record.dataset === 'HANZE' ? record.source_profile : null,
                        label: 'Flood profile', type: 'categorical', group: 'HANZE · Event characteristics',
                        description: 'Flood profiles supplied by HANZE v3.0.1 beta, including snowmelt and ice-jam flooding. Records without a source profile are excluded from this chart.'
                    },
                    {
                        key: 'hanzeCause',
                        dataField: record => record.dataset === 'HANZE' ? record.cause_of_flood : null,
                        label: 'Meteorological cause', type: 'categorical', group: 'HANZE · Event characteristics', maxItems: 12,
                        description: 'Causes as reported by HANZE, including rainfall, snowmelt and storm surge. Each category retains the source wording; less frequent descriptions are grouped as Other.'
                    },
                    {
                        key: 'hanzeIntervalDays',
                        dataField: record => {
                            if (record.dataset !== 'HANZE' || !record.date_of_commencement || !record.end_date) return null;
                            const start = Date.parse(`${record.date_of_commencement}T00:00:00Z`);
                            const end = Date.parse(`${record.end_date}T00:00:00Z`);
                            return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 86400000 + 1 : null;
                        },
                        label: 'Reported interval length', type: 'numeric', unit: 'days', group: 'HANZE · Event characteristics',
                        description: 'Calendar days between the reported HANZE start and end dates, including both dates. Source dates can be approximate; this is not a measurement of how long water remained on the ground.'
                    },
                    {
                        key: 'hanzeAffectedRegions',
                        dataField: record => {
                            if (record.dataset !== 'HANZE') return null;
                            const regions = record.regions_2024 || record.regions_2021;
                            const values = Array.isArray(regions) ? regions : typeof regions === 'string' ? regions.split(';') : [];
                            return new Set(values.map(value => String(value).trim()).filter(Boolean)).size || null;
                        },
                        label: 'Regions affected by floods per record', type: 'numeric', group: 'HANZE · Geographic coverage', scale: 'linear',
                        description: 'Number of affected administrative regions listed in each HANZE record: 2024 coding for the main catalogue and 2021 coding for historical List B. Region sizes differ; this count does not measure inundated area.'
                    },
                    {
                        key: 'hanzeWaterbodyCount',
                        dataField: record => record.dataset === 'HANZE' && record.flood_sources
                            ? new Set(record.flood_sources.split(';').map(value => value.trim()).filter(Boolean)).size || null : null,
                        label: 'Named waterbodies per record', type: 'numeric', group: 'HANZE · Geographic coverage', scale: 'linear',
                        description: 'Number of distinct river, lake or coastal-water names supplied by HANZE for each record. The source lists the main waterbodies, not necessarily every affected tributary. An absent list is missing information, not zero.'
                    },
                    {
                        key: 'hanzeFatalities',
                        dataField: record => record.dataset === 'HANZE' ? record.deaths_toll_int : null,
                        label: 'Fatalities', type: 'numeric', unit: 'people', group: 'HANZE · Human impact', scale: 'linear',
                        description: 'HANZE fatalities, including people missing and presumed dead, under its flood-impact definition. Explicit zeros are included; missing figures are excluded. These are regional source-record figures, separate from Greek local death-toll observations.'
                    },
                    {
                        key: 'hanzeAffectedPeople', dataField: record => record.dataset === 'HANZE' ? record.persons_affected : null,
                        label: 'Persons affected', type: 'numeric', unit: 'people', group: 'HANZE · Human impact',
                        description: 'People affected or evacuated as recorded by HANZE. Some figures are estimated from households or homes flooded. Missing figures are excluded; totals for related regional records may overlap.'
                    },
                    {
                        key: 'hanzeFloodedArea', dataField: record => record.dataset === 'HANZE' ? record.reported_inundated_area_km2 : null,
                        label: 'Reported flooded area', type: 'numeric', unit: 'km²', group: 'HANZE · Physical impact',
                        description: 'Flooded area reported by the source, sometimes limited to agricultural land. This is not the area of the administrative polygons displayed on the map. Missing figures are excluded.'
                    },
                    {
                        key: 'hanzeLosses2025', dataField: record => record.dataset === 'HANZE' ? record.losses_2025_eur : null,
                        label: 'Adjusted economic losses', type: 'numeric', unit: '2025 EUR', group: 'HANZE · Economic impact',
                        description: 'HANZE losses converted to euros at 2025 prices and exchange rates, allowing comparison across source currencies and years. These are source-record estimates; consult individual notes for coverage and qualifications, including insured losses.'
                    },
                    {
                        key: 'hanzeCurrency', dataField: record => record.dataset === 'HANZE' ? record.currency : null,
                        label: 'Original loss currency', type: 'categorical', group: 'HANZE · Economic impact', maxItems: 12,
                        description: 'Currency codes accompanying HANZE nominal losses, including historical currencies. This chart counts records by currency; it does not combine monetary amounts in different currencies.'
                    },
                    ...(this.dataManager.cnihEnabled ? [
                    ...[
                        ['cnih_origin', 'Water source'],
                        ['cnih_mechanism', 'Inundation mechanism'],
                        ['cnih_characteristics', 'Flood characteristics']
                    ].map(([field, label]) => ({
                        key: field, dataField: record => record.dataset === 'CNIH'
                            ? record[field]?.map(value => value.label || value.code).join(' + ') || null : null,
                        label, type: 'categorical', group: 'CNIH · Source classifications',
                        description: 'Original CNIH categories and codes. Multiple selections count each basin-event record once. Blank legacy fields are excluded; supplied unavailable-data codes remain visible.'
                    })),
                    { key: 'cnihBasin', dataField: record => record.dataset === 'CNIH' ? record.basin_name || record.basin_code : null,
                        label: 'River basin district', type: 'categorical', group: 'CNIH · Geographic coverage',
                        description: 'CNIH records an episode separately in each affected river basin district. These counts are source records, not unique national flood episodes.' },
                    { key: 'cnihMunicipalities', dataField: record => record.dataset === 'CNIH'
                            ? record.municipalities?.length || null : null,
                        label: 'Municipality entries', type: 'numeric', group: 'CNIH · Geographic coverage', scale: 'linear',
                        description: 'Distinct source code/name entries in linked municipal damage reports. Legacy codes may be postal codes, and several entries may refer to one municipality. An absent list is unknown.' },
                    { key: 'cnihDatePrecision', dataField: record => record.dataset === 'CNIH'
                            ? ({reported_day: 'Day', reported_month: 'Month', reported_year: 'Year', partial_or_invalid: 'Partial date', source_bce: 'BCE chronology'}[record.date_precision] || record.date_precision) : null,
                        label: 'Date precision', type: 'categorical', group: 'CNIH · Chronology',
                        description: 'Precision supported by the original historical date. Unknown day or month components are not filled in; BCE records retain their source chronology.' },
                    { key: 'cnihDuration', dataField: record => record.dataset === 'CNIH' ? record.duration_days : null,
                        label: 'Reported duration', type: 'numeric', unit: 'days', group: 'CNIH · Chronology', scale: 'linear',
                        description: 'Positive durations supplied by CNIH. Zero and invalid durations remain unknown; duration is not used to invent an end date.' },
                    { key: 'cnihAffectedArea', dataField: record => record.dataset === 'CNIH' ? record.reported_affected_area_km2 : null,
                        label: 'Reported affected area', type: 'numeric', unit: 'km²', group: 'CNIH · Physical impact',
                        description: 'Area reported by the basin authority. CNIH permits an affected-area approximation when the inundated area is unknown; this is not necessarily measured flooded area.' },
                    { key: 'cnihReferences', dataField: record => record.dataset === 'CNIH' ? record.source_reference_count || null : null,
                        label: 'Linked references', type: 'numeric', group: 'CNIH · Documentary sources', scale: 'linear',
                        description: 'Bibliography entries linked to each event record. A reference count is not a verification or confidence score.' }
                    ] : [])

                ]
            });

            installCatalogueLists(this.commonInterface);
            this.dataManager.lasso?.attach(this.commonInterface, record => [record.latitude, record.longitude]);

            this.setupEventHandlers();
            this.setupModalButtonHandlers();

            const isConnected = await this.dataManager.init();
            if (!isConnected) {
                this.uiController.showError('Failed to connect to database. Please check your configuration.');
                this.filterManager.disableFilters();
                return;
            }

            await this.loadInitialData();

            if (window.DEBUG_MODE) {
                console.log('✅ FloodMapApplication: Initialization complete');
            }

            window.app = this;

        } catch (error) {
            console.error('❌ FloodMapApplication: Initialization failed', error);
            this.uiController?.showError('Application failed to initialize. Please refresh the page.');
        }
    }

    setupEventHandlers() {
        this.eventBus.on('catalogue:partial', ({ message }) => this.uiController.showError(message));
        this.eventBus.on('filters:apply', async ({ filters }) => {
            this.hanzeGeometry.clear();
            this.stateManager.set('isLoading', true);
            try {
                // Check if there's an active SQL filter
                const activeSqlFilter = this.stateManager.get('activeSqlFilter');

                if (activeSqlFilter && activeSqlFilter.length > 0) {
                    // Re-fetch base data with the new regular filters, then apply SQL conditions client-side
                    const baseData = await this.dataManager.fetchFloodData(filters);
                    const data = this.queryBuilder.filterData(baseData, activeSqlFilter);

                    // Keep state aligned with what is shown on the map
                    this.stateManager.set('currentData', data);

                    this.markerManager.updateMarkers(data);
                    this.eventBus.emit('data:loaded', { count: data.length });
                    this.statsManager.calculateFromData(data);
                    this.dataManager.emitFilterOptionsFromData(data);
                } else {
                    // No SQL filter active, just use regular filters
                    const data = await this.dataManager.fetchFloodData(filters);
                    this.markerManager.updateMarkers(data);
                    this.eventBus.emit('data:loaded', { count: data.length });
                    this.statsManager.calculateFromData(data);
                }
            } finally {
                this.stateManager.set('isLoading', false);
            }
        });

        this.eventBus.on('sqlFilter:applied', async ({ data, conditions }) => {
            this.hanzeGeometry.clear();
            this.markerManager.updateMarkers(data);
            this.eventBus.emit('data:loaded', { count: data.length });
            this.statsManager.calculateFromData(data);
            // Update filter options based on SQL-filtered data
            this.dataManager.emitFilterOptionsFromData(data);
        });

        this.eventBus.on('sqlFilter:cleared', async () => {
            this.hanzeGeometry.clear();
            const filters = this.filterManager.getActiveFilters();
            const cleanFilters = {};
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== null && value !== '') {
                    cleanFilters[key] = value;
                }
            });

            this.stateManager.set('isLoading', true);
            try {
                const data = await this.dataManager.fetchFloodData(cleanFilters);
                this.markerManager.updateMarkers(data);
                this.eventBus.emit('data:loaded', { count: data.length });
                this.statsManager.calculateFromData(data);
                // Refresh filter options when SQL filter is cleared
                await this.dataManager.fetchFilterOptions(cleanFilters);
                // Update the active filters display to show remaining regular filters
                this.filterManager.updateActiveFiltersDisplay(cleanFilters);
            } finally {
                this.stateManager.set('isLoading', false);
            }
        });

        this.eventBus.on('marker:clicked', async ({ floodId }) => {
            this.hanzeGeometry.clearHover();
            const requestId = this.detailRequestId = (this.detailRequestId || 0) + 1;
            try {
                const flood = await this.dataManager.fetchFloodDetails(floodId);
                if (requestId !== this.detailRequestId) return;
                this.modalManager.showFloodDetails(flood);
                                this.hanzeGeometry.show(flood).then(feature => this.modalManager.updateFloodGeometry(flood.id, feature)).catch(error => {
                    if (error.name !== 'AbortError' && this.modalManager.previewRecord?.id === flood.id) {
                        const note = document.getElementById('flood-geometry-note');
                        if (note) note.textContent = 'The affected-region outline could not be loaded. The point shown is a derived display location. Select the pin again to retry.';
                    }
                });
            } catch (error) {
                if (requestId !== this.detailRequestId) return;
                console.error('Error loading flood details:', error);
                this.uiController.showError('Failed to load flood details.');
            }
        });

        this.eventBus.on('ui:showLoading', () => {
            this.stateManager.set('isLoading', true);
        });

        this.eventBus.on('ui:hideLoading', () => {
            this.stateManager.set('isLoading', false);
        });

        this.eventBus.on('ui:aboutClicked', () => {
            this.modalManager.openModal('welcome-modal');
        });

        this.eventBus.on('ui:referencesClicked', () => {
            this.modalManager.openModal('references-modal');
        });

        this.eventBus.on('ui:submitDataClicked', () => {
            this.modalManager.openModal('submit-data-modal');
        });

        this.eventBus.on('ui:reportBugClicked', () => {
            this.modalManager.openModal('report-bug-modal');
        });

        this.eventBus.on('ui:submitSuggestionClicked', () => {
            this.modalManager.openModal('submit-suggestion-modal');
        });

        this.eventBus.on('ui:sqlFilterClicked', () => {
            this.modalManager.openModal('sql-filter-modal');
        });

        this.stateManager.subscribe('isLoading', (isLoading) => {
            this.showLoading(isLoading);
        });
    }

    async loadInitialData() {
        this.stateManager.set('isLoading', true);

        try {
            const filterOptions = await this.dataManager.fetchFilterOptions({});
            this.queryBuilder.setFilterOptions(filterOptions);

            const data = await this.dataManager.fetchFloodData({});
            this.markerManager.setCatalogueRecords(data);
            this.markerManager.updateMarkers(data);
            const welcomeRecordCount = document.getElementById('welcome-record-count');
            if (welcomeRecordCount) {
                // welcomeRecordCount.textContent = this.markerManager.getMarkerCount().toLocaleString('en-GB');
                welcomeRecordCount.textContent = data.length.toLocaleString('en-GB');
            }
            this.eventBus.emit('data:loaded', { count: data.length });
            this.statsManager.calculateFromData(data);

        } finally {
            this.stateManager.set('isLoading', false);
        }
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) {
            if (show) {
                loading.classList.remove('hidden');
            } else {
                loading.classList.add('hidden');
            }
        }
    }

    setupModalButtonHandlers() {
        const downloadTemplateBtn = document.getElementById('download-template-btn');
        const sendEmailBtn = document.getElementById('send-email-btn');
        const sendBugReportBtn = document.getElementById('send-bug-report-btn');
        const sendSuggestionBtn = document.getElementById('send-suggestion-btn');

        if (downloadTemplateBtn) {
            downloadTemplateBtn.addEventListener('click', () => {
                this.emailHelper.downloadXLSXTemplate();
            });
        }

        if (sendEmailBtn) {
            sendEmailBtn.addEventListener('click', () => {
                this.emailHelper.openSubmitDataEmail();
            });
        }

        if (sendBugReportBtn) {
            sendBugReportBtn.addEventListener('click', () => {
                this.emailHelper.openReportBugEmail();
            });
        }

        if (sendSuggestionBtn) {
            sendSuggestionBtn.addEventListener('click', () => {
                this.emailHelper.openSuggestionEmail();
            });
        }
    }
}

function initApp() {
    if (document.getElementById('map')) {
        const app = new FloodMapApplication();
        app.init();
    } else {
        console.error('Required DOM elements not found');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

export default FloodMapApplication;
