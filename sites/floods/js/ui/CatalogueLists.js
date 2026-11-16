const PAGE_SIZE = 100;

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function pagination(onPrevious, onNext) {
    const controls = element('div', 'fbc-actions');
    const previous = element('button', 'btn-secondary', 'Previous');
    const next = element('button', 'btn-secondary', 'Next');
    for (const button of [previous, next]) {
        button.type = 'button';
        button.style.flex = '1 1 0';
        button.style.minWidth = '0';
    }
    previous.addEventListener('click', onPrevious);
    next.addEventListener('click', onNext);
    controls.append(previous, next);
    return { controls, previous, next };
}

function installFilterPagination(panel) {
    const nativeRender = panel.render.bind(panel);
    const pages = new Map();
    panel.render = function () {
        const field = this.fields.find(item => item.key === this.selectedKey) || this.fields[0];
        if (!field || !this.elements.content) return nativeRender();
        const records = this.countRecords();
        if (records.length <= PAGE_SIZE) return nativeRender();
        const locale = this.config.locale || undefined;
        const counts = new Map();
        for (const record of records) {
            const value = this.fieldValue(record, field);
            if (value === null || value === undefined || value === '') continue;
            const key = String(value);
            const weight = this.config.getRecordWeight ? this.config.getRecordWeight(record) : 1;
            counts.set(key, (counts.get(key) || 0) + weight);
        }
        if (!this.spatial) {
            for (const value of this.getOptions(field)) {
                const key = String(value);
                if (!counts.has(key)) counts.set(key, 0);
            }
        }
        const selected = this.currentValues(field);
        for (const value of selected) if (!counts.has(value)) counts.set(value, 0);
        if (counts.size <= PAGE_SIZE) return nativeRender();
        const ui = window.NkuaWebGISUI;
        const sortMode = this.sortModes[field.key] || (field.sort === 'desc' ? 'name-desc' : field.sort === 'asc' ? 'name-asc' : 'count-desc');
        const sorted = ui.sortListItems([...counts].map(([value, count]) => ({
            value, count, label: field.sort ? value : this.formatFieldValue(field, value)
        })), sortMode, locale).map(item => item.value);
        // Selected values stay at the top, in the chosen order.
        const values = [...sorted.filter(value => selected.includes(value)), ...sorted.filter(value => !selected.includes(value))];
        const current = selected.join('\u0000');
        const focused = this.elements.content.contains(document.activeElement) ? document.activeElement : null;
        const focusValue = focused?.dataset?.filterValue;
        const searchFocused = focused?.classList.contains('fbc-list-search');
        const cursor = searchFocused ? [focused.selectionStart, focused.selectionEnd] : null;
        this.elements.pickerValue.textContent = field.unit ? `${field.label} (${field.unit})` : field.label;
        this.renderActiveList();
        this.elements.content.replaceChildren();
        const wrap = element('div', 'fbc-list');
        wrap.style.gridTemplateRows = 'auto minmax(0, 1fr) auto';
        const search = element('input', 'fbc-list-search');
        const searchLabel = `Search ${field.label.toLocaleLowerCase(locale)}`;
        search.type = 'search';
        search.autocomplete = 'off';
        search.placeholder = `${searchLabel}…`;
        search.setAttribute('aria-label', searchLabel);
        search.value = this.searchTerms[field.key] || '';
        const rows = element('div', 'fbc-list-rows');
        const footer = element('div', '');
        const range = element('div', 'fbc-list-count');
        range.setAttribute('aria-live', 'polite');
        const state = pages.get(field.key) || { page: 0, current };
        if (state.current !== current) state.page = 0;
        state.current = current;
        pages.set(field.key, state);
        let matching = [];
        const pager = pagination(() => { state.page--; draw(); pager.previous.focus(); },
            () => { state.page++; draw(); pager.next.focus(); });
        footer.append(range, pager.controls);
        const head = element('div', 'fbc-list-head');
        head.append(search, ui.createListSortControl({
            value: sortMode,
            onChange: mode => {
                this.sortModes[field.key] = mode;
                state.page = 0;
                this.render();
                this.elements.content.querySelector('.fbc-sort-btn')?.focus();
            }
        }));
        wrap.append(head, rows, footer);
        this.elements.content.appendChild(wrap);
        const draw = () => {
            state.page = Math.max(0, Math.min(state.page, Math.ceil(matching.length / PAGE_SIZE) - 1));
            rows.replaceChildren();
            const first = state.page * PAGE_SIZE;
            for (const value of matching.slice(first, first + PAGE_SIZE)) {
                const active = selected.includes(value);
                const labelText = this.formatFieldValue(field, value);
                const row = element('button', `fbc-list-row${active ? ' is-active' : ''}`);
                row.type = 'button';
                row.title = labelText;
                row.dataset.filterValue = value;
                row.setAttribute('aria-pressed', String(active));
                const tick = element('span', 'fbc-list-tick', active ? '✓' : '');
                tick.setAttribute('aria-hidden', 'true');
                row.append(element('span', 'fbc-list-label', labelText),
                    element('span', 'fbc-list-count', counts.get(value).toLocaleString(locale)), tick);
                row.addEventListener('click', () => this.applyValue(field, value));
                rows.appendChild(row);
            }
            if (!matching.length) rows.appendChild(element('div', 'fbc-list-empty', 'No matches.'));
            range.textContent = matching.length
                ? `${(first + 1).toLocaleString(locale)}–${Math.min(first + PAGE_SIZE, matching.length).toLocaleString(locale)} of ${matching.length.toLocaleString(locale)} values`
                : '0 values';
            pager.controls.style.display = matching.length > PAGE_SIZE ? '' : 'none';
            pager.previous.disabled = state.page === 0;
            pager.next.disabled = first + PAGE_SIZE >= matching.length;
            rows.scrollTop = 0;
        };
        const findMatches = () => {
            const term = search.value.toLocaleLowerCase(locale).trim();
            this.searchTerms[field.key] = term;
            matching = term ? values.filter(value => this.formatFieldValue(field, value).toLocaleLowerCase(locale).includes(term)) : values;
            draw();
        };
        search.addEventListener('input', () => { state.page = 0; findMatches(); });
        findMatches();
        if (searchFocused) {
            search.focus();
            if (cursor[0] !== null) search.setSelectionRange(...cursor);
        } else if (focusValue !== undefined) {
            [...rows.children].find(row => row.dataset.filterValue === focusValue)?.focus();
        }
    };
}

export function handleStatisticsGroupSelect(field, selection, panel) {
    panel.cataloguePager?.remove();
    const nativeOpen = (pageSelection) => {
        const hook = panel.config.onGroupSelect;
        panel.config.onGroupSelect = null;
        try { panel.openBinModal(field, pageSelection); }
        finally { panel.config.onGroupSelect = hook; }
    };
    const supplied = selection.records || [];
    if (supplied.length <= PAGE_SIZE) return nativeOpen(selection);
    const locale = panel.config.locale || undefined;
    const collator = new Intl.Collator(locale, { numeric: true });
    const records = supplied.slice().sort((left, right) => panel.config.recordSort
        ? panel.config.recordSort(left, right)
        : collator.compare(panel.recordLabel(left), panel.recordLabel(right)));
    let page = 0;
    const pager = pagination(() => { page--; draw(); pager.previous.focus(); },
        () => { page++; draw(); pager.next.focus(); });
    panel.cataloguePager = pager.controls;
    const draw = () => {
        const first = page * PAGE_SIZE;
        nativeOpen({ ...selection, records: records.slice(first, first + PAGE_SIZE) });
        panel.elements.binSummary.querySelector('.stats-bin-summary-count').textContent =
            `${records.length.toLocaleString(locale)} records · ${(first + 1).toLocaleString(locale)}–${Math.min(first + PAGE_SIZE, records.length).toLocaleString(locale)}`;
        panel.elements.binList.after(pager.controls);
        panel.elements.binList.scrollTop = 0;
        pager.previous.disabled = page === 0;
        pager.next.disabled = first + PAGE_SIZE >= records.length;
    };
    draw();
}

export function installCatalogueLists(atlas) {
    installFilterPagination(atlas.filterPanel);
    const refresh = atlas.refresh.bind(atlas);
    let queued = false;
    atlas.refresh = () => {
        if (queued) return;
        queued = true;
        window.setTimeout(() => { queued = false; refresh(); }, 0);
    };
}
