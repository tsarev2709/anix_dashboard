// Stable chronological keyset uses the matching DB index, including equal timestamps.
export async function readActivityEvents(db,window){
 const rows=[];let at=null,id=null;
 for(let page=0;page<200;page++){
  let q=db.from('crm_events').select('external_id,event_type,entity_external_id,entity_type,created_by_external_id,created_at_source,value_before,value_after').eq('source_slug','amocrm').gte('created_at_source',window.since).lt('created_at_source',window.until).order('created_at_source').order('external_id').limit(1000);
  if(at)q=q.or(`created_at_source.gt.${at},and(created_at_source.eq.${at},external_id.gt.${id})`);
  const {data,error}=await q;if(error)throw Error(`crm_events: ${error.message}`);
  if(!data?.length)return rows;
  rows.push(...data);const last=data.at(-1);at=new Date(last.created_at_source).toISOString();id=last.external_id;
  if(!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('Unsupported activity cursor');
 }
 throw Error('Activity period exceeds 200000 events; choose a shorter period');
}
