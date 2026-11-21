-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — EV for Artists: the royalty on net profit
-- ─────────────────────────────────────────────────────────────────────────────
-- Follows 20261120090000_royalty_staging_verification.sql. The proposed
-- royalty is now 12% of the NET PROFIT from sales of the artist's specific
-- design (one SKU), and this file makes the statement compute exactly that:
--
--   sales       what was actually paid for the design after discounts, less
--               refunds and chargebacks — net of VAT, separately charged
--               shipping excluded. (Unchanged: the existing net-merchandise
--               base and reversal allocation.)
--   deductions  documented manufacturing, printing, packaging and
--               payment-processing costs attributable to the units sold.
--               Nothing else: ETERNAL VOID bears sampling, marketing and
--               general overhead, and the category check refuses them.
--   profit      sales − deductions
--   royalty     12% of profit (the agreement's royalty_bps), after any
--               balance carried in from an earlier period
--
-- Worked example, tested in tests/royalty-reconciliation/net-profit.mjs:
-- €1,000 sales − €400 costs = €600 profit → €72 at 12%.
--
-- EACH COST ONCE. A cost is recorded in one of two shapes:
--   per_unit    an amount per unit sold, for units paid within a window
--               (e.g. the manufacturing invoice's unit price). Charged on
--               exactly the units in the statement, so a unit's cost is
--               counted in the period it sold and never again. Two per-unit
--               rates for the same design and category may not overlap.
--   attributed  one documented amount attributable to the units sold on a
--               given date (e.g. the payment processor's fee for those
--               orders). Counted in the single statement period that holds
--               that date.
-- The same document cannot be entered twice for the same design and
-- category. When deductions and reversals exceed sales, the excess is
-- carried forward once against that design's next period (the existing
-- carry mechanism), so a cost is neither lost nor counted twice.
--
-- NO SILENT OVERPAYMENT. A period with sales of a design is not payout-ready
-- until someone has attested that the design's costs for the whole period
-- are recorded — a missing invoice would otherwise read as a zero deduction
-- and overpay the royalty.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══ 1 · Costs ════════════════════════════════════════════════════════════════
create table if not exists public.artist_royalty_costs (
    id              uuid primary key default gen_random_uuid(),
    sku             text not null,
    category        text not null,
    basis           text not null,
    -- Minor units, positive. Per unit when basis = per_unit, the whole
    -- documented amount when basis = attributed.
    amount          integer not null check (amount > 0),
    -- per_unit:   units paid on applies_from .. applies_to (open-ended if null)
    -- attributed: the date of the units sold it is attributable to
    applies_from    date not null,
    applies_to      date,
    -- The invoice, receipt or processor report the figure comes from.
    evidence_ref    text not null,
    note            text,
    created_at      timestamptz not null default now(),
    created_by      text not null,

    constraint artist_royalty_costs_category check (
        category in ('manufacturing', 'printing', 'packaging', 'payment_processing')),
    constraint artist_royalty_costs_basis check (basis in ('per_unit', 'attributed')),
    constraint artist_royalty_costs_shape check (
        (basis = 'attributed' and applies_to is null)
        or (basis = 'per_unit' and (applies_to is null or applies_to >= applies_from))),
    constraint artist_royalty_costs_evidence check (length(btrim(evidence_ref)) > 0),
    -- One document, one entry, per design and category.
    constraint artist_royalty_costs_once unique (sku, category, evidence_ref)
);

create index if not exists artist_royalty_costs_sku_idx
    on public.artist_royalty_costs (sku, applies_from);

-- Two per-unit rates for the same design and category over the same days
-- would charge every unit twice. Refused at the door.
create or replace function public.artist_royalty_costs_no_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.basis = 'per_unit' and exists (
        select 1 from public.artist_royalty_costs c
         where c.id <> new.id
           and c.sku = new.sku and c.category = new.category and c.basis = 'per_unit'
           and c.applies_from <= coalesce(new.applies_to, 'infinity'::date)
           and new.applies_from <= coalesce(c.applies_to, 'infinity'::date)
    ) then
        raise exception 'overlapping per-unit % cost for %', new.category, new.sku
            using errcode = 'exclusion_violation';
    end if;
    return new;
end $$;

drop trigger if exists artist_royalty_costs_no_overlap on public.artist_royalty_costs;
create trigger artist_royalty_costs_no_overlap
    before insert or update on public.artist_royalty_costs
    for each row execute function public.artist_royalty_costs_no_overlap();

-- Recording one, with the refusal explained rather than thrown.
create or replace function public.artist_royalty_cost_record(
    p_sku text, p_category text, p_basis text, p_amount integer,
    p_applies_from date, p_applies_to date, p_evidence_ref text,
    p_actor text, p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_id uuid;
begin
    if p_category not in ('manufacturing', 'printing', 'packaging', 'payment_processing') then
        -- Sampling, marketing and general overhead are ETERNAL VOID's.
        return jsonb_build_object('ok', false, 'error', 'category_not_deductible');
    end if;
    insert into public.artist_royalty_costs (
        sku, category, basis, amount, applies_from, applies_to, evidence_ref, note, created_by)
    values (btrim(p_sku), p_category, p_basis, p_amount, p_applies_from,
            case when p_basis = 'attributed' then null else p_applies_to end,
            btrim(p_evidence_ref), nullif(btrim(coalesce(p_note, '')), ''),
            left(coalesce(p_actor, 'unknown'), 320))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
exception
    when unique_violation then return jsonb_build_object('ok', false, 'error', 'already_recorded');
    when exclusion_violation then return jsonb_build_object('ok', false, 'error', 'overlapping_rate');
    when check_violation then return jsonb_build_object('ok', false, 'error', 'invalid_cost');
end $$;

-- ══ 2 · Cost attestation ═════════════════════════════════════════════════════
-- "Every documented cost of this design for this window is recorded." A null
-- sku attests every design for the window.
create table if not exists public.artist_royalty_cost_attestations (
    id              uuid primary key default gen_random_uuid(),
    sku             text,
    covers_from     timestamptz not null,
    covers_to       timestamptz not null,
    attested_at     timestamptz not null default now(),
    attested_by     text not null,
    note            text,
    constraint artist_royalty_cost_attestations_window check (covers_to > covers_from)
);

create or replace function public.artist_royalty_costs_attest(
    p_sku text, p_from timestamptz, p_to timestamptz, p_actor text, p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
    insert into public.artist_royalty_cost_attestations (sku, covers_from, covers_to, attested_by, note)
    values (nullif(btrim(coalesce(p_sku, '')), ''), p_from, p_to,
            left(coalesce(p_actor, 'unknown'), 320), nullif(btrim(coalesce(p_note, '')), ''));
    return jsonb_build_object('ok', true);
exception when check_violation then
    return jsonb_build_object('ok', false, 'error', 'bad_period');
end $$;

-- ══ 3 · The statement, on net profit ═════════════════════════════════════════
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
        o.order_number, o.paid_at, o.currency,
        i.product_name, i.quantity, i.line_amount,
        coalesce(public.artist_royalty_net_merchandise(
            i.line_amount, o.shipping_address ->> 'country', o.paid_at), 0) as net_merch
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
reversals as (
    select
        c.artist_email, c.sku, c.royalty_bps,
        r.provider_ref, r.kind, r.status, r.refunded_at,
        r.allocation_state, r.allocation_rule,
        coalesce(public.artist_royalty_net_merchandise(
            a.amount, o.shipping_address ->> 'country', o.paid_at), 0) as amount,
        a.amount as gross_amount,
        o.order_number, i.product_name
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
unattributed as (
    select r.provider_ref, r.amount, r.refunded_at, o.order_number
      from public.order_refunds r join public.orders o on o.id = r.order_id
     where r.status in ('pending', 'succeeded')
       and r.allocation_state = 'unallocated'
       and r.refunded_at >= p_from and r.refunded_at < p_to
),
-- Per-unit costs on exactly the units in this statement, and attributed
-- costs whose date falls in this period. Each row is one cost, once.
cost_lines as (
    select e.artist_email, e.sku, k.category, k.basis, k.evidence_ref,
           e.order_number, e.quantity as units, k.amount as unit_amount,
           (k.amount * e.quantity) as amount, e.paid_at::date as attributable_on
      from eligible e
      join public.artist_royalty_costs k
        on k.sku = e.sku and k.basis = 'per_unit'
       and e.paid_at::date >= k.applies_from
       and (k.applies_to is null or e.paid_at::date <= k.applies_to)
    union all
    select c.artist_email, k.sku, k.category, k.basis, k.evidence_ref,
           null, null, null, k.amount, k.applies_from
      from public.artist_royalty_costs k
      join (select distinct artist_email, sku from public.artist_collaborations
             where channel = 'direct'
               and (p_artist_email is null or artist_email = lower(btrim(p_artist_email)))) c
        on c.sku = k.sku
     where k.basis = 'attributed'
       and k.applies_from >= p_from::date and k.applies_from < p_to::date
),
cost_per_sku as (
    select l.artist_email, l.sku,
           (select max(c.royalty_bps) from public.artist_collaborations c
             where c.sku = l.sku and c.artist_email = l.artist_email and c.channel = 'direct') as royalty_bps,
           sum(amount) as deductions,
           sum(amount) filter (where category = 'manufacturing')      as manufacturing,
           sum(amount) filter (where category = 'printing')           as printing,
           sum(amount) filter (where category = 'packaging')          as packaging,
           sum(amount) filter (where category = 'payment_processing') as payment_processing
      from cost_lines l group by l.artist_email, l.sku
),
-- A carry applies in the period its applies_from falls in. The earlier rule
-- (applies_from >= p_from and applies_to <= p_to) never matched across a
-- year end: a Q4 carry spans Q4's 92 days and cannot fit inside Q1's 90, so
-- it was silently never deducted and Q1 was overpaid.
carried as (
    select artist_email, sku, sum(amount) as carried
      from public.artist_royalty_adjustments
     where consumed_at is null
       and applies_from >= p_from and applies_from < p_to
       and (p_artist_email is null or artist_email = lower(btrim(p_artist_email)))
     group by artist_email, sku
),
per_sku as (
    select artist_email, sku, royalty_bps,
           max(agreement_ref) as agreement_ref,
           sum(quantity) as units, sum(net_merch) as gross,
           sum(line_amount) as gross_gross
      from eligible group by artist_email, sku, royalty_bps
),
rev_per_sku as (
    select artist_email, sku, royalty_bps,
           sum(amount) as reversed, count(*) as reversal_count
      from reversals group by artist_email, sku, royalty_bps
),
-- Every design with a sale, a reversal or a cost in the period — a period
-- with costs and no sales still has to carry those costs forward.
keys as (
    select artist_email, sku, royalty_bps from per_sku
    union select artist_email, sku, royalty_bps from rev_per_sku
    union select artist_email, sku, royalty_bps from cost_per_sku
),
joined as (
    select
        k.artist_email, k.sku, k.royalty_bps,
        p.agreement_ref,
        coalesce(p.units, 0)          as units,
        coalesce(p.gross, 0)          as gross,
        coalesce(p.gross_gross, 0)    as gross_inc_vat,
        coalesce(r.reversed, 0)       as reversed,
        coalesce(r.reversal_count, 0) as reversal_count
      from keys k
      left join per_sku p     on p.artist_email = k.artist_email and p.sku = k.sku and p.royalty_bps = k.royalty_bps
      left join rev_per_sku r on r.artist_email = k.artist_email and r.sku = k.sku and r.royalty_bps = k.royalty_bps
),
with_costs as (
    select j.*,
           coalesce(k.carried, 0)              as carried_in,
           coalesce(d.deductions, 0)           as deductions,
           coalesce(d.manufacturing, 0)        as manufacturing,
           coalesce(d.printing, 0)             as printing,
           coalesce(d.packaging, 0)            as packaging,
           coalesce(d.payment_processing, 0)   as payment_processing,
           exists (
               select 1 from public.artist_royalty_cost_attestations t
                where (t.sku is null or t.sku = j.sku)
                  and t.covers_from <= p_from and t.covers_to >= p_to
           ) as costs_attested
      from joined j
      left join carried k on k.artist_email = j.artist_email
                         and coalesce(k.sku, '') = coalesce(j.sku, '')
      left join cost_per_sku d on d.artist_email = j.artist_email and d.sku = j.sku
                              and d.royalty_bps = j.royalty_bps
),
per_sku_due as (
    select *,
           (gross - reversed)                                        as sales,
           (gross - reversed - deductions)                           as profit,
           greatest(gross - reversed - deductions - carried_in, 0)   as base,
           greatest(deductions + reversed + carried_in - gross, 0)   as carry,
           round(greatest(gross - reversed - deductions - carried_in, 0)::numeric
                 * royalty_bps / 10000)                              as due
      from with_costs
),
per_artist as (
    select artist_email,
           max(agreement_ref) as agreement_ref,
           sum(units) as units, sum(gross) as gross, sum(gross_inc_vat) as gross_inc_vat,
           sum(reversed) as reversed, sum(reversal_count) as reversal_count,
           sum(sales) as sales, sum(deductions) as deductions, sum(profit) as profit,
           sum(carried_in) as carried_in,
           sum(base) as base, sum(carry) as carry, sum(due) as due,
           bool_and(costs_attested) as costs_attested
      from per_sku_due group by artist_email
),
recon as (select public.artist_royalty_reconciliation(p_from, p_to) as r)
select jsonb_build_object(
    'ok', true,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'currency', 'eur',
    'royaltyBasis', 'net_profit',
    'vatBasis', (select vat_basis from public.artist_royalty_settings where id),
    'reconciliation', (select r from recon),
    'costsUnattested', coalesce((select jsonb_agg(distinct sku) from per_sku_due where not costs_attested), '[]'::jsonb),
    -- Reconciled AND every design's costs attested for the period.
    'payoutReady', ((select r->>'status' from recon) = 'clean'
                    and not exists (select 1 from per_sku_due where not costs_attested)),
    'unattributedReversals', coalesce((select jsonb_agg(to_jsonb(u)) from unattributed u), '[]'::jsonb),
    'unattributedTotal', coalesce((select sum(amount) from unattributed), 0),
    'artists', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', a.artist_email,
            'artistName', (select max(artist_name) from eligible e where e.artist_email = a.artist_email),
            'creditName', (select max(credit_name) from eligible e where e.artist_email = a.artist_email),
            'agreementRef', a.agreement_ref,
            'units', a.units,
            'grossCharged', a.gross_inc_vat,
            'grossMerchandise', a.gross,
            'reversals', a.reversed,
            'reversalCount', a.reversal_count,
            'sales', a.sales,
            'deductions', a.deductions,
            'profit', a.profit,
            'carriedIn', a.carried_in,
            'royaltyBase', a.base,
            'carryForward', a.carry,
            'royaltyDue', a.due,
            'costsAttested', a.costs_attested,
            'perSku', (select jsonb_agg(jsonb_build_object(
                    'sku', s.sku, 'royaltyBps', s.royalty_bps, 'units', s.units,
                    'grossCharged', s.gross_inc_vat, 'grossMerchandise', s.gross,
                    'reversals', s.reversed, 'sales', s.sales,
                    'deductions', s.deductions,
                    'deductionsByCategory', jsonb_build_object(
                        'manufacturing', s.manufacturing, 'printing', s.printing,
                        'packaging', s.packaging, 'paymentProcessing', s.payment_processing),
                    'profit', s.profit, 'carriedIn', s.carried_in,
                    'royaltyBase', s.base, 'carryForward', s.carry, 'royaltyDue', s.due,
                    'costsAttested', s.costs_attested
                ) order by s.sku)
                from per_sku_due s where s.artist_email = a.artist_email)
        ) order by a.artist_email) from per_artist a), '[]'::jsonb),
    'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', artist_email, 'orderNumber', order_number, 'paidAt', paid_at,
            'sku', sku, 'productName', product_name, 'quantity', quantity,
            'charged', line_amount, 'netMerchandise', net_merch
        ) order by paid_at) from eligible), '[]'::jsonb),
    'reversalLines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', artist_email, 'orderNumber', order_number, 'sku', sku,
            'kind', kind, 'providerRef', provider_ref, 'refundedAt', refunded_at,
            'charged', gross_amount, 'amount', amount,
            'allocation', allocation_state, 'rule', allocation_rule
        ) order by refunded_at) from reversals), '[]'::jsonb),
    'costLines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', artist_email, 'sku', sku, 'category', category, 'basis', basis,
            'evidenceRef', evidence_ref, 'orderNumber', order_number, 'units', units,
            'unitAmount', unit_amount, 'amount', amount, 'attributableOn', attributable_on
        ) order by attributable_on, sku, category) from cost_lines), '[]'::jsonb)
);
$$;

-- The carry note now names both ways a period can go below zero.
create or replace function public.artist_royalty_raise_carry(
    p_from timestamptz, p_to timestamptz, p_actor text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_statement jsonb;
    v_artist    jsonb;
    v_sku       jsonb;
    v_raised    integer := 0;
    v_skipped   integer := 0;
    v_next_from timestamptz := p_to;
    v_next_to   timestamptz := p_to + (p_to - p_from);
begin
    v_statement := public.artist_royalty_statement(p_from, p_to, null);
    for v_artist in select * from jsonb_array_elements(v_statement -> 'artists') loop
        for v_sku in select * from jsonb_array_elements(v_artist -> 'perSku') loop
            if (v_sku ->> 'carryForward')::integer > 0 then
                begin
                    insert into public.artist_royalty_adjustments (
                        artist_email, sku, kind, amount,
                        arose_from, arose_to, applies_from, applies_to,
                        created_by, note
                    ) values (
                        v_artist ->> 'artistEmail', v_sku ->> 'sku', 'carry_forward',
                        (v_sku ->> 'carryForward')::integer,
                        p_from, p_to, v_next_from, v_next_to,
                        left(coalesce(p_actor, 'unknown'), 320),
                        'reversals and deductible costs exceeded sales in the originating period'
                    );
                    v_raised := v_raised + 1;
                exception when unique_violation then
                    v_skipped := v_skipped + 1;
                end;
            end if;
        end loop;
    end loop;
    return jsonb_build_object('ok', true, 'raised', v_raised, 'alreadyRaised', v_skipped,
                              'appliesFrom', v_next_from, 'appliesTo', v_next_to);
end $$;

-- Consuming follows the same rule as applying, so the balance a statement
-- deducted is the balance that is marked paid.
create or replace function public.artist_royalty_consume_carry(
    p_from timestamptz, p_to timestamptz, p_actor text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_n integer;
begin
    with consumed as (
        update public.artist_royalty_adjustments
           set consumed_at = now(),
               consumed_note = 'consumed by the statement for ' || p_from::date || '..' || p_to::date
                               || ' (' || left(coalesce(p_actor, 'unknown'), 320) || ')'
         where consumed_at is null
           and applies_from >= p_from and applies_from < p_to
        returning 1)
    select count(*) into v_n from consumed;
    return jsonb_build_object('ok', true, 'consumed', v_n);
end $$;

-- ══ Row level security and grants ════════════════════════════════════════════
alter table public.artist_royalty_costs              enable row level security;
alter table public.artist_royalty_cost_attestations  enable row level security;
revoke all on public.artist_royalty_costs, public.artist_royalty_cost_attestations
    from public, anon, authenticated;
grant select, insert, update, delete on public.artist_royalty_costs, public.artist_royalty_cost_attestations
    to service_role;

do $$
declare fn text;
begin
    foreach fn in array array[
        'public.artist_royalty_costs_no_overlap()',
        'public.artist_royalty_cost_record(text, text, text, integer, date, date, text, text, text)',
        'public.artist_royalty_costs_attest(text, timestamptz, timestamptz, text, text)',
        'public.artist_royalty_statement(timestamptz, timestamptz, text)',
        'public.artist_royalty_raise_carry(timestamptz, timestamptz, text)'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;
