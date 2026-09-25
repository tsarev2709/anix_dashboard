alter table public.crm_activity_sync_state add column if not exists live_progress jsonb;
alter table public.crm_activity_sync_state add column if not exists history_progress jsonb;
alter table public.crm_activity_sync_state add column if not exists live_covered_through timestamptz;
