-- Patch ID:        000002_20260730082525_rls_and_grants_hardening_core_tables
-- Baseline ID:     20260729_live_reconciliation_01
-- Expected version: 1
-- Target version:   2
--
-- Purpose: move the application's security boundary into Postgres. The 2026-07-30
-- canonical snapshot shows pins, reports, photos, and profiles with RLS disabled
-- and GRANT ALL to anon: anyone holding the public anon key can read every
-- profile (emails, roles), self-escalate to admin, and rewrite or delete all map
-- data. This patch implements the access matrix agreed in issue #7:
--
--   actors:    guest (anon) -> member (approved 'user') -> mapmaster -> admin
--   lifecycle: contributions enter pending (is_approved=false), appear
--              immediately, are approved/denied by moderators; members may edit
--              their own contributions only while pending; deny = soft-delete.
--   guests:    may read non-deleted pins only (public map = membership funnel).
--
-- Also closes function-level holes found in the snapshot:
--   * purge_soft_deleted_rows(): SECURITY DEFINER hard-delete, EXECUTE granted
--     to anon -> now requires is_admin() internally (still client-callable by
--     admins via the deleted-pins page).
--   * login_email_for_username() / username_available(): referenced a
--     signup_requests table that does not exist -> repaired to use profiles
--     only, so username login keeps working once profiles is locked down.
--   * request_signup(): dead, broken (same missing table), anon-executable
--     SECURITY DEFINER -> dropped.
--   * profiles.admin_secret: pre-auth backdoor column, referenced nowhere,
--     world-readable under old grants (treat as leaked) -> dropped.
--
-- Idempotency: every statement is guarded (drop-if-exists / create-or-replace /
-- conditional DO blocks). Rerunning at version 2 with this patch ID is a no-op
-- gate pass followed by idempotent re-application. Any other ledger state aborts
-- before schema changes.
--
-- Tracked in: GitHub issue #7 (rls-and-grants hardening)

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260729_live_reconciliation_01';
    v_patch_id constant text := '000002_20260730082525_rls_and_grants_hardening_core_tables';
    v_row public.database_patch_version%rowtype;
begin
    if to_regclass('public.database_patch_version') is null then
        raise exception 'ledger table missing; apply patch 000001 first';
    end if;

    select * into v_row
    from public.database_patch_version
    where id
    for update;

    if not found then
        raise exception 'ledger row missing; apply patch 000001 first';
    end if;

    if v_row.baseline_id <> v_baseline then
        raise exception 'ledger baseline % does not match expected %',
            v_row.baseline_id, v_baseline;
    end if;

    if v_row.version = 2 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 1 then
        raise exception 'ledger at version % (patch %); this patch requires version 1',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Schema corrections
--------------------------------------------------------------------------------

-- 1a. profiles.role must admit 'mapmaster' (the app already models the role).
do $$
declare
    v_def text;
begin
    select pg_get_constraintdef(oid) into v_def
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check';

    if v_def is not null and v_def not like '%mapmaster%' then
        alter table public.profiles drop constraint profiles_role_check;
        v_def := null;
    end if;

    if v_def is null then
        alter table public.profiles
            add constraint profiles_role_check
            check (role = any (array['user'::text, 'mapmaster'::text, 'admin'::text]));
    end if;
end;
$$;

-- 1b. Drop the pre-auth backdoor column (referenced nowhere; contents treated
--     as leaked under the old world-readable grants).
alter table public.profiles drop column if exists admin_secret;

-- 1c. Contributions enter pending: is_approved defaults flip to false.
alter table public.pins    alter column is_approved set default false;
alter table public.reports alter column is_approved set default false;

--------------------------------------------------------------------------------
-- 2. Role helper functions (SECURITY DEFINER so policies on profiles do not
--    recurse into themselves)
--------------------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
        select exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'admin'
        );
    $$;

create or replace function public.is_moderator() returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
        select exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('mapmaster', 'admin')
        );
    $$;

create or replace function public.is_approved_member() returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
        select exists (
            select 1 from public.profiles
            where id = auth.uid() and is_approved
        );
    $$;

grant execute on function public.is_admin(), public.is_moderator(), public.is_approved_member()
    to anon, authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. Function hardening
--------------------------------------------------------------------------------

-- 3a. Hard-delete purge: admin-only. Remains client-callable so the deleted-pins
--     page keeps working for admins; everyone else gets an exception.
create or replace function public.purge_soft_deleted_rows(
    cutoff timestamp with time zone default (now() - '30 days'::interval)
) returns table(deleted_reports integer, deleted_pins integer)
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
    v_deleted_reports integer := 0;
    v_deleted_pins integer := 0;
begin
    -- auth.uid() is null for service-role / server-side callers, which bypass
    -- the guard; every client JWT must resolve to an admin profile.
    if auth.uid() is not null and not public.is_admin() then
        raise exception 'purge_soft_deleted_rows: admin only';
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

revoke execute on function public.purge_soft_deleted_rows(timestamp with time zone) from anon;

-- 3b. Username login resolution: the previous body referenced
--     public.signup_requests, which does not exist. Repair to profiles-only so
--     username sign-in keeps working after profiles is locked down. Deliberate,
--     pre-existing trade-off: resolving username -> login email for anon is the
--     price of username login with Supabase password auth.
create or replace function public.login_email_for_username(u text) returns text
    language sql stable security definer
    set search_path to 'public'
    as $$
        select email
        from public.profiles
        where lower(username) = lower(u)
        limit 1;
    $$;

-- 3c. Signup username-availability check, same missing-table repair.
create or replace function public.username_available(u text) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
        select not exists (
            select 1 from public.profiles where lower(username) = lower(u)
        );
    $$;

grant execute on function public.login_email_for_username(text), public.username_available(text)
    to anon, authenticated, service_role;

-- 3d. Dead, broken, anon-executable SECURITY DEFINER function: drop.
drop function if exists public.request_signup(text, text, text, text);

--------------------------------------------------------------------------------
-- 4. Table grants: anon reads pins only; authenticated gets the minimum verbs
--    the app uses (RLS below constrains rows)
--------------------------------------------------------------------------------

revoke all on table public.pins, public.reports, public.photos, public.profiles
    from anon, authenticated;
revoke all on sequence public.pins_short_num_seq, public.reports_short_num_seq
    from anon;

grant select on table public.pins to anon;                       -- public map
grant select, insert, update on table public.pins     to authenticated;
grant select, insert, update on table public.reports  to authenticated;
grant select, insert, delete on table public.photos   to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;

-- 4b. Member-visible contributor directory. Activities display their
--     submitter's username/initials, but profiles RLS below is own-row-only.
--     This view runs with owner privileges (bypassing profiles RLS) and exposes
--     exactly the fields members may see about each other — nothing more.
create or replace view public.member_profiles as
    select id, username, initials from public.profiles;
alter view public.member_profiles owner to postgres;
revoke all on table public.member_profiles from public, anon, authenticated;
grant select on table public.member_profiles to authenticated, service_role;

--------------------------------------------------------------------------------
-- 5. Row Level Security
--------------------------------------------------------------------------------

alter table public.pins     enable row level security;
alter table public.reports  enable row level security;
alter table public.photos   enable row level security;
alter table public.profiles enable row level security;

-- ---- pins ----
drop policy if exists pins_public_select            on public.pins;
drop policy if exists pins_moderator_select         on public.pins;
drop policy if exists pins_member_insert            on public.pins;
drop policy if exists pins_moderator_insert         on public.pins;
drop policy if exists pins_member_update_own_pending on public.pins;
drop policy if exists pins_moderator_update         on public.pins;

-- Guests and members alike see every non-deleted pin (pending included: the
-- public map is the membership funnel, and pending pins appear immediately).
create policy pins_public_select on public.pins
    for select to anon, authenticated
    using (is_deleted = false);

create policy pins_moderator_select on public.pins
    for select to authenticated
    using (public.is_moderator());

create policy pins_member_insert on public.pins
    for insert to authenticated
    with check (
        public.is_approved_member()
        and submitted_by = auth.uid()
        and is_approved = false
        and is_deleted = false
    );

create policy pins_moderator_insert on public.pins
    for insert to authenticated
    with check (public.is_moderator());

-- Members may edit their own pin only while pending; the WITH CHECK repeats the
-- pending conditions so a member can neither approve, soft-delete, nor reassign
-- their own pin.
create policy pins_member_update_own_pending on public.pins
    for update to authenticated
    using (
        public.is_approved_member()
        and submitted_by = auth.uid()
        and is_approved = false
        and is_deleted = false
    )
    with check (
        submitted_by = auth.uid()
        and is_approved = false
        and is_deleted = false
    );

create policy pins_moderator_update on public.pins
    for update to authenticated
    using (public.is_moderator())
    with check (public.is_moderator());

-- No DELETE policies: hard deletion happens only via purge_soft_deleted_rows.

-- ---- reports ----
drop policy if exists reports_member_select             on public.reports;
drop policy if exists reports_moderator_select          on public.reports;
drop policy if exists reports_member_insert             on public.reports;
drop policy if exists reports_moderator_insert          on public.reports;
drop policy if exists reports_member_update_own_pending on public.reports;
drop policy if exists reports_moderator_update          on public.reports;

create policy reports_member_select on public.reports
    for select to authenticated
    using (public.is_approved_member() and is_deleted = false);

create policy reports_moderator_select on public.reports
    for select to authenticated
    using (public.is_moderator());

create policy reports_member_insert on public.reports
    for insert to authenticated
    with check (
        public.is_approved_member()
        and submitted_by = auth.uid()
        and is_approved = false
        and is_deleted = false
    );

create policy reports_moderator_insert on public.reports
    for insert to authenticated
    with check (public.is_moderator());

create policy reports_member_update_own_pending on public.reports
    for update to authenticated
    using (
        public.is_approved_member()
        and submitted_by = auth.uid()
        and is_approved = false
        and is_deleted = false
    )
    with check (
        submitted_by = auth.uid()
        and is_approved = false
        and is_deleted = false
    );

create policy reports_moderator_update on public.reports
    for update to authenticated
    using (public.is_moderator())
    with check (public.is_moderator());

-- ---- photos (ownership derives from the parent report) ----
drop policy if exists photos_member_select     on public.photos;
drop policy if exists photos_moderator_select  on public.photos;
drop policy if exists photos_member_insert     on public.photos;
drop policy if exists photos_moderator_insert  on public.photos;
drop policy if exists photos_member_delete     on public.photos;
drop policy if exists photos_moderator_delete  on public.photos;

create policy photos_member_select on public.photos
    for select to authenticated
    using (
        public.is_approved_member()
        and exists (
            select 1 from public.reports r
            where r.id = photos.report_id and r.is_deleted = false
        )
    );

create policy photos_moderator_select on public.photos
    for select to authenticated
    using (public.is_moderator());

create policy photos_member_insert on public.photos
    for insert to authenticated
    with check (
        public.is_approved_member()
        and exists (
            select 1 from public.reports r
            where r.id = report_id
              and r.submitted_by = auth.uid()
              and r.is_approved = false
              and r.is_deleted = false
        )
    );

create policy photos_moderator_insert on public.photos
    for insert to authenticated
    with check (public.is_moderator());

-- Members may detach photos only from their own pending report (report editing).
create policy photos_member_delete on public.photos
    for delete to authenticated
    using (
        public.is_approved_member()
        and exists (
            select 1 from public.reports r
            where r.id = photos.report_id
              and r.submitted_by = auth.uid()
              and r.is_approved = false
              and r.is_deleted = false
        )
    );

create policy photos_moderator_delete on public.photos
    for delete to authenticated
    using (public.is_moderator());

-- ---- profiles ----
drop policy if exists profiles_own_select   on public.profiles;
drop policy if exists profiles_admin_select on public.profiles;
drop policy if exists profiles_self_insert  on public.profiles;
drop policy if exists profiles_own_update   on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_admin_delete on public.profiles;

create policy profiles_own_select on public.profiles
    for select to authenticated
    using (id = auth.uid());

create policy profiles_admin_select on public.profiles
    for select to authenticated
    using (public.is_admin());

-- Signup: the client creates its own profile row, which must start as an
-- unapproved plain user.
create policy profiles_self_insert on public.profiles
    for insert to authenticated
    with check (id = auth.uid() and role = 'user' and is_approved = false);

create policy profiles_own_update on public.profiles
    for update to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

create policy profiles_admin_update on public.profiles
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy profiles_admin_delete on public.profiles
    for delete to authenticated
    using (public.is_admin() and id <> auth.uid());

-- Privileged-column guard: role / approval fields change only through an admin,
-- and no admin may change their own role. Server-side callers (auth.uid() is
-- null: service role, SQL editor, definer functions) bypass the guard.
create or replace function public.tg_profiles_guard_privileged() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
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

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
    before update on public.profiles
    for each row execute function public.tg_profiles_guard_privileged();

--------------------------------------------------------------------------------
-- 6. Forward verification
--------------------------------------------------------------------------------

do $$
declare
    v_tbl text;
    v_count integer;
begin
    foreach v_tbl in array array['pins', 'reports', 'photos', 'profiles'] loop
        if not (select relrowsecurity from pg_class
                where oid = ('public.' || v_tbl)::regclass) then
            raise exception 'verification failed: RLS not enabled on %', v_tbl;
        end if;
    end loop;

    if has_table_privilege('anon', 'public.profiles', 'select')
       or has_table_privilege('anon', 'public.reports', 'select')
       or has_table_privilege('anon', 'public.photos', 'select')
       or has_table_privilege('anon', 'public.pins', 'insert, update, delete')
       or has_table_privilege('anon', 'public.profiles', 'insert, update, delete') then
        raise exception 'verification failed: anon retains a forbidden table privilege';
    end if;

    if not has_table_privilege('anon', 'public.pins', 'select') then
        raise exception 'verification failed: anon lost the public-map pin read';
    end if;

    if has_table_privilege('anon', 'public.member_profiles', 'select')
       or not has_table_privilege('authenticated', 'public.member_profiles', 'select') then
        raise exception 'verification failed: member_profiles grants are wrong';
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles'
                 and column_name = 'admin_secret') then
        raise exception 'verification failed: profiles.admin_secret still exists';
    end if;

    if (select pg_get_expr(adbin, adrelid) from pg_attrdef
        where adrelid = 'public.pins'::regclass
          and adnum = (select attnum from pg_attribute
                       where attrelid = 'public.pins'::regclass
                         and attname = 'is_approved')) <> 'false' then
        raise exception 'verification failed: pins.is_approved default is not false';
    end if;

    if (select pg_get_expr(adbin, adrelid) from pg_attrdef
        where adrelid = 'public.reports'::regclass
          and adnum = (select attnum from pg_attribute
                       where attrelid = 'public.reports'::regclass
                         and attname = 'is_approved')) <> 'false' then
        raise exception 'verification failed: reports.is_approved default is not false';
    end if;

    if (select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_role_check') not like '%mapmaster%' then
        raise exception 'verification failed: profiles_role_check does not admit mapmaster';
    end if;

    if to_regprocedure('public.request_signup(text,text,text,text)') is not null then
        raise exception 'verification failed: request_signup still exists';
    end if;

    select count(*) into v_count from pg_policies
    where schemaname = 'public'
      and tablename in ('pins', 'reports', 'photos', 'profiles');
    if v_count < 20 then
        raise exception 'verification failed: expected >= 20 policies on core tables, found %', v_count;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 7. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 2,
    patch_id = '000002_20260730082525_rls_and_grants_hardening_core_tables',
    applied_at = now()
where id;

commit;
