// Approved signing policy. IDs below were verified against amoCRM metadata.
export const SIGNING_POLICY = [
  [87371870, 'Встреча проведена (SQL)', .5],
  [87224226, 'Готовим ПКП/ТКП', .5],
  [87713698, 'ПКП/ТКП отправлено', .7],
  [87371874, 'Согласование условий', .7],
  [87009206, 'Договор / Счёт', .8],
];
export const COLD_PIPELINE = 11078430;
export const DELIVERY_STAGES = [87009210, 87371878, 87009214];
export function approvedPolicy(pipelines) {
  const pipeline = pipelines.find(p => Number(p.id ?? p.external_id) === COLD_PIPELINE);
  const stages = pipeline?._embedded?.statuses || pipeline?.raw?._embedded?.statuses || [];
  for (const [id, name] of SIGNING_POLICY) {
    if (!stages.some(s => Number(s.id) === id && s.name === name)) throw new Error('Signing stages changed in amoCRM; review mapping');
  }
  return stages.filter(s => ![142, 143].includes(Number(s.id))).map(s => {
    const approved = SIGNING_POLICY.find(([id]) => id === Number(s.id));
    return { source_slug: 'amocrm', pipeline_external_id: COLD_PIPELINE, status_external_id: Number(s.id),
      forecast_phase: approved ? 'signing' : DELIVERY_STAGES.includes(Number(s.id)) ? 'delivery' : 'excluded',
      manual_override: approved?.[2] ?? null, requires_expected_date: Boolean(approved), updated_at: new Date().toISOString() };
  });
}
export const CONTRACT_FIELD = { name: 'Формат контракта', code: 'ANIX_CONTRACT_FORMAT', type: 'select', enums: [
  { value: 'Разовый проект', sort: 10 }, { value: 'Регулярный ежемесячный', sort: 20 }, { value: 'Рамочный / нерегулярный', sort: 30 },
] };
export function resolveContractField(fields) {
  const matches = fields.filter(f => f.code === CONTRACT_FIELD.code || f.name?.trim().toLowerCase() === CONTRACT_FIELD.name.toLowerCase());
  if (matches.length > 1 || (matches.length === 1 && matches[0].type !== 'select')) throw new Error('Contract format field needs manual review');
  return matches[0] || null;
}
export function contractFormat(lead, fieldId) {
  if (!fieldId) return null;
  const values = lead.custom_fields_values?.find(f => Number(f.field_id) === Number(fieldId))?.values;
  return values?.length === 1 ? String(values[0].value || '') || null : null;
}
