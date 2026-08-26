-- Patch ID:        20260826-patch-photo-object-ownership-6
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 5
-- Target version:   6
--
-- Purpose: enforce PATH OWNERSHIP on sign-photos storage writes, so a storage
-- object is owned exactly like the photos row it belongs to. Previously the
-- storage INSERT policy checked only "approved member" (never the path), and
-- mirror-photo wrote with the service role (bypassing storage RLS entirely).
-- Now a single rule governs both the direct-upload path and mirror-photo
-- (which is being changed to upload AS THE CALLER): a write to
-- sign-photos/{pinId}/{reportId}/{photoId}.ext is allowed iff the caller is a
-- moderator, or an approved member who owns the *pending* report named in the
-- path. This mirrors the existing photos_member_insert row policy.
--
-- Idempotency: create-or-replace + drop/recreate policy. Rerunning at version 6
-- with this patch ID re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260826-patch-photo-object-ownership-6';
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

    if v_row.version = 6 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 5 then
        raise exception 'ledger at version % (patch %); this patch requires version 5',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Ownership predicate: moderator, or approved member who owns the pending
--    report named as the 2nd path segment. SECURITY DEFINER so the storage
--    policy does not depend on the caller's RLS visibility of reports.
--------------------------------------------------------------------------------

create or replace function public.can_write_sign_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select public.is_moderator() or (
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
-- 2. Replace the approved-member-only upload policy with a path-owned one
--------------------------------------------------------------------------------

drop policy if exists "sign-photos approved upload" on storage.objects;
drop policy if exists "sign-photos owner upload" on storage.objects;
create policy "sign-photos owner upload" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'sign-photos' and public.can_write_sign_photo(name));

--------------------------------------------------------------------------------
-- 3. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if to_regprocedure('public.can_write_sign_photo(text)') is null then
        raise exception 'verification failed: can_write_sign_photo missing';
    end if;
    -- Path segment indexing must pick the report id (2nd folder).
    if (storage.foldername('11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/photo.jpg'))[2]
         <> '22222222-2222-2222-2222-222222222222' then
        raise exception 'verification failed: storage.foldername indexing unexpected';
    end if;
    if exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'sign-photos approved upload'
    ) then
        raise exception 'verification failed: old approved-upload policy still present';
    end if;
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'sign-photos owner upload'
    ) then
        raise exception 'verification failed: owner-upload policy missing';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 4. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 6,
    patch_id = '20260826-patch-photo-object-ownership-6',
    applied_at = now()
where id;

commit;
