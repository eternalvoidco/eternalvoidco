-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — inventory
--
-- Follows 20260906120000_orders.sql and 20260907090000_orders_grants.sql,
-- which are already applied and are not touched here.
--
-- Three tables:
--   inventory_items         one row per variant (`<product-slug>:<size>`)
--   inventory_reservations  units held for a checkout that has not been paid
--   inventory_movements     append-only audit trail of every on-hand change
--
-- Vocabulary, used the same way in SQL, in the API and on the dashboard:
--   on_hand    physical units not yet sold (includes units held in checkout)
--   reserved   units held by active checkouts; never a sale
--   available  on_hand - reserved; the only figure a customer is shown
--   sold       units converted by a verified payment (gross)
--   returned   units physically returned and explicitly restocked by an admin
--
-- Every write goes through the functions below, each of which runs in a single
-- transaction with row locks, so two checkouts racing for the last piece are
-- serialised by Postgres and stock can never go negative (the CHECK
-- constraints are the last line of defence underneath that).
--
-- Rerunnable: tables and types are created only if missing, functions are
-- replaced in place, and the initial allocation inserts only rows that do not
-- exist yet. Applying this file twice never resets stock or overwrites sales.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── orders: two new columns ─────────────────────────────────────────────────
-- inventory_status is null for an ordinary order. It is set only when a paid
-- order needs a human: 'shortfall' (paid for more units than could be
-- allocated) or 'amount_mismatch' (Stripe charged a different total).
alter table public.orders add column if not exists inventory_status text;
-- Whether the attached PaymentIntent is live or test mode, as Stripe reports it.
alter table public.orders add column if not exists livemode boolean;

do $$ begin
    create type inventory_reservation_status as enum ('active', 'committed', 'released');
exception when duplicate_object then null; end $$;

-- ── inventory_items ─────────────────────────────────────────────────────────
create table if not exists public.inventory_items (
    variant_id    text primary key,
    product_slug  text not null,
    size          text not null,

    on_hand       integer not null default 0,
    reserved      integer not null default 0,
    sold          integer not null default 0,
    returned      integer not null default 0,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint inventory_items_variant_shape    check (variant_id = product_slug || ':' || size),
    constraint inventory_items_on_hand_nonneg   check (on_hand >= 0),
    constraint inventory_items_reserved_nonneg  check (reserved >= 0),
    constraint inventory_items_reserved_covered check (reserved <= on_hand),
    constraint inventory_items_sold_nonneg      check (sold >= 0),
    constraint inventory_items_returned_range   check (returned >= 0 and returned <= sold)
);

-- ── inventory_reservations ──────────────────────────────────────────────────
-- expires_at null means "held without a deadline": a payment is processing at
-- the bank, or the order is waiting for review. Such a hold is never swept.
create table if not exists public.inventory_reservations (
    id              uuid primary key default gen_random_uuid(),
    -- restrict, not cascade: deleting an order must not silently drop a hold
    -- and leave inventory_items.reserved inflated.
    order_id        uuid not null references public.orders(id) on delete restrict,
    variant_id      text not null references public.inventory_items(variant_id),
    quantity        integer not null check (quantity > 0),
    status          inventory_reservation_status not null default 'active',
    expires_at      timestamptz,
    release_reason  text,
    created_at      timestamptz not null default now(),
    settled_at      timestamptz,

    constraint inventory_reservations_one_per_variant unique (order_id, variant_id)
);

create index if not exists inventory_reservations_active_idx
    on public.inventory_reservations (expires_at)
    where status = 'active';

-- ── inventory_movements ─────────────────────────────────────────────────────
create table if not exists public.inventory_movements (
    id              bigint generated always as identity primary key,
    variant_id      text not null references public.inventory_items(variant_id),
    kind            text not null check (kind in (
                        'initial', 'reconciliation', 'adjustment', 'stocktake',
                        'return_restock', 'sale', 'sale_shortfall')),
    delta           integer not null,          -- change to on_hand
    on_hand_after   integer not null,
    reserved_after  integer not null,
    order_id        uuid references public.orders(id),
    reason          text,
    actor_id        uuid,
    actor_email     text,
    created_at      timestamptz not null default now()
);

create index if not exists inventory_movements_variant_idx on public.inventory_movements (variant_id, created_at desc);
create index if not exists inventory_movements_order_idx   on public.inventory_movements (order_id) where order_id is not null;

create or replace function public.inventory_movements_append_only()
returns trigger language plpgsql as $$
begin
    raise exception 'inventory_movements is append-only';
end $$;

drop trigger if exists inventory_movements_append_only on public.inventory_movements;
create trigger inventory_movements_append_only
    before update or delete on public.inventory_movements
    for each row execute function public.inventory_movements_append_only();

-- ── Initial allocation ──────────────────────────────────────────────────────
-- Levitate and Endzustand: S 2 · M 16 · L 10 · XL 2 = 30 each, 60 in total.
-- Both designs are cut in S–XL only.
--
-- Reconciled first: units already sold through a paid (or since refunded)
-- order are subtracted, so the shop never offers a piece that has already
-- left. Rows that already exist are left exactly as they are.
with allocation (product_slug, size, initial) as (
    values
        ('levitate-tee',   'S', 2), ('levitate-tee',   'M', 16),
        ('levitate-tee',   'L', 10), ('levitate-tee',   'XL', 2),
        ('endzustand-tee', 'S', 2), ('endzustand-tee', 'M', 16),
        ('endzustand-tee', 'L', 10), ('endzustand-tee', 'XL', 2)
),
paid as (
    select oi.variant_id, sum(oi.quantity)::int as units
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.payment_status in ('paid', 'refunded')
     group by oi.variant_id
),
inserted as (
    insert into public.inventory_items (variant_id, product_slug, size, on_hand, sold)
    select a.product_slug || ':' || a.size,
           a.product_slug,
           a.size,
           greatest(a.initial - coalesce(p.units, 0), 0),
           coalesce(p.units, 0)
      from allocation a
      left join paid p on p.variant_id = a.product_slug || ':' || a.size
    on conflict (variant_id) do nothing
    returning variant_id, on_hand, sold
)
insert into public.inventory_movements (variant_id, kind, delta, on_hand_after, reserved_after, reason)
select i.variant_id, 'initial', a.initial, a.initial, 0, 'Initial allocation'
  from inserted i
  join allocation a on a.product_slug || ':' || a.size = i.variant_id
union all
select i.variant_id, 'reconciliation', i.on_hand - a.initial, i.on_hand, 0,
       'Reconciled against ' || i.sold || ' unit(s) in orders already paid before inventory tracking'
       || case when i.sold > a.initial
               then ' — EXCEEDS the allocation by ' || (i.sold - a.initial) || '; review'
               else '' end
  from inserted i
  join allocation a on a.product_slug || ':' || a.size = i.variant_id
 where i.sold > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Functions. All are SECURITY INVOKER and callable only by service_role (see
-- the grants at the end), so even a leaked EXECUTE would still hit the table
-- grants, which anon and authenticated do not have.
--
-- Lock order, everywhere: the order row first, then reservations, then
-- inventory rows sorted by variant_id. Nothing acquires them in another order,
-- so concurrent calls serialise instead of deadlocking.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Open an order and hold its stock, atomically ────────────────────────────
-- The order, its lines and the reservation are one transaction: either all of
-- it exists or none of it does, so a failure can never strand a hold.
create or replace function public.checkout_open_order(p_order jsonb, p_items jsonb, p_ttl_seconds integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_need     record;
    v_item     public.inventory_items%rowtype;
    v_issues   jsonb := '[]'::jsonb;
    v_order    public.orders%rowtype;
    v_expires  timestamptz := now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 1800), 86400)));
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        return jsonb_build_object('ok', false, 'error', 'empty_cart', 'issues', '[]'::jsonb);
    end if;

    -- Demand is summed per variant, so the same size sent as two lines cannot
    -- slip past a per-line check.
    for v_need in
        select x.variant_id, sum(x.quantity)::int as qty
          from jsonb_to_recordset(p_items) as x(variant_id text, quantity int)
         group by x.variant_id
         order by x.variant_id
    loop
        select * into v_item from public.inventory_items where variant_id = v_need.variant_id for update;
        if not found then
            v_issues := v_issues || jsonb_build_object('variantId', v_need.variant_id, 'reason', 'not_tracked',
                                                       'requested', v_need.qty, 'available', 0, 'held', false);
        elsif v_need.qty < 1 or v_item.on_hand - v_item.reserved < v_need.qty then
            v_issues := v_issues || jsonb_build_object('variantId', v_need.variant_id, 'reason', 'insufficient_stock',
                                                       'requested', v_need.qty,
                                                       'available', v_item.on_hand - v_item.reserved,
                                                       'held', v_item.reserved > 0);
        end if;
    end loop;

    if jsonb_array_length(v_issues) > 0 then
        return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'issues', v_issues);
    end if;

    insert into public.orders (
        order_number, user_id, customer_email, customer_first_name, customer_last_name, phone,
        shipping_address, billing_address, shipping_method_id, shipping_method_label, currency,
        subtotal_amount, shipping_amount, tax_amount, total_amount
    ) values (
        p_order->>'order_number',
        nullif(p_order->>'user_id', '')::uuid,
        p_order->>'customer_email',
        p_order->>'customer_first_name',
        p_order->>'customer_last_name',
        nullif(p_order->>'phone', ''),
        p_order->'shipping_address',
        case when jsonb_typeof(p_order->'billing_address') = 'object' then p_order->'billing_address' end,
        p_order->>'shipping_method_id',
        p_order->>'shipping_method_label',
        coalesce(p_order->>'currency', 'eur'),
        (p_order->>'subtotal_amount')::int,
        (p_order->>'shipping_amount')::int,
        (p_order->>'tax_amount')::int,
        (p_order->>'total_amount')::int
    )
    returning * into v_order;

    insert into public.order_items (order_id, variant_id, product_slug, product_name, size, sku, image_path,
                                    unit_amount, quantity, line_amount)
    select v_order.id, x.variant_id, x.product_slug, x.product_name, x.size, x.sku, x.image_path,
           x.unit_amount, x.quantity, x.line_amount
      from jsonb_to_recordset(p_items) as x(variant_id text, product_slug text, product_name text, size text,
                                             sku text, image_path text, unit_amount int, quantity int, line_amount int);

    insert into public.inventory_reservations (order_id, variant_id, quantity, expires_at)
    select v_order.id, x.variant_id, sum(x.quantity)::int, v_expires
      from jsonb_to_recordset(p_items) as x(variant_id text, quantity int)
     group by x.variant_id;

    update public.inventory_items i
       set reserved = i.reserved + d.qty, updated_at = now()
      from (select x.variant_id, sum(x.quantity)::int as qty
              from jsonb_to_recordset(p_items) as x(variant_id text, quantity int)
             group by x.variant_id) d
     where i.variant_id = d.variant_id;

    return jsonb_build_object(
        'ok', true,
        'order', jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number),
        'expiresAt', v_expires
    );
end $$;

-- ── Release an order's holds ────────────────────────────────────────────────
-- Called only once the payment can no longer succeed: Stripe has cancelled the
-- intent, or no client secret was ever handed out. A paid order is never
-- touched, and releasing twice is a no-op.
create or replace function public.inventory_release_order(p_order_id uuid, p_reason text, p_cancel_order boolean default true)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_order    public.orders%rowtype;
    v_res      record;
    v_released integer := 0;
begin
    select * into v_order from public.orders where id = p_order_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'order_not_found');
    end if;
    if v_order.payment_status = 'paid' then
        return jsonb_build_object('ok', true, 'released', 0, 'paid', true);
    end if;

    for v_res in
        select r.id, r.variant_id, r.quantity
          from public.inventory_reservations r
         where r.order_id = p_order_id and r.status = 'active'
         order by r.variant_id
           for update
    loop
        update public.inventory_items
           set reserved = reserved - v_res.quantity, updated_at = now()
         where variant_id = v_res.variant_id;
        update public.inventory_reservations
           set status = 'released', settled_at = now(), release_reason = left(coalesce(p_reason, 'released'), 120)
         where id = v_res.id;
        v_released := v_released + v_res.quantity;
    end loop;

    if p_cancel_order then
        update public.orders
           set status = 'cancelled', payment_status = 'failed', updated_at = now()
         where id = p_order_id and payment_status <> 'paid';
    end if;

    return jsonb_build_object('ok', true, 'released', v_released);
end $$;

-- ── Convert a verified payment into a sale, exactly once ────────────────────
-- The order row lock plus the payment_status check make this the single
-- transition point: a duplicate or concurrent call sees 'already_paid' and
-- does nothing. Units are deducted per unit purchased, not per order.
create or replace function public.inventory_confirm_payment(
    p_order_id uuid, p_payment_intent_id text, p_amount integer, p_currency text, p_livemode boolean
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_order     public.orders%rowtype;
    v_line      record;
    v_item      public.inventory_items%rowtype;
    v_res       public.inventory_reservations%rowtype;
    v_from_res  integer;
    v_take      integer;
    v_short     integer;
    v_shortfall boolean := false;
begin
    if p_order_id is not null then
        select * into v_order from public.orders where id = p_order_id for update;
    else
        select * into v_order from public.orders where stripe_payment_intent_id = p_payment_intent_id for update;
    end if;

    if not found then
        return jsonb_build_object('result', 'order_not_found');
    end if;

    if v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then
        return jsonb_build_object('result', 'intent_mismatch', 'order', to_jsonb(v_order));
    end if;

    if v_order.payment_status = 'paid' then
        return jsonb_build_object('result', 'already_paid', 'order', to_jsonb(v_order));
    end if;

    -- The webhook is authoritative, but it must agree with what was asked for.
    -- A mismatch is held for review: the stock stays reserved (no deadline) and
    -- the order is flagged rather than fulfilled.
    if p_amount is distinct from v_order.total_amount
       or lower(coalesce(p_currency, '')) <> lower(v_order.currency) then
        update public.orders
           set payment_status = 'failed', inventory_status = 'amount_mismatch',
               stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
               updated_at = now()
         where id = v_order.id
        returning * into v_order;
        update public.inventory_reservations
           set expires_at = null
         where order_id = v_order.id and status = 'active';
        return jsonb_build_object('result', 'amount_mismatch', 'order', to_jsonb(v_order));
    end if;

    for v_line in
        select oi.variant_id, sum(oi.quantity)::int as qty
          from public.order_items oi
         where oi.order_id = v_order.id
         group by oi.variant_id
         order by oi.variant_id
    loop
        select * into v_item from public.inventory_items where variant_id = v_line.variant_id for update;
        continue when not found;   -- an untracked piece has no stock to move

        select * into v_res from public.inventory_reservations
         where order_id = v_order.id and variant_id = v_line.variant_id and status = 'active'
           for update;

        v_from_res := 0;
        if found then
            v_from_res := least(v_res.quantity, v_line.qty);
            -- The whole hold leaves `reserved`; only the purchased part leaves on_hand.
            update public.inventory_items
               set reserved = reserved - v_res.quantity
             where variant_id = v_line.variant_id
            returning * into v_item;
            update public.inventory_reservations
               set status = 'committed', settled_at = now()
             where id = v_res.id;
        end if;

        -- Anything paid for without a live hold (an order from before tracking,
        -- or a hold that was released) is taken from what is still available.
        -- The units just committed from the hold are still in on_hand at this
        -- point, so they are not counted as available a second time.
        v_take  := least(v_line.qty - v_from_res, greatest(v_item.on_hand - v_item.reserved - v_from_res, 0));
        v_short := v_line.qty - v_from_res - v_take;

        update public.inventory_items
           set on_hand = on_hand - (v_from_res + v_take),
               sold = sold + (v_from_res + v_take),
               updated_at = now()
         where variant_id = v_line.variant_id
        returning * into v_item;

        if v_from_res + v_take > 0 then
            insert into public.inventory_movements (variant_id, kind, delta, on_hand_after, reserved_after, order_id, reason)
            values (v_line.variant_id, 'sale', -(v_from_res + v_take), v_item.on_hand, v_item.reserved, v_order.id,
                    'Order ' || v_order.order_number);
        end if;

        if v_short > 0 then
            v_shortfall := true;
            insert into public.inventory_movements (variant_id, kind, delta, on_hand_after, reserved_after, order_id, reason)
            values (v_line.variant_id, 'sale_shortfall', 0, v_item.on_hand, v_item.reserved, v_order.id,
                    v_short || ' unit(s) paid for in order ' || v_order.order_number || ' with no stock left to allocate');
        end if;
    end loop;

    update public.orders
       set payment_status = 'paid',
           status = 'confirmed',
           paid_at = now(),
           stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
           livemode = coalesce(p_livemode, livemode),
           inventory_status = case when v_shortfall then 'shortfall' else inventory_status end,
           updated_at = now()
     where id = v_order.id
    returning * into v_order;

    return jsonb_build_object('result', 'confirmed', 'order', to_jsonb(v_order), 'shortfall', v_shortfall);
end $$;

-- ── A payment is settling at the bank: hold without a deadline ──────────────
create or replace function public.inventory_hold_order(p_order_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_count integer;
begin
    perform 1 from public.orders where id = p_order_id for update;
    update public.inventory_reservations
       set expires_at = null
     where order_id = p_order_id and status = 'active';
    get diagnostics v_count = row_count;
    return jsonb_build_object('ok', true, 'held', v_count);
end $$;

-- ── An attempt failed but the intent is still open ──────────────────────────
-- Stripe returns a failed intent to requires_payment_method, so the customer
-- may still retry with another card. The hold stays; one that had lost its
-- deadline (a processing payment that then failed) gets a fresh one.
create or replace function public.inventory_payment_failed(p_order_id uuid, p_grace_seconds integer)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
    perform 1 from public.orders where id = p_order_id for update;
    update public.orders
       set payment_status = 'failed', updated_at = now()
     where id = p_order_id and payment_status = 'pending';
    update public.inventory_reservations
       set expires_at = now() + make_interval(secs => greatest(60, least(coalesce(p_grace_seconds, 900), 86400)))
     where order_id = p_order_id and status = 'active' and expires_at is null;
    return jsonb_build_object('ok', true);
end $$;

-- ── Orders whose holds have run out ─────────────────────────────────────────
create or replace function public.inventory_expired_orders(p_limit integer)
returns table (order_id uuid, payment_intent_id text, order_number text)
language sql
stable
set search_path = public
as $$
    select o.id, o.stripe_payment_intent_id, o.order_number
      from public.orders o
     where exists (
         select 1 from public.inventory_reservations r
          where r.order_id = o.id and r.status = 'active'
            and r.expires_at is not null and r.expires_at <= now())
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- ── Public read ─────────────────────────────────────────────────────────────
-- Everything the storefront needs, and nothing about who holds what.
create or replace function public.inventory_snapshot()
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'variantId', i.variant_id,
                       'productSlug', i.product_slug,
                       'size', i.size,
                       'onHand', i.on_hand,
                       'reserved', i.reserved,
                       'available', i.on_hand - i.reserved,
                       'everStocked', (i.on_hand > 0 or i.sold > 0))
                   order by i.product_slug, array_position(array['XS', 'S', 'M', 'L', 'XL', 'XXL'], i.size), i.size)
              from public.inventory_items i), '[]'::jsonb),
        'expiredHolds', (
            select count(*) from public.inventory_reservations r
             where r.status = 'active' and r.expires_at is not null and r.expires_at <= now()),
        'serverTime', now()
    );
$$;

-- ── Admin read ──────────────────────────────────────────────────────────────
create or replace function public.inventory_admin_snapshot(p_movement_limit integer default 100)
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'variantId', i.variant_id,
                       'productSlug', i.product_slug,
                       'size', i.size,
                       'onHand', i.on_hand,
                       'reserved', i.reserved,
                       'available', i.on_hand - i.reserved,
                       'sold', i.sold,
                       'returned', i.returned,
                       'adjustments', coalesce((
                           select sum(m.delta)::int from public.inventory_movements m
                            where m.variant_id = i.variant_id
                              and m.kind in ('adjustment', 'stocktake', 'reconciliation')), 0),
                       'updatedAt', i.updated_at)
                   order by i.product_slug, array_position(array['XS', 'S', 'M', 'L', 'XL', 'XXL'], i.size), i.size)
              from public.inventory_items i), '[]'::jsonb),
        'holds', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'orderNumber', o.order_number,
                       'variantId', r.variant_id,
                       'quantity', r.quantity,
                       'expiresAt', r.expires_at,
                       'createdAt', r.created_at,
                       'paymentStatus', o.payment_status)
                   order by r.created_at)
              from public.inventory_reservations r
              join public.orders o on o.id = r.order_id
             where r.status = 'active'), '[]'::jsonb),
        'movements', coalesce((
            select jsonb_agg(row_to_json(t)::jsonb order by t.id desc)
              from (select m.id, m.variant_id as "variantId", m.kind, m.delta,
                           m.on_hand_after as "onHandAfter", m.reserved_after as "reservedAfter",
                           o.order_number as "orderNumber", m.reason, m.actor_email as "actorEmail",
                           m.created_at as "createdAt"
                      from public.inventory_movements m
                      left join public.orders o on o.id = m.order_id
                     order by m.id desc
                     limit greatest(1, least(coalesce(p_movement_limit, 100), 500))) t), '[]'::jsonb),
        'attention', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'orderNumber', o.order_number,
                       'inventoryStatus', o.inventory_status,
                       'paymentStatus', o.payment_status,
                       'totalAmount', o.total_amount,
                       'createdAt', o.created_at)
                   order by o.created_at desc)
              from public.orders o
             where o.inventory_status is not null), '[]'::jsonb),
        'expiredHolds', (
            select count(*) from public.inventory_reservations r
             where r.status = 'active' and r.expires_at is not null and r.expires_at <= now()),
        'serverTime', now()
    );
$$;

-- ── Admin write ─────────────────────────────────────────────────────────────
-- p_mode:
--   'adjust'  on_hand += p_quantity (either sign) — corrections, damage, finds
--   'set'     on_hand := p_quantity              — a physical stocktake
--   'return'  on_hand += p_quantity, returned += p_quantity — a returned piece
--             that has physically arrived and been approved for resale. Tied to
--             the order it was sold in, and capped at what that order bought.
-- A refund alone never reaches this function; nothing restocks automatically.
-- The actor is whoever the server authenticated, never a client-supplied name.
create or replace function public.inventory_admin_adjust(
    p_variant_id text, p_mode text, p_quantity integer, p_reason text,
    p_actor_id uuid, p_actor_email text, p_order_number text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_item       public.inventory_items%rowtype;
    v_order      public.orders%rowtype;
    v_new        integer;
    v_delta      integer;
    v_bought     integer;
    v_restocked  integer;
    v_kind       text;
    v_reason     text := btrim(coalesce(p_reason, ''));
begin
    if p_mode not in ('adjust', 'set', 'return') then
        return jsonb_build_object('ok', false, 'error', 'invalid_mode');
    end if;
    if p_quantity is null or abs(p_quantity) > 100000 then
        return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
    end if;
    if length(v_reason) < 3 then
        return jsonb_build_object('ok', false, 'error', 'reason_required');
    end if;

    if p_mode = 'return' then
        if p_quantity < 1 then
            return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
        end if;
        select * into v_order from public.orders
         where order_number = upper(btrim(coalesce(p_order_number, '')));
        if not found then
            return jsonb_build_object('ok', false, 'error', 'order_not_found');
        end if;
        if v_order.payment_status not in ('paid', 'refunded') then
            return jsonb_build_object('ok', false, 'error', 'order_not_paid');
        end if;
    end if;

    select * into v_item from public.inventory_items where variant_id = p_variant_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'unknown_variant');
    end if;

    if p_mode = 'adjust' then
        if p_quantity = 0 then
            return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
        end if;
        v_delta := p_quantity;
        v_kind  := 'adjustment';
    elsif p_mode = 'set' then
        if p_quantity < 0 then
            return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
        end if;
        v_delta := p_quantity - v_item.on_hand;
        v_kind  := 'stocktake';
    else
        select coalesce(sum(oi.quantity), 0)::int into v_bought
          from public.order_items oi
         where oi.order_id = v_order.id and oi.variant_id = p_variant_id;
        if v_bought = 0 then
            return jsonb_build_object('ok', false, 'error', 'variant_not_in_order');
        end if;
        select coalesce(sum(m.delta), 0)::int into v_restocked
          from public.inventory_movements m
         where m.order_id = v_order.id and m.variant_id = p_variant_id and m.kind = 'return_restock';
        if v_restocked + p_quantity > v_bought then
            return jsonb_build_object('ok', false, 'error', 'exceeds_returnable',
                                      'returnable', v_bought - v_restocked);
        end if;
        if v_item.returned + p_quantity > v_item.sold then
            return jsonb_build_object('ok', false, 'error', 'exceeds_returnable',
                                      'returnable', v_item.sold - v_item.returned);
        end if;
        v_delta := p_quantity;
        v_kind  := 'return_restock';
    end if;

    v_new := v_item.on_hand + v_delta;
    if v_new < 0 then
        return jsonb_build_object('ok', false, 'error', 'would_go_negative', 'onHand', v_item.on_hand);
    end if;
    -- Units held in an open checkout are not the dashboard's to remove; they
    -- come back on their own if that checkout ends without payment.
    if v_new < v_item.reserved then
        return jsonb_build_object('ok', false, 'error', 'below_reserved', 'reserved', v_item.reserved);
    end if;
    if v_delta = 0 then
        return jsonb_build_object('ok', false, 'error', 'no_change');
    end if;

    update public.inventory_items
       set on_hand = v_new,
           returned = returned + case when v_kind = 'return_restock' then v_delta else 0 end,
           updated_at = now()
     where variant_id = p_variant_id
    returning * into v_item;

    insert into public.inventory_movements (variant_id, kind, delta, on_hand_after, reserved_after, order_id,
                                            reason, actor_id, actor_email)
    values (p_variant_id, v_kind, v_delta, v_item.on_hand, v_item.reserved,
            case when v_kind = 'return_restock' then v_order.id end,
            left(v_reason, 500), p_actor_id, left(p_actor_email, 320));

    return jsonb_build_object('ok', true, 'item', jsonb_build_object(
        'variantId', v_item.variant_id, 'onHand', v_item.on_hand, 'reserved', v_item.reserved,
        'available', v_item.on_hand - v_item.reserved, 'sold', v_item.sold, 'returned', v_item.returned));
end $$;

-- ── Row level security and grants ───────────────────────────────────────────
alter table public.inventory_items        enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.inventory_movements    enable row level security;
-- No policies: anon and authenticated can read and write nothing here. The
-- storefront reads availability through /api/inventory, server-side.

revoke all on table public.inventory_items        from anon, authenticated;
revoke all on table public.inventory_reservations from anon, authenticated;
revoke all on table public.inventory_movements    from anon, authenticated;

grant select, insert, update on table public.inventory_items        to service_role;
grant select, insert, update on table public.inventory_reservations to service_role;
-- Append-only by grant as well as by trigger.
grant select, insert         on table public.inventory_movements    to service_role;

-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase's
-- default privileges add anon and authenticated. Take all of it back.
do $$
declare
    fn text;
begin
    foreach fn in array array[
        'public.checkout_open_order(jsonb, jsonb, integer)',
        'public.inventory_release_order(uuid, text, boolean)',
        'public.inventory_confirm_payment(uuid, text, integer, text, boolean)',
        'public.inventory_hold_order(uuid)',
        'public.inventory_payment_failed(uuid, integer)',
        'public.inventory_expired_orders(integer)',
        'public.inventory_snapshot()',
        'public.inventory_admin_snapshot(integer)',
        'public.inventory_admin_adjust(text, text, integer, text, uuid, text, text)',
        'public.inventory_movements_append_only()'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
    end loop;

    foreach fn in array array[
        'public.checkout_open_order(jsonb, jsonb, integer)',
        'public.inventory_release_order(uuid, text, boolean)',
        'public.inventory_confirm_payment(uuid, text, integer, text, boolean)',
        'public.inventory_hold_order(uuid)',
        'public.inventory_payment_failed(uuid, integer)',
        'public.inventory_expired_orders(integer)',
        'public.inventory_snapshot()',
        'public.inventory_admin_snapshot(integer)',
        'public.inventory_admin_adjust(text, text, integer, text, uuid, text, text)'
    ] loop
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;

-- ── Verifying, after applying ───────────────────────────────────────────────
--   select variant_id, on_hand, reserved, on_hand - reserved as available, sold
--     from public.inventory_items order by variant_id;
--
-- Expected on a store with no prior sales: S 2, M 16, L 10, XL 2 for both
-- tees — 30 per design, 60 in total.
