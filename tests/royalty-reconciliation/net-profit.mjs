// The royalty on net profit, against the real migrations in a real Postgres.
//
// The draft rule: sales of the artist's design after discounts and refunds,
// net of VAT, separately charged shipping excluded; less documented
// manufacturing, printing, packaging and payment-processing costs
// attributable to the units sold, each counted once; 12% of what is left.
// Sampling, marketing and general overhead are ETERNAL VOID's and are never
// deducted. Expected figures are worked by hand from that rule.
import { boot as bootBare, bootReady as boot, makeOrder, collab, reversal, statement, eur, setVatBasis, attest } from './boot.mjs';

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
const sku = (s, email, code) => {
    const a = (s.artists || []).find((x) => x.artistEmail === email);
    return a && (a.perSku || []).find((x) => x.sku === code);
};
async function cost(db, c) {
    const { rows } = await db.query(
        `select public.artist_royalty_cost_record($1,$2,$3,$4,$5,$6,$7,'accounting@test',$8) as r`,
        [c.sku, c.category, c.basis, c.amount, c.from, c.to || null, c.ref, c.note || null]);
    return rows[0].r;
}
const ARTIST = 'mira@studio.co', SKU = 'EV-S1-TEST';

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1 · the published example: €1,000 − €400 = €600 profit → €72 ──');
{
    const db = await boot();
    await collab(db, { email: ARTIST, name: 'Mira', sku: SKU });
    // Ten tees at €100 — €1,000 of eligible sales — with €15 shipping and
    // €27 tax on the order, neither of which may earn.
    await makeOrder(db, { items: [{ sku: SKU, name: 'Mira Tee', unit: 10000, qty: 10 }],
        shipping: 1500, tax: 2700, paidAt: '2026-11-03T10:00:00Z' });
    // €400 of documented costs: three per-unit rates and one attributed fee.
    await cost(db, { sku: SKU, category: 'manufacturing', basis: 'per_unit', amount: 2500, from: '2026-10-01', ref: 'INV-MFG-0042' });
    await cost(db, { sku: SKU, category: 'printing', basis: 'per_unit', amount: 800, from: '2026-10-01', ref: 'INV-PRT-0107' });
    await cost(db, { sku: SKU, category: 'packaging', basis: 'per_unit', amount: 200, from: '2026-10-01', ref: 'INV-PKG-0009' });
    await cost(db, { sku: SKU, category: 'payment_processing', basis: 'attributed', amount: 5000, from: '2026-11-03', ref: 'STRIPE-FEES-2026-11-03' });
    const s = await statement(db, ...Q4);
    const d = sku(s, ARTIST, SKU);
    check('sales: €1,000 — shipping and tax excluded', d.sales, 100000, `(${eur(d.sales)})`);
    check('deductions: €400 in total', d.deductions, 40000, `(${eur(d.deductions)})`);
    check('deductions by category, as the statement shows them', Object.fromEntries(Object.entries(d.deductionsByCategory).sort()),
        { manufacturing: 25000, packaging: 2000, paymentProcessing: 5000, printing: 8000 });
    check('profit: €600', d.profit, 60000, `(${eur(d.profit)})`);
    check('royalty: 12% of €600 is €72', d.royaltyDue, 7200, `(${eur(d.royaltyDue)})`);
    check('every cost line is on the statement (4 lines)', s.costLines.length, 4);
    check('payout-ready: reconciled and costs attested', s.payoutReady, true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2 · each cost once, and only the four categories ──');
{
    const db = await boot();
    await collab(db, { email: ARTIST, name: 'Mira', sku: SKU });
    const first = await cost(db, { sku: SKU, category: 'manufacturing', basis: 'per_unit', amount: 2500, from: '2026-10-01', ref: 'INV-1' });
    const again = await cost(db, { sku: SKU, category: 'manufacturing', basis: 'attributed', amount: 2500, from: '2027-01-01', ref: 'INV-1' });
    check('the same document cannot be recorded twice for the same design', [first.ok, again.error], [true, 'already_recorded']);
    const overlap = await cost(db, { sku: SKU, category: 'manufacturing', basis: 'per_unit', amount: 2400, from: '2026-12-01', ref: 'INV-2' });
    check('a second per-unit rate over the same days is refused (no unit charged twice)', overlap.error, 'overlapping_rate');
    for (const category of ['sampling', 'marketing', 'overhead']) {
        const r = await cost(db, { sku: SKU, category, basis: 'attributed', amount: 9999, from: '2026-11-01', ref: 'X-' + category });
        check(`${category} is never deductible`, r.error, 'category_not_deductible');
    }
    // An attributed cost is counted in the one period holding its date.
    await cost(db, { sku: SKU, category: 'payment_processing', basis: 'attributed', amount: 3000, from: '2026-12-30', ref: 'STRIPE-1230' });
    await makeOrder(db, { items: [{ sku: SKU, name: 'Mira Tee', unit: 10000, qty: 1 }], paidAt: '2026-12-30T10:00:00Z' });
    await makeOrder(db, { items: [{ sku: SKU, name: 'Mira Tee', unit: 10000, qty: 1 }], paidAt: '2027-01-05T10:00:00Z' });
    const q4 = sku(await statement(db, ...Q4), ARTIST, SKU);
    const q1 = sku(await statement(db, ...Q1), ARTIST, SKU);
    check('Q4 carries the attributed fee and one unit of manufacturing', q4.deductions, 3000 + 2500);
    check('Q1 carries only its own unit — the Q4 fee is not counted again', q1.deductions, 2500);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3 · refunds reduce sales; costs stay attributable to the units sold ──');
{
    const db = await boot();
    await collab(db, { email: ARTIST, name: 'Mira', sku: SKU });
    const o = await makeOrder(db, { items: [{ sku: SKU, name: 'Mira Tee', unit: 10000, qty: 10 }], paidAt: '2026-11-03T10:00:00Z' });
    await cost(db, { sku: SKU, category: 'manufacturing', basis: 'per_unit', amount: 4000, from: '2026-10-01', ref: 'INV-MFG' });
    await reversal(db, { ref: 're_1', pi: o.pi, amount: 10000, at: '2026-11-20T10:00:00Z' });
    const d = sku(await statement(db, ...Q4), ARTIST, SKU);
    check('sales after a €100 refund: €900', d.sales, 90000);
    check('deductions: 10 units × €40', d.deductions, 40000);
    check('profit €500 → royalty €60', [d.profit, d.royaltyDue], [50000, 6000]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4 · costs above sales carry forward once, never lost, never doubled ──');
{
    const db = await boot();
    await collab(db, { email: ARTIST, name: 'Mira', sku: SKU });
    await makeOrder(db, { items: [{ sku: SKU, name: 'Mira Tee', unit: 10000, qty: 1 }], paidAt: '2026-11-03T10:00:00Z' });
    await cost(db, { sku: SKU, category: 'printing', basis: 'attributed', amount: 25000, from: '2026-11-03', ref: 'SCREENS-SETUP' });
    const q4 = sku(await statement(db, ...Q4), ARTIST, SKU);
    check('a loss-making period pays nothing and carries €150', [q4.profit, q4.royaltyDue, q4.carryForward], [-15000, 0, 15000]);
    const raise1 = await db.query(`select public.artist_royalty_raise_carry($1,$2,'accounting@test') as r`, Q4);
    const raise2 = await db.query(`select public.artist_royalty_raise_carry($1,$2,'accounting@test') as r`, Q4);
    check('the carry is raised once however often the period is closed', [raise1.rows[0].r.raised, raise2.rows[0].r.raised], [1, 0]);
    await makeOrder(db, { items: [{ sku: SKU, name: 'Mira Tee', unit: 10000, qty: 5 }], paidAt: '2027-01-10T10:00:00Z' });
    const q1 = sku(await statement(db, ...Q1), ARTIST, SKU);
    const consumed = (await db.query(`select public.artist_royalty_consume_carry($1,$2,'accounting@test') as r`, Q1)).rows[0].r;
    check('Q1: €500 sales, €150 carried in, royalty on €350 = €42', [q1.sales, q1.carriedIn, q1.royaltyBase, q1.royaltyDue], [50000, 15000, 35000, 4200]);
    check('paying Q1 consumes the carry, so it is not deducted a second time', [consumed.consumed, sku(await statement(db, ...Q1), ARTIST, SKU).carriedIn], [1, 0]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5 · a period whose costs nobody has attested is not paid ──');
{
    const db = await bootBare();
    await setVatBasis(db, 'exclusive');
    await attest(db, '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z');
    await collab(db, { email: ARTIST, name: 'Mira', sku: SKU });
    await makeOrder(db, { items: [{ sku: SKU, name: 'Mira Tee', unit: 10000, qty: 10 }], paidAt: '2026-11-03T10:00:00Z' });
    let s = await statement(db, ...Q4);
    check('without cost attestation the period is blocked and the design named', [s.payoutReady, s.costsUnattested], [false, [SKU]]);
    await db.query(`select public.artist_royalty_costs_attest($1,$2,$3,'accounting@test','Q4 invoices in')`, [SKU, ...Q4]);
    s = await statement(db, ...Q4);
    check('attested for that design and period: payout-ready', [s.payoutReady, s.costsUnattested], [true, []]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6 · VAT comes out of sales before profit is taken ──');
{
    const db = await bootBare();
    await setVatBasis(db, 'inclusive', { rates: [{ country: '*', bps: 2700 }] });
    await attest(db, '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z');
    await db.query(`select public.artist_royalty_costs_attest(null,$1,$2,'accounting@test',null)`, Q4);
    await collab(db, { email: ARTIST, name: 'Mira', sku: SKU });
    // €1,270 charged including 27% VAT is €1,000 of sales.
    await makeOrder(db, { items: [{ sku: SKU, name: 'Mira Tee', unit: 12700, qty: 10 }], paidAt: '2026-11-03T10:00:00Z' });
    await cost(db, { sku: SKU, category: 'manufacturing', basis: 'attributed', amount: 40000, from: '2026-11-03', ref: 'INV-ALL' });
    const d = sku(await statement(db, ...Q4), ARTIST, SKU);
    check('€1,270 inclusive → €1,000 sales → €600 profit → €72', [d.sales, d.profit, d.royaltyDue], [100000, 60000, 7200]);
}

console.log(`\n${n - fails.length}/${n} passed`);
if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
