/** Production view + coordinator/model/adapter. Isolated fixture browser with
 * intercepted requests, in-memory storage and a simulated extension message bridge.
 * No personal profile or real ChatGPT request. Browser connector is read-only.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {newState,addJob} from '../core/model.mjs';
import {createCoordinator} from '../core/coordinator.mjs';
const {firefox,chromium}=await import(process.env.CQ_PLAYWRIGHT||'playwright');
const browser=process.env.CQ_CAMOUFOX?await firefox.launch({executablePath:process.env.CQ_CAMOUFOX,headless:true}):await chromium.launch({headless:true});
const A='11111111-1111-4111-8111-111111111111',root=new URL('../',import.meta.url),results=[],errors=[];
const fixture=`<!doctype html><html><head><meta charset="utf-8"><title>Queue edit resume regression</title><style>
:root{--text-primary:#ececec;--text-secondary:#aaa;--main-surface-primary:#212121;--main-surface-secondary:#303030;--border-light:#ffffff24;--font-sans:system-ui;color-scheme:dark}*{box-sizing:border-box}body{background:#212121;color:#ececec;margin:0;font:14px/1.5 system-ui}main{max-width:760px;margin:30px auto;padding:20px}.history{min-height:210px;color:#aaa}form{padding:16px 20px;border-radius:24px;background:#303030}textarea#prompt-textarea{font:15px/1.5 system-ui;background:transparent;color:#eee;resize:vertical;min-height:60px;width:100%;border:0}footer{display:flex;justify-content:space-between}button{background:transparent;color:inherit;border:0;padding:6px}</style></head><body><main><h2>ChatGPT · prueba aislada</h2><section class="history"><div data-user-message-bubble="true" data-message-id="before"><span data-message-text>Mensaje anterior</span></div><article data-turn-key="turn"><div data-message-author-role="assistant" data-chatgpt-search-unit-key="turn:assistant" data-message-id="final">Respuesta en curso</div><button aria-label="Regenerate response">↻</button></article></section><form data-chatgpt-composer><div data-composer-attachments hidden></div><div data-above-composer-portal></div><textarea id="prompt-textarea" aria-label="Ask ChatGPT">Borrador nativo intacto</textarea><footer><button type="button" aria-label="Add files and more">+</button><button type="button" aria-label="Select ChatGPT model" data-selected-reasoning-effort="medium">Pro</button><button type="button" id="native-send" aria-label="Stop">■</button></footer></form></main></body></html>`;
async function setup(mode='panel',{manual=false,global=false}={}){
 const ctx=await browser.newContext({viewport:{width:1100,height:850}}),page=await ctx.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
 await ctx.route('**/*',r=>{const path=new URL(r.request().url()).pathname;if(path.startsWith('/fixture/')){const p=new URL(path.slice(9),root);if(existsSync(p)){let body=readFileSync(p);if(path.endsWith('.html'))body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');return r.fulfill({body,contentType:path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'application/javascript'});}}return r.fulfill({contentType:'text/html',body:fixture});});
 let state=newState(),time=10000;const messages=['Mensaje pendiente de editar','Segundo mensaje pendiente'];const jobs=messages.map(text=>addJob(state,{target:{id:A,url:`https://chatgpt.com/c/${A}`,title:'Prueba de edición'},text,files:[],sourceTabId:4,model:{effort:'medium'}}));
 if(manual){state.conversations[A].paused=true;state.conversations[A].reason='Pausa manual';}if(global){state.paused=true;state.reason='Pausa manual';}
 const publicState=()=>({...structuredClone(state),isHelper:false,conversations:Object.fromEntries(Object.entries(state.conversations).map(([id,{editPause,editReceipts,...c}])=>[id,{...structuredClone(c),editing:editPause?.sessions.length||0,editResume:editPause?editPause.resume!==false:null}]))});
 let active=false,failSave=false,loseSave=false;const calls=[];
 const emit=async()=>{if(active)await page.evaluate(()=>{for(const fn of __listeners)fn({channel:'cq2',type:'STATE_CHANGED'},{id:'fixture'},()=>{});});};
 const store={getState:async()=>structuredClone(state),changeState:async fn=>{const next=structuredClone(state),result=fn(next);next.revision++;state=next;return {state:structuredClone(next),result:structuredClone(result)};},deleteFile:async()=>{}};
 const tab={id:4,url:`https://chatgpt.com/c/${A}`,status:'complete'};
 const io={now:()=>time,changed:emit,listTabs:async()=>mode==='panel'?[tab]:[],getTab:async()=>tab,sendTab:async()=>({ok:true}),page:async(_id,args)=>page.evaluate(args=>CQPage(args),args)};
 const c=createCoordinator({store,io});
 await page.exposeFunction('__testRPC',async m=>{calls.push(m);try{let value=true;switch(m.type){
 case 'GET_STATE':case 'HELLO':value=publicState();break;
 case 'GET_JOB':value=structuredClone(state.jobs.find(j=>j.id===m.id));if(!value)throw Error('El mensaje ya no está pendiente.');break;
 case 'EDIT_BEGIN':value=await c.beginEdit({id:m.id,token:m.token,owner:'fixture-view'});break;
 case 'EDIT_END':if(m.save&&failSave){failSave=false;throw Error('Fallo de guardado simulado');}value=await c.endEdit({id:m.id,token:m.token,owner:'fixture-view',save:m.save===true,base:m.base,text:m.text});if(m.save&&loseSave){loseSave=false;throw Error('Respuesta de guardado perdida');}break;
 case 'EDIT_ACK':value=await c.ackEdit({id:m.id,token:m.token,owner:'fixture-view'});break;
 case 'PAUSE':value=await c.pause(m.conversationId);break;
 case 'RESUME':value=await c.resume(m.conversationId);break;
 case 'CLEAR_ALL':value=await c.clear();break;
 case 'CLEAR_CHAT':value=await c.clear(m.conversationId);break;
 case 'REMOVE':value=await c.remove(m.id);break;
 case 'UPDATE_INFO':value={version:'0.6.9'};break;
 }return {ok:true,value};}catch(e){return {ok:false,error:e.message};}});
 await page.goto(mode==='panel'?tab.url:'https://chatgpt.com/fixture/ui/manager.html');
 await page.evaluate(()=>{globalThis.__listeners=[];globalThis.chrome={runtime:{id:'fixture',getManifest:()=>({version:'0.6.9'}),getURL:p=>'https://chatgpt.com/fixture/'+p,onMessage:{addListener:fn=>__listeners.push(fn),removeListener:fn=>__listeners=__listeners.filter(x=>x!==fn)},sendMessage:m=>__testRPC(m)}};globalThis.__sends=[];const button=document.getElementById('native-send');if(button){button.onclick=()=>{if(button.getAttribute('aria-label')!=='Send')return;const input=document.getElementById('prompt-textarea'),text=input.value;__sends.push(text);const row=document.createElement('div');row.setAttribute('data-user-message-bubble','true');row.setAttribute('data-message-id','sent-'+__sends.length);const content=document.createElement('span');content.setAttribute('data-message-text','');content.textContent=text;row.append(content);document.querySelector('.history').append(row);input.value='';button.setAttribute('aria-label','Stop');};}});
 const files=mode==='panel'?['core/adapter.js','core/client.js','core/file-matching.js','ui/view.js','content.js']:['core/client.js','ui/view.js','ui/manager.js'];
 active=true;for(const file of files)await page.evaluate(readFileSync(new URL(file,root),'utf8'));
 await page.locator('.job').first().waitFor();assert.ok((await page.locator('main').innerText()).length>30);assert.equal(await page.title(),mode==='panel'?'Queue edit resume regression':'ChatGPT Queue · Todas las colas');
 return {page,mode,c,jobs,calls,get state(){return state;},row:i=>page.locator(`[data-job-id="${jobs[i].id}"]`),loseNextSaveReply(){loseSave=true;},failNextSave(){failSave=true;},async tick(n=12){for(let i=0;i<n;i++){await c.tick();time+=2000;}await page.waitForTimeout(180);},async close(){active=false;await ctx.close();}};
}
async function run(name,mode,opts,fn){if(process.env.CQ_CASE&&!name.includes(process.env.CQ_CASE))return;let t;try{t=await setup(mode,opts);await fn(t);if(mode==='panel')assert.equal(await t.page.locator('#prompt-textarea').inputValue(),'Borrador nativo intacto');assert.ok(!t.calls.some(m=>['ENQUEUE','RELEASE','CLEAR_COMPOSER'].includes(m.type)));results.push({name:mode+': '+name,passed:true});}catch(e){results.push({name:mode+': '+name,passed:false,error:e.message});}finally{await t?.close();}console.log(JSON.stringify(results.at(-1)));}
const edit=async(t,i=0)=>{await t.row(i).getByRole('button',{name:'Editar pendiente',exact:true}).click();await t.row(i).locator('.cq-editor').waitFor();assert.equal(t.state.conversations[A].paused,true);return t.row(i).locator('.cq-editor');};
const done=t=>t.row(0).locator('.cq-editor').waitFor({state:'detached'});
try{
 for(const mode of ['panel','manager']){
  await run('Save resumes automatically',mode,{},async t=>{const input=await edit(t);await input.fill('Mensaje corregido');await t.row(0).getByRole('button',{name:'Guardar',exact:true}).click();await done(t);assert.equal(t.state.conversations[A].paused,false);assert.equal(t.state.jobs[0].text,'Mensaje corregido');});
  await run('Escape cancels and restores running state',mode,{},async t=>{const input=await edit(t);await input.fill('No guardar');await input.press('Escape');await done(t);assert.equal(t.state.jobs[0].text,'Mensaje pendiente de editar');assert.equal(t.state.conversations[A].paused,false);});
  await run('prior manual pause remains manual',mode,{manual:true},async t=>{const input=await edit(t);await input.fill('Edición en pausa');await input.press('Control+Enter');await done(t);assert.equal(t.state.conversations[A].paused,true);assert.equal(t.state.conversations[A].reason,'Pausa manual');});
  await run('global pause is not undone',mode,{global:true},async t=>{const input=await edit(t);await input.press('Escape');await done(t);assert.equal(t.state.paused,true);});
  await run('manual pause added during editing survives Save',mode,{},async t=>{const input=await edit(t);await t.page.getByRole('button',{name:'Mantener en pausa después de editar',exact:true}).click();await input.fill('Editado');await input.press('Control+Enter');await done(t);assert.equal(t.state.conversations[A].paused,true);assert.equal(t.state.conversations[A].reason,'Pausa manual');});
  await run('manual hold can be undone while editing without permitting an early send',mode,{},async t=>{
   const input=await edit(t);await t.page.getByRole('button',{name:'Mantener en pausa después de editar',exact:true}).click();
   await t.page.getByRole('button',{name:'Reanudar al terminar la edición',exact:true}).click();assert.equal(t.state.conversations[A].paused,true);
   await input.press('Escape');await done(t);assert.equal(t.state.conversations[A].paused,false);
  });
  await run('lost successful Save reply can be retried without stale-base rejection',mode,{},async t=>{
   const input=await edit(t);await input.fill('Guardado una sola vez');t.loseNextSaveReply();await input.press('Control+Enter');
   await t.row(0).locator('.cq-feedback').waitFor({state:'visible'});assert.equal(t.state.jobs[0].text,'Guardado una sola vez');assert.equal(t.state.jobs[0].editRevision,1);
   await input.press('Control+Enter');await done(t);assert.equal(t.state.jobs[0].editRevision,1);assert.equal(t.state.conversations[A].paused,false);
   await t.page.waitForTimeout(100);assert.equal(t.state.conversations[A].editReceipts?.length||0,0);
  });
  for(const status of ['held','error'])await run('active edit of '+status+' still shows Editing without releasing review',mode,{},async t=>{
   t.state.jobs[0].status=status;await t.c.emit();const input=await edit(t);await t.page.waitForTimeout(180);
   assert.match(await t.page.locator(mode==='panel'?'#cq2-panel .status':'.conversation .subtitle').first().innerText(),/Editando/);
   await input.press('Escape');await done(t);assert.equal(t.state.jobs[0].status,status);assert.equal(t.state.conversations[A].paused,true);
  });
  await run('last of two open edits controls resumption',mode,{},async t=>{const a=await edit(t,0),b=await edit(t,1);await a.fill('Primero corregido');await a.press('Control+Enter');await done(t);assert.equal(t.state.conversations[A].paused,true);await b.press('Escape');await t.row(1).locator('.cq-editor').waitFor({state:'detached'});assert.equal(t.state.conversations[A].paused,false);});
  await run('failed Save keeps draft and pause until retry succeeds',mode,{},async t=>{const input=await edit(t);await input.fill('Edición preservada');t.failNextSave();await input.press('Control+Enter');await t.row(0).locator('.cq-feedback').waitFor({state:'visible'});assert.equal(t.state.jobs[0].text,'Mensaje pendiente de editar');assert.equal(t.state.conversations[A].paused,true);assert.equal(await input.inputValue(),'Edición preservada');await input.press('Control+Enter');await done(t);assert.equal(t.state.jobs[0].text,'Edición preservada');assert.equal(t.state.conversations[A].paused,false);});
  await run('Meta+Enter saves; ordinary Enter stays inside editing',mode,{},async t=>{const input=await edit(t);await input.fill('Línea');await input.press('Enter');assert.equal(t.state.conversations[A].paused,true);assert.equal(t.calls.filter(m=>m.type==='EDIT_END').length,0);await input.press('Meta+Enter');await done(t);assert.equal(t.state.conversations[A].paused,false);});
  await run('removed message stays copyable and cannot be resurrected',mode,{},async t=>{const input=await edit(t);await input.fill('Edición recuperable');await t.c.remove(t.jobs[0].id);await t.page.waitForTimeout(240);assert.equal(await input.inputValue(),'Edición recuperable');assert.equal(await t.row(0).getByRole('button',{name:'Guardar',exact:true}).isDisabled(),true);await input.press('Escape');await t.row(0).waitFor({state:'detached'});assert.equal(t.state.conversations[A].paused,false);assert.equal(t.state.jobs.length,1);});
 }
 await run('leaving the manager cancels its temporary edit without leaving a lock','manager',{},async t=>{await edit(t);await t.page.goto('https://chatgpt.com/away');await t.page.waitForTimeout(200);assert.equal(t.state.conversations[A].paused,false);assert.equal(t.state.jobs[0].text,'Mensaje pendiente de editar');});
 await run('continues after Save, waits for busy response, sends only edited text once','panel',{},async t=>{const input=await edit(t);await input.fill('Mensaje corregido');await input.press('Control+Enter');await done(t);await t.tick();assert.deepEqual(await t.page.evaluate('__sends'),[]);await t.page.evaluate(()=>document.getElementById('native-send').setAttribute('aria-label','Send'));await t.tick();assert.deepEqual(await t.page.evaluate('__sends'),['Mensaje corregido']);assert.equal(t.state.jobs.length,1);assert.equal(t.state.jobs[0].text,'Segundo mensaje pendiente');});
 await run('edit status and restored status fit desktop and narrow viewport','panel',{},async t=>{const input=await edit(t);await input.fill('Mensaje corregido');await t.page.waitForTimeout(220);assert.match(await t.page.locator('#cq2-panel .status').innerText(),/Editando/);const out=process.env.CQ_EVIDENCE;if(out){mkdirSync(out,{recursive:true});await t.page.screenshot({path:out+'/editing.png'});}await input.press('Control+Enter');await done(t);await t.page.waitForTimeout(220);assert.match(await t.page.locator('#cq2-panel .status').innerText(),/Esperando respuesta/);if(out)await t.page.screenshot({path:out+'/saved-running.png'});await t.page.setViewportSize({width:390,height:844});assert.ok(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(out)await t.page.screenshot({path:out+'/saved-mobile.png'});});
 const out={passed:results.filter(r=>r.passed).length,total:results.length,results,errors,environment:'Isolated '+(process.env.CQ_CAMOUFOX?'Camoufox':'Chromium')+'; production edit model/coordinator/UI and native DOM adapter, intercepted network and in-memory storage. Not a live ChatGPT session.'};if(process.env.CQ_RESULTS)writeFileSync(process.env.CQ_RESULTS,JSON.stringify(out,null,2));console.log(JSON.stringify({passed:out.passed,total:out.total,errors}));if(!out.total||out.passed!==out.total||errors.length)process.exitCode=1;
}finally{await browser.close();}
