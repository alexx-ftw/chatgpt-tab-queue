/** Real DOM + production coordinator/model/adapter, mocked extension messaging
 * and in-memory storage. Runs in an isolated Camoufox profile with every request
 * intercepted; no personal browser profile, account, or real message is used. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {newState,addJob,markPreparing,markSubmitting,ACK_TIMEOUT_REASON} from '../core/model.mjs';
import {createCoordinator} from '../core/coordinator.mjs';
const {firefox}=await import(process.env.CQ_PLAYWRIGHT||'playwright');
if(!process.env.CQ_CAMOUFOX)throw Error('Set CQ_CAMOUFOX to an installed Camoufox executable');
const browser=await firefox.launch({executablePath:process.env.CQ_CAMOUFOX,headless:true});
const root=new URL('../',import.meta.url),A='11111111-1111-4111-8111-111111111111';
const quote='# Selected text:\n\n## Selection 1\n\n> Original quoted words\n\n## My request:\n\nTest follow-up';
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const rendered='<div class="markdown"><h1 data-search-result-target="">Selected text:</h1><h2 data-search-result-target="">Selection 1</h2><blockquote><p data-search-result-target="">Original quoted words</p></blockquote><h2 data-search-result-target="">My request:</h2><p data-search-result-target="">Test follow-up</p></div>';
const bubble=(id,body)=>`<div data-message-id="${id}" data-user-message-bubble="true" class="message">${body}</div>`;
const full=s=>`<div data-message-text="">${esc(s)}</div>`;
function html(messages,{busy=false}={}){return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt confirmation regression</title><style>
:root{--font-sans:system-ui;--text-primary:#ececec;--text-secondary:#aaa;--main-surface-primary:#212121;--main-surface-secondary:#303030;--border-light:#ffffff24}*{box-sizing:border-box}body{margin:0;background:#212121;color:#ececec;font:14px/1.5 system-ui}main{max-width:760px;margin:28px auto;padding:20px}.message{background:#303030;padding:12px 16px;margin:12px 0 12px 90px;border-radius:18px;white-space:pre-wrap}h1,h2{font-size:14px;margin:6px 0}p{margin:0}blockquote{border-left:2px solid #777;padding-left:12px;margin:8px 0}form{border:1px solid #ffffff24;border-radius:24px;padding:16px;margin-top:16px}textarea{background:transparent;color:inherit;width:100%;font:inherit;border:0;resize:vertical;min-height:56px;outline:none}footer{display:flex;justify-content:space-between}button{background:transparent;color:inherit;border:0;padding:7px}.complete{color:#aaa;font-size:12px;padding:12px 0}.heading{font-size:19px;font-weight:600;margin-bottom:24px}
</style></head><body><main><div class="heading">ChatGPT · prueba aislada</div>${messages}<article data-turn-key="latest"><div data-chatgpt-search-unit-key="latest:assistant" data-message-id="final-latest">Respuesta completada</div><button aria-label="Regenerate response">↻</button></article><p class="complete">El envío ya está en el historial; la cola debe reconocerlo.</p><form data-chatgpt-composer=""><div data-composer-attachments="" hidden></div><div data-above-composer-portal=""></div><textarea id="prompt-textarea" aria-label="Ask ChatGPT">Mi siguiente borrador</textarea><footer><button type="button" aria-label="Add files and more">+</button><button type="button" aria-label="Select ChatGPT model" data-selected-reasoning-effort="medium">Pro</button><button id="native-send" type="button" aria-label="${busy?'Stop':'Start Voice'}">●</button></footer></form></main></body></html>`;}
const results=[],errors=[];
async function setup({text=quote,body=rendered,later=false,old=false,manual=false,busy=false,second=false}={}){
 const context=await browser.newContext({viewport:{width:1080,height:900}}),page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(String(e)));
 const messages=(old?bubble('ancient',full(text)):'')+bubble('before',full('Previous message'))+bubble('sent',body)+(later?bubble('later',full('A later manual message')):'');
 await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:html(messages,{busy})}));await page.goto(`https://chatgpt.com/c/${A}`);
 let state=newState(),time=10000;const calls=[];
 const job=addJob(state,{target:{id:A,url:`https://chatgpt.com/c/${A}`},text,files:[],sourceTabId:4,model:{effort:'medium'}});
 markPreparing(state,job.id,4,{lastUser:{id:'before'},finalId:'old-final'},1);markSubmitting(state,job.id,2);job.status='uncertain';job.reason=ACK_TIMEOUT_REASON;state.conversations[A].paused=true;state.conversations[A].reason=manual?'Pausa manual':ACK_TIMEOUT_REASON;
 if(second)addJob(state,{target:{id:A,url:`https://chatgpt.com/c/${A}`},text:'Next queued message',files:[],sourceTabId:4,model:{effort:'medium'}});
 const store={getState:async()=>structuredClone(state),changeState:async fn=>{const next=structuredClone(state),result=fn(next);next.revision++;state=next;return {state:structuredClone(next),result:structuredClone(result)};},deleteFile:async()=>{}};
 const emit=()=>page.evaluate(s=>{globalThis.__fixtureState=s;for(const f of globalThis.__listeners||[])f({channel:'cq2',type:'STATE_CHANGED'},{id:'fixture'},()=>{});},structuredClone(state));
 const io={now:()=>time,listTabs:async()=>[{id:4,url:page.url(),status:'complete'}],getTab:async()=>({id:4,url:page.url(),status:'complete'}),page:async(_id,args)=>{calls.push(args.cmd);return page.evaluate(args=>CQPage(args),args);},sendTab:async()=>({ok:true}),changed:emit};
 const coordinator=createCoordinator({store,io});
 await page.evaluate(s=>{
  globalThis.__fixtureState=s;globalThis.__listeners=[];globalThis.__nativeClicks=0;
  document.querySelector('#native-send').addEventListener('click',()=>__nativeClicks++);
  globalThis.chrome={runtime:{id:'fixture',getManifest:()=>({version:'0.6.7'}),onMessage:{addListener(f){__listeners.push(f);},removeListener(f){__listeners=__listeners.filter(x=>x!==f);}},async sendMessage(m){
   let value=true;if(m.type==='GET_STATE'||m.type==='HELLO')value={...structuredClone(__fixtureState),isHelper:false};
   else if(m.type==='GET_JOB')value=__fixtureState.jobs.find(j=>j.id===m.id);
   return {ok:true,value};
  }}};
 },structuredClone(state));
 for(const f of ['core/adapter.js','core/client.js','core/file-matching.js','ui/view.js','content.js'])await page.evaluate(readFileSync(f==='core/adapter.js'&&process.env.CQ_BASELINE?process.env.CQ_BASELINE:new URL(f,root),'utf8'));
 await page.waitForFunction(()=>document.querySelector('#cq2-panel')?.shadowRoot?.querySelectorAll('.job').length>0);
 assert.equal(await page.title(),'Receipt confirmation regression');assert.equal(page.url(),`https://chatgpt.com/c/${A}`);
 return {page,context,calls,get state(){return state;},async tick(n=8){for(let i=0;i<n;i++){await coordinator.tick();time+=2000;}await page.waitForTimeout(350);},close:()=>context.close()};
}
async function run(name,opts,check){if(process.env.CQ_CASE&&!name.includes(process.env.CQ_CASE))return;let t;try{t=await setup(opts);await check(t);assert.equal(await t.page.locator('#prompt-textarea').inputValue(),'Mi siguiente borrador');assert.equal(await t.page.evaluate('__nativeClicks'),0);assert.ok(!t.calls.some(c=>['send','localSend'].includes(c)));results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}finally{await t?.close();}console.log(JSON.stringify(results.at(-1)));}
try{
 await run('formatted selection: uncertain row disappears after proven receipt, no resend',{},async t=>{
  assert.match(await t.page.locator('#cq2-panel .cq-phase').first().innerText(),/incierto|revisi/i);
  if(process.env.CQ_EVIDENCE){mkdirSync(process.env.CQ_EVIDENCE,{recursive:true});await t.page.screenshot({path:process.env.CQ_EVIDENCE+'/receipt-before.png'});}
  await t.tick();assert.equal(t.state.jobs.length,0);assert.equal(t.state.conversations[A].paused,false);assert.equal(await t.page.locator('#cq2-panel').count(),0);
  if(process.env.CQ_EVIDENCE){await t.page.screenshot({path:process.env.CQ_EVIDENCE+'/receipt-after.png'});await t.page.setViewportSize({width:390,height:844});assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await t.page.screenshot({path:process.env.CQ_EVIDENCE+'/receipt-after-mobile.png'});}
 });
 await run('split plaintext blocks acknowledge as a whole',{text:'First paragraph\nSecond paragraph',body:'<div data-search-result-target=""><p>First paragraph</p></div><div data-search-result-target=""><p>Second paragraph</p></div>'},async t=>{await t.tick();assert.equal(t.state.jobs.length,0);assert.equal(await t.page.locator('#cq2-panel').count(),0);});
 await run('already-sent quote remains recognizable after subsequent manual messages',{later:true},async t=>{await t.tick();assert.equal(t.state.jobs.length,0);assert.equal(t.state.conversations[A].waiting,null);assert.equal(t.state.conversations[A].paused,false);});
 await run('different quote does not clear the uncertain message',{body:rendered.replace('Original quoted words','Different quotation')},async t=>{await t.tick();assert.equal(t.state.jobs.length,1);assert.equal(t.state.jobs[0].status,'uncertain');assert.equal(await t.page.locator('#cq2-panel').count(),1);});
 await run('old identical message before baseline cannot confirm current attempt',{old:true,body:full('A different message')},async t=>{await t.tick();assert.equal(t.state.jobs.length,1);assert.equal(t.state.history.length,0);});
 await run('manual pause survives verified late confirmation',{manual:true},async t=>{await t.tick();assert.equal(t.state.jobs.length,0);assert.equal(t.state.conversations[A].paused,true);assert.equal(t.state.conversations[A].reason,'Pausa manual');});
 await run('only confirmed row disappears while next queued message waits for response',{busy:true,second:true},async t=>{await t.tick();assert.equal(t.state.jobs.length,1);assert.equal(t.state.jobs[0].text,'Next queued message');assert.equal(await t.page.locator('#cq2-panel .job').count(),1);assert.match(await t.page.locator('#cq2-panel .status').innerText(),/Esperando respuesta/);});
 await run('literal Markdown source remains supported',{body:full(quote)},async t=>{await t.tick();assert.equal(t.state.jobs.length,0);assert.equal(t.state.history.length,1);});
 const out={passed:results.filter(r=>r.passed).length,total:results.length,results,errors,environment:'Isolated Camoufox, production DOM adapter/model/coordinator, in-memory storage and mocked extension messaging; no live ChatGPT account.'};
 if(process.env.CQ_RESULTS)writeFileSync(process.env.CQ_RESULTS,JSON.stringify(out,null,2));console.log(JSON.stringify({passed:out.passed,total:out.total,errors}));if(out.passed!==out.total||errors.length)process.exitCode=1;
}finally{await browser.close();}
