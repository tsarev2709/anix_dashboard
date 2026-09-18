import { resolveCloseField } from './forecast-fields.mjs';
// Narrow setup operation. No lead values or unrelated CRM fields are modified.
export async function ensureCloseField({ listFields, createField, claimCreation, configuredId = null }) {
  let resolved = resolveCloseField(await listFields(), configuredId);
  if (resolved.state === 'ready') return { ...resolved, created: false };
  if (resolved.state !== 'missing' || configuredId != null) throw new Error('Date field needs manual review');
  if (!await claimCreation()) throw new Error('Date field setup is already running or needs review');
  // Recheck after acquiring the single-owner creation claim.
  resolved = resolveCloseField(await listFields());
  if (resolved.state === 'ready') return { ...resolved, created: false };
  if (resolved.state !== 'missing') throw new Error('Date field became ambiguous');
  await createField({ name: 'Потенциальная дата сделки', type: 'date', code: 'EXPECTED_CLOSE_DATE' });
  resolved = resolveCloseField(await listFields());
  if (resolved.state !== 'ready') throw new Error('Date field creation could not be verified');
  return { ...resolved, created: true };
}
