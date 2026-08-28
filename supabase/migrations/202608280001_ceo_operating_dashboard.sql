-- Derived operating metrics and the future management decision tracker.
-- Source systems remain amoCRM and YouGile; this table only stores daily
-- aggregates so week-over-week comparisons do not invent historical state.

create table if not exists public.ceo_metric_snapshots (
  snapshot_date date primary key,
  captured_at timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb,
  source_freshness jsonb not null default '{}'::jsonb
);

create index if not exists ceo_metric_snapshots_captured_idx
  on public.ceo_metric_snapshots (captured_at desc);

create table if not exists public.management_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  hypothesis text,
  decided_at date not null default current_date,
  owner_name text not null,
  check_deadline date,
  expected_result text,
  metric_name text,
  actual_result text,
  status text not null default 'planned',
  next_review_at timestamptz,
  related_entity_type text,
  related_entity_external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint management_decisions_status_check
    check (status in ('planned', 'in_progress', 'validated', 'rejected', 'cancelled'))
);

create index if not exists management_decisions_review_idx
  on public.management_decisions (status, next_review_at);

drop trigger if exists management_decisions_touch_updated_at on public.management_decisions;
create trigger management_decisions_touch_updated_at
before update on public.management_decisions
for each row execute function public.touch_updated_at();

alter table public.ceo_metric_snapshots enable row level security;
alter table public.management_decisions enable row level security;

-- The browser never reads these tables directly. Authenticated requests go
-- through Edge Functions; the service role bypasses RLS.

insert into public.metric_definitions
  (slug, name, domain, source_slug, measurement_status, calculation_notes, required_fields)
values
  ('sales_stalled_14', 'Сделки без движения более 14 дней', 'sales', 'amocrm', 'measured', 'Последняя активность — максимум из обновления сделки, события и задачи.', '["crm_leads","crm_events","crm_tasks"]'),
  ('sales_stalled_30', 'Сделки без движения более 30 дней', 'sales', 'amocrm', 'measured', 'Последняя активность — максимум из обновления сделки, события и задачи.', '["crm_leads","crm_events","crm_tasks"]'),
  ('sales_without_next_step', 'Сделки без следующего шага', 'sales', 'amocrm', 'measured', 'Открытая сделка без незавершённой задачи и без closest_task_at/next_task_at.', '["crm_leads.raw","crm_tasks"]'),
  ('production_overdue_projects', 'Проекты с просроченными задачами', 'production', 'yougile', 'measured', 'Активные проекты, где есть хотя бы одна незавершённая просроченная задача.', '["pm_projects","pm_tasks"]'),
  ('cash_balance', 'Деньги на счетах', 'finance', 'tochka', 'missing', 'Нельзя считать до подключения банковских операций и остатков.', '["bank_accounts","bank_transactions"]'),
  ('accounts_receivable', 'Просроченная дебиторка', 'finance', 'tochka', 'missing', 'Нужны счета, график платежей и факт поступления денег.', '["invoices","payment_due_at","bank_transactions"]')
on conflict (slug) do update set
  name = excluded.name,
  domain = excluded.domain,
  source_slug = excluded.source_slug,
  measurement_status = excluded.measurement_status,
  calculation_notes = excluded.calculation_notes,
  required_fields = excluded.required_fields,
  updated_at = now();
