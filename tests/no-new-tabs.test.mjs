import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newState,addJob} from '../core/model.mjs';
import {createCoordinator} from '../core/coordinator.mjs';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
function fixture(){
 let s=newState(),time=10000;const calls=[],tabs=new Map(),pages=new Map();
 const store={getState:async()=>structuredClone(s),changeState:async fn=>{const value=fn(s);s.revision++;return {state:structuredClone(s),result:structuredClone(value)};},deleteFile:async()=>{}};
 const io={now:()=>time,changed:async()=>{},listTabs:async()=>[...tabs.values()],getTab:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},
 createHelper:async()=>{calls.push('CREATE');throw Error('No new tabs allowed');},navigate:async()=>calls.push('NAVIGATE'),closeHelper:async()=>calls.push('CLOSE'),parkHelper:async()=>calls.push('PARK'),
 sendTab:async()=>({ok:true}),page:async(id,a)=>{calls.push([id,a.cmd]);const p=pages.get(id);if(!p)throw Error('closed');
  if(a.cmd==='localSend'||a.cmd==='sendLocal'){p.lastUser={id:'r'+time,text:a.text,files:[]};p.state='busy';return {clicked:true,restored:true};}
  if(a.cmd==='localEnd'||a.cmd==='localCheck'||a.cmd==='guardEnd')return {ok:true};
  if(a.cmd==='guardStart'||a.cmd==='guardCheck')return {ok:true};
  if(a.cmd==='model'||a.cmd==='options')return {done:true};
  if(a.cmd==='verifyFiles')return {match:p.attachments.count===(a.expectedFiles||[]).length,loading:false};
  return structuredClone(p);
 }};
 const addTab=(id,cid,text='borrador intacto')=>{tabs.set(id,{id,url:`https://chatgpt.com/c/${cid}`,active:false,status:'complete'});pages.set(id,{route:`https://chatgpt.com/c/${cid}`,pathId:cid,ready:true,state:'idle',text,doc:null,selection:null,attachments:{count:0,items:[],unsupported:false,loading:false},lastUser:{id:'old'+cid,text:'antes',files:[]},finalId:'old-final',model:{},options:[],blocked:''});};
 const add=(cid=A,source=4)=>addJob(s,{target:{id:cid,url:`https://chatgpt.com/c/${cid}`},text:'pendiente '+cid,files:[],sourceTabId:source,model:{},options:[]},time);
 const c=createCoordinator({store,io});return {c,store,io,tabs,pages,calls,addTab,add,get s(){return s;},async steps(n=20){for(let i=0;i<n;i++){await c.tick();time+=2000;}}};
}
test('Tab queue reuses its existing conversation without creating or selecting any tab',async()=>{
 const f=fixture();f.addTab(4,A);f.add();await f.steps();
 assert.ok(!f.calls.includes('CREATE'),'must not call createHelper');
 assert.ok(!f.calls.includes('NAVIGATE'));assert.ok(!f.calls.includes('CLOSE'));assert.ok(!f.calls.includes('PARK'));
 assert.equal(f.s.jobs.length,0);assert.equal(f.pages.get(4).text,'borrador intacto');
});
test('a queue without any open matching conversation waits, never opens a replacement',async()=>{
 const f=fixture();f.addTab(4,B);f.add();await f.steps();assert.ok(!f.calls.includes('CREATE'));
 assert.equal(f.s.jobs[0].status,'queued');assert.equal(f.pages.get(4).pathId,B);
 f.addTab(4,A);await f.steps();assert.equal(f.s.jobs.length,0);
});
test('existing background conversations keep independent sending lanes',async()=>{
 const f=fixture();f.addTab(4,A);f.addTab(8,B);f.pages.get(4).state='busy';f.add();f.add(B,8);await f.steps();
 assert.equal(f.s.jobs.length,1);assert.equal(f.s.jobs[0].conversationId,A);assert.ok(!f.calls.includes('CREATE'));
});
test('draining or clearing a queue never closes, parks or navigates a user-owned tab',async()=>{
 const f=fixture();f.addTab(4,A);f.add();await f.steps();const p=f.pages.get(4);p.state='idle';p.finalId='new-final';await f.steps();await f.c.clear();
 assert.ok(!f.calls.some(x=>['CLOSE','PARK','NAVIGATE','CREATE'].includes(x)));assert.equal(f.tabs.size,1);
});
test('background IO exposes no automatic tab-creation or navigation helper',()=>{
 const s=readFileSync(new URL('../background.mjs',import.meta.url),'utf8');
 const io=s.slice(s.indexOf('const io='),s.indexOf('const coordinator='));
 assert.doesNotMatch(io,/chrome\.tabs\.(create|remove|update)|createHelper|navigate:|parkHelper|closeHelper/);
});
