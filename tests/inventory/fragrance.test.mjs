// /fragrance — the NÉANT teaser in Chromium: the three chapters, their
// controls, rapid and interrupted navigation, reduced motion, phones, the
// "Receive the unveiling" signup against the real newsletter backend, return
// navigation, and that every effect stops when it should.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const IDS = ['prologue', 'announcement', 'opening', 'heart', 'base', 'unveiling'];
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function visitor(browser, { viewport = DESKTOP, reducedMotion = 'no-preference', lang = 'en', touch = false } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion, hasTouch: touch, isMobile: touch });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await context.addInitScript((l) => {
        try {
            localStorage.setItem('void-gate-disabled', '1');
            localStorage.setItem('voidLanguage', l);
        } catch (e) { /* ignore */ }
    }, lang);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message));
    return { context, page };
}

const settled = (page) => page.waitForFunction(
    () => window.__neant && !window.__neant.busy && window.__neant.step === window.__neant.target);

// Everything that must be true of a passage at rest.
const rest = (page) => page.evaluate(() => {
    const scenes = Array.from(document.querySelectorAll('.nt-scene'));
    const shown = scenes.filter((s) => !s.hidden);
    return {
        step: window.__neant.step,
        shown: shown.map((s) => s.id),
        hash: location.hash,
        words: document.querySelectorAll('.nt-word, .nt-glyph').length,
        styled: shown.flatMap((s) => [s, ...s.querySelectorAll('[data-reveal]')]).filter((el) => el.getAttribute('style')).length,
        inert: shown.filter((s) => s.inert).length,
        ghost: !document.getElementById('ntGhost').hidden,
        current: document.querySelector('.nt-progress [aria-current]')?.dataset.goto,
        back: document.getElementById('ntBack').disabled,
        next: !document.getElementById('ntNext').hidden,
        skip: !document.getElementById('ntSkip').hidden,
        replay: !document.getElementById('ntReplay').hidden,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        running: document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || 'timeline')
    };
});

async function open(page, origin, hash = '') {
    await page.goto(`${origin}/fragrance${hash}`, { waitUntil: 'load' });
    await settled(page);
}

describe('NÉANT teaser', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
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

    it('opens on the announcement and steps through every passage under the visitor’s control', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);

        let s = await rest(page);
        assert.deepEqual([s.step, s.shown, s.ghost, s.current, s.back, s.next, s.skip, s.replay],
            [0, ['prologue'], true, '0', true, true, true, false]);
        assert.equal(s.hash, '', 'the first visit keeps a clean address');
        // At rest only the silhouette's slow reflection is moving.
        assert.deepEqual(s.running, ['nt-sweep']);

        // Every image the page uses arrived, and the emblem is served.
        const images = await page.$$eval('img', (els) => els.map((i) => [i.getAttribute('src'), i.complete && i.naturalWidth > 0]));
        assert.ok(images.length >= 4);
        for (const [src, ok] of images) assert.ok(ok, `${src} loaded`);
        assert.equal((await page.request.get(`${stack.origin}/assets/ev-emblem.png`)).status(), 200);

        for (let step = 1; step <= 5; step++) {
            await page.click('#ntNext');
            await settled(page);
            s = await rest(page);
            assert.deepEqual(s.shown, [IDS[step]]);
            assert.equal(s.hash, `#${IDS[step]}`);
            assert.equal(s.words, 0, 'letters are whole text again at rest');
            assert.equal(s.styled, 0, 'no animation state left behind');
            assert.equal(s.inert, 0);
            assert.equal(s.ghost, step === 1, 'the silhouette belongs to chapter 01 only');
            assert.deepEqual(s.running, step === 1 ? ['nt-sweep'] : [], 'nothing runs at rest after chapter 01');
            assert.ok(s.overflow <= 0, `no sideways scroll on ${IDS[step]}`);
        }

        assert.deepEqual([s.current, s.back, s.next, s.skip, s.replay], ['5', false, false, false, true]);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ntUnveilTitle',
            'focus is not lost when Next goes away');
        assert.match(await page.locator('#unveiling .nt-status').textContent(), /Coming Soon/);
        assert.equal(await page.locator('#unveiling').getByText(/€|\$|price|available now/i).count(), 0);

        await page.click('#ntBack');
        await settled(page);
        assert.deepEqual((await rest(page)).shown, ['base']);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('lets the monologue flow into the announcement once, and never moves on after the visitor takes control', async () => {
        const first = await visitor(browser);
        await open(first.page, stack.origin);
        await first.page.waitForFunction(() => window.__neant.step === 1 && !window.__neant.busy, null, { timeout: 15000 });
        await first.page.waitForTimeout(3500);
        assert.equal(await first.page.evaluate(() => window.__neant.target), 1, 'nothing beyond the announcement moves by itself');
        await first.context.close();

        const second = await visitor(browser);
        await second.page.goto(`${stack.origin}/fragrance`);
        await second.page.waitForFunction(() => window.__neant);
        await second.page.keyboard.press('ArrowRight');
        await settled(second.page);
        await second.page.keyboard.press('ArrowLeft');
        await settled(second.page);
        await second.page.waitForTimeout(10500);
        assert.equal(await second.page.evaluate(() => window.__neant.target), 0);
        await second.context.close();
    });

    it('settles cleanly after rapid and interrupted navigation', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);

        // Hammer Next well past the end.
        for (let i = 0; i < 9; i++) { await page.click('#ntNext', { force: true, noWaitAfter: true }).catch(() => {}); await page.waitForTimeout(25); }
        await settled(page);
        let s = await rest(page);
        assert.deepEqual([s.step, s.shown, s.words, s.styled, s.ghost], [5, ['unveiling'], 0, 0, false]);
        const lights = await page.$$eval('[data-light]', (els) => els.map((el) => [el.dataset.light, el.style.opacity]));
        assert.deepEqual(lights, [['gold', '0.55'], ['citrus', '0'], ['rose', '0'], ['smoke', '0.25'], ['amber', '0.95']]);

        // Turn round mid-transition, repeatedly: 5 → 4 → 5 → 4 → 3 → 4.
        await page.click('#ntBack');
        await page.waitForTimeout(250);
        await page.click('#ntNext');
        await page.waitForTimeout(150);
        await page.click('#ntBack');
        await page.click('#ntBack');
        await page.waitForTimeout(90);
        await page.click('#ntNext');
        assert.equal(await page.evaluate(() => window.__neant.busy), true, 'still mid-transition');
        await settled(page);
        s = await rest(page);
        assert.deepEqual([s.step, s.shown, s.words, s.styled, s.inert], [4, ['base'], 0, 0, 0]);

        // Interrupted while chapter 01 is still writing itself.
        await page.click('.nt-progress [data-goto="0"]');
        await page.waitForTimeout(1200);
        assert.ok(await page.evaluate(() => document.querySelectorAll('.nt-glyph').length) > 0, 'caught mid-reveal');
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(60);
        await page.keyboard.press('ArrowRight');
        await settled(page);
        s = await rest(page);
        assert.deepEqual([s.step, s.shown, s.words, s.styled, s.ghost], [2, ['opening'], 0, 0, false]);

        // Chapter jumps from the progress bar.
        await page.click('.nt-progress [data-goto="5"]');
        await page.click('.nt-progress [data-goto="2"]', { force: true });
        await settled(page);
        assert.deepEqual((await rest(page)).shown, ['opening']);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('skips, replays and answers the keyboard', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        await page.click('#ntSkip');
        await settled(page);
        assert.equal((await rest(page)).step, 5);

        await page.click('#ntReplay');
        await settled(page);
        assert.equal((await rest(page)).step, 0);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'ntNext');

        await page.keyboard.press('End');
        await settled(page);
        assert.equal((await rest(page)).step, 5);
        // Chapter 03 scrolls like a page: the arrows are left alone.
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__neant.target), 5);

        await page.click('#ntBack');
        await settled(page);
        await page.keyboard.press('Home');
        await settled(page);
        await page.keyboard.press('Escape');
        await settled(page);
        assert.equal((await rest(page)).step, 5);

        // Typing in the field never navigates.
        await page.click('#ntBack');
        await settled(page);
        await page.click('#ntNext');
        await settled(page);
        await page.fill('#ntEmail', 'a');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Space');
        assert.equal(await page.evaluate(() => window.__neant.target), 5);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('under reduced motion uses short crossfades, writes no letters and never moves by itself', async () => {
        const { context, page } = await visitor(browser, { reducedMotion: 'reduce' });
        const t0 = Date.now();
        await open(page, stack.origin);
        assert.ok(Date.now() - t0 < 4000);
        let s = await rest(page);
        assert.deepEqual([s.step, s.running], [0, []], 'the reflection holds still');

        await page.click('#ntNext');
        assert.equal(await page.evaluate(() => document.querySelectorAll('.nt-glyph').length), 0);
        const t1 = Date.now();
        await settled(page);
        assert.ok(Date.now() - t1 < 1500, 'a crossfade, not a sequence');
        await page.click('#ntBack');
        await settled(page);
        await page.waitForTimeout(3500);
        s = await rest(page);
        assert.equal(s.step, 0, 'no automatic advance');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('fits a phone, swipes between passages and keeps chapter 03 a page', async () => {
        const { context, page } = await visitor(browser, { viewport: PHONE, touch: true });
        await open(page, stack.origin);

        const swipe = (dx, dy) => page.evaluate(([x, y]) => {
            const at = (cx, cy) => new Touch({ identifier: 1, target: document.body, clientX: cx, clientY: cy });
            document.body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [at(200, 400)], changedTouches: [at(200, 400)] }));
            document.body.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [at(200 + x, 400 + y)] }));
        }, [dx, dy]);

        await swipe(-120, 0);
        await settled(page);
        assert.equal((await rest(page)).step, 1);
        await swipe(0, -140);
        await settled(page);
        assert.equal((await rest(page)).step, 2);
        await swipe(20, 10);   // too small to count
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__neant.target), 2);
        await swipe(110, 0);
        await settled(page);
        assert.equal((await rest(page)).step, 1);

        for (let step = 2; step <= 5; step++) {
            await page.locator('#ntNext').tap();
            await settled(page);
            const s = await rest(page);
            assert.ok(s.overflow <= 0, `no sideways scroll on ${IDS[step]}`);
            if (step < 5) {
                const bar = await page.locator('#ntControls').boundingBox();
                assert.ok(bar.y + bar.height <= PHONE.height + 1, 'controls stay on screen');
                const content = await page.evaluate((id) => {
                    const scene = document.getElementById(id);
                    const bottoms = [...scene.querySelectorAll('[data-reveal]')].map((el) => el.getBoundingClientRect().bottom);
                    return Math.max(...bottoms);
                }, IDS[step]);
                assert.ok(content <= bar.y + 2, `${IDS[step]} is not covered by the controls`);
            }
        }

        // Chapter 03 scrolls; its controls close the page instead of covering it.
        const pos = await page.evaluate(() => getComputedStyle(document.getElementById('ntControls')).position);
        assert.equal(pos, 'absolute');
        await page.locator('#ntEmail').scrollIntoViewIfNeeded();
        await page.locator('#ntEmail').tap();
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('nt-typing')), true);
        const submit = await page.locator('#ntSubmit').boundingBox();
        assert.ok(submit.width >= 300 && submit.height >= 44, 'a full-width, touch-sized button');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('signs up for the unveiling with NÉANT recorded, and shows every error in place', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin, '#unveiling');
        assert.equal((await rest(page)).step, 5);

        let posts = 0;
        page.on('request', (req) => { if (req.url().endsWith('/api/newsletter') && req.method() === 'POST') posts += 1; });
        const status = () => page.locator('#ntFormStatus').textContent();
        const state = () => page.locator('#ntForm').getAttribute('data-state');

        await page.fill('#ntEmail', 'not-an-email');
        await page.click('#ntSubmit');
        assert.equal(await status(), 'Please enter a valid email address.');
        assert.equal(await page.getAttribute('#ntEmail', 'aria-invalid'), 'true');
        assert.equal(posts, 0, 'nothing sent for an invalid address');
        await page.fill('#ntEmail', 'neant@example');
        assert.equal(await status(), '', 'the error clears as the visitor corrects it');

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
        assert.equal(await state(), 'error');
        await page.unroute('**/api/newsletter');

        const { rows: none } = await stack.db.query("select 1 from newsletter_subscribers where email = 'collector@example.com'");
        assert.equal(none.length, 0, 'no false success, nothing saved');

        await page.click('#ntSubmit');
        await page.waitForFunction(() => document.getElementById('ntForm').dataset.state === 'success');
        assert.equal(await status(), 'You are on the list for the unveiling. Please check your email.');
        assert.equal(await page.isVisible('#ntEmail'), false);
        const { rows } = await stack.db.query(
            "select status, sources, interests from newsletter_subscribers where email = 'collector@example.com'");
        assert.deepEqual(rows[0], { status: 'subscribed', sources: ['newsletter'], interests: ['neant'] });
        assert.ok(stack.emails.some((m) => m.to === 'collector@example.com'), 'the existing welcome email is sent');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('speaks the language chosen in the shop', async () => {
        const { context, page } = await visitor(browser, { lang: 'fr' });
        await open(page, stack.origin, '#unveiling');
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'fr');
        assert.equal(await page.locator('#ntSubmit').textContent(), 'Recevoir le dévoilement');
        assert.equal(await page.locator('#unveiling .nt-status').textContent(), 'Bientôt');
        assert.match(await page.locator('#ntBottleImg').getAttribute('alt'), /flacon NÉANT/);
        await context.close();
    });

    it('comes back to the unveiling from the collection, and stops every effect when left or hidden', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        await page.click('#ntSkip');
        await settled(page);

        // The bottle answers the pointer only while chapter 03 is shown.
        const box = await page.locator('#frStage').boundingBox();
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6, { steps: 4 });
        assert.equal(await page.evaluate(() => window.__neant.stageRunning), true);
        await page.click('#ntBack');
        assert.equal(await page.evaluate(() => window.__neant.stageRunning), false);
        await page.click('#ntNext');
        await settled(page);

        await page.click('.nt-nav a[href="/shop"]');
        await page.waitForURL(/\/shop$/);
        await page.goBack();
        await page.waitForURL(/\/fragrance#unveiling$/);
        await settled(page);
        assert.deepEqual((await rest(page)).shown, ['unveiling']);

        // Hidden mid-transition: it lands at once, and everything holds still.
        await page.click('#ntReplay');
        await settled(page);
        await page.click('#ntNext');
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        const paused = await page.evaluate(() => ({
            busy: window.__neant.busy,
            step: window.__neant.step,
            paused: document.documentElement.classList.contains('nt-paused'),
            running: document.getAnimations().filter((a) => a.playState === 'running'
                && getComputedStyle(a.effect.target).animationPlayState !== 'paused').length
        }));
        assert.deepEqual(paused, { busy: false, step: 1, paused: true, running: 0 });
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('nt-paused')), false);
        assert.deepEqual(page.errors, []);
        await context.close();
    });
});
