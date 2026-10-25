// /fragrance — NÉANT in Chromium: a page the browser scrolls on its own
// (wheel, trackpad, touch, keyboard, anchors, history), the product and its
// one action in the first viewport, honest about what is not yet known, the
// bag handed to the existing checkout, the phone dock, reduced motion, four
// languages, and "Receive the unveiling" against the real newsletter backend.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const DESKTOP = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 740 };

async function visitor(browser, { viewport = DESKTOP, reducedMotion = 'no-preference', lang = 'en', touch = false, init } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion, hasTouch: touch, isMobile: touch });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await context.addInitScript(([l, extra]) => {
        try {
            localStorage.setItem('void-gate-disabled', '1');
            localStorage.setItem('voidLanguage', l);
            if (extra && !sessionStorage.getItem('seeded')) {
                Object.entries(extra).forEach(([k, v]) => localStorage.setItem(k, v));
                sessionStorage.setItem('seeded', '1');
            }
        } catch (e) { /* ignore */ }
    }, [lang, init || null]);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message));
    return { context, page };
}

async function open(page, origin, hash = '') {
    await page.goto(`${origin}/fragrance${hash}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.fonts.status === 'loaded');
}

const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
const inView = (page, sel) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
}, sel);

describe('NÉANT page', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
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

    it('opens on the product: name, concentration, status and the action in the first viewport', async () => {
        for (const viewport of [DESKTOP, LAPTOP, PHONE, SMALL]) {
            const touch = viewport.width < 500;
            const { context, page } = await visitor(browser, { viewport, touch });
            await open(page, stack.origin);
            const hero = await page.evaluate(() => {
                const box = (s) => document.querySelector(s).getBoundingClientRect();
                return {
                    title: document.getElementById('ntTitle').textContent.replace(/\s+/g, ' ').trim(),
                    h1s: document.querySelectorAll('h1').length,
                    titleBottom: box('#ntTitle').bottom,
                    bottleBottom: box('#ntBottleImg').bottom,
                    submitBottom: box('#ntSubmit').bottom,
                    status: document.querySelector('#neant .nt-status').textContent.trim(),
                    tba: document.querySelector('#neant .nt-facts').textContent.includes('To be announced'),
                    overflow: document.documentElement.scrollWidth - window.innerWidth
                };
            });
            const label = `${viewport.width}×${viewport.height}`;
            assert.equal(hero.title, 'Néant Extrait de Parfum', label);
            assert.equal(hero.h1s, 1);
            assert.ok(hero.bottleBottom <= viewport.height, `${label}: the bottle is in view`);
            assert.ok(hero.titleBottom <= viewport.height, `${label}: the name is in view`);
            assert.ok(hero.submitBottom <= viewport.height, `${label}: the action is in view (${hero.submitBottom})`);
            assert.equal(hero.status, 'Coming Soon');
            assert.equal(hero.tba, true, 'size and price are flagged, not invented');
            assert.ok(hero.overflow <= 0, `${label}: no sideways scroll`);
            assert.deepEqual(page.errors, []);
            await context.close();
        }
    });

    it('never offers NÉANT for sale, and shows only real prices for pieces that exist', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        // NÉANT has no catalogue entry: no price, no bag control, nowhere.
        assert.equal(await page.locator('#neant, #scent, #details').getByText(/€|\$|£/).count(), 0);
        assert.equal(await page.getByRole('button', { name: /add to (bag|cart)/i }).count(), 0);
        // The collection strip carries the boutique's own figures.
        const pieces = await page.$$eval('.nt-piece', (els) => els.map((el) => [
            el.querySelector('.nt-piece-name').textContent, el.querySelector('.nt-piece-price').textContent,
            el.querySelector('a').getAttribute('href')]));
        assert.deepEqual(pieces, [['Levitate Tee', '€200', '/shop'], ['Endzustand Tee', '€200', '/shop']]);
        const shop = await page.request.get(`${stack.origin}/shop`);
        const html = await shop.text();
        for (const [name, price] of pieces) {
            assert.match(html, new RegExp(`data-product-name="${name}" data-product-price="${price.slice(1)}"`), `${name} matches the boutique`);
        }
        // Every image the page uses arrives, including the lazy ones.
        await page.locator('#collection').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.images].every((i) => i.complete));
        const images = await page.$$eval('img', (els) => els.map((i) => [i.currentSrc || i.src, i.naturalWidth > 0]));
        for (const [src, ok] of images) assert.ok(ok, `${src} loaded`);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('scrolls natively and at once: wheel, long wheel, keyboard and touch carry through the page', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        const overflow = await page.evaluate(() => [getComputedStyle(document.documentElement).overflowY, getComputedStyle(document.body).overflowY]);
        assert.ok(!overflow.includes('hidden'), 'the page is never locked');
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType), 'none');

        // One notch moves the page straight away.
        await page.mouse.move(700, 450);
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(150);
        assert.ok(await scrollY(page) > 0, 'the first wheel notch scrolls');

        // A long gesture carries through several sections, not one at a time.
        const cdp = await context.newCDPSession(page);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await cdp.send('Input.synthesizeScrollGesture', { x: 700, y: 450, yDistance: -2400, speed: 6000, gestureSourceType: 'mouse' });
        const afterLong = await scrollY(page);
        assert.ok(afterLong >= 2000, `a long gesture travels (${afterLong})`);
        assert.equal(await inView(page, '#neant'), false, 'past the hero in one gesture');

        // Keys.
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.locator('body').click({ position: { x: 5, y: 600 } });
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(400);
        assert.ok(await scrollY(page) > 300, 'PageDown');
        await page.keyboard.press('End');
        await page.waitForFunction(() => window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2);
        await page.waitForTimeout(300);   // let the End scroll settle
        await page.keyboard.press('Home');
        await page.waitForFunction(() => window.scrollY < 2, null, { polling: 100, timeout: 5000 });
        await page.keyboard.press('Space');
        await page.waitForTimeout(400);
        assert.ok(await scrollY(page) > 300, 'Space');
        await context.close();

        // A phone swipe: the page follows the finger, and a second flick
        // carries on with the browser's own momentum.
        const phone = await visitor(browser, { viewport: PHONE, touch: true });
        await open(phone.page, stack.origin);
        const pcdp = await phone.context.newCDPSession(phone.page);
        const swipe = async () => {
            await pcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 700 }] });
            for (let i = 1; i <= 12; i++) {
                await pcdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 700 - i * 40 }] });
                await new Promise((r) => setTimeout(r, 8));
            }
            await pcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await phone.page.waitForTimeout(1200);
        };
        await swipe();
        const first = await scrollY(phone.page);
        assert.ok(first >= 400, `the page follows the finger (${first})`);
        await swipe();
        const second = await scrollY(phone.page);
        assert.ok(second >= first + 400, `and keeps going (${second})`);
        assert.deepEqual(phone.page.errors, []);
        await phone.context.close();
    });

    it('lands section links below the header, keeps old addresses working and restores history', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);
        await page.click('.nt-nav a[href="#scent"]');
        await page.waitForFunction(() => location.hash === '#scent');
        await page.waitForFunction(() => Math.abs(document.getElementById('scent').getBoundingClientRect().top
            - document.getElementById('ntNav').getBoundingClientRect().bottom) < 40);
        assert.equal(await page.evaluate(() => document.getElementById('ntNav').classList.contains('is-solid')), true);

        // The movements kept their anchors; the passages that meant "the
        // product" now mean the top of the page.
        await open(page, stack.origin, '#heart');
        await page.waitForTimeout(300);
        assert.equal(await inView(page, '#heart'), true);
        await open(page, stack.origin, '#unveiling');
        assert.equal(await page.evaluate(() => location.hash), '');
        assert.equal(await scrollY(page), 0);

        // Scrolled to the collection, to the shop and back: the position holds.
        await page.evaluate(() => document.getElementById('collection').scrollIntoView({ behavior: 'instant' }));
        const before = await scrollY(page);
        await page.click('.nt-piece a');
        await page.waitForURL(/\/shop$/);
        await page.goBack();
        await page.waitForURL(/\/fragrance$/);
        await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 4, before);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('counts the bag the checkout will see and hands it over', async () => {
        const cart = JSON.stringify([
            { name: 'Levitate Tee', size: 'L', price: 200, quantity: 2 },
            { name: 'Insigne Noir', size: 'M', price: 250, quantity: 1 },   // a preview piece: never counted
            { name: 'broken' }
        ]);
        const { context, page } = await visitor(browser, { init: { voidCart: cart } });
        await open(page, stack.origin);
        assert.equal(await page.locator('#ntBagCount').textContent(), '2');
        assert.equal(await page.getAttribute('#ntBag', 'aria-label'), 'Bag, 2 items');
        assert.equal(await page.getAttribute('#ntBag', 'href'), '/checkout');

        // Another tab changes the bag: the count follows.
        await page.evaluate(() => {
            localStorage.setItem('voidCart', '[]');
            window.dispatchEvent(new StorageEvent('storage', { key: 'voidCart' }));
        });
        assert.equal(await page.isHidden('#ntBagCount'), true);
        assert.equal(await page.getAttribute('#ntBag', 'aria-label'), 'Bag, empty');
        await page.evaluate((c) => {
            localStorage.setItem('voidCart', c);
            window.dispatchEvent(new StorageEvent('storage', { key: 'voidCart' }));
        }, cart);

        await page.click('#ntBag');
        await page.waitForURL(/\/checkout$/);
        await page.waitForSelector('#ckShell:not([data-cart="loading"])');
        assert.notEqual(await page.getAttribute('#ckShell', 'data-cart'), 'empty', 'the checkout received the bag');
        await context.close();
    });

    it('keeps the action within reach on a phone without covering the page', async () => {
        const { context, page } = await visitor(browser, { viewport: PHONE, touch: true });
        await open(page, stack.origin);
        const dockShown = () => page.evaluate(() => document.getElementById('ntDock').classList.contains('is-shown'));
        assert.equal(await dockShown(), false, 'not while the form is on screen');

        await page.evaluate(() => document.getElementById('details').scrollIntoView({ behavior: 'instant' }));
        await page.waitForFunction(() => document.getElementById('ntDock').classList.contains('is-shown'));
        await page.waitForTimeout(400);   // its slide-in
        const dock = await page.locator('#ntDock').boundingBox();
        assert.ok(dock.y + dock.height <= PHONE.height + 1 && dock.height >= 56);
        const btn = await page.locator('#ntDock .nt-button').boundingBox();
        assert.ok(btn.height >= 44, 'a touch-sized action');

        // At the end of the page it steps aside, and the footer is never under it.
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
        await page.waitForFunction(() => !document.getElementById('ntDock').classList.contains('is-shown'));
        const footer = await page.locator('#ntFooter').boundingBox();
        assert.ok(footer.y + footer.height <= PHONE.height + 1, 'the footer is fully visible');

        // From the dock straight into the field.
        await page.evaluate(() => document.getElementById('scent').scrollIntoView({ behavior: 'instant' }));
        await page.waitForFunction(() => document.getElementById('ntDock').classList.contains('is-shown'));
        await page.locator('#ntDock .nt-button').tap();
        await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'ntEmail');
        await page.waitForTimeout(700);
        assert.equal(await inView(page, '#ntEmail'), true);
        assert.equal(await dockShown(), false);

        // Every control a thumb needs is at least 44px tall.
        const small = await page.$$eval('.nt-nav a, .nt-bag, .nt-button, .nt-form-submit, .nt-link, .nt-footer a', (els) =>
            els.filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 44).map((el) => el.className || el.textContent));
        assert.deepEqual(small, []);
        const submit = await page.locator('#ntSubmit').boundingBox();
        assert.ok(submit.width >= 300 && submit.height >= 44, 'a full-width, touch-sized button');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('under reduced motion nothing animates and anchors jump', async () => {
        const { context, page } = await visitor(browser, { reducedMotion: 'reduce' });
        await open(page, stack.origin);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
        assert.deepEqual(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length), 0);
        await page.click('.nt-nav a[href="#details"]');
        await page.waitForTimeout(50);
        assert.equal(await inView(page, '#ntDetailsTitle'), true, 'there at once');
        await context.close();

        // And without the preference, the entrance finishes and nothing keeps running.
        const moving = await visitor(browser);
        await open(moving.page, stack.origin);
        await moving.page.waitForTimeout(1300);
        assert.deepEqual(await moving.page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length), 0);
        await moving.context.close();
    });

    it('signs up for the unveiling with NÉANT recorded, and shows every error in place', async () => {
        const { context, page } = await visitor(browser);
        await open(page, stack.origin);

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

        // The details panel's action leads to the same field.
        await page.click('.nt-reserve .nt-button');
        await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'ntEmail');

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
        for (const [lang, submit, status, bag] of [
            ['fr', 'Recevoir le dévoilement', 'Bientôt', 'Panier, vide'],
            ['it', 'Ricevi lo svelamento', 'Prossimamente', 'Carrello, vuoto'],
            ['de', 'Die Enthüllung erhalten', 'Demnächst', 'Warenkorb, leer']
        ]) {
            const { context, page } = await visitor(browser, { lang });
            await open(page, stack.origin);
            assert.equal(await page.evaluate(() => document.documentElement.lang), lang);
            assert.equal(await page.locator('#ntSubmit').textContent(), submit);
            assert.equal(await page.locator('#neant .nt-status').textContent(), status);
            assert.equal(await page.getAttribute('#ntBag', 'aria-label'), bag);
            const english = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
                .filter((el) => /^(Shop the Collection|Discover the Fragrance|To be announced|Key notes|Bag)$/.test(el.textContent)).length);
            assert.equal(english, 0, 'no English left behind');
            await context.close();
        }
    });
});
