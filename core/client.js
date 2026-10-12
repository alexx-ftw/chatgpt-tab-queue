/* Shared isolated-world/extension-page client. Never accepts window.postMessage commands. */
(() => {
  'use strict';
  const CHUNK=192*1024;
  async function rpc(type,data={}){
    const r=await chrome.runtime.sendMessage({channel:'cq2',type,...data});
    if(!r?.ok)throw Error(r?.error||'Reconectando con la extensión. El borrador se conserva.');return r.value;
  }
  function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
  async function storeFile(file,progress=()=>{}){
    const meta=await rpc('FILE_BEGIN',{meta:{name:file.name,type:file.type,size:file.size,lastModified:file.lastModified}});
    try{let index=0;
      for(let at=0;at<file.size;at+=CHUNK){const bytes=new Uint8Array(await file.slice(at,at+CHUNK).arrayBuffer());await rpc('FILE_PART',{id:meta.id,index:index++,data:base64(bytes)});progress(Math.min(file.size,at+CHUNK),file.size);}
      return await rpc('FILE_FINISH',{id:meta.id});
    }catch(e){await rpc('FILE_DELETE',{id:meta.id}).catch(()=>{});throw e;}
  }
  function prettySize(bytes){return bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`;}
  globalThis.CQClient={rpc,storeFile,prettySize,base64,CHUNK};
})();
