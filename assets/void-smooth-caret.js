/* ============================================================
   VOID© — Smooth caret
   The house's typing mark. The browser's own caret is hidden while a
   field is focused and replaced by a single gold bar that springs
   between positions instead of jumping, so moving through a line reads
   as one continuous motion.

   How the position is found: a hidden span is given the focused field's
   exact font metrics, then the text before the caret is written into it
   and measured. For a password field the masked bullet is repeated
   instead, since the real characters are never rendered.

   One caret exists for the whole document — only one field can hold
   focus — and it is fixed to the viewport rather than wrapped around
   each input. Nothing in the markup is restructured: labels, validation,
   autofill, password managers and every existing selector are untouched,
   and with this script absent the native caret simply returns.
   ============================================================ */
(function voidSmoothCaret() {
    'use strict';

    // selectionStart is only defined for these types; measured in-browser,
    // email and number both return null. A field whose caret index cannot be
    // read would get a mark that sits still while the cursor moves, so those
    // two keep the browser's own caret. This is a platform limit, not taste.
    var SUPPORTED = ['text', 'search', 'url', 'tel', 'password'];

    // Firefox masks with a heavier bullet than the rest.
    var MASK_CHAR = /firefox|fxios/i.test(navigator.userAgent) ? '●' : '•';

    // Matches the reference's feel: quick to leave, settled on arrival.
    var STIFFNESS = 500;
    var DAMPING = 30;
    var MASS = 0.5;

    var caret = null;
    var measure = null;
    var host = null;          // the field currently wearing the caret
    var x = 0, targetX = 0, vel = 0;
    var frame = null, lastT = 0;

    function reduced() {
        if (document.documentElement.classList.contains('reduce-motion')) return true;
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function eligible(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        if (el.disabled || el.readOnly) return false;
        if (el.hasAttribute('data-no-smooth-caret')) return false;
        return SUPPORTED.indexOf((el.type || 'text').toLowerCase()) !== -1;
    }

    function build() {
        if (caret) return;
        caret = document.createElement('div');
        caret.className = 'void-caret';
        caret.setAttribute('aria-hidden', 'true');
        measure = document.createElement('span');
        measure.className = 'void-caret-measure';
        measure.setAttribute('aria-hidden', 'true');
        document.body.appendChild(caret);
        document.body.appendChild(measure);
    }

    /* Copy the field's metrics onto the ruler. Anything that changes glyph
       advance has to come across or the measurement drifts. */
    function syncMeasure(input) {
        var s = window.getComputedStyle(input);
        var size = s.fontSize;
        // Outside Chrome the bullet is set larger than the surrounding text.
        if (MASK_CHAR === '•' && input.type === 'password'
            && !/chrome|chromium|crios/i.test(navigator.userAgent)) {
            size = (parseFloat(size) + 6.25) + 'px';
        }
        measure.style.font = s.fontStyle + ' ' + s.fontWeight + ' ' + size + ' ' + s.fontFamily;
        measure.style.letterSpacing = s.letterSpacing;
        measure.style.fontFeatureSettings = s.fontFeatureSettings;
        measure.style.fontVariationSettings = s.fontVariationSettings;
        measure.style.textTransform = s.textTransform;
    }

    function caretIndex(input) {
        var start, end;
        try {
            start = input.selectionStart;
            end = input.selectionEnd;
        } catch (e) {
            return null;
        }
        if (start === null || end === null) return null;
        if (start === end) return start;
        return input.selectionDirection === 'backward' ? start : end;
    }

    function hide() {
        if (caret) caret.style.opacity = '0';
    }

    function update(instant) {
        if (!host || !caret) return;
        var index = caretIndex(host);
        if (index === null) { hide(); return; }

        var s = window.getComputedStyle(host);
        var padL = parseFloat(s.paddingLeft) || 0;
        var padR = parseFloat(s.paddingRight) || 0;
        var borderL = parseFloat(s.borderLeftWidth) || 0;

        syncMeasure(host);
        var before = host.type === 'password'
            ? new Array(index + 1).join(MASK_CHAR)
            : host.value.slice(0, index);
        measure.textContent = before;
        var width = before.length ? measure.offsetWidth + padL : padL - 1;

        // Keep the caret inside the field when the text runs past the edge,
        // mirroring what the browser would have done for its own caret.
        var maxScroll = Math.max(0, host.scrollWidth - host.clientWidth);
        var visibleRight = host.scrollLeft + host.clientWidth - padR;
        var visibleLeft = host.scrollLeft + padL;
        if (width > visibleRight) {
            host.scrollLeft = Math.min(width - host.clientWidth + padR, maxScroll);
        } else if (width < visibleLeft) {
            host.scrollLeft = Math.max(0, width - padL);
        }

        var rect = host.getBoundingClientRect();
        var local = width - host.scrollLeft;
        var minX = padL - 1;
        var maxX = host.clientWidth - padR;
        var start, end;
        try { start = host.selectionStart; end = host.selectionEnd; } catch (e) { start = end = index; }
        var selecting = start !== end;
        var offscreen = local < minX || local > maxX + 1;

        if (selecting || offscreen || document.activeElement !== host) { hide(); return; }

        // Right-to-left fields grow from the other edge; measuring a prefix
        // from the left would put the mark on the wrong side.
        if (s.direction === 'rtl') { hide(); return; }

        targetX = rect.left + borderL + Math.min(local, maxX);
        var fontSize = parseFloat(s.fontSize) || 16;
        caret.style.top = (rect.top + (rect.height - fontSize * 0.9) / 2) + 'px';
        caret.style.height = (fontSize * 0.9) + 'px';
        caret.style.opacity = '1';

        if (instant || reduced()) {
            x = targetX; vel = 0;
            caret.style.transform = 'translate3d(' + x + 'px, 0, 0)';
            return;
        }
        run();
    }

    function step(now) {
        var dt = Math.min((now - lastT) / 1000, 0.064);
        lastT = now;
        var a = (-STIFFNESS * (x - targetX) - DAMPING * vel) / MASS;
        vel += a * dt;
        x += vel * dt;
        caret.style.transform = 'translate3d(' + x + 'px, 0, 0)';
        // Stop once the remainder is sub-pixel and slow, then snap. Chasing
        // 0.1px/s kept the loop alive for a third of a second after the mark
        // had visibly arrived, for motion no one can see.
        if (Math.abs(targetX - x) < 0.15 && Math.abs(vel) < 4) {
            x = targetX;
            caret.style.transform = 'translate3d(' + x + 'px, 0, 0)';
            frame = null;
            return;
        }
        frame = window.requestAnimationFrame(step);
    }

    function run() {
        if (frame) return;
        lastT = window.performance ? performance.now() : Date.now();
        frame = window.requestAnimationFrame(step);
    }

    function attach(input) {
        build();
        if (host === input) return;
        detach();
        host = input;
        host.classList.add('void-caret-host');
        host.addEventListener('scroll', onScroll, { passive: true });
        // First appearance lands without a glide; there is nowhere to travel from.
        update(true);
    }

    function detach() {
        if (frame) { window.cancelAnimationFrame(frame); frame = null; }
        if (host) {
            host.classList.remove('void-caret-host');
            host.removeEventListener('scroll', onScroll);
        }
        host = null;
        hide();
    }

    function onScroll() { update(); }

    document.addEventListener('focusin', function (e) {
        if (eligible(e.target)) attach(e.target);
        else detach();
    });

    document.addEventListener('focusout', function (e) {
        if (e.target === host) detach();
    });

    // `input` covers typing and paste; `change` catches autofill that lands
    // without one. Both are passive listeners on the document, so no field
    // needs its own handler and nothing already bound is disturbed.
    document.addEventListener('input', function (e) {
        if (e.target === host) update();
    }, true);

    document.addEventListener('change', function (e) {
        if (e.target === host) update(true);
    }, true);

    document.addEventListener('selectionchange', function () {
        if (!host || document.activeElement !== host) return;
        window.requestAnimationFrame(function () {
            if (host && document.activeElement === host) update();
        });
    });

    // The field can move without the caret index changing: a drawer opens, a
    // modal settles, the keyboard resizes the viewport, a webfont swaps in.
    window.addEventListener('resize', function () { update(true); }, { passive: true });
    window.addEventListener('scroll', function () { update(true); }, { passive: true, capture: true });
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { update(true); });
    }
})();
