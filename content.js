(() => {
 'use strict';
 const VERSION=chrome.runtime.getManifest().version,previous=globalThis.__CQ2Content;
 if(previous?.version===VERSION)return;previous?.dispose?.();
 let disposed=false,observer=null,interval=null;const listeners=[];
 function listen(target,type,fn,opts){target.addEventListener(type,fn,opts);listeners.push(()=>target.removeEventListener(type,fn,opts));}
 globalThis.__CQ2Content={version:VERSION,dispose(){disposed=true;for(const remove of listeners)remove();observer?.disconnect();clearInterval(interval);clearTimeout(refreshTimer);clearTimeout(heartbeatTimer);clearTimeout(toastTimer);jobList?.dispose();host?.remove();toast?.remove();for(const task of uploads.values())task.cancelled=true;try{chrome.runtime.onMessage.removeListener(onRuntimeMessage);}catch{}},nativeFiles:previous?.nativeFiles||new Map(),uiDrafts:previous?.uiDrafts||new Map()};
 const {rpc,storeFile,prettySize}=globalThis.CQClient;
 const FORM='form[data-chatgpt-composer],form[data-type="unified-composer"]';
 const EDITOR='[data-composer-markdown][contenteditable="true"],#prompt-textarea[contenteditable="true"],textarea#prompt-textarea,.ProseMirror[contenteditable="true"][role="textbox"]';
 const clean=s=>String(s??'').trim();
 let state=null,host,shadow,list,statusNode,pauseButton,clearButton,noticeNode,jobList,mountedCid;
 let saving=false,composing=false,capturedTab=false,refreshing=false,refreshAgain=false,signature='',refreshTimer;
 let draftSeed=crypto.randomUUID(),lastLocal=null,lastPath=location.pathname,heartbeatTimer,toast,toastTimer;
 const uiDrafts=globalThis.__CQ2Content.uiDrafts;
 const nativeFiles=globalThis.__CQ2Content.nativeFiles,seenCards=new Map(),uploads=new Map();
 function inspect(){try{const s=CQPage({cmd:'inspect'});if(s&&typeof s==='object')return s;}catch{}
  return {ready:false,text:'',pathId:null,attachments:{count:0,items:[],unsupported:false,loading:false}};
 }
 function target(snap=inspect()){
  const path=location.pathname;
  if(path!==lastPath){if(!/\/c\//.test(path))draftSeed=crypto.randomUUID();lastPath=path;}
  if(snap.localId&&snap.localId!==lastLocal){if(!snap.pathId)draftSeed=crypto.randomUUID();lastLocal=snap.localId;}
  return {id:snap.pathId||`draft:${draftSeed}`,url:location.origin+path,isNew:!snap.pathId,localId:snap.localId||null,title:snap.title||document.title||'Chat nuevo'};
 }
 function nativeCaptured(key=target().id){if(!nativeFiles.has(key))nativeFiles.set(key,[]);return nativeFiles.get(key);}
 const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 function button(label,action,icon){
  const b=element('button',icon||label);b.type='button';b.title=label;b.setAttribute('aria-label',label);
  b.addEventListener('click',()=>Promise.resolve().then(action).catch(e=>notify(e.message)));return b;
 }
 const paths={pause:'M7 4v12M13 4v12',play:'m7 4 9 6-9 6z',trash:'M3 5h14M8 5V3h4v2M5 5l1 12h8l1-12M8 8v6M12 8v6',open:'M4 4h5M4 4v12h12v-5M11 3h6v6M17 3l-8 8',remove:'m5 5 10 10M5 15 15 5',edit:'m4 13 9-9 3 3-9 9-4 1z',retry:'M16 6a7 7 0 1 0 1 6M16 2v5h-5'};
 function setIcon(b,name){
  if(b.dataset.icon===name)return;b.dataset.icon=name;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('width','16');svg.setAttribute('height','16');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.4');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',paths[name]);svg.append(p);b.replaceChildren(svg);
 }
 function iconButton(label,action,name){const b=button(label,action);setIcon(b,name);return b;}
 function notify(text){
  // Feedback only after an explicit queue action; never a permanent empty queue toolbar.
  if(!document.body)return;
  if(!toast){toast=element('div');toast.id='cq2-notice';toast.setAttribute('role','status');toast.style.cssText='position:fixed;inset:auto 16px 22px auto;max-width:min(440px,calc(100vw - 32px));padding:10px 14px;border:1px solid var(--border-light,var(--color-border,#8884));border-radius:14px;z-index:2147483646;font:13px/1.4 system-ui;color:var(--text-primary,var(--color-text,inherit));background:var(--main-surface-primary,var(--color-surface,Canvas));box-shadow:0 3px 20px #0001';document.body.append(toast);}
  toast.textContent=String(text);clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast?.remove();toast=null;},6500);
 }
 async function refresh(){
  if(disposed)return;if(refreshing){refreshAgain=true;return;}refreshing=true;
  try{const fresh=await rpc('GET_STATE');if(disposed)return;state=fresh;render();}catch(e){if(!disposed)console.debug('[ChatGPT Queue]',e.message);}
  finally{refreshing=false;if(refreshAgain){refreshAgain=false;scheduleRefresh();}}
 }
 function scheduleRefresh(){if(disposed||refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;refresh();},100);}
 function unmount(){jobList?.dispose();jobList=null;host?.remove();host=null;shadow=null;mountedCid=null;signature='';}
 function mount(cid){
  const anchor=globalThis.CQPage({cmd:'uiAnchor'}),form=anchor?.form;
  if(!form||!anchor.editor){unmount();return false;}
  if(mountedCid&&mountedCid!==cid)unmount();
  if(!host){
   const V=globalThis.CQView;mountedCid=cid;
   host=element('div');host.id='cq2-panel';host.style.cssText='display:block;min-width:0;width:100%;margin:0;position:relative;z-index:4';
   shadow=host.attachShadow({mode:'open'});
   const style=element('style');style.textContent=`
    :host{--q-font:var(--font-sans,system-ui,sans-serif);--q-fg:var(--text-primary,var(--color-text,CanvasText));--q-muted:var(--text-secondary,var(--color-text-secondary,var(--color-text,GrayText)));--q-bg:var(--main-surface-primary,var(--color-surface,Canvas));--q-soft:var(--main-surface-secondary,var(--color-bg-primary-ghost-hover,#8881));--q-hover:var(--main-surface-secondary,var(--color-bg-primary-ghost-hover,#8882));--q-line:var(--border-light,var(--color-border,#8883));--q-warning:var(--text-primary,var(--color-text,CanvasText));font:12px/1.45 var(--q-font);color:var(--q-muted)}
    *{box-sizing:border-box}[hidden]{display:none!important}
    .panel{padding:0 8px 5px;background:transparent}.bar{display:flex;align-items:center;gap:2px;min-height:32px;padding:0 0 4px}.status{flex:1;min-width:0;font-size:12px;line-height:1.5;margin-right:6px}
    .bar button{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:30px;height:30px;color:inherit;background:transparent;border:0;border-radius:9px;padding:6px;cursor:pointer}
    .bar button:hover{background:var(--q-hover);color:var(--q-fg)}.bar button:focus-visible{outline:2px solid var(--q-fg);outline-offset:2px}.bar button:disabled{opacity:.4;cursor:default}
    .list{max-height:min(35vh,340px);overflow:auto;scrollbar-width:thin;scrollbar-color:var(--q-line) transparent;overscroll-behavior:contain}.queue-notice{font-size:11px;color:var(--q-muted);padding:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}
    .panel .cq-job{padding:9px 0}.panel .cq-text{font-size:13px;line-height:1.55}
    @media(hover:none),(pointer:coarse){.bar button{width:36px;height:36px}}
    @media(max-width:440px){.panel{padding-inline:4px}.bar{gap:0}.status{font-size:11px}.list{max-height:36vh}.panel .cq-job{padding:8px 0}}
   `;
   const panel=element('section',undefined,'panel');panel.setAttribute('aria-label','Mensajes en cola');
   const bar=element('div',undefined,'bar');statusNode=element('span','','status');statusNode.setAttribute('role','status');statusNode.setAttribute('aria-live','polite');statusNode.setAttribute('aria-atomic','true');
   pauseButton=iconButton('Pausar esta cola',async()=>{const current=state.aliases[target().id]||target().id;await rpc(state.paused?'RESUME':state.conversations[current]?.paused?'RESUME':'PAUSE',{conversationId:state.paused?null:current});await refresh();},'pause');
   clearButton=iconButton('Vaciar toda la cola',async()=>{
    const n=state?.jobs.length||0;if(!n)return;
    if(confirm(`¿Vaciar toda la cola? Se eliminarán ${n} pendientes de todas las conversaciones y sus archivos locales. No se detiene la respuesta en curso.`)){await rpc('CLEAR_ALL');for(const d of uiDrafts.values())d.clear();jobList?.discardEdits();await refresh();}
   },'trash');
   const all=iconButton('Todas las colas',()=>rpc('OPEN_MANAGER'),'open');
   bar.append(statusNode,pauseButton,clearButton,all);list=element('div',undefined,'list');noticeNode=element('div','','queue-notice');noticeNode.hidden=true;panel.append(bar,list,noticeNode);shadow.append(style,V.style(),panel);
   if(!uiDrafts.has(cid))uiDrafts.set(cid,new Map());
   jobList=V.createJobList(list,{rpc,notify,refresh,compact:true,drafts:uiDrafts.get(cid),isAlive:()=>!disposed});
  }
  if(host.parentNode!==form.parentNode||host.nextSibling!==form)form.before(host);
  return true;
 }
 function render(){
  if(disposed||!state)return;
  const snap=inspect(),key=target(snap).id,cid=state.aliases[key]||key,c=state.conversations[cid],jobs=state.jobs.filter(j=>j.conversationId===cid);
  // Only pending queues are shown. Keep an actively edited, concurrently removed
  // item available for copying rather than silently destroying unsaved user text.
  const hasEdit=uiDrafts.get(cid)?.size>0;
  if(state.isHelper||(!jobs.length&&!hasEdit)){unmount();return;}
  if(!document.body||!mount(cid))return;
  const V=globalThis.CQView,paused=state.paused||c?.paused;
  V.text(statusNode,jobs.length?`${jobs.length} en cola · ${V.queueStatus(c,jobs,{paused:state.paused,busy:snap.state==='busy'})}`:'Edición sin guardar');
  pauseButton.title=state.paused?'Reanudar todas las colas':paused?'Reanudar esta cola':'Pausar esta cola';pauseButton.setAttribute('aria-label',pauseButton.title);setIcon(pauseButton,paused?'play':'pause');
  clearButton.disabled=saving||!state.jobs.length;
  jobList.update(jobs,{paused});
  const reason=String(c?.reason||'');V.text(noticeNode,reason.startsWith('Esperando al navegador:')?'Reconectando con el chat. Los mensajes siguen guardados.':reason);noticeNode.title=reason;noticeNode.hidden=!reason;
 }
 async function enqueue(){
  if(saving||state?.isHelper||document.querySelector('form[data-cq-reservation]'))return;saving=true;
  const uploaded=[];let jobId=null;
  try{
   await rpc('CAPTURE_BEGIN');
   const snap=await rpc('CAPTURE'),t=target(snap);
   if(snap.oldUserscript)throw Error('Desactiva el userscript anterior y recarga ChatGPT antes de encolar.');
   const native=globalThis.CQSelectCapturedFiles(snap.attachments,nativeCaptured(t.id));
   if(!clean(snap.text)&&!native.length)return;
   // Snapshot first. Never prevent typing, Enter, paste, menus or native attachment selection.
   for(const file of native)uploaded.push(await storeFile(file));
   const answer=await rpc('ENQUEUE',{requestId:crypto.randomUUID(),target:t,text:snap.text,doc:snap.doc,model:snap.model,options:snap.options||[],fileIds:uploaded.map(f=>f.id)});jobId=answer.id;
   await rpc('CLEAR_COMPOSER',{jobId,nativeFiles:native.map(f=>({name:f.name,type:f.type,size:f.size}))});
   let empty=false;
   for(let n=0;n<20;n++){
    const fresh=inspect();if(target(fresh).id!==t.id)break;
    if(!clean(fresh.text)&&fresh.attachments.count===0){empty=true;break;}
    await new Promise(r=>setTimeout(r,100));
   }
   if(!empty)throw Error('El borrador cambió durante el guardado. El pendiente está conservado pero no se enviará hasta que lo revises.');
   await rpc('RELEASE',{id:jobId});nativeFiles.set(t.id,[]);seenCards.delete(t.id);
  }catch(e){
   notify(e.message);if(!jobId)for(const f of uploaded)await rpc('FILE_DELETE',{id:f.id}).catch(()=>{});
  }finally{saving=false;await rpc('CAPTURE_END').catch(()=>{});signature='';await refresh();}
 }
 async function runUpload(m,task){
  try{
   const files=[];
   for(const f of m.files){const parts=[];let total=0,index=0;
    // Even an empty file checks the live lease before touching the helper input.
    do{if(task.cancelled)throw Error('Subida cancelada.');const encoded=await rpc('FILE_READ',{jobId:m.jobId,token:m.token,frameToken:m.frameToken,fileId:f.id,index:index++});if(encoded===null)break;const raw=atob(encoded),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));parts.push(bytes);total+=bytes.length;}while(total<f.size);
    if(total!==f.size)throw Error('No se pudo recuperar el archivo completo: '+f.name);
    files.push(new File(parts,f.name,{type:f.type,lastModified:f.lastModified}));
   }
   if(task.cancelled)throw Error('Subida cancelada.');
   const fresh=globalThis.CQPage({cmd:'inspect',frameToken:m.frameToken});if(!fresh.ready||(!m.conversationId.startsWith('draft:')&&fresh.pathId!==m.conversationId)||fresh.attachments.count||fresh.attachments.unsupported)throw Error('El editor cambió o contiene otros adjuntos.');
   let targetDocument=document;
   if(m.frameToken){
    const frame=[...document.querySelectorAll('iframe[data-cq-frame-token]')].find(f=>f.getAttribute('data-cq-frame-token')===m.frameToken);
    if(!frame?.isConnected||!frame.contentDocument)throw Error('El contexto interno se cerró. No se adjuntará nada a tu chat visible.');
    targetDocument=frame.contentDocument;
   }
   const form=targetDocument.querySelector(FORM),inputs=[...(form?.querySelectorAll('input[type="file"]')||[])];
   const input=inputs.find(x=>!x.accept||/^(\*\/\*)$/.test(x.accept)||/^(attach files|adjuntar archivos)$/i.test(x.getAttribute('aria-label')||''))||inputs[inputs.length-1];
   if(!input)throw Error('No se encuentra la entrada nativa de archivos.');
   const dt=new DataTransfer();for(const f of files)dt.items.add(f);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
   await rpc('UPLOAD_RESULT',{jobId:m.jobId,token:m.token,frameToken:m.frameToken});
  }catch(e){await rpc('UPLOAD_RESULT',{jobId:m.jobId,token:m.token,frameToken:m.frameToken,error:e.message}).catch(()=>{});}
  finally{uploads.delete(m.token);}
 }
 function onRuntimeMessage(m,sender,respond){
  if(m?.channel!=='cq2'||sender.id!==chrome.runtime.id)return;
  if(m.type==='PING'){respond({ok:true,version:VERSION});return;}
  if(m.type==='STATE_CHANGED'){scheduleRefresh();return;}
  if(m.type==='UPLOAD'){if(uploads.has(m.token)){respond({ok:true});return;}const task={cancelled:false};uploads.set(m.token,task);respond({ok:true});runUpload(m,task);return;}
  if(m.type==='CANCEL_UPLOAD'){const task=uploads.get(m.token);if(task)task.cancelled=true;respond({ok:true});}
 }
 chrome.runtime.onMessage.addListener(onRuntimeMessage);
 function nativeTabContext(editor){
  const node=window.getSelection?.()?.anchorNode,parent=node?.nodeType===1?node:node?.parentElement;
  if(parent?.closest('td,th,pre,[role="gridcell"]'))return true;
  return [...document.querySelectorAll('[role="listbox"],[role="menu"],[role="dialog"]')].some(x=>x.getClientRects().length&&!x.closest('[hidden],[aria-hidden="true"]'));
 }
 listen(document,'keydown',e=>{
  if(e.key==='Tab'&&capturedTab&&e.repeat){e.preventDefault();e.stopImmediatePropagation();return;}
  if(e.defaultPrevented||e.key!=='Tab'||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey||e.isComposing||composing||state?.isHelper)return;
  const editor=e.target?.closest?.(EDITOR);if(!editor?.closest(FORM)||editor.closest('form[data-cq-reservation]')||nativeTabContext(editor))return;
  const snap=inspect();if(!clean(snap.text)&&!snap.attachments.count&&!snap.attachments.unsupported)return;
  e.preventDefault();e.stopImmediatePropagation();capturedTab=true;if(!e.repeat)enqueue();
 },true);
 listen(document,'keyup',e=>{if(e.key==='Tab')capturedTab=false;},true);
 listen(window,'blur',()=>{capturedTab=false;});
 listen(document,'compositionstart',()=>{composing=true;},true);
 listen(document,'compositionend',()=>{composing=false;},true);
 function captureFiles(e){
  if(state?.isHelper||document.querySelector('form[data-cq-reservation]')||e.composedPath().includes(host))return;
  let files=[];
  // The native picker may be rendered in a portal, outside the composer form.
  if(e.type==='change'&&e.target?.matches?.('input[type="file"]'))files=[...(e.target.files||[])];
  else if(e.type==='paste'&&e.target?.closest?.(EDITOR))files=[...(e.clipboardData?.files||[])];
  else if(e.type==='drop')files=[...(e.dataTransfer?.files||[])];
  if(!files.length||!inspect().ready)return;
  const key=target().id,a=nativeCaptured(key);
  for(const f of files)if(!a.includes(f))a.push(f);
  // Observe only: no cancellation, synthetic replacement, picker or extra attachment UI.
  seenCards.set(key,{...seenCards.get(key),capturedAt:Date.now()});scheduleHeartbeat();
 }
 for(const name of ['change','paste','drop'])listen(document,name,captureFiles,true);
 listen(document,'click',e=>{
  const b=e.target?.closest?.('button');
  if(b?.closest(FORM)&&/^(stop|stop generating|detener|detener generación)$/i.test(b.getAttribute('aria-label')||'')){
   const id=inspect().pathId;if(id)rpc('MANUAL_STOP',{conversationId:id}).catch(()=>{});
  }
 },true);
 let lastReport='';
 async function heartbeat(force=false){
  if(disposed)return;
  // State invalidations are best-effort. Recover from a missed notification on
  // navigation/visibility and on the existing five-second heartbeat.
  if(force||!state){await refresh();if(disposed||!state)return;}const snap=inspect(),t=target(snap);
  const seen=seenCards.get(t.id)||{};
  if(snap.attachments.count)seenCards.set(t.id,{...seen,hadCards:true});
  else if(seen.hadCards&&!saving&&Date.now()-(seen.capturedAt||0)>1500){nativeFiles.delete(t.id);seenCards.delete(t.id);}
  const sidebar=globalThis.CQPage({cmd:'sidebar'});
  const report=JSON.stringify([snap.pathId,snap.state,location.pathname,state.isHelper,sidebar]);
  if(force||report!==lastReport){lastReport=report;await rpc('REPORT',{pathId:snap.pathId,state:snap.state,sidebar}).catch(()=>{});}
  if(!disposed)render();
 }
 function scheduleHeartbeat(){if(disposed||heartbeatTimer)return;heartbeatTimer=setTimeout(()=>{heartbeatTimer=null;heartbeat().catch(()=>{});},120);}
 function start(){
  heartbeat(true).catch(()=>{});
  observer=new MutationObserver(records=>{
   if(records.some(r=>{
    // React may remove only our sibling panel while keeping the same form.
    if(host&&[...r.removedNodes].some(n=>n===host||n.contains?.(host)))return true;
    if(r.target===host||r.target===toast||host?.contains(r.target))return false;
    if(r.target?.closest?.(FORM))return true;
    if(r.type==='attributes'&&r.target?.querySelector?.(FORM))return true;
    return [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.(FORM)||n.querySelector?.(FORM)));
   }))scheduleHeartbeat();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','disabled','aria-disabled','data-map-composer-conversation','data-above-composer-conversation-id','hidden','aria-hidden','inert','class','style']});
  interval=setInterval(()=>heartbeat(true).catch(()=>{}),5000);
  for(const name of ['pageshow','online','popstate'])listen(window,name,()=>heartbeat(true).catch(()=>{}));
  listen(document,'visibilitychange',()=>heartbeat(true).catch(()=>{}));
 }
 if(document.readyState==='loading')listen(document,'DOMContentLoaded',start,{once:true});else start();
})();
