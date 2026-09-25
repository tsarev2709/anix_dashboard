import test from 'node:test';import assert from 'node:assert/strict';import {syncEventWindow} from '../supabase/functions/_shared/event-sync.mjs';
test('large intervals resume exactly after persisted pages with fixed bounds',async()=>{
 let progress={from:1,to:2,page:1},saved=[];const api=async path=>{const page=Number(new URL('https://x'+path).searchParams.get('page'));return {_embedded:{events:[{id:page}]},_links:page<105?{next:{}}:{}};};
 const args={api,save:async rows=>saved.push(...rows.map(x=>x.id)),checkpoint:async next=>{progress=next;},budget:20};
 let r=await syncEventWindow({...args,window:progress});assert.equal(r.complete,false);assert.equal(progress.page,21);
 while(progress)r=await syncEventWindow({...args,window:progress});assert.equal(saved.length,105);assert.equal(new Set(saved).size,105);assert.equal(r.complete,true);
});
test('failed writes do not advance the checkpoint',async()=>{let changed=false;await assert.rejects(syncEventWindow({api:async()=>({_embedded:{events:[{id:1}]}}),save:async()=>{throw Error('write failure');},checkpoint:async()=>{changed=true;},window:{from:1,to:2,page:1}}));assert.equal(changed,false);});
