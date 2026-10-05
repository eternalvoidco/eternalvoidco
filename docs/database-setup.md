# Database setup — fresh Supabase project

For a new **test** project (do the same for production once it has been checked).
Use a project that production does not use: test-mode payments against a database
consume its stock, and its subscriber list is real data.

## 1. Create the project

Supabase dashboard → **New project**. Nothing needs to be installed first: the
migrations only rely on what every Supabase project already has (the `auth.users`
table and the `anon`, `authenticated` and `service_role` roles). They need Postgres
15 or newer, which every current Supabase project runs (Project Settings →
Infrastructure shows the version).

## 2. Run the migrations, in this order

All four live in `supabase/migrations/`. Each must finish without an error before
the next one runs: later files use tables and functions that earlier files create.

| # | File | Creates |
|---|---|---|
| 1 | `20260906120000_orders.sql` | `orders`, `order_items`, `stripe_events`, the order enums, the `touch_updated_at()` trigger function |
| 2 | `20260907090000_orders_grants.sql` | table privileges for those three tables (`service_role` writes; signed-in customers read their own orders) |
| 3 | `20261004120000_inventory.sql` | inventory tables and functions, plus the initial allocation of S 2 · M 16 · L 10 · XL 2 for each design |
| 4 | `20261004130000_newsletter.sql` | `newsletter_subscribers`, the `newsletter_audience` view, and the subscribe/unsubscribe functions |

**Option A — SQL editor:** Supabase → SQL Editor → New query. Paste the whole of
file 1 → **Run**, wait for "Success". Then repeat with files 2, 3 and 4.

**Option B — Supabase CLI** (it applies the files in filename order, which is the
order above):

```sh
supabase link --project-ref <your-test-project-ref>
supabase db push
```

You can run any of the four files again safely: they never reset stock, delete
orders or remove subscribers.

## 3. Check the result

Run these in the SQL editor:

```sql
-- 60 pieces, S–XL only
select variant_id, on_hand, reserved, sold from public.inventory_items order by variant_id;
select sum(on_hand) from public.inventory_items;            -- 60

-- Browsers have no access to stock or subscribers (both queries return 0 rows)
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('inventory_items', 'inventory_reservations', 'inventory_movements',
                      'newsletter_subscribers', 'newsletter_audience')
   and grantee in ('anon', 'authenticated');
select routine_name, grantee
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and (routine_name like 'inventory_%' or routine_name like 'newsletter_%' or routine_name = 'checkout_open_order')
   and grantee in ('anon', 'authenticated', 'PUBLIC');

-- Empty to begin with
select count(*) from public.newsletter_subscribers;
```

## 4. Collect the keys

Supabase → **Project Settings → API**:
- **Project URL** → `SUPABASE_URL`
- **anon / publishable key** → `SUPABASE_ANON_KEY`
- **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never put it in front-end code)

Under **Data API**, `public` must be in the exposed schemas. It is by default.

## 5. Create the admin account

Supabase → **Authentication → Users → Add user**. Enter the email and a password,
and tick **Auto Confirm User**. The dashboard refuses unconfirmed accounts. Put
that email in `VOID_ADMIN_EMAILS`.

## 6. Environment variables for the deployment that uses this project

Set these in Vercel → Settings → Environment Variables, scoped to **Preview** for a
test project:

| Variable | Value |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from step 4 |
| `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` | Stripe **test** keys (`pk_test_…`, `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | from step 7 |
| `VOID_ADMIN_EMAILS` | the email from step 5 |
| `VOID_SITE_URL` | the preview's URL, so unsubscribe links in test emails reach this database |
| `VOID_SHIP_HU_STANDARD` (at least one `VOID_SHIP_*`) | e.g. `990`; checkout needs one delivery rate |
| `RESEND_API_KEY` | optional. Without it, signups are still saved but no welcome email is sent |
| `VOID_RESERVATION_MINUTES` | optional, default 30 |

## 7. Stripe test-mode webhook

Stripe dashboard in **Test mode** → Developers → Webhooks → **Add endpoint**:
- URL: `<deployment URL>/api/stripe-webhook`
- Events: `payment_intent.succeeded`, `payment_intent.processing`,
  `payment_intent.payment_failed`, `payment_intent.canceled`
- Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` and redeploy.

Use a preview URL that stays the same (a branch alias). If Vercel Deployment
Protection is on for previews, Stripe cannot reach the webhook: add a
protection-bypass token for automation, or turn protection off for that preview.

## 8. Smoke test on the deployment

1. `/shop` → Levitate and Endzustand show no stock label (30 each), and the size
   picker offers S, M, L and XL.
2. **Pre-order Access** → sign up → `select * from newsletter_subscribers` shows
   the address as `subscribed`.
3. Open the unsubscribe link in the welcome email → **Confirm unsubscribe** → the
   row is `unsubscribed` and missing from `newsletter_audience`.
4. Buy one piece with test card `4242 4242 4242 4242` → that size's `sold` goes up
   by 1 and `reserved` returns to 0.
5. `/admin/inventory` → sign in as the admin from step 5.
