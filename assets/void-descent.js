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

    // Arrival. The URL is made to say where we are, as a real anchor would,
    // and the destination takes focus so the keyboard and a screen reader
    // follow the page. The section takes it, never a field: on a phone,
    // focusing an input here would raise the keyboard before the visitor has
    // asked for it, and the form is to be read before it is filled in.
    /* The hash is pushed before the page moves, not after it arrives.
       Chrome records a history entry's scroll position at the moment the
       entry is superseded — so a hash pushed on arrival makes the departure
       entry remember the destination, and Back does nothing at all. Pushed
       at the press, while the page is still where the visitor pressed from,
       the browser's own restoration returns them there. It is also what a
       real anchor does: the URL names where you asked to go, from the
       moment you ask. */
    function announce(el) {
        if (!el.id || location.hash === '#' + el.id) return;
        try { history.pushState(null, '', '#' + el.id); }
        catch (e) { /* history blocked; the scroll still happens */ }
    }

    function land(el) {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        try { el.focus({ preventScroll: true }); } catch (e) { /* older browser */ }
    }

    function travel(el, kind) {
        var p = PROFILE[kind] || PROFILE.quiet;
        var from = window.scrollY || window.pageYOffset;
        var to = destinationOf(el);
        var gap = Math.abs(to - from);

        // Already on the way to this exact place: a second press must not
        // restart the journey or re-ease what is already decelerating.
        if (S.raf && S.el === el && Math.abs(S.to - to) < 2) return;

        announce(el);

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
    // Only same-document fragments, and only ones that resolve to something
    // on this page. Everything else — the legal documents, the mail link,
    // Collection, the form's own controls — is left entirely alone.
    function fragment(el) {
        if (!el || el.target && el.target !== '_self') return null;
        var href = el.getAttribute('href') || '';
        if (href.charAt(0) !== '#' || href === '#') return null;
        var id = href.slice(1);
        var node = document.getElementById(id);
        return node ? { el: el, node: node, kind: el.dataset.descent === 'primary' ? 'primary' : 'quiet' } : null;
    }

    function hit(event) {
        var el = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
        return fragment(el);
    }

    function plain(event) {
        return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
            || (typeof event.button === 'number' && event.button !== 0));
    }

    // The answer to the press, on the frame of the press — before the click
    // event exists, and before anything has moved.
    document.addEventListener('pointerdown', function (event) {
        var h = hit(event);
        if (h && plain(event)) light(h.el);
    });

    ['pointerup', 'pointercancel'].forEach(function (name) {
        document.addEventListener(name, function () {
            if (!S.raf) dim(180);          // stays lit while the page travels
        }, true);
    });

    document.addEventListener('click', function (event) {
        var h = hit(event);
        if (!h || event.defaultPrevented || !plain(event)) return;
        event.preventDefault();
        light(h.el);                        // keyboard activation has no press
        travel(h.node, h.kind);
    });

    // ── Arriving on a fragment ───────────────────────────────────────────────
    // A typed, bookmarked or shared URL is a request to be somewhere, not to
    // watch a journey there: the correction is immediate. Without it the
    // browser leaves the heading underneath the fixed header. The same is
    // true of a hash the visitor edits by hand, and of back and forward,
    // where the page has already been seen.
    function settleOnHash(animate) {
        var id = location.hash.slice(1);
        if (!id) return;
        var node = document.getElementById(id);
        if (!node) return;
        if (animate && !calm()) { travel(node, 'quiet'); return; }
        halt();
        window.scrollTo(0, destinationOf(node));
    }

    window.addEventListener('hashchange', function () {
        // A hash we set ourselves on landing must not bounce the page again.
        if (S.raf) return;
        settleOnHash(false);
    });

    window.addEventListener('popstate', function () {
        // Any descent in flight is abandoned; where the page goes next is
        // the browser's to decide, and for a fragment entry it restores the
        // scroll it recorded. Only a hash it cannot place is corrected here.
        halt();
        if (location.hash) settleOnHash(false);
    });

    if (location.hash) {
        // After layout, and after the fonts have settled the line boxes —
        // the offset is only right once the document has stopped growing.
        window.addEventListener('load', function () {
            window.setTimeout(function () { settleOnHash(false); }, 60);
        });
        // A webfont landing late reflows every paragraph on the page, which
        // on a narrow screen moves a destination near the bottom by
        // thousands of pixels. Settle again once the text has stopped
        // changing shape.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () { settleOnHash(false); });
        }
        settleOnHash(false);
    }

    // Mark the links this file owns, so the stylesheet can answer a press on
    // one without having to guess from the href which anchors are in-page and
    // which lead off it. A fragment that resolves to nothing is left plain —
    // it will behave as the browser's own anchor and should not look as
    // though something is going to happen.
    function mark() {
        var links = document.querySelectorAll('a[href^="#"]');
        Array.prototype.forEach.call(links, function (el) {
            if (fragment(el)) el.classList.add('ar-descent');
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark);
    else mark();

    window.voidDescent = { to: travel, stop: halt, mark: mark };
})();
