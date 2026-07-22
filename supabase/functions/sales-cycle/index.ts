import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const norm = (value: unknown) => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
const key = (pipelineId: unknown, statusId: unknown) => `${Number(pipelineId || 0)}:${Number(statusId || 0)}`;
const DAY = 86400000;
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = new Date();
    const [{ data: leads, error: leadsError }, { data: statuses, error: statusesError }, { data: pipelines, error: pipelinesError }, { data: events, error: eventsError }] = await Promise.all([
      supabase.from('crm_leads').select('external_id,name,pipeline_external_id,status_external_id,responsible_user_external_id,updated_at_source,closed_at_source').eq('source_slug', 'amocrm'),
      supabase.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order').eq('source_slug', 'amocrm').order('sort_order'),
      supabase.from('crm_pipelines').select('external_id,name').eq('source_slug', 'amocrm'),
      supabase.from('crm_lead_stage_events').select('lead_external_id,pipeline_external_id,status_external_id,observed_at').eq('source_slug', 'amocrm').order('observed_at', { ascending: true }).limit(10000),
    ]);
    if (leadsError) throw leadsError;
    if (statusesError) throw statusesError;
    if (pipelinesError) throw pipelinesError;
    if (eventsError) throw eventsError;

    const statusMap = new Map<string, any>((statuses || []).map((s: any) => [key(s.pipeline_external_id, s.external_id), s]));
    const pipelineMap = new Map<number, any>((pipelines || []).map((p: any) => [Number(p.external_id), p]));
    const eventsByLead = new Map<number, any[]>();
    for (const event of events || []) {
      const id = Number(event.lead_external_id);
      if (!eventsByLead.has(id)) eventsByLead.set(id, []);
      eventsByLead.get(id)!.push(event);
    }

    const openLeads = (leads || []).filter((lead: any) => !lead.closed_at_source);
    const stageGroups = new Map<string, any[]>();
    for (const lead of openLeads) {
      const status = statusMap.get(key(lead.pipeline_external_id, lead.status_external_id));
      const stageKey = key(lead.pipeline_external_id, lead.status_external_id);
      const history = eventsByLead.get(Number(lead.external_id)) || [];
      const currentEntries = history.filter((event: any) => Number(event.pipeline_external_id) === Number(lead.pipeline_external_id) && Number(event.status_external_id) === Number(lead.status_external_id));
      const enteredAt = currentEntries.length ? new Date(currentEntries[currentEntries.length - 1].observed_at) : new Date(lead.updated_at_source || now);
      const ageDays = Math.max(0, (now.getTime() - enteredAt.getTime()) / DAY);
      if (!stageGroups.has(stageKey)) stageGroups.set(stageKey, []);
      stageGroups.get(stageKey)!.push({ external_id: lead.external_id, name: lead.name || `Сделка #${lead.external_id}`, age_days: ageDays, entered_at: enteredAt.toISOString(), estimated: !currentEntries.length });
    }

    const stageAging = [...stageGroups.entries()].map(([stageKey, items]) => {
      const [pipelineId, statusId] = stageKey.split(':').map(Number);
      const status = statusMap.get(stageKey);
      const ages = items.map((item: any) => item.age_days);
      return {
        pipeline_external_id: pipelineId,
        pipeline_name: pipelineMap.get(pipelineId)?.name || null,
        status_external_id: statusId,
        stage_name: status?.name || `Этап ${statusId}`,
        sort_order: status?.sort_order ?? 9999,
        count: items.length,
        average_days: average(ages),
        median_days: median(ages),
        max_days: ages.length ? Math.max(...ages) : null,
        estimated_count: items.filter((item: any) => item.estimated).length,
        oldest: [...items].sort((a: any, b: any) => b.age_days - a.age_days).slice(0, 5),
      };
    }).sort((a, b) => String(a.pipeline_name || '').localeCompare(String(b.pipeline_name || ''), 'ru') || a.sort_order - b.sort_order);

    const findStageKeys = (names: string[]) => {
      const wanted = new Set(names.map(norm));
      return new Set((statuses || []).filter((status: any) => wanted.has(norm(status.name))).map((status: any) => key(status.pipeline_external_id, status.external_id)));
    };
    const firstTouchKeys = findStageKeys(['Первое касание сделано']);
    const dialogKeys = findStageKeys(['Диалог']);
    const prepaymentKeys = findStageKeys(['Предоплата']);

    const durationSamples = (startKeys: Set<string>) => {
      const durations: number[] = [];
      for (const history of eventsByLead.values()) {
        let start: Date | null = null;
        let end: Date | null = null;
        for (const event of history) {
          const eventKey = key(event.pipeline_external_id, event.status_external_id);
          if (!start && startKeys.has(eventKey)) start = new Date(event.observed_at);
          if (start && prepaymentKeys.has(eventKey)) { end = new Date(event.observed_at); break; }
        }
        if (start && end && end >= start) durations.push((end.getTime() - start.getTime()) / DAY);
      }
      return { count: durations.length, average_days: average(durations), median_days: median(durations), min_days: durations.length ? Math.min(...durations) : null, max_days: durations.length ? Math.max(...durations) : null };
    };

    const firstTouchToPrepayment = durationSamples(firstTouchKeys);
    const dialogToPrepayment = durationSamples(dialogKeys);
    const excluded = new Set(['производство', 'постоплата', 'успешно реализовано']);
    const candidates = stageAging.filter((stage: any) => stage.count > 0 && !excluded.has(norm(stage.stage_name)) && stage.average_days !== null);
    const bottleneck = [...candidates].sort((a: any, b: any) => (b.average_days || 0) - (a.average_days || 0))[0] || null;
    const recommendation = bottleneck ? {
      stage_name: bottleneck.stage_name,
      pipeline_name: bottleneck.pipeline_name,
      average_days: bottleneck.average_days,
      median_days: bottleneck.median_days,
      count: bottleneck.count,
      text: `Главный кандидат на ускорение — этап «${bottleneck.stage_name}»: ${bottleneck.count} сделок лежат там в среднем ${bottleneck.average_days.toFixed(1)} дня. Сначала проверьте самые старые карточки и наличие следующей задачи.`,
    } : null;

    const coverage = {
      total_stage_events: (events || []).length,
      leads_with_history: eventsByLead.size,
      open_leads: openLeads.length,
      open_leads_with_exact_stage_entry: stageAging.reduce((sum: number, stage: any) => sum + stage.count - stage.estimated_count, 0),
      caveat: 'Циклы и точный возраст этапа считаются по истории, накопленной после подключения синхронизации. Для карточек без события входа используется дата последнего обновления и ставится признак оценки.',
    };

    return new Response(JSON.stringify({ ok: true, generated_at: now.toISOString(), stage_aging: stageAging, cycles: { first_touch_to_prepayment: firstTouchToPrepayment, dialog_to_prepayment: dialogToPrepayment }, bottleneck: recommendation, coverage }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});