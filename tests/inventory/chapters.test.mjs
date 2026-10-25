// The collection's three chapters in Chromium, and the story each seal opens:
// the cinematic sequence (anticipation, unfolding, light, letters written in,
// a settled passage), the exit (a fade at full height, then the collapse),
// the 0.7s hover grace, restoring on return, closing mid-writing, keyboard,
// touch, long translations, reduced motion and language — with the pieces
// underneath fully visible and usable in every state.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const KEYS = ['fallen', 'sigil', 'eternal'];

const STORIES = {
    fallen: ['Ruin. Reckoning. Transformation.',
        'The old self falls apart. The Endzustand Tee marks the point of no return—an ending confronted, a new identity rising from the wreckage.'],
    sigil: ['Mystery. Elevation. Awakening.',
        'The weight falls away. The Levitate Tee captures the moment between release and becoming. Through the uncertainty, a symbol reveals a direction.'],
    eternal: ['Identity. Permanence. Legacy.',
        'An identity becomes a signature. Across the Insigne trilogy, the EV emblem gives it form—a mark to claim, carry, and leave beyond your lifetime.']
};

// language: the saved site choice, or null to leave it unset (the browser's
// own language, from `locale`, then decides).
async function shop(browser, stack, { viewport = DESKTOP, mobile = false, reducedMotion = 'no-preference', language = 'en', locale = 'en-US' } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion, isMobile: mobile, hasTouch: mobile, locale });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await context.addInitScript((lang) => {
        localStorage.setItem('void-gate-disabled', '1');
        if (lang) localStorage.setItem('voidLanguage', lang);
    }, language);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message));
    await page.goto(`${stack.origin}/shop`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    if (await page.locator('#voidAuth[aria-hidden="false"]').count()) await page.locator('#voidAuthClose').click();
    if (!mobile) await page.mouse.move(4, viewport.height / 2);   // well away from every seal
    await page.waitForFunction(() => document.querySelector('[data-stock-badge]') && document.fonts.status === 'loaded');
    return { context, page };
}

const seal = (key) => `[data-chapter="${key}"] [data-chapter-seal]`;
const region = (key) => `[data-chapter="${key}"] [data-chapter-story]`;

const phase = (page, key) => page.evaluate((i) => window.__chapterStories[i].phase, KEYS.indexOf(key));
const waitPhase = (page, key, p, timeout = 6000) => page.waitForFunction(([i, x]) => window.__chapterStories[i].phase === x,
    [KEYS.indexOf(key), p], { timeout });
const waitWritten = (page, key, timeout = 9000) => page.waitForFunction((i) => window.__chapterStories[i].written,
    KEYS.indexOf(key), { timeout });

// Everything about one chapter the tests care about, in one read.
const snap = (page, key) => page.evaluate((k) => {
    const section = document.querySelector(`[data-chapter="${k}"]`);
    const s = section.querySelector('[data-chapter-seal]');
    const r = section.querySelector('[data-chapter-story]');
    const body = r.querySelector('.chapter-story-body');
    const grid = section.querySelector('.products-grid');
    const sb = s.getBoundingClientRect();
    return {
        expanded: s.getAttribute('aria-expanded'),
        pinned: s.classList.contains('is-pinned'),
        inert: r.inert,
        height: Math.round(r.getBoundingClientRect().height),
        full: Math.round(body.offsetHeight),
        bodyOpacity: Number(getComputedStyle(body).opacity),
        writing: r.classList.contains('is-writing'),
        canvases: [...r.querySelectorAll('canvas')].filter((c) => !c.hidden).length,
        sealTop: Math.round(sb.top + window.scrollY),
        sealLeft: Math.round(sb.left),
        gridTop: Math.round(grid.getBoundingClientRect().top + window.scrollY)
    };
}, key);

async function toChapter(page, key) {
    await page.evaluate((k) => {
        document.querySelectorAll('.fade-in-up').forEach((el) => el.classList.add('visible'));
        const head = document.querySelector(`[data-chapter="${k}"] .collection-chapter-head`);
        window.scrollTo({ top: head.getBoundingClientRect().top + window.scrollY - 140, behavior: 'instant' });
    }, key);
    // The head's own fade-in must have finished, or the seal is still moving.
    await page.waitForFunction((k) => {
        const head = document.querySelector(`[data-chapter="${k}"] .collection-chapter-head`);
        const cs = getComputedStyle(head);
        return head.getAnimations().length === 0 && cs.opacity === '1' && (cs.transform === 'none' || cs.transform === 'matrix(1, 0, 0, 1, 0, 0)');
    }, key);
}

// Records, from now, every change of the story region's classes with its time.
const watch = (page, key) => page.evaluate((k) => {
    const r = document.querySelector(`[data-chapter="${k}"] [data-chapter-story]`);
    const t0 = performance.now();
    window.__log = [];
    window.__writes = 0;
    let had = r.classList.contains('is-writing');
    new MutationObserver(() => {
        const now = r.classList.contains('is-writing');
        if (now && !had) window.__writes += 1;
        had = now;
        window.__log.push([Math.round(performance.now() - t0), r.className]);
    }).observe(r, { attributes: true, attributeFilter: ['class'] });
}, key);
const firstWith = (page, cls) => page.evaluate((c) => (window.__log.find(([, name]) => name.split(' ').includes(c)) || [null])[0], cls);
const firstWithout = (page, cls, after = 0) => page.evaluate(([c, a]) => (window.__log.find(([t, name]) => t > a && !name.split(' ').includes(c)) || [null])[0], [cls, after]);

// No part of a story overlaps any piece's image, and the centre of every image
// is the image itself.
const imagesClear = (page) => page.evaluate(() => {
    const problems = [];
    const stories = [...document.querySelectorAll('[data-chapter-story]')].map((r) => r.getBoundingClientRect());
    document.querySelectorAll('.product-card .product-image').forEach((img) => {
        const b = img.getBoundingClientRect();
        stories.forEach((s) => {
            if (s.height > 0 && s.bottom > b.top + 0.5 && s.top < b.bottom && s.right > b.left && s.left < b.right) {
                problems.push(`story over ${img.closest('.product-card').dataset.productName}`);
            }
        });
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        if (cy > 0 && cy < innerHeight) {
            const hit = document.elementFromPoint(cx, cy);
            if (!hit || !img.contains(hit)) problems.push(`${img.closest('.product-card').dataset.productName} covered by ${hit && hit.className}`);
        }
    });
    return problems;
});

// How much ink the writing canvases hold (alpha summed, sampled).
const ink = (page, key) => page.evaluate((k) => {
    let sum = 0;
    document.querySelectorAll(`[data-chapter="${k}"] canvas`).forEach((c) => {
        if (c.hidden || !c.width) return;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 16) sum += d[i];
    });
    return sum;
}, key);

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

    it('groups the pieces into the three chapters, keeping every product as it was', async () => {
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
        for (const [key, [theme, text]] of Object.entries(STORIES)) {
            assert.equal(await page.locator(`${region(key)} .chapter-story-theme`).textContent(), theme);
            assert.equal(await page.locator(`${region(key)} .chapter-story-text`).textContent(), text);
            assert.equal(await page.getAttribute(seal(key), 'aria-controls'), await page.getAttribute(region(key), 'id'));
        }
        // The emblem is the house's own asset.
        assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.chapter-seal-mark')).maskImage), /\/assets\/ev-emblem\.png/);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('closed: no room, no focus, no input, and nothing running', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'fallen');
        for (const key of KEYS) {
            const s = await snap(page, key);
            assert.deepEqual([s.expanded, s.inert, s.height, s.canvases], ['false', true, 0, 0], key);
        }
        assert.equal(await page.$$eval('[data-chapter-story] button', (els) => els.filter((b) => !b.closest('[inert]')).length), 0);
        const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running'
            && a.effect.target.closest && a.effect.target.closest('[data-chapter-story], .chapter-filament')).length);
        assert.equal(running, 0, 'no decorative work while closed');
        assert.equal(await page.evaluate(() => window.__chapterStories.some((c) => c.writing)), false);
        await context.close();
    });

    it('opens as one sequence: anticipation, unfolding, light, then the words written in', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'fallen');
        const before = await snap(page, 'fallen');
        await watch(page, 'fallen');
        const sb = await page.locator(seal('fallen')).boundingBox();
        await page.mouse.move(sb.x + 22, sb.y + 22, { steps: 3 });

        // Anticipation: lit seal and the filament, but the space has not moved yet.
        await page.waitForTimeout(120);
        let s = await snap(page, 'fallen');
        assert.equal(s.expanded, 'true');
        assert.ok(s.height < 4, `still closed during the anticipation (${s.height})`);
        assert.equal(await page.evaluate(() => document.querySelector('[data-chapter="fallen"]').classList.contains('is-story-open')), true, 'filament drawn');

        // Mid-unfold, the space is partly open and the light has arrived.
        await page.waitForTimeout(700);
        s = await snap(page, 'fallen');
        assert.ok(s.height > 10 && s.height < s.full, `unfolding (${s.height}/${s.full})`);
        // Timed from the moment the story began to open (the first change).
        const begin = await firstWith(page, 'is-shown');
        const unfoldAt = (await firstWith(page, 'is-unfolding')) - begin;
        const litAt = (await firstWith(page, 'is-lit')) - begin;
        assert.ok(unfoldAt >= 220 && unfoldAt <= 480, `anticipation ~300ms (${unfoldAt})`);
        assert.ok(litAt >= unfoldAt && litAt <= 800, `the light comes just before the words (${litAt})`);

        // Letters form progressively: ink grows over time, never all at once.
        const a = await ink(page, 'fallen');
        await page.waitForTimeout(600);
        const b = await ink(page, 'fallen');
        await page.waitForTimeout(600);
        const c = await ink(page, 'fallen');
        assert.ok(a > 0 && b > a && c > b, `the ink develops (${a} → ${b} → ${c})`);
        assert.equal((await snap(page, 'fallen')).writing, true);

        // Settled: real, still, selectable text; the canvases gone.
        await waitWritten(page, 'fallen');
        const writtenAt = (await firstWithout(page, 'is-writing', begin + 50)) - begin;
        assert.ok(writtenAt >= 3500 && writtenAt <= 6500, `the short English story takes ~4–6s (${writtenAt})`);
        await page.waitForTimeout(150);
        s = await snap(page, 'fallen');
        assert.deepEqual([s.writing, s.canvases, s.bodyOpacity, s.sealTop, s.sealLeft], [false, 0, 1, before.sealTop, before.sealLeft]);
        assert.equal(s.height, s.full, 'full height, nothing clipped');
        assert.ok(s.gridTop - before.gridTop >= s.full - 2, 'the pieces moved down by the story');
        assert.deepEqual(await imagesClear(page), []);
        const textBox = await page.locator(`${region('fallen')} .chapter-story-text`).boundingBox();
        await page.mouse.move(textBox.x + 4, textBox.y + 8, { steps: 10 });
        await page.mouse.down();
        await page.mouse.move(textBox.x + textBox.width - 4, textBox.y + textBox.height - 8, { steps: 6 });
        await page.mouse.up();
        assert.match(await page.evaluate(() => String(window.getSelection())), /old self/, 'selectable');
        assert.equal(await page.evaluate(() => document.querySelector('[data-chapter="fallen"] .chapter-story-close').getAnimations().length > 0
            || getComputedStyle(document.querySelector('[data-chapter="fallen"] .chapter-story-close'), '::before').animationName), 'csGlint', 'the idle glint runs');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('keeps the passage whole for assistive technology while it is written', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'sigil');
        await page.click(seal('sigil'));
        await page.waitForTimeout(1500);
        const a11y = await page.evaluate(() => {
            const r = document.querySelector('[data-chapter="sigil"] [data-chapter-story]');
            return {
                canvasesHidden: [...r.querySelectorAll('canvas')].every((c) => c.getAttribute('aria-hidden') === 'true' && c.textContent === ''),
                theme: r.querySelector('.chapter-story-theme').textContent,
                text: r.querySelector('.chapter-story-text').textContent,
                childText: [...r.querySelectorAll('.chapter-story-theme *, .chapter-story-text *')].length,
                live: r.querySelectorAll('[aria-live]').length
            };
        });
        assert.deepEqual(a11y, { canvasesHidden: true, theme: STORIES.sigil[0], text: STORIES.sigil[1], childText: 0, live: 0 },
            'one plain sentence each, no per-letter nodes, nothing announced');
        await context.close();
    });

    it('waits ~0.7s after the pointer leaves, fades at full height, then collapses', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'fallen');
        const sb = await page.locator(seal('fallen')).boundingBox();
        await page.mouse.move(sb.x + 22, sb.y + 22, { steps: 3 });

        // Slowly from the seal down to the start of the text: it stays.
        await page.waitForTimeout(1600);
        const text = await page.locator(`${region('fallen')} .chapter-story-text`).boundingBox();
        for (let i = 1; i <= 16; i++) {
            const k = i / 16;
            await page.mouse.move(sb.x + 22 + (text.x + 10 - sb.x - 22) * k, sb.y + 22 + (text.y + 6 - sb.y - 22) * k);
            await page.waitForTimeout(70);
        }
        await waitWritten(page, 'fallen');
        assert.equal(await phase(page, 'fallen'), 'open');
        const full = (await snap(page, 'fallen')).full;
        const gridOpen = (await snap(page, 'fallen')).gridTop;

        // Out to the margin above the heading.
        await watch(page, 'fallen');
        await page.mouse.move(4, 120, { steps: 2 });
        await page.waitForTimeout(450);
        assert.equal(await phase(page, 'fallen'), 'open', 'not yet: the grace period');
        await waitPhase(page, 'fallen', 'closing', 2000);
        const fadeAt = await firstWith(page, 'is-fading');
        assert.ok(fadeAt >= 600 && fadeAt <= 1000, `exit begins ~0.7s after leaving (${fadeAt})`);

        // Most of the fade happens at full height.
        await page.waitForTimeout(700);
        let s = await snap(page, 'fallen');
        assert.ok(s.height >= full - 1, `held at full height while fading (${s.height}/${full})`);
        assert.ok(s.bodyOpacity < 0.75 && s.bodyOpacity > 0, `fading (${s.bodyOpacity})`);
        const collapseAt = await page.evaluate(() => new Promise((res) => {
            const check = () => { const e = window.__log.find(([, n]) => n.includes('is-collapsing')); if (e) res(e[0]); else setTimeout(check, 30); };
            check();
        }));
        assert.ok(collapseAt - fadeAt >= 950 && collapseAt - fadeAt <= 1250, `collapse starts once the words are nearly gone (${collapseAt - fadeAt})`);
        assert.ok(await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-chapter="fallen"] .chapter-story-body')).opacity)) < 0.2);

        await waitPhase(page, 'fallen', 'closed', 2000);
        s = await snap(page, 'fallen');
        assert.deepEqual([s.height, s.inert, s.expanded, s.canvases], [0, true, 'false', 0]);
        assert.ok(s.gridTop <= gridOpen - full + 2, 'the pieces came back up');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('restores the same story when the pointer returns mid-exit, and never restarts the writing', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'eternal');
        await watch(page, 'eternal');
        const sb = await page.locator(seal('eternal')).boundingBox();
        await page.mouse.move(sb.x + 22, sb.y + 22, { steps: 3 });
        await page.waitForTimeout(1800);   // part-way through the writing

        // Rapid in and out within the grace: nothing happens at all.
        for (let i = 0; i < 6; i++) {
            await page.mouse.move(4, sb.y - 160);
            await page.waitForTimeout(90);
            await page.mouse.move(sb.x + 22, sb.y + 22);
            await page.waitForTimeout(90);
        }
        assert.equal(await phase(page, 'eternal'), 'open');
        assert.equal(await page.evaluate(() => window.__log.some(([, n]) => n.includes('is-fading'))), false, 'no exit started');

        // Leave properly, then come back into the heading during the fade.
        await page.mouse.move(4, sb.y - 160);
        await waitPhase(page, 'eternal', 'closing', 2000);
        await page.waitForTimeout(500);
        const fading = await snap(page, 'eternal');
        assert.ok(fading.bodyOpacity < 1);
        await page.mouse.move(sb.x - 120, sb.y + 22, { steps: 3 });   // the heading, not the seal
        await waitPhase(page, 'eternal', 'open', 1500);
        await waitWritten(page, 'eternal');
        await page.waitForTimeout(800);
        const back = await snap(page, 'eternal');
        assert.deepEqual([back.expanded, back.bodyOpacity, back.height, back.writing], ['true', 1, back.full, false]);
        assert.equal(await page.evaluate(() => window.__writes), 1, 'the writing ran once, resumed — never restarted');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('closes from wherever the writing is, and resumes it if reopened during the fade', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'sigil');
        await watch(page, 'sigil');
        await page.click(seal('sigil'));   // held open
        await page.waitForTimeout(1900);
        const inkBefore = await ink(page, 'sigil');
        await page.click(seal('sigil'));   // and closed, mid-writing
        await waitPhase(page, 'sigil', 'closing', 1000);
        const paused = await page.evaluate(() => [window.__chapterStories[1].writing, window.__chapterStories[1].written]);
        assert.deepEqual(paused, [false, false], 'the hand stops where it is');
        assert.ok(await ink(page, 'sigil') >= inkBefore * 0.9, 'what was written stays while it fades');

        await page.waitForTimeout(500);
        await page.mouse.move(4, 120);
        await page.click(seal('sigil'));   // back, during the fade
        await waitPhase(page, 'sigil', 'open', 1000);
        assert.equal(await page.evaluate(() => window.__chapterStories[1].writing), true, 'the writing carries on');
        await waitWritten(page, 'sigil');
        await page.waitForTimeout(900);
        const s = await snap(page, 'sigil');
        assert.deepEqual([s.writing, s.canvases, s.bodyOpacity, s.height], [false, 0, 1, s.full]);
        assert.equal(await page.evaluate(() => window.__writes), 1);

        // The Close control: an immediate answer, then the exit.
        await page.click(`${region('sigil')} .chapter-story-close`);
        assert.equal(await page.evaluate(() => document.querySelector('[data-chapter="sigil"] .chapter-story-close').classList.contains('is-pressed')), true);
        assert.equal(await phase(page, 'sigil'), 'closing');
        assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chapter="sigil"] [data-chapter-seal]')), true, 'focus returns to the seal');
        await waitPhase(page, 'sigil', 'closed', 3000);

        // Escape, while held.
        await page.click(seal('sigil'));
        await waitPhase(page, 'sigil', 'open');
        await page.mouse.move(4, 120);
        await page.keyboard.press('Escape');
        assert.equal(await phase(page, 'sigil'), 'closing');
        await waitPhase(page, 'sigil', 'closed', 3000);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('answers the keyboard: focus opens it, Tab reaches Close, leaving closes it after the grace', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'sigil');
        await page.focus(seal('fallen'));
        await page.keyboard.press('Escape');
        while (!(await page.evaluate(() => document.activeElement.matches('[data-chapter="sigil"] [data-chapter-seal]')))) {
            await page.keyboard.press('Tab');
        }
        await waitPhase(page, 'sigil', 'open', 1000);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'chapter-story-close');
        await page.waitForTimeout(900);
        assert.equal(await phase(page, 'sigil'), 'open', 'held while focus is inside');
        await page.keyboard.press('Tab');
        await waitPhase(page, 'sigil', 'closing', 2000);
        await waitPhase(page, 'sigil', 'closed', 3000);

        await page.focus(seal('sigil'));
        await page.keyboard.press('Enter');
        await waitPhase(page, 'sigil', 'open');
        assert.equal((await snap(page, 'sigil')).pinned, true);
        await page.keyboard.press('Tab');
        await page.keyboard.press('Escape');
        await waitPhase(page, 'sigil', 'closing', 1000);
        assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chapter="sigil"] [data-chapter-seal]')), true);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('on a phone a tap toggles it, long German text fits and keeps a comfortable pace', async () => {
        const { context, page } = await shop(browser, stack, { viewport: PHONE, mobile: true, language: 'de' });
        for (const key of KEYS) {
            await toChapter(page, key);
            const before = await snap(page, key);
            const sealBox = await page.locator(seal(key)).boundingBox();
            assert.ok(sealBox.width >= 44 && sealBox.x + sealBox.width <= PHONE.width, `${key}: a touch-sized seal on screen`);
            await watch(page, key);
            await page.locator(seal(key)).tap();
            await waitWritten(page, key);
            const doneAt = await firstWithout(page, 'is-writing', 50);
            assert.ok(doneAt <= 7000, `${key}: the German story is written in ≤7s (${doneAt})`);
            await page.waitForTimeout(400);
            const open = await snap(page, key);
            assert.deepEqual([open.expanded, open.pinned, open.sealTop, open.height], ['true', true, before.sealTop, open.full], key);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'no sideways scroll');
            assert.deepEqual(await imagesClear(page), []);
            await page.locator(seal(key)).tap();
            await waitPhase(page, key, 'closed', 3500);
            const closed = await snap(page, key);
            assert.deepEqual([closed.height, closed.gridTop], [0, before.gridTop], key);
        }
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('under reduced motion it is simply there, and simply gone', async () => {
        const { context, page } = await shop(browser, stack, { reducedMotion: 'reduce' });
        await toChapter(page, 'fallen');
        await page.click(seal('fallen'));
        await page.waitForTimeout(50);
        let s = await snap(page, 'fallen');
        assert.deepEqual([s.expanded, s.writing, s.canvases, s.bodyOpacity, s.height], ['true', false, 0, 1, s.full]);
        assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running'
            && a.effect.target.closest && a.effect.target.closest('.collection-chapter-title, [data-chapter-story], .chapter-filament')).length), 0);
        await page.click(seal('fallen'));
        await page.waitForTimeout(50);
        s = await snap(page, 'fallen');
        assert.deepEqual([s.expanded, s.height, s.inert], ['false', 0, true]);
        await context.close();
    });

    it('tells each story in the visitor’s language: saved choice, browser language, and a live switch', async () => {
        const words = (page) => page.$$eval('[data-chapter-story]', (els) => els.map((el) => [
            el.querySelector('.chapter-story-theme').textContent, el.querySelector('.chapter-story-text').textContent]));
        const TOLD = {
            fr: [['Ruine. Jugement. Transformation.', /^L’ancien soi se désagrège\. Le Endzustand Tee/],
                ['Mystère. Élévation. Éveil.', /^Le poids se dissipe\. Le Levitate Tee/],
                ['Identité. Permanence. Héritage.', /trilogie Insigne, l’emblème EV/]],
            it: [['Rovina. Resa dei conti. Trasformazione.', /^Il vecchio io va in pezzi\. La Endzustand Tee/],
                ['Mistero. Elevazione. Risveglio.', /^Il peso svanisce\. La Levitate Tee/],
                ['Identità. Permanenza. Eredità.', /trilogia Insigne, l’emblema EV/]],
            de: [['Untergang. Abrechnung. Verwandlung.', /^Das alte Ich zerfällt\. Das Endzustand Tee/],
                ['Mysterium. Erhebung. Erwachen.', /^Die Last fällt ab\. Das Levitate Tee/],
                ['Identität. Beständigkeit. Vermächtnis.', /Insigne-Trilogie gibt ihr das EV-Emblem/]]
        };
        const expectTold = async (page, lang) => {
            const got = await words(page);
            TOLD[lang].forEach(([theme, text], i) => {
                assert.equal(got[i][0], theme, `${lang} theme ${i}`);
                assert.match(got[i][1], text, `${lang} text ${i}`);
            });
        };

        let { context, page } = await shop(browser, stack, { language: 'fr' });
        await expectTold(page, 'fr');
        assert.equal(await page.getAttribute(seal('sigil'), 'aria-label'), 'Lire le chapitre: The Sigil');
        assert.equal(await page.locator(`${region('sigil')} .chapter-story-close-label`).textContent(), 'Fermer');
        await context.close();

        for (const [locale, lang] of [['de-DE', 'de'], ['it-IT', 'it']]) {
            ({ context, page } = await shop(browser, stack, { language: null, locale }));
            await expectTold(page, lang);
            await context.close();
        }
        ({ context, page } = await shop(browser, stack, { language: null, locale: 'ja-JP' }));
        assert.deepEqual(await words(page), Object.values(STORIES));
        await context.close();

        // Switched while a story is being written: the new words, complete, at once.
        ({ context, page } = await shop(browser, stack));
        await toChapter(page, 'fallen');
        await page.click(seal('fallen'));
        await page.waitForTimeout(1500);
        await page.mouse.move(4, 120);
        await page.click('#languageSelectorButton');
        await page.click('#languageSelectorList [data-language="de"]');
        await page.waitForFunction(() => /^Untergang/.test(document.querySelector('[data-chapter="fallen"] .chapter-story-theme').textContent));
        await waitWritten(page, 'fallen', 3000);
        const s = await snap(page, 'fallen');
        assert.deepEqual([s.expanded, s.writing], ['true', false]);
        await expectTold(page, 'de');
        assert.deepEqual(page.errors, []);
        await context.close();
    });
});
