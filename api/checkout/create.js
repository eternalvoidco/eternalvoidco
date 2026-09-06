// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/create
//
// Revalidates the bag, writes a pending order, opens a Stripe PaymentIntent for
// the server-calculated total and returns only the client secret and the order
// number. The response never contains a price the client could act on as truth.
//
// Nothing here marks anything paid — that is the webhook's job alone.
// ─────────────────────────────────────────────────────────────────────────────
import { validateLines, subtotalOf, shippingAmountFor, shippingMethodsFor, taxAmountFor, CURRENCY } from '../_catalog.js';
import { createPaymentIntent, stripeConfigured } from '../_stripe.js';
import { createPendingOrder, attachPaymentIntent, generateOrderNumber, ordersConfigured } from '../_orders.js';

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

// The signed-in customer is resolved from their access token against Supabase,
// never read from the request body — a client-supplied user_id would let anyone
// file an order under someone else's account.
async function resolveUser(request) {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const anon = process.env.SUPABASE_ANON_KEY || '';
    if (!token || !base || !anon) return null;

    try {
        const res = await fetch(`${base}/auth/v1/user`, {
            headers: { apikey: anon, Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const user = await res.json();
        return user && user.id ? user : null;
    } catch (error) {
        return null;
    }
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method_not_allowed' });
    }

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

    // ── persist, then pay ───────────────────────────────────────────────────
    const user = await resolveUser(request);
    const orderNumber = generateOrderNumber();

    let order;
    try {
        order = await createPendingOrder({
            order_number: orderNumber,
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
        })));
    } catch (error) {
        console.error('checkout/create: order write failed', error.code || error.message);
        return response.status(500).json({ error: 'order_create_failed' });
    }

    let intent;
    try {
        intent = await createPaymentIntent({
            amount: total,
            currency: CURRENCY,
            automatic_payment_methods: { enabled: true },
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
        return response.status(502).json({ error: 'payment_init_failed', orderNumber: order.order_number });
    }

    try {
        await attachPaymentIntent(order.id, intent.id);
    } catch (error) {
        console.error('checkout/create: could not attach intent', error.code || error.message);
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
        totalAmount: total
    });
}
