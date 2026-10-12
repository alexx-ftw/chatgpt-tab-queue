"""Isolated local-browser proof of frame routing, focus, SPA survival and upload bytes.
Uses local fixture pages, not a live ChatGPT account or installed extension. The two
production origin literals are substituted in memory ONLY for localhost fixtures.
No browser security policy, headers, profiles or installed extensions are changed.
"""
import asyncio, base64, json, threading, argparse
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from playwright.async_api import async_playwright
p=argparse.ArgumentParser();p.add_argument('--extension',required=True);p.add_argument('--evidence',required=True);p.add_argument('--browser',default='/usr/bin/chromium');a=p.parse_args()
EXT=Path(a.extension);OUT=Path(a.evidence);OUT.mkdir(parents=True,exist_ok=True)
A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222';C='33333333-3333-4333-8333-333333333333'
HTML='''<!doctype html><html><head><meta charset="utf-8"><title>Local queue context test</title><style>body{font:16px system-ui;margin:60px auto;max-width:650px;background:#212121;color:#eee}textarea{width:100%;height:100px;box-sizing:border-box;border:1px solid #777;border-radius:18px;background:#303030;color:#eee;padding:14px}button{border:0;border-radius:12px;padding:8px}input[type=file]{display:none}.turn{padding:20px 0}[data-composer-attachments]{padding:5px}</style></head><body><h1 id="label">Chat visible</h1><main><div id="history"><div data-turn-key="before" class="turn"><div data-user-message-bubble="true" data-message-id="before"><span data-message-text>Mensaje anterior</span></div><div data-chatgpt-search-unit-key="0:assistant" data-message-id="final-before">Respuesta terminada</div><button aria-label="Regenerate response">↻</button></div></div><form data-chatgpt-composer><div data-composer-attachments></div><textarea id="prompt-textarea" aria-label="Ask ChatGPT"></textarea><input type="file" multiple aria-label="Attach files"><button id="send" type="button" aria-label="Start Voice">Enviar</button></form></main><script>
window.sent=[];window.nativeFiles=[];window.fileBytes=[];const editor=document.querySelector('textarea'),send=document.querySelector('#send'),input=document.querySelector('input'),area=document.querySelector('[data-composer-attachments]');
window.busy=false;function update(){send.setAttribute('aria-label',busy?'Stop':editor.value||nativeFiles.length?'Send':'Start Voice');}editor.oninput=update;
input.onchange=async()=>{for(const f of input.files){nativeFiles.push(f);fileBytes.push([...new Uint8Array(await f.arrayBuffer())]);const card=document.createElement('div');card.setAttribute('data-file-name',f.name);const name=document.createElement('span');name.textContent=f.name;card.append(name);const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Remove '+f.name);b.onclick=()=>{nativeFiles=nativeFiles.filter(x=>x!==f);card.remove();update();};card.append(b);area.append(card);}update();};
send.onclick=()=>{if(busy)return;sent.push({text:editor.value,names:nativeFiles.map(x=>x.name)});const turn=document.createElement('div');turn.setAttribute('data-turn-key','u'+sent.length);const user=document.createElement('div');user.setAttribute('data-user-message-bubble','true');user.setAttribute('data-message-id','u'+sent.length);const text=document.createElement('span');text.setAttribute('data-message-text','');text.textContent=editor.value;user.append(text);for(const f of nativeFiles){const x=document.createElement('span');x.setAttribute('data-file-name',f.name);x.textContent=f.name;user.append(x);}turn.append(user);document.querySelector('#history').append(turn);editor.value='';nativeFiles=[];area.replaceChildren();busy=true;update();};
window.finish=()=>{const t=document.querySelector('#history').lastElementChild;const ans=document.createElement('div');ans.setAttribute('data-chatgpt-search-unit-key','0:assistant');ans.setAttribute('data-message-id','answer-'+sent.length);ans.textContent='Terminó';t.append(ans);const b=document.createElement('button');b.setAttribute('aria-label','Regenerate response');t.append(b);busy=false;update();};
</script></body></html>'''
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('X-Frame-Options','SAMEORIGIN');self.end_headers();self.wfile.write(HTML.encode())
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();ORIGIN=f'http://127.0.0.1:{server.server_port}'
async def main():
 checks=[];errors=[]
 def check(name,condition):
  assert condition,name
  checks.append(name)
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path=a.browser,headless=True,args=['--no-sandbox','--disable-background-networking'])
  context=await browser.new_context(viewport={'width':1050,'height':800});page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(f'{ORIGIN}/c/{B}');await page.locator('textarea').fill('Borrador que no se debe tocar');await page.locator('textarea').focus()
  for name in ['core/adapter.js','core/frame-page.js']:
   source=(EXT/name).read_text().replace('https://chatgpt.com',ORIGIN)
   await page.add_script_tag(content=source)
  create=lambda cid:page.evaluate('(a)=>CQFrame(a)',{'cmd':'ensure','url':f'{ORIGIN}/c/{cid}','conversationId':cid})
  f=await create(A);token=f['token']
  await page.wait_for_function('(t)=>CQFrame({cmd:"status",token:t}).status==="complete"',arg=token)
  check('only one browser tab',len(context.pages)==1)
  check('visible URL unchanged after internal creation',page.url==f'{ORIGIN}/c/{B}')
  check('frame is inert and outside layout',await page.evaluate('(t)=>{const f=[...document.querySelectorAll("iframe")].find(x=>x.dataset.cqFrameToken===t);return f.inert&&f.getBoundingClientRect().right<0&&f.tabIndex===-1}',token))
  call=lambda args:page.evaluate('(a)=>CQPage(a)',args)
  r=await call({'cmd':'localSend','frameToken':token,'conversationId':A,'token':'text-lease','text':'uno en A','expectText':'','beforeUser':'before','expectedFiles':[],'options':[]})
  check('text sent in hidden native composer',r.get('clicked') is True)
  check('visible draft preserved',await page.locator('textarea').input_value()=='Borrador que no se debe tocar')
  check('visible focus preserved',await page.evaluate('document.activeElement.id')=='prompt-textarea')
  check('no native parent messages sent',await page.evaluate('sent.length')==0)
  # Simulate the relevant SPA operation: replace current route without replacing document.
  await page.evaluate('(p)=>{history.pushState({},"",p);document.querySelector("#label").textContent="Otro chat visible";}',f'/c/{C}')
  await page.locator('textarea').fill('Borrador nuevo en C')
  check('A frame survives manual SPA chat change',(await call({'cmd':'inspect','frameToken':token}))['pathId']==A)
  fc=await create(B);t2=fc['token'];await page.wait_for_function('(t)=>CQFrame({cmd:"status",token:t}).status==="complete"',arg=t2)
  r=await call({'cmd':'localSend','frameToken':t2,'conversationId':B,'token':'second','text':'independiente en B','expectText':'','beforeUser':'before','options':[]})
  check('second context sends while first reply remains busy',r.get('clicked') is True and (await call({'cmd':'inspect','frameToken':token}))['state']=='busy')
  check('visible new chat remains C',page.url==f'{ORIGIN}/c/{C}')
  # Real native input FileList; content script RPC is simulated, bytes and event dispatch are not.
  await page.evaluate('(t)=>[...document.querySelectorAll("iframe")].find(f=>f.dataset.cqFrameToken===t).contentWindow.finish()',token)
  file={'id':'pdf1','name':'prueba.pdf','type':'application/pdf','size':7,'lastModified':0}
  await call({'cmd':'localBegin','frameToken':token,'conversationId':A,'token':'file-lease','text':'con documento','expectedFiles':[file],'beforeUser':'u1'})
  await call({'cmd':'write','frameToken':token,'conversationId':A,'expectText':'','snapshot':{'text':'con documento'}})
  await page.evaluate('''()=>{window.testListeners=[];window.uploadResults=[];window.chrome={runtime:{id:'test',onMessage:{addListener(f){testListeners.push(f)}},async sendMessage(m){if(m.type==='FILE_READ')return {ok:true,value:m.index===0?'AQIDBAUGBw==':null};if(m.type==='UPLOAD_RESULT'){uploadResults.push(m);return {ok:true,value:true};}if(m.type==='GET_STATE')return {ok:true,value:{jobs:[],conversations:{},aliases:{},helpers:{},revision:0}};return {ok:true,value:true};}}};}''')
  for name in ['core/client.js','core/file-matching.js','content.js']:
   await page.add_script_tag(content=(EXT/name).read_text().replace('https://chatgpt.com',ORIGIN))
  await page.evaluate('''m=>{for(const fn of testListeners)fn(m,{id:'test'},()=>{});}''',{'channel':'cq2','type':'UPLOAD','jobId':'job1','token':'file-lease','conversationId':A,'frameToken':token,'files':[file]})
  await page.wait_for_function('uploadResults.length>0')
  results=await page.evaluate('uploadResults')
  check('file upload completes with frame token',results[0].get('error') is None and results[0]['frameToken']==token)
  check('original file bytes reach internal native input',await page.evaluate('(t)=>[...document.querySelectorAll("iframe")].find(f=>f.dataset.cqFrameToken===t).contentWindow.fileBytes[0]',token)==[1,2,3,4,5,6,7])
  check('visible composer receives no queued attachment',await page.evaluate('nativeFiles.length')==0)
  r=await call({'cmd':'send','frameToken':token,'conversationId':A,'token':'file-lease','text':'con documento','expectedFiles':[file],'beforeUser':'u1','options':[]})
  check('message with file sent inside A',r.get('clicked') is True)
  r=await call({'cmd':'localEnd','frameToken':token,'conversationId':A,'token':'file-lease','expectedFiles':[file],'afterSend':True})
  check('file transaction ends correctly',r.get('ok') is True)
  await page.evaluate('(t)=>CQFrame({cmd:"release",token:t})',t2)
  failed=await page.evaluate('(t)=>{try{CQPage({cmd:"inspect",frameToken:t});return false}catch{return true}}',t2)
  check('removed target cannot fall back to visible parent',failed)
  check('final URL, draft and browser tab count unchanged',page.url==f'{ORIGIN}/c/{C}' and await page.locator('textarea').input_value()=='Borrador nuevo en C' and len(context.pages)==1)
  check('no JavaScript page errors',not errors)
  await page.screenshot(path=str(OUT/'visible-unchanged.png'))
  (OUT/'results.json').write_text(json.dumps({'passed':checks,'count':len(checks),'errors':errors,'scope':'Local same-origin fixtures. Origin literals replaced in memory. No live ChatGPT or extension installation.'},indent=2,ensure_ascii=False))
  print(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},ensure_ascii=False))
  await browser.close()
try:asyncio.run(main())
finally:server.shutdown()
