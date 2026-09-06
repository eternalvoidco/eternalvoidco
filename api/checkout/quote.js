// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/quote
//
// The authoritative price of a bag. The client sends variant ids, quantities
// and (optionally) a destination country; everything payable comes back from
// here. The browser may show its own running total while the customer edits,
// but this is the figure the payment is built from.
//
// Deliberately does not touch the database — it is a pure read of the
// catalogue, so it stays cheap enough to call on every quantity change.
// ─────────────────────────────────────────────────────────────────────────────
import { validateLines, subtotalOf, shippingMethodsFor, shippingAmountFor, taxAmountFor, CURRENCY } from '../_catalog.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method_not_allowed' });
    }

    const body = request.body || {};
    const result = validateLines(body.items);

    // Issues are returned with a 200 rather than an error status: the bag is a
    // legitimate state to be in, and the client needs the detail to explain
    // which piece became unavailable.
    if (!result.ok) {
        return response.status(200).json({
            ok: false,
            error: result.error,
            issues: result.issues,
            lines: result.lines
        });
    }

    const country = typeof body.country === 'string' ? body.country : '';
    const methods = country ? shippingMethodsFor(country) : [];
    const subtotal = subtotalOf(result.lines);

    let shippingAmount = null;
    let shippingMethod = null;
    if (country && typeof body.shippingMethodId === 'string') {
        shippingAmount = shippingAmountFor(country, body.shippingMethodId);
        if (shippingAmount != null) {
            shippingMethod = methods.find((m) => m.id === body.shippingMethodId) || null;
        }
    }

    const tax = taxAmountFor();
    const total = subtotal + (shippingAmount || 0) + tax;

    return response.status(200).json({
        ok: true,
        currency: CURRENCY,
        lines: result.lines,
        subtotalAmount: subtotal,
        shippingAmount,
        shippingMethod,
        taxAmount: tax,
        totalAmount: total,
        shippingMethods: methods,
        // True when a country is known but no rate is configured for its zone,
        // which the UI needs to distinguish from "no country chosen yet".
        shippingUnavailable: Boolean(country) && methods.length === 0
    });
}
