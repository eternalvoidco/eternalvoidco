import { salesOpen } from '../_sales.js';
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/create
//
// Revalidates the bag, writes a pending order AND holds its stock in one
// transaction, opens a Stripe PaymentIntent for the server-calculated total and
// returns only the client secret and the order number. The response never
// contains a price the client could act on as truth.
//
// The hold is what stops two customers buying the same last piece: it is taken
// under a row lock, so of two simultaneous requests for one unit exactly one
// succeeds. If anything after it fails, the hold is released before
// responding — and since no client secret was returned, nothing can be charged.
//
// Nothing here marks anything paid — that is the webhook's job alone.
// ─────────────────────────────────────────────────────────────────────────────
import { validateLines, subtotalOf, shippingAmountFor, shippingMethodsFor, taxAmountFor, CURRENCY, lookupVariant } from '../_catalog.js';
import { createPaymentIntent, cancelPaymentIntent, stripeConfigured } from '../_stripe.js';
import { openOrder, attachPaymentIntent, generateOrderNumber, ordersConfigured, describeSupabaseError } from '../_orders.js';
import { holdSeconds, releaseOrder, sweepExpired } from '../_inventory.js';
import { resolveUser } from '../_auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function readAddress(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    return {
        firstName: str(a.firstName, 80),
        lastName: str(a.lastName, 80),
        line1: str(a.line1, 200),
        line2: str(a.line2, 200),
        city: str(a.city, 120),
        postalCode: str(a.postalCode, 32),
        country: str(a.country, 2).toUpperCase(),
        phone: str(a.phone, 40)
    };
}

function addressProblems(address) {
    const missing = [];
    ['firstName', 'lastName', 'line1', 'city', 'postalCode', 'country'].forEach((field) => {
        if (!address[field]) missing.push(field);
    });
    if (address.country && address.country.length !== 2) missing.push('country');
    return missing;
}

// The signed-in customer is resolved from their access token against Supabase
// (see _auth.js), never read from the request body — a client-supplied user_id
// would let anyone file an order under someone else's account.

// Names and sizes for the issues the database reports, so the page can say
// which piece ran out rather than quoting a variant id.
function describeStockIssues(issues) {
    return (issues || []).map((issue) => {
        const found = lookupVariant(issue.variantId);
        return {
            variantId: issue.variantId,
            reason: issue.reason === 'not_tracked' ? 'not_for_sale' : issue.reason,
            name: found.name,
            size: found.size,
            available: Math.max(Number(issue.available) || 0, 0),
            held: Boolean(issue.held)
        };
    });
}

async function releaseQuietly(orderId, reason) {
    try {
        await releaseOrder(orderId, reason);
    } catch (error) {
        // The hold carries a deadline and no intent was handed out, so the
        // sweeper releases it on its own; this only makes it immediate.
        console.error(describeSupabaseError(error, `checkout/create: release after ${reason}`));
    }
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method_not_allowed' });
    }

    if (!salesOpen()) return response.status(409).json({ ok: false, error: 'sales_not_open', message: 'Coming soon. Join the newsletter for drop updates.' });

    if (!stripeConfigured()) return response.status(503).json({ error: 'stripe_not_configured' });
    if (!ordersConfigured()) return response.status(503).json({ error: 'orders_not_configured' });

    const body = request.body || {};

    // ── customer ─────────────────────────────────────────────────────────────
    const email = str(body.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) {
        return response.status(400).json({ error: 'invalid_email', field: 'email' });
    }

    const shipping = readAddress(body.shippingAddress);
    const missing = addressProblems(shipping);
    if (missing.length) {
        return response.status(400).json({ error: 'incomplete_address', fields: missing });
    }

    const firstName = str(body.firstName, 80) || shipping.firstName;
    const lastName = str(body.lastName, 80) || shipping.lastName;
    if (!firstName || !lastName) {
        return response.status(400).json({ error: 'incomplete_name', fields: ['firstName', 'lastName'] });
    }

    // ── the bag, revalidated ────────────────────────────────────────────────
    const validated = validateLines(body.items);
    if (!validated.ok) {
        return response.status(409).json({ error: validated.error, issues: validated.issues });
    }

    // ── shipping, revalidated ───────────────────────────────────────────────
    const methodId = str(body.shippingMethodId, 64);
    const shippingAmount = shippingAmountFor(shipping.country, methodId);
    if (shippingAmount == null) {
        const available = shippingMethodsFor(shipping.country);
        return response.status(409).json({
            error: available.length ? 'invalid_shipping_method' : 'shipping_unavailable',
            shippingMethods: available
        });
    }
    const method = shippingMethodsFor(shipping.country).find((m) => m.id === methodId);

    const subtotal = subtotalOf(validated.lines);
    const tax = taxAmountFor();
    const total = subtotal + shippingAmount + tax;
    if (total <= 0) return response.status(409).json({ error: 'invalid_total' });

    // ── persist and hold, then pay ──────────────────────────────────────────
    const user = await resolveUser(request);

    // Expired holds are returned first, so a checkout abandoned an hour ago
    // cannot keep the last piece from a customer who is here now.
    try {
        await sweepExpired({ limit: 5 });
    } catch (error) {
        console.error(describeSupabaseError(error, 'checkout/create: sweep'));
    }

    let opened;
    try {
        opened = await openOrder({
            order_number: generateOrderNumber(),
            user_id: user ? user.id : null,
            customer_email: email,
            customer_first_name: firstName,
            customer_last_name: lastName,
            phone: str(body.phone, 40) || shipping.phone || null,
            shipping_address: shipping,
            billing_address: body.billingSameAsShipping === false ? readAddress(body.billingAddress) : null,
            shipping_method_id: methodId,
            shipping_method_label: method ? `${method.label} · ${method.note}` : null,
            currency: CURRENCY,
            subtotal_amount: subtotal,
            shipping_amount: shippingAmount,
            tax_amount: tax,
            total_amount: total
        }, validated.lines.map((line) => ({
            variant_id: line.variantId,
            product_slug: line.slug,
            product_name: line.name,
            size: line.size,
            sku: line.sku,
            image_path: line.image,
            unit_amount: line.unitAmount,
            quantity: line.quantity,
            line_amount: line.lineAmount
        })), holdSeconds());
    } catch (error) {
        // Full diagnostics to the server log — status, PostgREST code, message,
        // details, hint, which operation, and the shape of the configured key.
        // Never the key itself, the request body or any customer field. The
        // function is one transaction, so a failure leaves nothing behind.
        console.error(describeSupabaseError(error, 'checkout/create: open order'));
        return response.status(500).json({ error: 'order_create_failed' });
    }

    if (!opened || !opened.ok) {
        // Someone else secured the piece, or it was never for sale. Nothing
        // was written; the page gets enough detail to correct the bag.
        return response.status(409).json({
            error: 'line_issues',
            issues: describeStockIssues(opened && opened.issues)
        });
    }

    const order = opened.order;

    // Curated rather than automatic. `automatic_payment_methods` surfaces
    // everything switched on in the dashboard — Amazon Pay, Bancontact, EPS and
    // the rest — which reads as a marketplace, not a boutique. Naming the types
    // here suppresses them at the source, whatever the dashboard says.
    //
    // Apple Pay and Google Pay are card wallets and ride on `card`; they need no
    // entry of their own. Link is opt-in because an explicit list requires every
    // named method to be active on the account, and asking for an inactive one
    // fails the whole PaymentIntent.
    const methods = ['card'];
    if (process.env.VOID_ENABLE_LINK === '1') methods.push('link');

    let intent;
    try {
        intent = await createPaymentIntent({
            amount: total,
            currency: CURRENCY,
            payment_method_types: methods,
            receipt_email: email,
            // Only what is needed to find our order again. No addresses, no
            // names — Stripe does not need a copy of the customer record.
            metadata: {
                order_id: order.id,
                order_number: order.order_number
            },
            shipping: {
                name: `${firstName} ${lastName}`.trim(),
                address: {
                    line1: shipping.line1,
                    line2: shipping.line2 || undefined,
                    city: shipping.city,
                    postal_code: shipping.postalCode,
                    country: shipping.country
                }
            }
        }, `order-${order.id}`);
    } catch (error) {
        console.error('checkout/create: payment intent failed', error.code || error.message);
        await releaseQuietly(order.id, 'payment_init_failed');
        return response.status(502).json({ error: 'payment_init_failed' });
    }

    try {
        await attachPaymentIntent(order.id, intent.id, intent.livemode);
    } catch (error) {
        console.error(describeSupabaseError(error, 'checkout/create: attach intent'));
        // The client secret is never returned, so this intent cannot be paid;
        // it is cancelled anyway so it does not linger in the dashboard.
        try {
            await cancelPaymentIntent(intent.id, 'abandoned');
        } catch (cancelError) {
            console.error('checkout/create: cancel after attach failure', cancelError.code || cancelError.message);
        }
        await releaseQuietly(order.id, 'order_link_failed');
        return response.status(500).json({ error: 'order_link_failed' });
    }

    return response.status(200).json({
        ok: true,
        orderNumber: order.order_number,
        clientSecret: intent.client_secret,
        currency: CURRENCY,
        subtotalAmount: subtotal,
        shippingAmount,
        taxAmount: tax,
        totalAmount: total,
        // When the pieces go back to the collection if payment is not made.
        holdExpiresAt: opened.expiresAt
    });
}
