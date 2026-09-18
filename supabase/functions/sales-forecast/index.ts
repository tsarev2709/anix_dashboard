import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { loadForecastData } from '../_shared/forecast-data.ts';
import { buildForecast, stageCatalog, validMonth } from '../_shared/sales-forecast.mjs';
import { calendarDate } from '../_shared/forecast-fields.mjs';
const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://dashboard.anix-ai.pro',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
};
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (!['GET', 'PATCH'].includes(req.method)) return json({ ok: false, error: 'Method not allowed' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth?.user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (auth.user.email?.toLowerCase() !== 'studio@anix-ai.pro') return json({ ok: false, error: 'Forbidden' }, 403);
  try {
    const data = await loadForecastData(db);
    if (req.method === 'PATCH') {
      const body = await req.json();
      const stage = stageCatalog(data).find(s => s.pipeline_external_id === body.pipeline_external_id && s.status_external_id === body.status_external_id && s.outcome === 'open');
      if (!stage || !(body.manual_override === null || (typeof body.manual_override === 'number' && Number.isFinite(body.manual_override) && body.manual_override >= 0 && body.manual_override <= 1)) || typeof body.requires_expected_date !== 'boolean') return json({ ok: false, error: 'Выберите реальную открытую стадию, вероятность 0–100% или пустое значение.' }, 400);
      const { error } = await db.from('crm_stage_probabilities').upsert({ source_slug: 'amocrm', pipeline_external_id: stage.pipeline_external_id, status_external_id: stage.status_external_id, manual_override: body.manual_override, requires_expected_date: body.requires_expected_date, updated_at: new Date().toISOString() }, { onConflict: 'source_slug,pipeline_external_id,status_external_id' });
      if (error) throw error;
      return json({ ok: true });
    }
    const url = new URL(req.url);
    const month = url.searchParams.get('month') || calendarDate(new Date().toISOString(), data.settings.timezone)!.slice(0, 7);
    const manager = Number(url.searchParams.get('manager') || 0), pipeline = Number(url.searchParams.get('pipeline') || 0);
    if (!validMonth(month) || !Number.isSafeInteger(manager) || manager < -1 || !Number.isSafeInteger(pipeline) || pipeline < 0) return json({ ok: false, error: 'Некорректный месяц или фильтр.' }, 400);
    const payload = buildForecast(data, { month, manager, pipeline });
    const history = await db.from('sales_forecast_snapshots').select('snapshot_date,captured_at,fact_amount,weighted_forecast_amount,potential_pipeline_amount,expected_deals_count').eq('source_slug', 'amocrm').eq('forecast_month', `${month}-01`).eq('manager_external_id', manager).eq('pipeline_external_id', pipeline).order('snapshot_date');
    if (history.error) throw history.error;
    return json({ ...payload, snapshots: history.data || [] });
  } catch (error) {
    console.error('sales-forecast failed', error instanceof Error ? error.message : 'database error');
    return json({ ok: false, error: 'Не удалось получить прогноз. Проверьте миграцию и синхронизацию amoCRM.' }, 500);
  }
});
