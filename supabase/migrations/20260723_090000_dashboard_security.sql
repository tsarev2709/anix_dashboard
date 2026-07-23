-- Anix Dashboard security lockdown. Safe to run repeatedly.

-- Keep integration status values aligned with sync functions.
alter table if exists public.data_sources
  drop constraint if exists data_sources_status_check;

alter table if exists public.data_sources
  add constraint data_sources_status_check
  check (status in ('not_configured', 'syncing', 'healthy', 'warning', 'error'));

-- Prevent direct browser access to operational tables. Edge Functions use the
-- service role and continue to work because the service role bypasses RLS.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'data_sources',
    'integration_credentials',
    'crm_leads',
    'crm_statuses',
    'crm_pipelines',
    'crm_lead_stage_events',
    'crm_users',
    'crm_tasks',
    'crm_events',
    'pm_users',
    'pm_projects',
    'pm_boards',
    'pm_columns',
    'pm_tasks',
    'pm_task_stage_events'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
    end if;
  end loop;
end $$;

-- This internal dashboard currently has one owner account. Reject creation or
-- email change for every other Supabase Auth user, even if public signup is
-- accidentally enabled in the project settings.
create or replace function public.enforce_anix_dashboard_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if lower(coalesce(new.email, '')) <> 'studio@anix-ai.pro' then
    raise exception 'This Supabase project only permits the Anix Dashboard owner account.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_anix_dashboard_owner_trigger on auth.users;
create trigger enforce_anix_dashboard_owner_trigger
before insert or update of email on auth.users
for each row execute function public.enforce_anix_dashboard_owner();

revoke all on function public.enforce_anix_dashboard_owner() from public, anon, authenticated;
