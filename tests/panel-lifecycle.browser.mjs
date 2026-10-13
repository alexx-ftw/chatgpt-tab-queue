/** Real Chromium DOM and separate ISOLATED world. All network requests are fulfilled
 * locally; runtime RPC is mocked. Never opens a personal profile or sends a chat.
 * Run: CQ_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/panel-lifecycle.browser.mjs
 */
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.CQ_PLAYWRIGHT||'playwright');
const root=new URL('../',import.meta.url);
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const jobs=[1,2].map(n=>({id:'job-'+n,conversationId:A,text:'Pendiente de prueba '+n,files:[],status:'queued'}));
const state=n=>({version:3,revision:1,paused:false,aliases:{},isHelper:false,conversations:{[A]:{id:A,paused:false},[B]:{id:B,paused:false}},jobs:jobs.slice(0,n),helpers:{},draftBackups:{},settings:{preserveModel:true}});
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Queue panel regression</title><style>
:root{--color-text:#eee;--text-primary:#eee;--text-secondary:#aaa;--main-surface-primary:#181818;--border-light:#ffffff25}body{margin:0;background:#181818;color:#eee;font:14px system-ui}main{max-width:720px;margin:40px auto;padding:16px}.hidden{display:none}.workspace{display:contents}#transcript{height:230px}#composer-wrapper{display:flex;flex-direction:column}form{background:#262626;border-radius:28px;padding:18px}[contenteditable]{outline:none;min-height:24px}button{color:inherit;background:transparent;border:0}footer{display:flex;justify-content:space-between}p{margin:0}
</style></head><body><main><h1>ChatGPT</h1><div id="transcript">Respuesta en curso</div><div class="workspace"><div id="composer-wrapper"><form id="live-form" data-chatgpt-composer><div data-above-composer-portal data-above-composer-conversation-id="chatgpt:conversation:${A}"></div><div data-composer-attachments hidden></div><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT"><p>Borrador intacto</p></div><footer><button type="button" aria-label="Add files and more">+</button><button type="button" aria-label="Select ChatGPT model" data-selected-reasoning-effort="medium">Pro</button><button type="button" aria-label="Stop">■</button></footer></form></div></div></main></body></html>`;
const browser=await chromium.launch({headless:true});const results=[];const errors=[];
async function setup(n=2){
 const context=await browser.newContext({viewport:{width:1000,height:850}});
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('https://chatgpt.com/c/'+A);
 const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
 const tree=await cdp.send('Page.getFrameTree');
 const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'queue-test-isolated'});
 const iso=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await iso(`globalThis.__backend=${JSON.stringify(state(n))};globalThis.__listeners=[];globalThis.__rpcCalls=[];globalThis.__version='0.6.1';globalThis.__held=[];globalThis.__defer=false;
 globalThis.chrome={runtime:{id:'fixture',getManifest:()=>({version:__version}),onMessage:{addListener(fn){__listeners.push(fn)},removeListener(fn){__listeners=__listeners.filter(x=>x!==fn)}},async sendMessage(m){__rpcCalls.push(m.type);if(m.type==='GET_STATE'){if(__defer){__defer=false;return new Promise(resolve=>__held.push(resolve))}return {ok:true,value:structuredClone(__backend)}}if(m.type==='PAUSE'){__backend.conversations[m.conversationId].paused=true;__backend.revision++}if(m.type==='RESUME'){__backend.conversations[m.conversationId].paused=false;__backend.revision++}return {ok:true,value:true}}}};`);
 for(const file of ['core/adapter.js','core/client.js','core/file-matching.js','ui/view.js','content.js'])await iso(readFileSync(new URL(file,root),'utf8'));
 await page.waitForTimeout(220);
 assert.equal(await page.title(),'Queue panel regression');assert.equal(page.url(),'https://chatgpt.com/c/'+A);assert.equal(await page.evaluate('typeof window.CQPage'),'undefined');
 return {page,iso,close:()=>context.close()};
}
async function count(s){return s.page.locator('#cq2-panel .job').count()}
async function run(name,fn){let s;try{s=await setup(name==='empty queue'||name==='resync missed invalidation'?0:2);await fn(s);results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message})}finally{await s?.close()}console.log(JSON.stringify(results.at(-1)))}
try{
 await run('empty queue',async s=>assert.equal(await s.page.locator('#cq2-panel').count(),0));
 await run('two pending messages while busy',async s=>{assert.equal((await s.iso('CQPage({cmd:"inspect"})')).state,'busy');assert.equal(await count(s),2);await s.page.locator('#cq2-panel').getByRole('button',{name:'Pausar esta cola',exact:true}).click();await s.page.waitForTimeout(150);assert.match(await s.page.locator('#cq2-panel .status').innerText(),/En pausa/);assert.equal(await s.page.locator('#live-form [contenteditable]').innerText(),'Borrador intacto')});
 for(const mode of ['hidden','aria-hidden','inert','class','style'])await run('ignore hidden composer '+mode,async s=>{
  await s.page.evaluate(mode=>{const box=document.createElement('div');const form=document.querySelector('#live-form').cloneNode(true);form.removeAttribute('id');box.append(form);if(mode==='class')box.className='hidden';else if(mode==='style')box.style.display='none';else box.setAttribute(mode,mode==='aria-hidden'?'true':'');document.body.append(box)},mode);
  await s.page.waitForTimeout(450);const snap=await s.iso('CQPage({cmd:"inspect"})');assert.equal(snap.ready,true,'adapter must still see the live composer');assert.equal(snap.state,'busy');assert.equal(await count(s),2,'two queued messages must stay visible');
  if(mode==='hidden'&&process.env.CQ_EVIDENCE){
   await s.page.screenshot({path:process.env.CQ_EVIDENCE+'/panel-desktop.png'});
   await s.page.setViewportSize({width:390,height:844});
   assert.ok(await s.page.locator('#cq2-panel').isVisible());
   assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await s.page.screenshot({path:process.env.CQ_EVIDENCE+'/panel-mobile.png'});
  }
 });
 await run('reattach panel removed by page',async s=>{await s.page.locator('#cq2-panel').evaluate(el=>el.remove());await s.page.waitForTimeout(650);assert.equal(await count(s),2,'must not wait for a five-second timer or reload');assert.equal(await s.page.locator('#live-form [contenteditable]').innerText(),'Borrador intacto')});
 await run('resync missed invalidation',async s=>{await s.iso('__backend='+JSON.stringify(state(2)));await s.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await s.page.waitForTimeout(500);assert.equal(await count(s),2,'foreground recovery must fetch durable pending jobs')});
 await run('navigation does not mix queues',async s=>{await s.page.evaluate(id=>{history.pushState(null,'','/c/'+id);window.dispatchEvent(new PopStateEvent('popstate'))},B);await s.page.waitForTimeout(350);assert.equal(await count(s),0);await s.page.evaluate(id=>{history.pushState(null,'','/c/'+id);window.dispatchEvent(new PopStateEvent('popstate'))},A);await s.page.waitForTimeout(350);assert.equal(await count(s),2)});
 await run('late old refresh cannot resurrect disposed panel',async s=>{await s.iso('__defer=true;for(const fn of __listeners)fn({channel:"cq2",type:"STATE_CHANGED"},{id:"fixture"},()=>{})');await s.page.waitForTimeout(250);assert.equal(await s.iso('__held.length'),1);await s.iso('__version="0.6.2"');await s.iso(readFileSync(new URL('content.js',root),'utf8'));await s.page.waitForTimeout(200);await s.iso('__held[0]({ok:true,value:'+JSON.stringify(state(1))+'})');await s.page.waitForTimeout(200);assert.equal(await s.page.locator('#cq2-panel').count(),1,'only the current version may mount a panel');assert.equal(await count(s),2)});
 await run('only sent messages disappear',async s=>{await s.iso('__backend.jobs=[];__backend.revision++;for(const fn of __listeners)fn({channel:"cq2",type:"STATE_CHANGED"},{id:"fixture"},()=>{})');await s.page.waitForTimeout(350);assert.equal(await count(s),0);assert.equal(await s.page.locator('#live-form [contenteditable]').innerText(),'Borrador intacto');assert.equal((await s.iso('CQPage({cmd:"inspect"})')).state,'busy')});
 const out={passed:results.filter(x=>x.passed).length,total:results.length,results,errors,environment:'Isolated Chromium test profile; real DOM, extension ISOLATED world, intercepted network and mocked runtime RPC. No live ChatGPT session.'};
 if(process.env.CQ_RESULTS)writeFileSync(process.env.CQ_RESULTS,JSON.stringify(out,null,2));console.log(JSON.stringify({passed:out.passed,total:out.total,errors}));if(out.passed!==out.total||errors.length)process.exitCode=1;
}finally{await browser.close()}
