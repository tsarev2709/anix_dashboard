-- Signing forecast eligibility is explicit and defaults closed for unmapped stages.
alter table public.crm_stage_probabilities add column if not exists forecast_phase text not null default 'unmapped'
  check (forecast_phase in ('signing','excluded','delivery','unmapped'));
alter table public.crm_forecast_settings add column if not exists contract_format_field_id bigint;
alter table public.crm_forecast_settings add column if not exists contract_setup_state text not null default 'not_started';
alter table public.crm_forecast_settings add column if not exists signing_policy_applied_at timestamptz;
alter table public.crm_forecast_settings add column if not exists daily_activity_target integer not null default 800 check (daily_activity_target > 0);
alter table public.crm_leads add column if not exists contract_format text;
-- Existing RLS and service-only grants remain in force. No new public surface.
