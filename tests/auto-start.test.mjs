import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,addJob,markPreparing,markSubmitting,recoverAfterRestart,recoverAfterUpdate,migrateState,clearQueue} from '../core/model.mjs';
import {validateBackup} from '../core/backup.mjs';
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const OLD='Colas recuperadas tras reiniciar el navegador. Revisa y pulsa Reanudar.';
const add=(s,id=A,text='pendiente')=>addJob(s,{target:{id,url:`https://chatgpt.com/c/${id}`},text,files:[],sourceTabId:4});

test('fresh queues start running, including successive batches in the same chat',()=>{
 const s=newState();add(s);assert.equal(s.paused,false);assert.equal(s.conversations[A].paused,false);
 clearQueue(s);add(s);assert.equal(s.paused,false);assert.equal(s.conversations[A].paused,false);
});
test('restart keeps untouched queued messages running with their document and attachment references',()=>{
 const s=newState(),j=add(s);j.doc={type:'doc',content:[]};j.files=[{id:'local-file',name:'fixture.pdf',size:3}];
 const saved=structuredClone(j);s.helpers[A]={tabId:4};recoverAfterRestart(s);
 assert.equal(s.paused,false);assert.equal(s.conversations[A].paused,false);assert.equal(s.reason,'');
 assert.deepEqual(s.jobs,[saved]);assert.deepEqual(s.helpers,{});
});
test('restart while only waiting for an answer does not poison the next queue',()=>{
 const s=newState();add(s);s.jobs=[];s.conversations[A].waiting={receiptId:'sent',sawBusy:true};
 recoverAfterRestart(s);add(s,A,'nuevo');
 assert.equal(s.paused,false);assert.equal(s.conversations[A].paused,false);
 assert.deepEqual(s.conversations[A].waiting,{receiptId:'sent',sawBusy:true});
});
test('explicit global pause survives restart with its original reason',()=>{
 const s=newState();add(s);s.paused=true;s.reason='Pausa manual';recoverAfterRestart(s);add(s,B);
 assert.equal(s.paused,true);assert.equal(s.reason,'Pausa manual');
});
test('manual per-conversation pause is retained without pausing independent chats',()=>{
 const s=newState();add(s);add(s,B);s.conversations[A].paused=true;s.conversations[A].reason='Pausa manual';
 recoverAfterRestart(s);assert.equal(s.paused,false);assert.equal(s.conversations[A].paused,true);
 assert.equal(s.conversations[A].reason,'Pausa manual');assert.equal(s.conversations[B].paused,false);
});
test('restart quarantines a possible send only in its conversation and preserves its receipt baseline',()=>{
 const s=newState(),j=add(s);markPreparing(s,j.id,4,{lastUser:{id:'before'}},1);markSubmitting(s,j.id,2);add(s,B);
 const attempt=structuredClone(j.attempt);recoverAfterRestart(s);
 assert.equal(s.paused,false);assert.equal(j.status,'uncertain');assert.deepEqual(j.attempt,attempt);
 assert.equal(s.conversations[A].paused,true);assert.equal(s.conversations[B].paused,false);
 assert.throws(()=>markPreparing(s,j.id,4,{},3));assert.doesNotThrow(()=>markPreparing(s,s.jobs[1].id,8,{},3));
});
test('interrupted preparation and draft backups remain held for review',()=>{
 const s=newState(),j=add(s);markPreparing(s,j.id,4,{},1).attempt.localBackup={text:'borrador'};
 s.draftBackups={saved:{conversationId:A,backup:{text:'borrador'}}};const backups=structuredClone(s.draftBackups);
 recoverAfterRestart(s);assert.equal(j.status,'error');assert.equal(s.conversations[A].paused,true);
 assert.equal(s.paused,false);assert.deepEqual(s.draftBackups,backups);
});
for(const status of ['held','error','uncertain'])test(`restart does not release ${status} messages or block an unrelated chat`,()=>{
 const s=newState(),j=add(s);j.status=status;add(s,B);recoverAfterRestart(s);
 assert.equal(j.status,status);assert.equal(s.paused,false);assert.equal(s.conversations[A].paused,true);
 assert.equal(s.conversations[B].paused,false);
});
test('migration removes the old automatic startup pause but preserves an explicit chat pause',()=>{
 const s=newState();add(s);add(s,B);s.paused=true;s.reason=OLD;s.conversations[B].paused=true;s.conversations[B].reason='Pausa manual';
 migrateState(s);assert.equal(s.paused,false);assert.equal(s.reason,'');assert.equal(s.conversations[B].paused,true);
});
test('migration removes stale automatic startup pause even with no pending messages',()=>{
 const s=newState();s.paused=true;s.reason=OLD;migrateState(s);add(s);
 assert.equal(s.paused,false);assert.equal(s.conversations[A].paused,false);
});
test('migration of an old recovery pause never retries unconfirmed or interrupted sends',()=>{
 const s=newState(),j=add(s);markPreparing(s,j.id,4,{},1);markSubmitting(s,j.id,2);add(s,B);
 s.paused=true;s.reason=OLD;migrateState(s);
 assert.equal(s.paused,false);assert.equal(j.status,'uncertain');assert.equal(s.conversations[A].paused,true);
 assert.equal(s.jobs[1].status,'queued');assert.equal(s.conversations[B].paused,false);
});
for(const reason of ['Pausa manual','Cola importada. Revisa los pendientes y pulsa Reanudar.','Motivo no reconocido',''])
 test(`migration preserves non-startup pause: ${reason||'unknown'}`,()=>{
 const s=newState();add(s);s.paused=true;s.reason=reason;migrateState(s);assert.equal(s.paused,true);assert.equal(s.reason,reason);
 });
test('migration is idempotent and cannot undo a subsequent manual pause',()=>{
 const s=newState();add(s);s.paused=true;s.reason=OLD;migrateState(s);assert.equal(s.paused,false);
 const once=structuredClone(s);migrateState(s);assert.deepEqual(s,once);
 s.paused=true;s.reason='Pausa manual';migrateState(s);assert.equal(s.paused,true);
});
test('upgrade repairs the legacy startup pause without changing safe queued content',()=>{
 const s=newState(),j=add(s);const saved=structuredClone(j);s.paused=true;s.reason=OLD;
 recoverAfterUpdate(s);assert.equal(s.paused,false);assert.deepEqual(s.jobs,[saved]);
});
test('imported backups still require explicit review across restart',()=>{
 const s=newState();add(s);const result=validateBackup({format:'chatgpt-queue-backup',version:1,state:s,files:[],parts:[]}).state;
 const reason=result.reason;recoverAfterRestart(result);assert.equal(result.paused,true);assert.equal(result.reason,reason);
});
