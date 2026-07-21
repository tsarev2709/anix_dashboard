create extension if not exists pgcrypto;

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null,
  connection_mode text not null default 'edge',
  status text not null default 'not_configured',
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  freshness_minutes integer not null default 60,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_sources_status_check check (status in ('not_configured','healthy','warning','error','paused')),
  constraint data_sources_mode_check check (connection_mode in ('edge','local_bridge','manual','chatgpt_connector'))
);

create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  source_id uuid not null references public.data_sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  records_read integer not null default 0,
  records_written integer not null default 0,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  constraint sync_runs_status_check check (status in ('running','success','partial','error'))
);

create table if not exists public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  domain text not null,
  source_slug text,
  measurement_status text not null default 'missing',
  calculation_notes text,
  required_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint metric_measurement_status_check check (measurement_status in ('measured','manual','missing'))
);

insert into public.data_sources (slug, name, category, connection_mode, status, freshness_minutes)
values
  ('amocrm','amoCRM','sales','edge','not_configured',30),
  ('yougile','YouGile','production','edge','not_configured',30),
  ('tochka','Точка','finance','edge','not_configured',180),
  ('telegram','Telegram','communications','edge','not_configured',15),
  ('google','Google Workspace','operations','chatgpt_connector','not_configured',60),
  ('anix_bridge','Anix Bridge','local','local_bridge','not_configured',5)
on conflict (slug) do nothing;

alter table public.data_sources enable row level security;
alter table public.sync_runs enable row level security;
alter table public.metric_definitions enable row level security;

create policy "Authenticated users can read data sources"
on public.data_sources for select
to authenticated
using (true);

create policy "Authenticated users can read sync runs"
on public.sync_runs for select
to authenticated
using (true);

create policy "Authenticated users can read metric definitions"
on public.metric_definitions for select
to authenticated
using (true);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_data_sources_updated_at
before update on public.data_sources
for each row execute function public.touch_updated_at();

create trigger touch_metric_definitions_updated_at
before update on public.metric_definitions
for each row execute function public.touch_updated_at();
