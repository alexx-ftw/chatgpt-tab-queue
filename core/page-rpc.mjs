/** Validate scripting results at the browser boundary, before callers read any properties. */
export function createPageRPC({execute,func,timeoutMs=15000}) {
  return async function page(tabId,args) {
    let timer;
    const unavailable=message=>Object.assign(new Error(message),{code:'PAGE_UNAVAILABLE'});
    try {
      const result=await Promise.race([
        execute({target:{tabId,frameIds:[0]},world:'MAIN',injectImmediately:true,func,
          args:[{...args,rpcDeadline:Date.now()+Math.max(1,timeoutMs-250)}]}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(unavailable('La pestaña no respondió. Se conserva la cola sin reenviar.')),timeoutMs);})
      ]);
      const frame=Array.isArray(result)?result.find(x=>x?.frameId===0):null;
      if(frame?.result?.cqExpired)throw Object.assign(unavailable('La orden caducó antes de ejecutarse. Se conserva el mensaje.'),{notStarted:true,command:args.cmd});
      if(frame?.result===null||frame?.result===undefined)throw unavailable('El editor está cargando o no devolvió una respuesta válida.');
      if(frame.error)throw unavailable(String(frame.error));
      return frame.result;
    } finally { clearTimeout(timer); }
  };
}
