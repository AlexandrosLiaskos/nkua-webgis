/**
 * StatusBar - Full-width status bar at the bottom of the map
 *
 * Displays scale, statistics and connection status.
 * Black background, white text, professional appearance.
 */

import { formatNumber } from '../utils/helpers.js';
import { STORM_MAP_CATEGORIES, getStormMapCategory } from '../map/MarkerManager.js';

class StatusBar {
    constructor(eventBus, stateManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.container = null;
        this.scaleControl = null;
        this.elements = {
            totalEvents: null,
            filteredEvents: null,
            connectionDot: null,
            scaleContainer: null,
            legendCounts: {}
        };
        this.isOnline = navigator.onLine;
        this.globalTotal = null;
    }

    init(map) {
        this.map = map;
        this.removeDefaultAttribution();
        this.createStatusBar();
        this.setupEventListeners();

        if (window.DEBUG_MODE) {
            console.log('✅ StatusBar: Initialized');
        }
    }

    removeDefaultAttribution() {
        this.map.attributionControl?.remove();
    }

    createStatusBar() {
        // Shared legend with display settings (colour variable, classes, colours)
        // and per-class visibility; MarkerManager reads this.display.
        this.display = window.NkuaWebGISDisplay.create(this.map, {
            storageKey: 'nkua-storm-feb-2026-display-v1',
            locale: 'el-GR',
            title: 'Natura 2000',
            subtitle: 'χωρική σχέση',
            ariaLabel: 'Υπόμνημα Natura 2000',
            defaultLabel: 'Natura 2000 (χωρική σχέση)',
            categories: STORM_MAP_CATEGORIES,
            classify: getStormMapCategory,
            missingLabel: 'Χωρίς τιμή',
            unclassifiedLabel: 'Χωρίς κατηγορία',
            otherLabel: 'Λοιπές τιμές',
            text: {
                displaySettings: 'Ρυθμίσεις απεικόνισης χάρτη',
                displayTitle: 'Απεικόνιση χάρτη',
                closeDisplay: 'Κλείσιμο ρυθμίσεων απεικόνισης',
                colourBy: 'Χρωματισμός κατά',
                grouping: 'Ομαδοποίηση',
                classes: 'Κλάσεις',
                classSpan: 'Εύρος κλάσης',
                boundaries: 'Όρια κλάσεων',
                classTable: 'Κλάσεις χρωμάτων και πλήθος εγγραφών',
                colour: 'Χρώμα',
                class: 'Κλάση',
                records: 'Εγγραφές',
                recordsSubtitle: 'εγγραφές',
                variables: 'Μεταβλητές',
                cancel: 'Ακύρωση',
                apply: 'Εφαρμογή',
                hideClass: 'Απόκρυψη κλάσης στον χάρτη',
                showClass: 'Εμφάνιση κλάσης στον χάρτη',
                colourFor: 'Χρώμα για',
                noClasses: 'Δεν υπάρχουν κλάσεις.',
                checkSettings: 'Ελέγξτε τις ρυθμίσεις κλάσεων.',
                defaultNote: 'Η βασική ταξινόμηση του άτλαντα.',
                categoricalNote: 'Κάθε τιμή έχει δικό της χρώμα· οι σπανιότερες τιμές συγχωνεύονται. Οι κλάσεις καλύπτουν όλο τον κατάλογο.',
                'method.jenks': 'Φυσικά όρια (Jenks)',
                'method.quantile': 'Ποσοστημόρια',
                'method.equalInterval': 'Ίσα διαστήματα',
                'method.fixedInterval': 'Σταθερό εύρος',
                'method.standardDeviation': 'Τυπική απόκλιση',
                'method.custom': 'Ορισμένα όρια',
                'note.jenks': 'Ομαδοποιεί παρόμοιες τιμές μειώνοντας τη διακύμανση μέσα σε κάθε κλάση.',
                'note.quantile': 'Στοχεύει σε παρόμοιο πλήθος εγγραφών ανά κλάση. Οι ίδιες τιμές μένουν μαζί.',
                'note.equalInterval': 'Χωρίζει το εύρος τιμών σε ίσα διαστήματα.',
                'note.fixedInterval': 'Ομαδοποιεί τις τιμές σε διαστήματα σταθερού εύρους.',
                'note.standardDeviation': 'Ομαδοποιεί τις τιμές με βάση την απόσταση από τον μέσο όρο.',
                'note.custom': 'Κάθε όριο είναι η ανώτερη τιμή μιας κλάσης. Η τελευταία κλάση καλύπτει τις μεγαλύτερες τιμές.'
            },
            onChange: () => this.eventBus.emit('display:changed')
        });
        this.container = this.display.element;
        this.mapReadout = this.display.readout;

        this.elements.totalEvents = this.container.querySelector('#status-total-events');
        this.elements.filteredEvents = this.container.querySelector('#status-filtered-events');
        this.elements.connectionDot = this.container.querySelector('#status-connection-dot');
        this.elements.scaleContainer = this.mapReadout?.element.querySelector('.status-scale') || null;
    }

    createScaleBar() {
        // Initial render, then update on every map move/zoom
        this._updateCartographicScale();
        this.map.on('moveend zoomend', () => this._updateCartographicScale());
    }


    /** Round maxVal down to a cartographically nice number (1, 2, 5, 10, 20, …). */
    _niceNum(maxVal) {
        const pow10 = Math.pow(10, Math.floor(Math.log(maxVal) / Math.LN10));
        const d = maxVal / pow10;
        return (d >= 5 ? 5 : d >= 2 ? 2 : 1) * pow10;
    }

    /** Recompute and re-render the cartographic scale bar. */
    _updateCartographicScale() {
        const el = this.elements.scaleContainer;
        if (!el || !this.map) return;

        const size = this.map.getSize();
        const maxPx = 110;
        const maxMeters = this.map.distance(
            this.map.containerPointToLatLng([0, size.y / 2]),
            this.map.containerPointToLatLng([maxPx, size.y / 2])
        );

        if (!maxMeters || !isFinite(maxMeters)) return;

        let nice, unit, meters;
        if (maxMeters >= 1000) {
            nice = this._niceNum(maxMeters / 1000);
            unit = 'km';
            meters = nice * 1000;
        } else {
            nice = this._niceNum(maxMeters);
            unit = 'm';
            meters = nice;
        }

        const px = Math.round(maxPx * meters / maxMeters);

        el.innerHTML = `
            <div class="carto-scale">
                <div class="carto-scale-bar" style="width:${px}px">
                    <span class="carto-seg carto-seg-b"></span>
                    <span class="carto-seg carto-seg-w"></span>
                    <span class="carto-seg carto-seg-b"></span>
                    <span class="carto-seg carto-seg-w"></span>
                </div>
                <div class="carto-scale-label">${nice}\u00a0${unit}</div>
            </div>
        `;
    }

    setupEventListeners() {
        this.eventBus.on('data:loaded', ({ count, data } = {}) => {
            this.updateFilteredEvents(count);
            this.updateLegendCounts(Array.isArray(data) ? data : this.stateManager.get('currentData') || []);

            // First ever load (no filters) acts as the global total
            if (this.globalTotal === null || this.globalTotal === undefined) {
                this.globalTotal = count;
                this.updateTotalEvents(count);
            }
        });
    }

    updateLegendCounts(records) {
        this.display.update(records);
    }

    setupConnectionMonitor() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionStatus(true);
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateConnectionStatus(false);
        });
    }

    updateTotalEvents(count) {
        if (this.elements.totalEvents) {
            this.elements.totalEvents.textContent = formatNumber(count);
        }
    }

    updateFilteredEvents(count) {
        if (this.elements.filteredEvents) {
            this.elements.filteredEvents.textContent = formatNumber(count);
        }
    }

    updateConnectionStatus(isOnline) {
        if (this.elements.connectionDot) {
            this.elements.connectionDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        }
    }
}

export default StatusBar;
