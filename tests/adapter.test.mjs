import test from 'node:test';import assert from 'node:assert/strict';import {dom,fixture} from './dom-harness.mjs';
test('supplied idle form finds native Send and preserves text',()=>{const x=dom(fixture('idle'));const s=x.page();assert.equal(s.state,'idle');assert.equal(s.sendEnabled,true);assert.ok(s.text.startsWith('Userscript'));});
test('supplied working form detects Stop even in a background, unfocused document',()=>{const x=dom(fixture('busy'));assert.equal(x.document.hasFocus(),false);assert.equal(x.document.visibilityState,'hidden');assert.equal(x.page().state,'busy');});
test('supplied finished form detects Start Voice as positive idle',()=>{const x=dom(fixture('finished'));const s=x.page();assert.equal(s.state,'idle');assert.equal(s.text,'');assert.equal(s.finalId,'answer');});
test('busy state cannot click Send or Stop as an automatic action',()=>{const x=dom(fixture('busy'));let clicked=0;for(const b of x.document.querySelectorAll('button'))b.click=()=>clicked++;const r=x.page({cmd:'send',text:'',expectedFiles:[]});assert.equal(r.clicked,false);assert.equal(clicked,0);});
test('a different conversation ID is rejected before any Send click',()=>{const x=dom(fixture('idle'));assert.throws(()=>x.page({cmd:'send',conversationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',text:x.page().text,expectedFiles:[]}));});
test('text mismatch never submits an unrelated helper draft',()=>{const x=dom(fixture('idle'));let clicks=0;x.document.querySelector('button[aria-label="Send"]').click=()=>clicks++;assert.equal(x.page({cmd:'send',text:'otro texto',expectedFiles:[]}).clicked,false);assert.equal(clicks,0);});
test('the exact pending text clicks only the labeled native Send button',()=>{const x=dom(fixture('idle'));let clicks=0;x.document.querySelector('button[aria-label="Send"]').click=()=>clicks++;assert.equal(x.page({cmd:'send',text:x.page().text,expectedFiles:[]}).clicked,true);assert.equal(clicks,1);});
test('unknown/ambiguous multiple composers fail closed',()=>{let html=fixture('idle');html=html.replace('</main>',html.match(/<form[\s\S]*?<\/form>/)[0]+'</main>');const x=dom(html);assert.equal(x.page().ready,false);assert.equal(x.page().state,'unknown');});
test('two native document attachments are verified and removed one by one',async()=>{
 const html='<html><body><main><form data-chatgpt-composer><div data-composer-attachments><div><span>a.pdf</span><button aria-label="Remove a.pdf"></button></div><div><span>b.pdf</span><button aria-label="Remove b.pdf"></button></div></div><div class="ProseMirror" contenteditable="true" role="textbox" data-composer-markdown><p>documentos</p></div><button aria-label="Send"></button></form></main></body></html>';
 const x=dom(html),files=[{name:'a.pdf',type:'application/pdf'},{name:'b.pdf',type:'application/pdf'}];
 for(const b of x.document.querySelectorAll('button[aria-label^="Remove"]'))b.click=()=>b.parentNode.parentNode.removeChild(b.parentNode);
 assert.equal(x.page({cmd:'verifyFiles',expectedFiles:files}).match,true);
 await x.page({cmd:'removeHelperFiles',expectedFiles:files});assert.equal(x.page().attachments.count,0);
});
function editable(x){
 const e=x.document.querySelector('[data-composer-markdown]'),p=e.querySelector('p');
 const selection={from:1,to:1};const doc={content:{size:p.textContent.length},textBetween:()=>p.textContent,toJSON:()=>({text:p.textContent})};
 const schema={nodes:{paragraph:{create:(_a,t)=>t||''}},text:t=>t,nodeFromJSON:d=>({content:[d.text]})};
 const tr={replaceWith(_a,_b,c){this.content=c;return this;},setMeta(){return this;},setSelection(){return this;}};
 e.pmViewDesc={view:{dom:e,state:{doc,schema,selection,tr},dispatch(t){p.textContent=t.content.join('\n');doc.content.size=p.textContent.length;}}};return {e,p};
}
test('draft guard restores a helper echo without requiring an empty source editor',async()=>{
 const x=dom(fixture('idle')),v=editable(x),original=v.p.textContent;
 x.page({cmd:'guardStart',token:'guard',text:'texto auxiliar'});v.p.textContent='texto auxiliar';x.observers.at(-1).fn([]);
 assert.equal(v.p.textContent,original);await Promise.resolve();x.page({cmd:'guardEnd',token:'guard'});
});
test('draft guard follows trusted typing and preserves the latest unfinished draft',async()=>{
 const x=dom(fixture('idle')),v=editable(x);x.page({cmd:'guardStart',token:'guard',text:'texto auxiliar'});
 v.p.textContent='sigo escribiendo';x.document.dispatchEvent({type:'input',target:v.e,isTrusted:true});v.p.textContent='';x.observers.at(-1).fn([]);
 assert.equal(v.p.textContent,'sigo escribiendo');await Promise.resolve();x.page({cmd:'guardEnd',token:'guard'});
});
test('a manual Enter in a guarded source chat blocks a conflicting helper send',()=>{
 const x=dom(fixture('idle')),v=editable(x);x.page({cmd:'guardStart',token:'guard',text:'auxiliar'});
 x.document.dispatchEvent({type:'keydown',key:'Enter',target:v.e,isTrusted:true});
 assert.equal(x.page({cmd:'guardCheck',token:'guard'}).ok,false);
});
test('native selected tools are included in the captured message configuration',()=>{
 let html=fixture('idle').replace('</form>','<button aria-label="Search" aria-pressed="true">Search</button></form>');
 const x=dom(html);assert.ok(x.page({cmd:'capture'}).options?.some(o=>o.label==='Search'));
});
test('unrecognized native tools are not silently dropped by the helper',()=>{
 const x=dom(fixture('idle'));x.document.querySelector('button[aria-label="Add files and more"]').setAttribute('aria-expanded','true');const r=x.page({cmd:'options',options:[{label:'My new native tool'}]});assert.ok(r.error);assert.equal(r.done,false);
});
test('native uploads can be cancelled by their remove controls after originals are saved',async()=>{
 const html='<html><body><main><form data-chatgpt-composer><div data-composer-attachments><div><span>a.pdf</span><span role="progressbar"></span><button aria-label="Remove a.pdf"></button></div></div><div class="ProseMirror" contenteditable="true" role="textbox" data-composer-markdown><p>x</p></div><button aria-label="Send"></button></form></main></body></html>';
 const x=dom(html);const b=x.document.querySelector('button[aria-label="Remove a.pdf"]');b.click=()=>b.parentNode.parentNode.removeChild(b.parentNode);
 assert.equal(x.page({cmd:'removeFirstFile',expectedFiles:[{name:'a.pdf'}]}),0);assert.equal(x.page().attachments.count,0);
});
test('native attachment verification does not confuse a.pdf with aa.pdf',()=>{
 const html='<html><body><main><form data-chatgpt-composer><div data-composer-attachments><div><span>aa.pdf</span><button aria-label="Remove aa.pdf"></button></div></div><div class="ProseMirror" contenteditable="true" role="textbox" data-composer-markdown><p>x</p></div><button aria-label="Send"></button></form></main></body></html>';
 const x=dom(html);assert.equal(x.page({cmd:'verifyFiles',expectedFiles:[{name:'a.pdf',type:'application/pdf'}]}).match,false);
});
test('native tool left over in helper is deselected when original message used no tool',()=>{
 const html=fixture('idle').replace('</form>','<button aria-label="Search" aria-pressed="true">Search</button></form>');const x=dom(html),b=x.document.querySelector('button[aria-label="Search"]');let n=0;b.click=()=>{n++;b.setAttribute('aria-pressed','false');};
 assert.equal(x.page({cmd:'options',options:[]}).done,false);assert.equal(n,1);assert.equal(x.page({cmd:'options',options:[]}).done,true);
});
