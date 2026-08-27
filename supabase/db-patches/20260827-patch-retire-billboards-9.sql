-- Patch ID:        20260827-patch-retire-billboards-9
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 8
-- Target version:   9
--
-- Purpose: fully retire the "billboard" concept (a sign_type value). Billboard
-- was a first-class sign type with its own map category, marker shape, color,
-- and dashboard bucket, now removed from the product. The client side (report
-- options, KML import, map, dashboard, export, glossary) is handled in the same
-- PR; this patch handles the data + analytics:
--   1. Reclassify existing billboard pins to 'sign' (they become regular
--      sightings). Intentional: those pins move from the billboard bucket into
--      the sighting/backlog counts, so quarterly numbers shift accordingly.
--   2. Remove the is_billboard column, the billboard bucket CASE arm, and the
--      "not is_billboard" backlog filter from dashboard_stats and export_pins.
--      With no billboard rows left (step 1), all other buckets are numerically
--      unchanged; the reclassified pins simply count as sightings.
--
-- Function bodies are the exact post-patch-8 definitions with only the billboard
-- logic removed (mechanical). Idempotent: the UPDATE no-ops on rerun.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $LEDGER$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260827-patch-retire-billboards-9';
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
        raise exception 'ledger baseline % does not match expected %', v_row.baseline_id, v_baseline;
    end if;
    if v_row.version = 9 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 8 then
        raise exception 'ledger at version % (patch %); this patch requires version 8',
            v_row.version, v_row.patch_id;
    end if;
end;
$LEDGER$;

--------------------------------------------------------------------------------
-- 1. Reclassify billboard pins to 'sign' (they become regular sightings)
--------------------------------------------------------------------------------

update public.pins set sign_type = 'sign' where sign_type = 'billboard';

--------------------------------------------------------------------------------
-- 2. dashboard_stats without billboard logic
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
               case when p.icon_type = 1 then 'plundered'
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
               b.state, b.is_major_campaign, b.campaign, b.bucket
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
        select w.name as window, a.report_type, a.is_major_campaign, a.campaign, a.state, count(*)::int as n
        from acts a
        join windows w on a.occurred_on between w.w_from and w.w_to
        group by 1, 2, 3, 4, 5
        union all
        select w.name, 'first_sighting', b.is_major_campaign, b.campaign, b.state, count(*)::int
        from first_seen f
        join base_pins b on b.id = f.pin_id
        join windows w on f.first_on between w.w_from and w.w_to
        group by 1, 3, 4, 5
        union all
        select w.name, 'tracked_total', null, null, null, count(*)::int
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
        -- not (currently) questionable — an approximation of the
        -- live "treasure in waiting" count for past quarters.
        select q.label, 'backlog_end', count(*)::int
        from quarters q
        join first_seen f on f.first_on <= q.q_end
        join base_pins b on b.id = f.pin_id
        where b.bucket <> 'questionable'
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

--------------------------------------------------------------------------------
-- 3. export_pins without billboard logic
--------------------------------------------------------------------------------

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
               case when p.icon_type = 1 then 'plundered'
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

--------------------------------------------------------------------------------
-- 4. Forward verification
--------------------------------------------------------------------------------

do $VERIFY$
begin
    if exists (select 1 from public.pins where sign_type = 'billboard') then
        raise exception 'verification failed: billboard pins remain';
    end if;
    if pg_get_functiondef('public.dashboard_stats(date, date)'::regprocedure) like '%billboard%'
       or pg_get_functiondef('public.export_pins(text[], text, text, date, date)'::regprocedure) like '%billboard%' then
        raise exception 'verification failed: an RPC still references billboard';
    end if;
end;
$VERIFY$;

--------------------------------------------------------------------------------
-- 5. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 9,
    patch_id = '20260827-patch-retire-billboards-9',
    applied_at = now()
where id;

commit;
