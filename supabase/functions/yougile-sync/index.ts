import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-anix-sync-key, apikey, content-type',
};
const SOURCE = 'yougile';
const DEFAULT_BASE = 'https://yougile.com/api-v2';

const listFrom = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  for (const key of ['content', 'data', 'items', 'result', 'values']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
};
const idOf = (row: any) => String(row?.id || row?._id || '');
const titleOf = (row: any) => row?.title || row?.name || row?.displayName || null;
const bool = (value: any) => value === true;
const iso = (value: any) => {
  if (!value) return null;
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const assignedIds = (task: any): string[] => {
  const value = task?.assigned || task?.assignedUsers || task?.users || task?.assignees || [];
  if (Array.isArray(value)) return value.map((item: any) => String(typeof item === 'string' ? item : item?.id || '')).filter(Boolean);
  if (value && typeof value === 'object') return Object.keys(value);
  return [];
};
const deadlineOf = (task: any) => iso(task?.deadline?.deadline || task?.deadline?.date || task?.deadline || task?.dueDate);

async function api(base: string, path: string, token: string) {
  const response = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error(`YouGile ${path}: HTTP ${response.status} ${typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function paged(base: string, path: string, token: string) {
  const rows: any[] = [];
  let firstPayload: any = null;
  for (let offset = 0; offset < 100000; offset += 100) {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await api(base, `${path}${separator}limit=100&offset=${offset}`, token);
    if (offset === 0) firstPayload = payload;
    const batch = listFrom(payload);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return { rows, firstPayload };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: jsonHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const sourceWrite = async (status: string, extra: Record<string, any> = {}) => {
    const { error } = await supabase.from('data_sources').upsert({
      slug: SOURCE,
      name: 'YouGile',
      category: 'Производство',
      connection_mode: 'edge',
      status,
      ...extra,
    }, { onConflict: 'slug' });
    if (error) throw new Error(`data_sources write failed: ${error.message}`);
  };

  try {
    const expected = Deno.env.get('ANIX_SYNC_KEY');
    if (expected && req.headers.get('x-anix-sync-key') !== expected) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
    }
    const token = Deno.env.get('YOUGILE_API_KEY');
    const companyId = Deno.env.get('YOUGILE_COMPANY_ID');
    const base = (Deno.env.get('YOUGILE_BASE_URL') || DEFAULT_BASE).replace(/\/$/, '');
    if (!token || !companyId) throw new Error('YOUGILE_API_KEY or YOUGILE_COMPANY_ID is missing');

    const syncedAt = new Date().toISOString();
    await sourceWrite('syncing', { last_error: null });

    let userResult = await paged(base, '/users', token);
    let projectResult = await paged(base, '/projects', token);

    // Some YouGile installations require an explicit company filter even though the key is company-scoped.
    if (!userResult.rows.length) userResult = await paged(base, `/users?companyId=${encodeURIComponent(companyId)}`, token);
    if (!projectResult.rows.length) projectResult = await paged(base, `/projects?companyId=${encodeURIComponent(companyId)}`, token);

    const users = userResult.rows;
    const projects = projectResult.rows;
    if (!projects.length) {
      const preview = projectResult.firstPayload === null ? 'null' : JSON.stringify(projectResult.firstPayload).slice(0, 1000);
      throw new Error(`YouGile returned 0 projects. companyId=${companyId}; base=${base}; response=${preview}`);
    }

    const boards: any[] = [];
    const columns: any[] = [];
    const tasks: any[] = [];

    for (const project of projects) {
      const projectId = idOf(project);
      if (!projectId) continue;
      const projectBoards = (await paged(base, `/boards?projectId=${encodeURIComponent(projectId)}`, token)).rows;
      for (const board of projectBoards) {
        board.__projectId = projectId;
        boards.push(board);
        const boardId = idOf(board);
        if (!boardId) continue;
        const boardColumns = (await paged(base, `/columns?boardId=${encodeURIComponent(boardId)}`, token)).rows;
        for (const column of boardColumns) {
          column.__boardId = boardId;
          column.__projectId = projectId;
          columns.push(column);
          const columnId = idOf(column);
          if (!columnId) continue;
          const columnTasks = (await paged(base, `/tasks?columnId=${encodeURIComponent(columnId)}`, token)).rows;
          for (const task of columnTasks) {
            task.__columnId = columnId;
            task.__boardId = boardId;
            task.__projectId = projectId;
            tasks.push(task);
          }
        }
      }
    }

    const { data: oldTasks, error: oldError } = await supabase.from('pm_tasks').select('external_id,column_external_id').eq('source_slug', SOURCE);
    if (oldError) throw oldError;
    const oldColumn = new Map((oldTasks || []).map((row: any) => [String(row.external_id), String(row.column_external_id || '')]));

    const write = async (table: string, rows: any[]) => {
      if (!rows.length) return;
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'source_slug,external_id' });
        if (error) throw new Error(`${table}: ${error.message}`);
      }
    };

    await write('pm_users', users.map((row: any) => ({ source_slug: SOURCE, external_id: idOf(row), name: titleOf(row), email: row.email || row.login || null, is_active: row.isActive !== false && row.deleted !== true, raw: row, synced_at: syncedAt })).filter((row: any) => row.external_id));
    await write('pm_projects', projects.map((row: any) => ({ source_slug: SOURCE, external_id: idOf(row), title: titleOf(row), is_archived: bool(row.archived) || bool(row.isArchived), raw: row, synced_at: syncedAt })).filter((row: any) => row.external_id));
    await write('pm_boards', boards.map((row: any) => ({ source_slug: SOURCE, external_id: idOf(row), project_external_id: row.__projectId, title: titleOf(row), is_archived: bool(row.archived) || bool(row.isArchived), raw: row, synced_at: syncedAt })).filter((row: any) => row.external_id));
    await write('pm_columns', columns.map((row: any, index: number) => ({ source_slug: SOURCE, external_id: idOf(row), board_external_id: row.__boardId, title: titleOf(row), position: Number(row.position ?? row.order ?? index), is_archived: bool(row.archived) || bool(row.isArchived), raw: row, synced_at: syncedAt })).filter((row: any) => row.external_id));

    const taskRows = tasks.map((row: any) => ({ source_slug: SOURCE, external_id: idOf(row), title: titleOf(row), project_external_id: row.__projectId, board_external_id: row.__boardId, column_external_id: row.__columnId, assigned_user_external_ids: assignedIds(row), deadline_at: deadlineOf(row), completed: bool(row.completed) || bool(row.isCompleted), is_archived: bool(row.archived) || bool(row.isArchived), created_at_source: iso(row.createdAt || row.created), updated_at_source: iso(row.updatedAt || row.updated), raw: row, synced_at: syncedAt })).filter((row: any) => row.external_id);
    const stageEvents = taskRows.filter((row: any) => oldColumn.get(row.external_id) !== row.column_external_id).map((row: any) => ({ source_slug: SOURCE, task_external_id: row.external_id, project_external_id: row.project_external_id, board_external_id: row.board_external_id, column_external_id: row.column_external_id, observed_at: syncedAt }));
    await write('pm_tasks', taskRows);
    if (stageEvents.length) {
      const { error } = await supabase.from('pm_task_stage_events').insert(stageEvents);
      if (error) throw error;
    }

    const counts = { users: users.length, projects: projects.length, boards: boards.length, columns: columns.length, tasks: tasks.length, stage_events: stageEvents.length };
    await sourceWrite('healthy', { last_success_at: syncedAt, last_error: null });
    return new Response(JSON.stringify({ ok: true, company_id: companyId, base_url: base, synced_at: syncedAt, counts }), { headers: jsonHeaders });
  } catch (error) {
    const message = String(error);
    try { await sourceWrite('error', { last_error: message }); } catch (sourceError) {
      return new Response(JSON.stringify({ ok: false, error: message, source_status_error: String(sourceError) }), { status: 500, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: jsonHeaders });
  }
});