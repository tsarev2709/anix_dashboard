create index if not exists crm_events_time_cursor_idx
 on public.crm_events(source_slug, created_at_source, external_id);
analyze public.crm_events;
