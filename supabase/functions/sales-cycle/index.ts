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

const funnelDefinition = [
  { id: 'first_touch', label: 'Первое касание', names: ['Первое касание сделано'] },
  { id: 'dialog', label: 'Диалог', names: ['Диалог'] },
  { id: 'interest', label: 'Интерес подтверждён', names: ['Интерес подтверждён'] },
  { id: 'meeting_set', label: 'Встреча назначена', names: ['Встреча назначена'] },
  { id: 'sql', label: 'Встреча проведена (SQL)', names: ['Встреча проведена (SQL)'] },
  { id: 'proposal_preparing', label: 'Готовим КП', names: ['Готовим КП'] },
  { id: 'proposal_sent', label: 'КП отправлено', names: ['КП отправлено'] },
  { id: 'negotiations', label: 'Переговоры', names: ['Переговоры'] },
  { id: 'contract', label: 'Договор / счёт', names: ['Договор / счёт', 'Договор / счет'] },
  { id: 'prepayment', label: 'Предоплата', names: ['Предоплата'] },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [{ data: leads, error: leadsError }, { data: statuses, error: statusesError }, { data: pipelines, error: pipelinesError }, { data: events, error: eventsError }] = await Promise.all([
      supabase.from('crm_leads').select('external_id,name,price,pipeline_external_id,status_external_id,responsible_user_external_id,updated_at_source,closed_at_source,raw').eq('source_slug', 'amocrm'),
      supabase.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order').eq('source_slug', 'amocrm').order('sort_order'),
      supabase.from('crm_pipelines').select('external_id,name').eq('source_slug', 'amocrm'),
      supabase.from('crm_lead_stage_events').select('lead_external_id,pipeline_external_id,status_external_id,observed_at').eq('source_slug', 'amocrm').order('observed_at', { ascending: true }).limit(20000),
    ]);
    if (leadsError) throw leadsError;
    if (statusesError) throw statusesError;
    if (pipelinesError) throw pipelinesError;
    if (eventsError) throw eventsError;

    const allLeads = leads || [];
    const leadMap = new Map<number, any>(allLeads.map((lead: any) => [Number(lead.external_id), lead]));
    const statusMap = new Map<string, any>((statuses || []).map((s: any) => [key(s.pipeline_external_id, s.external_id), s]));
    const pipelineMap = new Map<number, any>((pipelines || []).map((p: any) => [Number(p.external_id), p]));
    const eventsByLead = new Map<number, any[]>();
    for (const event of events || []) {
      const id = Number(event.lead_external_id);
      if (!eventsByLead.has(id)) eventsByLead.set(id, []);
      eventsByLead.get(id)!.push(event);
    }

    const stageKeysById = new Map<string, Set<string>>();
    for (const definition of funnelDefinition) {
      const wanted = new Set(definition.names.map(norm));
      stageKeysById.set(definition.id, new Set((statuses || []).filter((status: any) => wanted.has(norm(status.name))).map((status: any) => key(status.pipeline_external_id, status.external_id))));
    }
    const stageIdForEvent = (event: any) => funnelDefinition.find(definition => stageKeysById.get(definition.id)?.has(key(event.pipeline_external_id, event.status_external_id)))?.id || null;

    const openLeads = allLeads.filter((lead: any) => !lead.closed_at_source);
    const stageGroups = new Map<string, any[]>();
    for (const lead of openLeads) {
      const stageKey = key(lead.pipeline_external_id, lead.status_external_id);
      const history = eventsByLead.get(Number(lead.external_id)) || [];
      const currentEntries = history.filter((event: any) => key(event.pipeline_external_id, event.status_external_id) === stageKey);
      const enteredAt = currentEntries.length ? new Date(currentEntries[currentEntries.length - 1].observed_at) : new Date(lead.updated_at_source || now);
      const ageDays = Math.max(0, (now.getTime() - enteredAt.getTime()) / DAY);
      if (!stageGroups.has(stageKey)) stageGroups.set(stageKey, []);
      stageGroups.get(stageKey)!.push({
        external_id: lead.external_id,
        name: lead.name || `Сделка #${lead.external_id}`,
        age_days: ageDays,
        entered_at: enteredAt.toISOString(),
        estimated: !currentEntries.length,
        price: Number(lead.price || 0),
        has_next_task: Boolean((lead.raw || {}).closest_task_at || (lead.raw || {}).next_task_at),
      });
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
        without_next_task: items.filter((item: any) => !item.has_next_task).length,
        oldest: [...items].sort((a: any, b: any) => b.age_days - a.age_days).slice(0, 5),
      };
    }).sort((a, b) => String(a.pipeline_name || '').localeCompare(String(b.pipeline_name || ''), 'ru') || a.sort_order - b.sort_order);

    const firstReached = new Map<number, Map<string, Date>>();
    for (const [leadId, history] of eventsByLead.entries()) {
      const map = new Map<string, Date>();
      for (const event of history) {
        const stageId = stageIdForEvent(event);
        if (stageId && !map.has(stageId)) map.set(stageId, new Date(event.observed_at));
      }
      firstReached.set(leadId, map);
    }

    const durationBetween = (startId: string, endId: string) => {
      const durations: number[] = [];
      for (const reached of firstReached.values()) {
        const start = reached.get(startId);
        const end = reached.get(endId);
        if (start && end && end >= start) durations.push((end.getTime() - start.getTime()) / DAY);
      }
      return { count: durations.length, average_days: average(durations), median_days: median(durations), min_days: durations.length ? Math.min(...durations) : null, max_days: durations.length ? Math.max(...durations) : null };
    };

    const cycles = {
      first_touch_to_prepayment: durationBetween('first_touch', 'prepayment'),
      dialog_to_prepayment: durationBetween('dialog', 'prepayment'),
    };

    const segmentCycles = funnelDefinition.slice(0, -1).map((stage, index) => ({
      from_id: stage.id,
      from_label: stage.label,
      to_id: funnelDefinition[index + 1].id,
      to_label: funnelDefinition[index + 1].label,
      ...durationBetween(stage.id, funnelDefinition[index + 1].id),
    }));

    const monthReached = new Map<string, Set<number>>();
    funnelDefinition.forEach(stage => monthReached.set(stage.id, new Set()));
    for (const event of events || []) {
      if (new Date(event.observed_at) < monthStart) continue;
      const stageId = stageIdForEvent(event);
      if (stageId) monthReached.get(stageId)?.add(Number(event.lead_external_id));
    }
    const conversions = funnelDefinition.map((stage, index) => {
      const count = monthReached.get(stage.id)?.size || 0;
      if (!index) return { id: stage.id, label: stage.label, count, from_previous: null };
      const previous = funnelDefinition[index - 1];
      const previousCount = monthReached.get(previous.id)?.size || 0;
      return { id: stage.id, label: stage.label, count, previous_label: previous.label, previous_count: previousCount, from_previous: previousCount ? count / previousCount : null };
    });

    const excluded = new Set(['производство', 'постоплата', 'успешно реализовано', 'новая компания']);
    const candidates = stageAging.filter((stage: any) => stage.count > 0 && !excluded.has(norm(stage.stage_name)) && stage.average_days !== null);
    const bottleneck = [...candidates].sort((a: any, b: any) => (b.average_days || 0) - (a.average_days || 0))[0] || null;
    const recommendation = bottleneck ? {
      stage_name: bottleneck.stage_name,
      pipeline_name: bottleneck.pipeline_name,
      average_days: bottleneck.average_days,
      median_days: bottleneck.median_days,
      count: bottleneck.count,
      without_next_task: bottleneck.without_next_task,
      oldest: bottleneck.oldest,
      text: `Главный кандидат на ускорение — этап «${bottleneck.stage_name}»: ${bottleneck.count} сделок лежат там в среднем ${bottleneck.average_days.toFixed(1)} дня. У ${bottleneck.without_next_task} из них не видна следующая задача.`,
    } : null;

    const probabilityByStage: Record<string, number> = { proposal_sent: .25, negotiations: .45, contract: .75, prepayment: .95 };
    let weightedForecast = 0;
    let rawLatePipeline = 0;
    let pricedCount = 0;
    let relevantCount = 0;
    const forecastByStage: any[] = [];
    for (const stage of funnelDefinition.filter(item => probabilityByStage[item.id])) {
      const keys = stageKeysById.get(stage.id) || new Set<string>();
      const stageLeads = openLeads.filter((lead: any) => keys.has(key(lead.pipeline_external_id, lead.status_external_id)));
      const priced = stageLeads.filter((lead: any) => Number(lead.price || 0) > 0);
      const amount = priced.reduce((sum: number, lead: any) => sum + Number(lead.price || 0), 0);
      const probability = probabilityByStage[stage.id];
      relevantCount += stageLeads.length;
      pricedCount += priced.length;
      rawLatePipeline += amount;
      weightedForecast += amount * probability;
      forecastByStage.push({ id: stage.id, label: stage.label, count: stageLeads.length, priced_count: priced.length, amount, probability, weighted_amount: amount * probability });
    }
    const cashForecast = { weighted_amount: weightedForecast, raw_amount: rawLatePipeline, priced_count: pricedCount, relevant_count: relevantCount, coverage: relevantCount ? pricedCount / relevantCount : 0, by_stage: forecastByStage, method: 'Взвешивание открытых сделок: КП 25%, переговоры 45%, договор 75%, предоплата 95%.' };

    const health: any[] = [];
    const firstTouch = monthReached.get('first_touch')?.size || 0;
    const dialog = monthReached.get('dialog')?.size || 0;
    const sql = monthReached.get('sql')?.size || 0;
    const proposal = monthReached.get('proposal_sent')?.size || 0;
    health.push({ tone: firstTouch >= 700 ? 'green' : firstTouch >= 400 ? 'yellow' : 'red', title: 'Темп первых касаний', detail: `${firstTouch} сделок вошли в «Первое касание сделано» в этом месяце.` });
    health.push({ tone: firstTouch && dialog / firstTouch >= .2 ? 'green' : firstTouch && dialog / firstTouch >= .1 ? 'yellow' : 'red', title: 'Конверсия в диалог', detail: firstTouch ? `${(dialog / firstTouch * 100).toFixed(1)}%: ${dialog} диалогов из ${firstTouch} первых касаний.` : 'Нет базы для расчёта.' });
    health.push({ tone: dialog && sql / dialog >= .1 ? 'green' : dialog && sql / dialog >= .05 ? 'yellow' : 'red', title: 'Конверсия во встречу/SQL', detail: dialog ? `${(sql / dialog * 100).toFixed(1)}%: ${sql} SQL из ${dialog} диалогов.` : 'Нет базы для расчёта.' });
    health.push({ tone: sql && proposal / sql >= .4 ? 'green' : sql && proposal / sql >= .2 ? 'yellow' : 'red', title: 'Выход в КП', detail: sql ? `${(proposal / sql * 100).toFixed(1)}%: ${proposal} КП из ${sql} SQL.` : 'Нет базы для расчёта.' });
    if (bottleneck) health.push({ tone: (bottleneck.average_days || 0) <= 5 ? 'green' : (bottleneck.average_days || 0) <= 10 ? 'yellow' : 'red', title: `Скорость этапа «${bottleneck.stage_name}»`, detail: `Среднее ${bottleneck.average_days.toFixed(1)} дня, медиана ${(bottleneck.median_days || 0).toFixed(1)} дня.` });

    const todayActions = bottleneck ? bottleneck.oldest.slice(0, 5).map((item: any, index: number) => ({
      priority: index + 1,
      lead_external_id: item.external_id,
      lead_name: item.name,
      stage_name: bottleneck.stage_name,
      age_days: item.age_days,
      action: item.has_next_task ? 'Проверить результат последней коммуникации и актуальность следующего шага.' : 'Назначить конкретную следующую задачу и дату контакта.',
    })) : [];

    const coverage = {
      total_stage_events: (events || []).length,
      leads_with_history: eventsByLead.size,
      open_leads: openLeads.length,
      open_leads_with_exact_stage_entry: stageAging.reduce((sum: number, stage: any) => sum + stage.count - stage.estimated_count, 0),
      caveat: 'Циклы и точный возраст этапа считаются по истории, накопленной после подключения синхронизации. Для карточек без события входа используется дата последнего обновления и ставится признак оценки.',
    };

    return new Response(JSON.stringify({ ok: true, generated_at: now.toISOString(), stage_aging: stageAging, cycles, segment_cycles: segmentCycles, conversions, bottleneck: recommendation, cash_forecast: cashForecast, health, today_actions: todayActions, coverage }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});