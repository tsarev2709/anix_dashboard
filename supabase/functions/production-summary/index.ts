import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const DAY = 86400000;
const text = (v: unknown) => String(v || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = new Date();
    const [{ data: source, error: sourceError }, { data: projects, error: projectsError }, { data: boards, error: boardsError }, { data: columns, error: columnsError }, { data: tasks, error: tasksError }, { data: users, error: usersError }, { data: events, error: eventsError }] = await Promise.all([
      supabase.from('data_sources').select('status,last_success_at,last_error').eq('slug', 'yougile').single(),
      supabase.from('pm_projects').select('*').eq('source_slug', 'yougile'),
      supabase.from('pm_boards').select('*').eq('source_slug', 'yougile'),
      supabase.from('pm_columns').select('*').eq('source_slug', 'yougile'),
      supabase.from('pm_tasks').select('*').eq('source_slug', 'yougile'),
      supabase.from('pm_users').select('*').eq('source_slug', 'yougile'),
      supabase.from('pm_task_stage_events').select('*').eq('source_slug', 'yougile').order('observed_at', { ascending: true }).limit(30000),
    ]);
    for (const error of [sourceError, projectsError, boardsError, columnsError, tasksError, usersError, eventsError]) if (error) throw error;

    const projectMap = new Map((projects || []).map((x: any) => [x.external_id, x]));
    const boardMap = new Map((boards || []).map((x: any) => [x.external_id, x]));
    const columnMap = new Map((columns || []).map((x: any) => [x.external_id, x]));
    const userMap = new Map((users || []).map((x: any) => [x.external_id, x]));
    const activeTasks = (tasks || []).filter((x: any) => !x.is_archived && !x.completed);
    const overdue = activeTasks.filter((x: any) => x.deadline_at && new Date(x.deadline_at) < now);
    const dueWeek = activeTasks.filter((x: any) => x.deadline_at && new Date(x.deadline_at) >= now && new Date(x.deadline_at).getTime() <= now.getTime() + 7 * DAY);
    const withoutDeadline = activeTasks.filter((x: any) => !x.deadline_at);
    const withoutAssignee = activeTasks.filter((x: any) => !(x.assigned_user_external_ids || []).length);

    const stageGroups = new Map<string, any>();
    for (const task of activeTasks) {
      const id = String(task.column_external_id || 'none');
      const row = stageGroups.get(id) || { column_external_id: id, column_name: columnMap.get(id)?.title || 'Без колонки', count: 0, overdue: 0 };
      row.count += 1;
      if (task.deadline_at && new Date(task.deadline_at) < now) row.overdue += 1;
      stageGroups.set(id, row);
    }

    const projectGroups = new Map<string, any>();
    for (const task of activeTasks) {
      const id = String(task.project_external_id || 'none');
      const row = projectGroups.get(id) || { project_external_id: id, project_name: projectMap.get(id)?.title || 'Без проекта', active_tasks: 0, overdue: 0, due_week: 0, without_deadline: 0 };
      row.active_tasks += 1;
      if (!task.deadline_at) row.without_deadline += 1;
      else if (new Date(task.deadline_at) < now) row.overdue += 1;
      else if (new Date(task.deadline_at).getTime() <= now.getTime() + 7 * DAY) row.due_week += 1;
      projectGroups.set(id, row);
    }

    const people = new Map<string, any>();
    for (const task of activeTasks) {
      for (const userId of task.assigned_user_external_ids || []) {
        const row = people.get(userId) || { user_external_id: userId, user_name: userMap.get(userId)?.name || userMap.get(userId)?.email || `Сотрудник ${userId}`, active_tasks: 0, overdue: 0, due_week: 0, projects: new Set<string>() };
        row.active_tasks += 1;
        if (task.project_external_id) row.projects.add(task.project_external_id);
        if (task.deadline_at && new Date(task.deadline_at) < now) row.overdue += 1;
        else if (task.deadline_at && new Date(task.deadline_at).getTime() <= now.getTime() + 7 * DAY) row.due_week += 1;
        people.set(userId, row);
      }
    }

    const eventByTask = new Map<string, any[]>();
    for (const event of events || []) {
      if (!eventByTask.has(event.task_external_id)) eventByTask.set(event.task_external_id, []);
      eventByTask.get(event.task_external_id)!.push(event);
    }
    const agesByColumn = new Map<string, number[]>();
    for (const task of activeTasks) {
      const history = eventByTask.get(task.external_id) || [];
      const entries = history.filter((e: any) => e.column_external_id === task.column_external_id);
      const entered = entries.length ? new Date(entries[entries.length - 1].observed_at) : new Date(task.updated_at_source || task.synced_at || now);
      const age = Math.max(0, (now.getTime() - entered.getTime()) / DAY);
      const id = String(task.column_external_id || 'none');
      if (!agesByColumn.has(id)) agesByColumn.set(id, []);
      agesByColumn.get(id)!.push(age);
    }
    const bottlenecks = [...agesByColumn.entries()].map(([id, values]) => ({ column_external_id: id, column_name: columnMap.get(id)?.title || 'Без колонки', count: values.length, average_days: values.reduce((a, b) => a + b, 0) / values.length, max_days: Math.max(...values) })).filter(x => !/готов|архив|заверш/.test(text(x.column_name))).sort((a, b) => b.average_days - a.average_days);

    const attention = [...overdue].sort((a: any, b: any) => new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime()).slice(0, 12).map((task: any) => ({ external_id: task.external_id, title: task.title, project_name: projectMap.get(task.project_external_id)?.title || null, board_name: boardMap.get(task.board_external_id)?.title || null, column_name: columnMap.get(task.column_external_id)?.title || null, deadline_at: task.deadline_at, overdue_days: Math.ceil((now.getTime() - new Date(task.deadline_at).getTime()) / DAY), assignees: (task.assigned_user_external_ids || []).map((id: string) => userMap.get(id)?.name || userMap.get(id)?.email || id) }));

    return new Response(JSON.stringify({ ok: true, generated_at: now.toISOString(), source, summary: { projects: (projects || []).filter((x: any) => !x.is_archived).length, active_tasks: activeTasks.length, overdue: overdue.length, due_week: dueWeek.length, without_deadline: withoutDeadline.length, without_assignee: withoutAssignee.length }, projects: [...projectGroups.values()].sort((a, b) => b.overdue - a.overdue || b.active_tasks - a.active_tasks), stages: [...stageGroups.values()].sort((a, b) => b.count - a.count), people: [...people.values()].map((x: any) => ({ ...x, projects: x.projects.size })).sort((a, b) => b.overdue - a.overdue || b.active_tasks - a.active_tasks), bottleneck: bottlenecks[0] || null, bottlenecks, attention }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});
