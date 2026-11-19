-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — royalty reconciliation
--
-- Follows 20261119120000_artist_submissions.sql and replaces the reversal model
-- it introduced. Three defects are fixed here, and all three paid the artist
-- the wrong number:
--
--   1 · THE DISCOUNT INFERENCE WAS VACUOUS. The previous statement inferred an
--       order-level discount from `sum(line_amount) - orders.subtotal_amount`.
--       In this codebase that difference is ALWAYS ZERO: api/_catalog.js
--       computes subtotalOf() as exactly sum(lineAmount), and two constraints
--       hold it there (orders_total_is_sum, order_items_line_is_product). There
--       is no coupon, promotion or voucher path anywhere in the project. So the
--       calculation handled nothing while looking as though it handled
--       something — and the day a discount feature lands, a pro-rata guess
--       would quietly pay a wrong number. It is replaced below by the verified
--       identity plus a tripwire: an order whose subtotal does not equal the
--       sum of its lines is UNRECONCILABLE and blocks the payout, rather than
--       being silently treated as discounted.
--
--   2 · UNALLOCATED REVERSALS VANISHED. The reversal query inner-joined
--       order_items through order_item_id, so a refund not yet attributed to a
--       line was dropped from the statement entirely. That is the worst
--       direction for an error to point: it over-pays. Allocation now lives in
--       its own table, and anything unallocated is counted, carried on the face
--       of the statement, and blocks the payout.
--
--   3 · ONE RATE PER ARTIST. The statement took max(royalty_bps) per artist. An
--       artist with two SKUs on two agreements at two rates got one blended
--       wrong rate over the combined base. Royalty is now computed per
--       collaboration row and summed.
--
-- WHY order_refunds IS DROPPED AND REBUILT. It was introduced in the preceding
-- migration with no writer: api/stripe-webhook.js has only ever handled
-- payment_intent.* events, so nothing could have inserted a row. The table is
-- provably empty, and the shape it needs differs enough that altering it would
-- be less legible than replacing it.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.artist_royalty_statement(timestamptz, timestamptz, text);
drop table if exists public.order_refunds cascade;

-- ══ Reversals ════════════════════════════════════════════════════════════════
-- One row per Stripe Refund or Dispute. `provider_ref` is Stripe's own id
-- (re_… or dp_…) and is unique, so the same object arriving any number of times
-- — a retry, a duplicate delivery, a later status change, a refund issued from
-- the Stripe Dashboard and its webhook — converges on one row rather than
-- accumulating.
--
-- `amount` is the GROSS reversal as Stripe reports it, which may include
-- shipping. What of it belongs to merchandise, and to which line, is decided
-- separately in order_refund_allocations — because Stripe cannot say. This
-- integration creates bare PaymentIntents with no line items, so a refund
-- carries no item-level evidence at all.
create table if not exists public.order_refunds (
    id                  uuid primary key default gen_random_uuid(),
    order_id            uuid not null references public.orders(id) on delete cascade,

    provider_ref        text not null,
    provider_object     text not null,                    -- 'refund' | 'dispute'
    charge_id           text,
    payment_intent_id   text,

    kind                text not null default 'refund',   -- 'refund' | 'chargeback'

    -- pending      requested, money has not moved yet
    -- succeeded    the money has gone back to the customer. Counts.
    -- failed       the refund did not go through. Does not count.
    -- canceled     withdrawn before settling. Does not count.
    -- reinstated   a dispute we won, or funds otherwise returned to us. The
    --              reversal is undone, so it must not reduce a royalty.
    status              text not null default 'succeeded',

    amount              integer not null check (amount >= 0),
    currency            text not null default 'eur',
    reason              text,

    -- When the money actually moved. The statement buckets on this, which is
    -- what puts a reversal landing after quarter-end into the quarter it landed
    -- in rather than the quarter of the sale.
    refunded_at         timestamptz not null,

    -- Stripe's own last-modified moment for the object, used to refuse a stale
    -- delivery arriving after a newer one has already been applied.
    source_updated_at   timestamptz,

    -- not_required   the order holds no collaboration SKU, so no allocation is
    --                needed and this reversal never touches a statement
    -- auto           allocated by a rule below that is unambiguous
    -- manual         allocated by a named person
    -- unallocated    the evidence cannot say which line. BLOCKS THE PAYOUT.
    allocation_state    text not null default 'unallocated',
    allocation_rule     text,
    allocation_note     text,
    allocated_by        text,
    allocated_at        timestamptz,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint order_refunds_provider_unique unique (provider_ref),
    constraint order_refunds_object check (provider_object in ('refund', 'dispute')),
    constraint order_refunds_kind   check (kind in ('refund', 'chargeback')),
    constraint order_refunds_status check (status in ('pending', 'succeeded', 'failed', 'canceled', 'reinstated')),
    constraint order_refunds_alloc  check (allocation_state in ('unallocated', 'auto', 'manual', 'not_required'))
);

create index if not exists order_refunds_order_idx  on public.order_refunds (order_id);
create index if not exists order_refunds_at_idx     on public.order_refunds (refunded_at);
create index if not exists order_refunds_charge_idx on public.order_refunds (charge_id);
create index if not exists order_refunds_open_idx
    on public.order_refunds (refunded_at) where allocation_state = 'unallocated';

drop trigger if exists order_refunds_touch_updated_at on public.order_refunds;
create trigger order_refunds_touch_updated_at
    before update on public.order_refunds
    for each row execute function public.touch_updated_at();

-- ── Which line a reversal reversed ──────────────────────────────────────────
-- A reversal may span several lines, so this is one row per (reversal, line).
-- The sum of a reversal's allocations is its merchandise component; the
-- remainder is shipping, which never earned a royalty and so is not allocated.
create table if not exists public.order_refund_allocations (
    id              uuid primary key default gen_random_uuid(),
    refund_id       uuid not null references public.order_refunds(id) on delete cascade,
    order_item_id   uuid not null references public.order_items(id) on delete cascade,
    amount          integer not null check (amount > 0),
    created_at      timestamptz not null default now(),

    constraint order_refund_allocations_once unique (refund_id, order_item_id)
);

create index if not exists order_refund_allocations_item_idx
    on public.order_refund_allocations (order_item_id);

-- ══ Recording a reversal ═════════════════════════════════════════════════════
-- Called from the webhook with the CURRENT state of the object as read back
-- from Stripe, never with the event's own snapshot. That is what makes delivery
-- order safe: a late `charge.refunded` arriving after `refund.updated` re-reads
-- the same current status and converges on it, exactly as the PaymentIntent
-- path in this project already does.
--
-- `p_source_updated_at` guards the one case re-reading cannot fix: two handlers
-- in flight at once, the slower one holding the older snapshot.
create or replace function public.order_reversal_record(
    p_provider_ref text,
    p_provider_object text,
    p_payment_intent text,
    p_charge text,
    p_kind text,
    p_status text,
    p_amount integer,
    p_currency text,
    p_reason text,
    p_reversed_at timestamptz,
    p_source_updated_at timestamptz
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_order     public.orders%rowtype;
    v_existing  public.order_refunds%rowtype;
    v_row       public.order_refunds%rowtype;
    v_had       boolean := false;
begin
    if p_status not in ('pending', 'succeeded', 'failed', 'canceled', 'reinstated') then
        return jsonb_build_object('ok', false, 'error', 'bad_status');
    end if;

    -- The only link from Stripe back to an order. A refund issued from the
    -- Dashboard carries the same payment_intent, so it arrives by this route
    -- too — there is no separate path for it to miss.
    select * into v_order from public.orders
     where stripe_payment_intent_id = btrim(coalesce(p_payment_intent, ''));
    if not found then
        return jsonb_build_object('ok', false, 'error', 'order_not_found',
                                  'paymentIntent', p_payment_intent);
    end if;

    select * into v_existing from public.order_refunds
     where provider_ref = btrim(p_provider_ref) for update;
    v_had := found;

    -- A delivery older than what has already been applied changes nothing.
    if v_had
       and v_existing.source_updated_at is not null
       and p_source_updated_at is not null
       and p_source_updated_at < v_existing.source_updated_at then
        return jsonb_build_object('ok', true, 'outcome', 'stale',
                                  'reference', v_existing.provider_ref,
                                  'status', v_existing.status);
    end if;

    insert into public.order_refunds (
        order_id, provider_ref, provider_object, charge_id, payment_intent_id,
        kind, status, amount, currency, reason, refunded_at, source_updated_at
    ) values (
        v_order.id, btrim(p_provider_ref), p_provider_object,
        nullif(btrim(coalesce(p_charge, '')), ''), btrim(p_payment_intent),
        p_kind, p_status, greatest(coalesce(p_amount, 0), 0),
        lower(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'eur')),
        nullif(btrim(coalesce(p_reason, '')), ''),
        coalesce(p_reversed_at, now()), p_source_updated_at
    )
    on conflict (provider_ref) do update
       set status            = excluded.status,
           amount            = excluded.amount,
           reason            = coalesce(excluded.reason, public.order_refunds.reason),
           refunded_at       = excluded.refunded_at,
           charge_id         = coalesce(excluded.charge_id, public.order_refunds.charge_id),
           source_updated_at = excluded.source_updated_at
    returning * into v_row;

    return jsonb_build_object(
        'ok', true,
        'outcome', case when v_had then 'updated' else 'created' end,
        'id', v_row.id, 'orderId', v_order.id, 'orderNumber', v_order.order_number,
        'reference', v_row.provider_ref, 'status', v_row.status,
        'amount', v_row.amount, 'allocationState', v_row.allocation_state
    );
end $$;

-- ══ Allocating a reversal to lines ═══════════════════════════════════════════
-- Stripe carries no item-level evidence for this integration, so the rules
-- below are the only unambiguous readings of the amounts available. Anything
-- outside them is left unallocated on purpose: guessing an allocation is how an
-- artist gets paid for a sale that was returned.
--
--   not_required       the order holds no collaboration SKU. Nothing to decide.
--   full_order         the reversal equals the order total. Everything went
--                      back, so every line reverses in full. Exact.
--   full_merchandise   the reversal equals the merchandise subtotal, shipping
--                      retained. Every line reverses in full. Exact.
--   sole_line          the order has exactly one line and carries no shipping,
--                      so there is nothing else the money could have come from.
--   unique_line_match  the reversal equals the line total of exactly one line
--                      and of no other. Refused when two lines share a price,
--                      because then it is a coin toss.
--
-- Everything else is unallocated, and the period will not pass reconciliation.
create or replace function public.order_reversal_allocate(p_provider_ref text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row      public.order_refunds%rowtype;
    v_order    public.orders%rowtype;
    v_lines    integer;
    v_merch    integer;
    v_eligible integer;
    v_match    uuid;
    v_matches  integer;
    v_rule     text;
    v_target   integer;
begin
    select * into v_row from public.order_refunds
     where provider_ref = btrim(p_provider_ref) for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

    -- A person's decision is never overwritten by a rule.
    if v_row.allocation_state = 'manual' then
        return jsonb_build_object('ok', true, 'outcome', 'manual_kept',
                                  'allocationState', 'manual');
    end if;

    select * into v_order from public.orders where id = v_row.order_id;

    select count(*), coalesce(sum(line_amount), 0)
      into v_lines, v_merch
      from public.order_items where order_id = v_order.id;

    select count(*) into v_eligible
      from public.order_items i
      join public.artist_collaborations c on c.sku = i.sku
     where i.order_id = v_order.id;

    delete from public.order_refund_allocations where refund_id = v_row.id;

    if v_eligible = 0 then
        update public.order_refunds
           set allocation_state = 'not_required', allocation_rule = null,
               allocation_note = 'order holds no collaboration SKU',
               allocated_at = now(), allocated_by = 'rule'
         where id = v_row.id;
        return jsonb_build_object('ok', true, 'outcome', 'not_required');
    end if;

    -- A line with no SKU cannot be matched to an agreement, so an order
    -- containing one cannot be allocated by rule at all.
    if exists (select 1 from public.order_items
                where order_id = v_order.id and (sku is null or btrim(sku) = '')) then
        update public.order_refunds
           set allocation_state = 'unallocated', allocation_rule = null,
               allocation_note = 'order contains a line with no SKU',
               allocated_at = now(), allocated_by = 'rule'
         where id = v_row.id;
        return jsonb_build_object('ok', true, 'outcome', 'unallocated',
                                  'reason', 'line_without_sku');
    end if;

    v_rule := null;

    if v_row.amount = v_order.total_amount then
        v_rule := 'full_order';       v_target := v_merch;
    elsif v_row.amount = v_merch then
        v_rule := 'full_merchandise'; v_target := v_merch;
    elsif v_lines = 1 and v_order.shipping_amount = 0
          and v_row.amount > 0 and v_row.amount <= v_merch then
        v_rule := 'sole_line';        v_target := v_row.amount;
    else
        select count(*) into v_matches
          from public.order_items
         where order_id = v_order.id and line_amount = v_row.amount;
        if v_matches = 1 then
            select id into v_match from public.order_items
             where order_id = v_order.id and line_amount = v_row.amount;
            v_rule := 'unique_line_match'; v_target := v_row.amount;
        end if;
    end if;

    if v_rule is null then
        update public.order_refunds
           set allocation_state = 'unallocated', allocation_rule = null,
               allocation_note = format(
                   'reversal %s matches neither the order total (%s), nor the merchandise subtotal (%s), nor any single line',
                   v_row.amount, v_order.total_amount, v_merch),
               allocated_at = now(), allocated_by = 'rule'
         where id = v_row.id;
        return jsonb_build_object('ok', true, 'outcome', 'unallocated',
                                  'reason', 'ambiguous', 'amount', v_row.amount,
                                  'orderTotal', v_order.total_amount, 'merchandise', v_merch);
    end if;

    if v_rule = 'unique_line_match' then
        insert into public.order_refund_allocations (refund_id, order_item_id, amount)
        values (v_row.id, v_match, v_target);
    elsif v_rule = 'sole_line' then
        insert into public.order_refund_allocations (refund_id, order_item_id, amount)
        select v_row.id, id, v_target from public.order_items where order_id = v_order.id;
    else
        -- Everything reverses. Allocated at each line's own amount, so the
        -- parts sum to the whole exactly and there is no rounding to spread.
        insert into public.order_refund_allocations (refund_id, order_item_id, amount)
        select v_row.id, id, line_amount
          from public.order_items where order_id = v_order.id and line_amount > 0;
    end if;

    update public.order_refunds
       set allocation_state = 'auto', allocation_rule = v_rule, allocation_note = null,
           allocated_at = now(), allocated_by = 'rule'
     where id = v_row.id;

    return jsonb_build_object('ok', true, 'outcome', 'allocated', 'rule', v_rule,
                              'merchandiseReversed', v_target);
end $$;

-- A person resolving what the rules refused. Amounts are checked against both
-- the reversal and the lines, so a manual allocation cannot reverse more than
-- was taken, or more than a line was ever worth.
create or replace function public.order_reversal_allocate_manual(
    p_provider_ref text, p_allocations jsonb, p_actor text, p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row   public.order_refunds%rowtype;
    v_total integer := 0;
    v_entry jsonb;
    v_item  public.order_items%rowtype;
begin
    select * into v_row from public.order_refunds
     where provider_ref = btrim(p_provider_ref) for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

    for v_entry in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
        select * into v_item from public.order_items
         where id = (v_entry->>'orderItemId')::uuid and order_id = v_row.order_id;
        if not found then
            return jsonb_build_object('ok', false, 'error', 'item_not_on_order',
                                      'orderItemId', v_entry->>'orderItemId');
        end if;
        if (v_entry->>'amount')::integer <= 0
           or (v_entry->>'amount')::integer > v_item.line_amount then
            return jsonb_build_object('ok', false, 'error', 'amount_out_of_range',
                                      'orderItemId', v_entry->>'orderItemId',
                                      'lineAmount', v_item.line_amount);
        end if;
        v_total := v_total + (v_entry->>'amount')::integer;
    end loop;

    if v_total > v_row.amount then
        return jsonb_build_object('ok', false, 'error', 'over_allocated',
                                  'allocated', v_total, 'reversal', v_row.amount);
    end if;

    delete from public.order_refund_allocations where refund_id = v_row.id;
    insert into public.order_refund_allocations (refund_id, order_item_id, amount)
    select v_row.id, (e->>'orderItemId')::uuid, (e->>'amount')::integer
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) e;

    update public.order_refunds
       set allocation_state = 'manual', allocation_rule = 'manual',
           allocation_note = nullif(btrim(coalesce(p_note, '')), ''),
           allocated_by = left(coalesce(p_actor, 'unknown'), 320), allocated_at = now()
     where id = v_row.id;

    return jsonb_build_object('ok', true, 'outcome', 'allocated',
                              'merchandiseReversed', v_total);
end $$;

-- ══ Reconciliation ═══════════════════════════════════════════════════════════
-- Everything that would make a statement for this period untrustworthy. A
-- period carrying any of it is not payout-ready, and the export refuses to
-- produce a payout file for it.
create or replace function public.artist_royalty_reconciliation(
    p_from timestamptz, p_to timestamptz
)
returns jsonb
language sql
stable
set search_path = public
as $$
with
-- Orders in the period carrying at least one collaboration SKU.
scope as (
    select distinct o.id, o.order_number, o.paid_at, o.subtotal_amount, o.total_amount
      from public.orders o
      join public.order_items i on i.order_id = o.id
      join public.artist_collaborations c on c.sku = i.sku
     where o.payment_status = 'paid' and o.paid_at is not null
       and o.paid_at >= p_from and o.paid_at < p_to
),
-- THE TRIPWIRE. In this codebase subtotal_amount is computed as exactly the
-- sum of the line amounts and two constraints hold it there, so this set is
-- empty by construction. It is here for the day that stops being true — a
-- discount feature, an import, a manual correction. Rather than inferring an
-- allocation, the period stops being payable and a person looks at it.
discount_anomalies as (
    select s.order_number, s.subtotal_amount,
           (select coalesce(sum(line_amount), 0) from public.order_items where order_id = s.id) as lines_total
      from scope s
     where s.subtotal_amount <> (select coalesce(sum(line_amount), 0)
                                   from public.order_items where order_id = s.id)
),
-- A line with no SKU inside an order that otherwise earns a royalty: a reversal
-- on that order can never be allocated by rule.
missing_sku as (
    select distinct s.order_number
      from scope s
      join public.order_items i on i.order_id = s.id
     where i.sku is null or btrim(i.sku) = ''
),
-- Reversals landing in this period that still have no line attribution.
unallocated as (
    select r.provider_ref, r.kind, r.status, r.amount, r.refunded_at,
           r.allocation_note, o.order_number
      from public.order_refunds r
      join public.orders o on o.id = r.order_id
     where r.refunded_at >= p_from and r.refunded_at < p_to
       and r.status in ('pending', 'succeeded')
       and r.allocation_state = 'unallocated'
),
-- Still moving. A pending refund may yet succeed or fail, so a statement cut
-- across one could be wrong in either direction.
pending as (
    select r.provider_ref, r.amount, r.refunded_at, o.order_number
      from public.order_refunds r
      join public.orders o on o.id = r.order_id
     where r.refunded_at >= p_from and r.refunded_at < p_to and r.status = 'pending'
),
-- A charge carrying both a refund and a dispute. Legitimate, and also the exact
-- shape of a double reversal, so it is always looked at.
charge_overlaps as (
    select o.order_number, r.charge_id,
           sum(r.amount) filter (where r.provider_object = 'refund')  as refunded,
           sum(r.amount) filter (where r.provider_object = 'dispute') as disputed
      from public.order_refunds r
      join public.orders o on o.id = r.order_id
     where r.charge_id is not null
       and r.status in ('pending', 'succeeded')
       and r.refunded_at >= p_from and r.refunded_at < p_to
     group by o.order_number, r.charge_id
    having count(distinct r.provider_object) > 1
),
-- Allocated for more merchandise than the reversal actually took.
over_allocated as (
    select r.provider_ref, r.amount,
           (select coalesce(sum(amount), 0) from public.order_refund_allocations
             where refund_id = r.id) as allocated
      from public.order_refunds r
     where r.refunded_at >= p_from and r.refunded_at < p_to
       and (select coalesce(sum(amount), 0) from public.order_refund_allocations
             where refund_id = r.id) > r.amount
)
select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'ordersInScope', (select count(*) from scope),
    'blocking', jsonb_build_object(
        'discountAnomalies',    coalesce((select jsonb_agg(to_jsonb(d)) from discount_anomalies d), '[]'::jsonb),
        'linesWithoutSku',      coalesce((select jsonb_agg(order_number) from missing_sku), '[]'::jsonb),
        'unallocatedReversals', coalesce((select jsonb_agg(to_jsonb(u)) from unallocated u), '[]'::jsonb),
        'overAllocated',        coalesce((select jsonb_agg(to_jsonb(v)) from over_allocated v), '[]'::jsonb)
    ),
    'review', jsonb_build_object(
        'pendingReversals',             coalesce((select jsonb_agg(to_jsonb(p)) from pending p), '[]'::jsonb),
        'refundAndDisputeOnSameCharge', coalesce((select jsonb_agg(to_jsonb(x)) from charge_overlaps x), '[]'::jsonb)
    ),
    'blockingCount',
        (select count(*) from discount_anomalies) + (select count(*) from missing_sku)
      + (select count(*) from unallocated)        + (select count(*) from over_allocated),
    'reviewCount',
        (select count(*) from pending) + (select count(*) from charge_overlaps),
    'status', case
        when (select count(*) from discount_anomalies) + (select count(*) from missing_sku)
           + (select count(*) from unallocated)        + (select count(*) from over_allocated) > 0
            then 'blocked'
        when (select count(*) from pending) + (select count(*) from charge_overlaps) > 0
            then 'needs_review'
        else 'clean' end
);
$$;

-- ══ The royalty statement ════════════════════════════════════════════════════
-- What the public page promises, and nothing else:
--
--   base          the amount actually paid for the collaboration merchandise.
--                 That is sum(order_items.line_amount) — the verified identity
--                 in this codebase, where subtotal_amount IS that sum and no
--                 discount path exists. Not inferred, not pro-rated.
--   excluded      VAT and other sales taxes (orders.tax_amount, a sibling
--                 column, never inside line_amount) and separately charged
--                 shipping (orders.shipping_amount, likewise).
--   reversals     the merchandise component of each refund or chargeback,
--                 counted once through its allocation rows, only where the
--                 status says the money actually moved, bucketed on the date
--                 it moved.
--   not deducted  production, sampling, packaging, platform fees, payment
--                 fees, marketing, overhead. None of them appear here.
--
-- The rate is read per collaboration row and the royalty summed per row, so two
-- SKUs on two agreements at two rates produce two correct figures rather than
-- one blended wrong one.
create or replace function public.artist_royalty_statement(
    p_from timestamptz, p_to timestamptz, p_artist_email text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
with eligible as (
    select
        c.artist_email, c.artist_name, c.credit_name, c.agreement_ref,
        c.sku, c.royalty_bps,
        o.order_number, o.paid_at,
        i.product_name, i.quantity, i.line_amount
      from public.order_items i
      join public.orders o on o.id = i.order_id
      join public.artist_collaborations c
            on c.sku = i.sku
           and c.channel = 'direct'
           and o.paid_at::date >= c.effective_from
           and (c.effective_to is null or o.paid_at::date <= c.effective_to)
     where o.payment_status = 'paid'
       and o.paid_at is not null
       and o.paid_at >= p_from and o.paid_at < p_to
       and (p_artist_email is null or c.artist_email = lower(btrim(p_artist_email)))
),
-- Only money that actually moved. 'pending' has not moved yet, 'failed' and
-- 'canceled' never did, and 'reinstated' is a dispute we won — the funds came
-- back to us, so that reversal is undone and must not reduce a royalty.
reversals as (
    select
        c.artist_email, c.sku, c.royalty_bps,
        r.provider_ref, r.kind, r.status, r.refunded_at,
        r.allocation_state, r.allocation_rule,
        a.amount, o.order_number, i.product_name
      from public.order_refund_allocations a
      join public.order_refunds r on r.id = a.refund_id
      join public.order_items i   on i.id = a.order_item_id
      join public.orders o        on o.id = r.order_id
      join public.artist_collaborations c
            on c.sku = i.sku
           and c.channel = 'direct'
           and o.paid_at::date >= c.effective_from
           and (c.effective_to is null or o.paid_at::date <= c.effective_to)
     where r.status = 'succeeded'
       and r.refunded_at >= p_from and r.refunded_at < p_to
       and (p_artist_email is null or c.artist_email = lower(btrim(p_artist_email)))
),
-- Reversals in the period that touch a royalty-bearing order but have not been
-- attributed to a line. They cannot be subtracted from anybody yet, so they are
-- carried on the face of the statement as an unresolved amount and the
-- reconciliation refuses the payout. Never silently dropped — that was the bug.
unattributed as (
    select r.provider_ref, r.amount, r.refunded_at, o.order_number
      from public.order_refunds r
      join public.orders o on o.id = r.order_id
     where r.status in ('pending', 'succeeded')
       and r.allocation_state = 'unallocated'
       and r.refunded_at >= p_from and r.refunded_at < p_to
),
per_sku as (
    select artist_email, sku, royalty_bps,
           max(agreement_ref) as agreement_ref,
           sum(quantity)      as units,
           sum(line_amount)   as gross
      from eligible group by artist_email, sku, royalty_bps
),
rev_per_sku as (
    select artist_email, sku, royalty_bps,
           sum(amount) as reversed, count(*) as reversal_count
      from reversals group by artist_email, sku, royalty_bps
),
-- A full outer join, so a reversal landing in a quarter with no matching sale
-- still appears instead of disappearing.
joined as (
    select
        coalesce(p.artist_email, r.artist_email) as artist_email,
        coalesce(p.sku, r.sku)                   as sku,
        coalesce(p.royalty_bps, r.royalty_bps)   as royalty_bps,
        p.agreement_ref,
        coalesce(p.units, 0)          as units,
        coalesce(p.gross, 0)          as gross,
        coalesce(r.reversed, 0)       as reversed,
        coalesce(r.reversal_count, 0) as reversal_count
      from per_sku p
      full outer join rev_per_sku r
        on r.artist_email = p.artist_email and r.sku = p.sku and r.royalty_bps = p.royalty_bps
),
-- Per SKU, because the rate is per SKU. Floored at zero so a SKU whose
-- reversals exceed its sales in one quarter cannot silently fund another.
per_sku_due as (
    select *,
           greatest(gross - reversed, 0) as base,
           greatest(reversed - gross, 0) as carry,
           round(greatest(gross - reversed, 0)::numeric * royalty_bps / 10000) as due
      from joined
),
per_artist as (
    select artist_email,
           max(agreement_ref) as agreement_ref,
           sum(units) as units, sum(gross) as gross,
           sum(reversed) as reversed, sum(reversal_count) as reversal_count,
           sum(base) as base, sum(carry) as carry, sum(due) as due
      from per_sku_due group by artist_email
),
recon as (select public.artist_royalty_reconciliation(p_from, p_to) as r)
select jsonb_build_object(
    'ok', true,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'currency', 'eur',
    'reconciliation', (select r from recon),
    -- The single flag that decides whether this may be paid from.
    'payoutReady', ((select r->>'status' from recon) = 'clean'),
    'unattributedReversals', coalesce((select jsonb_agg(to_jsonb(u)) from unattributed u), '[]'::jsonb),
    'unattributedTotal', coalesce((select sum(amount) from unattributed), 0),
    'artists', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', a.artist_email,
            'artistName', (select max(artist_name) from eligible e where e.artist_email = a.artist_email),
            'creditName', (select max(credit_name) from eligible e where e.artist_email = a.artist_email),
            'agreementRef', a.agreement_ref,
            'units', a.units,
            'grossMerchandise', a.gross,
            'reversals', a.reversed,
            'reversalCount', a.reversal_count,
            'royaltyBase', a.base,
            'carryForward', a.carry,
            'royaltyDue', a.due,
            'perSku', (select jsonb_agg(jsonb_build_object(
                    'sku', s.sku, 'royaltyBps', s.royalty_bps, 'units', s.units,
                    'grossMerchandise', s.gross, 'reversals', s.reversed,
                    'royaltyBase', s.base, 'carryForward', s.carry, 'royaltyDue', s.due
                ) order by s.sku)
                from per_sku_due s where s.artist_email = a.artist_email)
        ) order by a.artist_email) from per_artist a), '[]'::jsonb),
    'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', artist_email, 'orderNumber', order_number, 'paidAt', paid_at,
            'sku', sku, 'productName', product_name, 'quantity', quantity,
            'netMerchandise', line_amount
        ) order by paid_at) from eligible), '[]'::jsonb),
    'reversalLines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', artist_email, 'orderNumber', order_number, 'sku', sku,
            'kind', kind, 'providerRef', provider_ref, 'refundedAt', refunded_at,
            'amount', amount, 'allocation', allocation_state, 'rule', allocation_rule
        ) order by refunded_at) from reversals), '[]'::jsonb)
);
$$;

-- ══ The historical dry run ═══════════════════════════════════════════════════
-- A webhook only catches what happens next. This is the other half: the caller
-- fetches the reversals Stripe already knows about and offers them here as a
-- batch. With p_apply false nothing is written and the answer says what would
-- be — which records match an order, which are already known, which match
-- nothing, and what the totals come to.
create or replace function public.order_reversal_backfill(
    p_rows jsonb, p_apply boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row       jsonb;
    v_order     public.orders%rowtype;
    v_known     public.order_refunds%rowtype;
    v_matched   jsonb := '[]'::jsonb;
    v_unmatched jsonb := '[]'::jsonb;
    v_existing  jsonb := '[]'::jsonb;
    v_applied   integer := 0;
    v_total     bigint := 0;
begin
    for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
        select * into v_order from public.orders
         where stripe_payment_intent_id = btrim(coalesce(v_row->>'paymentIntent', ''));

        if not found then
            v_unmatched := v_unmatched || jsonb_build_object(
                'providerRef', v_row->>'providerRef',
                'paymentIntent', v_row->>'paymentIntent',
                'amount', (v_row->>'amount')::integer,
                'reason', 'no order carries this payment intent');
            continue;
        end if;

        select * into v_known from public.order_refunds
         where provider_ref = btrim(v_row->>'providerRef');
        if found then
            v_existing := v_existing || jsonb_build_object(
                'providerRef', v_known.provider_ref, 'orderNumber', v_order.order_number,
                'status', v_known.status, 'allocationState', v_known.allocation_state);
            continue;
        end if;

        v_matched := v_matched || jsonb_build_object(
            'providerRef', v_row->>'providerRef',
            'orderNumber', v_order.order_number,
            'amount', (v_row->>'amount')::integer,
            'orderTotal', v_order.total_amount,
            'status', v_row->>'status',
            'reversedAt', v_row->>'reversedAt');
        v_total := v_total + (v_row->>'amount')::integer;

        if p_apply then
            perform public.order_reversal_record(
                v_row->>'providerRef', coalesce(v_row->>'providerObject', 'refund'),
                v_row->>'paymentIntent', v_row->>'charge',
                coalesce(v_row->>'kind', 'refund'), coalesce(v_row->>'status', 'succeeded'),
                (v_row->>'amount')::integer, coalesce(v_row->>'currency', 'eur'),
                v_row->>'reason', (v_row->>'reversedAt')::timestamptz,
                (v_row->>'reversedAt')::timestamptz);
            perform public.order_reversal_allocate(v_row->>'providerRef');
            v_applied := v_applied + 1;
        end if;
    end loop;

    return jsonb_build_object(
        'ok', true, 'applied', p_apply, 'wouldInsert', jsonb_array_length(v_matched),
        'inserted', v_applied, 'reversalTotal', v_total,
        'matched', v_matched, 'alreadyKnown', v_existing, 'unmatched', v_unmatched);
end $$;

-- ══ Row level security and grants ════════════════════════════════════════════
alter table public.order_refunds            enable row level security;
alter table public.order_refund_allocations enable row level security;

revoke all on table public.order_refunds            from anon, authenticated;
revoke all on table public.order_refund_allocations from anon, authenticated;

grant select, insert, update, delete on table public.order_refunds            to service_role;
grant select, insert, update, delete on table public.order_refund_allocations to service_role;

do $$
declare fn text;
begin
    foreach fn in array array[
        'public.order_reversal_record(text, text, text, text, text, text, integer, text, text, timestamptz, timestamptz)',
        'public.order_reversal_allocate(text)',
        'public.order_reversal_allocate_manual(text, jsonb, text, text)',
        'public.artist_royalty_reconciliation(timestamptz, timestamptz)',
        'public.artist_royalty_statement(timestamptz, timestamptz, text)',
        'public.order_reversal_backfill(jsonb, boolean)'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;

-- ── Verifying, after applying ───────────────────────────────────────────────
--   -- must be empty in this codebase; anything here blocks a payout
--   select public.artist_royalty_reconciliation(
--       '2026-10-01'::timestamptz, '2027-01-01'::timestamptz) -> 'blocking';
--
--   -- the one flag accounting reads before paying anybody
--   select public.artist_royalty_statement(
--       '2026-10-01'::timestamptz, '2027-01-01'::timestamptz, null) -> 'payoutReady';
