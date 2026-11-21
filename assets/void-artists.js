/* ─────────────────────────────────────────────────────────────────────────────
   EV FOR ARTISTS — /for-artists
   ─────────────────────────────────────────────────────────────────────────────
   Four things live here: the language, the hero's reveal, the restrained
   scroll reveals, and the submission form.

   The hero's reveal is not started by this file's own clock. void-passage.js
   fires `void:reveal` with the schedule it is working to, and everything below
   is timed against that one timeline — the title is drawn in behind the
   panel's edge, not after it. A direct visit gets the same beats in a shorter
   window; back and forward get none at all.
   ───────────────────────────────────────────────────────────────────────── */
(function voidArtists() {
    'use strict';

    var root = document.documentElement;
    var $ = function (id) { return document.getElementById(id); };
    var calm = function () { return root.classList.contains('reduce-motion'); };

    // ══ Language ══════════════════════════════════════════════════════════
    // The house's stored choice, as the fragrance page reads it. EV for
    // Artists is the programme's name and is never translated.
    var I18N = window.VOID_ARTISTS_I18N || { en: {} };
    var lang = 'en';
    try {
        var saved = localStorage.getItem('voidLanguage');
        if (saved && I18N[saved]) lang = saved;
    } catch (e) { /* storage blocked */ }

    function t(key) {
        return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || '';
    }

    // ══ Intake state ══════════════════════════════════════════════════════
    // One flag decides every primary action on the page — the header link,
    // the hero, the action after the editorial, and the heading of the
    // section they all lead to. Closed, they offer the notification form and
    // land on it; open, they offer the submission and land on the first
    // field of the form. The markup is written closed, so a visitor without
    // script is never sent to a form that is not there.
    var OPEN = intakeOpen();
    var INTAKE_TARGET = OPEN ? '#arForm' : '#arGate';
    root.setAttribute('data-intake', OPEN ? 'open' : 'closed');
    document.querySelectorAll('[data-intake-cta]').forEach(function (el) {
        el.setAttribute('href', INTAKE_TARGET);
    });

    function applyLanguage() {
        root.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var v = t(el.dataset.i18n);
            if (v) el.textContent = v;
        });
        document.querySelectorAll('[data-i18n-intake]').forEach(function (el) {
            var v = t(el.dataset.i18nIntake + (OPEN ? 'Open' : 'Closed'));
            if (v) el.textContent = v;
        });
        document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
            var v = t(el.dataset.i18nHtml);
            if (v) el.innerHTML = v;
        });
        // Alt text is content, not decoration: these plates describe the
        // garment, so they translate with everything else. The VOID Lab
        // artwork is the one image that does not: its alt is the brand name,
        // the same in every language, and carries no data-i18n-alt.
        document.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
            var v = t(el.dataset.i18nAlt);
            if (v) el.alt = v;
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            var v = t(el.dataset.i18nPlaceholder);
            if (v) el.placeholder = v;
        });
        document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
            var v = t(el.dataset.i18nAriaLabel);
            if (v) el.setAttribute('aria-label', v);
        });
        var btn = $('arLangButton');
        if (btn) btn.textContent = lang.toUpperCase();
        document.querySelectorAll('.ar-lang-option').forEach(function (el) {
            el.setAttribute('aria-selected', String(el.dataset.language === lang));
        });
    }

    (function languagePicker() {
        var wrap = $('arLang');
        var button = $('arLangButton');
        if (!wrap || !button) return;

        function close() {
            wrap.classList.remove('is-open');
            button.setAttribute('aria-expanded', 'false');
        }
        button.addEventListener('click', function () {
            var open = wrap.classList.toggle('is-open');
            button.setAttribute('aria-expanded', String(open));
        });
        wrap.querySelectorAll('.ar-lang-option').forEach(function (option) {
            option.addEventListener('click', function () {
                lang = option.dataset.language;
                try { localStorage.setItem('voidLanguage', lang); } catch (e) { /* ignore */ }
                applyLanguage();
                close();
            });
        });
        document.addEventListener('click', function (event) {
            if (!wrap.contains(event.target)) close();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') close();
        });
    })();

    applyLanguage();

    // ══ The hero's reveal ═════════════════════════════════════════════════
    // Opacity and clip only. Nothing here changes a position, so the frame a
    // word becomes readable is the frame it is already in its final place —
    // which is the whole test the entrance has to pass.
    //
    // [delay, duration] per part, measured from the moment the passage panel
    // begins to clear. The title is on the left of the frame and the panel
    // uncovers from the right, so it is drawn in behind the edge rather than
    // before it; the lines under it resolve together once the edge is past.
    var PLAN = {
        passage: {
            title:  [140, 480],
            kicker: [210, 280],
            draft:  [280, 620],
            lede:   [380, 300],
            body:   [420, 300],
            cta:    [470, 300],
            scroll: [720, 380]
        },
        // Typed, bookmarked or refreshed: the same order, roughly half the
        // window. Nobody who asked for this page directly should have to
        // watch a door they did not open.
        direct: {
            title:  [0,   420],
            kicker: [40,  260],
            draft:  [120, 520],
            lede:   [170, 260],
            body:   [210, 260],
            cta:    [260, 300],
            scroll: [460, 300]
        }
    };

    var EASE_SETTLE = 'cubic-bezier(0.16, 1, 0.3, 1)';
    var EASE_ARRIVE = 'cubic-bezier(0.4, 0, 0.2, 1)';

    // How far into the passage's timeline this file is running. Deferred
    // scripts run in order and void-passage.js is first, so by the time this
    // one parses the panel has already been moving for a moment. Every delay
    // below is measured from the panel's own zero and this is taken off, so
    // the title is drawn in behind the edge rather than a beat after it.
    var late = 0;
    function at(part) {
        return [Math.max(0, part[0] - late), part[1]];
    }

    function fade(el, part) {
        if (!el || !part) return null;
        var when = at(part);
        return el.animate([{ opacity: 0 }, { opacity: 1 }],
            { duration: when[1], delay: when[0], easing: EASE_ARRIVE, fill: 'both' });
    }

    var revealed = false;
    function reveal(via) {
        if (revealed) return;
        revealed = true;
        window.clearTimeout(window.__arSafety);

        var zero = window.voidPassage && window.voidPassage.revealAt;
        if (via === 'passage' && typeof zero === 'number') {
            late = Math.max(0, Math.min(400, performance.now() - zero));
        }

        var hero = document.querySelector('.ar-hero');
        if (!hero) { root.classList.remove('ar-pre'); return; }

        // Already seen, or asked for a calmer site: the page is simply here.
        if (via === 'history' || calm() || typeof hero.animate !== 'function') {
            root.classList.remove('ar-pre');
            return;
        }

        var plan = PLAN[via] || PLAN.direct;
        var maskIn = hero.querySelector('.ar-mask-in');

        // The title uncovers from the right, the same way the panel's edge
        // travels, so the two read as one movement rather than two.
        if (maskIn) {
            var title = at(plan.title);
            maskIn.animate(
                [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }],
                { duration: title[1], delay: title[0], easing: EASE_SETTLE, fill: 'both' }
            );
        }
        fade(hero.querySelector('.ar-hero-kicker'), plan.kicker);
        fade(hero.querySelector('.ar-hero-draft'), plan.draft);
        fade(hero.querySelector('.ar-hero-lede'), plan.lede);
        fade(hero.querySelector('.ar-hero-body'), plan.body);
        fade(hero.querySelector('.ar-hero-actions'), plan.cta);
        fade(hero.querySelector('.ar-hero-scroll'), plan.scroll);

        // The CSS pre-state comes off in the same frame the animations are
        // created. Each holds its own first keyframe through its delay, so
        // nothing is visible before it is meant to be.
        root.classList.remove('ar-pre');
    }

    document.addEventListener('void:reveal', function (event) {
        reveal((event.detail && event.detail.via) || 'direct');
    });
    // void-passage.js may have fired before this file parsed, or may not be
    // present at all. Either way the hero is revealed exactly once.
    if (root.hasAttribute('data-revealed')) reveal(root.getAttribute('data-revealed'));
    window.setTimeout(function () { reveal('direct'); }, 1200);

    // ══ Header backing ════════════════════════════════════════════════════
    (function headerBacking() {
        var nav = $('arNav');
        var sentinel = $('arTopSentinel');
        if (!nav || !sentinel || !('IntersectionObserver' in window)) return;
        new IntersectionObserver(function (entries) {
            nav.classList.toggle('is-backed', !entries[0].isIntersecting);
        }, { rootMargin: '-120px 0px 0px 0px' }).observe(sentinel);
    })();

    // ══ Scroll reveals ════════════════════════════════════════════════════
    // Once, on first sight, and nothing that could still be moving while
    // someone is reading terms or filling in a field.
    (function scrollReveals() {
        var targets = document.querySelectorAll('.ar-reveal');
        if (!targets.length) return;
        if (calm() || !('IntersectionObserver' in window)) {
            targets.forEach(function (el) { el.classList.add('is-in'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-in');
                io.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
        targets.forEach(function (el) { io.observe(el); });
    })();

    // ══ Countries ═════════════════════════════════════════════════════════
    // A help, not a restriction: the field stays free text so nobody is
    // locked out by a list that does not contain where they live.
    (function countries() {
        var list = $('arCountries');
        if (!list) return;
        ['Austria', 'Belgium', 'Brazil', 'Bulgaria', 'Canada', 'Croatia', 'Czechia',
         'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary',
         'Iceland', 'India', 'Ireland', 'Italy', 'Japan', 'Latvia', 'Lithuania',
         'Luxembourg', 'Malta', 'Mexico', 'Netherlands', 'New Zealand', 'Norway',
         'Poland', 'Portugal', 'Romania', 'Serbia', 'Singapore', 'Slovakia',
         'Slovenia', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'Ukraine',
         'United Arab Emirates', 'United Kingdom', 'United States', 'Australia'
        ].forEach(function (name) {
            var option = document.createElement('option');
            option.value = name;
            list.appendChild(option);
        });
    })();

    // ══ The submission form ═══════════════════════════════════════════════
    var MAX_BYTES = 15 * 1024 * 1024;
    var TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Intake is closed until the rate, the payouts and the legal drafts are
    // approved. `?intake=preview` only un-hides the form — the gate itself is
    // on the server, and the server lets exactly one kind of caller through a
    // closed one: an administrator on the existing allowlist, whose submission
    // is flagged as a rehearsal. So the query string reveals the form to
    // anyone; it admits nobody.
    function previewRequested() {
        try {
            return new URLSearchParams(location.search).get('intake') === 'preview';
        } catch (e) { return false; }
    }

    function intakeOpen() {
        return window.VOID_ARTISTS_INTAKE_OPEN === true || previewRequested();
    }

    // The signed-in session, when there is one, so an administrator
    // rehearsing through a closed gate is recognised. Loaded only on the
    // preview path: an artist submitting to an open gate needs no account and
    // is never asked for one.
    var sessionToken = null;
    function warmSession() {
        if (!previewRequested()) return Promise.resolve(null);
        return import('/assets/supabase-client.js')
            .then(function (mod) { return mod.getSession(); })
            .then(function (session) {
                sessionToken = session ? session.access_token : null;
                return sessionToken;
            })
            .catch(function () { return null; });
    }

    var form = $('arForm');
    var gate = $('arGate');

    if (form && gate && OPEN) {
        gate.hidden = true;
        form.hidden = false;
        warmSession();
    }

    function setError(input, message) {
        var box = document.querySelector('.ar-field-error[data-for="' + input.id + '"]');
        if (box) {
            box.textContent = message || '';
            box.classList.toggle('is-on', Boolean(message));
        }
        input.classList.toggle('is-invalid', Boolean(message));
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
        return !message;
    }

    function validate() {
        var ok = true;
        var first = null;
        function check(input, message) {
            var good = setError(input, message);
            if (!good) { ok = false; if (!first) first = input; }
        }

        var name = $('arName'), email = $('arEmail'), country = $('arCountry');
        var title = $('arTitleField'), desc = $('arDesc'), link = $('arLink');
        var file = $('arFile'), terms = $('arAcceptTerms');

        check(name, name.value.trim() ? '' : t('errRequired'));
        check(email, EMAIL_RE.test(email.value.trim()) ? '' : t('errEmail'));
        check(country, country.value.trim() ? '' : t('errRequired'));
        check(title, title.value.trim() ? '' : t('errRequired'));
        check(desc, desc.value.trim() ? '' : t('errRequired'));

        if (link.value.trim()) {
            var good = false;
            try {
                var url = new URL(link.value.trim());
                good = url.protocol === 'https:' || url.protocol === 'http:';
            } catch (e) { good = false; }
            check(link, good ? '' : t('errUrl'));
        } else {
            setError(link, '');
        }

        var chosen = file.files && file.files[0];
        if (chosen) {
            if (TYPES.indexOf(chosen.type) === -1 && !/\.(pdf|jpe?g|png)$/i.test(chosen.name)) {
                check(file, t('errFileType'));
            } else if (chosen.size > MAX_BYTES) {
                check(file, t('errFileSize'));
            } else {
                setError(file, '');
            }
        } else {
            setError(file, '');
        }

        check(terms, terms.checked ? '' : t('errTerms'));

        if (first && typeof first.focus === 'function') first.focus();
        return ok;
    }

    function say(node, message, kind) {
        if (!node) return;
        node.textContent = message;
        node.classList.remove('is-error', 'is-ok');
        if (kind) node.classList.add(kind);
    }

    if (form) {
        var desc = $('arDesc');
        var count = $('arDescCount');
        if (desc && count) {
            var tick = function () { count.textContent = desc.value.length + ' / 2000'; };
            desc.addEventListener('input', tick);
            tick();
        }

        // Clear a field's complaint as soon as it is being put right.
        form.querySelectorAll('input, textarea').forEach(function (input) {
            input.addEventListener('input', function () {
                if (input.classList.contains('is-invalid')) setError(input, '');
            });
            input.addEventListener('change', function () {
                if (input.classList.contains('is-invalid')) setError(input, '');
            });
        });

        var sending = false;
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            if (sending) return;

            var msg = $('arFormMsg');
            if (!validate()) { say(msg, '', null); return; }

            var button = $('arSubmitBtn');
            sending = true;
            button.disabled = true;
            say(msg, t('sending'), null);

            var chosen = $('arFile').files && $('arFile').files[0];
            var fields = {
                name: $('arName').value.trim(),
                email: $('arEmail').value.trim(),
                country: $('arCountry').value.trim(),
                title: $('arTitleField').value.trim(),
                description: $('arDesc').value.trim(),
                portfolio: $('arLink').value.trim(),
                locale: lang,
                acceptTerms: true,
                acceptNews: $('arAcceptNews').checked
            };
            if (chosen) {
                // Described, not carried: the bytes go straight from here to
                // private storage over a one-shot URL the server mints. They
                // never pass through a function, so they are never in a
                // request body anything could log.
                fields.file = { name: chosen.name, type: chosen.type, size: chosen.size };
            }

            // `done` is the only place that declares success, so a half-
            // finished submission can never look finished.
            function done(data) {
                var receipt = $('arReceipt');
                var ref = $('arReceiptRef');
                if (ref) ref.textContent = data.reference || '—';
                form.hidden = true;
                if (receipt) {
                    receipt.hidden = false;
                    // A receipt that did not send is ours to retry, never a
                    // reason to ask somebody to upload their work again.
                    if (data.receiptSent === false) {
                        var note = document.createElement('p');
                        note.className = 'ar-receipt-copy';
                        note.textContent = t('errRetry');
                        receipt.appendChild(note);
                    }
                    receipt.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
                }
            }

            function stop(message) {
                sending = false;
                button.disabled = false;
                say(msg, message, 'is-error');
            }

            function post(payload) {
                var headers = { 'Content-Type': 'application/json' };
                if (sessionToken) headers.Authorization = 'Bearer ' + sessionToken;
                return fetch('/api/artist-submission', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                }).then(function (response) {
                    return response.json()
                        .catch(function () { return {}; })
                        .then(function (data) { return { status: response.status, data: data || {} }; });
                });
            }

            post(fields)
                .then(function (result) {
                    if (result.status !== 200 || !result.data.ok) {
                        stop(result.data.message || t('errServer'));
                        return null;
                    }
                    // No file: the submission is already in the queue.
                    if (!result.data.pending) { done(result.data); return null; }

                    var handoff = result.data;
                    return fetch(handoff.uploadUrl, {
                        method: 'PUT',
                        headers: handoff.uploadHeaders || {},
                        body: chosen
                    }).then(function (up) {
                        if (!up.ok) throw new Error('upload_failed');
                        // Only now does the submission join the queue. Until
                        // this lands it is a draft nobody will read, and the
                        // row and the file are swept together.
                        return post({ confirm: handoff.reference, token: handoff.token, path: handoff.path });
                    }).then(function (confirmed) {
                        if (confirmed.status === 200 && confirmed.data.ok) { done(confirmed.data); return null; }
                        stop(confirmed.data.message || t('errServer'));
                        return null;
                    });
                })
                .catch(function () {
                    stop(t('errNetwork'));
                });
        });
    }

    // ══ The waiting list ══════════════════════════════════════════════════
    // While intake is closed. Goes to the newsletter the house already runs,
    // with its own source, so the consent record and the unsubscribe path are
    // the ones already in place.
    (function gateForm() {
        var gateForm = $('arGateForm');
        if (!gateForm) return;
        var sending = false;

        gateForm.addEventListener('submit', function (event) {
            event.preventDefault();
            if (sending) return;
            var input = $('arGateEmail');
            var msg = $('arGateMsg');
            var value = input.value.trim();
            if (!EMAIL_RE.test(value)) { say(msg, t('errEmail'), 'is-error'); input.focus(); return; }

            sending = true;
            say(msg, t('sending'), null);
            fetch('/api/newsletter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: value, interest: 'ev-for-artists' })
            })
                .then(function (response) { return response.ok; })
                .then(function (ok) {
                    sending = false;
                    say(msg, ok ? t('gateOk') : t('gateErr'), ok ? 'is-ok' : 'is-error');
                    if (ok) input.value = '';
                })
                .catch(function () {
                    sending = false;
                    say(msg, t('gateErr'), 'is-error');
                });
        });
    })();
})();
