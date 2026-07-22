import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const plans = [
  { key: 'touches', label: 'Целевые касания', plan: 1000, unit: 'шт.', source: 'stages', exact: ['первое касание сделано'] },
  { key: 'conversations', label: 'Ответы / переписки', plan: 250, unit: 'шт.', source: 'stages', exact: ['диалог'] },
  { key: 'calls', label: 'Квалификационные звонки', plan: 25, unit: 'шт.', source: 'tasks' },
  { key: 'sql', label: 'Квалифицированные лиды / SQL', plan: 10, unit: 'шт.', source: 'stages', exact: ['встреча проведена (sql)'] },
  { key: 'proposals', label: 'Коммерческие предложения', plan: 5, unit: 'шт.', source: 'stages', exact: ['кп отправлено'] },
  { key: 'contracts', label: 'Договоры / счета', plan: 3, unit: 'шт.', source: 'stages', exact: ['договор / счёт', 'договор / счет'] },
  { key: 'prepayments', label: 'Предоплаты', plan: 2, unit: 'шт.', source: 'stages', exact: ['предоплата'] },
  { key: 'payments', label: 'Оплаты', plan: 1000000, unit: '₽', source: 'stages', isMoney: true, exact: ['постоплата', 'успешно реализовано'] },
];

const timestamp = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const statusKey = (pipelineId: unknown, statusId: unknown) => `${Number(pipelineId || 0)}:${Number(statusId || 0)}`;
const normalize = (value: unknown) => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
const text = normalize;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const elapsedDays = Math.max(1, now.getUTCDate());
    const elapsedRatio = Math.min(1, elapsedDays / daysInMonth);

    const [
      { data: leads, error: leadsError },
      { data: statuses, error: statusesError },
      { data: pipelines, error: pipelinesError },
      { data: users, error: usersError },
      { data: source, error: sourceError },
      { data: stageEvents, error: stageEventsError },
      { data: tasks, error: tasksError },
      { data: crmEvents, error: crmEventsError },
    ] = await Promise.all([
      supabase.from('crm_leads').select('external_id,name,price,pipeline_external_id,status_external_id,responsible_user_external_id,created_at_source,updated_at_source,closed_at_source,raw').eq('source_slug', 'amocrm'),
      supabase.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order,color').eq('source_slug', 'amocrm').order('sort_order'),
      supabase.from('crm_pipelines').select('external_id,name,is_main,is_archive').eq('source_slug', 'amocrm'),
      supabase.from('crm_users').select('external_id,name,email,is_admin,is_active').eq('source_slug', 'amocrm'),
      supabase.from('data_sources').select('status,last_success_at,last_error').eq('slug', 'amocrm').single(),
      supabase.from('crm_lead_stage_events').select('lead_external_id,pipeline_external_id,status_external_id,observed_at').eq('source_slug', 'amocrm').gte('observed_at', monthStart.toISOString()).lt('observed_at', monthEnd.toISOString()),
      supabase.from('crm_tasks').select('external_id,entity_external_id,responsible_user_external_id,task_type_id,text,result_text,is_completed,complete_till,updated_at_source').eq('source_slug', 'amocrm').eq('is_completed', true).gte('updated_at_source', monthStart.toISOString()).lt('updated_at_source', monthEnd.toISOString()),
      supabase.from('crm_events').select('external_id,event_type,entity_external_id,entity_type,created_by_external_id,created_at_source,value_before,value_after').eq('source_slug', 'amocrm').gte('created_at_source', monthStart.toISOString()).lt('created_at_source', monthEnd.toISOString()),
    ]);
    if (leadsError) throw leadsError;
    if (statusesError) throw statusesError;
    if (pipelinesError) throw pipelinesError;
    if (usersError) throw usersError;
    if (sourceError) throw sourceError;
    if (stageEventsError) throw stageEventsError;
    if (tasksError) throw new Error(`crm_tasks read failed: ${tasksError.message}`);
    if (crmEventsError) throw new Error(`crm_events read failed: ${crmEventsError.message}`);

    const allLeads = leads || [];
    const openLeads = allLeads.filter((lead: any) => !lead.closed_at_source);
    const closedLeads = allLeads.filter((lead: any) => Boolean(lead.closed_at_source));
    const pricedOpenLeads = openLeads.filter((lead: any) => Number(lead.price || 0) > 0);
    const pipelineValue = pricedOpenLeads.reduce((sum: number, lead: any) => sum + Number(lead.price || 0), 0);
    const averageOpenCheck = pricedOpenLeads.length ? pipelineValue / pricedOpenLeads.length : null;
    const budgetCoverage = openLeads.length ? pricedOpenLeads.length / openLeads.length : 0;
    const pipelineMap = new Map((pipelines || []).map((p: any) => [Number(p.external_id), p]));
    const userMap = new Map((users || []).map((u: any) => [Number(u.external_id), u]));
    const leadMap = new Map(allLeads.map((l: any) => [Number(l.external_id), l]));
    const managerName = (id: unknown) => userMap.get(Number(id || 0))?.name || `Пользователь #${id || '—'}`;
    const statusMap = new Map<string, any>();
    for (const status of statuses || []) statusMap.set(statusKey(status.pipeline_external_id, status.external_id), status);
    const findStatus = (pipelineId: unknown, statusId: unknown) => statusMap.get(statusKey(pipelineId, statusId)) || (statuses || []).find((s: any) => Number(s.external_id) === Number(statusId));

    const byStatus = new Map<string, any>();
    for (const lead of openLeads) {
      const status = findStatus(lead.pipeline_external_id, lead.status_external_id);
      const pipeline = pipelineMap.get(Number(lead.pipeline_external_id)) as any;
      const key = statusKey(lead.pipeline_external_id, lead.status_external_id);
      const current = byStatus.get(key) || { external_id: Number(lead.status_external_id || 0), name: status?.name || `Этап ${lead.status_external_id}`, pipeline_external_id: Number(lead.pipeline_external_id || 0), pipeline_name: pipeline?.name || null, color: status?.color || null, sort_order: status?.sort_order ?? null, count: 0, value: 0, priced_count: 0 };
      current.count += 1;
      if (Number(lead.price || 0) > 0) { current.value += Number(lead.price || 0); current.priced_count += 1; }
      byStatus.set(key, current);
    }
    const stages = [...byStatus.values()].sort((a, b) => String(a.pipeline_name || '').localeCompare(String(b.pipeline_name || ''), 'ru') || (a.sort_order ?? 9999) - (b.sort_order ?? 9999));

    const importedThisMonth = allLeads.filter((lead: any) => { const created = new Date(lead.created_at_source || 0); return created >= monthStart && created < monthEnd; });
    const leadCreatedEventTypes = new Set(['lead_added', 'entity_added', 'lead_created']);
    const operationalCreatedLeadIds = new Set<number>();
    for (const event of crmEvents || []) if ((event.entity_type === 'lead' || event.entity_type === 'leads') && leadCreatedEventTypes.has(String(event.event_type || ''))) operationalCreatedLeadIds.add(Number(event.entity_external_id));

    const reachedByStage = new Map<string, Set<number>>();
    for (const event of stageEvents || []) {
      const key = statusKey(event.pipeline_external_id, event.status_external_id);
      if (!reachedByStage.has(key)) reachedByStage.set(key, new Set());
      reachedByStage.get(key)!.add(Number(event.lead_external_id));
    }

    const completedTasks = tasks || [];
    const callTasks = completedTasks.filter((task: any) => Number(task.task_type_id) === 1 || Number(task.task_type_id) === 2 || /вкс|встреч|созвон|звонок/.test(`${text(task.text)} ${text(task.result_text)}`));

    const kpis = plans.map((plan: any) => {
      if (plan.source === 'tasks') {
        const fact = new Set(callTasks.map((task: any) => Number(task.external_id))).size;
        const forecast = Math.round(fact / elapsedRatio);
        const completion = fact / plan.plan;
        const forecastCompletion = forecast / plan.plan;
        return { ...plan, measurable: true, matched_statuses: [], task_breakdown: { calls: callTasks.length }, fact, forecast, completion, forecast_completion: forecastCompletion, pace: plan.plan * elapsedRatio, status: forecastCompletion >= 1 ? 'green' : forecastCompletion >= .8 ? 'yellow' : forecastCompletion >= .6 ? 'orange' : 'red' };
      }
      const wanted = new Set((plan.exact || []).map(normalize));
      const matchedStatuses = (statuses || []).filter((status: any) => wanted.has(normalize(status.name)));
      const leadIds = new Set<number>();
      for (const status of matchedStatuses) reachedByStage.get(statusKey(status.pipeline_external_id, status.external_id))?.forEach(id => leadIds.add(id));
      let fact = leadIds.size;
      if (plan.isMoney) fact = [...leadIds].reduce((sum, id) => sum + Number((leadMap.get(id) as any)?.price || 0), 0);
      const forecast = Math.round(fact / elapsedRatio);
      const completion = plan.plan ? fact / plan.plan : 0;
      const forecastCompletion = plan.plan ? forecast / plan.plan : 0;
      return { ...plan, measurable: matchedStatuses.length > 0, matched_statuses: matchedStatuses.map((status: any) => ({ name: status.name, pipeline_name: pipelineMap.get(Number(status.pipeline_external_id))?.name || null })), fact, forecast, completion, forecast_completion: forecastCompletion, pace: plan.plan * elapsedRatio, status: !matchedStatuses.length ? 'missing' : forecastCompletion >= 1 ? 'green' : forecastCompletion >= .8 ? 'yellow' : forecastCompletion >= .6 ? 'orange' : 'red' };
    });

    const measurableKpis = kpis.filter((item: any) => item.measurable && item.forecast_completion !== null);
    const overallForecast = measurableKpis.length ? measurableKpis.reduce((sum: number, item: any) => sum + Math.min(1.25, item.forecast_completion || 0), 0) / measurableKpis.length : null;

    const responsible = new Map<number, any>();
    for (const lead of allLeads) {
      const id = Number(lead.responsible_user_external_id || 0); if (!id) continue;
      const user = userMap.get(id) as any;
      const row = responsible.get(id) || { id, name: managerName(id), email: user?.email || null, is_admin: Boolean(user?.is_admin), is_active: user?.is_active !== false, open: 0, created_month: 0, pipeline_value: 0, completed_tasks_month: 0 };
      if (!lead.closed_at_source) { row.open += 1; row.pipeline_value += Number(lead.price || 0); }
      if (operationalCreatedLeadIds.has(Number(lead.external_id))) row.created_month += 1;
      responsible.set(id, row);
    }
    for (const task of completedTasks) {
      const id = Number(task.responsible_user_external_id || 0); if (!id) continue;
      const user = userMap.get(id) as any;
      const row = responsible.get(id) || { id, name: managerName(id), email: user?.email || null, is_admin: Boolean(user?.is_admin), is_active: user?.is_active !== false, open: 0, created_month: 0, pipeline_value: 0, completed_tasks_month: 0 };
      row.completed_tasks_month += 1; responsible.set(id, row);
    }
    const managers = [...responsible.values()].sort((a, b) => b.completed_tasks_month - a.completed_tasks_month || b.created_month - a.created_month || b.open - a.open);

    const staleThreshold = now.getTime() - 5 * 86400000;
    const attention = openLeads.filter((lead: any) => new Date(lead.updated_at_source || 0).getTime() < staleThreshold).sort((a: any, b: any) => new Date(a.updated_at_source || 0).getTime() - new Date(b.updated_at_source || 0).getTime()).slice(0, 12).map((lead: any) => ({ external_id: lead.external_id, name: lead.name || `Сделка #${lead.external_id}`, price: Number(lead.price || 0), status_name: findStatus(lead.pipeline_external_id, lead.status_external_id)?.name || null, pipeline_name: pipelineMap.get(Number(lead.pipeline_external_id))?.name || null, updated_at_source: lead.updated_at_source, stale_days: Math.floor((now.getTime() - new Date(lead.updated_at_source || 0).getTime()) / 86400000), responsible_user_external_id: lead.responsible_user_external_id, responsible_user_name: managerName(lead.responsible_user_external_id) }));
    const upcoming = openLeads.map((lead: any) => { const nextAt = timestamp((lead.raw || {}).closest_task_at || (lead.raw || {}).next_task_at); return nextAt ? { external_id: lead.external_id, name: lead.name || `Сделка #${lead.external_id}`, at: nextAt, status_name: findStatus(lead.pipeline_external_id, lead.status_external_id)?.name || null, pipeline_name: pipelineMap.get(Number(lead.pipeline_external_id))?.name || null, responsible_user_external_id: lead.responsible_user_external_id, responsible_user_name: managerName(lead.responsible_user_external_id) } : null; }).filter(Boolean).filter((item: any) => new Date(item.at) >= new Date(now.getTime() - 86400000)).sort((a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 10);
    const recent = [...allLeads].sort((a: any, b: any) => new Date(b.updated_at_source || 0).getTime() - new Date(a.updated_at_source || 0).getTime()).slice(0, 10).map((lead: any) => ({ ...lead, raw: undefined, status_name: findStatus(lead.pipeline_external_id, lead.status_external_id)?.name || null, pipeline_name: pipelineMap.get(Number(lead.pipeline_external_id))?.name || null, responsible_user_name: managerName(lead.responsible_user_external_id) }));
    const missingData = [
      ...kpis.filter((item: any) => !item.measurable).map((item: any) => ({ metric: item.label, reason: 'Точный этап текущей воронки не найден в синхронизированном справочнике.', priority: 'high' })),
      ...(budgetCoverage < .5 ? [{ metric: 'Бюджеты сделок', reason: `Бюджет заполнен только у ${pricedOpenLeads.length} из ${openLeads.length} открытых сделок. Денежный прогноз пока нельзя считать надёжным.`, priority: 'high' }] : []),
      { metric: 'Плановая дата оплаты', reason: 'Нет отдельной обязательной даты ожидаемой оплаты по сделке — прогноз денег по календарю пока неполный.', priority: 'high' },
    ];

    return new Response(JSON.stringify({ ok: true, generated_at: now.toISOString(), period: { start: monthStart.toISOString(), end: monthEnd.toISOString(), elapsed_days: elapsedDays, days_in_month: daysInMonth, elapsed_ratio: elapsedRatio }, source, summary: { total_leads: allLeads.length, open_leads: openLeads.length, closed_leads: closedLeads.length, pipeline_value: pipelineValue, average_open_check: averageOpenCheck, budget_coverage: budgetCoverage, priced_open_leads: pricedOpenLeads.length, new_leads_month: operationalCreatedLeadIds.size, imported_or_created_month: importedThisMonth.length, overall_forecast: overallForecast, completed_tasks_month: completedTasks.length }, pipelines: pipelines || [], users: users || [], kpis, stages, managers, attention, upcoming, recent, missing_data: missingData }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});