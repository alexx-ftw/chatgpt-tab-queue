import {newState} from './model.mjs';
const DB_NAME='eros-chatgpt-queue-2';
let opening;
export function openDB(){
  if(!opening)opening=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,1);
    r.onupgradeneeded=()=>{
      r.result.createObjectStore('meta');
      r.result.createObjectStore('files',{keyPath:'id'});
      const parts=r.result.createObjectStore('parts',{keyPath:['fileId','index']});parts.createIndex('fileId','fileId');
    };
    r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};
    r.onerror=()=>{opening=null;reject(r.error);};
    r.onblocked=()=>reject(Error('El almacén local está bloqueado por otra versión.'));
  });
  return opening;
}
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Operación cancelada'));tx.onerror=()=>reject(tx.error);});}
async function read(store,key){const db=await openDB();return request(db.transaction(store).objectStore(store).get(key));}
async function put(store,value,key){const db=await openDB(),tx=db.transaction(store,'readwrite'),end=done(tx);tx.objectStore(store).put(value,key);await end;return value;}
export const getState=async()=>await read('meta','state')||newState();
let serial=Promise.resolve();
/** Never await browser/DOM operations inside this callback. */
export function changeState(fn){
  const task=serial.then(async()=>{const s=await getState();const result=fn(s);if(result?.then)throw Error('La transición de estado debe ser síncrona.');s.revision++;await put('meta',s,'state');return {state:s,result};});
  serial=task.catch(()=>{});return task;
}
export async function beginFile(meta,owner){
  if(!meta||typeof meta.name!=='string'||!meta.name||meta.name.length>1000||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>512*1024*1024)throw Error('Archivo inválido o mayor de 512 MiB.');
  const f={id:crypto.randomUUID(),name:meta.name,type:String(meta.type||''),size:meta.size,lastModified:Number(meta.lastModified)||0,owner,createdAt:Date.now(),bytes:0,next:0,ready:false};
  await put('files',f);return f;
}
export const getFile=id=>read('files',id);
export async function writePart(id,index,base64,owner){
  if(typeof base64!=='string'||base64.length>360000)throw Error('Bloque de archivo demasiado grande.');
  let raw;try{raw=atob(base64);}catch{throw Error('Bloque de archivo inválido.');}
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)).buffer;
  const db=await openDB(),tx=db.transaction(['files','parts'],'readwrite'),end=done(tx);
  try{
    const store=tx.objectStore('files'),f=await request(store.get(id));
    if(!f||f.owner!==owner||f.ready||index!==f.next||f.bytes+bytes.byteLength>f.size)throw Error('Bloques de archivo fuera de orden o sin autorización.');
    tx.objectStore('parts').put({fileId:id,index,bytes});f.next++;f.bytes+=bytes.byteLength;store.put(f);await end;
  }catch(e){try{tx.abort();}catch{}await end.catch(()=>{});throw e;}
}
export async function finishFile(id,owner){
  const db=await openDB(),tx=db.transaction('files','readwrite'),end=done(tx);
  try{const store=tx.objectStore('files'),f=await request(store.get(id));
    if(!f||f.owner!==owner||f.bytes!==f.size)throw Error('No se ha guardado el archivo completo.');
    f.ready=true;store.put(f);await end;return f;
  }catch(e){try{tx.abort();}catch{}await end.catch(()=>{});throw e;}
}
export async function readPart(id,index){return (await read('parts',[id,index]))?.bytes;}
export async function deleteFile(id){
  const db=await openDB(),tx=db.transaction(['files','parts'],'readwrite'),end=done(tx);
  tx.objectStore('files').delete(id);
  const r=tx.objectStore('parts').index('fileId').openKeyCursor(IDBKeyRange.only(id));
  r.onsuccess=()=>{const c=r.result;if(c){tx.objectStore('parts').delete(c.primaryKey);c.continue();}};
  await end;
}
export async function cleanOrphans(){
  const s=await getState(),referenced=new Set(s.jobs.flatMap(j=>j.files.map(f=>f.id)));
  const db=await openDB(),files=await request(db.transaction('files').objectStore('files').getAll());
  for(const f of files)if(!referenced.has(f.id)&&f.createdAt<Date.now()-7*86400000)await deleteFile(f.id);
}
