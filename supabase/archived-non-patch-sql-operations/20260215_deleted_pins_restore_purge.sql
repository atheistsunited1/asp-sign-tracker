-- Deleted pins/report restore + purge support
-- Date: 2026-02-15

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

alter table public.pins
  add column if not exists deleted_at timestamptz;

alter table public.reports
  add column if not exists deleted_at timestamptz;

create index if not exists pins_deleted_at_idx
  on public.pins (deleted_at)
  where is_deleted = true;

create index if not exists reports_deleted_at_idx
  on public.reports (deleted_at)
  where is_deleted = true;

create index if not exists reports_pin_deleted_idx
  on public.reports (pin_id, deleted_at)
  where is_deleted = true;

create or replace function public.purge_soft_deleted_rows(cutoff timestamptz default (now() - interval '30 days'))
returns table (
  deleted_reports integer,
  deleted_pins integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_reports integer := 0;
  v_deleted_pins integer := 0;
begin
  -- 1) Remove report-linked photos for reports eligible for purge.
  --    (storage object deletion handled by scheduled edge function)
  delete from public.photos p
  using public.reports r
  where p.report_id = r.id
    and r.is_deleted = true
    and r.deleted_at is not null
    and r.deleted_at <= cutoff;

  -- 2) Remove eligible soft-deleted reports.
  delete from public.reports r
  where r.is_deleted = true
    and r.deleted_at is not null
    and r.deleted_at <= cutoff;
  get diagnostics v_deleted_reports = row_count;

  -- 3) Remove eligible soft-deleted pins.
  delete from public.pins p
  where p.is_deleted = true
    and p.deleted_at is not null
    and p.deleted_at <= cutoff;
  get diagnostics v_deleted_pins = row_count;

  return query select v_deleted_reports, v_deleted_pins;
end;
$$;

-- IMPORTANT:
-- Do not schedule this SQL function directly. Storage object deletion should happen
-- first in the scheduled edge function, then call this RPC for DB row purge.

commit;
