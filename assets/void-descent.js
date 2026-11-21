/* ─────────────────────────────────────────────────────────────────────────────
   THE DESCENT — the in-page journey
   ─────────────────────────────────────────────────────────────────────────────
   The passage (void-passage.js) answers a Collection link by moving one panel
   across the viewport: a press is acknowledged on the frame it happens, the
   movement begins at once, and it decelerates a long way into its rest. This
   file gives an in-page link the same manners without changing the route —
   nothing crosses the screen, the page itself travels.

   WHAT IS BORROWED, AND WHAT IS NOT. The curve is the passage's own clearing
   curve: fast off the mark, then a long settle. The press answer is the same
   warm gold, raised on pointerdown rather than on click, because the point of
   it is to be there before the movement is. What is not borrowed is the
   fixed duration — a panel always crosses one viewport, but a descent may be
   eight thousand pixels or eight hundred, and the same number of milliseconds
   would make one crawl and the other lurch. Duration is taken from distance,
   on a square root so that a journey ten times longer takes about three times
   as long rather than ten.

   TWO VOICES. The primary descent is the hero's "Submit a Design" and the
   link that closes the editorial: the full travel, the full curve. The quiet
   one is "Collaboration Terms" — shorter, gentler off the mark, and answered
   with a hairline rather than a lit edge. They are meant to feel like the
   same house and not like the same gesture.

   ONE OWNER. Only this file scrolls the page. A press while a descent is
   running retargets it from wherever the page has got to, so a second
   destination is continuous rather than a cut; a press on the destination
   already being travelled to is ignored rather than restarted. Any real
   input — wheel, touch, a navigation key — ends the animation where it
   stands, because someone who has taken the wheel is no longer a passenger.
   ───────────────────────────────────────────────────────────────────────── */
(function voidDescent() {
    'use strict';

    var root = document.documentElement;

    // The house switch, as everywhere else on the site.
    function calm() { return root.classList.contains('reduce-motion'); }

    /* Distance → duration. `base` is what the shortest journey costs, `span`
       what the reference distance adds on top, and the ends are clamped so
       nothing is ever instant enough to read as a jump or slow enough to be
       in the way.

       primary  a 4500px descent lands in ~900ms, a full-page one in ~1.1s —
                the passage's own press-to-settled, which is what this is
                meant to feel like. A link already beside the form: ~450ms.
       quiet    the same shape, two thirds the weight. A typical desktop
                distance lands between 450 and 650ms, and it never takes
                longer than the primary would for the same travel. */
    var PROFILE = {
        primary: { ease: [0.28, 0.72, 0.22, 1], base: 260, span: 640, ref: 4500, min: 380, max: 1180 },
        quiet:   { ease: [0.38, 0.06, 0.20, 1], base: 240, span: 300, ref: 3000, min: 320, max: 680 }
    };

    /* A cubic-bezier evaluated in script, because the page's scroll position
       is not a property the compositor will animate for us. Newton-Raphson
       from x as the first guess converges in a handful of steps for every
       curve here; the bisection is only there so a pathological control point
       could never spin. */
    function bezier(p1x, p1y, p2x, p2y) {
        function a(c1, c2) { return 1 - 3 * c2 + 3 * c1; }
        function b(c1, c2) { return 3 * c2 - 6 * c1; }
        function c(c1) { return 3 * c1; }
        function at(t, c1, c2) { return ((a(c1, c2) * t + b(c1, c2)) * t + c(c1)) * t; }
        function slope(t, c1, c2) { return 3 * a(c1, c2) * t * t + 2 * b(c1, c2) * t + c(c1); }
        return function (x) {
            if (x <= 0) return 0;
            if (x >= 1) return 1;
            var t = x, i, s;
            for (i = 0; i < 6; i++) {
                s = slope(t, p1x, p2x);
                if (!s) break;
                var err = at(t, p1x, p2x) - x;
                if (Math.abs(err) < 1e-6) return at(t, p1y, p2y);
                t -= err / s;
            }
            var lo = 0, hi = 1;
            t = x;
            for (i = 0; i < 20; i++) {
                if (at(t, p1x, p2x) > x) hi = t; else lo = t;
                t = (lo + hi) / 2;
            }
            return at(t, p1y, p2y);
        };
    }

    var CURVE = {
        primary: bezier.apply(null, PROFILE.primary.ease),
        quiet: bezier.apply(null, PROFILE.quiet.ease)
    };

    // ── Where a destination actually sits ────────────────────────────────────
    // The header is fixed, so the top of a section is not where it can be
    // read from. Headroom is the header plus a little air, and it is measured
    // rather than assumed: the header's height changes with the viewport.
    function headroom() {
        var nav = document.getElementById('arNav');
        var h = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
        return h + Math.min(46, Math.max(14, Math.round(window.innerHeight * 0.03)));
    }

    /* Layout position, walked up the offset chain rather than read off a
       bounding rect. A rect carries transforms, and every section on this
       page is a scroll reveal that sits fourteen pixels low until it has
       been seen — so a destination measured from a rect while the section is
       still unrevealed is fourteen pixels wrong, and arrives with the
       heading that much closer to the header than it was meant to be.
       offsetTop is the laid-out position and does not move with a
       transform. */
    function layoutTop(el) {
        var y = 0, node = el;
        while (node) { y += node.offsetTop; node = node.offsetParent; }
        return y;
    }

    function destinationOf(el) {
        var limit = Math.max(0, root.scrollHeight - window.innerHeight);
        return Math.max(0, Math.min(Math.round(layoutTop(el) - headroom()), limit));
    }

    // ── The journey ──────────────────────────────────────────────────────────
    var S = { raf: 0, el: null, to: 0, lit: null, release: 0 };

    function unlight() {
        window.clearTimeout(S.release);
        if (S.lit) S.lit.classList.remove('is-descending');
        S.lit = null;
    }

    // Lit on the press and held for as long as the page is moving, so the
    // answer and the movement are one event rather than two.
    function light(el) {
        if (S.lit && S.lit !== el) unlight();
        window.clearTimeout(S.release);
        S.lit = el;
        el.classList.add('is-descending');
    }

    function dim(after) {
        window.clearTimeout(S.release);
        S.release = window.setTimeout(unlight, after || 0);
    }

    function halt() {
        if (S.raf) window.cancelAnimationFrame(S.raf);
        S.raf = 0;
        S.el = null;
        listen(false);
    }

    // Taking the wheel ends the journey. Our own scrolling does not raise any
    // of these, so there is no way for the animation to interrupt itself.
    function interrupted(event) {
        if (event.type === 'keydown'
            && !(/^(Arrow|Page|Home|End| )/.test(event.key) || event.key === 'Spacebar')) return;
        halt();
        dim(140);
    }

    function listen(on) {
        var fn = on ? 'addEventListener' : 'removeEventListener';
        window[fn]('wheel', interrupted, { passive: true });
        window[fn]('touchstart', interrupted, { passive: true });
        window[fn]('keydown', interrupted, true);
    }

    // ── Sections as paths ────────────────────────────────────────────────────
    /* Destinations are real paths under the page — /for-artists/terms, not
       /for-artists#terms — so a copied link, a new tab, a refresh and a
       shared URL all arrive at the same place. Vercel rewrites each
       registered path to this document; the table itself is handed over by
       the page script (void-artists.js), because one destination depends on
       whether intake is open. Element ids are untouched: they are what the
       scroll and the focus land on. */
    var R = { base: '', sections: {}, legacy: {}, ready: false };

    function norm(p) {
        p = String(p || '/').replace(/\/+$/, '');
        return p || '/';
    }
    function pathOf(slug) { return slug ? R.base + '/' + slug : R.base; }
    function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

    // '' for the page itself, the slug for a registered section, and null
    // for anything else — which is left entirely to the browser.
    function slugOf(pathname) {
        if (!R.ready) return null;
        var p = norm(pathname);
        if (p === R.base) return '';
        if (p.indexOf(R.base + '/') !== 0) return null;
        var s = p.slice(R.base.length + 1);
        return has(R.sections, s) ? s : null;
    }
    function nodeOf(slug) { return slug ? document.getElementById(R.sections[slug]) : null; }

    /* Where the visitor was on the entry they are leaving, kept in that
       entry's own state so Back can return them to it. Scroll restoration is
       manual (see routes()), so this is the only record there is. */
    function remember() {
        try {
            var s = history.state && typeof history.state === 'object' ? history.state : {};
            var next = {};
            for (var k in s) if (has(s, k)) next[k] = s[k];
            next.arY = window.scrollY || window.pageYOffset;
            history.replaceState(next, '');
        } catch (e) { /* history blocked */ }
    }

    // Arrival. The URL is made to say where we are, and the destination
    // takes focus so the keyboard and a screen reader follow the page. The
    // section takes it, never a field: on a phone, focusing an input here
    // would raise the keyboard before the visitor has asked for it, and the
    // form is to be read before it is filled in.
    /* The path is pushed at the press, before the page moves — the URL names
       where you asked to go from the moment you ask, and the entry being
       left still holds where you pressed from. A press for the place the
       address bar already names adds nothing: one destination, one entry,
       however many times it is asked for. */
    function announce(slug) {
        var path = pathOf(slug);
        if (norm(location.pathname) === path && !location.hash) return;
        remember();
        try { history.pushState({ arSection: slug }, '', path + location.search); }
        catch (e) { /* history blocked; the scroll still happens */ }
    }

    function land(el) {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        try { el.focus({ preventScroll: true }); } catch (e) { /* older browser */ }
    }

    function travel(el, kind, slug) {
        var p = PROFILE[kind] || PROFILE.quiet;
        var from = window.scrollY || window.pageYOffset;
        var to = destinationOf(el);
        var gap = Math.abs(to - from);

        // Already on the way to this exact place: a second press must not
        // restart the journey or re-ease what is already decelerating.
        if (S.raf && S.el === el && Math.abs(S.to - to) < 2) return;

        if (typeof slug === 'string') announce(slug);

        if (calm() || gap < 2) {
            halt();
            window.scrollTo(0, to);
            land(el);
            dim(220);
            return;
        }

        // A new destination takes over from wherever the page has got to, so
        // there is nothing to jump back from.
        halt();

        var ms = Math.round(Math.min(p.max, Math.max(p.min, p.base + p.span * Math.sqrt(gap / p.ref))));
        var curve = CURVE[kind] || CURVE.quiet;
        var started = 0;
        S.el = el;
        S.to = to;
        listen(true);

        S.raf = window.requestAnimationFrame(function step(now) {
            if (!started) started = now;
            var x = Math.min(1, (now - started) / ms);
            /* The destination is re-read on every frame, not fixed at the
               press. This page is a long editorial that is still settling
               while the descent runs — a late webfont reflows a dozen
               sections of narrow mobile text, and the document can grow by
               thousands of pixels after the journey has begun. A target
               fixed at the press would be clamped to the old, shorter
               document and the descent would stop short of the form. Re-read
               it and the path simply bends; the easing is on normalised
               time, so nothing in the movement jumps. */
            to = destinationOf(el);
            S.to = to;
            window.scrollTo(0, from + (to - from) * curve(x));
            if (x < 1) { S.raf = window.requestAnimationFrame(step); return; }
            S.raf = 0;
            S.el = null;
            listen(false);
            window.scrollTo(0, destinationOf(el));
            land(el);
            dim(160);
        });
    }

    // ── The link ─────────────────────────────────────────────────────────────
    // Two kinds, and nothing else. A link to a registered section path
    // (/for-artists/terms) travels and takes the address bar with it. A
    // same-page fragment (the skip link) moves the view and the focus and
    // leaves the URL alone. Everything else — the legal documents, the mail
    // link, Collection, the form's own controls — is left entirely alone.
    function kindOf(el) { return el.dataset.descent === 'primary' ? 'primary' : 'quiet'; }

    function routeLink(el) {
        if (!el || el.target && el.target !== '_self') return null;
        if (el.hasAttribute('download')) return null;
        var href = el.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#') return null;
        var url;
        try { url = new URL(href, location.href); } catch (e) { return null; }
        if (url.origin !== location.origin) return null;
        var slug = slugOf(url.pathname);
        if (!slug) return null;
        var node = nodeOf(slug);
        return node ? { el: el, node: node, kind: kindOf(el), slug: slug } : null;
    }

    function fragment(el) {
        if (!el || el.target && el.target !== '_self') return null;
        var href = el.getAttribute('href') || '';
        if (href.charAt(0) !== '#' || href === '#') return null;
        var node = document.getElementById(href.slice(1));
        return node ? { el: el, node: node, kind: kindOf(el), skip: el.hasAttribute('data-skip') } : null;
    }

    function hit(event) {
        var el = event.target instanceof Element ? event.target.closest('a[href]') : null;
        return routeLink(el) || fragment(el);
    }

    function plain(event) {
        return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
            || (typeof event.button === 'number' && event.button !== 0));
    }

    // The answer to the press, on the frame of the press — before the click
    // event exists, and before anything has moved.
    document.addEventListener('pointerdown', function (event) {
        var h = hit(event);
        if (h && !h.skip && plain(event)) light(h.el);
    });

    ['pointerup', 'pointercancel'].forEach(function (name) {
        document.addEventListener(name, function () {
            if (!S.raf) dim(180);          // stays lit while the page travels
        }, true);
    });

    // A modified click (new tab, new window) is the browser's: the href is
    // the clean path, and the new tab arrives through the entry below.
    document.addEventListener('click', function (event) {
        var h = hit(event);
        if (!h || event.defaultPrevented || !plain(event)) return;
        event.preventDefault();
        if (h.skip) {
            // The skip link: focus moves to the content, the view follows,
            // and the address bar is not touched — no #artists left behind.
            halt();
            window.scrollTo(0, destinationOf(h.node));
            land(h.node);
            return;
        }
        light(h.el);                        // keyboard activation has no press
        travel(h.node, h.kind, h.slug);     // a fragment link passes no slug
    });

    // ── Arriving ─────────────────────────────────────────────────────────────
    // A typed, bookmarked, shared or refreshed URL is a request to be
    // somewhere, not to watch a journey there: the landing is immediate. It
    // is made once as soon as this runs (stylesheets have loaded and every
    // image reserves its own box, so the offsets are already close), then
    // corrected after load and again when the webfonts have settled — a late
    // font reflows every paragraph above the destination. The corrections
    // stop the moment the visitor scrolls for themselves.
    var tookWheel = false;
    function wheelTaken() { tookWheel = true; }
    ['wheel', 'touchstart'].forEach(function (name) {
        window.addEventListener(name, wheelTaken, { passive: true, once: true });
    });
    window.addEventListener('keydown', function (event) {
        if (/^(Arrow|Page|Home|End| )/.test(event.key)) tookWheel = true;
    }, true);

    function placeAt(node, focus) {
        halt();
        window.scrollTo(0, destinationOf(node));
        if (focus) land(node);
    }

    // `getY` is asked again on every correction, so a destination measured
    // after the fonts have landed is measured on the final layout.
    function settle(getY, focusNode) {
        var first = getY();
        if (typeof first !== 'number') return;
        halt();
        window.scrollTo(0, first);
        if (focusNode) land(focusNode);
        function again() {
            if (tookWheel || S.raf) return;
            var y = getY();
            if (typeof y === 'number') window.scrollTo(0, y);
        }
        if (document.readyState === 'complete') window.setTimeout(again, 60);
        else window.addEventListener('load', function () { window.setTimeout(again, 60); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
    }

    // A recognised old fragment — /for-artists#terms from a bookmark or an
    // old email — is upgraded in place to its path, query string kept, and
    // answered as if the path had been asked for. Returns the slug, or null.
    function upgradeLegacy() {
        var hash = location.hash;
        if (!hash || !has(R.legacy, hash)) return null;
        var slug = R.legacy[hash];
        try { history.replaceState({ arSection: slug }, '', pathOf(slug) + location.search); }
        catch (e) { /* history blocked */ }
        return slug;
    }

    // Any other fragment that names something on the page: corrected for
    // the fixed header, as the browser's own jump would leave it underneath.
    function settleOnHash() {
        var id = location.hash.slice(1);
        if (!id) return;
        var node = document.getElementById(id);
        if (node) settle(function () { return destinationOf(node); });
    }

    function sectionY(slug) {
        return function () { var n = nodeOf(slug); return n ? destinationOf(n) : null; };
    }

    function enter() {
        var legacy = upgradeLegacy();
        var slug = legacy !== null ? legacy : slugOf(location.pathname);
        if (slug) { settle(sectionY(slug), nodeOf(slug)); return; }
        if (slug === '') {
            // The page itself. A reload or a return through history comes
            // back to where this entry was left; a fresh arrival is the top,
            // which is where the browser already is.
            var st = history.state;
            var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
            var back = nav.type === 'reload' || nav.type === 'back_forward';
            if (legacy === '' && !back) { window.scrollTo(0, 0); return; }
            if (back && st && typeof st.arY === 'number') {
                var y = st.arY;
                settle(function () { return y; });
            }
            return;
        }
        if (location.hash) settleOnHash();
    }

    // Back and Forward. Scroll restoration is manual, so each entry is put
    // back explicitly: a section entry at its section, the page entry where
    // it was left. Any descent in flight is abandoned first.
    window.addEventListener('popstate', function () {
        halt();
        unlight();
        var slug = slugOf(location.pathname);
        if (slug === null) return;
        if (slug) { var n = nodeOf(slug); if (n) placeAt(n, true); return; }
        var st = history.state;
        window.scrollTo(0, st && typeof st.arY === 'number' ? st.arY : 0);
    });

    // A fragment typed into the address bar by hand gets the same answer as
    // one arriving from outside.
    window.addEventListener('hashchange', function () {
        if (S.raf) return;
        var slug = upgradeLegacy();
        if (slug) { var n = nodeOf(slug); if (n) placeAt(n, true); return; }
        if (slug === '') { window.scrollTo(0, 0); return; }
        settleOnHash();
    });

    // A reload keeps history.state, so the entry carries where it was left.
    window.addEventListener('pagehide', remember);

    // Mark the links this file owns, so the stylesheet can answer a press on
    // one without having to guess from the href which links stay on the page
    // and which lead off it.
    function mark() {
        var links = document.querySelectorAll('a[href]');
        Array.prototype.forEach.call(links, function (el) {
            var h = routeLink(el) || fragment(el);
            if (h && !h.skip) el.classList.add('ar-descent');
        });
    }

    /* Called once by the page with its table:
         base      '/for-artists'
         sections  { slug: element id }  — the registered paths
         legacy    { '#fragment': slug } — '' for the page itself
       Every slug here needs a matching rewrite in vercel.json; a path that
       is not registered in both is an ordinary 404. */
    function routes(cfg) {
        R.base = norm(cfg.base);
        R.sections = cfg.sections || {};
        R.legacy = cfg.legacy || {};
        R.ready = true;
        try { history.scrollRestoration = 'manual'; } catch (e) { /* older browser */ }
        mark();
        enter();
    }

    window.voidDescent = { to: travel, stop: halt, mark: mark, routes: routes };
})();
