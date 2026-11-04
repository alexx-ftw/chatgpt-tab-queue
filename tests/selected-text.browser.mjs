/** Real Chromium DOM in ISOLATED world, intercepted fixture page and mocked RPC.
 * No personal browser profile, live ChatGPT request or real chat send. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.CQ_PLAYWRIGHT||'playwright');
const root=new URL('../',import.meta.url),A='11111111-1111-4111-8111-111111111111';
const URL_TEXT='https://example.org/reference';
const icon='<span contenteditable="false"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><title>GitHub</title><circle cx="8" cy="8" r="6" fill="currentColor"/></svg></span>';
const esc=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const chip=(url=URL_TEXT)=>`<span contenteditable="false" data-type="link" class="link">${icon}<a href="${esc(url)}">${esc(url)}</a></span>`;
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Queue selection regression</title><style>
:root{--color-text:#eee;--text-primary:#eee;--text-secondary:#aaa;--main-surface-primary:#171717;--main-surface-secondary:#282828;--border-light:#ffffff22}*{box-sizing:border-box}body{margin:0;background:#171717;color:#eee;font:14px system-ui}main{max-width:920px;margin:35px auto;padding:20px}#transcript{min-height:150px}.subtle{color:#aaa;font-size:12px}form{background:#262626;border-radius:30px;padding:18px 22px;margin-top:8px}[contenteditable=true]{outline:0;min-height:32px;overflow-wrap:anywhere}.link{color:#729bdc;display:inline-flex;align-items:center;gap:6px}.link a{color:inherit}button{color:inherit;background:transparent;border:0;padding:5px}footer{display:flex;justify-content:space-between;align-items:center}p{margin:0}input[type=file]{display:none}.file{border:1px solid #8884;border-radius:8px;padding:8px;margin:4px}
</style></head><body><main><h2>ChatGPT</h2><div id="transcript">Respuesta en curso</div><p class="subtle">ChatGPT can make mistakes. Check important info.</p><form data-chatgpt-composer><div data-above-composer-portal></div><div data-composer-attachments></div><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT"><p></p></div><input type="file" multiple aria-label="Attach files"><footer><button type="button" aria-label="Add files and more">+</button><button type="button" aria-label="Select ChatGPT model" data-selected-reasoning-effort="max">Extra High</button><button type="button" aria-label="Stop" id="send">■</button></footer></form></main><script>
window.busy=true;window.sent=[];const editor=document.querySelector('[data-composer-markdown]'),send=document.getElementById('send');
function sync(){send.setAttribute('aria-label',busy?'Stop':editor.innerText.trim()?'Send':'Start Voice')}
editor.addEventListener('input',sync);window.finish=()=>{busy=false;sync()};
// Native fixture serializes editor paragraphs, not rendered paragraph spacing.
send.onclick=()=>{if(busy)return;const text=[...editor.childNodes].map(n=>n.textContent||'').join('\\n').trim();sent.push(text);const bubble=document.createElement('div');bubble.setAttribute('data-user-message-bubble','true');bubble.setAttribute('data-message-id','receipt-'+sent.length);const t=document.createElement('span');t.setAttribute('data-message-text','');t.textContent=text;bubble.append(t);document.getElementById('transcript').append(bubble);editor.innerHTML='<p><br class="ProseMirror-trailingBreak"></p>';busy=true;sync()};
editor.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send.click()}});
document.querySelector('input[type=file]').addEventListener('change',e=>{for(const f of e.target.files){const c=document.createElement('div');c.className='file';c.setAttribute('data-file-name',f.name);const t=document.createElement('span');t.textContent=f.name;const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Remove '+f.name);b.textContent='×';b.onclick=()=>c.remove();c.append(t,b);document.querySelector('[data-composer-attachments]').append(c)}});

window.addSelected=text=>{
 const outer=document.createElement('span');outer.className='group group/composer-attachment';
 const surface=document.createElement('span');surface.className='composer-attachment-surface';
 const preview=document.createElement('span');preview.className='line-clamp-4 whitespace-pre-wrap';preview.style.cssText='display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;max-width:230px';preview.textContent=text;
 const label=document.createElement('span');label.textContent='Selection';
 const open=document.createElement('button');open.type='button';open.setAttribute('aria-label','Selection');
 surface.append(preview,label,open);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove selected text '+(document.querySelectorAll('[aria-label^="Remove selected text"]').length+1));
 remove.onclick=()=>{outer.remove();let i=1;for(const b of document.querySelectorAll('[aria-label^="Remove selected text"]'))b.setAttribute('aria-label','Remove selected text '+i++);};
 outer.append(surface,remove);document.querySelector('[data-composer-attachments]').append(outer);
};
window.nativeSentSelections=[];
const nativeClick=send.onclick;send.onclick=()=>{if(busy)return;nativeSentSelections.push([...document.querySelectorAll('.whitespace-pre-wrap')].map(e=>e.textContent));nativeClick();for(const b of document.querySelectorAll('[aria-label^="Remove selected text"]'))b.click();};

</script></body></html>`;
const browser=await chromium.launch({headless:true}),results=[],errors=[];
async function setup(){
 const context=await browser.newContext({viewport:{width:1100,height:700}});
 await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));
 const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('https://chatgpt.com/c/'+A);
 const cdp=await context.newCDPSession(page),tree=await cdp.send('Page.getFrameTree');
 const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'queue-link-isolated'});
 const iso=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const state={version:4,revision:0,paused:false,aliases:{},isHelper:false,jobs:[],conversations:{[A]:{id:A,paused:false}},helpers:{},draftBackups:{},settings:{preserveModel:true}};
 await iso(`globalThis.__state=${JSON.stringify(state)};globalThis.__files=new Map();globalThis.__listeners=[];globalThis.__calls=[];
 globalThis.__emit=()=>{__state.revision++;for(const f of __listeners)f({channel:'cq2',type:'STATE_CHANGED'},{id:'fixture'},()=>{})};
 globalThis.chrome={runtime:{id:'fixture',getManifest:()=>({version:'0.6.6'}),onMessage:{addListener(f){__listeners.push(f)},removeListener(f){__listeners=__listeners.filter(x=>x!==f)}},async sendMessage(m){__calls.push(m.type);try{let value=true;switch(m.type){
 case 'GET_STATE':case 'HELLO':value=structuredClone(__state);break;
 case 'CAPTURE':value=CQPage({cmd:'capture'});break;
 case 'ENQUEUE':{const id=crypto.randomUUID();__state.jobs.push({id,conversationId:m.target.id,text:m.text,doc:m.doc,files:m.fileIds.map(id=>({...__files.get(id),bytes:undefined})),status:'held'});value={id};__emit();break;}
 case 'CLEAR_COMPOSER':{if(globalThis.__changeBeforeClear){document.querySelector('.whitespace-pre-wrap').textContent='New context';document.querySelector('[data-composer-markdown]').textContent='New request';}const j=__state.jobs.find(j=>j.id===m.jobId);value=await CQPage({cmd:'clear',conversationId:j.conversationId,expectText:j.text,expectDoc:j.doc,expectedFiles:m.nativeFiles||[],sourceText:m.sourceText,sourceDoc:m.sourceDoc,selectedTexts:m.selectedTexts});break;}
 case 'RELEASE':__state.jobs.find(j=>j.id===m.id).status='queued';__emit();break;
 case 'FILE_BEGIN':{const id=crypto.randomUUID();value={...m.meta,id};__files.set(id,{...value,bytes:[]});break;}
 case 'FILE_PART':__files.get(m.id).bytes.push(...Array.from(atob(m.data),c=>c.charCodeAt(0)));break;
 case 'FILE_FINISH':value={...__files.get(m.id),bytes:undefined};break;
 case 'FILE_DELETE':__files.delete(m.id);break;
 case 'GET_JOB':value=__state.jobs.find(j=>j.id===m.id);break;
 }return {ok:true,value}}catch(e){return {ok:false,error:e.message}}}}};`);
 for(const file of ['core/adapter.js','core/client.js','core/file-matching.js','ui/view.js','content.js']){
  const source=file==='core/adapter.js'&&process.env.CQ_BASELINE?readFileSync(process.env.CQ_BASELINE,'utf8'):readFileSync(new URL(file,root),'utf8');await iso(source);
 }
 await page.waitForTimeout(250);
 return {page,iso,close:()=>context.close(),editor:page.locator('[data-composer-markdown]')};
}
async function run(name,fn){if(process.env.CQ_CASE&&!name.includes(process.env.CQ_CASE))return;let s;try{s=await setup();await fn(s);results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message})}finally{await s?.close()}console.log(JSON.stringify(results.at(-1)))}
async function draft(s,html){await s.editor.evaluate((el,h)=>{el.innerHTML='<p>'+h+'</p>';el.dispatchEvent(new Event('input',{bubbles:true}))},html);await s.editor.focus()}
async function tab(s,text){await s.editor.press('Tab');await s.page.waitForTimeout(750);const jobs=await s.iso('__state.jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].status,'queued');assert.equal(jobs[0].text,text);assert.equal((await s.editor.innerText()).trim(),'');assert.equal(await s.page.evaluate('sent.length'),0);return jobs[0]}const quote=(ss,t)=>'# Selected text:\n\n'+ss.map((s,i)=>`## Selection ${i+1}\n\n${s.split('\n').map(l=>'> '+l).join('\n')}`).join('\n\n')+'\n\n## My request:\n\n'+t;
async function selected(s,texts,request='Compare these options'){
 await draft(s,esc(request));await s.page.evaluate(ss=>ss.forEach(t=>window.addSelected(t)),texts);await s.editor.focus();
}
try{
 await run('Tab with native selected text stores an explicit quote, not a File',async s=>{
  await selected(s,['Example combination']);const j=await tab(s,quote(['Example combination'],'Compare these options'));
  assert.equal(j.files.length,0);assert.equal(j.doc,null);assert.equal(await s.iso('__calls.includes("FILE_BEGIN")'),false);
  assert.equal(await s.page.locator('[aria-label^="Remove selected text"]').count(),0);
  assert.equal(await s.page.locator('#cq2-panel .job').count(),1);assert.equal(await s.page.locator('#cq2-notice').count(),0);
  assert.equal((await s.iso('CQPage({cmd:"inspect"})')).state,'busy');
  if(process.env.CQ_EVIDENCE){mkdirSync(process.env.CQ_EVIDENCE,{recursive:true});await s.page.screenshot({path:process.env.CQ_EVIDENCE+'/selection-queued.png'});await s.page.setViewportSize({width:390,height:844});assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await s.page.screenshot({path:process.env.CQ_EVIDENCE+'/selection-queued-mobile.png'})}
 });
 await run('several selections preserve order and duplicate text despite native renumbering',async s=>{const ss=['first\n  indented','second','second'];await selected(s,ss,'Keep order');await tab(s,quote(ss,'Keep order'));assert.equal(await s.page.locator('[aria-label^="Remove selected text"]').count(),0)});
 await run('clamped preview retains all DOM text beyond four visible lines',async s=>{const t='Paragraph with a long selected line\n'.repeat(40);await selected(s,[t],'Summarize');await tab(s,quote([t],'Summarize'))});
 await run('selection-only request is queued without losing its text',async s=>{await selected(s,['Only context'],'');await tab(s,quote(['Only context'],''))});
 await run('selection plus PDF preserves exact file bytes and selected quotation',async s=>{
  await selected(s,['Context for this PDF'],'Analyze');const bytes=Buffer.from('%PDF-1.4\nfixture\x00\xff','latin1');await s.page.locator('input[type=file]').setInputFiles({name:'notes.pdf',mimeType:'application/pdf',buffer:bytes});
  const j=await tab(s,quote(['Context for this PDF'],'Analyze'));assert.equal(j.files.length,1);assert.equal(j.files[0].name,'notes.pdf');assert.deepEqual(await s.iso('__files.get('+JSON.stringify(j.files[0].id)+').bytes'),[...bytes]);assert.equal(await s.page.locator('[data-file-name]').count(),0);
 });
 await run('quoted selection sends once after completion and restores the next draft',async s=>{
  await selected(s,['Context'],'Question');const j=await tab(s,quote(['Context'],'Question'));await draft(s,'Unfinished next draft');await s.page.evaluate('finish()');
  const r=await s.iso('CQPage('+JSON.stringify({cmd:'localSend',text:j.text,doc:j.doc,token:'fixture-send',expectText:'Unfinished next draft',beforeUser:null,options:[]})+')');
  assert.equal(r.clicked,true,JSON.stringify({r,current:await s.iso('CQPage({cmd:"inspect"})'),html:await s.editor.innerHTML(),expected:j.text}));assert.equal(r.restored,true,JSON.stringify(r));assert.deepEqual(await s.page.evaluate('sent'),[j.text]);assert.equal(await s.editor.innerText(),'Unfinished next draft');assert.equal(s.page.url(),'https://chatgpt.com/c/'+A);
 });
 await run('a fresh native selection in the next draft is never replaced by queued text',async s=>{
  await selected(s,['First context'],'Question');const j=await tab(s,quote(['First context'],'Question'));await selected(s,['New context'],'New unfinished request');await s.page.evaluate('finish()');
  const r=await s.iso('CQPage('+JSON.stringify({cmd:'localSend',text:j.text,doc:j.doc,token:'blocked-send',expectText:'New unfinished request',beforeUser:null,options:[]})+')');assert.equal(r.clicked,false);assert.equal(await s.page.evaluate('sent.length'),0);assert.equal(await s.editor.innerText(),'New unfinished request');assert.equal(await s.page.locator('.whitespace-pre-wrap').innerText(),'New context');
 });
 for(const [name,change] of [['missing preview',()=>document.querySelector('.whitespace-pre-wrap').className='unknown'],['opaque reference',()=>document.querySelector('.group').setAttribute('data-file-id','opaque')],['empty preview',()=>document.querySelector('.whitespace-pre-wrap').textContent='']]){
  await run(name+' is not flattened or dropped',async s=>{await selected(s,['Context']);await s.page.evaluate(change);const before=await s.editor.innerHTML();await s.editor.press('Tab');await s.page.waitForTimeout(400);assert.equal(await s.iso('__state.jobs.length'),0);assert.equal(await s.editor.innerHTML(),before);assert.equal(await s.page.locator('[aria-label^="Remove selected text"]').count(),1);assert.equal(await s.page.evaluate('sent.length'),0)});
 }
 await run('selection changed after persistence leaves saved message held and new draft intact',async s=>{
  await selected(s,['Original context'],'Original request');await s.iso('__changeBeforeClear=true');await s.editor.press('Tab');await s.page.waitForTimeout(500);
  const j=await s.iso('__state.jobs[0]');assert.equal(j.status,'held');assert.equal(j.text,quote(['Original context'],'Original request'));assert.equal(await s.editor.innerText(),'New request');assert.equal(await s.page.locator('.whitespace-pre-wrap').innerText(),'New context');assert.equal(await s.iso('__calls.includes("RELEASE")'),false);
 });
 await run('native Enter retains native selected text without queue conversion',async s=>{
  await selected(s,['Native context'],'Native request');await s.page.evaluate('finish()');await s.editor.press('Enter');assert.deepEqual(await s.page.evaluate('sent'),['Native request']);assert.deepEqual(await s.page.evaluate('nativeSentSelections'),[['Native context']]);assert.equal(await s.iso('__state.jobs.length'),0);
 });
 await run('Shift+Tab leaves the selection and request untouched',async s=>{await selected(s,['Context'],'Request');await s.editor.press('Shift+Tab');await s.page.waitForTimeout(200);assert.equal(await s.iso('__state.jobs.length'),0);assert.equal(await s.editor.innerText(),'Request');assert.equal(await s.page.locator('[aria-label^="Remove selected text"]').count(),1)});
 const out={passed:results.filter(x=>x.passed).length,total:results.length,results,errors,environment:'Isolated Chromium profile; real DOM and ISOLATED world, intercepted fixture page and mocked extension RPC. Browser connector exposes read-only tabs, not control. No personal browser or real ChatGPT send.'};
 if(process.env.CQ_RESULTS)writeFileSync(process.env.CQ_RESULTS,JSON.stringify(out,null,2));console.log(JSON.stringify({passed:out.passed,total:out.total,errors}));if(out.passed!==out.total||errors.length)process.exitCode=1;
}finally{await browser.close()}
