/* ─────────────────────────────────────────────────────────────────────────────
   THE PASSAGE — the lateral route transition
   ─────────────────────────────────────────────────────────────────────────────
   A link marked [data-passage] does not load a page, it opens a door. One
   near-black panel crosses the viewport right to left and covers the page
   being left; the route changes underneath it; on the page that arrives, the
   same panel keeps going and uncovers the hero from the right.

   ONE SURFACE, ONE OWNER. Everything that moves during a route change is
   .vp-panel, and only this file ever touches it. The two halves of the
   journey happen in different documents, so they cannot collide across a
   navigation — but they can inside one document, when a passage link is
   pressed while this page is still being uncovered. That case holds the
   panel where it stands and retargets it, the same hold/retarget the chapter
   stage and the size guide use, so a reversal continues from the current
   visual state instead of restarting.

   The incoming page's own reveal is not run from here. This fires
   `void:reveal` on the document with the schedule it is working to, and the
   page schedules its hero against the same clock — one coordinated timeline,
   two files.

   Pages opt in with three things: this file, void-passage.css in the <head>,
   and the inline bootstrap that sets data-passage before first paint.
   ───────────────────────────────────────────────────────────────────────── */
(function voidPassage() {
    'use strict';

    var root = document.documentElement;
    var FLAG = 'void-passage';

    /* Covering has to answer the click, so it is the shorter of the two.
       Clearing carries the weight and is what the visitor actually watches —
       the hero is behind it the whole way. Together with the document swap
       between them this lands a little over a second from press to settled. */
    var COVER_MS = 380;
    var CLEAR_MS = 600;

    /* If the navigation never happens — blocked, offline, a destination that
       refuses to load — the visitor must not be left behind a black panel. */
    var STRANDED_MS = 7000;

    var EASE = {
        cover: 'cubic-bezier(0.32, 0, 0.24, 1)',
        clear: 'cubic-bezier(0.28, 0.72, 0.22, 1)'
    };

    var S = { panel: null, anim: null, phase: null, stranded: 0 };

    // The house switch, as everywhere else on the site.
    function calm() { return root.classList.contains('reduce-motion'); }

    function supported() {
        return typeof Element !== 'undefined'
            && typeof Element.prototype.animate === 'function';
    }

    // ── The surface ──────────────────────────────────────────────────────────
    function build(at) {
        if (S.panel) return S.panel;
        var panel = document.createElement('div');
        panel.className = 'vp-panel';
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = '<span class="vp-lead"></span><span class="vp-wake"></span>';
        panel.style.transform = 'translate3d(' + at + ', 0, 0)';
        (document.body || root).appendChild(panel);
        S.panel = panel;
        return panel;
    }

    function destroy() {
        if (S.anim) { try { S.anim.cancel(); } catch (e) { /* already gone */ } }
        S.anim = null;
        if (S.panel && S.panel.parentNode) S.panel.parentNode.removeChild(S.panel);
        S.panel = null;
        S.phase = null;
        root.classList.remove('vp-moving', 'vp-clearing');
        root.removeAttribute('data-passage');
        window.clearTimeout(S.stranded);
        hold.release();
    }

    // Hold the panel where it stands and let the animation go, so the next one
    // starts from exactly here rather than snapping to a keyframe.
    function park() {
        if (!S.anim) return;
        try { S.anim.commitStyles(); } catch (e) { /* not rendered */ }
        S.anim.cancel();
        S.anim = null;
    }

    // One keyframe: from wherever the panel is now. That is what makes a
    // press during the reveal continuous rather than a restart.
    function play(to, ms, ease) {
        park();
        S.anim = S.panel.animate(
            [{ transform: 'translate3d(' + to + ', 0, 0)' }],
            { duration: ms, easing: ease, fill: 'both' }
        );
        return S.anim;
    }

    // ── Holding the page still ───────────────────────────────────────────────
    // Only while the panel is up, and only through listeners: taking the
    // scrollbar away with overflow:hidden and handing it back is a layout
    // shift at both ends of the very movement that is supposed to be seamless.
    var hold = (function () {
        var on = false;
        function stop(event) { if (event.cancelable) event.preventDefault(); }
        function keys(event) {
            if (/^(Arrow|Page|Home|End| )/.test(event.key) || event.key === 'Spacebar') stop(event);
        }
        return {
            take: function () {
                if (on) return;
                on = true;
                window.addEventListener('wheel', stop, { passive: false });
                window.addEventListener('touchmove', stop, { passive: false });
                window.addEventListener('keydown', keys, true);
            },
            release: function () {
                if (!on) return;
                on = false;
                window.removeEventListener('wheel', stop, { passive: false });
                window.removeEventListener('touchmove', stop, { passive: false });
                window.removeEventListener('keydown', keys, true);
            }
        };
    })();

    // ── Telling the page when to reveal ──────────────────────────────────────
    // `via` is what the page needs to decide how much ceremony it is owed:
    //   passage  arrived through the door — the full reveal, behind the panel
    //   direct   typed, bookmarked, refreshed — the same beats, shorter
    //   history  back or forward — none at all, the page was already seen
    var told = false;
    function tell(via) {
        if (told) return;
        told = true;
        try {
            document.dispatchEvent(new CustomEvent('void:reveal', {
                detail: { via: via, clearMs: CLEAR_MS, coverMs: COVER_MS }
            }));
        } catch (e) { /* no CustomEvent constructor */ }
        root.setAttribute('data-revealed', via);
    }

    function restored() {
        try {
            var nav = performance.getEntriesByType('navigation')[0];
            return Boolean(nav && nav.type === 'back_forward');
        } catch (e) { return false; }
    }

    // ── Arriving ─────────────────────────────────────────────────────────────
    function arrive() {
        var marked = root.getAttribute('data-passage') === 'in';

        // Back and forward are immediate: this page has been seen, and making
        // someone sit through the door again to reach what they just left is
        // the opposite of immediate. The browser's own scroll restoration is
        // left alone.
        if (restored()) { root.removeAttribute('data-passage'); tell('history'); return; }

        if (!marked || calm() || !supported()) {
            root.removeAttribute('data-passage');
            tell(marked ? 'passage' : 'direct');
            return;
        }

        // The still cover is painted and the hero is laid out behind it. The
        // panel takes its place at the same position in the same colour, and
        // the swap is made in one frame: the element is in the document and
        // its transform committed before the attribute that paints the cover
        // is taken off, so no frame is drawn without one or the other.
        build('0%');
        root.classList.add('vp-moving', 'vp-clearing');
        hold.take();
        void S.panel.offsetWidth;
        root.removeAttribute('data-passage');

        // The instant the panel starts to move. Everything the page reveals
        // behind the edge is scheduled against this, not against whenever the
        // page's own script happened to parse — deferred scripts run in order
        // and this one runs first, so without a shared zero the hero would
        // always be a few milliseconds behind the edge that is uncovering it.
        S.phase = 'clear';
        window.voidPassage.revealAt = performance.now();
        tell('passage');

        play('-100%', CLEAR_MS, EASE.clear).finished
            .then(function () { if (S.phase === 'clear') destroy(); })
            .catch(function () { /* retargeted by a press during the reveal */ });
    }

    // ── Leaving ──────────────────────────────────────────────────────────────
    function leave(href) {
        S.phase = 'cover';
        root.classList.add('vp-moving');
        root.classList.remove('vp-clearing');
        hold.take();
        build('100%');

        try { sessionStorage.setItem(FLAG, 'in'); } catch (e) { /* storage blocked */ }

        play('0%', COVER_MS, EASE.cover).finished
            .then(function () {
                if (S.phase !== 'cover') return;
                // Changed while the outgoing page is completely covered, so
                // the swap itself is never seen.
                window.location.assign(href);
            })
            .catch(function () { /* superseded */ });

        // Nothing should be able to strand someone behind the panel.
        S.stranded = window.setTimeout(function () {
            if (S.phase !== 'cover') return;
            try { sessionStorage.removeItem(FLAG); } catch (e) { /* ignore */ }
            play('100%', 320, EASE.clear).finished
                .then(destroy).catch(function () {});
        }, COVER_MS + STRANDED_MS);
    }

    // ── The link ─────────────────────────────────────────────────────────────
    function passageLink(event) {
        var el = event.target instanceof Element ? event.target.closest('[data-passage]') : null;
        if (!el) return null;
        var href = el.getAttribute('href') || el.dataset.passageHref || '';
        if (!href) return null;
        var url;
        try { url = new URL(href, location.href); } catch (e) { return null; }
        if (url.origin !== location.origin) return null;
        return { el: el, url: url };
    }

    function plainClick(event) {
        return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
            || (typeof event.button === 'number' && event.button !== 0));
    }

    // A destination asked for before it is needed. Started on the press, so by
    // the time the panel has finished covering, the document is usually
    // already in the cache and the swap costs nothing.
    var warmed = {};
    function warm(url) {
        var key = url.pathname + url.search;
        if (warmed[key]) return;
        warmed[key] = true;
        var link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = 'document';
        link.href = key;
        document.head.appendChild(link);
    }

    document.addEventListener('pointerdown', function (event) {
        var hit = passageLink(event);
        if (!hit || !plainClick(event)) return;
        // The answer to the press, on the frame of the press.
        hit.el.classList.add('is-pressed');
        warm(hit.url);
    });

    ['pointerup', 'pointercancel', 'blur'].forEach(function (name) {
        document.addEventListener(name, function () {
            if (S.phase === 'cover') return;   // stays lit while the door opens
            document.querySelectorAll('[data-passage].is-pressed')
                .forEach(function (el) { el.classList.remove('is-pressed'); });
        }, true);
    });

    document.addEventListener('mouseenter', function (event) {
        var hit = passageLink(event);
        if (hit) warm(hit.url);
    }, true);

    document.addEventListener('click', function (event) {
        var hit = passageLink(event);
        if (!hit || event.defaultPrevented || !plainClick(event)) return;
        if (hit.el.target && hit.el.target !== '_self') return;

        // Already on the way: a second press must not start a second journey
        // or send the browser somewhere twice.
        if (S.phase === 'cover') { event.preventDefault(); return; }

        event.preventDefault();
        hit.el.classList.add('is-pressed');

        if (calm() || !supported()) { window.location.assign(hit.url.href); return; }
        leave(hit.url.href);
    });

    // ── Coming back ──────────────────────────────────────────────────────────
    // Restored from the back/forward cache, this document is exactly as it was
    // left — including, on the page someone navigated away from, a panel
    // covering the whole viewport. Take it down and clear the flag, or Back
    // lands on a black screen.
    window.addEventListener('pageshow', function (event) {
        if (!event.persisted) return;
        try { sessionStorage.removeItem(FLAG); } catch (e) { /* ignore */ }
        destroy();
        told = true;
        root.setAttribute('data-revealed', 'history');
    });

    // A page left mid-cover keeps the flag; one left any other way must not,
    // or an unrelated later visit would open behind a cover with nothing to
    // uncover it.
    window.addEventListener('pagehide', function () {
        if (S.phase !== 'cover') {
            try { sessionStorage.removeItem(FLAG); } catch (e) { /* ignore */ }
        }
    });

    window.voidPassage = {
        get arriving() { return root.getAttribute('data-passage') === 'in'; },
        coverMs: COVER_MS,
        clearMs: CLEAR_MS,
        // performance.now() at the frame the panel began to clear, or null on
        // any arrival that is not a passage. Pages schedule against this.
        revealAt: null,
        cancel: destroy
    };

    arrive();
})();
