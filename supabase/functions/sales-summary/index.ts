import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const [{ data: leads, error: leadsError }, { data: statuses, error: statusesError }, { data: source, error: sourceError }] = await Promise.all([
      supabase.from('crm_leads').select('external_id,name,price,pipeline_external_id,status_external_id,responsible_user_external_id,created_at_source,updated_at_source,closed_at_source').eq('source_slug', 'amocrm'),
      supabase.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order,color').eq('source_slug', 'amocrm').order('sort_order'),
      supabase.from('data_sources').select('status,last_success_at,last_error').eq('slug', 'amocrm').single(),
    ]);

    if (leadsError) throw leadsError;
    if (statusesError) throw statusesError;
    if (sourceError) throw sourceError;

    const allLeads = leads || [];
    const openLeads = allLeads.filter((lead: any) => !lead.closed_at_source);
    const closedLeads = allLeads.filter((lead: any) => Boolean(lead.closed_at_source));
    const pipelineValue = openLeads.reduce((sum: number, lead: any) => sum + Number(lead.price || 0), 0);
    const averageOpenCheck = openLeads.length ? pipelineValue / openLeads.length : 0;

    const statusMap = new Map((statuses || []).map((status: any) => [status.external_id, status]));
    const byStatus = new Map<number, { external_id: number; name: string; color: string | null; sort_order: number | null; count: number; value: number }>();

    for (const lead of openLeads) {
      const status = statusMap.get(lead.status_external_id) as any;
      const key = Number(lead.status_external_id || 0);
      const current = byStatus.get(key) || {
        external_id: key,
        name: status?.name || `Этап ${key}`,
        color: status?.color || null,
        sort_order: status?.sort_order ?? null,
        count: 0,
        value: 0,
      };
      current.count += 1;
      current.value += Number(lead.price || 0);
      byStatus.set(key, current);
    }

    const stages = [...byStatus.values()].sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));
    const recent = [...allLeads]
      .sort((a: any, b: any) => new Date(b.updated_at_source || 0).getTime() - new Date(a.updated_at_source || 0).getTime())
      .slice(0, 10)
      .map((lead: any) => ({
        ...lead,
        status_name: (statusMap.get(lead.status_external_id) as any)?.name || null,
      }));

    return new Response(JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      source,
      summary: {
        total_leads: allLeads.length,
        open_leads: openLeads.length,
        closed_leads: closedLeads.length,
        pipeline_value: pipelineValue,
        average_open_check: averageOpenCheck,
      },
      stages,
      recent,
    }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers,
    });
  }
});
