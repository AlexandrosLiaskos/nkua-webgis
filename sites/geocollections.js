(() => {
    const setupMobileNavigation = () => {
        const header = document.querySelector('.site-header');
        const toggle = header?.querySelector('.nav-toggle');
        const navigation = header?.querySelector('.site-nav');
        if (!toggle || !navigation) return;

        const mobile = window.matchMedia('(max-width: 840px)');
        const setOpen = (open) => {
            const expanded = mobile.matches && open;
            header.classList.toggle('is-menu-open', expanded);
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.setAttribute('aria-label', expanded ? 'Close navigation' : 'Open navigation');
        };

        toggle.addEventListener('click', () => {
            setOpen(toggle.getAttribute('aria-expanded') !== 'true');
        });

        navigation.addEventListener('click', (event) => {
            const action = event.target.closest('a, button');
            if (!mobile.matches || !action) return;
            setOpen(false);

            if (action.matches('a[href^="#"]')) {
                const destination = document.getElementById(action.hash.slice(1));
                if (destination) {
                    destination.setAttribute('tabindex', '-1');
                    destination.focus({ preventScroll: true });
                }
            } else {
                toggle.focus({ preventScroll: true });
            }
        });

        document.addEventListener('pointerdown', (event) => {
            if (!header.contains(event.target)) setOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || toggle.getAttribute('aria-expanded') !== 'true') return;
            event.preventDefault();
            setOpen(false);
            toggle.focus({ preventScroll: true });
        });
        header.addEventListener('focusout', () => {
            window.requestAnimationFrame(() => {
                if (!header.contains(document.activeElement)) setOpen(false);
            });
        });
        mobile.addEventListener('change', () => {
            const focusInNavigation = navigation.contains(document.activeElement);
            const focusOnToggle = document.activeElement === toggle;
            setOpen(false);
            if (mobile.matches && focusInNavigation) toggle.focus({ preventScroll: true });
            if (!mobile.matches && focusOnToggle) header.querySelector('.brand').focus({ preventScroll: true });
        });

        toggle.hidden = false;
        header.classList.add('is-nav-ready');
    };

    setupMobileNavigation();

    const setupCollectionFolders = () => {
        document.querySelectorAll('.collection-dialog').forEach((dialog) => {
            if (typeof dialog.showModal !== 'function') return;

            let opener;
            let pointerStartedOutside = false;
            const isOutside = (event) => {
                const bounds = dialog.getBoundingClientRect();
                return event.clientX < bounds.left || event.clientX > bounds.right
                    || event.clientY < bounds.top || event.clientY > bounds.bottom;
            };

            document.querySelectorAll(`[data-collection-folder="${dialog.id}"]`).forEach((trigger) => {
                trigger.addEventListener('click', (event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    if (dialog.open) return;
                    opener = trigger;
                    dialog.showModal();
                    document.documentElement.classList.add('has-collection-dialog');
                });
            });

            dialog.querySelector('.collection-dialog-close').addEventListener('click', () => dialog.close());
            dialog.addEventListener('pointerdown', (event) => {
                pointerStartedOutside = event.target === dialog && isOutside(event);
            });
            dialog.addEventListener('click', (event) => {
                if (pointerStartedOutside && event.target === dialog && isOutside(event)) dialog.close();
                pointerStartedOutside = false;
            });
            dialog.addEventListener('close', () => {
                document.documentElement.classList.remove('has-collection-dialog');
                opener?.focus({ preventScroll: true });
            });
        });
    };

    setupCollectionFolders();

    const setupPhotoCredits = () => {
        const disclosure = document.querySelector('.hero-photo-info');
        if (!disclosure) return;

        document.addEventListener('pointerdown', (event) => {
            if (disclosure.open && !disclosure.contains(event.target)) disclosure.open = false;
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !disclosure.open) return;
            const hadFocus = disclosure.contains(document.activeElement);
            disclosure.open = false;
            if (hadFocus) {
                event.preventDefault();
                disclosure.querySelector('summary').focus();
            }
        });
    };

    setupPhotoCredits();

    const setupHeroRotator = () => {
        const rotator = document.querySelector('[data-hero-rotator]');
        const hero = rotator?.closest('.hero');
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

        if (!rotator || reducedMotion.matches) return;

        const phrases = ['geomorphic features.', 'natural disasters.'];
        let phraseIndex = 0;
        let holdTimer;
        let swapTimer;
        let isIntersecting = true;
        let isRunning = false;

        const clearTimers = () => {
            window.clearTimeout(holdTimer);
            window.clearTimeout(swapTimer);
        };

        const renderPhrase = (phrase) => {
            const fragment = document.createDocumentFragment();
            const words = phrase.split(' ');
            const letterCount = phrase.replace(/\s/g, '').length;
            let letterIndex = 0;

            words.forEach((word, wordIndex) => {
                if (wordIndex > 0) fragment.append(document.createTextNode(' '));

                const wordElement = document.createElement('span');
                wordElement.className = 'hero-word-unit';

                Array.from(word).forEach((character) => {
                    const letter = document.createElement('span');
                    letter.className = 'hero-letter';
                    letter.textContent = character;
                    letter.style.setProperty('--letter-index', letterIndex);
                    letter.style.setProperty('--reverse-index', letterCount - letterIndex - 1);
                    wordElement.append(letter);
                    letterIndex += 1;
                });

                fragment.append(wordElement);
            });

            rotator.replaceChildren(fragment);
        };

        const enterPhrase = () => {
            if (hero) hero.dataset.heroScene = phraseIndex === 1 ? 'disasters' : 'features';
            renderPhrase(phrases[phraseIndex]);
            rotator.classList.remove('is-entering', 'is-leaving');

            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    if (!isRunning) return;
                    rotator.classList.add('is-entering');
                    holdTimer = window.setTimeout(exitPhrase, 3600);
                });
            });
        };

        const exitPhrase = () => {
            if (!isRunning) return;

            rotator.classList.remove('is-entering');
            rotator.classList.add('is-leaving');

            swapTimer = window.setTimeout(() => {
                phraseIndex = (phraseIndex + 1) % phrases.length;
                enterPhrase();
            }, 720);
        };

        const updatePlayback = () => {
            const shouldRun = isIntersecting && !document.hidden;
            if (shouldRun === isRunning) return;

            isRunning = shouldRun;
            clearTimers();
            rotator.classList.remove('is-entering', 'is-leaving');

            if (isRunning) enterPhrase();
        };

        rotator.classList.add('is-enhanced');

        const observer = new IntersectionObserver(([entry]) => {
            isIntersecting = entry.isIntersecting;
            updatePlayback();
        }, { threshold: 0.15 });

        observer.observe(rotator);
        document.addEventListener('visibilitychange', updatePlayback);
        updatePlayback();
    };

    setupHeroRotator();

    const setupCollectionMotion = () => {
        if (!('IntersectionObserver' in window) || !Element.prototype.animate) return;

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const targets = document.querySelectorAll('.domain-heading, .team-heading, .catalogue, .team-member');
        const revealed = new WeakSet();
        const activeAnimations = new Map();
        const easing = 'cubic-bezier(0.16, 1, 0.3, 1)';

        const animate = (root, element, keyframes, duration, delay) => {
            if (!element) return;

            const animation = element.animate(keyframes, {
                duration,
                delay,
                easing,
                fill: 'backwards'
            });
            activeAnimations.set(animation, root);
            const release = () => activeAnimations.delete(animation);
            animation.addEventListener('finish', release, { once: true });
            animation.addEventListener('cancel', release, { once: true });
        };

        const reveal = (element, delay) => {
            if (element.matches('.domain-heading, .team-heading')) {
                animate(element, element.querySelector('h2, h3'), [
                    { opacity: 0.6, filter: 'blur(3px)', transform: 'translateY(0.6rem)' },
                    { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' }
                ], 620, delay);
                return;
            }

            if (element.matches('.catalogue')) {
                animate(element, element.querySelector('.catalogue-visual'), [
                    { opacity: 0.7, clipPath: 'inset(0 0 10% 0)' },
                    { opacity: 1, clipPath: 'inset(0)' }
                ], 680, delay);
                animate(element, element.querySelector('.catalogue-visual img'), [
                    { transform: 'scale(1.035)' },
                    { transform: 'scale(1)' }
                ], 760, delay);
                animate(element, element.querySelector('.catalogue-copy'), [
                    { opacity: 0.65, transform: 'translateY(0.5rem)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ], 520, delay + 80);
                return;
            }

            animate(element, element.querySelector('.team-portrait'), [
                { opacity: 0.65, transform: 'translateY(0.75rem)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], 640, delay);
            animate(element, element.querySelector('.team-member-copy'), [
                { opacity: 0.6, transform: 'translateY(0.375rem)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], 480, delay + 100);
        };

        const observer = new IntersectionObserver((entries) => {
            const rows = new Map();
            entries.filter((entry) => entry.isIntersecting)
                .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top
                    || a.boundingClientRect.left - b.boundingClientRect.left)
                .forEach((entry) => {
                    const element = entry.target;
                    observer.unobserve(element);
                    if (revealed.has(element)) return;
                    revealed.add(element);

                    if (reducedMotion.matches || document.hidden || element.contains(document.activeElement)) return;

                    // Stagger only siblings entering on the same visible row.
                    const parent = element.parentElement;
                    const top = entry.boundingClientRect.top;
                    let row = rows.get(parent);
                    if (!row || Math.abs(row.top - top) > 24) {
                        row = { top, count: 0 };
                        rows.set(parent, row);
                    }
                    reveal(element, Math.min(row.count * 70, 210));
                    row.count += 1;
                });
        }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });

        const cancelAnimations = () => {
            activeAnimations.forEach((_root, animation) => animation.cancel());
            activeAnimations.clear();
        };

        const updateMotion = () => {
            observer.disconnect();
            if (reducedMotion.matches) {
                cancelAnimations();
                return;
            }
            targets.forEach((element) => {
                if (!revealed.has(element)) observer.observe(element);
            });
        };

        document.addEventListener('focusin', (event) => {
            activeAnimations.forEach((root, animation) => {
                if (root.contains(event.target)) animation.cancel();
            });
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) cancelAnimations();
        });
        reducedMotion.addEventListener('change', updateMotion);
        updateMotion();
    };

    setupCollectionMotion();

    const setupVisitCounter = () => {
        const counter = document.querySelector('[data-visit-count]');
        if (!counter) return;

        const endpoint = counter.dataset.endpoint;
        const storageKey = counter.dataset.storageKey;
        const locale = counter.dataset.locale || 'en';
        let alreadyCounted = false;

        try {
            alreadyCounted = window.sessionStorage.getItem(storageKey) === 'yes';
        } catch (_error) {
            alreadyCounted = false;
        }

        window.fetch(endpoint, {
            method: alreadyCounted ? 'GET' : 'POST',
            cache: 'no-store',
            headers: { Accept: 'application/json' }
        }).then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        }).then((payload) => {
            const count = Number(payload.count);
            if (!Number.isFinite(count) || count < 0) throw new Error('Invalid visit count');
            counter.textContent = count.toLocaleString(locale);
            if (!alreadyCounted) {
                try {
                    window.sessionStorage.setItem(storageKey, 'yes');
                } catch (_error) {
                    // The aggregate counter still works without browser storage.
                }
            }
        }).catch(() => {
            counter.textContent = 'Unavailable';
        });
    };

    setupVisitCounter();

    // Visits of each entry and the total of all websites, from the public summary of the visit counters.
    const setupVisitSummary = () => {
        const entries = document.querySelectorAll('[data-visit-key]');
        const total = document.querySelector('[data-visit-total]');
        if (!entries.length && !total) return;

        const format = (value) => value.toLocaleString('en');
        const valid = (value) => Number.isFinite(value) && value >= 0;

        window.fetch('/api/visits/summary', {
            headers: { Accept: 'application/json' }
        }).then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        }).then((payload) => {
            const sites = payload && payload.sites && typeof payload.sites === 'object' ? payload.sites : {};

            entries.forEach((entry) => {
                const figure = entry.querySelector('[data-visit-figure]');
                const record = sites[entry.dataset.visitKey];
                // A number that is not comparable with the others is not shown.
                if (!figure || !record || record.comparable !== true) return;
                const visits = Number(record.visits);
                if (!valid(visits)) return;
                figure.textContent = `${format(visits)} ${visits === 1 ? 'visit' : 'visits'}`;
                figure.hidden = false;
            });

            if (!total) return;
            const sum = Number(payload.total);
            if (!valid(sum)) throw new Error('Invalid total');
            const records = Object.values(sites);
            const counted = records.filter((record) => record && record.comparable === true).length;
            const left = records.length - counted;
            total.textContent = format(sum);
            total.parentElement.title = `Sum of the visits recorded by the counters of ${counted} websites.`
                + (left ? ` ${left === 1 ? 'One counter' : `${left} counters`} with numbers that are not comparable ${left === 1 ? 'is' : 'are'} not included.` : '');
        }).catch(() => {
            if (total) total.textContent = 'Unavailable';
        });
    };

    setupVisitSummary();

    const button = document.querySelector('.share-button');
    const status = document.querySelector('#share-status');

    if (!button || !status) return;

    const shareData = {
        title: 'NKUA geospatial research catalogues',
        text: 'Explore geospatial research catalogues of Earth’s landforms and natural disasters.',
        url: 'https://evelpidou.geo.nkua.cloud/'
    };

    let statusTimer;

    const announce = (message) => {
        window.clearTimeout(statusTimer);
        status.textContent = message;
        statusTimer = window.setTimeout(() => {
            status.textContent = '';
            button.removeAttribute('data-copied');
        }, 2600);
    };

    const copyLink = async () => {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareData.url);
        } else {
            const field = document.createElement('textarea');
            field.value = shareData.url;
            field.setAttribute('readonly', '');
            field.style.position = 'fixed';
            field.style.opacity = '0';
            document.body.appendChild(field);
            field.select();
            document.execCommand('copy');
            field.remove();
        }

        button.setAttribute('data-copied', 'true');
        announce('Link copied to clipboard.');
    };

    button.addEventListener('click', async () => {
        try {
            if (navigator.share) {
                await navigator.share(shareData);
                return;
            }

            await copyLink();
        } catch (error) {
            if (error?.name !== 'AbortError') {
                announce('The link could not be copied. Use evelpidou.geo.nkua.cloud to share this page.');
            }
        }
    });
})();
