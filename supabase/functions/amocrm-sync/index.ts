import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const toIso = (value?: number | null) => value ? new Date(value * 1000).toISOString() : null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: jsonHeaders });
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
      const clientId = Deno.env.get('AMOCRM_CLIENT_ID');
      const clientSecret = Deno.env.get('AMOCRM_CLIENT_SECRET');
      const redirectUri = Deno.env.get('AMOCRM_REDIRECT_URI');
      const refreshResponse = await fetch(`https://${credential.account_domain}/oauth2/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: credential.refresh_token, redirect_uri: redirectUri }),
      });
      const refreshed = await refreshResponse.json();
      if (!refreshResponse.ok) throw new Error(`amoCRM refresh failed: ${JSON.stringify(refreshed)}`);
      accessToken = refreshed.access_token;
      await supabase.from('integration_credentials').update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, token_expires_at: new Date(Date.now() + Number(refreshed.expires_in || 86400) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('source_slug', 'amocrm');
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
    if (pipelines.length) {
      await supabase.from('crm_pipelines').upsert(pipelines.map((p: any) => ({ source_slug: 'amocrm', external_id: p.id, name: p.name, is_main: p.is_main, is_archive: p.is_archive, raw: p, synced_at: new Date().toISOString() })));
      const statuses = pipelines.flatMap((p: any) => (p._embedded?.statuses || []).map((s: any) => ({ source_slug: 'amocrm', external_id: s.id, pipeline_external_id: p.id, name: s.name, sort_order: s.sort, color: s.color, raw: s, synced_at: new Date().toISOString() })));
      if (statuses.length) await supabase.from('crm_statuses').upsert(statuses);
    }

    let page = 1;
    let recordsRead = 0;
    let recordsWritten = 0;
    while (page <= 100) {
      const body = await api(`/api/v4/leads?limit=250&page=${page}&order[updated_at]=asc&with=source_id`);
      const leads = body?._embedded?.leads || [];
      if (!leads.length) break;
      recordsRead += leads.length;
      const existingIds = leads.map((lead: any) => lead.id);
      const { data: existing } = await supabase.from('crm_leads').select('external_id,status_external_id,pipeline_external_id').in('external_id', existingIds).eq('source_slug', 'amocrm');
      const old = new Map((existing || []).map((x: any) => [x.external_id, x]));
      const rows = leads.map((l: any) => ({ source_slug: 'amocrm', external_id: l.id, name: l.name, price: l.price || 0, pipeline_external_id: l.pipeline_id, status_external_id: l.status_id, responsible_user_external_id: l.responsible_user_id, created_at_source: toIso(l.created_at), updated_at_source: toIso(l.updated_at), closed_at_source: toIso(l.closed_at), loss_reason_external_id: l.loss_reason_id, raw: l, synced_at: new Date().toISOString() }));
      const { error: upsertError } = await supabase.from('crm_leads').upsert(rows);
      if (upsertError) throw upsertError;
      recordsWritten += rows.length;
      const events = leads.filter((l: any) => !old.has(l.id) || old.get(l.id)?.status_external_id !== l.status_id || old.get(l.id)?.pipeline_external_id !== l.pipeline_id).map((l: any) => ({ source_slug: 'amocrm', lead_external_id: l.id, pipeline_external_id: l.pipeline_id, status_external_id: l.status_id, observed_at: toIso(l.updated_at) || new Date().toISOString() }));
      if (events.length) await supabase.from('crm_lead_stage_events').insert(events);
      if (!body?._links?.next) break;
      page += 1;
    }

    await supabase.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'success', records_read: recordsRead, records_written: recordsWritten }).eq('id', runId);
    await supabase.from('data_sources').update({ status: 'healthy', last_success_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), last_error: null }).eq('slug', 'amocrm');
    return new Response(JSON.stringify({ ok: true, recordsRead, recordsWritten }), { headers: jsonHeaders });
  } catch (error) {
    if (runId) await supabase.from('sync_runs').update({ finished_at: new Date().toISOString(), status: 'error', error_message: String(error) }).eq('id', runId);
    await supabase.from('data_sources').update({ status: 'error', last_attempt_at: new Date().toISOString(), last_error: String(error) }).eq('slug', 'amocrm');
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: jsonHeaders });
  }
});
