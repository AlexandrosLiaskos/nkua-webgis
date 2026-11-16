/**
 * StatsManager - Statistics calculation and display
 *
 * Handles statistics calculation from both database queries and data arrays.
 * Supports both regular filters and SQL query builder filters.
 * Emits events for StatusBar to display stats.
 *
 * @example
 * const statsManager = new StatsManager(eventBus, dataManager);
 * await statsManager.loadStats({ year: 2020 });
 */

import { hasValidCoordinates } from './recordValues.js?v=20261004-cnih-1';

class StatsManager {
    constructor(eventBus, dataManager) {
        this.eventBus = eventBus;
        this.dataManager = dataManager;

        this.supabase = null;
    }

    /**
     * Initialize the stats manager
     */
    init() {
        this.supabase = window.supabaseClient;

        if (window.DEBUG_MODE) {
            console.log('✅ StatsManager: Initialized');
        }
    }

    /**
     * Load statistics from database with filters
     * @param {Object} filters - Filter object
     * @returns {Promise<Object>} Statistics object
     */
    async loadStats(filters = {}) {
        try {
            // Prefer already-loaded data (keeps working after DB lockdown)
            const currentData = this.dataManager?.stateManager?.get('currentData');
            if (Array.isArray(currentData)) {
                return this.calculateFromData(currentData);
            }

            // Fallback: fetch marker data and calculate
            const data = await this.dataManager.fetchFloodData(filters);
            return this.calculateFromData(data);
        } catch (error) {
            console.error('❌ StatsManager: Error loading stats', error);
            this.eventBus.emit('stats:error', { error, filters });
            return null;
        }
    }

    /**
     * Calculate statistics from a data array (for SQL filter results)
     * @param {Array} data - Array of flood records
     * @returns {Object} Statistics object
     */
    calculateFromData(data) {
        if (!data || data.length === 0) {
            const emptyStats = {
                total_events: 0,
                year_range: { min: 'N/A', max: 'N/A' },
                events_with_deaths: 0
            };
            this.renderPanel([], emptyStats);
            this.eventBus.emit('stats:updated', { stats: emptyStats, source: 'data' });
            return emptyStats;
        }

        // Total count
        const total_events = data.length;

        // Year range
        const years = data
            .map(d => d.year)
            .filter(y => y != null);

        const minYear = years.length > 0 ? years.reduce((min, year) => Math.min(min, year), Infinity) : 'N/A';
        const maxYear = years.length > 0 ? years.reduce((max, year) => Math.max(max, year), -Infinity) : 'N/A';

        // Events with casualties
        const events_with_deaths = data.filter(d => {
            const toll = d.deaths_toll_int;
            return toll !== null && toll !== undefined && toll > 0;
        }).length;

        const stats = {
            total_events,
            year_range: { min: minYear, max: maxYear },
            events_with_deaths
        };

        this.renderPanel(data, stats);

        // Emit event
        this.eventBus.emit('stats:updated', { stats, source: 'data' });

        if (window.DEBUG_MODE) {
            console.log('✅ StatsManager: Stats calculated from data', stats);
        }

        return stats;
    }

    renderPanel(data, stats) {
        if (!window.NkuaWebGISUI) return;
        const range = stats.year_range.min === 'N/A'
            ? '—'
            : `${stats.year_range.min}–${stats.year_range.max}`;
        window.NkuaWebGISUI.renderStatistics({
            containerId: 'stats-tab',
            records: data,
            field: 'year',
            type: 'numeric',
            figureTitle: 'Flood source records by year',
            axisLabel: 'Year',
            summaryRows: [
                { label: 'Matching source records', value: stats.total_events },
                { label: 'NKUA', value: data.filter(record => record.dataset === 'NKUA').length },
                { label: 'HANZE', value: data.filter(record => record.dataset === 'HANZE').length },
                ...(this.dataManager.cnihEnabled ? [
                    { label: 'CNIH', value: data.filter(record => record.dataset === 'CNIH').length }
                ] : []),
                ...(this.dataManager.noaaEnabled ? [
                    { label: 'NOAA', value: data.filter(record => record.dataset === 'NOAA').length }
                ] : []),
                { label: 'With map coordinates', value: data.filter(hasValidCoordinates).length },
                { label: 'Without map coordinates', value: data.filter(record => !hasValidCoordinates(record)).length },
                { label: 'Records with riverine water source', value: data.filter(record => record.flood_classification?.waterSource?.includes('Riverine')).length },
                { label: 'Year range', value: range },
                { label: 'Records with reported fatalities', value: stats.events_with_deaths }
            ]
        });
    }

}

// Export for ES modules
export default StatsManager;
