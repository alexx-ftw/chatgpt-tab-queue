/* Shared presentation only. No sending, routing, storage migration or remote code. */
(() => {
  'use strict';
  const el = (tag, value, cls) => { const n = document.createElement(tag); if (value !== undefined) n.textContent = value; if (cls) n.className = cls; return n; };
  const text = (node, value) => { value = String(value ?? ''); if (node.textContent !== value) node.textContent = value; };
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const icons = {
    pause:'M7 4v12M13 4v12',play:'m7 4 9 6-9 6z',trash:'M3 5h14M8 5V3h4v2M5 5l1 12h8l1-12M8 8v6M12 8v6',
    open:'M4 4h5M4 4v12h12v-5M11 3h6v6M17 3l-8 8',remove:'m5 5 10 10M5 15 15 5',edit:'m4 13 9-9 3 3-9 9-4 1z',
    retry:'M16 6a7 7 0 1 0 1 6M16 2v5h-5',copy:'M7 7h10v10H7zM4 13H3V3h10v1',clock:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M10 6v4l3 2',
    warning:'M10 3 18 17H2zM10 8v4M10 14v.1',check:'m4 10 4 4 8-8',file:'M4 2h8l4 4v12H4zM12 2v5h4M7 11h6M7 14h4',
    image:'M3 3h14v14H3zM3 14l5-5 4 4 2-2 3 3M13 6h.01',search:'M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M13 13l4 4',
    settings:'M3 5h14M3 15h14M7 3v4M13 13v4M3 10h14M12 8v4',queue:'M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    for (const [k,v] of Object.entries({viewBox:'0 0 20 20',width:'16',height:'16',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(k,v);
    const p = document.createElementNS(svg.namespaceURI,'path'); p.setAttribute('d',icons[name] || icons.file); svg.append(p); return svg;
  }
  function setIcon(button, name) { if (button.dataset.icon === name) return; button.dataset.icon = name; button.replaceChildren(icon(name)); }
  function button(label, fn, name, notify = () => {}) {
    const b = el('button', name ? undefined : label, name ? 'cq-icon-button' : 'cq-button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label',label);
    if (name) setIcon(b,name);
    b.addEventListener('click', async () => { if (b.dataset.pending === 'true') return; b.dataset.pending = 'true'; b.setAttribute('aria-busy','true'); try { await fn(); } catch (e) { notify(e.message); } finally { b.dataset.pending = 'false'; b.removeAttribute('aria-busy'); } });
    return b;
  }
  function sync(parent, nodes) {
    const wanted = new Set(nodes);
    for (const node of [...parent.children]) if (!wanted.has(node)) node.remove();
    let cursor = parent.firstElementChild;
    for (const node of nodes) {
      if (node === cursor) { cursor = cursor.nextElementSibling; continue; }
      if (node.isConnected && parent.isConnected && parent.moveBefore) parent.moveBefore(node,cursor);
      else parent.insertBefore(node,cursor);
    }
  }
  function phase(job, paused = false) {
    const known = {held:['Revisar borrador','warning'],preparing:['Preparando','clock'],submitting:['Confirmando envío','clock'],uncertain:['Envío incierto','warning'],error:['Requiere revisión','warning']};
    const [label, symbol] = known[job?.status] || (paused ? ['En pausa','pause'] : ['Pendiente','clock']);
    return {label, symbol, attention:['held','uncertain','error'].includes(job?.status)};
  }
  function queueStatus(c, jobs, {paused=false,busy=false} = {}) {
    if (jobs.some(j => ['error','held','uncertain'].includes(j.status))) return 'Requiere revisión';
    if (jobs.some(j => j.status === 'submitting')) return 'Confirmando envío';
    if (jobs.some(j => j.status === 'preparing')) return 'Preparando';
    if (paused || c?.paused) return 'En pausa';
    if (c?.waiting || busy) return 'Esperando respuesta';
    if (String(c?.reason || '').startsWith('Esperando al navegador:')) return 'Reconectando…';
    if (c?.reason) return 'Esperando';
    return 'Pendiente';
  }
  function groups(state, query='', mode='all', keep=new Set()) {
    const needle=normalize(query.trim()), map=new Map();
    for (const j of state.jobs || []) {
      const c=state.conversations[j.conversationId] || {id:j.conversationId,title:'Conversación'};
      if (!map.has(c.id)) map.set(c.id,{conversation:c,all:[],jobs:[]});
      const g=map.get(c.id);g.all.push(j);
      const match=!needle || normalize([c.title,j.text,...(j.files||[]).map(f=>f.name)].join('\n')).includes(needle);
      const filter=mode==='all' || (mode==='paused' && (state.paused||c.paused)) || (mode==='review' && ['held','error','uncertain'].includes(j.status));
      if ((match && filter) || keep.has(j.id)) g.jobs.push(j);
    }
    return [...map.values()].filter(g=>g.jobs.length);
  }
  const css = `
    .cq-job{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:9px;padding:14px 0;border-top:1px solid var(--q-line);color:var(--q-fg);position:relative;min-width:0}
    .cq-number{color:var(--q-muted);font:12px/1.6 var(--q-font,system-ui);font-variant-numeric:tabular-nums;padding-top:2px;text-align:center}
    .cq-body{min-width:0}.cq-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.6;margin:0}.cq-actions{display:flex;align-items:flex-start;gap:1px;align-self:start}
    .cq-icon-button,.cq-button{font:13px/1.35 var(--q-font,system-ui);display:inline-flex;align-items:center;justify-content:center;gap:6px;color:inherit;background:transparent;border:0;border-radius:9px;cursor:pointer;flex-shrink:0;transition:background .12s ease,opacity .12s ease}
    .cq-icon-button{width:30px;height:30px;padding:6px;color:var(--q-muted)}.cq-icon-button svg{flex-shrink:0}.cq-button{min-height:32px;padding:6px 11px;background:var(--q-soft)}
    .cq-icon-button:hover,.cq-button:hover{color:var(--q-fg);background:var(--q-hover)}.cq-icon-button:focus-visible,.cq-button:focus-visible,.cq-editor:focus-visible{outline:2px solid var(--q-focus,var(--q-fg));outline-offset:2px}
    .cq-icon-button:disabled,.cq-button:disabled{opacity:.4;cursor:default}.cq-icon-button[aria-busy=true],.cq-button[aria-busy=true]{opacity:.55;cursor:progress}
    .cq-phase{font-size:11px;line-height:1.5;color:var(--q-muted);display:flex;align-items:center;gap:5px;margin:6px 0 0}.cq-phase svg{width:13px;height:13px}.cq-phase[data-attention=true]{color:var(--q-warning)}
    .cq-files{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.cq-file{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;border:1px solid var(--q-line);border-radius:8px;padding:4px 7px;font-size:11px;line-height:1.4;color:var(--q-muted)}
    .cq-file svg{width:14px;height:14px;flex-shrink:0}.cq-file-name{overflow-wrap:anywhere;min-width:0}.cq-file-size{white-space:nowrap;flex-shrink:0;font-size:10px}
    .cq-reason,.cq-feedback{font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:7px;color:var(--q-muted)}.cq-feedback[data-error=true]{color:var(--q-warning)}
    .cq-edit-area{grid-column:2/-1;min-width:0}.cq-editor{display:block;width:100%;min-height:96px;max-height:45vh;resize:vertical;font:14px/1.6 var(--q-font,system-ui);background:var(--q-bg);border:1px solid var(--q-line);border-radius:12px;color:var(--q-fg);padding:10px 12px;box-sizing:border-box}
    .cq-edit-footer{display:flex;align-items:center;gap:7px;margin-top:8px;flex-wrap:wrap}.cq-edit-hint{font-size:11px;line-height:1.4;color:var(--q-muted);flex:1;min-width:130px}.cq-save{color:var(--q-bg);background:var(--q-fg)}.cq-save:hover{color:var(--q-bg);background:var(--q-fg);opacity:.86}
    .cq-job[hidden],.cq-job [hidden]{display:none!important}.cq-job[data-editing]{background:transparent}
    @media(hover:hover) and (pointer:fine){.cq-job:not([data-attention=true]):not(:hover):not(:focus-within)>.cq-actions{opacity:0}.cq-job[data-attention=true]>.cq-actions{opacity:1}}
    @media(hover:none),(pointer:coarse){.cq-icon-button{width:36px;height:36px}.cq-actions{opacity:1}}
    @media(max-width:440px){.cq-job{grid-template-columns:16px minmax(0,1fr);gap:6px 8px}.cq-actions{grid-column:2;justify-self:end;opacity:1!important}.cq-edit-area{grid-column:2}.cq-file{font-size:11px}.cq-text{font-size:13px}.cq-icon-button{width:34px;height:34px}}
    @media(prefers-reduced-motion:reduce){.cq-icon-button,.cq-button{transition:none}}
  `;
  function style() { return el('style',css); }
  function createJobList(container, options) {
    const {rpc,notify=()=>{},refresh=async()=>{},onEditing=()=>{},compact=false,isAlive=()=>true}=options;
    const drafts=options.drafts || new Map(), views=new Map();let live=true;
    const alive=()=>live&&isAlive();
    const fullJob=id=>rpc('GET_JOB',{id});
    function make(job) {
      const node=el('article',undefined,'job cq-job');node.dataset.jobId=job.id;
      const number=el('span','','number cq-number'),body=el('div',undefined,'cq-body'),read=el('div'),message=el('div','','text cq-text'),files=el('div',undefined,'files cq-files');
      const phaseNode=el('div',undefined,'cq-phase'),phaseIcon=el('span'),phaseLabel=el('span'),reason=el('div','','cq-reason'),feedback=el('div','','cq-feedback');feedback.setAttribute('role','status');feedback.hidden=true;
      phaseNode.append(phaseIcon,phaseLabel);read.append(message,files,phaseNode,reason);body.append(read,feedback);
      const actions=el('div',undefined,'actions cq-actions');node.append(number,body,actions);
      const v={node,job,number,body,read,message,files,phaseNode,phaseLabel,phaseIcon,reason,feedback,actions,form:null,missing:false,busy:false,fileSig:null,phaseIconName:null};
      const say=(value,error=false)=>{text(feedback,value);feedback.hidden=!value;feedback.dataset.error=String(error);};
      const act=(label,fn,name)=>button(label,fn,name,error=>say(error,true));
      v.copy=act('Copiar texto',async()=>{const full=await fullJob(v.job.id);await navigator.clipboard.writeText(full.text);say('Texto copiado.');},'copy');
      v.edit=act('Editar pendiente',async()=>{
        if(drafts.has(v.job.id)||v.busy)return;v.busy=true;
        try {
          await rpc('PAUSE',{conversationId:v.job.conversationId});const full=await fullJob(v.job.id);
          if(!alive()||!node.isConnected)return;
          if(!['queued','error','held'].includes(full.status))throw Error('El mensaje ya se está enviando; no se ha modificado.');
          drafts.set(v.job.id,{value:full.text,base:full.text,job:{...v.job,text:full.text}});beginEdit(v);onEditing(true);await refresh();
        } finally {v.busy=false;}
      },'edit');
      v.retry=act('Reintentar pendiente',async()=>{if(confirm('Comprueba que no se haya enviado y revisa el borrador antes de reactivar este pendiente. ¿Continuar?')){await rpc('RETRY',{id:v.job.id});await refresh();}},'retry');
      v.remove=act('Retirar pendiente',async()=>{if(['submitting','uncertain'].includes(v.job.status)&&!confirm('Este mensaje puede haberse enviado ya. ¿Retirarlo solo de la cola, sin borrarlo de ChatGPT?'))return;await rpc('REMOVE',{id:v.job.id});await refresh();},'remove');
      actions.append(v.copy,v.edit,v.retry,v.remove);
      return v;
    }
    function endEdit(v) {
      drafts.delete(v.job.id);v.form?.remove();v.form=null;delete v.node.dataset.editing;v.read.hidden=false;v.actions.hidden=false;
      onEditing(drafts.size>0);v.edit.focus({preventScroll:true});refresh();
    }
    function beginEdit(v, focus=true) {
      const d=drafts.get(v.job.id);if(!d||v.form)return;
      v.node.dataset.editing='true';v.read.hidden=true;v.actions.hidden=true;
      const area=el('div',undefined,'cq-edit-area'),input=el('textarea',undefined,'cq-editor');input.value=d.value;input.setAttribute('aria-label','Editar mensaje pendiente');
      const footer=el('div',undefined,'cq-edit-footer'),hint=el('span','Cola pausada. Ctrl+Enter guarda · Esc cancela','cq-edit-hint');
      const say=e=>{text(v.feedback,e);v.feedback.hidden=false;v.feedback.dataset.error='true';};
      const save=button('Guardar',async()=>{
        if(v.missing||v.saving||!alive())return;v.saving=true;v.cancel.disabled=true;save.disabled=true;input.readOnly=true;
        try {
          const fresh=await fullJob(v.job.id);
          if(fresh.text!==d.base)throw Error('El pendiente cambió en otra vista. Copia tu edición antes de cancelar y volver a abrirlo.');
          await rpc('EDIT',{id:v.job.id,text:input.value});
          if(alive()){endEdit(v);notify('Guardado. La cola sigue en pausa hasta que la reanudes.');}
        } finally {v.saving=false;v.cancel.disabled=false;input.readOnly=false;save.disabled=v.missing||!['queued','held','error'].includes(v.job.status);}
      },null,say);save.classList.add('cq-save');save.disabled=v.missing;
      const cancel=button('Cancelar',()=>{if(!v.saving)endEdit(v);},null,say);v.cancel=cancel;
      const copy=button('Copiar edición',async()=>{await navigator.clipboard.writeText(input.value);notify('Edición copiada.');},null,say);
      footer.append(hint,copy,cancel,save);area.append(input,footer);v.body.append(area);v.form=area;v.save=save;v.input=input;v.hint=hint;
      input.addEventListener('input',()=>{d.value=input.value;onEditing(true);});
      input.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel.click();}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.stopPropagation();if(!save.disabled)save.click();}});
      if(focus)input.focus({preventScroll:true});
    }
    function updateView(v,job,index,ctx) {
      v.job=job;if(!v.missing)v.position=index;text(v.number,v.missing?'·':String(index+1));v.node.setAttribute('aria-label',v.missing?'Edición conservada':'Mensaje '+(index+1));
      const p=phase(job,ctx.paused);v.node.dataset.attention=String(p.attention);
      if(v.phaseIconName!==p.symbol){v.phaseIcon.replaceChildren(icon(p.symbol));v.phaseIconName=p.symbol;}
      text(v.phaseLabel,p.label);v.phaseNode.dataset.attention=String(p.attention);
      v.phaseNode.hidden=compact&&job.status==='queued';
      text(v.message,job.text||'(Solo adjuntos)');text(v.reason,job.reason||'');v.reason.hidden=!job.reason;
      const fileSig=JSON.stringify(job.files||[]);
      if(fileSig!==v.fileSig){v.fileSig=fileSig;v.files.replaceChildren();for(const f of job.files||[]){const chip=el('span',undefined,'file cq-file');chip.title=f.name;chip.append(icon(String(f.type).startsWith('image/')?'image':'file'),el('span',f.name,'cq-file-name'),el('span',globalThis.CQClient.prettySize(f.size),'cq-file-size'));v.files.append(chip);}}
      v.files.hidden=!job.files?.length;v.edit.hidden=!['queued','held','error'].includes(job.status);v.retry.hidden=!['held','error'].includes(job.status);
      if(drafts.has(job.id)){beginEdit(v,false);if(v.save){v.save.disabled=v.saving||v.missing||!['queued','held','error'].includes(job.status);if(v.missing)text(v.hint,'Ya no está en cola. Tu edición se conserva para copiarla.');}}
    }
    return {
      update(jobs,ctx={}) {
        if(!alive())return;const shown=[...jobs],present=new Set(jobs.map(j=>j.id));
        for(const [id,d] of drafts)if(!present.has(id))shown.splice(Math.min(views.get(id)?.position??shown.length,shown.length),0,d.job);
        const nodes=[];
        for(const [index,j] of shown.entries()) {let v=views.get(j.id);if(!v){v=make(j);views.set(j.id,v);}v.missing=!present.has(j.id);updateView(v,j,ctx.positions?.get(j.id)??index,ctx);nodes.push(v.node);}
        for(const [id,v] of views)if(!nodes.includes(v.node)){v.node.remove();views.delete(id);}
        sync(container,nodes);
      },
      get editing(){return drafts.size>0;},get editingIds(){return new Set(drafts.keys());},
      discardEdits(){for(const v of views.values()){drafts.delete(v.job.id);v.form?.remove();v.form=null;delete v.node.dataset.editing;v.read.hidden=false;v.actions.hidden=false;}onEditing(false);},
      dispose(){live=false;views.clear();}
    };
  }
  globalThis.CQView = {el,text,icon,setIcon,button,sync,phase,queueStatus,groups,css,style,createJobList};
})();
