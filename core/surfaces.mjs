/** Addresses are either real top-level tab IDs, or frame:<hostTabId>:<opaqueToken>.
 * The queue cannot create, activate, navigate or close any browser tab through this IO. */
export function parseSurface(id) {
  if (Number.isInteger(id) && id >= 0) return {tabId:id,frameToken:null};
  const match = typeof id === 'string' && /^frame:(\d+):([a-zA-Z0-9-]{5,100})$/.exec(id);
  if (!match) throw Error('Dirección de contexto interno inválida.');
  return {tabId:Number(match[1]),frameToken:match[2]};
}
export function surfaceForSender(tabId,frameToken) {
  const id=frameToken?`frame:${tabId}:${frameToken}`:tabId;
  parseSurface(id);return id;
}
export function createSurfaceIO({api,page,frameFunc,timeoutMs=12000}) {
  const unavailable=message=>Object.assign(Error(message),{code:'PAGE_UNAVAILABLE'});
  const listTabs=()=>api.tabs.query({url:['https://chatgpt.com/*']});
  async function frameCommand(tabId,args) {
    let timer;
    try {
      const result=await Promise.race([
        api.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',injectImmediately:true,func:frameFunc,args:[{...args,rpcDeadline:Date.now()+Math.max(1,timeoutMs-250)}]}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(unavailable('El contexto interno no respondió. Tu chat no se ha cambiado.')),timeoutMs);})
      ]);
      const value=result?.find(x=>x?.frameId===0)?.result;
      if(!value||typeof value!=='object')throw unavailable('La vista interna aún no está disponible.');
      if(value.status==='unavailable')throw unavailable(value.reason);
      return value;
    }finally{clearTimeout(timer);}
  }
  function descriptor(tab,value) {
    return {id:`frame:${tab.id}:${value.token}`,hostTabId:tab.id,cqFrame:true,url:value.url,
      status:value.status,createdAt:value.createdAt||null,discarded:!!tab.discarded,frozen:!!tab.frozen,active:false};
  }
  return {
    listTabs,
    async getTab(id) {
      const address=parseSurface(id),tab=await api.tabs.get(address.tabId);
      if(!address.frameToken)return tab;
      if(!tab?.url?.startsWith('https://chatgpt.com/'))throw unavailable('La página anfitriona ya no está en ChatGPT.');
      const value=await frameCommand(tab.id,{cmd:'status',token:address.frameToken});
      if(value.status==='missing')throw unavailable('El contexto interno se cerró al recargar la página.');
      return descriptor(tab,value);
    },
    async ensureBackground(conversation,job) {
      if(conversation.isNew)return null;
      const tabs=(await listTabs()).filter(t=>Number.isInteger(t.id)&&!t.discarded&&!t.frozen&&t.status!=='loading');
      tabs.sort((a,b)=>Number(b.id===job?.sourceTabId)-Number(a.id===job?.sourceTabId));
      const tab=tabs[0];if(!tab)return null;
      const value=await frameCommand(tab.id,{cmd:'ensure',url:conversation.url,conversationId:conversation.id});
      if(!value.token)return null;
      return descriptor(tab,value);
    },
    async page(id,args) {
      const address=parseSurface(id);
      return page(address.tabId,address.frameToken?{...args,frameToken:address.frameToken}:args);
    },
    async sendTab(id,message) {
      const address=parseSurface(id);
      return api.tabs.sendMessage(address.tabId,address.frameToken?{...message,frameToken:address.frameToken}:message);
    },
    async releaseBackground(id) {
      const address=parseSurface(id);
      if(address.frameToken)await frameCommand(address.tabId,{cmd:'release',token:address.frameToken});
    }
  };
}
