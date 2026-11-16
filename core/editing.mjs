/** Transaction-only edit reservations. No browser access, timers or send side effects.
 * Pausing to edit is scoped to a conversation and never replaces a user pause.
 * Sessions are durable across worker suspension; closing the browser requires review.
 */
export const EDIT_REASON='Editando un mensaje de la cola';
export const hasEdits=c=>!!c?.editPause?.sessions?.length;
export function retainPause(c){if(c?.editPause)c.editPause.resume=false;}
/** Identity comes from the authenticated browser sender, never the request body. */
export function uiEditOwner(sender){
 if(typeof sender?.documentId!=='string'||!sender.documentId)throw Error('No se puede identificar el documento de edición. Vuelve a abrir la vista de colas.');
 return Number.isInteger(sender.tab?.id)&&sender.tab.id>=0?`ui-tab:${sender.tab.id}:${sender.documentId}`:`ui-document:${sender.documentId}`;
}
const uiDocument=owner=>String(owner).match(/^(?:ui-tab:\d+:|ui-document:)(.+)$/)?.[1]||null;
export function uiEditOwners(s){
 return [...new Set(Object.values(s.conversations||{}).flatMap(c=>[...(c.editPause?.sessions||[]),...(c.editReceipts||[])]).map(x=>x.owner).filter(owner=>uiDocument(owner)))];
}
export const missingUIEditOwners=(owners,contexts)=>{
 const documents=new Set(contexts.map(c=>c.documentId).filter(Boolean));
 return owners.filter(owner=>!documents.has(uiDocument(owner)));
};
const editable=j=>j&&['queued','held','error'].includes(j.status);
const identity=p=>{
 if(typeof p?.token!=='string'||!/^[a-zA-Z0-9-]{8,128}$/.test(p.token)||typeof p.owner!=='string'||!p.owner||p.owner.length>300)throw Error('Reserva de edición no válida.');
};
const status=(s,c)=>({finished:true,paused:!!s.paused||!!c?.paused,editing:hasEdits(c)});
function release(s,c){
 const hold=c.editPause;if(!hold||hold.sessions.length)return;
 delete c.editPause;
 const review=s.jobs.find(j=>j.conversationId===c.id&&['held','error','uncertain','preparing','submitting'].includes(j.status));
 if(hold.resume&&!review){c.paused=false;c.reason='';c.nextCheckAt=0;}
 else if(c.reason===EDIT_REASON)c.reason=review?.reason||'Hay pendientes que requieren revisión.';
}
export function beginQueueEdit(s,p){
 identity(p);
 const j=s.jobs.find(j=>j.id===p.id),c=j&&s.conversations[j.conversationId];
 if(!editable(j)||!c)throw Error('Ese mensaje ya se está enviando o ya no está pendiente.');
 if(s.jobs.some(x=>x.conversationId===c.id&&['preparing','submitting'].includes(x.status)))throw Error('Hay un envío en preparación o confirmación. Edita cuando termine.');
 for(const candidate of Object.values(s.conversations)){
  const session=candidate.editPause?.sessions.find(x=>x.token===p.token);
  if(session&&(session.owner!==p.owner||session.id!==p.id))throw Error('La reserva pertenece a otra edición.');
  if(candidate.editReceipts?.some(x=>x.token===p.token))throw Error('La edición ya se ha cerrado.');
 }
 // Outstanding completion receipts live until acknowledged or their owner
 // closes. Refuse more work at a generous cap rather than evict retry evidence.
 const outstanding=Object.values(s.conversations).reduce((n,c)=>n+(c.editReceipts||[]).filter(r=>r.owner===p.owner).length,0);
 if(outstanding>=256&&!c.editPause?.sessions.some(x=>x.token===p.token))throw Error('Hay demasiadas ediciones sin confirmar en esta vista. Cierra y vuelve a abrir la vista de colas.');
 if(!c.editPause)c.editPause={resume:!c.paused,sessions:[]};
 if(!c.editPause.sessions.some(x=>x.token===p.token))c.editPause.sessions.push({token:p.token,owner:p.owner,id:p.id,revision:j.editRevision||0});
 if(!c.paused)c.reason=EDIT_REASON;
 c.paused=true;
 return {token:p.token,job:{id:j.id,conversationId:j.conversationId,text:j.text,files:j.files,status:j.status}};
}
export function endQueueEdit(s,p){
 identity(p);
 const completed=Object.values(s.conversations).find(c=>c.editReceipts?.some(x=>x.token===p.token));
 if(completed){
  const receipt=completed.editReceipts.find(x=>x.token===p.token);
  if(receipt.owner!==p.owner||receipt.id!==p.id)throw Error('La reserva pertenece a otra edición.');
  if(p.save&&!receipt.saved)throw Error('La edición ya se canceló. Copia tu texto y vuelve a abrirla.');
  const current=s.jobs.find(j=>j.id===p.id);
  if(p.save&&current&&(current.text!==p.text||current.editRevision!==receipt.revision))throw Error('El pendiente cambió después de guardar esta edición.');
  return {...status(s,completed),saved:receipt.saved};
 }
 const c=Object.values(s.conversations).find(c=>c.editPause?.sessions.some(x=>x.token===p.token));
 if(!c){if(p.save)throw Error('La reserva de edición ya no está activa. Copia tu texto y vuelve a abrir la edición.');return {finished:true,paused:true,editing:false};}
 const session=c.editPause.sessions.find(x=>x.token===p.token);
 if(session.owner!==p.owner||session.id!==p.id)throw Error('La reserva pertenece a otra edición.');
 let revision=null;
 if(p.save){
  const j=s.jobs.find(j=>j.id===p.id);
  if(!editable(j)||j.conversationId!==c.id)throw Error('Ese mensaje ya se está enviando o ya no está pendiente.');
  if((j.editRevision||0)!==session.revision||(typeof p.base==='string'&&j.text!==p.base))throw Error('El pendiente cambió en otra vista. Copia tu edición antes de cancelar y volver a abrirlo.');
  if(typeof p.text!=='string'||p.text.length>2000000||(!p.text.trim()&&!j.files.length))throw Error('Texto inválido.');
  if(j.text!==p.text){j.text=p.text;j.doc=null;}
  j.editRevision=(j.editRevision||0)+1;revision=j.editRevision;
 }
 c.editPause.sessions=c.editPause.sessions.filter(x=>x!==session);
 // Keep metadata-only completion proof until the caller acknowledges it.
 c.editReceipts=[{token:p.token,owner:p.owner,id:p.id,saved:!!p.save,revision},...(c.editReceipts||[])];
 release(s,c);
 return status(s,c);
}
export function clearQueueEdits(s,cid=null){
 for(const c of Object.values(s.conversations))if((!cid||c.id===cid)&&c.editPause){c.editPause.sessions=[];release(s,c);}
}
export function interruptQueueEdits(s,reason='La edición se interrumpió al cerrar el navegador. Revisa el pendiente antes de reanudar.'){
 for(const c of Object.values(s.conversations)){
  delete c.editReceipts;
  if(!c.editPause)continue;
  delete c.editPause;c.paused=true;
  if(!c.reason||c.reason===EDIT_REASON)c.reason=reason;
 }
}
export function acknowledgeQueueEdit(s,p){
 identity(p);
 for(const c of Object.values(s.conversations)){
  const r=c.editReceipts?.find(x=>x.token===p.token);if(!r)continue;
  if(r.owner!==p.owner||r.id!==p.id)throw Error('La confirmación pertenece a otra edición.');
  c.editReceipts=c.editReceipts.filter(x=>x!==r);return true;
 }
 return true;
}
/** Cancellation never commits the edited draft, even if pagehide did not run. */
export function abandonOwnerEdits(s,owners){
 const gone=new Set(owners);
 for(const c of Object.values(s.conversations)){
  for(const session of [...(c.editPause?.sessions||[])])if(gone.has(session.owner))endQueueEdit(s,{...session,save:false});
  if(c.editReceipts)c.editReceipts=c.editReceipts.filter(r=>!gone.has(r.owner));
 }
}
/** Source-tab or manager-tab navigation/closure cancels only that tab's edits. */
export function abandonTabEdits(s,tabId){
 const owners=Object.values(s.conversations).flatMap(c=>[...(c.editPause?.sessions||[]),...(c.editReceipts||[])]).map(x=>x.owner)
  .filter(owner=>owner.startsWith(`tab:${tabId}:`)||owner.startsWith(`ui-tab:${tabId}:`));
 abandonOwnerEdits(s,owners);
}
