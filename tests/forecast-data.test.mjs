import test from 'node:test';
import assert from 'node:assert/strict';
import { readAll, captureForecastSnapshots } from '../supabase/functions/_shared/forecast-data.ts';
test('database pagination survives a server row cap lower than requested limit', async () => {
  const rows = Array.from({ length: 1003 }, (_, i) => ({ external_id: i + 1 }));
  let requests = 0;
  const db = { from() {
    let cursor = 0;
    const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, gt(_field, value) { cursor = value; return this; }, then(resolve) { requests++; resolve({ data: rows.filter(r => r.external_id > cursor).slice(0, 300), error: null }); } };
    return query;
  } };
  const result = await readAll(db, 'crm_leads', 'external_id');
  assert.equal(result.length, 1003); assert.equal(requests, 5); assert.equal(new Set(result.map(r => r.external_id)).size, 1003);
});
test('database failure never returns a partial forecast as success', async () => {
  const db = { from() { return { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, then(resolve) { resolve({ data: null, error: { message: 'unavailable' } }); } }; } };
  await assert.rejects(readAll(db, 'crm_leads', 'external_id'), /crm_leads: unavailable/);
});

test('completed daily snapshots skip loading the CRM history again', async () => {
  let reads = 0;
  const db = { from(table) {
    reads++;
    assert.equal(table, 'crm_forecast_settings');
    return { select() { return this; }, eq() { return this; }, single() { return Promise.resolve({ data: { timezone: 'Europe/Moscow', last_snapshot_date: '2026-09-19' }, error: null }); } };
  } };
  assert.equal(await captureForecastSnapshots(db, new Date('2026-09-18T21:01:00Z')), 0);
  assert.equal(reads, 1);
});
