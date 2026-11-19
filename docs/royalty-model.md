# EV for Artists — the royalty model

Version 2026-11-19 · **Proposed, pending owner approval, accounting confirmation and legal review.**

One definition, written once, used in three places: the public page, the collaboration agreement,
and the export that produces a statement. If any of the three drifts, an artist is paid a number
they were not promised.

- Public page: `/for-artists` §03, and `assets/void-artists-i18n.js` (four languages)
- Agreement: `docs/legal/ev-for-artists-collaboration-agreement.DRAFT.md` §8–§10
- Export: `public.artist_royalty_statement()` in
  `supabase/migrations/20261119120000_artist_submissions.sql`, served by `api/artist-royalties.js`

---

## The proposal

**12% of net product sales.**

This is ETERNAL VOID's proposed opening offer for a selected design. It is **not** an industry
benchmark and must not be described as one — the public page says so explicitly, in all four
languages. The rate that governs is the one in the signed agreement, which is also the one that must
be written into `artist_collaborations.royalty_bps` (1200 = 12.00%).

The rate lives per collaboration row rather than in code so a renegotiated or legacy agreement
reports correctly without anyone editing the export.

## The base

For **direct sales**, the royalty is calculated on the amount actually paid for the collaboration
merchandise, **after discounts**.

**Excluded from the base**
- VAT and other sales taxes
- Shipping charged separately to the customer

**Not deducted** — ETERNAL VOID covers these when it runs the release
- Production, sampling, packaging
- Platform fees, payment processing fees
- Marketing, fulfilment, overhead

**Worked example.** €160 net product sales × 12% = **€19.20**.

## How the export computes it

| Step | Source | Note |
|------|--------|------|
| Eligible items | `order_items` joined to `artist_collaborations` on `sku` | A SKU nobody has written into `artist_collaborations` earns nothing. A mistake is a missing payment somebody notices, not a silent overpayment. |
| Paid only | `orders.payment_status = 'paid'` and `paid_at` within the period | |
| Within the agreement window | `paid_at::date` between `effective_from` and `effective_to` | A sale before the agreement starts earns nothing. |
| Gross merchandise | `sum(order_items.line_amount)` | Tax and shipping are already outside `line_amount`. |
| Discounts | `greatest(sum(line_amount) − orders.subtotal_amount, 0)`, allocated pro rata on `line_amount` | **Confirm with accounting.** See open question 1. |
| Reversals | `order_refunds`, bucketed on `refunded_at` | Applied once; `provider_ref` is unique, so a duplicated webhook event reverses the amount once. Partial amounts honoured. A reversal landing in a later quarter is reported in that quarter. |
| Royalty base | `gross − discounts − reversals`, floored at zero | |
| Carry-forward | `reversals − (gross − discounts)` when positive | A quarter whose reversals exceed its sales carries the excess forward as a note rather than inventing a negative payment. |
| Due | `round(base × royalty_bps / 10000)` | Integer minor units throughout. No floats anywhere in the chain. |

The export returns the per-line detail as well as the totals, so a statement can be **checked**
rather than believed. CSV at `/api/artist-royalties?format=csv&quarter=2026Q4`.

## Statements and payment

- Itemised **quarterly** statements, paid **within 30 days of quarter end**.
- Each statement shows eligible units, discounts, reversals, royalty base, rate, amount due.
- Admin only: `requireAdmin` (the inventory dashboard's allowlist). No payment path exists in the
  code, and none should — **the export is evidence; the payout is a decision accounting makes.**

## Scope

- **Direct sales only** at launch.
- Wholesale, bundles and marketplaces are out of scope until their base and rate are agreed. The
  base above is written for direct retail; wholesale sells at a different price to a different buyer
  and needs its own base, or the artist is paid on the wrong number.
- Restocks of a listed SKU: in scope, same terms.
- New colourways / new SKUs: require a written amendment adding them to Schedule 1 **and** a new
  `artist_collaborations` row.

## Development fees

Separate from royalties. If ETERNAL VOID asks for a production-ready tech pack, additional artwork,
or substantial revisions after selection, a scope and fee are agreed **before that work starts**.
Not an advance, not recoupable, payable whether or not the piece reaches release.

---

## Launch dependencies — none of these are optional

1. **`order_refunds` is not written yet.** `api/stripe-webhook.js` does not populate it. Until it
   handles `charge.refunded` and `charge.dispute.closed` (writing `provider_ref`, `order_item_id`,
   `amount`, `refunded_at`), the export reports **zero reversals** and **must not be used to pay
   anybody**. This is the single biggest blocker.
2. **Discount allocation needs confirming.** The schema has no discount column. The export infers an
   order-level discount from `sum(line_amount) − orders.subtotal_amount`. Accounting must confirm
   that is how discounts actually land today, and whether item-level discounts are ever written into
   `unit_amount` instead — in which case they are already in the base and must not be deducted
   twice.
3. **`order_items.sku` must be populated** for collaboration products. It is nullable today. A null
   SKU silently earns nothing.
4. **Owner approves the 12%**, the quarterly cadence and the 30-day term.
5. **Accounting confirms** invoicing direction (self-billing vs artist invoice), EU and non-EU VAT
   treatment, currency conversion method and date, and withholding by jurisdiction.
6. **Counsel reviews** the agreement, the Submission Terms and the Privacy Notice.
7. **Reconciliation test** against representative data before the first statement: discounted sales,
   partial refunds, a duplicated payment event, and an adjustment landing in a later quarter.

## Open questions for accounting

1. How is a discount recorded today — reduced `unit_amount`, or an order-level difference between
   `subtotal_amount` and the sum of lines? The export assumes the latter and ignores the former.
2. Should the quarterly minimum payment threshold (§9.3 of the agreement) be set, and at what value?
3. Currency: all orders are EUR today. If that changes, the conversion date and source need fixing
   in the agreement before, not after.
4. Is a reversal of a bundled item apportioned the same way as the sale?
