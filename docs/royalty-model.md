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
| Discounts | **n/a — verified absent.** `subtotalOf()` is exactly `sum(lineAmount)`, `taxAmountFor()` is `0`, and there is no coupon/promotion path in the project. Two constraints hold it. | An order where `subtotal_amount` disagrees with the sum of its lines is **unreconcilable** and blocks the payout. It is never inferred. |
| Reversals | `order_refunds` + `order_refund_allocations`, bucketed on `refunded_at` | Counted once through allocation rows; `provider_ref` is unique so duplicate deliveries converge. Only `succeeded` counts: `pending` has not moved money, `failed`/`canceled` never did, `reinstated` (dispute won) undoes it. **Unallocated reversals are carried on the statement and block the payout — never dropped.** |
| Royalty base | `gross − reversals`, floored at zero, **per SKU** | |
| Carry-forward | `reversals − gross` when positive, per SKU | A quarter whose reversals exceed its sales carries the excess forward as a note rather than inventing a negative payment. |
| Due | `round(base × royalty_bps / 10000)` **per SKU**, summed | The rate is per collaboration row, so two agreements at two rates give two correct figures rather than one blended wrong one. Integer minor units throughout; no floats anywhere. |

The export returns the per-line detail as well as the totals, so a statement can be **checked**
rather than believed. CSV at `/api/artist-royalties?format=csv&quarter=2026Q4` — **refused with 409 for any period that does not reconcile**; `&diagnostic=1` returns the same figures with every unresolved item listed, named `…-DIAGNOSTIC-DO-NOT-PAY.csv`.

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

1. **Enable the refund and dispute events** on the Stripe webhook endpoint:
   `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`,
   `charge.refund.updated`, and the five `charge.dispute.*`. The ingestion is written and tested
   (`api/_reversals.js`); until the events are switched on it receives nothing.
2. **Run the historical dry run.** A webhook only catches what happens next.
   `GET /api/artist-reversals?from=…&to=…` reports what it would record and every payment it could
   not match to an order. Resolve those, then `&apply=1`. **No real period can reconcile before
   this.**
3. **Populate `order_items.sku`** for collaboration products. The column is nullable, and a null
   SKU silently earns nothing — the reconciliation flags such orders rather than guessing.
4. **One `artist_collaborations` row per signed SKU**, carrying the rate that agreement says.
5. **Owner approves** 12%, the quarterly cadence and the 30-day term.
6. **Accounting confirms** invoicing direction, EU and non-EU VAT, currency conversion, withholding,
   the dispute rule, and how carry-forward is applied.
7. **Counsel reviews** all three documents.
8. **Read `payoutReady`.** A period that is not `clean` produces no payout file — the export
   refuses with 409 and returns a diagnostic worklist instead.

See `docs/ev-for-artists-handoff.md` for the full test results and the open decisions.

## Open questions for accounting

1. How is a discount recorded today — reduced `unit_amount`, or an order-level difference between
   `subtotal_amount` and the sum of lines? The export assumes the latter and ignores the former.
2. Should the quarterly minimum payment threshold (§9.3 of the agreement) be set, and at what value?
3. Currency: all orders are EUR today. If that changes, the conversion date and source need fixing
   in the agreement before, not after.
4. Is a reversal of a bundled item apportioned the same way as the sale?
