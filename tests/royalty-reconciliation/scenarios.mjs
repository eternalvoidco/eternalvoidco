// Every case the royalty terms promise, run against the real migrations in a
// real Postgres. Expected figures are worked out by hand from the published
// rule — "12% of the amount actually paid for the merchandise, after
// discounts, excluding VAT and separately charged shipping, less reversals
// applied once and bucketed on the date they happened" — and compared with
// what the statement actually returns.
import { boot, makeOrder, collab, reversal, statement, eur } from './boot.mjs';

const Q4 = ['2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z'];
const Q1 = ['2027-01-01T00:00:00Z', '2027-04-01T00:00:00Z'];

const fails = [];
let n = 0;
function check(name, actual, expected, extra) {
    n += 1;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    console.log(`          expected ${JSON.stringify(expected)}   actual ${JSON.stringify(actual)}${extra ? '   ' + extra : ''}`);
    if (!ok) fails.push(name);
}

const due = (s, email) => {
    const a = (s.artists || []).find((x) => x.artistEmail === email);
    return a ? a.royaltyDue : 0;
};
const base = (s, email) => {
    const a = (s.artists || []).find((x) => x.artistEmail === email);
    return a ? a.royaltyBase : 0;
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1 · the published example, and what is excluded from the base ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-COL-TEE-L' });
    // €160 merchandise, €12 shipping, €38 tax. Only the €160 may earn.
    await makeOrder(db, {
        items: [{ sku: 'EV-COL-TEE-L', name: 'Collab Tee', unit: 16000, qty: 1 }],
        shipping: 1200, tax: 3800, paidAt: '2026-11-02T10:00:00Z'
    });
    const s = await statement(db, ...Q4);
    check('royalty base is merchandise only — shipping and tax excluded',
        base(s, 'lena@studio.co'), 16000, `(${eur(16000)})`);
    check('12% of €160 pays €19.20',
        due(s, 'lena@studio.co'), 1920, `(${eur(1920)})`);
    check('a clean period is payout-ready', s.payoutReady, true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2 · two SKUs, two agreements, two rates (the max(bps) bug) ──');
{
    const db = await boot();
    await collab(db, { email: 'kai@studio.co', name: 'Kai', sku: 'EV-A', bps: 1200, ref: 'AGR-A' });
    await collab(db, { email: 'kai@studio.co', name: 'Kai', sku: 'EV-B', bps: 800, ref: 'AGR-B' });
    await makeOrder(db, {
        items: [{ sku: 'EV-A', name: 'A', unit: 10000, qty: 1 },
                { sku: 'EV-B', name: 'B', unit: 10000, qty: 1 }],
        paidAt: '2026-11-03T10:00:00Z'
    });
    const s = await statement(db, ...Q4);
    // 12% of 100 + 8% of 100 = 12 + 8 = €20.00.
    // The old max(bps) code would have charged 12% of €200 = €24.00.
    check('each SKU is paid at its own agreement rate',
        due(s, 'kai@studio.co'), 2000, `(${eur(2000)}; the blended-rate bug gave ${eur(2400)})`);
    const per = s.artists[0].perSku.map((x) => [x.sku, x.royaltyBps, x.royaltyDue]);
    check('per-SKU breakdown is on the statement', per,
        [['EV-A', 1200, 1200], ['EV-B', 800, 800]]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3 · a full-order refund, and the same event delivered repeatedly ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-COL-TEE-L' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-COL-TEE-L', name: 'Collab Tee', unit: 16000, qty: 1 }],
        shipping: 1200, paidAt: '2026-11-02T10:00:00Z'
    });
    // The whole order back, including shipping: €172.
    const first = await reversal(db, { ref: 're_1', pi: o.pi, amount: 17200, at: '2026-11-20T10:00:00Z' });
    check('a full-order reversal allocates by rule', first.allocation.rule, 'full_order');
    check('only the merchandise component is reversed', first.allocation.merchandiseReversed, 16000);

    // Stripe retries, and charge.refunded arrives alongside refund.created.
    await reversal(db, { ref: 're_1', pi: o.pi, amount: 17200, at: '2026-11-20T10:00:00Z' });
    await reversal(db, { ref: 're_1', pi: o.pi, amount: 17200, at: '2026-11-20T10:00:00Z' });

    const s = await statement(db, ...Q4);
    check('three deliveries of one refund reverse it once',
        [base(s, 'lena@studio.co'), due(s, 'lena@studio.co')], [0, 0]);
    const rows = await db.query('select count(*)::int as n from public.order_refunds');
    check('and leave one row, not three', rows.rows[0].n, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4 · multiple partial refunds on a single-line order ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    // No shipping, one line: the sole_line rule can read any partial amount.
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }],
        paidAt: '2026-10-05T10:00:00Z'
    });
    const a = await reversal(db, { ref: 're_a', pi: o.pi, amount: 5000, at: '2026-10-10T10:00:00Z' });
    const b = await reversal(db, { ref: 're_b', pi: o.pi, amount: 3000, at: '2026-10-12T10:00:00Z' });
    check('each partial allocates on its own', [a.allocation.rule, b.allocation.rule],
        ['sole_line', 'sole_line']);
    const s = await statement(db, ...Q4);
    // 200 − 50 − 30 = €120 base, 12% = €14.40
    check('both partials subtract', base(s, 'lena@studio.co'), 12000, `(${eur(12000)})`);
    check('royalty on the reduced base', due(s, 'lena@studio.co'), 1440, `(${eur(1440)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5 · a mixed cart, partially refunded: no evidence, so no guess ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-COL' });
    // One collaboration piece at €160 and one house piece at €90, plus
    // shipping. A €90 refund is unambiguous (unique_line_match); a €70 refund
    // matches nothing and must not be guessed at.
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-COL', name: 'Collab', unit: 16000, qty: 1 },
                { sku: 'EV-HOUSE', name: 'House', unit: 9000, qty: 1 }],
        shipping: 1000, paidAt: '2026-11-01T10:00:00Z'
    });

    const clear = await reversal(db, { ref: 're_clear', pi: o.pi, amount: 9000, at: '2026-11-05T10:00:00Z' });
    check('a refund matching exactly one line is attributed to it',
        clear.allocation.rule, 'unique_line_match');

    const murky = await reversal(db, { ref: 're_murky', pi: o.pi, amount: 7000, at: '2026-11-06T10:00:00Z' });
    check('a refund matching nothing is left unallocated',
        [murky.allocation.outcome, murky.allocation.reason], ['unallocated', 'ambiguous']);

    const s = await statement(db, ...Q4);
    check('the collaboration piece is untouched by the house-piece refund',
        base(s, 'lena@studio.co'), 16000, `(${eur(16000)})`);
    check('the unattributed €70 is carried on the face of the statement',
        s.unattributedTotal, 7000, `(${eur(7000)})`);
    check('and the period is NOT payout-ready', s.payoutReady, false);
    check('reconciliation says why', s.reconciliation.status, 'blocked');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6 · out-of-order delivery, and a refund that fails ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }],
        paidAt: '2026-10-05T10:00:00Z'
    });

    // The newer state arrives first, the older one second.
    await reversal(db, { ref: 're_x', pi: o.pi, amount: 5000, status: 'succeeded',
        at: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:05:00Z' });
    const stale = await reversal(db, { ref: 're_x', pi: o.pi, amount: 5000, status: 'pending',
        at: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z' });
    check('a stale delivery is refused', stale.outcome, 'stale');
    check('and the newer status stands', stale.status, 'succeeded');

    // A refund that was requested and then failed must not reduce anything.
    await reversal(db, { ref: 're_f', pi: o.pi, amount: 4000, status: 'pending',
        at: '2026-10-11T10:00:00Z', updatedAt: '2026-10-11T10:00:00Z' });
    await reversal(db, { ref: 're_f', pi: o.pi, amount: 4000, status: 'failed',
        at: '2026-10-11T10:00:00Z', updatedAt: '2026-10-11T11:00:00Z' });

    const s = await statement(db, ...Q4);
    // 200 − 50 (succeeded) = €150. The failed €40 does not count.
    check('a failed refund does not reduce the base',
        base(s, 'lena@studio.co'), 15000, `(${eur(15000)})`);
    check('royalty', due(s, 'lena@studio.co'), 1800, `(${eur(1800)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7 · a refund landing after quarter-end ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }],
        paidAt: '2026-12-20T10:00:00Z'
    });
    // Sold in Q4, refunded in Q1.
    await reversal(db, { ref: 're_late', pi: o.pi, amount: 20000, at: '2027-01-14T10:00:00Z' });

    const q4 = await statement(db, ...Q4);
    check('Q4 pays on the sale, because that is when the money came in',
        due(q4, 'lena@studio.co'), 2400, `(${eur(2400)})`);
    const q1 = await statement(db, ...Q1);
    check('Q1 carries the reversal, with no sale to absorb it',
        [base(q1, 'lena@studio.co'), q1.artists[0].carryForward], [0, 20000],
        `(carry ${eur(20000)})`);
    check('and raises no negative payment', due(q1, 'lena@studio.co'), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 8 · a dispute, and the funds reinstated ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }],
        paidAt: '2026-10-05T10:00:00Z'
    });

    await reversal(db, { ref: 'dp_1', object: 'dispute', kind: 'chargeback', pi: o.pi,
        amount: 20000, status: 'succeeded', at: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z' });
    let s = await statement(db, ...Q4);
    check('a chargeback reverses the sale while funds are withdrawn',
        [base(s, 'lena@studio.co'), due(s, 'lena@studio.co')], [0, 0]);

    // We win it. The money comes back to us, so the reversal is undone.
    await reversal(db, { ref: 'dp_1', object: 'dispute', kind: 'chargeback', pi: o.pi,
        amount: 20000, status: 'reinstated', at: '2026-10-20T10:00:00Z',
        updatedAt: '2026-11-25T10:00:00Z' });
    s = await statement(db, ...Q4);
    check('funds reinstated puts the royalty back',
        [base(s, 'lena@studio.co'), due(s, 'lena@studio.co')], [20000, 2400],
        `(${eur(2400)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 9 · a refund and a dispute on the same charge ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }],
        paidAt: '2026-10-05T10:00:00Z'
    });
    await reversal(db, { ref: 're_p', pi: o.pi, charge: 'ch_same', amount: 5000, at: '2026-10-10T10:00:00Z' });
    await reversal(db, { ref: 'dp_p', object: 'dispute', kind: 'chargeback', pi: o.pi,
        charge: 'ch_same', amount: 20000, at: '2026-10-18T10:00:00Z' });

    const s = await statement(db, ...Q4);
    check('both are flagged for review on the same charge',
        s.reconciliation.review.refundAndDisputeOnSameCharge.length, 1);
    check('the period is held for review rather than paid',
        [s.reconciliation.status, s.payoutReady], ['needs_review', false]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 10 · the discount tripwire ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    // This codebase cannot produce such an order — subtotalOf() is exactly
    // sum(lineAmount) and two constraints hold it there. Written directly, as
    // an import or a future discount feature would, to prove the tripwire bites
    // instead of the old code silently inferring a discount.
    await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }],
        subtotalOverride: 18000, paidAt: '2026-10-05T10:00:00Z'
    });
    const s = await statement(db, ...Q4);
    check('an order whose subtotal disagrees with its lines blocks the period',
        [s.reconciliation.status, s.payoutReady], ['blocked', false]);
    check('and names the order and both figures',
        s.reconciliation.blocking.discountAnomalies.map((d) => [d.subtotal_amount, d.lines_total]),
        [[18000, 20000]]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 11 · a line with no SKU ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 },
                { sku: null, name: 'Unlabelled', unit: 5000, qty: 1 }],
        paidAt: '2026-10-05T10:00:00Z'
    });
    const r = await reversal(db, { ref: 're_nosku', pi: o.pi, amount: 5000, at: '2026-10-09T10:00:00Z' });
    check('a reversal on an order with an unlabelled line is not allocated',
        r.allocation.reason, 'line_without_sku');
    const s = await statement(db, ...Q4);
    check('and the period is blocked',
        [s.reconciliation.status, s.reconciliation.blocking.linesWithoutSku.length], ['blocked', 1]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 12 · a refund on an order with no collaboration SKU ──');
{
    const db = await boot();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }],
        paidAt: '2026-10-05T10:00:00Z'
    });
    const other = await makeOrder(db, {
        items: [{ sku: 'EV-HOUSE', name: 'House', unit: 9000, qty: 1 }],
        paidAt: '2026-10-06T10:00:00Z'
    });
    const r = await reversal(db, { ref: 're_irrelevant', pi: other.pi, amount: 9000, at: '2026-10-09T10:00:00Z' });
    check('it needs no allocation at all', r.allocation.outcome, 'not_required');
    const s = await statement(db, ...Q4);
    check('and does not hold up the period',
        [s.reconciliation.status, s.payoutReady], ['clean', true]);
    check('nor touch the royalty', due(s, 'lena@studio.co'), 2400, `(${eur(2400)})`);
}

console.log(`\n${n - fails.length}/${n} passed` + (fails.length ? `\nFAILED: ${fails.join(', ')}` : ''));
process.exit(fails.length ? 1 : 0);
