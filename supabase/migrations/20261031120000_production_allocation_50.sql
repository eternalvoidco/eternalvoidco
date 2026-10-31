-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — production allocation: 50 pieces per design
--
-- Follows 20261004120000_inventory.sql.
--
-- Levitate Tee and Endzustand Tee are each produced in 50 pieces, 100 in total:
--
--   S 4 · M 25 · L 17 · XL 4      (XS is not produced and stays unavailable)
--
-- These are TARGET production totals per size, not quantities to add. The
-- allocation a size has been given is recorded in inventory_movements: the
-- 'initial' row written when it was first stocked (S 2 · M 16 · L 10 · XL 2),
-- plus any 'allocation' rows since. This file moves each size's allocation to
-- its target and applies only the difference to on_hand:
--
--   delta    = target − (sum of 'initial' and 'allocation' deltas)
--   on_hand += delta
--
-- So everything else stays exactly as it is: units sold, units held by open
-- checkouts (reserved), returns, manual adjustments and stocktakes, and the
-- whole audit trail. available = on_hand − reserved, as everywhere else.
-- Each change is written as an 'allocation' movement, so the history shows
-- when and by how much the production run grew.
--
-- Idempotent: once a size's allocation equals its target the delta is 0 and
-- nothing is written. Running this file again — or at the same time from two
-- sessions (each size is row-locked before its allocation is read) — can never
-- add stock a second time. A database created from scratch is already
-- allocated at 50 by the inventory migration, so this file is a no-op there.
--
-- Insigne pieces, prices, sizes, reservations, the 30-minute hold, payment
-- confirmation, the expiry sweep and the VOID_SALES_OPEN gate are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. A movement kind for a change of production allocation ────────────────
-- Adding a value to the CHECK reads the existing rows to validate them; it
-- writes none, so the append-only trigger is not involved.
alter table public.inventory_movements drop constraint if exists inventory_movements_kind_check;
alter table public.inventory_movements add constraint inventory_movements_kind_check check (kind in (
    'initial', 'allocation', 'reconciliation', 'adjustment', 'stocktake',
    'return_restock', 'sale', 'sale_shortfall'));

-- ── 2. Move each size to its target allocation ──────────────────────────────
do $$
declare
    v_target    record;
    v_item      public.inventory_items%rowtype;
    v_allocated integer;
    v_delta     integer;
begin
    for v_target in
        select t.variant_id, t.target
          from (values
                    ('endzustand-tee:S', 4), ('endzustand-tee:M', 25), ('endzustand-tee:L', 17), ('endzustand-tee:XL', 4),
                    ('levitate-tee:S',   4), ('levitate-tee:M',   25), ('levitate-tee:L',   17), ('levitate-tee:XL',   4)
               ) as t(variant_id, target)
         -- The lock order every inventory function uses: by variant_id.
         order by t.variant_id
    loop
        select * into v_item from public.inventory_items where variant_id = v_target.variant_id for update;
        if not found then
            raise exception 'inventory row % is missing: apply 20261004120000_inventory.sql first', v_target.variant_id;
        end if;

        -- Read after the row lock, so a concurrent run's allocation is seen.
        select coalesce(sum(m.delta), 0)::int into v_allocated
          from public.inventory_movements m
         where m.variant_id = v_target.variant_id and m.kind in ('initial', 'allocation');

        v_delta := v_target.target - v_allocated;
        if v_delta = 0 then
            raise notice '%: already allocated % — unchanged (on hand %, reserved %, sold %)',
                v_target.variant_id, v_allocated, v_item.on_hand, v_item.reserved, v_item.sold;
            continue;
        end if;

        -- Only reachable if a target is ever lowered below what is already
        -- sold or held; stop the whole run rather than strand a checkout.
        if v_item.on_hand + v_delta < v_item.reserved then
            raise exception '%: allocation % → % would leave % on hand under % reserved',
                v_target.variant_id, v_allocated, v_target.target, v_item.on_hand + v_delta, v_item.reserved;
        end if;

        update public.inventory_items
           set on_hand = on_hand + v_delta, updated_at = now()
         where variant_id = v_target.variant_id
        returning * into v_item;

        insert into public.inventory_movements (variant_id, kind, delta, on_hand_after, reserved_after, reason)
        values (v_target.variant_id, 'allocation', v_delta, v_item.on_hand, v_item.reserved,
                format('Production allocation %s → %s (50 per design)', v_allocated, v_target.target));

        raise notice '%: allocation % → % (%s), on hand now %, reserved %, available %',
            v_target.variant_id, v_allocated, v_target.target,
            case when v_delta > 0 then '+' else '' end || v_delta,
            v_item.on_hand, v_item.reserved, v_item.on_hand - v_item.reserved;
    end loop;
end $$;

-- ── 3. The dashboard shows each size's allocation ───────────────────────────
-- Unchanged from 20261004120000_inventory.sql except for 'allocated', the
-- size's production allocation (its 'initial' and 'allocation' movements).
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
                       'allocated', coalesce((
                           select sum(m.delta)::int from public.inventory_movements m
                            where m.variant_id = i.variant_id
                              and m.kind in ('initial', 'allocation')), 0),
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

-- Replacing a function keeps its grants, but say it again: service_role only.
revoke all on function public.inventory_admin_snapshot(integer) from public, anon, authenticated;
grant execute on function public.inventory_admin_snapshot(integer) to service_role;

-- ── Verifying, after applying ───────────────────────────────────────────────
--   select i.variant_id,
--          (select sum(m.delta) from inventory_movements m
--            where m.variant_id = i.variant_id and m.kind in ('initial', 'allocation')) as allocated,
--          i.on_hand, i.reserved, i.on_hand - i.reserved as available, i.sold, i.returned
--     from inventory_items i
--    where i.product_slug in ('levitate-tee', 'endzustand-tee')
--    order by i.variant_id;
--
-- allocated must read S 4, M 25, L 17, XL 4 for both designs (50 each, 100 in
-- all). On a store with no sales, holds or adjustments, on_hand and available
-- read the same figures.
