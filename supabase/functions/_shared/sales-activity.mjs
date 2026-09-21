import { calendarDate } from './forecast-fields.mjs';
const TYPES = { outgoing_call: 'calls', outgoing_mail: 'emails', outgoing_chat_message: 'messages', outgoing_sms: 'sms' };
const TAGS = { '[поиск контакта]': 'contact_search', '[анализ сегмента]': 'research', '[анализ компании]': 'research' };
// Task completion is a separate measure: a completed task is not proof of a call.
export function salesActivity(data, { month, manager = 0, pipeline = 0, now = new Date() }) {
  const users = new Map(data.users.map(u => [Number(u.external_id), u.name]));
  const leads = new Map(data.leads.map(l => [Number(l.external_id), l]));
  const tasks = new Map(data.tasks.map(t => [Number(t.external_id), t]));
  const days = new Map(), seen = new Set();
  let unknownActor = 0, unattributedPipeline = 0;
  const counts = () => ({ calls: 0, emails: 0, messages: 0, sms: 0, contact_search: 0, research: 0, completed_tasks: 0, notes: 0, actions: 0 });
  const total = counts();
  // First observed completion of a task counts once, even if repeated/reopened.
  const events = [...data.events].sort((a,b) => String(a.created_at_source).localeCompare(String(b.created_at_source)) || String(a.external_id).localeCompare(String(b.external_id)));
  for (const e of events) {
    let category = TYPES[e.event_type];
    if (!category && !['task_completed', 'common_note_added'].includes(e.event_type)) continue;
    const task = e.entity_type === 'task' ? tasks.get(Number(e.entity_external_id)) : null;
    const proof = e.value_after?.[0];
    const evidence = proof?.message?.id || proof?.note?.id || proof?.mail?.id;
    const identity = e.event_type === 'task_completed' ? `task:${e.entity_external_id}` : `${e.event_type}:${evidence || e.external_id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const day = calendarDate(e.created_at_source, data.settings.timezone);
    if (!day?.startsWith(month + '-')) continue;
    const actor = Number(e.created_by_external_id);
    if (!users.has(actor)) { unknownActor++; continue; }
    if (manager && actor !== manager) continue;
    const leadId = e.entity_type === 'lead' ? Number(e.entity_external_id) : ['lead','leads'].includes(task?.entity_type) ? Number(task.entity_external_id) : null;
    const lead = leads.get(leadId);
    if (pipeline && !lead) { unattributedPipeline++; continue; }
    if (pipeline && Number(lead.pipeline_external_id) !== pipeline) continue;
    const k = `${day}:${actor}`;
    if (!days.has(k)) days.set(k, { date: day, manager_id: actor, manager_name: users.get(actor), ...counts() });
    const row = days.get(k);
    if (e.event_type === 'task_completed') {
      row.completed_tasks++; total.completed_tasks++;
      // Never reclassify history from a task text edited after completion.
      const stable = task && Date.parse(task.updated_at_source || '') <= Date.parse(e.created_at_source);
      const text = stable ? String(task.text || '').trim().toLowerCase() : '';
      category = Object.entries(TAGS).find(([tag]) => text.startsWith(tag))?.[1];
    } else if (e.event_type === 'common_note_added') category = 'notes';
    if (!category) continue;
    row[category]++; total[category]++;
    if (category !== 'notes') { row.actions++; total.actions++; }
  }
  const target = Number(data.settings.daily_activity_target) || 800;
  return { total, by_day: [...days.values()].sort((a,b) => b.date.localeCompare(a.date) || a.manager_id-b.manager_id).map(row => ({...row, target, target_ratio: row.actions/target})), daily_target: target,
    unknown_actor_events: unknownActor, unattributed_pipeline_events: unattributedPipeline,
    measured_through: calendarDate(now.toISOString(),data.settings.timezone),
    coverage: 'Только зафиксированные события с известным автором. Нет события ≠ не было работы. Полнота телефонии, почты и чатов не подтверждена; сообщения без автора не приписываются продавцу.',
    recording: 'Для поиска и аналитики создайте отдельную задачу в amoCRM с префиксом [Поиск контакта], [Анализ сегмента] или [Анализ компании] и завершите её после работы. Одна задача = одно действие; повторное завершение не увеличивает счётчик. Не меняйте текст после завершения.',
  };
}
