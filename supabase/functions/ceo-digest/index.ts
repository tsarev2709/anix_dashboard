import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

const DAY = 86_400_000;
const SOURCE_CRM = 'amocrm';
const SOURCE_PM = 'yougile';
const norm = (value: unknown) => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
const key = (pipelineId: unknown, statusId: unknown) => `${Number(pipelineId || 0)}:${Number(statusId || 0)}`;
const ms = (value: unknown) => {
  if (!value) return 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const iso = (value: unknown) => ms(value) ? new Date(ms(value)).toISOString() : null;
const daysSince = (value: unknown, nowMs: number) => Math.max(0, Math.floor((nowMs - ms(value)) / DAY));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
};
const round1 = (value: number | null) => value === null ? null : Math.round(value * 10) / 10;
const severityRank: Record<string, number> = { critical: 0, risk: 1, info: 2 };
const timestampFromRaw = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  return iso(value);
};
const contactFromRaw = (raw: any) => {
  const contacts = raw?._embedded?.contacts || raw?.contacts || [];
  if (!Array.isArray(contacts)) return null;
  const named = contacts.find((contact: any) => contact?.name || contact?.first_name || contact?.last_name);
  if (!named) return null;
  return named.name || [named.first_name, named.last_name].filter(Boolean).join(' ') || null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const now = new Date();
    const nowMs = now.getTime();
    const historyFrom = new Date(nowMs - 180 * DAY).toISOString();
    const conversionFrom = nowMs - 90 * DAY;

    const [
      leadsResult,
      statusesResult,
      pipelinesResult,
      crmUsersResult,
      crmTasksResult,
      crmEventsResult,
      stageEventsResult,
      pmProjectsResult,
      pmBoardsResult,
      pmColumnsResult,
      pmTasksResult,
      pmUsersResult,
      sourcesResult,
      decisionsResult,
      telegramInboxResult,
      credentialResult,
    ] = await Promise.all([
      db.from('crm_leads').select('external_id,name,price,pipeline_external_id,status_external_id,responsible_user_external_id,created_at_source,updated_at_source,closed_at_source,raw').eq('source_slug', SOURCE_CRM).limit(10_000),
      db.from('crm_statuses').select('external_id,pipeline_external_id,name,sort_order,color').eq('source_slug', SOURCE_CRM).order('sort_order').limit(5_000),
      db.from('crm_pipelines').select('external_id,name,is_main,is_archive').eq('source_slug', SOURCE_CRM).limit(1_000),
      db.from('crm_users').select('external_id,name,email,is_active').eq('source_slug', SOURCE_CRM).limit(5_000),
      db.from('crm_tasks').select('external_id,entity_external_id,entity_type,responsible_user_external_id,text,result_text,is_completed,complete_till,created_at_source,updated_at_source').eq('source_slug', SOURCE_CRM).limit(30_000),
      db.from('crm_events').select('external_id,event_type,entity_external_id,entity_type,created_at_source').eq('source_slug', SOURCE_CRM).gte('created_at_source', historyFrom).order('created_at_source', { ascending: false }).limit(30_000),
      db.from('crm_lead_stage_events').select('lead_external_id,pipeline_external_id,status_external_id,observed_at').eq('source_slug', SOURCE_CRM).gte('observed_at', historyFrom).order('observed_at', { ascending: true }).limit(30_000),
      db.from('pm_projects').select('external_id,title,is_archived,raw,synced_at').eq('source_slug', SOURCE_PM).limit(5_000),
      db.from('pm_boards').select('external_id,project_external_id,title').eq('source_slug', SOURCE_PM).limit(10_000),
      db.from('pm_columns').select('external_id,board_external_id,title,position').eq('source_slug', SOURCE_PM).limit(10_000),
      db.from('pm_tasks').select('external_id,title,project_external_id,board_external_id,column_external_id,assigned_user_external_ids,deadline_at,completed,is_archived,created_at_source,updated_at_source,synced_at,raw').eq('source_slug', SOURCE_PM).limit(30_000),
      db.from('pm_users').select('external_id,name,email,is_active').eq('source_slug', SOURCE_PM).limit(5_000),
      db.from('data_sources').select('slug,status,last_success_at,last_attempt_at,last_error,freshness_minutes').in('slug', [SOURCE_CRM, SOURCE_PM, 'tochka', 'telegram_tasks']).limit(10),
      db.from('management_decisions').select('id,title,hypothesis,decided_at,owner_name,check_deadline,expected_result,metric_name,actual_result,status,next_review_at,related_entity_type,related_entity_external_id').in('status', ['planned', 'in_progress']).limit(1_000),
      db.from('telegram_task_inbox').select('id,status,normalized_title,original_text,error,created_at,processed_at,yougile_task_id,source_url').in('status', ['processing', 'failed']).order('created_at', { ascending: false }).limit(1_000),
      db.from('integration_credentials').select('account_domain').eq('source_slug', SOURCE_CRM).maybeSingle(),
    ]);

    const requiredErrors = [
      leadsResult.error, statusesResult.error, pipelinesResult.error, crmUsersResult.error,
      crmTasksResult.error, crmEventsResult.error, stageEventsResult.error,
      pmProjectsResult.error, pmBoardsResult.error, pmColumnsResult.error,
      pmTasksResult.error, pmUsersResult.error, sourcesResult.error, decisionsResult.error, telegramInboxResult.error,
    ];
    for (const error of requiredErrors) if (error) throw error;

    const leads: any[] = leadsResult.data || [];
    const statuses: any[] = statusesResult.data || [];
    const pipelines: any[] = pipelinesResult.data || [];
    const crmTasks: any[] = crmTasksResult.data || [];
    const crmEvents: any[] = crmEventsResult.data || [];
    const stageEvents: any[] = stageEventsResult.data || [];
    const pmProjects: any[] = pmProjectsResult.data || [];
    const pmBoards: any[] = pmBoardsResult.data || [];
    const pmColumns: any[] = pmColumnsResult.data || [];
    const pmTasks: any[] = pmTasksResult.data || [];
    const decisions: any[] = decisionsResult.data || [];
    const telegramInbox: any[] = telegramInboxResult.data || [];

    const statusMap = new Map<string, any>(statuses.map((status: any) => [key(status.pipeline_external_id, status.external_id), status]));
    const pipelineMap = new Map<number, any>(pipelines.map((pipeline: any) => [Number(pipeline.external_id), pipeline]));
    const crmUserMap = new Map<number, any>((crmUsersResult.data || []).map((user: any) => [Number(user.external_id), user]));
    const pmProjectMap = new Map<string, any>(pmProjects.map((project: any) => [String(project.external_id), project]));
    const pmBoardMap = new Map<string, any>(pmBoards.map((board: any) => [String(board.external_id), board]));
    const pmColumnMap = new Map<string, any>(pmColumns.map((column: any) => [String(column.external_id), column]));
    const pmUserMap = new Map<string, any>((pmUsersResult.data || []).map((user: any) => [String(user.external_id), user]));
    const sourceMap = new Map<string, any>((sourcesResult.data || []).map((source: any) => [source.slug, source]));
    const accountDomain = credentialResult.data?.account_domain || null;

    const stageHistoryByLead = new Map<number, any[]>();
    for (const event of stageEvents) {
      const leadId = Number(event.lead_external_id);
      if (!stageHistoryByLead.has(leadId)) stageHistoryByLead.set(leadId, []);
      stageHistoryByLead.get(leadId)!.push(event);
    }

    const activityByLead = new Map<number, number>();
    for (const event of crmEvents) {
      if (!/lead/.test(norm(event.entity_type))) continue;
      const leadId = Number(event.entity_external_id || 0);
      if (!leadId) continue;
      activityByLead.set(leadId, Math.max(activityByLead.get(leadId) || 0, ms(event.created_at_source)));
    }

    const tasksByLead = new Map<number, any[]>();
    for (const task of crmTasks) {
      const leadId = Number(task.entity_external_id || 0);
      if (!leadId) continue;
      if (!tasksByLead.has(leadId)) tasksByLead.set(leadId, []);
      tasksByLead.get(leadId)!.push(task);
      activityByLead.set(leadId, Math.max(activityByLead.get(leadId) || 0, ms(task.updated_at_source), ms(task.created_at_source)));
    }

    const statusInfo = (lead: any) => statusMap.get(key(lead.pipeline_external_id, lead.status_external_id)) as any;
    const pipelineInfo = (lead: any) => pipelineMap.get(Number(lead.pipeline_external_id)) as any;
    const isApprovalStage = (name: string) => /кп отправ|предложен.*отправ|переговор|согласован/.test(norm(name));
    const isContractStage = (name: string) => /договор|счет|счёт|тз/.test(norm(name));
    const isPaymentStage = (name: string) => /предоплат|постоплат|ожида.*оплат|оплат.*ожида/.test(norm(name));
    const isLateStage = (name: string) => /кп|предлож|переговор|согласован|договор|счет|счёт|предоплат|постоплат|производств/.test(norm(name));
    const isWonStage = (name: string) => /успеш|реализован|выигран|closed won/.test(norm(name));

    const openLeads: any[] = leads.filter((lead: any) => !lead.closed_at_source);
    const pricedDeals = openLeads.map((lead: any) => Number(lead.price || 0)).filter((price: number) => price > 0);
    const bigDealThreshold = Math.max(300_000, percentile(pricedDeals, .75) || 0);

    const currentStageEntry = (lead: any) => {
      const history = stageHistoryByLead.get(Number(lead.external_id)) || [];
      const currentKey = key(lead.pipeline_external_id, lead.status_external_id);
      const entries = history.filter(event => key(event.pipeline_external_id, event.status_external_id) === currentKey);
      if (entries.length) return { at: entries[entries.length - 1].observed_at, estimated: false };
      return { at: lead.updated_at_source || lead.created_at_source || now.toISOString(), estimated: true };
    };

    const dealItems: any[] = openLeads.map((lead: any) => {
      const leadId = Number(lead.external_id);
      const leadTasks = tasksByLead.get(leadId) || [];
      const pending = leadTasks.filter(task => !task.is_completed).sort((a, b) => (ms(a.complete_till) || Number.MAX_SAFE_INTEGER) - (ms(b.complete_till) || Number.MAX_SAFE_INTEGER));
      const nextTask = pending[0] || null;
      const overdueTask = pending.filter(task => ms(task.complete_till) && ms(task.complete_till) < nowMs).sort((a, b) => ms(a.complete_till) - ms(b.complete_till))[0] || null;
      const rawNextAt = timestampFromRaw(lead.raw?.closest_task_at || lead.raw?.next_task_at);
      const stageEntry = currentStageEntry(lead);
      const lastActivityAt = Math.max(ms(lead.updated_at_source), activityByLead.get(leadId) || 0, ms(lead.created_at_source));
      const status = statusInfo(lead);
      const pipeline = pipelineInfo(lead);
      return {
        external_id: leadId,
        name: lead.name || `Сделка #${leadId}`,
        company: lead.name || null,
        contact: contactFromRaw(lead.raw),
        price: Number(lead.price || 0),
        pipeline_external_id: Number(lead.pipeline_external_id || 0),
        pipeline_name: pipeline?.name || null,
        status_external_id: Number(lead.status_external_id || 0),
        stage_name: status?.name || `Этап ${lead.status_external_id}`,
        stage_sort: Number(status?.sort_order || 0),
        responsible_user_name: crmUserMap.get(Number(lead.responsible_user_external_id || 0))?.name || `Пользователь #${lead.responsible_user_external_id || '—'}`,
        created_at: lead.created_at_source,
        last_activity_at: lastActivityAt ? new Date(lastActivityAt).toISOString() : null,
        stale_days: lastActivityAt ? daysSince(lastActivityAt, nowMs) : null,
        entered_stage_at: stageEntry.at,
        stage_days: daysSince(stageEntry.at, nowMs),
        stage_age_estimated: stageEntry.estimated,
        next_step: nextTask?.text || (rawNextAt ? 'Следующая задача в amoCRM' : null),
        next_step_at: nextTask?.complete_till || rawNextAt,
        has_next_step: Boolean(nextTask || rawNextAt),
        overdue_task_days: overdueTask ? daysSince(overdueTask.complete_till, nowMs) : 0,
        overdue_task_text: overdueTask?.text || null,
        external_url: accountDomain ? `https://${accountDomain}/leads/detail/${leadId}` : null,
      };
    });

    const stale14 = dealItems.filter(item => Number(item.stale_days || 0) > 14);
    const stale30 = dealItems.filter(item => Number(item.stale_days || 0) > 30);
    const withoutNextStep = dealItems.filter(item => !item.has_next_step);
    const approvalDeals = dealItems.filter(item => isApprovalStage(item.stage_name));
    const contractDeals = dealItems.filter(item => isContractStage(item.stage_name));
    const paymentStageDeals = dealItems.filter(item => isPaymentStage(item.stage_name));
    const sumDeals = (items: any[]) => items.reduce((sum, item) => sum + Number(item.price || 0), 0);

    const statusesByPipeline = new Map<number, any[]>();
    for (const status of statuses) {
      const pipelineId = Number(status.pipeline_external_id);
      if (!statusesByPipeline.has(pipelineId)) statusesByPipeline.set(pipelineId, []);
      statusesByPipeline.get(pipelineId)!.push(status);
    }
    for (const rows of statusesByPipeline.values()) rows.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

    const dealItemsByStage = new Map<string, any[]>();
    for (const item of dealItems) {
      const stageKey = key(item.pipeline_external_id, item.status_external_id);
      if (!dealItemsByStage.has(stageKey)) dealItemsByStage.set(stageKey, []);
      dealItemsByStage.get(stageKey)!.push(item);
    }

    const funnelHealth: any[] = [];
    for (const [pipelineId, pipelineStatuses] of statusesByPipeline.entries()) {
      for (let index = 0; index < pipelineStatuses.length; index++) {
        const status = pipelineStatuses[index];
        const stageKey = key(pipelineId, status.external_id);
        const nextStatus = pipelineStatuses[index + 1] || null;
        const nextKey = nextStatus ? key(pipelineId, nextStatus.external_id) : null;
        const current = dealItemsByStage.get(stageKey) || [];
        const completedDurations: number[] = [];
        const entrants = new Set<number>();
        const advanced = new Set<number>();

        for (const [leadId, history] of stageHistoryByLead.entries()) {
          for (let eventIndex = 0; eventIndex < history.length; eventIndex++) {
            const event = history[eventIndex];
            if (key(event.pipeline_external_id, event.status_external_id) !== stageKey) continue;
            const nextEvent = history[eventIndex + 1];
            if (nextEvent && ms(nextEvent.observed_at) >= ms(event.observed_at)) {
              completedDurations.push((ms(nextEvent.observed_at) - ms(event.observed_at)) / DAY);
            }
            if (ms(event.observed_at) < conversionFrom) continue;
            entrants.add(leadId);
            if (nextKey && history.slice(eventIndex + 1).some(later => key(later.pipeline_external_id, later.status_external_id) === nextKey)) advanced.add(leadId);
          }
        }

        if (!current.length && !entrants.size) continue;
        const ages = current.map(item => Number(item.stage_days || 0));
        const completedMedian = median(completedDurations);
        const normalDays = completedDurations.length >= 3 ? Math.max(3, Math.round(Number(completedMedian || 0) * 1.5)) : 14;
        const overNorm = current.filter(item => Number(item.stage_days || 0) > normalDays);
        funnelHealth.push({
          id: stageKey,
          pipeline_external_id: pipelineId,
          pipeline_name: pipelineMap.get(pipelineId)?.name || null,
          status_external_id: Number(status.external_id),
          stage_name: status.name,
          sort_order: Number(status.sort_order || 0),
          count: current.length,
          amount: sumDeals(current),
          conversion_to_next: nextKey && entrants.size ? advanced.size / entrants.size : null,
          conversion_sample: entrants.size,
          advanced_count: advanced.size,
          next_stage_name: nextStatus?.name || null,
          average_days: round1(average(ages)),
          median_days: round1(median(ages)),
          normal_days: normalDays,
          over_norm_count: overNorm.length,
          completed_duration_sample: completedDurations.length,
          age_buckets: {
            '0_7': current.filter(item => item.stage_days <= 7).length,
            '8_14': current.filter(item => item.stage_days > 7 && item.stage_days <= 14).length,
            '15_30': current.filter(item => item.stage_days > 14 && item.stage_days <= 30).length,
            '30_plus': current.filter(item => item.stage_days > 30).length,
          },
          deals: [...current].sort((a, b) => Number(b.stage_days || 0) - Number(a.stage_days || 0)),
        });
      }
    }
    funnelHealth.sort((a, b) => String(a.pipeline_name || '').localeCompare(String(b.pipeline_name || ''), 'ru') || a.sort_order - b.sort_order);

    const wonDeals = leads.filter((lead: any) => lead.closed_at_source && isWonStage(statusInfo(lead)?.name || ''));
    const wonCycles = wonDeals
      .map((lead: any) => ms(lead.closed_at_source) && ms(lead.created_at_source) ? (ms(lead.closed_at_source) - ms(lead.created_at_source)) / DAY : null)
      .filter((value: number | null): value is number => value !== null && value >= 0);
    const pricedWon = wonDeals.filter((lead: any) => Number(lead.price || 0) > 0);

    const probability = (stageName: string) => {
      const name = norm(stageName);
      if (/предоплат/.test(name)) return .95;
      if (/договор|счет|счёт/.test(name)) return .75;
      if (/переговор|согласован/.test(name)) return .45;
      if (/кп отправ|предложен.*отправ/.test(name)) return .25;
      return 0;
    };
    const weightedDeals: any[] = dealItems.filter((item: any) => probability(item.stage_name) > 0);
    const weightedRevenue = weightedDeals.reduce((sum: number, item: any) => sum + item.price * probability(item.stage_name), 0);
    const weightedPricedCount = weightedDeals.filter((item: any) => item.price > 0).length;

    const activePmTasks = pmTasks.filter((task: any) => !task.completed && !task.is_archived);
    const activeProjectIds = new Set<string>(activePmTasks.map((task: any) => String(task.project_external_id || '')).filter(Boolean));
    const projectRows: any[] = [];
    for (const projectId of activeProjectIds) {
      const project = pmProjectMap.get(projectId) as any;
      if (project?.is_archived) continue;
      const tasks = activePmTasks.filter((task: any) => String(task.project_external_id || '') === projectId);
      const overdue = tasks.filter((task: any) => ms(task.deadline_at) && ms(task.deadline_at) < nowMs);
      const dueWeek = tasks.filter((task: any) => ms(task.deadline_at) >= nowMs && ms(task.deadline_at) <= nowMs + 7 * DAY);
      const withoutDeadline = tasks.filter((task: any) => !task.deadline_at);
      const withoutAssignee = tasks.filter((task: any) => !(task.assigned_user_external_ids || []).length);
      const newestUpdate = Math.max(...tasks.map((task: any) => ms(task.updated_at_source) || ms(task.created_at_source) || 0), 0);
      const clientMaterialTasks = tasks.filter((task: any) => /ждем.*материал|ожидаем.*материал|материал.*клиент|ждем.*клиент|ожидаем.*клиент/.test(norm(`${task.title} ${pmColumnMap.get(String(task.column_external_id))?.title || ''}`)));
      const clientWaitsTasks = tasks.filter((task: any) => /клиент.*ждет|клиент.*ожида|ожидает.*нас/.test(norm(`${task.title} ${pmColumnMap.get(String(task.column_external_id))?.title || ''}`)));
      const revisionTasks = tasks.filter((task: any) => /правк/.test(norm(`${task.title} ${pmColumnMap.get(String(task.column_external_id))?.title || ''}`)));
      const taskItems = tasks.map((task: any) => ({
        external_id: task.external_id,
        title: task.title || `Задача ${task.external_id}`,
        board_name: pmBoardMap.get(String(task.board_external_id))?.title || null,
        column_name: pmColumnMap.get(String(task.column_external_id))?.title || null,
        deadline_at: task.deadline_at,
        overdue_days: ms(task.deadline_at) && ms(task.deadline_at) < nowMs ? daysSince(task.deadline_at, nowMs) : 0,
        assignees: (task.assigned_user_external_ids || []).map((id: string) => pmUserMap.get(String(id))?.name || pmUserMap.get(String(id))?.email || id),
        updated_at: task.updated_at_source,
      }));
      projectRows.push({
        external_id: projectId,
        name: project?.title || `Проект ${projectId}`,
        active_tasks: tasks.length,
        overdue_tasks: overdue.length,
        due_week_tasks: dueWeek.length,
        without_deadline: withoutDeadline.length,
        without_assignee: withoutAssignee.length,
        no_movement_days: newestUpdate ? daysSince(newestUpdate, nowMs) : null,
        waiting_client_materials: clientMaterialTasks.length,
        client_waits_us: clientWaitsTasks.length,
        tasks_in_revision_columns: revisionTasks.length,
        tasks: taskItems.sort((a, b) => Number(b.overdue_days || 0) - Number(a.overdue_days || 0)),
      });
    }
    projectRows.sort((a, b) => b.overdue_tasks - a.overdue_tasks || b.due_week_tasks - a.due_week_tasks || b.active_tasks - a.active_tasks);

    const todayKey = now.toISOString().slice(0, 10);
    const weekTarget = new Date(nowMs - 7 * DAY);
    const weekWindowStart = new Date(nowMs - 9 * DAY).toISOString().slice(0, 10);
    const weekTargetKey = weekTarget.toISOString().slice(0, 10);
    const snapshotMetrics = {
      open_deals: dealItems.length,
      pipeline_amount: sumDeals(dealItems),
      stalled_14_count: stale14.length,
      stalled_14_ratio: dealItems.length ? stale14.length / dealItems.length : 0,
      stalled_30_count: stale30.length,
      without_next_step: withoutNextStep.length,
      overdue_projects: projectRows.filter(project => project.overdue_tasks > 0).length,
      overdue_project_tasks: projectRows.reduce((sum, project) => sum + project.overdue_tasks, 0),
      weighted_revenue: weightedRevenue,
    };
    const { data: previousSnapshot, error: previousError } = await db
      .from('ceo_metric_snapshots')
      .select('snapshot_date,captured_at,metrics')
      .gte('snapshot_date', weekWindowStart)
      .lte('snapshot_date', weekTargetKey)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousError) throw previousError;

    const sourceFreshness = Object.fromEntries([...sourceMap.entries()].map(([slug, source]: any) => [slug, { status: source.status, last_success_at: source.last_success_at }]));
    const { error: snapshotError } = await db.from('ceo_metric_snapshots').upsert({
      snapshot_date: todayKey,
      captured_at: now.toISOString(),
      metrics: snapshotMetrics,
      source_freshness: sourceFreshness,
    }, { onConflict: 'snapshot_date' });
    if (snapshotError) throw snapshotError;

    const previousMetrics = previousSnapshot?.metrics || null;
    const compare = (metric: string) => {
      const current = Number((snapshotMetrics as any)[metric] || 0);
      if (!previousMetrics || previousMetrics[metric] === undefined || previousMetrics[metric] === null) return { current, previous: null, absolute_change: null, relative_change: null };
      const previous = Number(previousMetrics[metric] || 0);
      return { current, previous, absolute_change: current - previous, relative_change: previous ? (current - previous) / Math.abs(previous) : null };
    };

    const stageNormalMap = new Map(funnelHealth.map(stage => [stage.id, Number(stage.normal_days || 14)]));
    const alerts: any[] = [];
    for (const item of dealItems) {
      const reasons: string[] = [];
      const normalDays = stageNormalMap.get(key(item.pipeline_external_id, item.status_external_id)) || 14;
      if (item.overdue_task_days > 0) reasons.push(`задача просрочена на ${item.overdue_task_days} дн.`);
      if (Number(item.stale_days || 0) > 14) reasons.push(`нет активности ${item.stale_days} дн.`);
      if (!item.has_next_step && (Number(item.stale_days || 0) > 3 || isLateStage(item.stage_name) || item.price >= bigDealThreshold)) reasons.push('не назначен следующий шаг');
      if (item.stage_days > normalDays && Number(item.stale_days || 0) <= 14) reasons.push(`на этапе ${item.stage_days} дн. при норме ${normalDays}`);
      if (!reasons.length) continue;

      const critical = item.overdue_task_days > 0 || Number(item.stale_days || 0) > 30 || (!item.has_next_step && isLateStage(item.stage_name) && item.price > 0);
      const action = item.overdue_task_days > 0
        ? 'Закрыть или переназначить просроченную задачу и зафиксировать результат контакта.'
        : !item.has_next_step
          ? 'Назначить конкретный следующий шаг, владельца и дату контакта.'
          : isLateStage(item.stage_name)
            ? 'Связаться с клиентом и зафиксировать условие перехода на следующий этап.'
            : 'Проверить актуальность сделки: вернуть в работу, сменить этап или закрыть.';
      alerts.push({
        id: `deal-${item.external_id}`,
        severity: critical ? 'critical' : 'risk',
        domain: 'sales',
        title: `Сделка «${item.name}» требует движения`,
        description: reasons.join(' · '),
        object_type: 'Сделка',
        object_name: item.name,
        days: Math.max(Number(item.stale_days || 0), Number(item.stage_days || 0), Number(item.overdue_task_days || 0)),
        owner: item.responsible_user_name,
        amount: item.price || null,
        next_action: action,
        drilldown_key: Number(item.stale_days || 0) > 30 ? 'stalled30' : Number(item.stale_days || 0) > 14 ? 'stalled14' : `stage:${key(item.pipeline_external_id, item.status_external_id)}`,
        external_url: item.external_url,
      });
    }

    for (const project of projectRows) {
      const reasons: string[] = [];
      if (project.overdue_tasks) reasons.push(`${project.overdue_tasks} просроченных задач`);
      if (project.due_week_tasks) reasons.push(`${project.due_week_tasks} дедлайнов в ближайшие 7 дней`);
      if (project.without_assignee) reasons.push(`${project.without_assignee} задач без ответственного`);
      if (Number(project.no_movement_days || 0) > 7) reasons.push(`нет обновлений YouGile ${project.no_movement_days} дн.`);
      if (project.client_waits_us) reasons.push(`клиент ждёт нас: ${project.client_waits_us} задач`);
      if (project.tasks_in_revision_columns >= 3) reasons.push(`${project.tasks_in_revision_columns} задач находятся в колонках правок`);
      if (!reasons.length) continue;
      const critical = project.overdue_tasks > 0 || project.client_waits_us > 0;
      alerts.push({
        id: `project-${project.external_id}`,
        severity: critical ? 'critical' : 'risk',
        domain: 'projects',
        title: `Проект «${project.name}» требует внимания`,
        description: reasons.join(' · '),
        object_type: 'Проект',
        object_name: project.name,
        days: Math.max(Number(project.no_movement_days || 0), ...project.tasks.map((task: any) => Number(task.overdue_days || 0))),
        owner: project.tasks.flatMap((task: any) => task.assignees || [])[0] || 'Не назначен',
        amount: null,
        next_action: project.overdue_tasks
          ? 'Перепланировать просроченные задачи, подтвердить владельца и новый срок.'
          : project.without_assignee
            ? 'Назначить ответственных и проверить реалистичность ближайших дедлайнов.'
            : 'Зафиксировать ближайший результат проекта и действие на эту неделю.',
        drilldown_key: `project:${project.external_id}`,
        external_url: null,
      });
    }

    for (const decision of decisions) {
      const reviewAt = decision.next_review_at || decision.check_deadline;
      if (!reviewAt || ms(reviewAt) >= nowMs) continue;
      const overdueDays = daysSince(reviewAt, nowMs);
      alerts.push({
        id: `decision-${decision.id}`,
        severity: overdueDays > 7 ? 'critical' : 'risk',
        domain: 'decisions',
        title: `Решение «${decision.title}» не проверено в срок`,
        description: `Review просрочен на ${overdueDays} дн. · статус «${decision.status}»`,
        object_type: 'Решение',
        object_name: decision.title,
        days: overdueDays,
        owner: decision.owner_name,
        amount: null,
        next_action: 'Провести review: записать фактический результат, вывод и следующий шаг.',
        drilldown_key: 'decisions',
        external_url: null,
      });
    }

    const failedTelegramTasks = telegramInbox.filter(item => item.status === 'failed');
    const stuckTelegramTasks = telegramInbox.filter(item => item.status === 'processing' && nowMs - ms(item.created_at) > 15 * 60_000);
    if (failedTelegramTasks.length || stuckTelegramTasks.length) {
      const oldest = [...failedTelegramTasks, ...stuckTelegramTasks]
        .sort((a, b) => ms(a.created_at) - ms(b.created_at))[0];
      alerts.push({
        id: 'telegram-task-capture-failures',
        severity: failedTelegramTasks.length ? 'critical' : 'risk',
        domain: 'operations',
        title: `${failedTelegramTasks.length + stuckTelegramTasks.length} задач из Telegram не дошли до YouGile`,
        description: failedTelegramTasks.length
          ? `Ошибок: ${failedTelegramTasks.length}. Последняя: ${failedTelegramTasks[0]?.error || 'без описания'}`
          : `${stuckTelegramTasks.length} задач обрабатываются более 15 минут.`,
        object_type: 'Интеграция',
        object_name: 'Telegram → YouGile',
        days: oldest ? daysSince(oldest.created_at, nowMs) : 0,
        owner: 'Операционный контур',
        amount: null,
        next_action: 'Проверить доступность LLM и ключ YouGile, затем повторить постановку задачи.',
        drilldown_key: 'telegram_task_failures',
        external_url: oldest?.source_url || null,
      });
    }

    if (previousMetrics) {
      const staleChange = compare('stalled_14_ratio');
      if (Number(staleChange.absolute_change || 0) >= .1 && stale14.length >= 2) alerts.push({
        id: 'metric-stalled-ratio', severity: 'risk', domain: 'weekly',
        title: 'Доля зависших сделок заметно выросла',
        description: `${Math.round(Number(staleChange.previous || 0) * 100)}% → ${Math.round(Number(staleChange.current || 0) * 100)}% за неделю`,
        object_type: 'Метрика', object_name: 'Сделки без движения >14 дней', days: 7,
        owner: 'Продажи', amount: sumDeals(stale14),
        next_action: 'Разобрать список зависших сделок и назначить следующую задачу по каждой.',
        drilldown_key: 'stalled14', external_url: null,
      });
      const overdueChange = compare('overdue_project_tasks');
      if (Number(overdueChange.absolute_change || 0) >= 2) alerts.push({
        id: 'metric-project-overdue', severity: 'risk', domain: 'weekly',
        title: 'Просрочек в производстве стало больше',
        description: `${overdueChange.previous} → ${overdueChange.current} просроченных задач за неделю`,
        object_type: 'Метрика', object_name: 'Просроченные задачи проектов', days: 7,
        owner: 'Производство', amount: null,
        next_action: 'Открыть проекты с просрочками и переподтвердить сроки и владельцев.',
        drilldown_key: 'projects_overdue', external_url: null,
      });
    }

    alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || Number(b.amount || 0) - Number(a.amount || 0) || Number(b.days || 0) - Number(a.days || 0));

    const generatedFrom: string[] = [sourceMap.get(SOURCE_CRM)?.last_success_at, sourceMap.get(SOURCE_PM)?.last_success_at].filter(Boolean).sort();
    const dataAsOf = generatedFrom.length ? generatedFrom[0] : now.toISOString();
    const weeklyMetrics = [
      { key: 'open_deals', label: 'Открытые сделки', direction: 'neutral', ...compare('open_deals') },
      { key: 'stalled_14_ratio', label: 'Доля сделок без движения >14 дней', direction: 'down_is_good', format: 'percent', ...compare('stalled_14_ratio') },
      { key: 'pipeline_amount', label: 'Объём открытой воронки', direction: 'up_is_good', format: 'money', ...compare('pipeline_amount') },
      { key: 'weighted_revenue', label: 'Взвешенная поздняя воронка', direction: 'up_is_good', format: 'money', ...compare('weighted_revenue') },
      { key: 'overdue_project_tasks', label: 'Просроченные задачи проектов', direction: 'down_is_good', ...compare('overdue_project_tasks') },
    ];

    const unavailable = [
      { key: 'cash_balance', label: 'Деньги на счетах', reason: 'Точка не подключена: остатков по счетам нет.' },
      { key: 'cash_in_7', label: 'Ожидаемые поступления 7 дней', reason: 'Нет реестра счетов с плановой датой платежа.' },
      { key: 'cash_in_30', label: 'Ожидаемые поступления 30 дней', reason: 'Нет реестра счетов с плановой датой платежа.' },
      { key: 'receivables_overdue', label: 'Просроченная дебиторка', reason: 'Нет связи выставленного счёта, срока оплаты и банковского поступления.' },
      { key: 'cash_out_7_30', label: 'Обязательные выплаты 7 / 30 дней', reason: 'Нет платёжного календаря и банковских операций.' },
      { key: 'paid_revenue_month', label: 'Оплаченная выручка месяца', reason: 'amoCRM хранит бюджет сделки, но не подтверждает факт поступления денег.' },
      { key: 'signed_unpaid', label: 'Подписанные, но не оплаченные сделки', reason: 'Нет структурированных дат подписания, счетов и оплат.' },
      { key: 'client_response_delay', label: 'Клиент давно не получил ответа', reason: 'Не синхронизируется направление писем и сообщений.' },
      { key: 'revision_rounds', label: 'Количество раундов правок', reason: 'YouGile показывает задачи в колонках правок, но не хранит нормализованный счётчик раундов.' },
      { key: 'project_remaining_payment', label: 'Остаток оплаты по активным проектам', reason: 'Нет надёжной связи проекта YouGile со сделкой, графиком и фактом оплат.' },
      { key: 'project_next_stage', label: 'Проекты без согласованного следующего этапа', reason: 'YouGile хранит задачи и колонки, но отдельное обязательное поле «следующий этап проекта» пока не синхронизируется.' },
    ];

    const response = {
      ok: true,
      generated_at: now.toISOString(),
      data_as_of: dataAsOf,
      sources: {
        amocrm: sourceMap.get(SOURCE_CRM) || null,
        yougile: sourceMap.get(SOURCE_PM) || null,
        tochka: sourceMap.get('tochka') || null,
        telegram_tasks: sourceMap.get('telegram_tasks') || null,
      },
      alert_summary: {
        total: alerts.length,
        critical: alerts.filter(alert => alert.severity === 'critical').length,
        risk: alerts.filter(alert => alert.severity === 'risk').length,
        info: alerts.filter(alert => alert.severity === 'info').length,
      },
      alerts: alerts.slice(0, 20),
      sales: {
        summary: {
          open_deals: dealItems.length,
          priced_open_deals: dealItems.filter(item => item.price > 0).length,
          pipeline_amount: sumDeals(dealItems),
          stalled_14_count: stale14.length,
          stalled_14_ratio: dealItems.length ? stale14.length / dealItems.length : 0,
          stalled_14_amount: sumDeals(stale14),
          stalled_30_count: stale30.length,
          stalled_30_amount: sumDeals(stale30),
          without_next_step: withoutNextStep.length,
          approval_amount: sumDeals(approvalDeals),
          contract_invoice_stage_amount: sumDeals(contractDeals),
          payment_stage_amount: sumDeals(paymentStageDeals),
          weighted_revenue: weightedRevenue,
          weighted_revenue_budget_coverage: weightedDeals.length ? weightedPricedCount / weightedDeals.length : 0,
          average_lead_to_win_days: round1(average(wonCycles)),
          lead_to_win_sample: wonCycles.length,
          average_won_check: pricedWon.length ? sumDeals(pricedWon.map((lead: any) => ({ price: lead.price }))) / pricedWon.length : null,
          won_check_sample: pricedWon.length,
          big_deal_threshold: bigDealThreshold,
        },
        comparisons: {
          stalled_14_count: compare('stalled_14_count'),
          stalled_14_ratio: compare('stalled_14_ratio'),
          stalled_30_count: compare('stalled_30_count'),
          pipeline_amount: compare('pipeline_amount'),
        },
        funnel_health: funnelHealth,
        deal_lists: {
          open: dealItems,
          stalled14: stale14,
          stalled30: stale30,
          without_next_step: withoutNextStep,
          approval: approvalDeals,
          contracts: contractDeals,
          payments: paymentStageDeals,
        },
      },
      projects: {
        summary: {
          active_projects: projectRows.length,
          deadline_week: projectRows.filter(project => project.due_week_tasks > 0).length,
          overdue_projects: projectRows.filter(project => project.overdue_tasks > 0).length,
          no_movement: projectRows.filter(project => Number(project.no_movement_days || 0) > 7).length,
          without_assignee: projectRows.filter(project => project.without_assignee > 0).length,
          waiting_client_materials: projectRows.filter(project => project.waiting_client_materials > 0).length,
          client_waits_us: projectRows.filter(project => project.client_waits_us > 0).length,
          tasks_in_revision_columns: projectRows.reduce((sum, project) => sum + project.tasks_in_revision_columns, 0),
          remaining_payment: null,
        },
        items: projectRows,
      },
      cash: {
        weighted_pipeline_revenue: { available: true, value: weightedRevenue, coverage: weightedDeals.length ? weightedPricedCount / weightedDeals.length : 0, source: 'amoCRM · бюджеты сделок × вероятность этапа' },
        payment_stage_pipeline: { available: true, value: sumDeals(paymentStageDeals), coverage: paymentStageDeals.length ? paymentStageDeals.filter(item => item.price > 0).length / paymentStageDeals.length : 0, source: 'amoCRM · сумма бюджетов на этапах оплаты; не факт поступления денег' },
        unavailable,
      },
      weekly: {
        comparison_available: Boolean(previousMetrics),
        previous_snapshot_at: previousSnapshot?.captured_at || null,
        metrics: weeklyMetrics,
      },
      decisions: {
        active: decisions.length,
        overdue: decisions.filter((decision: any) => {
          const reviewAt = decision.next_review_at || decision.check_deadline;
          return reviewAt && ms(reviewAt) < nowMs;
        }).length,
        items: decisions,
      },
      operations: {
        telegram_task_failures: [...failedTelegramTasks, ...stuckTelegramTasks],
      },
      data_quality: {
        unavailable,
        notes: [
          'Контакт показывается только если имя уже есть в raw amoCRM; отдельная синхронизация контактов пока не реализована.',
          'Точный возраст этапа доступен после накопления истории переходов; для старых карточек используется дата обновления с признаком оценки.',
          'Конверсия этапа считается по наблюдаемым переходам последних 90 дней и показывает размер выборки.',
          'Нормальный срок этапа — 1,5 медианы завершённых прохождений при выборке от 3; иначе временный порог 14 дней.',
        ],
      },
    };

    return new Response(JSON.stringify(response), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers });
  }
});
