// Public tender discoveries enter amoCRM through the Dashboard's existing OAuth.
// No procurement site credentials or paid feed are required for this intake step.
const PIPELINE_ID = 11380854;
const NEW_STATUS_ID = 89173342;

type FieldKind = 'text' | 'textarea' | 'url' | 'numeric' | 'date_time';
type FieldSpec = { source: string; name: string; type: FieldKind };
const FIELD_SPECS: FieldSpec[] = [
  { source: 'source_key', name: 'Тендер · ключ', type: 'text' },
  { source: 'platform', name: 'Тендер · площадка', type: 'text' },
  { source: 'url', name: 'Тендер · ссылка', type: 'url' },
  { source: 'nmck', name: 'Тендер · НМЦК', type: 'numeric' },
  { source: 'deadline', name: 'Тендер · дедлайн', type: 'date_time' },
  { source: 'law', name: 'Тендер · закон', type: 'text' },
  { source: 'procedure', name: 'Тендер · процедура', type: 'text' },
  { source: 'customer', name: 'Тендер · заказчик', type: 'text' },
  { source: 'bid_security_cash', name: 'Тендер · обеспечение заявки', type: 'numeric' },
  { source: 'performance_security_cash', name: 'Тендер · обеспечение контракта', type: 'numeric' },
  { source: 'advance_pct', name: 'Тендер · аванс, %', type: 'numeric' },
  { source: 'payment_days', name: 'Тендер · оплата, дней', type: 'numeric' },
  { source: 'scope', name: 'Тендер · объём работ', type: 'textarea' },
  { source: 'experience_requirements', name: 'Тендер · требование опыта', type: 'textarea' },
  { source: 'revisions', name: 'Тендер · правки', type: 'textarea' },
  { source: 'ip_terms', name: 'Тендер · права IP', type: 'textarea' },
  { source: 'ai_terms', name: 'Тендер · ограничения AI', type: 'textarea' },
  { source: 'direct_cost_estimate', name: 'Тендер · себестоимость, оценка', type: 'numeric' },
  { source: 'cash_gap_estimate', name: 'Тендер · кассовый разрыв, оценка', type: 'numeric' },
  { source: 'project_margin_pct', name: 'Тендер · маржа проекта, %', type: 'numeric' },
  { source: 'risk_score', name: 'Тендер · риск, 0–100', type: 'numeric' },
  { source: 'decision', name: 'Тендер · решение', type: 'text' },
  { source: 'missing', name: 'Тендер · недостающие данные', type: 'textarea' },
];

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function validHttps(value: unknown): boolean {
  try { return typeof value === 'string' && new URL(value).protocol === 'https:'; }
  catch { return false; }
}

function fieldValues(candidate: Record<string, unknown>, fields: Map<string, number>) {
  const values = [];
  for (const spec of FIELD_SPECS) {
    let value: unknown = candidate[spec.source];
    if (value === null || value === undefined || value === '') continue;
    if (spec.source === 'missing' && Array.isArray(value)) value = value.join('; ');
    if (spec.type === 'numeric') value = numeric(value);
    if (spec.type === 'date_time') value = timestamp(value);
    if (spec.type === 'url' && !validHttps(value)) value = null;
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string') value = value.slice(0, spec.type === 'textarea' ? 3500 : 250);
    values.push({ field_id: fields.get(spec.name), values: [{ value }] });
  }
  return values;
}

async function findExisting(api: (path: string, options?: RequestInit) => Promise<any>, key: string, keyFieldId: number) {
  const result = await api(`/api/v4/leads?query=${encodeURIComponent(key)}&limit=250`);
  for (const lead of result?._embedded?.leads || []) {
    if (Number(lead.pipeline_id) !== PIPELINE_ID) continue;
    if ((lead.custom_fields_values || []).some((field: any) =>
      Number(field.field_id) === keyFieldId && (field.values || []).some((v: any) => v.value === key))) return Number(lead.id);
    if (String(lead.name || '').startsWith(`[Тендер ${key}]`)) return Number(lead.id);
  }
  return null;
}

export async function processTenderInbox(db: any, api: (path: string, options?: RequestInit) => Promise<any>, customFields: any[]) {
  const result = { read: 0, created: 0, updated: 0, expired: 0, failed: 0, fieldsCreated: 0 };
  const { data: rows, error: readError } = await db.from('tender_inbox')
    .select('source_key,payload,attempts').in('status', ['pending', 'error'])
    .lt('attempts', 3).order('created_at', { ascending: true }).limit(20);
  if (readError) throw readError;
  if (!rows?.length) return result;
  result.read = rows.length;

  const fieldIds = new Map<string, number>((customFields || []).map((f: any) => [f.name, Number(f.id)]));
  const missingFields = FIELD_SPECS.filter(f => !fieldIds.has(f.name));
  if (missingFields.length) {
    const response = await api('/api/v4/leads/custom_fields', {
      method: 'POST', body: JSON.stringify(missingFields.map(f => ({ name: f.name, type: f.type }))),
    });
    for (const f of response?._embedded?.custom_fields || []) fieldIds.set(f.name, Number(f.id));
    result.fieldsCreated = missingFields.length;
  }
  if (FIELD_SPECS.some(f => !fieldIds.has(f.name))) throw new Error('Tender custom fields were not created in amoCRM');

  for (const row of rows) {
    const candidate: Record<string, unknown> = { ...row.payload, source_key: row.source_key };
    const deadline = timestamp(candidate.deadline);
    try {
      if (!deadline || deadline <= Math.floor(Date.now() / 1000)) {
        const { error } = await db.from('tender_inbox').update({ status: 'expired', processed_at: new Date().toISOString() }).eq('source_key', row.source_key);
        if (error) throw error;
        result.expired++;
        continue;
      }
      if (typeof candidate.title !== 'string' || !candidate.title.trim() || !validHttps(candidate.url))
        throw new Error('Candidate requires a title and an HTTPS source URL');
      const leadPayload = {
        name: `[Тендер ${row.source_key}] ${candidate.title}`.slice(0, 250),
        pipeline_id: PIPELINE_ID,
        price: Math.round(numeric(candidate.bid_price) ?? 0),
        custom_fields_values: fieldValues(candidate, fieldIds),
      };
      const existingId = await findExisting(api, row.source_key, fieldIds.get('Тендер · ключ')!);
      let leadId: number;
      if (existingId) {
        await api(`/api/v4/leads/${existingId}`, { method: 'PATCH', body: JSON.stringify(leadPayload) });
        leadId = existingId;
        result.updated++;
      } else {
        const created = await api('/api/v4/leads', { method: 'POST', body: JSON.stringify([{ ...leadPayload, status_id: NEW_STATUS_ID }]) });
        leadId = Number(created?._embedded?.leads?.[0]?.id);
        if (!Number.isInteger(leadId) || leadId <= 0) throw new Error('amoCRM did not return a lead ID');
        const note = 'ANIX Tender OS — предварительный отбор. Отсутствующие условия требуют проверки ТЗ.\n' +
          JSON.stringify(candidate, null, 2).slice(0, 13000);
        await api(`/api/v4/leads/${leadId}/notes`, {
          method: 'POST', body: JSON.stringify([{ note_type: 'common', params: { text: note } }]),
        });
        result.created++;
      }
      const { error } = await db.from('tender_inbox').update({ status: 'processed', amo_lead_id: leadId,
        processed_at: new Date().toISOString(), last_error: null }).eq('source_key', row.source_key);
      if (error) throw error;
    } catch (error) {
      result.failed++;
      await db.from('tender_inbox').update({ status: 'error', attempts: row.attempts + 1,
        last_error: String(error).slice(0, 1000) }).eq('source_key', row.source_key);
    }
  }
  return result;
}

