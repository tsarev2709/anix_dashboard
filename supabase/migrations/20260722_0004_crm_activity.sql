create table if not exists public.crm_tasks (
  source_slug text not null default 'amocrm',
  external_id bigint not null,
  entity_external_id bigint,
  entity_type text,
  responsible_user_external_id bigint,
  created_by_external_id bigint,
  updated_by_external_id bigint,
  task_type_id bigint,
  text text,
  result_text text,
  is_completed boolean not null default false,
  complete_till timestamptz,
  created_at_source timestamptz,
  updated_at_source timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (source_slug, external_id)
);

create index if not exists crm_tasks_entity_idx on public.crm_tasks(source_slug, entity_type, entity_external_id);
create index if not exists crm_tasks_responsible_idx on public.crm_tasks(source_slug, responsible_user_external_id, updated_at_source desc);
create index if not exists crm_tasks_completed_idx on public.crm_tasks(source_slug, is_completed, complete_till);

create table if not exists public.crm_events (
  source_slug text not null default 'amocrm',
  external_id text not null,
  event_type text not null,
  entity_external_id bigint,
  entity_type text,
  created_by_external_id bigint,
  created_at_source timestamptz not null,
  value_before jsonb not null default '[]'::jsonb,
  value_after jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (source_slug, external_id)
);

create index if not exists crm_events_entity_idx on public.crm_events(source_slug, entity_type, entity_external_id, created_at_source desc);
create index if not exists crm_events_creator_idx on public.crm_events(source_slug, created_by_external_id, created_at_source desc);
create index if not exists crm_events_type_idx on public.crm_events(source_slug, event_type, created_at_source desc);

alter table public.crm_tasks enable row level security;
alter table public.crm_events enable row level security;

create policy "Authenticated users can read CRM tasks"
on public.crm_tasks for select to authenticated using (true);

create policy "Authenticated users can read CRM events"
on public.crm_events for select to authenticated using (true);
