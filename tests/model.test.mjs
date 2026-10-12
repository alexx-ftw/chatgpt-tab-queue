import test from 'node:test';
import assert from 'node:assert/strict';
import {newState, canonical, targetFromURL, addJob, markPreparing, markSubmitting, acknowledge, reconcileWait, recoverAfterRestart, pendingFor, receiptMatches} from '../core/model.mjs';
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const target=id=>({id,url:`https://chatgpt.com/c/${id}`,title:id});
const payload=(id=A,text='uno',files=[])=>({target:target(id),text,files,sourceTabId:4});
test('canonical handles NBSP, CRLF but keeps internal spacing',()=>assert.equal(canonical(' a\r\nb\u00a0 '),'a\nb'));
test('URL targets are restricted to HTTPS chatgpt.com',()=>{
 assert.equal(targetFromURL(`https://chatgpt.com/c/${A}?foo=1`).id,A);
 for(const url of [`https://evil.test/c/${A}`,`https://chatgpt.com.evil.test/c/${A}`,`javascript:alert(1)`,`http://chatgpt.com/c/${A}`]) assert.throws(()=>targetFromURL(url));
});
test('project/GPT nested conversation URL preserved without query',()=>assert.equal(targetFromURL(`https://chatgpt.com/g/g-123/c/${A}?x=1`).url,`https://chatgpt.com/g/g-123/c/${A}`));
test('empty message rejected, file-only message accepted',()=>{
 const s=newState(); assert.throws(()=>addJob(s,payload(A,' \n '),1));
 assert.equal(addJob(s,payload(A,'',[{id:'f',name:'photo.png',size:7,type:'image/png'}]),1).text,'');
});
test('independent queues remain FIFO even when selected chat changes',()=>{
 const s=newState(); const x=addJob(s,payload(A,'a'),1), y=addJob(s,payload(B,'b'),2),z=addJob(s,payload(A,'c'),3);
 assert.deepEqual(pendingFor(s,A).map(j=>j.id),[x.id,z.id]); assert.equal(pendingFor(s,B)[0].id,y.id);
});
test('only first queued item can be claimed',()=>{
 const s=newState();addJob(s,payload(A,'a'),1);const b=addJob(s,payload(A,'b'),2);
 assert.throws(()=>markPreparing(s,b.id,12,{lastUser:{id:'before'}},3));
});
test('duplicate prepare/submission attempts fail closed',()=>{
 const s=newState(), j=addJob(s,payload(),1);markPreparing(s,j.id,12,{lastUser:{id:'before'}},2);
 assert.throws(()=>markPreparing(s,j.id,12,{},3));markSubmitting(s,j.id,4);assert.throws(()=>markSubmitting(s,j.id,5));
});
test('ack removes sent item immediately and stores separate generation wait',()=>{
 const s=newState(),j=addJob(s,payload(),1);markPreparing(s,j.id,12,{lastUser:{id:'before'},finalId:'old'},2);markSubmitting(s,j.id,3);
 acknowledge(s,j.id,{id:'after',text:'uno'},{state:'busy'},4);
 assert.equal(s.jobs.length,0); assert.equal(s.conversations[A].waiting.receiptId,'after'); assert.equal(s.history.length,1);
});
test('generation wait cannot complete on stale same-text previous user turn',()=>{
 const s=newState(),j=addJob(s,payload(),1);markPreparing(s,j.id,12,{lastUser:{id:'before'},finalId:'old'},2);markSubmitting(s,j.id,3);
 assert.equal(receiptMatches(j,{id:'before',text:'uno'}),false);
 acknowledge(s,j.id,{id:'after',text:'uno'},{state:'busy'},4);
 assert.equal(reconcileWait(s,A,{state:'idle',lastUser:{id:'before'},finalId:'old',idleStable:true},5),false);
});
test('generation wait completes only with correct receipt and positive stable idle',()=>{
 const s=newState(),j=addJob(s,payload(),1);markPreparing(s,j.id,12,{lastUser:{id:'before'},finalId:'old'},2);markSubmitting(s,j.id,3);
 acknowledge(s,j.id,{id:'after',text:'uno'},{state:'busy'},4);
 assert.equal(reconcileWait(s,A,{state:'unknown',lastUser:{id:'after'},idleStable:true},5),false);
 assert.equal(reconcileWait(s,A,{state:'idle',lastUser:{id:'after'},idleStable:false},6),false);
 assert.equal(reconcileWait(s,A,{state:'idle',lastUser:{id:'after'},idleStable:true},7),true);
});
test('a fast response missed between polls is detected via a new final ID',()=>{
 const s=newState(),j=addJob(s,payload(),1);markPreparing(s,j.id,12,{finalId:'old'},2);markSubmitting(s,j.id,3);
 acknowledge(s,j.id,{id:'after',text:'uno'},{state:'idle'},4);
 assert.equal(reconcileWait(s,A,{state:'idle',lastUser:{id:'after'},finalId:'new',idleStable:true},5),true);
});
test('file-only receipt requires matching uploaded filenames',()=>{
 const s=newState(),j=addJob(s,payload(A,'',[{id:'f',name:'a.pdf',size:9}]),1);markPreparing(s,j.id,12,{lastUser:{id:'before'}},2);
 assert.equal(receiptMatches(j,{id:'after',text:'',files:['b.pdf']}),false);
 assert.equal(receiptMatches(j,{id:'after',text:'',files:['a.pdf']}),true);
});
test('text plus files cannot ACK a text-only submission',()=>{
 const s=newState(),j=addJob(s,payload(A,'Analiza',[{id:'f',name:'a.pdf',size:9}]),1);markPreparing(s,j.id,12,{},2);
 assert.equal(receiptMatches(j,{id:'new',text:'Analiza',files:[]}),false);
});
test('browser restart never blindly retries a possibly sent message',()=>{
 const s=newState(),j=addJob(s,payload(),1);markPreparing(s,j.id,12,{},2);markSubmitting(s,j.id,3);recoverAfterRestart(s);
 assert.equal(s.jobs[0].status,'uncertain'); assert.equal(s.paused,true);
});
test('initial homepage supported as a local draft target',()=>{const t=targetFromURL('https://chatgpt.com/','draft:4:abc');assert.equal(t.id,'draft:4:abc');assert.equal(t.isNew,true);});
test('new chat acknowledgement adopts real conversation for remaining jobs',()=>{
 const s=newState(),p=payload();p.target=targetFromURL('https://chatgpt.com/','draft:4:abc');const j=addJob(s,p,1);addJob(s,{...p,text:'dos'},2);
 markPreparing(s,j.id,12,{},3);markSubmitting(s,j.id,4);acknowledge(s,j.id,{id:'new',text:'uno'},{state:'busy',target:target(A)},5);
 assert.equal(s.jobs[0].conversationId,A);assert.equal(s.aliases['draft:4:abc'],A);
});

test('clear all removes pending in every conversation and returns file IDs, not active generation waits',async()=>{
 const {clearQueue}=await import('../core/model.mjs');const s=newState();
 const one=addJob(s,payload(A,'a',[{id:'file-a',name:'a.pdf',size:10}]),1);addJob(s,payload(B,'b',[{id:'file-b',name:'b.png',size:4}]),2);
 s.conversations[A].waiting={receiptId:'running',sawBusy:true};
 const removed=clearQueue(s);assert.equal(s.jobs.length,0);assert.equal(removed.length,2);assert.equal(s.conversations[A].waiting.receiptId,'running');
 assert.deepEqual(removed.flatMap(j=>j.files.map(f=>f.id)),['file-a','file-b']);assert.ok(s.cancelEpoch>0);
 assert.throws(()=>markSubmitting(s,one.id));
});
test('clear one conversation never removes another conversation',async()=>{
 const {clearQueue}=await import('../core/model.mjs');const s=newState();addJob(s,payload(A),1);addJob(s,payload(B),2);
 assert.equal(clearQueue(s,A).length,1);assert.equal(s.jobs[0].conversationId,B);
});
test('clear during a possible send leaves that conversation safety-paused',async()=>{
 const {clearQueue}=await import('../core/model.mjs');const s=newState(),j=addJob(s,payload(),1);
 markPreparing(s,j.id,12,{},2);markSubmitting(s,j.id,3);clearQueue(s);
 assert.equal(s.conversations[A].paused,true);assert.equal(s.jobs.length,0);
});
test('enqueue request IDs are idempotent for a lost runtime response',()=>{
 const s=newState(),p={...payload(),requestId:'request-1'};
 const a=addJob(s,p,1),b=addJob(s,p,2);assert.equal(a.id,b.id);assert.equal(s.jobs.length,1);
});
test('held capture cannot send before composer clearing is acknowledged',()=>{
 const s=newState(),j=addJob(s,{...payload(),hold:true},1);
 assert.equal(j.status,'held');assert.throws(()=>markPreparing(s,j.id,12,{},2));
});
test('image receipt can acknowledge unnamed image thumbnails after a matching new user turn',()=>{
 const s=newState(),j=addJob(s,payload(A,'mira',[{id:'i',name:'paste.png',type:'image/png',size:1}]),1);
 markPreparing(s,j.id,12,{lastUser:{id:'old'}},2);
 assert.equal(receiptMatches(j,{id:'new',text:'mira',files:[],imageCount:1}),true);
 assert.equal(receiptMatches(j,{id:'new',text:'mira',files:[],imageCount:0}),false);
});
test('paused job cannot cross the final submitting gate',()=>{
 const s=newState(),j=addJob(s,payload(),1);markPreparing(s,j.id,12,{},2);s.paused=true;
 assert.throws(()=>markSubmitting(s,j.id,3));
});
test('legacy migration preserves pending jobs and waits but relinquishes auxiliary tab ownership',async()=>{
 const {migrateState}=await import('../core/model.mjs');const s=newState();s.version=2;delete s.helpers;s.helper={tabId:18,conversationId:'old',jobId:'p'};s.jobs=[{id:'p',files:[{id:'file-original'}]}];s.conversations.old={waiting:{receiptId:'known'}};s.reason="Esperando al navegador: Cannot read properties of null (reading 'route')";
 migrateState(s);assert.equal(s.version,4);assert.deepEqual(s.helpers,{});assert.equal(s.jobs[0].files[0].id,'file-original');assert.equal(s.conversations.old.waiting.receiptId,'known');assert.equal(s.reason,'');assert.equal(s.helper,null);
});
