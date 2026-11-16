/**
 * Greek Coastal Events WebGIS - Main Entry Point
 *
 * Initializes and wires together all application modules using ES6 imports.
 * This is the main application orchestrator.
 */

import EventBus from './core/EventBus.js';
import StateManager from './core/StateManager.js';
import CacheManager from './core/CacheManager.js';
import DataManager from './data/DataManager.js?v=20261026-filters-display-1';
import StatsManager from './data/StatsManager.js';
import MapManager from './map/MapManager.js';
import MarkerManager from './map/MarkerManager.js?v=20261026-filters-display-1';
import ModalManager from './ui/ModalManager.js?v=20260904-2';
import UIController from './ui/UIController.js';
import FilterManager from './ui/FilterManager.js?v=20261026-filters-display-1';
import FilterDisplay from './ui/FilterDisplay.js';
import GlobalSearch from './ui/GlobalSearch.js';
import MobileControls from './ui/MobileControls.js';
import StatusBar from './ui/StatusBar.js?v=20261026-filters-display-1';
import DropdownLimiter from './utils/DropdownLimiter.js';
import BoundaryLayerManager from './map/BoundaryLayerManager.js';

class CoastalMapApplication {
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
        this.mobileControls = null;
        this.statusBar = null;
        this.dropdownLimiter = null;
        this.boundaryLayerManager = null;
    }

    async init() {
        try {
            if (window.DEBUG_MODE) {
                console.log('🚀 CoastalMapApplication: Starting initialization...');
            }

            this.dataManager = new DataManager(this.eventBus, this.cacheManager, this.stateManager);
            this.statsManager = new StatsManager(this.eventBus, this.dataManager);
            this.mapManager = new MapManager(this.eventBus, this.stateManager);
            this.modalManager = new ModalManager(this.eventBus, this.cacheManager);
            this.uiController = new UIController(this.eventBus, this.stateManager);
            this.filterManager = new FilterManager(this.eventBus, this.stateManager, this.dataManager);
            this.filterDisplay = new FilterDisplay(this.eventBus, this.stateManager);
            this.globalSearch = new GlobalSearch(this.eventBus, this.stateManager, this.filterManager);
            this.mobileControls = new MobileControls(this.eventBus, this.stateManager);
            this.dropdownLimiter = new DropdownLimiter();

            this.mapManager.init('map');

            const map = this.mapManager.getMap();
            this.dataManager.lasso = window.NkuaWebGISMap?.addLassoSelection(map, {
                label: 'Επιλογή με λάσο: σχεδιάστε γύρω από εγγραφές',
                clearLabel: 'Καθαρισμός επιλογής λάσο',
                onChange: () => this.filterManager.applyFilters()
            }) || null;
            this.markerManager = new MarkerManager(map, this.eventBus, this.stateManager);
            this.markerManager.init();

            this.statusBar = new StatusBar(this.eventBus, this.stateManager);
            this.statusBar.init(map);
            // Markers follow the legend display settings; redraw without refitting when they change.
            this.markerManager.display = this.statusBar.display;
            this.eventBus.on('display:changed', () => {
                this.markerManager.updateMarkers(this.stateManager.get('currentData') || [], { fitBounds: false });
            });

            // Boundary overlays load async in background; control appears immediately
            this.boundaryLayerManager = new BoundaryLayerManager(map, this.eventBus);
            this.boundaryLayerManager.init();

            this.modalManager.init();
            this.uiController.init();
            this.filterManager.init();
            this.filterDisplay.init();
            this.globalSearch.init();
            this.statsManager.init();
            this.mobileControls.init();
            this.dropdownLimiter.init();

            this.commonInterface = window.NkuaWebGISUI?.createAtlasInterface({
                eventBus: this.eventBus,
                locale: 'el-GR',
                text: {
                    filterBy: 'φιλτράρισμα κατά',
                    resetAll: 'Επαναφορά όλων',
                    chooseFilter: 'Επιλογή μεταβλητής φίλτρου',
                    chooseStatistic: 'Επιλογή στατιστικής μεταβλητής',
                    searchVariables: 'Αναζήτηση μεταβλητών…',
                    searchValues: 'Αναζήτηση',
                    advancedQuery: 'Σύνθετο ερώτημα',
                    queryBuilder: 'Δημιουργία σύνθετου ερωτήματος',
                    addCondition: 'Προσθήκη συνθήκης',
                    generatedQuery: 'Δημιουργημένο ερώτημα:',
                    applyFilter: 'Εφαρμογή φίλτρου',
                    clearAll: 'Καθαρισμός όλων',
                    activeFilter: 'Ενεργό φίλτρο:',
                    where: 'ΟΠΟΥ',
                    and: 'ΚΑΙ',
                    or: 'Ή',
                    chooseValue: 'Επιλογή τιμής…',
                    enterValue: 'Εισαγωγή τιμής…',
                    noConditions: 'Δεν υπάρχουν ολοκληρωμένες συνθήκες.',
                    conditionRequired: 'Προσθέστε τουλάχιστον μία ολοκληρωμένη συνθήκη.',
                    removeCondition: 'Αφαίρεση συνθήκης',
                    variables: 'Μεταβλητές',
                    loadingData: 'Φόρτωση δεδομένων…',
                    noMatches: 'Δεν βρέθηκαν αποτελέσματα.',
                    sortValues: 'Ταξινόμηση τιμών',
                    sortBy: 'Ταξινόμηση κατά',
                    sortCountDesc: 'Περισσότερες εγγραφές πρώτα',
                    sortCountAsc: 'Λιγότερες εγγραφές πρώτα',
                    sortNameAsc: 'Αλφαβητικά Α–Ω',
                    sortNameDesc: 'Αλφαβητικά Ω–Α',
                    statisticsHint: 'Οι αλλαγές φίλτρων εφαρμόζονται στα στατιστικά· επαναφέρετε τα φίλτρα για το πλήρες σύνολο. Περάστε τον δείκτη πάνω από μια ράβδο για το ακριβές πλήθος και επιλέξτε την για τη λίστα εγγραφών.',
                    variable: 'Μεταβλητή:',
                    figure: 'Σχ.',
                    summaryStatistics: 'Συνοπτικά στατιστικά',
                    whatTheseMean: 'Τι σημαίνουν;',
                    statisticsGuide: 'Ανάγνωση στατιστικών',
                    statisticsGuideText: 'Όλα τα στατιστικά υπολογίζονται στις εγγραφές που παραμένουν ορατές μετά τα φίλτρα. Εγγραφές χωρίς αξιοποιήσιμη τιμή για την επιλεγμένη μεταβλητή εξαιρούνται από το διάγραμμα και το δείγμα n.',
                    visibleRecords: 'Ορατές εγγραφές',
                    validValues: 'Έγκυρες τιμές',
                    uniqueValues: 'Μοναδικές τιμές',
                    mean: 'Μέσος όρος',
                    median: 'Διάμεσος',
                    standardDeviation: 'Τυπ. απόκλιση',
                    minimum: 'Ελάχιστο',
                    maximum: 'Μέγιστο',
                    range: 'Εύρος',
                    skewness: 'Ασυμμετρία',
                    mode: 'Επικρατούσα τιμή',
                    minimumMaximum: 'Ελάχ. / μέγ.',
                    numericType: 'αριθμητική',
                    categoricalType: 'κατηγορική',
                    otherCategory: 'Λοιπά',
                    statisticsCoverage: '{valid} από {total} ορατές εγγραφές έχουν τιμή ({percent}).',
                    statisticsMissingNote: 'Οι εγγραφές χωρίς αξιοποιήσιμη τιμή εξαιρούνται από το διάγραμμα.',
                    glossaryPanelTerms: 'Πώς διαβάζεται ο πίνακας',
                    glossaryVariables: 'Μεταβλητές του άτλαντα',
                    glossaryCodes: 'Κωδικοί και ειδικοί όροι',
                    glossaryTerm: 'Όρος',
                    glossaryVariable: 'Μεταβλητή',
                    glossaryType: 'Τύπος',
                    glossaryCode: 'Κωδικός',
                    glossaryMeaning: 'Σημασία',
                    visibleRecordsDefinition: 'Όλες οι εγγραφές που απομένουν μετά τα ενεργά φίλτρα του χάρτη.',
                    sampleSizeDefinition: 'Εγγραφές με αξιοποιήσιμη τιμή για την επιλεγμένη μεταβλητή.',
                    uniqueValuesDefinition: 'Πλήθος διαφορετικών κατηγοριών μέσα στο δείγμα n.',
                    modeDefinition: 'Η συχνότερη κατηγορία, μαζί με το πλήθος και το ποσοστό της στο n.',
                    meanDefinition: 'Αριθμητικός μέσος: το άθροισμα των τιμών διά του n.',
                    medianDefinition: 'Η μεσαία τιμή: οι μισές παρατηρήσεις βρίσκονται χαμηλότερα και οι μισές υψηλότερα.',
                    standardDeviationDefinition: 'Τυπική διασπορά των παρατηρήσεων γύρω από τον μέσο όρο.',
                    minimumMaximumDefinition: 'Η μικρότερη και η μεγαλύτερη παρατηρούμενη τιμή.',
                    quartilesDefinition: '25ο και 75ο εκατοστημόριο· ανάμεσά τους βρίσκεται το μεσαίο 50% των τιμών.',
                    iqrDefinition: 'Ενδοτεταρτημοριακό εύρος: Q3 μείον Q1.',
                    skewnessDefinition: 'Ασυμμετρία της κατανομής. Μια μεγάλη θετική τιμή δείχνει μακριά δεξιά ουρά.',
                    logScale: 'λογ. κλίμακα',
                    logScaleDefinition: 'Εφαρμόζεται αυτόματα σε έντονα δεξιά-ασύμμετρες, αυστηρά θετικές μεταβλητές, ώστε να διαβάζονται οι μικρές και οι μεγάλες τιμές. Η ένδειξη κάτω από το διάγραμμα την επισημαίνει πάντα.',
                    count: 'Πλήθος',
                    histogramOf: 'Ιστόγραμμα:',
                    recordsInSelection: 'Εγγραφές στην επιλογή',
                    selectionCount: '{count} εγγραφές',
                    noVariableDefinition: 'Ο ορισμός ακολουθεί τον κατάλογο προέλευσης.',
                    close: 'Κλείσιμο',
                    distributionOf: 'Κατανομή:',
                    frequencyOf: 'Συχνότητα:',
                    emptyStatistics: 'Δεν υπάρχουν εγγραφές στην τρέχουσα επιλογή.'
                },
                getRecords: () => this.stateManager.get('currentData') || [],
                getOptions: (field) => this.filterManager.currentOptions?.[field.optionsKey] || [],
                onApply: (field, value) => this.filterManager.applyFilterValue(field.filterKey, value),
                onAdvancedApply: (records, conditions) => {
                    this.stateManager.set('currentData', records);
                    this.stateManager.set('activeSqlFilter', conditions);
                    this.markerManager.updateMarkers(records);
                    this.eventBus.emit('data:loaded', { data: records, count: records.length });
                    this.statsManager.calculateFromData(records);
                },
                onAdvancedClear: () => {
                    this.stateManager.set('activeSqlFilter', null);
                    return this.filterManager.applyFilters();
                },
                statisticsRecordLabel: record => record.location_name || record.municipality || `Συμβάν ${record.id}`,
                statisticsRecordMeta: record => [record.region_name, record.regional_unit, record.date_of_commencement].filter(Boolean).join(' · '),
                onStatisticsRecordSelect: record => {
                    const latitude = Number(record.latitude);
                    const longitude = Number(record.longitude);
                    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                        this.mapManager.setView(latitude, longitude, 11);
                    }
                    this.eventBus.emit('marker:clicked', { floodId: record.id, flood: record });
                },
                filterFields: [
                    { key: 'date', dataField: 'date_of_commencement', filterKey: 'date', inputId: 'date-filter', optionsKey: 'dates', label: 'Ημερομηνία συμβάντος', group: 'Χρόνος', sort: 'desc' },
                    { key: 'location', dataField: 'location_name', filterKey: 'location', inputId: 'location-filter', optionsKey: 'locations', label: 'Τοποθεσία', group: 'Γεωγραφία' },
                    { key: 'deathsToll', dataField: 'deaths_toll_int', filterKey: 'deathsToll', inputId: 'deaths-toll-filter', optionsKey: 'deathsToll', label: 'Κατάσταση Natura', group: 'Περιβάλλον', valueLabels: { '1': 'Εντός Natura 2000', '0': 'Εκτός Natura 2000' } },
                    { key: 'region', dataField: 'region_name', filterKey: 'region', inputId: 'region-filter', optionsKey: 'regions', label: 'Περιφέρεια', group: 'Διοίκηση' },
                    { key: 'regionalUnit', dataField: 'regional_unit', filterKey: 'regionalUnit', inputId: 'regional-unit-filter', optionsKey: 'regionalUnits', label: 'Περιφερειακή ενότητα', group: 'Διοίκηση' },
                    { key: 'municipality', dataField: 'municipality', filterKey: 'municipality', inputId: 'municipality-filter', optionsKey: 'municipalities', label: 'Δήμος', group: 'Διοίκηση' }
                ],
                statisticsFields: [
                    {
                        key: 'date',
                        dataField: 'date_of_commencement',
                        label: 'Ημερομηνία συμβάντος',
                        type: 'categorical',
                        group: 'Χρόνος',
                        maxItems: 12,
                        description: 'Η ημερομηνία στην οποία αποδίδεται το καταγεγραμμένο παράκτιο συμβάν.'
                    },
                    {
                        key: 'region',
                        dataField: 'region_name',
                        label: 'Περιφέρεια',
                        type: 'categorical',
                        group: 'Διοίκηση',
                        description: 'Η διοικητική περιφέρεια στην οποία βρίσκεται το σημείο του συμβάντος.'
                    },
                    {
                        key: 'regionalUnit',
                        dataField: 'regional_unit',
                        label: 'Περιφερειακή ενότητα',
                        type: 'categorical',
                        group: 'Διοίκηση',
                        maxItems: 12,
                        description: 'Η περιφερειακή ενότητα στην οποία βρίσκεται το σημείο. Οι λιγότερο συχνές ενότητες ομαδοποιούνται ως Λοιπά.'
                    },
                    {
                        key: 'municipality',
                        dataField: 'municipality',
                        label: 'Δήμος',
                        type: 'categorical',
                        group: 'Διοίκηση',
                        maxItems: 12,
                        description: 'Ο δήμος στον οποίο αντιστοιχεί το σημείο. Οι λιγότερο συχνοί δήμοι ομαδοποιούνται ως Λοιπά.'
                    },
                    {
                        key: 'natura',
                        dataField: 'natura_flag',
                        label: 'Κατάσταση Natura 2000',
                        type: 'categorical',
                        group: 'Περιβάλλον',
                        valueLabels: { YES: 'Εντός Natura 2000', NO: 'Εκτός Natura 2000' },
                        description: 'Δείχνει αν το σημείο του συμβάντος βρίσκεται μέσα σε προστατευόμενη περιοχή του δικτύου Natura 2000. Δεν αποτελεί μέτρο έντασης ή ζημιάς.',
                        glossary: [
                            { term: 'Natura 2000', meaning: 'Ευρωπαϊκό δίκτυο προστατευόμενων περιοχών για τη διατήρηση οικοτόπων και ειδών.' },
                            { term: 'Εντός / Εκτός', meaning: 'Χωρική σχέση του σημείου του συμβάντος με τα όρια του δικτύου· όχι αξιολόγηση της σοβαρότητας.' }
                        ]
                    },
                    {
                        key: 'duration',
                        dataField: 'emergency_duration',
                        label: 'Διάρκεια έκτακτης ανάγκης',
                        type: 'categorical',
                        group: 'Διοίκηση',
                        valueLabels: { '2 months': '2 μήνες', '3 months': '3 μήνες', '6 months': '6 μήνες' },
                        description: 'Η διάρκεια της διοικητικής κήρυξης κατάστασης έκτακτης ανάγκης που συνοδεύει την εγγραφή· δεν είναι η διάρκεια του καιρικού φαινομένου.'
                    }
                ]
            });
            this.statusBar.display.attach(this.commonInterface);
            this.dataManager.lasso?.attach(this.commonInterface, record => [record.latitude, record.longitude], 'Επιλογή λάσο');

            this.setupEventHandlers();

            const isConnected = await this.dataManager.init();
            if (!isConnected) {
                this.uiController.showError('Αποτυχία φόρτωσης τοπικών δεδομένων. Ελέγξτε τα αρχεία στον φάκελο /data.');
                this.filterManager.disableFilters();
                return;
            }

            await this.loadInitialData();

            if (window.DEBUG_MODE) {
                console.log('✅ CoastalMapApplication: Initialization complete');
            }

            window.app = this;

        } catch (error) {
            console.error('❌ CoastalMapApplication: Initialization failed', error);
            this.uiController?.showError('Αποτυχία αρχικοποίησης εφαρμογής. Παρακαλώ ανανεώστε τη σελίδα.');
        }
    }

    setupEventHandlers() {
        this.eventBus.on('filters:apply', async ({ filters }) => {
            this.stateManager.set('isLoading', true);
            try {
                const data = await this.dataManager.fetchFloodData(filters);
                this.markerManager.updateMarkers(data);
                this.eventBus.emit('data:loaded', { count: data.length });
                this.statsManager.calculateFromData(data);
            } finally {
                this.stateManager.set('isLoading', false);
            }
        });

        this.eventBus.on('marker:clicked', async ({ floodId }) => {
            try {
                const eventData = await this.dataManager.fetchFloodDetails(floodId);
                this.modalManager.showEventDetails(eventData);
            } catch (error) {
                console.error('Error loading event details:', error);
                this.uiController.showError('Αποτυχία φόρτωσης στοιχείων συμβάντος.');
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

        this.stateManager.subscribe('isLoading', (isLoading) => {
            this.showLoading(isLoading);
        });
    }

    async loadInitialData() {
        this.stateManager.set('isLoading', true);

        try {
            await this.dataManager.fetchFilterOptions({});

            const data = await this.dataManager.fetchFloodData({});
            const coverageCount = document.getElementById('storm-event-count');
            if (coverageCount) {
                coverageCount.textContent = data.length.toLocaleString('el-GR');
            }
            this.markerManager.updateMarkers(data);
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

}

function initApp() {
    if (document.getElementById('map')) {
        const app = new CoastalMapApplication();
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

export default CoastalMapApplication;
