

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


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."login_email_for_username"("u" "text") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- prefer approved profile, else latest pending request
  with p as (
    select email
    from public.profiles
    where lower(username) = lower(u)
    limit 1
  ),
  r as (
    select email
    from public.signup_requests
    where lower(username) = lower(u)
      and status in ('pending','approved')
    order by created_at desc
    limit 1
  )
  select coalesce((select email from p), (select email from r));
$$;


ALTER FUNCTION "public"."login_email_for_username"("u" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone DEFAULT ("now"() - '30 days'::interval)) RETURNS TABLE("deleted_reports" integer, "deleted_pins" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_deleted_reports integer := 0;
  v_deleted_pins integer := 0;
begin
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


CREATE OR REPLACE FUNCTION "public"."request_signup"("p_email" "text", "p_username" "text", "p_initials" "text" DEFAULT NULL::"text", "p_zip" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users
   WHERE lower(email) = lower(p_email)
   ORDER BY created_at DESC LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No auth user found for %', p_email;
  END IF;

  INSERT INTO public.signup_requests (user_id, email, username, initials, zip, status)
  VALUES (v_uid, lower(p_email), p_username, p_initials, p_zip, 'pending')
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        username = EXCLUDED.username,
        initials = EXCLUDED.initials,
        zip = EXCLUDED.zip,
        status = 'pending',
        updated_at = now();
END; $$;


ALTER FUNCTION "public"."request_signup"("p_email" "text", "p_username" "text", "p_initials" "text", "p_zip" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;


ALTER FUNCTION "public"."tg_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."username_available"("u" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists (
    select 1 from public.profiles        where lower(username) = lower(u)
    union
    select 1 from public.signup_requests where lower(username) = lower(u) and status in ('pending','approved')
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
    "location_description" "text",
    "short_num" bigint NOT NULL,
    "friendly_id" "text" GENERATED ALWAYS AS (('P-'::"text" || "public"."base36"("short_num"))) STORED,
    "sign_text" "text",
    "sign_type" "text",
    "city" "text",
    "state" "text",
    "gsv_date" "date",
    "submitted_by" "uuid",
    "is_approved" boolean DEFAULT true NOT NULL,
    "is_major_campaign" boolean DEFAULT false NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "campaign_class" "text",
    "icon_color" "text" DEFAULT '#C2185B'::"text" NOT NULL,
    "icon_art" "text" DEFAULT '/icons/1670-religious-christian_4x.png&highlight=ff000000,C2185B&scale=2.0'::"text" NOT NULL,
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
    "admin_secret" "text",
    "role" "text" DEFAULT 'user'::"text",
    "username" "text",
    "initials" "text",
    "zip" "text",
    "approved_at" timestamp with time zone,
    "is_approved" boolean DEFAULT false NOT NULL,
    "approved_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'admin'::"text"]))),
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
    "report_details" "text",
    "short_num" bigint NOT NULL,
    "submitted_by" "uuid",
    "is_approved" boolean DEFAULT true NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone
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



CREATE INDEX "pins_friendly_id_trgm_idx" ON "public"."pins" USING "gin" ("lower"(COALESCE("friendly_id", ''::"text")) "public"."gin_trgm_ops");



CREATE INDEX "pins_icon_type_approved_idx" ON "public"."pins" USING "btree" ("icon_type", "is_approved") WHERE ("is_deleted" = false);



CREATE INDEX "pins_is_deleted_idx" ON "public"."pins" USING "btree" ("is_deleted");



CREATE INDEX "pins_location_description_trgm_idx" ON "public"."pins" USING "gin" ("lower"(COALESCE("location_description", ''::"text")) "public"."gin_trgm_ops");



CREATE INDEX "pins_major_campaign_idx" ON "public"."pins" USING "btree" ("is_major_campaign") WHERE ("is_deleted" = false);



CREATE INDEX "pins_search_fts_idx" ON "public"."pins" USING "gin" ("to_tsvector"('"simple"'::"regconfig", ((((((((((COALESCE("friendly_id", ''::"text") || ' '::"text") || COALESCE("sign_text", ''::"text")) || ' '::"text") || COALESCE("location_description", ''::"text")) || ' '::"text") || COALESCE("city", ''::"text")) || ' '::"text") || COALESCE("state", ''::"text")) || ' '::"text") || COALESCE("zip", ''::"text"))));



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



CREATE INDEX "reports_report_details_trgm_idx" ON "public"."reports" USING "gin" ("lower"(COALESCE("report_details", ''::"text")) "public"."gin_trgm_ops") WHERE ("is_deleted" = false);



CREATE INDEX "reports_report_type_idx" ON "public"."reports" USING "btree" ("report_type") WHERE ("is_deleted" = false);



CREATE INDEX "reports_search_fts_idx" ON "public"."reports" USING "gin" ("to_tsvector"('"simple"'::"regconfig", ((COALESCE("report_type", ''::"text") || ' '::"text") || COALESCE("report_details", ''::"text")))) WHERE ("is_deleted" = false);



CREATE INDEX "reports_submitted_by_idx" ON "public"."reports" USING "btree" ("submitted_by") WHERE ("is_deleted" = false);



CREATE UNIQUE INDEX "ux_photos_report_url" ON "public"."photos" USING "btree" ("report_id", "image_url");



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



CREATE POLICY "logs_insert_anyone" ON "public"."app_logs" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);





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











































































































































































GRANT ALL ON FUNCTION "public"."base36"("n" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."base36"("n" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."base36"("n" bigint) TO "service_role";



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



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."login_email_for_username"("u" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."login_email_for_username"("u" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."login_email_for_username"("u" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_soft_deleted_rows"("cutoff" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."request_signup"("p_email" "text", "p_username" "text", "p_initials" "text", "p_zip" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."request_signup"("p_email" "text", "p_username" "text", "p_initials" "text", "p_zip" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_signup"("p_email" "text", "p_username" "text", "p_initials" "text", "p_zip" "text") TO "service_role";



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



GRANT ALL ON TABLE "public"."photos" TO "anon";
GRANT ALL ON TABLE "public"."photos" TO "authenticated";
GRANT ALL ON TABLE "public"."photos" TO "service_role";



GRANT ALL ON TABLE "public"."pins" TO "anon";
GRANT ALL ON TABLE "public"."pins" TO "authenticated";
GRANT ALL ON TABLE "public"."pins" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pins_short_num_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pins_short_num_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pins_short_num_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON SEQUENCE "public"."reports_short_num_seq" TO "anon";
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






























