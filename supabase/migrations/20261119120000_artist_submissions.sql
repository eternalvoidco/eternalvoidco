-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — EV for Artists
--
-- Follows 20261031120000_production_allocation_50.sql. Rerunnable: nothing here
-- drops or overwrites data.
--
-- Three things live here.
--
--   artist_submissions        one row per design sent in through /for-artists.
--                             Unpublished work by people who do not yet have a
--                             contract with us, so nothing in this table is
--                             reachable by a browser role at all — not with the
--                             anon key, not with a signed-in user's key. Every
--                             read and write goes through a Vercel function
--                             holding the service role.
--
--   artist_collaborations     which SKUs belong to which signed artist, at what
--                             rate, from when. The royalty export reads this and
--                             nothing else to decide what counts: a SKU that is
--                             not named here earns nothing, so a mistake is a
--                             missing payment that gets noticed rather than a
--                             silent overpayment that does not.
--
--   order_refunds             per-item reversals. orders.payment_status has a
--                             'refunded' value but no amount and no date, which
--                             cannot express a partial refund or one that lands
--                             in a later quarter — both of which the royalty
--                             terms have to handle. Written by the Stripe
--                             webhook; see the note on that below.
--
-- FILES ARE NOT IN THIS DATABASE. Uploads go to the private `artist-submissions`
-- storage bucket and only the path is recorded here. The bucket has no public
-- policy; reviewers reach a file through a short-lived signed URL minted by a
-- function that has already checked they are an admin.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══ Submissions ══════════════════════════════════════════════════════════════

create table if not exists public.artist_submissions (
    id                  uuid primary key default gen_random_uuid(),

    -- What the artist is given and quotes back to us. A label, never an
    -- authorisation: knowing a reference grants nothing.
    reference           text not null,

    -- draft        created, file not yet confirmed. Never shown to a reviewer.
    -- received     complete and in the queue.
    -- under_review / shortlisted / declined   where review has got to.
    -- withdrawn    the artist asked us to stop. Files deleted, row kept.
    status              text not null default 'draft',

    -- ── the artist ──
    name                text not null,
    email               text not null,
    country             text not null,
    locale              text not null default 'en',

    -- ── the work ──
    title               text not null,
    description         text not null,
    portfolio_url       text,

    -- ── the file, in the private bucket ──
    file_path           text,
    file_name           text,
    file_size           integer,
    file_type           text,
    -- none | pending | stored | deleted
    file_state          text not null default 'none',

    -- ── what was agreed, and when ──
    -- The version of the Submission Terms the server served at the time, not
    -- whatever the browser claimed. Kept even after a withdrawal: it is the
    -- record of what both sides agreed to, and it protects both sides.
    terms_version       text not null,
    terms_accepted_at   timestamptz not null default now(),
    -- Separate from the terms, and never a condition of review.
    marketing_opt_in    boolean not null default false,

    -- Ties the confirm call to the row that minted the upload URL. A nonce,
    -- cleared the moment it is used.
    confirm_token       text,

    -- ── review ──
    -- Internal only. No artist-facing endpoint ever selects this column.
    reviewer_notes      text,
    status_changed_at   timestamptz,
    status_changed_by   text,

    receipt_sent_at     timestamptz,
    notified_at         timestamptz,
    withdrawn_at        timestamptz,
    files_deleted_at    timestamptz,

    -- Rate limiting without keeping an address: a salted hash, and the salt is
    -- an environment secret the database never sees.
    submit_ip_hash      text,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint artist_submissions_reference_unique unique (reference),
    constraint artist_submissions_status check (
        status in ('draft', 'received', 'under_review', 'shortlisted', 'declined', 'withdrawn')),
    constraint artist_submissions_file_state check (
        file_state in ('none', 'pending', 'stored', 'deleted')),
    constraint artist_submissions_email_normalised check (
        email = lower(btrim(email)) and length(email) between 3 and 320 and position('@' in email) > 1),
    constraint artist_submissions_sizes check (
        length(name) between 1 and 120
        and length(country) between 1 and 80
        and length(title) between 1 and 140
        and length(description) between 1 and 2000
        and (portfolio_url is null or length(portfolio_url) <= 500)),
    -- 15 MB, enforced here as well as in the function: the database is the
    -- last place a bad value can be stopped.
    constraint artist_submissions_file_size check (
        file_size is null or (file_size > 0 and file_size <= 15728640)),
    constraint artist_submissions_file_type check (
        file_type is null or file_type in ('application/pdf', 'image/jpeg', 'image/png'))
);

create index if not exists artist_submissions_status_idx
    on public.artist_submissions (status, created_at desc);
create index if not exists artist_submissions_email_idx
    on public.artist_submissions (email);
-- Drafts are swept; this is the index that sweep walks.
create index if not exists artist_submissions_draft_idx
    on public.artist_submissions (created_at) where status = 'draft';

drop trigger if exists artist_submissions_touch_updated_at on public.artist_submissions;
create trigger artist_submissions_touch_updated_at
    before update on public.artist_submissions
    for each row execute function public.touch_updated_at();

-- ── The audit trail ─────────────────────────────────────────────────────────
-- Who moved a submission, when, and from what. Append-only: there is no update
-- or delete grant on it for anybody, including the service role.
create table if not exists public.artist_submission_events (
    id              bigserial primary key,
    submission_id   uuid not null references public.artist_submissions(id) on delete cascade,
    at              timestamptz not null default now(),
    actor           text not null,
    action          text not null,
    from_status     text,
    to_status       text,
    detail          text
);

create index if not exists artist_submission_events_submission_idx
    on public.artist_submission_events (submission_id, at desc);

-- ══ Creating a submission ════════════════════════════════════════════════════
-- Called by /api/artist-submission after it has validated everything. Returns
-- the row id and reference. Starts as a draft: a submission with a file that
-- has not landed yet is not a submission anybody should be reading.
create or replace function public.artist_submission_create(
    p_reference text,
    p_name text,
    p_email text,
    p_country text,
    p_title text,
    p_description text,
    p_portfolio text,
    p_locale text,
    p_terms_version text,
    p_marketing boolean,
    p_file_name text,
    p_file_size integer,
    p_file_type text,
    p_file_path text,
    p_confirm_token text,
    p_ip_hash text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row public.artist_submissions%rowtype;
    v_has_file boolean := p_file_path is not null and length(btrim(p_file_path)) > 0;
begin
    insert into public.artist_submissions (
        reference, status, name, email, country, locale,
        title, description, portfolio_url,
        file_path, file_name, file_size, file_type, file_state,
        terms_version, marketing_opt_in, confirm_token, submit_ip_hash
    ) values (
        p_reference,
        -- Nothing to wait for without a file, so it joins the queue at once.
        case when v_has_file then 'draft' else 'received' end,
        left(btrim(p_name), 120),
        lower(btrim(p_email)),
        left(btrim(p_country), 80),
        coalesce(nullif(btrim(p_locale), ''), 'en'),
        left(btrim(p_title), 140),
        left(btrim(p_description), 2000),
        nullif(btrim(coalesce(p_portfolio, '')), ''),
        nullif(btrim(coalesce(p_file_path, '')), ''),
        nullif(btrim(coalesce(p_file_name, '')), ''),
        p_file_size,
        nullif(btrim(coalesce(p_file_type, '')), ''),
        case when v_has_file then 'pending' else 'none' end,
        p_terms_version,
        coalesce(p_marketing, false),
        case when v_has_file then p_confirm_token else null end,
        nullif(btrim(coalesce(p_ip_hash, '')), '')
    )
    returning * into v_row;

    insert into public.artist_submission_events (submission_id, actor, action, to_status, detail)
    values (v_row.id, 'artist', 'created', v_row.status,
            case when v_has_file then 'awaiting upload' else 'no file' end);

    return jsonb_build_object('ok', true, 'id', v_row.id, 'reference', v_row.reference, 'status', v_row.status);
end $$;

-- ══ Confirming the upload ════════════════════════════════════════════════════
-- The second half. The caller has already checked with storage that the object
-- is really there; this moves the row into the queue. Idempotent, so a client
-- that retries after a dropped response does not create a second anything.
create or replace function public.artist_submission_confirm(
    p_reference text, p_token text, p_size integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row public.artist_submissions%rowtype;
begin
    select * into v_row from public.artist_submissions
     where reference = btrim(p_reference) for update;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    -- Already confirmed: say so and change nothing.
    if v_row.status <> 'draft' then
        return jsonb_build_object('ok', true, 'already', true, 'id', v_row.id,
                                  'reference', v_row.reference, 'status', v_row.status);
    end if;

    if v_row.confirm_token is null or v_row.confirm_token <> p_token then
        return jsonb_build_object('ok', false, 'error', 'bad_token');
    end if;

    update public.artist_submissions
       set status = 'received',
           file_state = 'stored',
           file_size = coalesce(p_size, file_size),
           confirm_token = null
     where id = v_row.id
    returning * into v_row;

    insert into public.artist_submission_events (submission_id, actor, action, from_status, to_status)
    values (v_row.id, 'artist', 'upload confirmed', 'draft', 'received');

    return jsonb_build_object('ok', true, 'id', v_row.id, 'reference', v_row.reference, 'status', v_row.status);
end $$;

-- Marks a receipt or an atelier notification as sent. A send that fails is not
-- an error worth losing a submission over, so this is recorded separately and
-- can be retried.
create or replace function public.artist_submission_mark_sent(
    p_reference text, p_which text
)
returns void
language sql
set search_path = public
as $$
    update public.artist_submissions
       set receipt_sent_at = case when p_which = 'receipt' then now() else receipt_sent_at end,
           notified_at     = case when p_which = 'atelier' then now() else notified_at end
     where reference = btrim(p_reference);
$$;

-- ══ The reviewer's queue ═════════════════════════════════════════════════════
-- Drafts are never returned: an upload that never landed is not something to
-- read. Notes are included — this is the admin path, and the only one.
create or replace function public.artist_submissions_list(
    p_status text default null, p_limit integer default 100, p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'counts', (
            select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
              from (select status, count(*) as n
                      from public.artist_submissions
                     where status <> 'draft'
                     group by status) c
        ),
        'rows', coalesce((
            select jsonb_agg(row_to_json(s) order by s.created_at desc)
              from (
                select id, reference, status, name, email, country, locale,
                       title, description, portfolio_url,
                       file_name, file_type, file_size, file_state, file_path,
                       terms_version, terms_accepted_at, marketing_opt_in,
                       reviewer_notes, status_changed_at, status_changed_by,
                       receipt_sent_at, notified_at, withdrawn_at, files_deleted_at,
                       created_at
                  from public.artist_submissions
                 where status <> 'draft'
                   and (p_status is null or p_status = '' or status = p_status)
                 order by created_at desc
                 limit greatest(1, least(coalesce(p_limit, 100), 500))
                offset greatest(0, coalesce(p_offset, 0))
              ) s), '[]'::jsonb)
    );
$$;

-- Move a submission, optionally leaving a private note. Every call is written
-- to the audit trail with the reviewer's address.
create or replace function public.artist_submission_set_status(
    p_reference text, p_status text, p_actor text, p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row public.artist_submissions%rowtype;
    v_from text;
begin
    if p_status not in ('received', 'under_review', 'shortlisted', 'declined', 'withdrawn') then
        return jsonb_build_object('ok', false, 'error', 'bad_status');
    end if;

    select * into v_row from public.artist_submissions
     where reference = btrim(p_reference) and status <> 'draft' for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    v_from := v_row.status;

    update public.artist_submissions
       set status = p_status,
           status_changed_at = now(),
           status_changed_by = left(coalesce(p_actor, 'unknown'), 320),
           reviewer_notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), reviewer_notes),
           withdrawn_at = case when p_status = 'withdrawn' then now() else withdrawn_at end
     where id = v_row.id
    returning * into v_row;

    insert into public.artist_submission_events (submission_id, actor, action, from_status, to_status, detail)
    values (v_row.id, left(coalesce(p_actor, 'unknown'), 320), 'status', v_from, p_status,
            nullif(btrim(coalesce(p_note, '')), ''));

    return jsonb_build_object('ok', true, 'reference', v_row.reference, 'status', v_row.status,
                              'filePath', v_row.file_path, 'fileState', v_row.file_state);
end $$;

-- The withdrawal procedure, as the public page describes it: the submission is
-- marked withdrawn and the file record is cleared. The caller deletes the
-- object from storage first and passes `true` once it has; the row keeps the
-- fact that a submission existed, who it was from and which terms they
-- accepted, and nothing else.
create or replace function public.artist_submission_mark_files_deleted(
    p_reference text, p_actor text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row public.artist_submissions%rowtype;
begin
    select * into v_row from public.artist_submissions where reference = btrim(p_reference) for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

    update public.artist_submissions
       set file_state = 'deleted', file_path = null, files_deleted_at = now()
     where id = v_row.id;

    insert into public.artist_submission_events (submission_id, actor, action, detail)
    values (v_row.id, left(coalesce(p_actor, 'unknown'), 320), 'files deleted', v_row.file_name);

    return jsonb_build_object('ok', true, 'reference', v_row.reference);
end $$;

-- Drafts whose upload never landed. Returns the paths so the caller can clear
-- the objects too — a row and its object are always removed together, so a
-- failed upload leaves neither an unreadable submission nor an orphaned file.
create or replace function public.artist_submissions_sweep_drafts(p_older_than interval default interval '24 hours')
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_paths text[];
begin
    select coalesce(array_agg(file_path) filter (where file_path is not null), '{}')
      into v_paths
      from public.artist_submissions
     where status = 'draft' and created_at < now() - p_older_than;

    delete from public.artist_submissions
     where status = 'draft' and created_at < now() - p_older_than;

    return jsonb_build_object('ok', true, 'paths', to_jsonb(v_paths));
end $$;

-- Proportionate rate limiting: how many submissions this address or this
-- hashed caller has made in the window. The function decides what to do.
create or replace function public.artist_submission_recent(
    p_email text, p_ip_hash text, p_window interval default interval '1 hour'
)
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'byEmail', (select count(*) from public.artist_submissions
                     where email = lower(btrim(coalesce(p_email, '')))
                       and created_at > now() - p_window),
        'byCaller', (select count(*) from public.artist_submissions
                      where submit_ip_hash is not null
                        and submit_ip_hash = nullif(btrim(coalesce(p_ip_hash, '')), '')
                        and created_at > now() - p_window)
    );
$$;

-- ══ Collaborations and royalties ═════════════════════════════════════════════
-- The signed side. One row per SKU that a signed agreement puts a royalty on.
--
-- Nothing is inferred. A SKU earns a royalty because somebody wrote it here
-- after a contract was signed, with the rate that contract says and the date it
-- starts. The rate lives per row rather than in code so a renegotiated or
-- legacy agreement reports correctly without touching the export.
create table if not exists public.artist_collaborations (
    id              uuid primary key default gen_random_uuid(),
    submission_id   uuid references public.artist_submissions(id) on delete set null,

    artist_name     text not null,
    artist_email    text not null,
    -- The name the artist is credited under, which is not always their own.
    credit_name     text not null,

    agreement_ref   text not null,
    signed_at       date not null,

    -- The SKU as it appears on order_items.sku.
    sku             text not null,
    product_name    text,

    -- Basis points, so 12% is 1200 and nothing depends on a float. The public
    -- page proposes 1200; what is written here is what the agreement says.
    royalty_bps     integer not null,

    -- Sales outside this window earn nothing. `effective_to` null means open.
    effective_from  date not null,
    effective_to    date,

    -- 'direct' today. Wholesale, bundles and marketplaces get their own rows
    -- with their own terms once those channels have terms.
    channel         text not null default 'direct',

    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint artist_collaborations_rate check (royalty_bps between 0 and 10000),
    constraint artist_collaborations_window check (effective_to is null or effective_to >= effective_from),
    constraint artist_collaborations_sku_window unique (sku, channel, effective_from)
);

create index if not exists artist_collaborations_sku_idx on public.artist_collaborations (sku);

drop trigger if exists artist_collaborations_touch_updated_at on public.artist_collaborations;
create trigger artist_collaborations_touch_updated_at
    before update on public.artist_collaborations
    for each row execute function public.touch_updated_at();

-- ── Reversals ───────────────────────────────────────────────────────────────
-- orders.payment_status can say 'refunded' but cannot say how much or when, and
-- the royalty terms promise that a reversal is applied once, that a partial
-- reversal is honoured, and that one landing in a later quarter is applied to
-- that quarter. All three need an amount and a date per item.
--
-- WIRING NOTE: api/stripe-webhook.js does not write this table yet. Until it
-- does, the royalty export reports zero reversals and must not be used to pay
-- anybody. That is a launch dependency, listed in docs/royalty-model.md.
create table if not exists public.order_refunds (
    id              uuid primary key default gen_random_uuid(),
    order_id        uuid not null references public.orders(id) on delete cascade,
    order_item_id   uuid references public.order_items(id) on delete set null,

    -- Stripe's own id for the refund or dispute. Unique, so the same event
    -- arriving twice reverses the amount once — the duplicate-delivery case
    -- the webhook is expected to produce.
    provider_ref    text not null,
    kind            text not null default 'refund',

    -- Minor units, positive. The reversal, not the remaining balance.
    amount          integer not null check (amount > 0),
    currency        text not null default 'eur',

    -- When the money actually went back. This is the date the export buckets
    -- on, which is what makes a late reversal land in the right quarter.
    refunded_at     timestamptz not null,
    created_at      timestamptz not null default now(),

    constraint order_refunds_provider_unique unique (provider_ref),
    constraint order_refunds_kind check (kind in ('refund', 'chargeback'))
);

create index if not exists order_refunds_order_idx on public.order_refunds (order_id);
create index if not exists order_refunds_at_idx on public.order_refunds (refunded_at);

-- ══ The royalty statement ════════════════════════════════════════════════════
-- Everything the public page promises, computed in one place so the page, the
-- agreement and the payment cannot drift apart.
--
--   base       what was actually paid for the merchandise, after discounts
--   excluded   VAT and other sales taxes, and separately charged shipping —
--              neither is in line_amount to begin with, and neither is added
--   discounts  an order-level reduction (orders.subtotal_amount below the sum
--              of its line_amounts) is allocated across that order's eligible
--              items in proportion to their line_amount
--   reversals  refunds and chargebacks, applied once, partial amounts honoured,
--              bucketed on the date the reversal happened rather than the date
--              of the sale
--   not deducted  production, sampling, packaging, platform fees, payment fees,
--              marketing, overhead. None of them appear anywhere below.
--
-- Only paid orders count, and only items whose SKU is named in
-- artist_collaborations with a window covering the sale.
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
        c.sku, c.royalty_bps, c.channel,
        o.id                as order_id,
        o.order_number,
        o.currency,
        o.paid_at,
        i.id                as item_id,
        i.product_name,
        i.quantity,
        i.line_amount,
        -- The order-level discount this item carries, pro rata on line_amount.
        -- `greatest(…, 0)` because a subtotal above the sum of its lines is not
        -- a discount and must never become a negative deduction.
        round(
            greatest(o_lines.lines_total - o.subtotal_amount, 0)::numeric
            * (i.line_amount::numeric / nullif(o_lines.lines_total, 0))
        )                   as discount_alloc
      from public.order_items i
      join public.orders o          on o.id = i.order_id
      join lateral (
            select coalesce(sum(line_amount), 0) as lines_total
              from public.order_items where order_id = o.id
      ) o_lines on true
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
-- Reversals are matched to the agreement through the item they reverse, and
-- bucketed on when they happened — so one that lands after the quarter it
-- relates to is reported in the quarter it lands in, exactly once.
reversals as (
    select
        c.artist_email, c.sku, c.royalty_bps,
        r.provider_ref, r.kind, r.refunded_at, r.amount,
        o.order_number
      from public.order_refunds r
      join public.orders o      on o.id = r.order_id
      join public.order_items i on i.id = r.order_item_id
      join public.artist_collaborations c
            on c.sku = i.sku
           and c.channel = 'direct'
           and o.paid_at::date >= c.effective_from
           and (c.effective_to is null or o.paid_at::date <= c.effective_to)
     where r.refunded_at >= p_from and r.refunded_at < p_to
       and (p_artist_email is null or c.artist_email = lower(btrim(p_artist_email)))
),
per_artist as (
    select
        artist_email,
        max(artist_name)   as artist_name,
        max(credit_name)   as credit_name,
        max(agreement_ref) as agreement_ref,
        max(royalty_bps)   as royalty_bps,
        sum(quantity)      as units,
        sum(line_amount)   as gross,
        sum(discount_alloc) as discounts,
        sum(line_amount - discount_alloc) as base_before_reversals
      from eligible group by artist_email
),
per_artist_rev as (
    select artist_email, sum(amount) as reversed, count(*) as reversal_count
      from reversals group by artist_email
)
select jsonb_build_object(
    'ok', true,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'rate_note', 'royalty_bps is read per collaboration row, as signed; the public page proposes 1200 (12%).',
    'currency', 'eur',
    'artists', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', a.artist_email,
            'artistName', a.artist_name,
            'creditName', a.credit_name,
            'agreementRef', a.agreement_ref,
            'royaltyBps', a.royalty_bps,
            'units', a.units,
            'grossMerchandise', a.gross,
            'discounts', a.discounts,
            'reversals', coalesce(r.reversed, 0),
            'reversalCount', coalesce(r.reversal_count, 0),
            -- Never below zero inside one period: a quarter whose reversals
            -- exceed its sales carries the excess forward as a note for
            -- accounting rather than inventing a negative payment.
            'royaltyBase', greatest(a.base_before_reversals - coalesce(r.reversed, 0), 0),
            'carryForward', greatest(coalesce(r.reversed, 0) - a.base_before_reversals, 0),
            'royaltyDue', round(
                greatest(a.base_before_reversals - coalesce(r.reversed, 0), 0)::numeric
                * a.royalty_bps / 10000)
        ) order by a.artist_email)
          from per_artist a left join per_artist_rev r using (artist_email)), '[]'::jsonb),
    -- The lines behind the totals, so a statement can be checked rather than
    -- believed.
    'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', artist_email, 'orderNumber', order_number, 'paidAt', paid_at,
            'sku', sku, 'productName', product_name, 'quantity', quantity,
            'lineAmount', line_amount, 'discountAllocated', discount_alloc,
            'netMerchandise', line_amount - discount_alloc
        ) order by paid_at) from eligible), '[]'::jsonb),
    'reversalLines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'artistEmail', artist_email, 'orderNumber', order_number, 'sku', sku,
            'kind', kind, 'providerRef', provider_ref, 'refundedAt', refunded_at, 'amount', amount
        ) order by refunded_at) from reversals), '[]'::jsonb)
);
$$;

-- ══ Row level security and grants ════════════════════════════════════════════
-- Unpublished work by people with no contract with us. No browser role may
-- read or write any of it; there are deliberately no policies at all, so RLS
-- denies everything and only the service role (which bypasses it) gets through.
alter table public.artist_submissions       enable row level security;
alter table public.artist_submission_events enable row level security;
alter table public.artist_collaborations    enable row level security;
alter table public.order_refunds            enable row level security;

revoke all on table public.artist_submissions       from anon, authenticated;
revoke all on table public.artist_submission_events from anon, authenticated;
revoke all on table public.artist_collaborations    from anon, authenticated;
revoke all on table public.order_refunds            from anon, authenticated;

grant select, insert, update, delete on table public.artist_submissions    to service_role;
-- Append-only: no update, no delete, for anyone.
grant select, insert                 on table public.artist_submission_events to service_role;
grant usage, select on sequence public.artist_submission_events_id_seq       to service_role;
grant select, insert, update, delete on table public.artist_collaborations to service_role;
grant select, insert                 on table public.order_refunds         to service_role;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'public.artist_submission_create(text, text, text, text, text, text, text, text, text, boolean, text, integer, text, text, text, text)',
        'public.artist_submission_confirm(text, text, integer)',
        'public.artist_submission_mark_sent(text, text)',
        'public.artist_submissions_list(text, integer, integer)',
        'public.artist_submission_set_status(text, text, text, text)',
        'public.artist_submission_mark_files_deleted(text, text)',
        'public.artist_submissions_sweep_drafts(interval)',
        'public.artist_submission_recent(text, text, interval)',
        'public.artist_royalty_statement(timestamptz, timestamptz, text)'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;

-- ══ Storage ══════════════════════════════════════════════════════════════════
-- Private, 15 MB, three types. Created here so the bucket cannot be forgotten
-- and cannot be created public by accident. No storage.objects policies are
-- added for anon or authenticated, so the only way to a file is a signed URL
-- minted server-side by a function that has already checked for an admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artist-submissions', 'artist-submissions', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
   set public = false,
       file_size_limit = 15728640,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

-- ── Verifying, after applying ───────────────────────────────────────────────
--   select reference, status, file_state, created_at
--     from public.artist_submissions order by created_at desc limit 20;
--
--   -- must be false, and must stay false
--   select id, public from storage.buckets where id = 'artist-submissions';
--
--   -- must return zero rows: no browser role may reach the table
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'artist_submissions' and grantee in ('anon', 'authenticated');
--
--   -- a quarter, for one artist
--   select public.artist_royalty_statement('2026-10-01'::timestamptz,
--                                          '2027-01-01'::timestamptz, null);
