-- Patch ID:        000006_20260821183000_activity_model
-- Baseline ID:     20260729_live_reconciliation_01
-- Expected version: 5
-- Target version:   6
--
-- Purpose: the activity model loses free text (issue #66 / plan #93).
--   * reports.occurred_on (date) — the domain date of an activity (when it was
--     sighted / plundered / krakened). created_at stays audit-only (row write
--     time); KML-imported activities carry historical dates here.
--   * reports.report_details dropped, with its trigram and FTS indexes —
--     type, occurred_on, member and photos cover what the text held; anything
--     else belongs in the pin description.
--   * pins.location_description renamed to pins.description (UI label
--     "Description"); its trigram index and the pins FTS index are rebuilt.
--
-- Precondition (owner): pins / reports / photos are wiped before this runs;
-- no data migration is performed (the column drop discards audit-note text).
--
-- Idempotency: add-if-not-exists, drop-if-exists, rename guarded by
-- information_schema checks. Rerunning at version 6 with this patch ID
-- re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260729_live_reconciliation_01';
    v_patch_id constant text := '000006_20260821183000_activity_model';
    v_row public.database_patch_version%rowtype;
begin
    if to_regclass('public.database_patch_version') is null then
        raise exception 'ledger table missing; apply patches 000001..000005 first';
    end if;

    select * into v_row from public.database_patch_version where id for update;

    if not found then
        raise exception 'ledger row missing; apply patch 000001 first';
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
-- 1. reports.occurred_on — domain date of the activity
--------------------------------------------------------------------------------

alter table public.reports
    add column if not exists occurred_on date not null default current_date;

create index if not exists reports_pin_occurred_on_idx
    on public.reports (pin_id, occurred_on desc, created_at desc)
    where is_deleted = false;

--------------------------------------------------------------------------------
-- 2. Drop activity free text and its indexes
--------------------------------------------------------------------------------

drop index if exists public.reports_report_details_trgm_idx;
drop index if exists public.reports_search_fts_idx;
alter table public.reports drop column if exists report_details;

--------------------------------------------------------------------------------
-- 3. pins.location_description → pins.description (+ rebuild its indexes)
--------------------------------------------------------------------------------

do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'pins'
                 and column_name = 'location_description')
       and not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'pins'
                         and column_name = 'description') then
        alter table public.pins rename column location_description to description;
    end if;
end;
$$;

drop index if exists public.pins_location_description_trgm_idx;
create index if not exists pins_description_trgm_idx
    on public.pins using gin (lower(coalesce(description, '')) public.gin_trgm_ops);

drop index if exists public.pins_search_fts_idx;
create index if not exists pins_search_fts_idx
    on public.pins using gin (
        to_tsvector('simple',
            coalesce(friendly_id, '') || ' ' || coalesce(sign_text, '') || ' ' ||
            coalesce(description, '') || ' ' || coalesce(city, '') || ' ' ||
            coalesce(state, '') || ' ' || coalesce(zip, '')));

--------------------------------------------------------------------------------
-- 4. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'reports' and column_name = 'occurred_on') then
        raise exception 'verification failed: reports.occurred_on missing';
    end if;
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'reports' and column_name = 'report_details') then
        raise exception 'verification failed: reports.report_details still exists';
    end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'pins' and column_name = 'description') then
        raise exception 'verification failed: pins.description missing';
    end if;
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'pins' and column_name = 'location_description') then
        raise exception 'verification failed: pins.location_description still exists';
    end if;
    if to_regclass('public.pins_description_trgm_idx') is null
       or to_regclass('public.pins_search_fts_idx') is null
       or to_regclass('public.reports_pin_occurred_on_idx') is null then
        raise exception 'verification failed: expected indexes missing';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 5. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 6,
    patch_id = '000006_20260821183000_activity_model',
    applied_at = now()
where id;

commit;
