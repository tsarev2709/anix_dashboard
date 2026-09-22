import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrikaReader } from '../supabase/functions/_shared/metrika.mjs';
const body = { totals: [12, 8, 25, 10, 65], query: { date1: '2026-09-16', date2: '2026-09-22' }, data: [{ dimensions: [{ name: 'Поиск' }], metrics: [12] }] };
test('no credential means unavailable, not zero traffic; no upstream call', async () => {
  const r = await createMetrikaReader()({ fetcher: () => assert.fail('unexpected request') });
  assert.equal(r.available, false); assert.equal(r.error, 'not_configured');
});
test('authenticated report uses header only, aggregates unique visitors from totals and caches sanitized results', async () => {
  let calls = 0;
  const read = createMetrikaReader();
  const args = { token: 'test-private-token', now: 1000, fetcher: async (url, options) => {
    calls++; assert.ok(!url.includes('test-private-token'));
    assert.equal(options.headers.Authorization, 'OAuth test-private-token');
    assert.equal(new URL(url).searchParams.get('ids'), '103290769');
    return new Response(JSON.stringify(body));
  } };
  const result = await read(args);
  assert.equal(calls, 3); assert.equal(result.totals.users, 8);
  assert.ok(!JSON.stringify(result).includes(args.token));
  await read({ ...args, now: 1100 }); assert.equal(calls, 3);
  await read({ ...args, now: 301001 }); assert.equal(calls, 6);
});
test('denied and malformed responses cannot appear as valid data or leak upstream details', async () => {
  for (const [response, error] of [[new Response('private details', { status: 403 }), 'access_denied'], [new Response('{}'), 'invalid_response']]) {
    const r = await createMetrikaReader()({ token: 'secret', fetcher: async () => response.clone() });
    assert.equal(r.available, false); assert.equal(r.error, error); assert.ok(!JSON.stringify(r).includes('private'));
  }
});
test('network exception is sanitized', async () => {
  const r = await createMetrikaReader()({ token: 'secret', fetcher: async () => { throw new Error('secret'); } });
  assert.equal(r.error, 'unavailable');
});
