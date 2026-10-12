/** Pure queue transitions. All external side effects belong to background.mjs. */
export const canonical = value => String(value ?? '').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
export const comparable = value => canonical(value).replace(/\s+/g,' ');
export function targetFromURL(input, draftId) {
  const u=new URL(input);
  if(u.origin!=='https://chatgpt.com'||u.username||u.password) throw Error('Solo se admiten conversaciones de https://chatgpt.com.');
  const m=u.pathname.match(/(?:^|\/)c\/([a-f0-9-]{20,64})(?:\/|$)/i);
  if(m) return {id:m[1],url:u.origin+u.pathname.replace(/\/$/,''),isNew:false};
  if(draftId?.startsWith('draft:') && (u.pathname==='/'||/^\/g\/[a-zA-Z0-9_-]+(?:\/project)?\/?$/.test(u.pathname)))
    return {id:draftId,url:u.origin+u.pathname,isNew:true};
  throw Error('Abre una conversación o un chat nuevo antes de encolar.');
}
export const newState = () => ({version:4,revision:0,cancelEpoch:0,paused:false,reason:'',jobs:[],conversations:{},aliases:{},history:[],helpers:{},helper:null,draftBackups:{},settings:{idleMs:1200,ackMs:45000,uploadMs:180000,checkMs:10000,preserveModel:true}});
/** Upgrade v0.2 state in place, retaining pending text, file IDs and uncertain attempts. */
export function migrateState(s) {
  if(!s.draftBackups||typeof s.draftBackups!=='object')s.draftBackups={};
  if(s.version!==4){
    // Drop ownership of old auxiliary tabs, but never close them or lose pending bytes.
    for(const j of s.jobs||[]){
      if(j.status==='preparing'){j.status='error';j.reason='Preparación de la versión anterior interrumpida. Revisa y reintenta.';}
      else if(j.status==='submitting'){j.status='uncertain';j.reason='Posible envío de la versión anterior. No se repetirá sin confirmación.';}
    }
    s.helpers={};
  }
  if(!s.helpers||typeof s.helpers!=='object')s.helpers={};
  s.helper=null;
  if(String(s.reason||'').startsWith('Esperando al navegador:'))s.reason='';
  s.version=4;
  return s;
}
export const pendingFor=(s,id)=>s.jobs.filter(j=>j.conversationId===(s.aliases[id]||id));
export function addJob(s,p,now=Date.now()) {
  if(p?.requestId){const old=s.jobs.find(j=>j.requestId===p.requestId);if(old)return old;}
  if(!p?.target?.id||typeof p.text!=='string'||!Array.isArray(p.files)) throw Error('Mensaje de cola inválido.');
  if(!canonical(p.text)&&!p.files.length) throw Error('Escribe un mensaje o añade un archivo.');
  if(p.text.length>2_000_000||p.files.length>80) throw Error('El mensaje supera el límite local de la cola.');
  const t=targetFromURL(p.target.url,p.target.isNew?p.target.id:undefined);
  let id=s.aliases[t.id]||t.id;
  if(!s.conversations[id]) s.conversations[id]={...t,id,localId:p.target.localId||null,title:String(p.target.title||'Chat nuevo').slice(0,250),paused:false,reason:'',waiting:null,nextCheckAt:0};
  const c=s.conversations[id];
  const job={id:globalThis.crypto.randomUUID(),requestId:p.requestId||null,conversationId:id,text:p.text,doc:p.doc||null,files:p.files.map(f=>({id:f.id,name:f.name,type:f.type||'',size:f.size,lastModified:f.lastModified||0})),sourceTabId:p.sourceTabId,model:p.model||null,options:p.options||[],createdAt:now,status:p.hold?'held':'queued',reason:'',attempt:null};
  s.jobs.push(job); c.nextCheckAt=0; return job;
}
export function markPreparing(s,id,tabId,baseline,now=Date.now()) {
  const j=s.jobs.find(j=>j.id===id),c=j&&s.conversations[j.conversationId];
  if(!j||j.status!=='queued'||pendingFor(s,j.conversationId)[0]!==j||c.waiting||c.paused||s.paused) throw Error('Este mensaje no está listo para enviarse.');
  j.status='preparing'; j.attempt={token:crypto.randomUUID(),tabId,startedAt:now,beforeUser:baseline?.lastUser?.id||null,beforeFinal:baseline?.finalId||null};
  return j;
}
export function markSubmitting(s,id,now=Date.now()) {
  const j=s.jobs.find(j=>j.id===id);
  if(!j||j.status!=='preparing'||s.paused||s.conversations[j.conversationId]?.paused) throw Error('Intento de envío duplicado o fuera de orden.');
  j.status='submitting';j.attempt.clickedAt=now;return j;
}
export function receiptMatches(j,user) {
  if(!user?.id||user.id===j.attempt?.beforeUser) return false;
  if(comparable(user.text)!==comparable(j.text)) return false;
  const names=[...(user.files||[])];
  let unnamedImages=0;
  for(const f of j.files){const at=names.indexOf(f.name);if(at>=0)names.splice(at,1);else if(f.type?.startsWith('image/'))unnamedImages++;else return false;}
  return !unnamedImages||(Number(user.imageCount)>=j.files.filter(f=>f.type?.startsWith('image/')).length);

}
export function acknowledge(s,id,user,snapshot,now=Date.now()) {
  const i=s.jobs.findIndex(j=>j.id===id),j=s.jobs[i];
  if(!j||!['submitting','uncertain'].includes(j.status)||!receiptMatches(j,user)) throw Error('El envío no está confirmado.');
  let cid=j.conversationId,c=s.conversations[cid];
  if(c.isNew&&snapshot.target&&!snapshot.target.isNew&&snapshot.target.id!==cid) {
    const real=targetFromURL(snapshot.target.url);const old=cid;cid=real.id;
    if(s.conversations[cid]&&s.conversations[cid]!==c) throw Error('La conversación de destino ya tiene otra cola.');
    delete s.conversations[old];Object.assign(c,real,{id:cid});s.conversations[cid]=c;s.aliases[old]=cid;
    for(const job of s.jobs)if(job.conversationId===old)job.conversationId=cid;
    if(s.helper?.conversationId===old)s.helper.conversationId=cid;
    if(s.helpers?.[old]){const helper=s.helpers[old];delete s.helpers[old];helper.conversationId=cid;helper.url=real.url;s.helpers[cid]=helper;}
  }
  c.waiting={receiptId:user.id,beforeFinal:j.attempt.beforeFinal,sawBusy:snapshot.state==='busy',since:now};
  c.nextCheckAt=0;
  s.jobs.splice(i,1);
  // History is metadata only; sent text and file bytes are not retained in history.
  s.history.unshift({id:j.id,conversationId:cid,sentAt:now,fileCount:j.files.length});s.history=s.history.slice(0,100);
  return j;
}
export function reconcileWait(s,id,snap,now=Date.now()) {
  const c=s.conversations[id],w=c?.waiting;
  if(!w)return false;
  if(snap.state==='busy') w.sawBusy=true;
  if(snap.lastUser?.id!==w.receiptId) return false;
  const finalChanged=!!snap.finalId&&snap.finalId!==w.beforeFinal;
  if(snap.state==='idle'&&snap.idleStable&&!snap.blocked&&(w.sawBusy||finalChanged)) {
    c.waiting=null;c.nextCheckAt=now;return true;
  }
  return false;
}
export function recoverAfterRestart(s) {
  if(!s.jobs.length&&!Object.values(s.conversations).some(c=>c.waiting))return;
  s.paused=true;s.reason='Colas recuperadas tras reiniciar el navegador. Revisa y pulsa Reanudar.';
  for(const j of s.jobs) {
    if(j.status==='submitting'){j.status='uncertain';j.reason='El navegador se cerró durante un posible envío. No se reintentará solo.';}
    else if(j.status==='preparing'){j.status='error';j.reason='La preparación quedó interrumpida. El mensaje sigue guardado.';}
  }
  s.helper=null;s.helpers={};
}

/** Remove pending entries only. Never stop an already submitted response. */
export function clearQueue(s,conversationId=null){
  const cid=s.aliases[conversationId]||conversationId;
  const removed=s.jobs.filter(j=>!cid||j.conversationId===cid);
  s.jobs=s.jobs.filter(j=>!removed.includes(j));s.cancelEpoch=(s.cancelEpoch||0)+1;
  for(const j of removed)if(['submitting','uncertain'].includes(j.status)){
    const c=s.conversations[j.conversationId];c.paused=true;
    c.reason='Cola vaciada durante un posible envío. Comprueba el chat antes de reanudar.';
  }
  return removed;
}

/** An extension upgrade is not a browser restart. Keep safe queues and manual pauses. */
export function recoverAfterUpdate(s){
  migrateState(s);
  for(const j of s.jobs){
    if(j.status==='submitting'){j.status='uncertain';j.reason='Actualización durante un posible envío. Se comprobará su confirmación, sin reenviarlo.';}
    else if(j.status==='preparing'){
      if(!j.attempt?.localBackup&&(j.attempt?.stage||'model')==='model'){j.status='queued';j.attempt=null;}
      else{j.status='error';j.reason='Preparación interrumpida por la actualización. El borrador sigue guardado.';s.conversations[j.conversationId].paused=true;}
    }
  }
  s.helpers={};return s;
}
