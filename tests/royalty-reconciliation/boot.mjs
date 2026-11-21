// Boots a real Postgres (PGlite, WASM) and applies the project's own migration
// files verbatim. Only the things Supabase provides and a bare Postgres does
// not — the three roles, the auth and storage schemas — are stubbed first.
// Nothing in the migrations themselves is edited for the test.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, '..', '..', 'supabase', 'migrations') + path.sep;

const PRELUDE = `
create role anon;
create role authenticated;
create role service_role;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema if not exists storage;
create table if not exists storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
);
`;

export async function boot() {
    const db = new PGlite();
    await db.exec(PRELUDE);
    for (const file of [
        '20260906120000_orders.sql',
        '20261119120000_artist_submissions.sql',
        '20261119160000_royalty_reconciliation.sql',
        '20261119180000_artist_intake_hardening.sql',
        '20261120090000_royalty_staging_verification.sql',
        '20261121120000_royalty_net_profit.sql'
    ]) {
        try {
            // pgcrypto ships with Supabase and not with bare PGlite. gen_random_uuid()
            // is core Postgres 13+, so dropping the CREATE EXTENSION line changes
            // nothing under test. It is the only edit made to any migration here.
            const sql = fs.readFileSync(MIG + file, "utf8")
                .replace(/create extension[^;]*;/gi, "");
            await db.exec(sql);
        } catch (error) {
            throw new Error(`${file}: ${error.message}`);
        }
    }
    return db;
}

export const eur = (minor) => '€' + (Number(minor) / 100).toFixed(2);

// ── fixtures ────────────────────────────────────────────────────────────────
let seq = 0;

export async function makeOrder(db, { items, shipping = 0, tax = 0, paidAt, subtotalOverride = null }) {
    seq += 1;
    const number = `EV-26-TEST${String(seq).padStart(2, '0')}`;
    const pi = `pi_test_${seq}`;
    const lines = items.map((i) => ({ ...i, line: i.unit * i.qty }));
    const subtotal = subtotalOverride == null ? lines.reduce((s, l) => s + l.line, 0) : subtotalOverride;
    const total = subtotal + shipping + tax;

    const { rows } = await db.query(
        `insert into public.orders (order_number, customer_email, customer_first_name,
            customer_last_name, shipping_address, currency, subtotal_amount,
            shipping_amount, tax_amount, total_amount, status, payment_status,
            stripe_payment_intent_id, paid_at)
         values ($1,'a@b.co','A','B','{}'::jsonb,'eur',$2,$3,$4,$5,'confirmed','paid',$6,$7)
         returning id, order_number`,
        [number, subtotal, shipping, tax, total, pi, paidAt]
    );
    const orderId = rows[0].id;

    const itemIds = [];
    for (const l of lines) {
        const r = await db.query(
            `insert into public.order_items (order_id, variant_id, product_slug,
                product_name, size, sku, unit_amount, quantity, line_amount)
             values ($1,$2,$3,$4,'L',$5,$6,$7,$8) returning id`,
            [orderId, l.sku || 'v', l.sku || 'p', l.name, l.sku, l.unit, l.qty, l.line]
        );
        itemIds.push({ id: r.rows[0].id, ...l });
    }
    return { orderId, number, pi, itemIds, subtotal, shipping, tax, total };
}

export async function collab(db, { email, name, sku, bps = 1200, from = '2026-01-01', to = null, ref = 'AGR-1' }) {
    await db.query(
        `insert into public.artist_collaborations (artist_name, artist_email, credit_name,
            agreement_ref, signed_at, sku, product_name, royalty_bps, effective_from, effective_to)
         values ($1,$2,$3,$4,'2026-01-01',$5,$5,$6,$7,$8)`,
        [name, email, name, ref, sku, bps, from, to]
    );
}

// Mirrors exactly what api/stripe-webhook.js does with a re-read Stripe object.
export async function reversal(db, { ref, object = 'refund', pi, charge = 'ch_1', kind = 'refund',
                                     status = 'succeeded', amount, at, updatedAt = null,
                                     evidence = null, withdrawnAt = null, reinstatedAt = null }) {
    const rec = await db.query(
        `select public.order_reversal_record($1,$2,$3,$4,$5,$6,$7,'eur',null,$8,$9,$10,$11,$12) as r`,
        [ref, object, pi, charge, kind, status, amount, at, updatedAt || at,
         evidence ? JSON.stringify(evidence) : null, withdrawnAt, reinstatedAt]
    );
    const out = rec.rows[0].r;
    if (out.ok && out.outcome !== 'stale') {
        const alloc = await db.query(`select public.order_reversal_allocate($1) as r`, [ref]);
        out.allocation = alloc.rows[0].r;
    }
    return out;
}

export async function statement(db, from, to, artist = null) {
    const { rows } = await db.query(
        `select public.artist_royalty_statement($1,$2,$3) as s`, [from, to, artist]);
    return rows[0].s;
}

// ── preconditions the statement now demands ─────────────────────────────────
// Two things must be positively established before any period can be paid:
// what line_amount is net of, and that the period's reversals were actually
// read back from Stripe. Both default to "nobody has said", which blocks.

export async function setVatBasis(db, basis, { actor = 'accounting@test', rates = [] } = {}) {
    await db.query(`select public.artist_royalty_set_vat_basis($1, $2, $3)`,
        [basis, actor, 'set by the test harness']);
    for (const r of rates) {
        await db.query(
            `insert into public.artist_vat_rates (country, rate_bps, effective_from, effective_to, note)
             values ($1,$2,$3,$4,$5) on conflict (country, effective_from) do nothing`,
            [r.country, r.bps, r.from || '2020-01-01', r.to || null, r.note || null]);
    }
}

// Stands in for a historical dry run having been run and applied.
export async function attest(db, from, to, extra = {}) {
    await db.query(
        `insert into public.order_reversal_coverage
            (covers_from, covers_to, attested_by, source, refunds_seen, disputes_seen, matched, unmatched, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [from, to, extra.by || 'test@eternalvoid.co', extra.source || 'stripe_backfill',
         extra.refunds || 0, extra.disputes || 0, extra.matched || 0, extra.unmatched || 0,
         extra.note || null]);
}

// A database ready to produce a payable statement: VAT declared exclusive (the
// simple reading, so arithmetic tests stay about arithmetic), the whole of
// 2026-2027 attested for reversals, and every design's costs attested as
// complete for the same window (with none recorded, so deductions are zero).
export async function bootReady() {
    const db = await boot();
    await setVatBasis(db, 'exclusive');
    await attest(db, '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z');
    await db.query(`select public.artist_royalty_costs_attest(null, '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z', 'test@eternalvoid.co', 'no costs in these fixtures')`);
    return db;
}
