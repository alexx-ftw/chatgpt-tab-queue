import test from 'node:test';
import assert from 'node:assert/strict';
// Dynamic import makes missing implementation an assertion rather than a parse error.
async function load(){let m;try{m=await import('../core/page-rpc.mjs');}catch{}assert.equal(typeof m?.createPageRPC,'function','createPageRPC must exist');return m.createPageRPC;}
test('script RPC rejects null result with a recoverable code rather than forwarding null',async()=>{
 const factory=await load();const page=factory({execute:async()=>[{frameId:0,result:null}],func:()=>{}});
 await assert.rejects(page(1,{cmd:'inspect'}),e=>e.code==='PAGE_UNAVAILABLE');
});
test('script RPC selects top frame even when results arrive out of order',async()=>{
 const factory=await load();const page=factory({execute:async()=>[{frameId:2,result:null},{frameId:0,result:{route:'x'}}],func:()=>{}});
 assert.equal((await page(1,{cmd:'inspect'})).route,'x');
});
test('script RPC preserves false and zero valid results',async()=>{
 const factory=await load();for(const value of [false,0]){const page=factory({execute:async()=>[{frameId:0,result:value}],func:()=>{}});assert.equal(await page(1,{}),value);}
});
test('page calls request immediate injection and carry a bounded deadline',async()=>{
 const factory=await load();let invocation;
 const page=factory({execute:async a=>{invocation=a;return [{frameId:0,result:{ok:true}}];},func:()=>{},timeoutMs:2000});
 const before=Date.now();await page(7,{cmd:'inspect'});
 assert.equal(invocation.injectImmediately,true);
 assert.ok(invocation.args[0].rpcDeadline>before&&invocation.args[0].rpcDeadline<=Date.now()+2000);
});
test('an expired dispatch is a recoverable explicit non-execution result',async()=>{
 const factory=await load();const page=factory({execute:async()=>[{frameId:0,result:{cqExpired:true}}],func:()=>{}});
 await assert.rejects(page(1,{cmd:'localSend'}),e=>e.code==='PAGE_UNAVAILABLE'&&e.notStarted===true);
});
test('RPC never substitutes a child frame for a missing top-frame response',async()=>{
 const factory=await load();const page=factory({execute:async()=>[{frameId:9,result:{clicked:true}}],func:()=>{}});
 await assert.rejects(page(1,{cmd:'send'}),e=>e.code==='PAGE_UNAVAILABLE');
});
