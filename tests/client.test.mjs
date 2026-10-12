import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function client(fail=false){const messages=[];const ctx=vm.createContext({Uint8Array,btoa,atob,chrome:{runtime:{sendMessage:async m=>{messages.push(m);if(fail&&m.type==='FILE_PART')return {ok:false,error:'storage full'};return {ok:true,value:m.type==='FILE_BEGIN'?{id:'f',...m.meta}:m.type==='FILE_FINISH'?{id:'f',ready:true}:true};}}}});vm.runInContext(readFileSync(new URL('../core/client.js',import.meta.url),'utf8'),ctx);return {api:ctx.CQClient,messages};}
test('local file transport preserves every byte over multiple runtime chunks',async()=>{
 const {api,messages}=client();const bytes=Uint8Array.from({length:650123},(_,i)=>i%256);const file=new File([bytes],'example.pdf',{type:'application/pdf'});
 await api.storeFile(file);const chunks=messages.filter(m=>m.type==='FILE_PART');assert.equal(chunks.length,4);assert.deepEqual(chunks.map(c=>c.index),[0,1,2,3]);
 assert.deepEqual(Buffer.concat(chunks.map(c=>Buffer.from(c.data,'base64'))),Buffer.from(bytes));assert.equal(messages.at(-1).type,'FILE_FINISH');
});
test('empty local files finish without losing file metadata',async()=>{
 const {api,messages}=client();await api.storeFile(new File([],'empty.txt',{type:'text/plain'}));assert.equal(messages[0].meta.size,0);assert.equal(messages[0].meta.name,'empty.txt');assert.equal(messages.at(-1).type,'FILE_FINISH');
});
test('failed file storage is reported and temporary bytes are scheduled for removal',async()=>{
 const {api,messages}=client(true);await assert.rejects(()=>api.storeFile(new File(['abc'],'a.txt')),/storage full/);assert.equal(messages.at(-1).type,'FILE_DELETE');assert.ok(!messages.some(m=>m.type==='FILE_FINISH'));
});
