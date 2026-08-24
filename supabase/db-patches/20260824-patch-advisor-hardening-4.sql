-- Patch ID:        20260824-patch-advisor-hardening-4
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 3
-- Target version:   4
--
-- Purpose: resolve the actionable Security Advisor findings.
--   1. Pin search_path on the two functions that lacked it (base36,
--      tg_set_updated_at) — all other functions already pin it.
--   2. tg_profiles_guard_privileged is a trigger function; it has no business
--      being RPC-callable. Revoke EXECUTE from API roles.
--   3. The "sign-photos public read" storage policy allowed anyone to LIST the
--      whole bucket. Public buckets serve object URLs without any SELECT
--      policy, and the only in-app listing is the KML importer's moderator
--      pre-flight check — so listing becomes moderator-only. Photo URLs keep
--      working for everyone.
--   4. Drop public.email_in_use(text): an anon-callable email-enumeration
--      surface (same class as the removed username→email lookup). The signup
--      flow now detects an already-registered email from auth.signUp itself
--      (obfuscated user with empty identities array), so nothing needs it.
--
-- Idempotency: alter/revoke/drop-if-exists/create-or-replace. Rerunning at
-- version 4 with this patch ID re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260824-patch-advisor-hardening-4';
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

    if v_row.version = 4 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 3 then
        raise exception 'ledger at version % (patch %); this patch requires version 3',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Pin search_path on the remaining functions
--------------------------------------------------------------------------------

alter function public.base36(bigint) set search_path to 'public';
alter function public.tg_set_updated_at() set search_path to 'public';

--------------------------------------------------------------------------------
-- 2. Trigger function is not an API surface
--------------------------------------------------------------------------------

revoke execute on function public.tg_profiles_guard_privileged() from public, anon, authenticated;

--------------------------------------------------------------------------------
-- 3. Bucket listing is moderator-only (object URLs unaffected: public bucket)
--------------------------------------------------------------------------------

drop policy if exists "sign-photos public read" on storage.objects;

drop policy if exists "sign-photos moderator read" on storage.objects;
create policy "sign-photos moderator read" on storage.objects
    for select to authenticated
    using (bucket_id = 'sign-photos' and public.is_moderator());

--------------------------------------------------------------------------------
-- 4. Drop the email-enumeration RPC
--------------------------------------------------------------------------------

drop function if exists public.email_in_use(text);

--------------------------------------------------------------------------------
-- 5. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'base36'
          and p.proconfig::text like '%search_path%'
    ) then
        raise exception 'verification failed: base36 search_path not pinned';
    end if;
    if not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'tg_set_updated_at'
          and p.proconfig::text like '%search_path%'
    ) then
        raise exception 'verification failed: tg_set_updated_at search_path not pinned';
    end if;
    if has_function_privilege('anon', 'public.tg_profiles_guard_privileged()', 'execute') then
        raise exception 'verification failed: anon can still execute tg_profiles_guard_privileged';
    end if;
    if exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'sign-photos public read'
    ) then
        raise exception 'verification failed: public read policy still present';
    end if;
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'sign-photos moderator read'
    ) then
        raise exception 'verification failed: moderator read policy missing';
    end if;
    if to_regprocedure('public.email_in_use(text)') is not null then
        raise exception 'verification failed: email_in_use still exists';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 6. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 4,
    patch_id = '20260824-patch-advisor-hardening-4',
    applied_at = now()
where id;

commit;
