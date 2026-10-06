// Newsletter persistence: both signup forms save to newsletter_subscribers
// before any email is sent, unsubscribes stick, and the export only ever
// holds subscribed addresses. Resend is captured by the harness; nothing is
// actually emailed.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startStack, checkoutBody } from './harness.mjs';

const CHROME = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

async function subscriber(stack, email) {
    const { rows } = await stack.db.query(
        `select email, status, country, sources, interests, consent_source, unsubscribe_source,
                consent_at is not null as consented, welcome_sent_at is not null as welcomed, unsubscribe_token
           from newsletter_subscribers where email = $1`, [email]);
    return rows[0] || null;
}

async function audience(stack) {
    const { rows } = await stack.db.query('select email from newsletter_audience order by email');
    return rows.map((r) => r.email);
}

describe('signing up', () => {
    let stack;
    before(async () => { stack = await startStack(); });
    after(async () => { await stack.stop(); });

    it('saves a popup signup, then sends the existing welcome email with a working unsubscribe link', async () => {
        const res = await stack.api('POST', '/api/preorder', { email: '  Ada@Example.com ', country: 'Hungary' });
        assert.equal(res.status, 200);
        assert.equal(res.data.message, 'Welcome to the VOID© private access club. Please check your email.');

        const row = await subscriber(stack, 'ada@example.com');
        assert.deepEqual(
            { status: row.status, country: row.country, sources: row.sources, consented: row.consented, consent_source: row.consent_source, welcomed: row.welcomed },
            { status: 'subscribed', country: 'Hungary', sources: ['preorder'], consented: true, consent_source: 'preorder', welcomed: true });
        assert.deepEqual(await audience(stack), ['ada@example.com'], 'available for the next drop notification');

        assert.equal(stack.emails.length, 1);
        const mail = stack.emails[0];
        assert.equal(mail.to, 'Ada@Example.com');
        assert.equal(mail.subject, 'Welcome to the VOID© Private Access Club');
        assert.match(mail.html, /Pre-order Access Reserved/);
        assert.match(mail.html, /Country: Hungary/);
        assert.ok(mail.html.includes(`/unsubscribe.html?token=${row.unsubscribe_token}`));
        assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
        assert.ok(mail.headers['List-Unsubscribe'].includes(`/api/unsubscribe?token=${row.unsubscribe_token}`));
    });

    it('saves a footer signup, and keeps one record per address across both forms', async () => {
        const res = await stack.api('POST', '/api/newsletter', { email: 'ada@example.com' });
        assert.equal(res.status, 200);
        const row = await subscriber(stack, 'ada@example.com');
        assert.deepEqual(row.sources, ['preorder', 'newsletter']);
        assert.equal(row.country, 'Hungary', 'the popup country is kept');

        const fresh = await stack.api('POST', '/api/newsletter', { email: 'bea@example.com' });
        assert.equal(fresh.data.message, 'Thank you for signing up to the VOID newsletter. Please check your email.');
        assert.equal(stack.emails.at(-1).subject, 'Thank you for signing up to VOID');
        assert.match(stack.emails.at(-1).html, /You are inside the VOID\./);
        assert.deepEqual(await audience(stack), ['ada@example.com', 'bea@example.com']);
    });

    it('does not re-send the welcome to a repeat signup within a day, and answers the same', async () => {
        const before = stack.emails.length;
        const again = await stack.api('POST', '/api/newsletter', { email: 'bea@example.com' });
        assert.equal(again.status, 200);
        assert.equal(again.data.message, 'Thank you for signing up to the VOID newsletter. Please check your email.');
        assert.equal(stack.emails.length, before);
        const { rows } = await stack.db.query("select count(*)::int as n from newsletter_subscribers where email = 'bea@example.com'");
        assert.equal(rows[0].n, 1);
    });

    it('records the design a visitor asked about from a sold-out piece, and nothing invented', async () => {
        await stack.api('POST', '/api/preorder', { email: 'cleo@example.com', country: 'France', interest: 'levitate-tee' });
        await stack.api('POST', '/api/preorder', { email: 'cleo@example.com', country: 'France', interest: 'not-a-product' });
        await stack.api('POST', '/api/preorder', { email: 'cleo@example.com', country: 'France', interest: 'endzustand-tee' });
        assert.deepEqual((await subscriber(stack, 'cleo@example.com')).interests, ['levitate-tee', 'endzustand-tee']);
    });

    it('records NÉANT from "Receive the unveiling" without making it a catalogue piece', async () => {
        assert.equal((await stack.api('POST', '/api/newsletter', { email: 'iris@example.com', interest: ' NEANT ' })).status, 200);
        await stack.api('POST', '/api/newsletter', { email: 'iris@example.com', interest: 'neant-parfum' });
        await stack.api('POST', '/api/newsletter', { email: 'iris@example.com', interest: 'toString' });
        assert.deepEqual((await subscriber(stack, 'iris@example.com')).interests, ['neant']);
        // Announced, not on sale: nothing can quote or hold it.
        const quote = await stack.api('POST', '/api/checkout/quote', { items: [{ variantId: 'neant:M', quantity: 1 }] });
        assert.notEqual(quote.data.ok, true);
    });

    it('rejects invalid input without saving or emailing', async () => {
        const before = stack.emails.length;
        assert.equal((await stack.api('POST', '/api/preorder', { email: 'nope', country: 'Hungary' })).status, 400);
        assert.equal((await stack.api('POST', '/api/preorder', { email: 'dan@example.com' })).status, 400);
        assert.equal((await stack.api('POST', '/api/newsletter', { email: '' })).status, 400);
        assert.equal(await subscriber(stack, 'dan@example.com'), null);
        assert.equal(stack.emails.length, before);
    });

    it('sends nothing when the address could not be saved', async () => {
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        process.env.SUPABASE_SERVICE_ROLE_KEY = stack.signJwt({ role: 'anon' });   // the save is refused
        try {
            const before = stack.emails.length;
            const res = await stack.api('POST', '/api/newsletter', { email: 'eve@example.com' });
            assert.equal(res.status, 502);
            assert.equal(stack.emails.length, before, 'no welcome for an unrecorded signup');
        } finally {
            process.env.SUPABASE_SERVICE_ROLE_KEY = key;
        }
        assert.equal(await subscriber(stack, 'eve@example.com'), null);
    });

    it('keeps the signup when the welcome email fails, says so, and sends it on the next try', async () => {
        stack.mail.failures = 1;
        const res = await stack.api('POST', '/api/preorder', { email: 'finn@example.com', country: 'Italy' });
        assert.equal(res.status, 200);
        assert.match(res.data.message, /We could not send the confirmation email just now/);
        let row = await subscriber(stack, 'finn@example.com');
        assert.equal(row.status, 'subscribed');
        assert.equal(row.welcomed, false);

        const retry = await stack.api('POST', '/api/preorder', { email: 'finn@example.com', country: 'Italy' });
        assert.equal(retry.data.message, 'Welcome to the VOID© private access club. Please check your email.');
        row = await subscriber(stack, 'finn@example.com');
        assert.equal(row.welcomed, true);
        assert.equal(stack.emails.at(-1).to, 'finn@example.com');
    });
});

describe('unsubscribing', () => {
    let stack;
    before(async () => {
        stack = await startStack();
        for (const email of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) {
            await stack.api('POST', '/api/newsletter', { email });
        }
    });
    after(async () => { await stack.stop(); });

    it('does nothing on a GET, so a mail scanner opening the link cannot unsubscribe anyone', async () => {
        const { unsubscribe_token: token } = await subscriber(stack, 'a@example.com');
        const res = await stack.api('GET', `/api/unsubscribe?token=${token}`);
        assert.equal(res.status, 405);
        assert.equal((await subscriber(stack, 'a@example.com')).status, 'subscribed');
    });

    it('unsubscribes from the email link, silently', async () => {
        const { unsubscribe_token: token } = await subscriber(stack, 'a@example.com');
        const before = stack.emails.length;
        const res = await stack.api('POST', '/api/unsubscribe', { token });
        assert.equal(res.status, 200);
        const row = await subscriber(stack, 'a@example.com');
        assert.deepEqual([row.status, row.unsubscribe_source], ['unsubscribed', 'email_link']);
        assert.equal(stack.emails.length, before);
        assert.ok(!(await audience(stack)).includes('a@example.com'));
    });

    it('honours RFC 8058 one-click unsubscribe from the mail client', async () => {
        const { unsubscribe_token: token } = await subscriber(stack, 'b@example.com');
        const res = await fetch(`${stack.origin}/api/unsubscribe?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'List-Unsubscribe=One-Click'
        });
        assert.equal(res.status, 200);
        const row = await subscriber(stack, 'b@example.com');
        assert.deepEqual([row.status, row.unsubscribe_source], ['unsubscribed', 'one_click']);
    });

    it('unsubscribes by address from the page form, and confirms by email as before', async () => {
        const res = await stack.api('POST', '/api/unsubscribe', { email: 'C@Example.com' });
        assert.equal(res.status, 200);
        assert.equal(res.data.message, 'You have been unsubscribed from VOID emails.');
        assert.equal((await subscriber(stack, 'c@example.com')).status, 'unsubscribed');
        assert.equal(stack.emails.at(-1).subject, 'You have been unsubscribed from VOID emails');
        assert.match(stack.emails.at(-1).html, /has been removed from VOID newsletter/);
    });

    it('records an address that was never on the list, so it stays suppressed', async () => {
        await stack.api('POST', '/api/unsubscribe', { email: 'never@example.com' });
        const row = await subscriber(stack, 'never@example.com');
        assert.deepEqual([row.status, row.consented], ['unsubscribed', false]);
        assert.ok(!(await audience(stack)).includes('never@example.com'));
    });

    it('refuses an unknown link without touching anyone', async () => {
        const res = await stack.api('POST', '/api/unsubscribe', { token: 'f'.repeat(64) });
        assert.equal(res.status, 404);
        assert.equal((await subscriber(stack, 'd@example.com')).status, 'subscribed');
    });

    it('stays unsubscribed through everything except a new signup through a form', async () => {
        // Buying something does not put them back on the list.
        const order = await stack.api('POST', '/api/checkout/create', checkoutBody(
            [{ variantId: 'levitate-tee:M', quantity: 1 }], { email: 'a@example.com' }));
        await stack.deliver('payment_intent.succeeded', stack.stripe.succeed(order.data.clientSecret.split('_secret_')[0]));
        assert.equal((await subscriber(stack, 'a@example.com')).status, 'unsubscribed');
        assert.deepEqual(await audience(stack), ['d@example.com']);

        // Signing up again is new, explicit consent.
        const before = stack.emails.length;
        await stack.api('POST', '/api/newsletter', { email: 'a@example.com' });
        assert.equal((await subscriber(stack, 'a@example.com')).status, 'subscribed');
        assert.equal(stack.emails.length, before + 1, 'a returning subscriber is welcomed again');
        assert.deepEqual(await audience(stack), ['a@example.com', 'd@example.com']);
    });
});

describe('access to subscribers', () => {
    let stack;
    let admin;
    before(async () => {
        stack = await startStack();
        admin = stack.addUser({ email: 'owner@eternalvoid.co' });
        await stack.api('POST', '/api/preorder', { email: 'x@example.com', country: 'Hungary', interest: 'endzustand-tee' });
        await stack.api('POST', '/api/newsletter', { email: 'y@example.com' });
        await stack.api('POST', '/api/newsletter', { email: '=cmd@example.com' });
        await stack.api('POST', '/api/unsubscribe', { email: 'y@example.com' });
    });
    after(async () => { await stack.stop(); });

    it('gives browsers no way to read or change the list', async () => {
        const anon = { apikey: 'anon-key-for-tests' };
        const authed = { Authorization: `Bearer ${stack.signJwt({ role: 'authenticated', sub: crypto.randomUUID() })}` };
        for (const headers of [anon, authed]) {
            for (const path of ['/newsletter_subscribers?select=email', '/newsletter_audience?select=email']) {
                const res = await fetch(`${stack.restUrl}${path}`, { headers });
                assert.ok([401, 403].includes(res.status), `${path} refused (${res.status})`);
            }
            const call = await fetch(`${stack.restUrl}/rpc/newsletter_subscribe`, {
                method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ p_email: 'z@example.com', p_source: 'newsletter' })
            });
            assert.ok([401, 403, 404].includes(call.status), `rpc refused (${call.status})`);
        }
    });

    it('shows counts and exports only subscribed addresses, to the admin only', async () => {
        const customer = stack.addUser({ email: 'client@example.com' });
        assert.equal((await stack.api('GET', '/api/inventory?scope=admin&export=audience')).status, 401);
        assert.equal((await stack.api('GET', '/api/inventory?scope=admin&export=audience', undefined, { Authorization: `Bearer ${customer}` })).status, 403);

        const snap = await stack.api('GET', '/api/inventory?scope=admin', undefined, { Authorization: `Bearer ${admin}` });
        assert.deepEqual(snap.data.newsletter, { subscribed: 2, unsubscribed: 1, interests: { 'endzustand-tee': 1 } });

        const csv = await stack.api('GET', '/api/inventory?scope=admin&export=audience', undefined, { Authorization: `Bearer ${admin}` });
        assert.equal(csv.status, 200);
        assert.match(csv.headers.get('content-type'), /text\/csv/);
        const lines = csv.data.trim().split('\r\n');
        assert.equal(lines[0], 'email,country,interests,sources,consented_at,unsubscribe_url');
        assert.equal(lines.length, 3);
        assert.ok(lines.some((l) => l.startsWith('"x@example.com","Hungary","endzustand-tee","preorder"')));
        assert.ok(lines.some((l) => l.startsWith(`"'=cmd@example.com"`)), 'spreadsheet formulas are neutralised');
        assert.ok(!csv.data.includes('y@example.com'), 'unsubscribed addresses are never exported');
        assert.match(lines[1], /\/unsubscribe\.html\?token=[0-9a-f]{64}"$/);
    });
});

describe('a fresh project with no default grants', () => {
    // Newer Supabase projects do not grant new tables or functions to the API
    // roles automatically. Every migration must grant what it needs itself.
    let stack;
    before(async () => { stack = await startStack({ strict: true }); });
    after(async () => { await stack.stop(); });

    it('runs signup, unsubscribe, checkout, payment and the dashboard', async () => {
        assert.equal((await stack.api('POST', '/api/preorder', { email: 'p@example.com', country: 'Hungary' })).status, 200);
        assert.equal((await stack.api('POST', '/api/unsubscribe', { email: 'p@example.com' })).status, 200);
        const inv = await stack.api('GET', '/api/inventory');
        assert.equal(inv.data.products['levitate-tee'].available, 30);
        const order = await stack.api('POST', '/api/checkout/create', checkoutBody([{ variantId: 'endzustand-tee:L', quantity: 2 }]));
        assert.equal(order.status, 200);
        const paid = await stack.deliver('payment_intent.succeeded', stack.stripe.succeed(order.data.clientSecret.split('_secret_')[0]));
        assert.equal(paid.data.outcome, 'confirmed');
        const admin = stack.addUser({ email: 'owner@eternalvoid.co' });
        const adjust = await stack.api('POST', '/api/inventory',
            { action: 'adjust', variantId: 'levitate-tee:S', mode: 'adjust', quantity: 1, reason: 'Found one' },
            { Authorization: `Bearer ${admin}` });
        assert.equal(adjust.status, 200);
        const snap = await stack.api('GET', '/api/inventory?scope=admin', undefined, { Authorization: `Bearer ${admin}` });
        assert.equal(snap.status, 200);
        assert.deepEqual(snap.data.newsletter, { subscribed: 0, unsubscribed: 1, interests: {} });
    });
});

describe('the real forms', { skip: !CHROME && 'no Chromium found (set CHROMIUM_PATH)' }, () => {
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

    async function shop() {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        await context.addInitScript(() => {
            localStorage.setItem('void-gate-disabled', '1');
            localStorage.setItem('voidLanguage', 'en');
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${stack.origin}/shop`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1600);
        if (await page.locator('#voidAuth[aria-hidden="false"]').count()) await page.locator('#voidAuthClose').click();
        await page.waitForFunction(() => document.querySelector('[data-stock-badge]'));
        return { context, page };
    }

    async function joinThroughPopup(page, email) {
        await page.waitForSelector('#preorderModal.active');
        await page.fill('#preorderEmail', email);
        await page.click('#preorderCountryButton');
        await page.click('#preorderCountryList [data-country="Hungary"]');
        await page.click('#preorderForm .preorder-submit');
        await page.waitForFunction(() => /private access club/.test(document.getElementById('preorderResponse').textContent));
    }

    it('saves an address entered in the pre-order popup', async () => {
        const { context, page } = await shop();
        await page.locator('.collection-preorder-trigger').click();
        await joinThroughPopup(page, 'popup@example.com');
        const row = await subscriber(stack, 'popup@example.com');
        assert.deepEqual([row.status, row.country, row.sources, row.interests], ['subscribed', 'Hungary', ['preorder'], []]);
        await context.close();
    });

    it('records the design when a visitor joins from a sold-out piece', async () => {
        await stack.db.query("update inventory_items set on_hand = 0, sold = 1 where product_slug = 'endzustand-tee'");
        const { context, page } = await shop();
        await page.locator('.product-card[data-product-name="Endzustand Tee"] .product-image').click();
        await page.waitForSelector('#pdNotify:not([hidden])');
        await page.click('#pdNotify');
        await page.waitForFunction(() => pdNl.view === 'newsletter');
        await page.fill('#pdNlEmail', 'soldout@example.com');
        await page.click('#pdNlSubmit');
        await page.waitForFunction(() => document.getElementById('pdNlStatus').dataset.state === 'success');
        const row = await subscriber(stack, 'soldout@example.com');
        assert.deepEqual([row.status, row.interests, row.sources], ['subscribed', ['endzustand-tee'], ['newsletter']]);
        await context.close();
    });

    it('saves an address entered in the footer newsletter form', async () => {
        const { context, page } = await shop();
        await page.locator('#newsletterEmail').scrollIntoViewIfNeeded();
        await page.fill('#newsletterEmail', 'footer@example.com');
        await page.click('#newsletterButton');
        await page.waitForFunction(() => /Thank you for signing up/.test(document.getElementById('newsletterResponse').textContent));
        assert.deepEqual((await subscriber(stack, 'footer@example.com')).sources, ['newsletter']);
        await context.close();
    });

    it('unsubscribes from the link in the email only after the button is pressed', async () => {
        const { unsubscribe_token: token } = await subscriber(stack, 'popup@example.com');
        const context = await browser.newContext();
        await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
        const page = await context.newPage();
        await page.goto(`${stack.origin}/unsubscribe.html?token=${token}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#unsubscribeTokenForm:not([hidden])');
        assert.equal(await page.locator('#unsubscribeForm').isHidden(), true);
        await page.waitForTimeout(500);
        assert.equal((await subscriber(stack, 'popup@example.com')).status, 'subscribed', 'opening the page changes nothing');
        await page.click('#unsubscribeTokenButton');
        await page.waitForFunction(() => /unsubscribed/.test(document.getElementById('unsubscribeResponse').textContent));
        assert.equal((await subscriber(stack, 'popup@example.com')).status, 'unsubscribed');

        // Links in emails sent before this change carry ?email=; they still work.
        await page.goto(`${stack.origin}/unsubscribe.html?email=footer%40example.com`, { waitUntil: 'domcontentloaded' });
        assert.equal(await page.inputValue('#unsubscribeEmail'), 'footer@example.com');
        await page.click('#unsubscribeButton');
        await page.waitForFunction(() => /unsubscribed/.test(document.getElementById('unsubscribeResponse').textContent));
        assert.equal((await subscriber(stack, 'footer@example.com')).status, 'unsubscribed');
        await context.close();
    });
});
