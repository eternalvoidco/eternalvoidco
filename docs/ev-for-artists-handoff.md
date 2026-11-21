# EV for Artists — owner handoff

2026-11-20 · Third pass: staging verification, VAT basis, coverage attestation, carried balances.

## Status

| | state | what it is waiting on |
|---|---|---|
| **Staging verification** | **PART DONE** | Everything that can be proven without live credentials is proven, against real Postgres. Four steps need a staging Supabase and Stripe **test** mode and have not been run: the VAT basis against a real invoice, the historical dry run, the storage/overwrite/public-read checks, and the upload-token expiry. Commands for all four: `docs/ev-for-artists-staging-runbook.md`. |
| **Public intake** | **CLOSED** | `VOID_ARTIST_INTAKE` is closed and the server refuses every unauthenticated request. Opening takes two switches in one deploy: `VOID_ARTIST_INTAKE=open` on the server and `window.VOID_ARTISTS_INTAKE_OPEN = true` in the head of `for-artists/index.html` — the page shows the notification signup until the second is flipped. Opening needs counsel on three documents, the owner on the rate, and `VOID_ARTIST_IP_SALT` + `CRON_SECRET` set. |
| **Royalty payouts** | **BLOCKED** | Two hard blocks, neither of which is a bug: **nobody has recorded whether charged amounts include VAT**, and **no dry run has established that any period's refund history was read back from Stripe**. Either one alone stops a payout file being produced. |

**12% of net profit from sales of the covered products (changed from net product sales on
2026-11-21; complete tech pack required), quarterly statements, payment within 30 days of quarter end remain
PROPOSED and unapproved.** Net profit is not yet defined, and the statement engine still computes on
net product sales — see the note at the top of docs/royalty-model.md. They are marked that way on the public page in all four languages.

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

`api/_artist-submission.js` looked a draft up through `artist_submissions_list` to read its
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
landed. Drafts never appear in the reviewer's queue. `api/_artist-drafts-sweep.js` removes drafts
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
| ~~`unique_line_match`~~ | ~~reversal == the line total of exactly one line~~ | **WITHDRAWN in the third pass — §7.2.** It could not tell a full refund of a cheap line from a partial refund of a dear one, and the two pay different artists |
| `metadata` | the refund itself names the lines and amounts | those lines, after the database re-validates every one against the order |
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

## 3 · Test results · earlier passes

> Two results below were **superseded** by the third pass and are marked where they appear. The
> current results are in §8.

Run against **real PostgreSQL** (PGlite/WASM) with the project's own migration files applied
verbatim. Only the three Supabase roles, `auth.uid()`, and the `pgcrypto` extension line were
stubbed — `gen_random_uuid()` is core Postgres, so dropping that line changes nothing under test.

**Executing the SQL found a real bug immediately:** `overlaps` is a Postgres operator keyword and
cannot name a CTE. It would have failed on apply.

### Royalty — 36/36

| # | case | expected | actual |
|---|---|---|---|
| 1 | €160 merchandise + €12 shipping + €38 tax | base €160.00, due **€19.20** | **conditional — §7.1.** True only under a VAT-*exclusive* basis. Nobody has yet recorded which basis applies, so the period now blocks |
| 2 | two SKUs, 12% and 8% | **€20.00** (old code: €24.00) | ✓ |
| 3 | full-order refund delivered 3× | one row, due €0.00 | ✓ |
| 4 | two partial refunds (€50, €30) on €200 | base €120.00, due **€14.40** | ✓ |
| 5 | mixed cart: €90 refund matches one line; €70 matches nothing | ~~€90 attributed~~; €70 unallocated, period **blocked** | **superseded — §7.2.** The €90 is no longer attributed; it is a guess between two readings that pay different people, and now goes to the worklist |
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

## 4b · One function, five routes

The five EV for Artists endpoints are **one** Vercel function. The Hobby plan allows twelve, and
adding them as five separate files took the project to sixteen — so every deployment from
`656a3b1` onward failed to build, and `/for-artists` was 404 on the live site while the homepage
served from an older deployment.

`api/artists.js` dispatches to five `_`-prefixed modules, which Vercel does not treat as routes.
`vercel.json` rewrites each public path to it, carrying `_ev_artist_route`. The URLs are
unchanged: nothing that calls them had to move, and the dispatcher handles both shapes Vercel may
present (the original path, or the rewrite destination).

**The project is now at exactly twelve of twelve.** The next new endpoint breaks the build again.
Fold it into an existing function, or move to a plan with a higher limit.

## 5 · Before intake can open

1. Apply the **four** migrations in order.
2. Set `VOID_ARTIST_IP_SALT` (rate limiting is a no-op without it) and `CRON_SECRET` (the draft sweep cannot authenticate without it).
3. Confirm the `artist-submissions` bucket is **private** after apply.
4. Counsel signs off all three drafts; remove the draft banners and the `noindex`.
5. Owner approves the rate and terms.
6. Then, and only then, set `VOID_ARTIST_INTAKE=open`.

## 6 · Before any royalty is paid

1. **Record the VAT basis.** The single blocking decision — see §7.1. Until accounting sets it,
   every period with eligible sales is blocked and no payout file is produced.
2. Enable the refund and dispute events on the Stripe webhook endpoint (the ten listed above).
3. Run the historical dry run over all trading history; resolve every unmatched payment, then
   `&apply=1` — **which is also what attests the coverage.** A period whose window has never been
   attested cannot be paid, however clean it looks.
4. **Populate `order_items.sku` for collaboration products** — the column is nullable, and a null SKU silently earns nothing.
5. Write one `artist_collaborations` row per signed SKU, with the rate the agreement says.
6. Run the quarter and read `payoutReady`. If it is not `true`, nothing is paid.
7. Close the previous quarter's carried balances with `{"action":"raiseCarry"}`, and mark this
   one's as spent with `{"action":"consumeCarry"}` once the payment is made.
8. Accounting approves and executes. The code does not pay.

Step-by-step commands for all of this: `docs/ev-for-artists-staging-runbook.md`.

---

## 7 · This pass: what changed, and why

### 9.1 · The VAT basis now blocks  ·  the most consequential finding

`api/_catalog.js` says it in its own comment: *"No tax model exists in this project and product
prices carry no stated tax treatment."* `orders.tax_amount` is always `0`, no invoice exists
anywhere in the project, and the storefront never tells a customer whether a price includes VAT.

So nobody can say whether `order_items.line_amount` is net of VAT or includes it — and the answer
moves every royalty by the whole VAT rate:

| reading of a €160 tee | net merchandise | 12% royalty |
|---|---|---|
| **exclusive** | €160.00 | **€19.20** |
| **inclusive**, HU 27% | €125.98 | **€15.12** |

Paying the first when the second is true pays the artist a share of tax remitted to the state.
The previous export silently assumed exclusive. **It now refuses:** `artist_royalty_settings.vat_basis`
starts at `unknown`, and every period carrying eligible sales is blocked until accounting records
an answer with a name against it. An assumption nobody made on purpose is not a basis.

Both figures are now carried separately on every statement and in the CSV — `grossCharged` and
`grossMerchandise` — so the decision is visible rather than folded into one number.

A **non-EUR order** in a statement that declares EUR also blocks now. All orders are EUR today
(`CURRENCY = 'eur'`), so this is a tripwire rather than a live condition.

### 9.2 · `unique_line_match` is withdrawn

It allocated a reversal to the one line whose total equalled it. On a mixed cart that is a guess
wearing a rule's clothes. The test the brief asked for makes it concrete: a cart of a **€160
collaboration piece** and a **€90 house piece**, with a **€90 refund**. Two readings, identical in
the amounts, paying different people:

- a full refund of the €90 house piece → the artist loses nothing
- a partial refund of the €160 collaboration piece → the artist's base drops by €90

Stripe holds no item-level evidence for this integration, so there is no third fact to break the
tie. It now goes to the manual worklist, and the test asserts that it does.

What replaced it is a **`metadata` rule** that accepts *genuine* item-level evidence: a refund
carrying `metadata.ev_lines` of the shape `[{"sku":"EV-A","amount":9000}]`. Only refunds ETERNAL
VOID issues itself can carry that, and the database re-validates every line against the order
before believing a penny of it. Evidence that overstates a line is refused and the reversal goes to
the worklist with its reason recorded.

### 9.3 · A status can no longer regress

The existing guard refused a delivery whose source timestamp was older than what had been applied.
It did not cover the tie: two handlers reading the same object moments apart can carry the same
event timestamp, and the slower one then overwrote the faster one's newer status.

`order_reversal_rank()` gives the status a direction — `pending(0) < failed/canceled(1) <
succeeded(2) < reinstated(3)` — and on a tied timestamp a regression is refused. A refund that has
succeeded cannot become pending again because a slow read finished last. Forward movement on a tie
is still allowed.

### 9.4 · Payout readiness now needs positive evidence

A period with no recorded reversals used to look clean. It is indistinguishable from a period whose
reversals were never ingested — and a webhook only ever sees what happens after it is switched on.

`order_reversal_coverage` records that a window's refunds and disputes were actually read back from
Stripe, written by the historical dry run when it is applied. `order_reversal_coverage_gap()` walks
the attested windows and reports the first gap. **A period not fully covered cannot be paid**,
and the gap is named with its start and end. A period with no eligible sales needs no coverage —
there is nothing a missing reversal could reduce.

### 9.5 · A carried balance is a ledger entry

Carry-forward was reported and then forgotten. `artist_royalty_adjustments` now holds it, with a
unique key on `(artist, sku, kind, originating period)` — so the database itself refuses to raise
the same carry twice, however many times a statement is re-run.

The full cycle is tested: **Q4 pays €24.00 → Q1 refunds it with no sales to absorb it, raising a
€200.00 carry → Q2 sells €300.00 and pays 12% of €100.00, not of €300.00.** Raising twice raises
nothing; consuming twice consumes nothing; and once consumed, a second look at Q2 no longer deducts
it.

### 9.6 · Dispute dating  ·  PENDING ACCOUNTING

A dispute moves money twice, on two different dates. Both are now recorded —
`funds_withdrawn_at` and `funds_reinstated_at` — alongside `refunded_at`, which is what the
statement currently buckets on.

**Today:** a chargeback is bucketed on the date the dispute opened, which is when the funds left.
A reinstatement therefore **restates the original quarter** rather than landing in the quarter it
occurred.

**The alternative:** bucket the reinstatement in the quarter it happened, leaving the closed
quarter alone.

Both moments are stored either way, so switching the answer later is a query change rather than a
re-ingestion from Stripe. **Accounting must choose**, and it matters most for a dispute opened in
one quarter and won in the next.

---

## 8 · Test results · this pass

All four suites run the project's own migration files and the real `artist-submission.js` handler
against a real PostgreSQL (PGlite). `npm install` once in `tests/royalty-reconciliation/`.

| suite | result | covers |
|---|---|---|
| `scenarios.mjs` | **36/36** | the royalty arithmetic, refunds, disputes, out-of-order delivery, quarter boundaries |
| `backfill.mjs` | **8/8** | the historical dry run, unmatched payments, idempotent apply |
| `intake.mjs` | **35/35** | the closed gate, admin rehearsal, path scoping, type/size at confirmation, sweep |
| `staging.mjs` | **34/34** | **new this pass** — the four below |

`staging.mjs` in detail:

- **§1 the invoice fixture.** Unknown basis blocks; `exclusive` gives €19.20; `inclusive` at 27%
  gives €15.12; shipping never enters the base; an inclusive basis with no rate for the destination
  blocks that order. **The fixture is not an approved basis** — it prices both readings so the
  decision can be made against real numbers.
- **§1b** a non-EUR order blocks.
- **§2** item-level evidence allocates to the line the evidence names, *not* the line whose amount
  matches; evidence that overstates a line is refused.
- **§2b** the concurrency race: an older read is refused on its timestamp; on a **tied** timestamp
  the status still cannot regress; the persisted state stays `succeeded`; a genuine advance on a
  tie is accepted.
- **§3** an unattested period is **not** clean; partial coverage is reported as the gap it is, with
  its start date; two adjoining attestations close it.
- **§4** the Q4 → Q1 → Q2 carry cycle, raised once and consumed once.

Two cases in `scenarios.mjs` were rewritten rather than fixed, because the contract changed on
purpose: the €90 mixed-cart refund that `unique_line_match` used to claim now asserts that it is
**not** guessed, and the unattributed total rises to €160 accordingly.

### What is still not verified

Four things need live credentials, which this machine has none of — no `.env`, no Supabase or
Stripe keys, no Vercel CLI, no staging host. Each has an exact command in
`docs/ev-for-artists-staging-runbook.md`:

| | why it cannot be done here |
|---|---|
| the VAT basis against a **real invoice** | no invoice exists in the project, and one real order settles it |
| the **historical dry run** | needs `STRIPE_SECRET_KEY` with read access to refunds, disputes and charges |
| **overwrite refusal** and **not-publicly-readable** | needs a live Supabase Storage bucket |
| **upload-token expiry** | 2 hours is the documented default and **has never been measured**. Runbook §3f is a two-command probe that settles it either way |

---

## 9 · Exactly what is needed, from whom

### From the owner
- [ ] **12%** of net profit from sales of the covered products — still proposed; **define net profit** (costs deducted, allocation, evidence) and update the statement engine
- [ ] Whether additional development work after selection is paid, and how (Agreement §11 still promises a fee for a tech pack, which is now the royalty condition)
- [ ] **Quarterly** statements, **30 days** after quarter end — still proposed
- [ ] Term, territory, release deadline, sell-off window *(Agreement §4, §5, §6.4, §13.3)*
- [ ] Minimum payment threshold *(§9.3)*
- [ ] Whether exclusivity is ever offered, and at what price *(Schedule 2)*
- [ ] A current **`cégkivonat`** (company registry extract) — closes the registered name, company
      number, tax number, seat and signing representative in one pass

### From accounting
- [ ] **The VAT basis.** The single blocking decision. Which reading is right, checked against one
      real invoice, and the destination rates if `inclusive`
- [ ] **Dispute dating** — restate the original quarter, or land the reinstatement where it happened
- [ ] **Carry-forward** — confirm the Q4/Q1/Q2 behaviour as tested is what they want
- [ ] Invoicing direction — self-billing or artist invoice
- [ ] EU and non-EU VAT treatment; withholding by artist jurisdiction
- [ ] Currency conversion method and date, should anything stop being EUR
- [ ] That the quarterly statement format matches what `artist_royalty_statement()` produces

### From Hungarian counsel — three separate documents
1. `/legal/ev-for-artists-submission-terms` — public, `noindex` while draft, 7 open items in the page
2. `/legal/ev-for-artists-privacy-notice` — public, `noindex` while draft, 8 open items in the page
3. `docs/legal/ev-for-artists-collaboration-agreement.DRAFT.md` — **private, never deployed**

Principal questions: licence form and the written-form requirement under the Hungarian Copyright
Act (1999. évi LXXVI.), moral rights, design registration, indemnity cap and mutuality, venue,
e-signature validity, and whether a Hungarian-language version is required and which language
governs.
