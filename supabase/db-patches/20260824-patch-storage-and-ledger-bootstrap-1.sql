-- Patch ID:        20260824-patch-storage-and-ledger-bootstrap-1
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 0
-- Target version:   1
--
-- Purpose: everything the schema-only version-0 snapshot cannot carry —
--   1. the singleton version-0 ledger row (data, not schema; this patch is the
--      cycle's sanctioned bootstrap and also creates the ledger table if a
--      bare database is missing it),
--   2. the `sign-photos` storage bucket (storage configuration, not schema),
--   3. the storage policies: public read, approved-member upload, admin delete.
--      A looser "authenticated upload" policy (any signed-in user, even
--      unapproved) is explicitly dropped if present — approved-member upload
--      is the intended gate.
--
-- Note: if the SQL editor rejects the storage policy statements with
-- "must be owner of table objects", create the same three policies through
-- Storage → Policies in the dashboard instead, then rerun this patch (the
-- drop/create pairs are skipped-safe and the rest completes the ledger).
--
-- Idempotency: create/insert-if-missing and drop-and-recreate throughout.
-- Rerunning at version 1 with this patch ID re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger bootstrap + gate
--------------------------------------------------------------------------------

create table if not exists public.database_patch_version (
    id boolean default true not null,
    baseline_id text not null,
    version integer not null,
    patch_id text not null,
    applied_at timestamp with time zone default now() not null,
    constraint database_patch_version_id_check check (id),
    constraint database_patch_version_pkey primary key (id)
);

alter table public.database_patch_version enable row level security;
revoke all on table public.database_patch_version from anon, authenticated;

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260824-patch-storage-and-ledger-bootstrap-1';
    v_row public.database_patch_version%rowtype;
begin
    -- Normalize the interim label used by the initial setup scripts, if present.
    update public.database_patch_version
    set baseline_id = v_baseline,
        patch_id = 'baseline_' || v_baseline
    where id and version = 0 and baseline_id = '20260824_au_reconciliation_02';

    -- Bootstrap the version-0 row when missing.
    insert into public.database_patch_version (id, baseline_id, version, patch_id)
    values (true, v_baseline, 0, 'baseline_' || v_baseline)
    on conflict (id) do nothing;

    select * into v_row from public.database_patch_version where id for update;

    if v_row.baseline_id <> v_baseline then
        raise exception 'ledger baseline % does not match expected %',
            v_row.baseline_id, v_baseline;
    end if;

    if v_row.version = 1 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 0 then
        raise exception 'ledger at version % (patch %); this patch requires version 0',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Storage bucket: sign-photos (public read via public-bucket URLs)
--------------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('sign-photos', 'sign-photos', true)
on conflict (id) do update set public = true;

--------------------------------------------------------------------------------
-- 2. Storage policies
--------------------------------------------------------------------------------

drop policy if exists "sign-photos public read" on storage.objects;
create policy "sign-photos public read" on storage.objects
    for select using (bucket_id = 'sign-photos');

drop policy if exists "sign-photos approved upload" on storage.objects;
create policy "sign-photos approved upload" on storage.objects
    for insert with check (
        bucket_id = 'sign-photos'
        and auth.uid() is not null
        and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.is_approved = true
        )
    );

drop policy if exists "sign-photos admin delete" on storage.objects;
create policy "sign-photos admin delete" on storage.objects
    for delete using (public.is_admin() and bucket_id = 'sign-photos');

-- Deliberately absent: an any-authenticated-user upload policy. Drop it if a
-- setup script created one.
drop policy if exists "sign-photos authenticated upload" on storage.objects;

--------------------------------------------------------------------------------
-- 3. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from storage.buckets where id = 'sign-photos' and public) then
        raise exception 'verification failed: sign-photos bucket missing or not public';
    end if;
    if (select count(*) from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname in ('sign-photos public read',
                             'sign-photos approved upload',
                             'sign-photos admin delete')) <> 3 then
        raise exception 'verification failed: expected the 3 sign-photos policies';
    end if;
    if exists (select 1 from pg_policies
               where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'sign-photos authenticated upload') then
        raise exception 'verification failed: loose authenticated-upload policy still present';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 4. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 1,
    patch_id = '20260824-patch-storage-and-ledger-bootstrap-1',
    applied_at = now()
where id;

commit;
