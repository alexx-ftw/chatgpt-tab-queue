import {openDB,getState} from './db.mjs';
import {targetFromURL,migrateState} from './model.mjs';
const LIMIT=256*1024*1024;
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Importación cancelada'));tx.onerror=()=>reject(tx.error);});
const encoded=bytes=>{const a=new Uint8Array(bytes);let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s);};
function safeKeys(value){
 if(!value||typeof value!=='object')return;
 for(const [k,v] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))throw Error('La copia contiene claves no admitidas.');safeKeys(v);}
}
/** Validate completely before opening any write transaction. Never auto-resume imported jobs. */
export function validateBackup(data){
 safeKeys(data);
 if(data?.format!=='chatgpt-queue-backup'||data.version!==1||!Array.isArray(data.state?.jobs)||!Array.isArray(data.files)||!Array.isArray(data.parts))throw Error('Copia de cola no válida.');
 const s=structuredClone(data.state);
 if(!s.conversations||typeof s.conversations!=='object'||!s.aliases||typeof s.aliases!=='object'||!Array.isArray(s.history)||!s.settings||data.files.length>10000||s.jobs.length>10000)throw Error('Estructura de copia no válida.');
 const ids=new Set(),needed=new Set();
 for(const [id,c] of Object.entries(s.conversations)){
  if(c.id!==id||targetFromURL(c.url,c.isNew?c.id:undefined).id!==id)throw Error('La copia contiene un destino de conversación inválido.');
 }
 for(const j of s.jobs){
  if(typeof j.id!=='string'||ids.has(j.id)||!s.conversations[j.conversationId]||typeof j.text!=='string'||j.text.length>2000000||!Array.isArray(j.files)||j.files.length>80||!['queued','held','preparing','submitting','uncertain','error'].includes(j.status))throw Error('Mensaje no válido en la copia.');
  ids.add(j.id);for(const f of j.files)needed.add(f.id);
 }
 const files=new Map(),parts=[],sums=new Map(),next=new Map();let total=0;
 for(const f of data.files){
  if(typeof f.id!=='string'||files.has(f.id)||!needed.has(f.id)||!Number.isSafeInteger(f.size)||f.size<0||!f.ready||typeof f.name!=='string')throw Error('Archivo no válido en la copia.');
  total+=f.size;if(total>LIMIT)throw Error('La copia supera los 256 MiB de transferencia.');files.set(f.id,structuredClone(f));sums.set(f.id,0);next.set(f.id,0);
 }
 for(const p of data.parts){
  if(!files.has(p.fileId)||p.index!==next.get(p.fileId)||typeof p.data!=='string'||p.data.length>360000)throw Error('Bloques de archivo incompletos o fuera de orden.');
  const bytes=Uint8Array.from(atob(p.data),c=>c.charCodeAt(0)).buffer;parts.push({fileId:p.fileId,index:p.index,bytes});sums.set(p.fileId,sums.get(p.fileId)+bytes.byteLength);next.set(p.fileId,p.index+1);
 }
 for(const j of s.jobs)for(const f of j.files){if(!files.has(f.id)||files.get(f.id).size!==f.size||sums.get(f.id)!==f.size||files.get(f.id).name!==f.name)throw Error('Falta un archivo completo de la cola.');}
 migrateState(s);for(const j of s.jobs){if(j.status==='submitting'){j.status='uncertain';j.reason='Posible envío anterior a la transferencia. Comprueba el historial.';}else if(j.status==='preparing'){j.status='error';j.reason='Preparación interrumpida. El borrador se conserva.';s.conversations[j.conversationId].paused=true;}}s.paused=true;s.reason='Cola importada. Revisa los pendientes y pulsa Reanudar.';s.helpers={};s.helper=null;s.revision=(Number(s.revision)||0)+1;
 for(const j of s.jobs)if(s.conversations[j.conversationId].isNew){j.status='held';j.reason='Este chat nuevo no tenía URL. Recupera el mensaje desde la vista de cola.';j.sourceTabId=null;}
 return {state:s,files:[...files.values()],parts};
}
export async function exportBackup(){
 const initial=await getState();
 if(!initial.paused||initial.jobs.some(j=>['preparing','submitting'].includes(j.status)))throw Error('Pausa la cola y espera a que termine cualquier envío antes de exportar.');
 const ids=new Set(initial.jobs.flatMap(j=>j.files.map(f=>f.id)));
 const total=initial.jobs.flatMap(j=>j.files).reduce((n,f)=>n+f.size,0);if(total>LIMIT)throw Error('La transferencia admite hasta 256 MiB. No se ha modificado la cola.');
 const db=await openDB(),tx=db.transaction(['meta','files','parts'],'readonly');
 const [state,allFiles,allParts]=await Promise.all([request(tx.objectStore('meta').get('state')),request(tx.objectStore('files').getAll()),request(tx.objectStore('parts').getAll())]);
 const out={format:'chatgpt-queue-backup',version:1,createdAt:new Date().toISOString(),state:state||initial,files:allFiles.filter(f=>ids.has(f.id)),parts:allParts.filter(p=>ids.has(p.fileId)).sort((a,b)=>a.fileId.localeCompare(b.fileId)||a.index-b.index).map(p=>({fileId:p.fileId,index:p.index,data:encoded(p.bytes)}))};
 validateBackup(out);
 if((await getState()).revision!==out.state.revision)throw Error('La cola cambió durante la exportación. Repite la operación.');
 return out;
}
export async function importBackup(data){
 const incoming=validateBackup(data),db=await openDB(),tx=db.transaction(['meta','files','parts'],'readwrite'),end=done(tx);
 try{
  const meta=tx.objectStore('meta'),current=await request(meta.get('state'));
  if(current?.jobs?.length||Object.keys(current?.draftBackups||{}).length||Object.values(current?.conversations||{}).some(c=>c.waiting))throw Error('Importa en una instalación sin cola ni borradores guardados. No se sobrescribirá nada.');
  for(const f of incoming.files)tx.objectStore('files').put(f);
  for(const p of incoming.parts)tx.objectStore('parts').put(p);
  meta.put(incoming.state,'state');await end;return incoming.state.jobs.length;
 }catch(e){try{tx.abort();}catch{}await end.catch(()=>{});throw e;}
}
