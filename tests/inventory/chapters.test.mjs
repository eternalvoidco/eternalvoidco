// The collection's three chapters in Chromium, and the stage each seal opens:
// the piece carried forward from the grid by its own geometry, the page
// receding into one blurred layer, the side compositions arriving and being
// written in by hand, the complete reverse on close, interruption from any
// point, keyboard, a phone, reduced motion and language.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const STORIES = {
    fallen: ['Ruin. Reckoning. Transformation.',
        'The old self falls apart. The Endzustand Tee marks the point of no return—an ending confronted, a new identity rising from the wreckage.'],
    sigil: ['Mystery. Elevation. Awakening.',
        'The weight falls away. The Levitate Tee captures the moment between release and becoming. Through the uncertainty, a symbol reveals a direction.'],
    eternal: ['Identity. Permanence. Legacy.',
        'An identity becomes a signature. Across the Insigne trilogy, the EV emblem gives it form—a mark to claim, carry, and leave beyond your lifetime.']
};

// language: the saved site choice, or null to leave it unset (the browser's
// own language, from `locale`, then decides). calm: the house's own reduced
// motion switch (its stored setting together with the OS preference).
async function shop(browser, stack, { viewport = DESKTOP, mobile = false, calm = false, language = 'en', locale = 'en-US' } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion: calm ? 'reduce' : 'no-preference', isMobile: mobile, hasTouch: mobile, locale });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await context.addInitScript(([lang, quiet]) => {
        localStorage.setItem('void-gate-disabled', '1');
        if (lang) localStorage.setItem('voidLanguage', lang);
        if (quiet) localStorage.setItem('void-reduce-motion', '1');
    }, [language, calm]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message));
    await page.goto(`${stack.origin}/shop`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    if (await page.locator('#voidAuth[aria-hidden="false"]').count()) await page.locator('#voidAuthClose').click();
    if (!mobile) await page.mouse.move(4, viewport.height / 2);   // well away from every seal and card
    await page.waitForFunction(() => document.querySelector('[data-stock-badge]') && document.fonts.status === 'loaded');
    return { context, page };
}

const seal = (key) => `[data-chapter="${key}"] [data-chapter-seal]`;
const phase = (page) => page.evaluate(() => window.__chapterStage.phase);
const waitPhase = (page, p, timeout = 9000) => page.waitForFunction((x) => window.__chapterStage.phase === x, p, { timeout });
const waitWritten = (page, timeout = 9000) => page.waitForFunction(() => window.__chapterStage.phase === 'open' && window.__chapterStage.written, null, { timeout });

async function toChapter(page, key) {
    await page.evaluate((k) => {
        document.querySelectorAll('.fade-in-up').forEach((el) => el.classList.add('visible'));
        const head = document.querySelector(`[data-chapter="${k}"] .collection-chapter-head`);
        window.scrollTo({ top: head.getBoundingClientRect().top + window.scrollY - 140, behavior: 'instant' });
    }, key);
    await page.waitForFunction((k) => {
        const card = document.querySelector(`[data-chapter="${k}"] .product-card`);
        const head = document.querySelector(`[data-chapter="${k}"] .collection-chapter-head`);
        return [card, head].every((el) => el.getAnimations().length === 0 && getComputedStyle(el).opacity === '1');
    }, key);
}

// Everything about the stage and the piece the tests care about, in one read.
const snap = (page, key) => page.evaluate((k) => {
    const round = (r) => r && [r.left, r.top, r.width, r.height].map((v) => Math.round(v));
    const original = document.querySelector(`[data-chapter="${k}"] .product-card.is-staged`)
        || document.querySelector(`[data-chapter="${k}"] .product-card`);
    const double = document.querySelector('.cst-card');
    const stage = document.getElementById('chapterStage');
    const visibleCards = [...document.querySelectorAll('.product-card')].filter((c) => {
        const cs = getComputedStyle(c);
        return cs.visibility !== 'hidden' && cs.opacity !== '0' && c.closest(`[data-chapter="${k}"], #chapterStage`)
            && (c === double || c === original);
    }).length;
    return {
        phase: window.__chapterStage.phase,
        expanded: document.querySelector(`[data-chapter="${k}"] [data-chapter-seal]`).getAttribute('aria-expanded'),
        stageHidden: stage.hidden,
        veil: Number(getComputedStyle(stage.querySelector('.cst-veil')).opacity),
        original: round(original.getBoundingClientRect()),
        originalHidden: getComputedStyle(original).visibility === 'hidden',
        double: double ? round(double.getBoundingClientRect()) : null,
        info: double ? Number(getComputedStyle(double.querySelector('.product-info')).opacity) : null,
        visibleCards,
        canvases: [...stage.querySelectorAll('canvas')].filter((c) => !c.hidden).length,
        writing: window.__chapterStage.writing,
        focus: document.activeElement === document.body ? 'body' : (document.activeElement.className || document.activeElement.tagName),
        scrollY: Math.round(window.scrollY)
    };
}, key);

// How much ink the writing canvases hold (alpha summed, sampled).
const ink = (page, where = '#chapterStage') => page.evaluate((w) => {
    let sum = 0;
    document.querySelectorAll(`${w} canvas`).forEach((c) => {
        if (c.hidden || !c.width) return;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 16) sum += d[i];
    });
    return sum;
}, where);

const words = (page) => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
        pieceKicker: q('.cst-col.is-piece .cst-kicker-text').textContent,
        desc: q('.cst-desc').textContent,
        details: [...document.querySelectorAll('.cst-details li')].map((li) => li.textContent),
        price: q('.cst-price').textContent,
        status: q('.cst-status').hidden ? '' : q('.cst-status').textContent,
        name: q('.cst-name').textContent,
        storyKicker: q('.cst-col.is-story .cst-kicker-text').textContent,
        title: q('.cst-title').textContent,
        theme: q('.cst-theme').textContent,
        text: q('.cst-text').textContent,
        close: q('.cst-close-label').textContent
    };
});

describe('collection chapters', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
    let stack;
    let browser;
    before(async () => {
        stack = await startStack();
        browser = await chromium.launch({ executablePath: CHROME });
    });
    after(async () => {
        await browser?.close();
        await stack?.stop();
    });

    it('groups the pieces into the three chapters, with one seal each opening the stage', async () => {
        const { context, page } = await shop(browser, stack);
        const chapters = await page.$$eval('.collection-chapter', (els) => els.map((el) => ({
            key: el.dataset.chapter,
            label: el.getAttribute('aria-labelledby').split(' ').map((id) => document.getElementById(id).textContent).join(' — '),
            preview: el.classList.contains('is-preview'),
            pieces: [...el.querySelectorAll('.product-card')].map((c) => [
                c.dataset.productName, c.querySelector('.product-price').textContent, c.dataset.unreleased === 'true'])
        })));
        assert.deepEqual(chapters, [
            { key: 'fallen', label: 'Chapter I — The Fallen', preview: false, pieces: [['Endzustand Tee', '€200', false]] },
            { key: 'sigil', label: 'Chapter II — The Sigil', preview: false, pieces: [['Levitate Tee', '€200', false]] },
            { key: 'eternal', label: 'Chapter III — The Eternal', preview: true, pieces: [
                ['Insigne Ivoire', '€250', true], ['Insigne Noir', '€250', true], ['Insigne Azure', '€250', true]] }
        ]);
        for (const key of Object.keys(STORIES)) {
            assert.deepEqual(await page.evaluate((s) => {
                const b = document.querySelector(s);
                return [b.hidden, b.getAttribute('aria-controls'), b.getAttribute('aria-haspopup'), b.getAttribute('aria-expanded')];
            }, seal(key)), [false, 'chapterStage', 'dialog', 'false'], key);
        }
        // The old description box is gone from the page.
        assert.equal(await page.locator('[data-chapter-story], .chapter-story').count(), 0);
        assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.chapter-seal-mark')).maskImage), /\/assets\/ev-emblem\.png/);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('closed: no stage, nothing staged, nothing running, page scrolling untouched', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'fallen');
        const s = await snap(page, 'fallen');
        assert.deepEqual([s.phase, s.stageHidden, s.originalHidden, s.double, s.canvases], ['closed', true, false, null, 0]);
        assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running'
            && a.effect.target.closest && a.effect.target.closest('#chapterStage')).length), 0, 'no work while closed');
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cst-hold')), false);
        // Wheel scrolling still moves the page: no listener is holding it.
        const y = s.scrollY;
        await page.mouse.wheel(0, 300);
        await page.waitForFunction((y0) => window.scrollY > y0 + 100, y);
        await context.close();
    });

    it('opens as one timeline: the seal answers, the card is carried forward, the page recedes, the words are written', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'fallen');
        const before = await snap(page, 'fallen');
        const priceColour = await page.evaluate(() => getComputedStyle(document.querySelector('[data-chapter="fallen"] .product-price')).color);
        const badge = await page.evaluate(() => {
            const b = document.querySelector('[data-chapter="fallen"] [data-stock-badge]');
            return b && !b.hidden ? b.querySelector('.stock-text').textContent.trim().toUpperCase() : '';
        });

        await page.click(seal('fallen'));
        // Immediate: the seal is lit and the double stands exactly where the
        // card stood, the original hidden — one card, no jump.
        let s = await snap(page, 'fallen');
        assert.equal(s.expanded, 'true');
        assert.equal(s.stageHidden, false);
        assert.deepEqual(s.double, before.original, 'the double starts on the card');
        assert.equal(s.originalHidden, true);
        assert.equal(s.visibleCards, 1);
        assert.equal(s.focus, 'cst-scroll', 'focus moves into the dialog');
        assert.equal(await page.evaluate(() => document.querySelector('header, nav, .nav').closest('[inert]') !== null), true, 'the page is inert');

        // Close is there from the start.
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.cst-close')).pointerEvents), 'auto', 'Close can be pressed at once');
        // …and fully arrived well inside the card's journey.
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.cst-close')).opacity) > 0.95, null, { timeout: 1200 });

        // Mid-journey: the veil is coming up and the card is between its two
        // boxes, larger than it was, its name and price leaving it.
        await page.waitForFunction(() => window.__chapterStage.time >= 950);
        s = await snap(page, 'fallen');
        assert.ok(s.veil > 0.2 && s.veil < 1, `the page recedes progressively (${s.veil})`);
        assert.ok(s.double[2] > before.original[2] && s.info < 1, `enlarging (${s.double[2]}), metadata fading (${s.info})`);

        // Landed: centred, enlarged within reason, metadata gone.
        await page.waitForFunction(() => window.__chapterStage.time >= 2100);
        s = await snap(page, 'fallen');
        const cx = s.double[0] + s.double[2] / 2;
        const mid = await page.evaluate(() => document.getElementById('chapterStage').clientWidth / 2);
        assert.ok(Math.abs(cx - mid) < 3, `centred (${cx} against ${mid})`);
        assert.ok(s.double[2] / before.original[2] > 1.2 && s.double[2] / before.original[2] < 1.8, 'a restrained enlargement');
        assert.equal(s.info, 0);
        assert.equal(s.veil, 1);
        assert.equal(s.visibleCards, 1);

        // One blur treatment: the veil is the stage's only backdrop root, and
        // nothing the foreground sits in carries a filter of its own.
        assert.deepEqual(await page.evaluate(() => {
            const roots = [...document.querySelectorAll('#chapterStage, #chapterStage *')].filter((el) => {
                const cs = getComputedStyle(el);
                return (cs.backdropFilter && cs.backdropFilter !== 'none') && el.getClientRects().length && cs.opacity !== '0';
            }).map((el) => el.className);
            let filtered = false;
            for (let n = document.querySelector('.cst-card'); n; n = n.parentElement) if (getComputedStyle(n).filter !== 'none') filtered = true;
            return { roots, filtered };
        }), { roots: ['cst-veil'], filtered: false });

        // Letters form progressively: the story's ink grows, never all at once.
        const story = '.cst-col.is-story';
        const a = await ink(page, story);
        await page.waitForTimeout(500);
        const b = await ink(page, story);
        await page.waitForTimeout(500);
        const c = await ink(page, story);
        assert.ok(a > 0 && b > a && c > b, `the ink develops (${a} → ${b} → ${c})`);

        // Settled: real, still, selectable text, the canvases gone, ~6.5s in all.
        await waitWritten(page, 9000);
        const t = await page.evaluate(() => window.__chapterStage.time);
        assert.ok(t >= 5000 && t <= 7600, `the whole reveal takes 5–7.5s (${t})`);
        // The canvases are let go one frame after the real text shows (so no
        // frame is ever without either); a slow frame must not fail this.
        await page.waitForFunction(() => [...document.querySelectorAll('#chapterStage canvas')].every((c) => c.hidden), null, { timeout: 1500 });
        s = await snap(page, 'fallen');
        assert.deepEqual([s.canvases, s.writing], [0, false]);
        const w = await words(page);
        assert.deepEqual(w, {
            pieceKicker: 'The Piece',
            desc: 'Crafted from 100% cotton, the Endzustand\u00a0Tee combines a slightly oversized silhouette with an embroidered VOID signature at the chest. Contrasting artwork on the reverse completes the design, balancing understated lettering with a distinctive graphic composition.',
            details: ['100% cotton', 'Slightly oversized fit', 'Black', 'Crew neckline', 'Embroidered VOID lettering at the chest', 'Contrasting graphic artwork on the back'],
            price: '€200', status: badge,
            name: 'ENDZUSTAND', storyKicker: 'Chapter I', title: 'The Fallen',
            theme: STORIES.fallen[0], text: STORIES.fallen[1], close: 'Close'
        });
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.cst-price')).color), priceColour, 'the card\'s own gold');
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.cst-col, .cst-name-box')].map((n) => {
            const cs = getComputedStyle(n);
            return [cs.opacity, cs.transform === 'none' || cs.transform === 'matrix(1, 0, 0, 1, 0, 0)'];
        })), [['1', true], ['1', true], ['1', true]], 'sharp and stationary');
        // Behind the veil the page's own animations are held, and the page did not move.
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cst-hold')), true);
        assert.equal(s.scrollY, before.scrollY);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('closes as the complete reverse and restores the card, its metadata, focus and scroll', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'fallen');
        const before = await snap(page, 'fallen');
        await page.click(seal('fallen'));
        await waitWritten(page);
        // Moving freely between the columns does not dismiss it.
        for (const sel of ['.cst-col.is-piece', '.cst-col.is-story', '.cst-text', '.cst-name']) await page.click(sel);
        assert.equal(await phase(page), 'open');

        await page.click('.cst-close');
        const t0 = Date.now();
        await page.waitForTimeout(600);
        let s = await snap(page, 'fallen');
        assert.equal(s.phase, 'closing');
        assert.equal(s.focus.includes('chapter-seal'), true, 'focus returns to the seal at once');
        assert.ok(await page.evaluate(() => Number(getComputedStyle(document.querySelector('.cst-col.is-story')).opacity)) < 0.95, 'the text fades first');
        await page.waitForTimeout(700);
        s = await snap(page, 'fallen');
        assert.ok(s.double[2] < 420 && s.veil < 1, `on its way home (${s.double[2]}, veil ${s.veil})`);
        await waitPhase(page, 'closed', 3000);
        const took = Date.now() - t0;
        assert.ok(took >= 1700 && took <= 2700, `~1.8–2.4s (${took})`);
        s = await snap(page, 'fallen');
        assert.deepEqual([s.stageHidden, s.originalHidden, s.double, s.expanded, s.scrollY], [true, false, null, 'false', before.scrollY]);
        assert.deepEqual(s.original, before.original, 'the card is exactly where it was');
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-chapter="fallen"] .product-info')).opacity), '1');
        assert.equal(await page.evaluate(() => document.querySelector('[inert]') === null || !document.querySelector('header, nav, .nav').closest('[inert]')), true);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cst-hold')), false);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('turns round from any point: no restarts, no jumps, nothing left behind', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'fallen');
        const before = await snap(page, 'fallen');

        // Closed during the card's journey: it goes straight home.
        await page.click(seal('fallen'));
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await waitPhase(page, 'closed', 3000);
        assert.deepEqual((await snap(page, 'fallen')).original, before.original);

        // Closed mid-writing and reopened mid-exit: the same timeline resumes.
        await page.keyboard.press('Enter');                  // focus is on the seal
        await page.waitForTimeout(2400);
        const durations = await page.evaluate(() => window.__chapterStage.durations);
        const heldAt = await page.evaluate(() => window.__chapterStage.time);
        const inkBefore = await ink(page);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        assert.equal(await phase(page), 'closing');
        assert.ok(Math.abs(await page.evaluate(() => window.__chapterStage.time) - heldAt) < 120, 'the clock is held');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(60);
        assert.equal(await phase(page), 'opening');
        assert.ok(await ink(page) >= inkBefore * 0.95, 'the written letters are still there');
        assert.deepEqual(await page.evaluate(() => window.__chapterStage.durations), durations, 'nothing was re-measured or restarted');
        await waitWritten(page, 9000);
        assert.equal((await snap(page, 'fallen')).visibleCards, 1);

        // Rapid toggling, then a clean finish.
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(120);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(120);
        }
        await page.keyboard.press('Escape');
        await waitPhase(page, 'closed', 3500);
        const s = await snap(page, 'fallen');
        assert.deepEqual([s.double, s.originalHidden, s.original, await page.locator('.cst-card, .product-card.is-staged').count()],
            [null, false, before.original, 0]);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('answers the keyboard, keeps focus in the dialog and the page still', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'eternal');
        const y = (await snap(page, 'eternal')).scrollY;
        await page.focus(seal('eternal'));
        await page.keyboard.press('Space');
        await waitPhase(page, 'opening', 1000);
        const order = [];
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('Tab');
            order.push(await page.evaluate(() => document.activeElement.className));
        }
        assert.deepEqual(order, ['cst-step is-prev', 'cst-step is-next', 'cst-close', 'cst-step is-prev']);
        await page.mouse.wheel(0, 600);
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(200);
        assert.equal((await snap(page, 'eternal')).scrollY, y, 'the page beneath never moves');

        // Another piece of the same chapter: the facts and name are bound to it.
        await waitWritten(page);
        assert.equal((await words(page)).name, 'INSIGNE IVOIRE');
        await page.focus('.cst-step.is-next');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2200);
        const w = await words(page);
        assert.deepEqual([w.name, w.price, w.title, w.theme], ['INSIGNE NOIR', '€250', 'The Eternal', STORIES.eternal[0]]);
        assert.equal(await page.evaluate(() => document.querySelector('[data-chapter="eternal"] .product-card.is-staged').dataset.productName), 'Insigne Noir');
        const noir = await page.evaluate(() => {
            const c = document.querySelector('[data-chapter="eternal"] [data-product-name="Insigne Noir"]').getBoundingClientRect();
            return [c.left, c.top, c.width, c.height].map(Math.round);
        });
        await page.keyboard.press('Escape');
        await waitPhase(page, 'closed', 3500);
        assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chapter="eternal"] [data-chapter-seal]')), true, 'focus back on the trigger');
        assert.equal(await page.locator('.product-card.is-staged, .cst-card').count(), 0);
        assert.deepEqual(await page.evaluate(() => {
            const c = document.querySelector('[data-chapter="eternal"] [data-product-name="Insigne Noir"]').getBoundingClientRect();
            return [c.left, c.top, c.width, c.height].map(Math.round);
        }), noir);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('on a phone: a tap opens a stacked, scrolling stage; the page never moves; long German fits', async () => {
        const { context, page } = await shop(browser, stack, { viewport: PHONE, mobile: true, language: 'de' });
        await toChapter(page, 'fallen');
        const before = await snap(page, 'fallen');
        await page.locator(seal('fallen')).tap();
        await waitWritten(page, 9500);
        const layout = await page.evaluate(() => {
            const r = (s) => document.querySelector(s).getBoundingClientRect();
            const sc = document.querySelector('.cst-scroll');
            return {
                order: [r('.cst-slot').top < r('.cst-col.is-piece').top, r('.cst-col.is-piece').top < r('.cst-col.is-story').top],
                sideways: sc.scrollWidth - sc.clientWidth + document.documentElement.scrollWidth - innerWidth,
                scrolls: sc.scrollHeight > sc.clientHeight
            };
        });
        assert.deepEqual(layout, { order: [true, true], sideways: 0, scrolls: true });
        const w = await words(page);
        assert.equal(w.theme, 'Untergang. Abrechnung. Verwandlung.');
        assert.deepEqual(w.details.slice(0, 3), ['100 % Baumwolle', 'Leicht oversized geschnitten', 'Schwarz']);
        assert.match(w.desc, /gestickten VOID-Signatur/);
        assert.equal(w.close, 'Schließen');
        await page.evaluate(() => document.querySelector('.cst-scroll').scrollTo(0, 99999));
        assert.equal((await snap(page, 'fallen')).scrollY, before.scrollY);
        await page.locator('.cst-close').tap();
        await waitPhase(page, 'closed', 3500);
        const s = await snap(page, 'fallen');
        assert.deepEqual([s.original, s.scrollY, s.originalHidden], [before.original, before.scrollY, false]);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('under the house\'s reduced motion it is a short crossfade: nothing travels, nothing is written', async () => {
        const { context, page } = await shop(browser, stack, { calm: true });
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('reduce-motion')), true);
        await toChapter(page, 'fallen');
        const before = await snap(page, 'fallen');
        await page.click(seal('fallen'));
        let s = await snap(page, 'fallen');
        assert.notDeepEqual(s.double, before.original, 'the card is already in its place');
        assert.deepEqual([s.writing, s.canvases], [false, 0]);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.cst-veil')).opacity === '1', null, { timeout: 1500 });
        s = await snap(page, 'fallen');
        assert.deepEqual([s.phase, s.veil, s.info], ['open', 1, 0]);
        assert.equal((await words(page)).text, STORIES.fallen[1]);
        await page.keyboard.press('Escape');
        await waitPhase(page, 'closed', 800);
        s = await snap(page, 'fallen');
        assert.deepEqual([s.original, s.originalHidden], [before.original, false]);
        await context.close();
    });

    it('keeps the Insigne facts visible after each switch, rapid switching and reopening', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'eternal');
        await page.click(seal('eternal'));
        await waitWritten(page);

        const settledFacts = async (name) => {
            await page.waitForFunction((expected) => document.querySelector('.cst-name').textContent === expected, name);
            await waitWritten(page);
            // Wait for the real text to take over, rather than accepting the
            // canvas that temporarily paints above a stuck opacity:0 fade.
            await page.waitForFunction(() => [...document.querySelectorAll('.cst-col.is-piece canvas, .cst-name-box canvas')].every((c) => c.hidden));
            // The description and details arrive on a short stagger; once it has
            // run, every line of the panel must actually be painted.
            const painted = () => {
                const visible = (n) => {
                    if (!n || n.hidden || !n.getClientRects().length) return false;
                    for (let p = n; p; p = p.parentElement) {
                        const cs = getComputedStyle(p);
                        if (Number(cs.opacity) < 0.99 || cs.visibility === 'hidden' || cs.display === 'none') return false;
                    }
                    return true;
                };
                return ['.cst-desc', '.cst-details li:first-child', '.cst-details li:last-child', '.cst-price', '.cst-status', '.cst-name']
                    .map((s) => visible(document.querySelector(s)));
            };
            await page.waitForFunction((fn) => new Function(`return (${fn})()`)().every(Boolean), painted.toString(), { timeout: 4000 })
                .catch(() => {});
            assert.deepEqual(await page.evaluate((fn) => new Function(`return (${fn})()`)(), painted.toString()),
                [true, true, true, true, true, true], `${name}: settled text is actually painted`);
            // The details always belong to the piece on show.
            const colour = name.replace('INSIGNE ', '');
            const w = await words(page);
            assert.deepEqual([w.details[1], w.details[2]], ['Regular fit', colour[0] + colour.slice(1).toLowerCase()], name);
        };

        await settledFacts('INSIGNE IVOIRE');
        for (const name of ['INSIGNE NOIR', 'INSIGNE AZURE', 'INSIGNE IVOIRE']) {
            await page.click('.cst-step.is-next');
            await settledFacts(name);
        }
        await page.evaluate(() => {
            document.querySelector('.cst-step.is-next').click();
            document.querySelector('.cst-step.is-next').click();
            document.querySelector('.cst-step.is-prev').click();
        });
        await settledFacts('INSIGNE NOIR');
        assert.equal(await page.locator('.cst-details li:nth-child(2)').textContent(), 'Regular fit');
        assert.equal(await page.locator('.cst-details li:nth-child(3)').textContent(), 'Noir');
        assert.equal(await page.locator('.cst-price').textContent(), '€250');
        await page.click('.cst-close');
        await waitPhase(page, 'closed', 3500);
        await page.click(seal('eternal'));
        await settledFacts('INSIGNE IVOIRE');
        await page.keyboard.press('Escape');
        await waitPhase(page, 'closed', 3500);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('lets sign-in own pointer and keyboard input above a chapter, then restores the chapter', async () => {
        for (const mobile of [false, true]) {
            const { context, page } = await shop(browser, stack, { viewport: mobile ? PHONE : DESKTOP, mobile });
            await toChapter(page, 'fallen');
            const before = await snap(page, 'fallen');
            await page.click(seal('fallen'));
            await page.evaluate(() => window.voidAuthOpen());
            await page.waitForFunction(() => document.activeElement === document.getElementById('voidAuthEmail'));
            assert.equal(await page.locator('#voidAuth').evaluate((n) => !!n.closest('[inert]')), false);
            assert.equal(await page.locator('#chapterStage').evaluate((n) => n.inert), true);
            assert.equal(await page.getAttribute('#chapterStage', 'aria-modal'), 'false');

            await page.click('#voidAuthEmail');
            await page.fill('#voidAuthEmail', 'guest@example.com');
            await page.fill('#voidAuthPass', 'example-password');
            await page.click('#voidAuthEye');
            assert.equal(await page.getAttribute('#voidAuthPass', 'type'), 'text');

            // Tab and Shift+Tab wrap in the visible sign-in dialog, never in
            // the stage underneath it.
            await page.locator('#voidAuthModeToggle').focus();
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'voidAuthClose');
            await page.keyboard.press('Shift+Tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'voidAuthModeToggle');

            await page.click('#voidAuthClose');
            assert.equal(await page.getAttribute('#voidAuth', 'aria-hidden'), 'true');
            assert.equal(await page.locator('#chapterStage').evaluate((n) => n.inert), false);
            assert.equal(await page.evaluate(() => document.getElementById('chapterStage').contains(document.activeElement)), true);
            assert.notEqual(await phase(page), 'closing');

            await page.evaluate(() => window.voidAuthOpen());
            await page.waitForFunction(() => document.activeElement === document.getElementById('voidAuthEmail'));
            await page.keyboard.press('Escape');
            assert.equal(await page.getAttribute('#voidAuth', 'aria-hidden'), 'true');
            assert.notEqual(await phase(page), 'closing', 'Escape dismisses only the foreground dialog');
            await page.keyboard.press('Escape');
            await waitPhase(page, 'closed', 3500);
            const after = await snap(page, 'fallen');
            assert.deepEqual([after.original, after.scrollY, after.originalHidden], [before.original, before.scrollY, false]);
            assert.deepEqual(page.errors, []);
            await context.close();
        }
    });

    it('describes every piece in every language with only the confirmed facts', async () => {
        const EMBROIDERED = { en: /Embroidered/, fr: /brodé/, it: /ricamat/, de: /Gestickt/ };
        const FIT = {
            en: { loose: 'Slightly oversized fit', regular: 'Regular fit' },
            fr: { loose: 'Coupe légèrement oversize', regular: 'Coupe classique' },
            it: { loose: 'Vestibilità leggermente oversize', regular: 'Vestibilità regolare' },
            de: { loose: 'Leicht oversized geschnitten', regular: 'Reguläre Passform' }
        };
        const COLOUR = {
            en: ['Black', 'White', 'Ivoire', 'Noir', 'Azure'],
            fr: ['Noir', 'Blanc', 'Ivoire', 'Noir', 'Azur'],
            it: ['Nero', 'Bianco', 'Avorio', 'Nero', 'Azzurro'],
            de: ['Schwarz', 'Weiß', 'Elfenbein', 'Schwarz', 'Azurblau']
        };
        for (const language of ['en', 'fr', 'it', 'de']) {
            // The house's reduced motion opens the stage at once, so all five
            // pieces can be read quickly; it also proves the copy is shown there.
            const { context, page } = await shop(browser, stack, { language, calm: true });
            const seen = [];
            for (const key of ['fallen', 'sigil', 'eternal']) {
                await toChapter(page, key);
                await page.click(seal(key));
                await waitPhase(page, 'open', 2000);
                for (let i = 0; i < (key === 'eternal' ? 3 : 1); i++) {
                    if (i) {
                        await page.click('.cst-step.is-next');
                        await page.waitForFunction((n) => window.__chapterStage.index === n, i);
                        await page.waitForTimeout(500);
                    }
                    const w = await words(page);
                    const shown = await page.evaluate(() => ['.cst-desc', '.cst-details'].map((s) => getComputedStyle(document.querySelector(s)).opacity));
                    assert.deepEqual(shown, ['1', '1'], `${language} ${w.name}: shown under reduced motion`);
                    seen.push(w);
                }
                await page.keyboard.press('Escape');
                await waitPhase(page, 'closed', 2000);
            }
            assert.deepEqual(seen.map((w) => w.name), ['ENDZUSTAND', 'LEVITATE', 'INSIGNE IVOIRE', 'INSIGNE NOIR', 'INSIGNE AZURE']);
            seen.forEach((w, i) => {
                const insigne = i >= 2;
                const label = `${language} ${w.name}`;
                assert.equal(w.details.length, 6, label);
                assert.match(w.details[0], /^100\s?%/, `${label}: 100% cotton`);
                assert.equal(w.details[1], FIT[language][insigne ? 'regular' : 'loose'], `${label}: fit`);
                assert.equal(w.details[2], COLOUR[language][i], `${label}: only the selected colour`);
                assert.match(w.details[4], EMBROIDERED[language], `${label}: the lettering is embroidered`);
                assert.doesNotMatch(w.details[5], EMBROIDERED[language], `${label}: the artwork or motif is not called embroidered`);
                assert.match(w.desc, new RegExp(EMBROIDERED[language].source, 'i'), `${label}: description names the embroidery`);
                const all = [w.desc, ...w.details].join(' ');
                assert.doesNotMatch(all, /GSM|ritual|rituel|Ritual|\[|\]/, `${label}: no unconfirmed specification or placeholder`);
                if (insigne) assert.doesNotMatch(all, /oversize/i, `${label}: Insigne is never oversized`);
                // Natural French and Italian: "le t-shirt Endzustand", "la T-shirt Insigne",
                // never an article set straight before the product name.
                if (language === 'fr') assert.match(w.desc, /le t-shirt (Endzustand|Levitate|Insigne)/, label);
                if (language === 'it') assert.match(w.desc, /la T-shirt (Endzustand|Levitate|Insigne)/, label);
                assert.doesNotMatch(w.desc, /\b(le|la|Le|La) (Endzustand|Levitate|Insigne)\b/, `${label}: no article before the bare name`);
            });
            assert.deepEqual(page.errors, []);
            await context.close();
        }
    });

    it('states the confirmed fit in the size popup and the product view, in every language', async () => {
        const FIT = {
            en: ['Slightly oversized fit', 'Regular fit'],
            fr: ['Coupe légèrement oversize', 'Coupe classique'],
            it: ['Vestibilità leggermente oversize', 'Vestibilità regolare'],
            de: ['Leicht oversized geschnitten', 'Reguläre Passform']
        };
        const OPENING = {
            en: ['A 100% cotton tee with a slightly oversized fit', 'A 100% cotton tee with a regular fit.'],
            fr: ['Un t-shirt en 100 % coton à la coupe légèrement oversize', 'Un t-shirt en 100 % coton à la coupe classique.'],
            it: ['Una T-shirt in 100% cotone dalla vestibilità leggermente oversize', 'Una T-shirt in 100% cotone dalla vestibilità regolare.'],
            de: ['Ein T-Shirt aus 100 % Baumwolle in leicht oversized Passform', 'Ein T-Shirt aus 100 % Baumwolle in regulärer Passform.']
        };
        const PIECES = ['Endzustand Tee', 'Levitate Tee', 'Insigne Ivoire', 'Insigne Noir', 'Insigne Azure'];
        for (const language of ['en', 'fr', 'it', 'de']) {
            const { context, page } = await shop(browser, stack, { language });
            for (const name of PIECES) {
                const regular = name.startsWith('Insigne') ? 1 : 0;
                const seen = await page.evaluate((n) => {
                    const card = document.querySelector(`.collection-chapter [data-product-name="${n}"]`);
                    openSizePopup(card, null);
                    updateSizePopupFit(card, 'M');
                    const popup = [document.getElementById('sizePopupFitTitle').textContent, document.getElementById('sizePopupFitNote').textContent];
                    closeSizePopup();
                    openProductDetail(card);
                    const view = document.getElementById('pdDesc').textContent;
                    closeProductDetail();
                    return { popup, view, data: [card.dataset.fit, card.dataset.fitTitle, card.dataset.fitNote] };
                }, name);
                const label = `${language} ${name}`;
                assert.deepEqual(seen.data, [regular ? 'regular' : 'slightly-oversized', undefined, undefined], `${label}: one fit key on the card`);
                assert.equal(seen.popup[0], FIT[language][regular], `${label}: popup title`);
                assert.ok(seen.view.startsWith(OPENING[language][regular]), `${label}: product view opens with the fit (${seen.view.slice(0, 60)})`);
                const all = `${seen.popup.join(' ')} ${seen.view}`;
                assert.doesNotMatch(all, /ritual|rituel|rituale|rituell|relaxed oversized|oversize détendue|oversize rilassato|entspannter, oversized|boxy|boxiges/i, `${label}: no old fit wording`);
                if (regular) assert.doesNotMatch(all, /oversize/i, `${label}: Insigne is never oversized`);
                await page.waitForTimeout(200);
            }
            assert.deepEqual(page.errors, []);
            await context.close();
        }
    });

    it('fits Chapter III\'s card, name and arrows on a 1280×720 screen without shrinking the copy', async () => {
        const { context, page } = await shop(browser, stack, { viewport: { width: 1280, height: 720 } });
        for (const key of ['fallen', 'eternal']) {
            await toChapter(page, key);
            await page.click(seal(key));
            await waitWritten(page);
            const m = await page.evaluate(() => {
                const sc = document.querySelector('.cst-scroll');
                const nav = document.querySelector('.cst-pieces');
                const last = (nav.hidden ? document.querySelector('.cst-name-box') : nav).getBoundingClientRect();
                return {
                    overflow: sc.scrollHeight - sc.clientHeight,
                    centreBottom: last.bottom,
                    height: innerHeight,
                    desc: parseFloat(getComputedStyle(document.querySelector('.cst-desc')).fontSize),
                    detail: parseFloat(getComputedStyle(document.querySelector('.cst-details li')).fontSize)
                };
            });
            assert.ok(m.overflow <= 0, `${key}: no scroll needed (${m.overflow}px)`);
            assert.ok(m.centreBottom < m.height - 40, `${key}: the arrows sit clear of the edge (${m.centreBottom})`);
            assert.ok(m.desc >= 14 && m.detail >= 13, `${key}: body copy kept readable (${m.desc}/${m.detail})`);
            await page.keyboard.press('Escape');
            await waitPhase(page, 'closed', 3500);
        }
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('speaks the visitor\'s language, and follows a change of it', async () => {
        let { context, page } = await shop(browser, stack, { language: 'fr' });
        await toChapter(page, 'sigil');
        assert.equal(await page.getAttribute(seal('sigil'), 'aria-label'), 'Lire le chapitre: The Sigil');
        await page.click(seal('sigil'));
        await waitWritten(page);
        let w = await words(page);
        assert.deepEqual([w.pieceKicker, w.details, w.name, w.theme, w.close], ['La pièce',
            ['100 % coton', 'Coupe légèrement oversize', 'Blanc', 'Col rond', 'Lettrage VOID brodé sur la poitrine', 'Figure contrastée au dos'],
            'LEVITATE', 'Mystère. Élévation. Éveil.', 'Fermer']);
        assert.match(w.desc, /^Confectionné en 100 % coton, le t-shirt Levitate présente/);
        assert.match(w.text, /^Le poids se dissipe\. Le Levitate Tee/);
        await page.keyboard.press('Escape');
        await waitPhase(page, 'closed', 3500);
        await context.close();

        ({ context, page } = await shop(browser, stack, { language: null, locale: 'it-IT' }));
        await toChapter(page, 'fallen');
        await page.click(seal('fallen'));
        await page.waitForTimeout(1800);
        // A language change mid-writing: the new words, complete, at once.
        await page.evaluate(() => { setLanguageValue('de'); });
        await page.waitForFunction(() => /^Untergang/.test(document.querySelector('.cst-theme').textContent));
        await page.waitForTimeout(100);
        w = await words(page);
        assert.deepEqual([w.pieceKicker, w.details[1]], ['Das Stück', 'Leicht oversized geschnitten']);
        await page.waitForFunction(() => [...document.querySelectorAll('#chapterStage canvas')].every((c) => c.hidden), null, { timeout: 1500 });
        assert.deepEqual(page.errors, []);
        await context.close();
    });
});
