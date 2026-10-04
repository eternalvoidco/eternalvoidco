-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — newsletter subscribers
--
-- Follows 20261004120000_inventory.sql. Rerunnable: nothing here drops or
-- overwrites data.
--
-- One row per email address, whichever form it came through (the pre-order
-- popup or the footer newsletter form). `status` is the only thing a send
-- should read:
--
--   subscribed     explicit consent through a signup form; may be emailed
--   unsubscribed   asked to stop. Kept as a suppression record so the address
--                  is never emailed again — only a new, explicit signup through
--                  a form moves it back to subscribed.
--
-- Send drop notifications from the newsletter_audience view, which lists
-- subscribed addresses only.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.newsletter_subscribers (
    id                  uuid primary key default gen_random_uuid(),
    email               text not null,
    status              text not null default 'subscribed',

    -- Pre-order popup: the country the visitor chose or typed.
    country             text,
    -- Every form this address has signed up through: 'preorder', 'newsletter'.
    sources             text[] not null default '{}',
    -- Designs the visitor asked about from a sold-out piece ('levitate-tee', …).
    interests           text[] not null default '{}',

    -- The latest explicit consent: when, and through which form.
    consent_at          timestamptz,
    consent_source      text,

    unsubscribed_at     timestamptz,
    unsubscribe_source  text,
    -- Bearer token for the unsubscribe link in every email. 244 random bits
    -- from gen_random_uuid(), which is core Postgres (no extension schema).
    unsubscribe_token   text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),

    welcome_sent_at     timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint newsletter_subscribers_email_unique unique (email),
    constraint newsletter_subscribers_token_unique unique (unsubscribe_token),
    constraint newsletter_subscribers_email_normalised
        check (email = lower(btrim(email)) and length(email) between 3 and 320 and position('@' in email) > 1),
    constraint newsletter_subscribers_status
        check (status in ('subscribed', 'unsubscribed')),
    constraint newsletter_subscribers_consented
        check (status <> 'subscribed' or consent_at is not null)
);

create index if not exists newsletter_subscribers_status_idx on public.newsletter_subscribers (status);

drop trigger if exists newsletter_subscribers_touch_updated_at on public.newsletter_subscribers;
create trigger newsletter_subscribers_touch_updated_at
    before update on public.newsletter_subscribers
    for each row execute function public.touch_updated_at();

-- ── The list to send from ───────────────────────────────────────────────────
-- security_invoker: the view is read with the caller's privileges, so it can
-- never expose more than the table grants allow.
create or replace view public.newsletter_audience
with (security_invoker = true) as
    select email, country, interests, sources, consent_at, unsubscribe_token
      from public.newsletter_subscribers
     where status = 'subscribed';

-- ── Subscribe ───────────────────────────────────────────────────────────────
-- Called only after the visitor submitted a signup form, so this is explicit
-- consent and may move an unsubscribed address back to subscribed.
--
-- outcome: 'new' | 'resubscribed' | 'already_subscribed'
-- sendWelcome: true when the welcome email should go out — a new or returning
-- subscriber, or one whose welcome never went out or went out over a day ago.
-- Repeated submissions therefore cannot be used to flood an inbox.
create or replace function public.newsletter_subscribe(
    p_email text, p_source text, p_country text default null, p_interest text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_email    text := lower(btrim(coalesce(p_email, '')));
    v_source   text := btrim(coalesce(p_source, ''));
    v_country  text := nullif(left(btrim(coalesce(p_country, '')), 80), '');
    v_interest text := nullif(left(btrim(coalesce(p_interest, '')), 64), '');
    v_row      public.newsletter_subscribers%rowtype;
    v_outcome  text;
begin
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 320 then
        return jsonb_build_object('ok', false, 'error', 'invalid_email');
    end if;
    if v_source not in ('preorder', 'newsletter') then
        return jsonb_build_object('ok', false, 'error', 'invalid_source');
    end if;

    insert into public.newsletter_subscribers (email, status, country, sources, interests, consent_at, consent_source)
    values (v_email, 'subscribed', v_country, array[v_source],
            case when v_interest is null then '{}'::text[] else array[v_interest] end,
            now(), v_source)
    on conflict (email) do nothing
    returning * into v_row;

    if found then
        v_outcome := 'new';
    else
        select * into v_row from public.newsletter_subscribers where email = v_email for update;
        v_outcome := case when v_row.status = 'subscribed' then 'already_subscribed' else 'resubscribed' end;

        update public.newsletter_subscribers
           set status = 'subscribed',
               country = coalesce(v_country, country),
               sources = case when v_source = any(sources) then sources else sources || v_source end,
               interests = case when v_interest is null or v_interest = any(interests) then interests
                                else interests || v_interest end,
               consent_at = now(),
               consent_source = v_source
         where id = v_row.id
        returning * into v_row;
    end if;

    return jsonb_build_object(
        'ok', true,
        'outcome', v_outcome,
        'token', v_row.unsubscribe_token,
        'sendWelcome', v_outcome <> 'already_subscribed'
                       or v_row.welcome_sent_at is null
                       or v_row.welcome_sent_at < now() - interval '1 day'
    );
end $$;

create or replace function public.newsletter_welcome_sent(p_token text)
returns void
language sql
set search_path = public
as $$
    update public.newsletter_subscribers set welcome_sent_at = now() where unsubscribe_token = p_token;
$$;

-- ── Unsubscribe ─────────────────────────────────────────────────────────────
-- By token (the link in an email) or by address (the unsubscribe page). An
-- address that was never on the list is still recorded as unsubscribed, so it
-- is suppressed if it is ever added another way.
--
-- outcome: 'unsubscribed' | 'already_unsubscribed' | 'not_found' (token only)
create or replace function public.newsletter_unsubscribe(p_token text, p_email text, p_source text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row    public.newsletter_subscribers%rowtype;
    v_email  text := lower(btrim(coalesce(p_email, '')));
    v_source text := left(coalesce(p_source, 'unknown'), 40);
begin
    if nullif(btrim(coalesce(p_token, '')), '') is not null then
        select * into v_row from public.newsletter_subscribers where unsubscribe_token = btrim(p_token) for update;
        if not found then
            return jsonb_build_object('ok', true, 'outcome', 'not_found');
        end if;
    else
        if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 320 then
            return jsonb_build_object('ok', false, 'error', 'invalid_email');
        end if;
        insert into public.newsletter_subscribers (email, status, unsubscribed_at, unsubscribe_source)
        values (v_email, 'unsubscribed', now(), v_source)
        on conflict (email) do nothing
        returning * into v_row;
        if found then
            return jsonb_build_object('ok', true, 'outcome', 'unsubscribed');
        end if;
        select * into v_row from public.newsletter_subscribers where email = v_email for update;
    end if;

    if v_row.status = 'unsubscribed' then
        return jsonb_build_object('ok', true, 'outcome', 'already_unsubscribed');
    end if;

    update public.newsletter_subscribers
       set status = 'unsubscribed', unsubscribed_at = now(), unsubscribe_source = v_source
     where id = v_row.id;
    return jsonb_build_object('ok', true, 'outcome', 'unsubscribed');
end $$;

-- ── Counts for the dashboard ────────────────────────────────────────────────
create or replace function public.newsletter_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'subscribed', (select count(*) from public.newsletter_subscribers where status = 'subscribed'),
        'unsubscribed', (select count(*) from public.newsletter_subscribers where status = 'unsubscribed'),
        'interests', coalesce((
            select jsonb_object_agg(interest, n)
              from (select unnest(interests) as interest, count(*) as n
                      from public.newsletter_subscribers
                     where status = 'subscribed'
                     group by 1) t), '{}'::jsonb)
    );
$$;

-- ── Row level security and grants ───────────────────────────────────────────
alter table public.newsletter_subscribers enable row level security;
-- No policies: no browser role can read or write subscribers.

revoke all on table public.newsletter_subscribers from anon, authenticated;
revoke all on table public.newsletter_audience    from anon, authenticated;
grant select, insert, update on table public.newsletter_subscribers to service_role;
grant select                 on table public.newsletter_audience    to service_role;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'public.newsletter_subscribe(text, text, text, text)',
        'public.newsletter_welcome_sent(text)',
        'public.newsletter_unsubscribe(text, text, text)',
        'public.newsletter_stats()'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;

-- ── Verifying, after applying ───────────────────────────────────────────────
--   select email, status, sources, interests, consent_at, unsubscribed_at
--     from public.newsletter_subscribers order by created_at desc;
--
--   select count(*) from public.newsletter_audience;   -- who a send would reach
