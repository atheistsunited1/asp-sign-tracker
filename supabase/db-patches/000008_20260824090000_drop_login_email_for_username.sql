-- Patch ID:        000008_20260824090000_drop_login_email_for_username
-- Baseline ID:     20260729_live_reconciliation_01
-- Expected version: 7
-- Target version:   8
--
-- Purpose: drop public.login_email_for_username(text) (issue #142). The
-- function was anon-executable SECURITY DEFINER returning the login email for
-- a username — the deliberate price of username login (patch 000002 §3b).
-- With the schema going public it is an obvious username → email enumeration
-- surface, so the decision (2026-08-24) is to drop username login entirely:
-- the app signs in with email only, and nothing calls this function any more.
-- username_available(text) stays (signup availability check; boolean only).
--
-- Idempotency: drop-if-exists. Rerunning at version 8 with this patch ID
-- re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260729_live_reconciliation_01';
    v_patch_id constant text := '000008_20260824090000_drop_login_email_for_username';
    v_row public.database_patch_version%rowtype;
begin
    if to_regclass('public.database_patch_version') is null then
        raise exception 'ledger table missing; apply patches 000001..000007 first';
    end if;

    select * into v_row from public.database_patch_version where id for update;

    if not found then
        raise exception 'ledger row missing; apply patch 000001 first';
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
-- 1. Drop the function
--------------------------------------------------------------------------------

drop function if exists public.login_email_for_username(text);

--------------------------------------------------------------------------------
-- 2. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if to_regprocedure('public.login_email_for_username(text)') is not null then
        raise exception 'verification failed: login_email_for_username still exists';
    end if;
    if to_regprocedure('public.username_available(text)') is null then
        raise exception 'verification failed: username_available should remain';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 3. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 8,
    patch_id = '000008_20260824090000_drop_login_email_for_username',
    applied_at = now()
where id;

commit;
