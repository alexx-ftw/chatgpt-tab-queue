import './core/adapter.js';
import './core/frame-page.js';
import {createSurfaceIO,surfaceForSender} from './core/surfaces.mjs';
import * as store from './core/db.mjs';
import {addJob,targetFromURL,recoverAfterRestart,recoverAfterUpdate,migrateState} from './core/model.mjs';
import {createCoordinator} from './core/coordinator.mjs';
import {createPageRPC} from './core/page-rpc.mjs';
import {createNativeUpdates,reattachPages} from './core/native-updates.mjs';
import {collectDiagnostics} from './core/diagnostics.mjs';
const CHANNEL='cq2',reports=new Map(),captures=new Map(),uiActivity=new Map();let bootPromise,timer,activeHandlers=0;
const updates=createNativeUpdates({runtime:chrome.runtime,getState:store.getState,
 isBusy:()=>activeHandlers>0||[...captures.values()].some(t=>t>Date.now())||[...uiActivity.values()].some(t=>t>Date.now())});
const topPage=createPageRPC({execute:args=>chrome.scripting.executeScript(args),func:globalThis.CQPage});
const surfaces=createSurfaceIO({api:chrome,page:topPage,frameFunc:globalThis.CQFrame});
const {page,listTabs}=surfaces;
async function publicState(tabId){
 const s=await store.getState(),helpers=s.helpers||{};
 return {...s,jobs:s.jobs.map(({doc,attempt,...j})=>({...j,text:j.text.slice(0,40000),truncated:j.text.length>40000,attempt:attempt?{stage:attempt.stage}:null})),
   helpers:Object.fromEntries(Object.entries(helpers).map(([cid,h])=>[cid,{tabId:h.tabId,conversationId:cid}])),helper:null,
   draftBackups:Object.fromEntries(Object.entries(s.draftBackups||{}).map(([token,d])=>[token,{token,conversationId:d.conversationId,createdAt:d.createdAt,active:s.jobs.some(j=>j.attempt?.token===token&&['preparing','submitting'].includes(j.status))}])),
   isHelper:false};
}
async function changed(){
 const s=await store.getState();await chrome.action.setBadgeText({text:s.jobs.length?String(s.jobs.length):''});
 await chrome.action.setBadgeBackgroundColor({color:s.paused?'#b87528':'#22695c'});
 // Only invalidate; do not broadcast the contents of every queued message to every tab.
 for(const t of await listTabs())chrome.tabs.sendMessage(t.id,{channel:CHANNEL,type:'STATE_CHANGED'}).catch(()=>{});
 chrome.runtime.sendMessage({channel:CHANNEL,type:'STATE_CHANGED'}).catch(()=>{});
}
const io={...surfaces,now:()=>Date.now(),changed,canStart:()=>!updates.pending,
 busyHint:id=>[...reports.values()].some(r=>r.at>Date.now()-9000&&((r.pathId===id&&r.state==='busy')||r.sidebar?.some(x=>x.id===id&&x.working)))
};
const coordinator=createCoordinator({store,io});
async function boot(){
 if(!bootPromise)bootPromise=(async()=>{
  await store.changeState(migrateState);
  await chrome.alarms.create('cq-check',{periodInMinutes:0.5});
 })();return bootPromise;
}
function schedule(){if(timer)return;timer=setTimeout(async()=>{timer=null;try{await boot();await coordinator.tick();await updates.applyWhenSafe();}catch(e){console.warn('[ChatGPT Queue]',e.message);}},80);}
function senderInfo(sender){
 if(sender.id!==chrome.runtime.id)throw Error('Remitente no autorizado.');
 const own=String(sender.url||'').startsWith(chrome.runtime.getURL(''));
 if(own)return {ui:true,owner:'extension-ui',tabId:sender.tab?.id};
 let origin;try{origin=new URL(sender.url||sender.tab?.url).origin;}catch{}
 if(origin!=='https://chatgpt.com'||sender.frameId!==0||!Number.isInteger(sender.tab?.id))throw Error('Solo se admiten la página de ChatGPT y la interfaz de esta extensión.');
 return {ui:false,tabId:sender.tab.id,owner:`tab:${sender.tab.id}:${sender.documentId||'main'}`};
}
const base64=bytes=>{let s='';const a=new Uint8Array(bytes);for(let at=0;at<a.length;at+=8192)s+=String.fromCharCode(...a.subarray(at,at+8192));return btoa(s);};
async function handle(m,sender){
 const who=senderInfo(sender);await boot();
 switch(m.type){
  case 'PING':return {version:chrome.runtime.getManifest().version};
  case 'CAPTURE_BEGIN':if(updates.pending)throw Error('Actualizando la extensión. Tu borrador no se ha tocado; vuelve a pulsar Tab en un momento.');captures.set(who.owner,Date.now()+300000);return true;
  case 'CAPTURE_END':captures.delete(who.owner);schedule();return true;
  case 'UI_ACTIVITY':if(who.ui){if(m.editing)uiActivity.set(who.owner,Date.now()+20000);else uiActivity.delete(who.owner);}return true;
  case 'UPDATE_INFO':return {version:chrome.runtime.getManifest().version,pending:updates.pending,url:chrome.runtime.getManifest().update_url||null};
  case 'CHECK_UPDATE':if(!who.ui)throw Error('Abre la vista de la extensión.');return chrome.runtime.requestUpdateCheck();
  case 'HELLO':case 'GET_STATE':return publicState(who.tabId);
  case 'REPORT':if(!who.ui){reports.set(who.tabId,{pathId:m.pathId,state:m.state,sidebar:Array.isArray(m.sidebar)?m.sidebar.slice(0,300):[],at:Date.now()});schedule();}return true;
  case 'CAPTURE':if(who.ui)throw Error('Abre ChatGPT para encolar desde su cuadro.');return page(who.tabId,{cmd:'capture'});
  case 'ENQUEUE':{
   if(who.ui)throw Error('Encola desde el cuadro de ChatGPT.');
   const tab=await chrome.tabs.get(who.tabId),target=targetFromURL(tab.url,m.target?.isNew?m.target.id:undefined);
   if(target.id!==m.target?.id)throw Error('Has cambiado de conversación mientras se guardaba el mensaje.');
   const files=[];for(const id of m.fileIds||[]){const f=await store.getFile(id);if(!f?.ready||f.owner!==who.owner)throw Error('No se ha guardado un archivo completo. No se ha vaciado el borrador.');files.push(f);}
   const {result:j}=await coordinator.change(s=>addJob(s,{requestId:m.requestId,target:{...target,localId:m.target.localId||null,title:m.target.title},text:m.text,doc:m.doc,files,sourceTabId:who.tabId,model:m.model,options:m.options||[],hold:true}));
   return {id:j.id};
  }
  case 'CLEAR_COMPOSER':{
   const state=await store.getState(),job=state.jobs.find(j=>j.id===m.jobId);
   if(who.ui||!job||job.sourceTabId!==who.tabId||job.status!=='held')throw Error('El mensaje se ha retirado o cambió. No se ha tocado el borrador.');
   return page(who.tabId,{cmd:'clear',conversationId:job.conversationId,localId:state.conversations[job.conversationId]?.localId,expectText:job.text,expectDoc:job.doc,expectedFiles:m.nativeFiles||[]});
  }
  case 'RELEASE':{
   const {result:r}=await coordinator.change(s=>{const j=s.jobs.find(j=>j.id===m.id);if(!j||j.sourceTabId!==who.tabId||j.status!=='held')throw Error('El mensaje ya no está en espera.');j.status='queued';return true;});schedule();return r;
  }
  case 'DIAGNOSTICS':{
   if(!who.ui)throw Error('Abre Todas las colas para obtener el diagnóstico.');
   return collectDiagnostics(await store.getState(),io,chrome.runtime.getManifest().version);
  }
  case 'GET_DRAFT_BACKUP':{
   if(!who.ui)throw Error('Recupera el borrador desde Todas las colas.');
   const s=await store.getState(),d=s.draftBackups?.[m.token];if(!d)throw Error('La copia ya se ha restaurado o eliminado.');return d.backup;
  }
  case 'DISMISS_DRAFT_BACKUP':{
   if(!who.ui)throw Error('Gestiona las copias desde Todas las colas.');
   return coordinator.change(s=>{if(s.jobs.some(j=>j.attempt?.token===m.token&&['preparing','submitting'].includes(j.status)))throw Error('Espera a que finalice el envío antes de eliminar esta copia.');if(s.draftBackups)delete s.draftBackups[m.token];});
  }
  case 'GET_JOB':{const s=await store.getState(),j=s.jobs.find(j=>j.id===m.id);if(!j)throw Error('El mensaje ya no está pendiente.');return {id:j.id,text:j.text,files:j.files,status:j.status};}
  case 'FILE_BEGIN':return store.beginFile(m.meta,who.owner);
  case 'FILE_PART':await store.writePart(m.id,m.index,m.data,who.owner);return true;
  case 'FILE_FINISH':return store.finishFile(m.id,who.owner);
  case 'FILE_DELETE':{
   const f=await store.getFile(m.id),s=await store.getState();if(!f)return true;
   if((f.owner!==who.owner&&!who.ui)||s.jobs.some(j=>j.files.some(x=>x.id===m.id)))throw Error('Ese archivo pertenece a un mensaje pendiente.');
   await store.deleteFile(m.id);return true;
  }
  case 'FILE_READ':{
   const s=await store.getState(),j=s.jobs.find(j=>j.id===m.jobId);
   if(!j||j.status!=='preparing'||j.attempt?.token!==m.token||j.attempt.tabId!==surfaceForSender(who.tabId,m.frameToken)||!j.files.some(f=>f.id===m.fileId)||s.paused||s.conversations[j.conversationId]?.paused)throw Error('Subida cancelada.');
   const bytes=await store.readPart(m.fileId,m.index);return bytes?base64(bytes):null;
  }
  case 'UPLOAD_RESULT':{
   const s=await store.getState(),j=s.jobs.find(j=>j.id===m.jobId);
   if(j?.attempt?.tabId!==surfaceForSender(who.tabId,m.frameToken)||j?.attempt?.token!==m.token)return false;
   await coordinator.uploadResult(j.id,m.token,m.error||null);schedule();return true;
  }
  case 'CLEAR_ALL':return coordinator.clear();
  case 'CLEAR_CHAT':return coordinator.clear(m.conversationId);
  case 'REMOVE':return coordinator.remove(m.id);
  case 'PAUSE':return coordinator.pause(m.conversationId||null);
  case 'RESUME':await coordinator.resume(m.conversationId||null);schedule();return true;
  case 'RETRY':await coordinator.retry(m.id);schedule();return true;
  case 'EDIT':return coordinator.change(s=>{const j=s.jobs.find(j=>j.id===m.id);if(!j||!['queued','held','error'].includes(j.status))throw Error('Ese mensaje ya se está enviando.');if(typeof m.text!=='string'||m.text.length>2000000||(!m.text.trim()&&!j.files.length))throw Error('Texto inválido.');j.text=m.text;j.doc=null;});
  case 'SETTINGS':return coordinator.change(s=>{if(typeof m.preserveModel==='boolean')s.settings.preserveModel=m.preserveModel;});
  case 'OPEN_MANAGER':await chrome.tabs.create({url:chrome.runtime.getURL('ui/manager.html')});return true;
  case 'OPEN_CHAT':{const s=await store.getState(),id=s.aliases[m.conversationId]||m.conversationId,c=s.conversations[id];if(!c)throw Error('Conversación no encontrada.');await chrome.tabs.create({url:c.url});return true;}
  case 'MANUAL_STOP':{
   const s=await store.getState();const id=m.conversationId;if(s.conversations[id])await coordinator.pause(id);return true;
  }
  default:throw Error('Operación de cola desconocida.');
 }
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(m?.channel!==CHANNEL||m.type==='STATE_CHANGED')return;
 activeHandlers++;
 handle(m,sender).then(value=>respond({ok:true,value}),e=>respond({ok:false,error:e.message}))
  .finally(()=>{activeHandlers--;if(updates.pending)schedule();});return true;
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='cq-check')schedule();});
chrome.runtime.onStartup.addListener(()=>{store.changeState(recoverAfterRestart).then(boot).then(schedule).catch(console.error);});
chrome.runtime.onInstalled.addListener(details=>{
 (async()=>{await boot();if(details.reason==='update')await store.changeState(recoverAfterUpdate);await store.cleanOrphans();await reattachPages(chrome);await changed();schedule();})().catch(console.error);
});
chrome.runtime.onUpdateAvailable.addListener(details=>{updates.available(details);schedule();});
chrome.tabs.onRemoved.addListener(id=>{reports.delete(id);schedule();});
chrome.tabs.onUpdated.addListener((_id,info)=>{if(info.status==='complete'||info.frozen===false){reattachPages(chrome,_id).catch(()=>{});schedule();}});
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('ui/manager.html')}));
// Fast while a worker is awake; alarms and content events recover after worker suspension.
setInterval(schedule,1000);
boot().then(schedule).catch(console.error);
