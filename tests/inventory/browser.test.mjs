// The storefront and checkout in Chromium, against the same stack as the API
// tests. Every external request (fonts, analytics, CDNs) is blocked so the
// pages run only on what this repository serves.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack, checkoutBody } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const LVT = (size) => `levitate-tee:${size}`;
const END = (size) => `endzustand-tee:${size}`;

async function newShopper(browser, stack, { viewport = { width: 1280, height: 900 }, reducedMotion = 'no-preference', cart } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await context.addInitScript((bag) => {
        try {
            localStorage.setItem('void-gate-disabled', '1');
            localStorage.setItem('voidLanguage', 'en');
            if (bag) localStorage.setItem('voidCart', JSON.stringify(bag));
        } catch (e) { /* ignore */ }
    }, cart || null);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message));
    return { context, page };
}

// Opens the boutique the way a signed-out visitor sees it, and closes the
// member sign-in prompt that greets them.
async function enterShop(page, origin) {
    await page.goto(`${origin}/shop`, { waitUntil: 'domcontentloaded' });
    const close = page.locator('#voidAuthClose');
    await page.waitForTimeout(1600);
    if (await page.locator('#voidAuth[aria-hidden="false"]').count()) await close.click();
    await page.waitForFunction(() => window.voidStockRefresh && document.querySelector('[data-stock-badge]'));
}

const badgeText = (page, name) => page.evaluate((n) => {
    const badge = document.querySelector(`.product-card[data-product-name="${n}"] [data-stock-badge]`);
    return badge && !badge.hidden ? badge.textContent.trim() : '';
}, name);

async function openDetail(page, name) {
    await page.locator(`.product-card[data-product-name="${name}"] .product-image`).click();
    await page.waitForSelector('#productDetailOverlay.open');
}

const pdSnapshot = (page) => page.evaluate(() => ({
    stock: document.getElementById('pdStock').hidden ? null : document.getElementById('pdStock').textContent.trim(),
    sizeStock: document.getElementById('pdSizeStock').textContent.trim(),
    add: { text: document.getElementById('pdAdd').textContent.trim(), disabled: document.getElementById('pdAdd').disabled },
    notify: !document.getElementById('pdNotify').hidden,
    sizes: Object.fromEntries([...document.querySelectorAll('#pdSizes [data-pd-size]')]
        .map((b) => [b.dataset.pdSize, { disabled: b.disabled, flag: (b.querySelector('.pd-size-flag') || {}).textContent || '' }]))
}));

async function setLevitate(stack, sizes) {
    for (const [size, n] of Object.entries(sizes)) await stack.setStock(LVT(size), n);
}

const nudge = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

describe('storefront', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
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

    it('updates both open browsers without a reload', async () => {
        const a = await newShopper(browser, stack);
        const b = await newShopper(browser, stack);
        await enterShop(a.page, stack.origin);
        await enterShop(b.page, stack.origin);

        // 30 available: the normal interface, no urgency label.
        assert.equal(await badgeText(a.page, 'Levitate Tee'), '');
        assert.equal(await badgeText(b.page, 'Endzustand Tee'), '');

        const reloadsBefore = await Promise.all([a.page, b.page].map((p) => p.evaluate(() => performance.getEntriesByType('navigation').length)));

        await setLevitate(stack, { S: 2, M: 0, L: 6, XL: 2 });   // 10 left
        // Session A regains focus; session B is left to its regular poll.
        await nudge(a.page);
        await a.page.waitForFunction(
            () => /Only 10 pieces left/.test(document.querySelector('.product-card[data-product-name="Levitate Tee"] [data-stock-badge]').textContent),
            null, { timeout: 20000 });
        await b.page.waitForFunction(
            () => !document.querySelector('.product-card[data-product-name="Levitate Tee"] [data-stock-badge]').hidden,
            null, { timeout: 25000 });
        assert.equal(await badgeText(b.page, 'Levitate Tee'), 'Only 10 pieces left');

        // A real purchase in a third session moves both.
        const res = await stack.api('POST', '/api/checkout/create', checkoutBody([{ variantId: LVT('L'), quantity: 6 }, { variantId: LVT('XL'), quantity: 2 }]));
        await stack.deliver('payment_intent.succeeded', stack.stripe.succeed(res.data.clientSecret.split('_secret_')[0]));
        await Promise.all([nudge(a.page), nudge(b.page)]);
        // A focus refresh is debounced to one fetch per 2s, so allow up to one
        // full 15s poll interval for each page to pick it up.
        for (const page of [a.page, b.page]) {
            await page.waitForFunction(
                () => /Only 2 pieces left/.test(document.querySelector('.product-card[data-product-name="Levitate Tee"] [data-stock-badge]').textContent),
                null, { timeout: 20000 });
        }

        const reloadsAfter = await Promise.all([a.page, b.page].map((p) => p.evaluate(() => performance.getEntriesByType('navigation').length)));
        assert.deepEqual(reloadsAfter, reloadsBefore, 'no navigation happened');
        assert.deepEqual([...a.page.errors, ...b.page.errors], []);
        await a.context.close();
        await b.context.close();
    });

    it('labels the design and each size separately in the product detail', async () => {
        await setLevitate(stack, { S: 0, M: 1, L: 1, XL: 0 });
        await stack.db.query("update inventory_items set sold = 2 where variant_id = 'levitate-tee:S'");   // S genuinely sold out
        const { context, page } = await newShopper(browser, stack);
        await enterShop(page, stack.origin);
        await openDetail(page, 'Levitate Tee');

        let pd = await pdSnapshot(page);
        assert.equal(pd.stock, 'Only 2 pieces left');
        // XS is not offered for this design at all.
        assert.equal(await page.locator('#pdSizes [data-pd-size="XS"]').isHidden(), true);
        assert.deepEqual(await page.$$eval('#pdSizes [data-pd-size]:not([hidden])', (els) => els.map((e) => e.dataset.pdSize)), ['S', 'M', 'L', 'XL']);
        assert.deepEqual(pd.sizes.S, { disabled: true, flag: 'Sold out' });
        assert.deepEqual(pd.sizes.M, { disabled: false, flag: '' });
        assert.equal(pd.add.disabled, false);

        await page.locator('#pdSizes [data-pd-size="M"]').click();
        pd = await pdSnapshot(page);
        assert.equal(pd.sizeStock, 'Size M · last piece', 'the size speaks for itself, not for the total');
        assert.equal(pd.stock, 'Only 2 pieces left');

        // Add the last M; the bag will not take a second.
        await page.locator('#pdAdd').click();
        await page.waitForSelector('#pdAdded:not([hidden])');
        const bag = await page.evaluate(() => JSON.parse(localStorage.getItem('voidCart')));
        assert.deepEqual(bag.map((i) => [i.name, i.size, i.quantity]), [['Levitate Tee', 'M', 1]]);
        await page.waitForTimeout(1800);
        await page.locator('#pdAdd').click();
        assert.match(await page.locator('#pdSizeStock').textContent(), /already holds every available piece in size M/);
        assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('voidCart'))))[0].quantity, 1);

        // M sells elsewhere while the panel is open: deselected, said plainly,
        // and the panel does not move.
        const addTop = await page.locator('#pdAdd').evaluate((el) => el.getBoundingClientRect().top);
        await stack.setStock(LVT('M'), 0);
        await stack.db.query("update inventory_items set sold = 1 where variant_id = 'levitate-tee:M'");
        await nudge(page);
        // Opening the panel just fetched, so this focus may be debounced onto
        // the next regular poll: allow one interval.
        await page.waitForFunction(() => /no longer available/.test(document.getElementById('pdSizeStock').textContent), null, { timeout: 20000 });
        pd = await pdSnapshot(page);
        assert.equal(pd.stock, 'Last piece available');
        assert.deepEqual(pd.sizes.M, { disabled: true, flag: 'Sold out' });
        assert.equal(pd.sizeStock, 'Size M is no longer available');
        assert.equal(await page.locator('#pdAdd').evaluate((el) => el.getBoundingClientRect().top), addTop, 'no layout shift');

        // The bag now says so too.
        await page.locator('#pdClose').click();
        await page.waitForTimeout(400);
        assert.match(await page.locator('#cartItems').textContent(), /No longer available in this size/);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('is honest that the last pieces are held, not gone', async () => {
        await setLevitate(stack, { S: 0, M: 0, L: 1, XL: 0 });
        const hold = await stack.api('POST', '/api/checkout/create', checkoutBody([{ variantId: LVT('L'), quantity: 1 }]));
        assert.equal(hold.status, 200);
        const { context, page } = await newShopper(browser, stack);
        await enterShop(page, stack.origin);
        assert.equal(await badgeText(page, 'Levitate Tee'), 'Currently reserved');
        await openDetail(page, 'Levitate Tee');
        const pd = await pdSnapshot(page);
        assert.match(pd.stock, /^Currently reserved/);
        assert.match(pd.stock, /return if it is not completed/);
        assert.deepEqual(pd.add, { text: 'Temporarily unavailable', disabled: true });
        assert.equal(pd.notify, false, 'no "next drop" while pieces may still return');
        assert.deepEqual(pd.sizes.L, { disabled: true, flag: 'Reserved' });

        // The holder walks away; the piece comes back to this open page.
        await stack.api('POST', '/api/checkout/order', { action: 'release', clientSecret: hold.data.clientSecret });
        await nudge(page);
        await page.waitForFunction(() => document.getElementById('pdStock').textContent.includes('Last piece available'), null, { timeout: 20000 });
        assert.equal(await page.locator('#pdAdd').isDisabled(), false);
        await context.close();
    });

    it('when sold out, closes purchasing and opens the existing pre-order signup', async () => {
        await setLevitate(stack, { S: 0, M: 0, L: 0, XL: 0 });
        await stack.db.query("update inventory_items set sold = 1 where product_slug = 'levitate-tee'");
        const { context, page } = await newShopper(browser, stack);
        await enterShop(page, stack.origin);
        assert.equal(await badgeText(page, 'Levitate Tee'), 'Sold out');
        assert.equal(await badgeText(page, 'Endzustand Tee'), '', 'the other design is untouched');

        await openDetail(page, 'Levitate Tee');
        const pd = await pdSnapshot(page);
        assert.equal(pd.stock, 'Sold out');
        assert.deepEqual(pd.add, { text: 'Sold out', disabled: true });
        assert.equal(pd.notify, true);
        assert.equal(await page.locator('#pdNotify').textContent(), 'Get notified for the next drop');

        assert.equal(await page.locator('.preorder-modal-backdrop').count(), 1, 'one signup popup, not a second');
        await page.locator('#pdNotify').click();
        await page.waitForSelector('#preorderModal.active');
        assert.equal(await page.locator('#productDetailOverlay.open').count(), 0);
        assert.equal(await page.locator('#preorderModal').getAttribute('aria-hidden'), 'false');
        // Its own form, consent copy and submit path, unchanged.
        assert.equal(await page.locator('#preorderModal #preorderForm').count(), 1);
        assert.match(await page.locator('#preorderModal .privacy-note').textContent(), /agree to receive pre-order emails/);

        // The add control cannot be forced: the bag refuses the piece.
        await page.evaluate(() => addToCart('Levitate Tee', 200, 'M', null));
        assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem('voidCart') || '[]')).length), 0);
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('keeps the indicator readable on a phone and still under reduced motion', async () => {
        await setLevitate(stack, { S: 2, M: 3, L: 0, XL: 0 });
        const { context, page } = await newShopper(browser, stack, { viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
        await enterShop(page, stack.origin);
        await page.locator('.product-card[data-product-name="Levitate Tee"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        const badge = page.locator('.product-card[data-product-name="Levitate Tee"] [data-stock-badge]');
        assert.equal((await badge.textContent()).trim(), 'Only 5 pieces left');
        const box = await badge.boundingBox();
        const card = await page.locator('.product-card[data-product-name="Levitate Tee"] .product-image').boundingBox();
        assert.ok(box.x >= card.x && box.x + box.width <= card.x + card.width + 0.5, 'badge stays inside the image');
        const style = await badge.evaluate((el) => {
            const cs = getComputedStyle(el);
            return { size: parseFloat(cs.fontSize), anim: getComputedStyle(el.querySelector('.stock-mark')).animationName };
        });
        assert.ok(style.size >= 8, `legible size (${style.size}px)`);
        assert.equal(style.anim, 'none', 'no motion when reduced motion is requested');
        await page.screenshot({ path: new URL('./.artifacts/phone-card.png', import.meta.url).pathname });
        await openDetail(page, 'Levitate Tee');
        await page.waitForTimeout(1500);
        await page.locator('#pdSizes').scrollIntoViewIfNeeded();
        const rows = await page.$$eval('#pdSizes [data-pd-size]:not([hidden])', (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
        assert.equal(rows, 1, 'all sizes on one row on a phone');
        await page.screenshot({ path: new URL('./.artifacts/phone-detail.png', import.meta.url).pathname });
        await context.close();
    });
});

describe('checkout', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
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

    it('corrects a stale bag and says why', async () => {
        // Bagged days ago: 2 × Endzustand XL. One has since sold.
        await stack.setStock(END('XL'), 1);
        const cart = [
            { name: 'Endzustand Tee', size: 'XL', price: 200, quantity: 2 },
            { name: 'Levitate Tee', size: 'M', price: 200, quantity: 1 }
        ];
        const { context, page } = await newShopper(browser, stack, { cart });
        await page.goto(`${stack.origin}/checkout`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#ckBlocker:not([hidden])');
        assert.equal(await page.locator('#ckBlockerTitle').textContent(), 'Your bag has been updated');
        assert.match(await page.locator('#ckBlockerBody').textContent(), /Only 1 Endzustand Tee remains in size XL/);
        const bag = await page.evaluate(() => JSON.parse(localStorage.getItem('voidCart')));
        assert.deepEqual(bag.map((i) => [i.name, i.size, i.quantity]), [['Endzustand Tee', 'XL', 1], ['Levitate Tee', 'M', 1]]);
        assert.equal(await page.locator('#ckSummaryCount').textContent(), '2 pieces');
        // And it cannot be pushed back up past what remains.
        const plus = page.locator('.ck-line', { hasText: 'Endzustand' }).locator('button', { hasText: '+' });
        assert.equal(await plus.isDisabled(), true);
        await context.close();
    });

    it('tells the customer when someone else took the last piece, and empties the bag honestly', async () => {
        await stack.setStock(LVT('XL'), 1);
        const cart = [{ name: 'Levitate Tee', size: 'XL', price: 200, quantity: 1 }];
        const { context, page } = await newShopper(browser, stack, { cart });
        await page.goto(`${stack.origin}/checkout`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#ckShell[data-cart="ready"]');
        await page.waitForFunction(() => document.getElementById('ckTotal').textContent !== '—');

        await page.fill('#ckEmail', 'late@example.com');
        await page.fill('#ckFirstName', 'Late');
        await page.fill('#ckLastName', 'Client');
        await page.click('[data-advance="delivery"]');
        await page.fill('#ckLine1', 'Váci utca 1');
        await page.fill('#ckPostal', '1052');
        await page.fill('#ckCity', 'Budapest');
        await page.selectOption('#ckCountry', 'HU');
        await page.waitForSelector('#ckMethods input', { state: 'attached' });

        // The last quote this page saw said the piece was there. Another client
        // completes their purchase in the instant before this checkout opens.
        let raced = false;
        await page.route('**/api/checkout/create', async (route) => {
            if (!raced) {
                raced = true;
                const other = await stack.api('POST', '/api/checkout/create', checkoutBody([{ variantId: LVT('XL'), quantity: 1 }]));
                await stack.deliver('payment_intent.succeeded', stack.stripe.succeed(other.data.clientSecret.split('_secret_')[0]));
            }
            await route.continue();
        });
        await page.click('[data-advance="payment"]');

        await page.waitForSelector('#ckShell[data-cart="empty"]');
        assert.match(await page.locator('#ckEmptyNote').textContent(), /Another client has just secured the last Levitate Tee in size XL\. Your bag has been updated\./);
        assert.equal(await page.evaluate(() => localStorage.getItem('voidCart')), '[]');
        assert.equal((await stack.stock(LVT('XL'))).reserved, 0, 'the refused checkout held nothing');
        await context.close();
    });
});

describe('inventory dashboard', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
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

    // supabase-js loads from a CDN that the tests block, so the page's sign-in
    // module is replaced by one that already holds a session for `token`.
    // Everything else — the page, the API, the authorisation — is real.
    async function openDashboard(token) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        await context.route('**/assets/supabase-client.js', (route) => route.fulfill({
            contentType: 'text/javascript',
            body: `export async function getSession() { return ${token ? `{ access_token: ${JSON.stringify(token)} }` : 'null'}; }
                   export async function signIn() { return { error: new Error('no') }; }
                   export async function signOut() {}`
        }));
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${stack.origin}/admin/inventory`, { waitUntil: 'domcontentloaded' });
        return { context, page };
    }

    it('shows nothing and refuses a customer', async () => {
        const anon = await openDashboard(null);
        await anon.page.waitForSelector('#signinView:not([hidden])');
        assert.equal(await anon.page.locator('#dashView').isHidden(), true);
        await anon.context.close();

        const customer = await openDashboard(stack.addUser({ email: 'client@example.com' }));
        await customer.page.waitForSelector('#signinError:not([hidden])');
        assert.match(await customer.page.locator('#signinError').textContent(), /not authorised/);
        assert.equal(await customer.page.locator('#sizeRows tr').count(), 0);
        await customer.context.close();
    });

    it('lets the owner see every count and record an adjustment', async () => {
        const res = await stack.api('POST', '/api/checkout/create', checkoutBody([{ variantId: END('M'), quantity: 2 }]));
        assert.equal(res.status, 200);
        const { context, page } = await openDashboard(stack.addUser({ email: 'owner@eternalvoid.co' }));
        await page.waitForSelector('#dashView:not([hidden])');
        assert.equal(await page.locator('#whoEmail').textContent(), 'owner@eternalvoid.co');

        const row = (size, nth) => page.locator('#sizeRows tr:not(.group)').nth(nth).locator('td');
        // Endzustand is listed first (alphabetical by slug): S M L XL
        const m = row('M', 1);
        assert.deepEqual(await m.allTextContents(), ['M', '14', '2', '16', '0', '0', '0']);
        assert.match(await page.locator('#holdRows').textContent(), new RegExp(res.data.orderNumber));

        await page.selectOption('#adjVariant', 'levitate-tee:XL');
        await page.selectOption('#adjMode', 'adjust');
        await page.fill('#adjQuantity', '-1');
        await page.fill('#adjReason', 'Sample kept for the archive');
        await page.click('#adjSubmit');
        await page.waitForSelector('#adjResult:not([hidden])');
        assert.match(await page.locator('#adjResult').textContent(), /1 on hand, 1 available/);
        // The audit table is refreshed right after the result is shown.
        await page.waitForFunction(() => /Sample kept for the archive/.test(document.querySelector('#movementRows tr').textContent));
        assert.match(await page.locator('#movementRows tr').first().textContent(), /Adjustment.*-1.*owner@eternalvoid\.co.*Sample kept for the archive/);
        assert.deepEqual(await stack.stock(LVT('XL')), { onHand: 1, reserved: 0, available: 1, sold: 0, returned: 0 });
        await page.screenshot({ path: new URL('./.artifacts/dashboard.png', import.meta.url).pathname, fullPage: true });
        await context.close();
    });
});
