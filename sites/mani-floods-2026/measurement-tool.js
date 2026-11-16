/**
 * Leaflet distance and area measurement control.
 * Styled to the shared publication standard.
 */
(function () {
    'use strict';

    const RULER_ICON_SVG = '<svg class="measurement-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.3 15.3l-7.6-7.6c-.6-.6-1.5-.6-2.1 0l-8.9 8.9c-.6.6-.6 1.5 0 2.1l2.3 2.3c.6.6 1.5.6 2.1 0l8.9-8.9c.6-.6.6-1.5 0-2.1l-2.3-2.3"/><line x1="14.5" y1="12.5" x2="16.5" y2="10.5"/><line x1="11.5" y1="9.5" x2="13.5" y2="7.5"/><line x1="8.5" y1="6.5" x2="10.5" y2="4.5"/></svg>';

    const CLEAR_ICON_SVG = '<svg class="measurement-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    const CLOSE_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    class MeasurementTool {
        constructor(map) {
            this.map = map;
            this.active = false;
            this.points = [];
            this.markers = [];
            this.polyline = null;
            this.polygon = null;
            this.infoControl = null;
            this.createControl();
            this.map.on('click', event => {
                if (this.active) this.addPoint(event.latlng);
            });
        }

        createControl() {
            const ToolControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: () => {
                    const container = L.DomUtil.create(
                        'div',
                        'measurement-control leaflet-bar'
                    );
                    const toggle = L.DomUtil.create(
                        'button',
                        'measurement-btn',
                        container
                    );
                    toggle.type = 'button';
                    toggle.innerHTML = RULER_ICON_SVG;
                    toggle.title = 'Measure distance and area';
                    toggle.setAttribute('aria-label', 'Measure distance and area');
                    toggle.setAttribute('aria-pressed', 'false');

                    const clear = L.DomUtil.create(
                        'button',
                        'measurement-btn measurement-clear-btn',
                        container
                    );
                    clear.type = 'button';
                    clear.innerHTML = CLEAR_ICON_SVG;
                    clear.title = 'Clear measurement';
                    clear.setAttribute('aria-label', 'Clear measurement');
                    clear.hidden = true;

                    toggle.addEventListener('click', event => {
                        event.preventDefault();
                        this.active = !this.active;
                        toggle.classList.toggle('active', this.active);
                        toggle.setAttribute('aria-pressed', String(this.active));
                        clear.hidden = !this.active && this.points.length === 0;
                        this.map.getContainer().classList.toggle(
                            'measurement-active',
                            this.active
                        );
                        if (this.active) {
                            this.map.dragging.disable();
                        } else {
                            this.map.dragging.enable();
                        }
                    });

                    clear.addEventListener('click', event => {
                        event.preventDefault();
                        this.clear();
                    });

                    L.DomEvent.disableClickPropagation(container);
                    L.DomEvent.disableScrollPropagation(container);
                    this.toggleButton = toggle;
                    this.clearButton = clear;
                    return container;
                }
            });
            this.control = new ToolControl();
            this.control.addTo(this.map);
        }

        addPoint(latlng) {
            this.points.push(latlng);
            const marker = L.circleMarker(latlng, {
                radius: 5,
                fillColor: '#111827',
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.95,
                interactive: false
            }).addTo(this.map);
            this.markers.push(marker);
            this.redraw();
            this.renderInfo();
            if (this.clearButton) this.clearButton.hidden = false;
        }

        redraw() {
            if (this.polyline) this.map.removeLayer(this.polyline);
            if (this.polygon) this.map.removeLayer(this.polygon);
            this.polyline = null;
            this.polygon = null;

            if (this.points.length > 1) {
                this.polyline = L.polyline(this.points, {
                    color: '#111827',
                    weight: 2.5,
                    opacity: 0.85,
                    dashArray: '5, 5',
                    interactive: false
                }).addTo(this.map);
            }
            if (this.points.length > 2) {
                this.polygon = L.polygon(this.points, {
                    color: '#111827',
                    weight: 1.5,
                    fillColor: '#111827',
                    fillOpacity: 0.08,
                    interactive: false
                }).addTo(this.map);
            }
        }

        distanceMetres() {
            let distance = 0;
            for (let index = 1; index < this.points.length; index += 1) {
                distance += this.points[index - 1].distanceTo(this.points[index]);
            }
            return distance;
        }

        areaSquareMetres() {
            if (this.points.length < 3 || !L.GeometryUtil ||
                typeof L.GeometryUtil.geodesicArea !== 'function') {
                return this.approximateArea();
            }
            return L.GeometryUtil.geodesicArea(this.points);
        }

        approximateArea() {
            if (this.points.length < 3) return 0;
            const centreLatitude = this.points.reduce(
                (sum, point) => sum + point.lat,
                0
            ) / this.points.length;
            const metresPerDegreeLat = 111132;
            const metresPerDegreeLon =
                111320 * Math.cos(centreLatitude * Math.PI / 180);
            let twiceArea = 0;
            for (let index = 0; index < this.points.length; index += 1) {
                const next = (index + 1) % this.points.length;
                const x1 = this.points[index].lng * metresPerDegreeLon;
                const y1 = this.points[index].lat * metresPerDegreeLat;
                const x2 = this.points[next].lng * metresPerDegreeLon;
                const y2 = this.points[next].lat * metresPerDegreeLat;
                twiceArea += x1 * y2 - x2 * y1;
            }
            return Math.abs(twiceArea) / 2;
        }

        renderInfo() {
            if (!this.infoControl) {
                this.infoControl = L.control({ position: 'topright' });
                this.infoControl.onAdd = () => {
                    this.infoElement = L.DomUtil.create('div', 'measurement-info');
                    this.infoElement.setAttribute('role', 'status');
                    this.infoElement.setAttribute('aria-live', 'polite');
                    L.DomEvent.disableClickPropagation(this.infoElement);
                    L.DomEvent.disableScrollPropagation(this.infoElement);
                    return this.infoElement;
                };
                this.infoControl.addTo(this.map);
            }

            const distance = this.distanceMetres();
            const area = this.areaSquareMetres();
            const pointCount = this.points.length;

            let distanceDisplay;
            if (pointCount < 2) {
                distanceDisplay = '—';
            } else if (distance >= 1000) {
                distanceDisplay = `${(distance / 1000).toFixed(2)} <abbr class="measurement-unit" title="kilometres">km</abbr>`;
            } else {
                distanceDisplay = `${Math.round(distance).toLocaleString('en-US')} <abbr class="measurement-unit" title="metres">m</abbr>`;
            }

            let areaDisplay = '';
            if (pointCount >= 3) {
                if (area >= 1000000) {
                    areaDisplay = `${(area / 1000000).toFixed(2)} <abbr class="measurement-unit" title="square kilometres">km²</abbr>`;
                } else if (area >= 10000) {
                    areaDisplay = `${(area / 10000).toFixed(2)} <abbr class="measurement-unit" title="hectares">ha</abbr> <span class="measurement-unit-secondary">(${Math.round(area).toLocaleString('en-US')} m²)</span>`;
                } else {
                    areaDisplay = `${Math.round(area).toLocaleString('en-US')} <abbr class="measurement-unit" title="square metres">m²</abbr>`;
                }
            }

            const footerText = pointCount < 2
                ? 'Click map to place next vertex'
                : 'Click map to extend · Click ✕ to clear';

            this.infoElement.innerHTML = `
                <div class="measurement-card">
                    <div class="measurement-card-header">
                        <span class="measurement-card-eyebrow">Map measurement</span>
                        <button type="button" class="measurement-card-close" aria-label="Clear and close measurement" title="Clear measurement">
                            ${CLOSE_ICON_SVG}
                        </button>
                    </div>
                    <div class="measurement-card-body">
                        <div class="measurement-metric-row">
                            <span class="measurement-metric-label">Distance</span>
                            <span class="measurement-metric-value">${distanceDisplay}</span>
                        </div>
                        ${pointCount >= 3 ? `
                        <div class="measurement-metric-row">
                            <span class="measurement-metric-label">Area</span>
                            <span class="measurement-metric-value">${areaDisplay}</span>
                        </div>
                        ` : ''}
                        <div class="measurement-metric-row measurement-sub-row">
                            <span class="measurement-metric-label">Vertices</span>
                            <span class="measurement-metric-count">${pointCount} point${pointCount === 1 ? '' : 's'}</span>
                        </div>
                    </div>
                    <div class="measurement-card-footer">
                        ${footerText}
                    </div>
                </div>
            `;

            const closeBtn = this.infoElement.querySelector('.measurement-card-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.clear();
                });
            }
        }

        clear() {
            this.markers.forEach(marker => this.map.removeLayer(marker));
            this.markers = [];
            this.points = [];
            if (this.polyline) this.map.removeLayer(this.polyline);
            if (this.polygon) this.map.removeLayer(this.polygon);
            this.polyline = null;
            this.polygon = null;
            if (this.infoControl) this.map.removeControl(this.infoControl);
            this.infoControl = null;
            this.infoElement = null;
            this.active = false;
            this.map.dragging.enable();
            this.map.getContainer().classList.remove('measurement-active');
            if (this.toggleButton) {
                this.toggleButton.classList.remove('active');
                this.toggleButton.setAttribute('aria-pressed', 'false');
            }
            if (this.clearButton) this.clearButton.hidden = true;
        }
    }

    window.MeasurementTool = MeasurementTool;
}());
