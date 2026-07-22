import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const plans = [
  { key: 'touches', label: 'Целевые касания', plan: 1000, unit: 'шт.', measurable: false, missing: 'Касания вне сделок не синхронизируются. Нужны сообщения/почта или отдельное поле активности.' },
  { key: 'conversations', label: 'Ответы / переписки', plan: 250, unit: 'шт.', measurable: false, missing: 'В базе пока нет переписок amoCRM и Telegram.' },
  { key: 'calls', label: 'Квалификационные звонки', plan: 25, unit: 'шт.', measurable: false, missing: 'Звонки и результаты звонков пока не загружаются.' },
  { key: 'sql', label: 'Квалифицированные лиды / SQL', plan: 10, unit: 'шт.', measurable: true, patterns: [/sql/i, /квалифиц/i] },
  { key: 'proposals', label: 'Коммерческие предложения', plan: 5, unit: 'шт.', measurable: true, patterns: [/\bкп\b/i, /коммерческ/i, /предложен/i] },
  { key: 'contracts', label: 'Договоры / счета', plan: 3, unit: 'шт.', measurable: true, patterns: [/договор/i, /сч[её]т/i] },
  { key: 'prepayments', label: 'Предоплаты', plan: 2, unit: 'шт.', measurable: true, patterns: [/предоплат/i, /аванс/i] },
  { key: 'payments', label: 'Оплаты', plan: 1000000, unit: '₽', measurable: true, isMoney: true, patterns: [/оплат/i, /успешно реализован/i, /закрыт.*успеш/i] },
];

const timestamp = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const elapsedDays = Math.max(1, now.getUTCDate());
    const elapsedRatio = Math.min(1, elapsedDays / daysInMonth);

    const [
      { data: leads, error: leadsError },
      { data: statuses, error: statusesError },
      { data: source, error: sourceError },
      { data: events, error: eventsError },
    ] = await Promise.all([
      supabase.from('crm_leads').select('external_id,name,price,pipeline_external_id,status_external_id,responsible_user_external_id,created_at_source,updated_at_source,closed_at_source,raw').eq('source_slug', 'amocrm'),
      supabase.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order,color').eq('source_slug', 'amocrm').order('sort_order'),
      supabase.from('data_sources').select('status,last_success_at,last_error').eq('slug', 'amocrm').single(),
      supabase.from('crm_lead_stage_events').select('lead_external_id,status_external_id,observed_at').eq('source_slug', 'amocrm').gte('observed_at', monthStart.toISOString()).lt('observed_at', monthEnd.toISOString()),
    ]);

    if (leadsError) throw leadsError;
    if (statusesError) throw statusesError;
    if (sourceError) throw sourceError;
    if (eventsError) throw eventsError;

    const allLeads = leads || [];
    const openLeads = allLeads.filter((lead: any) => !lead.closed_at_source);
    const closedLeads = allLeads.filter((lead: any) => Boolean(lead.closed_at_source));
    const pipelineValue = openLeads.reduce((sum: number, lead: any) => sum + Number(lead.price || 0), 0);
    const averageOpenCheck = openLeads.length ? pipelineValue / openLeads.length : 0;
    const statusMap = new Map((statuses || []).map((status: any) => [Number(status.external_id), status]));
    const leadMap = new Map(allLeads.map((lead: any) => [Number(lead.external_id), lead]));

    const byStatus = new Map<number, any>();
    for (const lead of openLeads) {
      const status = statusMap.get(Number(lead.status_external_id)) as any;
      const key = Number(lead.status_external_id || 0);
      const current = byStatus.get(key) || { external_id: key, name: status?.name || `Этап ${key}`, color: status?.color || null, sort_order: status?.sort_order ?? null, count: 0, value: 0 };
      current.count += 1;
      current.value += Number(lead.price || 0);
      byStatus.set(key, current);
    }
    const stages = [...byStatus.values()].sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));

    const currentMonthLeads = allLeads.filter((lead: any) => {
      const created = new Date(lead.created_at_source || 0);
      return created >= monthStart && created < monthEnd;
    });

    const reachedByStatus = new Map<number, Set<number>>();
    for (const event of events || []) {
      const statusId = Number(event.status_external_id || 0);
      if (!reachedByStatus.has(statusId)) reachedByStatus.set(statusId, new Set());
      reachedByStatus.get(statusId)!.add(Number(event.lead_external_id));
    }
    for (const lead of currentMonthLeads) {
      const statusId = Number(lead.status_external_id || 0);
      if (!reachedByStatus.has(statusId)) reachedByStatus.set(statusId, new Set());
      reachedByStatus.get(statusId)!.add(Number(lead.external_id));
    }

    const kpis = plans.map((plan) => {
      if (!plan.measurable) return { ...plan, fact: null, forecast: null, completion: null, pace: null, status: 'missing' };
      const matchedStatusIds = (statuses || []).filter((status: any) => plan.patterns?.some(pattern => pattern.test(status.name || ''))).map((status: any) => Number(status.external_id));
      const leadIds = new Set<number>();
      matchedStatusIds.forEach(statusId => reachedByStatus.get(statusId)?.forEach(id => leadIds.add(id)));
      let fact = leadIds.size;
      if (plan.isMoney) fact = [...leadIds].reduce((sum, id) => sum + Number((leadMap.get(id) as any)?.price || 0), 0);
      const forecast = Math.round(fact / elapsedRatio);
      const completion = plan.plan ? fact / plan.plan : 0;
      const forecastCompletion = plan.plan ? forecast / plan.plan : 0;
      return {
        ...plan,
        matched_statuses: matchedStatusIds.map(id => (statusMap.get(id) as any)?.name).filter(Boolean),
        fact,
        forecast,
        completion,
        forecast_completion: forecastCompletion,
        pace: plan.plan * elapsedRatio,
        status: forecastCompletion >= 1 ? 'green' : forecastCompletion >= .8 ? 'yellow' : forecastCompletion >= .6 ? 'orange' : 'red',
      };
    });

    const measurableKpis = kpis.filter(item => item.measurable && item.forecast_completion !== null);
    const overallForecast = measurableKpis.length ? measurableKpis.reduce((sum, item: any) => sum + Math.min(1.25, item.forecast_completion || 0), 0) / measurableKpis.length : 0;

    const responsible = new Map<number, { id: number; open: number; created_month: number; pipeline_value: number }>();
    for (const lead of allLeads) {
      const id = Number(lead.responsible_user_external_id || 0);
      if (!id) continue;
      const row = responsible.get(id) || { id, open: 0, created_month: 0, pipeline_value: 0 };
      if (!lead.closed_at_source) { row.open += 1; row.pipeline_value += Number(lead.price || 0); }
      if (currentMonthLeads.some((monthLead: any) => monthLead.external_id === lead.external_id)) row.created_month += 1;
      responsible.set(id, row);
    }
    const managers = [...responsible.values()].sort((a, b) => b.created_month - a.created_month || b.open - a.open);

    const staleThreshold = now.getTime() - 5 * 86400000;
    const attention = openLeads
      .filter((lead: any) => new Date(lead.updated_at_source || 0).getTime() < staleThreshold)
      .sort((a: any, b: any) => new Date(a.updated_at_source || 0).getTime() - new Date(b.updated_at_source || 0).getTime())
      .slice(0, 12)
      .map((lead: any) => ({
        external_id: lead.external_id,
        name: lead.name || `Сделка #${lead.external_id}`,
        price: Number(lead.price || 0),
        status_name: (statusMap.get(Number(lead.status_external_id)) as any)?.name || null,
        updated_at_source: lead.updated_at_source,
        stale_days: Math.floor((now.getTime() - new Date(lead.updated_at_source || 0).getTime()) / 86400000),
        responsible_user_external_id: lead.responsible_user_external_id,
      }));

    const upcoming = openLeads
      .map((lead: any) => {
        const raw = lead.raw || {};
        const nextAt = timestamp(raw.closest_task_at || raw.next_task_at);
        return nextAt ? { external_id: lead.external_id, name: lead.name || `Сделка #${lead.external_id}`, at: nextAt, status_name: (statusMap.get(Number(lead.status_external_id)) as any)?.name || null, responsible_user_external_id: lead.responsible_user_external_id } : null;
      })
      .filter(Boolean)
      .filter((item: any) => new Date(item.at) >= new Date(now.getTime() - 86400000))
      .sort((a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(0, 10);

    const recent = [...allLeads]
      .sort((a: any, b: any) => new Date(b.updated_at_source || 0).getTime() - new Date(a.updated_at_source || 0).getTime())
      .slice(0, 10)
      .map((lead: any) => ({ ...lead, raw: undefined, status_name: (statusMap.get(Number(lead.status_external_id)) as any)?.name || null }));

    const missingData = [
      ...kpis.filter(item => !item.measurable).map(item => ({ metric: item.label, reason: item.missing, priority: 'high' })),
      { metric: 'Имена пользователей amoCRM', reason: 'Сейчас синхронизируются ID ответственных, но не справочник пользователей. Поэтому продавец отображается по ID.', priority: 'medium' },
      { metric: 'Плановая дата оплаты', reason: 'Нет отдельной обязательной даты ожидаемой оплаты по сделке — прогноз денег по календарю пока неполный.', priority: 'high' },
      { metric: 'Причины проигрыша', reason: 'Причина хранится как ID, но справочник причин ещё не синхронизирован.', priority: 'medium' },
    ];

    return new Response(JSON.stringify({
      ok: true,
      generated_at: now.toISOString(),
      period: { start: monthStart.toISOString(), end: monthEnd.toISOString(), elapsed_days: elapsedDays, days_in_month: daysInMonth, elapsed_ratio: elapsedRatio },
      source,
      summary: { total_leads: allLeads.length, open_leads: openLeads.length, closed_leads: closedLeads.length, pipeline_value: pipelineValue, average_open_check: averageOpenCheck, new_leads_month: currentMonthLeads.length, overall_forecast: overallForecast },
      kpis,
      stages,
      managers,
      attention,
      upcoming,
      recent,
      missing_data: missingData,
    }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});