

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."admin_list_profiles"("pending_only" boolean DEFAULT false) RETURNS TABLE("id" "uuid", "email" "text", "username" "text", "initials" "text", "zip" "text", "role" "text", "created_at" timestamp with time zone, "approved_at" timestamp with time zone, "is_approved" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    if not public.is_admin() then
        raise exception 'admin_list_profiles: admin only';
    end if;

    return query
    select p.id, p.email, p.username, p.initials, p.zip, p.role,
           p.created_at, p.approved_at, p.is_approved
    from public.profiles p
    where (not pending_only) or (p.is_approved = false)
    order by
        case when pending_only then p.created_at end asc,
        case when not pending_only then p.approved_at end desc nulls first;
end;
$$;


ALTER FUNCTION "public"."admin_list_profiles"("pending_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."base36"("n" bigint) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  chars text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  res   text := '';
  q     bigint := n;
  r     int;
begin
  if q is null then return null; end if;
  if q = 0 then return '0'; end if;
  while q > 0 loop
    r := (q % 36);
    res := substr(chars, r+1, 1) || res;
    q := q / 36;
  end loop;
  return res;
end $$;


ALTER FUNCTION "public"."base36"("n" bigint) OWNER TO "postgres";


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
    if not public.is_moderator() then
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


ALTER FUNCTION "public"."dashboard_stats"("p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."email_in_use"("e" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
        select exists (
            select 1 from public.profiles where lower(email) = lower(e)
        );
    $$;


ALTER FUNCTION "public"."email_in_use"("e" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."export_pins"("p_buckets" "text"[] DEFAULT NULL::"text"[], "p_major" "text" DEFAULT 'all'::"text", "p_state" "text" DEFAULT NULL::"text", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_result jsonb;
begin
    if not public.is_moderator() then
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


ALTER FUNCTION "public"."export_pins"("p_buckets" "text"[], "p_major" "text", "p_state" "text", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
        select exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'admin'
        );
    $$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_approved_member"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
        select exists (
            select 1 from public.profiles
            where id = auth.uid() and is_approved
        );
    $$;


ALTER FUNCTION "public"."is_approved_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_moderator"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
        select exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('mapmaster', 'admin')
        );
    $$;


ALTER FUNCTION "public"."is_moderator"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone DEFAULT ("now"() - '30 days'::interval)) RETURNS TABLE("deleted_reports" integer, "deleted_pins" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_deleted_reports integer := 0;
    v_deleted_pins integer := 0;
    v_claims text := current_setting('request.jwt.claims', true);
    v_jwt_role text;
begin
    if v_claims is null or v_claims = '' then
        -- No JWT: a direct database session (psql, SQL editor, scheduled job).
        -- Such callers already hold database-level privileges.
        null;
    else
        v_jwt_role := (v_claims::json ->> 'role');
        if v_jwt_role is distinct from 'service_role' and not public.is_admin() then
            raise exception 'purge_soft_deleted_rows: admin only';
        end if;
    end if;

    -- 1) Remove report-linked photos for reports eligible for purge.
    --    (storage object deletion handled by scheduled edge function)
    delete from public.photos p
    using public.reports r
    where p.report_id = r.id
      and r.is_deleted = true
      and r.deleted_at is not null
      and r.deleted_at <= cutoff;

    -- 2) Remove eligible soft-deleted reports.
    delete from public.reports r
    where r.is_deleted = true
      and r.deleted_at is not null
      and r.deleted_at <= cutoff;
    get diagnostics v_deleted_reports = row_count;

    -- 3) Remove eligible soft-deleted pins.
    delete from public.pins p
    where p.is_deleted = true
      and p.deleted_at is not null
      and p.deleted_at <= cutoff;
    get diagnostics v_deleted_pins = row_count;

    return query select v_deleted_reports, v_deleted_pins;
end;
$$;


ALTER FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_profiles_guard_privileged"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    if new.role        is distinct from old.role
       or new.is_approved is distinct from old.is_approved
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then

        if auth.uid() is null then
            return new;
        end if;

        if not public.is_admin() then
            raise exception 'only admins may change role or approval fields';
        end if;

        if new.role is distinct from old.role and old.id = auth.uid() then
            raise exception 'admins may not change their own role';
        end if;
    end if;

    return new;
end;
$$;


ALTER FUNCTION "public"."tg_profiles_guard_privileged"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;


ALTER FUNCTION "public"."tg_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."username_available"("u" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
        select not exists (
            select 1 from public.profiles where lower(username) = lower(u)
        );
    $$;


ALTER FUNCTION "public"."username_available"("u" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "source" "text" DEFAULT 'report_form'::"text" NOT NULL,
    "level" "text" DEFAULT 'error'::"text" NOT NULL,
    "event" "text" NOT NULL,
    "message" "text",
    "details" "jsonb",
    "device" "text",
    "network" "text",
    "ua" "text",
    "path" "text",
    CONSTRAINT "app_logs_level_check" CHECK (("level" = ANY (ARRAY['debug'::"text", 'info'::"text", 'warn'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."app_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookmarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "pin_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bookmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."database_patch_version" (
    "id" boolean DEFAULT true NOT NULL,
    "baseline_id" "text" NOT NULL,
    "version" integer NOT NULL,
    "patch_id" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "database_patch_version_id_check" CHECK ("id")
);


ALTER TABLE "public"."database_patch_version" OWNER TO "postgres";


COMMENT ON TABLE "public"."database_patch_version" IS 'Singleton ledger row recording the applied database patch version. Database-control metadata: no client access, no RLS policies.';



CREATE TABLE IF NOT EXISTS "public"."photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid",
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    "icon_type" integer DEFAULT 0,
    "approved_by" "uuid",
    "description" "text",
    "short_num" bigint NOT NULL,
    "friendly_id" "text" GENERATED ALWAYS AS (('P-'::"text" || "public"."base36"("short_num"))) STORED,
    "sign_text" "text",
    "sign_type" "text",
    "city" "text",
    "state" "text",
    "gsv_date" "date",
    "submitted_by" "uuid",
    "is_approved" boolean DEFAULT false NOT NULL,
    "is_major_campaign" boolean DEFAULT false NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "campaign_class" "text",
    "icon_color" "text" DEFAULT '#C2185B'::"text" NOT NULL,
    "zip" "text",
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."pins" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pins"."is_major_campaign" IS 'True if the pin is part of a major campaign. Defaults to false.';



CREATE SEQUENCE IF NOT EXISTS "public"."pins_short_num_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pins_short_num_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pins_short_num_seq" OWNED BY "public"."pins"."short_num";



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'user'::"text",
    "username" "text",
    "initials" "text",
    "zip" "text",
    "approved_at" timestamp with time zone,
    "is_approved" boolean DEFAULT false NOT NULL,
    "approved_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'mapmaster'::"text", 'admin'::"text"]))),
    CONSTRAINT "profiles_username_chars_ck" CHECK (("username" ~ '^[a-zA-Z0-9_.]+$'::"text")),
    CONSTRAINT "profiles_username_len_chk" CHECK ((("username" IS NULL) OR (("char_length"("username") >= 3) AND ("char_length"("username") <= 40)))),
    CONSTRAINT "profiles_username_len_ck" CHECK ((("char_length"("username") >= 3) AND ("char_length"("username") <= 24)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pin_id" "uuid",
    "report_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "approved_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "short_num" bigint NOT NULL,
    "submitted_by" "uuid",
    "is_approved" boolean DEFAULT false NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "occurred_on" "date" DEFAULT CURRENT_DATE NOT NULL
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."reports_short_num_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."reports_short_num_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."reports_short_num_seq" OWNED BY "public"."reports"."short_num";



ALTER TABLE ONLY "public"."pins" ALTER COLUMN "short_num" SET DEFAULT "nextval"('"public"."pins_short_num_seq"'::"regclass");



ALTER TABLE ONLY "public"."reports" ALTER COLUMN "short_num" SET DEFAULT "nextval"('"public"."reports_short_num_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_logs"
    ADD CONSTRAINT "app_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_user_pin_key" UNIQUE ("user_id", "pin_id");



ALTER TABLE ONLY "public"."database_patch_version"
    ADD CONSTRAINT "database_patch_version_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pins"
    ADD CONSTRAINT "pins_friendly_id_uniq" UNIQUE ("friendly_id");



ALTER TABLE ONLY "public"."pins"
    ADD CONSTRAINT "pins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



CREATE INDEX "bookmarks_pin_id_idx" ON "public"."bookmarks" USING "btree" ("pin_id");



CREATE INDEX "bookmarks_user_created_at_idx" ON "public"."bookmarks" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_photos_report_id" ON "public"."photos" USING "btree" ("report_id");



CREATE INDEX "idx_pins_approved_by" ON "public"."pins" USING "btree" ("approved_by");



CREATE INDEX "idx_pins_not_deleted" ON "public"."pins" USING "btree" ("is_approved") WHERE ("is_deleted" = false);



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_reports_approved_by" ON "public"."reports" USING "btree" ("approved_by");



CREATE INDEX "idx_reports_not_deleted" ON "public"."reports" USING "btree" ("is_approved", "created_at") WHERE ("is_deleted" = false);



CREATE INDEX "idx_reports_pin_id" ON "public"."reports" USING "btree" ("pin_id");



CREATE INDEX "photos_report_id_created_at_desc_idx" ON "public"."photos" USING "btree" ("report_id", "created_at" DESC);



CREATE INDEX "pins_campaign_class_idx" ON "public"."pins" USING "btree" ("campaign_class");



CREATE INDEX "pins_city_trgm_idx" ON "public"."pins" USING "gin" ("lower"(COALESCE("city", ''::"text")) "public"."gin_trgm_ops");



CREATE INDEX "pins_deleted_at_idx" ON "public"."pins" USING "btree" ("deleted_at") WHERE ("is_deleted" = true);



CREATE INDEX "pins_description_trgm_idx" ON "public"."pins" USING "gin" ("lower"(COALESCE("description", ''::"text")) "public"."gin_trgm_ops");



CREATE INDEX "pins_friendly_id_trgm_idx" ON "public"."pins" USING "gin" ("lower"(COALESCE("friendly_id", ''::"text")) "public"."gin_trgm_ops");



CREATE INDEX "pins_icon_type_approved_idx" ON "public"."pins" USING "btree" ("icon_type", "is_approved") WHERE ("is_deleted" = false);



CREATE INDEX "pins_is_deleted_idx" ON "public"."pins" USING "btree" ("is_deleted");



CREATE INDEX "pins_major_campaign_idx" ON "public"."pins" USING "btree" ("is_major_campaign") WHERE ("is_deleted" = false);



CREATE INDEX "pins_search_fts_idx" ON "public"."pins" USING "gin" ("to_tsvector"('"simple"'::"regconfig", ((((((((((COALESCE("friendly_id", ''::"text") || ' '::"text") || COALESCE("sign_text", ''::"text")) || ' '::"text") || COALESCE("description", ''::"text")) || ' '::"text") || COALESCE("city", ''::"text")) || ' '::"text") || COALESCE("state", ''::"text")) || ' '::"text") || COALESCE("zip", ''::"text"))));



CREATE INDEX "pins_sign_text_trgm_idx" ON "public"."pins" USING "gin" ("lower"(COALESCE("sign_text", ''::"text")) "public"."gin_trgm_ops");



CREATE INDEX "pins_state_city_idx" ON "public"."pins" USING "btree" ("state", "city") WHERE ("is_deleted" = false);



CREATE INDEX "pins_state_trgm_idx" ON "public"."pins" USING "gin" ("lower"(COALESCE("state", ''::"text")) "public"."gin_trgm_ops");



CREATE INDEX "pins_updated_at_desc_idx" ON "public"."pins" USING "btree" ("updated_at" DESC) WHERE ("is_deleted" = false);



CREATE INDEX "pins_zip_idx" ON "public"."pins" USING "btree" ("zip") WHERE (("is_deleted" = false) AND ("zip" IS NOT NULL));



CREATE INDEX "pins_zip_trgm_idx" ON "public"."pins" USING "gin" ("lower"(COALESCE("zip", ''::"text")) "public"."gin_trgm_ops");



CREATE UNIQUE INDEX "profiles_email_lower_uq" ON "public"."profiles" USING "btree" ("lower"("email"));



CREATE INDEX "profiles_is_approved_idx" ON "public"."profiles" USING "btree" ("is_approved");



CREATE UNIQUE INDEX "profiles_username_ci_uq" ON "public"."profiles" USING "btree" ("lower"("username"));



CREATE UNIQUE INDEX "profiles_username_lower_key" ON "public"."profiles" USING "btree" ("lower"("username")) WHERE ("username" IS NOT NULL);



CREATE UNIQUE INDEX "profiles_username_lower_unique" ON "public"."profiles" USING "btree" ("lower"("username")) WHERE ("username" IS NOT NULL);



CREATE UNIQUE INDEX "profiles_username_lower_uq" ON "public"."profiles" USING "btree" ("lower"("username"));



CREATE INDEX "reports_deleted_at_idx" ON "public"."reports" USING "btree" ("deleted_at") WHERE ("is_deleted" = true);



CREATE INDEX "reports_is_approved_idx" ON "public"."reports" USING "btree" ("is_approved") WHERE ("is_deleted" = false);



CREATE INDEX "reports_pin_deleted_idx" ON "public"."reports" USING "btree" ("pin_id", "deleted_at") WHERE ("is_deleted" = true);



CREATE INDEX "reports_pin_id_created_at_desc_idx" ON "public"."reports" USING "btree" ("pin_id", "created_at" DESC) WHERE ("is_deleted" = false);



CREATE INDEX "reports_pin_occurred_on_idx" ON "public"."reports" USING "btree" ("pin_id", "occurred_on" DESC, "created_at" DESC) WHERE ("is_deleted" = false);



CREATE INDEX "reports_report_type_idx" ON "public"."reports" USING "btree" ("report_type") WHERE ("is_deleted" = false);



CREATE INDEX "reports_submitted_by_idx" ON "public"."reports" USING "btree" ("submitted_by") WHERE ("is_deleted" = false);



CREATE UNIQUE INDEX "ux_photos_report_url" ON "public"."photos" USING "btree" ("report_id", "image_url");



CREATE OR REPLACE TRIGGER "profiles_guard_privileged" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."tg_profiles_guard_privileged"();



ALTER TABLE ONLY "public"."app_logs"
    ADD CONSTRAINT "app_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pins"
    ADD CONSTRAINT "pins_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pins"
    ADD CONSTRAINT "pins_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE "public"."app_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookmarks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bookmarks_delete_own" ON "public"."bookmarks" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "bookmarks_insert_own" ON "public"."bookmarks" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "bookmarks_select_own" ON "public"."bookmarks" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."database_patch_version" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "logs_insert_anyone" ON "public"."app_logs" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "photos_member_delete" ON "public"."photos" FOR DELETE TO "authenticated" USING (("public"."is_approved_member"() AND (EXISTS ( SELECT 1
   FROM "public"."reports" "r"
  WHERE (("r"."id" = "photos"."report_id") AND ("r"."submitted_by" = "auth"."uid"()) AND ("r"."is_approved" = false) AND ("r"."is_deleted" = false))))));



CREATE POLICY "photos_member_insert" ON "public"."photos" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_approved_member"() AND (EXISTS ( SELECT 1
   FROM "public"."reports" "r"
  WHERE (("r"."id" = "photos"."report_id") AND ("r"."submitted_by" = "auth"."uid"()) AND ("r"."is_approved" = false) AND ("r"."is_deleted" = false))))));



CREATE POLICY "photos_member_select" ON "public"."photos" FOR SELECT TO "authenticated" USING (("public"."is_approved_member"() AND (EXISTS ( SELECT 1
   FROM "public"."reports" "r"
  WHERE (("r"."id" = "photos"."report_id") AND ("r"."is_deleted" = false))))));



CREATE POLICY "photos_moderator_delete" ON "public"."photos" FOR DELETE TO "authenticated" USING ("public"."is_moderator"());



CREATE POLICY "photos_moderator_insert" ON "public"."photos" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_moderator"());



CREATE POLICY "photos_moderator_select" ON "public"."photos" FOR SELECT TO "authenticated" USING ("public"."is_moderator"());



ALTER TABLE "public"."pins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pins_member_insert" ON "public"."pins" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_approved_member"() AND ("submitted_by" = "auth"."uid"()) AND ("is_approved" = false) AND ("is_deleted" = false)));



CREATE POLICY "pins_member_update_own_pending" ON "public"."pins" FOR UPDATE TO "authenticated" USING (("public"."is_approved_member"() AND ("submitted_by" = "auth"."uid"()) AND ("is_approved" = false) AND ("is_deleted" = false))) WITH CHECK ((("submitted_by" = "auth"."uid"()) AND ("is_approved" = false) AND ("is_deleted" = false)));



CREATE POLICY "pins_moderator_insert" ON "public"."pins" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_moderator"());



CREATE POLICY "pins_moderator_select" ON "public"."pins" FOR SELECT TO "authenticated" USING ("public"."is_moderator"());



CREATE POLICY "pins_moderator_update" ON "public"."pins" FOR UPDATE TO "authenticated" USING ("public"."is_moderator"()) WITH CHECK ("public"."is_moderator"());



CREATE POLICY "pins_public_select" ON "public"."pins" FOR SELECT TO "authenticated", "anon" USING (("is_deleted" = false));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_admin_delete" ON "public"."profiles" FOR DELETE TO "authenticated" USING (("public"."is_admin"() AND ("id" <> "auth"."uid"())));



CREATE POLICY "profiles_admin_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "profiles_admin_update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "profiles_member_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."is_approved_member"());



CREATE POLICY "profiles_own_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles_own_update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles_self_insert" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((("id" = "auth"."uid"()) AND ("role" = 'user'::"text") AND ("is_approved" = false)));



ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reports_member_insert" ON "public"."reports" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_approved_member"() AND ("submitted_by" = "auth"."uid"()) AND ("is_approved" = false) AND ("is_deleted" = false)));



CREATE POLICY "reports_member_select" ON "public"."reports" FOR SELECT TO "authenticated" USING (("public"."is_approved_member"() AND ("is_deleted" = false)));



CREATE POLICY "reports_member_update_own_pending" ON "public"."reports" FOR UPDATE TO "authenticated" USING (("public"."is_approved_member"() AND ("submitted_by" = "auth"."uid"()) AND ("is_approved" = false) AND ("is_deleted" = false))) WITH CHECK ((("submitted_by" = "auth"."uid"()) AND ("is_approved" = false) AND ("is_deleted" = false)));



CREATE POLICY "reports_moderator_insert" ON "public"."reports" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_moderator"());



CREATE POLICY "reports_moderator_select" ON "public"."reports" FOR SELECT TO "authenticated" USING ("public"."is_moderator"());



CREATE POLICY "reports_moderator_update" ON "public"."reports" FOR UPDATE TO "authenticated" USING ("public"."is_moderator"()) WITH CHECK ("public"."is_moderator"());





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "public"."admin_list_profiles"("pending_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_profiles"("pending_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_profiles"("pending_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."base36"("n" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."base36"("n" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."base36"("n" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."dashboard_stats"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dashboard_stats"("p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dashboard_stats"("p_from" "date", "p_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."email_in_use"("e" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."email_in_use"("e" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."email_in_use"("e" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."export_pins"("p_buckets" "text"[], "p_major" "text", "p_state" "text", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."export_pins"("p_buckets" "text"[], "p_major" "text", "p_state" "text", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."export_pins"("p_buckets" "text"[], "p_major" "text", "p_state" "text", "p_from" "date", "p_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_approved_member"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_approved_member"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_approved_member"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_moderator"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_moderator"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_moderator"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_profiles_guard_privileged"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_profiles_guard_privileged"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."username_available"("u" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."username_available"("u" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."username_available"("u" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";
























GRANT ALL ON TABLE "public"."app_logs" TO "anon";
GRANT ALL ON TABLE "public"."app_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."app_logs" TO "service_role";



GRANT ALL ON TABLE "public"."bookmarks" TO "anon";
GRANT ALL ON TABLE "public"."bookmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."bookmarks" TO "service_role";



GRANT ALL ON TABLE "public"."database_patch_version" TO "service_role";



GRANT ALL ON TABLE "public"."photos" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."photos" TO "authenticated";



GRANT ALL ON TABLE "public"."pins" TO "service_role";
GRANT SELECT ON TABLE "public"."pins" TO "anon";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."pins" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."pins_short_num_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pins_short_num_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT INSERT,DELETE,UPDATE ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("role") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("username") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("initials") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("approved_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("is_approved") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("approved_by") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."reports" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."reports" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."reports_short_num_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."reports_short_num_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























