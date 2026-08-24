-- Map search + bookmarks migration
-- Date: 2026-02-14
-- Notes:
-- - Adds pins.zip for pin-location ZIP prefix filtering.
-- - Adds bookmarks table (private per-user), with cascade only on bookmarks rows.
-- - Adds text-search indexes (trgm + FTS) for map search scale.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- 1) pins.zip (nullable; backfill done separately in app/script)
alter table public.pins
  add column if not exists zip text;

-- 2) bookmarks table
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  pin_id uuid not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookmarks_user_pin_key'
      and conrelid = 'public.bookmarks'::regclass
  ) then
    alter table public.bookmarks
      add constraint bookmarks_user_pin_key unique (user_id, pin_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookmarks_user_id_fkey'
      and conrelid = 'public.bookmarks'::regclass
  ) then
    alter table public.bookmarks
      add constraint bookmarks_user_id_fkey
      foreign key (user_id)
      references public.profiles(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookmarks_pin_id_fkey'
      and conrelid = 'public.bookmarks'::regclass
  ) then
    alter table public.bookmarks
      add constraint bookmarks_pin_id_fkey
      foreign key (pin_id)
      references public.pins(id)
      on delete cascade;
  end if;
end $$;

create index if not exists bookmarks_user_created_at_idx
  on public.bookmarks (user_id, created_at desc);

create index if not exists bookmarks_pin_id_idx
  on public.bookmarks (pin_id);

alter table public.bookmarks enable row level security;

drop policy if exists bookmarks_select_own on public.bookmarks;
create policy bookmarks_select_own
  on public.bookmarks
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists bookmarks_insert_own on public.bookmarks;
create policy bookmarks_insert_own
  on public.bookmarks
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists bookmarks_delete_own on public.bookmarks;
create policy bookmarks_delete_own
  on public.bookmarks
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.bookmarks to authenticated;

-- 3) Map search / filter indexes
-- Pins filtering indexes
create index if not exists pins_is_deleted_idx
  on public.pins (is_deleted);

create index if not exists pins_icon_type_approved_idx
  on public.pins (icon_type, is_approved)
  where is_deleted = false;

create index if not exists pins_major_campaign_idx
  on public.pins (is_major_campaign)
  where is_deleted = false;

create index if not exists pins_state_city_idx
  on public.pins (state, city)
  where is_deleted = false;

create index if not exists pins_zip_idx
  on public.pins (zip)
  where is_deleted = false and zip is not null;

create index if not exists pins_updated_at_desc_idx
  on public.pins (updated_at desc)
  where is_deleted = false;

-- Pins text search acceleration (ILIKE / fuzzy)
create index if not exists pins_friendly_id_trgm_idx
  on public.pins using gin (lower(coalesce(friendly_id, '')) gin_trgm_ops);

create index if not exists pins_sign_text_trgm_idx
  on public.pins using gin (lower(coalesce(sign_text, '')) gin_trgm_ops);

create index if not exists pins_location_description_trgm_idx
  on public.pins using gin (lower(coalesce(location_description, '')) gin_trgm_ops);

create index if not exists pins_city_trgm_idx
  on public.pins using gin (lower(coalesce(city, '')) gin_trgm_ops);

create index if not exists pins_state_trgm_idx
  on public.pins using gin (lower(coalesce(state, '')) gin_trgm_ops);

create index if not exists pins_zip_trgm_idx
  on public.pins using gin (lower(coalesce(zip, '')) gin_trgm_ops);

create index if not exists pins_search_fts_idx
  on public.pins using gin (
    to_tsvector(
      'simple',
      coalesce(friendly_id, '') || ' ' ||
      coalesce(sign_text, '') || ' ' ||
      coalesce(location_description, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(state, '') || ' ' ||
      coalesce(zip, '')
    )
  );

-- Reports search acceleration
create index if not exists reports_pin_id_created_at_desc_idx
  on public.reports (pin_id, created_at desc)
  where is_deleted = false;

create index if not exists reports_report_type_idx
  on public.reports (report_type)
  where is_deleted = false;

create index if not exists reports_submitted_by_idx
  on public.reports (submitted_by)
  where is_deleted = false;

create index if not exists reports_is_approved_idx
  on public.reports (is_approved)
  where is_deleted = false;

create index if not exists reports_report_details_trgm_idx
  on public.reports using gin (lower(coalesce(report_details, '')) gin_trgm_ops)
  where is_deleted = false;

create index if not exists reports_search_fts_idx
  on public.reports using gin (
    to_tsvector(
      'simple',
      coalesce(report_type, '') || ' ' ||
      coalesce(report_details, '')
    )
  )
  where is_deleted = false;

-- Photos join acceleration (has photos + popup photo fetch)
create index if not exists photos_report_id_created_at_desc_idx
  on public.photos (report_id, created_at desc);

commit;
