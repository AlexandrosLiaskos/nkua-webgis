/**
 * Beach Rocks Web Map - Frontend Application
 * Handles map visualization, filtering, and user interactions for beachrock data
 */

// Filter inputs can hold several values (multi-select); see NkuaWebGISUI.
const readFilter = id => window.NkuaWebGISUI.readFilterInput(document.getElementById(id));
const writeFilter = (input, value) => window.NkuaWebGISUI.writeFilterInput(input, value);

// A filter input holds one value, or several as a JSON array. The data functions
// take each filter as a PostgreSQL text array, written here as an array literal.
const filterValues = raw => {
    const text = raw === null || raw === undefined ? '' : String(raw);
    if (!text) return [];
    if (text.charAt(0) === '[') {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed.map(String);
        } catch (_error) { /* A single value that happens to start with "[". */ }
    }
    return [text];
};
const filterArray = raw => {
    const values = filterValues(raw);
    if (!values.length) return null;
    return `{${values.map(value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
};

const BEACHROCK_MAP_CATEGORIES = [
    { key: 'mediterranean', label: 'Mediterranean & Black Sea', color: '#dc2626', border: '#f87171' },
    { key: 'indo_pacific', label: 'Indo-Pacific & marginal seas', color: '#f97316', border: '#fdba74' },
    { key: 'atlantic_other', label: 'Atlantic & other waters', color: '#0d9488', border: '#5eead4' }
];

const BEACHROCK_BASIN_BY_WATER = {
    'Mediterranean Sea': 'mediterranean',
    'Aegean Sea': 'mediterranean',
    'Ionian Sea': 'mediterranean',
    'Black Sea': 'mediterranean',
    'Indian Ocean': 'indo_pacific',
    'Red Sea': 'indo_pacific',
    'Persian Gulf': 'indo_pacific',
    'Pacific Ocean': 'indo_pacific',
    'Atlantic Ocean': 'atlantic_other',
    'Caribbean Sea': 'atlantic_other',
    'Lake': 'atlantic_other'
};

function getBeachrockMapCategory(beachrock) {
    const key = BEACHROCK_BASIN_BY_WATER[beachrock?.ocean_sea] || 'atlantic_other';
    return BEACHROCK_MAP_CATEGORIES.find(category => category.key === key);
}

class BeachRockMapApp {
    constructor() {
        this.map = null;
        this.beachrockLayer = null;
        this.markerCluster = null;
        this.mapLegend = null;
        this.currentData = [];
        this.totalCount = 0;
        this.filterOptions = {};
        this.isLoading = false;
        this.filterDebounceTimer = null;
        this.filterUpdateTimer = null;
        this.isUpdatingFilters = false;
        this.beachrockDetailsCache = new Map();
        this.modalElements = null;
        this.popupTemplate = null;
        this.filterOptionsCache = null;
        this.filterOptionsCacheTimestamp = null;
        this.FILTER_CACHE_TTL = 5 * 60 * 1000;
        
        this.init();
    }
    
    async init() {
        this.cacheModalElements();
        this.initMap();
        this.initEventListeners();
        this.initCommonInterface();
        await this.checkDatabaseConnection();
        await this.loadFilterOptions();
        await this.loadStats({});
        await this.loadBeachrockData();
    }
    
    initMap() {
        // Global view centered on world
        this.map = L.map('map', {
            preferCanvas: false,
            maxZoom: 19,
            zoomControl: true,
            attributionControl: true,
            renderer: L.svg({ padding: 0.5 }),
            zoomAnimation: true,
            zoomAnimationThreshold: 4,
            fadeAnimation: true,
            markerZoomAnimation: true,
            zoomSnap: 0.25,
            zoomDelta: 0.5,
            wheelPxPerZoomLevel: 80
        }).setView([25, 0], 2);
        
        const baseMaps = window.NkuaWebGISMap.createBasemaps();
        const defaultBasemap = window.NkuaWebGISMap.addDefault(this.map, baseMaps);
        window.NkuaWebGISMap.addBasemapPicker(this.map, baseMaps, { defaultName: defaultBasemap });
        window.NkuaWebGISMap.addNorthArrow(this.map);

        if (typeof MeasurementTool !== 'undefined') {
            this.measurementTool = new MeasurementTool(this.map);
        }
        this.lasso = window.NkuaWebGISMap.addLassoSelection(this.map, {
            onChange: () => this.applyFilters()
        });

        this.markerCluster = L.markerClusterGroup({
            chunkedLoading: true,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 60,
            iconCreateFunction: cluster => window.NkuaWebGISMap.createCategoryClusterIcon(cluster, this.mapLegend.categories())
        });
        
        this.map.addLayer(this.markerCluster);
        this.mapLegend = window.NkuaWebGISDisplay.create(this.map, {
            storageKey: 'nkua-beachrocks-display-v1',
            defaultLabel: 'Ocean basin',
            onChange: () => this.updateMap({ fit: false }),
            title: 'Ocean basin',
            subtitle: '3 groups',
            ariaLabel: 'Beachrock ocean-basin legend',
            categories: BEACHROCK_MAP_CATEGORIES,
            classify: getBeachrockMapCategory
        });
    }
    
    initEventListeners() {
        // Tab navigation
        if (window.innerWidth > 768) {
            const tabButtons = document.querySelectorAll('.tab-button');
            const tabContents = document.querySelectorAll('.tab-content');
            
            tabButtons.forEach(button => {
                button.addEventListener('click', () => {
                    tabButtons.forEach(btn => btn.classList.remove('active'));
                    tabContents.forEach(content => content.classList.remove('active'));
                    button.classList.add('active');
                    const tabId = button.dataset.tab + '-tab';
                    document.getElementById(tabId).classList.add('active');
                });
            });
        }
        
        // Filter change handler
        const handleFilterChange = async () => {
            if (this.isUpdatingFilters) return;
            this.isUpdatingFilters = true;

            const selectedFilters = {
                country: readFilter('country-filter'),
                ocean: readFilter('ocean-filter'),
                cement: readFilter('cement-filter'),
                process: readFilter('process-filter'),
                location: readFilter('location-filter'),
                dating: readFilter('dating-filter')
            };
            
            try {
                await this.loadFilterOptions(selectedFilters);
                this.applyFilters();
            } finally {
                this.isUpdatingFilters = false;
            }
        };

        this.handleFilterChange = handleFilterChange;
        
        // Attach filter listeners
        document.getElementById('country-filter').addEventListener('change', handleFilterChange);
        document.getElementById('ocean-filter').addEventListener('change', handleFilterChange);
        document.getElementById('cement-filter').addEventListener('change', handleFilterChange);
        document.getElementById('process-filter').addEventListener('change', handleFilterChange);
        document.getElementById('location-filter').addEventListener('change', handleFilterChange);
        document.getElementById('dating-filter').addEventListener('change', handleFilterChange);
        
        document.getElementById('clear-filters').addEventListener('click', () => {
            this.clearFilters();
        });
        
        // Modal controls
        const modal = document.getElementById('beachrock-modal');
        const closeBtn = document.querySelector('.close');
        
        closeBtn.addEventListener('click', () => this.closeModal());
        
        document.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.closeModal();
            }
        });
        
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && modal.classList.contains('active')) {
                this.closeModal();
            }
        });
        
        // Welcome modal
        const welcomeModal = document.getElementById('welcome-modal');
        const closeWelcome = document.getElementById('close-welcome');
        const enterWebGIS = document.getElementById('enter-webgis');
        const aboutBtn = document.getElementById('about-btn');

        const closeWelcomeModal = () => {
            if (welcomeModal) welcomeModal.classList.remove('active');
        };

        if (welcomeModal) {
            const isEmbedded = new URLSearchParams(window.location.search).get('embed') === '1';
            if (!isEmbedded) {
                setTimeout(() => welcomeModal.classList.add('active'), 300);
            }
            if (closeWelcome) closeWelcome.addEventListener('click', closeWelcomeModal);
            if (enterWebGIS) {
                enterWebGIS.addEventListener('click', () => {
                    if (window.NkuaWebGISUI?.revealWelcomeModal) {
                        window.NkuaWebGISUI.revealWelcomeModal(welcomeModal, closeWelcomeModal);
                    } else {
                        closeWelcomeModal();
                    }
                });
            }
            welcomeModal.addEventListener('click', (event) => {
                if (event.target === welcomeModal) closeWelcomeModal();
            });
        }

        if (aboutBtn && welcomeModal) {
            aboutBtn.addEventListener('click', () => welcomeModal.classList.add('active'));
        }

        // References modal
        const referencesBtn = document.getElementById('references-btn');
        const referencesModal = document.getElementById('references-modal');
        const closeReferences = document.getElementById('close-references');

        if (referencesBtn && referencesModal) {
            referencesBtn.addEventListener('click', () => referencesModal.classList.add('active'));
            if (closeReferences) {
                closeReferences.addEventListener('click', () => referencesModal.classList.remove('active'));
            }
            referencesModal.addEventListener('click', (event) => {
                if (event.target === referencesModal) referencesModal.classList.remove('active');
            });
        }

        // Submit data modal
        const submitDataBtn = document.getElementById('submit-data-btn');
        const submitDataModal = document.getElementById('submit-data-modal');
        const closeSubmitData = document.getElementById('close-submit-data');
        const closeSubmitDataModal = () => submitDataModal?.classList.remove('active');

        if (submitDataBtn && submitDataModal) {
            submitDataBtn.addEventListener('click', () => submitDataModal.classList.add('active'));
            closeSubmitData?.addEventListener('click', closeSubmitDataModal);
            submitDataModal.addEventListener('click', (event) => {
                if (event.target === submitDataModal) closeSubmitDataModal();
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') closeSubmitDataModal();
            });
        }

        // Mobile controls
        const mobileFiltersToggle = document.getElementById('mobile-filters-toggle');
        const mobileSearchToggle = document.getElementById('mobile-search-toggle');
        const mobileStatsToggle = document.getElementById('mobile-stats-toggle');
        const sidebar = document.getElementById('sidebar');
        const mobileClose = document.getElementById('mobile-sidebar-close');

        if (mobileFiltersToggle && sidebar) {
            mobileFiltersToggle.addEventListener('click', () => {
                sidebar.classList.toggle('active');
                document.getElementById('filters-tab').classList.add('active');
                document.getElementById('search-tab').classList.remove('active');
                document.getElementById('stats-tab').classList.remove('active');
            });
        }

        if (mobileSearchToggle && sidebar) {
            mobileSearchToggle.addEventListener('click', () => {
                sidebar.classList.toggle('active');
                document.getElementById('search-tab').classList.add('active');
                document.getElementById('filters-tab').classList.remove('active');
                document.getElementById('stats-tab').classList.remove('active');
            });
        }

        if (mobileStatsToggle && sidebar) {
            mobileStatsToggle.addEventListener('click', () => {
                sidebar.classList.toggle('active');
                document.getElementById('stats-tab').classList.add('active');
                document.getElementById('filters-tab').classList.remove('active');
                document.getElementById('search-tab').classList.remove('active');
            });
        }

        if (mobileClose && sidebar) {
            mobileClose.addEventListener('click', () => sidebar.classList.remove('active'));
        }

        if (window.NkuaWebGISUI) {
            window.NkuaWebGISUI.setupSearch({
                inputId: 'global-search-input',
                resultsId: 'global-search-results',
                getRecords: () => this.currentData,
                fields: ['site', 'area', 'country', 'ocean_sea'],
                label: record => record.site || record.area || `Beachrock ${record.id}`,
                meta: ['country', 'ocean_sea'],
                onSelect: record => {
                    this.map.setView([Number(record.latitude), Number(record.longitude)], 9);
                    this.showBeachrockDetails(record.id);
                }
            });
        }
    }

    initCommonInterface() {
        if (!window.NkuaWebGISUI?.createAtlasInterface) return;
        this.commonInterface = window.NkuaWebGISUI.createAtlasInterface({
            getRecords: () => this.currentData,
            getOptions: (field) => {
                const input = document.getElementById(field.inputId);
                return input?.options ? Array.from(input.options).map(option => option.value).filter(Boolean) : [];
            },
            onApply: async (field, value) => {
                const input = document.getElementById(field.inputId);
                if (!input) return;
                writeFilter(input, value);
                input.classList.toggle('has-value', Boolean(value));
                await this.handleFilterChange();
            },
            onAdvancedApply: records => {
                this.currentData = records;
                this.updateMap();
            },
            onAdvancedClear: () => this.applyFilters(),
            statisticsRecordLabel: record => record.site || record.area || `Beachrock ${record.id}`,
            statisticsRecordMeta: record => [record.area, record.country, record.ocean_sea].filter(Boolean).join(' · '),
            onStatisticsRecordSelect: record => {
                const latitude = Number(record.latitude);
                const longitude = Number(record.longitude);
                if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                    this.map.setView([latitude, longitude], 9);
                }
                this.showBeachrockDetails(record.id);
            },
            filterFields: [
                { key: 'country', dataField: 'country', inputId: 'country-filter', label: 'Country', group: 'Geography' },
                { key: 'ocean', dataField: 'ocean_sea', inputId: 'ocean-filter', label: 'Ocean / sea', group: 'Geography' },
                { key: 'cement', dataField: 'cement_type', inputId: 'cement-filter', label: 'Cement type', group: 'Geology' },
                { key: 'process', dataField: 'formation_process', inputId: 'process-filter', label: 'Formation process', group: 'Formation' },
                { key: 'location', dataField: 'formation_location', inputId: 'location-filter', label: 'Formation location', group: 'Formation' },
                { key: 'dating', dataField: 'dating_method', inputId: 'dating-filter', label: 'Dating method', group: 'Dating' }
            ],
            statisticsFields: [
                {
                    key: 'country',
                    dataField: 'country',
                    label: 'Country',
                    type: 'categorical',
                    group: 'Geography',
                    maxItems: 12,
                    description: 'Country assigned to each documented beachrock site. Less frequent countries are combined as Other.'
                },
                {
                    key: 'ocean',
                    dataField: 'ocean_sea',
                    label: 'Ocean / sea',
                    type: 'categorical',
                    group: 'Geography',
                    maxItems: 11,
                    description: 'Marine basin bordering the documented beachrock site.'
                },
                {
                    key: 'position',
                    dataField: 'pos_type',
                    label: 'Position precision',
                    type: 'categorical',
                    group: 'Data quality',
                    maxItems: 3,
                    description: 'How precisely the catalogue coordinates reproduce the location reported in the original publication.',
                    glossary: [
                        { term: 'Exact', meaning: 'The point follows an exact location reported in the original publication.' },
                        { term: 'Proximate', meaning: 'The point is an approximate site location because exact published coordinates were unavailable.' }
                    ]
                },
                {
                    key: 'cement',
                    dataField: 'cement_type',
                    label: 'Cement mineralogy',
                    type: 'categorical',
                    group: 'Geology',
                    maxItems: 11,
                    description: 'Mineral phase or assemblage reported as cementing the beach sediment. This property is not reported for every catalogue record.',
                    glossary: [
                        { term: 'Ar', meaning: 'Aragonite.' },
                        { term: 'Cal', meaning: 'Calcite.' },
                        { term: 'HMC', meaning: 'High-magnesium calcite.' },
                        { term: 'LMC', meaning: 'Low-magnesium calcite.' },
                        { term: 'Si', meaning: 'Silica.' },
                        { term: 'Spar', meaning: 'Sparry, coarse-crystalline cement.' }
                    ]
                },
                {
                    key: 'process',
                    dataField: 'formation_process',
                    label: 'Reported formation process',
                    type: 'categorical',
                    group: 'Formation',
                    maxItems: 12,
                    description: 'Cementation mechanism proposed by the cited study. Combined labels retain multiple mechanisms reported for the same site.'
                },
                {
                    key: 'location',
                    dataField: 'formation_location',
                    label: 'Formation zone',
                    type: 'categorical',
                    group: 'Formation',
                    maxItems: 10,
                    description: 'Shore-level zone in which formation was reported or inferred.',
                    glossary: [
                        { term: 'Intertidal', meaning: 'Shore zone regularly covered and exposed by the tide.' },
                        { term: 'Supratidal', meaning: 'Zone above normal high tide, reached mainly by spray or exceptional water levels.' }
                    ]
                },
                {
                    key: 'dating',
                    dataField: 'dating_method',
                    label: 'Dating method',
                    type: 'categorical',
                    group: 'Dating',
                    maxItems: 12,
                    description: 'Method used by the cited study to estimate the beachrock age. Records without a reported method are excluded from the chart.',
                    glossary: [
                        { term: '14C', meaning: 'Radiocarbon dating.' },
                        { term: '14C-AMS', meaning: 'Accelerator mass spectrometry radiocarbon dating.' },
                        { term: 'OSL', meaning: 'Optically stimulated luminescence dating.' },
                        { term: 'U/Th', meaning: 'Uranium–thorium dating.' },
                        { term: 'SL', meaning: 'Sea level.' }
                    ]
                }
            ]
        });
        this.mapLegend.attach(this.commonInterface);
        this.lasso.attach(this.commonInterface, beachrock => [beachrock.latitude, beachrock.longitude]);
    }

    async loadFilterOptions(selectedFilters = {}) {
        if (!window.supabaseClient) {
            console.error('❌ Database connection not initialized.');
            this.showError('Database connection not initialized.');
            return;
        }
        
        try {
            this.showFilterLoading(true);
            
            // One request returns the values of all lists; each list is
            // computed in the database with the other five filters applied.
            const { data: optionRows, error: optionError } = await window.supabaseClient.rpc('api_beachrocks_filter_options', {
                p_country: filterArray(selectedFilters.country),
                p_ocean_sea: filterArray(selectedFilters.ocean),
                p_cement_type: filterArray(selectedFilters.cement),
                p_formation_process: filterArray(selectedFilters.process),
                p_formation_location: filterArray(selectedFilters.location),
                p_dating_method: filterArray(selectedFilters.dating)
            });
            if (optionError) throw optionError;
            const optionsOf = field => this._getUniqueValues(
                (optionRows || []).filter(row => row.field === field).map(row => ({ [field]: row.value })),
                field
            );
            const countries = optionsOf('country');
            const oceans = optionsOf('ocean_sea');
            const cements = optionsOf('cement_type');
            const processes = optionsOf('formation_process');
            const locations = optionsOf('formation_location');
            const datings = optionsOf('dating_method');

            this.filterOptions = { countries, oceans, cements, processes, locations, datings };
            this.populateFilterDropdowns(selectedFilters);
            this.showFilterLoading(false);
            
        } catch (error) {
            console.error('❌ Error loading filter options:', error);
            this.showFilterLoading(false);
            this.showError('Failed to load filter options.');
        }
    }
    
    _getUniqueValues(data, fieldName) {
        const uniqueValues = new Set();
        data.forEach(item => {
            const value = item[fieldName];
            if (value !== null && value !== undefined) {
                const processedValue = typeof value === 'string' ? value.trim() : value;
                if (processedValue !== '') uniqueValues.add(processedValue);
            }
        });
        return Array.from(uniqueValues).sort((a, b) => String(a).localeCompare(String(b)));
    }
    
    populateFilterDropdowns(selectedFilters = {}) {
        this.populateDropdown('country', this.filterOptions.countries, selectedFilters.country);
        this.populateDropdown('ocean', this.filterOptions.oceans, selectedFilters.ocean);
        this.populateDropdown('cement', this.filterOptions.cements, selectedFilters.cement);
        this.populateDropdown('process', this.filterOptions.processes, selectedFilters.process);
        this.populateDropdown('location', this.filterOptions.locations, selectedFilters.location);
        this.populateDropdown('dating', this.filterOptions.datings, selectedFilters.dating);
    }
    
    populateDropdown(filterName, options, currentValue) {
        const select = document.getElementById(`${filterName}-filter`);
        if (!select) return;

        while (select.options.length > 1) select.remove(1);

        options.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });

        if (currentValue) {
            writeFilter(select, currentValue);
            select.classList.add('has-value');
        } else {
            select.value = '';
            select.classList.remove('has-value');
        }

        if (window.refreshDropdown) window.refreshDropdown(`${filterName}-filter`);
    }
    
    async loadStats(filters = {}) {
        try {
            // Total count (always shows total in database)
            const { data: totalCount } = await window.supabaseClient.rpc('api_beachrocks_count');
            this.totalCount = totalCount || 0;
            document.getElementById('total-beachrocks').textContent = this.totalCount.toLocaleString();
            
            // Visible stats are calculated from currentData (filtered data)
            this.updateVisibleStats();
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
    
    updateVisibleStats() {
        const data = this.currentData || [];
        
        // Visible countries
        const countries = new Set(data.filter(p => p.country).map(p => p.country)).size;
        document.getElementById('visible-countries').textContent = countries.toLocaleString();
        
        // Visible oceans/seas
        const oceans = new Set(data.filter(p => p.ocean_sea).map(p => p.ocean_sea)).size;
        document.getElementById('visible-oceans').textContent = oceans.toLocaleString();
        
        // Visible cement types
        const cementTypes = new Set(data.filter(p => p.cement_type).map(p => p.cement_type)).size;
        document.getElementById('visible-cement-types').textContent = cementTypes.toLocaleString();
        
        // Visible points count
        document.getElementById('visible-points').textContent = data.length.toLocaleString();

        if (window.NkuaWebGISUI) {
            window.NkuaWebGISUI.renderStatistics({
                containerId: 'stats-tab',
                records: data,
                field: 'country',
                figureTitle: 'Beachrocks by country',
                axisLabel: 'Country',
                maxItems: 8,
                summaryRows: [
                    { label: 'Catalogue total', value: this.totalCount, id: 'total-beachrocks' },
                    { label: 'Visible records', value: data.length, id: 'visible-points' },
                    { label: 'Visible countries', value: countries, id: 'visible-countries' },
                    { label: 'Visible oceans / seas', value: oceans, id: 'visible-oceans' },
                    { label: 'Visible cement types', value: cementTypes, id: 'visible-cement-types' }
                ]
            });
        }
        this.commonInterface?.setRecords(data);
    }

    
    async loadBeachrockData(filters = {}) {
        if (this.isLoading) return;
        
        this.showLoading(true);
        this.isLoading = true;
        
        try {
            // Marker-level columns only; the full record is read one at a time
            // by api_beachrocks_details when a record is opened.
            const query = window.supabaseClient.rpc('api_beachrocks_markers', {
                p_country: filterArray(filters.country),
                p_ocean_sea: filterArray(filters.ocean),
                p_cement_type: filterArray(filters.cement),
                p_formation_process: filterArray(filters.process),
                p_formation_location: filterArray(filters.location),
                p_dating_method: filterArray(filters.dating)
            }).limit(1000);

            const { data, error } = await query;
            if (error) throw error;
            
            console.log(`✅ Loaded ${data.length} beachrocks`);
            this.currentData = this.lasso.filter(data, beachrock => [beachrock.latitude, beachrock.longitude]);
            this.updateMap();
            this.updateVisibleStats();
            
        } catch (error) {
            console.error('❌ Error loading beachrock data:', error);
            this.showError('Failed to load beachrock data.');
        } finally {
            this.showLoading(false);
            this.isLoading = false;
        }
    }
    
    updateMap({ fit = true } = {}) {
        this.markerCluster.clearLayers();
        
        const markers = this.mapLegend.visible(this.currentData).map(beachrock => {
            const category = this.getMapCategory(beachrock);
            const marker = L.marker(
                [beachrock.latitude, beachrock.longitude],
                { icon: window.NkuaWebGISMap.createCategoryMarkerIcon(category) }
            );
            marker._mapCategory = category.key;
            
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                this.showBeachrockDetails(beachrock.id);
            });
            
            const localityParts = [beachrock.area, beachrock.country].filter(Boolean);
            const tooltipContent = `
                <div class="lagoon-hover-card is-text-only">
                    <div class="lagoon-hover-body">
                        <span class="lagoon-hover-eyebrow">Beachrock site</span>
                        <h3 class="lagoon-hover-name">
                            <span class="lagoon-hover-name-en">${this.escapeHtml(beachrock.site || 'Unnamed site')}</span>
                        </h3>
                        ${localityParts.length ? `
                            <div class="lagoon-hover-locality">
                                <svg class="lagoon-hover-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                    <circle cx="12" cy="10" r="3"></circle>
                                </svg>
                                <span class="lagoon-hover-loc-main">${this.escapeHtml(localityParts[0])}</span>
                                ${localityParts[1] ? `<span class="lagoon-hover-loc-dot" aria-hidden="true">·</span><span class="lagoon-hover-loc-island">${this.escapeHtml(localityParts[1])}</span>` : ''}
                            </div>
                        ` : ''}
                        <div class="lagoon-hover-stats">
                            <div class="lagoon-hover-stat">
                                <span class="lagoon-hover-stat-label">Ocean / Sea</span>
                                <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                                <span class="lagoon-hover-stat-value">${this.escapeHtml(beachrock.ocean_sea || '—')}</span>
                            </div>
                            <div class="lagoon-hover-stat">
                                <span class="lagoon-hover-stat-label">Position</span>
                                <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                                <span class="lagoon-hover-stat-value">${this.escapeHtml(beachrock.pos_type || '—')}</span>
                            </div>
                            <div class="lagoon-hover-stat">
                                <span class="lagoon-hover-stat-label">Cement</span>
                                <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                                <span class="lagoon-hover-stat-value">${this.escapeHtml(beachrock.cement_type || '—')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            marker.bindTooltip(tooltipContent, {
                direction: 'top',
                offset: [0, -10],
                opacity: 1,
                className: 'custom-tooltip'
            });
            
            marker.on('mouseover', () => marker.openTooltip());
            marker.on('mouseout', () => marker.closeTooltip());
            
            return marker;
        });
        
        if (markers.length > 0) {
            this.markerCluster.addLayers(markers);
            const bounds = this.markerCluster.getBounds();
            if (fit && bounds.isValid()) this.map.fitBounds(bounds.pad(0.05));
        }

        this.mapLegend?.update(this.currentData);
        
        this.updateVisibleStats();
    }
    
    getMapCategory(beachrock) {
        return this.mapLegend.classify(beachrock);
    }
    
    async showBeachrockDetails(beachrockId) {
        if (this.beachrockDetailsCache.has(beachrockId)) {
            this.displayBeachrockModal(this.beachrockDetailsCache.get(beachrockId));
            return;
        }
        
        try {
            const { data: beachrock, error } = await window.supabaseClient
                .rpc('api_beachrocks_details', { p_id: beachrockId })
                .single();
            if (error) throw error;
            
            beachrock.dataset_reference = 'https://doi.org/10.5281/zenodo.16408107';
            this.beachrockDetailsCache.set(beachrockId, beachrock);
            this.displayBeachrockModal(beachrock);
        } catch (error) {
            console.error('Error loading beachrock details:', error);
            this.showError('Failed to load beachrock details.');
        }
    }
    
    displayBeachrockModal(beachrock) {
        if (!this.modalElements) this.cacheModalElements();
        const localityParts = [beachrock.area, beachrock.country, beachrock.ocean_sea].filter(Boolean);
        const titleblock = document.getElementById('beachrock-modal-titleblock');
        if (titleblock) {
            const localityHtml = localityParts.map((part, index) => `
                ${index ? '<span class="lagoon-locality-dot" aria-hidden="true">·</span>' : ''}
                <span class="${index === 0 ? 'lagoon-locality-main' : 'lagoon-locality-island'}">${this.escapeHtml(part)}</span>
            `).join('');

            titleblock.innerHTML = `
                <span class="lagoon-eyebrow">Beachrock site</span>
                <h2 class="lagoon-name">
                    <span class="lagoon-name-en">${this.escapeHtml(beachrock.site || 'Unnamed site')}</span>
                </h2>
                ${localityHtml ? `
                    <p class="lagoon-locality">
                        <svg class="lagoon-locality-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        ${localityHtml}
                    </p>
                ` : ''}
            `;
        }

        const sections = [
            { title: 'Location', fields: [
                { key: 'id', label: 'ID' },
                { key: 'site', label: 'Site' },
                { key: 'area', label: 'Area' },
                { key: 'country', label: 'Country' },
                { key: 'ocean_sea', label: 'Ocean / Sea' },
                { key: 'latitude', label: 'Latitude' },
                { key: 'longitude', label: 'Longitude' },
                { key: 'pos_type', label: 'Position type' }
            ] },
            { title: 'Morphometry', fields: [
                { key: 'maximum_altitude', label: 'Maximum altitude' },
                { key: 'minimum_altitude', label: 'Minimum altitude' },
                { key: 'no_of_slabs', label: 'Number of slabs' },
                { key: 'tidal_range', label: 'Tidal range' }
            ] },
            { title: 'Composition and formation', fields: [
                { key: 'main_composition', label: 'Main composition' },
                { key: 'cement_type', label: 'Cement type' },
                { key: 'cement_microstructure', label: 'Cement microstructure' },
                { key: 'formation_process', label: 'Formation process' },
                { key: 'formation_location', label: 'Formation location' },
                { key: 'water_table', label: 'Water table' }
            ] },
            { title: 'Dating and sources', fields: [
                { key: 'dating_method', label: 'Dating method' },
                { key: 'dated_sample', label: 'Dated sample' },
                { key: 'estimated_age', label: 'Estimated age' },
                { key: 'reference', label: 'Reference' },
                { key: 'publication_year', label: 'Publication year' },
                { key: 'dataset_reference', label: 'Dataset reference', isLink: true }
            ] }
        ];

        const html = sections.map(section => {
            const rows = section.fields.map(field => {
                const value = beachrock[field.key];
                const hasValue = value !== null && value !== undefined && String(value).trim() !== '';
                const displayValue = hasValue ? value : '—';
                let valueHtml;
                if (field.isLink && hasValue) {
                    valueHtml = `<a href="${this.escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(value)}</a>`;
                } else if (field.key === 'id' && hasValue) {
                    valueHtml = `#${this.escapeHtml(value)}`;
                } else {
                    valueHtml = this.escapeHtml(displayValue);
                }

                return `
                    <div class="detail-item">
                        <div class="detail-label">${field.label}</div>
                        <div class="detail-value">${valueHtml}</div>
                    </div>
                `;
            }).join('');

            return `
                <section class="lagoon-modal-section">
                    <header class="lagoon-modal-section-head">
                        <h4 class="lagoon-modal-section-title">${section.title}</h4>
                    </header>
                    <div class="lagoon-modal-details-grid">${rows}</div>
                </section>
            `;
        }).join('');
        
        this.modalElements.detailsContainer.innerHTML = html;
        this.modalElements.modal.classList.add('active');
        document.body.classList.add('modal-open');
    }
    
    async applyFilters() {
        const filters = {
            country: readFilter('country-filter'),
            ocean: readFilter('ocean-filter'),
            cement: readFilter('cement-filter'),
            process: readFilter('process-filter'),
            location: readFilter('location-filter'),
            dating: readFilter('dating-filter')
        };
        
        let activeCount = 0;
        Object.keys(filters).forEach(key => {
            if (!filters[key]) delete filters[key];
            else activeCount++;
        });
        
        this.updateActiveFiltersDisplay(filters);
        this.updateFilterIndicator(activeCount, filters);
        
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.remove('active');
        }
        
        await this.loadBeachrockData(filters);
        await this.loadStats(filters);
    }
    
    updateFilterIndicator(count, filters = {}) {
        const toggleBtn = document.getElementById('mobile-filters-toggle');
        if (!toggleBtn) return;
        
        if (count > 0) {
            toggleBtn.textContent = `Filters (${count})`;
            toggleBtn.style.borderColor = 'var(--accent-blue)';
        } else {
            toggleBtn.textContent = 'Filters';
            toggleBtn.style.borderColor = '';
        }
    }
    
    async checkDatabaseConnection() {
        if (!window.supabaseClient) {
            this.showError('Database connection not initialized.');
            return false;
        }
        
        try {
            const { data: count, error } = await window.supabaseClient
                .rpc('api_beachrocks_count');
            
            if (error) {
                this.showError('Failed to connect to database.');
                return false;
            }
            
            console.log(`✅ Database connected. ${count} beachrocks found.`);
            return true;
        } catch (error) {
            this.showError('Database connection error.');
            return false;
        }
    }
    
    showFilterLoading(show) {
        const filterLoading = document.getElementById('filter-loading');
        if (filterLoading) {
            filterLoading.classList.toggle('hidden', !show);
        }
    }
    
    async clearFilters() {
        this.lasso.clear(true);
        const filterIds = ['country-filter', 'ocean-filter', 'cement-filter', 'process-filter', 'location-filter', 'dating-filter'];
        filterIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                el.classList.remove('has-value');
            }
        });
        
        const summary = document.getElementById('active-filters-summary');
        if (summary) summary.classList.add('hidden');
        
        await this.loadFilterOptions({});
        this.updateFilterIndicator(0, {});
        this.applyFilters();
    }
    
    updateActiveFiltersDisplay(filters) {
        const summary = document.getElementById('active-filters-summary');
        const list = document.getElementById('active-filters-list');
        if (!summary || !list) return;
        
        list.innerHTML = '';
        
        const labels = {
            country: 'Country',
            ocean: 'Ocean/Sea',
            cement: 'Cement Type',
            process: 'Formation Process',
            location: 'Formation Location',
            dating: 'Dating Method'
        };
        
        const activeCount = Object.keys(filters).length;
        if (activeCount === 0) {
            summary.classList.add('hidden');
            return;
        }
        
        summary.classList.remove('hidden');
        
        Object.keys(filters).forEach(key => {
            const badge = document.createElement('div');
            badge.className = 'filter-badge';
            badge.innerHTML = `
                <span class="filter-badge-label">${labels[key] || key}:</span>
                <span class="filter-badge-value">${this.escapeHtml(filters[key])}</span>
                <button class="filter-badge-remove" title="Remove filter">×</button>
            `;
            badge.querySelector('.filter-badge-remove').addEventListener('click', () => this.clearIndividualFilter(key));
            list.appendChild(badge);
        });
    }
    
    async clearIndividualFilter(filterName) {
        const filterIds = {
            country: 'country-filter',
            ocean: 'ocean-filter',
            cement: 'cement-filter',
            process: 'process-filter',
            location: 'location-filter',
            dating: 'dating-filter'
        };
        
        const el = document.getElementById(filterIds[filterName]);
        if (el) {
            el.value = '';
            el.classList.remove('has-value');
        }
        this.applyFilters();
    }
    
    updateVisiblePointsCount() {
        document.getElementById('visible-points').textContent = this.currentData.length.toLocaleString();
    }
    
    showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) loading.classList.toggle('hidden', !show);
    }
    
    showError(message) {
        console.error('Error:', message);
        let errorBanner = document.getElementById('error-banner');
        if (errorBanner) {
            const msgEl = document.getElementById('error-banner-message');
            if (msgEl) msgEl.textContent = message;
            errorBanner.classList.remove('hidden');
        }
    }
    
    closeModal() {
        if (this.modalElements && this.modalElements.modal) {
            this.modalElements.modal.classList.remove('active');
        }
        document.body.classList.remove('modal-open');
    }
    
    cacheModalElements() {
        this.modalElements = {
            modal: document.getElementById('beachrock-modal'),
            detailsContainer: document.getElementById('beachrock-details')
        };
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    addNorthArrow() {
        const NorthArrowControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: function(map) {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control north-arrow-control');
                container.innerHTML = `
                    <div style="background: white; padding: 5px; border-radius: 4px; box-shadow: 0 1px 5px rgba(0,0,0,0.3); text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #333;">↑</div>
                        <div style="font-size: 10px; font-weight: bold; color: #333;">N</div>
                    </div>
                `;
                return container;
            }
        });
        this.map.addControl(new NorthArrowControl());
    }
}

// Initialize app
const app = new BeachRockMapApp();
