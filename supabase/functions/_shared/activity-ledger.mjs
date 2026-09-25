import { moscowDay, timestampMs, DAY } from './time.mjs';
export const activityLabels = {
 outgoing_call:'Исходящий звонок', incoming_call:'Входящий звонок', outgoing_mail:'Отправлено письмо', incoming_mail:'Получено письмо', outgoing_chat_message:'Отправлено сообщение', incoming_chat_message:'Получено сообщение', outgoing_sms:'Отправлено SMS', incoming_sms:'Получено SMS',
 lead_added:'Создана сделка', contact_added:'Создан контакт', company_added:'Создана компания', lead_deleted:'Удалена сделка', contact_deleted:'Удалён контакт', company_deleted:'Удалена компания', entity_merged:'Объединены дубли', lead_restored:'Восстановлена сделка', contact_restored:'Восстановлен контакт', company_restored:'Восстановлена компания',
 lead_status_changed:'Изменён этап сделки', task_added:'Поставлена задача', task_completed:'Завершена задача', task_deleted:'Удалена задача', task_text_changed:'Изменён текст задачи', task_type_changed:'Изменён тип задачи', task_deadline_changed:'Перенесён срок задачи', task_result_added:'Добавлен результат задачи',
 name_field_changed:'Изменено название', sale_field_changed:'Изменён бюджет', custom_field_value_changed:'Изменено поле карточки', entity_responsible_changed:'Изменён ответственный', entity_tag_added:'Добавлен тег', entity_tag_deleted:'Удалён тег', common_note_added:'Добавлено примечание', common_note_deleted:'Удалено примечание', attachment_note_added:'Добавлен файл', entity_direct_message:'Внутренний комментарий', entity_linked:'Добавлена связь', entity_unlinked:'Удалена связь', contact_linked:'Привязан контакт', contact_unlinked:'Отвязан контакт', company_linked:'Привязана компания', company_unlinked:'Отвязана компания', lead_linked:'Привязана сделка', lead_unlinked:'Отвязана сделка',
 contact_search:'Поиск контакта — задача завершена', research:'Аналитика — задача завершена', duplicate_cleanup:'Удаление дубля — задача завершена'
};
const touches = new Set(['outgoing_call','outgoing_mail','outgoing_chat_message','outgoing_sms']);
const selfReports = [['[поиск контакта]','contact_search'],['[анализ компании]','research'],['[анализ сегмента]','research'],['[аналитика]','research'],['[удаление дубля]','duplicate_cleanup']];
const entityLabels = { lead:'Сделка', leads:'Сделка', contact:'Контакт', company:'Компания', task:'Задача', customer:'Покупатель' };
export function activityLedger(data, filters = {}, now = new Date()) {
 const today = moscowDay(now), dayStart = Date.parse(today+'T00:00:00+03:00');
 const week = moscowDay(dayStart - ((new Date(dayStart+3*3600000).getUTCDay()+6)%7)*DAY);
 const from = filters.from || today.slice(0,7)+'-01', to = filters.to || today;
 if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || from>to || Date.parse(to)-Date.parse(from)>366*DAY) throw new Error('invalid_period');
 const users = new Map(data.users.map(x=>[Number(x.external_id),x]));
 const leads = new Map(data.leads.map(x=>[Number(x.external_id),x]));
 const tasks = new Map(data.tasks.map(x=>[Number(x.external_id),x]));
 const pipelines = new Map(data.pipelines.map(x=>[Number(x.external_id),x.name]));
 const statuses = new Map(data.statuses.map(x=>[Number(x.external_id),x.name]));
 const seen = new Set(); const all = [];
 const renderValue = v => JSON.stringify(v ?? []);
 for (const e of data.events) {
  if (!timestampMs(e.created_at_source)) continue;
  const proof = e.value_after?.[0];
  const evidence = proof?.message?.id || proof?.note?.id || proof?.mail?.id;
  const identity = evidence && touches.has(e.event_type) ? `${e.event_type}:${evidence}` : String(e.external_id);
  if(seen.has(identity)) continue; seen.add(identity);
  const task = e.entity_type==='task' ? tasks.get(Number(e.entity_external_id)) : null;
  const leadId = ['lead','leads'].includes(e.entity_type) ? Number(e.entity_external_id) : ['lead','leads'].includes(task?.entity_type) ? Number(task.entity_external_id) : null;
  const lead = leads.get(leadId);
  const actor = Number(e.created_by_external_id || 0), known = users.has(actor);
  let kind = e.event_type;
  const stableTask = task && timestampMs(task.updated_at_source) <= timestampMs(e.created_at_source);
  if (kind==='task_completed' && stableTask) kind = selfReports.find(([tag])=>String(task.text||'').trim().toLowerCase().startsWith(tag))?.[1] || kind;
  const system = !known || /^(incoming_|robot_|site_visit_|service_note_|intent_)/.test(kind);
  const entityName = lead?.name || e.raw?._embedded?.entity?.name || e.raw?.lead_name || `${entityLabels[e.entity_type]||e.entity_type} #${e.entity_external_id}`;
  const route = leadId ? `leads/detail/${leadId}` : e.entity_type==='contact' ? `contacts/detail/${e.entity_external_id}` : e.entity_type==='company' ? `companies/detail/${e.entity_external_id}` : null;
  const domain = /^[a-z0-9.-]+$/i.test(data.account_domain||'') ? data.account_domain : null;
  let detail = '';
  if(e.event_type==='lead_status_changed') {
    const before=e.value_before?.[0]?.lead_status, after=e.value_after?.[0]?.lead_status;
    detail=`${statuses.get(Number(before?.id))||before?.id||'—'} → ${statuses.get(Number(after?.id))||after?.id||'—'}`;
  }
  all.push({id:String(e.external_id),at:e.created_at_source,day:moscowDay(e.created_at_source),kind,event_type:e.event_type,label:activityLabels[kind]||kind,user_id:actor,user_name:users.get(actor)?.name||'Система / автор не определён',human:!system,touch:!system&&touches.has(kind),
   entity_id:e.entity_external_id,entity_type:e.entity_type,entity_name:entityName,lead_id:leadId,pipeline_id:lead?.pipeline_external_id||null,pipeline_name:pipelines.get(Number(lead?.pipeline_external_id))||null,
   url:domain&&route?`https://${domain}/${route}`:null,detail,task_text:task?.text||null,task_text_is_current:!stableTask,result:stableTask?task?.result_text||null:null,before:renderValue(e.value_before),after:renderValue(e.value_after),evidence:selfReports.some(([,k])=>k===kind)?'Отчёт сотрудника в задаче':'Событие amoCRM'});
 }
 all.sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
 const manager = Number(filters.manager||0), pipeline=Number(filters.pipeline||0);
 const scoped=all.filter(a=>(!manager||a.user_id===manager)&&(!pipeline||Number(a.pipeline_id)===pipeline));
 const selected=scoped.filter(a=>a.day>=from&&a.day<=to&&(!filters.kind||a.kind===filters.kind)&&(!filters.search||`${a.entity_name} ${a.task_text||''} ${a.detail} ${a.label}`.toLowerCase().includes(filters.search.toLowerCase()))&&(filters.system==='1'||a.human));
 const count=xs=>({operations:xs.filter(x=>x.human).length,touches:xs.filter(x=>x.touch).length,tasks:xs.filter(x=>x.event_type==='task_completed'&&x.human).length,entities:new Set(xs.filter(x=>x.human).map(x=>`${x.entity_type}:${x.entity_id}`)).size});
 const daysMap=new Map(),usersMap=new Map();
 for(const action of selected){if(!daysMap.has(action.day))daysMap.set(action.day,[]);daysMap.get(action.day).push(action);if(!usersMap.has(action.user_id))usersMap.set(action.user_id,[]);usersMap.get(action.user_id).push(action);}
 const daily=[];
 for(let ms=Date.parse(from+'T00:00:00+03:00');ms<=Date.parse(to+'T00:00:00+03:00');ms+=DAY){const date=moscowDay(ms);daily.push({date,...count(daysMap.get(date)||[])});}
 const managers=[...users.values()].map(u=>({id:u.external_id,name:u.name,...count(usersMap.get(Number(u.external_id))||[])}));
 const by_kind=Object.entries(selected.reduce((m,a)=>(m[a.kind]=(m[a.kind]||0)+1,m),{})).map(([kind,count])=>({kind,label:activityLabels[kind]||kind,count})).sort((a,b)=>b.count-a.count);
 return {from,to,timezone:'Europe/Moscow',summary:count(selected),today:count(scoped.filter(x=>x.day===today)),week:count(scoped.filter(x=>x.day>=week&&x.day<=today)),month:count(scoped.filter(x=>x.day>=today.slice(0,7)+'-01'&&x.day<=today)),daily,managers,by_kind,actions:selected,
 system_events:scoped.filter(x=>x.day>=from&&x.day<=to&&!x.human).length,available_from:all.at(-1)?.day||null,
 filters:{users:data.users.map(u=>({id:u.external_id,name:u.name})),pipelines:data.pipelines.map(p=>({id:p.external_id,name:p.name})),kinds:[...new Set(all.map(x=>x.kind))].map(kind=>({kind,label:activityLabels[kind]||kind}))}};
}
