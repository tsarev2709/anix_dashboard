import test from 'node:test';
import assert from 'node:assert/strict';
import {timestampMs,daysSince} from '../supabase/functions/_shared/time.mjs';
import {activityLedger} from '../supabase/functions/_shared/activity-ledger.mjs';
const now=new Date('2026-09-24T10:00:00Z');
const e=(id,type,extra={})=>({external_id:id,event_type:type,entity_type:'lead',entity_external_id:10,created_by_external_id:2,created_at_source:'2026-09-23T21:30:00Z',...extra});
const data=events=>({events,users:[{external_id:2,name:'Миша'},{external_id:3,name:'Другой'}],leads:[{external_id:10,name:'Компания',pipeline_external_id:7,responsible_user_external_id:3}],tasks:[],statuses:[],pipelines:[{external_id:7,name:'Продажи'}],account_domain:'example.amocrm.ru'});
test('date regression: milliseconds never fall through to 1970; seconds, ISO and unknown are handled',()=>{
 const at=Date.parse('2026-09-22T10:00:00Z');
 for(const v of [at,String(at),at/1000,String(at/1000),'2026-09-22T10:00:00Z']){assert.equal(timestampMs(v),at);assert.equal(daysSince(v,+now),2);}
 for(const v of [null,undefined,'invalid','',0])assert.equal(daysSince(v,+now),null);
 assert.equal(daysSince(+now+100000,+now),0);
});
test('Moscow midnight and Monday-to-date; actor attribution and separate touches',()=>{
 const d=data([e('a','name_field_changed'),e('b','outgoing_call'),e('c','task_added'),e('d','entity_merged'),e('e','incoming_mail'),e('f','lead_added',{created_by_external_id:0})]);
 const r=activityLedger(d,{manager:2},now);
 assert.equal(r.today.operations,4);assert.equal(r.week.operations,4);assert.equal(r.summary.touches,1);assert.equal(r.system_events,1);
 assert.equal(activityLedger(d,{manager:3},now).summary.operations,0);
 assert.ok(r.actions.every(x=>x.day==='2026-09-24'));assert.equal(r.daily.length,24);
});
test('keeps edits and deletes, deduplicates communication evidence, no fake calls from task text',()=>{
 const d=data([e('a','outgoing_call',{value_after:[{note:{id:90}}]}),e('b','outgoing_call',{value_after:[{note:{id:90}}]}),e('c','contact_deleted',{entity_type:'contact'}),e('d','task_completed',{entity_type:'task',entity_external_id:22})]);
 d.tasks=[{external_id:22,entity_type:'leads',entity_external_id:10,text:'Позвонить',updated_at_source:'2026-09-23T21:30:00Z'}];
 const r=activityLedger(d,{},now);assert.equal(r.summary.operations,3);assert.equal(r.summary.touches,1);assert.equal(r.summary.tasks,1);assert.equal(r.actions.find(x=>x.id==='c').label,'Удалён контакт');
});
test('research is explicit self-report; later edits never reclassify old completions',()=>{
 const d=data([e('a','task_completed',{entity_type:'task',entity_external_id:22})]);d.tasks=[{external_id:22,text:'[Аналитика] Клиент',updated_at_source:'2026-09-23T21:30:00Z'}];
 assert.equal(activityLedger(d,{},now).actions[0].kind,'research');d.tasks[0].updated_at_source='2026-09-24T08:00:00Z';assert.equal(activityLedger(d,{},now).actions[0].kind,'task_completed');
});
test('filters reconcile, unknown pipelines stay unassigned and invalid periods fail',()=>{
 const d=data([e('a','entity_merged'),e('b','outgoing_mail',{entity_type:'contact',entity_external_id:55})]);
 assert.equal(activityLedger(d,{pipeline:7},now).summary.operations,1);const r=activityLedger(d,{kind:'outgoing_mail'},now);assert.equal(r.summary.operations,1);assert.equal(r.daily.reduce((s,x)=>s+x.operations,0),1);assert.equal(r.managers.reduce((s,x)=>s+x.operations,0),1);
 assert.throws(()=>activityLedger(d,{from:'x'},now),/invalid_period/);
});
