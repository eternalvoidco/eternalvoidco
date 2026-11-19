-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — royalty: staging verification
--
-- Follows 20261119180000_artist_intake_hardening.sql. Four things, each of
-- which is the difference between a number that looks right and one somebody
-- can sign off.
--
--   1 · THE VAT BASIS IS UNKNOWN, AND THAT NOW BLOCKS.
--       api/_catalog.js says it outright: "No tax model exists in this project
--       and product prices carry no stated tax treatment." orders.tax_amount is
--       always 0, there is no invoice anywhere in the project, and nothing on
--       the storefront tells a customer whether a price includes VAT.
--
--       So nobody can say today whether order_items.line_amount is VAT-exclusive
--       or VAT-inclusive — and the answer moves the royalty by the whole VAT
--       rate. At Hungarian 27%, a €160 line is either €160 of net product sales
--       (royalty €19.20) or €125.98 of net product sales inside a VAT-inclusive
--       price (royalty €15.12). Paying the first when the second is true pays
--       the artist a share of tax remitted to the state.
--
--       Previously the export silently assumed exclusive. It now refuses: until
--       accounting records a basis, every period carrying eligible sales is
--       blocked. An assumption nobody made on purpose is not a basis.
--
--   2 · unique_line_match IS WITHDRAWN. It allocated a reversal to the one line
--       whose total equalled it. On a mixed cart that is a guess wearing a
--       rule's clothes: a €90 partial refund against a €160 piece is
--       indistinguishable, from the amounts alone, from a full refund of the
--       €90 piece beside it — and the two pay different artists. Stripe holds
--       no item-level evidence for this integration, so the only honest
--       answers are the exact readings and the manual worklist. A new
--       `metadata` rule accepts genuine item-level evidence when a refund
--       carries it.
--
--   3 · PAYOUT READINESS NOW REQUIRES POSITIVE EVIDENCE. A period with no
--       recorded reversals used to look clean. It is indistinguishable from a
--       period whose reversals were never ingested — a webhook only ever sees
--       what happens after it is switched on. Coverage is now attested
--       explicitly by the historical dry run, and a period not fully covered
--       cannot be paid.
--
--   4 · A CARRIED BALANCE IS A LEDGER ENTRY, NOT A NOTE. Carry-forward was
--       reported and then forgotten. It is now an adjustment row that can be
--       raised once and consumed once, and the statement applies it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══ 0 · Columns the rest of this file needs ══════════════════════════════════

-- Item-level evidence carried by the reversal itself, when there is any. Shape:
--   {"lines": [{"sku": "EV-A", "amount": 9000}, …]}
-- Stripe knows nothing about lines for this integration, so this is only ever
-- populated for refunds ETERNAL VOID issues itself, which can say what they
-- were refunding. It is validated against the order before it is believed.
alter table public.order_refunds
    add column if not exists evidence jsonb;

-- A dispute moves money twice and the two moments are different dates. Both are
-- kept so the accounting decision about which one a statement buckets on can be
-- made — and changed — without re-ingesting anything from Stripe.
--
--   refunded_at           what the statement buckets on today: the dispute's
--                         own created date, which is when the funds left.
--   funds_withdrawn_at    when Stripe reported the withdrawal.
--   funds_reinstated_at   when a won dispute returned them.
--
-- PENDING ACCOUNTING: whether a reinstatement should reverse the original
-- period's figure (restating a closed quarter) or land in the quarter it
-- occurred. Today it restates, because refunded_at does not move. See
-- docs/royalty-model.md.
alter table public.order_refunds
    add column if not exists funds_withdrawn_at timestamptz;
alter table public.order_refunds
    add column if not exists funds_reinstated_at timestamptz;

-- ══ 1 · The VAT basis ════════════════════════════════════════════════════════
-- One row, set by accounting, naming what order_items.line_amount actually is.
--
--   unknown    nobody has said. Every period with eligible sales is BLOCKED.
--   exclusive  line_amount carries no VAT. Royalty base = line_amount.
--   inclusive  line_amount includes VAT at the rate in artist_vat_rates for the
--              order's destination. Royalty base = line_amount / (1 + rate).
--
-- Recorded with who said so and when, because this is the single assumption
-- that moves every figure on every statement.
create table if not exists public.artist_royalty_settings (
    id              boolean primary key default true,
    vat_basis       text not null default 'unknown',
    -- The agreement's own words, so the setting and the contract can be
    -- compared without opening two documents.
    basis_note      text,
    set_by          text,
    set_at          timestamptz,
    updated_at      timestamptz not null default now(),

    constraint artist_royalty_settings_singleton check (id),
    constraint artist_royalty_settings_basis check (vat_basis in ('unknown', 'exclusive', 'inclusive'))
);

insert into public.artist_royalty_settings (id, vat_basis)
values (true, 'unknown') on conflict (id) do nothing;

drop trigger if exists artist_royalty_settings_touch on public.artist_royalty_settings;
create trigger artist_royalty_settings_touch
    before update on public.artist_royalty_settings
    for each row execute function public.touch_updated_at();

-- Only consulted when the basis is 'inclusive'. Destination country, because
-- under EU distance selling the rate follows the customer, not the seller.
-- '*' is the fallback when no country-specific row applies.
create table if not exists public.artist_vat_rates (
    id              uuid primary key default gen_random_uuid(),
    country         text not null,
    rate_bps        integer not null,
    effective_from  date not null,
    effective_to    date,
    note            text,

    constraint artist_vat_rates_rate check (rate_bps between 0 and 10000),
    constraint artist_vat_rates_window check (effective_to is null or effective_to >= effective_from),
    constraint artist_vat_rates_once unique (country, effective_from)
);

-- Accounting's decision, written down with a name against it.
create or replace function public.artist_royalty_set_vat_basis(
    p_basis text, p_actor text, p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
    if p_basis not in ('unknown', 'exclusive', 'inclusive') then
        return jsonb_build_object('ok', false, 'error', 'bad_basis');
    end if;
    update public.artist_royalty_settings
       set vat_basis = p_basis,
           basis_note = nullif(btrim(coalesce(p_note, '')), ''),
           set_by = left(coalesce(p_actor, 'unknown'), 320),
           set_at = now()
     where id;
    return jsonb_build_object('ok', true, 'vatBasis', p_basis);
end $$;

-- The net-of-VAT merchandise amount for one line, under whatever basis is set.
-- Returns NULL when the basis is unknown or when an inclusive basis has no rate
-- for that order's destination — and NULL is what blocks the period, rather
-- than a number nobody chose.
create or replace function public.artist_royalty_net_merchandise(
    p_line_amount integer, p_country text, p_paid_at timestamptz
)
returns integer
language sql
stable
set search_path = public
as $$
    select case (select vat_basis from public.artist_royalty_settings where id)
        when 'exclusive' then p_line_amount
        when 'inclusive' then (
            select case when r.rate_bps is null then null
                   -- Integer minor units throughout. The VAT fraction is
                   -- removed, never added, because the price already holds it.
                   else round(p_line_amount::numeric * 10000 / (10000 + r.rate_bps))::integer end
              from (
                select rate_bps from public.artist_vat_rates
                 where (country = upper(btrim(coalesce(p_country, ''))) or country = '*')
                   and effective_from <= p_paid_at::date
                   and (effective_to is null or effective_to >= p_paid_at::date)
                 order by (country = '*'), effective_from desc
                 limit 1
              ) r
        )
        else null
    end;
$$;

-- ══ 3 · Coverage ═════════════════════════════════════════════════════════════
-- Positive evidence that a window's refunds and disputes were actually read
-- back from Stripe and reconciled, rather than merely never having arrived.
-- Written by the historical dry run when it is applied.
create table if not exists public.order_reversal_coverage (
    id              uuid primary key default gen_random_uuid(),
    covers_from     timestamptz not null,
    covers_to       timestamptz not null,
    attested_at     timestamptz not null default now(),
    attested_by     text not null,
    source          text not null default 'stripe_backfill',
    refunds_seen    integer not null default 0,
    disputes_seen   integer not null default 0,
    matched         integer not null default 0,
    unmatched       integer not null default 0,
    note            text,

    constraint order_reversal_coverage_window check (covers_to > covers_from)
);

create index if not exists order_reversal_coverage_window_idx
    on public.order_reversal_coverage (covers_from, covers_to);

-- Is every moment of [from, to) inside some attestation? Walks the attested
-- windows in order and refuses the first gap, so partial coverage is reported
-- as the gap it is rather than rounded up to "covered".
create or replace function public.order_reversal_coverage_gap(
    p_from timestamptz, p_to timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
    v_cursor timestamptz := p_from;
    v_row    record;
begin
    for v_row in
        select covers_from, covers_to from public.order_reversal_coverage
         where covers_to > p_from and covers_from < p_to
         order by covers_from
    loop
        if v_row.covers_from > v_cursor then
            return jsonb_build_object('covered', false,
                                      'gapFrom', v_cursor, 'gapTo', v_row.covers_from);
        end if;
        if v_row.covers_to > v_cursor then v_cursor := v_row.covers_to; end if;
        exit when v_cursor >= p_to;
    end loop;

    if v_cursor < p_to then
        return jsonb_build_object('covered', false, 'gapFrom', v_cursor, 'gapTo', p_to);
    end if;
    return jsonb_build_object('covered', true);
end $$;

-- ══ 4 · Adjustments ══════════════════════════════════════════════════════════
-- A carried balance, raised once and consumed once. The unique key is the
-- whole mechanism: raising the same carry twice is refused by the database, so
-- no amount of retrying a statement can double it.
create table if not exists public.artist_royalty_adjustments (
    id              uuid primary key default gen_random_uuid(),
    artist_email    text not null,
    sku             text,

    -- carry_forward  a negative balance raised in the period it arose
    -- manual         accounting correcting something, with a reason
    kind            text not null default 'carry_forward',

    -- Minor units, positive. A carry REDUCES the next period's base.
    amount          integer not null check (amount > 0),

    -- The period it arose in, and the period it is to be applied to.
    arose_from      timestamptz not null,
    arose_to        timestamptz not null,
    applies_from    timestamptz not null,
    applies_to      timestamptz not null,

    -- Set when a statement has actually consumed it.
    consumed_at     timestamptz,
    consumed_note   text,

    created_at      timestamptz not null default now(),
    created_by      text not null,
    note            text,

    -- Exactly once: one carry per artist, per SKU, per originating period.
    constraint artist_royalty_adjustments_once
        unique (artist_email, sku, kind, arose_from, arose_to),
    constraint artist_royalty_adjustments_kind check (kind in ('carry_forward', 'manual'))
);

create index if not exists artist_royalty_adjustments_apply_idx
    on public.artist_royalty_adjustments (artist_email, applies_from, applies_to);

-- Raises the carried balances a closed period produced. Idempotent by the
-- unique key, so running it twice over the same quarter raises nothing new.
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
                        'reversals exceeded sales in the originating period'
                    );
                    v_raised := v_raised + 1;
                exception when unique_violation then
                    -- Already raised for this period. Exactly once.
                    v_skipped := v_skipped + 1;
                end;
            end if;
        end loop;
    end loop;

    return jsonb_build_object('ok', true, 'raised', v_raised, 'alreadyRaised', v_skipped,
                              'appliesFrom', v_next_from, 'appliesTo', v_next_to);
end $$;

-- Marks the carries a statement has actually been paid against, so the same
-- balance cannot be consumed by a second payout of the same period.
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
           and applies_from >= p_from and applies_to <= p_to
        returning 1)
    select count(*) into v_n from consumed;
    return jsonb_build_object('ok', true, 'consumed', v_n);
end $$;

-- ══ 2 · Allocation, with the guess withdrawn ═════════════════════════════════
-- unique_line_match is gone. What remains is only what the amounts can prove,
-- plus genuine item-level evidence when a refund carries it.
--
--   not_required      the order holds no collaboration SKU
--   metadata          the refund itself names the lines and amounts. The only
--                     source of verified item-level evidence available, and it
--                     exists only for refunds this project issues itself
--   full_order        reversal == order total. Everything went back
--   full_merchandise  reversal == merchandise subtotal, shipping retained
--   sole_line         one line, no shipping: nothing else it could be
--
-- Everything else goes to the manual worklist. On a mixed cart a partial
-- refund is genuinely undecidable from amounts — a €90 refund against a €160
-- piece looks exactly like a full refund of the €90 piece beside it — and the
-- two pay different artists.
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
    v_rule     text;
    v_target   integer;
    v_meta     jsonb;
    v_entry    jsonb;
    v_sum      integer := 0;
    v_item     public.order_items%rowtype;
begin
    select * into v_row from public.order_refunds
     where provider_ref = btrim(p_provider_ref) for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

    -- A person's decision is never overwritten by a rule.
    if v_row.allocation_state = 'manual' then
        return jsonb_build_object('ok', true, 'outcome', 'manual_kept', 'allocationState', 'manual');
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

    if exists (select 1 from public.order_items
                where order_id = v_order.id and (sku is null or btrim(sku) = '')) then
        update public.order_refunds
           set allocation_state = 'unallocated', allocation_rule = null,
               allocation_note = 'order contains a line with no SKU',
               allocated_at = now(), allocated_by = 'rule'
         where id = v_row.id;
        return jsonb_build_object('ok', true, 'outcome', 'unallocated', 'reason', 'line_without_sku');
    end if;

    -- ── verified item-level evidence ────────────────────────────────────────
    -- Stripe refund metadata of the shape
    --   {"lines":[{"sku":"EV-A","amount":9000}, …]}
    -- written by whatever issued the refund. Validated against this order's own
    -- lines before a penny of it is believed.
    v_meta := v_row.evidence;
    if v_meta is not null and jsonb_typeof(v_meta -> 'lines') = 'array'
       and jsonb_array_length(v_meta -> 'lines') > 0 then
        v_sum := 0;
        for v_entry in select * from jsonb_array_elements(v_meta -> 'lines') loop
            select * into v_item from public.order_items
             where order_id = v_order.id and sku = (v_entry ->> 'sku') limit 1;
            if not found
               or (v_entry ->> 'amount')::integer <= 0
               or (v_entry ->> 'amount')::integer > v_item.line_amount then
                v_sum := -1;
                exit;
            end if;
            v_sum := v_sum + (v_entry ->> 'amount')::integer;
        end loop;

        if v_sum > 0 and v_sum <= v_row.amount then
            insert into public.order_refund_allocations (refund_id, order_item_id, amount)
            select v_row.id, i.id, (e ->> 'amount')::integer
              from jsonb_array_elements(v_meta -> 'lines') e
              join public.order_items i
                on i.order_id = v_order.id and i.sku = (e ->> 'sku');
            update public.order_refunds
               set allocation_state = 'auto', allocation_rule = 'metadata',
                   allocation_note = null, allocated_at = now(), allocated_by = 'rule'
             where id = v_row.id;
            return jsonb_build_object('ok', true, 'outcome', 'allocated', 'rule', 'metadata',
                                      'merchandiseReversed', v_sum);
        end if;
        -- Evidence that does not reconcile against the order is worse than
        -- none: it falls through to the worklist with its reason recorded.
        update public.order_refunds
           set allocation_note = 'refund metadata did not reconcile against this order''s lines'
         where id = v_row.id;
    end if;

    v_rule := null;
    if v_row.amount = v_order.total_amount then
        v_rule := 'full_order';       v_target := v_merch;
    elsif v_row.amount = v_merch then
        v_rule := 'full_merchandise'; v_target := v_merch;
    elsif v_lines = 1 and v_order.shipping_amount = 0
          and v_row.amount > 0 and v_row.amount <= v_merch then
        v_rule := 'sole_line';        v_target := v_row.amount;
    end if;

    if v_rule is null then
        update public.order_refunds
           set allocation_state = 'unallocated', allocation_rule = null,
               allocation_note = coalesce(allocation_note, '') ||
                   case when coalesce(allocation_note, '') = '' then '' else '; ' end ||
                   format('reversal %s matches neither the order total (%s), nor the merchandise subtotal (%s); on a cart of %s lines the amounts alone cannot say which line it came from',
                          v_row.amount, v_order.total_amount, v_merch, v_lines),
               allocated_at = now(), allocated_by = 'rule'
         where id = v_row.id;
        return jsonb_build_object('ok', true, 'outcome', 'unallocated', 'reason', 'ambiguous',
                                  'amount', v_row.amount, 'orderTotal', v_order.total_amount,
                                  'merchandise', v_merch, 'lines', v_lines);
    end if;

    if v_rule = 'sole_line' then
        insert into public.order_refund_allocations (refund_id, order_item_id, amount)
        select v_row.id, id, v_target from public.order_items where order_id = v_order.id;
    else
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

-- ══ Grants ═══════════════════════════════════════════════════════════════════
alter table public.artist_royalty_settings    enable row level security;
alter table public.artist_vat_rates           enable row level security;
alter table public.order_reversal_coverage    enable row level security;
alter table public.artist_royalty_adjustments enable row level security;

revoke all on table public.artist_royalty_settings    from anon, authenticated;
revoke all on table public.artist_vat_rates           from anon, authenticated;
revoke all on table public.order_reversal_coverage    from anon, authenticated;
revoke all on table public.artist_royalty_adjustments from anon, authenticated;

grant select, insert, update          on table public.artist_royalty_settings    to service_role;
grant select, insert, update, delete  on table public.artist_vat_rates           to service_role;
grant select, insert                  on table public.order_reversal_coverage    to service_role;
grant select, insert, update          on table public.artist_royalty_adjustments to service_role;

do $$
declare fn text;
begin
    foreach fn in array array[
        'public.artist_royalty_set_vat_basis(text, text, text)',
        'public.artist_royalty_net_merchandise(integer, text, timestamptz)',
        'public.order_reversal_coverage_gap(timestamptz, timestamptz)',
        'public.artist_royalty_raise_carry(timestamptz, timestamptz, text)',
        'public.artist_royalty_consume_carry(timestamptz, timestamptz, text)',
        'public.order_reversal_allocate(text)'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;

-- ── Verifying, after applying ───────────────────────────────────────────────
--   -- must be 'unknown' until accounting says otherwise, and must block
--   select vat_basis from public.artist_royalty_settings;
--
--   -- the gap between what the webhook has seen and what the period needs
--   select public.order_reversal_coverage_gap(
--       '2026-10-01'::timestamptz, '2027-01-01'::timestamptz);

-- ══ Recording a reversal: status must not regress ════════════════════════════
-- The existing guard refuses a delivery whose source timestamp is older than
-- what has been applied. It does not cover the tie: two handlers reading the
-- same object moments apart can carry the same event timestamp, and the slower
-- one then overwrites the faster one's newer status.
--
-- So the status itself is given a direction. `pending` is the only state that
-- may advance to anything; the four settled states never go back to it, and a
-- settled state is never replaced by a different settled state unless the
-- source timestamp is genuinely newer. A refund that has succeeded cannot
-- become pending again because a slow read finished last.
create or replace function public.order_reversal_rank(p_status text)
returns integer
language sql
immutable
as $$
    select case p_status
        when 'pending'    then 0
        when 'failed'     then 1
        when 'canceled'   then 1
        when 'succeeded'  then 2
        when 'reinstated' then 3
        else 0 end;
$$;

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
    p_source_updated_at timestamptz,
    p_evidence jsonb default null,
    p_funds_withdrawn_at timestamptz default null,
    p_funds_reinstated_at timestamptz default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_order    public.orders%rowtype;
    v_existing public.order_refunds%rowtype;
    v_row      public.order_refunds%rowtype;
    v_had      boolean := false;
    v_newer    boolean;
begin
    if p_status not in ('pending', 'succeeded', 'failed', 'canceled', 'reinstated') then
        return jsonb_build_object('ok', false, 'error', 'bad_status');
    end if;

    select * into v_order from public.orders
     where stripe_payment_intent_id = btrim(coalesce(p_payment_intent, ''));
    if not found then
        return jsonb_build_object('ok', false, 'error', 'order_not_found',
                                  'paymentIntent', p_payment_intent);
    end if;

    select * into v_existing from public.order_refunds
     where provider_ref = btrim(p_provider_ref) for update;
    v_had := found;

    if v_had then
        v_newer := p_source_updated_at is null
                   or v_existing.source_updated_at is null
                   or p_source_updated_at > v_existing.source_updated_at;

        -- Strictly older: nothing about it can be an improvement.
        if p_source_updated_at is not null
           and v_existing.source_updated_at is not null
           and p_source_updated_at < v_existing.source_updated_at then
            return jsonb_build_object('ok', true, 'outcome', 'stale',
                                      'reference', v_existing.provider_ref,
                                      'status', v_existing.status,
                                      'reason', 'older source timestamp');
        end if;

        -- Same moment, or no moment to compare: the status may still not go
        -- backwards. This is the concurrent-read case — two handlers, one slow.
        if not v_newer
           and public.order_reversal_rank(p_status)
             < public.order_reversal_rank(v_existing.status) then
            return jsonb_build_object('ok', true, 'outcome', 'stale',
                                      'reference', v_existing.provider_ref,
                                      'status', v_existing.status,
                                      'reason', 'status would regress');
        end if;
    end if;

    insert into public.order_refunds (
        order_id, provider_ref, provider_object, charge_id, payment_intent_id,
        kind, status, amount, currency, reason, refunded_at, source_updated_at,
        evidence, funds_withdrawn_at, funds_reinstated_at
    ) values (
        v_order.id, btrim(p_provider_ref), p_provider_object,
        nullif(btrim(coalesce(p_charge, '')), ''), btrim(p_payment_intent),
        p_kind, p_status, greatest(coalesce(p_amount, 0), 0),
        lower(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'eur')),
        nullif(btrim(coalesce(p_reason, '')), ''),
        coalesce(p_reversed_at, now()), p_source_updated_at,
        p_evidence, p_funds_withdrawn_at, p_funds_reinstated_at
    )
    on conflict (provider_ref) do update
       set status              = excluded.status,
           amount              = excluded.amount,
           reason              = coalesce(excluded.reason, public.order_refunds.reason),
           refunded_at         = excluded.refunded_at,
           charge_id           = coalesce(excluded.charge_id, public.order_refunds.charge_id),
           source_updated_at   = excluded.source_updated_at,
           evidence            = coalesce(excluded.evidence, public.order_refunds.evidence),
           funds_withdrawn_at  = coalesce(excluded.funds_withdrawn_at, public.order_refunds.funds_withdrawn_at),
           funds_reinstated_at = coalesce(excluded.funds_reinstated_at, public.order_refunds.funds_reinstated_at)
    returning * into v_row;

    return jsonb_build_object(
        'ok', true,
        'outcome', case when v_had then 'updated' else 'created' end,
        'id', v_row.id, 'orderId', v_order.id, 'orderNumber', v_order.order_number,
        'reference', v_row.provider_ref, 'status', v_row.status,
        'amount', v_row.amount, 'allocationState', v_row.allocation_state
    );
end $$;

-- ══ Reconciliation, with the new blockers ════════════════════════════════════
-- Three things join the list, and each is a thing nobody had positively
-- established rather than a thing that had gone wrong:
--
--   vatBasis        nobody has said what line_amount is net of
--   coverageGap     nothing has established that this period's reversals were
--                   ever read back from Stripe
--   currency        a non-EUR order in a statement that declares EUR
create or replace function public.artist_royalty_reconciliation(
    p_from timestamptz, p_to timestamptz
)
returns jsonb
language sql
stable
set search_path = public
as $$
with
scope as (
    select distinct o.id, o.order_number, o.paid_at, o.subtotal_amount,
           o.total_amount, o.currency, o.shipping_address ->> 'country' as country
      from public.orders o
      join public.order_items i on i.order_id = o.id
      join public.artist_collaborations c on c.sku = i.sku
     where o.payment_status = 'paid' and o.paid_at is not null
       and o.paid_at >= p_from and o.paid_at < p_to
),
settings as (select vat_basis from public.artist_royalty_settings where id),
-- The VAT question, asked of every order in scope. 'unknown' blocks the lot;
-- an 'inclusive' basis with no rate for a destination blocks that order alone.
vat_unresolved as (
    select s.order_number, s.country, s.paid_at
      from scope s
     where (select vat_basis from settings) = 'unknown'
        or public.artist_royalty_net_merchandise(
               (select coalesce(sum(line_amount), 0)::integer from public.order_items where order_id = s.id),
               s.country, s.paid_at) is null
),
wrong_currency as (
    select order_number, currency from scope where lower(currency) <> 'eur'
),
discount_anomalies as (
    select s.order_number, s.subtotal_amount,
           (select coalesce(sum(line_amount), 0) from public.order_items where order_id = s.id) as lines_total
      from scope s
     where s.subtotal_amount <> (select coalesce(sum(line_amount), 0)
                                   from public.order_items where order_id = s.id)
),
missing_sku as (
    select distinct s.order_number
      from scope s join public.order_items i on i.order_id = s.id
     where i.sku is null or btrim(i.sku) = ''
),
unallocated as (
    select r.provider_ref, r.kind, r.status, r.amount, r.refunded_at,
           r.allocation_note, o.order_number
      from public.order_refunds r join public.orders o on o.id = r.order_id
     where r.refunded_at >= p_from and r.refunded_at < p_to
       and r.status in ('pending', 'succeeded')
       and r.allocation_state = 'unallocated'
),
pending as (
    select r.provider_ref, r.amount, r.refunded_at, o.order_number
      from public.order_refunds r join public.orders o on o.id = r.order_id
     where r.refunded_at >= p_from and r.refunded_at < p_to and r.status = 'pending'
),
charge_overlaps as (
    select o.order_number, r.charge_id,
           sum(r.amount) filter (where r.provider_object = 'refund')  as refunded,
           sum(r.amount) filter (where r.provider_object = 'dispute') as disputed
      from public.order_refunds r join public.orders o on o.id = r.order_id
     where r.charge_id is not null and r.status in ('pending', 'succeeded')
       and r.refunded_at >= p_from and r.refunded_at < p_to
     group by o.order_number, r.charge_id
    having count(distinct r.provider_object) > 1
),
over_allocated as (
    select r.provider_ref, r.amount,
           (select coalesce(sum(amount), 0) from public.order_refund_allocations where refund_id = r.id) as allocated
      from public.order_refunds r
     where r.refunded_at >= p_from and r.refunded_at < p_to
       and (select coalesce(sum(amount), 0) from public.order_refund_allocations where refund_id = r.id) > r.amount
),
coverage as (select public.order_reversal_coverage_gap(p_from, p_to) as g),
-- A period with no sales at all needs no coverage: there is nothing a missing
-- reversal could reduce.
coverage_needed as (select (select count(*) from scope) > 0 as needed)
select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'ordersInScope', (select count(*) from scope),
    'vatBasis', (select vat_basis from settings),
    'coverage', (select g from coverage),
    'blocking', jsonb_build_object(
        'vatBasisUnresolved',   coalesce((select jsonb_agg(to_jsonb(v)) from vat_unresolved v), '[]'::jsonb),
        'currencyNotEur',       coalesce((select jsonb_agg(to_jsonb(w)) from wrong_currency w), '[]'::jsonb),
        'reversalHistoryNotAttested',
            case when (select needed from coverage_needed)
                      and not ((select g from coverage) ->> 'covered')::boolean
                 then (select g from coverage) else 'null'::jsonb end,
        'discountAnomalies',    coalesce((select jsonb_agg(to_jsonb(d)) from discount_anomalies d), '[]'::jsonb),
        'linesWithoutSku',      coalesce((select jsonb_agg(order_number) from missing_sku), '[]'::jsonb),
        'unallocatedReversals', coalesce((select jsonb_agg(to_jsonb(u)) from unallocated u), '[]'::jsonb),
        'overAllocated',        coalesce((select jsonb_agg(to_jsonb(x)) from over_allocated x), '[]'::jsonb)
    ),
    'review', jsonb_build_object(
        'pendingReversals',             coalesce((select jsonb_agg(to_jsonb(p)) from pending p), '[]'::jsonb),
        'refundAndDisputeOnSameCharge', coalesce((select jsonb_agg(to_jsonb(y)) from charge_overlaps y), '[]'::jsonb)
    ),
    'blockingCount',
        (select count(*) from vat_unresolved) + (select count(*) from wrong_currency)
      + (select count(*) from discount_anomalies) + (select count(*) from missing_sku)
      + (select count(*) from unallocated) + (select count(*) from over_allocated)
      + case when (select needed from coverage_needed)
                  and not ((select g from coverage) ->> 'covered')::boolean then 1 else 0 end,
    'reviewCount', (select count(*) from pending) + (select count(*) from charge_overlaps),
    'status', case
        when (select count(*) from vat_unresolved) + (select count(*) from wrong_currency)
           + (select count(*) from discount_anomalies) + (select count(*) from missing_sku)
           + (select count(*) from unallocated) + (select count(*) from over_allocated)
           + case when (select needed from coverage_needed)
                       and not ((select g from coverage) ->> 'covered')::boolean then 1 else 0 end > 0
            then 'blocked'
        when (select count(*) from pending) + (select count(*) from charge_overlaps) > 0
            then 'needs_review'
        else 'clean' end
);
$$;

-- ══ The royalty statement, net of VAT and net of carried balances ════════════
-- The base is no longer line_amount. It is line_amount put through
-- artist_royalty_net_merchandise, which is the identity under an 'exclusive'
-- basis and removes the embedded VAT under an 'inclusive' one — and is NULL
-- under 'unknown', which is what stops a period being paid rather than being
-- silently rounded to the exclusive reading.
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
-- A reversal is reduced by the same VAT fraction as the sale it reverses: a
-- refund of a VAT-inclusive price hands back the VAT too, and that part was
-- never the artist's to lose.
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
-- Balances raised by an earlier period and not yet consumed. A carry reduces
-- this period's base before the rate is applied, so the artist is made whole
-- on the rate rather than on the cash.
carried as (
    select artist_email, sku, sum(amount) as carried
      from public.artist_royalty_adjustments
     where consumed_at is null
       and applies_from >= p_from and applies_to <= p_to
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
joined as (
    select
        coalesce(p.artist_email, r.artist_email) as artist_email,
        coalesce(p.sku, r.sku)                   as sku,
        coalesce(p.royalty_bps, r.royalty_bps)   as royalty_bps,
        p.agreement_ref,
        coalesce(p.units, 0)          as units,
        coalesce(p.gross, 0)          as gross,
        coalesce(p.gross_gross, 0)    as gross_inc_vat,
        coalesce(r.reversed, 0)       as reversed,
        coalesce(r.reversal_count, 0) as reversal_count
      from per_sku p
      full outer join rev_per_sku r
        on r.artist_email = p.artist_email and r.sku = p.sku and r.royalty_bps = p.royalty_bps
),
with_carry as (
    select j.*, coalesce(k.carried, 0) as carried_in
      from joined j
      left join carried k on k.artist_email = j.artist_email
                         and coalesce(k.sku, '') = coalesce(j.sku, '')
),
per_sku_due as (
    select *,
           greatest(gross - reversed - carried_in, 0) as base,
           greatest(reversed + carried_in - gross, 0) as carry,
           round(greatest(gross - reversed - carried_in, 0)::numeric * royalty_bps / 10000) as due
      from with_carry
),
per_artist as (
    select artist_email,
           max(agreement_ref) as agreement_ref,
           sum(units) as units, sum(gross) as gross, sum(gross_inc_vat) as gross_inc_vat,
           sum(reversed) as reversed, sum(reversal_count) as reversal_count,
           sum(carried_in) as carried_in,
           sum(base) as base, sum(carry) as carry, sum(due) as due
      from per_sku_due group by artist_email
),
recon as (select public.artist_royalty_reconciliation(p_from, p_to) as r)
select jsonb_build_object(
    'ok', true,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'currency', 'eur',
    'vatBasis', (select vat_basis from public.artist_royalty_settings where id),
    'reconciliation', (select r from recon),
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
            'grossCharged', a.gross_inc_vat,
            'grossMerchandise', a.gross,
            'reversals', a.reversed,
            'reversalCount', a.reversal_count,
            'carriedIn', a.carried_in,
            'royaltyBase', a.base,
            'carryForward', a.carry,
            'royaltyDue', a.due,
            'perSku', (select jsonb_agg(jsonb_build_object(
                    'sku', s.sku, 'royaltyBps', s.royalty_bps, 'units', s.units,
                    'grossCharged', s.gross_inc_vat, 'grossMerchandise', s.gross,
                    'reversals', s.reversed, 'carriedIn', s.carried_in,
                    'royaltyBase', s.base, 'carryForward', s.carry, 'royaltyDue', s.due
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
        ) order by refunded_at) from reversals), '[]'::jsonb)
);
$$;

do $$
declare fn text;
begin
    foreach fn in array array[
        'public.order_reversal_rank(text)',
        'public.order_reversal_record(text, text, text, text, text, text, integer, text, text, timestamptz, timestamptz, jsonb, timestamptz, timestamptz)',
        'public.artist_royalty_reconciliation(timestamptz, timestamptz)',
        'public.artist_royalty_statement(timestamptz, timestamptz, text)'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;

-- The eleven-argument form is superseded by the fourteen-argument one above.
drop function if exists public.order_reversal_record(
    text, text, text, text, text, text, integer, text, text, timestamptz, timestamptz);

-- Written by the historical dry run when it is applied. The only thing that
-- can turn "no reversals recorded" into "no reversals exist".
create or replace function public.order_reversal_coverage_record(
    p_from timestamptz, p_to timestamptz, p_by text,
    p_refunds integer default 0, p_disputes integer default 0,
    p_matched integer default 0, p_unmatched integer default 0,
    p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_id uuid;
begin
    insert into public.order_reversal_coverage
        (covers_from, covers_to, attested_by, source, refunds_seen, disputes_seen,
         matched, unmatched, note)
    values (p_from, p_to, left(coalesce(p_by, 'unknown'), 320), 'stripe_backfill',
            greatest(coalesce(p_refunds, 0), 0), greatest(coalesce(p_disputes, 0), 0),
            greatest(coalesce(p_matched, 0), 0), greatest(coalesce(p_unmatched, 0), 0),
            nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id,
                              'coversFrom', p_from, 'coversTo', p_to);
end $$;

do $$ begin
    execute 'revoke all on function public.order_reversal_coverage_record(timestamptz, timestamptz, text, integer, integer, integer, integer, text) from public, anon, authenticated';
    execute 'grant execute on function public.order_reversal_coverage_record(timestamptz, timestamptz, text, integer, integer, integer, integer, text) to service_role';
end $$;
