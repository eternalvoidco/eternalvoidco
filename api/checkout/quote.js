// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/quote
//
// The authoritative price of a bag. The client sends variant ids, quantities
// and (optionally) a destination country; everything payable comes back from
// here. The browser may show its own running total while the customer edits,
// but this is the figure the payment is built from.
//
// Prices come from the catalogue; availability from one read of the inventory
// snapshot. Both are advisory here — nothing is held. The hold is taken, under
// a lock, when checkout starts (/api/checkout/create), which is what actually
// stops two customers buying the same last piece.
// ─────────────────────────────────────────────────────────────────────────────
import { validateLines, subtotalOf, shippingMethodsFor, shippingAmountFor, taxAmountFor, CURRENCY } from '../_catalog.js';
import { snapshot, stockIssues, availableFor } from '../_inventory.js';
import { ordersConfigured, describeSupabaseError } from '../_orders.js';

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

    // A stale bag — an old tab, a cart saved before the drop sold through — is
    // caught here, with the detail the page needs to correct it.
    if (!ordersConfigured()) return response.status(503).json({ ok: false, error: 'inventory_unavailable' });
    let snap;
    try {
        snap = await snapshot();
    } catch (error) {
        console.error(describeSupabaseError(error, 'checkout/quote: inventory'));
        return response.status(503).json({ ok: false, error: 'inventory_unavailable' });
    }
    const lines = result.lines.map((line) => ({ ...line, available: availableFor(line.variantId, snap) }));
    const issues = stockIssues(result.lines, snap);
    if (issues.length) {
        return response.status(200).json({ ok: false, error: 'line_issues', issues, lines });
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
        lines,
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
