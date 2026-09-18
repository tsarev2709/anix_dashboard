import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCloseField } from '../supabase/functions/_shared/forecast-setup.mjs';
const field = { id: 987, name: 'Потенциальная дата сделки', type: 'date' };
test('existing close-date field is reused without claiming or creating', async () => {
  const r = await ensureCloseField({ listFields: async () => [field], createField: () => assert.fail('duplicate'), claimCreation: () => assert.fail('unnecessary claim') });
  assert.equal(r.id, 987); assert.equal(r.created, false);
});
test('new field is created once and verified; unrelated date remains', async () => {
  const fields = [{ id: 12, name: 'срок', type: 'date' }]; let posts = 0;
  const r = await ensureCloseField({ listFields: async () => fields, claimCreation: async () => true, createField: async input => { posts++; assert.deepEqual(input, { name: 'Потенциальная дата сделки', type: 'date', code: 'EXPECTED_CLOSE_DATE' }); fields.push(field); } });
  assert.equal(posts, 1); assert.equal(fields.length, 2); assert.equal(r.created, true);
});
test('creation claim prevents concurrent duplicates', async () => {
  await assert.rejects(ensureCloseField({ listFields: async () => [], claimCreation: async () => false, createField: () => assert.fail('duplicate') }), /already running/);
});
test('ambiguous field or stale explicit mapping never creates another field', async () => {
  for (const options of [{ listFields: async () => [field, { ...field, id: 988 }] }, { listFields: async () => [], configuredId: 999 }]) {
    await assert.rejects(ensureCloseField({ ...options, claimCreation: () => assert.fail('claim'), createField: () => assert.fail('duplicate') }), /manual review/);
  }
});
test('field appearing after first read is reused after the claim', async () => {
  let reads = 0;
  const r = await ensureCloseField({ listFields: async () => ++reads === 1 ? [] : [field], claimCreation: async () => true, createField: () => assert.fail('duplicate') });
  assert.equal(r.created, false);
});
