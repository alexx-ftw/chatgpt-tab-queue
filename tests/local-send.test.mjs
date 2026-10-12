import test from 'node:test';import assert from 'node:assert/strict';
import {dom,fixture} from './dom-harness.mjs';
const A='11111111-1111-4111-8111-111111111111';
function edit(x){
 const e=x.document.querySelector('[data-composer-markdown]'),p=e.querySelector('p');
 const selection={from:1,to:1,constructor:{create:(_d,from,to)=>({from,to})}};
 const doc={content:{size:p.textContent.length},textBetween:()=>p.textContent,toJSON:()=>({text:p.textContent})};
 const schema={nodes:{paragraph:{create:(_a,t)=>t||''}},text:t=>t,nodeFromJSON:d=>({content:[d.text]})};
 const tr={replaceWith(_a,_b,c){this.content=c;return this;},setMeta(){return this;},setSelection(s){this.selection=s;return this;}};
 e.pmViewDesc={view:{dom:e,state:{doc,schema,selection,tr},dispatch(t){p.textContent=t.content.join('\n');doc.content.size=p.textContent.length;}}};
 return {e,p};
}
function args(x,extra={}){const s=x.page({cmd:'capture'});return {cmd:'localSend',token:'t1',conversationId:A,text:'solo el mensaje encolado',expectText:s.text,expectDoc:s.doc,beforeUser:s.lastUser?.id||null,expectedFiles:[],options:[],...extra};}
test('localSend sends only queued text and restores a nonempty original draft',async()=>{
 const x=dom(fixture('idle')),v=edit(x);v.p.textContent='mi borrador todavía sin terminar';
 let sent=[];x.document.querySelector('button[aria-label="Send"]').click=()=>{sent.push(v.p.textContent);v.p.textContent='';};
 const r=await x.page(args(x));assert.equal(r.clicked,true);assert.equal(r.restored,true);assert.deepEqual(sent,['solo el mensaje encolado']);assert.equal(v.p.textContent,'mi borrador todavía sin terminar');
});
test('localSend rejects a changed draft without overwriting or sending it',async()=>{
 const x=dom(fixture('idle')),v=edit(x);const a=args(x);v.p.textContent='edición nueva';let clicks=0;x.document.querySelector('button[aria-label="Send"]').click=()=>clicks++;
 const r=await x.page(a);assert.equal(r.clicked,false);assert.equal(r.restored,true);assert.equal(v.p.textContent,'edición nueva');assert.equal(clicks,0);
});
test('localSend does not click any control while a response is busy',async()=>{
 const x=dom(fixture('busy')),v=edit(x);let clicks=0;for(const b of x.document.querySelectorAll('button'))b.click=()=>clicks++;
 const r=await x.page(args(x));assert.equal(r.clicked,false);assert.equal(clicks,0);
});
test('localSend fails closed on a route change',async()=>{
 const x=dom(fixture('idle'));const r=await x.page(args(x,{conversationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}));assert.equal(r.clicked,false);
});
test('file preparation reserves the existing editor and cancellation restores its draft',async()=>{
 const x=dom(fixture('idle')),v=edit(x);v.p.textContent='borrador original';
 const r=x.page({cmd:'localBegin',token:'files',conversationId:A,text:'pendiente con archivos',expectedFiles:[]});assert.equal(r.ok,true);assert.equal(r.backup.text,'borrador original');
 x.page({cmd:'write',snapshot:{text:'pendiente con archivos'}});
 assert.equal(x.page({cmd:'localCheck',token:'files',conversationId:A}).ok,true);
 const ended=await x.page({cmd:'localEnd',token:'files',conversationId:A,expectedFiles:[]});assert.equal(ended.ok,true);assert.equal(v.p.textContent,'borrador original');
});
test('reservation rejects a stale token and prevents accidental native submission of queued files',()=>{
 const x=dom(fixture('idle')),v=edit(x);x.page({cmd:'localBegin',token:'files',conversationId:A,text:'file text',expectedFiles:[]});
 assert.equal(x.page({cmd:'localCheck',token:'stale',conversationId:A}).ok,false);
 let prevented=false;x.document.dispatchEvent({type:'keydown',key:'Enter',target:v.e,isTrusted:true,preventDefault(){prevented=true;},stopImmediatePropagation(){}});assert.equal(prevented,true);
});
test('localSend never changes native model or tools to match a queued message',async()=>{
 const x=dom(fixture('idle')),v=edit(x),before=v.p.textContent;const r=await x.page(args(x,{model:{effort:'does-not-match'}}));assert.equal(r.clicked,false);assert.equal(v.p.textContent,before);
});
test('a possible click exception is uncertain, never reported as definitely unsent',async()=>{
 const x=dom(fixture('idle')),v=edit(x);v.p.textContent='borrador';x.document.querySelector('button[aria-label="Send"]').click=()=>{throw Error('lost result after dispatch');};
 const r=await x.page(args(x));assert.equal(r.clicked,null);assert.equal(v.p.textContent,'borrador');
});
test('a file lease token must still be valid at the final native send gate',()=>{
 const x=dom(fixture('idle')),v=edit(x);x.page({cmd:'localBegin',token:'real',conversationId:A,text:v.p.textContent,expectedFiles:[]});let clicks=0;x.document.querySelector('button[aria-label="Send"]').click=()=>clicks++;
 const r=x.page({cmd:'send',conversationId:A,token:'stale',text:v.p.textContent,expectedFiles:[]});assert.equal(r.clicked,false);assert.equal(clicks,0);
});
test('reservation marks the composer so Tab cannot enqueue the transient outgoing prompt',async()=>{
 const x=dom(fixture('idle'));x.page({cmd:'localBegin',token:'files',conversationId:A,text:'pending',expectedFiles:[]});
 assert.equal(x.document.querySelector('form').getAttribute('data-cq-reservation'),'files');await x.page({cmd:'localEnd',token:'files',conversationId:A,expectedFiles:[]});
 assert.equal(x.document.querySelector('form').hasAttribute('data-cq-reservation'),false);
});
test('navigation during a cancelled send does not falsely report the original draft restored',async()=>{
 const x=dom(fixture('idle')),v=edit(x),button=x.document.querySelector('button[aria-label="Send"]'),view=v.e.pmViewDesc.view;
 const dispatch=view.dispatch.bind(view);view.dispatch=t=>{dispatch(t);if(v.p.textContent==='solo el mensaje encolado')button.setAttribute('disabled','');};
 const pending=x.page(args(x));x.context.location.pathname='/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 const cancelled=await x.page({cmd:'localEnd',token:'t1',conversationId:A,expectedFiles:[]});assert.equal(cancelled.ok,false);
 const r=await pending;assert.equal(r.clicked,false);assert.equal(r.restored,false);
});

test('a detached composer reservation does not block the replacement editor after navigation',async()=>{
 const x=dom(fixture('idle')),v=edit(x);v.p.textContent='borrador A';
 const old=x.page({cmd:'localBegin',token:'old-reservation',conversationId:A,text:'archivos A',expectedFiles:[]});assert.equal(old.ok,true);
 // React may replace just the composer while reusing the same document and route.
 const oldForm=x.document.querySelector('form');oldForm.parentNode.removeChild(oldForm);
 // Import a patched element fixture as the replacement tree, with connectivity controlled by this document.
 oldForm.parentNode=null;
 // Temporarily move away. The stale lease is a JS object, not a new page.
 x.context.location.pathname='/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';x.page({cmd:'inspect'});
 assert.equal(!!x.context.__cqExistingComposerV4,false,'navigation must release old event reservations');
});
test('an expired untouched reservation is released and the same live draft can be reserved again',()=>{
 const x=dom(fixture('idle'));edit(x);
 assert.equal(x.page({cmd:'localBegin',token:'old',conversationId:A,text:'pending',expectedFiles:[]}).ok,true);
 x.context.__cqExistingComposerV4.expires=0;
 const next=x.page({cmd:'localBegin',token:'new',conversationId:A,text:'pending',expectedFiles:[]});
 assert.equal(next.ok,true,'expired lease must not permanently occupy the composer');
});
test('native Enter in the next SPA route is not blocked by an old lease even before a poll',()=>{
 const x=dom(fixture('idle')),v=edit(x);x.page({cmd:'localBegin',token:'files',conversationId:A,text:'file text',expectedFiles:[]});
 x.context.location.pathname='/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 let prevented=false;x.document.dispatchEvent({type:'keydown',key:'Enter',target:v.e,isTrusted:true,preventDefault(){prevented=true;},stopImmediatePropagation(){}});
 assert.equal(prevented,false,'a lease from A must not swallow native Enter in B');
 assert.equal(!!x.context.__cqExistingComposerV4,false);
});
test('Tiptap DOM editor reference is used when pmViewDesc exposes no view',async()=>{
 const x=dom(fixture('idle')),v=edit(x),view=v.e.pmViewDesc.view;
 v.e.pmViewDesc={node:view.state.doc};v.e.editor={view};
 v.e.focus=()=>{throw Error('must not require focus');};
 let sent=[];x.document.querySelector('button[aria-label="Send"]').click=()=>{sent.push(v.p.textContent);v.p.textContent='';};
 const a={...args(x),expectDoc:{text:v.p.textContent}};
 const r=await x.page(a);assert.equal(r.clicked,true);assert.deepEqual(sent,['solo el mensaje encolado']);assert.equal(r.restored,true);
});
