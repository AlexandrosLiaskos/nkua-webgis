(() => {
    'use strict';

    const readerId = 'source-reader-modal';
    let sourceButton = null;
    let currentDocument = null;
    let registeredManager = null;

    function elements() {
        return {
            reader: document.getElementById(readerId),
            overview: document.getElementById('references-modal'),
            title: document.getElementById('source-reader-title'),
            meta: document.getElementById('source-reader-meta'),
            sidebar: document.getElementById('source-reader-sidebar'),
            content: document.getElementById('source-reader-content')
        };
    }

    function panels(source) {
        return Array.from(source.children).filter(child => child.matches('section.source-reader-panel[data-topic-id]'));
    }

    function selectPanel(panel) {
        if (!currentDocument || !panel) return;
        const ui = elements();
        panels(currentDocument).forEach(item => {
            const selected = item === panel;
            item.hidden = !selected;
            item.style.display = selected ? '' : 'none';
        });
        ui.sidebar.querySelectorAll('button[data-reader-topic]').forEach(button => {
            const selected = button.dataset.readerTopic === panel.dataset.topicId;
            button.classList.toggle('active', selected);
            if (selected) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
        });
        ui.content.scrollTop = 0;
    }

    function registerReader(manager, ui) {
        if (registeredManager === manager) return;
        manager.modals.set(readerId, {
            element: ui.reader,
            closeBtn: document.getElementById('close-source-reader'),
            content: ui.reader.querySelector('.modal-content') || ui.reader
        });
        registeredManager = manager;
    }

    function openSource(source, origin, targetPanel) {
        const ui = elements();
        const manager = window.app?.modalManager;
        if (!source || !manager || !ui.reader || !ui.sidebar || !ui.content) return false;
        const sourcePanels = panels(source);
        if (!sourcePanels.length) return false;

        if (origin) sourceButton = origin;
        currentDocument = source;
        ui.content.querySelectorAll('section.source-document[data-source-id]').forEach(item => {
            const selected = item === source;
            item.hidden = !selected;
            item.style.display = selected ? '' : 'none';
        });
        ui.title.textContent = source.dataset.title || '';
        ui.meta.textContent = source.dataset.meta || '';
        ui.sidebar.replaceChildren();
        sourcePanels.forEach(panel => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'source-reader-topic';
            button.dataset.readerTopic = panel.dataset.topicId;
            button.textContent = panel.dataset.topicTitle || panel.dataset.topicId;
            if (!panel.id) panel.id = panel.dataset.topicId;
            button.setAttribute('aria-controls', panel.id);
            ui.sidebar.append(button);
        });
        selectPanel(sourcePanels.includes(targetPanel) ? targetPanel : sourcePanels[0]);
        registerReader(manager, ui);
        manager.closeModal('references-modal');
        manager.openModal(readerId);
        ui.title.tabIndex = -1;
        ui.title.focus({ preventScroll: true });
        return true;
    }

    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const ui = elements();
        const manager = window.app?.modalManager;
        const opener = event.target.closest('button[data-open-source]');
        if (opener && ui.overview?.contains(opener)) {
            const source = Array.from(ui.content?.querySelectorAll('section.source-document[data-source-id]') || [])
                .find(item => item.dataset.sourceId === opener.dataset.openSource);
            event.preventDefault();
            openSource(source, opener);
            return;
        }

        if (!ui.reader || !manager) return;
        if (event.target === ui.reader || event.target.closest('#close-source-reader')) {
            manager.closeModal(readerId);
            return;
        }
        if (event.target.closest('#source-reader-back')) {
            manager.closeModal(readerId);
            manager.openModal('references-modal');
            sourceButton?.focus({ preventScroll: true });
            return;
        }
        const topicButton = event.target.closest('button[data-reader-topic]');
        if (topicButton && ui.sidebar?.contains(topicButton)) {
            selectPanel(panels(currentDocument).find(panel => panel.dataset.topicId === topicButton.dataset.readerTopic));
            return;
        }

        const anchor = event.target.closest('a[href]');
        if (!anchor || (!ui.reader.contains(anchor) && !ui.overview?.contains(anchor))) return;
        const destination = new URL(anchor.href, window.location.href);
        if (destination.origin !== location.origin || destination.pathname !== location.pathname || destination.search !== location.search) return;
        let targetId;
        try { targetId = decodeURIComponent(destination.hash.slice(1)); } catch { return; }
        if (!targetId) return;
        const target = document.getElementById(targetId);
        const source = target?.closest('section.source-document[data-source-id]');
        const panel = target?.closest('section.source-reader-panel[data-topic-id]');
        if (!source || !panel || !ui.content.contains(source)) return;
        event.preventDefault();
        if (currentDocument !== source || !ui.reader.classList.contains('active')) {
            const origin = Array.from(ui.overview?.querySelectorAll('button[data-open-source]') || [])
                .find(button => button.dataset.openSource === source.dataset.sourceId);
            if (!openSource(source, origin, panel)) return;
        } else {
            selectPanel(panel);
        }
        history.replaceState(history.state, '', destination.href);
        const offset = target.getBoundingClientRect().top - ui.content.getBoundingClientRect().top + ui.content.scrollTop;
        ui.content.scrollTop = Math.max(0, offset - 16);
    });
})();
