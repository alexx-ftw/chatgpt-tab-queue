/** Use the browser's signed-package updater only; never fetch/eval remote code. */
export function createNativeUpdates({runtime,getState,isBusy=()=>false,now=()=>Date.now()}) {
  let pending=null,applying=false;
  return {
    available(details){if(typeof details?.version==='string')pending=details.version;},
    get pending(){return pending;},
    async applyWhenSafe(){
      if(!pending||applying||isBusy())return false;
      const state=await getState();
      const critical=state.jobs.some(j=>['preparing','submitting'].includes(j.status)||
        (j.status==='held'&&now()-(j.createdAt??now())<15000));
      if(critical||isBusy())return false;
      applying=true;
      try{await runtime.reload();return true;}catch(e){applying=false;throw e;}
    }
  };
}
/** Reinject packaged scripts into existing documents, without navigating any tab. */
export async function reattachPages(api,onlyTab=null){
  const scripts=api.runtime.getManifest().content_scripts.flatMap(c=>c.js||[]);
  const tabs=await api.tabs.query({url:['https://chatgpt.com/*']});
  return Promise.allSettled(tabs.filter(t=>(onlyTab===null||t.id===onlyTab)&&!t.discarded&&!t.frozen)
    .map(t=>api.scripting.executeScript({target:{tabId:t.id,frameIds:[0]},files:scripts,injectImmediately:true})));
}
