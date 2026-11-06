// ─────────────────────────────────────────────────────────────────────────────
// The sales gate.
//
// Two independent switches, both explicit, both closed unless switched on:
//
//   VOID_SALES_OPEN=true     live sales. Every active catalogue piece.
//   VOID_TEST_CHECKOUT=true  the test checkout. One piece, test stock, test
//                            Stripe credentials, no fulfilment.
//
// Neither is inferred from the environment. An earlier version of salesOpen()
// treated any non-production deployment as open, which meant a preview URL
// quietly opened the whole catalogue — and a preview deployment shares the
// production database and the production Stripe key, so it establishes no
// isolation at all. Both switches are now read as literal 'true'.
// ─────────────────────────────────────────────────────────────────────────────

export function salesOpen() {
    return process.env.VOID_SALES_OPEN === 'true';
}

// The one piece the test checkout may sell. A slug of its own, not the live
// Endzustand: its stock, holds and orders are separate rows, so a test purchase
// cannot touch the production allocation. See api/_catalog.js.
export const TEST_PRODUCT_SLUG = 'endzustand-tee-test';

export function testCheckoutEnabled() {
    return process.env.VOID_TEST_CHECKOUT === 'true';
}

// Whether a single validated catalogue line may be bought right now. The two
// switches never cover for each other: a test twin needs the test switch even
// when live sales are open, and a live piece needs the live switch even when
// the test checkout is running.
export function linePurchasable(line) {
    return line && line.testOnly ? testCheckoutEnabled() : salesOpen();
}

// What kind of checkout a validated bag is: 'live', 'test', or 'mixed'.
//
// 'mixed' is refused by the callers. One order and one PaymentIntent cannot be
// half test and half real — it would put test stock and production stock in the
// same transaction and leave the charge ambiguous.
export function checkoutMode(lines) {
    const test = lines.filter((line) => line.testOnly).length;
    if (test === 0) return 'live';
    if (test === lines.length) return 'test';
    return 'mixed';
}

// Lines the gate refuses, in the shape the checkout endpoints already use for
// stock problems. This is the server-side half of the restriction: the
// storefront hides what cannot be bought, and this is what makes a
// hand-written request obey the same rule.
export function gateIssues(lines) {
    return lines
        .filter((line) => !linePurchasable(line))
        .map((line) => ({
            variantId: line.variantId,
            reason: 'not_for_sale',
            name: line.name,
            size: line.size
        }));
}
