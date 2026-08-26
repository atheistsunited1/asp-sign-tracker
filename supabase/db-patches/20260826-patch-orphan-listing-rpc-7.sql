-- Patch ID:        20260826-patch-orphan-listing-rpc-7
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 6
-- Target version:   7
--
-- Purpose: give the reconcile_orphan_photos job a way to enumerate the bucket
-- in ONE keyset-paginated query instead of walking folders. The Storage list
-- API is per-folder and non-recursive, so at production volume (thousands of
-- pin/report folders) the job exhausted its compute (WORKER_RESOURCE_LIMIT).
-- This SECURITY DEFINER function reads storage.objects directly; it is granted
-- only to service_role (the reconcile job's key) — not anon/authenticated, so
-- it is not an object-enumeration surface for clients.
--
-- Idempotency: create-or-replace. Rerunning at version 7 with this patch ID
-- re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260826-patch-orphan-listing-rpc-7';
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

    if v_row.version = 7 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 6 then
        raise exception 'ledger at version % (patch %); this patch requires version 6',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Keyset-paginated bucket enumeration (service_role only)
--------------------------------------------------------------------------------

create or replace function public.list_sign_photo_objects(p_after text, p_limit integer)
returns table(name text, created_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public', 'storage'
as $$
    select o.name, o.created_at
    from storage.objects o
    where o.bucket_id = 'sign-photos'
      and (p_after is null or o.name > p_after)
    order by o.name
    limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

revoke all on function public.list_sign_photo_objects(text, integer) from public, anon, authenticated;
grant execute on function public.list_sign_photo_objects(text, integer) to service_role;

--------------------------------------------------------------------------------
-- 2. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if to_regprocedure('public.list_sign_photo_objects(text, integer)') is null then
        raise exception 'verification failed: list_sign_photo_objects missing';
    end if;
    if has_function_privilege('anon', 'public.list_sign_photo_objects(text, integer)', 'execute') then
        raise exception 'verification failed: anon can execute list_sign_photo_objects';
    end if;
    if has_function_privilege('authenticated', 'public.list_sign_photo_objects(text, integer)', 'execute') then
        raise exception 'verification failed: authenticated can execute list_sign_photo_objects';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 3. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 7,
    patch_id = '20260826-patch-orphan-listing-rpc-7',
    applied_at = now()
where id;

commit;
