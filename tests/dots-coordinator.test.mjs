import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,addJob,targetFromURL,markPreparing,markSubmitting,ACK_TIMEOUT_REASON} from '../core/model.mjs';
import {createCoordinator} from '../core/coordinator.mjs';
const KEY='11111111-1111-4111-8111-111111111111~22222222222242228222222222222222',url='https://chatgpt.com/dots/'+KEY;
const MAIN='dot:'+KEY+':main',REPLY='dot:'+KEY+':reply:33333333333343338333333333333333~33333333333343338333333333333333~CalpicoMessage~Sentinel_44444444444444448444444444444444';
function setup(){let s=newState(),time=10000,chain=Promise.resolve();const sends=[],frames=[],reads=[],pages=new Map(),tabs=[];
 const page=(id,dest)=>{pages.set(id,{ready:true,route:url,pathId:dest,state:'busy',blocked:'',text:'Keep draft',attachments:{count:0,unsupported:false},model:{},options:[],lastUser:{id:'before-'+id,text:'Before'},finalId:'final-'+id});tabs.push({id,url,status:'complete'});};page(1,MAIN);page(2,REPLY);
 const store={getState:async()=>structuredClone(s),changeState:fn=>{const p=chain.then(()=>{const copy=structuredClone(s),result=fn(copy);s=copy;return {state:structuredClone(copy),result:structuredClone(result)};});chain=p.catch(()=>{});return p;},deleteFile:async()=>{}};
 const io={now:()=>time,changed:async()=>{},listTabs:async()=>tabs,getTab:async id=>tabs.find(t=>t.id===id),ensureBackground:async()=>{frames.push(true);return null;},page:async(id,a)=>{const p=pages.get(id);if(a.cmd==='inspect'){reads.push({id,...a});if(p.inspectionError)throw Error('Inspection unavailable');}if(a.cmd==='localSend'){assert.equal(a.conversationId,p.pathId);sends.push({tab:id,dest:p.pathId,text:a.text});p.state='busy';p.lastUser={id:'sent-'+sends.length,text:a.text,files:[]};return {clicked:true,restored:true};}if(a.cmd==='capture')return {...structuredClone(p),doc:null};return structuredClone(p);}};
 const c=createCoordinator({store,io});return {c,pages,tabs,sends,frames,reads,get state(){return s;},add(dest=MAIN){return addJob(s,{target:targetFromURL(url,dest),text:'Queued',files:[],sourceTabId:1});},async ticks(n=12){for(let i=0;i<n;i++){await c.tick();time+=2000;}}};}
test('dot queued work uses the matching live thread even when the source tab shows another',async()=>{const x=setup();x.add(REPLY);x.pages.get(1).state='idle';x.pages.get(2).state='idle';await x.ticks();assert.deepEqual(x.sends,[{tab:2,dest:REPLY,text:'Queued'}]);assert.equal(x.frames.length,0);});
test('an existing dot helper that switched threads does not pin the queue away from another valid tab',async()=>{const x=setup();x.add();await x.ticks(2);assert.equal(x.state.helpers[MAIN].tabId,1);x.pages.get(1).pathId=REPLY;x.pages.get(2).pathId=MAIN;x.pages.get(1).state=x.pages.get(2).state='idle';await x.ticks();assert.deepEqual(x.sends,[{tab:2,dest:MAIN,text:'Queued'}]);assert.equal(x.frames.length,0);});
test('closing the dot keeps pending work and never creates any fallback surface',async()=>{const x=setup();x.add();x.tabs.length=0;await x.ticks();assert.equal(x.sends.length,0);assert.equal(x.state.jobs.length,1);assert.equal(x.frames.length,0);});
test('unknown dot activity never starts preparation',async()=>{const x=setup();x.add();x.pages.get(1).state='unknown';await x.ticks();assert.equal(x.sends.length,0);assert.equal(x.state.jobs[0].status,'queued');});

// A URL is insufficient to recover a dispatched attempt: main and Replies share it.
for(const status of ['submitting','uncertain'])for(const unavailable of ['other-thread','missing-editor','frozen','inspection-error']){
 test(`recover ${status} receipt from another tab when original is ${unavailable}`,async()=>{
  const x=setup(),j=x.add(),cid=j.conversationId;
  markPreparing(x.state,j.id,1,x.pages.get(1),10000);markSubmitting(x.state,j.id,10000);
  if(status==='uncertain'){j.status=status;j.reason=ACK_TIMEOUT_REASON;x.state.conversations[cid].paused=true;x.state.conversations[cid].reason=ACK_TIMEOUT_REASON;}
  const original=structuredClone(j.attempt);
  x.state.helpers[cid]={tabId:1,conversationId:cid,jobId:j.id,url,owned:false};
  const p=x.pages.get(1);
  if(unavailable==='other-thread')p.pathId=REPLY;
  if(unavailable==='missing-editor')p.ready=false;
  if(unavailable==='frozen')x.tabs[0].frozen=true;
  if(unavailable==='inspection-error')p.inspectionError=true;
  const receipt={id:'already-delivered',text:j.text,files:[]};
  Object.assign(x.pages.get(2),{pathId:MAIN,state:'busy',lastUser:receipt,submittedUser:receipt,receiptAnchorFound:true,receiptAnchorAmbiguous:false,receiptUserCount:2});
  await x.ticks(3);
  assert.equal(x.state.jobs.length,0,'a verified receipt removes the original attempt');
  assert.equal(x.state.history.length,1);assert.equal(x.state.helpers[cid].tabId,2);
  assert.equal(x.state.conversations[cid].waiting.receiptId,receipt.id);
  assert.equal(x.state.conversations[cid].paused,false);
  assert.deepEqual(j.attempt,original,'never replace the original attempt or baseline');
  assert.ok(x.reads.some(r=>r.id===2&&r.receiptAfter===original.beforeUser));
  assert.equal(x.sends.length,0,'recovery must never send again');assert.equal(x.frames.length,0);
 });
}
test('dispatched dot attempt without another matching scope remains untouched',async()=>{
 const x=setup(),j=x.add();markPreparing(x.state,j.id,1,x.pages.get(1),10000);markSubmitting(x.state,j.id,10000);
 x.pages.get(1).pathId=REPLY;const before=structuredClone(j);
 await x.ticks(3);assert.deepEqual(x.state.jobs[0],before);assert.equal(x.sends.length,0);assert.equal(x.frames.length,0);
});
test('recovery in another dot tab preserves a manual pause',async()=>{
 const x=setup(),j=x.add();markPreparing(x.state,j.id,1,x.pages.get(1),10000);markSubmitting(x.state,j.id,10000);
 j.status='uncertain';j.reason=ACK_TIMEOUT_REASON;x.state.conversations[MAIN].paused=true;x.state.conversations[MAIN].reason='Pausa manual';
 x.pages.get(1).pathId=REPLY;const receipt={id:'delivered',text:j.text,files:[]};
 Object.assign(x.pages.get(2),{pathId:MAIN,lastUser:receipt,submittedUser:receipt,receiptAnchorFound:true});
 await x.ticks(3);assert.equal(x.state.jobs.length,0);assert.equal(x.state.conversations[MAIN].paused,true);assert.equal(x.state.conversations[MAIN].reason,'Pausa manual');assert.equal(x.sends.length,0);
});
