import { buildForecast, stageProbabilities } from './sales-forecast.mjs';
import { calendarDate } from './forecast-fields.mjs';

// Keyset pagination avoids silently truncating at PostgREST's default 1,000 rows.
export async function readAll(db: any, table: string, columns: string, order = 'external_id') {
  const rows: any[] = [];
  let cursor: any = null;
  for (let page = 0; page < 200; page++) {
    let query = db.from(table).select(columns).eq('source_slug', 'amocrm').order(order).limit(1000);
    if (cursor !== null) query = query.gt(order, cursor);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) return rows;
    rows.push(...data);
    cursor = data[data.length - 1][order];
  }
  throw new Error(`${table}: pagination limit reached; refusing incomplete forecast`);
}
export async function loadForecastData(db: any, snapshot = false) {
  const [leads, pipelines, users, tasks, events, stages, lossReasons, config, source, account] = await Promise.all([
    readAll(db, 'crm_leads', 'external_id,name,price,pipeline_external_id,status_external_id,responsible_user_external_id,created_at_source,updated_at_source,closed_at_source,loss_reason_external_id,expected_close_date,expected_close_date_invalid'),
    readAll(db, 'crm_pipelines', 'external_id,name,raw'),
    readAll(db, 'crm_users', 'external_id,name'),
    readAll(db, 'crm_tasks', 'external_id,entity_external_id,entity_type,responsible_user_external_id,text,is_completed,complete_till,created_at_source,updated_at_source'),
    snapshot ? Promise.resolve([]) : readAll(db, 'crm_events', 'external_id,event_type,entity_external_id,entity_type,created_by_external_id,created_at_source'),
    readAll(db, 'crm_lead_stage_events', 'id,lead_external_id,pipeline_external_id,status_external_id,observed_at', 'id'),
    readAll(db, 'crm_loss_reasons', 'external_id,name'),
    db.from('crm_forecast_settings').select('*').eq('source_slug', 'amocrm').single(),
    db.from('data_sources').select('status,last_success_at,last_attempt_at').eq('slug', 'amocrm').single(),
    db.from('integration_credentials').select('account_domain').eq('source_slug', 'amocrm').single(),
  ]);
  for (const result of [config, source, account]) if (result.error) throw result.error;
  // Each pipeline has at most 100 stages; fetch the config by pipeline to avoid API row caps.
  const probabilities: any[] = [];
  for (const p of pipelines) {
    const result = await db.from('crm_stage_probabilities').select('*').eq('source_slug', 'amocrm').eq('pipeline_external_id', p.external_id);
    if (result.error) throw result.error;
    probabilities.push(...(result.data || []));
  }
  return { leads, pipelines, users, tasks, events, stages, lossReasons, settings: config.data, probabilities, source: source.data, account_domain: account.data?.account_domain };
}
export async function captureForecastSnapshots(db: any, now = new Date()) {
  const { data: settings, error: settingsError } = await db.from('crm_forecast_settings').select('timezone,last_snapshot_date').eq('source_slug', 'amocrm').single();
  if (settingsError) throw settingsError;
  const snapshotDate = calendarDate(now.toISOString(), settings.timezone)!;
  if (settings.last_snapshot_date === snapshotDate) return 0;
  const data = await loadForecastData(db, true);
  const probabilities = stageProbabilities(data);
  const currentMonth = snapshotDate.slice(0, 7);
  const months = new Set([currentMonth, ...data.leads.filter(l => l.expected_close_date && l.expected_close_date.slice(0, 7) >= currentMonth).map(l => l.expected_close_date.slice(0, 7))]);
  const scopes = new Map<string, { manager: number; pipeline: number }>();
  scopes.set('0:0', { manager: 0, pipeline: 0 });
  for (const lead of data.leads) {
    const manager = Number(lead.responsible_user_external_id) || -1, pipeline = Number(lead.pipeline_external_id) || 0;
    for (const scope of [{ manager, pipeline: 0 }, { manager: 0, pipeline }, { manager, pipeline }]) scopes.set(`${scope.manager}:${scope.pipeline}`, scope);
  }
  let written = 0;
  for (const month of months) {
    const rows = [...scopes.values()].map(scope => {
      const result = buildForecast(data, { month, ...scope, now, snapshot: true }, probabilities);
      return { source_slug: 'amocrm', snapshot_date: snapshotDate, forecast_month: `${month}-01`,
        manager_external_id: scope.manager, pipeline_external_id: scope.pipeline, captured_at: now.toISOString(),
        fact_amount: result.actual.amount, weighted_forecast_amount: result.forecast.weighted_forecast_amount,
        potential_pipeline_amount: result.forecast.potential_pipeline_amount, open_deals_count: result.actual.open_deals_count,
        expected_deals_count: result.deals.length, raw_metrics: { forecast: result.forecast, quality: result.quality, field_state: data.settings.field_state, model_version: 1 } };
    });
    // First successful sync of each day is immutable. Reruns cannot revise past forecasts.
    const { error } = await db.from('sales_forecast_snapshots').upsert(rows, { onConflict: 'source_slug,snapshot_date,forecast_month,manager_external_id,pipeline_external_id', ignoreDuplicates: true });
    if (error) throw error;
    written += rows.length;
  }
  // Mark complete only after every month/scope succeeds. Partial failures retry safely.
  const { error: completionError } = await db.from('crm_forecast_settings').update({ last_snapshot_date: snapshotDate }).eq('source_slug', 'amocrm');
  if (completionError) throw completionError;
  return written;
}
