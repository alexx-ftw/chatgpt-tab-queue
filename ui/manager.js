/* Queue manager UI. Uses existing RPC commands only; never sends or navigates a chat automatically. */
(() => {
  'use strict';
  const {rpc}=CQClient,V=CQView,$=id=>document.getElementById(id);
  let state=null,loading=false,again=false,mode='all',updateMessage='';
  const views=new Map(),backupViews=new Map();
  document.head.append(V.style());$('search-icon').append(V.icon('search'));
  const notice=(value,error=false)=>{V.text($('notice'),value);$('notice-wrap').hidden=!value;$('notice-wrap').dataset.error=String(error);};
  const report=error=>notice(error.message||String(error),true);
  async function load(){
    if(loading){again=true;return;}loading=true;
    try {state=await rpc('GET_STATE');render();}catch(e){report(e);}
    finally {loading=false;if(again){again=false;queueMicrotask(load);}}
  }
  const editing=()=>[...views.values()].some(v=>v.list.editing);
  const activity=()=>rpc('UI_ACTIVITY',{editing:editing()}).catch(()=>{});
  const action=(label,fn,icon)=>V.button(label,fn,icon,report);
  async function refresh(){await load();activity();}
  function makeGroup(c){
    const node=V.el('section',undefined,'conversation');node.dataset.conversationId=c.id;
    const head=V.el('div',undefined,'conversation-head'),titleBox=V.el('div',undefined,'conversation-title'),title=V.el('h3'),sub=V.el('div','','subtitle'),controls=V.el('div',undefined,'controls conversation-controls');
    titleBox.append(title,sub);head.append(titleBox,controls);
    const note=V.el('p','','conversation-note'),jobs=V.el('div',undefined,'group-jobs');node.append(head,note,jobs);
    const view={node,head,title,sub,note,jobs,c,list:null};
    const open=action('Abrir chat',()=>rpc('OPEN_CHAT',{conversationId:c.id}),'open');
    const pause=action('Pausar esta cola',async()=>{await rpc(view.c.paused?'RESUME':'PAUSE',{conversationId:c.id});await refresh();},'pause');view.pause=pause;
    const clear=action('Vaciar este chat',async()=>{
      const count=state.jobs.filter(j=>j.conversationId===c.id).length;if(!count)return;
      if(confirm(`¿Vaciar los ${count} pendientes de esta conversación y sus archivos locales? La respuesta en curso y el historial no se eliminan.`)){await rpc('CLEAR_CHAT',{conversationId:c.id});view.list.discardEdits();await refresh();}
    },'trash');view.clear=clear;controls.append(open,pause,clear);
    view.list=V.createJobList(jobs,{rpc,notify:notice,refresh,onEditing:activity});
    return view;
  }
  const empty=V.el('section',undefined,'empty'),emptyHeading=V.el('h2'),emptyText=V.el('p'),reset=action('Limpiar filtros',()=>{$('search').value='';mode='all';render();});
  empty.append(V.icon('queue'),emptyHeading,emptyText,reset);
  function render(){
    if(!state)return;
    const count=state.jobs.length,totalGroups=new Set(state.jobs.map(j=>j.conversationId)).size;
    V.text($('summary'),`${count} mensaje${count===1?'':'s'} pendiente${count===1?'':'s'} · ${totalGroups} conversación${totalGroups===1?'':'es'}${state.paused?' · En pausa':''}`);
    V.text($('pause'),state.paused?'Reanudar todo':'Pausar todo');$('pause').disabled=!count&&!state.paused;$('clear').disabled=!count;$('preserve').checked=state.settings.preserveModel;
    V.text($('count-all'),count);V.text($('count-paused'),state.jobs.filter(j=>state.paused||state.conversations[j.conversationId]?.paused).length);V.text($('count-review'),state.jobs.filter(j=>['held','error','uncertain'].includes(j.status)).length);
    for(const b of document.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b.dataset.filter===mode));
    $('search-clear').hidden=!$('search').value;
    const keep=new Set([...views.values()].flatMap(v=>[...v.list.editingIds]));
    const groups=V.groups(state,$('search').value,mode,keep),visible=new Set(groups.map(g=>g.conversation.id));
    // A pending edit removed from another view is retained for copying, never sent.
    for(const [cid,v] of views)if(v.list.editing&&!visible.has(cid)){groups.push({conversation:state.conversations[cid]||v.c,all:[],jobs:[]});visible.add(cid);}
    const nodes=[];
    for(const g of groups){
      const c=g.conversation;let v=views.get(c.id);if(!v){v=makeGroup(c);views.set(c.id,v);}v.c=c;
      V.text(v.title,c.title||'Conversación');
      const filtered=g.jobs.length!==g.all.length;
      V.text(v.sub,`${filtered?`${g.jobs.length} de ${g.all.length}`:g.all.length} pendiente${g.all.length===1?'':'s'} · ${V.queueStatus(c,g.all,{paused:state.paused})}`);
      const paused=c.paused;const pauseLabel=paused?'Reanudar esta cola':'Pausar esta cola';v.pause.title=pauseLabel;v.pause.setAttribute('aria-label',pauseLabel);V.setIcon(v.pause,paused?'play':'pause');v.clear.disabled=!g.all.length;
      V.text(v.note,c.reason||'');v.note.hidden=!c.reason;
      const positions=new Map(g.all.map((j,i)=>[j.id,i]));v.list.update(g.jobs,{paused:state.paused||c.paused,positions});nodes.push(v.node);
    }
    // Keep filtered groups cached without touching their row identity. Their data
    // is reconciled against durable state again before they are shown.
    for(const [cid,v] of views)if(!visible.has(cid)){v.node.remove();if(!state.jobs.some(j=>j.conversationId===cid)&&!v.list.editing){v.list.dispose();views.delete(cid);}}
    if(!nodes.length){
      const filtered=count>0;V.text(emptyHeading,filtered?'Sin coincidencias':'Todo despejado');
      const waiting=Object.values(state.conversations).filter(c=>c.waiting).length;
      V.text(emptyText,filtered?'Prueba otra búsqueda o cambia el filtro. Tus mensajes siguen en la cola.':waiting?`${waiting} respuesta${waiting===1?' sigue':'s siguen'} en curso o pendiente de comprobar. No quedan mensajes en cola.`:'Escribe en ChatGPT y pulsa Tab para guardar tu siguiente mensaje.');reset.hidden=!filtered;nodes.push(empty);
    }
    V.sync($('queues'),nodes);renderBackups();
    if(state.reason&&$('notice-wrap').hidden)notice(state.reason);
  }
  function renderBackups(){
    const ds=Object.values(state.draftBackups||{}).filter(d=>!d.active),out=$('draft-backups');out.hidden=!ds.length;
    if(!ds.length){backupViews.clear();out.replaceChildren();return;}
    let h=out.querySelector('h2');if(!h)h=V.el('h2','Borradores guardados para recuperar');const nodes=[h];
    for(const d of ds){let v=backupViews.get(d.token);if(!v){const node=V.el('div',undefined,'backup-row'),title=V.el('p'),controls=V.el('div',undefined,'controls');controls.append(action('Copiar borrador',async()=>{const b=await rpc('GET_DRAFT_BACKUP',{token:d.token});await navigator.clipboard.writeText(b.text);notice('Borrador copiado. Pégalo en la conversación correcta.');}),action('Eliminar copia',async()=>{if(confirm('¿Eliminar esta copia? Hazlo solo después de recuperar el borrador.')){await rpc('DISMISS_DRAFT_BACKUP',{token:d.token});await refresh();}}));node.append(title,controls);v={node,title};backupViews.set(d.token,v);}const cid=state.aliases[d.conversationId]||d.conversationId;V.text(v.title,state.conversations[cid]?.title||'Borrador conservado');nodes.push(v.node);}
    for(const id of backupViews.keys())if(!ds.some(d=>d.token===id))backupViews.delete(id);V.sync(out,nodes);
  }
  function tools(open){$('tools').hidden=!open;$('tools-toggle').setAttribute('aria-expanded',String(open));if(!open)$('tools-toggle').focus({preventScroll:true});}
  $('tools-toggle').addEventListener('click',()=>tools($('tools').hidden));$('tools-close').addEventListener('click',()=>tools(false));
  $('help-toggle').addEventListener('click',()=>{const open=$('help-content').hidden;$('help-content').hidden=!open;$('help-toggle').setAttribute('aria-expanded',String(open));});
  $('notice-close').addEventListener('click',()=>notice(''));
  $('search').addEventListener('input',render);$('search').addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();$('search').value='';render();}});
  $('search-clear').addEventListener('click',()=>{$('search').value='';render();$('search').focus({preventScroll:true});});
  for(const b of document.querySelectorAll('[data-filter]'))b.addEventListener('click',()=>{mode=b.dataset.filter;render();});
  async function runButton(b,fn){if(b.dataset.pending==='true')return;b.dataset.pending='true';b.setAttribute('aria-busy','true');try{await fn();}catch(e){report(e);}finally{b.dataset.pending='false';b.removeAttribute('aria-busy');}}
  $('pause').addEventListener('click',()=>runButton($('pause'),async()=>{await rpc(state.paused?'RESUME':'PAUSE');await refresh();}));
  $('clear').addEventListener('click',()=>runButton($('clear'),async()=>{if(!state?.jobs.length)return;if(!confirm(`¿Vaciar toda la cola? Se eliminarán ${state.jobs.length} mensajes pendientes de todas las conversaciones y sus archivos locales. No se detienen respuestas ni se borra el historial de ChatGPT.`))return;await rpc('CLEAR_ALL');for(const v of views.values())v.list.discardEdits();notice('Cola vaciada. Los mensajes ya enviados siguen en ChatGPT.');await refresh();}));
  $('diagnostics').addEventListener('click',()=>runButton($('diagnostics'),async()=>{
    const content=JSON.stringify(await rpc('DIAGNOSTICS'),null,2);
    try{await navigator.clipboard.writeText(content);$('diagnostic-output').hidden=true;notice('Diagnóstico copiado. No incluye mensajes, borradores ni nombres de archivos.');}
    catch{$('diagnostic-output').value=content;$('diagnostic-output').hidden=false;$('diagnostic-output').focus();$('diagnostic-output').select();notice('Selecciona y copia el diagnóstico mostrado.');}
  }));
  $('preserve').addEventListener('change',()=>rpc('SETTINGS',{preserveModel:$('preserve').checked}).catch(e=>{report(e);load();}));
  async function updateInfo(){const i=await rpc('UPDATE_INFO');V.text($('version'),'v'+i.version);V.text($('update-status'),i.pending?`Versión ${i.pending} descargada. Se aplicará cuando termine el envío o la edición.`:updateMessage||'El navegador gestiona las actualizaciones del paquete firmado.');}
  $('check-update').addEventListener('click',()=>runButton($('check-update'),async()=>{const r=await rpc('CHECK_UPDATE');updateMessage=r.status==='update_available'?'Actualización descargada. Se aplicará cuando sea seguro.':r.status==='throttled'?'El navegador ya lo ha comprobado recientemente. Espera antes de volver a intentarlo.':'No hay una versión nueva disponible.';await updateInfo();}));
  chrome.runtime.onMessage.addListener(m=>{if(m?.channel==='cq2'&&m.type==='STATE_CHANGED')load();});
  load();updateInfo().catch(report);setInterval(()=>{load();activity();},5000);
  window.addEventListener('input',activity);window.addEventListener('pagehide',()=>rpc('UI_ACTIVITY',{editing:false}).catch(()=>{}));
})();
