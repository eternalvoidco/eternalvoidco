-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — checkout v1 schema
--
-- Three tables:
--   orders          one row per attempted purchase, created before payment
--   order_items     an immutable snapshot of what was bought, at the price paid
--   stripe_events   webhook idempotency ledger
--
-- Writes happen only from the server (service role). RLS is on and there is no
-- policy granting anon or authenticated any write, so the anon key the frontend
-- already uses cannot insert a paid order, move a status or edit a total.
-- Signed-in customers may read their own orders and nothing else; guests read
-- theirs through the server, which requires the order number AND the email.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── enums ───────────────────────────────────────────────────────────────────
do $$ begin
    create type order_status as enum ('pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
    create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

-- ── orders ──────────────────────────────────────────────────────────────────
create table if not exists public.orders (
    id                        uuid primary key default gen_random_uuid(),
    order_number              text not null unique,

    -- null for guests. Never taken from the client; resolved server-side from
    -- the access token.
    user_id                   uuid references auth.users(id) on delete set null,

    customer_email            text not null,
    customer_first_name       text not null,
    customer_last_name        text not null,
    phone                     text,

    shipping_address          jsonb not null,
    billing_address           jsonb,

    shipping_method_id        text,
    shipping_method_label     text,

    -- Minor units, always. Server-calculated; the browser never supplies these.
    currency                  text not null default 'eur',
    subtotal_amount           integer not null check (subtotal_amount >= 0),
    shipping_amount           integer not null default 0 check (shipping_amount >= 0),
    tax_amount                integer not null default 0 check (tax_amount >= 0),
    total_amount              integer not null check (total_amount >= 0),

    status                    order_status not null default 'pending',
    payment_status            payment_status not null default 'pending',

    stripe_payment_intent_id  text unique,

    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    paid_at                   timestamptz,

    constraint orders_total_is_sum
        check (total_amount = subtotal_amount + shipping_amount + tax_amount)
);

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_email_idx   on public.orders (lower(customer_email));
create index if not exists orders_created_idx on public.orders (created_at desc);

-- ── order_items ─────────────────────────────────────────────────────────────
-- Snapshots, deliberately. An order must still read at the price it was bought
-- for after the catalogue moves on, so nothing here is a foreign key into
-- product data.
create table if not exists public.order_items (
    id            uuid primary key default gen_random_uuid(),
    order_id      uuid not null references public.orders(id) on delete cascade,

    variant_id    text not null,
    product_slug  text not null,
    product_name  text not null,
    size          text not null,
    sku           text,
    image_path    text,

    unit_amount   integer not null check (unit_amount >= 0),
    quantity      integer not null check (quantity > 0),
    line_amount   integer not null check (line_amount >= 0),

    created_at    timestamptz not null default now(),

    constraint order_items_line_is_product
        check (line_amount = unit_amount * quantity)
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- ── stripe_events ───────────────────────────────────────────────────────────
-- The primary key is the lock. A duplicate delivery fails the insert, so the
-- handler knows it has already run and skips the side effects.
create table if not exists public.stripe_events (
    event_id     text primary key,
    type         text not null,
    received_at  timestamptz not null default now()
);

-- ── row level security ──────────────────────────────────────────────────────
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.stripe_events enable row level security;

-- Read-only, and only your own. No insert/update/delete policy exists for anon
-- or authenticated, which is what stops a client writing a paid order.
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
    on public.orders for select
    to authenticated
    using (user_id = auth.uid());

drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own"
    on public.order_items for select
    to authenticated
    using (exists (
        select 1 from public.orders o
        where o.id = order_items.order_id and o.user_id = auth.uid()
    ));

-- stripe_events is server-only; no policies at all.

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
    before update on public.orders
    for each row execute function public.touch_updated_at();
