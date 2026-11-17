import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,addJob,targetFromURL} from '../core/model.mjs';
import {validateBackup} from '../core/backup.mjs';
import {createCoordinator} from '../core/coordinator.mjs';
const url='https://chatgpt.com/dots/11111111-1111-4111-8111-111111111111~22222222222242228222222222222222';
function backup(destination=url){const state=newState(),target=targetFromURL(destination);addJob(state,{target,text:'Pending',files:[]});return {format:'chatgpt-queue-backup',version:1,state,files:[],parts:[]};}
for(const kind of [undefined,'chatgpt','other'])test(`import derives dot transport rather than trusting kind=${kind}`,()=>{
 const b=backup(),id=Object.keys(b.state.conversations)[0],c=b.state.conversations[id];
 if(kind===undefined)delete c.kind;else c.kind=kind;
 c.isNew=true;
 const result=validateBackup(b).state;
 assert.equal(result.conversations[id].kind,'dot');assert.equal(result.conversations[id].isNew,false);
 assert.equal(result.paused,true);assert.equal(result.jobs[0].status,'queued');assert.equal(result.jobs[0].text,'Pending');
 assert.equal(c.isNew,true,'validation must not mutate the supplied backup object');
});
test('a normal chat cannot inherit a forged dot transport type',()=>{
 const b=backup('https://chatgpt.com/c/11111111-1111-4111-8111-111111111111'),id=Object.keys(b.state.conversations)[0];b.state.conversations[id].kind='dot';b.state.conversations[id].isNew=true;
 const r=validateBackup(b).state;assert.equal(r.conversations[id].kind,undefined);assert.equal(r.conversations[id].isNew,false);assert.equal(r.jobs[0].status,'queued');
});
test('resumed imported dot never requests a background frame when metadata was absent',async()=>{
 const b=backup(),id=Object.keys(b.state.conversations)[0];delete b.state.conversations[id].kind;
 let state=validateBackup(b).state;state.paused=false;
 const store={getState:async()=>structuredClone(state),changeState:async fn=>{const s=structuredClone(state),result=fn(s);state=s;return {state:structuredClone(s),result};}};
 let frames=0;const io={now:()=>10000,changed:async()=>{},listTabs:async()=>[],getTab:async()=>null,ensureBackground:async()=>{frames++;return null;}};
 await createCoordinator({store,io}).tick();assert.equal(frames,0);assert.equal(state.jobs.length,1);assert.equal(state.jobs[0].status,'queued');
});
