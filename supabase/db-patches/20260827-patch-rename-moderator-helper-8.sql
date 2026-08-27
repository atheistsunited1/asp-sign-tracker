-- Patch ID:        20260827-patch-rename-moderator-helper-8
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 7
-- Target version:   8
--
-- Purpose: terminology discipline (behaviour-neutral). The capability
-- "mapmaster or admin" was named `is_moderator()` and its policies
-- `<table>_moderator_<op>` — an over-broad label. In the strict role hierarchy
-- (member < mapmaster < admin) the clear name is the minimum-role threshold:
-- `is_mapmaster_or_higher()`, and the policies become `<table>_mapmaster_<op>`,
-- parallel to the existing `<table>_member_<op>` policies. (Plain
-- `<table>_<op>` is impossible: each table carries BOTH a member-tier and a
-- mapmaster-tier policy per operation, with different predicates.)
--
-- This patch:
--   * adds `is_mapmaster_or_higher()` (exact body of `is_moderator()`);
--   * migrates every caller (policies, can_write_sign_photo, dashboard_stats,
--     export_pins) to it and DROPS `is_moderator()` entirely;
--   * renames each `<table>_moderator_<op>` policy to `<table>_mapmaster_<op>`
--     and points it at the clear helper — predicate byte-identical;
--   * updates the `sign-photos` read policy and `can_write_sign_photo`.
--
-- `dashboard_stats` and `export_pins` are migrated in section 4: their exact
-- current bodies with the single guard call swapped mechanically (one token).
--
-- Every predicate is byte-identical except the helper name; only policy NAMES
-- change (internal identifiers, no app/external references). Behaviour-neutral,
-- proven by the local RLS matrix.
--
-- Idempotency: create-or-replace + drop-if-exists (both old and new names).

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260827-patch-rename-moderator-helper-8';
    v_row public.database_patch_version%rowtype;
begin
    if to_regclass('public.database_patch_version') is null then
        raise exception 'ledger table missing; apply the baseline and patch 1 first';
    end if;

    select * into v_row from public.database_patch_version where id for update;

    if not found then
        raise exception 'ledger row missing; apply patch 1 first';
    end if;

    if v_row.baseline_id <> v_baseline then
        raise exception 'ledger baseline % does not match expected %',
            v_row.baseline_id, v_baseline;
    end if;

    if v_row.version = 8 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 7 then
        raise exception 'ledger at version % (patch %); this patch requires version 7',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Canonical helper (is_moderator dropped in section 4)
--------------------------------------------------------------------------------

create or replace function public.is_mapmaster_or_higher()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role in ('mapmaster', 'admin')
    );
$$;

revoke all on function public.is_mapmaster_or_higher() from public, anon;
grant execute on function public.is_mapmaster_or_higher() to authenticated, service_role;

-- is_moderator() is fully retired: all callers are migrated below (RPC
-- guards in section 4) and the function is dropped. No wrapper is kept.

--------------------------------------------------------------------------------
-- 2. Rename the mapmaster-tier policies: <table>_moderator_<op> ->
--    <table>_mapmaster_<op>, pointed at the clear helper. Predicates unchanged.
--------------------------------------------------------------------------------

-- pins
drop policy if exists "pins_moderator_select" on public.pins;
drop policy if exists "pins_mapmaster_select" on public.pins;
create policy "pins_mapmaster_select" on public.pins
    for select to authenticated using (public.is_mapmaster_or_higher());

drop policy if exists "pins_moderator_insert" on public.pins;
drop policy if exists "pins_mapmaster_insert" on public.pins;
create policy "pins_mapmaster_insert" on public.pins
    for insert to authenticated with check (public.is_mapmaster_or_higher());

drop policy if exists "pins_moderator_update" on public.pins;
drop policy if exists "pins_mapmaster_update" on public.pins;
create policy "pins_mapmaster_update" on public.pins
    for update to authenticated
    using (public.is_mapmaster_or_higher()) with check (public.is_mapmaster_or_higher());

-- reports
drop policy if exists "reports_moderator_select" on public.reports;
drop policy if exists "reports_mapmaster_select" on public.reports;
create policy "reports_mapmaster_select" on public.reports
    for select to authenticated using (public.is_mapmaster_or_higher());

drop policy if exists "reports_moderator_insert" on public.reports;
drop policy if exists "reports_mapmaster_insert" on public.reports;
create policy "reports_mapmaster_insert" on public.reports
    for insert to authenticated with check (public.is_mapmaster_or_higher());

drop policy if exists "reports_moderator_update" on public.reports;
drop policy if exists "reports_mapmaster_update" on public.reports;
create policy "reports_mapmaster_update" on public.reports
    for update to authenticated
    using (public.is_mapmaster_or_higher()) with check (public.is_mapmaster_or_higher());

-- photos
drop policy if exists "photos_moderator_select" on public.photos;
drop policy if exists "photos_mapmaster_select" on public.photos;
create policy "photos_mapmaster_select" on public.photos
    for select to authenticated using (public.is_mapmaster_or_higher());

drop policy if exists "photos_moderator_insert" on public.photos;
drop policy if exists "photos_mapmaster_insert" on public.photos;
create policy "photos_mapmaster_insert" on public.photos
    for insert to authenticated with check (public.is_mapmaster_or_higher());

drop policy if exists "photos_moderator_delete" on public.photos;
drop policy if exists "photos_mapmaster_delete" on public.photos;
create policy "photos_mapmaster_delete" on public.photos
    for delete to authenticated using (public.is_mapmaster_or_higher());

--------------------------------------------------------------------------------
-- 3. Storage: read policy (patch 4, renamed) + can_write_sign_photo (patch 6)
--------------------------------------------------------------------------------

drop policy if exists "sign-photos moderator read" on storage.objects;
drop policy if exists "sign-photos mapmaster read" on storage.objects;
create policy "sign-photos mapmaster read" on storage.objects
    for select to authenticated
    using (bucket_id = 'sign-photos' and public.is_mapmaster_or_higher());

create or replace function public.can_write_sign_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select public.is_mapmaster_or_higher() or (
        public.is_approved_member() and exists (
            select 1 from public.reports r
            where r.id::text = (storage.foldername(object_name))[2]
              and r.submitted_by = auth.uid()
              and r.is_approved = false
              and r.is_deleted = false
        )
    );
$$;

revoke all on function public.can_write_sign_photo(text) from public, anon;
grant execute on function public.can_write_sign_photo(text) to authenticated;

--------------------------------------------------------------------------------
-- 4. Migrate the two RPC guards off is_moderator(), then drop it entirely.
--    Bodies are the exact current definitions with the single guard call
--    swapped is_moderator() -> is_mapmaster_or_higher() (mechanical, one token).
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."dashboard_stats"("p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_len         integer;
    v_prev_from   date;
    v_prev_to     date;
    v_trend_start date;
    v_trend_end   date;
    v_result      jsonb;
begin
    if not public.is_mapmaster_or_higher() then
        raise exception 'dashboard_stats: mapmaster or admin required' using errcode = '42501';
    end if;
    if p_from is null or p_to is null or p_to < p_from then
        raise exception 'dashboard_stats: invalid period % .. %', p_from, p_to;
    end if;

    v_len       := (p_to - p_from) + 1;
    v_prev_to   := p_from - 1;
    v_prev_from := v_prev_to - v_len + 1;
    -- Last 8 calendar quarters, ending with the quarter that contains p_to.
    v_trend_end   := (date_trunc('quarter', p_to::timestamp) + interval '3 months' - interval '1 day')::date;
    v_trend_start := (date_trunc('quarter', p_to::timestamp) - interval '21 months')::date;

    with
    windows(name, w_from, w_to) as (
        values ('period', p_from, p_to), ('previous', v_prev_from, v_prev_to)
    ),
    base_pins as (
        select p.id, p.state, p.is_major_campaign,
               (p.sign_type = 'billboard') as is_billboard,
               case when p.sign_type = 'billboard' then 'billboard'
                    when p.icon_type = 1 then 'plundered'
                    when p.icon_type = 2 then 'krakened'
                    when p.icon_type = 3 then 'questionable'
                    else 'sighting' end as bucket,
               case when not p.is_major_campaign then null
                    when p.sign_text ilike 'jesus saves%' then 'js'
                    when p.sign_text ilike 'jesus is coming%' then 'jicr'
                    else 'other_major' end as campaign
        from public.pins p
        where p.is_deleted = false and p.is_approved = true
    ),
    acts as (
        select r.pin_id, r.report_type, r.occurred_on, r.submitted_by,
               b.state, b.is_major_campaign, b.campaign, b.is_billboard, b.bucket
        from public.reports r
        join base_pins b on b.id = r.pin_id
        where r.is_deleted = false and r.is_approved = true
          and r.report_type not in ('deleted', 'restored')
    ),
    first_seen as (
        select pin_id, min(occurred_on) as first_on from acts group by pin_id
    ),
    snapshot as (
        select bucket, is_major_campaign, campaign, state, count(*)::int as n
        from base_pins
        group by 1, 2, 3, 4
    ),
    activity as (
        select w.name as window, a.report_type, a.is_major_campaign, a.campaign, a.state, a.is_billboard, count(*)::int as n
        from acts a
        join windows w on a.occurred_on between w.w_from and w.w_to
        group by 1, 2, 3, 4, 5, 6
        union all
        select w.name, 'first_sighting', b.is_major_campaign, b.campaign, b.state, b.is_billboard, count(*)::int
        from first_seen f
        join base_pins b on b.id = f.pin_id
        join windows w on f.first_on between w.w_from and w.w_to
        group by 1, 3, 4, 5, 6
        union all
        select w.name, 'tracked_total', null, null, null, null, count(*)::int
        from first_seen f
        join windows w on f.first_on <= w.w_to
        group by 1
    ),
    quarters as (
        select q::date as q_start,
               (q + interval '3 months' - interval '1 day')::date as q_end,
               to_char(q, 'YYYY') || '-Q' || to_char(q, 'Q') as label
        from generate_series(v_trend_start::timestamp, v_trend_end::timestamp, interval '3 months') q
    ),
    trend as (
        select q.label as quarter, a.report_type, count(*)::int as n
        from quarters q
        join acts a on a.occurred_on between q.q_start and q.q_end
        group by 1, 2
        union all
        select q.label, 'first_sighting', count(*)::int
        from quarters q
        join first_seen f on f.first_on between q.q_start and q.q_end
        group by 1
        union all
        -- backlog at quarter end: signs first seen by then, no plunder/kraken by then,
        -- not billboards, not (currently) questionable — an approximation of the
        -- live "treasure in waiting" count for past quarters.
        select q.label, 'backlog_end', count(*)::int
        from quarters q
        join first_seen f on f.first_on <= q.q_end
        join base_pins b on b.id = f.pin_id
        where not b.is_billboard and b.bucket <> 'questionable'
          and not exists (
              select 1 from acts t
              where t.pin_id = f.pin_id
                and t.report_type in ('plundered', 'krakened')
                and t.occurred_on <= q.q_end
          )
        group by 1
    ),
    members as (
        select w.name as window, pr.username, a.report_type, count(*)::int as n
        from acts a
        join windows w on a.occurred_on between w.w_from and w.w_to
        join public.profiles pr on pr.id = a.submitted_by
        group by 1, 2, 3
    )
    select jsonb_build_object(
        'period',   jsonb_build_object('from', p_from, 'to', p_to),
        'previous', jsonb_build_object('from', v_prev_from, 'to', v_prev_to),
        'snapshot', coalesce((select jsonb_agg(to_jsonb(s)) from snapshot s), '[]'::jsonb),
        'activity', coalesce((select jsonb_agg(to_jsonb(a)) from activity a), '[]'::jsonb),
        'trend',    coalesce((select jsonb_agg(to_jsonb(t)) from trend t), '[]'::jsonb),
        'members',  coalesce((select jsonb_agg(to_jsonb(m)) from members m), '[]'::jsonb)
    )
    into v_result;

    return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."export_pins"("p_buckets" "text"[] DEFAULT NULL::"text"[], "p_major" "text" DEFAULT 'all'::"text", "p_state" "text" DEFAULT NULL::"text", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_result jsonb;
begin
    if not public.is_mapmaster_or_higher() then
        raise exception 'export_pins: mapmaster or admin required' using errcode = '42501';
    end if;
    if p_major not in ('all', 'only', 'exclude') then
        raise exception 'export_pins: p_major must be all|only|exclude';
    end if;

    with
    base_pins as (
        select p.*,
               (p.sign_type = 'billboard') as is_billboard,
               case when p.sign_type = 'billboard' then 'billboard'
                    when p.icon_type = 1 then 'plundered'
                    when p.icon_type = 2 then 'krakened'
                    when p.icon_type = 3 then 'questionable'
                    else 'sighting' end as bucket,
               case when not p.is_major_campaign then null
                    when p.sign_text ilike 'jesus saves%' then 'js'
                    when p.sign_text ilike 'jesus is coming%' then 'jicr'
                    else 'other_major' end as campaign
        from public.pins p
        where p.is_deleted = false and p.is_approved = true
    ),
    sel as (
        select b.*
        from base_pins b
        where (p_buckets is null or b.bucket = any (p_buckets))
          and (p_major = 'all'
               or (p_major = 'only' and b.is_major_campaign)
               or (p_major = 'exclude' and not b.is_major_campaign))
          and (p_state is null or b.state = p_state)
          and ((p_from is null and p_to is null) or exists (
                select 1 from public.reports r
                where r.pin_id = b.id and r.is_deleted = false and r.is_approved = true
                  and r.report_type not in ('deleted', 'restored')
                  and r.occurred_on between coalesce(p_from, date '1900-01-01') and coalesce(p_to, date '2999-12-31')))
    )
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'pin', jsonb_build_object(
                'id', s.id, 'friendly_id', s.friendly_id, 'lat', s.lat, 'lng', s.lng,
                'sign_text', s.sign_text, 'sign_type', s.sign_type, 'description', s.description,
                'city', s.city, 'state', s.state, 'zip', s.zip, 'gsv_date', s.gsv_date,
                'is_major_campaign', s.is_major_campaign, 'campaign', s.campaign,
                'bucket', s.bucket, 'created_at', s.created_at),
            'activities', (
                select coalesce(jsonb_agg(jsonb_build_object(
                           'type', r.report_type, 'occurred_on', r.occurred_on,
                           'initials', pr.initials, 'username', pr.username)
                           order by r.occurred_on, r.created_at), '[]'::jsonb)
                from public.reports r
                left join public.profiles pr on pr.id = r.submitted_by
                where r.pin_id = s.id and r.is_deleted = false and r.is_approved = true
                  and r.report_type not in ('deleted', 'restored')),
            'photos', (
                select coalesce(jsonb_agg(ph.image_url order by ph.created_at), '[]'::jsonb)
                from public.photos ph
                join public.reports r2 on r2.id = ph.report_id
                where r2.pin_id = s.id and r2.is_deleted = false and r2.is_approved = true)
        ) order by s.state nulls last, s.city nulls last, s.sign_text nulls last, s.created_at
    ), '[]'::jsonb)
    into v_result
    from sel s;

    return v_result;
end;
$$;

drop function if exists public.is_moderator();

--------------------------------------------------------------------------------
-- 5. Forward verification
--------------------------------------------------------------------------------

do $$
declare
    v_new constant text[] := array[
        'pins_mapmaster_select','pins_mapmaster_insert','pins_mapmaster_update',
        'reports_mapmaster_select','reports_mapmaster_insert','reports_mapmaster_update',
        'photos_mapmaster_select','photos_mapmaster_insert','photos_mapmaster_delete',
        'sign-photos mapmaster read'];
begin
    if to_regprocedure('public.is_mapmaster_or_higher()') is null then
        raise exception 'verification failed: is_mapmaster_or_higher missing';
    end if;
    if to_regprocedure('public.is_moderator()') is not null then
        raise exception 'verification failed: is_moderator still exists (should be dropped)';
    end if;
    if pg_get_functiondef('public.dashboard_stats(date, date)'::regprocedure) like '%is_moderator%'
       or pg_get_functiondef('public.export_pins(text[], text, text, date, date)'::regprocedure) like '%is_moderator%' then
        raise exception 'verification failed: an RPC still calls is_moderator';
    end if;
    -- All renamed policies must exist.
    if (select count(*) from pg_policies
        where schemaname in ('public','storage') and policyname = any(v_new)) <> array_length(v_new, 1) then
        raise exception 'verification failed: a renamed mapmaster policy is missing';
    end if;
    -- No *_moderator_* policy may remain, and none may still call is_moderator.
    if exists (
        select 1 from pg_policies
        where schemaname in ('public','storage')
          and (policyname like '%_moderator_%' or policyname = 'sign-photos moderator read'
               or (coalesce(qual,'') || coalesce(with_check,'')) like '%is_moderator%')
    ) then
        raise exception 'verification failed: a moderator-named policy or is_moderator call remains';
    end if;
    if pg_get_functiondef('public.can_write_sign_photo(text)'::regprocedure) like '%is_moderator%' then
        raise exception 'verification failed: can_write_sign_photo still calls is_moderator';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 6. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 8,
    patch_id = '20260827-patch-rename-moderator-helper-8',
    applied_at = now()
where id;

commit;
