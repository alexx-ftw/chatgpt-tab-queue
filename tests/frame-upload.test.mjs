/* Production content upload handler, with explicit mocked DOM and RPC boundaries. */
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const A='11111111-1111-4111-8111-111111111111',TOKEN='internal-upload';
function harness(missing=false){const listeners=[],calls=[],dispatches=[];const input={accept:'',getAttribute:()=> 'Attach files',dispatchEvent(e){dispatches.push(e);}};const parentInput={accept:'',dispatchEvent(){throw Error('Parent was touched');}};
 const childForm={querySelectorAll:()=>[input]},childDocument={querySelector:()=>childForm};const frame={isConnected:true,contentDocument:childDocument,getAttribute:()=>TOKEN};
 const document={readyState:'loading',addEventListener(){},querySelector:()=>({querySelectorAll:()=>[parentInput]}),querySelectorAll:()=>missing?[]:[frame]};
 class Transfer{constructor(){this.files=[];this.items={add:f=>this.files.push(f)};}}
 const ctx=vm.createContext({document,location:new URL('https://chatgpt.com/c/22222222-2222-4222-8222-222222222222'),crypto,Uint8Array,File,atob,DataTransfer:Transfer,Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},setTimeout,clearTimeout,console,
 CQClient:{prettySize:String,storeFile:()=>{},rpc:async(type,m)=>{calls.push({type,...m});if(type==='FILE_READ')return m.index===0?'AAEC/f7/':null;return true;}},
 CQPage:a=>{assert.equal(a.frameToken,TOKEN);return {ready:true,pathId:A,attachments:{count:0,unsupported:false}};},chrome:{runtime:{id:'test',getManifest:()=>({version:'0.6.0'}),onMessage:{addListener:fn=>listeners.push(fn)}}}});
 ctx.window={addEventListener(){}};vm.runInContext(readFileSync(new URL('../content.js',import.meta.url),'utf8'),ctx);
 const invoke=()=>{listeners[0]({channel:'cq2',type:'UPLOAD',jobId:'job1',token:'attempt1',frameToken:TOKEN,conversationId:A,files:[{id:'f1',name:'file.pdf',type:'application/pdf',size:6}]},{id:'test'},()=>{});};
 return {invoke,input,parentInput,calls,dispatches,async finished(){for(let i=0;i<50&&!calls.some(x=>x.type==='UPLOAD_RESULT');i++)await new Promise(r=>setImmediate(r));return calls.find(x=>x.type==='UPLOAD_RESULT');}};
}
test('queued bytes and native file-change event reach only the selected internal document',async()=>{const h=harness();h.invoke();const result=await h.finished();assert.ok(result&&!result.error);assert.equal(result.frameToken,TOKEN);assert.deepEqual([...new Uint8Array(await h.input.files[0].arrayBuffer())],[0,1,2,253,254,255]);assert.equal(h.parentInput.files,undefined);assert.equal(h.dispatches[0].type,'change');assert.equal(h.calls.find(x=>x.type==='FILE_READ').frameToken,TOKEN);});
test('missing file destination sends an error receipt and never uses parent file picker',async()=>{const h=harness(true);h.invoke();const result=await h.finished();assert.match(result.error,/interno se cerró/);assert.equal(h.input.files,undefined);assert.equal(h.parentInput.files,undefined);});
