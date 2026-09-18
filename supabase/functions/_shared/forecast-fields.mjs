// amoCRM date fields accept Unix seconds or RFC3339. Calendar days use account timezone.
export const normalizeName = value => String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const dateFormatters = new Map();
export function calendarDate(value, timezone = 'Europe/Moscow') {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
  }
  if (typeof value === 'string' && !/^\d+$/.test(value) && !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) * 1000 : value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1970 || date.getUTCFullYear() > 2200) return null;
  let formatter = dateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(timezone, formatter);
  }
  return formatter.format(date);
}
export function resolveCloseField(fields, configuredId = null) {
  const names = new Set(['потенциальная дата сделки', 'плановая дата закрытия', 'ожидаемая дата закрытия', 'дата планируемого закрытия']);
  const candidates = fields.filter(f => names.has(normalizeName(f.name)) || f.code === 'EXPECTED_CLOSE_DATE');
  const selected = configuredId == null ? candidates : fields.filter(f => Number(f.id) === Number(configuredId));
  if (selected.length !== 1) return { id: null, state: selected.length ? 'ambiguous' : 'missing', candidates: candidates.map(f => ({ id: f.id, name: f.name, type: f.type })) };
  if (selected[0].type !== 'date') return { id: null, state: 'wrong_type', candidates: selected.map(f => ({ id: f.id, name: f.name, type: f.type })) };
  return { id: Number(selected[0].id), state: 'ready', candidates: [{ id: selected[0].id, name: selected[0].name, type: selected[0].type }] };
}
export function extractCloseDate(lead, fieldId, timezone) {
  if (!fieldId) return { date: null, invalid: false };
  const values = (lead.custom_fields_values || []).find(f => Number(f.field_id) === Number(fieldId))?.values || [];
  if (!values.length || values[0]?.value == null || values[0]?.value === '') return { date: null, invalid: false };
  const date = values.length === 1 ? calendarDate(values[0].value, timezone) : null;
  return { date, invalid: !date };
}
