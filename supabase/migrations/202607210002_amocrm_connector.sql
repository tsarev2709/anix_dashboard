create table if not exists public.integration_credentials (
  source_slug text primary key references public.data_sources(slug) on delete cascade,
  account_domain text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_pipelines (
  source_slug text not null default 'amocrm',
  external_id bigint not null,
  name text not null,
  is_main boolean not null default false,
  is_archive boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (source_slug, external_id)
);

create table if not exists public.crm_statuses (
  source_slug text not null default 'amocrm',
  external_id bigint not null,
  pipeline_external_id bigint not null,
  name text not null,
  sort_order integer,
  color text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (source_slug, external_id)
);

create table if not exists public.crm_leads (
  source_slug text not null default 'amocrm',
  external_id bigint not null,
  name text,
  price numeric not null default 0,
  pipeline_external_id bigint,
  status_external_id bigint,
  responsible_user_external_id bigint,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  closed_at_source timestamptz,
  loss_reason_external_id bigint,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (source_slug, external_id)
);

create table if not exists public.crm_lead_stage_events (
  id bigint generated always as identity primary key,
  source_slug text not null default 'amocrm',
  lead_external_id bigint not null,
  pipeline_external_id bigint,
  status_external_id bigint,
  observed_at timestamptz not null default now(),
  unique (source_slug, lead_external_id, status_external_id, observed_at)
);

create index if not exists crm_leads_updated_idx on public.crm_leads(updated_at_source desc);
create index if not exists crm_stage_events_lead_idx on public.crm_lead_stage_events(lead_external_id, observed_at);

alter table public.integration_credentials enable row level security;
alter table public.crm_pipelines enable row level security;
alter table public.crm_statuses enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_lead_stage_events enable row level security;

create policy "Authenticated users can read CRM pipelines" on public.crm_pipelines for select to authenticated using (true);
create policy "Authenticated users can read CRM statuses" on public.crm_statuses for select to authenticated using (true);
create policy "Authenticated users can read CRM leads" on public.crm_leads for select to authenticated using (true);
create policy "Authenticated users can read CRM stage events" on public.crm_lead_stage_events for select to authenticated using (true);

insert into public.metric_definitions (slug, name, domain, source_slug, measurement_status, calculation_notes, required_fields)
values
  ('sales_pipeline_value','Объём воронки','sales','amocrm','measured','Сумма бюджетов открытых сделок','["price","status_id"]'),
  ('sales_stage_conversion','Конверсия между этапами','sales','amocrm','measured','Считается по наблюдаемым переходам сделок','["lead_id","status_id","observed_at"]'),
  ('sales_stage_duration','Скорость прохождения этапов','sales','amocrm','measured','Разница между последовательными событиями этапов','["lead_id","status_id","observed_at"]')
on conflict (slug) do update set measurement_status = excluded.measurement_status, calculation_notes = excluded.calculation_notes, required_fields = excluded.required_fields;
