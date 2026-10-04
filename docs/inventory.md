# Inventory

Stock for **Levitate Tee** (`levitate-tee`) and **Endzustand Tee** (`endzustand-tee`),
tracked per size in Supabase Postgres. The database is the only source of truth;
the browser never holds a stock figure it is trusted on.

| Size | Levitate | Endzustand |
|---|---:|---:|
| S | 2 | 2 |
| M | 16 | 16 |
| L | 10 | 10 |
| XL | 2 | 2 |
| **Total** | **30** | **30** |

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

1. **Apply the migration** `supabase/migrations/20261004120000_inventory.sql`
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
