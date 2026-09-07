-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — checkout v1: table privileges
--
-- Follows 20260906120000_orders.sql, which is already applied and is not
-- touched here.
--
-- Production failed with:
--     op=insert orders | http=403 | code=42501
--     message=permission denied for table orders
--
-- That is a PostgreSQL GRANT refusal, raised before row level security is ever
-- consulted. Newer Supabase projects no longer hand every new table in `public`
-- to the built-in roles by default, so the tables the previous migration
-- created were reachable by nobody — including service_role, which the checkout
-- functions authenticate as.
--
-- Two distinct gates, both of which must pass:
--     GRANT  — may this role touch this table at all?   ← what was missing
--     RLS    — which rows may it see or change?         ← was already correct
--
-- RLS stays enabled on all three tables. Nothing below weakens it.
-- ─────────────────────────────────────────────────────────────────────────────

-- A table grant is useless without schema usage; if that is what is missing the
-- error is the same 42501. Both are already the Supabase default, so these are
-- no-ops on a normal project and insurance on one where the defaults changed.
grant usage on schema public to service_role;
grant usage on schema public to authenticated;

-- ── Belt and braces ─────────────────────────────────────────────────────────
-- Some project templates apply blanket default privileges to anon/authenticated
-- for new tables in `public`. RLS would still refuse the write (neither role has
-- an insert, update or delete policy), but a privilege that is never granted
-- cannot be relied on by mistake later. Revoke first, then grant back only the
-- read that is actually wanted.
revoke all on table public.orders        from anon, authenticated;
revoke all on table public.order_items   from anon, authenticated;
revoke all on table public.stripe_events from anon, authenticated;

-- ── service_role: the checkout and webhook functions ────────────────────────
-- These run server-side only, in Vercel functions, holding the secret key. This
-- is the role that writes orders, attaches the payment intent, marks an order
-- paid and records webhook event ids.
grant select, insert, update, delete on table public.orders        to service_role;
grant select, insert, update, delete on table public.order_items   to service_role;
grant select, insert, update, delete on table public.stripe_events to service_role;

-- ── authenticated: read your own orders, nothing else ───────────────────────
-- Matches the orders_select_own / order_items_select_own policies from the
-- previous migration, which scope this to `user_id = auth.uid()`. SELECT only:
-- no insert, update or delete is granted, so a signed-in customer cannot file
-- an order, move a status, edit a total or mark anything paid — the grant is
-- refused before RLS is even reached.
grant select on table public.orders      to authenticated;
grant select on table public.order_items to authenticated;

-- ── anon and stripe_events ──────────────────────────────────────────────────
-- Deliberately no grants. anon gets nothing on any of the three tables, and
-- stripe_events — the webhook idempotency ledger — stays server-only, since a
-- client able to insert an event id could suppress a real payment's side
-- effects. The revokes above are the whole story for both.

-- No sequence grants are needed: both tables use uuid primary keys defaulted
-- from gen_random_uuid(), not identity or serial columns.

-- ── Verifying, after applying ───────────────────────────────────────────────
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('orders', 'order_items', 'stripe_events')
--    order by table_name, grantee, privilege_type;
--
-- Expected: service_role with SELECT/INSERT/UPDATE/DELETE on all three,
-- authenticated with SELECT on orders and order_items only, anon absent.
--
--   select tablename, rowsecurity
--     from pg_tables
--    where schemaname = 'public'
--      and tablename in ('orders', 'order_items', 'stripe_events');
--
-- Expected: rowsecurity = true for all three.
