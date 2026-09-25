import test from 'node:test';import assert from 'node:assert/strict';import {readActivityEvents} from '../supabase/functions/_shared/activity-reader.mjs';
test('chronological reader retains timestamp ties across capped pages',async()=>{
 const rows=Array.from({length:1100},(_,i)=>({external_id:String(i).padStart(5,'0'),created_at_source:'2026-09-25T09:00:00.000Z'}));let calls=0;
 const db={from(){let cursor='';return {select(){return this;},eq(){return this;},gte(){return this;},lt(){return this;},order(){return this;},limit(){return this;},or(s){cursor=s.match(/external_id.gt.([0-9]+)/)[1];return this;},then(resolve){calls++;resolve({data:rows.filter(r=>r.external_id>cursor).slice(0,300)});}};}};
 const found=await readActivityEvents(db,{since:'2026-09-01',until:'2026-09-26'});assert.equal(found.length,1100);assert.equal(new Set(found.map(x=>x.external_id)).size,1100);assert.equal(calls,5);
});
