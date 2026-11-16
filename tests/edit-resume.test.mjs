import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,addJob,markPreparing,markSubmitting,recoverAfterRestart,acknowledge,ACK_TIMEOUT_REASON} from '../core/model.mjs';
import {createCoordinator} from '../core/coordinator.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function fixture(){
 let state=newState(),time=10000;const sends=[];
 const pages=new Map([A,B].map((id,i)=>[i+1,{ready:true,route:`https://chatgpt.com/c/${id}`,pathId:id,state:'busy',blocked:'',text:'Unfinished draft',attachments:{count:0,unsupported:false},model:{},options:[],lastUser:{id:'before-'+id,text:'Previous'},finalId:'old'}]));
 const tabs=[...pages].map(([id,p])=>({id,url:p.route,status:'complete'}));
 const store={getState:async()=>structuredClone(state),changeState:async fn=>{const next=structuredClone(state),result=fn(next);next.revision++;state=next;return {state:structuredClone(next),result:structuredClone(result)};},deleteFile:async()=>{}};
 const io={now:()=>time,changed:async()=>{},listTabs:async()=>tabs,getTab:async id=>tabs.find(t=>t.id===id),sendTab:async()=>({ok:true}),page:async(id,args)=>{const p=pages.get(id);if(args.cmd==='capture')return {...structuredClone(p),doc:null};if(args.cmd==='localSend'){sends.push({id,text:args.text});p.state='busy';p.lastUser={id:'sent-'+sends.length,text:args.text,files:[]};return {clicked:true,restored:true};}if(['guardStart','guardEnd','guardCheck'].includes(args.cmd))return {ok:true};return structuredClone(p);}};
 const c=createCoordinator({store,io}),add=(cid=A,text='Original')=>addJob(state,{target:{id:cid,url:`https://chatgpt.com/c/${cid}`},text,doc:{text},files:[],sourceTabId:cid===A?1:2,options:[]});
 return {c,store,io,add,sends,pages,get s(){return state;},async steps(n=15){for(let i=0;i<n;i++){await c.tick();time+=2000;}}};
}
const begin=(f,j,token='edit-token-111',owner='view-a')=>f.c.beginEdit({id:j.id,token,owner});
const end=(f,j,extra={},token='edit-token-111',owner='view-a')=>f.c.endEdit({id:j.id,token,owner,...extra});
test('saving a queued edit restores running state without Play and sends the edited text once',async()=>{const f=fixture(),j=f.add();await begin(f,j);assert.equal(f.s.conversations[A].paused,true);f.pages.get(1).state='idle';await f.steps();assert.equal(f.sends.length,0);await end(f,j,{save:true,text:'Edited'});assert.equal(f.s.conversations[A].paused,false);await f.steps();assert.deepEqual(f.sends,[{id:1,text:'Edited'}]);assert.equal(f.pages.get(1).text,'Unfinished draft');});
test('cancelling restores running state, text and rich document unchanged',async()=>{const f=fixture(),j=f.add();await begin(f,j);await end(f,j);assert.equal(f.s.conversations[A].paused,false);assert.deepEqual(f.s.jobs[0].doc,{text:'Original'});assert.equal(f.s.jobs[0].text,'Original');});
for(const reason of ['Pausa manual','Cola importada','Unknown pause'])test('prior pause survives edit: '+reason,async()=>{const f=fixture(),j=f.add();await f.store.changeState(s=>{s.conversations[A].paused=true;s.conversations[A].reason=reason;});await begin(f,j);await end(f,j,{save:true,text:'Edited'});assert.equal(f.s.conversations[A].paused,true);assert.equal(f.s.conversations[A].reason,reason);});
for(const when of ['before','during'])test('global pause '+when+' editing is retained',async()=>{const f=fixture(),j=f.add();if(when==='before')await f.c.pause();await begin(f,j);if(when==='during')await f.c.pause();const r=await end(f,j,{save:true,text:'Edited'});assert.equal(f.s.paused,true);assert.equal(r.paused,true);assert.equal(f.s.reason,'Pausa manual');});
test('a new manual conversation pause during editing is not undone',async()=>{const f=fixture(),j=f.add();await begin(f,j);await f.c.pause(A);await end(f,j);assert.equal(f.s.conversations[A].paused,true);assert.equal(f.s.conversations[A].reason,'Pausa manual');});
test('parallel edits of different messages keep their lane paused until the last closes',async()=>{const f=fixture(),a=f.add(),b=f.add(A,'Second');await begin(f,a);await begin(f,b,'edit-token-222','view-b');await end(f,a,{save:true,text:'Edited'});assert.equal(f.s.conversations[A].paused,true);await end(f,b,{},'edit-token-222','view-b');assert.equal(f.s.conversations[A].paused,false);});
test('parallel edits of the same message detect a stale save atomically',async()=>{const f=fixture(),j=f.add();await begin(f,j);await begin(f,j,'edit-token-222','view-b');await end(f,j,{save:true,text:'First editor'});await assert.rejects(end(f,j,{save:true,text:'Stale overwrite'},'edit-token-222','view-b'),/cambió/);assert.equal(f.s.jobs[0].text,'First editor');assert.equal(f.s.conversations[A].paused,true);await end(f,j,{},'edit-token-222','view-b');assert.equal(f.s.conversations[A].paused,false);});
test('invalid save retains the edit lock and original text until a valid save',async()=>{const f=fixture(),j=f.add();await begin(f,j);await assert.rejects(end(f,j,{save:true,text:''}),/Texto inválido/);assert.equal(f.s.jobs[0].text,'Original');assert.equal(f.s.conversations[A].paused,true);await end(f,j,{save:true,text:'Valid'});assert.equal(f.s.conversations[A].paused,false);});
test('saving unchanged text preserves native document and attachment references',async()=>{const f=fixture(),j=f.add();await f.store.changeState(s=>s.jobs[0].files=[{id:'f',name:'original.pdf',size:42}]);await begin(f,j);await end(f,j,{save:true,text:j.text});assert.deepEqual(f.s.jobs[0].doc,j.doc);assert.deepEqual(f.s.jobs[0].files,[{id:'f',name:'original.pdf',size:42}]);});
test('Resume all cannot bypass an active edit',async()=>{const f=fixture(),j=f.add();await begin(f,j);await f.c.resume();await f.c.resume(A);assert.equal(f.s.conversations[A].paused,true);await end(f,j);assert.equal(f.s.conversations[A].paused,false);});
test('other conversations continue while one message is being edited',async()=>{const f=fixture(),j=f.add();f.add(B,'Independent');await begin(f,j);f.pages.get(2).state='idle';await f.steps();assert.deepEqual(f.sends,[{id:2,text:'Independent'}]);assert.equal(f.s.jobs[0].id,j.id);});
test('worker restart keeps the durable edit ownership',async()=>{const f=fixture(),j=f.add();await begin(f,j);const restarted=createCoordinator({store:f.store,io:f.io});await restarted.endEdit({id:j.id,token:'edit-token-111',owner:'view-a',save:true,text:'After wake'});assert.equal(f.s.conversations[A].paused,false);});
test('browser restart cannot auto-send an abandoned edit',async()=>{const f=fixture(),j=f.add();await begin(f,j);await f.store.changeState(recoverAfterRestart);assert.equal(f.s.conversations[A].paused,true);await assert.rejects(end(f,j,{save:true,text:'Expired'}),/edición/);assert.equal(f.s.jobs[0].text,'Original');});
for(const status of ['preparing','submitting'])test('editing cannot interrupt a '+status+' attempt',async()=>{const f=fixture(),j=f.add(),tail=f.add(A,'Tail');await f.store.changeState(s=>{markPreparing(s,j.id,1,{},1);if(status==='submitting')markSubmitting(s,j.id,2);});await assert.rejects(begin(f,tail),/envío|enviando/);assert.equal(f.s.conversations[A].paused,false);});
test('held and error entries never become runnable solely by saving an edit',async()=>{for(const status of ['held','error']){const f=fixture(),j=f.add();await f.store.changeState(s=>s.jobs[0].status=status);await begin(f,j);await end(f,j,{save:true,text:'Edited'});assert.equal(f.s.jobs[0].status,status);assert.equal(f.s.conversations[A].paused,true);}});
test('removing an edited message cannot recreate it on save; cancel releases its edit',async()=>{const f=fixture(),j=f.add();await begin(f,j);await f.c.remove(j.id);await assert.rejects(end(f,j,{save:true,text:'Resurrect'}));assert.equal(f.s.jobs.length,0);await end(f,j);assert.equal(f.s.conversations[A].paused,false);});
test('clear-all discards edit reservations without poisoning future queues',async()=>{const f=fixture(),j=f.add();await begin(f,j);await f.c.clear();f.add();assert.equal(f.s.conversations[A].paused,false);assert.ok(!f.s.conversations[A].editPause);await assert.rejects(end(f,j,{save:true,text:'Old'}));});
test('a foreign owner cannot save or cancel another view edit',async()=>{const f=fixture(),j=f.add();await begin(f,j);await assert.rejects(end(f,j,{},'edit-token-111','foreign'));await assert.rejects(end(f,j,{save:true,text:'Foreign'},'edit-token-111','foreign'));assert.equal(f.s.jobs[0].text,'Original');assert.equal(f.s.conversations[A].paused,true);});
test('duplicate begin and finish requests are idempotent',async()=>{const f=fixture(),j=f.add();await begin(f,j);await begin(f,j);assert.equal(f.s.conversations[A].editPause.sessions.length,1);await end(f,j,{save:true,text:'Once'});await end(f,j,{save:true,text:'Once'});await assert.rejects(end(f,j,{save:true,text:'Do not change'}));assert.equal(f.s.jobs[0].text,'Once');assert.equal(f.s.conversations[A].paused,false);});
test('closing a source tab releases only the edits owned by that tab',async()=>{const f=fixture(),a=f.add(),b=f.add(A,'Second');await begin(f,a,'edit-tab-a','tab:4:doc');await begin(f,b,'edit-tab-b','tab:9:doc');await f.c.abandonTabEdits(4);assert.equal(f.s.conversations[A].paused,true);assert.equal(f.s.conversations[A].editPause.sessions.length,1);await f.c.abandonTabEdits(9);assert.equal(f.s.conversations[A].paused,false);assert.equal(f.s.jobs.length,2);});
test('closing an editing tab preserves a deliberate user pause',async()=>{const f=fixture(),j=f.add();await begin(f,j,'edit-tab-a','tab:4:doc');await f.c.pause(A);await f.c.abandonTabEdits(4);assert.equal(f.s.conversations[A].paused,true);assert.equal(f.s.conversations[A].reason,'Pausa manual');});

test('late confirmation resolves its timeout without bypassing an open edit',async()=>{const f=fixture(),first=f.add(),tail=f.add(A,'Next');await f.store.changeState(s=>{markPreparing(s,first.id,1,{lastUser:{id:'before'}},1);markSubmitting(s,first.id,2);s.jobs[0].status='uncertain';s.jobs[0].reason=ACK_TIMEOUT_REASON;s.conversations[A].paused=true;s.conversations[A].reason=ACK_TIMEOUT_REASON;});await begin(f,tail);await f.store.changeState(s=>acknowledge(s,first.id,{id:'sent',text:'Original',files:[]},{state:'idle'},3));assert.equal(f.s.conversations[A].paused,true);await end(f,tail,{save:true,text:'Edited next'});assert.equal(f.s.conversations[A].paused,false);});

test('a late Save after a completed cancellation never reports a false success',async()=>{const f=fixture(),j=f.add();await begin(f,j);await end(f,j);await assert.rejects(end(f,j,{save:true,text:'Not saved'}),/canceló/);assert.equal(f.s.jobs[0].text,'Original');});

test('navigation cleanup is serialized after an in-flight edit begin',async()=>{
 const f=fixture(),j=f.add();let unlock,entered;const gate=new Promise(r=>unlock=r),started=new Promise(r=>entered=r);let first=true,serial=Promise.resolve();const change=f.store.changeState;
 f.store.changeState=fn=>{const next=serial.then(async()=>{if(first){first=false;entered();await gate;}return change(fn);});serial=next.catch(()=>{});return next;};
 const opening=begin(f,j,'edit-race-001','tab:4:old-doc');await started;const closing=f.c.abandonTabEdits(4);await Promise.resolve();unlock();await Promise.all([opening,closing]);
 assert.equal(f.s.conversations[A].paused,false);assert.ok(!f.s.conversations[A].editPause);assert.equal(f.s.jobs[0].text,'Original');
});
test('closed manager documents release only their own durable edits without pagehide',async()=>{
 const f=fixture(),a=f.add(),b=f.add(A,'Second');await begin(f,a,'manager-edit-a','ui-document:doc-a');await begin(f,b,'manager-edit-b','ui-document:doc-b');
 await f.c.reconcileUIEdits({getContexts:async()=>[{documentId:'doc-a'}]});assert.equal(f.s.conversations[A].editPause.sessions.length,1);assert.equal(f.s.conversations[A].paused,true);
 await f.c.reconcileUIEdits({getContexts:async()=>[]});assert.ok(!f.s.conversations[A].editPause);assert.equal(f.s.conversations[A].paused,false);assert.equal(f.s.jobs[0].text,'Original');
});
test('manager cleanup never cancels an owner created after its context snapshot',async()=>{
 const f=fixture(),a=f.add(),b=f.add(A,'Second');await begin(f,a,'manager-edit-a','ui-document:doc-a');let release,entered;const ready=new Promise(r=>entered=r);
 const cleaning=f.c.reconcileUIEdits({getContexts:()=>{entered();return new Promise(r=>release=r);}});await ready;await begin(f,b,'manager-edit-b','ui-document:doc-b');release([]);await cleaning;
 assert.equal(f.s.conversations[A].editPause.sessions.length,1);assert.equal(f.s.conversations[A].editPause.sessions[0].owner,'ui-document:doc-b');
});
test('unavailable browser contexts retain edits instead of guessing they closed',async()=>{
 const f=fixture(),j=f.add();await begin(f,j,'manager-edit-a','ui-document:doc-a');await f.c.reconcileUIEdits({getContexts:async()=>{throw Error('temporarily unavailable');}});
 assert.equal(f.s.conversations[A].paused,true);assert.equal(f.s.conversations[A].editPause.sessions.length,1);
});
test('extension UI owners are unique per document and tab-aware when available',async()=>{
 const {uiEditOwner}=await import('../core/editing.mjs');assert.equal(uiEditOwner({documentId:'doc-a',tab:{id:4}}),'ui-tab:4:doc-a');assert.equal(uiEditOwner({documentId:'doc-b'}),'ui-document:doc-b');assert.throws(()=>uiEditOwner({}),/documento/i);
 const f=fixture(),j=f.add();await begin(f,j,'manager-edit-a','ui-tab:4:doc-a');await f.c.abandonTabEdits(4);assert.equal(f.s.conversations[A].paused,false);
});
test('lost Save result remains retryable after more than twenty unrelated completions',async()=>{
 const f=fixture(),a=f.add(),b=f.add(A,'Second');await begin(f,a);await end(f,a,{save:true,text:'Once'});
 for(let i=0;i<25;i++){const token='later-token-'+i;await begin(f,b,token);await end(f,b,{},token);}
 await end(f,a,{save:true,text:'Once'});assert.equal(f.s.jobs[0].text,'Once');assert.equal(f.s.jobs[0].editRevision,1);
 await f.c.ackEdit({id:a.id,token:'edit-token-111',owner:'view-a'});assert.ok(!f.s.conversations[A].editReceipts.some(r=>r.token==='edit-token-111'));
});
test('a foreign view cannot acknowledge another view completed edit',async()=>{
 const f=fixture(),j=f.add();await begin(f,j);await end(f,j);await assert.rejects(f.c.ackEdit({id:j.id,token:'edit-token-111',owner:'other'}));assert.equal(f.s.conversations[A].editReceipts.length,1);
});
test('forced extension update releases edit ownership but leaves interrupted work review-paused',async()=>{
 const {recoverAfterUpdate}=await import('../core/model.mjs');const f=fixture(),j=f.add();await begin(f,j);await f.store.changeState(recoverAfterUpdate);assert.ok(!f.s.conversations[A].editPause);assert.equal(f.s.conversations[A].paused,true);assert.match(f.s.conversations[A].reason,/actualiz/i);await f.c.resume(A);assert.equal(f.s.conversations[A].paused,false);
});
test('explicit resume during edit restores only future intent, never bypassing the reservation',async()=>{
 const f=fixture(),j=f.add();await f.c.pause(A);await begin(f,j);await f.c.resume(A);assert.equal(f.s.conversations[A].paused,true);f.pages.get(1).state='idle';await f.steps();assert.equal(f.sends.length,0);await end(f,j);assert.equal(f.s.conversations[A].paused,false);
});

test('atomic save checks the displayed base even for an unversioned external change',async()=>{
 const f=fixture(),j=f.add();await begin(f,j);await f.store.changeState(s=>s.jobs[0].text='External change');
 await assert.rejects(end(f,j,{save:true,base:'Original',text:'Stale edit'}),/cambió/);assert.equal(f.s.jobs[0].text,'External change');assert.equal(f.s.conversations[A].paused,true);
});
test('unacknowledged completion evidence is never silently evicted at the per-owner cap',async()=>{
 const f=fixture(),j=f.add();for(let i=0;i<256;i++){const token='retained-token-'+i;await begin(f,j,token);await end(f,j,{},token);}
 await assert.rejects(begin(f,j,'retained-token-256'),/demasiadas/);assert.equal(f.s.conversations[A].paused,false);assert.equal(f.s.conversations[A].editReceipts.length,256);
 await f.c.ackEdit({id:j.id,token:'retained-token-0',owner:'view-a'});await begin(f,j,'retained-token-256');await end(f,j,{},'retained-token-256');
});
