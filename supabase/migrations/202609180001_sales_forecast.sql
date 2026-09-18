-- Idempotent: deployment re-applies migrations. No customer stage IDs or guessed probabilities.
alter table public.crm_leads add column if not exists expected_close_date date;
alter table public.crm_leads add column if not exists expected_close_date_invalid boolean not null default false;
create index if not exists crm_leads_expected_close_idx on public.crm_leads(source_slug, expected_close_date);
create index if not exists crm_leads_closed_idx on public.crm_leads(source_slug, closed_at_source);

create table if not exists public.crm_forecast_settings (
  source_slug text primary key default 'amocrm',
  expected_close_field_id bigint,
  timezone text not null default 'Europe/Moscow',
  observed_enabled boolean not null default false,
  min_sample_size integer not null default 30 check (min_sample_size >= 10),
  field_state jsonb not null default '{"state":"not_synced"}',
  metadata_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.crm_forecast_settings add column if not exists last_snapshot_date date;
insert into public.crm_forecast_settings(source_slug) values ('amocrm') on conflict do nothing;

create table if not exists public.crm_lead_custom_fields (
  source_slug text not null default 'amocrm',
  external_id bigint not null,
  name text not null,
  code text,
  field_type text not null,
  synced_at timestamptz not null default now(),
  primary key(source_slug, external_id)
);
create table if not exists public.crm_loss_reasons (
  source_slug text not null default 'amocrm',
  external_id bigint not null,
  name text not null,
  synced_at timestamptz not null default now(),
  primary key(source_slug, external_id)
);
create table if not exists public.crm_stage_probabilities (
  source_slug text not null default 'amocrm',
  pipeline_external_id bigint not null,
  status_external_id bigint not null,
  manual_override numeric check (manual_override between 0 and 1),
  fallback_probability numeric check (fallback_probability between 0 and 1),
  requires_expected_date boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(source_slug, pipeline_external_id, status_external_id)
);
-- 0 is an aggregate sentinel, never a CRM user/pipeline ID; -1 means unassigned manager.
create table if not exists public.sales_forecast_snapshots (
  source_slug text not null default 'amocrm',
  snapshot_date date not null,
  forecast_month date not null,
  manager_external_id bigint not null default 0,
  pipeline_external_id bigint not null default 0,
  captured_at timestamptz not null default now(),
  fact_amount numeric not null,
  weighted_forecast_amount numeric,
  potential_pipeline_amount numeric not null,
  open_deals_count integer not null,
  expected_deals_count integer not null,
  raw_metrics jsonb not null default '{}',
  primary key(source_slug, snapshot_date, forecast_month, manager_external_id, pipeline_external_id)
);
create index if not exists forecast_snapshots_month_idx on public.sales_forecast_snapshots(forecast_month, snapshot_date);
-- Service-role only, through an authenticated owner endpoint. No public policies.
alter table public.crm_forecast_settings enable row level security;
alter table public.crm_lead_custom_fields enable row level security;
alter table public.crm_loss_reasons enable row level security;
alter table public.crm_stage_probabilities enable row level security;
alter table public.sales_forecast_snapshots enable row level security;
revoke all on public.crm_forecast_settings, public.crm_lead_custom_fields, public.crm_loss_reasons, public.crm_stage_probabilities, public.sales_forecast_snapshots from anon, authenticated;

-- Do not depend on project default privileges for server-only tables.
grant select, insert, update, delete on public.crm_forecast_settings, public.crm_lead_custom_fields, public.crm_loss_reasons, public.crm_stage_probabilities, public.sales_forecast_snapshots to service_role;
