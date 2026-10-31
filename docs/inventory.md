# Inventory

Stock for **Levitate Tee** (`levitate-tee`) and **Endzustand Tee** (`endzustand-tee`),
tracked per size in Supabase Postgres. The database is the only source of truth;
the browser never holds a stock figure it is trusted on.

Production allocation (target totals per size):

| Size | Levitate | Endzustand |
|---|---:|---:|
| S | 4 | 4 |
| M | 25 | 25 |
| L | 17 | 17 |
| XL | 4 | 4 |
| **Total** | **50** | **50** |

100 pieces in all. A size's allocation is the sum of its `initial` and
`allocation` movements, shown as *Allocated* on the dashboard. Raising a
production run is a migration that moves the allocation to a target and adds
only the difference to on hand (see `20261031120000_production_allocation_50.sql`),
so sales, holds, returns and adjustments are kept, and rerunning it adds
nothing.

Both designs are cut in S–XL only. XS is not offered on the storefront, and an
XS line for either (an old bag, a direct request) is refused at checkout.

## How it works

- **available = on hand − reserved.** Customers only ever see `available`.
- **Hold at checkout start.** `POST /api/checkout/create` writes the order, its lines
  and the stock hold in one transaction (`checkout_open_order`) under row locks, so
  two customers racing for the last piece cannot both get it. Adding to the bag
  holds nothing.
- **Sale on verified payment only.** The Stripe webhook re-reads the PaymentIntent
  from Stripe and acts on its current state. `inventory_confirm_payment` turns the
  hold into a sale exactly once (order row lock), deducting units, not orders.
  Duplicate, retried and out-of-order events are no-ops.
- **Release only when payment can no longer happen.** A PaymentIntent never expires
  on its own, so a hold past its deadline (`VOID_RESERVATION_MINUTES`, default 30) is
  released only after Stripe confirms the intent is cancelled. If the cancel is
  refused because the payment succeeded or is processing, it is confirmed or held
  instead. Expired holds are swept before every checkout, whenever the storefront
  reads stock, and by a daily Vercel cron.
- **Checkout creation failure** releases the hold before responding; no client
  secret was returned, so nothing can be charged.
- **Refunds never restock.** Use *Restock an approved return* on the dashboard once
  the piece is physically back and approved; it is tied to the order and capped at
  what that order bought.
- **Audit trail.** Every change to on-hand stock is a row in `inventory_movements`
  (append-only by grant and trigger), with the admin's email for manual changes.

## Setup

Step-by-step for a new project: [database-setup.md](database-setup.md).

1. **Apply the migrations** `supabase/migrations/20261004120000_inventory.sql`
   and then `20261031120000_production_allocation_50.sql`
   (Supabase → SQL editor, or `supabase db push`) after the two orders migrations. It is safe to run more than once:
   it never resets existing stock. On first run it subtracts units already sold in
   orders marked `paid`/`refunded`, and records that as a *Reconciliation* row.
   If test-mode orders were ever marked paid in this database, they are counted
   too — correct with an Adjust on the dashboard if so.
2. **Stripe webhook** (Developers → Webhooks → endpoint
   `https://eternalvoid.co/api/stripe-webhook`) must send:
   `payment_intent.succeeded`, `payment_intent.processing`,
   `payment_intent.payment_failed`, `payment_intent.canceled`.
   Its signing secret goes in `STRIPE_WEBHOOK_SECRET`.
3. **Environment variables** (Vercel → Settings → Environment Variables):
   - `VOID_ADMIN_EMAILS` — who may open `/admin/inventory` and change stock.
   - `VOID_RESERVATION_MINUTES` — optional, default 30.
   - Existing: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
     `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
4. Each admin signs in at `/admin/inventory` with a confirmed Supabase account whose
   email is in `VOID_ADMIN_EMAILS`.

Keep test keys and live keys pointed at separate databases: a test-mode payment
against the production database would consume production stock.

## Raising the production run to 50 per design (production runbook)

`20261031120000_production_allocation_50.sql` moves an existing store from
S 2 · M 16 · L 10 · XL 2 to S 4 · M 25 · L 17 · XL 4 per design. Apply it in
Supabase → SQL Editor (paste the whole file → **Run**) or with `supabase db push`.

1. **Preflight** — check whether anyone already added the new pieces by hand
   (an Adjust or Stocktake for the delivery). The migration adds the
   allocation difference on top of whatever is on hand, so a manual top-up
   made for the same delivery would be counted twice:

   ```sql
   select variant_id, kind, delta, reason, actor_email, created_at
     from inventory_movements
    where kind in ('adjustment', 'stocktake')
    order by created_at;
   ```

   If a row there already covers the extra 20 pieces per design, reverse it
   with an Adjust on the dashboard first, or correct after with a stocktake.
2. **Apply** the file. Its notices list each size: old → new allocation, the
   change applied, and the resulting on hand / reserved / available.
3. **Verify** — every size must show the target allocation:

   ```sql
   select i.variant_id,
          (select sum(m.delta) from inventory_movements m
            where m.variant_id = i.variant_id and m.kind in ('initial', 'allocation')) as allocated,
          i.on_hand, i.reserved, i.on_hand - i.reserved as available, i.sold, i.returned
     from inventory_items i
    where i.product_slug in ('levitate-tee', 'endzustand-tee')
    order by i.variant_id;
   ```

   On `/admin/inventory` each design's card shows **Production 50**, and the
   *Allocated* column reads 4 / 25 / 17 / 4.

Running the file again changes nothing. It never touches orders, reservations,
`sold`, `returned` or earlier movements, and it does not change the 30-minute
hold, payment confirmation, the expiry sweep or `VOID_SALES_OPEN`.

## Endpoints

| Route | Who | What |
|---|---|---|
| `GET /api/inventory` | public | availability per design and size (ETag, 3 s edge cache) |
| `GET /api/inventory?sweep=1` | public / cron | end checkouts whose holds expired |
| `GET /api/inventory?scope=admin` | admin | full counts, holds, attention list, audit trail |
| `POST /api/inventory` `{action:'adjust'}` | admin | adjust / stocktake / restock a return |
| `POST /api/checkout/order` `{action:'release', clientSecret}` | the checkout's own browser | end that checkout now |
| `GET /api/inventory?scope=admin&export=audience` | admin | CSV of subscribed newsletter addresses |

## Newsletter

Every signup saves to `newsletter_subscribers` before the welcome email is sent,
one row per address:
- the pre-order popup (`/api/preorder`, with country);
- the footer form (`/api/newsletter`);
- the "Get Drop Updates" scene inside the product view, also opened by "Get
  notified for the next drop" on a sold-out piece (`/api/newsletter`, recording
  the piece being viewed under `interests`).

- **Send drop notifications to `newsletter_audience`** (or the dashboard's CSV
  export). It lists subscribed addresses only, each with its own unsubscribe link.
- **Unsubscribes stick.** The email link (`/unsubscribe.html?token=…`, confirmed
  with a button), RFC 8058 one-click from the mail client, and the unsubscribe
  page form all set `status = 'unsubscribed'`. Only a new signup through a form
  sets it back. An address unsubscribed without ever signing up is kept as
  suppressed.
- Signup is single opt-in, as before. A repeat signup does not re-send the
  welcome within a day.
- Every email carries `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
  When you send a drop notification yourself, include each row's
  `unsubscribe_url` in the email and those two headers.

## Tests

See `tests/inventory/README.md`.

## Publishing before the drop

Set `VOID_SALES_OPEN=false` in the Vercel Production environment and deploy.
The public storefront shows Coming Soon, while newsletter signup and the admin
inventory dashboard stay available. Both checkout endpoints reject requests
before database writes, reservations or Stripe calls. Production defaults closed
if this variable is absent; preview/development allow sandbox testing unless
explicitly closed. Public stock responses include `salesOpen`.

When the physical pieces arrive: reconcile old test orders and count actual
stock, configure live Stripe credentials and the production webhook, then set
`VOID_SALES_OPEN=true` and redeploy. Recheck stock and payments before announcing
the drop. Changing a Vercel variable takes effect on a new deployment.
