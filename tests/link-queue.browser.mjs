/** Real Chromium DOM in ISOLATED world, intercepted fixture page and mocked RPC.
 * No personal browser profile, live ChatGPT request or real chat send. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.CQ_PLAYWRIGHT||'playwright');
const root=new URL('../',import.meta.url),A='11111111-1111-4111-8111-111111111111';
const URL_TEXT='https://github.com/archcore-ai/archcore';
const icon='<span contenteditable="false"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><title>GitHub</title><circle cx="8" cy="8" r="6" fill="currentColor"/></svg></span>';
const esc=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const chip=(url=URL_TEXT)=>`<span contenteditable="false" data-type="link" class="link">${icon}<a href="${esc(url)}">${esc(url)}</a></span>`;
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Queue link regression</title><style>
:root{--color-text:#eee;--text-primary:#eee;--text-secondary:#aaa;--main-surface-primary:#171717;--main-surface-secondary:#282828;--border-light:#ffffff22}*{box-sizing:border-box}body{margin:0;background:#171717;color:#eee;font:14px system-ui}main{max-width:920px;margin:35px auto;padding:20px}#transcript{min-height:150px}.subtle{color:#aaa;font-size:12px}form{background:#262626;border-radius:30px;padding:18px 22px;margin-top:8px}[contenteditable=true]{outline:0;min-height:32px;overflow-wrap:anywhere}.link{color:#729bdc;display:inline-flex;align-items:center;gap:6px}.link a{color:inherit}button{color:inherit;background:transparent;border:0;padding:5px}footer{display:flex;justify-content:space-between;align-items:center}p{margin:0}input[type=file]{display:none}.file{border:1px solid #8884;border-radius:8px;padding:8px;margin:4px}
</style></head><body><main><h2>ChatGPT</h2><div id="transcript">Respuesta en curso</div><p class="subtle">ChatGPT can make mistakes. Check important info.</p><form data-chatgpt-composer><div data-above-composer-portal></div><div data-composer-attachments></div><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT"><p></p></div><input type="file" multiple aria-label="Attach files"><footer><button type="button" aria-label="Add files and more">+</button><button type="button" aria-label="Select ChatGPT model" data-selected-reasoning-effort="max">Extra High</button><button type="button" aria-label="Stop" id="send">■</button></footer></form></main><script>
window.busy=true;window.sent=[];const editor=document.querySelector('[data-composer-markdown]'),send=document.getElementById('send');
function sync(){send.setAttribute('aria-label',busy?'Stop':editor.innerText.trim()?'Send':'Start Voice')}
editor.addEventListener('input',sync);window.finish=()=>{busy=false;sync()};
send.onclick=()=>{if(busy)return;const text=editor.innerText.trim();sent.push(text);const bubble=document.createElement('div');bubble.setAttribute('data-user-message-bubble','true');bubble.setAttribute('data-message-id','receipt-'+sent.length);const t=document.createElement('span');t.setAttribute('data-message-text','');t.textContent=text;bubble.append(t);document.getElementById('transcript').append(bubble);editor.innerHTML='<p><br class="ProseMirror-trailingBreak"></p>';busy=true;sync()};
editor.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send.click()}});
document.querySelector('input[type=file]').addEventListener('change',e=>{for(const f of e.target.files){const c=document.createElement('div');c.className='file';c.setAttribute('data-file-name',f.name);const t=document.createElement('span');t.textContent=f.name;const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Remove '+f.name);b.textContent='×';b.onclick=()=>c.remove();c.append(t,b);document.querySelector('[data-composer-attachments]').append(c)}});
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
 globalThis.chrome={runtime:{id:'fixture',getManifest:()=>({version:'0.6.4'}),onMessage:{addListener(f){__listeners.push(f)},removeListener(f){__listeners=__listeners.filter(x=>x!==f)}},async sendMessage(m){__calls.push(m.type);try{let value=true;switch(m.type){
 case 'GET_STATE':case 'HELLO':value=structuredClone(__state);break;
 case 'CAPTURE':value=CQPage({cmd:'capture'});break;
 case 'ENQUEUE':{const id=crypto.randomUUID();__state.jobs.push({id,conversationId:m.target.id,text:m.text,doc:m.doc,files:m.fileIds.map(id=>({...__files.get(id),bytes:undefined})),status:'held'});value={id};__emit();break;}
 case 'CLEAR_COMPOSER':{const j=__state.jobs.find(j=>j.id===m.jobId);value=await CQPage({cmd:'clear',conversationId:j.conversationId,expectText:j.text,expectDoc:j.doc,expectedFiles:m.nativeFiles||[]});break;}
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
async function tab(s,text){await s.editor.press('Tab');await s.page.waitForTimeout(750);const jobs=await s.iso('__state.jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].status,'queued');assert.equal(jobs[0].text,text);assert.equal((await s.editor.innerText()).trim(),'');assert.equal(await s.page.evaluate('sent.length'),0);return jobs[0]}
try{
 await run('decorated GitHub link: Tab queues exact URL while response stays busy',async s=>{await draft(s,chip());await tab(s,URL_TEXT);assert.equal(await s.page.locator('#cq2-panel .job').count(),1);assert.equal(await s.page.locator('#cq2-notice').count(),0);assert.equal((await s.iso('CQPage({cmd:"inspect"})')).state,'busy');if(process.env.CQ_EVIDENCE){mkdirSync(process.env.CQ_EVIDENCE,{recursive:true});await s.page.screenshot({path:process.env.CQ_EVIDENCE+'/link-queued.png'})}});
 await run('favicon inside ordinary anchor does not block Tab',async s=>{await draft(s,`<a href="${URL_TEXT}">${icon}${URL_TEXT}</a>`);await tab(s,URL_TEXT)});
 await run('decorative widget preceding URL does not block Tab',async s=>{await draft(s,icon+URL_TEXT);await tab(s,URL_TEXT)});
 await run('multiple links preserve order, query parameters and fragments',async s=>{const u='https://example.org/a?q=1&other=2#Anchor';await draft(s,`Mira ${chip()} y ${chip(u)}`);await tab(s,`Mira ${URL_TEXT} y ${u}`)});
 await run('queued URL sends once after completion and restores unfinished draft',async s=>{await draft(s,chip());const j=await tab(s,URL_TEXT);await s.editor.fill('Mi siguiente borrador');await s.page.evaluate('finish()');const r=await s.iso('CQPage('+JSON.stringify({cmd:'localSend',text:j.text,doc:j.doc,token:'test-lease',expectText:'Mi siguiente borrador',beforeUser:null,options:[]})+')');assert.equal(r.clicked,true,JSON.stringify(r));assert.equal(r.restored,true,JSON.stringify({r,snapshot:await s.iso('CQPage({cmd:"inspect"})'),html:await s.editor.innerHTML()}));assert.deepEqual(await s.page.evaluate('sent'),[URL_TEXT]);assert.equal(await s.editor.innerText(),'Mi siguiente borrador');assert.equal(s.page.url(),'https://chatgpt.com/c/'+A)});
 await run('URL plus native PDF keeps both original file bytes and link',async s=>{await draft(s,chip());const bytes=Buffer.from('%PDF-1.4\nfixture\x00\xff','latin1');await s.page.locator('input[type=file]').setInputFiles({name:'notes.pdf',mimeType:'application/pdf',buffer:bytes});const j=await tab(s,URL_TEXT);assert.equal(j.files.length,1);assert.equal(j.files[0].name,'notes.pdf');assert.deepEqual(await s.iso('__files.get('+JSON.stringify(j.files[0].id)+').bytes'),[...bytes]);assert.equal(await s.page.locator('[data-file-name]').count(),0)});
 for(const [name,body] of [['opaque native reference',`<span contenteditable="false" data-file-id="opaque">${chip()}</span>`],['unrelated mention',chip()+'<span contenteditable="false" data-mention="file">Documento privado</span>'],['mismatched URL',`<span contenteditable="false"><a href="https://example.org/other">${URL_TEXT}</a></span>`]]){
  await run(name+' stays intact and does not enqueue',async s=>{await draft(s,body);const before=await s.editor.innerHTML();await s.editor.press('Tab');await s.page.waitForTimeout(500);assert.equal(await s.iso('__state.jobs.length'),0);assert.equal(await s.editor.innerHTML(),before);assert.equal(await s.page.evaluate('sent.length'),0);assert.match(await s.page.locator('#cq2-notice').innerText(),/borrador sigue intacto/i)});
 }
 await run('native Enter with decorated link remains unchanged',async s=>{await draft(s,chip());await s.page.evaluate('finish()');await s.editor.press('Enter');assert.deepEqual(await s.page.evaluate('sent'),[URL_TEXT]);assert.equal(await s.iso('__state.jobs.length'),0)});
 const out={passed:results.filter(x=>x.passed).length,total:results.length,results,errors,environment:'Real Chromium DOM; isolated fixture profile, intercepted requests and mocked extension RPC; not a live ChatGPT session.'};
 if(process.env.CQ_RESULTS)writeFileSync(process.env.CQ_RESULTS,JSON.stringify(out,null,2));console.log(JSON.stringify({passed:out.passed,total:out.total,errors}));if(out.passed!==out.total||errors.length)process.exitCode=1;
}finally{await browser.close()}
