import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const weekStart = new Date(now.getTime() - 7 * 86400000);
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);

    const [{ data: events, error: eventsError }, { data: leads, error: leadsError }, { data: statuses, error: statusesError }, { data: pipelines, error: pipelinesError }, { data: users, error: usersError }] = await Promise.all([
      supabase.from('crm_lead_stage_events').select('lead_external_id,pipeline_external_id,status_external_id,observed_at').eq('source_slug', 'amocrm').gte('observed_at', monthStart.toISOString()).order('observed_at', { ascending: false }),
      supabase.from('crm_leads').select('external_id,name,responsible_user_external_id').eq('source_slug', 'amocrm'),
      supabase.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order').eq('source_slug', 'amocrm'),
      supabase.from('crm_pipelines').select('external_id,name').eq('source_slug', 'amocrm'),
      supabase.from('crm_users').select('external_id,name,is_admin,is_active').eq('source_slug', 'amocrm'),
    ]);
    if (eventsError) throw eventsError;
    if (leadsError) throw leadsError;
    if (statusesError) throw statusesError;
    if (pipelinesError) throw pipelinesError;
    if (usersError) throw usersError;

    const leadMap = new Map((leads || []).map((x: any) => [Number(x.external_id), x]));
    const statusMap = new Map((statuses || []).map((x: any) => [Number(x.external_id), x]));
    const pipelineMap = new Map((pipelines || []).map((x: any) => [Number(x.external_id), x]));
    const userMap = new Map((users || []).map((x: any) => [Number(x.external_id), x]));

    const chronological = [...(events || [])].sort((a: any, b: any) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());
    const previousByLead = new Map<number, any>();
    const enriched = chronological.map((event: any) => {
      const leadId = Number(event.lead_external_id);
      const lead = leadMap.get(leadId) as any;
      const currentStatus = statusMap.get(Number(event.status_external_id)) as any;
      const previous = previousByLead.get(leadId);
      previousByLead.set(leadId, event);
      const previousStatus = previous ? statusMap.get(Number(previous.status_external_id)) as any : null;
      const manager = userMap.get(Number(lead?.responsible_user_external_id || 0)) as any;
      const currentSort = Number(currentStatus?.sort_order || 0);
      const previousSort = Number(previousStatus?.sort_order || 0);
      return {
        lead_external_id: leadId,
        lead_name: lead?.name || `Сделка #${leadId}`,
        observed_at: event.observed_at,
        pipeline_name: pipelineMap.get(Number(event.pipeline_external_id))?.name || null,
        from_status_name: previousStatus?.name || null,
        to_status_name: currentStatus?.name || `Этап ${event.status_external_id}`,
        manager_id: lead?.responsible_user_external_id || null,
        manager_name: manager?.name || `Пользователь #${lead?.responsible_user_external_id || '—'}`,
        direction: previousStatus ? (currentSort > previousSort ? 'forward' : currentSort < previousSort ? 'backward' : 'same') : 'initial',
      };
    }).reverse();

    const countSince = (date: Date) => enriched.filter((x: any) => new Date(x.observed_at) >= date).length;
    const byDayMap = new Map<string, number>();
    enriched.forEach((x: any) => {
      const key = new Date(x.observed_at).toISOString().slice(0, 10);
      byDayMap.set(key, (byDayMap.get(key) || 0) + 1);
    });
    const byStageMap = new Map<string, number>();
    enriched.forEach((x: any) => byStageMap.set(x.to_status_name, (byStageMap.get(x.to_status_name) || 0) + 1));
    const byManagerMap = new Map<string, number>();
    enriched.forEach((x: any) => byManagerMap.set(x.manager_name, (byManagerMap.get(x.manager_name) || 0) + 1));

    return new Response(JSON.stringify({
      ok: true,
      generated_at: now.toISOString(),
      summary: { today: countSince(dayStart), week: countSince(weekStart), month: enriched.length, forward: enriched.filter((x: any) => x.direction === 'forward').length, backward: enriched.filter((x: any) => x.direction === 'backward').length },
      by_day: [...byDayMap.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
      by_stage: [...byStageMap.entries()].map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count),
      by_manager: [...byManagerMap.entries()].map(([manager, count]) => ({ manager, count })).sort((a, b) => b.count - a.count),
      recent: enriched.slice(0, 30),
      caveat: 'История начинается с момента подключения синхронизации. Исполнитель пока определяется по текущему ответственному сделки; точный автор перехода будет добавлен через API событий amoCRM.',
    }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});