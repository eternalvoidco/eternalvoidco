-- ─────────────────────────────────────────────────────────────────────────────
-- ETERNAL VOID — EV for Artists intake, hardened
--
-- Follows 20261119160000_royalty_reconciliation.sql. Two things.
--
--   1 · THE CONFIRM STEP TRUSTED THE CLIENT FOR THE FILE PATH.
--       api/artist-submission.js looked the draft up through
--       artist_submissions_list to read its file_path — but that function
--       excludes drafts by design, so the lookup ALWAYS missed and the code
--       always fell through to the path in the request body, checked only
--       against a shape regex. A caller holding a valid token for their own
--       draft could therefore point it at a different submission's object.
--       The comment above that line said the path was read back from the row.
--       It was not. artist_submission_draft_path below is that read, and it
--       answers only when the token matches the draft that owns the path.
--
--   2 · A PREVIEW SUBMISSION MUST BE DISTINGUISHABLE FROM A REAL ONE.
--       Intake stays closed until the terms are approved, but the whole path
--       has to be exercisable before then — by an administrator, against real
--       storage. Those submissions are flagged here and kept out of the
--       reviewer's queue unless it asks for them, so a test can never be read
--       as somebody's work, and they can be purged as a group.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.artist_submissions
    add column if not exists is_preview boolean not null default false;

create index if not exists artist_submissions_preview_idx
    on public.artist_submissions (created_at desc) where is_preview;

-- ══ The draft's own path ═════════════════════════════════════════════════════
-- The one authoritative answer to "where does this draft's file live". Returns
-- it only for a draft, and only to a caller presenting that draft's own
-- confirm token — so knowing a reference, or guessing one, yields nothing.
create or replace function public.artist_submission_draft_path(
    p_reference text, p_token text
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
    v_row public.artist_submissions%rowtype;
begin
    select * into v_row from public.artist_submissions
     where reference = btrim(p_reference);
    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    -- Already confirmed. Said plainly so the caller can treat a retry after a
    -- dropped response as the success it was.
    if v_row.status <> 'draft' then
        return jsonb_build_object('ok', true, 'already', true,
                                  'status', v_row.status, 'path', null);
    end if;

    if v_row.confirm_token is null or v_row.confirm_token <> p_token then
        return jsonb_build_object('ok', false, 'error', 'bad_token');
    end if;

    return jsonb_build_object('ok', true, 'already', false,
                              'path', v_row.file_path,
                              'fileType', v_row.file_type,
                              'fileSize', v_row.file_size,
                              'isPreview', v_row.is_preview);
end $$;

-- ══ Creating a submission, with the preview flag ═════════════════════════════
-- Same function as before with one more argument. Replaced rather than altered
-- so the signature stays honest about what it takes.
drop function if exists public.artist_submission_create(
    text, text, text, text, text, text, text, text, text, boolean,
    text, integer, text, text, text, text);

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
    p_ip_hash text,
    p_is_preview boolean default false
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
        terms_version, marketing_opt_in, confirm_token, submit_ip_hash, is_preview
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
        nullif(btrim(coalesce(p_ip_hash, '')), ''),
        coalesce(p_is_preview, false)
    )
    returning * into v_row;

    insert into public.artist_submission_events (submission_id, actor, action, to_status, detail)
    values (v_row.id, case when v_row.is_preview then 'preview' else 'artist' end, 'created', v_row.status,
            case when v_has_file then 'awaiting upload' else 'no file' end);

    return jsonb_build_object('ok', true, 'id', v_row.id, 'reference', v_row.reference,
                              'status', v_row.status, 'isPreview', v_row.is_preview);
end $$;

-- ══ The reviewer's queue, without the rehearsals ═════════════════════════════
-- Preview submissions are excluded unless explicitly asked for, so a test can
-- never be mistaken for somebody's work.
drop function if exists public.artist_submissions_list(text, integer, integer);

create or replace function public.artist_submissions_list(
    p_status text default null,
    p_limit integer default 100,
    p_offset integer default 0,
    p_include_preview boolean default false
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
                       and (coalesce(p_include_preview, false) or not is_preview)
                     group by status) c
        ),
        'previewCount', (select count(*) from public.artist_submissions where is_preview),
        'rows', coalesce((
            select jsonb_agg(row_to_json(s) order by s.created_at desc)
              from (
                select id, reference, status, name, email, country, locale,
                       title, description, portfolio_url,
                       file_name, file_type, file_size, file_state, file_path,
                       terms_version, terms_accepted_at, marketing_opt_in, is_preview,
                       reviewer_notes, status_changed_at, status_changed_by,
                       receipt_sent_at, notified_at, withdrawn_at, files_deleted_at,
                       created_at
                  from public.artist_submissions
                 where status <> 'draft'
                   and (coalesce(p_include_preview, false) or not is_preview)
                   and (p_status is null or p_status = '' or status = p_status)
                 order by created_at desc
                 limit greatest(1, least(coalesce(p_limit, 100), 500))
                offset greatest(0, coalesce(p_offset, 0))
              ) s), '[]'::jsonb)
    );
$$;

-- ══ Grants ═══════════════════════════════════════════════════════════════════
do $$
declare fn text;
begin
    foreach fn in array array[
        'public.artist_submission_draft_path(text, text)',
        'public.artist_submission_create(text, text, text, text, text, text, text, text, text, boolean, text, integer, text, text, text, text, boolean)',
        'public.artist_submissions_list(text, integer, integer, boolean)'
    ] loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
    end loop;
end $$;

-- ── Verifying, after applying ───────────────────────────────────────────────
--   -- a confirm token for one draft must not reveal another draft's path
--   select public.artist_submission_draft_path('EVA-26-AAAAAA', 'wrong-token');
--     -> {"ok": false, "error": "bad_token"}
--
--   -- rehearsals stay out of the queue
--   select public.artist_submissions_list(null, 100, 0)       -> 'previewCount';
--   select public.artist_submissions_list(null, 100, 0, true) -> 'rows';
