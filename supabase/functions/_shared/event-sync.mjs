// Fixed time bounds keep pagination stable while a large interval spans several runs.
export async function syncEventWindow({api,save,checkpoint,window,budget=20}) {
 let page=window.page||1,count=0;
 for(let n=0;n<budget;n++,page++) {
  const body=await api(`/api/v4/events?limit=100&page=${page}&filter[created_at][from]=${window.from}&filter[created_at][to]=${window.to}&with=lead_name,contact_name,company_name`);
  const events=body?._embedded?.events||[];
  if(events.length) await save(events);
  count+=events.length;
  const complete=!events.length||!body?._links?.next;
  await checkpoint(complete?null:{...window,page:page+1});
  if(complete)return {complete:true,count};
 }
 return {complete:false,count};
}
