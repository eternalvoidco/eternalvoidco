-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — test checkout stock for the Endzustand twin
--
-- Follows 20261004120000_inventory.sql and 20261031120000_production_allocation_50.sql.
--
-- There are no physical products yet, so the cart and checkout have to be
-- exercised against something. That something is 'endzustand-tee-test': the
-- same piece as far as the boutique is concerned (same name, price, image and
-- size run — see api/_catalog.js) but a slug of its own, which is what makes
-- the isolation real rather than promised:
--
--   • its variant ids are 'endzustand-tee-test:<SIZE>', so its stock lives in
--     its own inventory_items rows and the production allocation of 50 pieces
--     per design is never read, held, decremented or sold against;
--   • reservations reference those rows, so a test checkout holds test units;
--   • order_items carry the test slug, so a test order is identifiable for the
--     lifetime of the record;
--   • movements are tagged 'Test checkout stock' in the same audit trail, so
--     the dashboard shows plainly what is test and what is not.
--
-- 20 units per size: enough to run the flow repeatedly — including abandoned
-- checkouts whose holds take half an hour to sweep — without ever reaching the
-- sold-out branch by accident. The figure is arbitrary because the stock is;
-- adjust it from the admin dashboard like any other row.
--
-- Nothing about the live catalogue, prices, sizes, holds, confirmation,
-- the expiry sweep, VOID_SALES_OPEN or any existing row is touched here.
--
-- Idempotent: the insert takes no action on an existing variant_id, and the
-- movement rows are written only for variants this statement actually created.
-- Applying the file again — or twice at once — adds no stock a second time.
-- ─────────────────────────────────────────────────────────────────────────────

with allocation (product_slug, size, initial) as (
    values
        ('endzustand-tee-test', 'S', 20), ('endzustand-tee-test', 'M', 20),
        ('endzustand-tee-test', 'L', 20), ('endzustand-tee-test', 'XL', 20)
),
inserted as (
    insert into public.inventory_items (variant_id, product_slug, size, on_hand, sold)
    select a.product_slug || ':' || a.size, a.product_slug, a.size, a.initial, 0
      from allocation a
    on conflict (variant_id) do nothing
    returning variant_id, on_hand
)
insert into public.inventory_movements (variant_id, kind, delta, on_hand_after, reserved_after, reason)
select i.variant_id, 'initial', i.on_hand, i.on_hand, 0,
       'Test checkout stock — not a production allocation'
  from inserted i;
