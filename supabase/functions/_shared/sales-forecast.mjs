import { calendarDate } from './forecast-fields.mjs';
const DAY = 86400000;
const n = value => Number(value || 0);
const stamp = value => value ? Date.parse(value) || 0 : 0;
const key = (p, s) => `${p}:${s}`;
const sum = (rows, get) => Math.round(rows.reduce((total, row) => total + get(row), 0) * 100) / 100;
// These two IDs are amoCRM API system constants, not guessed customer stages.
// https://www.amocrm.ru/developers/content/crm_platform/leads_pipelines
const outcome = lead => n(lead.status_external_id) === 142 ? 'won' : n(lead.status_external_id) === 143 ? 'lost' : 'open';
export function validMonth(month) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= '2000-01' && month <= '2199-12'; }
export function stageCatalog(data) {
  // Pipelines preserve each occurrence of the shared system statuses.
  return data.pipelines.flatMap(p => (p.raw?._embedded?.statuses || []).map(s => ({
    pipeline_external_id: n(p.external_id), status_external_id: n(s.id), name: s.name,
    pipeline_name: p.name, sort_order: n(s.sort), outcome: outcome({ status_external_id: s.id }),
  })));
}
export function stageProbabilities(data) {
  const leads = new Map(data.leads.map(l => [n(l.external_id), l]));
  const visits = new Map();
  for (const e of data.stages) {
    const lead = leads.get(n(e.lead_external_id));
    // Only resolved outcomes after the observed visit; open deals remain censored.
    if (!lead || outcome(lead) === 'open' || !stamp(lead.closed_at_source) || stamp(e.observed_at) > stamp(lead.closed_at_source)) continue;
    const k = key(e.pipeline_external_id, e.status_external_id);
    if (!visits.has(k)) visits.set(k, new Set());
    visits.get(k).add(n(lead.external_id));
  }
  const configs = new Map(data.probabilities.map(p => [key(p.pipeline_external_id, p.status_external_id), p]));
  return stageCatalog(data).map(stage => {
    const k = key(stage.pipeline_external_id, stage.status_external_id);
    const config = configs.get(k) || {};
    const ids = [...(visits.get(k) || [])];
    const wins = ids.filter(id => outcome(leads.get(id)) === 'won').length;
    const observed = ids.length ? wins / ids.length : null;
    let probability = null, probability_source = 'unconfigured';
    if (stage.outcome !== 'open') { probability = stage.outcome === 'won' ? 1 : 0; probability_source = 'system'; }
    else if (config.manual_override != null) { probability = n(config.manual_override); probability_source = 'manual'; }
    else if (data.settings.observed_enabled && ids.length >= data.settings.min_sample_size) { probability = observed; probability_source = 'observed'; }
    else if (config.fallback_probability != null) { probability = n(config.fallback_probability); probability_source = 'fallback'; }
    return { ...stage, probability, probability_source, sample_size: ids.length, observed_probability: observed,
      manual_override: config.manual_override ?? null, fallback_probability: config.fallback_probability ?? null,
      requires_expected_date: Boolean(config.requires_expected_date) };
  });
}
export function buildForecast(data, { month, manager = 0, pipeline = 0, now = new Date() }) {
  if (!validMonth(month)) throw new Error('Invalid month');
  const timezone = data.settings.timezone;
  const today = calendarDate(now.toISOString(), timezone);
  const inMonth = value => calendarDate(value, timezone)?.slice(0, 7) === month;
  const probabilities = stageProbabilities(data);
  const stageMap = new Map(probabilities.map(s => [key(s.pipeline_external_id, s.status_external_id), s]));
  const users = new Map(data.users.map(u => [n(u.external_id), u.name]));
  const eligible = data.leads.filter(l => (!manager || (n(l.responsible_user_external_id) || -1) === manager) && (!pipeline || n(l.pipeline_external_id) === pipeline));
  const eligibleIds = new Set(eligible.map(l => n(l.external_id)));
  const tasksByLead = new Map(), eventsByLead = new Map(), stagesByLead = new Map();
  for (const task of data.tasks) {
    if (!['lead', 'leads'].includes(task.entity_type)) continue;
    const id = n(task.entity_external_id);
    if (!tasksByLead.has(id)) tasksByLead.set(id, []);
    tasksByLead.get(id).push(task);
  }
  for (const event of data.events) {
    if (event.entity_type !== 'lead') continue;
    const id = n(event.entity_external_id);
    eventsByLead.set(id, Math.max(eventsByLead.get(id) || 0, stamp(event.created_at_source)));
  }
  for (const event of data.stages) {
    const id = n(event.lead_external_id);
    if (!stagesByLead.has(id)) stagesByLead.set(id, []);
    stagesByLead.get(id).push(event);
  }
  const urlBase = /^[a-z0-9-]+\.(amocrm\.ru|kommo\.com)$/.test(data.account_domain || '') ? `https://${data.account_domain}` : null;
  const enriched = eligible.map(lead => {
    const id = n(lead.external_id), stage = stageMap.get(key(lead.pipeline_external_id, lead.status_external_id));
    const tasks = tasksByLead.get(id) || [];
    const pending = tasks.filter(t => !t.is_completed).sort((a, b) => (stamp(a.complete_till) || Infinity) - (stamp(b.complete_till) || Infinity));
    const next = pending[0];
    const history = [...(stagesByLead.get(id) || [])].sort((a, b) => stamp(b.observed_at) - stamp(a.observed_at));
    let entered = null;
    for (const event of history) {
      if (n(event.status_external_id) !== n(lead.status_external_id) || n(event.pipeline_external_id) !== n(lead.pipeline_external_id)) break;
      entered = event.observed_at;
    }
    let lastActivity = Math.max(stamp(lead.updated_at_source), stamp(lead.created_at_source), eventsByLead.get(id) || 0);
    for (const task of tasks) lastActivity = Math.max(lastActivity, stamp(task.updated_at_source), stamp(task.created_at_source));
    const days = date => Math.max(0, Math.floor((now.getTime() - stamp(date)) / DAY));
    return { id, name: lead.name || `Сделка #${id}`, url: urlBase ? `${urlBase}/leads/detail/${id}` : null,
      manager_id: n(lead.responsible_user_external_id) || -1, manager_name: users.get(n(lead.responsible_user_external_id)) || 'Без ответственного',
      pipeline_id: n(lead.pipeline_external_id), status_id: n(lead.status_external_id),
      stage_name: stage?.name || 'Этап не синхронизирован', price: n(lead.price), outcome: outcome(lead),
      probability: stage?.probability ?? null, probability_source: stage?.probability_source || 'unconfigured',
      weighted_amount: stage?.probability == null ? null : Math.round(n(lead.price) * stage.probability * 100) / 100,
      expected_close_date: lead.expected_close_date, invalid_date: lead.expected_close_date_invalid,
      requires_expected_date: stage?.requires_expected_date || false,
      overdue_days: lead.expected_close_date && lead.expected_close_date < today ? Math.round((Date.parse(today) - Date.parse(lead.expected_close_date)) / DAY) : 0,
      next_step: next?.text || (next ? 'Задача без описания' : null), next_step_at: next?.complete_till || null,
      has_next_step: pending.length > 0,
      overdue_tasks: pending.filter(t => stamp(t.complete_till) && stamp(t.complete_till) < now.getTime()).length,
      stage_age_days: entered ? days(entered) : null, inactive_days: lastActivity ? days(new Date(lastActivity).toISOString()) : null,
      closed_at: lead.closed_at_source, created_at: lead.created_at_source,
    };
  });
  const open = enriched.filter(l => l.outcome === 'open');
  const expected = open.filter(l => l.expected_close_date?.slice(0, 7) === month);
  const won = enriched.filter(l => l.outcome === 'won' && inMonth(l.closed_at));
  const lost = enriched.filter(l => l.outcome === 'lost' && inMonth(l.closed_at));
  const totals = (deals, wins = []) => {
    const unknown = deals.filter(l => l.probability === null);
    const knownWeighted = sum(deals, l => l.weighted_amount || 0);
    return { fact_amount: sum(wins, l => l.price), potential_pipeline_amount: sum(deals, l => l.price),
      weighted_forecast_amount: unknown.length || data.settings.field_state?.state !== 'ready' ? null : knownWeighted, known_weighted_amount: knownWeighted,
      unweighted_deals_count: unknown.length, unweighted_amount: sum(unknown, l => l.price),
      expected_deals_count: deals.length, won_count: wins.length };
  };
  const forecast = totals(expected, won);
  const group = (field, labels) => [...new Set([...expected, ...won].map(l => l[field]))].map(id => ({
    id, name: labels(id), ...totals(expected.filter(l => l[field] === id), won.filter(l => l[field] === id)),
  }));
  const issues = open.filter(l => l.overdue_days || !l.has_next_step || l.overdue_tasks || l.invalid_date || (l.requires_expected_date && !l.expected_close_date) || l.inactive_days > 14)
    .sort((a, b) => (b.overdue_days + b.overdue_tasks * 10 + (!b.has_next_step ? 10 : 0)) - (a.overdue_days + a.overdue_tasks * 10 + (!a.has_next_step ? 10 : 0)) || b.price - a.price);
  const reasons = new Map(data.lossReasons.map(r => [n(r.external_id), r.name]));
  const lostIds = new Set(lost.map(l => l.id)), lossGroups = new Map();
  for (const lead of eligible.filter(l => lostIds.has(n(l.external_id)))) {
    const name = reasons.get(n(lead.loss_reason_external_id)) || 'Причина не указана / не синхронизирована';
    lossGroups.set(name, (lossGroups.get(name) || 0) + 1);
  }
  // Event counts are explicitly CRM events, never presented as employee actions or KPI=800.
  const monthlyEvents = data.events.filter(e => e.entity_type === 'lead' && eligibleIds.has(n(e.entity_external_id)) && inMonth(e.created_at_source));
  const byDay = new Map();
  for (const e of monthlyEvents) {
    const day = calendarDate(e.created_at_source, timezone);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const durations = won.filter(l => stamp(l.created_at) && stamp(l.closed_at) >= stamp(l.created_at)).map(l => (stamp(l.closed_at) - stamp(l.created_at)) / DAY);
  return { ok: true, month, timezone, generated_at: now.toISOString(), source: data.source,
    filters: { manager, pipeline },
    options: { managers: [{ external_id: -1, name: 'Без ответственного' }, ...data.users.map(u => ({ external_id: n(u.external_id), name: u.name }))], pipelines: data.pipelines.map(p => ({ external_id: n(p.external_id), name: p.name })) },
    actual: { amount: forecast.fact_amount, won_count: won.length, lost_count: lost.length,
      new_deals_count: enriched.filter(l => inMonth(l.created_at)).length, open_deals_count: open.length,
      average_won_amount: won.length ? forecast.fact_amount / won.length : null,
      closed_win_rate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
      average_won_days: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      crm_events_count: monthlyEvents.length },
    forecast,
    discipline: { without_next_step: open.filter(l => !l.has_next_step).length,
      overdue_tasks: sum(open, l => l.overdue_tasks), overdue_close_date: open.filter(l => l.overdue_days).length,
      without_date: open.filter(l => !l.expected_close_date).length,
      required_without_date: open.filter(l => l.requires_expected_date && !l.expected_close_date).length,
      invalid_date: open.filter(l => l.invalid_date).length,
      stalled_14: open.filter(l => l.inactive_days > 14).length, stalled_30: open.filter(l => l.inactive_days > 30).length },
    quality: { date_coverage: open.length ? open.filter(l => l.expected_close_date).length / open.length : null,
      next_step_coverage: open.length ? open.filter(l => l.has_next_step).length / open.length : null,
      budget_coverage: open.length ? open.filter(l => l.price > 0).length / open.length : null,
      probability_coverage: expected.length ? expected.filter(l => l.probability !== null).length / expected.length : null },
    deals: expected.sort((a, b) => b.price - a.price), issues,
    by_manager: group('manager_id', id => users.get(id) || 'Без ответственного'),
    by_stage: [...new Set(expected.map(l => key(l.pipeline_id, l.status_id)))].map(id => ({ id, name: stageMap.get(id)?.name || id, ...totals(expected.filter(l => key(l.pipeline_id, l.status_id) === id)) })),
    by_day: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    loss_reasons: [...lossGroups].map(([name, count]) => ({ name, count })),
    configuration: { ...data.settings, stages: probabilities },
    caveats: [
      'Прогноз сделок не равен поступлениям денег. Факт — текущие выигранные сделки по дате закрытия.',
      'Открытые карточки включают раннюю базу поиска контактов; это не количество активных переговоров.',
      'Открытые сделки и дисциплина показаны на текущий момент, включая при выборе прошлых месяцев.',
      'Конверсия — выиграно / (выиграно + проиграно) за месяц, не когортная конверсия.',
      'Наблюдаемая вероятность: уникальные завершённые сделки с зафиксированным посещением стадии. Незавершённые исключены; история может быть неполной.',
      'Активность — события карточек CRM, включая автоматические изменения. Это не число действий менеджера; норматив 800 не применяется.',
      'Выполненные задачи, встречи и КП не выводятся без надёжного события завершения и согласованного соответствия реальным стадиям.',
    ],
  };
}
