import test from 'node:test';
import assert from 'node:assert/strict';
import {newState} from '../core/model.mjs';
async function load(){let m;try{m=await import('../core/native-updates.mjs');}catch{}assert.equal(typeof m?.createNativeUpdates,'function');return m;}
test('native update preserves queued jobs and waits for critical transitions',async()=>{
 const m=await load(),state=newState();let reloads=0,busy=false;
 const u=m.createNativeUpdates({runtime:{reload:()=>reloads++},getState:async()=>state,isBusy:()=>busy});
 u.available({version:'1.0.0'});state.jobs=[{status:'submitting'}];assert.equal(await u.applyWhenSafe(),false);
 state.jobs=[{status:'preparing'}];assert.equal(await u.applyWhenSafe(),false);
 state.jobs=[{status:'held'}];assert.equal(await u.applyWhenSafe(),false);
 state.jobs=[{status:'queued',text:'saved'}];busy=true;assert.equal(await u.applyWhenSafe(),false);
 busy=false;assert.equal(await u.applyWhenSafe(),true);assert.equal(reloads,1);assert.equal(state.jobs[0].text,'saved');
 await u.applyWhenSafe();assert.equal(reloads,1);
});
test('native update rechecks transient activity after reading durable state',async()=>{
 const m=await load();let busy=false,reloads=0;
 const u=m.createNativeUpdates({runtime:{reload:()=>reloads++},getState:async()=>{busy=true;return newState();},isBusy:()=>busy});
 u.available({version:'1.0.0'});await u.applyWhenSafe();assert.equal(reloads,0);
});
test('reattachment uses existing tabs only, immediate injection and packaged scripts',async()=>{
 const m=await load(),calls=[];
 const api={runtime:{getManifest:()=>({content_scripts:[{js:['core/adapter.js','content.js']}]})},tabs:{query:async()=>[{id:1,url:'https://chatgpt.com/c/a'},{id:2,url:'https://chatgpt.com/c/b',discarded:true}]},scripting:{executeScript:async a=>{calls.push(a);return []}}};
 await m.reattachPages(api);assert.equal(calls.length,1);assert.equal(calls[0].target.tabId,1);assert.equal(calls[0].injectImmediately,true);assert.deepEqual(calls[0].files,['core/adapter.js','content.js']);
});
