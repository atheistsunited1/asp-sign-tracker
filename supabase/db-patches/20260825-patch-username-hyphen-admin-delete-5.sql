-- Patch ID:        20260825-patch-username-hyphen-admin-delete-5
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 4
-- Target version:   5
--
-- Purpose:
--   1. Allow hyphens in usernames (charset becomes A-Za-z0-9 _ . -) -- decided
--      2026-08-25 after a hyphenated signup aborted on the old check.
--   2. Tidy the redundant username constraints/indexes from the baseline:
--      one length check (3-24) and one case-insensitive unique index remain.
--   3. admin_delete_user(): denying/removing a user must delete BOTH the
--      profile and the auth.users row -- a lingering auth account blocks the
--      email from ever signing up again. SECURITY DEFINER, admin-gated,
--      self-delete refused.
--
-- Idempotency: drop-if-exists + recreate. Rerunning at version 5 with this
-- patch ID re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260825-patch-username-hyphen-admin-delete-5';
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

    if v_row.version = 5 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 4 then
        raise exception 'ledger at version % (patch %); this patch requires version 4',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Username charset: allow hyphen
--------------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_username_chars_ck;
alter table public.profiles add constraint profiles_username_chars_ck
    check (username ~ '^[a-zA-Z0-9_.-]+$');

--------------------------------------------------------------------------------
-- 2. Consolidate redundant username constraints and indexes
--    (keep profiles_username_len_ck 3-24 and profiles_username_ci_uq)
--------------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_username_len_chk;
drop index if exists public.profiles_username_lower_key;
drop index if exists public.profiles_username_lower_unique;
drop index if exists public.profiles_username_lower_uq;

--------------------------------------------------------------------------------
-- 3. Admin user deletion: profile + auth account together
--------------------------------------------------------------------------------

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    if not public.is_admin() then
        raise exception 'admin_delete_user: admin only' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() then
        raise exception 'admin_delete_user: cannot delete your own account';
    end if;
    delete from public.profiles where id = p_user_id;
    delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

--------------------------------------------------------------------------------
-- 4. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'profiles_username_chars_ck'
          and pg_get_constraintdef(oid) like '%-%'
    ) then
        raise exception 'verification failed: hyphen not in username charset check';
    end if;
    if exists (select 1 from pg_constraint where conname = 'profiles_username_len_chk') then
        raise exception 'verification failed: redundant length check still present';
    end if;
    if exists (
        select 1 from pg_class where relname in
        ('profiles_username_lower_key','profiles_username_lower_unique','profiles_username_lower_uq')
    ) then
        raise exception 'verification failed: duplicate username indexes still present';
    end if;
    if to_regclass('public.profiles_username_ci_uq') is null then
        raise exception 'verification failed: canonical username unique index missing';
    end if;
    if to_regprocedure('public.admin_delete_user(uuid)') is null then
        raise exception 'verification failed: admin_delete_user missing';
    end if;
    if has_function_privilege('anon', 'public.admin_delete_user(uuid)', 'execute') then
        raise exception 'verification failed: anon can execute admin_delete_user';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 5. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 5,
    patch_id = '20260825-patch-username-hyphen-admin-delete-5',
    applied_at = now()
where id;

commit;
