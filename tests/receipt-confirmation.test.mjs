import test from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './dom-harness.mjs';
import * as M from '../core/model.mjs';
const A='11111111-1111-4111-8111-111111111111';
const quote='# Selected text:\n\n## Selection 1\n\n> Original quoted words\n\n## My request:\n\nTest follow-up';
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const bubble=(id,body)=>`<div data-message-id="${id}" data-user-message-bubble="true">${body}</div>`;
const page=messages=>dom(`<html><body><main>${messages}<form data-chatgpt-composer=""><div data-composer-markdown="" contenteditable="true" role="textbox"><p></p></div><button aria-label="Start Voice"></button></form></main></body></html>`);
const full=s=>`<div data-message-text="">${esc(s)}</div>`;
const rendered='<div class="markdown"><h1 data-search-result-target="">Selected text:</h1><h2 data-search-result-target="">Selection 1</h2><blockquote><p data-search-result-target="">Original quoted words</p></blockquote><h2 data-search-result-target="">My request:</h2><p data-search-result-target="">Test follow-up</p></div>';
function pending(text=quote){const s=M.newState();const j=M.addJob(s,{target:{id:A,url:`https://chatgpt.com/c/${A}`},text,files:[],sourceTabId:4});M.markPreparing(s,j.id,4,{lastUser:{id:'before'},finalId:'old-final'},1);M.markSubmitting(s,j.id,2);return {s,j};}
test('all split message text blocks participate in the receipt, not just the first',()=>{
 const {j}=pending('First paragraph\nSecond paragraph');const x=page(bubble('after','<div data-search-result-target=""><p>First paragraph</p></div><div data-search-result-target=""><p>Second paragraph</p></div>'));
 assert.equal(M.receiptMatches(j,x.page().lastUser),true);
 const {j:partial}=pending('First paragraph');assert.equal(M.receiptMatches(partial,x.page().lastUser),false);
});
test('nested text selectors do not duplicate a user message',()=>{const {j}=pending('A complete message');const x=page(bubble('after','<div data-search-result-target=""><div class="whitespace-pre-wrap"><span data-message-text="">A complete message</span></div></div>'));assert.equal(M.receiptMatches(j,x.page().lastUser),true);});
test('literal Markdown quotes are still matched exactly',()=>{const {j}=pending();assert.equal(M.receiptMatches(j,page(bubble('after',full(quote))).page().lastUser),true);});
test('rendered headings and blockquote reconstruct the complete quoted message',()=>{const {j}=pending();const r=page(bubble('after',rendered)).page().lastUser;assert.equal(M.receiptMatches(j,r),true);});
test('a rendered quote cannot be mistaken for its first heading or only its request',()=>{
 const r=page(bubble('after',rendered)).page().lastUser;
 for(const t of ['Selected text:','Test follow-up','Original quoted words'])assert.equal(M.receiptMatches(pending(t).j,r),false);
});
test('missing quote or altered request cannot acknowledge a selected-text message',()=>{
 const {j}=pending();for(const html of [rendered.replace('Original quoted words','Other words'),rendered.replace('Test follow-up','Other request'),rendered.replace(/<blockquote>[\s\S]*?<\/blockquote>/,'')])assert.equal(M.receiptMatches(j,page(bubble('after',html)).page().lastUser),false);
});
test('plain message content can be the user bubble itself',()=>{const {j}=pending('Whole text');assert.equal(M.receiptMatches(j,page('<div data-message-id="after" data-user-message-bubble="true" data-message-text="">Whole text</div>').page().lastUser),true);});
test('copy controls and hidden decorative text are excluded, content is retained',()=>{const {j}=pending('Whole text');const x=page(bubble('after','<div data-message-text="">Whole text<button>Copy</button><span aria-hidden="true">decoration</span></div>'));assert.equal(M.receiptMatches(j,x.page().lastUser),true);});
test('read-only receipt inspection never clicks buttons or changes draft',()=>{const x=page(bubble('after',rendered));let clicks=0;for(const b of x.document.querySelectorAll('button'))b.click=()=>clicks++;const before=x.document.querySelector('[contenteditable]').textContent;x.page({cmd:'inspect',receiptAfter:'before'});assert.equal(clicks,0);assert.equal(x.document.querySelector('[contenteditable]').textContent,before);});
test('read the submitted message immediately after the saved baseline even with a later manual message',()=>{
 const {j}=pending();const x=page(bubble('before',full('Previous'))+bubble('sent',rendered)+bubble('later',full('A later manual message')));const snap=x.page({cmd:'inspect',receiptAfter:'before'});
 assert.equal(snap.receiptAnchorFound,true);assert.equal(snap.submittedUser?.id,'sent');assert.equal(snap.lastUser.id,'later');assert.equal(M.confirmedReceipt?.(j,snap)?.id,'sent');
});
test('historical scan is anchored, never any old identical message',()=>{
 const {j}=pending();const snap=page(bubble('old',full(quote))+bubble('before',full('Previous'))+bubble('later',full('Different'))).page({cmd:'inspect',receiptAfter:'before'});
 assert.equal(snap.receiptAnchorFound,true);assert.equal(M.confirmedReceipt?.(j,snap)??null,null);
});
test('intervening mismatched message prevents acknowledging a later identical message',()=>{
 const {j}=pending();const snap=page(bubble('before',full('Previous'))+bubble('intervening',full('Different'))+bubble('later',full(quote))).page({cmd:'inspect',receiptAfter:'before'});
 assert.equal(snap.receiptAnchorFound,true);assert.equal(M.confirmedReceipt?.(j,snap)??null,null);
});
test('absent baseline does not fabricate an anchored historical receipt',()=>{const snap=page(bubble('old',full(quote))+bubble('later',full('Different'))).page({cmd:'inspect',receiptAfter:'missing'});assert.equal(snap.receiptAnchorFound,false);assert.equal(snap.submittedUser,null);});
test('duplicate baseline IDs fail closed instead of selecting an arbitrary branch',()=>{const snap=page(bubble('before',full('Previous'))+bubble('sent',full(quote))+bubble('before',full('Duplicate'))).page({cmd:'inspect',receiptAfter:'before'});assert.equal(snap.receiptAnchorFound,false);assert.equal(snap.submittedUser,null);});
test('assistant quotation is never accepted as a user receipt',()=>{const {j}=pending();const snap=page(bubble('before',full('Previous'))+`<div data-message-author-role="assistant" data-message-id="assistant">${rendered}</div>`).page({cmd:'inspect',receiptAfter:'before'});assert.equal(M.receiptMatches(j,snap.lastUser),false);});
test('attachment receipt verification is still required for every queued file',()=>{const {j}=pending();j.files=[{name:'required.pdf',type:'application/pdf'}];const r=page(bubble('sent',rendered)).page().lastUser;assert.equal(M.receiptMatches(j,r),false);r.files=['required.pdf'];assert.equal(M.receiptMatches(j,r),true);});
const timeout='ChatGPT no ha confirmado el envío. Revisa esta pestaña antes de continuar.';
test('late confirmed receipt releases only its own automatic confirmation pause',()=>{
 const {s,j}=pending();j.status='uncertain';j.reason=timeout;s.conversations[A].paused=true;s.conversations[A].reason=timeout;
 M.acknowledge(s,j.id,{id:'sent',text:quote,files:[]},{state:'idle'},5);assert.equal(s.jobs.length,0);assert.equal(s.conversations[A].paused,false);assert.equal(s.conversations[A].reason,'');
});
test('late receipt never removes manual, import, unknown, or global pauses',()=>{
 for(const reason of ['Pausa manual','Cola importada','Unknown pause']){const {s,j}=pending();j.status='uncertain';j.reason=timeout;s.paused=true;s.reason='Pausa manual';s.conversations[A].paused=true;s.conversations[A].reason=reason;M.acknowledge(s,j.id,{id:'sent',text:quote,files:[]},{state:'idle'},5);assert.equal(s.paused,true);assert.equal(s.conversations[A].paused,true);assert.equal(s.conversations[A].reason,reason);}
});
test('another review job keeps its conversation paused after one receipt matches',()=>{const {s,j}=pending();j.status='uncertain';j.reason=timeout;s.conversations[A].paused=true;s.conversations[A].reason=timeout;const other=M.addJob(s,{target:{id:A,url:`https://chatgpt.com/c/${A}`},text:'Other',files:[],sourceTabId:4});other.status='held';M.acknowledge(s,j.id,{id:'sent',text:quote,files:[]},{state:'idle'},5);assert.equal(s.conversations[A].paused,true);});
test('when a known baseline is not loaded, even matching latest text cannot prove order',()=>{
 const {j}=pending();const snap=page(bubble('old-identical',full(quote))).page({cmd:'inspect',receiptAfter:'before'});
 assert.equal(snap.receiptAnchorFound,false);assert.equal(M.confirmedReceipt(j,snap),null);
});
test('a genuinely new chat with no baseline can confirm its first message',()=>{
 const {j}=pending();j.attempt.beforeUser=null;const snap=page(bubble('first',full(quote))).page({cmd:'inspect',receiptAfter:null});
 assert.equal(M.confirmedReceipt(j,snap)?.id,'first');
});

test('new quote transport stays readable without the special native selection envelope',()=>{
 const card='<span><span class="whitespace-pre-wrap">Quoted words</span><button aria-label="Selection 1"></button><button aria-label="Remove selected text 1"></button></span>';
 const x=dom(`<html><body><form data-chatgpt-composer><div data-composer-attachments>${card}</div><div data-composer-markdown contenteditable="true" role="textbox"><p>Follow-up</p></div><button aria-label="Send"></button></form></body></html>`);
 const captured=x.page({cmd:'capture'});
 assert.deepEqual(Array.from(captured.attachments.selections),['Quoted words']);
 assert.equal(captured.queueText,'# Quoted context:\n\n## Excerpt 1\n\n> Quoted words\n\n## Request:\n\nFollow-up');
 const rendered='<div class="markdown"><h1>Quoted context:</h1><h2>Excerpt 1</h2><blockquote><p>Quoted words</p></blockquote><h2>Request:</h2><p>Follow-up</p></div>';
 assert.equal(M.receiptMatches(pending(captured.queueText).j,page(bubble('after',rendered)).page().lastUser),true);
});
test('a collapsed selection counter and matching request alone cannot prove the whole legacy message',()=>{
 const {j}=pending();const r=page(bubble('before',full('Previous'))+bubble('after','<button aria-label="1 selection">1 selection</button>'+full('Test follow-up'))).page({cmd:'inspect',receiptAfter:'before'});
 assert.equal(M.confirmedReceipt(j,r),null);
});
test('manual delivery confirmation cannot strand an unbound new-chat queue',()=>{
 const s=M.newState(),target={id:'draft:initial',url:'https://chatgpt.com/'};
 const j=M.addJob(s,{target,text:'First',files:[],sourceTabId:4});M.addJob(s,{target,text:'Second',files:[],sourceTabId:4});
 M.markPreparing(s,j.id,4,{},1);M.markSubmitting(s,j.id,2);j.status='uncertain';
 const before=structuredClone(s);assert.throws(()=>M.confirmDelivered(s,j.id),/destino/);assert.deepEqual(s,before);
});
test('search-unit-only user receipt with explicit ID is recognized without duplicating nested standard bubbles',()=>{
 const {j}=pending();const wrap=(id,body)=>`<div data-chatgpt-search-unit-key="turn:0:user" data-chatgpt-search-message-ids="${id}">${body}</div>`;
 const r=page(wrap('before',bubble('before',full('Previous')))+wrap('after',full(quote))).page({cmd:'inspect',receiptAfter:'before'});
 assert.equal(r.receiptUserCount,2);assert.equal(M.confirmedReceipt(j,r)?.id,'after');
});
test('search-unit fallback never treats an assistant container as a user receipt',()=>{
 const {j}=pending();const r=page(bubble('before',full('Previous'))+`<div data-message-author-role="assistant"><div data-chatgpt-search-unit-key="turn:0:user" data-chatgpt-search-message-ids="after">${full(quote)}</div></div>`).page({cmd:'inspect',receiptAfter:'before'});
 assert.equal(M.confirmedReceipt(j,r),null);
});
test('a verified delivery can release recognized interrupted-send pauses while preserving unrelated reasons',()=>{
 for(const reason of ['El navegador se cerró durante un posible envío. No se reintentará solo.','Envío incierto; no se repetirá automáticamente. El borrador queda guardado. Lost response','No se sabe si ChatGPT recibió el envío. No se reintentará solo. Lost response','Pausa manual','Unknown pause']){
  const {s,j}=pending();j.status='uncertain';j.reason=reason;s.conversations[A].paused=true;s.conversations[A].reason=reason;
  M.confirmDelivered(s,j.id,5);assert.equal(s.conversations[A].paused,['Pausa manual','Unknown pause'].includes(reason));
 }
});
