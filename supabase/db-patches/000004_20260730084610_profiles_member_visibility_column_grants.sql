-- Patch ID:        000004_20260730084610_profiles_member_visibility_column_grants
-- Baseline ID:     20260729_live_reconciliation_01
-- Expected version: 3
-- Target version:   4
--
-- Purpose: rework how members see other members' profiles. Patch 000002 made
-- profiles own-row-only and added a member_profiles view for name lookups, but
-- integration review showed the app depends on PostgREST *embeds* of profiles
-- (reports -> submitter:submitted_by(username,initials,id), approver) and on
-- server-side filters over them (submitter.username ilike ...). Embeds resolve
-- against the profiles table itself, so under own-row-only RLS every submitter
-- name outside your own rows comes back null and username/initials filters
-- silently match nothing for members. The view cannot serve those embeds
-- without rewriting every relationship, so this patch replaces the approach:
--
--   * ROW visibility: approved members may SELECT all profile rows.
--   * COLUMN visibility: authenticated's SELECT becomes column-scoped —
--     email and zip are withheld; id, username, initials, role, approval
--     fields, and timestamps are readable. PostgREST embeds and filters only
--     ever request username/initials/id, so they work unchanged.
--   * Admin account management needs email and zip, and admins share the
--     `authenticated` role, so listing moves to an is_admin()-guarded
--     SECURITY DEFINER function: admin_list_profiles(pending_only).
--   * Signup's "does this email already have an account" preflight loses its
--     direct profiles read -> new email_in_use(text) definer function
--     (boolean only; milder than the existing login_email_for_username, which
--     intentionally returns the email itself for username login).
--   * The member_profiles view from 000002 is superseded and dropped.
--
-- Consequence for clients: SELECTs on profiles must name columns; `select *`
-- now fails for authenticated with a column permission error. All current app
-- call sites request explicit columns.
--
-- Idempotency: absolute grant/revoke statements, create-or-replace, drop-if-
-- exists. Rerunning at version 4 with this patch ID re-applies identically.
--
-- Tracked in: GitHub issue #7 (rls-and-grants hardening)

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260729_live_reconciliation_01';
    v_patch_id constant text := '000004_20260730084610_profiles_member_visibility_column_grants';
    v_row public.database_patch_version%rowtype;
begin
    if to_regclass('public.database_patch_version') is null then
        raise exception 'ledger table missing; apply patches 000001..000003 first';
    end if;

    select * into v_row from public.database_patch_version where id for update;

    if not found then
        raise exception 'ledger row missing; apply patch 000001 first';
    end if;

    if v_row.baseline_id <> v_baseline then
        raise exception 'ledger baseline % does not match expected %',
            v_row.baseline_id, v_baseline;
    end if;

    if v_row.version = 4 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 3 then
        raise exception 'ledger at version % (patch %); this patch requires version 3',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Drop the superseded view
--------------------------------------------------------------------------------

drop view if exists public.member_profiles;

--------------------------------------------------------------------------------
-- 2. Row visibility: approved members see all profile rows
--    (profiles_own_select stays: a not-yet-approved user must still read their
--    own row for the router's approval gate.)
--------------------------------------------------------------------------------

drop policy if exists profiles_member_select on public.profiles;
create policy profiles_member_select on public.profiles
    for select to authenticated
    using (public.is_approved_member());

--------------------------------------------------------------------------------
-- 3. Column visibility: withhold email and zip from the authenticated role
--------------------------------------------------------------------------------

revoke select on table public.profiles from authenticated;
grant select (id, username, initials, role, is_approved,
              created_at, approved_at, approved_by, updated_at)
    on public.profiles to authenticated;

--------------------------------------------------------------------------------
-- 4. Admin account listing (email/zip included) via guarded definer function
--------------------------------------------------------------------------------

create or replace function public.admin_list_profiles(pending_only boolean default false)
    returns table(
        id uuid,
        email text,
        username text,
        initials text,
        zip text,
        role text,
        created_at timestamptz,
        approved_at timestamptz,
        is_approved boolean
    )
    language plpgsql stable security definer
    set search_path to 'public'
    as $$
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

revoke all on function public.admin_list_profiles(boolean) from public, anon;
grant execute on function public.admin_list_profiles(boolean)
    to authenticated, service_role;

--------------------------------------------------------------------------------
-- 5. Signup email preflight: boolean-only existence check
--------------------------------------------------------------------------------

create or replace function public.email_in_use(e text) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
        select exists (
            select 1 from public.profiles where lower(email) = lower(e)
        );
    $$;

grant execute on function public.email_in_use(text)
    to anon, authenticated, service_role;

--------------------------------------------------------------------------------
-- 6. Re-run the anon SECURITY DEFINER audit with the updated allowlist
--------------------------------------------------------------------------------

do $$
declare
    v_leaks text;
begin
    select string_agg(p.proname, ', ')
    into v_leaks
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in ('login_email_for_username', 'username_available', 'email_in_use');

    if v_leaks is not null then
        raise exception 'anon can execute unexpected SECURITY DEFINER function(s): %', v_leaks;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 7. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if to_regclass('public.member_profiles') is not null then
        raise exception 'verification failed: member_profiles view still exists';
    end if;

    if has_column_privilege('authenticated', 'public.profiles', 'email', 'select')
       or has_column_privilege('authenticated', 'public.profiles', 'zip', 'select') then
        raise exception 'verification failed: authenticated can still select email or zip';
    end if;

    if not has_column_privilege('authenticated', 'public.profiles', 'username', 'select')
       or not has_column_privilege('authenticated', 'public.profiles', 'initials', 'select')
       or not has_column_privilege('authenticated', 'public.profiles', 'role', 'select')
       or not has_column_privilege('authenticated', 'public.profiles', 'is_approved', 'select') then
        raise exception 'verification failed: authenticated lost a required profile column';
    end if;

    if has_table_privilege('anon', 'public.profiles', 'select')
       or has_column_privilege('anon', 'public.profiles', 'username', 'select') then
        raise exception 'verification failed: anon can select from profiles';
    end if;

    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = 'profiles'
                     and policyname = 'profiles_member_select') then
        raise exception 'verification failed: profiles_member_select policy missing';
    end if;

    if to_regprocedure('public.admin_list_profiles(boolean)') is null
       or to_regprocedure('public.email_in_use(text)') is null then
        raise exception 'verification failed: expected functions missing';
    end if;

    if has_function_privilege('anon', 'public.admin_list_profiles(boolean)', 'execute') then
        raise exception 'verification failed: anon can execute admin_list_profiles';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 8. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 4,
    patch_id = '000004_20260730084610_profiles_member_visibility_column_grants',
    applied_at = now()
where id;

commit;
