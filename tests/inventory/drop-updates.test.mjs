// "Get Drop Updates": the product dialog turning into the newsletter scene
// and back, in Chromium, against the real handlers and database.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const DESKTOP = { width: 1280, height: 640 };   // short, so the panel really scrolls
const PHONE = { width: 390, height: 844 };

async function subscriber(stack, email) {
    const { rows } = await stack.db.query(
        'select status, sources, interests from newsletter_subscribers where email = $1', [email]);
    return rows[0] || null;
}

async function open(browser, stack, { viewport = DESKTOP, language = 'en', reducedMotion = 'no-preference', mobile = false, product = 'Levitate Tee' } = {}) {
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
    await page.locator(`.product-card[data-product-name="${product}"] .product-image`).click();
    await page.waitForSelector('#productDetailOverlay.open');
    await page.waitForTimeout(900);   // the dialog's own opening animation
    return { context, page };
}

const view = (page) => page.evaluate(() => pdNl.view);
const waitView = (page, v, timeout = 6000) => page.waitForFunction((x) => pdNl.view === x, v, { timeout });

// Where the visible product state lives.
const productState = (page) => page.evaluate(() => {
    const scroller = getComputedStyle(document.querySelector('.product-detail-panel')).overflowY === 'auto'
        ? document.querySelector('.product-detail-panel') : document.getElementById('productDetailOverlay');
    return {
        size: pdState.size,
        activeSize: (document.querySelector('#pdSizes .pd-size.active') || {}).textContent || '',
        image: document.getElementById('pdMediaPhoto').dataset.view,
        accordions: [...document.querySelectorAll('[data-accordion]')].map((a) => a.classList.contains('open')),
        scrollTop: scroller.scrollTop,
        windowY: window.scrollY
    };
});

describe('drop updates scene', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
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

    it('goes from the piece to the scene and back, with everything as it was', async () => {
        const { context, page } = await open(browser, stack);
        assert.equal((await page.locator('#pdAdvisor').textContent()).trim(), 'Get Drop Updates');

        // A real visitor's state: a size, the back view, an accordion open,
        // the panel scrolled.
        await page.click('#pdSizes [data-pd-size="L"]');
        await page.click('[data-pd-view="back"]');
        await page.click('[data-accordion-trigger]');
        await page.locator('#pdAdvisor').scrollIntoViewIfNeeded();
        await page.evaluate(() => { document.querySelector('.product-detail-panel').scrollTop += 37; });
        await page.locator('#pdAdvisor').scrollIntoViewIfNeeded();
        const before = await productState(page);
        assert.ok(before.scrollTop > 0, 'the panel is scrolled');
        assert.deepEqual([before.size, before.image, before.accordions[0]], ['L', 'back', true]);

        await page.click('#pdAdvisor');
        assert.equal(await view(page), 'entering');
        assert.equal(await page.evaluate(() => pdNl.total >= 1600 && pdNl.total <= 2000), true, 'a 1.6–2s sequence');
        await waitView(page, 'newsletter');

        // One dialog, now about the newsletter, with focus in the field.
        const scene = await page.evaluate(() => ({
            focus: document.activeElement.id,
            labelled: document.querySelector('.product-detail-panel').getAttribute('aria-labelledby'),
            dialogs: document.querySelectorAll('#productDetailOverlay [role="dialog"]').length,
            productInert: document.getElementById('pdLayout').inert,
            title: document.getElementById('pdNlTitle').textContent,
            kicker: document.querySelector('.pd-nl-kicker').textContent,
            copy: document.querySelector('.pd-nl-copy').textContent,
            join: document.getElementById('pdNlSubmit').textContent,
            back: document.getElementById('pdNlBack').textContent.trim(),
            consent: document.getElementById('pdNlConsent').textContent,
            privacy: document.querySelector('#pdNlConsent a').getAttribute('href'),
            scenes: document.querySelectorAll('.pd-nl').length,
            // Timeline animations only (CSS transitions and the ambient CSS
            // loops are the scene's own resting behaviour).
            leftovers: document.getAnimations().filter((a) => a.constructor.name === 'Animation').length
        }));
        assert.deepEqual(scene, {
            focus: 'pdNlEmail', labelled: 'pdNlTitle', dialogs: 1, productInert: true,
            title: 'Enter the inner circle', kicker: 'Private Access',
            copy: 'Be first to discover upcoming drops and new releases.', join: 'Join the list',
            back: 'Back to the piece',
            consent: 'By joining, you agree to receive emails about VOID© drops and new releases. You can unsubscribe at any time. Read our Privacy Policy.',
            privacy: '/privacy-policy.html', scenes: 1, leftovers: 0
        });

        // The hidden piece cannot be reached from the keyboard.
        const reachable = [];
        for (let i = 0; i < 8; i += 1) {
            await page.keyboard.press('Tab');
            reachable.push(await page.evaluate(() => document.activeElement.id || document.activeElement.className));
        }
        assert.ok(reachable.every((id) => ['pdNlEmail', 'pdNlSubmit', 'pdNlBack', 'pdClose', ''].includes(id) || /privacy/.test(id) || id === ''), reachable.join(','));
        assert.ok(!reachable.some((id) => /pd-size|pdAdd|pdAdvisor/.test(id)), 'no product control takes focus');

        await page.click('#pdNlBack');
        assert.equal(await view(page), 'leaving');
        await waitView(page, 'product');
        const after = await productState(page);
        assert.deepEqual(after, before, 'size, image, accordion, scroll and page position all restored');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'pdAdvisor', 'focus back on the trigger');
        assert.equal(await page.evaluate(() => document.querySelector('.product-detail-panel').getAttribute('aria-labelledby')), 'pdName');
        assert.equal(await page.locator('#pdNewsletter').isHidden(), true);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('treats close and Escape as "back" in the scene, and as close on the piece', async () => {
        const { context, page } = await open(browser, stack);
        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');
        await page.click('#pdClose');
        await waitView(page, 'product');
        assert.equal(await page.locator('#productDetailOverlay.open').count(), 1, 'close returned to the piece');

        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');
        await page.keyboard.press('Escape');
        await waitView(page, 'product');
        assert.equal(await page.locator('#productDetailOverlay.open').count(), 1, 'Escape returned to the piece');

        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');
        await page.mouse.click(5, 5);   // the backdrop
        await waitView(page, 'product');
        assert.equal(await page.locator('#productDetailOverlay.open').count(), 1, 'the backdrop returned to the piece');

        await page.keyboard.press('Escape');
        await page.waitForSelector('#productDetailOverlay:not(.open)');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('survives rapid clicks, interruptions, closing and reopening', async () => {
        const { context, page } = await open(browser, stack);
        const cartBefore = await page.evaluate(() => localStorage.getItem('voidCart'));

        // Hammer the trigger: one scene, one transition.
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) document.getElementById('pdAdvisor').click(); });
        assert.equal(await page.evaluate(() => document.querySelectorAll('.pd-nl').length), 1);
        const animsOnce = await page.evaluate(() => pdNl.anims.length);

        // Clicks mid-transition do not reach the piece underneath.
        await page.waitForTimeout(250);
        const addBox = await page.locator('#pdAdd').boundingBox();
        await page.mouse.click(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2);
        assert.equal(await page.evaluate(() => localStorage.getItem('voidCart')), cartBefore, 'nothing was bagged');

        // Escape half way: it turns round where it stands, no restart.
        await page.waitForTimeout(250);
        const at = await page.evaluate(() => pdNl.anims[0].currentTime);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');   // a second press while returning changes nothing
        assert.equal(await view(page), 'leaving');
        assert.equal(await page.evaluate(() => pdNl.anims.length), animsOnce, 'the same animations, reversed');
        assert.ok(await page.evaluate(() => pdNl.anims[0].currentTime) <= at + 40);
        await waitView(page, 'product', 3000);
        assert.equal(await page.locator('#productDetailOverlay.open').count(), 1);
        assert.equal(await page.evaluate(() => document.getElementById('pdLayout').inert), false, 'controls are live again');
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pd-media')).opacity), '1');

        // Forward again, close the whole dialog mid-way, reopen: a clean piece.
        await page.click('#pdAdvisor');
        await page.waitForTimeout(300);
        await page.evaluate(() => closeProductDetail());
        await page.waitForSelector('#productDetailOverlay:not(.open)');
        assert.equal(await page.evaluate(() => pdNl.view), 'product');
        assert.equal(await page.evaluate(() => pdNl.anims.length), 0, 'every effect stopped');
        assert.equal(await page.evaluate(() => document.getAnimations()
            .filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#pdNewsletter')).length), 0,
            'the motes and the glow stop with the dialog');
        assert.equal(await page.locator('#pdNewsletter').isHidden(), true);
        await page.locator('.product-card[data-product-name="Levitate Tee"] .product-image').click();
        await page.waitForSelector('#productDetailOverlay.open');
        await page.waitForTimeout(900);
        assert.equal(await page.locator('#pdAdd').isVisible(), true);
        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('saves a signup with the piece as interest, and only says so once the server has', async () => {
        const { context, page } = await open(browser, stack);
        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');

        // Hold the request so the in-between state can be seen.
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        await page.route('**/api/newsletter', async (route) => { await held; await route.continue(); });
        await page.fill('#pdNlEmail', 'scene@example.com');
        await page.click('#pdNlSubmit');
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'loading');
        assert.equal(await page.locator('#pdNlStatus').textContent(), 'Joining…');
        assert.equal(await page.locator('#pdNlSubmit').isDisabled(), true);
        assert.equal(await subscriber(stack, 'scene@example.com'), null, 'nothing claimed before the server answers');
        release();
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'success');
        assert.equal(await page.locator('#pdNlStatus').textContent(), 'You are on the list. Please check your email.');
        await page.unroute('**/api/newsletter');

        assert.deepEqual(await subscriber(stack, 'scene@example.com'),
            { status: 'subscribed', sources: ['newsletter'], interests: ['levitate-tee'] });
        const mail = stack.emails.at(-1);
        assert.equal(mail.to, 'scene@example.com');
        assert.equal(mail.subject, 'Thank you for signing up to VOID');
        assert.match(mail.headers['List-Unsubscribe'], /\/api\/unsubscribe\?token=[0-9a-f]{64}>/);

        // The same address again, from another piece: one row, both interests,
        // no second welcome within the day, the same answer.
        await page.click('#pdNlBack');
        await waitView(page, 'product');
        await page.click('#pdClose');
        await page.waitForSelector('#productDetailOverlay:not(.open)');
        await page.locator('.product-card[data-product-name="Endzustand Tee"] .product-image').click();
        await page.waitForSelector('#productDetailOverlay.open');
        await page.waitForTimeout(900);
        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');
        assert.equal(await page.inputValue('#pdNlEmail'), '', 'a fresh form after a completed signup');
        const mailCount = stack.emails.length;
        await page.fill('#pdNlEmail', 'scene@example.com');
        await page.click('#pdNlSubmit');
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'success');
        assert.deepEqual((await subscriber(stack, 'scene@example.com')).interests, ['levitate-tee', 'endzustand-tee']);
        assert.equal(stack.emails.length, mailCount);
        const { rows } = await stack.db.query("select count(*)::int as n from newsletter_subscribers where email = 'scene@example.com'");
        assert.equal(rows[0].n, 1);
        await context.close();
    });

    it('keeps unsubscribed addresses suppressed until they sign up again here', async () => {
        await stack.api('POST', '/api/newsletter', { email: 'gone@example.com' });
        await stack.api('POST', '/api/unsubscribe', { email: 'gone@example.com' });
        assert.equal((await subscriber(stack, 'gone@example.com')).status, 'unsubscribed');
        const { context, page } = await open(browser, stack);
        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');
        await page.fill('#pdNlEmail', 'gone@example.com');
        await page.click('#pdNlSubmit');
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'success');
        assert.equal((await subscriber(stack, 'gone@example.com')).status, 'subscribed', 'an explicit signup is new consent');
        await context.close();
    });

    it('shows validation and backend errors in place, never a false success', async () => {
        const { context, page } = await open(browser, stack);
        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');

        let requests = 0;
        page.on('request', (req) => { if (req.url().endsWith('/api/newsletter')) requests += 1; });
        await page.fill('#pdNlEmail', 'not-an-email');
        await page.click('#pdNlSubmit');
        assert.equal(await page.locator('#pdNlStatus').textContent(), 'Please enter a valid email address.');
        assert.equal(await page.getAttribute('#pdNlEmail', 'aria-invalid'), 'true');
        assert.equal(requests, 0, 'nothing sent for an invalid address');

        await page.route('**/api/newsletter', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"message":"x"}' }));
        await page.fill('#pdNlEmail', 'down@example.com');
        await page.click('#pdNlSubmit');
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'error');
        assert.equal(await page.locator('#pdNlStatus').textContent(), 'We could not add you just now. Please try again.');
        assert.equal(await page.locator('#pdNlSubmit').isDisabled(), false, 'the form can be tried again');

        await page.route('**/api/newsletter', (route) => route.abort());
        await page.click('#pdNlSubmit');
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'error');
        await page.unroute('**/api/newsletter');

        // A real backend failure: the save is refused, nothing is emailed.
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        process.env.SUPABASE_SERVICE_ROLE_KEY = stack.signJwt({ role: 'anon' });
        try {
            const mails = stack.emails.length;
            await page.click('#pdNlSubmit');
            await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'error'
                && !document.getElementById('pdNlSubmit').disabled);
            assert.equal(stack.emails.length, mails);
        } finally {
            process.env.SUPABASE_SERVICE_ROLE_KEY = key;
        }
        assert.equal(await subscriber(stack, 'down@example.com'), null);

        // A failed welcome email: saved, and said honestly.
        stack.mail.failures = 1;
        await page.click('#pdNlSubmit');
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'success');
        assert.equal(await page.locator('#pdNlStatus').textContent(), 'You are on the list. We could not send the confirmation email just now.');
        assert.equal((await subscriber(stack, 'down@example.com')).status, 'subscribed');
        await context.close();
    });

    it('opens the same scene from a sold-out piece, with that piece as interest', async () => {
        await stack.db.query("update inventory_items set on_hand = 0, sold = 1 where product_slug = 'endzustand-tee'");
        const { context, page } = await open(browser, stack, { product: 'Endzustand Tee' });
        await page.waitForSelector('#pdNotify:not([hidden])');
        await page.click('#pdNotify');
        await waitView(page, 'newsletter');
        await page.fill('#pdNlEmail', 'notify@example.com');
        await page.click('#pdNlSubmit');
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'success');
        assert.deepEqual((await subscriber(stack, 'notify@example.com')).interests, ['endzustand-tee']);
        await page.click('#pdNlBack');
        await waitView(page, 'product');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'pdNotify', 'focus back on its trigger');
        await stack.db.query("update inventory_items set on_hand = case size when 'S' then 2 when 'M' then 16 when 'L' then 10 else 2 end, sold = 0 where product_slug = 'endzustand-tee'");
        await context.close();
    });

    it('uses a short, simple crossfade under reduced motion', async () => {
        const { context, page } = await open(browser, stack, { reducedMotion: 'reduce' });
        await page.click('#pdAdvisor');
        const shape = await page.evaluate(() => ({
            total: pdNl.total,
            split: document.querySelectorAll('.pd-nl-glyph').length,
            transforms: pdNl.anims.some((a) => a.effect.getKeyframes().some((k) => k.transform || k.filter || k.strokeDashoffset != null))
        }));
        assert.ok(shape.total <= 320, `short (${shape.total}ms)`);
        assert.deepEqual([shape.split, shape.transforms], [0, false], 'no letter reveal, nothing travels');
        await waitView(page, 'newsletter', 1500);
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pd-nl-mote')).animationName), 'none');
        await page.keyboard.press('Escape');
        await waitView(page, 'product', 1500);
        await context.close();
    });

    for (const [language, expect] of Object.entries({
        en: { trigger: 'Get Drop Updates', title: 'Enter the inner circle', join: 'Join the list', back: 'Back to the piece', invalid: 'Please enter a valid email address.' },
        fr: { trigger: 'Être informé des drops', title: 'Entrez dans le cercle intime', join: 'Rejoindre la liste', back: 'Retour à la pièce', invalid: 'Veuillez saisir une adresse e-mail valide.' },
        it: { trigger: 'Ricevi aggiornamenti sui drop', title: 'Entra nella cerchia ristretta', join: 'Unisciti alla lista', back: 'Torna al capo', invalid: 'Inserisci un indirizzo email valido.' },
        de: { trigger: 'Drop-Updates erhalten', title: 'Tritt in den inneren Kreis ein', join: 'Der Liste beitreten', back: 'Zurück zum Stück', invalid: 'Bitte gib eine gültige E-Mail-Adresse ein.' }
    })) {
        it(`is fully translated: ${language}`, async () => {
            const { context, page } = await open(browser, stack, { language });
            assert.equal((await page.locator('#pdAdvisor').textContent()).trim(), expect.trigger);
            await page.click('#pdAdvisor');
            await waitView(page, 'newsletter');
            const copy = await page.evaluate(() => ({
                title: document.getElementById('pdNlTitle').textContent,
                join: document.getElementById('pdNlSubmit').textContent,
                back: document.getElementById('pdNlBack').textContent.trim(),
                close: document.getElementById('pdClose').getAttribute('aria-label'),
                consentHasLink: Boolean(document.querySelector('#pdNlConsent a[href="/privacy-policy.html"]')),
                kicker: document.querySelector('.pd-nl-kicker').textContent
            }));
            assert.deepEqual([copy.title, copy.join, copy.back, copy.close, copy.consentHasLink],
                [expect.title, expect.join, expect.back, expect.back, true]);
            if (language !== 'en') assert.notEqual(copy.kicker, 'Private Access');
            await page.fill('#pdNlEmail', 'x');
            await page.click('#pdNlSubmit');
            assert.equal(await page.locator('#pdNlStatus').textContent(), expect.invalid);
            await context.close();
        });
    }

    it('fits a phone, keeps its controls in view, and restores the sheet exactly', async () => {
        const { context, page } = await open(browser, stack, { viewport: PHONE, mobile: true });
        await page.click('#pdSizes [data-pd-size="M"]');
        await page.locator('#pdAdvisor').scrollIntoViewIfNeeded();
        const before = await productState(page);
        assert.ok(before.scrollTop > 0, 'the sheet is scrolled');
        await page.click('#pdAdvisor');
        await waitView(page, 'newsletter');
        const fit = await page.evaluate(() => {
            const scene = document.getElementById('pdNewsletter').getBoundingClientRect();
            const box = (id) => document.getElementById(id).getBoundingClientRect();
            const inView = (r) => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
            return {
                scene: [Math.round(scene.top), Math.round(scene.height)],
                horizontalOverflow: document.documentElement.scrollWidth > innerWidth
                    || document.getElementById('productDetailOverlay').scrollWidth > innerWidth,
                controls: ['pdNlEmail', 'pdNlSubmit', 'pdNlBack'].every((id) => inView(box(id))),
                inputFont: getComputedStyle(document.getElementById('pdNlEmail')).fontSize
            };
        });
        assert.ok(Math.abs(fit.scene[0]) <= 1 && Math.abs(fit.scene[1] - PHONE.height) <= 2, `scene covers the screen (${fit.scene})`);
        assert.equal(fit.horizontalOverflow, false);
        assert.equal(fit.controls, true);
        assert.equal(fit.inputFont, '16px', 'no zoom-on-focus on iOS');

        // With the keyboard open the visual viewport shrinks; the field stays reachable.
        await page.setViewportSize({ width: PHONE.width, height: 420 });
        await page.waitForTimeout(200);
        await page.focus('#pdNlEmail');
        await page.locator('#pdNlSubmit').scrollIntoViewIfNeeded();
        const short = await page.evaluate(() => {
            const r = document.getElementById('pdNlSubmit').getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight;
        });
        assert.equal(short, true, 'the button can be reached above the keyboard');
        await page.setViewportSize(PHONE);
        await page.waitForTimeout(200);

        await page.click('#pdNlBack');
        await waitView(page, 'product');
        const after = await productState(page);
        assert.deepEqual([after.size, after.scrollTop, after.windowY], [before.size, before.scrollTop, before.windowY]);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('leaves the footer newsletter form working on its own', async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        await context.addInitScript(() => { localStorage.setItem('void-gate-disabled', '1'); });
        const page = await context.newPage();
        await page.goto(`${stack.origin}/shop`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1600);
        if (await page.locator('#voidAuth[aria-hidden="false"]').count()) await page.locator('#voidAuthClose').click();
        await page.locator('#newsletterEmail').scrollIntoViewIfNeeded();
        await page.fill('#newsletterEmail', 'footer-only@example.com');
        await page.click('#newsletterButton');
        await page.waitForFunction(() => /Thank you for signing up/.test(document.getElementById('newsletterResponse').textContent));
        assert.deepEqual(await subscriber(stack, 'footer-only@example.com'), { status: 'subscribed', sources: ['newsletter'], interests: [] });
        await context.close();
    });
});
