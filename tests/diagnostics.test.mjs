import test from 'node:test';import assert from 'node:assert/strict';
import {newState,addJob} from '../core/model.mjs';
const A='11111111-1111-4111-8111-111111111111';
async function load(){let api;try{api=await import('../core/diagnostics.mjs');}catch{}assert.equal(typeof api?.collectDiagnostics,'function','diagnostics implementation missing');return api.collectDiagnostics;}
test('diagnostic report excludes message, draft, file names, tokens and document contents',async()=>{
 const collect=await load(),s=newState();const job=addJob(s,{target:{id:A,url:`https://chatgpt.com/c/${A}`,title:'PRIVATE TITLE'},text:'PRIVATE MESSAGE',doc:{text:'PRIVATE DOCUMENT'},files:[{id:'f',name:'PRIVATE FILE.pdf',size:1}],sourceTabId:4});
 job.attempt={token:'PRIVATE TOKEN',tabId:4,stage:'model',localBackup:{text:'PRIVATE DRAFT'}};
 s.helpers[A]={tabId:4};s.conversations[A].reason='PRIVATE ALERT';
 const io={listTabs:async()=>[{id:4,url:`https://chatgpt.com/c/${A}`,status:'complete'}],getTab:async()=>({status:'complete'}),page:async()=>({ready:true,blocked:'PRIVATE FILE ERROR',route:`https://chatgpt.com/c/${A}`,pathId:A,state:'idle',text:'PRIVATE EDITOR',lastUser:{id:'receipt',text:'PRIVATE USER'},finalId:'final',attachments:{count:1,items:[{label:'PRIVATE LABEL'}]},model:{effort:'max'}})};
 const r=await collect(s,io,'0.5.1');assert.equal(r.version,'0.5.1');assert.equal(r.conversations[0].surface.page.effort,'max');assert.equal(r.conversations[0].surface.page.hasFinal,true);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('one unavailable surface does not remove diagnostic results for the rest',async()=>{
 const collect=await load(),s=newState();s.conversations[A]={id:A,paused:false};s.helpers[A]={tabId:'frame:4:missing'};
 const io={listTabs:async()=>[],getTab:async()=>{throw Error('Frame blocked: PRIVATE FILE.pdf');},page:async()=>{throw Error('Must not run');}};
 const r=await collect(s,io,'0.5.1');assert.equal(r.conversations[0].surface.error,'Frame blocked');assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
