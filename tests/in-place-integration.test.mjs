/* Production coordinator + production MAIN adapter on the lightweight DOM fixture.
   Browser/storage/network boundaries are simulated. This is not a live ChatGPT test. */
import test from 'node:test';import assert from 'node:assert/strict';
import {dom} from './dom-harness.mjs';
import {newState,addJob} from '../core/model.mjs';import {createCoordinator} from '../core/coordinator.mjs';
const A='11111111-1111-4111-8111-111111111111';
const html=`<html><body><main>
<div data-user-message-bubble="true" data-message-id="old"><span data-message-text="">antes</span><span id="receipt-file"></span></div>
<form data-chatgpt-composer="" data-composer-placement="thread">
<div data-composer-attachments="" hidden=""><div id="card"><span>proof.pdf</span><button aria-label="Remove proof.pdf"></button></div></div>
<div data-composer-markdown="" contenteditable="true" class="ProseMirror" role="textbox"><p>mi borrador sin terminar</p></div><button aria-label="Send"></button></form>
</main></body></html>`;
function fixture(){
 const x=dom(html),d=x.document,e=d.querySelector('[data-composer-markdown]'),p=e.querySelector('p'),form=d.querySelector('form'),area=d.querySelector('[data-composer-attachments]');
 const selection={from:3,to:3,constructor:{create:(_d,from,to)=>({from,to})}},doc={content:{size:p.textContent.length},textBetween:()=>p.textContent,toJSON:()=>({text:p.textContent})};
 const schema={nodes:{paragraph:{create:(_a,t)=>t||''}},text:t=>t,nodeFromJSON:d=>({content:[d.text]})};
 const tr={replaceWith(_a,_b,c){this.content=c;return this;},setMeta(){return this;},setSelection(s){this.selection=s;return this;}};
 e.pmViewDesc={view:{dom:e,state:{doc,schema,selection,tr},dispatch(t){p.textContent=t.content.join('\n');doc.content.size=p.textContent.length;}}};
 const sent=[];let serial=0;
 d.querySelector('[aria-label="Remove proof.pdf"]').click=()=>area.setAttribute('hidden','');
 d.querySelector('[aria-label="Send"]').click=function(){
  sent.push({text:p.textContent,files:area.hasAttribute('hidden')?[]:['proof.pdf']});
  d.querySelector('[data-user-message-bubble]').setAttribute('data-message-id','sent-'+(++serial));
  d.querySelector('[data-message-text]').textContent=p.textContent;
  if(!area.hasAttribute('hidden'))d.querySelector('#receipt-file').setAttribute('data-file-name','proof.pdf');
  p.textContent='';area.setAttribute('hidden','');this.setAttribute('aria-label','Stop');
 };
 let state=newState(),time=10000;const removed=[];
 const store={getState:async()=>structuredClone(state),changeState:async fn=>{const result=fn(state);state.revision++;return {result:structuredClone(result),state:structuredClone(state)};},deleteFile:async id=>removed.push(id)};
 const tab={id:4,url:`https://chatgpt.com/c/${A}`,status:'complete',active:false};
 const io={now:()=>time,changed:async()=>{},getTab:async()=>tab,listTabs:async()=>[tab],page:async(_id,a)=>x.page(a),sendTab:async(_id,m)=>{
  if(m.type==='UPLOAD'){area.removeAttribute('hidden');await c.uploadResult(m.jobId,m.token);}
  return {ok:true};
 }};
 const c=createCoordinator({store,io});
 const add=(files=[])=>addJob(state,{target:{id:A,url:tab.url},text:'texto encolado',doc:{text:'texto encolado'},files,sourceTabId:4,model:null,options:[]},time);
 return {x,p,e,form,area,io,c,store,removed,sent,add,get s(){return state;},async steps(n=14){for(let i=0;i<n;i++){await c.tick();time+=2000;}}};
}
test('full text path uses original tab and restores its existing draft',async()=>{
 const f=fixture();f.add();await f.steps();assert.deepEqual(f.sent,[{text:'texto encolado',files:[]}]);assert.equal(f.p.textContent,'mi borrador sin terminar');assert.equal(f.s.jobs.length,0);assert.equal(Object.keys(f.s.draftBackups).length,0);assert.equal(f.form.hasAttribute('data-cq-reservation'),false);
});
test('full attachment path sends matching files and restores the original nonempty draft',async()=>{
 const f=fixture();f.add([{id:'file-1',name:'proof.pdf',type:'application/pdf',size:10}]);await f.steps(20);
 assert.deepEqual(f.sent,[{text:'texto encolado',files:['proof.pdf']}]);assert.equal(f.p.textContent,'mi borrador sin terminar');assert.equal(f.s.jobs.length,0);assert.ok(f.removed.includes('file-1'));assert.equal(Object.keys(f.s.draftBackups).length,0);assert.equal(f.form.hasAttribute('data-cq-reservation'),false);
});
test('clear while files are staged restores the original draft, removes only queue files, and sends nothing',async()=>{
 const f=fixture();f.add([{id:'file-1',name:'proof.pdf',type:'application/pdf',size:10}]);
 for(let n=0;n<15&&f.area.hasAttribute('hidden');n++)await f.steps(1);
 assert.equal(f.area.hasAttribute('hidden'),false);await f.c.clear();await f.steps();
 assert.equal(f.sent.length,0);assert.equal(f.p.textContent,'mi borrador sin terminar');assert.equal(f.area.hasAttribute('hidden'),true);assert.equal(f.form.hasAttribute('data-cq-reservation'),false);assert.equal(Object.keys(f.s.draftBackups).length,0);
});
test('queue does not mix native draft attachments into its outgoing message',async()=>{
 const f=fixture();f.area.removeAttribute('hidden');f.add();await f.steps();assert.equal(f.sent.length,0);assert.equal(f.p.textContent,'mi borrador sin terminar');assert.equal(f.area.hasAttribute('hidden'),false);assert.equal(f.s.jobs[0].status,'queued');
});
test('loss of the DOM response retains a recoverable user draft instead of retrying a send',async()=>{
 const f=fixture();f.add();const page=f.io.page;let once=true;
 f.io.page=async(id,a)=>{const result=await page(id,a);if(a.cmd==='localSend'&&once){once=false;throw Error('response channel lost');}return result;};
 await f.steps();assert.equal(f.sent.length,1);assert.equal(f.p.textContent,'mi borrador sin terminar');assert.ok(Object.values(f.s.draftBackups).some(d=>d.backup.text==='mi borrador sin terminar'));
});
test('clear racing with editor reservation releases the lock without reopening a job',async()=>{
 const f=fixture();f.add([{id:'file-1',name:'proof.pdf',type:'application/pdf',size:10}]);const page=f.io.page;
 f.io.page=async(id,a)=>{const result=await page(id,a);if(a.cmd==='localBegin')await f.c.clear();return result;};
 await f.steps();assert.equal(f.s.jobs.length,0);assert.equal(f.sent.length,0);assert.equal(f.p.textContent,'mi borrador sin terminar');assert.equal(f.form.hasAttribute('data-cq-reservation'),false);
});
