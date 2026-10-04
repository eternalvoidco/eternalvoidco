// ─────────────────────────────────────────────────────────────────────────────
// POST /api/stripe-webhook
//
// The single authoritative confirmation path. An order becomes paid here (or in
// the sweeper, which asks Stripe the same question) and nowhere else — not when
// a browser resolves a promise, not when someone loads the success page.
//
// Order of operations:
//   1. verify the signature against the raw body;
//   2. skip an event already processed (fast path only);
//   3. re-read the PaymentIntent from Stripe and act on its CURRENT state;
//   4. record the event id.
//
// Step 3 is what makes duplicates, retries and out-of-order delivery safe: a
// late `processing` after a `succeeded` reads `succeeded` again, and every
// transition is idempotent in the database (a sale is recorded once, under the
// order row's lock). The event is recorded only after it has been acted on, so
// a delivery that failed halfway is processed again on Stripe's retry instead
// of being skipped forever.
// ─────────────────────────────────────────────────────────────────────────────
import { verifyWebhook, readRawBody, retrievePaymentIntent } from './_stripe.js';
import { eventSeen, recordEvent, ordersConfigured, describeSupabaseError } from './_orders.js';
import { syncPaymentIntent } from './_inventory.js';

// Vercel would otherwise parse the body and destroy the exact bytes the
// signature was computed over.
export const config = { api: { bodyParser: false } };

// Enable exactly these on the endpoint in Stripe → Developers → Webhooks.
const HANDLED = new Set([
    'payment_intent.succeeded',
    'payment_intent.processing',
    'payment_intent.payment_failed',
    'payment_intent.canceled'
]);

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

    const object = event.data && event.data.object;
    if (!object || !object.id) return response.status(200).json({ received: true, ignored: 'no_intent' });

    try {
        if (await eventSeen(event.id)) return response.status(200).json({ received: true, duplicate: true });
    } catch (error) {
        // Not fatal: processing is idempotent without the ledger.
        console.error(describeSupabaseError(error, 'stripe-webhook: ledger read'));
    }

    let result;
    try {
        // The authoritative current state, not the event's snapshot of it.
        const intent = await retrievePaymentIntent(object.id);
        result = await syncPaymentIntent(intent);
    } catch (error) {
        console.error(describeSupabaseError(error, `stripe-webhook: ${event.type}`));
        // 500 asks Stripe to retry, which is right — we do not know if we acted.
        return response.status(500).json({ error: 'processing_failed' });
    }

    try {
        await recordEvent(event.id, event.type);
    } catch (error) {
        console.error(describeSupabaseError(error, 'stripe-webhook: ledger write'));
    }

    // Amount mismatches and unknown orders are recorded and flagged, never
    // fulfilled, and answered 200 so Stripe stops retrying something a retry
    // cannot fix.
    return response.status(200).json({ received: true, outcome: result.outcome });
}
