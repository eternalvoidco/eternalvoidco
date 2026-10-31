// Backend behaviour, end to end through the real handlers, PostgREST and
// Postgres. Each `describe` gets one stack; tests inside it share state in the
// order written, which keeps the arithmetic readable.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startStack, checkoutBody, applyInventoryMigrationAgain, applyAllocationMigration, readMigration, INVENTORY_MIGRATION } from './harness.mjs';

const LVT = (size) => `levitate-tee:${size}`;
const END = (size) => `endzustand-tee:${size}`;

async function openCheckout(stack, items) {
    return stack.api('POST', '/api/checkout/create', checkoutBody(items));
}

async function pay(stack, clientSecret) {
    const piId = clientSecret.split('_secret_')[0];
    const pi = stack.stripe.succeed(piId);
    return stack.deliver('payment_intent.succeeded', pi);
}

describe('initial allocation', () => {
    let stack;
    before(async () => { stack = await startStack(); });
    after(async () => { await stack.stop(); });

    it('holds 50 pieces per design, 100 in total, split S4 M25 L17 XL4', async () => {
        const { rows } = await stack.db.query('select sum(on_hand)::int as total from inventory_items');
        assert.equal(rows[0].total, 100);

        const res = await stack.api('GET', '/api/inventory');
        assert.equal(res.status, 200);
        for (const slug of ['levitate-tee', 'endzustand-tee']) {
            const p = res.data.products[slug];
            assert.equal(p.available, 50, slug);
            assert.equal(p.state, 'in_stock');
            assert.deepEqual(
                Object.fromEntries(Object.entries(p.sizes).map(([s, v]) => [s, v.available])),
                { S: 4, M: 25, L: 17, XL: 4 }
            );
            // Both designs are cut in S–XL only; XS does not exist for them.
            assert.equal(p.sizes.XS, undefined);
            assert.equal(p.sizes.S.state, 'low');
        }
        // Only the two tracked designs are exposed, and nothing about holders.
        assert.deepEqual(Object.keys(res.data.products).sort(), ['endzustand-tee', 'levitate-tee']);
        assert.equal(res.data.products['levitate-tee'].reserved, undefined);
    });

    it('answers a matching ETag with 304 and caches only briefly at the edge', async () => {
        const first = await stack.api('GET', '/api/inventory');
        const etag = first.headers.get('etag');
        assert.match(first.headers.get('cache-control'), /max-age=0.*s-maxage=3/);
        const again = await fetch(`${stack.origin}/api/inventory`, { headers: { 'If-None-Match': etag } });
        assert.equal(again.status, 304);
    });

    it('reruns the migration without resetting stock or sales', async () => {
        const res = await openCheckout(stack, [{ variantId: LVT('M'), quantity: 2 }]);
        assert.equal(res.status, 200);
        await pay(stack, res.data.clientSecret);
        const held = await openCheckout(stack, [{ variantId: LVT('L'), quantity: 1 }]);
        assert.equal(held.status, 200);

        const before = await stack.db.query('select variant_id, on_hand, reserved, sold from inventory_items order by 1');
        const movementsBefore = await stack.db.query('select count(*)::int as n from inventory_movements');

        await applyInventoryMigrationAgain(stack.db);
        await applyInventoryMigrationAgain(stack.db);

        const afterRows = await stack.db.query('select variant_id, on_hand, reserved, sold from inventory_items order by 1');
        const movementsAfter = await stack.db.query('select count(*)::int as n from inventory_movements');
        assert.deepEqual(afterRows.rows, before.rows);
        assert.equal(movementsAfter.rows[0].n, movementsBefore.rows[0].n);
        assert.deepEqual(await stack.stock(LVT('M')), { onHand: 23, reserved: 0, available: 23, sold: 2, returned: 0 });
        assert.equal((await stack.stock(LVT('L'))).reserved, 1);
    });
});

describe('initialisation reconciles orders paid before tracking', () => {
    it('subtracts units already sold and records why', async () => {
        // Build a database where orders exist and were paid BEFORE the
        // inventory migration ran, then apply it.
        const stack = await startStack();
        try {
            await stack.db.query('truncate inventory_reservations, inventory_items, inventory_movements cascade');
            await stack.db.query('alter table inventory_movements disable trigger inventory_movements_append_only');
            const { rows: [order] } = await stack.db.query(`
                insert into orders (order_number, customer_email, customer_first_name, customer_last_name,
                                    shipping_address, subtotal_amount, shipping_amount, total_amount, payment_status, status)
                values ('EV-26-LEGACY', 'a@b.co', 'A', 'B', '{}'::jsonb, 60000, 0, 60000, 'paid', 'confirmed')
                returning id`);
            await stack.db.query(`
                insert into order_items (order_id, variant_id, product_slug, product_name, size, unit_amount, quantity, line_amount)
                values ($1, 'endzustand-tee:M', 'endzustand-tee', 'Endzustand Tee', 'M', 20000, 3, 60000)`, [order.id]);
            await stack.db.query('alter table inventory_movements enable trigger inventory_movements_append_only');

            await applyInventoryMigrationAgain(stack.db);

            assert.deepEqual(await stack.stock(END('M')), { onHand: 22, reserved: 0, available: 22, sold: 3, returned: 0 });
            const { rows } = await stack.db.query(
                "select kind, delta from inventory_movements where variant_id = 'endzustand-tee:M' order by id");
            assert.deepEqual(rows, [{ kind: 'initial', delta: 25 }, { kind: 'reconciliation', delta: -3 }]);
            const total = await stack.api('GET', '/api/inventory');
            assert.equal(total.data.products['endzustand-tee'].available, 47);
        } finally {
            await stack.stop();
        }
    });
});

// Rebuilds the store as production was stocked before 2026-10-31: the
// inventory migration as it stood, with the old allocation S2 M16 L10 XL2.
async function stockAtOldAllocation(stack) {
    await stack.db.query('truncate inventory_reservations, inventory_items, inventory_movements cascade');
    const current = readMigration(INVENTORY_MIGRATION);
    const old = current
        .replace("('levitate-tee',   'S', 4), ('levitate-tee',   'M', 25)", "('levitate-tee',   'S', 2), ('levitate-tee',   'M', 16)")
        .replace("('levitate-tee',   'L', 17), ('levitate-tee',   'XL', 4)", "('levitate-tee',   'L', 10), ('levitate-tee',   'XL', 2)")
        .replace("('endzustand-tee', 'S', 4), ('endzustand-tee', 'M', 25)", "('endzustand-tee', 'S', 2), ('endzustand-tee', 'M', 16)")
        .replace("('endzustand-tee', 'L', 17), ('endzustand-tee', 'XL', 4)", "('endzustand-tee', 'L', 10), ('endzustand-tee', 'XL', 2)");
    assert.notEqual(old, current, 'the old allocation was substituted');
    await stack.db.query(old);
}

const allocatedBy = (stack) => stack.db.query(`select variant_id, sum(delta)::int as n from inventory_movements
    where kind in ('initial', 'allocation') group by 1 order by 1`).then((r) => Object.fromEntries(r.rows.map((x) => [x.variant_id, x.n])));

// A store stocked before the production run grew: allocated S2 M16 L10 XL2,
// with sales, an open hold, a restocked return and manual adjustments on it.
// The allocation migration must move only the allocation, once.
describe('production allocation 50 per design', () => {
    const TARGET = { S: 4, M: 25, L: 17, XL: 4 };
    let stack;
    let admin;
    let held;
    let snapshot;
    let movementsBefore;
    const items = () => stack.db.query('select variant_id, on_hand, reserved, sold, returned from inventory_items order by 1')
        .then((r) => Object.fromEntries(r.rows.map((x) => [x.variant_id, x])));
    const allocated = () => allocatedBy(stack);
    const adjust = (body) => stack.api('POST', '/api/inventory', { action: 'adjust', ...body }, { Authorization: `Bearer ${admin}` });

    before(async () => {
        stack = await startStack();
        admin = stack.addUser({ email: 'owner@eternalvoid.co' });
        await stockAtOldAllocation(stack);
        assert.deepEqual(await allocated(), {
            [END('L')]: 10, [END('M')]: 16, [END('S')]: 2, [END('XL')]: 2,
            [LVT('L')]: 10, [LVT('M')]: 16, [LVT('S')]: 2, [LVT('XL')]: 2
        });
    });
    after(async () => { await stack.stop(); });

    it('keeps sales, holds, returns and adjustments, and adds only the difference', async () => {
        // Two sold Levitate M, one of them returned and restocked; an Endzustand L held
        // in an open checkout; an Endzustand S written off; a Levitate XL found.
        const sale = await openCheckout(stack, [{ variantId: LVT('M'), quantity: 2 }]);
        await pay(stack, sale.data.clientSecret);
        assert.equal((await adjust({ variantId: LVT('M'), mode: 'return', quantity: 1, reason: 'Approved return', orderNumber: sale.data.orderNumber })).status, 200);
        held = await openCheckout(stack, [{ variantId: END('L'), quantity: 3 }]);
        assert.equal(held.status, 200);
        assert.equal((await adjust({ variantId: END('S'), mode: 'adjust', quantity: -1, reason: 'Damaged in transit' })).status, 200);
        assert.equal((await adjust({ variantId: LVT('XL'), mode: 'adjust', quantity: 1, reason: 'Found in stockroom' })).status, 200);

        snapshot = await items();
        movementsBefore = (await stack.db.query('select * from inventory_movements order by id')).rows;
        const reservationsBefore = (await stack.db.query('select id, status, quantity, expires_at from inventory_reservations order by id')).rows;
        const ordersBefore = (await stack.db.query('select id, payment_status, status from orders order by id')).rows;

        await applyAllocationMigration(stack.db);

        const after = await items();
        const old = { S: 2, M: 16, L: 10, XL: 2 };
        for (const slug of ['levitate-tee', 'endzustand-tee']) {
            for (const size of Object.keys(TARGET)) {
                const id = `${slug}:${size}`;
                assert.equal(after[id].on_hand, snapshot[id].on_hand + TARGET[size] - old[size], `${id} on hand`);
                assert.deepEqual([after[id].reserved, after[id].sold, after[id].returned],
                    [snapshot[id].reserved, snapshot[id].sold, snapshot[id].returned], `${id} untouched otherwise`);
            }
        }
        assert.deepEqual(await allocated(), {
            [END('L')]: 17, [END('M')]: 25, [END('S')]: 4, [END('XL')]: 4,
            [LVT('L')]: 17, [LVT('M')]: 25, [LVT('S')]: 4, [LVT('XL')]: 4
        });
        // The figures a shopper and the dashboard see.
        assert.deepEqual(await stack.stock(LVT('M')), { onHand: 24, reserved: 0, available: 24, sold: 2, returned: 1 });
        assert.deepEqual(await stack.stock(END('L')), { onHand: 17, reserved: 3, available: 14, sold: 0, returned: 0 });
        assert.deepEqual(await stack.stock(END('S')), { onHand: 3, reserved: 0, available: 3, sold: 0, returned: 0 });
        assert.deepEqual(await stack.stock(LVT('XL')), { onHand: 5, reserved: 0, available: 5, sold: 0, returned: 0 });

        // History is appended to, never rewritten; holds and orders are as they were.
        const movementsAfter = (await stack.db.query('select * from inventory_movements order by id')).rows;
        assert.deepEqual(movementsAfter.slice(0, movementsBefore.length), movementsBefore);
        const added = movementsAfter.slice(movementsBefore.length);
        assert.equal(added.length, 8);
        assert.ok(added.every((m) => m.kind === 'allocation' && /→/.test(m.reason) && m.actor_email === null));
        assert.deepEqual((await stack.db.query('select id, status, quantity, expires_at from inventory_reservations order by id')).rows, reservationsBefore);
        assert.deepEqual((await stack.db.query('select id, payment_status, status from orders order by id')).rows, ordersBefore);

        // Nothing else is stocked: Insigne stays untracked, XS stays absent.
        assert.deepEqual(Object.keys(after).sort(), Object.keys(snapshot).sort());
        assert.equal(Object.keys(after).some((id) => id.startsWith('insigne') || id.endsWith(':XS')), false);
    });

    it('is idempotent: running it again adds nothing', async () => {
        const once = await items();
        const count = (await stack.db.query('select count(*)::int as n from inventory_movements')).rows[0].n;
        await applyAllocationMigration(stack.db);
        await applyAllocationMigration(stack.db);
        await applyInventoryMigrationAgain(stack.db);
        assert.deepEqual(await items(), once);
        assert.equal((await stack.db.query('select count(*)::int as n from inventory_movements')).rows[0].n, count);
    });

    it('leaves the 30-minute hold, payment confirmation and release working on the new stock', async () => {
        assert.ok(Date.parse(held.data.holdExpiresAt) > Date.now() + 25 * 60 * 1000);
        await pay(stack, held.data.clientSecret);
        assert.deepEqual(await stack.stock(END('L')), { onHand: 14, reserved: 0, available: 14, sold: 3, returned: 0 });
        // All 25 M can be held (at most 10 per line, as always), and no 26th.
        const opened = [];
        for (const quantity of [10, 10, 5]) {
            const res = await openCheckout(stack, [{ variantId: END('M'), quantity }]);
            assert.equal(res.status, 200, `hold ${quantity}`);
            opened.push(res);
        }
        assert.equal((await openCheckout(stack, [{ variantId: END('M'), quantity: 1 }])).status, 409, 'and no 26th');
        for (const res of opened) await stack.api('POST', '/api/checkout/order', { action: 'release', clientSecret: res.data.clientSecret });
        assert.deepEqual(await stack.stock(END('M')), { onHand: 25, reserved: 0, available: 25, sold: 0, returned: 0 });
    });

    it('shows each design\'s production allocation on the admin dashboard data, to admins only', async () => {
        const res = await stack.api('GET', '/api/inventory?scope=admin', undefined, { Authorization: `Bearer ${admin}` });
        assert.equal(res.status, 200);
        const by = {};
        res.data.items.forEach((i) => { by[i.productSlug] = (by[i.productSlug] || 0) + i.allocated; });
        assert.deepEqual(by, { 'endzustand-tee': 50, 'levitate-tee': 50 });
        assert.ok(res.data.movements.some((m) => m.kind === 'allocation'));
        assert.equal((await stack.api('GET', '/api/inventory?scope=admin')).status, 401);
        const customer = stack.addUser({ email: 'shopper@example.com' });
        assert.equal((await stack.api('GET', '/api/inventory?scope=admin', undefined, { Authorization: `Bearer ${customer}` })).status, 403);
    });
});

describe('production allocation from two sessions at once', () => {
    it('raises each size exactly once when two runs race', async () => {
        const stack = await startStack();
        const extra = new pg.Client({ host: stack.db.host, port: stack.db.port, user: stack.db.user, database: stack.db.database });
        try {
            await stockAtOldAllocation(stack);
            await extra.connect();
            await Promise.all([applyAllocationMigration(stack.db), applyAllocationMigration(extra)]);
            assert.deepEqual(await allocatedBy(stack), {
                [END('L')]: 17, [END('M')]: 25, [END('S')]: 4, [END('XL')]: 4,
                [LVT('L')]: 17, [LVT('M')]: 25, [LVT('S')]: 4, [LVT('XL')]: 4
            });
            const { rows } = await stack.db.query(`select i.variant_id, i.on_hand,
                    (select count(*)::int from inventory_movements m where m.variant_id = i.variant_id and m.kind = 'allocation') as raises
                from inventory_items i order by 1`);
            assert.deepEqual(rows.map((r) => [r.variant_id, r.on_hand, r.raises]), [
                [END('L'), 17, 1], [END('M'), 25, 1], [END('S'), 4, 1], [END('XL'), 4, 1],
                [LVT('L'), 17, 1], [LVT('M'), 25, 1], [LVT('S'), 4, 1], [LVT('XL'), 4, 1]
            ]);
        } finally {
            await extra.end().catch(() => {});
            await stack.stop();
        }
    });

    it('is a no-op on a store created at 50 per design', async () => {
        const stack = await startStack();
        try {
            // Every migration has already run once on a new store.
            const { rows } = await stack.db.query("select count(*)::int as n from inventory_movements where kind = 'allocation'");
            assert.equal(rows[0].n, 0);
            assert.equal((await stack.db.query('select sum(on_hand)::int as n from inventory_items')).rows[0].n, 100);
        } finally {
            await stack.stop();
        }
    });
});

describe('checkout holds and sales', () => {
    let stack;
    before(async () => { stack = await startStack(); });
    after(async () => { await stack.stop(); });

    it('holds stock when checkout starts, not before', async () => {
        const quote = await stack.api('POST', '/api/checkout/quote', { items: [{ variantId: END('M'), quantity: 3 }] });
        assert.equal(quote.data.ok, true);
        assert.equal(quote.data.lines[0].available, 25);
        assert.equal((await stack.stock(END('M'))).reserved, 0, 'a quote never holds stock');

        const res = await openCheckout(stack, [{ variantId: END('M'), quantity: 3 }]);
        assert.equal(res.status, 200);
        assert.ok(res.data.clientSecret);
        assert.ok(Date.parse(res.data.holdExpiresAt) > Date.now() + 25 * 60 * 1000);
        assert.deepEqual(await stack.stock(END('M')), { onHand: 25, reserved: 3, available: 22, sold: 0, returned: 0 });

        // A hold is not a sale.
        const { rows } = await stack.db.query("select count(*)::int as n from inventory_movements where kind = 'sale'");
        assert.equal(rows[0].n, 0);
        stack.lastCheckout = res.data;
    });

    it('deducts every unit purchased once payment is verified', async () => {
        const delivery = await pay(stack, stack.lastCheckout.clientSecret);
        assert.equal(delivery.status, 200);
        assert.equal(delivery.data.outcome, 'confirmed');
        assert.deepEqual(await stack.stock(END('M')), { onHand: 22, reserved: 0, available: 22, sold: 3, returned: 0 });
        const { rows } = await stack.db.query("select payment_status, status, livemode from orders where order_number = $1",
            [stack.lastCheckout.orderNumber]);
        assert.deepEqual(rows[0], { payment_status: 'paid', status: 'confirmed', livemode: false });
    });

    it('processes duplicated, retried and out-of-order notifications exactly once', async () => {
        const res = await openCheckout(stack, [{ variantId: END('L'), quantity: 2 }]);
        const piId = res.data.clientSecret.split('_secret_')[0];
        const processingSnapshot = stack.stripe.processing(piId);
        const processing = await stack.deliver('payment_intent.processing', processingSnapshot);
        assert.equal(processing.data.outcome, 'held');
        const { rows: held } = await stack.db.query(
            "select expires_at from inventory_reservations where variant_id = 'endzustand-tee:L' and status = 'active'");
        assert.equal(held[0].expires_at, null, 'a processing payment is held without a deadline');

        const succeeded = await stack.deliver('payment_intent.succeeded', stack.stripe.succeed(piId));
        assert.equal(succeeded.data.outcome, 'confirmed');

        // The same delivery again (Stripe retry) …
        const retry = await stack.redeliver(succeeded);
        assert.equal(retry.status, 200);
        assert.equal(retry.data.duplicate, true);
        // … a second, distinct event for the same payment …
        const second = await stack.deliver('payment_intent.succeeded', stack.stripe.get(piId));
        assert.equal(second.data.outcome, 'already_paid');
        // … a stale `processing` arriving last, and two at once.
        const stale = await stack.deliver('payment_intent.processing', processingSnapshot);
        assert.equal(stale.data.outcome, 'already_paid');
        const racing = await Promise.all([
            stack.deliver('payment_intent.succeeded', stack.stripe.get(piId)),
            stack.deliver('payment_intent.succeeded', stack.stripe.get(piId))
        ]);
        racing.forEach((r) => assert.equal(r.data.outcome, 'already_paid'));

        assert.deepEqual(await stack.stock(END('L')), { onHand: 15, reserved: 0, available: 15, sold: 2, returned: 0 });
        const { rows } = await stack.db.query(
            "select count(*)::int as n from inventory_movements where kind = 'sale' and variant_id = 'endzustand-tee:L'");
        assert.equal(rows[0].n, 1);
    });

    it('rejects webhooks without a valid signature', async () => {
        const res = await fetch(`${stack.origin}/api/stripe-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=forged' },
            body: JSON.stringify({ id: 'evt_x', type: 'payment_intent.succeeded', data: { object: { id: 'pi_x' } } })
        });
        assert.equal(res.status, 400);
    });

    it('keeps the hold through a declined attempt so the customer can retry', async () => {
        const res = await openCheckout(stack, [{ variantId: LVT('S'), quantity: 1 }]);
        const piId = res.data.clientSecret.split('_secret_')[0];
        const declined = await stack.deliver('payment_intent.payment_failed', stack.stripe.decline(piId));
        assert.equal(declined.data.outcome, 'failed');
        assert.equal((await stack.stock(LVT('S'))).reserved, 1);

        const ok = await stack.deliver('payment_intent.succeeded', stack.stripe.succeed(piId));
        assert.equal(ok.data.outcome, 'confirmed');
        assert.deepEqual(await stack.stock(LVT('S')), { onHand: 3, reserved: 0, available: 3, sold: 1, returned: 0 });
    });

    it('flags, and does not fulfil, a payment for the wrong amount', async () => {
        const res = await openCheckout(stack, [{ variantId: LVT('L'), quantity: 1 }]);
        const piId = res.data.clientSecret.split('_secret_')[0];
        const delivery = await stack.deliver('payment_intent.succeeded', stack.stripe.succeed(piId, { amountReceived: 100 }));
        assert.equal(delivery.data.outcome, 'amount_mismatch');
        const { rows } = await stack.db.query('select payment_status, inventory_status from orders where order_number = $1',
            [res.data.orderNumber]);
        assert.deepEqual(rows[0], { payment_status: 'failed', inventory_status: 'amount_mismatch' });
        assert.deepEqual(await stack.stock(LVT('L')), { onHand: 17, reserved: 1, available: 16, sold: 0, returned: 0 });
    });

    it('does not restock on a refund event', async () => {
        const before = await stack.stock(END('M'));
        const res = await stack.deliver('charge.refunded', { id: 'ch_test', object: 'charge', payment_intent: 'pi_any' });
        assert.equal(res.data.ignored, 'charge.refunded');
        assert.deepEqual(await stack.stock(END('M')), before);
    });
});

describe('thresholds', () => {
    let stack;
    before(async () => { stack = await startStack(); });
    after(async () => { await stack.stop(); });

    async function stateWith(sizes) {
        for (const [size, n] of Object.entries(sizes)) await stack.setStock(LVT(size), n);
        const res = await stack.api('GET', '/api/inventory');
        return res.data.products['levitate-tee'];
    }

    it('changes state at 11, 10, 2, 1 and 0 available', async () => {
        assert.equal((await stateWith({ S: 0, M: 11, L: 0, XL: 0 })).state, 'in_stock');
        const ten = await stateWith({ M: 10 });
        assert.equal(ten.state, 'low');
        assert.equal(ten.available, 10);
        assert.equal((await stateWith({ M: 2 })).state, 'low');
        assert.equal((await stateWith({ M: 1 })).state, 'last');
        const zero = await stateWith({ M: 0 });
        assert.equal(zero.state, 'sold_out');
        // Zeroed here without a single sale, so the size reads "unavailable";
        // a size emptied by sales reads "sold out" (asserted below).
        assert.equal(zero.sizes.M.state, 'unavailable');
    });

    it('says "reserved", not "sold out", while the last pieces are only held', async () => {
        await stateWith({ M: 1 });
        const res = await openCheckout(stack, [{ variantId: LVT('M'), quantity: 1 }]);
        assert.equal(res.status, 200);
        const p = (await stack.api('GET', '/api/inventory')).data.products['levitate-tee'];
        assert.equal(p.available, 0);
        assert.equal(p.state, 'reserved');
        assert.equal(p.sizes.M.state, 'reserved');

        // And it really is sold out once that hold is paid.
        await pay(stack, res.data.clientSecret);
        const sold = (await stack.api('GET', '/api/inventory')).data.products['levitate-tee'];
        assert.equal(sold.state, 'sold_out');
        assert.equal(sold.sizes.M.state, 'sold_out');
    });

    it('lets one size sell out while the others stay purchasable', async () => {
        await stack.setStock(END('S'), 2);
        const res = await openCheckout(stack, [{ variantId: END('S'), quantity: 2 }]);
        await pay(stack, res.data.clientSecret);
        const p = (await stack.api('GET', '/api/inventory')).data.products['endzustand-tee'];
        assert.equal(p.sizes.S.state, 'sold_out');
        assert.equal(p.sizes.M.state, 'in_stock');
        assert.equal(p.state, 'in_stock');

        const refused = await openCheckout(stack, [{ variantId: END('S'), quantity: 1 }]);
        assert.equal(refused.status, 409);
        assert.equal(refused.data.issues[0].reason, 'insufficient_stock');
        assert.equal(refused.data.issues[0].available, 0);
        const fine = await openCheckout(stack, [{ variantId: END('M'), quantity: 1 }]);
        assert.equal(fine.status, 200);
    });
});

describe('concurrency', () => {
    let stack;
    before(async () => { stack = await startStack(); });
    after(async () => { await stack.stop(); });

    it('gives the final piece to exactly one of two simultaneous checkouts', async () => {
        await stack.setStock(LVT('XL'), 1);
        const [a, b] = await Promise.all([
            openCheckout(stack, [{ variantId: LVT('XL'), quantity: 1 }]),
            openCheckout(stack, [{ variantId: LVT('XL'), quantity: 1 }])
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        const loser = a.status === 409 ? a : b;
        assert.equal(loser.data.issues[0].available, 0);
        assert.equal(loser.data.issues[0].held, true);
        assert.deepEqual(await stack.stock(LVT('XL')), { onHand: 1, reserved: 1, available: 0, sold: 0, returned: 0 });
        const { rows } = await stack.db.query(
            "select count(*)::int as n from orders where payment_status = 'pending' and status = 'pending'");
        assert.equal(rows[0].n, 1, 'the losing request wrote nothing');
    });

    it('never oversells under a burst of 40 simultaneous checkouts for 25 pieces', async () => {
        const results = await Promise.all(Array.from({ length: 40 }, () =>
            openCheckout(stack, [{ variantId: END('M'), quantity: 1 }])));
        assert.equal(results.filter((r) => r.status === 200).length, 25);
        assert.equal(results.filter((r) => r.status === 409).length, 15);
        assert.deepEqual(await stack.stock(END('M')), { onHand: 25, reserved: 25, available: 0, sold: 0, returned: 0 });
    });

    it('holds under contention straight at the database, across separate connections', async () => {
        // 25 independent connections race checkout_open_order for L (10 left).
        await stack.db.query("update inventory_items set on_hand = 10, reserved = 0 where variant_id = 'levitate-tee:L'");
        const conns = await Promise.all(Array.from({ length: 25 }, async () => {
            const c = new pg.Client({ host: process.env.PGHOST || '/tmp', port: Number(process.env.PGPORT || 54329), user: 'postgres', database: stack.dbName });
            await c.connect();
            return c;
        }));
        const outcomes = await Promise.all(conns.map((c, i) => c.query(
            'select checkout_open_order($1::jsonb, $2::jsonb, 1800) as r',
            [JSON.stringify({ order_number: `EV-26-RACE${String(i).padStart(2, '0')}`, customer_email: 'r@x.co',
                customer_first_name: 'R', customer_last_name: 'X', shipping_address: {}, currency: 'eur',
                subtotal_amount: 20000, shipping_amount: 0, tax_amount: 0, total_amount: 20000 }),
            JSON.stringify([{ variant_id: 'levitate-tee:L', product_slug: 'levitate-tee', product_name: 'Levitate Tee',
                size: 'L', unit_amount: 20000, quantity: 1, line_amount: 20000 }])]
        ).then((r) => r.rows[0].r.ok)));
        await Promise.all(conns.map((c) => c.end()));
        assert.equal(outcomes.filter(Boolean).length, 10);
        assert.deepEqual(await stack.stock(LVT('L')), { onHand: 10, reserved: 10, available: 0, sold: 0, returned: 0 });
    });

    it('refuses to let stock go negative even when asked directly', async () => {
        await assert.rejects(
            stack.db.query("update inventory_items set reserved = on_hand + 1 where variant_id = 'levitate-tee:L'"),
            /inventory_items_reserved_covered/);
        await assert.rejects(
            stack.db.query("update inventory_items set on_hand = -1, reserved = 0 where variant_id = 'levitate-tee:S'"),
            /inventory_items_on_hand_nonneg/);
    });
});

describe('releasing holds', () => {
    let stack;
    before(async () => { stack = await startStack(); });
    after(async () => { await stack.stop(); });

    async function expire(orderNumber) {
        await stack.db.query(`update inventory_reservations set expires_at = now() - interval '1 minute'
                               where order_id = (select id from orders where order_number = $1)`, [orderNumber]);
    }

    it('cancels an abandoned checkout at Stripe, then returns its pieces', async () => {
        const res = await openCheckout(stack, [{ variantId: LVT('M'), quantity: 4 }]);
        assert.equal((await stack.stock(LVT('M'))).reserved, 4);

        // Before the deadline nothing is touched.
        await stack.api('GET', '/api/inventory?sweep=1');
        assert.equal((await stack.stock(LVT('M'))).reserved, 4);

        await expire(res.data.orderNumber);
        const inv = await stack.api('GET', '/api/inventory');   // the public read sweeps inline
        assert.equal(inv.data.products['levitate-tee'].sizes.M.available, 25);

        const piId = res.data.clientSecret.split('_secret_')[0];
        assert.equal(stack.stripe.get(piId).status, 'canceled', 'the intent can no longer be charged');
        assert.deepEqual(await stack.stock(LVT('M')), { onHand: 25, reserved: 0, available: 25, sold: 0, returned: 0 });
        const { rows } = await stack.db.query('select status, payment_status from orders where order_number = $1', [res.data.orderNumber]);
        assert.deepEqual(rows[0], { status: 'cancelled', payment_status: 'failed' });

        // Stripe then tells us it was cancelled; nothing is released twice.
        const echo = await stack.deliver('payment_intent.canceled', stack.stripe.get(piId));
        assert.equal(echo.data.outcome, 'released');
        assert.equal((await stack.stock(LVT('M'))).reserved, 0);
    });

    it('never releases a hold whose payment is still processing at the bank', async () => {
        const res = await openCheckout(stack, [{ variantId: LVT('L'), quantity: 1 }]);
        const piId = res.data.clientSecret.split('_secret_')[0];
        stack.stripe.processing(piId);   // the webhook for it has not arrived yet
        await expire(res.data.orderNumber);

        const sweep = await stack.api('GET', '/api/inventory?sweep=1');
        assert.equal(sweep.data.results[0].outcome, 'held');
        assert.equal((await stack.stock(LVT('L'))).reserved, 1);
        const { rows } = await stack.db.query(
            "select expires_at from inventory_reservations where variant_id = 'levitate-tee:L' and status = 'active'");
        assert.equal(rows[0].expires_at, null);

        await stack.deliver('payment_intent.succeeded', stack.stripe.succeed(piId));
        assert.deepEqual(await stack.stock(LVT('L')), { onHand: 16, reserved: 0, available: 16, sold: 1, returned: 0 });
    });

    it('confirms, rather than releases, an expired hold whose payment actually went through', async () => {
        const res = await openCheckout(stack, [{ variantId: END('XL'), quantity: 1 }]);
        const piId = res.data.clientSecret.split('_secret_')[0];
        stack.stripe.succeed(piId);       // paid; webhook delayed
        await expire(res.data.orderNumber);
        const sweep = await stack.api('GET', '/api/inventory?sweep=1');
        assert.equal(sweep.data.results[0].outcome, 'confirmed');
        assert.deepEqual(await stack.stock(END('XL')), { onHand: 3, reserved: 0, available: 3, sold: 1, returned: 0 });
    });

    it('releases straight away when the customer leaves the payment step', async () => {
        const res = await openCheckout(stack, [{ variantId: END('L'), quantity: 2 }]);
        assert.equal((await stack.stock(END('L'))).reserved, 2);

        const secret = res.data.clientSecret;
        const forgedSecret = secret.slice(0, -1) + (secret.endsWith('0') ? '1' : '0');
        const forged = await stack.api('POST', '/api/checkout/order', { action: 'release', clientSecret: forgedSecret });
        assert.equal(forged.status, 404);
        assert.equal((await stack.stock(END('L'))).reserved, 2);

        const ok = await stack.api('POST', '/api/checkout/order', { action: 'release', clientSecret: res.data.clientSecret });
        assert.equal(ok.status, 200);
        assert.equal(ok.data.outcome, 'released');
        assert.equal((await stack.stock(END('L'))).reserved, 0);
    });

    it('leaves no stranded hold when checkout creation fails', async () => {
        const before = await stack.stock(LVT('S'));
        stack.stripe.faults.create = { status: 500 };
        const res = await openCheckout(stack, [{ variantId: LVT('S'), quantity: 2 }]);
        assert.equal(res.status, 502);
        assert.equal(res.data.error, 'payment_init_failed');
        assert.equal(res.data.clientSecret, undefined);
        assert.deepEqual(await stack.stock(LVT('S')), before);
        const { rows } = await stack.db.query(
            "select o.status, r.status as hold from orders o join inventory_reservations r on r.order_id = o.id order by o.created_at desc limit 1");
        assert.deepEqual(rows[0], { status: 'cancelled', hold: 'released' });

        // And the pieces are immediately purchasable again.
        const retry = await openCheckout(stack, [{ variantId: LVT('S'), quantity: 2 }]);
        assert.equal(retry.status, 200);
    });

    it('recovers a hold whose release was lost, via the sweeper', async () => {
        // Simulate a crash between "hold taken" and "intent attached": the
        // order has a hold and no intent, and the deadline has passed.
        const res = await openCheckout(stack, [{ variantId: END('S'), quantity: 1 }]);
        await stack.db.query('update orders set stripe_payment_intent_id = null where order_number = $1', [res.data.orderNumber]);
        await expire(res.data.orderNumber);
        await stack.api('GET', '/api/inventory?sweep=1');
        assert.equal((await stack.stock(END('S'))).reserved, 0);
    });
});

describe('stale carts and direct requests', () => {
    let stack;
    before(async () => { stack = await startStack(); });
    after(async () => { await stack.stop(); });

    it('rejects a bag for a sold-out piece at quote and at checkout', async () => {
        await stack.setStock(END('XL'), 0);
        const quote = await stack.api('POST', '/api/checkout/quote', { items: [{ variantId: END('XL'), quantity: 1 }] });
        assert.equal(quote.data.ok, false);
        assert.deepEqual(quote.data.issues[0], {
            variantId: END('XL'), reason: 'insufficient_stock', name: 'Endzustand Tee', size: 'XL', available: 0, held: false
        });
        const create = await openCheckout(stack, [{ variantId: END('XL'), quantity: 1 }]);
        assert.equal(create.status, 409);
    });

    it('rejects more units than remain, including when split across duplicate lines', async () => {
        const over = await openCheckout(stack, [{ variantId: LVT('S'), quantity: 5 }]);
        assert.equal(over.status, 409);
        assert.equal(over.data.issues[0].available, 4);
        const split = await openCheckout(stack, [
            { variantId: LVT('S'), quantity: 4 }, { variantId: LVT('S'), quantity: 1 }
        ]);
        assert.equal(split.status, 409);
        assert.equal((await stack.stock(LVT('S'))).reserved, 0);
    });

    it('rejects pieces that are not stocked at all', async () => {
        const insigne = await openCheckout(stack, [{ variantId: 'insigne-noir:M', quantity: 1 }]);
        assert.equal(insigne.status, 409);
        assert.equal(insigne.data.issues[0].reason, 'not_for_sale');
        const xs = await openCheckout(stack, [{ variantId: LVT('XS'), quantity: 1 }]);
        assert.equal(xs.status, 409);
        assert.equal(xs.data.issues[0].reason, 'unknown_size', 'XS is not a size of this design');
        const quote = await stack.api('POST', '/api/checkout/quote', { items: [{ variantId: END('XS'), quantity: 1 }] });
        assert.equal(quote.data.issues[0].reason, 'unknown_size');
        const { rows } = await stack.db.query("select count(*)::int as n from inventory_items where size = 'XS'");
        assert.equal(rows[0].n, 0);
    });

    it('ignores any price or stock figure the browser sends', async () => {
        const res = await stack.api('POST', '/api/checkout/create', checkoutBody(
            [{ variantId: LVT('M'), quantity: 1, price: 1, unitAmount: 1, available: 999 }],
            { total: 1, totalAmount: 1 }
        ));
        assert.equal(res.status, 200);
        assert.equal(res.data.totalAmount, 20000 + 990);
        const piId = res.data.clientSecret.split('_secret_')[0];
        assert.equal(stack.stripe.get(piId).amount, 20990);
    });
});

describe('inventory administration', () => {
    let stack;
    let admin;
    before(async () => {
        stack = await startStack();
        admin = stack.addUser({ email: 'owner@eternalvoid.co' });
    });
    after(async () => { await stack.stop(); });

    const adjust = (token, body) => stack.api('POST', '/api/inventory', { action: 'adjust', ...body },
        token ? { Authorization: `Bearer ${token}` } : {});

    it('rejects every unauthorised read and write', async () => {
        const body = { variantId: LVT('M'), mode: 'adjust', quantity: 50, reason: 'hacked' };
        assert.equal((await adjust(null, body)).status, 401);
        assert.equal((await adjust('not-a-token', body)).status, 401);
        const customer = stack.addUser({ email: 'client@example.com' });
        assert.equal((await adjust(customer, body)).status, 403);
        const unconfirmed = stack.addUser({ email: 'owner@eternalvoid.co', confirmed: false });
        assert.equal((await adjust(unconfirmed, body)).status, 403);
        assert.equal((await stack.api('GET', '/api/inventory?scope=admin', undefined, { Authorization: `Bearer ${customer}` })).status, 403);
        assert.equal((await stack.api('GET', '/api/inventory?scope=admin')).status, 401);
        assert.equal((await stack.stock(LVT('M'))).onHand, 25);
    });

    it('gives the public and signed-in customers no route to the tables or functions', async () => {
        const anon = { apikey: 'anon-key-for-tests' };
        const authed = { Authorization: `Bearer ${stack.signJwt({ role: 'authenticated', sub: crypto.randomUUID() })}` };
        for (const headers of [anon, authed]) {
            const read = await fetch(`${stack.restUrl}/inventory_items?select=*`, { headers });
            assert.ok([401, 403].includes(read.status), `select refused (${read.status})`);
            const call = await fetch(`${stack.restUrl}/rpc/inventory_admin_adjust`, {
                method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ p_variant_id: LVT('M'), p_mode: 'adjust', p_quantity: 99, p_reason: 'nope',
                    p_actor_id: null, p_actor_email: 'x' })
            });
            assert.ok([401, 403, 404].includes(call.status), `rpc refused (${call.status})`);
            const patch = await fetch(`${stack.restUrl}/inventory_items?variant_id=eq.${LVT('M')}`, {
                method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ on_hand: 999 })
            });
            assert.ok([401, 403].includes(patch.status), `patch refused (${patch.status})`);
        }
        assert.equal((await stack.stock(LVT('M'))).onHand, 25);
    });

    it('adjusts, takes stock and keeps an audit trail naming the admin', async () => {
        const down = await adjust(admin, { variantId: LVT('M'), mode: 'adjust', quantity: -2, reason: 'Two damaged in transit' });
        assert.equal(down.status, 200);
        assert.equal(down.data.item.onHand, 23);
        const count = await adjust(admin, { variantId: LVT('M'), mode: 'set', quantity: 24, reason: 'Stocktake 4 Oct' });
        assert.equal(count.data.item.onHand, 24);

        const noReason = await adjust(admin, { variantId: LVT('M'), mode: 'adjust', quantity: 1, reason: '' });
        assert.equal(noReason.status, 409);
        assert.equal(noReason.data.error, 'reason_required');

        const snap = await stack.api('GET', '/api/inventory?scope=admin', undefined, { Authorization: `Bearer ${admin}` });
        assert.equal(snap.status, 200);
        const m = snap.data.movements.slice(0, 2);
        assert.deepEqual(m.map((x) => [x.kind, x.delta, x.actorEmail]), [
            ['stocktake', 1, 'owner@eternalvoid.co'], ['adjustment', -2, 'owner@eternalvoid.co']
        ]);
        const row = snap.data.items.find((i) => i.variantId === LVT('M'));
        assert.deepEqual([row.onHand, row.reserved, row.available, row.sold, row.adjustments], [24, 0, 24, 0, -1]);

        // The trail cannot be rewritten, even with the service role.
        await assert.rejects(stack.db.query('delete from inventory_movements'), /append-only/);
    });

    it('will not remove units that are held in an open checkout', async () => {
        await stack.setStock(LVT('XL'), 2);
        await openCheckout(stack, [{ variantId: LVT('XL'), quantity: 2 }]);
        const res = await adjust(admin, { variantId: LVT('XL'), mode: 'set', quantity: 1, reason: 'Recount' });
        assert.equal(res.status, 409);
        assert.equal(res.data.error, 'below_reserved');
    });

    it('restocks a return only when told to, against the order it was sold in', async () => {
        const res = await openCheckout(stack, [{ variantId: END('L'), quantity: 2 }]);
        await pay(stack, res.data.clientSecret);
        assert.deepEqual(await stack.stock(END('L')), { onHand: 15, reserved: 0, available: 15, sold: 2, returned: 0 });

        const noOrder = await adjust(admin, { variantId: END('L'), mode: 'return', quantity: 1, reason: 'Returned' });
        assert.equal(noOrder.data.error, 'order_not_found');
        const wrongSize = await adjust(admin, { variantId: END('M'), mode: 'return', quantity: 1, reason: 'Returned', orderNumber: res.data.orderNumber });
        assert.equal(wrongSize.data.error, 'variant_not_in_order');

        const one = await adjust(admin, { variantId: END('L'), mode: 'return', quantity: 1, reason: 'Inspected, resaleable', orderNumber: res.data.orderNumber });
        assert.equal(one.status, 200);
        assert.deepEqual(await stack.stock(END('L')), { onHand: 16, reserved: 0, available: 16, sold: 2, returned: 1 });
        const tooMany = await adjust(admin, { variantId: END('L'), mode: 'return', quantity: 2, reason: 'Returned', orderNumber: res.data.orderNumber });
        assert.equal(tooMany.data.error, 'exceeds_returnable');
        assert.equal(tooMany.data.returnable, 1);
    });
});
