-- Patch ID:        000001_20260730082524_create_database_patch_version_ledger
-- Baseline ID:     20260729_live_reconciliation_01
-- Expected version: 0 (created by this patch — sanctioned bootstrap, see ../README.md)
-- Target version:   1
--
-- Purpose: bootstrap the versioned-patch ledger. The live database predates the
-- patch methodology and has no public.database_patch_version table. Per the
-- bootstrap exception in ../README.md, this patch — and only this patch — may
-- create the ledger table and its singleton version-0 baseline row. It then
-- advances the ledger to version 1 under its own patch ID.
--
-- Idempotency: rerunning against a ledger already at version 1 with this patch
-- ID is a no-op. Any other ledger state (missing baseline ID, version >= 2, or
-- a foreign patch ID at version 1) aborts before changes.
--
-- Tracked in: GitHub issue #7 (rls-and-grants hardening)

begin;

create table if not exists public.database_patch_version (
    id          boolean primary key default true check (id),
    baseline_id text not null,
    version     integer not null,
    patch_id    text not null,
    applied_at  timestamptz not null default now()
);

comment on table public.database_patch_version is
    'Singleton ledger row recording the applied database patch version. Database-control metadata: no client access, no RLS policies.';

-- Database-control metadata: revoke every client-facing privilege and enable
-- RLS with no policies so PostgREST roles can never touch it.
revoke all on table public.database_patch_version from public, anon, authenticated;
alter table public.database_patch_version enable row level security;

do $$
declare
    v_baseline constant text := '20260729_live_reconciliation_01';
    v_patch_id constant text := '000001_20260730082524_create_database_patch_version_ledger';
    v_row public.database_patch_version%rowtype;
begin
    -- Bootstrap the version-0 baseline row when the ledger is empty.
    insert into public.database_patch_version (id, baseline_id, version, patch_id)
    values (true, v_baseline, 0, 'baseline_' || v_baseline)
    on conflict (id) do nothing;

    select * into v_row
    from public.database_patch_version
    where id
    for update;

    if v_row.baseline_id <> v_baseline then
        raise exception 'ledger baseline % does not match expected %',
            v_row.baseline_id, v_baseline;
    end if;

    if v_row.version = 1 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; no-op rerun', v_patch_id;
        return;
    end if;

    if v_row.version <> 0 then
        raise exception 'ledger at version % (patch %); this patch requires version 0',
            v_row.version, v_row.patch_id;
    end if;

    -- Forward verification: the ledger is locked down before we advance it.
    if has_table_privilege('anon', 'public.database_patch_version', 'select')
       or has_table_privilege('authenticated', 'public.database_patch_version', 'select') then
        raise exception 'verification failed: client roles retain access to the ledger';
    end if;

    update public.database_patch_version
    set version = 1,
        patch_id = v_patch_id,
        applied_at = now()
    where id;
end;
$$;

commit;
