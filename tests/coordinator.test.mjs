import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,addJob,markPreparing,markSubmitting} from '../core/model.mjs';
import {createCoordinator} from '../core/coordinator.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
export function fixture(){
 let state=newState(),time=10000;const files=new Map(),calls=[];
 const pages=new Map([[4,{route:`https://chatgpt.com/c/${A}`,pathId:A,ready:true,state:'idle',text:'Estoy escribiendo otro borrador',attachments:{count:0,unsupported:false,loading:false},lastUser:{id:'old',text:'antes',files:[]},finalId:'old-answer',blocked:'',model:{effort:'max'}}]]);
 const tabs=new Map([[4,{id:4,url:`https://chatgpt.com/c/${A}`,windowId:1,active:true,status:'complete'}]]);
 tabs.set(8,{id:8,url:`https://chatgpt.com/c/${B}`,windowId:1,active:false,status:'complete'});pages.set(8,{...structuredClone(pages.get(4)),route:`https://chatgpt.com/c/${B}`,pathId:B});
 const store={getState:async()=>structuredClone(state),changeState:async(fn)=>{const s=structuredClone(state),result=fn(s);s.revision++;state=s;return {state:structuredClone(s),result:structuredClone(result)};},getFile:async id=>files.get(id),deleteFile:async id=>files.delete(id)};
 const io={now:()=>time,changed:async()=>{},listTabs:async()=>[...tabs.values()],getTab:async id=>{if(!tabs.has(id))throw Error('missing');return tabs.get(id);},
 createHelper:async(url,source)=>{calls.push(['create',url,{active:false}]);const id=12;tabs.set(id,{id,url,active:false,status:'complete',windowId:1});pages.set(id,{...structuredClone(pages.get(4)),route:url,pathId:url.match(/\/c\/([^/]+)/)?.[1]||null,text:''});return tabs.get(id);},
 navigate:async(id,url)=>{calls.push(['navigate',id,url]);tabs.get(id).url=url;pages.set(id,{...pages.get(id),route:url,pathId:url.match(/\/c\/([^/]+)/)?.[1]||null,text:'',state:'idle'});},
 page:async(id,args)=>{calls.push(['page',id,args.cmd]);const p=pages.get(id);if(!p)throw Error('missing page');
  if(args.cmd==='capture')return structuredClone({...p,doc:null,selection:null});
  if(args.cmd==='localBegin'){p.localBackup={text:p.text};return {ok:true,backup:structuredClone(p.localBackup)};}
  if(args.cmd==='localCheck')return {ok:true};
  if(args.cmd==='localEnd'){if(p.localBackup)p.text=p.localBackup.text;p.attachments.count=0;return {ok:true};}
  if(args.cmd==='localSend'){p.lastUser={id:'receipt-'+time,text:args.text,files:[]};p.state='busy';return {clicked:true,restored:true};}
  if(args.cmd==='guardStart'||args.cmd==='guardCheck')return {ok:true};if(args.cmd==='guardEnd')return {ok:true};
  if(args.cmd==='model'||args.cmd==='options')return {done:true};if(args.cmd==='write'){p.text=args.snapshot.text;return structuredClone(p);}
  if(args.cmd==='removeHelperFiles'){p.attachments.count=0;return true;}
  if(args.cmd==='verifyFiles')return {match:p.attachments.count===(args.expectedFiles||[]).length,loading:false,snapshot:structuredClone(p)};
  if(args.cmd==='send'){p.lastUser={id:'receipt-'+time,text:args.text,files:(args.expectedFiles||[]).map(f=>f.name)};p.text='';p.state='busy';return {clicked:true};}
  return structuredClone(p);
 },sendTab:async(id,m)=>{calls.push(['message',id,m.type]);return {ok:true};},openManager:async()=>{},openChat:async()=>{}};
 const c=createCoordinator({store,io});return {c,store,io,calls,pages,tabs,files,get s(){return state;},advance:()=>time+=2000,add:(cid=A,text='pendiente',fs=[])=>addJob(state,{target:{id:cid,url:`https://chatgpt.com/c/${cid}`},text,files:fs,sourceTabId:4,model:{effort:'max'}},time)};
}
async function steps(f,n=18){for(let i=0;i<n;i++){await f.c.tick();f.advance();}}
test('existing tab sends while preserving its unfinished draft and URL',async()=>{
 const f=fixture();f.add();await steps(f);assert.equal(f.s.jobs.length,0);assert.equal(f.pages.get(4).text,'Estoy escribiendo otro borrador');
 assert.ok(f.s.conversations[A].waiting);assert.equal(f.calls.filter(x=>x[0]==='page'&&['send','localSend'].includes(x[2])).length,1);
 assert.ok(!f.calls.some(x=>x[0]==='navigate'&&x[1]===4));assert.ok(!f.calls.some(x=>x[0]==='create'));
});
test('two queued messages wait for the preceding response before the second send',async()=>{
 const f=fixture();f.add(A,'uno');f.add(A,'dos');await steps(f,24);assert.equal(f.s.jobs.length,1);
 f.pages.get(4).state='idle';f.pages.get(4).finalId='new-answer';await steps(f,24);assert.equal(f.s.jobs.length,0);assert.equal(f.calls.filter(x=>x[0]==='page'&&['send','localSend'].includes(x[2])).length,2);
});
test('clear all cancels preparing work and deletes file bytes from every chat',async()=>{
 const f=fixture();f.files.set('a',{id:'a'});f.files.set('b',{id:'b'});f.add(A,'one',[{id:'a',name:'a.pdf',size:1}]);f.add(B,'two',[{id:'b',name:'b.pdf',size:1}]);
 await f.c.clear();await steps(f);assert.equal(f.s.jobs.length,0);assert.equal(f.files.size,0);assert.ok(!f.calls.some(x=>x[0]==='page'&&['send','localSend'].includes(x[2])));
});
test('clear queue while a response is running never clicks Stop',async()=>{
 const f=fixture();f.add();await steps(f);f.add(A,'next');await f.c.clear();assert.equal(f.s.jobs.length,0);assert.equal(f.pages.get(4).state,'busy');assert.ok(f.s.conversations[A].waiting);
 assert.ok(!f.calls.some(x=>x[2]==='stop'));
});
test('busy conversation is never submitted into',async()=>{
 const f=fixture();f.add();f.pages.get(4).state='busy';
 await steps(f,24);assert.equal(f.s.jobs.length,1);assert.ok(!f.calls.some(x=>x[0]==='page'&&['send','localSend'].includes(x[2])));
});
test('worker restart reconciles an existing submitting attempt instead of clicking twice',async()=>{
 const f=fixture();const j=f.add();f.tabs.set(12,{id:12,url:`https://chatgpt.com/c/${A}`,active:false,status:'complete'});
 f.pages.set(12,{...f.pages.get(4),text:'',lastUser:{id:'receipt',text:'pendiente',files:[]},state:'busy'});
 await f.store.changeState(s=>{markPreparing(s,j.id,12,{lastUser:{id:'old'}},1);markSubmitting(s,j.id,2);s.helper={tabId:12,conversationId:A,jobId:j.id,url:`https://chatgpt.com/c/${A}`};});
 await steps(f,3);assert.equal(f.s.jobs.length,0);assert.ok(!f.calls.some(x=>x[0]==='page'&&['send','localSend'].includes(x[2])));
});
test('an unknown send result is made uncertain, not blindly retried',async()=>{
 const f=fixture();f.add();const page=f.io.page;f.io.page=async(id,args)=>{if(args.cmd==='localSend'){f.calls.push(['page',id,'localSend']);throw Error('connection lost');}return page(id,args);};
 await steps(f,40);assert.equal(f.s.jobs[0].status,'uncertain');assert.equal(f.calls.filter(x=>x[0]==='page'&&['send','localSend'].includes(x[2])).length,1);
});
test('clear after prepare makes a later submitting gate fail closed',async()=>{
 const f=fixture();f.add();for(let n=0;n<10&&f.s.jobs[0]?.status!=='preparing';n++){await f.c.tick();f.advance();}
 await f.c.clear();await steps(f);assert.ok(!f.calls.some(x=>x[0]==='page'&&['send','localSend'].includes(x[2])));
});
test('a selected browser tab is not required: existing-tab background activity proceeds',async()=>{
 const f=fixture();f.tabs.get(4).active=false;f.add();await steps(f);assert.equal(f.s.jobs.length,0);
});
test('queued follow-up binds a different existing tab after its source is closed',async()=>{
 const f=fixture();f.add();await steps(f);f.add(A,'after');
 const p=structuredClone(f.pages.get(4));f.tabs.delete(4);f.pages.delete(4);
 p.lastUser={id:f.s.conversations[A].waiting.receiptId,text:'pendiente',files:[]};p.finalId='finished';p.state='idle';
 f.tabs.set(14,{id:14,url:`https://chatgpt.com/c/${A}`,active:false,status:'complete'});f.pages.set(14,p);
 await steps(f,30);assert.equal(f.s.jobs.length,0);assert.ok(!f.calls.some(x=>x[0]==='create'));
});
test('clearing from inside a prepare operation prevents the subsequent Send click',async()=>{
 const f=fixture();f.add();const page=f.io.page;
 f.io.page=async(id,args)=>{const r=await page(id,args);if(args.cmd==='capture')await f.c.clear();return r;};
 await steps(f,30);assert.equal(f.s.jobs.length,0);assert.ok(!f.calls.some(x=>x[0]==='page'&&['send','localSend'].includes(x[2])));
});

test('null inspector result is a transient unavailable page, never a route TypeError',async()=>{
 const f=fixture();f.add();const page=f.io.page;
 f.io.page=async(id,args)=>args.cmd==='inspect'?null:page(id,args);
 await steps(f,2);
 assert.ok(!JSON.stringify(f.s).includes("Cannot read properties of null"));
 assert.equal(f.s.jobs[0].status,'queued');
 f.io.page=page;await steps(f,24);assert.equal(f.s.jobs.length,0);
});
test('different conversations send independently while the first answer is still running',async()=>{
 const f=fixture();let id=11;
 f.add(A,'A1');f.add(A,'A2');f.add(B,'B1');
 await steps(f,26);
 assert.equal(f.s.jobs.filter(j=>j.conversationId===B).length,0);
 assert.equal(f.s.jobs.filter(j=>j.conversationId===A).length,1);
 assert.equal([...f.pages.values()].filter(p=>p.state==='busy').length,2);
 assert.equal(Object.keys(f.s.helpers).length,2);
});
test('a frozen existing tab does not block a different conversation',async()=>{
 const f=fixture();f.tabs.get(4).frozen=true;
 f.add(A,'A1');f.add(B,'B1');await steps(f,24);
 assert.equal(f.s.jobs.length,1);assert.equal(f.s.jobs[0].conversationId,A);
});
test('a deferred inspector in A does not prevent later ticks from advancing B',async()=>{
 const f=fixture();let id=11;
 let release;const stall=new Promise(r=>release=r),page=f.io.page;
 f.io.page=async(id,args)=>{if(f.pages.get(id)?.pathId===A&&args.cmd==='inspect')await stall;return page(id,args);};
 f.add(A,'A1');const pending=f.c.tick();
 // Let A acquire its own lane and start waiting in the browser.
 for(let i=0;i<30;i++)await Promise.resolve();
 f.add(B,'B1');await steps(f,22);
 const remainingB=f.s.jobs.filter(j=>j.conversationId===B).length;
 release();await pending;assert.equal(remainingB,0);
});
test('upload failure ends draft guards and pauses only its own conversation',async()=>{
 const f=fixture(),j=f.add(A,'file');f.add(B,'independent');
 await f.store.changeState(s=>{markPreparing(s,j.id,12,{lastUser:{id:'old'}},1).attempt.guardTabs=[4];});
 const token=f.s.jobs[0].attempt.token;await f.c.uploadResult(j.id,token,'Upload failed');
 assert.equal(f.s.conversations[A].paused,true);assert.equal(f.s.conversations[B].paused,false);
 assert.ok(f.calls.some(x=>x[0]==='page'&&x[1]===4&&x[2]==='guardEnd'));
 assert.ok(f.calls.some(x=>x[0]==='message'&&x[2]==='CANCEL_UPLOAD'),'failed attempts must cancel an in-progress native upload');
});
test('slow cleanup in one conversation does not stop another conversation',async()=>{
 const f=fixture();let next=11;
 const j=f.add(A,'cancel me');for(let n=0;n<6&&f.s.jobs[0].status!=='preparing';n++){await f.c.tick();f.advance();}
 let release;const stalled=new Promise(r=>release=r);f.io.sendTab=async(_id,m)=>{if(m.type==='CANCEL_UPLOAD')await stalled;return {ok:true};};
 const removing=f.c.remove(j.id);for(let n=0;n<30;n++)await Promise.resolve();f.add(B,'continues');await steps(f,24);
 const remaining=f.s.jobs.filter(x=>x.conversationId===B).length;release();await removing;assert.equal(remaining,0);
});
