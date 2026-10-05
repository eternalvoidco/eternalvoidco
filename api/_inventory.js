// ─────────────────────────────────────────────────────────────────────────────
// Inventory: availability, holds, and keeping them in step with Stripe.
//
// The database is the source of truth (inventory_items, inventory_reservations,
// inventory_movements) and every write is a Postgres function, so the rules
// that matter for correctness — no overselling, no negative stock, a sale only
// once — are enforced inside a transaction, not here.
//
// What lives here is the part only the server can do: deciding when a hold may
// be released. A PaymentIntent has no expiry of its own; it stays chargeable
// until it is cancelled. So a hold is released only when
//   • Stripe confirms the intent is cancelled, or
//   • the intent's client secret never left the server (checkout creation
//     failed), so nobody can ever confirm it.
// Releasing on a timer alone would let a customer pay for a piece that had
// already been handed to someone else.
// ─────────────────────────────────────────────────────────────────────────────
import { rpc, findOrderItems, findOrderIdByIntent, describeSupabaseError } from './_orders.js';
import { cancelPaymentIntent, retrievePaymentIntent } from './_stripe.js';
import { sendOrderConfirmation } from './_email.js';
import { productInfo } from './_catalog.js';

// ── Thresholds ───────────────────────────────────────────────────────────────
// Genuine availability only. 11 or more says nothing; 2–10 states the number;
// 1 says so; 0 is either sold out or, when the last pieces are only held in
// someone's checkout, temporarily unavailable — never presented as final.
export const LOW_STOCK_MAX = 10;

export function productState(available, reserved) {
    if (available > LOW_STOCK_MAX) return 'in_stock';
    if (available >= 2) return 'low';
    if (available === 1) return 'last';
    return reserved > 0 ? 'reserved' : 'sold_out';
}

// A size that was never allocated (XS for the season one tees) is
// 'unavailable' rather than 'sold_out': nothing was sold.
export function sizeState(available, reserved, everStocked) {
    if (available > 0) return productState(available, reserved);
    if (reserved > 0) return 'reserved';
    return everStocked ? 'sold_out' : 'unavailable';
}

// ── Hold duration ────────────────────────────────────────────────────────────
// How long a checkout may keep its pieces before the sweeper cancels its
// PaymentIntent and returns them. VOID_RESERVATION_MINUTES, 10–120, default 30.
export function holdSeconds() {
    const minutes = Number(process.env.VOID_RESERVATION_MINUTES);
    const clamped = Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.max(Math.round(minutes), 10), 120) : 30;
    return clamped * 60;
}

// After a declined attempt the customer can still retry on the same intent; a
// hold that had lost its deadline while the bank was processing gets this long.
const FAILED_GRACE_SECONDS = 15 * 60;

// ── Reads ────────────────────────────────────────────────────────────────────
export function snapshot() {
    return rpc('inventory_snapshot', {}, 'inventory snapshot');
}

export function adminSnapshot() {
    return rpc('inventory_admin_snapshot', { p_movement_limit: 150 }, 'inventory admin snapshot');
}

export function adminAdjust({ variantId, mode, quantity, reason, orderNumber, actor }) {
    return rpc('inventory_admin_adjust', {
        p_variant_id: variantId,
        p_mode: mode,
        p_quantity: quantity,
        p_reason: reason,
        p_actor_id: actor.id,
        p_actor_email: actor.email,
        p_order_number: orderNumber || null
    }, 'inventory admin adjust');
}

// The storefront payload: per design, the total available across sizes and a
// state for it; per size, the same. Who holds what is never exposed.
export function summarize(snap) {
    const products = {};
    (snap.items || []).forEach((item) => {
        const info = productInfo(item.productSlug);
        if (!info) return;
        const product = products[item.productSlug] || (products[item.productSlug] = {
            slug: item.productSlug,
            name: info.name,
            available: 0,
            reserved: 0,
            sizes: {}
        });
        product.available += item.available;
        product.reserved += item.reserved;
        product.sizes[item.size] = {
            available: item.available,
            state: sizeState(item.available, item.reserved, item.everStocked)
        };
    });

    Object.values(products).forEach((product) => {
        product.state = productState(product.available, product.reserved);
        // Sizes in the catalogue's own order, so every client lists them alike.
        const info = productInfo(product.slug);
        const ordered = {};
        info.sizes.forEach((size) => { if (product.sizes[size]) ordered[size] = product.sizes[size]; });
        product.sizes = ordered;
        // `reserved` decided the state; the number itself stays private.
        delete product.reserved;
    });

    return { products, serverTime: snap.serverTime };
}

// Checks validated catalogue lines against current availability. Demand is
// summed per variant. Advisory only — the reservation in checkout_open_order is
// what actually enforces it, under a lock.
export function stockIssues(lines, snap) {
    const byVariant = new Map((snap.items || []).map((item) => [item.variantId, item]));
    const demand = new Map();
    lines.forEach((line) => demand.set(line.variantId, (demand.get(line.variantId) || 0) + line.quantity));

    const issues = [];
    demand.forEach((qty, variantId) => {
        const item = byVariant.get(variantId);
        const line = lines.find((l) => l.variantId === variantId);
        if (!item) {
            issues.push({ variantId, reason: 'not_for_sale', name: line.name, size: line.size });
        } else if (item.available < qty) {
            issues.push({
                variantId,
                reason: 'insufficient_stock',
                name: line.name,
                size: line.size,
                available: Math.max(item.available, 0),
                held: item.reserved > 0
            });
        }
    });
    return issues;
}

export function availableFor(variantId, snap) {
    const item = (snap.items || []).find((i) => i.variantId === variantId);
    return item ? Math.max(item.available, 0) : 0;
}

// ── Release ──────────────────────────────────────────────────────────────────
export function releaseOrder(orderId, reason) {
    return rpc('inventory_release_order', {
        p_order_id: orderId,
        p_reason: reason,
        p_cancel_order: true
    }, 'release order');
}

// ── Following Stripe ─────────────────────────────────────────────────────────
// Acts on an intent's CURRENT state, as just read from Stripe — never on what a
// webhook event says it was. That is what makes duplicated, retried and
// out-of-order deliveries harmless: a stale `processing` arriving after the
// payment succeeded re-reads `succeeded`, and confirming twice is a no-op in
// the database.
async function orderIdFor(intent) {
    const fromMetadata = intent.metadata && intent.metadata.order_id;
    if (fromMetadata) return fromMetadata;
    return findOrderIdByIntent(intent.id);
}

export async function syncPaymentIntent(intent) {
    if (!intent || !intent.id) return { outcome: 'ignored' };

    if (intent.status === 'succeeded') {
        const result = await rpc('inventory_confirm_payment', {
            p_order_id: (intent.metadata && intent.metadata.order_id) || null,
            p_payment_intent_id: intent.id,
            p_amount: intent.amount_received != null ? intent.amount_received : intent.amount,
            p_currency: intent.currency,
            p_livemode: typeof intent.livemode === 'boolean' ? intent.livemode : null
        }, 'confirm payment');

        if (result.result === 'confirmed') {
            // Exactly once: only the call that moved the order to paid gets here.
            try {
                const items = await findOrderItems(result.order.id);
                await sendOrderConfirmation(result.order, items);
            } catch (error) {
                // The payment is real and the order is recorded; an email
                // failure must not turn into a webhook retry.
                console.error('inventory: confirmation email failed', error.message);
            }
        } else if (result.result !== 'already_paid') {
            console.error('inventory: payment not fulfilled —', result.result, intent.id);
        }
        return { outcome: result.result };
    }

    const orderId = await orderIdFor(intent);
    if (!orderId) return { outcome: 'order_not_found' };

    if (intent.status === 'canceled') {
        const result = await releaseOrder(orderId, 'payment_canceled');
        return { outcome: 'released', released: result.released || 0 };
    }

    if (intent.status === 'processing') {
        await rpc('inventory_hold_order', { p_order_id: orderId }, 'hold order');
        return { outcome: 'held' };
    }

    if (intent.status === 'requires_payment_method' && intent.last_payment_error) {
        await rpc('inventory_payment_failed', { p_order_id: orderId, p_grace_seconds: FAILED_GRACE_SECONDS }, 'payment failed');
        return { outcome: 'failed' };
    }

    // requires_action, requires_confirmation, a fresh requires_payment_method:
    // the customer is still at it. The hold keeps its deadline.
    return { outcome: 'open' };
}

// Cancel first, then release on Stripe's word. If the cancel is refused the
// intent has moved on (succeeded, processing, already cancelled), so it is read
// again and followed instead.
export async function cancelAndRelease(paymentIntentId) {
    try {
        const cancelled = await cancelPaymentIntent(paymentIntentId, 'abandoned');
        return await syncPaymentIntent(cancelled);
    } catch (error) {
        if (error.code !== 'stripe_error') throw error;
        const current = await retrievePaymentIntent(paymentIntentId);
        return syncPaymentIntent(current);
    }
}

// ── The sweeper ──────────────────────────────────────────────────────────────
// Finds holds past their deadline and ends their checkouts. Runs at the start
// of every checkout (so a stale hold on the last piece never blocks a real
// buyer), from /api/inventory whenever expired holds exist, and from the daily
// cron as a backstop. Safe to run concurrently: every step is idempotent.
export async function sweepExpired({ limit = 5 } = {}) {
    const rows = await rpc('inventory_expired_orders', { p_limit: limit }, 'expired orders');
    const results = [];

    for (const row of rows || []) {
        try {
            if (!row.payment_intent_id) {
                // No intent was ever attached, so no client secret was ever
                // returned to a browser: nothing can be charged.
                await releaseOrder(row.order_id, 'checkout_expired');
                results.push({ order: row.order_number, outcome: 'released' });
                continue;
            }
            const result = await cancelAndRelease(row.payment_intent_id);
            results.push({ order: row.order_number, outcome: result.outcome });
        } catch (error) {
            // Left for the next sweep. The hold stays — releasing without
            // Stripe's confirmation is exactly what must not happen.
            console.error(describeSupabaseError(error, `inventory: sweep ${row.order_number}`));
            results.push({ order: row.order_number, outcome: 'error' });
        }
    }
    return results;
}
