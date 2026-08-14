import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-anix-sync-key',
};
const iso = (v?: number | null) => v ? new Date(v * 1000).toISOString() : null;
const resultText = (v: any) => !v ? null : typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => x?.text || x?.value || '').filter(Boolean).join('; ') || null : v?.text || null;

function dedupe<T>(rows: T[], key: (row: T) => string, label: string, compatible: (a: T, b: T) => boolean = () => true): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    if (!k || /undefined|null/.test(k)) throw new Error(`${label}: invalid key ${k}`);
    const previous = map.get(k);
    if (previous && !compatible(previous, row)) throw new Error(`${label}: conflicting duplicate ${k}`);
    if (!previous) map.set(k, row);
  }
  return [...map.values()];
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.headers.get('x-anix-sync-key') !== Deno.env.get('ANIX_SYNC_KEY')) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let runId: number | null = null;
  try {
    const { data: source, error: sourceError } = await db.from('data_sources').select('id,last_success_at,enabled,status').eq('slug', 'amocrm').single();
    if (sourceError) throw sourceError;
    if (source.enabled === false || source.status === 'paused') {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'source_paused' }), { status: 200, headers });
    }
    const { data: run, error: runError } = await db.from('sync_runs').insert({ source_id: source.id }).select('id').single();
    if (runError) throw runError;
    runId = run.id;

    const { data: credential, error: credentialError } = await db.from('integration_credentials').select('*').eq('source_slug', 'amocrm').single();
    if (credentialError || !credential) throw new Error('amoCRM is not authorized');
    let token = credential.access_token;
    if (!credential.token_expires_at || new Date(credential.token_expires_at).getTime() < Date.now() + 300000) {
      const r = await fetch(`https://${credential.account_domain}/oauth2/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: Deno.env.get('AMOCRM_CLIENT_ID'), client_secret: Deno.env.get('AMOCRM_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: credential.refresh_token, redirect_uri: Deno.env.get('AMOCRM_REDIRECT_URI') }) });
      const body = await r.json();
      if (!r.ok) throw new Error(`Token refresh failed: ${JSON.stringify(body)}`);
      token = body.access_token;
      const { error } = await db.from('integration_credentials').update({ access_token: body.access_token, refresh_token: body.refresh_token, token_expires_at: new Date(Date.now() + Number(body.expires_in || 86400) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('source_slug', 'amocrm');
      if (error) throw error;
    }

    const api = async (path: string) => {
      const r = await fetch(`https://${credential.account_domain}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 204) return null;
      const text = await r.text();
      let body: any; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      if (!r.ok) throw new Error(`amoCRM ${path}: HTTP ${r.status}: ${JSON.stringify(body)}`);
      return body;
    };
    const upsert = async (table: string, rows: any[], conflict = 'source_slug,external_id') => {
      if (!rows.length) return;
      const { error } = await db.from(table).upsert(rows, { onConflict: conflict });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    };

    const pipelines = (await api('/api/v4/leads/pipelines'))?._embedded?.pipelines || [];
    const pipelineRows = dedupe(pipelines.map((p: any) => ({ source_slug: 'amocrm', external_id: p.id, name: p.name, is_main: p.is_main, is_archive: p.is_archive, raw: p, synced_at: new Date().toISOString() })), x => `${x.source_slug}:${x.external_id}`, 'crm_pipelines');
    const rawStatuses = pipelines.flatMap((p: any) => (p._embedded?.statuses || []).map((s: any) => ({ source_slug: 'amocrm', external_id: s.id, pipeline_external_id: p.id, name: s.name, sort_order: s.sort, color: s.color, raw: s, synced_at: new Date().toISOString() })));
    const statusRows = dedupe(rawStatuses, x => `${x.source_slug}:${x.external_id}`, 'crm_statuses', (a, b) => a.name === b.name && Number(a.sort_order) === Number(b.sort_order));
    await upsert('crm_pipelines', pipelineRows);
    await upsert('crm_statuses', statusRows);

    let usersRead = 0;
    for (let page = 1; page <= 20; page++) {
      const body = await api(`/api/v4/users?limit=250&page=${page}`); const users = body?._embedded?.users || []; if (!users.length) break;
      const rows = dedupe(users.map((u: any) => ({ source_slug: 'amocrm', external_id: u.id, name: u.name || `Пользователь #${u.id}`, email: u.email || null, is_admin: Boolean(u.rights?.is_admin), is_active: u.rights?.is_active !== false, raw: u, synced_at: new Date().toISOString() })), x => `${x.source_slug}:${x.external_id}`, 'crm_users');
      usersRead += rows.length; await upsert('crm_users', rows); if (!body?._links?.next) break;
    }

    let recordsRead = 0, recordsWritten = 0, transitionsWritten = 0;
    for (let page = 1; page <= 100; page++) {
      const body = await api(`/api/v4/leads?limit=250&page=${page}&order[updated_at]=asc&with=source_id`); const leads = body?._embedded?.leads || []; if (!leads.length) break;
      recordsRead += leads.length;
      const ids = leads.map((l: any) => l.id);
      const { data: existing, error } = await db.from('crm_leads').select('external_id,status_external_id,pipeline_external_id').in('external_id', ids).eq('source_slug', 'amocrm'); if (error) throw error;
      const old = new Map((existing || []).map((x: any) => [x.external_id, x]));
      const rows = dedupe(leads.map((l: any) => ({ source_slug: 'amocrm', external_id: l.id, name: l.name, price: l.price || 0, pipeline_external_id: l.pipeline_id, status_external_id: l.status_id, responsible_user_external_id: l.responsible_user_id, created_at_source: iso(l.created_at), updated_at_source: iso(l.updated_at), closed_at_source: iso(l.closed_at), loss_reason_external_id: l.loss_reason_id, raw: l, synced_at: new Date().toISOString() })), x => `${x.source_slug}:${x.external_id}`, 'crm_leads');
      await upsert('crm_leads', rows); recordsWritten += rows.length;
      const changes = rows.filter((l: any) => !old.has(l.external_id) || old.get(l.external_id)?.status_external_id !== l.status_external_id || old.get(l.external_id)?.pipeline_external_id !== l.pipeline_external_id).map((l: any) => ({ source_slug: 'amocrm', lead_external_id: l.external_id, pipeline_external_id: l.pipeline_external_id, status_external_id: l.status_external_id, observed_at: l.updated_at_source || new Date().toISOString() }));
      if (changes.length) { const { error: e } = await db.from('crm_lead_stage_events').insert(changes); if (e) throw e; transitionsWritten += changes.length; }
      if (!body?._links?.next) break;
    }

    const from = source.last_success_at ? Math.floor((new Date(source.last_success_at).getTime() - 2 * 86400000) / 1000) : Math.floor((Date.now() - 180 * 86400000) / 1000);
    let tasksRead = 0;
    for (let page = 1; page <= 100; page++) {
      const body = await api(`/api/v4/tasks?limit=250&page=${page}&filter[updated_at][from]=${from}&order[updated_at]=asc`); const tasks = body?._embedded?.tasks || []; if (!tasks.length) break;
      const rows = dedupe(tasks.map((t: any) => ({ source_slug: 'amocrm', external_id: t.id, entity_external_id: t.entity_id || null, entity_type: t.entity_type || null, responsible_user_external_id: t.responsible_user_id || null, created_by_external_id: t.created_by || null, updated_by_external_id: t.updated_by || null, task_type_id: t.task_type_id || null, text: t.text || null, result_text: resultText(t.result), is_completed: Boolean(t.is_completed), complete_till: iso(t.complete_till), created_at_source: iso(t.created_at), updated_at_source: iso(t.updated_at), raw: t, synced_at: new Date().toISOString() })), x => `${x.source_slug}:${x.external_id}`, 'crm_tasks');
      tasksRead += rows.length; await upsert('crm_tasks', rows); if (!body?._links?.next) break;
    }

    let eventsRead = 0;
    for (let page = 1; page <= 100; page++) {
      const body = await api(`/api/v4/events?limit=100&page=${page}&filter[created_at][from]=${from}&filter[entity][]=lead&filter[entity][]=task&with=lead_name`); const events = body?._embedded?.events || []; if (!events.length) break;
      const rows = dedupe(events.map((e: any) => ({ source_slug: 'amocrm', external_id: String(e.id), event_type: e.type || 'unknown', entity_external_id: e.entity_id || null, entity_type: e.entity_type || null, created_by_external_id: e.created_by || null, created_at_source: iso(e.created_at) || new Date().toISOString(), value_before: e.value_before || [], value_after: e.value_after || [], raw: e, synced_at: new Date().toISOString() })), x => `${x.source_slug}:${x.external_id}`, 'crm_events');
      eventsRead += rows.length; await upsert('crm_events', rows); if (!body?._links?.next) break;
    }

    const read = recordsRead + usersRead + pipelineRows.length + rawStatuses.length + tasksRead + eventsRead;
    const written = recordsWritten + usersRead + pipelineRows.length + statusRows.length + transitionsWritten + tasksRead + eventsRead;
    await db.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'success', records_read: read, records_written: written }).eq('id', runId);
    await db.from('data_sources').update({ status: 'healthy', last_success_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), last_error: null }).eq('slug', 'amocrm');
    return new Response(JSON.stringify({ ok: true, recordsRead, recordsWritten, usersRead, pipelinesRead: pipelineRows.length, statusesRead: rawStatuses.length, statusesWritten: statusRows.length, duplicateStatusesCollapsed: rawStatuses.length - statusRows.length, transitionsWritten, tasksRead, eventsRead }), { headers });
  } catch (error) {
    if (runId) await db.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'error', error_message: String(error) }).eq('id', runId);
    await db.from('data_sources').update({ status: 'error', last_attempt_at: new Date().toISOString(), last_error: String(error) }).eq('slug', 'amocrm');
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});