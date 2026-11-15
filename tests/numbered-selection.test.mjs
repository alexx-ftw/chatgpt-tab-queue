import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './dom-harness.mjs';
import {receiptMatches} from '../core/model.mjs';
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const card=(n,text='Quoted passage '+n,opener='Selection '+n,remove='Remove selected text '+n)=>`<span class="group/composer-attachment"><span class="composer-attachment-surface"><span class="pointer-events-none"><span class="line-clamp-4 whitespace-pre-wrap">${esc(text)}</span></span><span><svg aria-hidden="true"></svg><span>${opener}</span></span><button type="button" aria-label="${opener}"></button></span><button type="button" aria-label="${remove}"></button></span>`;
const markup=(cards,body='<p>My request</p>',before='')=>`<html><body><main>${before}<form data-chatgpt-composer><div data-above-composer-portal data-above-composer-conversation-id="chatgpt:local-chatgpt:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"></div><div data-composer-attachments><div>${cards}</div></div><div data-composer-markdown contenteditable="true" role="textbox">${body}</div><button type="button" aria-label="Send"></button></form></main></body></html>`;
const quote=(ss,request)=>'# Selected text:\n\n'+ss.map((s,i)=>`## Selection ${i+1}\n\n> ${s}`).join('\n\n')+'\n\n## My request:\n\n'+request;
function setup(cards,body,before){const x=dom(markup(cards,body,before));vm.runInContext(readFileSync(new URL('../core/file-matching.js',import.meta.url),'utf8'),x.context);return x;}
for(const [name,cards] of [
 ['numbered English',card(1)+card(2)],['legacy unnumbered',card(1,'One','Selection')+card(2,'Two','Selection')],
 ['numbered Spanish',card(1,'Uno','Selección 1','Quitar texto seleccionado 1')+card(2,'Dos','Texto seleccionado 2','Eliminar texto seleccionado 2')],
 ['native arbitrary indices',card(3)+card(7)]
])test('capture accepts '+name+' selection labels without inventing files',()=>{
 const x=setup(cards),s=x.page({cmd:'capture'});assert.equal(s.attachments.unsupported,false);assert.equal(s.attachments.selections.length,2);assert.equal(x.context.CQSelectCapturedFiles(s.attachments,[]).length,0);assert.equal(s.queueDoc,null);
});
for(const opener of ['Selection 9','Selection 0','Selection 01','Selection 1 extra','Selection file','Selection 1.png'])test('reject inconsistent or misleading selection opener: '+opener,()=>{
 const x=setup(card(1,'Keep this passage',opener)),s=x.page({cmd:'capture'});assert.equal(s.attachments.unsupported,true);assert.throws(()=>x.context.CQSelectCapturedFiles(s.attachments,[]));assert.equal(x.document.querySelector('[data-composer-markdown]').textContent,'My request');
});
test('two numbered quotes preserve numbered reply and trailing empty paragraph',()=>{
 const x=setup(card(1)+card(2),'<ol start="1"><li><p>First reply</p></li><li><p>Second reply</p></li></ol><p><br class="ProseMirror-trailingBreak"/></p>');
 const s=x.page({cmd:'capture'});assert.equal(s.attachments.unsupported,false);assert.equal(s.text,'1. First reply\n2. Second reply\n');assert.equal(s.queueText,quote(['Quoted passage 1','Quoted passage 2'],s.text));
 assert.equal(x.document.querySelectorAll('ol').length,1);assert.equal(x.document.querySelectorAll('li').length,2);
});
for(const [body,want] of [
 ['<ol start="4"><li>First</li><li>Second</li></ol>','4. First\n5. Second'],
 ['<ol reversed=""><li>First</li><li>Second</li></ol>','2. First\n1. Second'],
 ['<ol start="3"><li>First</li><li value="9">Second</li><li>Third</li></ol>','3. First\n9. Second\n10. Third'],
 ['<ol reversed="" start="5"><li>First</li><li value="2">Second</li><li>Third</li></ol>','5. First\n2. Second\n1. Third'],
 ['<ol start="0"><li>First</li><li>Second</li></ol>','0. First\n1. Second'],
 ['<ol><li><p>Parent</p><ul><li>Child</li></ul></li><li><p>Next</p></li></ol>','1. Parent\n   - Child\n2. Next']
])test('list markers survive capture: '+want.replaceAll('\n',' / '),()=>assert.equal(setup(card(1,'Context','Selection'),body).page({cmd:'capture'}).text,want));
test('available ProseMirror document is kept, list numbering does not depend on textBetween',()=>{
 const x=setup('','<ol start="2"><li><p>First</p></li><li><p>Second</p></li></ol>'),e=x.document.querySelector('[data-composer-markdown]');
 const json={type:'doc',content:[{type:'orderedList',attrs:{start:2},content:[]}]};
 e.editor={view:{dom:e,state:{doc:{content:{size:12},textBetween:()=> 'First\nSecond',toJSON:()=>json},selection:{from:1,to:1}},dispatch(){throw Error('Read only');}}};
 const s=x.page({cmd:'capture'});assert.equal(s.text,'2. First\n3. Second');assert.deepEqual(s.doc,json);assert.deepEqual(s.queueDoc,json);
});
test('rendered rich list can confirm the numbered capture without dropping bold or numbering',()=>{
 const user='<div data-user-message-bubble="true" data-message-id="after"><div class="markdown"><ol start="2"><li><p><strong>First</strong></p></li><li><p>Second</p></li></ol></div></div>';
 const receipt=setup('',undefined,user).page().lastUser;
 assert.equal(receiptMatches({text:'2. First\n3. Second',files:[],attempt:{beforeUser:'before'}},receipt),true);
 assert.equal(receiptMatches({text:'1. First\n2. Second',files:[],attempt:{beforeUser:'before'}},receipt),false);
});
test('numbered file names remain files, not selected text',()=>{
 const x=setup('<span data-file-name="Selection 1.txt">Selection 1.txt<button aria-label="Remove file Selection 1.txt"></button></span>');
 const s=x.page({cmd:'capture'});assert.equal(s.attachments.selections.length,0);assert.equal(s.attachments.items[0].kind,'file');
});
test('numbered selection with opaque reference metadata remains blocked',()=>{
 const x=setup(card(1).replace('class="group/composer-attachment"','class="group/composer-attachment" data-file-id="opaque"'));assert.equal(x.page().attachments.unsupported,true);
});
for(const tag of ['ol','ul'])test('empty '+tag+' placeholder remains an empty composer, not an enqueued marker',()=>{
 const s=setup('',`<${tag}><li><p><br class="ProseMirror-trailingBreak"/></p></li></${tag}>`).page({cmd:'capture'});assert.equal(s.text,'');assert.equal(s.queueText,'');
});
test('changing a list ordinal invalidates the saved capture before cleanup',()=>{
 const x=setup(card(1),'<ol start="1"><li><p>Reply</p></li></ol>'),s=x.page({cmd:'capture'});
 let removed=0;for(const b of x.document.querySelectorAll('button'))b.click=()=>removed++;
 x.document.querySelector('ol').setAttribute('start','8');
 assert.throws(()=>x.page({cmd:'clear',expectText:s.queueText,sourceText:s.text,expectedFiles:[],selectedTexts:s.attachments.selections}));assert.equal(removed,0);assert.equal(x.document.querySelector('ol').getAttribute('start'),'8');
});
