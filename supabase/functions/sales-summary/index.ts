import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const DAY = 86400000;
const normalize = (value: unknown) => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
const statusKey = (pipelineId: unknown, statusId: unknown) => `${Number(pipelineId || 0)}:${Number(statusId || 0)}`;
const timestamp = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const funnel = [
  { id: 'new', label: 'Новая компания', names: ['новая компания'] },
  { id: 'first_touch', label: 'Первое касание сделано', names: ['первое касание сделано'] },
  { id: 'follow_up', label: 'Follow-up', names: ['follow-up', 'follow up'] },
  { id: 'dialog', label: 'Диалог', names: ['диалог'] },
  { id: 'interest', label: 'Интерес подтверждён', names: ['интерес подтвержден', 'интерес подтверждён'] },
  { id: 'meeting_set', label: 'Встреча назначена', names: ['встреча назначена'] },
  { id: 'sql', label: 'Встреча проведена (SQL)', names: ['встреча проведена (sql)'] },
  { id: 'proposal_preparing', label: 'Готовим КП', names: ['готовим кп'] },
  { id: 'proposal_sent', label: 'КП отправлено', names: ['кп отправлено'] },
  { id: 'negotiations', label: 'Переговоры', names: ['переговоры'] },
  { id: 'contract', label: 'Договор / счёт', names: ['договор / счет', 'договор / счёт'] },
  { id: 'prepayment', label: 'Предоплата', names: ['предоплата'] },
  { id: 'production', label: 'Производство', names: ['производство'] },
  { id: 'postpayment', label: 'Постоплата', names: ['постоплата'] },
  { id: 'won', label: 'Успешно реализовано', names: ['успешно реализовано'] },
];
const kpiPlans = [
  { key: 'touches', stageId: 'first_touch', label: 'Первые целевые касания', plan: 1000, unit: 'событий' },
  { key: 'conversations', stageId: 'dialog', label: 'Начатые общения', plan: 250, unit: 'событий' },
  { key: 'calls', label: 'Проведённые встречи / ВКС', plan: 25, unit: 'событий', source: 'tasks' },
  { key: 'sql', stageId: 'sql', label: 'Квалифицированные лиды / SQL', plan: 10, unit: 'событий' },
  { key: 'proposals', stageId: 'proposal_sent', label: 'Отправленные КП', plan: 5, unit: 'событий' },
  { key: 'contracts', stageId: 'contract', label: 'Договоры / счета', plan: 3, unit: 'событий' },
  { key: 'prepayments', stageId: 'prepayment', label: 'Полученные предоплаты', plan: 2, unit: 'событий' },
];

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
      { data: leads, error: leadsError }, { data: statuses, error: statusesError },
      { data: pipelines, error: pipelinesError }, { data: users, error: usersError },
      { data: source, error: sourceError }, { data: stageEvents, error: stageEventsError },
      { data: tasks, error: tasksError }, { data: crmEvents, error: crmEventsError },
    ] = await Promise.all([
      supabase.from('crm_leads').select('external_id,name,price,pipeline_external_id,status_external_id,responsible_user_external_id,created_at_source,updated_at_source,closed_at_source,raw').eq('source_slug', 'amocrm'),
      supabase.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order,color').eq('source_slug', 'amocrm').order('sort_order'),
      supabase.from('crm_pipelines').select('external_id,name,is_main,is_archive').eq('source_slug', 'amocrm'),
      supabase.from('crm_users').select('external_id,name,email,is_admin,is_active').eq('source_slug', 'amocrm'),
      supabase.from('data_sources').select('status,last_success_at,last_error').eq('slug', 'amocrm').single(),
      supabase.from('crm_lead_stage_events').select('lead_external_id,pipeline_external_id,status_external_id,observed_at').eq('source_slug', 'amocrm').gte('observed_at', monthStart.toISOString()).lt('observed_at', monthEnd.toISOString()).limit(30000),
      supabase.from('crm_tasks').select('external_id,entity_external_id,responsible_user_external_id,task_type_id,text,result_text,is_completed,complete_till,updated_at_source').eq('source_slug', 'amocrm').eq('is_completed', true).gte('updated_at_source', monthStart.toISOString()).lt('updated_at_source', monthEnd.toISOString()).limit(30000),
      supabase.from('crm_events').select('external_id,event_type,entity_external_id,entity_type,created_by_external_id,created_at_source,value_before,value_after').eq('source_slug', 'amocrm').gte('created_at_source', monthStart.toISOString()).lt('created_at_source', monthEnd.toISOString()).limit(30000),
    ]);
    if (leadsError) throw leadsError; if (statusesError) throw statusesError; if (pipelinesError) throw pipelinesError;
    if (usersError) throw usersError; if (sourceError) throw sourceError; if (stageEventsError) throw stageEventsError;
    if (tasksError) throw tasksError; if (crmEventsError) throw crmEventsError;

    const allLeads = leads || [];
    const leadMap = new Map(allLeads.map((lead: any) => [Number(lead.external_id), lead]));
    const userMap = new Map((users || []).map((user: any) => [Number(user.external_id), user]));
    const pipelineMap = new Map((pipelines || []).map((pipeline: any) => [Number(pipeline.external_id), pipeline]));
    const statusMap = new Map<string, any>((statuses || []).map((status: any) => [statusKey(status.pipeline_external_id, status.external_id), status]));
    const stageIndexByStatus = new Map<string, number>();
    for (const status of statuses || []) {
      const index = funnel.findIndex(stage => stage.names.includes(normalize(status.name)));
      if (index >= 0) stageIndexByStatus.set(statusKey(status.pipeline_external_id, status.external_id), index);
    }
    const managerName = (id: unknown) => userMap.get(Number(id || 0))?.name || `Пользователь #${id || '—'}`;
    const findStatus = (pipelineId: unknown, statusId: unknown) => statusMap.get(statusKey(pipelineId, statusId));

    const openLeads = allLeads.filter((lead: any) => !lead.closed_at_source);
    const closedLeads = allLeads.filter((lead: any) => Boolean(lead.closed_at_source));
    const pricedOpenLeads = openLeads.filter((lead: any) => Number(lead.price || 0) > 0);
    const pipelineValue = pricedOpenLeads.reduce((sum: number, lead: any) => sum + Number(lead.price || 0), 0);
    const budgetCoverage = openLeads.length ? pricedOpenLeads.length / openLeads.length : 0;

    const byStatus = new Map<string, any>();
    for (const lead of openLeads) {
      const currentKey = statusKey(lead.pipeline_external_id, lead.status_external_id);
      const status = statusMap.get(currentKey);
      const row = byStatus.get(currentKey) || { external_id: Number(lead.status_external_id), name: status?.name || `Этап ${lead.status_external_id}`, pipeline_external_id: Number(lead.pipeline_external_id), pipeline_name: pipelineMap.get(Number(lead.pipeline_external_id))?.name || null, color: status?.color || null, sort_order: status?.sort_order ?? 9999, count: 0, value: 0, priced_count: 0 };
      row.count += 1;
      if (Number(lead.price || 0) > 0) { row.value += Number(lead.price); row.priced_count += 1; }
      byStatus.set(currentKey, row);
    }
    const stages = [...byStatus.values()].sort((a, b) => String(a.pipeline_name || '').localeCompare(String(b.pipeline_name || ''), 'ru') || a.sort_order - b.sort_order);

    // Highest funnel milestone reached by each lead during the month.
    // Any later milestone implies all preceding KPI milestones were also achieved.
    const highestReached = new Map<number, { index: number; at: string; inferred: boolean }>();
    for (const event of stageEvents || []) {
      const leadId = Number(event.lead_external_id);
      const index = stageIndexByStatus.get(statusKey(event.pipeline_external_id, event.status_external_id));
      if (index === undefined) continue;
      const existing = highestReached.get(leadId);
      if (!existing || index > existing.index) highestReached.set(leadId, { index, at: event.observed_at, inferred: false });
    }
    // Backfill late-stage cards changed this month when historical intermediate events were not captured yet.
    for (const lead of allLeads) {
      const leadId = Number(lead.external_id);
      if (highestReached.has(leadId)) continue;
      const updated = new Date(lead.updated_at_source || 0);
      if (updated < monthStart || updated >= monthEnd) continue;
      const index = stageIndexByStatus.get(statusKey(lead.pipeline_external_id, lead.status_external_id));
      if (index !== undefined && index >= funnel.findIndex(stage => stage.id === 'dialog')) highestReached.set(leadId, { index, at: updated.toISOString(), inferred: true });
    }

    const reachedSets = new Map<string, Set<number>>();
    funnel.forEach(stage => reachedSets.set(stage.id, new Set()));
    for (const [leadId, reached] of highestReached.entries()) {
      for (let index = 0; index <= reached.index; index++) reachedSets.get(funnel[index].id)?.add(leadId);
    }

    const meetingTasks = (tasks || []).filter((task: any) => {
      const haystack = `${normalize(task.text)} ${normalize(task.result_text)}`;
      return Number(task.task_type_id) === 1 || Number(task.task_type_id) === 2 || /вкс|встреч|созвон|звонок/.test(haystack);
    });
    const uniqueMeetingLeadIds = new Set(meetingTasks.map((task: any) => Number(task.entity_external_id || 0)).filter(Boolean));

    const buildKpi = (plan: any) => {
      const leadIds = plan.source === 'tasks' ? uniqueMeetingLeadIds : (reachedSets.get(plan.stageId) || new Set<number>());
      const fact = leadIds.size;
      const forecast = Math.round(fact / elapsedRatio);
      const completion = fact / plan.plan;
      const forecastCompletion = forecast / plan.plan;
      const stage = plan.stageId ? funnel.find(item => item.id === plan.stageId) : null;
      return { ...plan, source: plan.source || 'cumulative_flow', measurable: true, fact, forecast, completion, forecast_completion: forecastCompletion, pace: plan.plan * elapsedRatio, status: forecastCompletion >= 1 ? 'green' : forecastCompletion >= .8 ? 'yellow' : forecastCompletion >= .6 ? 'orange' : 'red', matched_statuses: stage ? [{ name: stage.label, pipeline_name: 'накопительный поток месяца' }] : [], task_breakdown: plan.source === 'tasks' ? { calls: meetingTasks.length, unique_deals: fact } : undefined, formula: plan.source === 'tasks' ? 'Уникальные сделки с выполненной задачей встречи / ВКС за месяц.' : `Уникальные сделки, которые за месяц достигли этапа «${stage?.label}» или любого более позднего этапа.` };
    };
    const kpis = kpiPlans.map(buildKpi);
    const overallForecast = kpis.reduce((sum: number, item: any) => sum + Math.min(1.25, item.forecast_completion || 0), 0) / kpis.length;

    const managerRows = new Map<number, any>();
    const ensureManager = (id: number) => {
      const user = userMap.get(id) as any;
      if (!managerRows.has(id)) managerRows.set(id, { id, name: managerName(id), email: user?.email || null, is_admin: Boolean(user?.is_admin), is_active: user?.is_active !== false, open: 0, pipeline_value: 0, completed_tasks_month: 0, kpis: Object.fromEntries(kpiPlans.map(plan => [plan.key, 0])) });
      return managerRows.get(id);
    };
    for (const lead of allLeads) {
      const managerId = Number(lead.responsible_user_external_id || 0); if (!managerId) continue;
      const row = ensureManager(managerId);
      if (!lead.closed_at_source) { row.open += 1; row.pipeline_value += Number(lead.price || 0); }
      const reached = highestReached.get(Number(lead.external_id));
      if (reached) for (const plan of kpiPlans.filter(item => item.stageId)) {
        const targetIndex = funnel.findIndex(stage => stage.id === plan.stageId);
        if (reached.index >= targetIndex) row.kpis[plan.key] += 1;
      }
    }
    const meetingLeadsByManager = new Map<number, Set<number>>();
    for (const task of meetingTasks) {
      const managerId = Number(task.responsible_user_external_id || 0); if (!managerId) continue;
      if (!meetingLeadsByManager.has(managerId)) meetingLeadsByManager.set(managerId, new Set());
      const leadId = Number(task.entity_external_id || 0); if (leadId) meetingLeadsByManager.get(managerId)!.add(leadId);
    }
    for (const task of tasks || []) { const id = Number(task.responsible_user_external_id || 0); if (id) ensureManager(id).completed_tasks_month += 1; }
    for (const [id, leadIds] of meetingLeadsByManager.entries()) ensureManager(id).kpis.calls = leadIds.size;
    const managers = [...managerRows.values()].map(row => {
      const completionValues = kpiPlans.map(plan => Math.min(1.25, Number(row.kpis[plan.key] || 0) / plan.plan));
      row.kpi_completion = completionValues.reduce((a, b) => a + b, 0) / completionValues.length;
      row.kpi_items = kpiPlans.map(plan => ({ key: plan.key, label: plan.label, fact: row.kpis[plan.key] || 0, plan: plan.plan, completion: (row.kpis[plan.key] || 0) / plan.plan }));
      return row;
    }).sort((a, b) => b.kpi_completion - a.kpi_completion || b.completed_tasks_month - a.completed_tasks_month);

    const importedThisMonth = allLeads.filter((lead: any) => { const created = new Date(lead.created_at_source || 0); return created >= monthStart && created < monthEnd; });
    const leadCreatedTypes = new Set(['lead_added', 'entity_added', 'lead_created']);
    const operationalCreatedLeadIds = new Set<number>();
    for (const event of crmEvents || []) if ((event.entity_type === 'lead' || event.entity_type === 'leads') && leadCreatedTypes.has(String(event.event_type || ''))) operationalCreatedLeadIds.add(Number(event.entity_external_id));

    const staleThreshold = now.getTime() - 5 * DAY;
    const attention = openLeads.filter((lead: any) => new Date(lead.updated_at_source || 0).getTime() < staleThreshold).sort((a: any, b: any) => new Date(a.updated_at_source || 0).getTime() - new Date(b.updated_at_source || 0).getTime()).slice(0, 12).map((lead: any) => ({ external_id: lead.external_id, name: lead.name || `Сделка #${lead.external_id}`, price: Number(lead.price || 0), status_name: findStatus(lead.pipeline_external_id, lead.status_external_id)?.name || null, pipeline_name: pipelineMap.get(Number(lead.pipeline_external_id))?.name || null, updated_at_source: lead.updated_at_source, stale_days: Math.floor((now.getTime() - new Date(lead.updated_at_source || 0).getTime()) / DAY), responsible_user_name: managerName(lead.responsible_user_external_id) }));
    const upcoming = openLeads.map((lead: any) => { const at = timestamp((lead.raw || {}).closest_task_at || (lead.raw || {}).next_task_at); return at ? { external_id: lead.external_id, name: lead.name || `Сделка #${lead.external_id}`, at, status_name: findStatus(lead.pipeline_external_id, lead.status_external_id)?.name || null, pipeline_name: pipelineMap.get(Number(lead.pipeline_external_id))?.name || null, responsible_user_name: managerName(lead.responsible_user_external_id) } : null; }).filter(Boolean).filter((item: any) => new Date(item.at) >= new Date(now.getTime() - DAY)).sort((a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 10);
    const recent = [...allLeads].sort((a: any, b: any) => new Date(b.updated_at_source || 0).getTime() - new Date(a.updated_at_source || 0).getTime()).slice(0, 10).map((lead: any) => ({ ...lead, raw: undefined, status_name: findStatus(lead.pipeline_external_id, lead.status_external_id)?.name || null, pipeline_name: pipelineMap.get(Number(lead.pipeline_external_id))?.name || null, responsible_user_name: managerName(lead.responsible_user_external_id) }));
    const inferredCount = [...highestReached.values()].filter(item => item.inferred).length;
    const missingData = [
      ...(budgetCoverage < .5 ? [{ metric: 'Бюджеты сделок', reason: `Бюджет заполнен только у ${pricedOpenLeads.length} из ${openLeads.length} открытых сделок. Денежный прогноз пока нельзя считать надёжным.`, priority: 'high' }] : []),
      ...(inferredCount ? [{ metric: 'История старых сделок', reason: `${inferredCount} результатов месяца восстановлены по текущему позднему этапу и дате обновления, потому что полная история промежуточных переходов ещё не была накоплена.`, priority: 'medium' }] : []),
    ];

    return new Response(JSON.stringify({
      ok: true, generated_at: now.toISOString(),
      period: { start: monthStart.toISOString(), end: monthEnd.toISOString(), elapsed_days: elapsedDays, days_in_month: daysInMonth, elapsed_ratio: elapsedRatio },
      source,
      summary: { total_leads: allLeads.length, open_leads: openLeads.length, closed_leads: closedLeads.length, pipeline_value: pipelineValue, average_open_check: pricedOpenLeads.length ? pipelineValue / pricedOpenLeads.length : null, budget_coverage: budgetCoverage, priced_open_leads: pricedOpenLeads.length, new_leads_month: operationalCreatedLeadIds.size, imported_or_created_month: importedThisMonth.length, overall_forecast: overallForecast, completed_tasks_month: (tasks || []).length, period_flow_leads: highestReached.size, inferred_flow_leads: inferredCount },
      kpi_method: 'Месячный событийный КПЭ: уникальная сделка засчитывается, если за период достигла контрольного этапа или любого более позднего этапа. Каждая сделка учитывается один раз в каждом KPI.',
      pipelines: pipelines || [], users: users || [], kpis, stages, managers, attention, upcoming, recent, missing_data: missingData,
    }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});