(() => {
    'use strict';

    function initializeGuide() {
        const dialog = document.getElementById('feature-guide-modal');
        const sidebar = document.getElementById('flood-guide-sidebar');
        const content = document.getElementById('flood-guide-content');
        if (!dialog || !sidebar || !content) return;

        const panels = Array.from(content.children).filter(element => element.matches('section.flood-guide-panel[id]'));
        const buttons = Array.from(sidebar.querySelectorAll('button[data-flood-guide-section]'));

        function selectPanel(panel) {
            if (!panels.includes(panel)) return;
            panels.forEach(item => {
                const selected = item === panel;
                item.hidden = !selected;
                item.style.display = selected ? '' : 'none';
            });
            buttons.forEach(button => {
                const selected = button.dataset.floodGuideSection === panel.id;
                button.classList.toggle('active', selected);
                if (selected) button.setAttribute('aria-current', 'true');
                else button.removeAttribute('aria-current');
                button.setAttribute('aria-controls', button.dataset.floodGuideSection);
            });
            content.scrollTop = 0;
        }

        selectPanel(panels.find(panel => panel.id === 'flood-guide-definition-panel') || panels[0]);

        sidebar.addEventListener('click', event => {
            if (!(event.target instanceof Element)) return;
            const button = event.target.closest('button[data-flood-guide-section]');
            if (!button || !sidebar.contains(button)) return;
            selectPanel(panels.find(panel => panel.id === button.dataset.floodGuideSection));
        });

        dialog.addEventListener('click', event => {
            if (!(event.target instanceof Element)) return;
            const citation = event.target.closest('a.flood-guide-citation[href]');
            if (!citation || !dialog.contains(citation)) return;
            const destination = new URL(citation.href, window.location.href);
            if (destination.origin !== location.origin || destination.pathname !== location.pathname || destination.search !== location.search) return;
            let targetId;
            try { targetId = decodeURIComponent(destination.hash.slice(1)); } catch { return; }
            if (!targetId.startsWith('flood-ref-')) return;
            const target = document.getElementById(targetId);
            const panel = target?.closest('section.flood-guide-panel');
            if (!target || !panels.includes(panel)) return;
            event.preventDefault();
            selectPanel(panel);
            history.replaceState(history.state, '', destination.href);
            const offset = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
            content.scrollTop = Math.max(0, offset - 16);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeGuide, { once: true });
    else initializeGuide();
})();
