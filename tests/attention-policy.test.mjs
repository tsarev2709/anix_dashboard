import test from 'node:test';import assert from 'node:assert/strict';
import {salesAttention,attentionQueue} from '../supabase/functions/_shared/attention-policy.mjs';
import {activityWindow} from '../supabase/functions/_shared/activity-window.mjs';
const now=Date.parse('2026-09-25T09:00:00Z');
test('old cold cards are backlog; late promises and near tasks remain actionable',()=>{
 const old={stage_name:'Новый лид',stale_days:90,overdue_task_days:0};
 assert.equal(salesAttention(old,now).bucket,'backlog');
 assert.equal(salesAttention({...old,next_step_at:'2026-09-26T09:00:00Z',has_next_step:true},now).bucket,'attention');
 assert.equal(salesAttention({...old,stage_name:'Договор',expected_close_date:'2026-09-24'},now).severity,'critical');
 assert.equal(salesAttention({stage_name:'КП отправлено',stale_days:20,has_next_step:true,next_step_at:'2026-10-15'},now).bucket,'monitor');
 assert.equal(salesAttention({stage_name:'Новый',stale_days:null},now).bucket,'monitor');
});
test('queue deduplicates objects, caps 100, exposes overflow including urgent',()=>{
 const alerts=Array.from({length:200},(_,i)=>({id:String(i),severity:i<120?'critical':'risk',priority_score:i}));
 const q=attentionQueue([...alerts,alerts[0]]);assert.equal(q.items.length,100);assert.equal(q.summary.deferred,100);assert.equal(q.summary.deferred_critical,20);assert.equal(q.summary.critical,100);
});
test('activity SQL window covers selected dates plus all summary periods in Moscow',()=>{
 const w=activityWindow({from:'2025-12-01',to:'2025-12-31'},new Date('2026-03-01T21:00:00Z'));
 assert.equal(w.since,'2025-11-30T21:00:00.000Z');assert.equal(w.until,'2026-03-02T21:00:00.000Z');
 assert.throws(()=>activityWindow({from:'2026-02-30',to:'2026-03-01'}),/invalid_period/);
});
