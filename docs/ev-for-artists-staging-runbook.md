# EV for Artists — staging verification runbook

2026-11-20. The steps that need live Supabase and Stripe credentials, which are not available on
the development machine. Each one states the exact command, the permission it needs, and what a
pass looks like — so the result can be pasted back rather than described.

**Keep `VOID_ARTIST_INTAKE` closed throughout.** Nothing below requires opening it.

---

## 0 · Prerequisites

| | |
|---|---|
| Environment | A Vercel **Preview** deployment, or a staging project. Not production. |
| Supabase | A project whose data may be written to and thrown away. **Not the production project** — step 4 writes a submission and step 1 changes a setting that alters every statement. |
| Stripe | **Test mode.** Every refund and dispute below is a test-mode action. |
| Admin | The operator's address in `VOID_ADMIN_EMAILS`, with a confirmed Supabase account. |
| Secrets | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`, `VOID_ARTIST_IP_SALT`, `CRON_SECRET` |

Apply the migrations first, in order:

```
supabase db push
```

Then confirm the two defaults that must be defaults:

```sql
select vat_basis from public.artist_royalty_settings;          -- expect: unknown
select id, public from storage.buckets where id = 'artist-submissions';  -- expect: public = false
```

A bearer token for the calls below:

```bash
TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  --form-string "x=y" >/dev/null; \
  curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
    -d '{"email":"you@eternalvoid.co","password":"…"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
BASE=https://<your-preview>.vercel.app
```

---

## 1 · The VAT basis  ·  BLOCKING, and nobody has answered it

**This is the one that changes every number.** `api/_catalog.js` says it outright: *"No tax model
exists in this project and product prices carry no stated tax treatment."* `orders.tax_amount` is
always `0`, there is no invoice anywhere in the project, and the storefront never tells a customer
whether a price includes VAT.

So nobody can say today whether `order_items.line_amount` is net of VAT or includes it:

| reading | net merchandise on a €160 tee | 12% royalty |
|---|---|---|
| **exclusive** — €160 carries no VAT | €160.00 | **€19.20** |
| **inclusive** — €160 includes HU 27% | €125.98 | **€15.12** |

€4.08 a tee, and it is the whole VAT rate. Until accounting records an answer, **every period with
eligible sales is blocked** and no payout file is produced.

Accounting records it like this — one call, with a name against it:

```bash
curl -s -X POST "$BASE/api/artist-royalties" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"vatBasis","basis":"exclusive","note":"<why, and which invoice this was checked against>"}'
```

`basis` is `exclusive`, `inclusive`, or `unknown`. If `inclusive`, also load the rates — the rate
follows the customer's country under EU distance selling, and `'*'` is the fallback:

```sql
insert into public.artist_vat_rates (country, rate_bps, effective_from, note)
values ('*', 2700, '2026-01-01', 'HU standard rate'),
       ('DE', 1900, '2026-01-01', 'OSS destination rate');
```

**Pass:** `{"ok":true,"vatBasis":"…"}`, and a subsequent statement shows `grossCharged` and
`grossMerchandise` as two separate figures that differ by exactly the VAT fraction under
`inclusive`, and are equal under `exclusive`.

> **This step needs a real invoice.** The fixture in `tests/royalty-reconciliation/staging.mjs § 1`
> prices both readings against a worked example; it is **not** an approved basis and does not
> pretend to be. One real order's invoice settles it.

---

## 2 · The historical dry run  ·  read-only first

A webhook only ever sees what happens after it is switched on. Every refund and dispute Stripe has
already settled is invisible to it, and a period with no recorded reversals is indistinguishable
from a period whose reversals were never ingested. That is why `payoutReady` now demands a recorded
attestation rather than mere silence.

**Enable the events first** — Stripe → Developers → Webhooks → the existing endpoint:

```
charge.refunded              refund.created       refund.updated
refund.failed                charge.refund.updated
charge.dispute.created       charge.dispute.updated     charge.dispute.closed
charge.dispute.funds_withdrawn    charge.dispute.funds_reinstated
```

(The four `payment_intent.*` events stay as they are.)

### Read-only

Writes nothing. Run it over the whole trading history, not just the quarter being paid.

```bash
curl -s -G "$BASE/api/artist-reversals" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "from=2026-01-01T00:00:00Z" \
  --data-urlencode "to=2027-01-01T00:00:00Z" | tee dryrun.json | head -60
```

**Permissions:** admin bearer (`requireAdmin`), plus the server's `STRIPE_SECRET_KEY` with read
access to `refunds`, `disputes` and `charges`. No write scope is used.

**Expected output:**

```json
{
  "ok": true, "applied": false,
  "period": { "from": "…", "to": "…" },
  "fetchedFromStripe": 0,
  "wouldInsert": 0, "inserted": 0, "reversalTotal": 0,
  "matched": [], "alreadyKnown": [],
  "unmatched": [],
  "withoutPaymentIntent": [],
  "note": "Dry run — nothing was written. Add &apply=1 to record these."
}
```

**Report these four numbers back**, which is what item 3 of the brief asks for:

| | where it comes from |
|---|---|
| date range covered | `period.from` → `period.to` |
| unmatched payments | `unmatched[]` (no order carries that payment intent) and `withoutPaymentIntent[]` (Stripe object with no followable intent) |
| NULL SKUs | `select order_number from orders o join order_items i on i.order_id=o.id where i.sku is null;` |
| unresolved allocations | after apply: `reconciliation.blocking.unallocatedReversals` |
| coverage vs ingestion gap | `select public.order_reversal_coverage_gap('<from>','<to>');` |

### Apply

Only once the unmatched list is understood. This writes the reversals **and the attestation** that
lets a period become payable.

```bash
curl -s -G "$BASE/api/artist-reversals" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "from=2026-01-01T00:00:00Z" \
  --data-urlencode "to=2027-01-01T00:00:00Z" \
  --data-urlencode "apply=1"
```

**Pass:** `"applied": true`, `"coverageAttested": true`, and

```sql
select public.order_reversal_coverage_gap('2026-10-01','2027-01-01');
-- expect: {"covered": true}
```

**Re-running is safe** and must report `inserted: 0` with everything in `alreadyKnown`.

---

## 3 · Intake, end to end, with a disposable submission

Keep the gate closed for all of this.

### 3a · A stranger is refused

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/artist-submission" \
  -H 'Content-Type: application/json' \
  -d '{"name":"X","email":"x@example.com","country":"Hungary","title":"T",
       "description":"D","acceptTerms":true,
       "file":{"name":"a.pdf","type":"application/pdf","size":1024}}'
```

**Pass: `503`.** Repeat with `?intake=preview` on the URL and with
`"preview":true,"isPreview":true` in the body — **`503` every time**. Then confirm nothing landed:

```sql
select count(*) from public.artist_submissions;   -- expect: unchanged
```

### 3b · An administrator rehearses

```bash
STEP1=$(curl -s -X POST "$BASE/api/artist-submission" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Staging Test","email":"staging+artists@eternalvoid.co","country":"Hungary",
       "title":"DISPOSABLE — staging verification","description":"Delete me.",
       "acceptTerms":true,
       "file":{"name":"t.pdf","type":"application/pdf","size":1024}}')
echo "$STEP1"
```

**Pass:** `ok:true`, `pending:true`, a `reference` of the form `EVA-26-XXXXXX`, a `token`, an
`uploadUrl`, and `path` equal to `<YYYY>/<MM>/<reference>.pdf` — **the path is the server's, derived
from the reference it generated.**

### 3c · The upload, and the overwrite refusal

```bash
URL=$(echo "$STEP1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).uploadUrl')
printf '%%PDF-1.4\n' > /tmp/t.pdf

curl -s -o /dev/null -w 'first:  %{http_code}\n' -X PUT "$URL" \
  -H 'Content-Type: application/pdf' -H 'x-upsert: false' --data-binary @/tmp/t.pdf

curl -s -o /dev/null -w 'second: %{http_code}\n' -X PUT "$URL" \
  -H 'Content-Type: application/pdf' -H 'x-upsert: false' --data-binary @/tmp/t.pdf
```

**Pass: `first: 200`, `second: 409`** (`Duplicate`). Record the actual second code — this is the
overwrite behaviour the handoff currently marks as unverified.

### 3d · The file is not publicly readable

```bash
REF=$(echo "$STEP1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).reference')
P=$(echo "$STEP1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).path')

# no credentials at all
curl -s -o /dev/null -w 'public:    %{http_code}\n' "$SUPABASE_URL/storage/v1/object/public/artist-submissions/$P"
# anon key only
curl -s -o /dev/null -w 'anon:      %{http_code}\n' \
  -H "apikey: $SUPABASE_ANON_KEY" "$SUPABASE_URL/storage/v1/object/artist-submissions/$P"
# a signed-in non-admin, if one exists
curl -s -o /dev/null -w 'non-admin: %{http_code}\n' \
  -H "Authorization: Bearer $NON_ADMIN_TOKEN" "$BASE/api/artist-submissions?file=$REF"
```

**Pass: `400`/`404` for public, `400`/`401`/`403` for anon, `403` for the non-admin. Any `200` is a
failure and must stop the verification.**

### 3e · Finalise, and the reviewer's link

```bash
TOK=$(echo "$STEP1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -X POST "$BASE/api/artist-submission" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"confirm\":\"$REF\",\"token\":\"$TOK\"}"
```

**Pass:** `ok:true`. Run it a second time — **`ok:true, alreadyConfirmed:true`**, and still one row.

Then confirm the rehearsal is quarantined and the reviewer's link is short-lived:

```sql
select reference, status, file_state, is_preview from public.artist_submissions
 where reference = '<REF>';          -- expect: received / stored / is_preview = true
select jsonb_array_length(public.artist_submissions_list(null,100,0) -> 'rows');
-- expect: the rehearsal is NOT in it
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/artist-submissions?file=$REF"
```

**Pass:** a `url` and `expiresIn: 300`.

### 3f · Token expiry  ·  currently PENDING

The signed **upload** token's lifetime is Supabase's default and the sign endpoint takes no
`expiresIn`, so it cannot be set from this code. It is documented as 2 hours from the API contract
and **has never been measured**.

To settle it, mint an upload URL and leave it:

```bash
# t = 0
curl -s -X POST "$BASE/api/artist-submission" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Expiry probe","email":"staging+expiry@eternalvoid.co","country":"Hungary",
       "title":"DISPOSABLE — token expiry","description":"Delete me.","acceptTerms":true,
       "file":{"name":"t.pdf","type":"application/pdf","size":1024}}' > expiry.json

# t = 2h05m — the same PUT, unchanged
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$(node -pe 'JSON.parse(require("fs").readFileSync("expiry.json")).uploadUrl')" \
  -H 'Content-Type: application/pdf' -H 'x-upsert: false' --data-binary @/tmp/t.pdf
```

**Pass: a `400` with an expired-token error.** A `200` means the token outlives two hours and the
handoff's figure is wrong. Either result closes the question; record which.

The draft left behind by the probe is swept within 24 hours, with its file, by
`/api/artist-drafts-sweep`.

### 3g · Clean up

```sql
-- the rehearsals, and only the rehearsals
select reference, title from public.artist_submissions where is_preview;
delete from public.artist_submissions where is_preview;
```

Then remove their objects from the `artist-submissions` bucket, and re-run 3d's public check
against one of the deleted paths to confirm a `404`.

---

## 4 · The draft sweep

```bash
curl -s -X POST "$BASE/api/artist-drafts-sweep" -H "Authorization: Bearer $CRON_SECRET_AS_BEARER"
```

**Pass:** `ok:true` with `draftsRemoved`, `filesRemoved` equal, and `strandedFiles: []`. A non-empty
`strandedFiles` names objects whose row is gone — they must be deleted by hand, because no later
sweep will find them.

Without `CRON_SECRET` set the scheduled sweep **cannot authenticate** and the retention promise in
the Privacy Notice is not being kept. The endpoint logs that loudly rather than failing quietly.

---

## 5 · What to paste back

1. The VAT basis decision, and the invoice it was checked against.
2. `dryrun.json` — date range, `unmatched`, `withoutPaymentIntent`, totals.
3. The NULL-SKU query result.
4. The HTTP codes from 3a, 3c, 3d, 3e.
5. The 3f expiry code, and at what elapsed time.
6. `select public.order_reversal_coverage_gap(…)` for each quarter to be paid.
