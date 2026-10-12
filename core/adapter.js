/* Self-contained: executed in MAIN by chrome.scripting; also used read-only in ISOLATED.
   ChatGPT's DOM is not a public API. Unknown states deliberately block sending. */
globalThis.CQPage = function CQPage(args) {
  // A browser timeout cannot cancel queued injection. Expire it before any mutation.
  if(args?.rpcDeadline && Date.now()>args.rpcDeadline)return {cqExpired:true};
  const rootWorld = globalThis;
  let pageWorld = rootWorld, selectedFrame = null;
  if (args?.frameToken) {
    const frame = [...rootWorld.document.querySelectorAll('iframe[data-cq-frame-token]')]
      .find(f => f.getAttribute('data-cq-frame-token') === args.frameToken);
    if (!frame?.isConnected || !frame.contentWindow) throw Error('El contexto interno ya no está disponible. No se tocará tu chat.');
    selectedFrame = frame;
    pageWorld = frame.contentWindow;
    try {
      if (pageWorld.location.origin !== rootWorld.location.origin) throw Error('Origen de contexto interno no permitido.');
    } catch { throw Error('El navegador bloqueó el contexto interno por su origen. No se tocará tu chat.'); }
  }
  return (function CQPage(args) {
    const globalThis = pageWorld, document = pageWorld.document, location = pageWorld.location;
    const window = pageWorld, navigator = pageWorld.navigator;
    const getComputedStyle = pageWorld.getComputedStyle.bind(pageWorld);
    const MutationObserver = pageWorld.MutationObserver, Event = pageWorld.Event;
    const HTMLTextAreaElement = pageWorld.HTMLTextAreaElement;
    const setTimeout = pageWorld.setTimeout.bind(pageWorld), clearTimeout = pageWorld.clearTimeout.bind(pageWorld);
    const queueMicrotask = (pageWorld.queueMicrotask || rootWorld.queueMicrotask).bind(pageWorld);
  args=args||{};
  const FORM='form[data-chatgpt-composer],form[data-type="unified-composer"]';
  const EDITOR='[data-composer-markdown][contenteditable="true"],#prompt-textarea[contenteditable="true"],textarea#prompt-textarea,.ProseMirror[contenteditable="true"][role="textbox"]';
  const STOP=/^(stop|stop generating|stop response|detener|detener generación|detener respuesta|parar)$/i;
  const SEND=/^(send|send message|send prompt|enviar|enviar mensaje)$/i;
  const VOICE=/^(start voice|start voice mode|voice mode|iniciar voz|iniciar modo de voz|iniciar modo voz|modo de voz)$/i;
  const REMOVE=/^(remove|delete|quitar|eliminar|retirar)(?:\s|$)/i;
  const clean=t=>String(t??'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
  const words=t=>clean(t).replace(/\s+/g,' ');
  const visible=e=>(!selectedFrame||(selectedFrame.isConnected&&pageWorld.document===document))&&!!e?.isConnected&&!e.closest('[hidden],[aria-hidden="true"],[inert]')&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&!!e.getClientRects().length;
  const label=e=>e?.getAttribute('aria-label')||e?.getAttribute('title')||'';
  const enabled=e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true';
  const formList=[...document.querySelectorAll(FORM)].filter(f=>[...f.querySelectorAll(EDITOR)].some(visible));
  const form=formList.length===1?formList[0]:null,editor=form&&[...form.querySelectorAll(EDITOR)].find(visible);
  const pathId=location.pathname.match(/(?:^|\/)c\/([a-f0-9-]{20,64})(?:\/|$)/i)?.[1]||null;
  const localId=form?.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id')||null;
  const route=location.origin+location.pathname;
  function ensureRoute(){
    if(selectedFrame&&(!selectedFrame.isConnected||pageWorld.document!==document))throw Error('El contexto interno cambió o se cerró. No se enviará desde el documento anterior.');
    if(location.origin!=='https://chatgpt.com')throw Error('Dominio inesperado.');
    if(args.conversationId&&!args.conversationId.startsWith('draft:')&&pathId!==args.conversationId)throw Error('La conversación ha cambiado.');
    if(!editor)throw Error('No se encuentra un único editor activo.');
    if(args.localId&&!pathId&&localId!==args.localId)throw Error('El chat nuevo cambió antes de enviar.');
  }
  function pmView(){
    // Tiptap attaches its editor instance to the editor DOM. Plain ProseMirror's
    // pmViewDesc is a description of a node, not necessarily an EditorView.
    for(const read of [()=>editor?.editor?.view,()=>editor?.pmViewDesc?.view]){
      try{const v=read();if(v?.dom===editor&&v.state?.doc&&typeof v.dispatch==='function'&&!v.isDestroyed)return v;}catch{}
    }
    return null;
  }
  function textOf(e){
    if(!e)return '';
    if(e.tagName==='TEXTAREA')return e.value;
    if(e===editor){const v=pmView();if(v)return v.state.doc.textBetween(0,v.state.doc.content.size,'\n','\n');}
    function walk(n){
      if(n.nodeType===3)return n.nodeValue;
      if(n.nodeType!==1)return '';
      if(n.matches('br.ProseMirror-trailingBreak'))return '';
      if(n.tagName==='BR')return '\n';
      const a=[...n.childNodes],blocks=/^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|UL|OL|TR)$/;
      return a.map((x,i)=>walk(x)+(a[i+1]&&((x.nodeType===1&&blocks.test(x.tagName))||(a[i+1].nodeType===1&&blocks.test(a[i+1].tagName)))?'\n':'')).join('');
    }
    return walk(e);
  }
  function attachments(){
    if(!form)return {count:0,items:[],unsupported:false,loading:false,remove:[]};
    const areas=[...form.querySelectorAll('[data-composer-attachments],[data-testid="attachments"]')].filter(e=>!e.hidden);
    const portal=form.querySelector('[data-above-composer-portal]');
    const active=areas.filter(a=>[...a.children].some(visible));
    const remove=[];
    for(const a of active)for(const b of a.querySelectorAll('button,[role="button"]'))if(REMOVE.test(label(b))&&visible(b)&&!remove.includes(b))remove.push(b);
    // Some legacy upload cards sit directly inside the form.
    if(!areas.length)for(const b of form.querySelectorAll('button'))if(/^(remove|quitar|eliminar) (file|archivo|attachment|adjunto|image|imagen)/i.test(label(b))&&visible(b))remove.push(b);
    const items=remove.map(b=>{
      let node=b.parentElement;
      for(let i=0;i<4&&node?.parentElement&&!areas.includes(node);i++){
        const others=[...node.querySelectorAll('button,[role="button"]')].filter(x=>REMOVE.test(label(x)));
        if(others.length>1){node=b.parentElement;break;}
        const content=clean(node.innerText||node.textContent||'');
        if(content||node.querySelector('img'))break;
        node=node.parentElement;
      }
      const bits=[label(b),...(node?[...node.querySelectorAll('[title],[alt],[data-file-name]')].flatMap(e=>[e.getAttribute('title'),e.getAttribute('alt'),e.getAttribute('data-file-name')]):[]),node?.innerText||node?.textContent||''].filter(Boolean);
      return {label:words(bits.join(' ')),image:!!node?.querySelector('img'),name:node?.querySelector('[data-file-name]')?.getAttribute('data-file-name')||null};
    });
    const count=remove.length||active.reduce((n,a)=>n+[...a.children].filter(visible).length,0);
    const unsupported=!!editor?.querySelector('[contenteditable="false"],[data-mention],[data-type="mention"]')||!!(portal&&[...portal.children].some(visible))||(count>0&&remove.length!==count);
    const loading=active.some(a=>[...a.querySelectorAll('[role="progressbar"],[aria-busy="true"],[data-state="uploading"],[class*="animate-spin"]')].some(visible));
    return {count,items,unsupported,loading,remove};
  }
  const at=attachments();
  const fileNameMatches=(card,name)=>card.name?card.name===name:(' '+words(card.label)+' ').includes(' '+words(name)+' ');
  function matchesFiles(files){
    if(at.unsupported||at.count!==files.length)return false;
    const remaining=[...at.items];
    for(const f of files){let i=remaining.findIndex(x=>fileNameMatches(x,f.name));
      if(i<0&&String(f.type).startsWith('image/'))i=remaining.findIndex(x=>x.image);
      if(i<0)return false;remaining.splice(i,1);
    }
    return true;
  }
  const buttons=form?[...form.querySelectorAll('button')].filter(visible):[];
  const stop=buttons.find(b=>b.dataset.testid==='stop-button'||STOP.test(label(b)));
  const send=buttons.find(b=>b.dataset.testid==='send-button'||SEND.test(label(b)));
  const voice=buttons.find(b=>VOICE.test(label(b)));
  let state=stop?'busy':(send&&enabled(send))||(voice&&enabled(voice))?'idle':'unknown';
  if(form?.getAttribute('aria-busy')==='true')state='busy';
  function messageId(e){const parent=e?.closest('[data-chatgpt-search-message-ids],[data-message-id],[data-turn-key]');return parent?.getAttribute('data-chatgpt-search-message-ids')?.split(' ')[0]||parent?.getAttribute('data-message-id')||parent?.getAttribute('data-turn-key')||null;}
  const scope=form?.closest('[data-app-shell-focus-area="main"]')||form?.closest('main')||document;
  const users=[...scope.querySelectorAll('[data-user-message-bubble="true"],[data-message-author-role="user"]')].filter((e,i,a)=>!a.some(x=>x!==e&&e.contains(x)));
  function receipt(e){
    if(!e)return null;
    const textEl=e.querySelector('[data-message-text],.whitespace-pre-wrap,[data-search-result-target]');
    const text=textEl?(textEl.innerText||textOf(textEl)):'';
    const files=[];
    const candidates=[...e.querySelectorAll('[data-file-name],[title],[download],[aria-label]')].filter(x=>!textEl?.contains(x));
    for(const x of candidates){const s=x.getAttribute('data-file-name')||x.getAttribute('download')||x.getAttribute('title')||x.getAttribute('aria-label');if(s&&/\.[a-z0-9]{1,12}$/i.test(s)&&!files.includes(s))files.push(s);}
    for(const f of args.expectedFiles||[]){
      const leaves=[...e.querySelectorAll('*')].filter(x=>!x.children.length&&!textEl?.contains(x));
      if(!files.includes(f.name)&&leaves.some(x=>clean(x.textContent)===f.name))files.push(f.name);
    }
    return {id:messageId(e),text:clean(text),files,imageCount:e.querySelectorAll('img').length};
  }
  const lastUser=receipt(users.at(-1));
  const turns=[...scope.querySelectorAll('[data-turn-key]')],turn=turns.at(-1);
  let finalId=null;
  if(turn&&state==='idle'){
    const assistant=[...turn.querySelectorAll('[data-chatgpt-search-unit-key$=":assistant"],[data-message-author-role="assistant"]')].at(-1);
    const finished=[...turn.querySelectorAll('button')].some(b=>/^(regenerate response|regenerate|volver a generar|regenerar respuesta)$/i.test(label(b)));
    if(assistant&&finished)finalId=messageId(assistant);
  }else if(state==='idle'){
    const assistant=[...scope.querySelectorAll('[data-message-author-role="assistant"]')].at(-1);
    if(assistant?.closest('article')?.querySelector('[data-testid="copy-turn-action-button"]'))finalId=messageId(assistant);
  }
  let blocked='';
  if(navigator.onLine===false)blocked='Sin conexión';
  else if([...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')].some(visible))blocked='Hay un menú o diálogo abierto';
  const error=[...(turn||form||document).querySelectorAll('[role="alert"],[data-testid="error-message"]')].find(e=>visible(e)&&clean(e.textContent));
  if(error)blocked='Aviso de ChatGPT: '+words(error.textContent).slice(0,220);
  const reasoning=form?.querySelector('[data-selected-reasoning-effort]');
  const modelButton=document.querySelector('[data-testid="model-switcher-dropdown-button"]');
  const options=form?[...form.querySelectorAll('button[aria-pressed="true"],[data-composer-tool][data-state="active"]')]
    .filter(visible).map(e=>({label:words(label(e)||e.textContent)}))
    .filter(x=>x.label&&!/^(dictate|dictar|microphone|micrófono|select chatgpt model)$/i.test(x.label)):[];
  const model={engine:modelButton?words(modelButton.textContent):null,effort:reasoning?.getAttribute('data-selected-reasoning-effort')||null,effortLabel:reasoning?words(reasoning.querySelector('[class*="ModelPickerTriggerLabel"]')?.textContent||reasoning.textContent):null};
  const snapshot={editorMethod:pmView()?'transaction':editor?.tagName==='TEXTAREA'?'textarea':editor?'native-edit':'unavailable',route,pathId,localId,title:document.title.replace(/\s*[-|·]\s*ChatGPT\s*$/i,''),state,sendEnabled:!!send&&enabled(send),text:textOf(editor),attachments:{count:at.count,items:at.items,unsupported:at.unsupported,loading:at.loading},blocked,lastUser,finalId,model,options,ready:!!editor,oldUserscript:!!document.getElementById('eros-tab-queue')};
  function capture(){const v=pmView();return {...snapshot,doc:v?v.state.doc.toJSON():null,selection:v?{from:v.state.selection.from,to:v.state.selection.to}:null};}
  function replace(snapshot){
    ensureRoute();
    if((args.expectDoc&&JSON.stringify(capture().doc)!==JSON.stringify(args.expectDoc))||(args.expectText!==undefined&&clean(textOf(editor))!==clean(args.expectText)))throw Error('El borrador cambió. No se ha sobrescrito.');
    if(clean(textOf(editor))===clean(snapshot.text)&&!snapshot.doc)return true;
    const v=pmView();
    if(v){
      let content;
      if(snapshot.doc)content=v.state.schema.nodeFromJSON(snapshot.doc).content;
      else{const p=v.state.schema.nodes.paragraph;if(!p)throw Error('Esquema del editor no compatible.');content=String(snapshot.text||'').split('\n').map(x=>p.create(null,x?v.state.schema.text(x):null));}
      let tr=v.state.tr.replaceWith(0,v.state.doc.content.size,content).setMeta('addToHistory',false);
      try{if(snapshot.selection)tr=tr.setSelection(v.state.selection.constructor.create(tr.doc,snapshot.selection.from,snapshot.selection.to));}catch{}
      v.dispatch(tr);
    }else if(editor.tagName==='TEXTAREA'){
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor,snapshot.text||'');editor.dispatchEvent(new Event('input',{bubbles:true}));
    }else{
      const old=document.activeElement;
      const parentFocus=selectedFrame?rootWorld.document.activeElement:null;
      const wasInert=!!selectedFrame?.hasAttribute('inert');
      const parentRanges=[];
      let parentInputSelection=null;
      if(selectedFrame){
        try{const sel=rootWorld.getSelection?.();for(let i=0;i<(sel?.rangeCount||0);i++)parentRanges.push(sel.getRangeAt(i).cloneRange());}catch{}
        try{if(typeof parentFocus?.selectionStart==='number')parentInputSelection={start:parentFocus.selectionStart,end:parentFocus.selectionEnd,direction:parentFocus.selectionDirection};}catch{}
      }
      try{
        // The fallback needs a focusable editing host. Relax only OUR frame's
        // inert marker for this synchronous edit, then restore it and parent focus
        // before yielding. No await, window.focus, tab activation or route changes.
        if(wasInert)selectedFrame.removeAttribute('inert');
        editor.focus({preventScroll:true});
        const range=document.createRange();range.selectNodeContents(editor);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
        if(typeof document.execCommand!=='function'||!document.execCommand(snapshot.text?'insertText':'delete',false,snapshot.text||null))throw Error('El editor no admite edición segura en segundo plano.');
      }finally{
        try{if(old&&old!==editor&&old.isConnected)old.focus({preventScroll:true});}catch{}
        if(wasInert&&selectedFrame?.isConnected)selectedFrame.setAttribute('inert','');
        if(selectedFrame&&parentFocus?.isConnected){
          try{parentFocus.focus({preventScroll:true});
            if(parentInputSelection)parentFocus.setSelectionRange(parentInputSelection.start,parentInputSelection.end,parentInputSelection.direction);
            else if(parentRanges.length){const sel=rootWorld.getSelection?.();sel?.removeAllRanges();for(const range of parentRanges)sel?.addRange(range);}
          }catch{}
        }
      }
    }
    if(clean(textOf(editor))!==clean(snapshot.text))throw Error('El editor no aceptó el texto completo.');
    return true;
  }
  // Runs only in explicitly protected user tabs. No privileged messaging is exposed to the page.
  const GUARD='__cqDraftGuardV2';
  function stopGuard(g){g.observer?.disconnect();for(const [name,fn] of g.listeners||[])document.removeEventListener(name,fn,true);}
  function startGuard(){
    ensureRoute();const previous=globalThis[GUARD];if(previous){stopGuard(previous);delete globalThis[GUARD];}
    const g={expires:Date.now()+(args.guardMs||300000),token:args.token,conversationId:pathId,text:args.text,backup:capture(),restoring:false,conflict:'',manual:false,listeners:[]};
    const active=()=>location.pathname.match(/(?:^|\/)c\/([a-f0-9-]{20,64})(?:\/|$)/i)?.[1]===g.conversationId;
    const read=()=>CQPage({cmd:'capture',conversationId:g.conversationId});
    const edited=event=>{
      if(!event.isTrusted||!active()||g.restoring||!event.target?.closest?.(EDITOR))return;
      try{g.backup=read();}catch{g.conflict='No se pudo conservar el borrador actualizado';}
    };
    const manual=event=>{
      if(!event.isTrusted||!active())return;
      const enter=event.type==='keydown'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.target?.closest?.(EDITOR);
      const b=event.target?.closest?.('button');const click=event.type==='click'&&b?.closest(FORM)&&SEND.test(label(b));
      if(enter||click){g.manual=true;g.conflict='Se inició un envío manual en otra pestaña';stopGuard(g);}
    };
    g.listeners=[['input',edited],['keydown',manual],['click',manual]];
    for(const [name,fn] of g.listeners)document.addEventListener(name,fn,true);
    g.observer=new MutationObserver(()=>{
      if(Date.now()>g.expires||!active()){stopGuard(g);if(globalThis[GUARD]===g)delete globalThis[GUARD];return;}
      if(g.restoring||g.manual)return;
      try{
        const fresh=read();
        if(clean(fresh.text)!==clean(g.backup.text)&&(clean(fresh.text)===clean(g.text)||!clean(fresh.text))){
          g.restoring=true;CQPage({cmd:'write',conversationId:g.conversationId,expectText:fresh.text,snapshot:g.backup});
          queueMicrotask(()=>{g.restoring=false;});
        }
        if(fresh.attachments.count!==g.backup.attachments.count){g.conflict='Los adjuntos nativos cambiaron durante el envío auxiliar';}
      }catch{g.conflict='No se pudo proteger el editor frente a una sincronización entre pestañas';}
    });
    g.observer.observe(form,{subtree:true,childList:true,characterData:true});globalThis[GUARD]=g;
    return {ok:true};
  }
  // A short-lived reservation of an EXISTING composer, never a hidden page or tab.
  const LOCAL='__cqExistingComposerV4';
  function releaseLocal(g){
    for(const [type,fn] of g.listeners||[])document.removeEventListener(type,fn,true);
    if(g.editor?.isConnected){if(g.readonly===null)g.editor.removeAttribute('aria-readonly');else g.editor.setAttribute('aria-readonly',g.readonly);}
    if(g.form?.getAttribute('data-cq-reservation')===g.token)g.form.removeAttribute('data-cq-reservation');
    if(globalThis[LOCAL]===g)delete globalThis[LOCAL];
  }
  function localStillHere(g){
    const current=CQPage({cmd:'inspect'});
    if(!current.ready)return false;
    if(g.pathId)return current.pathId===g.pathId;
    return current.localId===g.localId||!!(g.clicked&&current.lastUser?.id!==g.beforeUser&&clean(current.lastUser?.text)===clean(g.text));
  }
  function restoreLocalText(g){
    if(!localStillHere(g))return false;
    const current=CQPage({cmd:'inspect'});
    // Do not overwrite an unexpected/new draft, even when recovery is requested.
    if(clean(current.text)!==clean(g.text)&&clean(current.text)!==''&&current.text!==g.backup.text)return false;
    if(current.text!==g.backup.text)CQPage({cmd:'write',conversationId:current.pathId||undefined,expectText:current.text,snapshot:g.backup});
    g.restored=CQPage({cmd:'inspect'}).text===g.backup.text;return g.restored;
  }
  function beginLocal(kind){
    ensureRoute();
    const old=globalThis[LOCAL];
    if(old)return old.token===args.token?{ok:true,backup:old.backup}:{ok:false,reason:'El editor ya tiene un envío reservado.'};
    if(state!=='idle'||blocked||at.count||at.unsupported)return {ok:false,reason:'El editor contiene contexto nativo o no está disponible.'};
    if(args.beforeUser!==undefined&&(lastUser?.id||null)!==args.beforeUser)return {ok:false,reason:'La conversación cambió antes de reservar el editor.'};
    const g={kind,token:args.token,text:args.text,backup:capture(),editor,form,pathId,localId,beforeUser:lastUser?.id||null,
      expires:Date.now()+240000,clicked:false,interrupted:false,listeners:[],readonly:editor.getAttribute('aria-readonly')};
    const intercept=e=>{
      if(!e.isTrusted||!form.contains(e.target))return;
      const livePath=location.pathname.match(/(?:^|\/)c\/([a-f0-9-]{20,64})(?:\/|$)/i)?.[1]||null;
      const liveLocal=form.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id')||null;
      if(!g.editor?.isConnected||!g.form?.isConnected||(g.pathId?livePath!==g.pathId:liveLocal!==g.localId)){
        g.interrupted=true;releaseLocal(g);return;
      }
      if(e.type==='click'&&STOP.test(label(e.target?.closest?.('button'))))return;
      const input=['beforeinput','paste','drop','compositionstart','change'].includes(e.type);
      const key=e.type==='keydown'&&(e.key==='Enter'||e.key==='Backspace'||e.key==='Delete'||e.key.length===1)&&!(e.ctrlKey&&e.key.toLowerCase()==='c');
      const control=e.type==='click'&&!!e.target?.closest?.('button');
      if(!input&&!key&&!control)return;
      if(kind==='text'&&!g.clicked){
        // Return the original draft synchronously, then let the real key/paste continue.
        g.interrupted=true;
        let restored=false;try{restored=restoreLocalText(g);}catch{}
        if(restored){releaseLocal(g);return;}
      }
      e.preventDefault?.();e.stopImmediatePropagation?.();
      g.interrupted=true;
      // No manual Send can accidentally include files inserted by the queue.
    };
    for(const name of ['beforeinput','keydown','paste','drop','compositionstart','click','change']){document.addEventListener(name,intercept,true);g.listeners.push([name,intercept]);}
    if(kind==='files')editor.setAttribute('aria-readonly','true');
    form.setAttribute('data-cq-reservation',g.token);globalThis[LOCAL]=g;return {ok:true,backup:g.backup};
  }
  async function endLocal(){
    const g=globalThis[LOCAL];
    if(!g||g.token!==args.token)return {ok:false,reason:'La reserva original ya no está disponible. Usa la copia del borrador guardada.'};
    g.interrupted=true;
    try{
      if(!localStillHere(g))return {ok:false,reason:'Has cambiado de conversación; el borrador se conserva para recuperarlo.'};
      let current=CQPage({cmd:'inspect'});
      if(current.attachments.count){
        if(args.afterSend){
          // A native send may clear its chips on a later render.
          for(let i=0;i<30&&current.attachments.count;i++){await new Promise(r=>setTimeout(r,30));if(!localStillHere(g))return {ok:false};current=CQPage({cmd:'inspect'});}
          if(current.attachments.count)return {ok:false,reason:'Los adjuntos aún no se han retirado después del envío.'};
        }else{
          const check=CQPage({cmd:'verifyFiles',expectedFiles:args.expectedFiles||[]});
          if(!check.match)return {ok:false,reason:'Los adjuntos cambiaron. No se han eliminado ni sobrescrito.'};
          await CQPage({cmd:'removeHelperFiles',conversationId:current.pathId||undefined,expectedFiles:args.expectedFiles||[]});
        }
      }
      const restored=restoreLocalText(g);
      return {ok:restored,reason:restored?'':'Hay otro borrador en el cuadro. La copia original está guardada.'};
    }finally{releaseLocal(g);}
  }
  async function localSend(){
    const unchanged=reason=>({clicked:false,restored:true,reason});
    try{ensureRoute();}catch(e){return unchanged(e.message);}
    if(state!=='idle'||blocked||at.count||at.unsupported)return unchanged('El editor no está listo para enviar.');
    if((args.expectText!==undefined&&snapshot.text!==args.expectText)||(args.expectDoc&&JSON.stringify(capture().doc)!==JSON.stringify(args.expectDoc)))return unchanged('El borrador cambió; se conserva la edición más reciente.');
    if(args.beforeUser!==undefined&&(lastUser?.id||null)!==args.beforeUser)return unchanged('Ha aparecido un mensaje nuevo.');
    for(const key of ['engine','effort'])if(args.model?.[key]&&args.model[key]!==model[key])return unchanged('El modelo cambió. No se han tocado tus controles.');
    const labels=x=>(x||[]).map(o=>words(o.label)).sort();
    if(JSON.stringify(labels(args.options))!==JSON.stringify(labels(options)))return unchanged('Las herramientas del cuadro cambiaron.');
    const begin=beginLocal('text');if(!begin.ok)return unchanged(begin.reason);
    const g=globalThis[LOCAL];let clicked=false,attempted=false,restored=false,reason='';
    try{
      replace({text:args.text,doc:args.doc||null});
      // ProseMirror/React may need a render after an initially empty composer.
      for(let i=0;i<25;i++){
        if((args.rpcDeadline&&Date.now()>args.rpcDeadline)||g.interrupted||globalThis[LOCAL]!==g||!localStillHere(g))break;
        const current=CQPage({cmd:'inspect'});
        if(current.text!==args.text&&clean(current.text)!==clean(args.text))break;
        if(current.state==='idle'&&current.sendEnabled&&!current.blocked){
          attempted=true;
          const r=CQPage({cmd:'send',conversationId:current.pathId||undefined,token:g.token,text:args.text,expectedFiles:[],beforeUser:g.beforeUser,rpcDeadline:args.rpcDeadline});
          attempted=r.clicked;
          if(r.clicked){clicked=true;g.clicked=true;break;}
        }
        if(current.state==='busy')break;
        await new Promise(r=>setTimeout(r,25));
      }
      if(clicked){
        for(let i=0;i<60;i++){
          if(!localStillHere(g))break;
          const current=CQPage({cmd:'inspect'});
          if(!clean(current.text)||current.state==='busy'||(current.lastUser?.id!==g.beforeUser&&clean(current.lastUser?.text)===clean(args.text)))break;
          await new Promise(r=>setTimeout(r,25));
        }
      }
      restored=g.interrupted&&globalThis[LOCAL]!==g?g.restored===true:restoreLocalText(g);
      if(restored&&clicked){
        // Protect against a delayed native clear, but never against the user's own Enter.
        const current=CQPage({cmd:'inspect'});
        CQPage({cmd:'guardStart',conversationId:current.pathId||undefined,token:args.token,text:args.text,guardMs:2500});
      }
    }catch(e){reason=e.message;try{restored=restoreLocalText(g);}catch{}}
    finally{releaseLocal(g);}
    return {clicked:attempted&&!clicked?null:clicked,restored,reason};
  }

  // SPA navigation retains MAIN-world globals. A reservation belongs to a route
  // AND the exact editor/form, not to a browser tab for the lifetime of the page.
  // Detach only our handlers/markers; never copy an old draft into a new chat.
  const oldLease=globalThis[LOCAL];
  if(oldLease&&!oldLease.cleaning){
    const sameRoute=oldLease.pathId?oldLease.pathId===pathId:
      oldLease.localId===localId||!!(oldLease.clicked&&lastUser?.id!==oldLease.beforeUser&&clean(lastUser?.text)===clean(oldLease.text));
    const changedEditor=!oldLease.editor?.isConnected||!oldLease.form?.isConnected||oldLease.editor!==editor||oldLease.form!==form;
    if(!sameRoute||changedEditor){oldLease.interrupted=true;releaseLocal(oldLease);}
    else if(Date.now()>oldLease.expires&&!at.count&&!at.unsupported){
      // An expired text-only lease can be released without dropping file context.
      oldLease.cleaning=true;
      try{if(clean(snapshot.text)===clean(oldLease.text)||!clean(snapshot.text))restoreLocalText(oldLease);}catch{}
      finally{oldLease.interrupted=true;releaseLocal(oldLease);}
    }
  }

  switch(args.cmd||'inspect'){
    case 'localSend':return localSend();
    case 'localBegin':return beginLocal('files');
    case 'localEnd':return endLocal();
    case 'localCheck':{const g=globalThis[LOCAL];return {ok:!!g&&g.token===args.token&&!g.interrupted&&Date.now()<g.expires&&localStillHere(g),reason:g?.interrupted?'Se pausó el envío para recuperar el editor. Repite tu acción sobre el borrador restaurado.':'La reserva del editor caducó o se perdió.'};}

    case 'guardStart':return startGuard();
    case 'guardCheck':{const g=globalThis[GUARD];if(args.conversationId&&pathId!==args.conversationId)return {ok:true};return g?.token===args.token&&Date.now()<g.expires?{ok:!g.conflict,reason:g.conflict}:{ok:false,reason:'La protección del borrador se perdió o caducó. Reintenta el mensaje.'};}
    case 'guardEnd':{const g=globalThis[GUARD];if(g?.token===args.token){stopGuard(g);delete globalThis[GUARD];return {ok:!g.conflict,reason:g.conflict};}return {ok:true};}
    case 'inspect':return snapshot;
    case 'capture':ensureRoute();return capture();
    case 'write':replace(args.snapshot);return capture();
    case 'clear':{
      ensureRoute();
      if((args.expectDoc&&JSON.stringify(capture().doc)!==JSON.stringify(args.expectDoc))||clean(snapshot.text)!==clean(args.expectText)||!matchesFiles(args.expectedFiles||[]))throw Error('El texto o los adjuntos cambiaron antes de encolar. Se conserva el borrador.');
      return (async()=>{
        await CQPage({cmd:'removeHelperFiles',conversationId:args.conversationId,expectedFiles:args.expectedFiles||[]});
        if(args.rpcDeadline&&Date.now()>args.rpcDeadline)throw Error('La limpieza del borrador ha caducado. Revisa el pendiente guardado.');
        CQPage({cmd:'write',conversationId:args.conversationId,expectText:args.expectText,expectDoc:args.expectDoc,snapshot:{text:''}});
        for(const i of form.querySelectorAll('input[type="file"]'))i.value='';
        return true;
      })();
    }
    case 'removeFirstFile':{
      ensureRoute();if(!matchesFiles(args.expectedFiles||[]))throw Error('Los adjuntos cambiaron durante su retirada.');
      if(!at.remove.length)return -1;
      const item=at.items[0];let index=(args.expectedFiles||[]).findIndex(f=>fileNameMatches(item,f.name));
      if(index<0&&item.image)index=(args.expectedFiles||[]).findIndex(f=>f.type?.startsWith('image/'));
      if(index<0)throw Error('No se puede identificar el adjunto que se va a retirar.');
      at.remove[0].click();return index;
    }
    case 'removeHelperFiles':{
      ensureRoute();if(!matchesFiles(args.expectedFiles||[]))throw Error('Hay adjuntos distintos de los que pertenecen al envío.');
      return (async()=>{
        const remaining=[...(args.expectedFiles||[])];
        while(remaining.length){
          const count=remaining.length;
          const index=CQPage({cmd:'removeFirstFile',conversationId:args.conversationId,expectedFiles:remaining});
          if(index<0)throw Error('No se pudo retirar el adjunto.');
          let removed=false;
          for(let n=0;n<20;n++){
            await new Promise(resolve=>setTimeout(resolve,75));
            const next=CQPage({cmd:'inspect'});if(args.conversationId&&!args.conversationId.startsWith('draft:')&&next.pathId!==args.conversationId)throw Error('La conversación cambió.');
            if(next.attachments.count===count-1){removed=true;break;}
          }
          if(!removed)throw Error('ChatGPT no retiró el adjunto. El original sigue guardado en la cola.');
          remaining.splice(index,1);
        }
        return true;
      })();
    }
    case 'verifyFiles':return {match:matchesFiles(args.expectedFiles||[]),loading:at.loading,snapshot};
    case 'send':{
      ensureRoute();
      const lease=globalThis[LOCAL];
      if(args.token&&(!lease||lease.token!==args.token||lease.interrupted||Date.now()>lease.expires))return {clicked:false,snapshot};
      if(args.beforeUser!==undefined&&(lastUser?.id||null)!==args.beforeUser)return {clicked:false,snapshot};
      if(args.model)for(const k of ['engine','effort'])if(args.model[k]&&args.model[k]!==model[k])return {clicked:false,snapshot};
      if(args.options){const names=x=>(x||[]).map(o=>words(o.label)).sort();if(JSON.stringify(names(args.options))!==JSON.stringify(names(options)))return {clicked:false,snapshot};}
      if(state!=='idle'||blocked||at.loading||!send||!enabled(send)||clean(snapshot.text)!==clean(args.text)||!matchesFiles(args.expectedFiles||[]))return {clicked:false,snapshot};
      // This is the only Send click in the entire extension.
      if(lease&&args.token===lease.token)lease.clicked=true;
      send.click();return {clicked:true};
    }
    case 'options':{
      ensureRoute();
      const desired=args.options||[];
      const extra=options.find(o=>!desired.some(d=>words(d.label)===o.label));
      if(extra){const b=[...form.querySelectorAll('button[aria-pressed="true"]')].find(e=>words(label(e)||e.textContent)===extra.label);
        if(b){b.click();return {done:false};}
        return {done:false,error:'No se pudo desactivar una herramienta previa en la auxiliar. No se enviará con otra configuración.'};}
      for(const option of desired){
        const name=words(option.label);if(options.some(x=>x.label===name))continue;
        const choices=[...form.querySelectorAll('button'),...document.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"],[role="option"]')];
        const match=choices.find(e=>visible(e)&&enabled(e)&&words(label(e)||e.textContent)===name);
        if(match){match.click();return {done:false};}
        const add=form.querySelector('[data-composer-navigation-target="add-context"],button[aria-label="Add files and more"],button[aria-label="Añadir archivos y más"]');
        if(add&&add.getAttribute('aria-expanded')!=='true'){add.click();return {done:false};}
        // No guessed label or internal API calls when a native entry is absent.
        return {done:false,error:'La herramienta «'+name+'» no aparece en la auxiliar. El mensaje sigue guardado; puedes usarla normalmente en ChatGPT.'};
      }
      return {done:true};
    }
    case 'closeConfiguration':{
      ensureRoute();
      // Only known composer configuration triggers. Never Escape/Stop or a generic click.
      const triggers=[modelButton,reasoning,form.querySelector('[data-composer-navigation-target="add-context"]')].filter(Boolean);
      for(const trigger of triggers)if(trigger.getAttribute('aria-expanded')==='true'){
        trigger.click();return {done:false};
      }
      return {done:!blocked};
    }
    case 'model':{
      ensureRoute();const want=args.model||{};
      if(want.engine&&model.engine!==want.engine){
        const item=[...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"]')].find(e=>visible(e)&&words(e.textContent)===want.engine);
        if(item){item.click();return {done:false};}
        if(modelButton?.getAttribute('aria-expanded')!=='true'){modelButton?.click();return {done:false};}
        return {done:false,error:'No encuentro el modelo exacto '+want.engine};
      }
      if(want.effort&&model.effort!==want.effort){
        const aliases={max:['extra high','extra alto','máximo'],xhigh:['extra high','extra alto'],high:['high','alto'],medium:['medium','medio','standard','estándar'],low:['low','bajo'],minimal:['minimal','mínimo']};
        const names=[...(aliases[want.effort]||[]),words(want.effortLabel).toLowerCase()].filter(Boolean);
        const choices=[...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],[data-reasoning-effort]')].filter(visible);
        const found=choices.find(e=>e.getAttribute('data-reasoning-effort')===want.effort||names.some(n=>words(e.textContent).toLowerCase()===n||words(e.textContent).toLowerCase().startsWith(n+' ')));
        if(found){found.click();return {done:false};}
        if(reasoning&&reasoning.getAttribute('aria-expanded')!=='true')reasoning.click();
        return {done:false};
      }
      return {done:true};
    }
    case 'sidebar':return [...document.querySelectorAll('[data-sidebar-chatgpt-conversation-key]')].map(row=>({id:row.querySelector('a[href*="/c/"]')?.getAttribute('href')?.match(/\/c\/([^/?#]+)/)?.[1]||null,working:!!row.querySelector('[role="status"][aria-label="Working"],[role="status"][aria-label="Trabajando"]')})).filter(x=>x.id);
    default:throw Error('Comando de editor desconocido.');
  }
  })(args);
};
