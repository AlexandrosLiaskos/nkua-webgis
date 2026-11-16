/**
 * ModalManager - Centralized modal management
 *
 * Handles opening, closing, and lifecycle of all modals in the application.
 * Provides consistent behavior across different modal types.
 *
 * @example
 * const modalManager = new ModalManager(eventBus);
 * modalManager.init();
 * modalManager.openModal('event-modal', content);
 */

import { escapeHtml } from '../utils/helpers.js';

class ModalManager {
    constructor(eventBus, cacheManager) {
        this.eventBus = eventBus;
        this.cacheManager = cacheManager;

        this.modals = new Map(); // Cache of modal elements
        this.activeModal = null;

        this.MODAL_IDS = {
            EVENT_DETAILS: 'event-modal',
            WELCOME: 'welcome-modal',
            REFERENCES: 'references-modal',
            SUBMIT_DATA: 'submit-data-modal',
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
     * Show event details in modal
     * @param {Object} eventData - Event data object
     */
    showEventDetails(eventData) {
        const html = this.generateEventDetailsHTML(eventData);

        // Get modal elements
        const modalData = this.modals.get(this.MODAL_IDS.EVENT_DETAILS);
        if (!modalData) {
            console.error('ModalManager: Event details modal not found');
            return;
        }

        // Update content
        const detailsContainer = document.getElementById('event-details');
        if (detailsContainer) {
            detailsContainer.innerHTML = html;
        }

        const titleblock = document.getElementById('event-modal-titleblock');
        if (titleblock) {
            titleblock.innerHTML = this.generateEventTitleHTML(eventData);
        }

        // Open modal
        this.openModal(this.MODAL_IDS.EVENT_DETAILS);

        // Cache the event data
        if (this.cacheManager) {
            this.cacheManager.set(`event-details-${eventData.id}`, eventData);
        }
    }

    generateEventTitleHTML(eventData) {
        const title = eventData?.location_name || 'Παράκτιο συμβάν';
        const localityParts = [
            eventData?.municipality,
            eventData?.regional_unit,
            eventData?.date_of_commencement
        ].filter(value => value !== null && value !== undefined && String(value).trim() !== '');
        const locality = localityParts.map((value, index) => `
            ${index ? '<span class="lagoon-locality-dot" aria-hidden="true">·</span>' : ''}
            <span class="${index === 0 ? 'lagoon-locality-main' : 'lagoon-locality-island'}">${escapeHtml(value)}</span>
        `).join('');

        return `
            <span class="lagoon-eyebrow">Παράκτιο συμβάν</span>
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
     * Generate HTML for event details modal
     * @param {Object} eventData - Event data
     * @returns {string} HTML string
     * @private
     */
    generateEventDetailsHTML(eventData) {
        const eventId = eventData?.event_id ?? eventData?.eventId ?? eventData?.id;
        const naturaStatus = Number(eventData?.deaths_toll_int) === 1 ? 'Εντός Natura 2000' : 'Εκτός Natura 2000';
        const imagePrefix = String(eventData?.image_prefix || eventId || '').trim();
        const shortDamageText = String(eventData?.short_damage || '').trim();
        const fullDamageText = String(eventData?.damage_description || '').trim();
        const damageTextsSimilar = shortDamageText && fullDamageText && (
            shortDamageText === fullDamageText ||
            fullDamageText.startsWith(shortDamageText) ||
            shortDamageText.startsWith(fullDamageText)
        );
        const imageHtml = imagePrefix
            ? `
                <figure class="record-modal-media">
                    <img
                        src="./assets/images/${escapeHtml(imagePrefix)}.jpg"
                        alt="Φωτογραφία τεκμηρίωσης συμβάντος"
                        onerror="if(!this.dataset.f1){this.dataset.f1='1';this.src='./assets/images/${escapeHtml(imagePrefix)}.png';}else if(!this.dataset.f2){this.dataset.f2='1';this.src='./assets/images/${escapeHtml(imagePrefix)}.webp';}else{this.closest('.record-modal-media').style.display='none';}"
                    />
                    <figcaption>Τεκμηρίωση συμβάντος</figcaption>
                </figure>
            `
            : '';

        const primaryFields = [
            { key: 'location_name', label: 'Πληγείσα Παράκτια Περιοχή' },
            { key: 'natura_status', label: 'Κατάσταση Natura', value: naturaStatus },
            { key: 'date_of_commencement', label: 'Ημερομηνία Συμβάντος' },
            { key: 'declaration_date', label: 'Ημερομηνία Κήρυξης' },
            { key: 'emergency_duration', label: 'Διάρκεια Έκτακτης Ανάγκης' },
            { key: 'ada_code', label: 'Κωδικός ΑΔΑ', isAdaLink: true }
        ];

        const adminFields = [
            { key: 'municipality', label: 'Δήμος' },
            { key: 'regional_unit', label: 'Περιφερειακή Ενότητα' },
            { key: 'region_name', label: 'Περιφέρεια' },
            { key: 'decentralized_admin', label: 'Αποκεντρωμένη Διοίκηση' },
            { key: 'municipal_unit', label: 'Δημοτική Ενότητα' },
            { key: 'community', label: 'Δημοτική Κοινότητα' }
        ];

        const renderMetaCard = (field) => {
            const rawValue = field.value !== undefined ? field.value : eventData[field.key];
            const hasValue = rawValue !== null && rawValue !== undefined && rawValue.toString().trim() !== '';
            if (!hasValue) return '';
            const displayValue = rawValue;

            let valueHtml;
            if (field.isAdaLink && rawValue && rawValue.toString().trim()) {
                const adaCode = String(rawValue).trim();
                const remotePdfUrl = `https://diavgeia.gov.gr/doc/${encodeURIComponent(adaCode)}`;
                valueHtml = `<a class="event-link" href="${escapeHtml(remotePdfUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(adaCode)}</a>`;
            } else if (field.isLink && rawValue && rawValue.toString().trim() && rawValue !== '-') {
                valueHtml = `<a class="event-link" href="${escapeHtml(rawValue)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawValue)}</a>`;
            } else {
                valueHtml = escapeHtml(displayValue);
            }

            return `
                <div class="detail-item">
                    <div class="detail-label">${field.label}</div>
                    <div class="detail-value">${valueHtml}</div>
                </div>
            `;
        };

        const primaryHtml = primaryFields.map(renderMetaCard).filter(Boolean).join('');
        const adminHtml = adminFields.map(renderMetaCard).filter(Boolean).join('');

        const impactBlocks = [];
        if (shortDamageText) {
            impactBlocks.push(`
                <p class="record-modal-prose">
                    <span class="record-modal-prose-label">${damageTextsSimilar ? 'Επιπτώσεις' : 'Σύνοψη Επιπτώσεων'}</span>
                    ${escapeHtml(shortDamageText)}
                </p>
            `);
        }
        if (!damageTextsSimilar && fullDamageText) {
            impactBlocks.push(`
                <p class="record-modal-prose">
                    <span class="record-modal-prose-label">Αναλυτική Περιγραφή Ζημιών</span>
                    ${escapeHtml(fullDamageText)}
                </p>
            `);
        }

        return `
            ${imageHtml}
            ${impactBlocks.length ? `
                <section class="lagoon-modal-section">
                    <header class="lagoon-modal-section-head">
                        <h4 class="lagoon-modal-section-title">Καταγεγραμμένες επιπτώσεις</h4>
                    </header>
                    ${impactBlocks.join('')}
                </section>
            ` : ''}
            ${primaryHtml ? `
                <section class="lagoon-modal-section">
                    <header class="lagoon-modal-section-head">
                        <h4 class="lagoon-modal-section-title">Στοιχεία συμβάντος</h4>
                    </header>
                    <div class="lagoon-modal-details-grid">${primaryHtml}</div>
                </section>
            ` : ''}
            ${adminHtml ? `
                <section class="lagoon-modal-section">
                    <header class="lagoon-modal-section-head">
                        <h4 class="lagoon-modal-section-title">Διοικητική ιεραρχία</h4>
                    </header>
                    <div class="lagoon-modal-details-grid">${adminHtml}</div>
                </section>
            ` : ''}
        `;
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
