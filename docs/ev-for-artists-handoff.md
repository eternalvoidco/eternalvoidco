# EV for Artists — owner handoff

2026-11-19 · Second pass: royalty reconciliation, private intake, launch readiness.

**Nothing in this programme is live.** Intake is closed on the server, the commercial terms are
proposals, and the three legal documents are drafts. This is what has been built, what has been
proven, and what has to be decided before any of it opens.

---

## 1 · Does closed intake reject unauthenticated requests?

**Yes, and it is the server that rejects them — not the page.**

`?intake=preview` only un-hides the form in the browser. It is not sent to the API and has no
bearing on anything the API does. The gate is `VOID_ARTIST_INTAKE`, read server-side in
`api/_artists.js`.

With the gate closed, an unauthenticated caller posting directly to `/api/artist-submission`:

| attempt | result |
|---|---|
| create a draft | `503`, nothing recorded |
| be issued an upload URL | `503`, no URL minted |
| finalise a submission | `503` |
| send `{preview: true, isPreview: true, intake: 'preview'}` in the body | `503`, nothing recorded |

The one way through a closed gate is an **administrator on the existing `VOID_ADMIN_EMAILS`
allowlist** — the same check the inventory dashboard uses. Their submissions are flagged
`is_preview`, kept out of the reviewer's queue, and purgeable as a group, so a rehearsal can never
be read as somebody's work.

> **Correction to the previous handoff.** It said `?intake=preview` "exercises the real form against
> the real endpoint". The form was real; the endpoint refused it, because the gate was closed. It is
> now genuinely end-to-end, for an administrator, against real storage.

### A security defect found and fixed

`api/artist-submission.js` looked a draft up through `artist_submissions_list` to read its
`file_path`. That function **excludes drafts by design**, so the lookup always missed and the code
always fell through to the path supplied in the request body, checked only against a shape regex.
A caller holding a valid token for their own draft could point it at a different submission's
object. The comment above that line claimed the path was read back from the row. It was not.

Fixed by `artist_submission_draft_path(reference, token)`, which answers only for a draft and only
to its own confirm token. The request body's `path` is now ignored entirely — proven in test C
below.

### Upload scoping, expiry and overwrite

| property | value | how it is known |
|---|---|---|
| object path | `YYYY/MM/<reference>.<ext>`, derived from the server-generated reference | chosen in `storagePath()`; a caller can never name one |
| bucket | `artist-submissions`, `public = false`, 15 MB limit, PDF/JPG/PNG only | set in the migration, re-asserted on every apply |
| signed upload token scope | one path, baked into the token | Supabase `/object/upload/sign/{bucket}/{path}` |
| overwrite | refused — `x-upsert: false` is sent with the PUT | set in `uploadHeaders` |
| **token expiry** | **2 hours (Supabase default). The sign endpoint takes no `expiresIn`, so it is not configurable from here.** | **Documented contract, NOT verified against the live project — see Unverified below** |
| download links for reviewers | 5 minutes, clamped to 15 max | `signDownload()` |

### Drafts and their files

A submission is a *draft* between its metadata being recorded and storage confirming the file
landed. Drafts never appear in the reviewer's queue. `api/artist-drafts-sweep.js` removes drafts
older than 24 hours **together with their objects**, so neither outlives the other — the retention
promise the Privacy Notice makes. Added to `vercel.json` crons at 04:41 daily, authorised by
`CRON_SECRET` or by an administrator. **If `CRON_SECRET` is unset the sweep cannot authenticate and
will log loudly rather than fail silently.**

---

## 2 · Royalty reconciliation

### Three defects fixed, each of which paid the wrong number

**1. The discount calculation was vacuous.** The export inferred an order-level discount from
`sum(line_amount) − orders.subtotal_amount`. In this codebase that difference is **always zero**:

- `api/_catalog.js` → `subtotalOf(lines)` returns exactly `sum(lineAmount)`
- `taxAmountFor()` returns `0`
- there is **no coupon, promotion, voucher or discount code path anywhere in the project**
- two constraints hold it there: `orders_total_is_sum` and `order_items_line_is_product`

So it handled nothing while looking as though it handled something — and the day a discount feature
lands, a pro-rata guess would quietly pay a wrong number.

**The verified calculation is now:** royalty base = `sum(order_items.line_amount)` for eligible
SKUs. Tax (`orders.tax_amount`) and shipping (`orders.shipping_amount`) are sibling columns, never
inside `line_amount`, so neither is in the base. Plus a **tripwire**: any order whose
`subtotal_amount` disagrees with the sum of its lines makes the period **unreconcilable** and blocks
the payout, rather than being silently treated as discounted.

> **A checkout fixture with a promotion could not be built, because the system cannot produce one.**
> Test 10 instead writes such an order directly — the way an import or a future discount feature
> would — and proves the tripwire bites.

**2. Unallocated reversals vanished.** The reversal query inner-joined `order_items` through
`order_item_id`, so a refund not yet attributed to a line was dropped from the statement entirely.
That is the worst direction for an error to point: **it over-pays**. Allocation now lives in its own
table; anything unallocated is counted, carried on the face of the statement, and blocks the payout.

**3. One rate per artist.** The statement took `max(royalty_bps)` per artist. An artist with two
SKUs on two agreements at two rates got one blended wrong rate over the combined base. Rate is now
read per collaboration row and the royalty summed per row. Test 2: **€20.00 correct vs €24.00 under
the old code.**

### Refund ingestion

Through the existing webhook, which already verifies the Stripe signature over the raw body
(`verifyWebhook`, `bodyParser: false`). Events handled:

```
charge.refunded              refund.created       refund.updated
refund.failed                charge.refund.updated
charge.dispute.created       .updated   .closed
charge.dispute.funds_withdrawn          .funds_reinstated
```

Every one is handled the same way, and it is the house pattern already used for PaymentIntents:
**re-read the object from Stripe and act on its current state.** That is what makes duplicates,
retries, out-of-order delivery and later status changes safe without a single special case. A
second guard, `source_updated_at`, refuses a stale delivery from a slower concurrent handler.

- **Reconciled by Stripe refund ID.** `provider_ref` is unique, so a refund arriving any number of
  times converges on one row. Three deliveries → one row, one reversal (test 3).
- **Dashboard refunds** emit the same events and carry the same `payment_intent`, so they arrive by
  the same route. There is no second path for them to miss.
- **`charge.refunded` carries the Charge**, whose `refunds.data` holds every refund on it — which is
  also how a second partial refund arrives. Each is re-read and landed under its own id.
- **Status is respected**: only `succeeded` reduces a royalty. `pending` has not moved money,
  `failed`/`canceled` never did, and `reinstated` (a dispute won) undoes the reversal.

### Allocating a refund to order lines

**Stripe holds no item-level evidence for this integration** — it creates bare PaymentIntents with
no line items. So the rules are the only unambiguous readings of the amounts, and everything else is
left for a person. Guessing is how an artist gets paid for a sale that was returned.

| rule | condition | allocation |
|---|---|---|
| `not_required` | order holds no collaboration SKU | none; never touches a statement |
| `full_order` | reversal == order total | every line, in full |
| `full_merchandise` | reversal == merchandise subtotal (shipping retained) | every line, in full |
| `sole_line` | one line, no shipping, reversal ≤ merchandise | that line |
| `unique_line_match` | reversal == the line total of exactly one line | that line. **Refused when two lines share a price** |
| **unallocated** | **anything else** | **none — BLOCKS THE PAYOUT** |

An order containing a line with **no SKU** can never be allocated by rule, and blocks.
`PATCH /api/artist-reversals` lets a named person resolve one; the amounts are checked against both
the reversal and the lines, and a manual decision is never overwritten by a later rule pass.

### Disputes

Opened → funds withdrawn → reversal counts. Closed `won` → `reinstated`, reversal undone. Closed
`lost` → stands. `warning_*` → `pending`. A charge carrying **both** a refund and a dispute is
flagged for review — legitimate, and also the exact shape of a double reversal.

### The historical dry run

A webhook only catches what happens next. `GET /api/artist-reversals?from=…&to=…` lists the refunds
and disputes Stripe already settled, matches each back to an order through
`orders.stripe_payment_intent_id`, and reports **what it would record**: the records, the totals,
what is already known, and — the part that matters — **every payment it could not match to an
order**. `&apply=1` writes them. Re-running recognises what it already recorded (test: 0 inserted,
1 already known).

### Reconciliation status, and the payout block

`artist_royalty_reconciliation(from, to)` returns `clean` / `needs_review` / `blocked`.

| blocking | review |
|---|---|
| unallocated reversals | reversals still `pending` |
| subtotal disagrees with lines | refund **and** dispute on one charge |
| a line with no SKU | |
| allocated for more than was reversed | |

`GET /api/artist-royalties?format=csv` **refuses with 409** for any period that is not `clean`, and
names what is in the way. `&diagnostic=1` returns the same figures with every unresolved item listed
as a worklist, filename `…-DIAGNOSTIC-DO-NOT-PAY.csv`, watermarked in the file's own header. The
admin queue does this automatically and says so.

**There is still no payment path in any of this code, and there should not be one.** The export is
evidence; the payout is a decision accounting makes.

---

## 3 · Test results

Run against **real PostgreSQL** (PGlite/WASM) with the project's own migration files applied
verbatim. Only the three Supabase roles, `auth.uid()`, and the `pgcrypto` extension line were
stubbed — `gen_random_uuid()` is core Postgres, so dropping that line changes nothing under test.

**Executing the SQL found a real bug immediately:** `overlaps` is a Postgres operator keyword and
cannot name a CTE. It would have failed on apply.

### Royalty — 36/36

| # | case | expected | actual |
|---|---|---|---|
| 1 | €160 merchandise + €12 shipping + €38 tax | base €160.00, due **€19.20** | ✓ |
| 2 | two SKUs, 12% and 8% | **€20.00** (old code: €24.00) | ✓ |
| 3 | full-order refund delivered 3× | one row, due €0.00 | ✓ |
| 4 | two partial refunds (€50, €30) on €200 | base €120.00, due **€14.40** | ✓ |
| 5 | mixed cart: €90 refund matches one line; €70 matches nothing | €90 attributed; €70 unallocated, period **blocked** | ✓ |
| 6 | out-of-order delivery; a refund that fails | stale refused; failed €40 ignored; due **€18.00** | ✓ |
| 7 | sold Q4, refunded Q1 | Q4 due €24.00; Q1 base €0, carry €200.00, due €0 | ✓ |
| 8 | dispute opened, then won | reverses to €0, then **restores to €24.00** | ✓ |
| 9 | refund + dispute on one charge | `needs_review`, not payable | ✓ |
| 10 | subtotal ≠ sum of lines | **blocked**, both figures named | ✓ |
| 11 | a line with no SKU | not allocated, period blocked | ✓ |
| 12 | refund on a non-collaboration order | `not_required`, period stays clean | ✓ |

### Historical backfill — 8/8

Dry run writes nothing and reports what it would insert; an unmatched payment is **listed, not
dropped**; apply writes it once; re-running recognises it; the statement then shows the refund once
and reconciles.

### Intake — 35/35

A `503` for every unauthenticated route through a closed gate, including a body claiming preview.
An administrator is let through and flagged. **Test C proves the fix**: A's token pointed at B's
object leaves A pointing at A and sized from A's own 1 KB object, not B's 2 KB one. A 20 MB upload
is refused at confirmation and removed; so is a disallowed type. Confirming twice is safe and says
`alreadyConfirmed`. An abandoned draft is swept with its file while confirmed submissions survive.

Harnesses live in `tests/royalty-reconciliation/` — `npm install`, then `node scenarios.mjs`,
`node backfill.mjs`, `node intake.mjs`. They apply the project's own migration files and import
the real `artist-submission.js` handler, so they test the code that ships rather than a model of
it. See that directory's README for exactly what is real and what is stubbed.

### Which reporting periods reconcile?

**Unknown, and not knowable from here — there is no production data on this machine and no
Supabase or Stripe credentials.** What can be said:

- Every period reconciles `clean` under the test fixtures where the evidence is unambiguous.
- **No real period can reconcile until the historical dry run has been run and its unmatched
  payments resolved**, because until then the reversals Stripe already settled are invisible.

The first real run is: apply the three migrations → `GET /api/artist-reversals?from&to` (dry) →
resolve the unmatched → `&apply=1` → `GET /api/artist-royalties?quarter=…` and read `payoutReady`.

### Which orders still require review?

Also not knowable from here. The report that answers it is
`artist_royalty_reconciliation(from, to) -> 'blocking'`, surfaced in the admin queue and in the
diagnostic CSV, listing each order number and reference. Expect the first run to flag:

- any order with a `NULL` `order_items.sku` — **the column is nullable today**
- any partial refund on a mixed cart that matches no single line

---

## 4 · Company information

**None exists.** The whole repository was searched for a registered name, company number, tax
number, seat, or imprint. There is no such information in any file, and I will not put a guessed
company name into a contract.

These are the exact blanks, each one currently a visible gap rather than plausible-looking prose:

| field | Submission Terms | Privacy Notice | Collaboration Agreement |
|---|---|---|---|
| registered legal name (…Kft.) | §1 | §1 | Parties, signature block |
| company registration number (cégjegyzékszám) | §1 | §1 | Parties |
| tax number (adószám) + EU VAT number | — | — | Parties, §9 |
| registered seat (székhely) | §1 | §1 | Parties, §16 |
| name and title of the signing representative | — | — | signature block |
| court venue for disputes | §12 | — | §16.3 |
| DPO required? | — | §1 | — |
| processor regions + transfer mechanism | — | §4, §5 | — |
| retention periods (files, record) | — | §6 | — |
| bank details / payout rail | — | — | §9 |

**Source document:** a current `cégkivonat` (company registry extract) from the Hungarian company
register supplies the first five in one place. Please paste it, or the five values, and every blank
closes in one pass.

---

## 5 · What must be approved

### Owner
- [ ] **12%** of net product sales (currently marked *proposed* on the public page in all four languages)
- [ ] **Quarterly** statements, paid **within 30 days** of quarter end (both marked *proposed*)
- [ ] Term, territory, release deadline, sell-off window (Collaboration Agreement §4, §5, §6.4, §13.3)
- [ ] Minimum payment threshold (§9.3)
- [ ] Whether exclusivity is ever offered, and at what price (Schedule 2)

### Accounting
- [ ] **Confirm the discount question is closed.** The export now asserts `subtotal_amount == sum(line_amount)` and blocks the period when it is not. Confirm no discount is ever applied in a way that breaks it.
- [ ] Invoicing direction — self-billing or artist invoice
- [ ] EU and non-EU VAT treatment
- [ ] Currency conversion method and date (all orders are EUR today)
- [ ] Withholding by artist jurisdiction
- [ ] **Agree the dispute rule as implemented**: opened reverses, won reinstates, lost stands
- [ ] **Agree the carry-forward rule**: a quarter whose reversals exceed its sales reports a carry-forward and raises no negative payment. *It is reported but not yet automatically applied to the next quarter* — see Known gaps
- [ ] Confirm the quarterly statement format matches what `artist_royalty_statement()` produces

### Hungarian counsel — three separate documents
1. `/legal/ev-for-artists-submission-terms` — public, `noindex` while draft. 7 open items listed in the page.
2. `/legal/ev-for-artists-privacy-notice` — public, `noindex` while draft. 8 open items listed in the page.
3. `docs/legal/ev-for-artists-collaboration-agreement.DRAFT.md` — **private, never deployed** (`.vercelignore` excludes `docs/`).

Principal questions: licence form and the written-form requirement under the Hungarian Copyright
Act (1999. évi LXXVI.), moral rights, design registration, indemnity cap and mutuality, venue,
e-signature validity, and whether a Hungarian-language version is required and which language
governs.

---

## 6 · Before intake can open

1. Apply the three migrations in order.
2. Set `VOID_ARTIST_IP_SALT` (rate limiting is a no-op without it) and `CRON_SECRET` (the draft sweep cannot authenticate without it).
3. Confirm the `artist-submissions` bucket is **private** after apply.
4. Counsel signs off all three drafts; remove the draft banners and the `noindex`.
5. Owner approves the rate and terms.
6. Then, and only then, set `VOID_ARTIST_INTAKE=open`.

## 7 · Before any royalty is paid

1. Enable the refund and dispute events on the Stripe webhook endpoint (the nine listed above).
2. Run the historical dry run over all trading history; resolve every unmatched payment.
3. `&apply=1`.
4. **Populate `order_items.sku` for collaboration products** — the column is nullable, and a null SKU silently earns nothing.
5. Write one `artist_collaborations` row per signed SKU, with the rate the agreement says.
6. Run the quarter and read `payoutReady`. If it is not `true`, nothing is paid.
7. Accounting approves and executes. The code does not pay.

---

## 8 · Known gaps — stated, not hidden

- **Not verified against live services.** Everything above was executed against real Postgres, but there are no Supabase or Stripe credentials on this machine. The signed-upload **2-hour expiry** and the **`x-upsert: false` overwrite refusal** are from the documented API contract and the headers this code sends; both need one confirmation against the live project. In the tests, storage was a stub behaving to that contract.
- **Carry-forward is reported, not applied.** A quarter whose reversals exceed its sales shows `carryForward`, but the next quarter does not automatically deduct it. Accounting must carry it by hand, or it needs a ledger. Flagged for decision.
- **Wholesale, bundles and marketplaces are out of scope.** The base is written for direct retail. Wholesale sells at a different price to a different buyer and needs its own base, or the artist is paid on the wrong number.
- **`order_items.sku` is nullable.** Until collaboration products reliably carry one, the reconciliation will flag those orders.
- **A dispute's reversal is dated when the dispute opened.** If accounting would rather bucket on the date funds were actually withdrawn, that is a one-line change and a decision to make before the first statement.
