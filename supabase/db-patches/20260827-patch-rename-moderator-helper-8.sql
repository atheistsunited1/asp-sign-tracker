-- Patch ID:        20260827-patch-rename-moderator-helper-8
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 7
-- Target version:   8
--
-- Purpose: terminology discipline (behaviour-neutral). The capability
-- "mapmaster or admin" was named `is_moderator()` and its policies
-- `<table>_moderator_<op>` — an over-broad label. In the strict role hierarchy
-- (member < mapmaster < admin) the clear name is the minimum-role threshold:
-- `is_mapmaster_or_higher()`, and the policies become `<table>_mapmaster_<op>`,
-- parallel to the existing `<table>_member_<op>` policies. (Plain
-- `<table>_<op>` is impossible: each table carries BOTH a member-tier and a
-- mapmaster-tier policy per operation, with different predicates.)
--
-- This patch:
--   * adds `is_mapmaster_or_higher()` (exact body of `is_moderator()`);
--   * keeps `is_moderator()` as a thin DEPRECATED wrapper one cycle so any
--     un-migrated caller still works;
--   * renames each `<table>_moderator_<op>` policy to `<table>_mapmaster_<op>`
--     and points it at the clear helper — predicate byte-identical;
--   * updates the `sign-photos` read policy and `can_write_sign_photo`.
--
-- NOT rewritten here: `dashboard_stats` (131 lines) and `export_pins` (74) keep
-- calling `is_moderator()` (the exact wrapper) — behaviour-identical, and
-- reproducing their large bodies just to swap one word would add transcription
-- risk right before launch. They migrate at their next real edit.
--
-- Every predicate is byte-identical except the helper name; only policy NAMES
-- change (internal identifiers, no app/external references). Behaviour-neutral,
-- proven by the local RLS matrix.
--
-- Idempotency: create-or-replace + drop-if-exists (both old and new names).

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260827-patch-rename-moderator-helper-8';
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

    if v_row.version = 8 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 7 then
        raise exception 'ledger at version % (patch %); this patch requires version 7',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Canonical helper + deprecated wrapper
--------------------------------------------------------------------------------

create or replace function public.is_mapmaster_or_higher()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role in ('mapmaster', 'admin')
    );
$$;

revoke all on function public.is_mapmaster_or_higher() from public, anon;
grant execute on function public.is_mapmaster_or_higher() to authenticated, service_role;

-- DEPRECATED: kept one cycle as a thin wrapper so un-migrated callers
-- (dashboard_stats, export_pins) keep working. Prefer is_mapmaster_or_higher().
create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select public.is_mapmaster_or_higher();
$$;

--------------------------------------------------------------------------------
-- 2. Rename the mapmaster-tier policies: <table>_moderator_<op> ->
--    <table>_mapmaster_<op>, pointed at the clear helper. Predicates unchanged.
--------------------------------------------------------------------------------

-- pins
drop policy if exists "pins_moderator_select" on public.pins;
drop policy if exists "pins_mapmaster_select" on public.pins;
create policy "pins_mapmaster_select" on public.pins
    for select to authenticated using (public.is_mapmaster_or_higher());

drop policy if exists "pins_moderator_insert" on public.pins;
drop policy if exists "pins_mapmaster_insert" on public.pins;
create policy "pins_mapmaster_insert" on public.pins
    for insert to authenticated with check (public.is_mapmaster_or_higher());

drop policy if exists "pins_moderator_update" on public.pins;
drop policy if exists "pins_mapmaster_update" on public.pins;
create policy "pins_mapmaster_update" on public.pins
    for update to authenticated
    using (public.is_mapmaster_or_higher()) with check (public.is_mapmaster_or_higher());

-- reports
drop policy if exists "reports_moderator_select" on public.reports;
drop policy if exists "reports_mapmaster_select" on public.reports;
create policy "reports_mapmaster_select" on public.reports
    for select to authenticated using (public.is_mapmaster_or_higher());

drop policy if exists "reports_moderator_insert" on public.reports;
drop policy if exists "reports_mapmaster_insert" on public.reports;
create policy "reports_mapmaster_insert" on public.reports
    for insert to authenticated with check (public.is_mapmaster_or_higher());

drop policy if exists "reports_moderator_update" on public.reports;
drop policy if exists "reports_mapmaster_update" on public.reports;
create policy "reports_mapmaster_update" on public.reports
    for update to authenticated
    using (public.is_mapmaster_or_higher()) with check (public.is_mapmaster_or_higher());

-- photos
drop policy if exists "photos_moderator_select" on public.photos;
drop policy if exists "photos_mapmaster_select" on public.photos;
create policy "photos_mapmaster_select" on public.photos
    for select to authenticated using (public.is_mapmaster_or_higher());

drop policy if exists "photos_moderator_insert" on public.photos;
drop policy if exists "photos_mapmaster_insert" on public.photos;
create policy "photos_mapmaster_insert" on public.photos
    for insert to authenticated with check (public.is_mapmaster_or_higher());

drop policy if exists "photos_moderator_delete" on public.photos;
drop policy if exists "photos_mapmaster_delete" on public.photos;
create policy "photos_mapmaster_delete" on public.photos
    for delete to authenticated using (public.is_mapmaster_or_higher());

--------------------------------------------------------------------------------
-- 3. Storage: read policy (patch 4, renamed) + can_write_sign_photo (patch 6)
--------------------------------------------------------------------------------

drop policy if exists "sign-photos moderator read" on storage.objects;
drop policy if exists "sign-photos mapmaster read" on storage.objects;
create policy "sign-photos mapmaster read" on storage.objects
    for select to authenticated
    using (bucket_id = 'sign-photos' and public.is_mapmaster_or_higher());

create or replace function public.can_write_sign_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select public.is_mapmaster_or_higher() or (
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
-- 4. Forward verification
--------------------------------------------------------------------------------

do $$
declare
    v_new constant text[] := array[
        'pins_mapmaster_select','pins_mapmaster_insert','pins_mapmaster_update',
        'reports_mapmaster_select','reports_mapmaster_insert','reports_mapmaster_update',
        'photos_mapmaster_select','photos_mapmaster_insert','photos_mapmaster_delete',
        'sign-photos mapmaster read'];
begin
    if to_regprocedure('public.is_mapmaster_or_higher()') is null then
        raise exception 'verification failed: is_mapmaster_or_higher missing';
    end if;
    if to_regprocedure('public.is_moderator()') is null then
        raise exception 'verification failed: is_moderator wrapper missing';
    end if;
    -- All renamed policies must exist.
    if (select count(*) from pg_policies
        where schemaname in ('public','storage') and policyname = any(v_new)) <> array_length(v_new, 1) then
        raise exception 'verification failed: a renamed mapmaster policy is missing';
    end if;
    -- No *_moderator_* policy may remain, and none may still call is_moderator.
    if exists (
        select 1 from pg_policies
        where schemaname in ('public','storage')
          and (policyname like '%_moderator_%' or policyname = 'sign-photos moderator read'
               or (coalesce(qual,'') || coalesce(with_check,'')) like '%is_moderator%')
    ) then
        raise exception 'verification failed: a moderator-named policy or is_moderator call remains';
    end if;
    if pg_get_functiondef('public.can_write_sign_photo(text)'::regprocedure) like '%is_moderator%' then
        raise exception 'verification failed: can_write_sign_photo still calls is_moderator';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 5. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 8,
    patch_id = '20260827-patch-rename-moderator-helper-8',
    applied_at = now()
where id;

commit;
