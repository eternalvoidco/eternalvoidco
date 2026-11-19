import { bootReady as boot, makeOrder, collab, statement, eur } from './boot.mjs';
let fails = 0;
const ok = (n, a, e) => { const p = JSON.stringify(a) === JSON.stringify(e);
  console.log(`  ${p?'PASS':'FAIL'}  ${n}\n          expected ${JSON.stringify(e)}   actual ${JSON.stringify(a)}`);
  if (!p) fails++; };

const db = await boot();
await collab(db, { email: 'lena@studio.co', name: 'Lena', sku: 'EV-S' });
const o1 = await makeOrder(db, { items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }], paidAt: '2026-10-05T10:00:00Z' });
const o2 = await makeOrder(db, { items: [{ sku: 'EV-S', name: 'S', unit: 20000, qty: 1 }], paidAt: '2026-10-06T10:00:00Z' });

// What the endpoint would hand the database after listing Stripe.
const rows = [
  { providerRef: 're_hist1', providerObject: 'refund', kind: 'refund', paymentIntent: o1.pi,
    charge: 'ch_1', status: 'succeeded', amount: 20000, currency: 'eur', reversedAt: '2026-10-20T10:00:00Z' },
  { providerRef: 're_orphan', providerObject: 'refund', kind: 'refund', paymentIntent: 'pi_not_ours',
    charge: 'ch_x', status: 'succeeded', amount: 5000, currency: 'eur', reversedAt: '2026-10-21T10:00:00Z' }
];

let r = (await db.query(`select public.order_reversal_backfill($1::jsonb, false) as r`, [JSON.stringify(rows)])).rows[0].r;
ok('dry run writes nothing', r.inserted, 0);
ok('and says what it would insert', [r.wouldInsert, r.reversalTotal], [1, 20000]);
ok('an unmatched payment is listed, not dropped',
   r.unmatched.map(u => [u.providerRef, u.reason]), [['re_orphan', 'no order carries this payment intent']]);

let s = await statement(db, '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z');
ok('nothing changed in the statement', s.artists[0].royaltyDue, 4800);

r = (await db.query(`select public.order_reversal_backfill($1::jsonb, true) as r`, [JSON.stringify(rows)])).rows[0].r;
ok('apply writes the matched one', r.inserted, 1);

// Re-running must not double-count.
r = (await db.query(`select public.order_reversal_backfill($1::jsonb, true) as r`, [JSON.stringify(rows)])).rows[0].r;
ok('re-running recognises it as already known', [r.inserted, r.alreadyKnown.length], [0, 1]);

s = await statement(db, '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z');
// 400 sold − 200 refunded = 200 base, 12% = €24
ok('the statement now reflects the backfilled refund, once',
   [s.artists[0].royaltyBase, s.artists[0].royaltyDue], [20000, 2400]);
ok('and the period reconciles', [s.reconciliation.status, s.payoutReady], ['clean', true]);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
