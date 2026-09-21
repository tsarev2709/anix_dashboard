import { approvedPolicy, COLD_PIPELINE, CONTRACT_FIELD, resolveContractField } from './forecast-policy.mjs';
export async function applySigningSetup(db: any, api: any, listFields: any, settings: any) {
  const pipelineResponse = await api('/api/v4/leads/pipelines');
  const policy = approvedPolicy(pipelineResponse?._embedded?.pipelines || []);
  const fields = await listFields();
  const dateField = fields.find(f => Number(f.id) === Number(settings.expected_close_field_id));
  if (!dateField || dateField.type !== 'date') throw new Error('Сначала подключите поле потенциальной даты.');
  let format = resolveContractField(fields);
  if (!format) {
    const claim = await db.from('crm_forecast_settings').update({contract_setup_state:'creating'}).eq('source_slug','amocrm').eq('contract_setup_state','not_started').select('source_slug').maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) throw new Error('Создание поля формата уже начато. Требуется проверка метаданных.');
    format = resolveContractField(await listFields());
    if (!format) await api('/api/v4/leads/custom_fields', {method:'POST',body:JSON.stringify([CONTRACT_FIELD])});
    format = resolveContractField(await listFields());
    if (!format) throw new Error('Contract field creation not verified');
  }
  // Preserve requirements in other pipelines. Configure verified stages only.
  const required = [...(dateField.required_statuses || []).filter(r => Number(r.pipeline_id) !== COLD_PIPELINE),
    ...policy.filter(r => r.forecast_phase === 'signing' || r.forecast_phase === 'delivery').map(r => ({pipeline_id:r.pipeline_external_id,status_id:r.status_external_id}))];
  await api(`/api/v4/leads/custom_fields/${dateField.id}`, {method:'PATCH',body:JSON.stringify({name:dateField.name,required_statuses:required})});
  const verified = await api(`/api/v4/leads/custom_fields/${dateField.id}`);
  if (required.some(r => !(verified.required_statuses || []).some(v => v.pipeline_id === r.pipeline_id && v.status_id === r.status_id))) throw new Error('Required date stages not verified');
  const saved = await db.from('crm_stage_probabilities').upsert(policy,{onConflict:'source_slug,pipeline_external_id,status_external_id'});
  if (saved.error) throw saved.error;
  const ready = await db.from('crm_forecast_settings').update({contract_setup_state:'ready',contract_format_field_id:format.id,signing_policy_applied_at:new Date().toISOString(),daily_activity_target:800}).eq('source_slug','amocrm');
  if (ready.error) throw ready.error;
  return {ok:true,format_field_id:format.id,required_statuses:required,stages:policy.length};
}
