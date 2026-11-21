-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — the EV for Artists opening announcement list
-- ─────────────────────────────────────────────────────────────────────────────
-- "Notify me" on /for-artists is a signup for one thing: the announcement that
-- artist submissions are open. It is its own list, with its own consent and
-- its own unsubscribe, and it is not the newsletter:
--
--   · a notify-only signup never creates, changes or reactivates a
--     newsletter_subscribers row, so nobody reaches the newsletter audience
--     without ticking the separate, unticked newsletter box (which uses the
--     newsletter's own path, unchanged);
--   · existing newsletter preferences are never touched from here;
--   · the earlier signups that reached newsletter_subscribers with no
--     interest recorded are left exactly as they are — unclassified.
--
-- Tokens start with 'ao' so /api/unsubscribe can tell this list's links from
-- the newsletter's without a second page.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.artist_opening_list (
    id                    uuid primary key default gen_random_uuid(),
    email                 text not null,
    status                text not null default 'subscribed',
    locale                text,
    consent_at            timestamptz not null default now(),
    confirmation_sent_at  timestamptz,
    announced_at          timestamptz,
    unsubscribed_at       timestamptz,
    unsubscribe_source    text,
    unsubscribe_token     text not null default ('ao' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
    created_at            timestamptz not null default now(),

    constraint artist_opening_list_email_unique unique (email),
    constraint artist_opening_list_token_unique unique (unsubscribe_token),
    constraint artist_opening_list_status check (status in ('subscribed', 'unsubscribed')),
    constraint artist_opening_list_locale check (locale is null or locale in ('en', 'fr', 'it', 'de'))
);

-- Who receives the opening announcement.
create or replace view public.artist_opening_audience
with (security_invoker = true) as
    select email, locale, consent_at, unsubscribe_token
      from public.artist_opening_list
     where status = 'subscribed' and announced_at is null;

create or replace function public.artist_opening_subscribe(p_email text, p_locale text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_email   text := lower(btrim(coalesce(p_email, '')));
    v_locale  text := case when p_locale in ('en', 'fr', 'it', 'de') then p_locale else null end;
    v_row     public.artist_opening_list%rowtype;
    v_outcome text;
begin
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 320 then
        return jsonb_build_object('ok', false, 'error', 'invalid_email');
    end if;

    insert into public.artist_opening_list (email, locale)
    values (v_email, v_locale)
    on conflict (email) do nothing
    returning * into v_row;

    if found then
        v_outcome := 'new';
    else
        select * into v_row from public.artist_opening_list where email = v_email for update;
        v_outcome := case when v_row.status = 'subscribed' then 'already_subscribed' else 'resubscribed' end;
        update public.artist_opening_list
           set status = 'subscribed',
               locale = coalesce(v_locale, locale),
               consent_at = case when v_row.status = 'subscribed' then consent_at else now() end,
               unsubscribed_at = null,
               unsubscribe_source = null
         where id = v_row.id
        returning * into v_row;
    end if;

    return jsonb_build_object(
        'ok', true,
        'outcome', v_outcome,
        'token', v_row.unsubscribe_token,
        -- One confirmation, not one per press of the button.
        'sendConfirmation', v_outcome <> 'already_subscribed'
                            or v_row.confirmation_sent_at is null
                            or v_row.confirmation_sent_at < now() - interval '1 day'
    );
end $$;

create or replace function public.artist_opening_confirmation_sent(p_token text)
returns void
language sql
set search_path = public
as $$
    update public.artist_opening_list set confirmation_sent_at = now()
     where unsubscribe_token = btrim(p_token);
$$;

-- By token (the link in an email, or one-click) or by email (the unsubscribe
-- page). An address that was never on the list is simply not found here; the
-- unsubscribe page's own suppression record lives with the newsletter.
create or replace function public.artist_opening_unsubscribe(p_token text, p_email text, p_source text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
    v_row public.artist_opening_list%rowtype;
begin
    if nullif(btrim(coalesce(p_token, '')), '') is not null then
        select * into v_row from public.artist_opening_list where unsubscribe_token = btrim(p_token) for update;
    else
        select * into v_row from public.artist_opening_list where email = lower(btrim(coalesce(p_email, ''))) for update;
    end if;
    if not found then
        return jsonb_build_object('ok', true, 'outcome', 'not_found');
    end if;
    if v_row.status = 'unsubscribed' then
        return jsonb_build_object('ok', true, 'outcome', 'already_unsubscribed');
    end if;
    update public.artist_opening_list
       set status = 'unsubscribed', unsubscribed_at = now(),
           unsubscribe_source = left(coalesce(p_source, 'unknown'), 40)
     where id = v_row.id;
    return jsonb_build_object('ok', true, 'outcome', 'unsubscribed');
end $$;

alter table public.artist_opening_list enable row level security;
revoke all on public.artist_opening_list, public.artist_opening_audience from public, anon, authenticated;
grant select, insert, update on public.artist_opening_list to service_role;
grant select on public.artist_opening_audience to service_role;

do $$
declare fn text;
begin
    foreach fn in array array[
        'public.artist_opening_subscribe(text, text)',
        'public.artist_opening_confirmation_sent(text)',
        'public.artist_opening_unsubscribe(text, text, text)'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;
