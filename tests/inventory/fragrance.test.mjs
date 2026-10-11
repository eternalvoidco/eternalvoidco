// /fragrance — the NÉANT scroll story in Chromium: the dark opening and its
// moving light, the decisive reveal and its single flash, the construction
// (parts apart and back), the controls staying in step with the scroll,
// returning visitors, hover and tap discovery, reduced motion, phones, the
// "Receive the unveiling" signup against the real backend, and that every
// effect stops when the page is hidden.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function visitor(browser, { viewport = DESKTOP, reducedMotion = 'no-preference', lang = 'en', touch = false, seen = false } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion, hasTouch: touch, isMobile: touch });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await context.addInitScript(([l, sn]) => {
        try {
            localStorage.setItem('void-gate-disabled', '1');
            localStorage.setItem('voidLanguage', l);
            if (sn && !sessionStorage.getItem('nt-seeded')) {
                localStorage.setItem('void-neant-seen', '1');
                sessionStorage.setItem('nt-seeded', '1');
            }
        } catch (e) { /* ignore */ }
    }, [lang, seen]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message));
    return { context, page };
}

const ready = (page) => page.waitForFunction(() => window.__neant && document.documentElement.classList.contains('nt-ready'));
const settled = (page) => page.waitForFunction(() => window.__neant.settled);

async function open(page, origin, hash = '') {
    await page.goto(`${origin}/fragrance${hash}`, { waitUntil: 'load' });
    await ready(page);
}

// Scroll to a point in the story and wait until the story has arrived there
// (not merely until it is at rest: the scroll event may not have landed yet).
async function toS(page, s) {
    await page.evaluate((v) => window.scrollTo(0, Math.round(window.__neant.top + v * window.__neant.vh)), s);
    await page.waitForFunction((v) => Math.abs(window.__neant.target - v) < 0.01 && window.__neant.settled, s);
}

const story = (page) => page.evaluate(() => {
    const n = window.__neant;
    const style = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    return {
        s: Math.round(n.s * 1000) / 1000,
        stop: n.stop,
        revealed: n.revealed,
        flashes: n.flashes,
        hash: location.hash,
        art: Number(style('.nt-b-art', 'opacity')),
        halo: Number(style('.nt-b-halo', 'opacity')),
        spot: Number(style('.nt-b-spot', 'opacity')),
        parts: Number(style('.nt-parts', 'opacity')),
        current: document.querySelector('.nt-progress [aria-current]')?.dataset.chapter,
        back: document.getElementById('ntBack').disabled,
        next: !document.getElementById('ntNext').hidden,
        skip: !document.getElementById('ntSkip').hidden,
        replay: !document.getElementById('ntReplay').hidden,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        glyphs: document.querySelectorAll('.nt-glyph').length
    };
});

// Translation of a layer, from its computed transform matrix.
const shift = (page, sel) => page.evaluate((q) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(q)).transform);
    return { x: Math.round(m.m41 * 10) / 10, y: Math.round(m.m42 * 10) / 10, scale: Math.round(Math.hypot(m.a, m.b) * 1000) / 1000 };
}, sel);

describe('NÉANT scroll story', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
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

    it('opens in darkness, where a narrow moving light discovers the bottle before it is seen', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);

        let s = await story(page);
        assert.equal(s.s, 0);
        assert.equal(s.art, 0, 'the bottle itself is not lit');
        assert.ok(s.halo <= 0.06, 'near-total darkness');
        assert.equal(await page.locator('.nt-ghost-sweep, .nt-ghost').count(), 0, 'no static streak layer');

        await page.waitForTimeout(3200);
        s = await story(page);
        assert.equal(s.art, 0, 'still only suggested');
        assert.ok(s.spot > 0.3, 'the light is on the bottle');
        const a = await page.evaluate(() => getComputedStyle(document.querySelector('.nt-b-spot')).transform);
        await page.waitForTimeout(700);
        const b = await page.evaluate(() => getComputedStyle(document.querySelector('.nt-b-spot')).transform);
        assert.notEqual(a, b, 'the light moves');

        // The poetry keeps its own measured time.
        const shown = () => page.$$eval('.nt-line', (els) => els.map((el) => el.classList.contains('is-shown')));
        assert.deepEqual(await shown(), [true, false, false]);
        await page.waitForFunction(() => document.querySelectorAll('.nt-line.is-shown').length === 2, null, { timeout: 4000 });

        const images = await page.$$eval('img', (els) => els.map((i) => [i.className, i.complete && i.naturalWidth > 0]));
        assert.ok(images.length >= 8);
        for (const [name, ok] of images) assert.ok(ok, `${name} loaded`);
        assert.equal((await page.request.get(`${stack.origin}/assets/ev-emblem.png`)).status(), 200);
        assert.ok(s.overflow <= 0);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('brings the bottle and the name in together at the threshold, with one flash, and only when scrolled across it', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        await toS(page, 2.2);
        let s = await story(page);
        assert.deepEqual([s.revealed, s.flashes], [false, 0]);
        assert.equal(await page.locator('#ntAnnounceName').evaluate((el) => el.classList.contains('is-shown')), false);

        // Scroll across it the way a visitor would.
        for (let i = 0; i < 6 && !(await page.evaluate(() => window.__neant.revealed)); i++) {
            await page.mouse.wheel(0, 80);
            await page.waitForTimeout(160);
        }
        await page.waitForFunction(() => window.__neant.revealed);
        s = await story(page);
        assert.equal(s.flashes, 1);
        assert.ok(s.glyphs > 0, 'the name is being written');
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.nt-b-art')).opacity) > 0.99, null, { timeout: 2500 });
        await page.waitForFunction(() => document.querySelectorAll('.nt-glyph').length === 0, null, { timeout: 4000 });
        assert.match(await page.locator('#ntAnnounceTitle').textContent(), /Néant/);

        // Leaving and arriving again from below does not flash.
        await toS(page, 4.0);
        await toS(page, 2.8);
        assert.equal((await story(page)).flashes, 1);
        assert.equal((await story(page)).revealed, true);

        // Skipping over the whole story flashes nothing.
        await toS(page, 0);
        await page.click('#ntSkip');
        await settled(page);
        assert.equal((await story(page)).flashes, 1);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('takes the bottle apart into crown, glass, insignia and amber core, and puts it back together', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        await toS(page, 7.3);
        await page.waitForTimeout(400);
        const cap = await shift(page, '.nt-b-cap');
        const ins = await shift(page, '.nt-b-ins');
        const amber = await shift(page, '.nt-b-amber');
        assert.ok(cap.y < -20, 'the crown lifts');
        assert.ok(ins.x < -10 && ins.scale > 1.05, 'the insignia comes forward');
        assert.ok(amber.y > 5 && amber.scale > 1.05, 'the amber core sinks and swells');
        assert.ok((await story(page)).parts > 0.95);
        assert.deepEqual(await page.$$eval('.nt-part', (els) => els.map((e) => e.textContent.trim())),
            ['The Crown', 'The Glass', 'The Insignia', 'The Amber Core']);
        assert.ok(Number(await page.locator('.nt-b-hollow--ins').evaluate((el) => getComputedStyle(el).opacity)) > 0.8);

        await toS(page, 8.3);
        assert.deepEqual(await shift(page, '.nt-b-cap'), { x: 0, y: 0, scale: 1 });
        assert.equal((await shift(page, '.nt-b-ins')).x, 0);
        assert.equal((await story(page)).parts, 0);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('keeps Next, Back, Skip, Replay and the progress in step with the scroll', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        const top = (stopId) => page.evaluate((id) => {
            const st = window.__neant.stops.find((x) => x.id === id);
            return Math.round(window.__neant.top + st.s * window.__neant.vh);
        }, stopId);

        await page.click('#ntNext');
        await settled(page);
        let s = await story(page);
        assert.deepEqual([s.stop, s.hash, s.current], ['announcement', '#announcement', '1']);
        assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - await top('announcement')) <= 2);

        await page.click('#ntNext');
        await page.click('#ntNext');
        await settled(page);
        s = await story(page);
        assert.deepEqual([s.stop, s.current], ['heart', '2']);

        await page.click('#ntBack');
        await settled(page);
        assert.equal((await story(page)).stop, 'opening');

        // Pressed quickly, each press moves on from where the last is going.
        await page.click('#ntNext');
        await page.click('#ntNext');
        await page.click('#ntNext');
        await settled(page);
        s = await story(page);
        assert.deepEqual([s.stop, s.current], ['construction', '3']);

        // The arrow keys step too; a visitor's own scroll always wins.
        await page.keyboard.press('ArrowLeft');
        await settled(page);
        assert.equal((await story(page)).stop, 'base');
        await page.click('.nt-progress [data-chapter="1"]');
        await page.waitForTimeout(250);
        await page.mouse.wheel(0, 200);
        await settled(page);
        assert.ok((await story(page)).s > 1, 'the control gave way to the wheel');

        await page.click('#ntSkip');
        await settled(page);
        s = await story(page);
        assert.deepEqual([s.stop, s.next, s.skip, s.replay, s.back], ['unveiling', false, false, true, false]);
        assert.equal(await page.evaluate(() => localStorage.getItem('void-neant-seen')), '1');
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('ntControls')).position), 'absolute');
        await page.waitForFunction(() => document.getElementById('ntUnveilCopy').classList.contains('is-shown'));

        // Typing never steps the story.
        await page.fill('#ntEmail', 'a');
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(200);
        assert.equal((await story(page)).stop, 'unveiling');

        await page.locator('#ntReplay').scrollIntoViewIfNeeded();
        await page.click('#ntReplay');
        await settled(page);
        s = await story(page);
        assert.deepEqual([s.s, s.next, s.replay, s.back, s.hash], [0, true, false, true, '']);
        assert.equal(await page.locator('.nt-line.is-shown').count(), 0, 'the poetry starts again');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('opens returning visitors on the unveiling, links on their passage, and comes back to the same place from the shop', async () => {
        const returning = await visitor(browser, { seen: true });
        await open(returning.page, stack.origin);
        await settled(returning.page);
        let s = await story(returning.page);
        assert.deepEqual([s.stop, s.replay], ['unveiling', true]);
        await returning.page.waitForFunction(() => document.getElementById('ntUnveilCopy').classList.contains('is-shown'));
        await returning.context.close();

        const { context, page } = await visitor(browser);
        await open(page, stack.origin, '#heart');
        await settled(page);
        s = await story(page);
        assert.deepEqual([s.stop, s.flashes], ['heart', 0]);
        await page.waitForFunction(() => document.querySelector('[data-beat="heart"]').classList.contains('is-shown'));

        await page.click('.nt-nav a[href="/shop"]');
        await page.waitForURL(/\/shop$/);
        await page.goBack();
        await page.waitForURL(/\/fragrance#heart$/);
        await ready(page);
        await page.waitForFunction(() => window.__neant.stop === 'heart' && window.__neant.settled);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('lights the bottle under the pointer, names what it finds, and returns to rest without snapping', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        await page.click('#ntSkip');
        await settled(page);
        await page.waitForTimeout(600);
        assert.equal(await page.locator('#ntCaptionHint').textContent(), 'Move closer to discover');
        assert.equal(await page.isVisible('#ntUnveilTitle'), true, 'everything essential is there without hovering');

        const box = await page.locator('#ntBottle').boundingBox();
        await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.3);
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.49, { steps: 10 });
        await page.waitForFunction(() => window.__neant.lamp.key === 'insignia' && window.__neant.lamp.i > 0.95);
        assert.equal(await page.locator('#ntCaptionTitle').textContent(), 'The Insignia');
        assert.equal(await page.locator('#ntCaption').evaluate((el) => el.classList.contains('is-on')), true);
        assert.ok(Number(await page.locator('.nt-b-spot').evaluate((el) => getComputedStyle(el).opacity)) > 0.8);
        const tilted = await page.locator('#ntBottle').evaluate((el) => getComputedStyle(el).transform);

        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.1, { steps: 8 });
        await page.waitForFunction(() => window.__neant.lamp.key === 'crown');

        await page.mouse.move(8, box.y + box.height * 0.5, { steps: 4 });
        await page.waitForTimeout(140);
        const fading = (await page.evaluate(() => window.__neant.lamp)).i;
        assert.ok(fading > 0.1 && fading < 0.95, `eases out rather than snapping (${fading})`);
        await page.waitForFunction(() => window.__neant.lamp.i < 0.01, null, { timeout: 4000 });
        assert.equal(await page.locator('#ntCaption').evaluate((el) => el.classList.contains('is-on')), false);
        assert.notEqual(tilted, await page.locator('#ntBottle').evaluate((el) => getComputedStyle(el).transform), 'the tilt settles back');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('lets touch and keyboard step through the same discovery', async () => {
        const { context, page } = await visitor(browser, { viewport: PHONE, touch: true });
        await open(page, stack.origin);
        await page.locator('#ntSkip').tap();
        await settled(page);
        assert.equal(await page.locator('#ntCaptionHint').textContent(), 'Tap the bottle to discover');
        const keys = [];
        for (let i = 0; i < 5; i++) {
            await page.locator('#ntDiscover').tap();
            await page.waitForTimeout(700);
            keys.push((await page.evaluate(() => window.__neant.lamp)).key);
        }
        assert.deepEqual(keys, ['crown', 'insignia', 'amber', 'glass', '']);

        await page.focus('#ntDiscover');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.__neant.lamp.key === 'crown');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('under reduced motion holds each composition still: no flash, no letters, nothing drifting', async () => {
        const { context, page } = await visitor(browser, { reducedMotion: 'reduce' });
        await open(page, stack.origin);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('nt-calm')), true);
        assert.equal(await page.locator('.nt-line.is-shown').count(), 3, 'the poetry is simply there');

        for (const s of [1.0, 2.0, 2.5, 2.8]) await toS(page, s);
        let st = await story(page);
        assert.deepEqual([st.revealed, st.flashes, st.glyphs], [true, 0, 0]);

        // The construction as a still: after the short crossfade, nothing moves.
        await toS(page, 7.3);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.nt-parts')).opacity === '1', null, { timeout: 3000 });
        await toS(page, 9);
        // Everything comes to rest: no loop, drift or reflection keeps running.
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 3000 });
        await page.waitForTimeout(1500);
        assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length), 0);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('fits a phone at every passage, and its controls never cover the form', async () => {
        const { context, page } = await visitor(browser, { viewport: PHONE, touch: true });
        await open(page, stack.origin);
        const stops = await page.evaluate(() => window.__neant.stops.map((x) => x.s));
        for (const s of stops) {
            await toS(page, s);
            await page.waitForTimeout(250);
            const st = await story(page);
            assert.ok(st.overflow <= 0, `no sideways scroll at ${s}`);
            if (s < 9) {
                const bar = await page.locator('#ntControls').boundingBox();
                assert.ok(bar.y + bar.height <= PHONE.height + 1, 'controls on screen');
            }
        }

        // The story's text stays clear of the controls.
        await toS(page, 4.85);
        await page.waitForTimeout(1600);
        const bar = await page.locator('#ntControls').boundingBox();
        const textBottom = await page.evaluate(() => Math.max(...[...document.querySelectorAll('[data-beat="heart"] [data-reveal]')]
            .map((el) => el.getBoundingClientRect().bottom)));
        assert.ok(textBottom <= bar.y + 4, `heart text ends at ${textBottom}, controls start at ${bar.y}`);

        await page.locator('#ntSkip').tap();
        await settled(page);
        await page.locator('#ntSubmit').scrollIntoViewIfNeeded();
        const form = await page.locator('#ntForm').boundingBox();
        const controls = await page.locator('#ntControls').boundingBox();
        assert.ok(controls.y >= form.y + form.height, 'the controls close the page below the form');
        await page.locator('#ntEmail').tap();
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('nt-typing')), true);
        const submit = await page.locator('#ntSubmit').boundingBox();
        assert.ok(submit.width >= 300 && submit.height >= 44);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('signs up for the unveiling with NÉANT recorded, and shows every error in place', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin, '#unveiling');
        await settled(page);

        let posts = 0;
        page.on('request', (req) => { if (req.url().endsWith('/api/newsletter') && req.method() === 'POST') posts += 1; });
        const status = () => page.locator('#ntFormStatus').textContent();

        await page.fill('#ntEmail', 'not-an-email');
        await page.click('#ntSubmit');
        assert.equal(await status(), 'Please enter a valid email address.');
        assert.equal(await page.getAttribute('#ntEmail', 'aria-invalid'), 'true');
        assert.equal(posts, 0);
        await page.fill('#ntEmail', 'neant@example');
        assert.equal(await status(), '');

        await page.route('**/api/newsletter', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"x"}' }));
        await page.fill('#ntEmail', 'collector@example.com');
        await page.click('#ntSubmit');
        await page.waitForFunction(() => document.getElementById('ntForm').dataset.state === 'error');
        assert.equal(await status(), 'Signup is not available right now. Please try again later.');
        assert.equal(await page.isEnabled('#ntSubmit'), true);

        await page.unroute('**/api/newsletter');
        await page.route('**/api/newsletter', (route) => route.abort());
        await page.click('#ntSubmit');
        await page.waitForFunction(() => /could not sign you up/.test(document.getElementById('ntFormStatus').textContent));
        await page.unroute('**/api/newsletter');
        const { rows: none } = await stack.db.query("select 1 from newsletter_subscribers where email = 'collector@example.com'");
        assert.equal(none.length, 0);

        await page.click('#ntSubmit');
        await page.waitForFunction(() => document.getElementById('ntForm').dataset.state === 'success');
        assert.equal(await status(), 'You are on the list for the unveiling. Please check your email.');
        const { rows } = await stack.db.query(
            "select status, sources, interests from newsletter_subscribers where email = 'collector@example.com'");
        assert.deepEqual(rows[0], { status: 'subscribed', sources: ['newsletter'], interests: ['neant'] });
        assert.ok(stack.emails.some((m) => m.to === 'collector@example.com'));
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('speaks the language chosen in the shop', async () => {
        const { context, page } = await visitor(browser, { lang: 'fr' });
        await open(page, stack.origin, '#construction');
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'fr');
        assert.equal(await page.locator('.nt-part--crown').textContent(), 'La Couronne');
        assert.equal(await page.locator('#ntSubmit').textContent(), 'Recevoir le dévoilement');
        assert.equal(await page.locator('.nt-status').textContent(), 'Bientôt');
        await context.close();
    });

    it('stops every effect while the page is hidden or left, and picks up again', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        await page.waitForTimeout(1500);
        assert.equal(await page.evaluate(() => window.__neant.running), true, 'the prologue light is alive');

        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__neant.running), false);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('nt-paused')), true);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__neant.running), true);

        // The settled scene's slow movement exists only there, and pauses too.
        await page.click('#ntSkip');
        await settled(page);
        await page.waitForTimeout(400);
        const names = await page.evaluate(() => document.getAnimations().map((a) => a.animationName).filter(Boolean).sort());
        assert.ok(names.includes('nt-sheen') && names.includes('nt-drift-a'));
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        const running = await page.evaluate(() => document.getAnimations()
            .filter((a) => a.playState === 'running' && getComputedStyle(a.effect.target).animationPlayState !== 'paused').length);
        assert.equal(running, 0);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));

        await page.click('#ntReplay');
        await settled(page);
        await page.waitForTimeout(200);
        const atTop = await page.evaluate(() => document.getAnimations().map((a) => a.animationName).filter(Boolean));
        assert.ok(!atTop.includes('nt-sheen'), 'the final scene’s movement stops when it is left');
        assert.deepEqual(page.errors, []);
        await context.close();
    });
});
