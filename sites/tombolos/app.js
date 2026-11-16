/**
 * Tombolos Web Map - Frontend Application
 * Handles map visualization, filtering, and user interactions for tombolos data
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

const TOMBOLO_MAP_CATEGORIES = [
    { key: 'submerged', label: 'Currently submerged', color: '#dc2626', border: '#f87171' },
    { key: 'projected', label: 'Projected submerged by 2100', color: '#f97316', border: '#fdba74' },
    { key: 'safe', label: 'Not projected submerged', color: '#0d9488', border: '#5eead4' }
];

function getTomboloMapCategory(tombolo) {
    const isYes = value => String(value || '').trim().toLowerCase() === 'yes';
    if (isYes(tombolo?.submerged)) return TOMBOLO_MAP_CATEGORIES[0];
    if (isYes(tombolo?.sub_rcp26) || isYes(tombolo?.sub_rcp85)) return TOMBOLO_MAP_CATEGORIES[1];
    return TOMBOLO_MAP_CATEGORIES[2];
}

class TomboloMapApp {
    constructor() {
        this.map = null;
        this.tomboloLayer = null;
        this.markerCluster = null;
        this.mapLegend = null;
        this.currentData = [];
        this.totalCount = 0;
        this.totalPrefectures = 0;
        this.submergedCount = 0;
        this.riskCount = 0;
        this.filterOptions = {};
        this.isLoading = false;
        this.filterDebounceTimer = null;
        this.filterUpdateTimer = null;
        this.isUpdatingFilters = false;
        this.tomboloDetailsCache = new Map();
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
        await this.loadTomboloData();
    }
    
    initMap() {
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
        }).setView([39.0742, 21.8243], 7);
        
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
            storageKey: 'nkua-tombolos-display-v1',
            defaultLabel: 'Inundation by 2100',
            onChange: () => this.updateMap({ fit: false }),
            title: 'Inundation',
            subtitle: 'by 2100',
            ariaLabel: 'Tombolo inundation legend',
            categories: TOMBOLO_MAP_CATEGORIES,
            classify: getTomboloMapCategory
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
                prefecture: readFilter('prefecture-filter'),
            island: readFilter('island-filter'),
                island: readFilter('island-filter'),
                type: readFilter('type-filter'),
                category: readFilter('category-filter'),
                submerged: readFilter('submerged-filter'),
                subRcp26: readFilter('rcp26-filter'),
                subRcp85: readFilter('rcp85-filter')
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
        document.getElementById('prefecture-filter').addEventListener('change', handleFilterChange);
        document.getElementById('island-filter').addEventListener('change', handleFilterChange);
        document.getElementById('type-filter').addEventListener('change', handleFilterChange);
        document.getElementById('category-filter').addEventListener('change', handleFilterChange);
        document.getElementById('submerged-filter').addEventListener('change', handleFilterChange);
        document.getElementById('rcp26-filter').addEventListener('change', handleFilterChange);
        document.getElementById('rcp85-filter').addEventListener('change', handleFilterChange);
        
        document.getElementById('clear-filters').addEventListener('click', () => {
            this.clearFilters();
        });
        
        // Modal controls
        const modal = document.getElementById('flood-modal');
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
                fields: ['name_en', 'name_gr', 'prefecture_en', 'island_en'],
                label: record => record.name_en || record.name_gr || `Tombolo ${record.id}`,
                meta: ['prefecture_en', 'island_en'],
                onSelect: record => {
                    this.map.setView([Number(record.latitude), Number(record.longitude)], 11);
                    this.showTomboloDetails(record.id);
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
                this.updateVisiblePointsCount();
            },
            onAdvancedClear: () => this.applyFilters(),
            statisticsRecordLabel: record => record.name_en || record.name_gr || `Tombolo ${record.id}`,
            statisticsRecordMeta: record => [record.prefecture_en, record.island_en].filter(Boolean).join(' · '),
            onStatisticsRecordSelect: record => {
                const latitude = Number(record.latitude);
                const longitude = Number(record.longitude);
                if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                    this.map.setView([latitude, longitude], 11);
                }
                this.showTomboloDetails(record.id);
            },
            filterFields: [
                { key: 'prefecture', dataField: 'prefecture_en', inputId: 'prefecture-filter', label: 'Prefecture', group: 'Geography' },
                { key: 'island', dataField: 'island_en', inputId: 'island-filter', label: 'Island', group: 'Geography' },
                { key: 'type', dataField: 'tombolo_type', inputId: 'type-filter', label: 'Tombolo type', group: 'Morphology' },
                { key: 'category', dataField: 'tombolo_category', inputId: 'category-filter', label: 'Tombolo category', group: 'Morphology' },
                { key: 'submerged', dataField: 'submerged', inputId: 'submerged-filter', label: 'Currently submerged', group: 'Inundation' },
                { key: 'rcp26', dataField: 'sub_rcp26', inputId: 'rcp26-filter', label: 'Submerged · RCP 2.6', group: 'Inundation' },
                { key: 'rcp85', dataField: 'sub_rcp85', inputId: 'rcp85-filter', label: 'Submerged · RCP 8.5', group: 'Inundation' }
            ],
            statisticsFields: [
                {
                    key: 'length',
                    dataField: 'length_m',
                    label: 'Length',
                    type: 'numeric',
                    unit: 'm',
                    group: 'Morphometry',
                    description: 'Mapped length of the sediment connection, in metres.'
                },
                {
                    key: 'width',
                    dataField: 'width_tombolo_m',
                    label: 'Tombolo width',
                    type: 'numeric',
                    unit: 'm',
                    group: 'Morphometry',
                    description: 'Mapped width of the connecting sediment body, in metres.'
                },
                {
                    key: 'height',
                    dataField: 'height_m',
                    label: 'Height',
                    type: 'numeric',
                    unit: 'm',
                    group: 'Morphometry',
                    description: 'Height value recorded for the tombolo in the source catalogue, in metres.'
                },
                {
                    key: 'prefecture',
                    dataField: 'prefecture_en',
                    label: 'Prefecture',
                    type: 'categorical',
                    group: 'Geography',
                    maxItems: 12,
                    description: 'Prefecture assigned to the mapped tombolo. Less frequent prefectures are combined as Other.'
                },
                {
                    key: 'island',
                    dataField: 'island_en',
                    label: 'Island / mainland setting',
                    type: 'categorical',
                    group: 'Geography',
                    maxItems: 12,
                    description: 'Associated island; Mainland Greece identifies sites on the mainland.'
                },
                {
                    key: 'type',
                    dataField: 'tombolo_type',
                    label: 'Tombolo type',
                    type: 'categorical',
                    group: 'Morphology',
                    description: 'Classification by the number of sediment connections that form the tombolo.',
                    glossary: [
                        { term: 'Single', meaning: 'One sediment connection.' },
                        { term: 'Double', meaning: 'Two sediment connections.' }
                    ]
                },
                {
                    key: 'category',
                    dataField: 'tombolo_category',
                    label: 'Tombolo category',
                    type: 'categorical',
                    group: 'Morphology',
                    description: 'Classification by the landforms or structures joined by the tombolo.',
                    glossary: [
                        { term: 'M-I', meaning: 'Mainland to island.' },
                        { term: 'M-R', meaning: 'Mainland to rock.' },
                        { term: 'M-B', meaning: 'Mainland to beachrock.' },
                        { term: 'I-I', meaning: 'Island to island.' },
                        { term: 'M-A', meaning: 'Mainland to an artificial coastal structure.' },
                        { term: 'M-M', meaning: 'Mainland to mainland.' },
                        { term: 'M-I & T-B', meaning: 'Mainland to island, with a secondary tombolo-to-beachrock connection.' }
                    ]
                },
                {
                    key: 'submerged',
                    dataField: 'submerged',
                    label: 'Currently submerged',
                    type: 'categorical',
                    group: 'Inundation',
                    valueLabels: { yes: 'Yes', no: 'No' },
                    description: 'Whether the mapped tombolo is already below present sea level.'
                },
                {
                    key: 'rcp26',
                    dataField: 'sub_rcp26',
                    label: 'Submerged · RCP 2.6',
                    type: 'categorical',
                    group: 'Inundation',
                    valueLabels: { yes: 'Yes', no: 'No', 'already submerged': 'Already submerged' },
                    description: 'Projected full inundation by 2100 under the catalogue’s lower-emissions scenario, assuming no natural or human adaptation.',
                    glossary: [
                        { term: 'RCP 2.6', meaning: 'Lower-emissions pathway; this catalogue applies 0.43 m of sea-level rise by 2100.' },
                        { term: 'Yes / No', meaning: 'Whether full inundation is projected under the scenario.' },
                        { term: 'Already submerged', meaning: 'The tombolo is submerged at the present-day baseline.' }
                    ]
                },
                {
                    key: 'rcp85',
                    dataField: 'sub_rcp85',
                    label: 'Submerged · RCP 8.5',
                    type: 'categorical',
                    group: 'Inundation',
                    valueLabels: { yes: 'Yes', no: 'No', 'already submerged': 'Already submerged' },
                    description: 'Projected full inundation by 2100 under the catalogue’s high-emissions scenario, assuming no natural or human adaptation.',
                    glossary: [
                        { term: 'RCP 8.5', meaning: 'High-emissions pathway; this catalogue applies 0.84 m of sea-level rise by 2100.' },
                        { term: 'Yes / No', meaning: 'Whether full inundation is projected under the scenario.' },
                        { term: 'Already submerged', meaning: 'The tombolo is submerged at the present-day baseline.' }
                    ]
                }
            ]
        });
        this.mapLegend.attach(this.commonInterface);
        this.lasso.attach(this.commonInterface, tombolo => [tombolo.latitude, tombolo.longitude]);
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
            // computed in the database with the same filters applied as before.
            const { data: optionRows, error: optionError } = await window.supabaseClient.rpc('api_tombolos_filter_options', {
                p_prefecture_en: filterArray(selectedFilters.prefecture),
                p_island_en: filterArray(selectedFilters.island),
                p_tombolo_type: filterArray(selectedFilters.type),
                p_tombolo_category: filterArray(selectedFilters.category),
                p_submerged: filterArray(selectedFilters.submerged),
                p_sub_rcp26: filterArray(selectedFilters.subRcp26),
                p_sub_rcp85: filterArray(selectedFilters.subRcp85)
            });
            if (optionError) throw optionError;
            const optionsOf = field => this._getUniqueValues(
                (optionRows || []).filter(row => row.field === field).map(row => ({ [field]: row.value })),
                field
            );
            const prefectures = optionsOf('prefecture_en');
            const islands = optionsOf('island_en');
            const types = optionsOf('tombolo_type');
            const categories = optionsOf('tombolo_category');
            const submerged = optionsOf('submerged');
            const subRcp26 = optionsOf('sub_rcp26');
            const subRcp85 = optionsOf('sub_rcp85');

            this.filterOptions = { prefectures, islands, types, categories, submerged, subRcp26, subRcp85 };
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
        this.populateDropdown('prefecture', this.filterOptions.prefectures, selectedFilters.prefecture);
        this.populateDropdown('island', this.filterOptions.islands, selectedFilters.island);
        this.populateDropdown('type', this.filterOptions.types, selectedFilters.type);
        this.populateDropdown('category', this.filterOptions.categories, selectedFilters.category);
        this.populateDropdown('submerged', this.filterOptions.submerged, selectedFilters.submerged);
        this.populateDropdown('rcp26', this.filterOptions.subRcp26, selectedFilters.subRcp26);
        this.populateDropdown('rcp85', this.filterOptions.subRcp85, selectedFilters.subRcp85);
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
            // Catalogue totals (always for all tombolos, not filtered), computed in the database.
            const { data: summary, error: summaryError } = await window.supabaseClient.rpc('api_tombolos_summary').single();
            if (summaryError) throw summaryError;
            const totalCount = summary.total;
            const prefectures = summary.prefectures;
            const submergedCount = summary.submerged;
            const riskCount = summary.at_risk_rcp85;

            this.totalCount = totalCount || 0;
            this.totalPrefectures = prefectures;
            this.submergedCount = submergedCount || 0;
            this.riskCount = riskCount || 0;
            this.updateVisiblePointsCount();
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
    
    async loadTomboloData(filters = {}) {
        if (this.isLoading) return;
        
        this.showLoading(true);
        this.isLoading = true;
        
        try {
            // Marker-level columns only; the full record is read one at a time
            // by api_tombolos_details when a record is opened.
            const query = window.supabaseClient.rpc('api_tombolos_markers', {
                p_prefecture_en: filterArray(filters.prefecture),
                p_island_en: filterArray(filters.island),
                p_tombolo_type: filterArray(filters.type),
                p_tombolo_category: filterArray(filters.category),
                p_submerged: filterArray(filters.submerged),
                p_sub_rcp26: filterArray(filters.subRcp26),
                p_sub_rcp85: filterArray(filters.subRcp85)
            }).limit(1000);

            const { data, error } = await query;
            if (error) throw error;
            
            console.log(`✅ Loaded ${data.length} tombolos`);
            this.currentData = this.lasso.filter(data, tombolo => [tombolo.latitude, tombolo.longitude]);
            this.updateMap();
            this.updateVisiblePointsCount();
            
        } catch (error) {
            console.error('❌ Error loading tombolo data:', error);
            this.showError('Failed to load tombolo data.');
        } finally {
            this.showLoading(false);
            this.isLoading = false;
        }
    }
    
    updateMap({ fit = true } = {}) {
        this.markerCluster.clearLayers();
        
        const markers = this.mapLegend.visible(this.currentData).map(tombolo => {
            const category = this.getMapCategory(tombolo);
            const marker = L.marker(
                [tombolo.latitude, tombolo.longitude],
                { icon: window.NkuaWebGISMap.createCategoryMarkerIcon(category) }
            );
            marker._mapCategory = category.key;
            
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                this.showTomboloDetails(tombolo.id);
            });
            
            const localityParts = [tombolo.prefecture_en, tombolo.island_en].filter(Boolean);
            const submergedStatus = tombolo.submerged
                ? (String(tombolo.submerged).toLowerCase() === 'yes' ? 'Submerged' : 'Not submerged')
                : '—';
            const tooltipContent = `
                <div class="lagoon-hover-card is-text-only">
                    <div class="lagoon-hover-body">
                        <span class="lagoon-hover-eyebrow">Tombolo</span>
                        <h3 class="lagoon-hover-name">
                            <span class="lagoon-hover-name-en">${this.escapeHtml(tombolo.name_en || 'Unnamed')}</span>
                            ${tombolo.name_gr ? `<span class="lagoon-hover-name-sep" aria-hidden="true">/</span><span class="lagoon-hover-name-gr">${this.escapeHtml(tombolo.name_gr)}</span>` : ''}
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
                                <span class="lagoon-hover-stat-label">Type</span>
                                <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                                <span class="lagoon-hover-stat-value">${this.escapeHtml(tombolo.tombolo_type || '—')}</span>
                            </div>
                            <div class="lagoon-hover-stat">
                                <span class="lagoon-hover-stat-label">Category</span>
                                <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                                <span class="lagoon-hover-stat-value">${this.escapeHtml(tombolo.tombolo_category || '—')}</span>
                            </div>
                            <div class="lagoon-hover-stat">
                                <span class="lagoon-hover-stat-label">Status</span>
                                <span class="lagoon-hover-basis-tag is-empty" aria-hidden="true"></span>
                                <span class="lagoon-hover-stat-value">${this.escapeHtml(submergedStatus)}</span>
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
        
        this.updateVisiblePointsCount();
    }
    
    getMapCategory(tombolo) {
        return this.mapLegend.classify(tombolo);
    }
    
    async showTomboloDetails(tomboloId) {
        if (this.tomboloDetailsCache.has(tomboloId)) {
            this.displayTomboloModal(this.tomboloDetailsCache.get(tomboloId));
            return;
        }
        
        try {
            const { data: tombolo, error } = await window.supabaseClient
                .rpc('api_tombolos_details', { p_id: tomboloId })
                .single();
            if (error) throw error;
            
            tombolo.reference = 'https://doi.org/10.3390/jmse12122112';
            this.tomboloDetailsCache.set(tomboloId, tombolo);
            this.displayTomboloModal(tombolo);
        } catch (error) {
            console.error('Error loading tombolo details:', error);
            this.showError('Failed to load tombolo details.');
        }
    }
    
    displayTomboloModal(tombolo) {
        if (!this.modalElements) this.cacheModalElements();
        const localityParts = [tombolo.prefecture_en, tombolo.island_en].filter(Boolean);
        const titleblock = document.getElementById('tombolo-modal-titleblock');
        if (titleblock) {
            const localityHtml = localityParts.map((part, index) => `
                ${index ? '<span class="lagoon-locality-dot" aria-hidden="true">·</span>' : ''}
                <span class="${index === 0 ? 'lagoon-locality-main' : 'lagoon-locality-island'}">${this.escapeHtml(part)}</span>
            `).join('');

            titleblock.innerHTML = `
                <span class="lagoon-eyebrow">Tombolo</span>
                <h2 class="lagoon-name">
                    <span class="lagoon-name-en">${this.escapeHtml(tombolo.name_en || 'Unnamed')}</span>
                    ${tombolo.name_gr ? `<span class="lagoon-name-sep" aria-hidden="true">/</span><span class="lagoon-name-gr">${this.escapeHtml(tombolo.name_gr)}</span>` : ''}
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
            { title: 'Identity and location', fields: [
                { key: 'id', label: 'ID' },
                { key: 'name_en', label: 'Name (EN)' },
                { key: 'name_gr', label: 'Name (GR)' },
                { key: 'prefecture_en', label: 'Prefecture' },
                { key: 'island_en', label: 'Island' },
                { key: 'tombolo_type', label: 'Type' },
                { key: 'tombolo_category', label: 'Category' }
            ] },
            { title: 'Morphometry', fields: [
                { key: 'length_m', label: 'Length (m)' },
                { key: 'width_tombolo_m', label: 'Width — tombolo (m)' },
                { key: 'width_continent_m', label: 'Width — continent (m)' },
                { key: 'width_island_m', label: 'Width — island (m)' },
                { key: 'height_m', label: 'Height (m)' },
                { key: 'elevation', label: 'Elevation (m)' }
            ] },
            { title: 'Sea-level scenarios', fields: [
                { key: 'submerged', label: 'Currently submerged' },
                { key: 'sub_rcp26', label: 'Submerged RCP 2.6 (2100)' },
                { key: 'sub_rcp85', label: 'Submerged RCP 8.5 (2100)' },
                { key: 'elevation_rcp26', label: 'Elevation RCP 2.6 (2100)' },
                { key: 'elevation_rcp85', label: 'Elevation RCP 8.5 (2100)' }
            ] },
            { title: 'Source', fields: [
                { key: 'reference', label: 'Reference', isLink: true }
            ] }
        ];

        const html = sections.map(section => {
            const rows = section.fields.map(field => {
                const value = tombolo[field.key];
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
            prefecture: readFilter('prefecture-filter'),
            island: readFilter('island-filter'),
            type: readFilter('type-filter'),
            category: readFilter('category-filter'),
            submerged: readFilter('submerged-filter'),
            subRcp26: readFilter('rcp26-filter'),
            subRcp85: readFilter('rcp85-filter')
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
        
        await this.loadTomboloData(filters);
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
                .rpc('api_tombolos_count');
            
            if (error) {
                this.showError('Failed to connect to database.');
                return false;
            }
            
            console.log(`✅ Database connected. ${count} tombolos found.`);
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
        const filterIds = ['prefecture-filter', 'island-filter', 'type-filter', 'category-filter', 'submerged-filter', 'rcp26-filter', 'rcp85-filter'];
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
            prefecture: 'Prefecture',
            island: 'Island',
            type: 'Type',
            category: 'Category',
            submerged: 'Submerged',
            subRcp26: 'RCP 2.6',
            subRcp85: 'RCP 8.5'
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
            prefecture: 'prefecture-filter',
            island: 'island-filter',
            type: 'type-filter',
            category: 'category-filter',
            submerged: 'submerged-filter',
            subRcp26: 'rcp26-filter',
            subRcp85: 'rcp85-filter'
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
        if (window.NkuaWebGISUI) {
            window.NkuaWebGISUI.renderStatistics({
                containerId: 'stats-tab',
                records: this.currentData,
                field: 'tombolo_type',
                figureTitle: 'Tombolos by type',
                axisLabel: 'Tombolo type',
                maxItems: 8,
                summaryRows: [
                    { label: 'Catalogue total', value: this.totalCount, id: 'total-events' },
                    { label: 'Visible records', value: this.currentData.length, id: 'visible-points' },
                    { label: 'Prefectures', value: this.totalPrefectures, id: 'total-prefectures' },
                    { label: 'Currently submerged', value: this.submergedCount, id: 'currently-submerged' },
                    { label: 'At risk · RCP 8.5', value: this.riskCount, id: 'at-risk-rcp85' }
                ]
            });
        }
        this.commonInterface?.setRecords(this.currentData);
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
            modal: document.getElementById('flood-modal'),
            detailsContainer: document.getElementById('flood-details')
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
const app = new TomboloMapApp();
