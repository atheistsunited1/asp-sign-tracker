-- Patch ID:        000003_20260730083830_fix_purge_function_authorization
-- Baseline ID:     20260729_live_reconciliation_01
-- Expected version: 2
-- Target version:   3
--
-- Purpose: correct two defects in patch 000002's hardening of
-- public.purge_soft_deleted_rows(). Verification (scripts/verify-rls.mjs) found
-- that an anon-key caller could still execute the function after 000002:
--
--   1. The in-function guard read `if auth.uid() is not null and not
--      is_admin()`. An anon-key request has no `sub` claim, so auth.uid() is
--      null and the guard was skipped entirely — the exact opposite of the
--      intent. The bypass is now keyed on the JWT *role* claim: only
--      'service_role' (edge functions) and callers with no JWT at all (direct
--      database sessions: psql, SQL editor, scheduled jobs) skip the admin
--      check. Every PostgREST caller — anon and authenticated alike — must
--      resolve to an admin profile.
--
--   2. `revoke execute ... from anon` does not remove PostgreSQL's implicit
--      `EXECUTE ... TO PUBLIC` grant that every new function receives, so anon
--      retained execute rights through PUBLIC. Execute is now revoked from
--      PUBLIC and anon, and granted explicitly to authenticated and
--      service_role only.
--
-- The two layers are independent: the grant stops anon at the door, the role
-- guard stops any caller who gets past it.
--
-- Additionally revokes anon execute from the 000002 role helpers (is_admin,
-- is_moderator, is_approved_member — they only serve TO-authenticated
-- policies) and all client execute from the profiles guard trigger function
-- (trigger firing does not check the updating role's execute privilege), so
-- the definer audit below holds.
--
-- Idempotency: create-or-replace plus absolute grant/revoke statements; safe to
-- rerun. Rerunning at version 3 with this patch ID re-applies identically.
--
-- Tracked in: GitHub issue #7 (rls-and-grants hardening)

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260729_live_reconciliation_01';
    v_patch_id constant text := '000003_20260730083830_fix_purge_function_authorization';
    v_row public.database_patch_version%rowtype;
begin
    if to_regclass('public.database_patch_version') is null then
        raise exception 'ledger table missing; apply patches 000001 and 000002 first';
    end if;

    select * into v_row from public.database_patch_version where id for update;

    if not found then
        raise exception 'ledger row missing; apply patch 000001 first';
    end if;

    if v_row.baseline_id <> v_baseline then
        raise exception 'ledger baseline % does not match expected %',
            v_row.baseline_id, v_baseline;
    end if;

    if v_row.version = 3 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 2 then
        raise exception 'ledger at version % (patch %); this patch requires version 2',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Correct the authorization guard
--------------------------------------------------------------------------------

create or replace function public.purge_soft_deleted_rows(
    cutoff timestamp with time zone default (now() - '30 days'::interval)
) returns table(deleted_reports integer, deleted_pins integer)
    language plpgsql security definer
    set search_path to 'public'
    as $$
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

--------------------------------------------------------------------------------
-- 2. Correct the execute grants (PUBLIC is the grant anon was riding on)
--------------------------------------------------------------------------------

revoke all on function public.purge_soft_deleted_rows(timestamp with time zone)
    from public, anon;
grant execute on function public.purge_soft_deleted_rows(timestamp with time zone)
    to authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. Remove anon execute from definer functions anon never calls
--------------------------------------------------------------------------------

-- The role helpers serve policies that only apply TO authenticated; no
-- anon-facing policy references them (000002 granted anon more than needed).
-- PUBLIC must be revoked too — anon otherwise retains execute through the
-- implicit PUBLIC grant, exactly like the purge function above.
-- The trigger function needs no client EXECUTE at all: firing a trigger does
-- not check the updating role's execute privilege.
revoke all on function public.is_admin(), public.is_moderator(), public.is_approved_member()
    from public, anon;
grant execute on function public.is_admin(), public.is_moderator(), public.is_approved_member()
    to authenticated, service_role;
revoke all on function public.tg_profiles_guard_privileged()
    from public, anon, authenticated;

--------------------------------------------------------------------------------
-- 4. Audit every other SECURITY DEFINER function reachable by anon
--------------------------------------------------------------------------------

-- login_email_for_username() and username_available() are intentionally
-- anon-callable (username login and signup availability checks) and return a
-- single scalar each. base36() and tg_set_updated_at() are not definers with
-- privileged reach. Assert that no *other* public definer function is
-- anon-executable, so the next one added cannot slip through unnoticed.
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
      and p.proname not in ('login_email_for_username', 'username_available');

    if v_leaks is not null then
        raise exception 'anon can execute unexpected SECURITY DEFINER function(s): %', v_leaks;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 5. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if has_function_privilege('anon',
        'public.purge_soft_deleted_rows(timestamp with time zone)', 'execute') then
        raise exception 'verification failed: anon retains execute on purge_soft_deleted_rows';
    end if;

    if not has_function_privilege('service_role',
        'public.purge_soft_deleted_rows(timestamp with time zone)', 'execute') then
        raise exception 'verification failed: service_role lost execute on purge_soft_deleted_rows';
    end if;

    if not has_function_privilege('authenticated',
        'public.purge_soft_deleted_rows(timestamp with time zone)', 'execute') then
        raise exception 'verification failed: authenticated lost execute on purge_soft_deleted_rows';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 6. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 3,
    patch_id = '000003_20260730083830_fix_purge_function_authorization',
    applied_at = now()
where id;

commit;
