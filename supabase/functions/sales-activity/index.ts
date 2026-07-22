import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const deepId = (value: unknown, keys: string[]): number | null => {
  if (Array.isArray(value)) {
    for (const item of value) { const found = deepId(item, keys); if (found) return found; }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (keys.includes(key) && Number(item)) return Number(item);
      const found = deepId(item, keys); if (found) return found;
    }
  }
  return null;
};

const taskKind = (task: any) => {
  const text = `${task.text || ''} ${task.result_text || ''}`.toLowerCase();
  if (/вкс|видеовстреч|zoom|meet|встреч/.test(text) || Number(task.task_type_id) === 2) return 'meeting';
  if (/follow.?up|фоллоу|фолоу|повторн|напомн/.test(text)) return 'follow_up';
  if (/перв.*касан|перв.*письм|перв.*сообщ/.test(text)) return 'first_touch';
  if (/кп|коммерческ.*предлож/.test(text)) return 'proposal';
  if (/договор|сч[её]т/.test(text)) return 'contract';
  if (Number(task.task_type_id) === 1 || /звон/.test(text)) return 'call';
  return 'task';
};

const labels: Record<string, string> = {
  transition: 'Переход сделки', first_touch: 'Первое касание', follow_up: 'Follow-up', call: 'Звонок', meeting: 'ВКС / встреча', proposal: 'КП', contract: 'Договор / счёт', task: 'Другая задача',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now.getTime() - 6 * 86400000); weekStart.setHours(0, 0, 0, 0);
    const historyStart = new Date(now.getTime() - 45 * 86400000);

    const [tasksRes, eventsRes, statusesRes, pipelinesRes, usersRes, leadsRes, sourceRes] = await Promise.all([
      supabase.from('crm_tasks').select('*').eq('source_slug', 'amocrm').gte('updated_at_source', historyStart.toISOString()).order('updated_at_source', { ascending: false }),
      supabase.from('crm_events').select('*').eq('source_slug', 'amocrm').gte('created_at_source', historyStart.toISOString()).order('created_at_source', { ascending: false }),
      supabase.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order').eq('source_slug', 'amocrm'),
      supabase.from('crm_pipelines').select('external_id,name').eq('source_slug', 'amocrm'),
      supabase.from('crm_users').select('external_id,name,email,is_admin,is_active').eq('source_slug', 'amocrm'),
      supabase.from('crm_leads').select('external_id,name,responsible_user_external_id,pipeline_external_id,status_external_id').eq('source_slug', 'amocrm'),
      supabase.from('data_sources').select('last_success_at,status,last_error').eq('slug', 'amocrm').single(),
    ]);
    for (const result of [tasksRes, eventsRes, statusesRes, pipelinesRes, usersRes, leadsRes, sourceRes]) if (result.error) throw result.error;

    const tasks = tasksRes.data || [];
    const events = eventsRes.data || [];
    const statuses = statusesRes.data || [];
    const pipelines = pipelinesRes.data || [];
    const users = usersRes.data || [];
    const leads = leadsRes.data || [];
    const statusMap = new Map(statuses.map((x: any) => [Number(x.external_id), x]));
    const pipelineMap = new Map(pipelines.map((x: any) => [Number(x.external_id), x]));
    const userMap = new Map(users.map((x: any) => [Number(x.external_id), x]));
    const leadMap = new Map(leads.map((x: any) => [Number(x.external_id), x]));
    const taskMap = new Map(tasks.map((x: any) => [Number(x.external_id), x]));
    const userName = (id: unknown) => userMap.get(Number(id || 0))?.name || `Пользователь #${id || '—'}`;

    const actions: any[] = [];
    for (const event of events) {
      if (event.event_type !== 'lead_status_changed') continue;
      const lead = leadMap.get(Number(event.entity_external_id)) as any;
      const fromId = deepId(event.value_before, ['status_id', 'id']);
      const toId = deepId(event.value_after, ['status_id', 'id']);
      if (!toId || fromId === toId) continue;
      const toStatus = statusMap.get(toId) as any;
      const fromStatus = fromId ? statusMap.get(fromId) as any : null;
      const pipelineId = Number(toStatus?.pipeline_external_id || lead?.pipeline_external_id || 0);
      actions.push({
        id: `event:${event.external_id}`, kind: 'transition', label: labels.transition, at: event.created_at_source,
        user_id: Number(event.created_by_external_id || lead?.responsible_user_external_id || 0), user_name: userName(event.created_by_external_id || lead?.responsible_user_external_id),
        lead_id: lead?.external_id || event.entity_external_id, lead_name: lead?.name || event.raw?.lead_name || `Сделка #${event.entity_external_id}`,
        pipeline_name: pipelineMap.get(pipelineId)?.name || null, from_status: fromStatus?.name || 'Предыдущий этап', to_status: toStatus?.name || `Этап ${toId}`,
      });
    }

    for (const task of tasks) {
      if (!task.is_completed || !task.updated_at_source) continue;
      const lead = task.entity_type === 'leads' || task.entity_type === 'lead' ? leadMap.get(Number(task.entity_external_id)) as any : null;
      const kind = taskKind(task);
      const actorId = Number(task.updated_by_external_id || task.responsible_user_external_id || lead?.responsible_user_external_id || 0);
      actions.push({
        id: `task:${task.external_id}`, kind, label: labels[kind], at: task.updated_at_source, user_id: actorId, user_name: userName(actorId),
        lead_id: lead?.external_id || task.entity_external_id, lead_name: lead?.name || (task.entity_external_id ? `Сделка #${task.entity_external_id}` : null),
        pipeline_name: lead ? pipelineMap.get(Number(lead.pipeline_external_id))?.name || null : null,
        text: task.text || null, result: task.result_text || null,
      });
    }

    actions.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const within = (action: any, start: Date) => new Date(action.at) >= start;
    const countByKind = (items: any[]) => Object.entries(items.reduce((acc: Record<string, number>, item: any) => { acc[item.kind] = (acc[item.kind] || 0) + 1; return acc; }, {})).map(([kind, count]) => ({ kind, label: labels[kind] || kind, count })).sort((a: any, b: any) => b.count - a.count);

    const monthActions = actions.filter(action => within(action, monthStart));
    const weekActions = actions.filter(action => within(action, weekStart));
    const todayActions = actions.filter(action => within(action, todayStart));

    const daily = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(todayStart.getTime() - (13 - index) * 86400000);
      const next = new Date(date.getTime() + 86400000);
      const items = actions.filter(action => { const at = new Date(action.at); return at >= date && at < next; });
      return { date: date.toISOString(), count: items.length, transitions: items.filter(x => x.kind === 'transition').length, tasks: items.filter(x => x.kind !== 'transition').length };
    });

    const transitionTargets = Object.values(monthActions.filter(x => x.kind === 'transition').reduce((acc: Record<string, any>, item: any) => {
      const key = `${item.pipeline_name || ''}:${item.to_status}`;
      acc[key] ||= { pipeline_name: item.pipeline_name, status_name: item.to_status, count: 0 };
      acc[key].count += 1; return acc;
    }, {})).sort((a: any, b: any) => b.count - a.count);

    const managers = Object.values(monthActions.reduce((acc: Record<string, any>, action: any) => {
      const key = String(action.user_id || 0); const user = userMap.get(Number(action.user_id)) as any;
      acc[key] ||= { id: action.user_id, name: action.user_name, is_admin: Boolean(user?.is_admin), actions: 0, transitions: 0, tasks: 0 };
      acc[key].actions += 1; if (action.kind === 'transition') acc[key].transitions += 1; else acc[key].tasks += 1; return acc;
    }, {})).sort((a: any, b: any) => b.actions - a.actions);

    const pendingTasks = tasks.filter((task: any) => !task.is_completed).sort((a: any, b: any) => new Date(a.complete_till || 0).getTime() - new Date(b.complete_till || 0).getTime());
    const overdue = pendingTasks.filter((task: any) => task.complete_till && new Date(task.complete_till) < now);

    return new Response(JSON.stringify({
      ok: true, generated_at: now.toISOString(), source: sourceRes.data,
      summary: { today: todayActions.length, week: weekActions.length, month: monthActions.length, completed_tasks_month: monthActions.filter(x => x.kind !== 'transition').length, transitions_month: monthActions.filter(x => x.kind === 'transition').length, overdue_tasks: overdue.length, pending_tasks: pendingTasks.length },
      by_kind: countByKind(monthActions), daily, transition_targets: transitionTargets, managers,
      recent: actions.slice(0, 40),
      overdue: overdue.slice(0, 15).map((task: any) => ({ ...task, responsible_user_name: userName(task.responsible_user_external_id), lead_name: leadMap.get(Number(task.entity_external_id))?.name || null })),
    }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});