import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './dom-harness.mjs';
const URL_TEXT='https://github.com/archcore-ai/archcore';
const icon='<span contenteditable="false"><svg aria-hidden="true" width="16" height="16"><title>GitHub</title><path d="M1 1"/></svg></span>';
const link=(url=URL_TEXT)=>`<span contenteditable="false" data-type="link">${icon}<a href="${url.replaceAll('&','&amp;')}">${url.replaceAll('&','&amp;')}</a></span>`;
const make=(body,extra='')=>{
 const x=dom(`<html><body><main><form data-chatgpt-composer><div data-composer-attachments></div><div data-above-composer-portal></div><div data-composer-markdown class="ProseMirror" contenteditable="true" role="textbox"><p>${body}</p></div><button aria-label="Send"></button>${extra}</form></main></body></html>`);
 x.context.URL=URL;
 vm.runInContext(readFileSync(new URL('../core/file-matching.js',import.meta.url),'utf8'),x.context);
 return x;
};
function allows(x,text){const s=x.page({cmd:'capture'});assert.equal(s.attachments.unsupported,false);assert.equal(s.attachments.count,0);assert.equal(s.text,text);assert.equal(x.context.CQSelectCapturedFiles(s.attachments,[]).length,0);return s;}
test('literal GitHub chip is text, not a file or opaque native context',()=>allows(make(link()),URL_TEXT));
test('favicon inside a normal anchor cannot turn that URL into an attachment',()=>allows(make(`<a href="${URL_TEXT}">${icon}${URL_TEXT}</a>`),URL_TEXT));
test('decorative widget next to a literal URL is ignored without erasing the URL',()=>allows(make(`${icon}${URL_TEXT}`),URL_TEXT));
test('noneditable literal URL without an anchor remains transportable',()=>allows(make(`<span contenteditable="false">${URL_TEXT}</span>`),URL_TEXT));
test('mixed text and multiple URL chips keep order and line breaks',()=>allows(make(`Mira ${link()} y ${link('https://example.org/read?a=1&b=2#Part')}<br/>Después compáralos`),`Mira ${URL_TEXT} y https://example.org/read?a=1&b=2#Part\nDespués compáralos`));
test('safe URL chip also passes final native Send verification',()=>{const x=make(link());let n=0;x.document.querySelector('button[aria-label="Send"]').click=()=>n++;assert.equal(x.page({cmd:'send',text:URL_TEXT,expectedFiles:[]}).clicked,true);assert.equal(n,1);});
test('ProseMirror leaf serialization cannot discard a visible link URL',()=>{
 const x=make(link()),editor=x.document.querySelector('[data-composer-markdown]');
 const doc={type:'doc',content:[{type:'paragraph',content:[{type:'webLink',attrs:{href:URL_TEXT}}]}]};
 editor.editor={view:{dom:editor,state:{doc:{content:{size:3},textBetween:()=> '\n',toJSON:()=>doc},selection:{from:1,to:1}},dispatch(){}}};
 const s=allows(x,URL_TEXT);assert.deepEqual(s.doc,doc,'keep native document, not a flattened replacement');
});
test('ordinary native document remains untouched when its text already serializes fully',()=>{
 const x=make(`Mira <a href="${URL_TEXT}">${URL_TEXT}</a>`),editor=x.document.querySelector('[data-composer-markdown]');
 const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:`Mira ${URL_TEXT}`,marks:[{type:'link',attrs:{href:URL_TEXT}}]}]}]};
 editor.editor={view:{dom:editor,state:{doc:{content:{size:60},textBetween:()=>`Mira ${URL_TEXT}`,toJSON:()=>doc},selection:{from:1,to:1}},dispatch(){}}};
 assert.deepEqual(allows(x,`Mira ${URL_TEXT}`).doc,doc);
});
for(const [name,body] of [
 ['opaque mention','<span contenteditable="false" data-type="mention" data-id="private-context">Documento</span>'],
 ['file reference containing a URL',`<span contenteditable="false" data-file-id="private-file">${link()}</span>`],
 ['reference metadata on a link',`<a href="${URL_TEXT}" data-reference-id="ref"><span contenteditable="false">${URL_TEXT}</span></a>`],
 ['GitHub connector reference',`<span contenteditable="false" data-mention="github" data-id="repository-123">${URL_TEXT}</span>`],
 ['unrecognized widget','<span contenteditable="false">opaque context</span>'],
 ['standalone image','<span contenteditable="false"><img src="blob:photo" alt="photo"/></span>'],
 ['misleading URL destination',`<span contenteditable="false"><a href="https://example.org/different">${URL_TEXT}</a></span>`],
 ['non-web protocol','<span contenteditable="false"><a href="javascript:alert(1)">javascript:alert(1)</a></span>'],
 ['credentials in URL','<span contenteditable="false">https://user:secret@example.org/file</span>'],
 ['mixed opaque context and valid link',`${link()}<span contenteditable="false" data-mention="file">Private document</span>`],
 ['hidden context content',`<span contenteditable="false">${URL_TEXT}<span hidden="">private payload</span></span>`],
 ['image inside URL wrapper',`<span contenteditable="false"><img src="blob:photo" width="500" height="500"/>${URL_TEXT}</span>`]
])test(`do not relax protection for ${name}`,()=>{const x=make(body),s=x.page({cmd:'capture'});assert.equal(s.attachments.unsupported,true);assert.throws(()=>x.context.CQSelectCapturedFiles(s.attachments,[]));});
test('selected context above composer is still blocked even with a safe inline URL',()=>{
 const x=dom(`<html><body><main><form data-chatgpt-composer><div data-above-composer-portal><blockquote>Selected quoted context</blockquote></div><div data-composer-markdown contenteditable="true" role="textbox"><p>${link()}</p></div><button aria-label="Send"/></form></main></body></html>`);x.context.URL=URL;
 assert.equal(x.page().attachments.unsupported,true);
});
test('URL alongside a native document keeps attachment matching active',()=>{
 // Use a second fixture because the lightweight harness patches only the initial DOM.
 const html=`<html><body><main><form data-chatgpt-composer><div data-composer-attachments><div data-file-name="notes.pdf"><span>notes.pdf</span><button aria-label="Remove notes.pdf"/></div></div><div data-composer-markdown contenteditable="true" role="textbox"><p>${link()}</p></div><button aria-label="Send"/></form></main></body></html>`;
 const y=dom(html);y.context.URL=URL;vm.runInContext(readFileSync(new URL('../core/file-matching.js',import.meta.url),'utf8'),y.context);
 const s=y.page();assert.equal(s.attachments.unsupported,false);assert.equal(s.attachments.count,1);const f={name:'notes.pdf',type:'application/pdf'};assert.equal(y.context.CQSelectCapturedFiles(s.attachments,[f])[0],f);assert.throws(()=>y.context.CQSelectCapturedFiles(s.attachments,[]));
});

test('writing a native link atom recalculates its readable text after the transaction',()=>{
 const x=make('draft'),e=x.document.querySelector('[data-composer-markdown]'),p=e.querySelector('p');let atom=false;
 const saved={type:'doc',content:[{type:'paragraph',content:[{type:'webLink',attrs:{href:URL_TEXT}}]}]};
 const doc={content:{size:5},textBetween:()=>atom?'\n':p.textContent,toJSON:()=>atom?saved:{text:p.textContent}};
 const tr={replaceWith(_a,_b,content){this.content=content;return this;},setMeta(){return this;}};
 e.editor={view:{dom:e,state:{doc,selection:{from:1,to:1},schema:{nodeFromJSON:()=>({content:saved.content})},tr},dispatch(){atom=true;p.textContent=URL_TEXT;p.setAttribute('contenteditable','false');}}};
 assert.doesNotThrow(()=>x.page({cmd:'write',expectText:'draft',snapshot:{text:URL_TEXT,doc:saved}}));
 assert.equal(x.page().text,URL_TEXT);
});

test('aria-hidden favicon wrapper is decoration, not hidden attachment text',()=>allows(make(`<a href="${URL_TEXT}"><span contenteditable="false" aria-hidden="true">${icon}</span>${URL_TEXT}</a>`),URL_TEXT));
test('control characters in a URL are not silently rewritten',()=>{const x=make('<span contenteditable="false">https://example.org/a&#8203;b</span>');assert.equal(x.page().attachments.unsupported,true);});
