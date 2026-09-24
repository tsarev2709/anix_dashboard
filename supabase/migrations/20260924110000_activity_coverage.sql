-- Internal checkpoint: broader contact/company event history is backfilled in bounded windows.
create table if not exists public.crm_activity_sync_state (
 source_slug text primary key,
 history_from timestamptz not null,
 backfilled_from timestamptz not null,
 live_from timestamptz not null,
 updated_at timestamptz not null default now()
);
alter table public.crm_activity_sync_state enable row level security;
revoke all on public.crm_activity_sync_state from anon, authenticated;
