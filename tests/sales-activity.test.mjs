import test from 'node:test';
import assert from 'node:assert/strict';
import {salesActivity} from '../supabase/functions/_shared/sales-activity.mjs';
import {approvedPolicy,SIGNING_POLICY,COLD_PIPELINE} from '../supabase/functions/_shared/forecast-policy.mjs';
const event=(id,type,extra={})=>({external_id:id,event_type:type,entity_type:'lead',entity_external_id:10,created_by_external_id:2,created_at_source:'2026-09-21T12:00:00Z',...extra});
const base=()=>({users:[{external_id:2,name:'Seller'},{external_id:3,name:'Owner'}],leads:[{external_id:10,responsible_user_external_id:3,pipeline_external_id:7}],tasks:[],events:[],settings:{timezone:'Europe/Moscow',daily_activity_target:800}});
const run=(data,filters={})=>salesActivity(data,{month:'2026-09',...filters});
test('counts actor, not current owner; deduplicates communication evidence and excludes automation',()=>{
 const d=base();d.events=[event('a','outgoing_call',{value_after:[{note:{id:88}}]}),event('b','outgoing_call',{value_after:[{note:{id:88}}]}),event('c','lead_added'),event('d','name_field_changed'),event('e','outgoing_mail',{created_by_external_id:null})];
 assert.equal(run(d,{manager:2}).total.actions,1);assert.equal(run(d,{manager:3}).total.actions,0);assert.equal(run(d).unknown_actor_events,1);
});
test('completed tasks are counted once by event time, separately from real touches',()=>{
 const d=base();d.tasks=[{external_id:90,entity_type:'leads',entity_external_id:10,text:'Позвонить',updated_at_source:'2026-09-21T12:00:00Z'}];
 d.events=[event('a','task_completed',{entity_type:'task',entity_external_id:90}),event('b','task_completed',{entity_type:'task',entity_external_id:90}),event('c','task_result_added')];
 const r=run(d,{pipeline:7});assert.equal(r.total.completed_tasks,1);assert.equal(r.total.actions,0);
});
test('explicit research tasks count; later text edits cannot reclassify history',()=>{
 const d=base();d.tasks=[{external_id:90,entity_type:'leads',entity_external_id:10,text:'[Поиск контакта] Компания',updated_at_source:'2026-09-21T12:00:00Z'}];d.events=[event('a','task_completed',{entity_type:'task',entity_external_id:90})];
 assert.equal(run(d).total.actions,1);assert.equal(run(d).total.contact_search,1);d.tasks[0].updated_at_source='2026-09-22T00:00:00Z';assert.equal(run(d).total.actions,0);
});
test('pipeline filter excludes unlinked work instead of attributing it to an arbitrary pipeline',()=>{
 const d=base();d.events=[event('a','outgoing_mail',{entity_type:'contact',entity_external_id:300})];assert.equal(run(d).total.actions,1);assert.equal(run(d,{pipeline:7}).total.actions,0);assert.equal(run(d,{pipeline:7}).unattributed_pipeline_events,1);
});
test('approved policy validates live stages and excludes prepayment and production',()=>{
 const stages=[...SIGNING_POLICY.map(([id,name])=>({id,name})),{id:87009210,name:'Предоплата'},{id:87371878,name:'Производство'},{id:87009194,name:'Диалог'}];
 const policy=approvedPolicy([{id:COLD_PIPELINE,_embedded:{statuses:stages}}]);assert.deepEqual(policy.filter(p=>p.forecast_phase==='signing').map(p=>p.manual_override),[.5,.5,.7,.7,.8]);assert.equal(policy.find(p=>p.status_external_id===87009210).forecast_phase,'delivery');assert.throws(()=>approvedPolicy([]),/changed/);
});
import {applySigningSetup} from '../supabase/functions/_shared/signing-setup.ts';
test('CRM setup patches the date requirements, preserves other pipelines and verifies before marking ready',async()=>{
 const fields=[{id:1,name:'Потенциальная дата сделки',type:'date',required_statuses:[{pipeline_id:999,status_id:22}]},{id:2,name:'Формат контракта',type:'select'}];let configured=false,patched=false;
 const db={from(table){return {upsert:async rows=>{assert.equal(rows.filter(r=>r.forecast_phase==='signing').length,5);return {error:null};},update(values){configured=values.contract_setup_state==='ready';return {eq:async()=>({error:null})};}};}};
 const api=async(path,opts)=>{if(path==='/api/v4/leads/pipelines')return {_embedded:{pipelines:[{id:COLD_PIPELINE,_embedded:{statuses:SIGNING_POLICY.map(([id,name])=>({id,name}))}}]}};if(opts?.method==='PATCH'){patched=true;fields[0].required_statuses=JSON.parse(opts.body).required_statuses;return fields[0];}return fields[0];};
 await applySigningSetup(db,api,async()=>fields,{expected_close_field_id:1});assert.equal(configured,true);assert.equal(patched,true);assert.equal(fields[0].required_statuses.length,6);assert.equal(fields[0].required_statuses[0].pipeline_id,999);
});
