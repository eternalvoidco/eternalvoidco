// ─────────────────────────────────────────────────────────────────────────────
// POST /api/stripe-webhook
//
// The single authoritative confirmation path. An order becomes paid here and
// nowhere else — not when a browser resolves a promise, not when someone loads
// the success page.
//
// Order of operations matters: verify the signature, claim the event id, then
// act. Claiming first means a retried delivery cannot decrement stock twice or
// send a second confirmation.
// ─────────────────────────────────────────────────────────────────────────────
import { verifyWebhook, readRawBody } from './_stripe.js';
import { markOrderPaid, markPaymentFailed, claimEvent, findOrderItems, ordersConfigured, describeSupabaseError } from './_orders.js';
import { sendOrderConfirmation } from './_email.js';

// Vercel would otherwise parse the body and destroy the exact bytes the
// signature was computed over.
export const config = { api: { bodyParser: false } };

const HANDLED = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed']);

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method_not_allowed' });
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !ordersConfigured()) {
        console.error('stripe-webhook: not configured');
        return response.status(503).json({ error: 'not_configured' });
    }

    let raw;
    try {
        raw = await readRawBody(request);
    } catch (error) {
        return response.status(400).json({ error: 'unreadable_body' });
    }

    const verified = verifyWebhook(raw, request.headers['stripe-signature'], secret);
    if (!verified.ok) {
        // Deliberately terse. An unverified caller learns nothing about why.
        console.warn('stripe-webhook: rejected', verified.reason);
        return response.status(400).json({ error: 'invalid_signature' });
    }

    const event = verified.event;
    if (!HANDLED.has(event.type)) {
        // Acknowledged so Stripe stops retrying something we do not act on.
        return response.status(200).json({ received: true, ignored: event.type });
    }

    // The claim is the idempotency lock: a duplicate delivery loses the insert
    // and returns here without repeating any side effect.
    let claimed;
    try {
        claimed = await claimEvent(event.id, event.type);
    } catch (error) {
        console.error(describeSupabaseError(error, 'stripe-webhook: claim event'));
        // 500 asks Stripe to retry, which is right — we do not know if we acted.
        return response.status(500).json({ error: 'claim_failed' });
    }
    if (!claimed) return response.status(200).json({ received: true, duplicate: true });

    const intent = event.data && event.data.object;
    if (!intent || !intent.id) return response.status(200).json({ received: true, ignored: 'no_intent' });

    if (event.type === 'payment_intent.payment_failed') {
        try {
            await markPaymentFailed(intent.id);
        } catch (error) {
            console.error(describeSupabaseError(error, 'stripe-webhook: mark failed'));
        }
        return response.status(200).json({ received: true });
    }

    // ── succeeded ────────────────────────────────────────────────────────────
    let result;
    try {
        result = await markOrderPaid(intent.id, {
            amountReceived: intent.amount_received != null ? intent.amount_received : intent.amount,
            currency: intent.currency
        });
    } catch (error) {
        console.error(describeSupabaseError(error, 'stripe-webhook: mark paid'));
        return response.status(500).json({ error: 'update_failed' });
    }

    if (!result.ok) {
        // Amount or currency disagreed with the order we wrote, or the order is
        // gone. Recorded, never fulfilled, and answered 200 so Stripe stops
        // retrying something a retry cannot fix.
        console.error('stripe-webhook: not fulfilling —', result.reason, intent.id);
        return response.status(200).json({ received: true, unfulfilled: result.reason });
    }

    if (result.alreadyPaid) return response.status(200).json({ received: true, duplicate: true });

    // ── side effects, once ───────────────────────────────────────────────────
    // Inventory would be decremented here. There is no stock model in this
    // project — no column, no feed — so there is nothing to decrement, and a
    // counter invented at this point would be fiction. See _catalog.stockFor().

    try {
        const items = await findOrderItems(result.order.id);
        await sendOrderConfirmation(result.order, items);
    } catch (error) {
        // A failed email must not fail the webhook: the payment is real and the
        // order is recorded. Retrying would risk charging state we already set.
        console.error('stripe-webhook: confirmation email failed', error.message);
    }

    return response.status(200).json({ received: true });
}
