// ─────────────────────────────────────────────────────────────────────────────
// GET /api/checkout/order?number=EV-26-XXXXXX&email=...
//
// What the confirmation page reads. It reports the order's real recorded state,
// so a customer who lands here after a failed or still-processing payment is
// told so rather than congratulated. Returning to this URL is not what makes an
// order paid — only the webhook does that.
//
// Both the order number and the email are required, so a guessed number on its
// own discloses nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { findOrderForConfirmation, ordersConfigured } from '../_orders.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).json({ error: 'method_not_allowed' });
    }

    if (!ordersConfigured()) return response.status(503).json({ error: 'orders_not_configured' });

    const { number, email } = request.query || {};
    if (!number || !email) return response.status(400).json({ error: 'missing_parameters' });

    let order;
    try {
        order = await findOrderForConfirmation(number, email);
    } catch (error) {
        console.error('checkout/order: lookup failed', error.code || error.message);
        return response.status(500).json({ error: 'lookup_failed' });
    }

    // Same response either way: a wrong email must not reveal that the order
    // number itself was right.
    if (!order) return response.status(404).json({ error: 'not_found' });

    return response.status(200).json({
        ok: true,
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        currency: order.currency,
        subtotalAmount: order.subtotal_amount,
        shippingAmount: order.shipping_amount,
        taxAmount: order.tax_amount,
        totalAmount: order.total_amount,
        firstName: order.customer_first_name,
        email: order.customer_email,
        shippingAddress: order.shipping_address,
        createdAt: order.created_at,
        paidAt: order.paid_at,
        items: (order.order_items || []).map((item) => ({
            name: item.product_name,
            size: item.size,
            sku: item.sku,
            quantity: item.quantity,
            unitAmount: item.unit_amount,
            image: item.image_path
        }))
    });
}
