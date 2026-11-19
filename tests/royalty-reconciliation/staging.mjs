// Staging verification: the four things that have to be positively
// established before a royalty can be paid, and the two races that could
// corrupt one.
//
// Run against the project's own migrations in a real Postgres.
import { boot, bootReady, setVatBasis, attest, makeOrder, collab, reversal, statement, eur } from './boot.mjs';

const Q4 = ['2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z'];
const Q1 = ['2027-01-01T00:00:00Z', '2027-04-01T00:00:00Z'];
const Q2 = ['2027-04-01T00:00:00Z', '2027-07-01T00:00:00Z'];

const fails = [];
let n = 0;
function check(name, actual, expected, extra) {
    n += 1;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    console.log(`          expected ${JSON.stringify(expected)}   actual ${JSON.stringify(actual)}${extra ? '   ' + extra : ''}`);
    if (!ok) fails.push(name);
}
const artist = (s, email) => (s.artists || []).find((a) => a.artistEmail === email) || {};

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── 1 · the VAT basis: the invoice fixture ──');
//
// THE FIXTURE. This is the invoice an order of this shape would produce, and
// it is the thing accounting has to confirm. It is NOT approved — see
// docs/ev-for-artists-handoff.md. Both readings are priced here so the
// decision can be made against real numbers.
//
//   one collaboration tee          €160.00  charged
//   shipping (EU tracked)           €12.00  charged, separately
//   orders.tax_amount                €0.00  always, in this codebase
//   ─────────────────────────────────────
//   total charged                  €172.00
//
//   if €160.00 is VAT-EXCLUSIVE   net merchandise €160.00 → 12% = €19.20
//   if €160.00 is VAT-INCLUSIVE   net merchandise €125.98 → 12% = €15.12
//     at HU 27%: 16000 × 10000 / 12700 = 12598 minor units
//
// The difference is €4.08 on one tee — the whole VAT rate — and nothing in
// this project says which is right.
{
    const db = await boot();                 // basis deliberately left 'unknown'
    await attest(db, ...Q4);
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-COL-TEE-L' });
    await makeOrder(db, {
        items: [{ sku: 'EV-COL-TEE-L', name: 'Collab Tee', unit: 16000, qty: 1 }],
        shipping: 1200, tax: 0, paidAt: '2026-11-02T10:00:00Z'
    });

    let s = await statement(db, ...Q4);
    check('an unresolved VAT basis blocks the period',
        [s.vatBasis, s.reconciliation.status, s.payoutReady], ['unknown', 'blocked', false]);
    check('and names the order, rather than assuming a reading',
        s.reconciliation.blocking.vatBasisUnresolved.map((v) => v.order_number).length, 1);

    // Accounting says exclusive.
    await setVatBasis(db, 'exclusive', { actor: 'accounting@eternalvoid.co' });
    s = await statement(db, ...Q4);
    check('declared EXCLUSIVE: the base is the charged amount',
        [artist(s, 'lena@studio.co').grossCharged, artist(s, 'lena@studio.co').grossMerchandise],
        [16000, 16000], `(${eur(16000)} charged, ${eur(16000)} net)`);
    check('and 12% pays €19.20', artist(s, 'lena@studio.co').royaltyDue, 1920, `(${eur(1920)})`);
    check('shipping never enters the base', artist(s, 'lena@studio.co').grossMerchandise, 16000,
        '(€12.00 shipping charged separately)');
    check('the period is now payable', s.payoutReady, true);

    // Accounting says inclusive at Hungarian 27%.
    await setVatBasis(db, 'inclusive', {
        actor: 'accounting@eternalvoid.co',
        rates: [{ country: '*', bps: 2700, note: 'HU standard rate' }]
    });
    s = await statement(db, ...Q4);
    check('declared INCLUSIVE at 27%: the VAT is taken out of the base',
        [artist(s, 'lena@studio.co').grossCharged, artist(s, 'lena@studio.co').grossMerchandise],
        [16000, 12598], `(${eur(16000)} charged, ${eur(12598)} net of VAT)`);
    check('and 12% pays €15.12', artist(s, 'lena@studio.co').royaltyDue, 1512,
        `(${eur(1512)} — ${eur(1920 - 1512)} less than the exclusive reading)`);

    // A destination with no rate on file cannot be priced either way.
    await db.query(`delete from public.artist_vat_rates`);
    s = await statement(db, ...Q4);
    check('an inclusive basis with no rate for the destination blocks',
        [s.reconciliation.status, s.payoutReady], ['blocked', false]);
}

console.log('\n── 1b · currency ──');
{
    const db = await bootReady();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }], paidAt: '2026-11-02T10:00:00Z'
    });
    await db.query(`update public.orders set currency = 'gbp' where id = $1`, [o.orderId]);
    const s = await statement(db, ...Q4);
    check('an order in another currency blocks a statement that declares EUR',
        [s.reconciliation.blocking.currencyNotEur.length, s.payoutReady], [1, false]);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── 2 · item-level evidence, where it genuinely exists ──');
{
    const db = await bootReady();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-COL' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-COL', name: 'Collab', unit: 16000, qty: 1 },
                { sku: 'EV-HOUSE', name: 'House', unit: 9000, qty: 1 }],
        shipping: 1000, paidAt: '2026-11-01T10:00:00Z'
    });

    // A refund this project issued itself, which can say what it was refunding.
    const evidenced = await reversal(db, {
        ref: 're_eviden', pi: o.pi, amount: 9000, at: '2026-11-05T10:00:00Z',
        evidence: { lines: [{ sku: 'EV-COL', amount: 9000 }] }
    });
    check('a refund carrying item-level evidence is allocated by it',
        [evidenced.allocation.rule, evidenced.allocation.merchandiseReversed], ['metadata', 9000]);

    const s = await statement(db, ...Q4);
    check('and it lands on the line the evidence names, not the one that matches the amount',
        artist(s, 'lena@studio.co').royaltyBase, 7000, `(${eur(16000)} − ${eur(9000)})`);

    // Evidence that does not reconcile is worse than none.
    const bad = await reversal(db, {
        ref: 're_badev', pi: o.pi, amount: 5000, at: '2026-11-07T10:00:00Z',
        evidence: { lines: [{ sku: 'EV-COL', amount: 99000 }] }
    });
    check('evidence that overstates a line is refused and sent to the worklist',
        bad.allocation.outcome, 'unallocated');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── 2b · two concurrent deliveries, the slower one older ──');
{
    const db = await bootReady();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    const o = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }], paidAt: '2026-10-05T10:00:00Z'
    });

    // Handler B read Stripe later and writes first: the refund has succeeded.
    await reversal(db, { ref: 're_race', pi: o.pi, amount: 5000, status: 'succeeded',
        at: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:05:00Z' });
    // Handler A read earlier (status still pending) and finishes writing last.
    const late = await reversal(db, { ref: 're_race', pi: o.pi, amount: 5000, status: 'pending',
        at: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z' });
    check('the older read is refused on its timestamp',
        [late.outcome, late.reason, late.status], ['stale', 'older source timestamp', 'succeeded']);

    // The harder case: both carry the SAME event timestamp, so there is no
    // ordering to appeal to. The status itself must not go backwards.
    const tie = await reversal(db, { ref: 're_race', pi: o.pi, amount: 5000, status: 'pending',
        at: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:05:00Z' });
    check('and on a tied timestamp the status still cannot regress',
        [tie.outcome, tie.reason, tie.status], ['stale', 'status would regress', 'succeeded']);

    const row = (await db.query(
        `select status from public.order_refunds where provider_ref = 're_race'`)).rows[0];
    check('the persisted state is the newer one', row.status, 'succeeded');

    // Forward movement is still allowed on a tie: succeeded → reinstated.
    const forward = await reversal(db, { ref: 're_race', pi: o.pi, amount: 5000, status: 'reinstated',
        at: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:05:00Z' });
    check('but a genuine advance on a tied timestamp is accepted',
        [forward.outcome, forward.status], ['updated', 'reinstated']);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── 3 · payout readiness needs positive evidence of coverage ──');
{
    const db = await boot();
    await setVatBasis(db, 'exclusive');
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
    await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }], paidAt: '2026-11-05T10:00:00Z'
    });

    let s = await statement(db, ...Q4);
    check('a period with no reversals and no attestation is NOT clean',
        [s.reconciliation.status, s.payoutReady], ['blocked', false],
        '(silence is not the same as reconciled)');
    check('and the gap is named', s.reconciliation.coverage.covered, false);

    // Half the quarter attested: still a gap.
    await attest(db, '2026-10-01T00:00:00Z', '2026-11-15T00:00:00Z');
    s = await statement(db, ...Q4);
    check('partial coverage is reported as the gap it is',
        [s.reconciliation.status, s.reconciliation.coverage.covered], ['blocked', false]);
    check('naming where the gap starts',
        String(s.reconciliation.coverage.gapFrom).slice(0, 10), '2026-11-15');

    await attest(db, '2026-11-15T00:00:00Z', '2027-01-01T00:00:00Z');
    s = await statement(db, ...Q4);
    check('two adjoining attestations close it',
        [s.reconciliation.coverage.covered, s.payoutReady], [true, true]);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── 4 · the carried balance: Q4 paid, Q1 refunded, Q2 settles ──');
{
    const db = await bootReady();
    await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });

    // Q4: one sale of €200. 12% = €24.00, paid.
    const o4 = await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }], paidAt: '2026-12-10T10:00:00Z'
    });
    let s = await statement(db, ...Q4);
    check('Q4 pays €24.00', artist(s, 'lena@studio.co').royaltyDue, 2400, `(${eur(2400)})`);
    check('Q4 is payable', s.payoutReady, true);

    // Q1: that sale is refunded in full, and Q1 has no sales to absorb it.
    await reversal(db, { ref: 're_q1', pi: o4.pi, amount: 20000, at: '2027-02-02T10:00:00Z' });
    s = await statement(db, ...Q1);
    check('Q1 has nothing to deduct from, so it raises a carry',
        [artist(s, 'lena@studio.co').royaltyBase, artist(s, 'lena@studio.co').carryForward],
        [0, 20000], `(carry ${eur(20000)})`);
    check('and pays nothing rather than a negative amount',
        artist(s, 'lena@studio.co').royaltyDue, 0);

    // Close Q1: raise the carry as a ledger entry.
    let raised = (await db.query(
        `select public.artist_royalty_raise_carry($1,$2,$3) as r`, [...Q1, 'accounting@test'])).rows[0].r;
    check('closing Q1 raises one carry', [raised.raised, raised.alreadyRaised], [1, 0]);

    // THE WHOLE POINT: raising it again must do nothing.
    raised = (await db.query(
        `select public.artist_royalty_raise_carry($1,$2,$3) as r`, [...Q1, 'accounting@test'])).rows[0].r;
    check('raising it a second time raises nothing',
        [raised.raised, raised.alreadyRaised], [0, 1], '(applied exactly once)');
    const ledger = (await db.query(
        `select count(*)::int as n from public.artist_royalty_adjustments`)).rows[0].n;
    check('the ledger holds one row, not two', ledger, 1);

    // Q2: €300 of sales, against which the carried €200 is applied.
    await makeOrder(db, {
        items: [{ sku: 'EV-S', name: 'S', unit: 30000, qty: 1 }], paidAt: '2027-05-04T10:00:00Z'
    });
    s = await statement(db, ...Q2);
    check('Q2 applies the carried balance before the rate',
        [artist(s, 'lena@studio.co').grossMerchandise,
         artist(s, 'lena@studio.co').carriedIn,
         artist(s, 'lena@studio.co').royaltyBase],
        [30000, 20000, 10000], `(${eur(30000)} − ${eur(20000)} = ${eur(10000)})`);
    check('so Q2 pays 12% of €100.00, not of €300.00',
        artist(s, 'lena@studio.co').royaltyDue, 1200,
        `(${eur(1200)}; without the carry it would have paid ${eur(3600)})`);

    // Consume it, and prove it cannot be spent twice.
    const consumed = (await db.query(
        `select public.artist_royalty_consume_carry($1,$2,$3) as r`, [...Q2, 'accounting@test'])).rows[0].r;
    check('paying Q2 consumes the carry', consumed.consumed, 1);

    s = await statement(db, ...Q2);
    check('a second look at Q2 no longer deducts it',
        [artist(s, 'lena@studio.co').carriedIn, artist(s, 'lena@studio.co').royaltyDue],
        [0, 3600], '(the balance is spent, not reusable)');

    const again = (await db.query(
        `select public.artist_royalty_consume_carry($1,$2,$3) as r`, [...Q2, 'accounting@test'])).rows[0].r;
    check('and consuming again consumes nothing', again.consumed, 0);
}

console.log(`\n${n - fails.length}/${n} passed` + (fails.length ? `\nFAILED: ${fails.join(', ')}` : ''));
process.exit(fails.length ? 1 : 0);
