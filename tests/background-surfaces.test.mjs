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
  if(a.cmd==='model'||a.cmd==='options')return {done:true};
  return structuredClone(p);
 },sendTab:async()=>({ok:true})};
 const add=(cid=A)=>addJob(s,{target:{id:cid,url:`https://chatgpt.com/c/${cid}`},text:`queued ${cid}`,files:[],sourceTabId:4,model:{}},time);
 const c=createCoordinator({store,io});return {s,io,c,calls,tabs,pages,internal,add,async steps(n=20){for(let i=0;i<n;i++){await c.tick();time+=2000;}}};
}
test('absent chat is processed internally while the visible B URL and draft stay untouched',async()=>{
 const f=fixture();f.add();await f.steps();assert.equal(f.s.jobs.length,0);assert.equal(f.tabs.size,1);assert.equal(f.pages.get(4).pathId,B);assert.equal(f.pages.get(4).text,'mi borrador de B');assert.ok(f.internal.size===1);assert.ok(!f.calls.some(([cmd,id])=>cmd==='localSend'&&id===4));
});
test('independent invisible conversations do not wait for another reply',async()=>{
 const f=fixture();f.add(A);f.add(A);f.add(C);await f.steps(30);assert.equal(f.s.jobs.length,1);assert.equal(f.s.jobs[0].conversationId,A);assert.equal(f.tabs.size,1);assert.equal(f.internal.size,2);
});
test('an internal frame must have a completed loaded turn before a new send',async()=>{
 const f=fixture();f.add();await f.steps(1);const id=[...f.internal.keys()][0];assert.ok(id);f.pages.get(id).finalId=null;await f.steps();assert.equal(f.s.jobs.length,1);assert.ok(!f.calls.some(([cmd])=>cmd==='localSend'));
 f.pages.get(id).finalId='loaded';await f.steps();assert.equal(f.s.jobs.length,0);
});
test('internal frame loading failure leaves user view and pending message untouched',async()=>{
 const f=fixture();f.add();f.io.ensureBackground=async()=>{throw Object.assign(Error('Carga interna bloqueada'),{code:'PAGE_UNAVAILABLE'});};await f.steps();assert.equal(f.s.jobs[0].status,'queued');assert.equal(f.pages.get(4).pathId,B);assert.equal(f.pages.get(4).text,'mi borrador de B');assert.match(f.s.conversations[A].reason,/bloqueada/);
});
test('idle internal context is released after receipt/reply without closing the browser tab',async()=>{
 const f=fixture();f.add();await f.steps();assert.equal(f.s.jobs.length,0);const id=[...f.internal.keys()][0];f.pages.get(id).state='idle';f.pages.get(id).finalId='new-final';await f.steps();assert.equal(f.internal.size,0);assert.equal(f.tabs.size,1);
});
test('switching away during untouched preparation rebinds instead of pausing the conversation',async()=>{
 const f=fixture();f.tabs.get(4).url=`https://chatgpt.com/c/${A}`;f.pages.set(4,{...f.pages.get(4),route:`https://chatgpt.com/c/${A}`,pathId:A,text:''});f.add();
 for(let i=0;i<6&&f.s.jobs[0]?.status!=='preparing';i++)await f.steps(1);
 assert.equal(f.s.jobs[0].status,'preparing');f.tabs.get(4).url=`https://chatgpt.com/c/${B}`;f.pages.get(4).route=f.tabs.get(4).url;f.pages.get(4).pathId=B;f.pages.get(4).text='nuevo borrador B';
 await f.steps();assert.equal(f.s.jobs.length,0);assert.equal(f.s.conversations[A].paused,false);assert.equal(f.pages.get(4).text,'nuevo borrador B');
});
test('navigation after a click reconciles in an internal context without sending twice',async()=>{
 const f=fixture();f.tabs.get(4).url=`https://chatgpt.com/c/${A}`;f.pages.set(4,{...f.pages.get(4),route:f.tabs.get(4).url,pathId:A,text:''});f.add();
 for(let i=0;i<12&&f.s.jobs[0]?.status!=='submitting';i++)await f.steps(1);
 assert.equal(f.s.jobs[0].status,'submitting');const receipt=structuredClone(f.pages.get(4).lastUser);
 const create=f.io.ensureBackground;f.io.ensureBackground=async(c,j)=>{const d=await create(c,j);f.pages.get(d.id).lastUser=receipt;f.pages.get(d.id).state='busy';return d;};
 f.tabs.get(4).url=`https://chatgpt.com/c/${B}`;f.pages.get(4).route=f.tabs.get(4).url;f.pages.get(4).pathId=B;
 await f.steps();assert.equal(f.s.jobs.length,0);assert.equal(f.calls.filter(([cmd])=>cmd==='localSend').length,1);assert.equal(f.s.conversations[A].paused,false);
});
