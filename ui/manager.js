(() => {
 'use strict';
 const {rpc,prettySize}=CQClient;let state=null,editing=null,loading=false;
 const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;};
 const notice=text=>{$('notice').textContent=text;$('notice').hidden=!text;};
 function button(label,fn,cls){const b=el('button',label,cls);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await fn();await load();}catch(e){notice(e.message);}finally{b.disabled=false;}});return b;}
 async function load(){if(loading)return;loading=true;try{state=await rpc('GET_STATE');render();}catch(e){notice(e.message);}finally{loading=false;}}
 function render(){
  if(!state)return;const count=state.jobs.length,groups=Object.values(state.conversations).filter(c=>state.jobs.some(j=>j.conversationId===c.id));
  $('summary').textContent=`${count} mensaje${count===1?'':'s'} pendiente${count===1?'':'s'} · ${groups.length} conversación${groups.length===1?'':'es'}${state.paused?' · En pausa':''}`;
  $('pause').textContent=state.paused?'Reanudar todo':'Pausar todo';$('clear').disabled=!count;$('preserve').checked=state.settings.preserveModel;
  const backups=$('draft-backups');backups.replaceChildren();
  const recoverable=Object.values(state.draftBackups||{}).filter(d=>!d.active);backups.hidden=!recoverable.length;
  if(recoverable.length){backups.append(el('h3','Borradores guardados para recuperar'));
   for(const d of recoverable){const row=el('div',undefined,'conversation');const cid=state.aliases[d.conversationId]||d.conversationId;
    row.append(el('p',state.conversations[cid]?.title||'Borrador conservado'),button('Copiar borrador',async()=>{const b=await rpc('GET_DRAFT_BACKUP',{token:d.token});await navigator.clipboard.writeText(b.text);notice('Borrador copiado. Pégalo en la conversación correcta.');}),button('Eliminar copia',async()=>{if(confirm('¿Eliminar esta copia del borrador? Hazlo solo después de recuperarlo.'))await rpc('DISMISS_DRAFT_BACKUP',{token:d.token});}));backups.append(row);
   }
  }
  if(state.reason)notice(state.reason);if(editing)return;
  const out=$('queues');out.replaceChildren();
  if(!count){const empty=el('section',undefined,'empty');empty.append(el('h3','Todo despejado'),el('p','Escribe en ChatGPT y pulsa Tab para añadir tu próximo mensaje.'));
   const waiting=Object.values(state.conversations).filter(c=>c.waiting).length;if(waiting)empty.append(el('p',`${waiting} respuesta${waiting===1?' sigue':'s siguen'} en curso o pendiente de comprobar, sin mensajes en cola.`));out.append(empty);return;}
  for(const c of groups){
   const jobs=state.jobs.filter(j=>j.conversationId===c.id),section=el('section',undefined,'conversation'),head=el('div',undefined,'conversation-head'),title=el('div');
   title.append(el('h3',c.title||'Conversación'),el('div',`${jobs.length} pendientes${c.waiting?' · Esperando respuesta':''}${c.paused?' · Pausada':''}`,'subtitle'));
   const controls=el('div',undefined,'controls');controls.append(button('Abrir chat ↗',()=>rpc('OPEN_CHAT',{conversationId:c.id})),button(c.paused?'Reanudar':'Pausar',()=>rpc(c.paused?'RESUME':'PAUSE',{conversationId:c.id})),button('Vaciar este chat',async()=>{if(confirm(`¿Eliminar los ${jobs.length} pendientes de esta conversación y sus archivos? La respuesta en curso no se detiene.`))await rpc('CLEAR_CHAT',{conversationId:c.id});},'danger'));
   head.append(title,controls);section.append(head);if(c.reason)section.append(el('p',c.reason,'notice'));
   for(const [i,j] of jobs.entries()){
    const row=el('article',undefined,'job'),header=el('div',undefined,'job-header');
    const phases={queued:'Pendiente',held:'Guardado, falta liberar el borrador',preparing:'Preparando',submitting:'Confirmando envío',uncertain:'Envío incierto',error:'Revisar'};
    header.append(el('span',String(i+1).padStart(2,'0'),'number'),el('span',phases[j.status]||j.status,'badge'));row.append(header,el('div',j.text||'(Solo archivos)','text'));
    if(j.truncated)row.append(el('p','Vista limitada a 40.000 caracteres. Editar o Copiar recupera el texto completo.','subtitle'));
    const files=el('div',undefined,'files');for(const f of j.files)files.append(el('span',`${f.name} · ${prettySize(f.size)}`,'file'));row.append(files);
    if(j.reason)row.append(el('p',j.reason,'notice'));
    const actions=el('div',undefined,'actions');
    actions.append(button('Copiar texto',async()=>{const full=await rpc('GET_JOB',{id:j.id});await navigator.clipboard.writeText(full.text);notice('Texto copiado.');}));
    if(['queued','error','held'].includes(j.status))actions.append(button('Editar',()=>edit(j,row)));
    if(['error','held'].includes(j.status))actions.append(button('Reintentar',async()=>{if(confirm('Revisa el borrador y los adjuntos antes de reactivar este mensaje. ¿Continuar?'))await rpc('RETRY',{id:j.id});}));
    actions.append(button('Retirar',async()=>{if(['submitting','uncertain'].includes(j.status)&&!confirm('Puede haberse enviado ya. Esto solo lo elimina de la cola, no del chat. ¿Continuar?'))return;await rpc('REMOVE',{id:j.id});}));row.append(actions);section.append(row);
   }
   out.append(section);
  }
 }
 async function edit(j,row){
  await rpc('PAUSE',{conversationId:j.conversationId});const full=await rpc('GET_JOB',{id:j.id});editing=j.id;
  row.replaceChildren();const textarea=el('textarea',undefined,'editor');textarea.value=full.text;textarea.setAttribute('aria-label','Texto del mensaje pendiente');
  const actions=el('div',undefined,'actions');actions.append(button('Guardar',async()=>{await rpc('EDIT',{id:j.id,text:textarea.value});editing=null;notice('Guardado. La conversación queda en pausa hasta que la reanudes.');}),button('Cancelar',()=>{editing=null;}));row.append(textarea,actions);textarea.focus();
 }
 $('pause').addEventListener('click',async()=>{try{await rpc(state.paused?'RESUME':'PAUSE');await load();}catch(e){notice(e.message);}});
 $('clear').addEventListener('click',async()=>{if(!state?.jobs.length)return;
  if(!confirm(`¿Vaciar TODA la cola?\n\nSe eliminarán ${state.jobs.length} mensajes pendientes de todas las conversaciones y sus archivos locales.\n\nNo se detiene la respuesta en curso y no se puede retirar un envío que ya haya empezado.`))return;
  try{await rpc('CLEAR_ALL');editing=null;notice('Cola vaciada. Los mensajes ya enviados no se han borrado de ChatGPT.');await load();}catch(e){notice(e.message);}
 });
 $('diagnostics').addEventListener('click',async()=>{
  const b=$('diagnostics');b.disabled=true;
  try{
   const text=JSON.stringify(await rpc('DIAGNOSTICS'),null,2);
   try{await navigator.clipboard.writeText(text);$('diagnostic-output').hidden=true;notice('Diagnóstico copiado. No incluye mensajes, borradores ni nombres o contenido de archivos.');}
   catch{$('diagnostic-output').value=text;$('diagnostic-output').hidden=false;$('diagnostic-output').focus();$('diagnostic-output').select();notice('Selecciona y copia el diagnóstico mostrado.');}
  }catch(e){notice(e.message);}finally{b.disabled=false;}
 });
 $('preserve').addEventListener('change',async()=>{try{await rpc('SETTINGS',{preserveModel:$('preserve').checked});}catch(e){notice(e.message);}});
 chrome.runtime.onMessage.addListener(m=>{if(m?.channel==='cq2'&&m.type==='STATE_CHANGED')load();});
 async function updateInfo(){const i=await rpc('UPDATE_INFO');$('version').textContent='v'+i.version;$('update-status').textContent=i.pending?'Actualización lista. Se aplicará al terminar el envío o la edición.':'Actualizaciones nativas del navegador · Requiere instalar el paquete firmado';}
 $('check-update').addEventListener('click',async()=>{const b=$('check-update');b.disabled=true;try{const r=await rpc('CHECK_UPDATE');notice(r.status==='update_available'?'Actualización descargada. Se aplicará cuando sea seguro.':r.status==='throttled'?'El navegador ya lo ha comprobado recientemente.':'No hay una versión nueva disponible.');await updateInfo();}catch(e){notice(e.message);}finally{b.disabled=false;}});
 const activity=()=>rpc('UI_ACTIVITY',{editing:!!editing}).catch(()=>{});
 load();updateInfo().catch(()=>{});setInterval(()=>{load();activity();},5000);window.addEventListener('input',activity);window.addEventListener('pagehide',()=>rpc('UI_ACTIVITY',{editing:false}).catch(()=>{}));
})();
