import {canonical,addJob,markPreparing,markSubmitting,acknowledge,receiptMatches,reconcileWait,clearQueue,targetFromURL,migrateState} from './model.mjs';

/** Durable per-conversation lanes; browser waits in A never block B. io is the only browser dependency (also used by tests). */
export function createCoordinator({store,io}) {
  let maintenance=0;
  const running=new Set(),maintained=new Map();
  const enterMaintenance=cid=>{if(!cid)maintenance++;else maintained.set(cid,(maintained.get(cid)||0)+1);};
  const leaveMaintenance=cid=>{if(!cid)maintenance--;else{const n=(maintained.get(cid)||1)-1;if(n)maintained.set(cid,n);else maintained.delete(cid);}};
  const idle=new Map();
  const now=()=>io.now?.()??Date.now();
  const emit=async()=>{try{await io.changed?.();}catch{}};
  const change=async fn=>{const v=await store.changeState(fn);await emit();return v;};
  const find=(s,id)=>s.jobs.find(j=>j.id===id);
  async function live(id,status=null){const s=await store.getState(),j=find(s,id);return j&&(!status||j.status===status)&&!s.paused&&!s.conversations[j.conversationId]?.paused?j:null;}
  async function fail(id,reason,uncertain=false){
    const {result:j}=await change(s=>{const x=find(s,id);if(!x)return null;x.status=uncertain?'uncertain':'error';x.reason=String(reason).slice(0,600);const c=s.conversations[x.conversationId];c.paused=true;c.reason=x.reason;return x;});
    if(j){
      if(j.attempt)try{await io.sendTab(j.attempt.tabId,{channel:'cq2',type:'CANCEL_UPLOAD',token:j.attempt.token});}catch{}
      await endGuards(j);
    }
  }
  async function mutateAttempt(id,fn){return change(s=>{const j=find(s,id);if(j?.attempt)fn(j,s);return j;});}
  async function inspect(tabId,c){
    const raw=await io.page(tabId,{cmd:'inspect',conversationId:c?.id,expectedFiles:[]});
    // Loading/navigation may legitimately produce no serializable result.
    if(!raw || typeof raw!=='object' || typeof raw.route!=='string') {
      idle.delete(tabId);
      return {ready:false,state:'unknown',route:c?.url||'',pathId:null,text:'',attachments:{count:0,items:[],unsupported:false,loading:false},idleStable:false};
    }
    const key=`${raw.route}|${raw.lastUser?.id||''}`;
    const prev=idle.get(tabId);
    if(raw.state!=='idle'||!raw.ready||raw.blocked) idle.delete(tabId);
    else if(!prev||prev.key!==key)idle.set(tabId,{key,since:now()});
    const state=await store.getState(),stable=idle.get(tabId);
    return {...raw,attachments:raw.attachments||{count:0,items:[],unsupported:false,loading:false},
      target:raw.pathId?targetFromURL(raw.route):null,
      idleStable:!!stable&&now()-stable.since>=state.settings.idleMs};
  }
  async function endGuards(job){
    for(const id of job.attempt?.guardTabs||[])try{await io.page(id,{cmd:'guardEnd',token:job.attempt.token});}catch{}
    if(job.attempt?.localBackup&&!job.attempt.restored){
      try{
        const r=await io.page(job.attempt.tabId,{cmd:'localEnd',token:job.attempt.token,conversationId:job.conversationId,
          expectedFiles:job.files,afterSend:['submitting','uncertain'].includes(job.status)});
        if(r?.ok)await forgetBackup(job);
      }catch{}
    }
  }
  async function deleteUnreferenced(jobs){
    const ids=new Set(jobs.flatMap(j=>j.files.map(f=>f.id)));
    for(const id of ids){const s=await store.getState();if(!s.jobs.some(j=>j.files.some(f=>f.id===id)))await store.deleteFile(id);}
  }
  async function tidy(job){
    if(!job.attempt)return;
    try{await io.sendTab(job.attempt.tabId,{channel:'cq2',type:'CANCEL_UPLOAD',token:job.attempt.token});}catch{}
    await endGuards(job);
  }
  async function clear(conversationId=null){
    const state=await store.getState(),scope=state.aliases[conversationId]||conversationId;
    enterMaintenance(scope);try{
    const {result:removed}=await change(s=>{const items=clearQueue(s,conversationId);for(const h of Object.values(s.helpers||{}))if(items.some(j=>j.id===h.jobId))h.jobId=null;return items;});
    for(const j of removed)await tidy(j);
    await deleteUnreferenced(removed);return {removed:removed.length};
    }finally{leaveMaintenance(scope);}
  }
  async function remove(id){
    const state=await store.getState(),scope=find(state,id)?.conversationId;if(!scope)return false;
    enterMaintenance(scope);try{
    const {result:j}=await change(s=>{const index=s.jobs.findIndex(j=>j.id===id);if(index<0)return null;const j=s.jobs[index];s.jobs.splice(index,1);s.cancelEpoch=(s.cancelEpoch||0)+1;
      if(['submitting','uncertain'].includes(j.status)){s.conversations[j.conversationId].paused=true;s.conversations[j.conversationId].reason='Se retiró un posible envío. Revisa antes de reanudar.';}
      for(const h of Object.values(s.helpers||{}))if(h.jobId===j.id)h.jobId=null;return j;});
    if(j){await tidy(j);await deleteUnreferenced([j]);}return !!j;
    }finally{leaveMaintenance(scope);}
  }
  async function pause(conversationId=null){
    const {result:preparing}=await change(s=>{const id=s.aliases[conversationId]||conversationId;if(id){const c=s.conversations[id];if(c){c.paused=true;c.reason='Pausa manual';}}else{s.paused=true;s.reason='Pausa manual';}
      return s.jobs.filter(j=>j.status==='preparing'&&(!id||j.conversationId===id));});
    for(const j of preparing){await tidy(j);await mutateAttempt(j.id,x=>{x.status='queued';x.attempt=null;});}
  }
  async function resume(conversationId=null){
    return change(s=>{const id=s.aliases[conversationId]||conversationId;
      if(!id){s.paused=false;s.reason='';}
      for(const c of Object.values(s.conversations))if(!id||c.id===id){
        if(s.jobs.some(j=>j.conversationId===c.id&&['submitting','uncertain','error','held'].includes(j.status)))continue;
        c.paused=false;c.reason='';c.nextCheckAt=0;
      }
    });
  }
  async function retry(id){
    const s=await store.getState(),j=find(s,id);
    if(!j||!['error','held'].includes(j.status))throw Error('Un envío incierto no se reintenta automáticamente. Comprueba el chat y retíralo.');
    await tidy({...j,status:'preparing'});
    return change(s=>{const x=find(s,id);if(!x||!['error','held'].includes(x.status))return;x.status='queued';x.reason='';x.attempt=null;
      const c=s.conversations[x.conversationId];c.paused=false;c.reason='';c.nextCheckAt=0;});
  }
  async function uploadResult(id,token,error=null){
    const s=await store.getState(),j=find(s,id);
    if(!j||j.status!=='preparing'||j.attempt?.token!==token)return;
    if(error){await fail(id,String(error));return;}
    return mutateAttempt(id,x=>{if(x.status==='preparing'&&x.attempt?.token===token)x.attempt.uploadInjected=true;});
  }
  function tabMatches(tab,c,job) {
    if((!Number.isInteger(tab?.id)&&!tab?.cqFrame)||!tab.url)return false;
    try {
      if(c.isNew)return tab.id===job?.sourceTabId&&new URL(tab.url).origin+new URL(tab.url).pathname===c.url;
      return targetFromURL(tab.url).id===c.id;
    }catch{return false;}
  }
  async function ensureHelper(c,job){
    // Prefer an already loaded conversation; absent chats use a same-origin internal frame.
    // The extension never creates or navigates a browser tab.
    const tabs=(await io.listTabs()).filter(t=>tabMatches(t,c,job));
    tabs.sort((a,b)=>Number(b.id===job?.sourceTabId)-Number(a.id===job?.sourceTabId));
    let tab=tabs.find(t=>!t.discarded&&!t.frozen&&t.status!=='loading')||tabs[0];
    if(!tab&&!c.isNew&&io.ensureBackground)tab=await io.ensureBackground(c,job);
    if(!tab){await note(c.id,'Mantén abierta una página de ChatGPT para continuar. No se abrirán pestañas ni se cambiará tu conversación.');return null;}
    const h={tabId:tab.id,conversationId:c.id,jobId:null,url:c.url,owned:false,internal:!!tab.cqFrame};
    await change(s=>{s.helpers[c.id]=h;});
    return tab;
  }
  function sameConfiguration(j,snap,settings){
    if(settings.preserveModel&&j.model){
      for(const key of ['engine','effort'])if(j.model[key]&&j.model[key]!==snap.model?.[key])return false;
    }
    const labels=x=>(x||[]).map(o=>canonical(o.label)).sort();
    return JSON.stringify(labels(j.options))===JSON.stringify(labels(snap.options));
  }
  async function saveBackup(j,backup){
    return change(s=>{const x=find(s,j.id);if(!x?.attempt||x.status!=='preparing'||x.attempt.token!==j.attempt.token)return false;
      backup={text:backup.text,doc:backup.doc||null,selection:backup.selection||null};
      x.attempt.localBackup=backup;
      // Persist user drafts separately: clearing queue entries must never erase them.
      if(canonical(backup.text)||backup.doc)(s.draftBackups||={})[x.attempt.token]={token:x.attempt.token,conversationId:x.conversationId,tabId:x.attempt.tabId,backup,createdAt:now()};
      return true;
    });
  }
  async function forgetBackup(j){
    await change(s=>{if(s.draftBackups)delete s.draftBackups[j.attempt.token];const x=find(s,j.id);if(x?.attempt)x.attempt.restored=true;});
  }
  async function guardVisibleEditors(j){
    if(!String(j.attempt?.tabId).startsWith('frame:'))return true;
    const tabs=(await io.listTabs()).filter(t=>tabMatches(t,{id:j.conversationId,isNew:false},j));
    for(const tab of tabs){
      const snap=await io.page(tab.id,{cmd:'inspect',conversationId:j.conversationId});
      if(!snap?.ready||snap.pathId!==j.conversationId)continue;
      if(snap.attachments?.count||snap.attachments?.unsupported){await note(j.conversationId,'Se conservan los adjuntos nativos del borrador visible. La cola espera sin tocarlos.');return false;}
      if(!(j.attempt.guardTabs||[]).includes(tab.id)){
        const started=await io.page(tab.id,{cmd:'guardStart',conversationId:j.conversationId,token:j.attempt.token,text:j.text});
        if(!started?.ok)return false;
        await mutateAttempt(j.id,x=>{(x.attempt.guardTabs||=[]).push(tab.id);});
        (j.attempt.guardTabs||=[]).push(tab.id);
      }
      const checked=await io.page(tab.id,{cmd:'guardCheck',conversationId:j.conversationId,token:j.attempt.token});
      if(!checked?.ok){await fail(j.id,checked?.reason||'El borrador visible cambió. El pendiente se conserva.');return false;}
    }
    return true;
  }
  async function sendInPlace(j,snap){
    if(!await guardVisibleEditors(j))return;
    const s=await store.getState();
    if(snap.attachments.count||snap.attachments.unsupported){await note(j.conversationId,'Tienes adjuntos en el borrador. Se conservan intactos; la cola espera.');return;}
    if(!sameConfiguration(j,snap,s.settings)){await note(j.conversationId,'El modelo o las herramientas han cambiado. No se modificarán tus controles automáticamente.');return;}
    await note(j.conversationId,'');
    const backup=await io.page(j.attempt.tabId,{cmd:'capture',conversationId:j.conversationId});
    if(!backup?.ready)return;
    const saved=await saveBackup(j,backup);if(!saved.result)return;
    const {result:permit}=await change(state=>{const x=find(state,j.id);if(!x||x.status!=='preparing'||state.paused||state.conversations[x.conversationId].paused)return null;return markSubmitting(state,j.id,now());});
    if(!permit)return;
    try{
      if(!find(await store.getState(),j.id))return;
      const r=await io.page(j.attempt.tabId,{cmd:'localSend',conversationId:j.conversationId,localId:s.conversations[j.conversationId]?.localId,token:j.attempt.token,text:j.text,doc:j.doc,
        expectText:backup.text,expectDoc:backup.doc,beforeUser:j.attempt.beforeUser,expectedFiles:[],model:s.settings.preserveModel?j.model:null,options:j.options||[]});
      if(!r||typeof r.clicked!=='boolean')throw Error('El navegador no confirmó el resultado del envío.');
      if(r.restored)await forgetBackup(j);
      if(!r.clicked){await mutateAttempt(j.id,x=>{x.status=r.restored?'queued':'error';x.reason=r.reason||'';if(r.restored)x.attempt=null;else{x.reason='Revisa el borrador conservado en Todas las colas.';}});}
      else if(!r.restored){await note(j.conversationId,'El mensaje se ha enviado; hay una copia del borrador para recuperar en Todas las colas.');}
    }catch(e){await fail(j.id,'Envío incierto; no se repetirá automáticamente. El borrador queda guardado. '+e.message,true);}
  }
  async function prep(job,snap){
    const j=await live(job.id,'preparing');if(!j)return;
    const a=j.attempt,s=await store.getState(),c=s.conversations[j.conversationId];
    if(now()-a.startedAt>s.settings.uploadMs+60000){await fail(j.id,'Tiempo de preparación agotado. El mensaje y sus archivos siguen guardados.');return;}
    if(!snap.ready)return;
    if(!await guardVisibleEditors(j))return;
    if((!c.isNew&&snap.pathId!==c.id)||(c.isNew&&(snap.pathId||(c.localId&&snap.localId!==c.localId)))){await fail(j.id,'La pestaña cambió de conversación. No se ha enviado nada.');return;}
    if((snap.lastUser?.id||null)!==a.beforeUser){await fail(j.id,'Ha aparecido otro mensaje durante la preparación. Revisa el chat antes de reintentar.');return;}
    const stage=a.stage||'model';
    if(stage==='model'){
      if(!j.files.length){if(snap.idleStable&&!snap.blocked&&snap.state==='idle')await sendInPlace(j,snap);return;}
      if(!sameConfiguration(j,snap,s.settings)){await note(c.id,'El modelo o las herramientas han cambiado. Restaura la configuración del pendiente para continuar.');return;}
      if(snap.attachments.count||snap.attachments.unsupported){await note(c.id,'Se conservan los adjuntos de tu borrador. Envíalos o retíralos para continuar la cola.');return;}
      if(snap.blocked||!snap.idleStable||snap.state!=='idle')return;
      await note(c.id,'');
      const result=await io.page(a.tabId,{cmd:'localBegin',conversationId:c.id,localId:c.localId,token:a.token,text:j.text,expectedFiles:j.files,beforeUser:a.beforeUser});
      if(!result?.ok)return;
      const saved=await saveBackup(j,result.backup);
      if(!saved.result){try{await io.page(a.tabId,{cmd:'localEnd',token:a.token,conversationId:c.id,expectedFiles:[]});}catch{}return;}
      if(!await live(j.id,'preparing')){await endGuards({...j,attempt:{...a,localBackup:result.backup}});return;}
      await mutateAttempt(j.id,x=>{x.attempt.stage='write';x.attempt.guardTabs||=[];});return;
    }
    if(!sameConfiguration(j,snap,s.settings)){await fail(j.id,'La configuración cambió durante la preparación. Se ha cancelado el envío.');return;}
    const lease=await io.page(a.tabId,{cmd:'localCheck',token:a.token,conversationId:c.id});
    if(!lease?.ok){await fail(j.id,lease?.reason||'La reserva del editor se perdió. No se ha enviado nada.');return;}
    if(snap.blocked){await fail(j.id,snap.blocked);return;}
    if(snap.state==='busy'){await fail(j.id,'ChatGPT volvió a trabajar durante la preparación. El mensaje permanece pendiente.');return;}
    if(stage==='write'){
      if(snap.attachments.count||snap.attachments.unsupported){await fail(j.id,'El cuadro contiene adjuntos que no pertenecen a este envío. No se han borrado.');return;}
      if(!await live(j.id,'preparing'))return;
      await io.page(a.tabId,{cmd:'write',conversationId:c.id,expectText:snap.text,snapshot:{text:j.text,doc:j.doc}});
      await mutateAttempt(j.id,x=>{x.attempt.stage=x.files.length?'upload':'ready';});return;
    }
    if(stage==='upload'){
      await mutateAttempt(j.id,x=>{x.attempt.stage='uploading';x.attempt.uploadStartedAt=now();});
      if(!await live(j.id,'preparing'))return;
      const r=await io.sendTab(a.tabId,{channel:'cq2',type:'UPLOAD',jobId:j.id,token:a.token,conversationId:c.id,files:j.files});
      if(!r?.ok)await fail(j.id,r?.error||'No se pudo preparar la subida de archivos.');return;
    }
    if(stage==='uploading'){
      if(!a.uploadInjected)return;
      const v=await io.page(a.tabId,{cmd:'verifyFiles',expectedFiles:j.files});
      if(!v.match||v.loading)return;
      await mutateAttempt(j.id,x=>{x.attempt.stage='ready';});return;
    }
    if(stage==='ready'){
      if(!snap.idleStable)return;
      if(canonical(snap.text)!==canonical(j.text)){await fail(j.id,'El texto de la pestaña cambió antes de enviar. No se ha enviado nada.');return;}
      const v=await io.page(a.tabId,{cmd:'verifyFiles',expectedFiles:j.files});
      if(v.loading)return;
      if(!v.match){await fail(j.id,'Los adjuntos no coinciden con el mensaje encolado. No se ha enviado nada.');return;}
      for(const id of a.guardTabs||[]){try{const g=await io.page(id,{cmd:'guardCheck',token:a.token,conversationId:c.id});if(!g?.ok)throw Error(g?.reason||'El borrador cambió de forma inesperada');}
        catch(e){await fail(j.id,'Protección de borrador: '+e.message);return;}}
      if(!await live(j.id,'preparing'))return;
      // Persist BEFORE the only potentially irreversible operation. A restart never repeats it.
      const {result:permit}=await change(state=>{const x=find(state,j.id);if(!x||x.status!=='preparing'||state.paused||state.conversations[x.conversationId].paused)return null;return markSubmitting(state,j.id,now());});
      if(!permit)return;
      try{
        // Clearing the queue can cancel before dispatch, but cannot retract a click already dispatched.
        if(!find(await store.getState(),j.id))return;
        const r=await io.page(a.tabId,{cmd:'send',conversationId:c.id,token:a.token,text:j.text,expectedFiles:j.files,beforeUser:a.beforeUser,model:s.settings.preserveModel?j.model:null,options:j.options||[]});
        if(!r||typeof r.clicked!=='boolean')throw Error('El navegador no confirmó el resultado del clic.');
        if(!r.clicked)await mutateAttempt(j.id,x=>{if(x.status==='submitting'){x.status='preparing';x.attempt.stage='ready';delete x.attempt.clickedAt;}});
      }catch(e){await fail(j.id,'No se sabe si ChatGPT recibió el envío. No se reintentará solo. '+e.message,true);}
    }
  }
  async function note(cid,reason){
    const state=await store.getState();
    if(state.conversations[cid]?.reason===reason)return;
    await change(s=>{if(s.conversations[cid])s.conversations[cid].reason=reason;});
  }
  async function lane(cid){
    let s=await store.getState(),c=s.conversations[cid];
    if(!c)return;
    let jobs=s.jobs.filter(j=>j.conversationId===cid),h=s.helpers[cid];
    let j=jobs.find(x=>x.id===h?.jobId)||jobs.find(x=>['preparing','submitting','uncertain'].includes(x.status));
    let tab=null;
    // A cached frame must not win over a conversation the user has reopened.
    // Do this BEFORE awaiting its status: a broken/frozen frame cannot delay recovery.
    // Never migrate a preparation that already touched the old composer. A possible
    // click may be observed elsewhere, but its original attempt is kept for receipts.
    if(h && (h.internal || String(h.tabId).startsWith('frame:')) &&
       (!j || j.status!=='preparing' || ((j.attempt?.stage||'model')==='model'&&!j.attempt?.localBackup))){
      const candidates=(await io.listTabs()).filter(t=>tabMatches(t,c,j||jobs[0])&&!t.discarded&&!t.frozen&&t.status!=='loading');
      candidates.sort((a,b)=>Number(b.id===(j||jobs[0])?.sourceTabId)-Number(a.id===(j||jobs[0])?.sourceTabId));
      for(const candidate of candidates){
        let fresh;try{fresh=await inspect(candidate.id,c);}catch{continue;}
        if(!fresh.ready||fresh.pathId!==cid)continue;
        const previous=h;
        const observing=j&&['submitting','uncertain'].includes(j.status);
        await change(state=>{
          const x=j&&find(state,j.id);
          if(x?.status==='preparing'&&!x.attempt?.localBackup){x.status='queued';x.attempt=null;x.reason='';}
          state.helpers[cid]={tabId:candidate.id,conversationId:cid,jobId:observing?j.id:null,url:c.url,owned:false,internal:false};
          if(!state.conversations[cid].paused)state.conversations[cid].reason='';
        });
        idle.delete(previous.tabId);
        // Do not destroy a frame with a dispatched/uncertain send. Reconcile first.
        if(!observing)try{await io.releaseBackground?.(previous.tabId);}catch{}
        s=await store.getState();c=s.conversations[cid];h=s.helpers[cid];jobs=s.jobs.filter(x=>x.conversationId===cid);
        j=jobs.find(x=>x.id===h.jobId)||jobs.find(x=>['preparing','submitting','uncertain'].includes(x.status));
        tab=candidate;break;
      }
    }
    if(h){
      if(!tab)try{tab=await io.getTab(h.tabId);}catch{}
      if(tab&&!tabMatches(tab,c,j||jobs[0])&&!(c.isNew&&j&&['submitting','uncertain'].includes(j.status)&&tab.id===j.attempt?.tabId))tab=null;
      if(!tab){
        if(j?.status==='preparing'){
          if((j.attempt?.stage||'model')==='model'&&!j.attempt?.localBackup){
            // Nothing has touched the editor: move the job to an internal surface safely.
            await change(state=>{const x=find(state,j.id);if(x?.status==='preparing'){x.status='queued';x.attempt=null;x.reason='';}});j=null;
          }else{
            await fail(j.id,'El editor cambió durante una subida. El mensaje y el borrador se conservan para revisión.');
          }
        }
        // After a click, keep the original attempt and only reconcile a receipt elsewhere.
        // Never turn a navigation into a second send or silently discard its backup.
        await change(state=>{delete state.helpers[cid];});idle.delete(h.tabId);h=null;
        s=await store.getState();c=s.conversations[cid];jobs=s.jobs.filter(x=>x.conversationId===cid);
        j=jobs.find(x=>['preparing','submitting','uncertain'].includes(x.status));
        if(j?.status==='preparing')return;
      }
    }
    if(!tab&&j?.attempt?.tabId&&['submitting','uncertain'].includes(j.status)){
      try{const candidate=await io.getTab(j.attempt.tabId);if(tabMatches(candidate,c,j)||c.isNew){tab=candidate;h={tabId:tab.id,conversationId:cid,jobId:j.id,owned:false};await change(s=>{s.helpers[cid]=h;});}}catch{}
    }
    // No work means no unnecessary ChatGPT tab. A waiting response is observed without Stop.
    if(!tab){
      const reconciling=!!j&&['submitting','uncertain'].includes(j.status);
      if(!reconciling&&(s.paused||c.paused||!jobs.some(x=>x.status==='queued')))return;
      tab=await ensureHelper(c,reconciling?j:jobs[0]);
      s=await store.getState();h=s.helpers[cid];
      if(h&&reconciling){await change(state=>{if(state.helpers[cid])state.helpers[cid].jobId=j.id;});h.jobId=j.id;}
    }
    if(!tab||!h)return;
    if(tab.discarded||tab.frozen){await note(cid,'El navegador ha suspendido esta pestaña. Las demás colas continúan.');return;}
    if(tab.status==='loading')return;
    const snap=await inspect(tab.id,c);
    if(c.isNew&&c.localId&&!j?.attempt&&snap.localId!==c.localId){await note(cid,'Has cambiado de chat nuevo. La cola se conserva sin enviar a otra conversación.');return;}
    if(!snap.ready){
      await note(cid,tab.cqFrame&&tab.createdAt&&now()-tab.createdAt>45000
        ?'ChatGPT no ha expuesto un editor en la vista interna. Puede haber bloqueado la carga o requerir iniciar sesión. No se cambiará tu chat.'
        :'Esperando a que cargue el editor de esta conversación');
      return;
    }
    if(String(c.reason||'').startsWith('Esperando al navegador:'))await note(cid,'');
    // Even a completed load may have been navigated manually. Never send into another chat.
    if(!c.isNew&&snap.pathId!==cid){await note(cid,'Esta pestaña está en otra conversación. La cola continúa al volver.');return;}
    if(j&&['submitting','uncertain'].includes(j.status)){
      const withFiles=await io.page(tab.id,{cmd:'inspect',expectedFiles:j.files});
      if(!withFiles||typeof withFiles!=='object')return;
      if(receiptMatches(j,withFiles.lastUser)){
        const {result:sent}=await change(s=>{
          if(!find(s,j.id))return null;
          const removed=acknowledge(s,j.id,withFiles.lastUser,{...withFiles,target:withFiles.pathId?targetFromURL(withFiles.route):null},now());
          const helper=Object.values(s.helpers).find(x=>x.tabId===tab.id);if(helper)helper.jobId=null;return removed;
        });
        if(sent){
          await endGuards(sent);await deleteUnreferenced([sent]);
          const previous=sent.attempt?.tabId;
          if(previous!==tab.id&&String(previous).startsWith('frame:'))try{await io.releaseBackground?.(previous);}catch{}
        }
      }else if(j.status==='submitting'&&now()-j.attempt.clickedAt>s.settings.ackMs){await fail(j.id,'ChatGPT no ha confirmado el envío. Revisa esta pestaña antes de continuar.',true);}
      return;
    }
    if(j?.status==='preparing'){
      if(s.paused||c.paused)return;
      await prep(j,snap);return;
    }
    if(c.waiting){
      const w=c.waiting;
      if(snap.state==='busy'){if(!w.sawBusy)await change(s=>{if(s.conversations[cid]?.waiting)s.conversations[cid].waiting.sawBusy=true;});return;}
      if(snap.lastUser?.id&&snap.lastUser.id!==w.receiptId){
        // A manual native message must not deadlock an otherwise finished conversation.
        if(snap.state==='idle'&&snap.idleStable&&!snap.blocked&&snap.finalId){await change(s=>{if(s.conversations[cid])s.conversations[cid].waiting=null;});}
        else return;
      }else if(snap.state==='idle'&&snap.idleStable&&!snap.blocked&&(w.sawBusy||(snap.finalId&&snap.finalId!==w.beforeFinal))){
        const {result:finished}=await change(s=>reconcileWait(s,cid,snap,now()));if(!finished)return;
      }else return;
    }
    s=await store.getState();c=s.conversations[cid];jobs=s.jobs.filter(x=>x.conversationId===cid);
    if(!jobs.length){
      if(snap.state==='idle'&&snap.idleStable){if(tab.cqFrame)await io.releaseBackground?.(tab.id);await change(s=>{if(s.helpers[cid]?.tabId===tab.id)delete s.helpers[cid];});idle.delete(tab.id);}return;
    }
    const candidate=jobs[0];
    if(maintenance||maintained.has(cid)||s.paused||c.paused||c.waiting||candidate.status!=='queued'||io.canStart?.()===false)return;
    if(snap.oldUserscript){await fail(candidate.id,'Desactiva el userscript anterior y recarga ChatGPT.');return;}
    // Fresh internal contexts do not necessarily inherit the saved reasoning effort
    // or tool choice. Synchronize only the internal composer, never the user's one.
    // Finish an owned configuration menu even though that menu resets idleStable.
    if(tab.cqFrame&&(h.configuring||!sameConfiguration(candidate,snap,s.settings))){
      if(snap.state!=='idle'||io.busyHint?.(cid))return;
      if(!snap.lastUser?.id||!snap.finalId){await note(cid,'Esperando a cargar el último turno terminado en la vista interna.');return;}
      if(snap.attachments.count||snap.attachments.unsupported){await note(cid,'El contexto interno contiene adjuntos o referencias inesperados. Se conserva la cola.');return;}
      if(snap.blocked&&!(h.configuring&&snap.blocked==='Hay un menú o diálogo abierto')){await note(cid,snap.blocked);return;}
      if(!h.configuring){
        await change(state=>{if(state.helpers[cid]?.tabId===tab.id)state.helpers[cid].configuring={since:now(),retryAt:0};});
        h=(await store.getState()).helpers[cid];
      }
      if(h.configuring.retryAt>now())return;
      if(now()-h.configuring.since>45000){
        await note(cid,'No se pudo reproducir el modelo o las herramientas en la vista interna. La cola se conserva; al volver al chat se usará su editor.');
        await change(state=>{const helper=state.helpers[cid];if(helper?.configuring){helper.configuring.since=now()+30000;helper.configuring.retryAt=now()+30000;}});
        return;
      }
      await note(cid,'Ajustando el modelo y las herramientas del contexto interno');
      if(s.settings.preserveModel&&candidate.model){
        const result=await io.page(tab.id,{cmd:'model',conversationId:cid,model:candidate.model});
        if(result?.error){await note(cid,result.error);return;}
        if(!result?.done)return;
      }
      const result=await io.page(tab.id,{cmd:'options',conversationId:cid,options:candidate.options||[]});
      if(result?.error){await note(cid,result.error);return;}
      if(!result?.done)return;
      const closed=await io.page(tab.id,{cmd:'closeConfiguration',conversationId:cid});
      if(!closed?.done)return;
      await change(state=>{if(state.helpers[cid]?.tabId===tab.id)delete state.helpers[cid].configuring;});
      idle.delete(tab.id);return;
    }
    if(snap.blocked){await note(cid,snap.blocked);return;}
    if(!snap.idleStable||snap.state!=='idle'||io.busyHint?.(cid))return;
    if(tab.cqFrame&&(!snap.lastUser?.id||!snap.finalId)){await note(cid,'Esperando a cargar el último turno terminado en la vista interna.');return;}
    if(snap.attachments.count||snap.attachments.unsupported){await note(cid,'Se conservan los adjuntos y el contexto de tu borrador. La cola espera a que los envíes o retires.');return;}
    if(!sameConfiguration(candidate,snap,s.settings)){await note(cid,'El modelo o las herramientas cambiaron desde que se encoló el mensaje. No se modificarán tus controles automáticamente.');return;}
    if(!await live(candidate.id,'queued'))return;
    await change(s=>{
      const x=find(s,candidate.id);if(!x||x.status!=='queued'||s.paused||s.conversations[cid]?.paused)return;
      markPreparing(s,x.id,tab.id,snap,now()).attempt.stage='model';if(s.helpers[cid])s.helpers[cid].jobId=x.id;
    });
  }
  async function tick(){
    if(maintenance)return;
    let s=await store.getState();
    if(s.version!==4||s.helper||!s.helpers){await change(migrateState);s=await store.getState();}
    const ids=new Set([...s.jobs.map(j=>j.conversationId),...Object.keys(s.helpers)]);
    const work=[];
    for(const cid of ids){
      if(running.has(cid)||maintained.has(cid))continue;
      running.add(cid);
      work.push((async()=>{
        try{await lane(cid);}catch(e){
          const state=await store.getState(),j=state.jobs.find(x=>x.conversationId===cid&&['preparing','submitting'].includes(x.status));
          if(e?.code==='PAGE_UNAVAILABLE'){
            // Only an explicitly unexecuted SEND can be returned to the queue. An
            // expired INSPECT is never proof that an earlier click did not happen.
            if(j&&e.notStarted&&['send','localSend'].includes(e.command)&&j.status==='submitting'){
              await tidy({...j,status:'preparing'});
              await change(s=>{const x=find(s,j.id);if(x?.status==='submitting'){x.status='queued';x.attempt=null;x.reason='';}});
            }
            await note(cid,'Esperando al navegador: '+e.message);
          }
          else if(j)await fail(j.id,e.message,j.status==='submitting');
          else await note(cid,'Esperando al navegador: '+String(e.message).slice(0,250));
        }finally{running.delete(cid);}
      })());
    }
    await Promise.all(work);
  }
  return {tick,clear,remove,pause,resume,retry,uploadResult,change,emit};
}
