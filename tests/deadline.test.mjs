import test from 'node:test';import assert from 'node:assert/strict';import {dom,fixture} from './dom-harness.mjs';
test('expired main-world commands cannot mutate the composer',()=>{
 const d=dom(fixture('idle'));const before=d.page({cmd:'inspect'}).text;
 const result=d.page({cmd:'write',snapshot:{text:'must never appear'},rpcDeadline:Date.now()-10});
 assert.equal(result.cqExpired,true);assert.equal(d.page({cmd:'inspect'}).text,before);
});
