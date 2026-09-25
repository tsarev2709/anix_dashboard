import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readAll } from '../_shared/forecast-data.ts';
import { activityWindow } from '../_shared/activity-window.mjs';
import { activityLedger } from '../_shared/activity-ledger.mjs';
const headers = { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers});
Deno.serve(async req => {
 if(req.method==='OPTIONS') return new Response('ok',{headers});
 try {
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token) return json({ok:false,error:'authentication_required'},401);
  const {data:auth,error}=await db.auth.getUser(token);
  if(error||!auth.user) return json({ok:false,error:'invalid_session'},401);
  const {data:profile}=await db.from('admin_profiles').select('role').eq('user_id',auth.user.id).maybeSingle();
  if(!profile?.role&&auth.user.email?.toLowerCase()!=='studio@anix-ai.pro') return json({ok:false,error:'access_denied'},403);
  const params=Object.fromEntries(new URL(req.url).searchParams);
  const window=activityWindow(params);
  const eventScope=(query: any)=>query.gte('created_at_source',window.since).lt('created_at_source',window.until);
  const [events,tasks,leads,users,pipelines,statuses,account,source,coverage]=await Promise.all([
   readAll(db,'crm_events','external_id,event_type,entity_external_id,entity_type,created_by_external_id,created_at_source,value_before,value_after','external_id','amocrm',eventScope),
   readAll(db,'crm_tasks','external_id,entity_external_id,entity_type,text,result_text,updated_at_source'),
   readAll(db,'crm_leads','external_id,name,pipeline_external_id'),readAll(db,'crm_users','external_id,name'),readAll(db,'crm_pipelines','external_id,name'),readAll(db,'crm_statuses','external_id,name'),
   db.from('integration_credentials').select('account_domain').eq('source_slug','amocrm').single(),
   db.from('data_sources').select('status,last_success_at,last_error').eq('slug','amocrm').single(),
   db.from('crm_activity_sync_state').select('history_from,backfilled_from,live_from,live_covered_through,live_progress,history_progress,updated_at').eq('source_slug','amocrm').maybeSingle()
  ]);
  if(account.error||source.error||coverage.error) throw new Error('Не удалось проверить полноту источника');
  const report=activityLedger({events,tasks,leads,users,pipelines,statuses,account_domain:account.data?.account_domain},params);
  const page=Math.max(1,Number(params.page)||1), size=100, total=report.actions.length;
  const actions=params.export==='1'?report.actions:report.actions.slice((page-1)*size,page*size);
  return json({ok:true,...report,actions,total,page,page_size:size,source:source.data,coverage:coverage.data,generated_at:new Date().toISOString()});
 } catch(e) {return json({ok:false,error:String(e)},String(e).includes('invalid_period')?400:500);}
});
