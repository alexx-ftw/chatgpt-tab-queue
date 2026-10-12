import test from 'node:test';import assert from 'node:assert/strict';import {newState,addJob} from '../core/model.mjs';
async function load(){let m;try{m=await import('../core/backup.mjs');}catch{}assert.equal(typeof m?.validateBackup,'function');return m;}
const target={id:'11111111-1111-4111-8111-111111111111',url:'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111'};
test('backup validation preserves text and exact bytes, imports paused and drops live destinations',async()=>{
 const m=await load(),s=newState();addJob(s,{target,text:'private draft',files:[{id:'file1',name:'a.bin',size:3,type:'application/octet-stream'}],sourceTabId:9});
 const b={format:'chatgpt-queue-backup',version:1,state:s,files:[{id:'file1',name:'a.bin',size:3,ready:true,next:1,bytes:3}],parts:[{fileId:'file1',index:0,data:'AAH/'}]};
 const result=m.validateBackup(b);assert.equal(result.state.paused,true);assert.equal(result.state.jobs[0].text,'private draft');assert.deepEqual([...new Uint8Array(result.parts[0].bytes)],[0,1,255]);assert.deepEqual(result.state.helpers,{});
});
test('backup rejects truncated attachment bytes',async()=>{
 const m=await load(),s=newState();addJob(s,{target,text:'x',files:[{id:'f',name:'a',size:5}]});
 assert.throws(()=>m.validateBackup({format:'chatgpt-queue-backup',version:1,state:s,files:[{id:'f',size:5,ready:true}],parts:[{fileId:'f',index:0,data:'AA=='}]}));
});
test('backup rejects prototype pollution keys and non-ChatGPT routes',async()=>{
 const m=await load();assert.throws(()=>m.validateBackup(JSON.parse('{"__proto__":{}}')));
 const s=newState();addJob(s,{target,text:'x',files:[]});s.conversations[target.id].url='https://evil.example/';
 assert.throws(()=>m.validateBackup({format:'chatgpt-queue-backup',version:1,state:s,files:[],parts:[]}));
});
