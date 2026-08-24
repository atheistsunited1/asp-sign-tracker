-- Patch ID:        000005_20260821031500_drop_pins_icon_art
-- Baseline ID:     20260729_live_reconciliation_01
-- Expected version: 4
-- Target version:   5
--
-- Purpose: remove the optional "custom pin icons" feature. pins.icon_art held
-- a path into public/icons/ — third-party (Google My Maps) PNGs the app
-- overlaid on markers only when a per-device settings toggle was on. The
-- assets cannot be redistributed in a public repository, so the toggle, the
-- overlay rendering, the icon-art pickers, and the assets are gone from the
-- app. Markers are drawn from icon_type / icon_color / sign_type, which are
-- untouched. Nothing in the schema (views, functions, policies) referenced
-- icon_art; it was a plain column with a default pointing at one of the
-- removed assets, so it is dropped outright.
--
-- Idempotency: drop-if-exists. Rerunning at version 5 with this patch ID
-- re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260729_live_reconciliation_01';
    v_patch_id constant text := '000005_20260821031500_drop_pins_icon_art';
    v_row public.database_patch_version%rowtype;
begin
    if to_regclass('public.database_patch_version') is null then
        raise exception 'ledger table missing; apply patches 000001..000004 first';
    end if;

    select * into v_row from public.database_patch_version where id for update;

    if not found then
        raise exception 'ledger row missing; apply patch 000001 first';
    end if;

    if v_row.baseline_id <> v_baseline then
        raise exception 'ledger baseline % does not match expected %',
            v_row.baseline_id, v_baseline;
    end if;

    if v_row.version = 5 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 4 then
        raise exception 'ledger at version % (patch %); this patch requires version 4',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Drop the column
--------------------------------------------------------------------------------

alter table public.pins drop column if exists icon_art;

--------------------------------------------------------------------------------
-- 2. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'pins'
                 and column_name = 'icon_art') then
        raise exception 'verification failed: pins.icon_art still exists';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 3. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 5,
    patch_id = '000005_20260821031500_drop_pins_icon_art',
    applied_at = now()
where id;

commit;
