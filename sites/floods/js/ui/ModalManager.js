/**
 * ModalManager - Centralized modal management
 *
 * Handles opening, closing, and lifecycle of all modals in the application.
 * Provides consistent behavior across different modal types.
 *
 * @example
 * const modalManager = new ModalManager(eventBus);
 * modalManager.init();
 * modalManager.openModal('flood-modal', content);
 */

import { escapeHtml } from '../utils/helpers.js';
import LagoonPreviewMap from '/lagoons/js/map/LagoonPreviewMap.js';
import { renderFloodDetails } from './FloodRecordDetails.js?v=20261004-cnih-1';
import { hasValidCoordinates } from '../data/recordValues.js?v=20261004-cnih-1';

class ModalManager {
    constructor(eventBus, cacheManager) {
        this.eventBus = eventBus;
        this.cacheManager = cacheManager;

        this.modals = new Map(); // Cache of modal elements
        this.activeModal = null;
        this.previewMap = new LagoonPreviewMap();
        this.regionMap = new LagoonPreviewMap();
        this.worldMap = new LagoonPreviewMap();
        this.previewRecord = null;
        this.previewFeature = null;

        this.MODAL_IDS = {
            FLOOD_DETAILS: 'flood-modal',
            WELCOME: 'welcome-modal',
            REFERENCES: 'references-modal',
            SUBMIT_DATA: 'submit-data-modal',
            REPORT_BUG: 'report-bug-modal',
            SUBMIT_SUGGESTION: 'submit-suggestion-modal',
            SQL_FILTER: 'sql-filter-modal'
        };
    }

    /**
     * Initialize modal manager and setup global event listeners
     */
    init() {
        // Setup ESC key handler
        document.addEventListener('keydown', (e) => this.handleEscapeKey(e));

        // Cache modal elements
        this.cacheModalElements();

        // Setup close buttons and overlay clicks for all modals
        this.setupModalCloseHandlers();

        // Setup welcome modal auto-show
        this.setupWelcomeModal();

        if (window.DEBUG_MODE) {
            console.log('✅ ModalManager: Initialized');
        }
    }

    /**
     * Cache all modal DOM elements
     * @private
     */
    cacheModalElements() {
        Object.values(this.MODAL_IDS).forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (modal) {
                this.modals.set(modalId, {
                    element: modal,
                    closeBtn: modal.querySelector('[id^="close-"]'),
                    content: modal.querySelector('.modal-content') || modal
                });
            }
        });
    }

    /**
     * Setup close handlers for all modals
     * @private
     */
    setupModalCloseHandlers() {
        this.modals.forEach((modalData, modalId) => {
            const { element, closeBtn } = modalData;

            // Close button handler
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeModal(modalId));
            }

            // Click outside to close
            element.addEventListener('click', (e) => {
                if (e.target === element) {
                    this.closeModal(modalId);
                }
            });
        });
    }

    /**
     * Setup welcome modal to show on page load
     * @private
     */
    setupWelcomeModal() {
        const welcomeModal = this.modals.get(this.MODAL_IDS.WELCOME);
        if (welcomeModal) {
            // Skip the splash when embedded (?embed=1) so the map is visible
            // immediately inside an iframe preview.
            const isEmbedded = new URLSearchParams(window.location.search).get('embed') === '1';

            if (!isEmbedded) {
                // Show welcome modal with delay
                setTimeout(() => {
                    this.openModal(this.MODAL_IDS.WELCOME);
                }, 300);
            }

            // Setup "Enter Map" button to close welcome modal
            const enterBtn = document.getElementById('enter-webgis');
            if (enterBtn) {
                enterBtn.addEventListener('click', () => {
                    const closeWelcome = () => this.closeModal(this.MODAL_IDS.WELCOME);
                    if (window.NkuaWebGISUI?.revealWelcomeModal) {
                        window.NkuaWebGISUI.revealWelcomeModal(welcomeModal.element, closeWelcome);
                    } else {
                        closeWelcome();
                    }
                });
            }

            // Setup welcome modal's submit data link
            const submitDataLink = document.getElementById('welcome-submit-data-link');
            if (submitDataLink) {
                submitDataLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.closeModal(this.MODAL_IDS.WELCOME);
                    this.openModal(this.MODAL_IDS.SUBMIT_DATA);
                });
            }
        }
    }

    /**
     * Handle ESC key press to close active modal
     * @param {KeyboardEvent} e - Keyboard event
     * @private
     */
    handleEscapeKey(e) {
        if (e.key === 'Escape' && this.activeModal) {
            this.closeModal(this.activeModal);
        }
    }

    /**
     * Open a modal
     * @param {string} modalId - Modal ID to open
     * @param {Object} options - Modal options
     */
    openModal(modalId, options = {}) {
        const modalData = this.modals.get(modalId);
        if (!modalData) {
            console.warn(`ModalManager: Modal "${modalId}" not found`);
            return;
        }

        // Close any active modal first
        if (this.activeModal && this.activeModal !== modalId) {
            this.closeModal(this.activeModal, { silent: true });
        }

        // Show modal
        modalData.element.classList.add('active');
        document.body.classList.add('modal-open');
        this.activeModal = modalId;

        // Emit event
        this.eventBus.emit('modal:opened', { modalId });

        if (window.DEBUG_MODE) {
            console.log(`📂 ModalManager: Opened modal "${modalId}"`);
        }
    }

    /**
     * Close a modal
     * @param {string} modalId - Modal ID to close
     * @param {Object} options - Close options
     */
    closeModal(modalId, options = {}) {
        const { silent = false } = options;

        if (modalId === this.MODAL_IDS.FLOOD_DETAILS) {
            this.destroyPreviews();
            this.previewRecord = null;
            this.previewFeature = null;
        }

        const modalData = this.modals.get(modalId);
        if (!modalData) {
            console.warn(`ModalManager: Modal "${modalId}" not found`);
            return;
        }

        // Hide modal
        modalData.element.classList.remove('active');
        document.body.classList.remove('modal-open');

        if (this.activeModal === modalId) {
            this.activeModal = null;
        }

        // Emit event
        if (!silent) {
            this.eventBus.emit('modal:closed', { modalId });
        }

        if (window.DEBUG_MODE) {
            console.log(`📂 ModalManager: Closed modal "${modalId}"`);
        }
    }

    /**
     * Close all modals
     */
    closeAll() {
        this.modals.forEach((_, modalId) => {
            this.closeModal(modalId, { silent: true });
        });
        this.activeModal = null;
    }

    /**
     * Show flood details in modal
     * @param {Object} flood - Flood data object
     */
    showFloodDetails(flood) {
        this.destroyPreviews();
        this.previewRecord = flood;
        this.previewFeature = null;
        const html = this.generateFloodDetailsHTML(flood);

        // Get modal elements
        const modalData = this.modals.get(this.MODAL_IDS.FLOOD_DETAILS);
        if (!modalData) {
            console.error('ModalManager: Flood details modal not found');
            return;
        }

        // Update content
        const detailsContainer = document.getElementById('flood-details');
        if (detailsContainer) {
            detailsContainer.innerHTML = html;
        }

        const titleblock = document.getElementById('flood-modal-titleblock');
        if (titleblock) {
            titleblock.innerHTML = this.generateFloodTitleHTML(flood);
        }

        // Open modal
        this.openModal(this.MODAL_IDS.FLOOD_DETAILS);
        this.renderPreview(flood);

        // Cache the flood data
        if (this.cacheManager) {
            this.cacheManager.set(`flood-details-${flood.id}`, flood);
        }
    }

    generateFloodTitleHTML(flood) {
        const title = flood?.flood_event_name || flood?.location_name || 'Flood event';
        const location = String((flood?.record_kind === 'affected_regions' ? flood.country : flood?.location_name) || '').trim();
        const date = String(flood?.date_interval || flood?.date_of_commencement || flood?.year || '').trim();
        const showLocation = location && location.toLowerCase() !== String(title).toLowerCase();
        const locality = [
            showLocation ? `<span class="lagoon-locality-main">${escapeHtml(location)}</span>` : '',
            date ? `<span class="lagoon-locality-island">${escapeHtml(date)}</span>` : ''
        ].filter(Boolean).join('<span class="lagoon-locality-dot" aria-hidden="true">·</span>');

        return `
            <span class="lagoon-eyebrow">${escapeHtml(flood.dataset || (flood.record_kind === 'affected_regions' ? 'HANZE' : 'NKUA'))}</span>
            <h2 class="lagoon-name">
                <span class="lagoon-name-en">${escapeHtml(title)}</span>
            </h2>
            ${locality ? `
                <p class="lagoon-locality">
                    <svg class="lagoon-locality-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    ${locality}
                </p>
            ` : ''}
        `;
    }

    /**
     * Generate HTML for flood details modal
     * @param {Object} flood - Flood data
     * @returns {string} HTML string
     * @private
     */
    generateFloodDetailsHTML(flood) {
        return renderFloodDetails(flood);
    }

    renderPreview(flood, feature = null) {
        if (!hasValidCoordinates(flood)) return;
        setTimeout(() => {
            if (this.previewRecord?.id !== flood.id || this.activeModal !== this.MODAL_IDS.FLOOD_DETAILS) return;
            this.previewMap.render(document.getElementById('flood-modal-preview-map'), {
                centroid_lat: flood.latitude, centroid_lng: flood.longitude,
                geojson: feature || this.previewFeature
            });
            const anchor = { centroid_lat: flood.latitude, centroid_lng: flood.longitude };
            this.regionMap.render(document.getElementById('flood-modal-region-map'), anchor, {
                locator: true, center: [Number(flood.latitude), Number(flood.longitude)], zoom: 4
            });
            this.worldMap.render(document.getElementById('flood-modal-world-map'), anchor, {
                locator: true, fitBounds: [[-65, -175], [80, 175]]
            });
        }, 0);
    }

    destroyPreviews() {
        this.previewMap.destroy(document.getElementById('flood-modal-preview-map'));
        this.regionMap.destroy(document.getElementById('flood-modal-region-map'));
        this.worldMap.destroy(document.getElementById('flood-modal-world-map'));
    }

    updateFloodGeometry(id, feature) {
        if (!feature || this.previewRecord?.id !== id) return;
        this.previewFeature = feature;
        this.renderPreview(this.previewRecord, feature);
        const note = document.getElementById('flood-geometry-note');
        if (note) note.textContent = 'Administrative regions affected by floods, not inundation extent. Pin coordinates are derived display locations. Missing impact values mean unreported, not zero.';
    }

    /**
     * Check if a modal is currently open
     * @param {string} modalId - Optional modal ID to check
     * @returns {boolean} True if modal is open
     */
    isModalOpen(modalId = null) {
        if (modalId) {
            return this.activeModal === modalId;
        }
        return this.activeModal !== null;
    }

    /**
     * Get active modal ID
     * @returns {string|null} Active modal ID or null
     */
    getActiveModal() {
        return this.activeModal;
    }

    /**
     * Get modal element
     * @param {string} modalId - Modal ID
     * @returns {HTMLElement|null} Modal element or null
     */
    getModalElement(modalId) {
        const modalData = this.modals.get(modalId);
        return modalData ? modalData.element : null;
    }
}

// Export for ES modules
export default ModalManager;
