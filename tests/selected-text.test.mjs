import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './dom-harness.mjs';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export const card=(text,n=1,extra='')=>`<span class="group/composer-attachment"><span class="composer-attachment-surface"><span class="pointer-events-none"><span class="line-clamp-4 whitespace-pre-wrap">${escape(text)}</span></span><span><svg aria-hidden="true"></svg><span>Selection</span></span><button aria-label="Selection" type="button"></button></span><button type="button" aria-label="Remove selected text ${n}" ${extra}></button></span>`;
const file=(name='document.pdf')=>`<span class="group/composer-attachment"><span data-file-name="${name}">${name}</span><button aria-label="Remove ${name}" type="button"></button></span>`;
export const markup=(cards,request='Compare these options')=>`<html><body><main><form data-chatgpt-composer><div data-above-composer-portal></div><div data-composer-attachments><div class="flex flex-wrap">${cards}</div></div><div contenteditable="true" data-composer-markdown role="textbox"><p>${escape(request)}</p></div><button aria-label="Send" type="button"></button></form></main></body></html>`;
const pack=(selections,text)=>'# Selected text:\n\n'+selections.map((s,i)=>`## Selection ${i+1}\n\n${s.split('\n').map(l=>'> '+l).join('\n')}`).join('\n\n')+'\n\n## My request:\n\n'+text;
function setup(cards,request){
 const x=dom(markup(cards,request));vm.runInContext(readFileSync(new URL('../core/file-matching.js',import.meta.url),'utf8'),x.context);
 const e=x.document.querySelector('[data-composer-markdown]'),p=e.querySelector('p');
 const doc={content:{size:p.textContent.length},textBetween:()=>p.textContent,toJSON:()=>({text:p.textContent})};
 const schema={nodes:{paragraph:{create:(_a,t)=>t||''}},text:t=>t,nodeFromJSON:d=>({content:[d.text]})};
 const tr={replaceWith(_a,_b,c){this.content=c;return this},setMeta(){return this},setSelection(){return this}};
 e.pmViewDesc={view:{dom:e,state:{doc,schema,selection:{from:1,to:1},tr},dispatch(t){p.textContent=t.content.join('\n');doc.content.size=p.textContent.length;}}};
 for(const b of x.document.querySelectorAll('button'))if((b.getAttribute('aria-label')||'').startsWith('Remove '))b.click=()=>b.parentNode.parentNode.removeChild(b.parentNode);
 return {...x,e,p,select:captured=>x.context.CQSelectCapturedFiles(x.page().attachments,captured)};
}
test('Selection is captured as quoted text, never looked up as a local File',()=>{
 const x=setup(card('Example combination')),s=x.page({cmd:'capture'});
 assert.equal(s.attachments.count,1);assert.equal(s.attachments.items[0].kind,'selection');assert.equal(s.attachments.unsupported,false);
 assert.deepEqual(Array.from(x.select([])),[]);assert.equal(s.text,'Compare these options');assert.equal(s.queueText,pack(['Example combination'],s.text));assert.equal(s.queueDoc,null);
 assert.equal(x.p.textContent,s.text);assert.equal(x.document.querySelectorAll('[aria-label="Selection"]').length,1);
});
test('multiple and identical selections retain DOM order, whitespace and line breaks',()=>{
 const texts=[' first\n  second & <code>\n','repeated','repeated'];const x=setup(texts.map((t,i)=>card(t,i+1)).join(''),'My request');
 const s=x.page({cmd:'capture'});assert.equal(s.queueText,pack(texts,'My request'));assert.equal(s.attachments.items.length,3);assert.equal(x.select([]).length,0);
});
test('CSS line clamping never truncates the selected text stored in the DOM',()=>{
 const full='Long selected passage\n'.repeat(100);const x=setup(card(full));assert.equal(x.page({cmd:'capture'}).queueText,pack([full],'Compare these options'));
});
test('selection-only messages can be queued without inventing a file',()=>{
 const x=setup(card('Only selected text'),'');assert.equal(x.page({cmd:'capture'}).queueText,pack(['Only selected text'],''));assert.equal(x.select([]).length,0);
});
test('selections and real files use distinct matching paths',()=>{
 const x=setup(card('Selection')+file()),f={name:'document.pdf',type:'application/pdf',size:3};assert.deepEqual(Array.from(x.select([f])),[f]);assert.equal(x.page().attachments.count,2);
});
test('a real file named selection.txt is still a file',()=>{
 const x=setup(file('selection.txt'));assert.equal(x.page().attachments.items[0].kind,'file');assert.equal(x.select([{name:'selection.txt',type:'text/plain'}]).length,1);
});
test('ordinary message and native editor document are unchanged by queue capture',()=>{
 const x=setup('','Regular prompt'),s=x.page({cmd:'capture'});assert.equal(s.queueText,s.text);assert.deepEqual(s.queueDoc,s.doc);
});
for(const [name,html] of [
 ['empty preview',card('')],['missing preview',card('text').replace('line-clamp-4 whitespace-pre-wrap','unknown-preview')],
 ['image in selection',card('text').replace('text</span>','text<img src="photo.png"/></span>')],
 ['opaque file metadata',card('text').replace('class="group/composer-attachment"','class="group/composer-attachment" data-file-id="private"')]
])test('unknown or incomplete selection stays intact: '+name,()=>{
 const x=setup(html),s=x.page({cmd:'capture'});assert.equal(s.attachments.unsupported,true);assert.throws(()=>x.select([]),/selecci[oó]n|conservar|referencia/i);assert.equal(x.p.textContent,'Compare these options');
});
test('normal Send verification never silently ignores a native selection',()=>{
 const x=setup(card('context'));let clicks=0;x.document.querySelector('[aria-label="Send"]').click=()=>clicks++;
 assert.equal(x.page({cmd:'send',text:'Compare these options',expectedFiles:[]}).clicked,false);assert.equal(clicks,0);
});
test('clear removes only the saved selection through its own native remove control',async()=>{
 const x=setup(card('context'));const s=x.page({cmd:'capture'});await x.page({cmd:'clear',expectText:s.queueText,expectDoc:s.queueDoc,expectedFiles:[]});
 assert.equal(x.page().attachments.count,0);assert.equal(x.p.textContent,'');
});
test('clear validates the entire saved quote before touching either the text or card',async()=>{
 const x=setup(card('before')),s=x.page({cmd:'capture'});x.document.querySelector('.whitespace-pre-wrap').textContent='after';
 await assert.rejects(async()=>x.page({cmd:'clear',expectText:s.queueText,expectDoc:s.queueDoc,expectedFiles:[]}));assert.equal(x.p.textContent,'Compare these options');assert.equal(x.page().attachments.count,1);
});
test('clear multiple selections supports native index renumbering',async()=>{
 const x=setup(card('first')+card('second',2)),s=x.page({cmd:'capture'});
 for(const b of x.document.querySelectorAll('button'))if((b.getAttribute('aria-label')||'').startsWith('Remove '))b.click=()=>{b.parentNode.parentNode.removeChild(b.parentNode);let i=1;for(const r of x.document.querySelectorAll('button'))if((r.getAttribute('aria-label')||'').startsWith('Remove '))r.setAttribute('aria-label','Remove selected text '+i++);};
 await x.page({cmd:'clear',expectText:s.queueText,expectedFiles:[]});assert.equal(x.page().attachments.count,0);assert.equal(x.p.textContent,'');
});
test('selection change during file cleanup stops further clearing and preserves current draft',async()=>{
 const x=setup(file()+card('original'));const s=x.page({cmd:'capture'}),b=x.document.querySelector('[aria-label="Remove document.pdf"]');
 b.click=()=>{b.parentNode.parentNode.removeChild(b.parentNode);x.document.querySelector('.whitespace-pre-wrap').textContent='new selection';};
 await assert.rejects(async()=>x.page({cmd:'clear',expectText:s.queueText,expectedFiles:[{name:'document.pdf',type:'application/pdf'}]}));assert.equal(x.p.textContent,'Compare these options');assert.equal(x.page().attachments.count,1);
});
test('a separate selected-text preview plus opaque reference cannot be flattened partially',()=>{
 const x=setup(card('known')+'<span data-file-id="opaque"><span>Private reference</span><button aria-label="Remove file reference"></button></span>');
 assert.throws(()=>x.select([]));assert.equal(x.p.textContent,'Compare these options');
});
test('empty attachment layout wrappers are not phantom files after selection removal',()=>{
 const x=setup('');assert.equal(x.page().attachments.count,0);assert.equal(x.page().attachments.unsupported,false);
});
test('selection capture never drops an additional reference without a remove control',()=>{
 const x=setup(card('known')+'<span data-file-id="unavailable">Library item without remove button</span>');assert.equal(x.page().attachments.unsupported,true);assert.throws(()=>x.select([]));
});
for(const extra of ['<span aria-busy="true"></span>','<span role="progressbar"></span>','<span class="animate-spin"></span>'])test('empty loading/media marker remains an unsupported attachment: '+extra,()=>{
 const x=setup(extra);assert.equal(x.page().attachments.count,1);assert.equal(x.page().attachments.unsupported,true);
});
test('fallback native editor reader counts empty paragraphs once, not twice',()=>{
 const x=dom(markup('','placeholder').replace('<p>placeholder</p>','<p>first</p><p><br/></p><p>third</p>'));assert.equal(x.page().text,'first\n\nthird');
});
test('a sole placeholder BR is empty but inline hard breaks remain',()=>{
 const empty=dom(markup('','placeholder').replace('<p>placeholder</p>','<p><br/></p>'));assert.equal(empty.page().text,'');
 const soft=dom(markup('','placeholder').replace('<p>placeholder</p>','<p>first<br/>second</p>'));assert.equal(soft.page().text,'first\nsecond');
});
for(const attr of ['aria-busy="true"','role="progressbar"'])test('direct loading marker is not an empty layout: '+attr,()=>{
 const x=dom(markup('').replace('<div class="flex flex-wrap"></div>',`<span ${attr}></span>`));assert.equal(x.page().attachments.count,1);assert.equal(x.page().attachments.unsupported,true);
});
