-- Telegram is an intake channel, while YouGile remains the source of truth for tasks.
-- These tables keep only the message context needed for task formulation, deduplication
-- and operational diagnostics.

create table if not exists public.telegram_chat_messages (
  chat_id text not null,
  message_id bigint not null,
  thread_id bigint,
  reply_to_message_id bigint,
  chat_title text,
  sender_id text,
  sender_name text,
  message_text text not null,
  message_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create index if not exists telegram_chat_messages_context_idx
  on public.telegram_chat_messages (chat_id, thread_id, message_at desc);

create table if not exists public.telegram_task_inbox (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  message_id bigint not null,
  reaction_user_id text,
  source_url text,
  original_text text not null,
  context jsonb not null default '[]'::jsonb,
  normalized_title text,
  normalized_description text,
  assignee_hint text,
  project_hint text,
  deadline_hint text,
  confidence numeric,
  status text not null default 'processing',
  yougile_task_id text,
  yougile_response jsonb,
  error text,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint telegram_task_inbox_status_check
    check (status in ('processing', 'created', 'created_without_llm', 'failed', 'ignored')),
  constraint telegram_task_inbox_message_unique unique (chat_id, message_id)
);

create index if not exists telegram_task_inbox_status_idx
  on public.telegram_task_inbox (status, created_at desc);

alter table public.telegram_chat_messages enable row level security;
alter table public.telegram_task_inbox enable row level security;

insert into public.data_sources
  (slug, name, category, connection_mode, status, enabled, freshness_minutes)
values
  ('telegram_tasks', 'Telegram → YouGile', 'operations', 'edge', 'not_configured', true, 15)
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  connection_mode = excluded.connection_mode,
  freshness_minutes = excluded.freshness_minutes;

insert into public.metric_definitions
  (slug, name, domain, source_slug, measurement_status, calculation_notes, required_fields)
values
  ('telegram_task_capture_failures', 'Ошибки постановки задач из Telegram', 'operations', 'telegram_tasks', 'measured', 'Задачи со статусом failed либо processing более 15 минут.', '["telegram_task_inbox"]')
on conflict (slug) do update set
  name = excluded.name,
  domain = excluded.domain,
  source_slug = excluded.source_slug,
  measurement_status = excluded.measurement_status,
  calculation_notes = excluded.calculation_notes,
  required_fields = excluded.required_fields,
  updated_at = now();
