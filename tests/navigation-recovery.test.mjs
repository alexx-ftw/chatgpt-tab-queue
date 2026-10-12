import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,addJob} from '../core/model.mjs';
import {createCoordinator} from '../core/coordinator.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
function fixture(){
 let s=newState(),time=10000;const calls=[],tabs=new Map(),pages=new Map(),internal=new Map();
 const snap=cid=>({route:`https://chatgpt.com/c/${cid}`,pathId:cid,ready:true,state:'idle',text:'',attachments:{count:0,items:[],unsupported:false,loading:false},lastUser:{id:'old-'+cid,text:'old',files:[]},finalId:'final-'+cid,model:{},options:[],blocked:''});
 tabs.set(4,{id:4,url:`https://chatgpt.com/c/${B}`,active:true,status:'complete'});pages.set(4,{...snap(B),text:'mi borrador de B'});
 const store={getState:async()=>structuredClone(s),changeState:async fn=>{const result=fn(s);s.revision++;return {state:structuredClone(s),result:structuredClone(result)};},deleteFile:async()=>{}};
 const io={now:()=>time,changed:async()=>{},listTabs:async()=>[...tabs.values()],getTab:async id=>{const t=tabs.get(id)||internal.get(id);if(!t)throw Error('Surface gone');return t;},
 ensureBackground:async(c,j)=>{calls.push(['internal',c.id]);const id=`frame:4:${c.id}`;if(!internal.has(id)){internal.set(id,{id,url:c.url,status:'complete',cqFrame:true,hostTabId:4});pages.set(id,snap(c.id));}return internal.get(id);},
 releaseBackground:async id=>{calls.push(['release',id]);internal.delete(id);pages.delete(id);},
 page:async(id,a)=>{calls.push([a.cmd,id]);const p=pages.get(id);if(!p)throw Error('Surface gone');
  if(a.cmd==='localSend'){p.lastUser={id:'receipt-'+time,text:a.text,files:[]};p.state='busy';return {clicked:true,restored:true};}
  if(['localEnd','guardStart','guardEnd','guardCheck'].includes(a.cmd))return {ok:true};
  if(['model','options','closeConfiguration'].includes(a.cmd))return {done:true};
  return structuredClone(p);
 },sendTab:async()=>({ok:true})};
 const add=(cid=A)=>addJob(s,{target:{id:cid,url:`https://chatgpt.com/c/${cid}`},text:`queued ${cid}`,files:[],sourceTabId:4,model:{}},time);
 const c=createCoordinator({store,io});return {s,io,c,calls,tabs,pages,internal,add,async steps(n=20){for(let i=0;i<n;i++){await c.tick();time+=2000;}}};
}

function visibleAgain(f,cid=A){
 f.tabs.get(4).url=`https://chatgpt.com/c/${cid}`;
 Object.assign(f.pages.get(4),{route:f.tabs.get(4).url,pathId:cid,text:'borrador conservado',state:'idle',ready:true,finalId:'final-visible',model:{},lastUser:{id:'old-'+cid,text:'old',files:[]}});
}
test('returning to original chat recovers from an internal surface stuck loading without reload',async()=>{
 const f=fixture();f.add();await f.steps(1);const id=[...f.internal.keys()][0];f.internal.get(id).status='loading';
 await f.steps(3);visibleAgain(f);await f.steps(20);
 assert.equal(f.s.jobs.length,0,'original visible chat must send without needing a document reload');
 assert.equal(f.pages.get(4).text,'borrador conservado');assert.equal(f.tabs.size,1);
 assert.ok(f.calls.some(([cmd,sid])=>cmd==='localSend'&&sid===4));
});
test('returning recovers from a loaded internal page with no editor',async()=>{
 const f=fixture();f.add();await f.steps(1);const id=[...f.internal.keys()][0];f.pages.get(id).ready=false;
 visibleAgain(f);await f.steps();assert.equal(f.s.jobs.length,0);assert.equal(f.tabs.size,1);
});
test('matching saved reasoning and tools is applied only in an internal surface',async()=>{
 const f=fixture(),j=f.add();j.model={effort:'max'};j.options=[{label:'Search'}];
 const page=f.io.page;f.io.page=async(id,a)=>{
  if(a.cmd==='model'){assert.ok(String(id).startsWith('frame:'));f.pages.get(id).model={...a.model};f.calls.push([a.cmd,id]);return {done:true};}
  if(a.cmd==='options'){assert.ok(String(id).startsWith('frame:'));f.pages.get(id).options=a.options;f.calls.push([a.cmd,id]);return {done:true};}
  return page(id,a);
 };
 await f.steps(30);assert.equal(f.s.jobs.length,0,'new internal composer must not wait forever with the wrong defaults');
 assert.equal(f.pages.get(4).text,'mi borrador de B');assert.deepEqual(f.pages.get(4).model,{});assert.deepEqual(f.pages.get(4).options,[]);
});
test('a configuring frame does not take over visible native model controls on returning',async()=>{
 const f=fixture(),j=f.add();j.model={effort:'max'};await f.steps(1);visibleAgain(f);const page=f.io.page;
 f.io.page=async(id,a)=>{if(['model','options'].includes(a.cmd))assert.notEqual(id,4);return page(id,a);};
 await f.steps();assert.equal(f.s.jobs[0]?.status,'queued');assert.deepEqual(f.pages.get(4).model,{});
});
test('returning after an unconfirmed click reconciles but never retries that click',async()=>{
 const f=fixture();f.add();
 for(let i=0;i<15&&f.s.jobs[0]?.status!=='submitting';i++)await f.steps(1);
 assert.equal(f.s.jobs[0].status,'submitting');const id=[...f.internal.keys()][0],receipt=structuredClone(f.pages.get(id).lastUser);
 f.pages.get(id).ready=false;visibleAgain(f);f.pages.get(4).lastUser=receipt;f.pages.get(4).state='busy';
 await f.steps();assert.equal(f.s.jobs.length,0);assert.equal(f.calls.filter(([cmd])=>cmd==='localSend').length,1);
});
