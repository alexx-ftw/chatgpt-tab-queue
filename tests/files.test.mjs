import test from 'node:test';import assert from 'node:assert/strict';
import {selectCapturedFiles} from '../core/files.mjs';
const f=(name,type='application/pdf')=>({name,type,size:10,lastModified:1});
test('maps native documents by full filename, not partial extension',()=>{
 const a=f('a.pdf'),b=f('b.pdf');assert.deepEqual(selectCapturedFiles({count:1,items:[{label:'Remove b.pdf'}]},[a,b]),[b]);
});
test('anonymous images require exact capture count, never a guess among removed images',()=>{
 const a=f('a.png','image/png'),b=f('b.png','image/png');
 assert.deepEqual(selectCapturedFiles({count:2,items:[{image:true},{image:true}]},[a,b]),[a,b]);
 assert.throws(()=>selectCapturedFiles({count:1,items:[{image:true}]},[a,b]));
});
test('unknown cloud/library references fail closed',()=>{
 assert.throws(()=>selectCapturedFiles({unsupported:true,count:1,items:[]},[]));
});
test('same-name multiple candidates are rejected rather than attached incorrectly',()=>{
 assert.throws(()=>selectCapturedFiles({count:1,items:[{label:'same.pdf'}]},[f('same.pdf'),{...f('same.pdf'),size:20}]));
});
test('captured originals can be enqueued while native uploads are still in progress',()=>{
 const a=f('uploading.pdf');assert.deepEqual(selectCapturedFiles({count:1,loading:true,items:[{name:'uploading.pdf'}]},[a]),[a]);
});
test('a filename is not confused with its suffix in another filename',()=>{
 const a=f('a.pdf'),b=f('aa.pdf');assert.deepEqual(selectCapturedFiles({count:1,items:[{label:'Remove aa.pdf'}]},[a,b]),[b]);
});
test('filenames with spaces and Unicode match full native labels',()=>{
 const a=f('Informe de avión ①.pdf');assert.deepEqual(selectCapturedFiles({count:1,items:[{label:'Remove Informe de avión ①.pdf Informe de avión ①.pdf PDF 1 MB'}]},[a]),[a]);
});
