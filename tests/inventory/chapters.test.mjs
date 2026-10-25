// The collection's three chapters in Chromium: their grouping, and the seal
// that opens each chapter's story inline — hover, keyboard, click, touch,
// closing, rapid pointer movement, phones and reduced motion — with the
// pieces underneath fully visible and usable in every state.
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

async function shop(browser, stack, { viewport = DESKTOP, mobile = false, reducedMotion = 'no-preference', language = 'en' } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion, isMobile: mobile, hasTouch: mobile });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await context.addInitScript((lang) => {
        localStorage.setItem('void-gate-disabled', '1');
        localStorage.setItem('voidLanguage', lang);
    }, language);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message));
    await page.goto(`${stack.origin}/shop`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    if (await page.locator('#voidAuth[aria-hidden="false"]').count()) await page.locator('#voidAuthClose').click();
    await page.waitForFunction(() => document.querySelector('[data-stock-badge]'));
    return { context, page };
}

const seal = (key) => `[data-chapter="${key}"] [data-chapter-seal]`;
const region = (key) => `[data-chapter="${key}"] [data-chapter-story]`;

// Everything about one chapter that the tests care about, in one read.
const snap = (page, key) => page.evaluate((k) => {
    const section = document.querySelector(`[data-chapter="${k}"]`);
    const s = section.querySelector('[data-chapter-seal]');
    const r = section.querySelector('[data-chapter-story]');
    const grid = section.querySelector('.products-grid');
    const sb = s.getBoundingClientRect();
    return {
        expanded: s.getAttribute('aria-expanded'),
        pinned: s.classList.contains('is-pinned'),
        open: r.classList.contains('is-open'),
        inert: r.inert,
        height: Math.round(r.getBoundingClientRect().height),
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

const until = (page, key, expanded, timeout = 4000) => page.waitForFunction(([k, x]) =>
    document.querySelector(`[data-chapter="${k}"] [data-chapter-seal]`).getAttribute('aria-expanded') === x, [key, expanded], { timeout });
// Open or closed, and the height animation finished.
const settled = (page, key) => page.waitForFunction((k) =>
    document.querySelector(`[data-chapter="${k}"] [data-chapter-story]`).getAnimations().length === 0, key);

// No part of the open story overlaps any piece's image, and the centre of
// every image is the image itself (nothing is laid over it).
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
            index: el.querySelector('.collection-chapter-index').textContent,
            name: el.querySelector('.collection-chapter-name').textContent,
            label: el.getAttribute('aria-labelledby').split(' ').map((id) => document.getElementById(id).textContent).join(' — '),
            preview: el.classList.contains('is-preview'),
            pieces: [...el.querySelectorAll('.product-card')].map((c) => [
                c.dataset.productName, c.querySelector('.product-price').textContent, c.dataset.unreleased === 'true',
                c.querySelector('.product-photo').getAttribute('src')])
        })));
        assert.deepEqual(chapters, [
            { key: 'fallen', index: 'Chapter I', name: 'The Fallen', label: 'Chapter I — The Fallen', preview: false,
                pieces: [['Endzustand Tee', '€200', false, '/assets/endzustand-black.png']] },
            { key: 'sigil', index: 'Chapter II', name: 'The Sigil', label: 'Chapter II — The Sigil', preview: false,
                pieces: [['Levitate Tee', '€200', false, '/assets/levitate-white.png']] },
            { key: 'eternal', index: 'Chapter III', name: 'The Eternal', label: 'Chapter III — The Eternal', preview: true,
                pieces: [['Insigne Ivoire', '€250', true, '/assets/ivory-gold-monogram.png'],
                    ['Insigne Noir', '€250', true, '/assets/ivory-black-gold-monogram.png'],
                    ['Insigne Azure', '€250', true, '/assets/ivory-blue-monogram.png']] }
        ]);
        assert.equal(await page.locator('[data-chapter="eternal"] .collection-chapter-status').textContent(), 'Coming Soon');

        // The copy, exactly, one component per chapter.
        for (const [key, [theme, text]] of Object.entries(STORIES)) {
            assert.equal(await page.locator(`${region(key)} .chapter-story-theme`).textContent(), theme);
            assert.equal(await page.locator(`${region(key)} .chapter-story-text`).textContent(), text);
            assert.equal(await page.getAttribute(seal(key), 'aria-controls'), await page.getAttribute(region(key), 'id'));
        }
        assert.deepEqual(await page.$$eval('[data-chapter-seal]', (els) => els.map((e) => e.getAttribute('aria-label'))),
            ['Read chapter: The Fallen', 'Read chapter: The Sigil', 'Read chapter: The Eternal']);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('closed stories take no room, no focus and no input', async () => {
        const { context, page } = await shop(browser, stack);
        for (const key of Object.keys(STORIES)) {
            const s = await snap(page, key);
            assert.deepEqual([s.expanded, s.open, s.inert, s.height], ['false', false, true, 0], key);
        }
        // Tab from each seal goes past its story, never into it.
        await toChapter(page, 'fallen');
        await page.focus(seal('fallen'));
        await page.keyboard.press('Escape');   // the focus-visible peek is not under test here
        const focusable = await page.$$eval('[data-chapter-story] button', (els) => els.filter((b) => !b.closest('[inert]')).length);
        assert.equal(focusable, 0);
        // A click where a closed story would be lands on the page below it.
        const box = await page.locator('[data-chapter="fallen"] .collection-chapter-head').boundingBox();
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).closest('[data-chapter-story]'), [box.x + box.width / 2, box.y + box.height + 2]);
        assert.equal(hit, null);
        await context.close();
    });

    it('opens on hover, stays open on the way into the text, and closes when the pointer leaves', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'fallen');
        const before = await snap(page, 'fallen');
        const sb = await page.locator(seal('fallen')).boundingBox();

        await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 4 });
        await page.waitForFunction(() => document.querySelector('[data-chapter="fallen"] [data-chapter-story]').classList.contains('is-open'));
        assert.equal((await snap(page, 'fallen')).expanded, 'true');
        assert.equal(await page.evaluate(() => document.querySelector('[data-chapter="fallen"] [data-chapter-story]').classList.contains('is-projecting')), true,
            'the projection plays');
        await settled(page, 'fallen');
        const open = await snap(page, 'fallen');
        assert.equal(open.sealTop, before.sealTop, 'the seal does not move');
        assert.equal(open.sealLeft, before.sealLeft);
        assert.ok(open.gridTop - before.gridTop >= open.height - 2 && open.height > 80, 'the pieces moved down by the story');

        // Down from the seal, across the head, onto the start of the paragraph
        // — slowly, the way someone reading would — and select it.
        const text = await page.locator(`${region('fallen')} .chapter-story-text`).boundingBox();
        for (let i = 1; i <= 16; i++) {
            const k = i / 16;
            await page.mouse.move(sb.x + 22 + (text.x + 10 - sb.x - 22) * k, sb.y + 22 + (text.y + 6 - sb.y - 22) * k);
            await page.waitForTimeout(60);
        }
        await page.waitForTimeout(500);
        assert.equal((await snap(page, 'fallen')).open, true, 'still open over the text');
        await page.mouse.down();
        await page.mouse.move(text.x + text.width - 10, text.y + text.height - 6, { steps: 8 });
        await page.mouse.up();
        assert.match(await page.evaluate(() => String(window.getSelection())), /old self|wreckage/, 'the text is selectable');
        await page.waitForTimeout(1200);
        assert.equal(await page.evaluate(() => document.querySelector('[data-chapter="fallen"] [data-chapter-story]').classList.contains('is-projecting')), false,
            'it settles into plain type');

        // Down onto the piece: it closes completely, and does not reopen.
        const card = await page.locator('.product-card[data-product-name="Endzustand Tee"] .product-image').boundingBox();
        await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 6 });
        await until(page, 'fallen', 'false');
        await settled(page, 'fallen');
        await page.waitForTimeout(400);   // and it stays closed
        const closed = await snap(page, 'fallen');
        assert.deepEqual([closed.expanded, closed.height, closed.inert, closed.gridTop], ['false', 0, true, before.gridTop]);
        assert.deepEqual(await imagesClear(page), []);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('holds still under rapid pointer movement: no flicker, no stuck state', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'sigil');
        const sb = await page.locator(seal('sigil')).boundingBox();
        const cx = sb.x + sb.width / 2;
        const cy = sb.y + sb.height / 2;

        // Count every state change while the pointer flicks on and off the seal.
        await page.evaluate(() => {
            window.__flips = 0;
            new MutationObserver((m) => { window.__flips += m.length; })
                .observe(document.querySelector('[data-chapter="sigil"] [data-chapter-seal]'), { attributes: true, attributeFilter: ['aria-expanded'] });
        });
        for (let i = 0; i < 8; i++) {
            await page.mouse.move(cx, cy);
            await page.waitForTimeout(40);
            await page.mouse.move(cx + 80, cy);
            await page.waitForTimeout(40);
        }
        assert.ok(await page.evaluate(() => window.__flips) <= 1, 'opened once, not on every pass');
        await page.mouse.move(cx + 300, cy - 200);
        await page.waitForFunction(() => document.querySelector('[data-chapter="sigil"] [data-chapter-seal]').getAttribute('aria-expanded') === 'false');

        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('click holds it open, a second click, the close action or Escape closes it', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'eternal');
        const sb = await page.locator(seal('eternal')).boundingBox();
        await page.mouse.click(sb.x + 22, sb.y + 22);
        await until(page, 'eternal', 'true');
        await settled(page, 'eternal');
        let s = await snap(page, 'eternal');
        assert.deepEqual([s.expanded, s.pinned], ['true', true]);

        // Held: the pointer can go anywhere, including the pieces.
        await page.mouse.move(10, 10, { steps: 5 });
        await page.waitForTimeout(600);
        assert.equal((await snap(page, 'eternal')).open, true, 'held open after the pointer leaves');
        assert.deepEqual(await imagesClear(page), [], 'the pieces are unobstructed while open');

        // Second click closes, and resting on the seal does not reopen it.
        await page.mouse.move(sb.x + 22, sb.y + 22);
        await page.waitForTimeout(100);
        await page.mouse.click(sb.x + 22, sb.y + 22);
        await until(page, 'eternal', 'false');
        await settled(page, 'eternal');
        await page.waitForTimeout(400);   // resting on the seal: must not reopen
        s = await snap(page, 'eternal');
        assert.deepEqual([s.expanded, s.pinned, s.height], ['false', false, 0]);
        // …until the pointer leaves and comes back.
        await page.mouse.move(sb.x - 200, sb.y);
        await page.mouse.move(sb.x + 22, sb.y + 22, { steps: 2 });
        await page.waitForFunction(() => document.querySelector('[data-chapter="eternal"] [data-chapter-seal]').getAttribute('aria-expanded') === 'true');
        await page.mouse.move(sb.x - 300, sb.y);

        // The close action.
        await page.mouse.click(sb.x + 22, sb.y + 22);
        await settled(page, 'eternal');
        await page.click(`${region('eternal')} .chapter-story-close`);
        await until(page, 'eternal', 'false');
        assert.equal((await snap(page, 'eternal')).expanded, 'false');
        assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chapter="eternal"] [data-chapter-seal]')), true, 'focus returns to the seal');

        // Escape, while held.
        await page.mouse.move(sb.x - 300, sb.y);
        await page.mouse.click(sb.x + 22, sb.y + 22);
        await until(page, 'eternal', 'true');
        await page.mouse.move(sb.x - 300, sb.y);
        await page.keyboard.press('Escape');
        await until(page, 'eternal', 'false');
        await settled(page, 'eternal');
        assert.deepEqual([(await snap(page, 'eternal')).expanded, (await snap(page, 'eternal')).height], ['false', 0]);

        // The pieces still open their detail panel with a story held open.
        await page.mouse.click(sb.x + 22, sb.y + 22);
        await until(page, 'eternal', 'true');
        await settled(page, 'eternal');
        await page.locator('.product-card[data-product-name="Insigne Noir"] .product-image').click();
        await page.waitForSelector('#productDetailOverlay.open');
        await page.keyboard.press('Escape');   // closes the dialog, not the story underneath
        await page.waitForSelector('#productDetailOverlay:not(.open)');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('answers the keyboard: focus shows it, Tab reaches the close action, leaving closes it', async () => {
        const { context, page } = await shop(browser, stack);
        await toChapter(page, 'sigil');
        await page.focus(seal('fallen'));
        await page.keyboard.press('Escape');
        // Shift+Tab/Tab so the seal gets keyboard (focus-visible) focus.
        await page.keyboard.press('Tab');
        while (!(await page.evaluate(() => document.activeElement.matches('[data-chapter="sigil"] [data-chapter-seal]')))) {
            await page.keyboard.press('Tab');
        }
        await page.waitForTimeout(150);
        assert.equal((await snap(page, 'sigil')).expanded, 'true', 'focus reveals the story');

        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'chapter-story-close');
        await page.waitForTimeout(400);
        assert.equal((await snap(page, 'sigil')).open, true, 'kept open while focus is inside');

        await page.keyboard.press('Tab');   // on past the story
        await until(page, 'sigil', 'false');   // closed once focus has left

        // Enter holds it; Escape closes and returns focus to the seal.
        await page.focus(seal('sigil'));
        await page.keyboard.press('Enter');
        await until(page, 'sigil', 'true');
        assert.equal((await snap(page, 'sigil')).pinned, true);
        await page.keyboard.press('Tab');
        await page.keyboard.press('Escape');
        await until(page, 'sigil', 'false');
        assert.equal((await snap(page, 'sigil')).expanded, 'false');
        assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chapter="sigil"] [data-chapter-seal]')), true);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('on a phone a tap toggles it, everything fits and the pieces stay clear', async () => {
        const { context, page } = await shop(browser, stack, { viewport: PHONE, mobile: true });
        for (const key of Object.keys(STORIES)) {
            await toChapter(page, key);
            const before = await snap(page, key);
            const sealBox = await page.locator(seal(key)).boundingBox();
            assert.ok(sealBox.width >= 44 && sealBox.height >= 44, 'a touch-sized seal');
            assert.ok(sealBox.x >= 0 && sealBox.x + sealBox.width <= PHONE.width, `${key}: the seal is on screen`);

            await page.locator(seal(key)).tap();
            await until(page, key, 'true');
            await settled(page, key);
            const open = await snap(page, key);
            assert.deepEqual([open.expanded, open.pinned, open.sealTop], ['true', true, before.sealTop], key);
            const text = await page.locator(`${region(key)} .chapter-story-text`).boundingBox();
            const regionBox = await page.locator(region(key)).boundingBox();
            assert.ok(text.y + text.height <= regionBox.y + regionBox.height + 1, `${key}: the whole paragraph is shown`);
            assert.ok(text.x >= 0 && text.x + text.width <= PHONE.width, `${key}: within the screen`);
            assert.equal(await page.evaluate((k) => {
                const r = document.querySelector(`[data-chapter="${k}"] [data-chapter-story]`);
                return [...r.querySelectorAll('*')].some((el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY));
            }, key), false, 'no inner scrolling');
            assert.deepEqual(await imagesClear(page), []);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'no sideways scroll');

            await page.locator(seal(key)).tap();
            await until(page, key, 'false');
            await settled(page, key);
            const closed = await snap(page, key);
            assert.deepEqual([closed.expanded, closed.height, closed.gridTop], ['false', 0, before.gridTop], key);
        }
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('under reduced motion it simply appears: no projection, no decorative motion', async () => {
        const { context, page } = await shop(browser, stack, { reducedMotion: 'reduce' });
        await toChapter(page, 'fallen');
        const running = () => page.evaluate(() => document.getAnimations()
            .filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest
                && a.effect.target.closest('.collection-chapter-title, [data-chapter-story]')).length);
        assert.equal(await running(), 0, 'the seals hold still');
        await page.click(seal('fallen'));
        await page.waitForTimeout(60);
        const s = await snap(page, 'fallen');
        assert.ok(s.expanded === 'true' && s.height > 80, 'open at once, full height');
        assert.equal(await page.evaluate(() => document.querySelector('[data-chapter="fallen"] [data-chapter-story]').classList.contains('is-projecting')), false);
        assert.equal(await running(), 0);
        await context.close();
    });

    it('relabels its controls with the language', async () => {
        const { context, page } = await shop(browser, stack, { language: 'fr' });
        assert.equal(await page.getAttribute(seal('sigil'), 'aria-label'), 'Lire le chapitre: The Sigil');
        assert.equal((await page.locator(`${region('sigil')} .chapter-story-close`).textContent()).replace('×', '').trim(), 'Fermer');
        await context.close();
    });
});
