create table if not exists public.crm_users (
  source_slug text not null default 'amocrm',
  external_id bigint not null,
  name text not null,
  email text,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (source_slug, external_id)
);

create index if not exists crm_users_name_idx on public.crm_users(name);

alter table public.crm_users enable row level security;

create policy "Authenticated users can read CRM users"
on public.crm_users
for select
to authenticated
using (true);
