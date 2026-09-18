import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, resolveCloseField, extractCloseDate } from '../supabase/functions/_shared/forecast-fields.mjs';
import { buildForecast, stageProbabilities, validMonth } from '../supabase/functions/_shared/sales-forecast.mjs';
const now = new Date('2026-09-18T12:00:00Z');
const lead = (id, overrides = {}) => ({ external_id: id, name: `Deal ${id}`, price: 1000, pipeline_external_id: 10, status_external_id: 700, responsible_user_external_id: 3, expected_close_date: '2026-09-25', created_at_source: '2026-08-01T00:00:00Z', updated_at_source: '2026-09-15T00:00:00Z', ...overrides });
const fixture = () => ({
  leads: [lead(1), lead(2, { status_external_id: 142, closed_at_source: '2026-09-05T10:00:00Z', price: 2000 }), lead(3, { status_external_id: 143, closed_at_source: '2026-09-07T10:00:00Z', price: 500 }), lead(4, { expected_close_date: '2026-10-02' })],
  pipelines: [{ external_id: 10, name: 'Sales', raw: { _embedded: { statuses: [{ id: 700, name: 'Offer', sort: 20 }, { id: 701, name: 'Talk', sort: 10 }, { id: 142, name: 'Won' }, { id: 143, name: 'Lost' }] } } }],
  users: [{ external_id: 3, name: 'Alice' }], tasks: [], events: [], stages: [], lossReasons: [],
  probabilities: [{ pipeline_external_id: 10, status_external_id: 700, manual_override: .7, requires_expected_date: true }],
  settings: { timezone: 'Europe/Moscow', min_sample_size: 30, observed_enabled: false, field_state: { state: 'ready' } },
  source: { status: 'healthy', last_success_at: now.toISOString() }, account_domain: 'studioanixaipro.amocrm.ru',
});
const forecast = data => buildForecast(data, { month: '2026-09', now });
test('separates actual, weighted, nominal; excludes lost and other months', () => {
  const p = forecast(fixture()); assert.equal(p.actual.amount, 2000); assert.equal(p.forecast.weighted_forecast_amount, 700); assert.equal(p.forecast.potential_pipeline_amount, 1000); assert.equal(p.actual.lost_count, 1); assert.equal(p.actual.closed_win_rate, .5); assert.deepEqual(p.deals.map(l => l.id), [1]);
});
test('missing probability gives unknown total, not zero or fabricated probability', () => {
  const data = fixture(); data.probabilities = [];
  const p = forecast(data); assert.equal(p.forecast.weighted_forecast_amount, null); assert.equal(p.forecast.unweighted_amount, 1000);
});
test('missing date field makes forecast unavailable even with no expected deals', () => {
  const data = fixture(); data.settings.field_state.state = 'missing'; data.leads = data.leads.map(l => ({ ...l, expected_close_date: null }));
  assert.equal(forecast(data).forecast.weighted_forecast_amount, null);
});
test('zero probability is valid, not unconfigured', () => {
  const data = fixture(); data.probabilities[0].manual_override = 0; assert.equal(forecast(data).forecast.weighted_forecast_amount, 0);
});
test('month boundary uses business timezone and not browser/UTC timezone', () => {
  const data = fixture(); data.leads = [lead(1, { status_external_id: 142, closed_at_source: '2026-08-31T21:30:00Z' }), lead(2, { status_external_id: 142, closed_at_source: '2026-09-30T21:30:00Z' })];
  assert.equal(forecast(data).actual.amount, 1000);
});
test('discipline covers current open deals across all months; excludes closed', () => {
  const data = fixture(); data.leads[0].expected_close_date = '2026-09-17'; data.leads[3].expected_close_date = null;
  const p = forecast(data); assert.equal(p.discipline.overdue_close_date, 1); assert.equal(p.discipline.required_without_date, 1); assert.equal(p.discipline.without_next_step, 2);
});
test('only pending lead tasks are next steps; contact tasks must not collide', () => {
  const data = fixture(); data.tasks = [{ entity_type: 'contacts', entity_external_id: 1, is_completed: false, complete_till: '2026-09-20T00:00:00Z' }, { entity_type: 'leads', entity_external_id: 1, is_completed: true, complete_till: '2026-09-17T00:00:00Z' }];
  assert.equal(forecast(data).deals[0].has_next_step, false);
  data.tasks.push({ entity_type: 'leads', entity_external_id: 1, is_completed: false, text: 'Call', complete_till: '2026-09-17T00:00:00Z' });
  const l = forecast(data).deals[0]; assert.equal(l.has_next_step, true); assert.equal(l.overdue_tasks, 1);
});
test('manager and pipeline filters and group totals reconcile', () => {
  const data = fixture(); data.leads.push(lead(5, { responsible_user_external_id: 4 }));
  const p = forecast(data); assert.equal(p.by_manager.reduce((s, m) => s + m.potential_pipeline_amount, 0), p.forecast.potential_pipeline_amount);
  assert.equal(buildForecast(data, { month: '2026-09', manager: 4, now }).deals.length, 1);
  assert.equal(buildForecast(data, { month: '2026-09', pipeline: 99, now }).deals.length, 0);
});
test('stage observations count distinct resolved deals, not repeated visits or open leads', () => {
  const data = fixture();
  data.stages = [1, 2, 2, 3].map(id => ({ lead_external_id: id, pipeline_external_id: 10, status_external_id: 700, observed_at: '2026-08-20T00:00:00Z' }));
  const s = stageProbabilities(data)[0]; assert.equal(s.sample_size, 2); assert.equal(s.observed_probability, .5); assert.equal(s.probability, .7);
  data.probabilities = []; data.settings.observed_enabled = true;
  assert.equal(stageProbabilities(data)[0].probability, null);
  data.settings.min_sample_size = 2; assert.equal(stageProbabilities(data)[0].probability, .5);
});
test('probability override > observed > fallback and pipeline-specific IDs', () => {
  const data = fixture(); data.probabilities[0].manual_override = null; data.probabilities[0].fallback_probability = .3;
  assert.equal(stageProbabilities(data)[0].probability_source, 'fallback');
  data.probabilities[0].pipeline_external_id = 20; assert.equal(stageProbabilities(data)[0].probability, null);
});
test('stage aging starts at latest reentry, not first-ever visit', () => {
  const data = fixture(); data.stages = [ ['2026-08-01', 700], ['2026-09-01', 701], ['2026-09-15', 700] ].map(([d, s]) => ({ lead_external_id: 1, pipeline_external_id: 10, status_external_id: s, observed_at: `${d}T12:00:00Z` }));
  assert.equal(forecast(data).deals[0].stage_age_days, 3);
});
test('unassigned is a distinct manager filter and unknown domains never produce links', () => {
  const data = fixture(); data.leads[0].responsible_user_external_id = null; data.account_domain = 'evil.example/path';
  const p = buildForecast(data, { month: '2026-09', manager: -1, now }); assert.equal(p.deals.length, 1); assert.equal(p.deals[0].url, null);
});
test('reports CRM events by selected lead and business date', () => {
  const data = fixture(); data.events = [ { entity_type: 'lead', entity_external_id: 1, created_at_source: '2026-08-31T21:05:00Z' }, { entity_type: 'task', entity_external_id: 1, created_at_source: '2026-09-05T00:00:00Z' } ];
  const p = forecast(data); assert.equal(p.actual.crm_events_count, 1); assert.deepEqual(p.by_day, [{ date: '2026-09-01', count: 1 }]);
});
test('empty pipeline is valid and cannot produce NaN', () => {
  const data = fixture(); data.leads = [];
  const p = forecast(data); assert.equal(p.forecast.weighted_forecast_amount, 0); assert.equal(p.actual.average_won_days, null); assert.equal(p.quality.date_coverage, null);
});
test('field selection rejects duplicate matches, wrong types and unknown configured ID', () => {
  const fields = [{ id: 42, name: 'Потенциальная дата сделки', type: 'date' }];
  assert.equal(resolveCloseField(fields).id, 42);
  fields.push({ id: 43, name: 'Ожидаемая дата закрытия', type: 'date' });
  assert.equal(resolveCloseField(fields).state, 'ambiguous'); assert.equal(resolveCloseField(fields, 43).id, 43);
  assert.equal(resolveCloseField(fields, 99).state, 'missing'); fields[0].type = 'text'; assert.equal(resolveCloseField(fields, 42).state, 'wrong_type');
});
test('date normalization preserves business dates and rejects invalid dates', () => {
  assert.equal(calendarDate('2026-09-25'), '2026-09-25'); assert.equal(calendarDate('2026-08-31T21:00:00Z'), '2026-09-01');
  assert.equal(calendarDate(Date.parse('2026-08-31T21:00:00Z') / 1000), '2026-09-01');
  for (const value of ['', null, 0, 'n/a', '2026-02-30']) assert.equal(calendarDate(value), null);
  const data = { custom_fields_values: [{ field_id: 42, values: [{ value: 'bad' }] }] };
  assert.deepEqual(extractCloseDate(data, 42, 'Europe/Moscow'), { date: null, invalid: true });
  assert.deepEqual(extractCloseDate(data, 43, 'Europe/Moscow'), { date: null, invalid: false });
});
test('rejects malformed month', () => { for (const month of ['2026-00', '2026-13', '26-01', '2026-09-01', '2026-9']) assert.equal(validMonth(month), false); });
test('lightweight daily snapshots match full report totals and coverage in every scope', () => {
  const data = fixture();
  data.leads.push(lead(5, { responsible_user_external_id: null, price: 12.35, status_external_id: 701 }), lead(6, { pipeline_external_id: 20, expected_close_date: null }));
  data.tasks = [{ entity_type: 'leads', entity_external_id: 1, is_completed: false }];
  data.events = [{ entity_type: 'lead', entity_external_id: 1, created_at_source: '2026-09-18T01:00:00Z' }];
  data.stages = [{ lead_external_id: 2, pipeline_external_id: 10, status_external_id: 700, observed_at: '2026-08-20T00:00:00Z' }];
  for (const fieldState of ['ready', 'missing']) {
    data.settings.field_state.state = fieldState;
    const probabilities = stageProbabilities(data);
    for (const month of ['2026-09', '2026-10']) for (const manager of [0, -1, 3]) for (const pipeline of [0, 10, 20, 99]) {
      const options = { month, manager, pipeline, now };
      const full = buildForecast(data, options);
      const snapshot = buildForecast({ ...data, events: [] }, { ...options, snapshot: true }, probabilities);
      assert.deepEqual(snapshot.forecast, full.forecast);
      assert.deepEqual(snapshot.quality, full.quality);
      assert.equal(snapshot.actual.amount, full.actual.amount);
      assert.equal(snapshot.actual.open_deals_count, full.actual.open_deals_count);
      assert.equal(snapshot.deals.length, full.deals.length);
    }
  }
});
