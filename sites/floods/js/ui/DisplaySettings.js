const PARAMETERS = [
    ['waterSource', 'Water source'], ['onset', 'Onset / response'],
    ['process', 'Generating process'], ['mechanism', 'Inundation mechanism'],
    ['sediment', 'Sediment behaviour'], ['setting', 'Setting'],
    ['compound', 'Interacting drivers']
];
const METHODS = [
    ['legacy', 'Original periods'], ['jenks', 'Natural breaks (Jenks)'],
    ['quantile', 'Quantiles'], ['equalInterval', 'Equal intervals'],
    ['decades', 'Calendar decades'], ['fixedInterval', 'Fixed year span'],
    ['standardDeviation', 'Standard deviation'], ['custom', 'Custom boundaries']
];
const METHOD_NOTES = {
    legacy: 'Preset year periods used by this map.',
    jenks: 'Groups similar years while reducing variation within classes.',
    quantile: 'Aims for similar record counts in each class. Identical years stay together.',
    equalInterval: 'Divides the observed year range into equally sized spans.',
    decades: 'Groups years into calendar decades, such as 1990–1999.',
    fixedInterval: 'Groups years into fixed spans aligned to calendar boundaries.',
    standardDeviation: 'Groups years by their distance from the mean year.',
    custom: 'Each boundary is the last year of a class. The final class covers later years.'
};
const clone = value => JSON.parse(JSON.stringify(value));

/** A draft-only native dialog. MarkerManager owns all classification and validation. */
export default class DisplaySettings {
    constructor(markerManager, eventBus) {
        this.markerManager = markerManager;
        this.eventBus = eventBus;
    }

    init() {
        if (this.dialog) return this;
        this._createDialog();
        this.unsubscribe = this.eventBus.on('display:open', payload => this.open(payload?.opener));
        return this;
    }

    _element(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    _field(label, name, options, parent) {
        const wrapper = this._element('div', 'display-settings-field');
        const caption = this._element('label', '', label);
        caption.htmlFor = `display-${name}`;
        const input = this._element(options ? 'select' : 'input');
        input.id = `display-${name}`;
        input.name = name;
        if (options) {
            // Keep these short configuration lists as native dropdowns. The
            // site limiter otherwise turns lists over six options into rows.
            input.dataset.dropdownLimit = '100';
            for (const [value, text] of options) {
                const option = this._element('option', '', text);
                option.value = value;
                input.append(option);
            }
        }
        wrapper.append(caption, input);
        parent.append(wrapper);
        return { input, wrapper };
    }

    _createDialog() {
        this.dialog = this._element('dialog', 'display-settings-dialog');
        this.dialog.id = 'display-settings-dialog';
        this.dialog.setAttribute('aria-labelledby', 'display-settings-title');
        const header = this._element('header', 'display-settings-header modal-header');
        const title = this._element('h2', '', 'Map display');
        title.id = 'display-settings-title';
        const close = this._element('button', 'display-settings-close modal-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close map display settings');
        close.addEventListener('click', () => this.close());
        header.append(title, close);
        this.form = this._element('form', 'display-settings-form');
        this.form.noValidate = true;
        const body = this._element('div', 'display-settings-body modal-body');
        this.controls = this._element('div', 'display-settings-controls');
        body.append(this.controls);
        this.mode = this._field('Colour by', 'mode', [
            ['year', 'Year'], ['month', 'Month'], ['classification', 'Flood classification'], ['dataset', 'Dataset source']
        ], this.controls);
        this.parameter = this._field('Criterion', 'parameter', PARAMETERS, this.controls);
        this.method = this._field('Year grouping', 'yearMethod', METHODS, this.controls);
        this.numericFields = this._element('div', 'display-settings-numeric');
        this.classCount = this._field('Classes', 'classCount', null, this.numericFields);
        Object.assign(this.classCount.input, { type: 'number', min: '2', max: '12', step: '1', inputMode: 'numeric' });
        this.interval = this._field('Years per class', 'interval', null, this.numericFields);
        Object.assign(this.interval.input, { type: 'number', min: '1', max: '200', step: '1', inputMode: 'numeric' });
        body.append(this.numericFields);
        this.breaks = this._field('Class boundaries', 'customBreaks', null, body);
        this.breaks.input.type = 'text';
        this.breaks.input.placeholder = '1900, 1950, 1980, 2000';
        this.breaks.input.autocomplete = 'off';
        this.breaks.input.spellcheck = false;
        this.context = this._element('p', 'display-settings-context');
        this.context.id = 'display-settings-context';
        body.append(this.context);

        const preview = this._element('section', 'display-settings-preview');
        const tableWrapper = this._element('div', 'template-table-wrapper');
        const table = this._element('table', 'template-table display-settings-table');
        table.setAttribute('aria-label', 'Colour classes and source-record counts');
        const thead = this._element('thead');
        const headings = this._element('tr');
        for (const label of ['Colour', 'Class', 'Source records']) {
            const cell = this._element('th', '', label);
            cell.scope = 'col';
            headings.append(cell);
        }
        thead.append(headings);
        this.classList = this._element('tbody', 'display-settings-class-list');
        table.append(thead, this.classList);
        tableWrapper.append(table);
        preview.append(tableWrapper);
        body.append(preview);
        this.error = this._element('p', 'display-settings-error');
        this.error.id = 'display-settings-error';
        this.error.setAttribute('role', 'alert');
        this.error.hidden = true;
        body.append(this.error);

        const footer = this._element('footer', 'display-settings-footer');
        const cancel = this._element('button', 'display-settings-cancel btn-secondary', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => this.close());
        this.apply = this._element('button', 'display-settings-apply btn-primary', 'Apply');
        this.apply.type = 'submit';
        footer.append(cancel, this.apply);
        this.form.append(body, footer);
        this.dialog.append(header, this.form);
        document.body.append(this.dialog);

        this.mode.input.addEventListener('change', () => this._refreshPreview());
        this.parameter.input.addEventListener('change', () => this._refreshPreview());
        this.method.input.addEventListener('change', () => this._refreshPreview());
        for (const field of [this.classCount, this.interval, this.breaks]) {
            field.input.addEventListener('input', () => this._refreshPreview());
        }
        this.form.addEventListener('submit', event => {
            event.preventDefault();
            try {
                const draft = this._readDraft();
                this.markerManager.previewDisplaySettings(draft);
                this.markerManager.setDisplaySettings(draft);
                this.close();
            } catch (error) { this._showError(error); }
        });
        this.dialog.addEventListener('click', event => {
            if (event.target !== this.dialog) return;
            const rect = this.dialog.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right ||
                event.clientY < rect.top || event.clientY > rect.bottom) this.close();
        });
        this.dialog.addEventListener('close', () => {
            this.draft = null;
            if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
        });
    }

    open(opener) {
        if (!this.dialog) this.init();
        if (this.dialog.open) return;
        this.opener = opener instanceof HTMLElement ? opener : document.activeElement;
        this.draft = clone(this.markerManager.getDisplaySettings());
        this.mode.input.value = this.draft.mode || 'classification';
        this.parameter.input.value = this.draft.parameter || 'waterSource';
        this.method.input.value = this.draft.yearMethod || 'legacy';
        this.classCount.input.value = this.draft.classCount ?? 5;
        this.interval.input.value = this.draft.interval ?? 10;
        this.breaks.input.value = (this.draft.customBreaks || []).join(', ');
        this._refreshPreview();
        this.dialog.showModal();
        this.mode.input.focus({ preventScroll: true });
    }

    close() { this.dialog?.close(); }

    _readDraft() {
        const draft = { ...this.draft, colors: { ...(this.draft?.colors || {}) } };
        draft.mode = this.mode.input.value;
        draft.parameter = this.parameter.input.value;
        draft.yearMethod = this.method.input.value;
        draft.classCount = Number(this.classCount.input.value);
        draft.interval = Number(this.interval.input.value);
        const raw = this.breaks.input.value.trim();
        // Preserve invalid tokens as NaN for the engine validator; do not silently
        // accept parseInt("1900oops") or treat an empty list item as year zero.
        draft.customBreaks = raw ? raw.split(',').map(token => /^\s*\d{1,4}\s*$/.test(token) ? Number(token) : NaN) : [];
        return draft;
    }

    _refreshPreview() {
        if (!this.draft) return;
        const isYear = this.mode.input.value === 'year';
        this.controls.dataset.mode = this.mode.input.value;
        const method = this.method.input.value;
        this.parameter.wrapper.hidden = this.mode.input.value !== 'classification';
        this.method.wrapper.hidden = !isYear;
        this.classCount.wrapper.hidden = !isYear || !['jenks', 'quantile', 'equalInterval', 'standardDeviation'].includes(method);
        this.interval.wrapper.hidden = !isYear || method !== 'fixedInterval';
        this.numericFields.hidden = this.classCount.wrapper.hidden && this.interval.wrapper.hidden;
        this.breaks.wrapper.hidden = !isYear || method !== 'custom';
        this.context.textContent = isYear ? METHOD_NOTES[method] : this.mode.input.value === 'classification'
            ? 'Unclassified means this parameter is not assigned in the catalogue.'
            : this.mode.input.value === 'month'
                ? 'Colours follow the recorded start month. Records without a known month are shown separately.'
                : 'Groups records by their source catalogue.';
        try {
            const result = this.markerManager.previewDisplaySettings(this._readDraft());
            this.context.hidden = !isYear && this.mode.input.value !== 'month' && (this.mode.input.value !== 'classification' || !result.categories.some(category => category.label === 'Unclassified' && category.totalCount > 0));
            this.draft = { ...result.settings, colors: { ...(result.settings.colors || {}) } };
            this.error.hidden = true;
            this.error.textContent = '';
            this.apply.disabled = false;
            this._renderCategories(result.categories);
        } catch (error) {
            this._showError(error);
        }
    }

    _showError(error) {
        this.error.textContent = error?.message || 'Check the class settings.';
        this.error.hidden = false;
        this.apply.disabled = true;
    }

    _renderCategories(categories) {
        this.classList.replaceChildren();
        for (const category of categories) {
            const key = category.key ?? category.id;
            const row = this._element('tr', 'display-settings-class');
            const picker = this._element('input', 'display-settings-color');
            picker.type = 'color';
            picker.value = /^#[0-9a-f]{6}$/i.test(category.color) ? category.color : '#777777';
            picker.setAttribute('aria-label', `Colour for ${category.label}`);
            picker.addEventListener('input', () => {
                this.draft.colors ||= {};
                this.draft.colors[key] = picker.value;
            });
            const name = this._element('span', 'display-settings-class-label', category.label);
            const count = this._element('span', 'display-settings-class-count', Number(category.totalCount ?? category.count ?? 0).toLocaleString());
            for (const content of [picker, name, count]) {
                const cell = this._element('td');
                cell.append(content);
                row.append(cell);
            }
            this.classList.append(row);
        }
        if (!categories.length) {
            const row = this._element('tr');
            const cell = this._element('td', 'display-settings-empty', 'No classes available.');
            cell.colSpan = 3;
            row.append(cell);
            this.classList.append(row);
        }
    }

    destroy() {
        this.unsubscribe?.();
        this.dialog?.close();
        this.dialog?.remove();
        this.dialog = null;
    }
}
