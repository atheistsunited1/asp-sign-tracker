-- Patch ID:        20260824-patch-public-activity-rpcs-3
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 2
-- Target version:   3
--
-- Purpose: public (anon) read access to APPROVED activity, without opening the
-- reports/photos tables. The map popup photo strip and the nearby-pin
-- selector's enrichment (latest activity + photo thumbnails) must work for
-- logged-out visitors, but reports/photos row access stays members-only.
-- Two SECURITY DEFINER functions return only approved, non-deleted rows whose
-- pin is also approved and non-deleted.
--
-- Idempotency: create-or-replace. Rerunning at version 3 with this patch ID
-- re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260824-patch-public-activity-rpcs-3';
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

    if v_row.version = 3 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 2 then
        raise exception 'ledger at version % (patch %); this patch requires version 2',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Approved reports of approved pins, newest first
--------------------------------------------------------------------------------

create or replace function public.public_reports_for_pins(p_pin_ids uuid[])
returns table(
    id uuid,
    pin_id uuid,
    report_type text,
    occurred_on date,
    created_at timestamp with time zone
)
language sql
stable
security definer
set search_path to 'public'
as $$
    select r.id, r.pin_id, r.report_type, r.occurred_on, r.created_at
    from public.reports r
    join public.pins p on p.id = r.pin_id
    where r.pin_id = any(p_pin_ids)
      and r.is_approved and not r.is_deleted
      and p.is_approved and not p.is_deleted
    order by r.occurred_on desc, r.created_at desc;
$$;

revoke all on function public.public_reports_for_pins(uuid[]) from public;
grant execute on function public.public_reports_for_pins(uuid[]) to anon, authenticated;

--------------------------------------------------------------------------------
-- 2. Photos of approved reports of approved pins, newest first
--------------------------------------------------------------------------------

create or replace function public.public_photos_for_reports(p_report_ids uuid[])
returns table(
    report_id uuid,
    image_url text,
    created_at timestamp with time zone
)
language sql
stable
security definer
set search_path to 'public'
as $$
    select ph.report_id, ph.image_url, ph.created_at
    from public.photos ph
    join public.reports r on r.id = ph.report_id
    join public.pins p on p.id = r.pin_id
    where ph.report_id = any(p_report_ids)
      and r.is_approved and not r.is_deleted
      and p.is_approved and not p.is_deleted
    order by ph.created_at desc;
$$;

revoke all on function public.public_photos_for_reports(uuid[]) from public;
grant execute on function public.public_photos_for_reports(uuid[]) to anon, authenticated;

--------------------------------------------------------------------------------
-- 3. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if to_regprocedure('public.public_reports_for_pins(uuid[])') is null then
        raise exception 'verification failed: public_reports_for_pins missing';
    end if;
    if to_regprocedure('public.public_photos_for_reports(uuid[])') is null then
        raise exception 'verification failed: public_photos_for_reports missing';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 4. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 3,
    patch_id = '20260824-patch-public-activity-rpcs-3',
    applied_at = now()
where id;

commit;
