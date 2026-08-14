-- Anix Control: CMS drafts, feature flags, integration switches and audit log.

alter table if exists public.data_sources
  add column if not exists enabled boolean not null default true;

alter table if exists public.data_sources
  add column if not exists disconnected_at timestamptz;

alter table if exists public.data_sources
  drop constraint if exists data_sources_status_check;

alter table if exists public.data_sources
  add constraint data_sources_status_check
  check (status in ('not_configured', 'syncing', 'healthy', 'warning', 'error', 'paused'));

create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'editor', 'analyst', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.admin_profiles (user_id, email, role)
select id, lower(email), 'owner'
from auth.users
where lower(email) = 'studio@anix-ai.pro'
on conflict (user_id) do update set email = excluded.email, role = 'owner', updated_at = now();

create table if not exists public.content_entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  content_type text not null default 'page'
    check (content_type in ('page', 'case', 'article', 'faq', 'cta', 'seo', 'wiki')),
  title text not null,
  body text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'review', 'published', 'archived')),
  source_repo text,
  source_path text,
  metadata jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_versions (
  id bigint generated always as identity primary key,
  content_id uuid not null references public.content_entries(id) on delete cascade,
  version_number integer not null,
  snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (content_id, version_number)
);

create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_entries_status_updated_idx
  on public.content_entries(status, updated_at desc);
create index if not exists content_versions_content_idx
  on public.content_versions(content_id, version_number desc);
create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log(created_at desc);

insert into public.feature_flags (key, enabled, description)
values
  ('ai_chat', true, 'Показывать AI-консультанта на основном сайте'),
  ('website_lead_form', true, 'Принимать заявки с основного сайта'),
  ('wiki_publish', false, 'Разрешить публикацию материалов в Anix Wiki из панели'),
  ('content_publish', false, 'Разрешить публикацию контента основного сайта из панели')
on conflict (key) do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'admin_profiles',
    'content_entries',
    'content_versions',
    'feature_flags',
    'admin_audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;

comment on table public.content_entries is
  'Draft and publication metadata for structured Anix website and wiki content.';
comment on table public.admin_audit_log is
  'Immutable audit trail for Anix Control mutations performed through Edge Functions.';
