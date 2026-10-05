// Prelaunch: Production with VOID_SALES_OPEN=false (or unset) shows Coming
// Soon and refuses both checkout endpoints before any order, hold or Stripe
// call, while newsletter signup and the inventory dashboard keep working.
// Preview and development keep sandbox checkout unless explicitly closed.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack, checkoutBody } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const LVT = (size) => `levitate-tee:${size}`;
const END = (size) => `endzustand-tee:${size}`;
const ITEMS = [{ variantId: END('M'), quantity: 1 }];

function setSales(vercelEnv, open) {
    if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = vercelEnv;
    if (open === undefined) delete process.env.VOID_SALES_OPEN;
    else process.env.VOID_SALES_OPEN = open;
}

// Everything a refused checkout must leave untouched.
async function footprint(stack) {
    const { rows } = await stack.db.query(`select
        (select count(*)::int from orders) as orders,
        (select count(*)::int from inventory_reservations) as reservations,
        (select coalesce(sum(reserved), 0)::int from inventory_items) as reserved,
        (select coalesce(sum(on_hand), 0)::int from inventory_items) as on_hand`);
    return { ...rows[0], stripeCalls: stack.stripe.calls.length, intents: stack.stripe.intents.size };
}

async function assertRefused(stack) {
    const before = await footprint(stack);
    const quote = await stack.api('POST', '/api/checkout/quote', { items: ITEMS, country: 'HU' });
    assert.equal(quote.status, 409);
    assert.equal(quote.data.error, 'sales_not_open');
    const create = await stack.api('POST', '/api/checkout/create', checkoutBody(ITEMS));
    assert.equal(create.status, 409);
    assert.equal(create.data.error, 'sales_not_open');
    assert.equal(create.data.clientSecret, undefined);
    assert.deepEqual(await footprint(stack), before, 'no order, hold or Stripe call');
}

async function assertSandboxOpen(stack) {
    const quote = await stack.api('POST', '/api/checkout/quote', { items: ITEMS });
    assert.equal(quote.status, 200);
    assert.equal(quote.data.ok, true);
    const create = await stack.api('POST', '/api/checkout/create', checkoutBody(ITEMS));
    assert.equal(create.status, 200);
    assert.ok(create.data.clientSecret);
}

describe('production with sales closed', () => {
    let stack;
    let admin;
    before(async () => {
        stack = await startStack({ env: { VERCEL_ENV: 'production', VOID_SALES_OPEN: 'false' } });
        admin = stack.addUser({ email: 'owner@eternalvoid.co' });
    });
    after(async () => {
        setSales(undefined, undefined);
        await stack.stop();
    });

    it('tells the storefront sales are closed, and still publishes stock', async () => {
        const res = await stack.api('GET', '/api/inventory');
        assert.equal(res.status, 200);
        assert.equal(res.data.salesOpen, false);
        assert.ok(Object.keys(res.data.products).length > 0);
    });

    it('refuses quote and checkout without creating orders, holds or Stripe payments', async () => {
        await assertRefused(stack);
        const { rows } = await stack.db.query('select count(*)::int as n from inventory_movements where kind = \'sale\'');
        assert.equal(rows[0].n, 0);
    });

    it('stays closed when VOID_SALES_OPEN is missing', async () => {
        setSales('production', undefined);
        await assertRefused(stack);
        assert.equal((await stack.api('GET', '/api/inventory')).data.salesOpen, false);
        setSales('production', 'false');
    });

    it('keeps newsletter and pre-order signup working', async () => {
        const footer = await stack.api('POST', '/api/newsletter', { email: 'drop@example.com' });
        assert.equal(footer.status, 200);
        const popup = await stack.api('POST', '/api/preorder', { email: 'popup@example.com', country: 'Hungary' });
        assert.equal(popup.status, 200);
        const { rows } = await stack.db.query(
            "select email, status from newsletter_subscribers where email in ('drop@example.com', 'popup@example.com') order by email");
        assert.deepEqual(rows, [
            { email: 'drop@example.com', status: 'subscribed' },
            { email: 'popup@example.com', status: 'subscribed' }
        ]);
    });

    it('keeps the inventory dashboard reading and adjusting stock', async () => {
        const auth = { Authorization: `Bearer ${admin}` };
        const snap = await stack.api('GET', '/api/inventory?scope=admin', undefined, auth);
        assert.equal(snap.status, 200);
        const adj = await stack.api('POST', '/api/inventory',
            { action: 'adjust', variantId: LVT('M'), mode: 'set', quantity: 12, reason: 'Physical count' }, auth);
        assert.equal(adj.status, 200);
        assert.equal((await stack.stock(LVT('M'))).onHand, 12);
    });

    it('opens only when VOID_SALES_OPEN is exactly true', async () => {
        for (const value of ['TRUE', '1', 'yes', '']) {
            setSales('production', value);
            await assertRefused(stack);
        }
        setSales('production', 'true');
        assert.equal((await stack.api('GET', '/api/inventory')).data.salesOpen, true);
        await assertSandboxOpen(stack);
        setSales('production', 'false');
    });
});

describe('preview and development', () => {
    let stack;
    before(async () => { stack = await startStack({ env: { VERCEL_ENV: 'preview' } }); });
    after(async () => {
        setSales(undefined, undefined);
        await stack.stop();
    });

    it('keeps sandbox checkout in Preview by default', async () => {
        setSales('preview', undefined);
        assert.equal((await stack.api('GET', '/api/inventory')).data.salesOpen, true);
        await assertSandboxOpen(stack);
    });

    it('keeps sandbox checkout in development by default', async () => {
        setSales(undefined, undefined);
        await assertSandboxOpen(stack);
    });

    it('closes Preview when explicitly set to false', async () => {
        setSales('preview', 'false');
        await assertRefused(stack);
    });
});

describe('storefront with sales closed', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
    let stack;
    let browser;
    before(async () => {
        stack = await startStack({ env: { VERCEL_ENV: 'production', VOID_SALES_OPEN: 'false' } });
        browser = await chromium.launch({ executablePath: CHROME });
    });
    after(async () => {
        await browser?.close();
        await stack?.stop();
        setSales(undefined, undefined);
    });

    async function shopper(cart) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

    async function enterShop(page) {
        await page.goto(`${stack.origin}/shop`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1600);
        if (await page.locator('#voidAuth[aria-hidden="false"]').count()) await page.locator('#voidAuthClose').click();
        await page.waitForFunction(() => document.querySelector('[data-stock-badge]'));
    }

    it('shows Coming Soon everywhere a piece could be bought', async () => {
        const cart = [{ name: 'Levitate Tee', size: 'M', price: 200, quantity: 1 }];
        const { context, page } = await shopper(cart);
        await enterShop(page);

        const badge = await page.locator('.product-card[data-product-name="Levitate Tee"] [data-stock-badge]').textContent();
        assert.equal(badge.trim(), 'Coming Soon');

        await page.locator('.product-card[data-product-name="Levitate Tee"] .product-image').click();
        await page.waitForSelector('#productDetailOverlay.open');
        const pdAdd = await page.evaluate(() => { const b = document.getElementById('pdAdd'); return { text: b.textContent.trim(), disabled: b.disabled }; });
        assert.deepEqual(pdAdd, { text: 'Coming Soon', disabled: true });
        // Choosing a size does not reopen the button, and forcing a click adds nothing.
        await page.locator('#pdSizes [data-pd-size="L"]').click({ force: true });
        assert.equal(await page.locator('#pdAdd').isDisabled(), true);
        await page.evaluate(() => { const b = document.getElementById('pdAdd'); b.disabled = false; b.click(); });
        const bag = await page.evaluate(() => JSON.parse(localStorage.getItem('voidCart')));
        assert.deepEqual(bag.map((i) => [i.name, i.size, i.quantity]), [['Levitate Tee', 'M', 1]]);
        await page.keyboard.press('Escape');

        // A bag left over from before cannot be taken to checkout.
        assert.equal((await page.locator('#cartCheckout').textContent()).trim(), 'Coming Soon');
        await page.evaluate(() => document.getElementById('cartCheckout').click());
        await page.waitForSelector('#voidNotice.active');
        assert.equal(await page.locator('#voidNoticeTitle').textContent(), 'Coming Soon');
        assert.equal(new URL(page.url()).pathname, '/shop');
        assert.deepEqual(page.errors, []);
        await context.close();
    });

    it('keeps the footer newsletter form working', async () => {
        const { context, page } = await shopper();
        await enterShop(page);
        await page.locator('#newsletterEmail').scrollIntoViewIfNeeded();
        await page.fill('#newsletterEmail', 'footer-closed@example.com');
        await page.click('#newsletterButton');
        await page.waitForFunction(() => /Thank you for signing up/.test(document.getElementById('newsletterResponse').textContent));
        const { rows } = await stack.db.query("select status from newsletter_subscribers where email = 'footer-closed@example.com'");
        assert.equal(rows[0].status, 'subscribed');
        await context.close();
    });

    it('blocks the checkout page itself, opened directly', async () => {
        const before = await footprint(stack);
        const cart = [{ name: 'Endzustand Tee', size: 'M', price: 200, quantity: 1 }];
        const { context, page } = await shopper(cart);
        await page.goto(`${stack.origin}/checkout`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#ckBlocker:not([hidden])');
        assert.equal(await page.locator('#ckBlockerTitle').textContent(), 'Coming soon');
        const enabled = await page.$$eval('[data-advance], #ckPayButton', (els) => els.filter((b) => !b.disabled).length);
        assert.equal(enabled, 0);
        assert.deepEqual(await footprint(stack), before);
        await context.close();
    });

    it('keeps the inventory dashboard working for the owner', async () => {
        const token = stack.addUser({ email: 'owner@eternalvoid.co' });
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        await context.route('**/assets/supabase-client.js', (route) => route.fulfill({
            contentType: 'text/javascript',
            body: `export async function getSession() { return { access_token: ${JSON.stringify(token)} }; }
                   export async function signIn() { return { error: new Error('no') }; }
                   export async function signOut() {}`
        }));
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${stack.origin}/admin/inventory`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#dashView:not([hidden])');
        assert.ok(await page.locator('#sizeRows tr:not(.group)').count() > 0);
        await context.close();
    });
});
