import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-anix-sync-key',
};
const toIso = (value?: number | null) => value ? new Date(value * 1000).toISOString() : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: jsonHeaders });

  const expectedKey = Deno.env.get('ANIX_SYNC_KEY');
  const suppliedKey = req.headers.get('x-anix-sync-key');
  if (!expectedKey || suppliedKey !== expectedKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized sync request' }), { status: 401, headers: jsonHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let runId: number | null = null;
  try {
    const { data: source, error: sourceError } = await supabase.from('data_sources').select('id').eq('slug', 'amocrm').single();
    if (sourceError) throw sourceError;
    const { data: run, error: runError } = await supabase.from('sync_runs').insert({ source_id: source.id }).select('id').single();
    if (runError) throw runError;
    runId = run.id;

    const { data: credential, error: credentialError } = await supabase.from('integration_credentials').select('*').eq('source_slug', 'amocrm').single();
    if (credentialError || !credential) throw new Error('amoCRM is not authorized yet');

    let accessToken = credential.access_token;
    if (!credential.token_expires_at || new Date(credential.token_expires_at).getTime() < Date.now() + 300000) {
      const refreshResponse = await fetch(`https://${credential.account_domain}/oauth2/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: Deno.env.get('AMOCRM_CLIENT_ID'), client_secret: Deno.env.get('AMOCRM_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: credential.refresh_token, redirect_uri: Deno.env.get('AMOCRM_REDIRECT_URI') }),
      });
      const refreshed = await refreshResponse.json();
      if (!refreshResponse.ok) throw new Error(`amoCRM refresh failed: ${JSON.stringify(refreshed)}`);
      accessToken = refreshed.access_token;
      const { error: tokenError } = await supabase.from('integration_credentials').update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, token_expires_at: new Date(Date.now() + Number(refreshed.expires_in || 86400) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('source_slug', 'amocrm');
      if (tokenError) throw tokenError;
    }

    const api = async (path: string) => {
      const response = await fetch(`https://${credential.account_domain}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 204) return null;
      const body = await response.json();
      if (!response.ok) throw new Error(`amoCRM ${path}: ${JSON.stringify(body)}`);
      return body;
    };

    const pipelinesBody = await api('/api/v4/leads/pipelines');
    const pipelines = pipelinesBody?._embedded?.pipelines || [];
    const pipelineRows = pipelines.map((p: any) => ({ source_slug: 'amocrm', external_id: p.id, name: p.name, is_main: p.is_main, is_archive: p.is_archive, raw: p, synced_at: new Date().toISOString() }));
    const statusRows = pipelines.flatMap((p: any) => (p._embedded?.statuses || []).map((s: any) => ({ source_slug: 'amocrm', external_id: s.id, pipeline_external_id: p.id, name: s.name, sort_order: s.sort, color: s.color, raw: s, synced_at: new Date().toISOString() })));
    if (pipelineRows.length) {
      const { error } = await supabase.from('crm_pipelines').upsert(pipelineRows);
      if (error) throw new Error(`crm_pipelines upsert failed: ${error.message}`);
    }
    if (statusRows.length) {
      const { error } = await supabase.from('crm_statuses').upsert(statusRows);
      if (error) throw new Error(`crm_statuses upsert failed: ${error.message}`);
    }

    let usersPage = 1;
    let usersRead = 0;
    while (usersPage <= 20) {
      const usersBody = await api(`/api/v4/users?limit=250&page=${usersPage}`);
      const users = usersBody?._embedded?.users || [];
      if (!users.length) break;
      usersRead += users.length;
      const { error } = await supabase.from('crm_users').upsert(users.map((user: any) => ({ source_slug: 'amocrm', external_id: user.id, name: user.name || `Пользователь #${user.id}`, email: user.email || null, is_admin: Boolean(user.rights?.is_admin), is_active: user.rights?.is_active !== false, raw: user, synced_at: new Date().toISOString() })));
      if (error) throw new Error(`crm_users upsert failed: ${error.message}`);
      if (!usersBody?._links?.next) break;
      usersPage += 1;
    }

    let page = 1;
    let recordsRead = 0;
    let recordsWritten = 0;
    let transitionsWritten = 0;
    while (page <= 100) {
      const body = await api(`/api/v4/leads?limit=250&page=${page}&order[updated_at]=asc&with=source_id`);
      const leads = body?._embedded?.leads || [];
      if (!leads.length) break;
      recordsRead += leads.length;
      const existingIds = leads.map((lead: any) => lead.id);
      const { data: existing, error: existingError } = await supabase.from('crm_leads').select('external_id,status_external_id,pipeline_external_id').in('external_id', existingIds).eq('source_slug', 'amocrm');
      if (existingError) throw existingError;
      const old = new Map((existing || []).map((x: any) => [x.external_id, x]));
      const rows = leads.map((l: any) => ({ source_slug: 'amocrm', external_id: l.id, name: l.name, price: l.price || 0, pipeline_external_id: l.pipeline_id, status_external_id: l.status_id, responsible_user_external_id: l.responsible_user_id, created_at_source: toIso(l.created_at), updated_at_source: toIso(l.updated_at), closed_at_source: toIso(l.closed_at), loss_reason_external_id: l.loss_reason_id, raw: l, synced_at: new Date().toISOString() }));
      const { error: upsertError } = await supabase.from('crm_leads').upsert(rows);
      if (upsertError) throw upsertError;
      recordsWritten += rows.length;
      const events = leads.filter((l: any) => !old.has(l.id) || old.get(l.id)?.status_external_id !== l.status_id || old.get(l.id)?.pipeline_external_id !== l.pipeline_id).map((l: any) => ({ source_slug: 'amocrm', lead_external_id: l.id, pipeline_external_id: l.pipeline_id, status_external_id: l.status_id, observed_at: toIso(l.updated_at) || new Date().toISOString() }));
      if (events.length) {
        const { error } = await supabase.from('crm_lead_stage_events').insert(events);
        if (error) throw new Error(`crm_lead_stage_events insert failed: ${error.message}`);
        transitionsWritten += events.length;
      }
      if (!body?._links?.next) break;
      page += 1;
    }

    await supabase.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'success', records_read: recordsRead + usersRead + pipelineRows.length + statusRows.length, records_written: recordsWritten + usersRead + pipelineRows.length + statusRows.length + transitionsWritten }).eq('id', runId);
    await supabase.from('data_sources').update({ status: 'healthy', last_success_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), last_error: null }).eq('slug', 'amocrm');
    return new Response(JSON.stringify({ ok: true, recordsRead, recordsWritten, usersRead, pipelinesRead: pipelineRows.length, statusesRead: statusRows.length, transitionsWritten }), { headers: jsonHeaders });
  } catch (error) {
    if (runId) await supabase.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'error', error_message: String(error) }).eq('id', runId);
    await supabase.from('data_sources').update({ status: 'error', last_attempt_at: new Date().toISOString(), last_error: String(error) }).eq('slug', 'amocrm');
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: jsonHeaders });
  }
});