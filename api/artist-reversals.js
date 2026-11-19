// ─────────────────────────────────────────────────────────────────────────────
// /api/artist-reversals — the two things the webhook cannot do. Admin only.
//
//   GET  ?from=…&to=…            THE HISTORICAL DRY RUN. A webhook only catches
//                                what happens next; every refund and dispute
//                                Stripe already settled is invisible to it.
//                                This asks Stripe for them, matches each back
//                                to an order, and reports what it WOULD record:
//                                the records, the totals, what is already known
//                                and — the part that matters — every payment it
//                                could not match to an order.
//
//        &apply=1                writes them. Separate verb, deliberate: the
//                                dry run is the default and the write is the
//                                exception.
//
//   PATCH { providerRef, allocations: [{orderItemId, amount}], note }
//                                what a person decides when the rules refused.
//                                Recorded against their address, checked
//                                against both the reversal and the lines, and
//                                never overwritten by a later rule pass.
//
// Nothing here pays anybody. It makes a period reconcilable; accounting still
// approves and executes.
// ─────────────────────────────────────────────────────────────────────────────
import { requireAdmin } from './_auth.js';
import { artistsConfigured, rpc, describeSupabaseError } from './_artists.js';
import { listRefunds, listDisputes, retrieveCharge, stripeConfigured } from './_stripe.js';

const at = (seconds) => new Date((Number(seconds) || 0) * 1000).toISOString();

const REFUND_STATUS = {
    succeeded: 'succeeded', pending: 'pending', requires_action: 'pending',
    failed: 'failed', canceled: 'canceled'
};

function disputeStatus(dispute) {
    const status = String(dispute.status || '');
    if (status === 'won') return 'reinstated';
    if (status === 'lost') return 'succeeded';
    if (status.startsWith('warning')) return 'pending';
    return 'succeeded';
}

// Charge → PaymentIntent, cached: a batch of refunds often shares charges, and
// Stripe's rate limit is not worth spending on the same lookup twice.
function chargeResolver() {
    const seen = new Map();
    return async function resolve(chargeId) {
        if (!chargeId) return null;
        if (seen.has(chargeId)) return seen.get(chargeId);
        let intent = null;
        try {
            const charge = await retrieveCharge(chargeId);
            intent = typeof charge.payment_intent === 'string'
                ? charge.payment_intent
                : (charge.payment_intent && charge.payment_intent.id) || null;
        } catch (error) {
            console.error('artist-reversals: charge lookup failed', chargeId, error && error.message);
        }
        seen.set(chargeId, intent);
        return intent;
    };
}

async function collect(from, to) {
    const resolve = chargeResolver();
    const rows = [];
    const unresolved = [];

    async function page(fetcher, map) {
        let startingAfter = null;
        for (let guard = 0; guard < 40; guard += 1) {
            const batch = await fetcher({
                createdGte: from.getTime(), createdLt: to.getTime(), startingAfter, limit: 100
            });
            const data = batch.data || [];
            for (const object of data) {
                const mapped = await map(object, resolve);
                if (mapped) rows.push(mapped);
                else unresolved.push({ providerRef: object.id, reason: 'no payment intent on the object or its charge' });
            }
            if (!batch.has_more || !data.length) break;
            startingAfter = data[data.length - 1].id;
        }
    }

    await page(listRefunds, async (refund, resolve) => {
        const chargeId = typeof refund.charge === 'string' ? refund.charge : (refund.charge && refund.charge.id);
        const intent = (typeof refund.payment_intent === 'string' ? refund.payment_intent : null)
            || await resolve(chargeId);
        if (!intent) return null;
        return {
            providerRef: refund.id, providerObject: 'refund', kind: 'refund',
            paymentIntent: intent, charge: chargeId || null,
            status: REFUND_STATUS[String(refund.status || '')] || 'pending',
            amount: Number(refund.amount) || 0, currency: refund.currency || 'eur',
            reason: refund.reason || null, reversedAt: at(refund.created)
        };
    });

    await page(listDisputes, async (dispute, resolve) => {
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge && dispute.charge.id);
        const intent = (typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null)
            || await resolve(chargeId);
        if (!intent) return null;
        return {
            providerRef: dispute.id, providerObject: 'dispute', kind: 'chargeback',
            paymentIntent: intent, charge: chargeId || null,
            status: disputeStatus(dispute),
            amount: Number(dispute.amount) || 0, currency: dispute.currency || 'eur',
            reason: dispute.reason || null, reversedAt: at(dispute.created)
        };
    });

    return { rows, unresolved };
}

export default async function handler(request, response) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return response.status(gate.status).json({ ok: false, error: gate.error });
    if (!artistsConfigured()) return response.status(503).json({ ok: false, error: 'not_configured' });

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');

    // ── the manual allocation ────────────────────────────────────────────
    if (request.method === 'PATCH') {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const providerRef = typeof body.providerRef === 'string' ? body.providerRef.trim() : '';
        if (!providerRef) return response.status(400).json({ ok: false, error: 'missing_provider_ref' });
        if (!Array.isArray(body.allocations) || !body.allocations.length) {
            return response.status(400).json({ ok: false, error: 'missing_allocations' });
        }
        try {
            const out = await rpc('order_reversal_allocate_manual', {
                p_provider_ref: providerRef,
                p_allocations: body.allocations,
                p_actor: gate.user.email,
                p_note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null
            }, 'manual allocation');
            if (!out || !out.ok) return response.status(409).json(out || { ok: false, error: 'failed' });
            return response.status(200).json(out);
        } catch (error) {
            console.error(describeSupabaseError(error, 'artist-reversals: manual allocation'));
            return response.status(502).json({ ok: false, error: 'upstream_failed' });
        }
    }

    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET, PATCH');
        return response.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    if (!stripeConfigured()) return response.status(503).json({ ok: false, error: 'stripe_not_configured' });

    const url = new URL(request.url, 'http://local');
    const from = new Date(url.searchParams.get('from') || '');
    const to = new Date(url.searchParams.get('to') || '');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
        return response.status(400).json({ ok: false, error: 'bad_period' });
    }

    const apply = url.searchParams.get('apply') === '1';

    let collected;
    try {
        collected = await collect(from, to);
    } catch (error) {
        console.error('artist-reversals: stripe listing failed', error && error.message);
        return response.status(502).json({ ok: false, error: 'stripe_listing_failed' });
    }

    let result;
    try {
        result = await rpc('order_reversal_backfill', {
            p_rows: collected.rows, p_apply: apply
        }, 'reversal backfill');
    } catch (error) {
        console.error(describeSupabaseError(error, 'artist-reversals: backfill'));
        return response.status(502).json({ ok: false, error: 'upstream_failed' });
    }

    // THE ATTESTATION. Applying the backfill is the only thing that can say
    // "this window's reversals were actually read back from Stripe". Without
    // it a period with no recorded refunds is indistinguishable from one whose
    // refunds were never ingested, and `payoutReady` would be true for both.
    // Written only on apply, and only for the window actually walked.
    if (apply) {
        try {
            await rpc('order_reversal_coverage_record', {
                p_from: from.toISOString(),
                p_to: to.toISOString(),
                p_by: gate.user.email,
                p_refunds: collected.rows.filter((r) => r.providerObject === 'refund').length,
                p_disputes: collected.rows.filter((r) => r.providerObject === 'dispute').length,
                p_matched: Number(result.wouldInsert || 0) + Number((result.alreadyKnown || []).length),
                p_unmatched: Number((result.unmatched || []).length) + collected.unresolved.length,
                p_note: collected.unresolved.length
                    ? 'some reversals carried no followable payment intent — see withoutPaymentIntent'
                    : null
            }, 'record coverage');
            result.coverageAttested = true;
        } catch (error) {
            // The reversals are recorded but the window is not attested, so
            // the period stays blocked. Visible, and safe in that direction.
            console.error(describeSupabaseError(error, 'artist-reversals: coverage'));
            result.coverageAttested = false;
        }
    }

    return response.status(200).json(Object.assign(result, {
        period: { from: from.toISOString(), to: to.toISOString() },
        fetchedFromStripe: collected.rows.length,
        // Refunds Stripe holds that carry no payment intent we could follow.
        // Listed rather than dropped: an unmatched payment is exactly the thing
        // accounting has to see.
        withoutPaymentIntent: collected.unresolved,
        note: apply
            ? 'Applied. Re-run the reconciliation for each affected period.'
            : 'Dry run — nothing was written. Add &apply=1 to record these.'
    }));
}
