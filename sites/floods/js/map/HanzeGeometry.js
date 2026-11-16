/** Show original affected regions for selected and hovered records, behind the pins. */
export default class HanzeGeometry {
    constructor(map, markerCluster) {
        this.map = map;
        this.layer = null;
        this.renderer = L.canvas({ padding: 0.5 });
        this.countries = new Map();
        this.selectionVersion = 0;
        this.hoverVersion = 0;
        this.hoverLayer = null;
        this.hoverTarget = null;
        this.hoverTimer = null;

        if (markerCluster) {
            markerCluster.on('mouseover', ({ layer }) => this.preview([layer.floodData], layer));
            markerCluster.on('clustermouseover', ({ layer }) => {
                this.preview(layer.getAllChildMarkers().map(marker => marker.floodData), layer);
            });
            markerCluster.on('mouseout clustermouseout', ({ layer }) => this.clearHover(layer));
            markerCluster.on('animationend spiderfied unspiderfied', () => this.clearHover());
            markerCluster.on('layerremove', () => this.clearHover());
            map.on('movestart zoomstart', () => this.clearHover());
            map.getContainer().addEventListener('mouseleave', () => this.clearHover());
            window.addEventListener('blur', () => this.clearHover());
        }
    }

    clear() {
        this.selectionVersion += 1;
        this.clearHover();
        if (this.layer) this.map.removeLayer(this.layer);
        this.layer = null;
    }

    loadCountry(file) {
        if (!this.countries.has(file)) {
            const request = fetch(new URL(`../../data/hanze/${file}`, import.meta.url))
                .then(response => {
                    if (!response.ok) throw new Error('Affected-region geometry could not be loaded');
                    return response.json();
                })
                .then(data => new Map(data.features.map(feature => [String(feature.id), feature])))
                .catch(error => {
                    this.countries.delete(file);
                    throw error;
                });
            this.countries.set(file, request);
        }
        return this.countries.get(file);
    }

    async show(record) {
        this.clear();
        if (record.record_kind !== 'affected_regions') return;
        const version = this.selectionVersion;
        const country = await this.loadCountry(record.geometry_file);
        if (version !== this.selectionVersion) return;
        const feature = country.get(String(record.geometry_feature_id));
        if (!feature) throw new Error('Affected-region geometry unavailable for this record');
        this.layer = L.geoJSON(feature, { renderer: this.renderer, interactive: false,
            style: { color: '#275b70', weight: 2, fillOpacity: 0.08 }
        }).addTo(this.map);
        return feature;
    }

    clearHover(target) {
        if (target && target !== this.hoverTarget) return;
        this.hoverVersion += 1;
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
        this.hoverTarget = null;
        if (this.hoverLayer) this.map.removeLayer(this.hoverLayer);
        this.hoverLayer = null;
    }

    preview(records, target) {
        if (target === this.hoverTarget) return;
        this.clearHover();
        const eligible = records.flatMap(record => [record, ...(record?.regional_records || [])])
            .filter(record => record?.record_kind === 'affected_regions'
            && record.geometry_file && record.geometry_feature_id != null);
        if (!eligible.length) return;
        this.hoverTarget = target;
        const version = this.hoverVersion;
        this.hoverTimer = setTimeout(() => {
            this.hoverTimer = null;
            this.renderHover(eligible, version).catch(error => {
                if (version === this.hoverVersion) {
                    this.clearHover();
                    console.warn('Affected-region hover preview could not be loaded', error);
                }
            });
        }, 100);
    }

    async renderHover(records, version) {
        if (version !== this.hoverVersion) return;
        const countries = new Map();
        for (const record of records) {
            if (!countries.has(record.geometry_file)) countries.set(record.geometry_file, new Set());
            countries.get(record.geometry_file).add(String(record.geometry_feature_id));
        }
        const layer = this.hoverLayer = L.geoJSON(null, {
            renderer: this.renderer,
            interactive: false,
            style: { color: '#275b70', weight: 1.5, opacity: 0.75,
                fill: records.length === 1, fillOpacity: 0.08 }
        }).addTo(this.map);
        const pending = countries.entries();
        const renderCountries = async () => {
            for (const [file, ids] of pending) {
                if (version !== this.hoverVersion) return;
                let features;
                try {
                    features = await this.loadCountry(file);
                } catch (error) {
                    if (version === this.hoverVersion) {
                        console.warn('Affected-region hover geometry could not be loaded', file, error);
                    }
                    continue;
                }
                let rendered = 0;
                for (const id of ids) {
                    if (version !== this.hoverVersion) return;
                    const feature = features.get(id);
                    if (feature) layer.addData(feature);
                    if (++rendered % 8 === 0) {
                        this.layer?.bringToFront();
                        await new Promise(resolve => requestAnimationFrame(resolve));
                    }
                }
                if (version !== this.hoverVersion) return;
                this.layer?.bringToFront();
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, countries.size) }, renderCountries));
    }
}
