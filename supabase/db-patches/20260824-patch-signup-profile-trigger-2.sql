-- Patch ID:        20260824-patch-signup-profile-trigger-2
-- Baseline ID:     20260824_production_baseline_01
-- Expected version: 1
-- Target version:   2
--
-- Purpose: create the pending profile server-side at signup. With email
-- confirmations ON, auth.signUp returns no session, so the client cannot
-- insert its own profiles row (profiles_self_insert is TO authenticated) —
-- signups produced an auth user with no profile. A SECURITY DEFINER trigger
-- on auth.users now creates the pending row from the signup metadata
-- (username / initials / zip are passed via signUp options.data); the client
-- no longer writes profiles at signup.
--
-- Notes:
--   * A username that loses the race for uniqueness makes the insert (and the
--     signup) fail — the client checks availability first; acceptable.
--   * auth-schema objects do NOT appear in `supabase db dump` schema exports:
--     this trigger must be re-verified after any future canonical
--     reconciliation (see ../README.md).
--
-- Idempotency: create-or-replace + drop-and-recreate. Rerunning at version 2
-- with this patch ID re-applies identically.

begin;

--------------------------------------------------------------------------------
-- 0. Ledger gate
--------------------------------------------------------------------------------

do $$
declare
    v_baseline constant text := '20260824_production_baseline_01';
    v_patch_id constant text := '20260824-patch-signup-profile-trigger-2';
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

    if v_row.version = 2 and v_row.patch_id = v_patch_id then
        raise notice 'patch % already applied; idempotent rerun', v_patch_id;
    elsif v_row.version <> 1 then
        raise exception 'ledger at version % (patch %); this patch requires version 1',
            v_row.version, v_row.patch_id;
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 1. Trigger function: pending profile from signup metadata
--------------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    insert into public.profiles (id, email, username, initials, zip, role, is_approved)
    values (
        new.id,
        new.email,
        nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'initials'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'zip'), ''),
        'user',
        false
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- Definer function used only by the trigger — not client-callable.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

--------------------------------------------------------------------------------
-- 2. Forward verification
--------------------------------------------------------------------------------

do $$
begin
    if to_regprocedure('public.handle_new_user()') is null then
        raise exception 'verification failed: handle_new_user missing';
    end if;
    if not exists (
        select 1 from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'auth' and c.relname = 'users'
          and t.tgname = 'on_auth_user_created' and not t.tgisinternal
    ) then
        raise exception 'verification failed: on_auth_user_created trigger missing';
    end if;
end;
$$;

--------------------------------------------------------------------------------
-- 3. Advance the ledger (final change before commit)
--------------------------------------------------------------------------------

update public.database_patch_version
set version = 2,
    patch_id = '20260824-patch-signup-profile-trigger-2',
    applied_at = now()
where id;

commit;
