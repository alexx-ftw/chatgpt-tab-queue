"""Real-DOM content-script regression with mocked RPC and location. No live account/network."""
import argparse, asyncio, json, tempfile
from pathlib import Path
from playwright.async_api import async_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--extension',required=True)
parser.add_argument('--evidence',default='./browser-evidence')
parser.add_argument('--browser',required=True,help='Path to an already-installed isolated Chromium test binary')
args=parser.parse_args();EXT=Path(args.extension).resolve();OUT=Path(args.evidence);OUT.mkdir(parents=True,exist_ok=True)
A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222'
HTML=r'''<!doctype html><html><head><title>Queue browser test</title><style>
:root{--text-primary:#242424;--text-secondary:#767676;--main-surface-primary:white;--main-surface-secondary:#f5f5f5;--border-light:#e8e8e8;--font-sans:Arial, sans-serif}
body{margin:0;background:var(--main-surface-primary);color:var(--text-primary);font:14px/1.5 Arial,sans-serif}main{max-width:740px;margin:55px auto;padding:0 20px}h1{font-size:24px;font-weight:500}header{height:40px;display:flex;align-items:center;font-weight:500}#transcript{min-height:150px;padding:10px 0}form{border:1px solid var(--border-light);border-radius:25px;padding:15px 18px;background:var(--main-surface-primary)}[contenteditable]{min-height:48px;outline:0;font-size:15px}p{margin:0}footer{display:flex;align-items:center;gap:6px;margin-top:10px}button{border:0;color:inherit;background:transparent;border-radius:20px;padding:5px 10px;cursor:pointer}footer button:last-child{margin-left:auto;background:var(--text-primary);color:var(--main-surface-primary)}[data-composer-attachments]{display:flex;gap:6px}[data-file-name]{border:1px solid var(--border-light);border-radius:10px;padding:6px}[data-file-name] img{width:28px;height:28px;object-fit:cover}input[type=file]{display:none}.dark{--text-primary:#eee;--text-secondary:#ababab;--main-surface-primary:#212121;--main-surface-secondary:#303030;--border-light:#ffffff20}
</style></head><body><main><header>ChatGPT</header><div id="transcript"></div><div id="bottom"><form data-chatgpt-composer data-composer-placement="thread"><div data-composer-attachments></div><div contenteditable="true" aria-label="Ask ChatGPT" data-composer-markdown class="ProseMirror" role="textbox"><p></p></div><footer><button type="button" aria-label="Add files and more" id="add">+</button><button type="button" aria-label="Select ChatGPT model" data-selected-reasoning-effort="medium">Pro</button><button type="button" aria-label="Dictate">♩</button><button type="button" aria-label="Start Voice" id="send">↑</button></footer></form></div><input id="native-file" type="file" multiple aria-label="Attach files"></main>
<script>
window.nativeSends=[];window.nativeFiles=[];window.busy=false;window.nativeEvents=[];
const editor=document.querySelector('[contenteditable]'),form=document.querySelector('form'),send=document.querySelector('#send'),area=document.querySelector('[data-composer-attachments]');
const input=document.querySelector('#native-file');
// In this fixture the picker is a portal. The actual helper upload input is inside the form too.
const helperInput=input.cloneNode();helperInput.id='helper-file';form.append(helperInput);
function update(){send.setAttribute('aria-label',window.busy?'Stop':editor.innerText.trim()||nativeFiles.length?'Send':'Start Voice');}
function filesChanged(e){for(const f of e.target.files){nativeFiles.push(f);const card=document.createElement('div');card.setAttribute('data-file-name',f.name);const text=document.createElement('span');text.textContent=f.name;card.append(text);if(f.type.startsWith('image/')){const img=document.createElement('img');img.src=URL.createObjectURL(f);img.alt=f.name;card.append(img);}const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Remove '+f.name);b.textContent='×';b.onclick=()=>{nativeFiles.splice(nativeFiles.indexOf(f),1);card.remove();update();};card.append(b);area.append(card);}update();}
input.addEventListener('change',filesChanged);helperInput.addEventListener('change',filesChanged);editor.addEventListener('input',update);
document.querySelector('#add').onclick=()=>input.click();
async function submit(){if(busy)return;const text=editor.innerText.trim(),fs=[...nativeFiles];if(!text&&!fs.length)return;nativeSends.push({text,files:await Promise.all(fs.map(async f=>({name:f.name,type:f.type,bytes:Array.from(new Uint8Array(await f.arrayBuffer()))})))});const bubble=document.createElement('div');bubble.setAttribute('data-user-message-bubble','true');bubble.setAttribute('data-message-id',crypto.randomUUID());const txt=document.createElement('div');txt.setAttribute('data-message-text','');txt.textContent=text;bubble.append(txt);for(const f of fs){const chip=document.createElement('span');chip.setAttribute('data-file-name',f.name);chip.textContent=f.name;bubble.append(chip);}document.querySelector('#transcript').append(bubble);editor.innerHTML='<p></p>';nativeFiles=[];area.replaceChildren();busy=true;update();}
send.onclick=()=>{if(busy){busy=false;update();}else submit();};form.addEventListener('submit',e=>{e.preventDefault();submit();});editor.addEventListener('keydown',e=>{nativeEvents.push({key:e.key,prevented:e.defaultPrevented});if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit();}});window.finish=()=>{busy=false;update();};
</script></body></html>'''

MOCK=r'''(()=>{
 window.__testCalls=[];window.__testFiles=new Map();window.__testListeners=[];
 window.__state={version:3,revision:0,paused:true,reason:'',jobs:[],conversations:{},aliases:{},helpers:{},history:[],settings:{preserveModel:true},isHelper:false};
 window.__state.conversations['11111111-1111-4111-8111-111111111111']={id:'11111111-1111-4111-8111-111111111111',title:'Prueba',paused:false};
 window.__changed=()=>{__state.revision++;for(const fn of __testListeners)fn({channel:'cq2',type:'STATE_CHANGED'},{id:'test'},()=>{});};
 window.chrome={runtime:{id:'test',getManifest:()=>({version:'0.6.0'}),onMessage:{addListener(fn){__testListeners.push(fn);},removeListener(fn){__testListeners=__testListeners.filter(f=>f!==fn);}},async sendMessage(m){
  __testCalls.push(m);
  try{let value;switch(m.type){
   case 'GET_STATE':case 'HELLO':value=structuredClone(__state);break;
   case 'REPORT':value=true;break;
   case 'CAPTURE':value=CQPage({cmd:'capture'});break;
   case 'ENQUEUE':{const id=crypto.randomUUID(),j={id,text:m.text,doc:m.doc,model:m.model,conversationId:m.target.id,files:m.fileIds.map(id=>({...__testFiles.get(id),bytes:undefined})),status:'held'};__state.jobs.push(j);value={id};__changed();break;}
   case 'CLEAR_COMPOSER':{const j=__state.jobs.find(j=>j.id===m.jobId);value=await CQPage({cmd:'clear',conversationId:j.conversationId,expectText:j.text,expectDoc:j.doc,expectedFiles:m.nativeFiles||[]});break;}
   case 'RELEASE':__state.jobs.find(j=>j.id===m.id).status='queued';value=true;__changed();break;
   case 'FILE_BEGIN':{const id=crypto.randomUUID(),f={...m.meta,id,bytes:[]};__testFiles.set(id,f);value={...f};break;}
   case 'FILE_PART':{if(window.__slowFiles)await new Promise(r=>setTimeout(r,400));const f=__testFiles.get(m.id);f.bytes.push(...Uint8Array.from(atob(m.data),c=>c.charCodeAt(0)));value=true;break;}
   case 'FILE_FINISH':{const f=__testFiles.get(m.id);value={...f,bytes:undefined};break;}
   case 'FILE_DELETE':__testFiles.delete(m.id);value=true;break;
   case 'CLEAR_ALL':__state.jobs=[];__changed();value=true;break;
   case 'REMOVE':__state.jobs=__state.jobs.filter(j=>j.id!==m.id);__changed();value=true;break;
   case 'PAUSE':if(m.conversationId)__state.conversations[m.conversationId].paused=true;else __state.paused=true;value=true;__changed();break;
   case 'RESUME':if(m.conversationId)__state.conversations[m.conversationId].paused=false;else __state.paused=false;value=true;__changed();break;
   case 'GET_JOB':value=__state.jobs.find(j=>j.id===m.id);break;
   case 'EDIT':__state.jobs.find(j=>j.id===m.id).text=m.text;__changed();value=true;break;
   default:value=true;
  }return {ok:true,value};}catch(e){return {ok:false,error:e.message};}
 }}};
})();'''
async def main():
 checks=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=args.browser,headless=True,args=['--no-sandbox','--disable-background-networking','--disable-gpu'])
  context=await browser.new_context(viewport={'width':1080,'height':850})
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  await page.set_content(HTML)
  await page.evaluate('if(!crypto.randomUUID)crypto.randomUUID=()=>"test-"+Math.random().toString(36).slice(2)');await page.add_script_tag(content=MOCK)
  for path in ['core/adapter.js','core/client.js','core/file-matching.js','content.js']:
   source=(EXT/path).read_text()
   if path=='core/adapter.js':source=source.replace('location = pageWorld.location;', 'location = new URL(\"https://chatgpt.com/c/'+A+'\");')
   code='(function(location){'+source+'\n})({origin:"https://chatgpt.com",pathname:"/c/'+A+'"});'
   await page.add_script_tag(content=code)
  await asyncio.sleep(.4)
  async def wait_jobs(n,status=None):
   await page.wait_for_function('(x)=>__state.jobs.length===x.n&&(!x.status||__state.jobs.every(j=>j.status===x.status))',arg={'n':n,'status':status},timeout=5000)
   await asyncio.sleep(.2)
  assert await page.locator('#cq2-panel').count()==0,'No queue must mean no injected panel'
  assert await page.get_by_text('Adjuntar a la cola',exact=True).count()==0
  checks+=['No UI with empty queue','No alternate attachment control']
  editor=page.locator('[contenteditable]')
  await editor.fill('Native Enter remains native');await editor.press('Enter');await page.wait_for_function('nativeSends.length===1')
  assert await page.evaluate('__state.jobs.length')==0
  checks.append('Native Enter sends normally without creating queue entries')
  await editor.fill('Primero, compara las dos opciones con una tabla');await editor.press('Tab');await wait_jobs(1,'queued')
  checks.append('Tab captures and clears text through the real DOM adapter')
  await editor.fill('Después, resume las diferencias principales');await editor.press('Tab');await wait_jobs(2,'queued')
  await editor.fill('Y aquí sigo escribiendo mi siguiente mensaje…')
  assert await page.locator('#cq2-panel .job').count()==2
  checks.append('All pending items expanded together')
  await page.screenshot(path=str(OUT/'light.png'));await page.evaluate("document.documentElement.classList.add('dark')");await page.screenshot(path=str(OUT/'dark.png'))
  await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'mobile.png'))
  assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth');checks.append('Light/dark and mobile layout has no horizontal overflow')
  await page.set_viewport_size({'width':1080,'height':850})
  await page.locator('#cq2-panel').get_by_role('button',name='Vaciar toda la cola',exact=True).click();await wait_jobs(0)
  assert await page.locator('#cq2-panel').count()==0;assert await editor.inner_text()=='Y aquí sigo escribiendo mi siguiente mensaje…'
  checks.append('Clear-all button hides queue and leaves native draft intact')
  await editor.fill('Comprueba los adjuntos')
  # The first is an arbitrary document, the second a real one-pixel PNG.
  import base64
  data=[{'name':'data.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4\nfixture\x00\xff'}, {'name':'tiny.png','mimeType':'image/png','buffer':base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1EAAAAASUVORK5CYII=')}]
  await page.locator('#native-file').set_input_files(data);await editor.press('Tab');await wait_jobs(1,'queued')
  job=await page.evaluate('__state.jobs[0]');assert [f['name'] for f in job['files']]==['data.pdf','tiny.png']
  for f,want in zip(job['files'],data):
   actual=await page.evaluate('(id)=>__testFiles.get(id).bytes',f['id']);assert actual==list(want['buffer'])
  assert await page.locator('[data-composer-attachments]').inner_text()==''
  checks.append('Native file picker in a portal: both attachments enqueued with exact original bytes')
  # Model controls are not touched by the source content script.
  assert await page.get_by_role('button',name='Select ChatGPT model',exact=True).count()==1
  assert await page.get_by_role('button',name='Dictate',exact=True).count()==1
  checks.append('Native model, dictation and attachment controls remain present')
  await page.evaluate('__state.jobs=[];__changed()');await wait_jobs(0)
  # A paste and drop remain uncancelled; the files are only observed by the queue.
  await page.evaluate("""()=>{const dt=new DataTransfer();dt.items.add(new File(['paste bytes'],'pasted.txt',{type:'text/plain'}));const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});window.__pasteAllowed=editor.dispatchEvent(e);const input=document.getElementById('native-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}""")
  assert await page.evaluate('__pasteAllowed');await editor.fill('Documento pegado');await editor.press('Tab');await wait_jobs(1,'queued')
  checks.append('Pasting remains native; captured original joins the queue')
  await page.evaluate('__state.jobs=[];__changed()');await wait_jobs(0)
  await page.evaluate("""()=>{const dt=new DataTransfer();dt.items.add(new File(['drop bytes'],'dropped.txt',{type:'text/plain'}));const e=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});window.__dropAllowed=editor.dispatchEvent(e);const input=document.getElementById('native-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}""")
  assert await page.evaluate('__dropAllowed');await editor.fill('Documento arrastrado');await editor.press('Tab');await wait_jobs(1,'queued')
  checks.append('Drag-and-drop not intercepted; original attaches to the queue')
  await page.evaluate('__state.jobs=[];__changed()');await wait_jobs(0)
  await editor.fill('Texto sin encolar')
  await page.evaluate("const m=document.createElement('div');m.setAttribute('role','listbox');m.textContent='Native suggestions';document.body.append(m)")
  await editor.press('Tab');await asyncio.sleep(.2);assert await page.evaluate('__state.jobs.length')==0
  checks.append('Tab in a native suggestion menu preserves native handling')
  await page.evaluate("document.querySelector('[role=listbox]').remove()")
  await editor.focus();await editor.press('Shift+Tab');await asyncio.sleep(.2);assert await page.evaluate('__state.jobs.length')==0
  checks.append('Shift+Tab keeps native focus navigation')
  await editor.fill('');await editor.press('Tab');await asyncio.sleep(.2);assert await page.evaluate('__state.jobs.length')==0
  checks.append('Empty Tab keeps native focus navigation')
  # Native use during an asynchronous queue save must not be suppressed.
  await page.evaluate('finish();window.__slowFiles=true');await editor.fill('Guardando y sigo escribiendo')
  await page.locator('#native-file').set_input_files({'name':'slow.txt','mimeType':'text/plain','buffer':b'bytes'})
  await editor.press('Tab');await editor.press('End');await editor.press('X')
  assert 'X' in await editor.inner_text();checks.append('Typing remains enabled during asynchronous file persistence')
  await editor.press('Enter');await page.wait_for_function('nativeSends.length===2')
  await wait_jobs(1,'held');checks.append('Native Enter during queue save is allowed; changed draft prevents automatic double-send')
  # Reattachment is an upgrade inside the same document, not a page reload.
  await page.evaluate('window.__slowFiles=false;__state.jobs=[];__changed();finish()')
  await wait_jobs(0)
  await editor.fill('Borrador que debe sobrevivir a una actualización')
  await page.evaluate('chrome.runtime.getManifest=()=>({version:"0.6.1"})')
  code='(function(location){'+(EXT/'content.js').read_text()+'\n})({origin:"https://chatgpt.com",pathname:"/c/'+A+'"});'
  await page.add_script_tag(content=code)
  await asyncio.sleep(.4)
  assert await editor.inner_text()=='Borrador que debe sobrevivir a una actualización'
  assert await page.evaluate('__testListeners.length')==1
  checks.append('Version reattachment removes old handlers without reloading or changing the draft')
  await page.add_script_tag(content=code)
  await editor.press('Tab');await wait_jobs(1,'queued')
  assert await page.evaluate('__testListeners.length')==1
  checks.append('Repeated injection stays idempotent: one Tab produces exactly one queue entry')
  assert not errors,errors
  checks.append('No JavaScript page errors')
  report={'passed':len(checks),'checks':checks,'errors':errors,'environment':'isolated about:blank Chromium DOM with fixture location and mocked extension RPC; extension installation blocked by container administrator policy; no live ChatGPT account'}
  (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
  await browser.close()
asyncio.run(main())
