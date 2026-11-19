// ─────────────────────────────────────────────────────────────────────────────
// Refunds and disputes, turned into reversals the royalty statement can read.
//
// Same discipline as the PaymentIntent path in _inventory.js: the event that
// woke us is a signal that something changed, not a description of what it
// changed to. Every handler re-reads the object from Stripe and acts on its
// CURRENT state. That is what makes duplicates, retries, out-of-order delivery
// and later status changes all safe without a single special case — a late
// `refund.created` arriving after `refund.updated` reads the same current
// status and converges on it.
//
// A refund issued from the Stripe Dashboard emits exactly the same events as
// one issued through the API, carries the same payment_intent, and so arrives
// here by the same route. There is no second path for it to miss.
//
// Allocation to order lines is deliberately NOT guessed. This integration
// creates bare PaymentIntents with no line items, so Stripe holds no
// item-level evidence at all. order_reversal_allocate applies only the
// readings of the amounts that are unambiguous and leaves everything else for
// a person — see the rule table in the migration.
// ─────────────────────────────────────────────────────────────────────────────
import { retrieveRefund, retrieveDispute, retrieveCharge } from './_stripe.js';
import { rpc, describeSupabaseError } from './_orders.js';

// Refund.status → our status. Stripe calls a refund that has settled
// 'succeeded'; 'requires_action' is still in flight and has moved no money.
const REFUND_STATUS = {
    succeeded: 'succeeded',
    pending: 'pending',
    requires_action: 'pending',
    failed: 'failed',
    canceled: 'canceled'
};

// A dispute withdraws the funds the moment it is opened and they stay out
// until it closes. Won means the money comes back to us, so the reversal is
// undone; lost means it stands. `warning_*` states are early notices where no
// money has moved yet.
function disputeStatus(dispute) {
    const status = String(dispute.status || '');
    if (status === 'won') return 'reinstated';
    if (status === 'lost') return 'succeeded';
    if (status.startsWith('warning')) return 'pending';
    // needs_response, under_review, charge_refunded: funds are withdrawn.
    return 'succeeded';
}

// The link back to an order. A Refund names its payment_intent directly on
// modern API versions; where it does not, the Charge it belongs to does.
async function intentFor(object) {
    if (object.payment_intent) {
        return typeof object.payment_intent === 'string'
            ? object.payment_intent
            : object.payment_intent.id;
    }
    const chargeId = typeof object.charge === 'string' ? object.charge : (object.charge && object.charge.id);
    if (!chargeId) return null;
    const charge = await retrieveCharge(chargeId);
    return typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : (charge.payment_intent && charge.payment_intent.id) || null;
}

function chargeIdOf(object) {
    return typeof object.charge === 'string' ? object.charge : (object.charge && object.charge.id) || null;
}

// Stripe timestamps are seconds.
const at = (seconds) => new Date((Number(seconds) || 0) * 1000).toISOString();

// Records the reversal and then asks the database to allocate it. The two are
// separate calls on purpose: recording must succeed even when allocation
// cannot decide anything, because an unallocated reversal still has to be
// counted and still has to block the payout. Losing it is the one outcome
// that over-pays.
async function land(row, sourceUpdatedAt) {
    const recorded = await rpc('order_reversal_record', {
        p_provider_ref: row.providerRef,
        p_provider_object: row.providerObject,
        p_payment_intent: row.paymentIntent,
        p_charge: row.charge,
        p_kind: row.kind,
        p_status: row.status,
        p_amount: row.amount,
        p_currency: row.currency,
        p_reason: row.reason,
        p_reversed_at: row.reversedAt,
        p_source_updated_at: sourceUpdatedAt
    }, 'record reversal');

    if (!recorded || !recorded.ok) {
        // An order we do not hold. Logged and answered 200 by the caller: a
        // retry cannot conjure the order, and Stripe should stop asking.
        return { outcome: recorded ? recorded.error : 'record_failed', recorded };
    }
    if (recorded.outcome === 'stale') return { outcome: 'stale', recorded };

    const allocated = await rpc('order_reversal_allocate', {
        p_provider_ref: row.providerRef
    }, 'allocate reversal');

    return { outcome: recorded.outcome, recorded, allocated };
}

// ── Refunds ──────────────────────────────────────────────────────────────────
// charge.refunded, refund.created, refund.updated, charge.refund.updated.
// `charge.refunded` carries the Charge, whose refunds.data holds one entry per
// refund on it — so a second partial refund arrives as a Charge with two
// refunds, and both are re-read and landed. Each has its own re_… id, so the
// first is updated in place rather than counted twice.
export async function syncRefundEvent(event) {
    const object = event.data && event.data.object;
    if (!object) return { outcome: 'ignored' };

    const refunds = [];
    if (object.object === 'charge') {
        const listed = (object.refunds && object.refunds.data) || [];
        for (const entry of listed) refunds.push(entry.id);
    } else if (object.object === 'refund') {
        refunds.push(object.id);
    }
    if (!refunds.length) return { outcome: 'no_refunds' };

    const results = [];
    for (const id of refunds) {
        // The authoritative current state, not the event's snapshot of it.
        const refund = await retrieveRefund(id);
        const paymentIntent = await intentFor(refund);
        if (!paymentIntent) {
            results.push({ id, outcome: 'no_payment_intent' });
            continue;
        }
        const status = REFUND_STATUS[String(refund.status || '')] || 'pending';
        const landed = await land({
            providerRef: refund.id,
            providerObject: 'refund',
            paymentIntent,
            charge: chargeIdOf(refund),
            kind: 'refund',
            status,
            amount: Number(refund.amount) || 0,
            currency: refund.currency || 'eur',
            reason: refund.reason || refund.failure_reason || null,
            reversedAt: at(refund.created)
        }, new Date(Number(event.created || 0) * 1000).toISOString());
        results.push({ id, ...landed });
    }
    return { outcome: 'synced', results };
}

// ── Disputes ─────────────────────────────────────────────────────────────────
// charge.dispute.created, .updated, .closed, .funds_withdrawn,
// .funds_reinstated. All five are handled the same way, because all five mean
// the same thing: re-read the dispute and record where it now stands.
export async function syncDisputeEvent(event) {
    const object = event.data && event.data.object;
    if (!object || !object.id) return { outcome: 'ignored' };

    const dispute = await retrieveDispute(object.id);
    const paymentIntent = await intentFor(dispute);
    if (!paymentIntent) return { outcome: 'no_payment_intent' };

    const landed = await land({
        providerRef: dispute.id,
        providerObject: 'dispute',
        paymentIntent,
        charge: chargeIdOf(dispute),
        kind: 'chargeback',
        status: disputeStatus(dispute),
        amount: Number(dispute.amount) || 0,
        currency: dispute.currency || 'eur',
        reason: dispute.reason || null,
        // The date the funds moved, which for a dispute is when it opened.
        reversedAt: at(dispute.created)
    }, new Date(Number(event.created || 0) * 1000).toISOString());

    return { outcome: 'synced', ...landed };
}

export { describeSupabaseError };
