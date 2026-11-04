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
  const allForms=[...document.querySelectorAll(FORM)];
  const formList=allForms.filter(f=>[...f.querySelectorAll(EDITOR)].some(visible));
  const form=formList.length===1?formList[0]:null,editor=form&&[...form.querySelectorAll(EDITOR)].find(visible);
  // Read-only local UI lookup. Return DOM nodes only to the caller in this world,
  // never through extension messaging. The panel and sender share this selection.
  if(args.cmd==='uiAnchor')return {form,editor,totalForms:allForms.length,visibleForms:formList.length};
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
  // A favicon or a literal web-link node is not a file/reference. Keep this
  // recognition local to the composer and fail closed on opaque native context.
  const INLINE_CONTEXT='[contenteditable="false"],[data-mention],[data-type="mention"]';
  let inlineContextCache=null;
  function webURL(value){
    const raw=clean(value);
    if(!/^https?:\/\/[^\s<>"`]+$/i.test(raw)||/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(raw))return null;
    try{const u=new rootWorld.URL(raw);return u.hostname&&!u.username&&!u.password?{raw,href:u.href}:null;}catch{return null;}
  }
  function opaqueReference(node){
    if(node?.nodeType!==1)return false;
    const kind=String(node.getAttribute('data-type')||'');
    if(node.hasAttribute('data-mention')||/(?:^|[-_])(mention|reference|attachment|context|resource|file)(?:$|[-_])/i.test(kind))return true;
    return Array.from(node.attributes).some(a=>/^data-(?:file|document|attachment|context|reference|resource|repository|source|item|asset|connector|app)-(?:id|key|token)$/i.test(a.name)||a.name==='data-id');
  }
  function literalLink(node){
    if(!node||node.nodeType!==1)return null;
    const elements=[node,...node.querySelectorAll('*')];
    if(elements.some(opaqueReference))return null;
    if(elements.some(n=>/^(INPUT|TEXTAREA|BUTTON|VIDEO|AUDIO|IFRAME|CANVAS|OBJECT|EMBED)$/i.test(n.tagName)||n.hasAttribute('download')||n.hasAttribute('data-composer-attachments')))return null;
    // Never mistake a pasted photo/preview for a decorative favicon. A small,
    // explicitly decorative image is allowed only as part of a full URL label.
    for(const image of elements.filter(n=>String(n.tagName).toUpperCase()==='IMG')){
      const w=Number(image.getAttribute('width')),h=Number(image.getAttribute('height'));
      if(image.getAttribute('aria-hidden')!=='true'||!(w>0&&w<=32&&h>0&&h<=32))return null;
    }
    let invalid=false;
    function labelText(n){
      if(n.nodeType===3)return n.nodeValue;
      if(n.nodeType!==1)return '';
      if(/^(SVG|IMG)$/i.test(n.tagName))return '';
      if(n.hasAttribute('hidden')||n.getAttribute('aria-hidden')==='true'||n.hasAttribute('inert')){
        if(clean([...n.childNodes].map(labelText).join('')))invalid=true;
        return '';
      }
      if(String(n.tagName).toUpperCase()==='BR')return '\n';
      return [...n.childNodes].map(labelText).join('');
    }
    const value=webURL(labelText(node));if(invalid||!value)return null;
    // URL display and destination must agree. Do not turn an opaque resource or
    // a misleading label into a different message merely because it has an href.
    for(const e of elements)for(const name of ['href','data-url','data-href']){
      if(name==='href'&&String(e.tagName).toUpperCase()!=='A')continue;
      if(!e.hasAttribute(name))continue;
      if(webURL(e.getAttribute(name))?.href!==value.href)return null;
    }
    return value.raw;
  }
  function inlineContexts(){
    if(inlineContextCache)return inlineContextCache;
    const links=new Map();let unsupported=false;
    const nodes=editor?[...editor.querySelectorAll(INLINE_CONTEXT)]:[];
    for(const node of nodes){
      if([...links.keys()].some(root=>root.contains(node)))continue;
      let opaque=false;
      for(let p=node;p&&p!==editor;p=p.parentElement)if(opaqueReference(p)){opaque=true;break;}
      if(opaque){unsupported=true;continue;}
      let found=false;
      // Only a self-contained full-URL wrapper can explain a noneditable node.
      // Stop at the editor, so surrounding user prose never becomes link data.
      for(let p=node;p&&p!==editor;p=p.parentElement){
        const url=literalLink(p);if(url){links.set(p,url);found=true;break;}
      }
      if(!found)unsupported=true;
    }
    return inlineContextCache={links,unsupported};
  }
  function textOf(e){
    if(!e)return '';
    if(e.tagName==='TEXTAREA')return e.value;
    const links=e===editor?inlineContexts().links:new Map();
    // ProseMirror textBetween can omit atomic link labels. Read certified URL
    // nodes from the DOM, retaining the native document separately in capture().
    if(e===editor&&!links.size){const v=pmView();if(v)return v.state.doc.textBetween(0,v.state.doc.content.size,'\n','\n');}
    function walk(n){
      if(n.nodeType===3)return n.nodeValue;
      if(n.nodeType!==1)return '';
      if(links.has(n))return links.get(n);
      if(n.matches('br.ProseMirror-trailingBreak'))return '';
      if(n.tagName==='BR'){
        // A lone BR is the browser's placeholder for an empty paragraph. The
        // surrounding block boundary already supplies its line break.
        const parent=n.parentElement,siblings=parent?[...parent.childNodes].filter(x=>x.nodeType!==3||x.nodeValue!==''):[];
        if(parent&&/^(P|DIV|LI|PRE|BLOCKQUOTE)$/i.test(parent.tagName)&&siblings.length===1)return '';
        return '\n';
      }
      const a=[...n.childNodes],blocks=/^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|UL|OL|TR)$/;
      return a.map((x,i)=>walk(x)+(a[i+1]&&((x.nodeType===1&&blocks.test(x.tagName))||(a[i+1].nodeType===1&&blocks.test(a[i+1].tagName)))?'\n':'')).join('');
    }
    return walk(e);
  }
  const REMOVE_SELECTION=/^(?:remove selected text|(?:quitar|eliminar|retirar) (?:el )?texto seleccionado)\s+[1-9]\d*$/i;
  function selectionFrom(remove,areas){
    // Only the positively identified native Selection card is a text quotation.
    // Do not treat a file, Library item, connector reference or generic preview as one.
    for(let card=remove.parentElement;card&&card!==form&&!areas.includes(card);card=card.parentElement){
      const removers=[...card.querySelectorAll('button,[role="button"]')].filter(b=>REMOVE.test(label(b)));
      if(removers.length!==1||removers[0]!==remove)break;
      const previews=[...card.querySelectorAll('[class*="whitespace-pre-wrap"]')];
      const opener=[...card.querySelectorAll('button')].some(b=>/^(selection|selección|texto seleccionado)$/i.test(label(b)));
      if(!previews.length||!opener)continue;
      if(previews.length!==1)return null;
      const preview=previews[0],nodes=[card,...card.querySelectorAll('*')];
      if(!visible(preview)||nodes.some(opaqueReference)||card.querySelector('img,video,audio,canvas,iframe,object,embed,input,textarea'))return null;
      if([preview,...preview.querySelectorAll('*')].some(n=>n.hasAttribute('hidden')||n.getAttribute('aria-hidden')==='true'||n.hasAttribute('inert')))return null;
      const text=textOf(preview).replace(/\r\n?/g,'\n');
      if(!text.trim()||text.length>2000000)return null;
      return {text,remove,card};
    }
    return null;
  }
  const sameSelections=(actual,expected)=>Array.isArray(expected)&&actual.length===expected.length&&actual.every((s,i)=>s===expected[i]);
  function quotedMessage(text,selections){
    if(!selections.length)return text;
    return '# Selected text:\n\n'+selections.map((s,i)=>`## Selection ${i+1}\n\n${s.split('\n').map(line=>'> '+line).join('\n')}`).join('\n\n')+'\n\n## My request:\n\n'+text;
  }
  function attachments(){
    if(!form)return {count:0,items:[],unsupported:false,loading:false,remove:[],selections:[],selectionError:''};
    const areas=[...form.querySelectorAll('[data-composer-attachments],[data-testid="attachments"]')].filter(e=>!e.hidden);
    const portal=form.querySelector('[data-above-composer-portal]');
    const active=areas.filter(a=>[...a.children].some(visible));
    const remove=[];
    for(const a of active)for(const b of a.querySelectorAll('button,[role="button"]'))if(REMOVE.test(label(b))&&visible(b)&&!remove.includes(b))remove.push(b);
    // Some legacy upload cards sit directly inside the form.
    if(!areas.length)for(const b of form.querySelectorAll('button'))if(/^(remove|quitar|eliminar) (file|archivo|attachment|adjunto|image|imagen)/i.test(label(b))&&visible(b))remove.push(b);
    const selections=[],covered=[];let selectionError='';
    const items=remove.map(b=>{
      if(REMOVE_SELECTION.test(label(b))){
        const selected=selectionFrom(b,areas);
        if(selected){selections.push(selected);covered.push(selected.card);}
        else selectionError='No se puede leer con seguridad el texto de esta selección. El borrador sigue intacto.';
        return {kind:'selection',text:selected?.text||null,label:label(b),image:false,name:null};
      }
      let node=b.parentElement;
      for(let i=0;i<4&&node?.parentElement&&!areas.includes(node);i++){
        const others=[...node.querySelectorAll('button,[role="button"]')].filter(x=>REMOVE.test(label(x)));
        if(others.length>1){node=b.parentElement;break;}
        const content=clean(node.innerText||node.textContent||'');
        if(content||node.querySelector('img'))break;
        node=node.parentElement;
      }
      if(node)covered.push(node);
      const bits=[label(b),...(node?[...node.querySelectorAll('[title],[alt],[data-file-name]')].flatMap(e=>[e.getAttribute('title'),e.getAttribute('alt'),e.getAttribute('data-file-name')]):[]),node?.innerText||node?.textContent||''].filter(Boolean);
      return {kind:'file',label:words(bits.join(' ')),image:!!node?.querySelector('img'),name:node?.querySelector('[data-file-name]')?.getAttribute('data-file-name')||null};
    });
    // React can leave an empty layout wrapper after the final card disappears.
    // Unknown content/media/loading still counts; an empty wrapper is not a file.
    const meaningful=e=>e.matches('[role="progressbar"],[data-file-name],[aria-busy="true"],[data-state="uploading"],[class*="animate-spin"]')||!!clean(e.textContent)||!!e.querySelector('img,svg,video,audio,canvas,iframe,button,[role="button"],[role="progressbar"],[data-file-name],[aria-busy="true"],[data-state="uploading"],[class*="animate-spin"]')||/^(IMG|SVG|VIDEO|AUDIO|CANVAS|IFRAME|BUTTON)$/i.test(e.tagName);
    const count=remove.length||active.reduce((n,a)=>n+[...a.children].filter(e=>visible(e)&&meaningful(e)).length,0);
    function unaccounted(node){
      if(covered.some(root=>root===node||root.contains(node)))return false;
      if(node.nodeType===3)return !!clean(node.nodeValue);
      if(node.nodeType!==1||node.hasAttribute('hidden')||node.getAttribute('aria-hidden')==='true')return false;
      if(opaqueReference(node)||/^(IMG|VIDEO|AUDIO|CANVAS|IFRAME|INPUT|BUTTON)$/i.test(node.tagName))return true;
      return [...node.childNodes].some(unaccounted);
    }
    const unexplainedSelectionCompanion=selections.length>0&&active.some(unaccounted);
    const unsupported=!!selectionError||unexplainedSelectionCompanion||inlineContexts().unsupported||!!(portal&&[...portal.children].some(visible))||(count>0&&remove.length!==count);
    const loading=active.some(a=>[...a.querySelectorAll('[role="progressbar"],[aria-busy="true"],[data-state="uploading"],[class*="animate-spin"]')].some(visible));
    return {count,items,unsupported,loading,remove,selections,selectionError};
  }
  const at=attachments();
  const fileNameMatches=(card,name)=>card.name?card.name===name:(' '+words(card.label)+' ').includes(' '+words(name)+' ');
  function matchesFiles(files,expectedSelections=[]){
    if(at.unsupported||!sameSelections(at.selections.map(s=>s.text),expectedSelections)||at.count!==files.length+expectedSelections.length)return false;
    const remaining=at.items.filter(item=>item.kind!=='selection');
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
  // Confirm the complete user message, never the first search-highlight block.
  // Reading is local and side-effect free. These variants retain formatting
  // markers; matching never strips punctuation or accepts a substring.
  const RECEIPT_TEXT='[data-message-text],[data-message-content],.whitespace-pre-wrap,[data-search-result-target],.markdown';
  const receiptExcluded=n=>n?.nodeType===1&&(n.matches('button,[role="button"],svg,script,style,input,textarea,form,[hidden],[aria-hidden="true"],[inert],[data-markdown-copy="exclude"],[data-file-name],[data-composer-attachments]')||getComputedStyle(n).display==='none'||getComputedStyle(n).visibility==='hidden');
  function receiptText(node,markdown=false){
    if(node.nodeType===3)return node.nodeValue;
    if(node.nodeType!==1||receiptExcluded(node))return '';
    const tag=String(node.tagName).toUpperCase();
    if(tag==='IMG')return ''; // File/image proof is verified separately.
    if(tag==='BR')return '\n';
    const children=[...node.childNodes];
    const block=n=>n?.nodeType===1&&/^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|LI|PRE|TABLE|TR|SECTION)$/.test(String(n.tagName).toUpperCase());
    const value=children.map((n,i)=>receiptText(n,markdown)+(children[i+1]&&(block(n)||block(children[i+1]))?(markdown?'\n\n':'\n'):'')).join('');
    if(!markdown)return value;
    if(/^H[1-6]$/.test(tag))return '#'.repeat(Number(tag.slice(1)))+' '+clean(value);
    if(tag==='BLOCKQUOTE')return clean(value).split('\n').map(line=>'> '+line).join('\n');
    if(tag==='STRONG'||tag==='B')return '**'+value+'**';
    if(tag==='EM'||tag==='I')return '*'+value+'*';
    if(tag==='DEL'||tag==='S')return '~~'+value+'~~';
    if(tag==='A'){
      const href=node.getAttribute('href');
      return href&&clean(value)!==href?'['+value+']('+href+')':value;
    }
    if(tag==='CODE'&&String(node.parentElement?.tagName).toUpperCase()!=='PRE')return '`'+value+'`';
    if(tag==='PRE'){
      const language=node.querySelector('code')?.getAttribute('class')?.match(/(?:^|\s)language-([\w+-]+)/)?.[1]||'';
      return '```'+language+'\n'+value.replace(/\n$/,'')+'\n```';
    }
    if(tag==='LI'){
      const ordered=String(node.parentElement?.tagName).toUpperCase()==='OL';
      const start=Number(node.parentElement?.getAttribute('start')||1);
      const index=ordered?[...node.parentElement.children].indexOf(node):0;
      return (ordered?String(start+index)+'. ':'- ')+clean(value);
    }
    return value;
  }
  function receipt(e){
    if(!e)return null;
    const matches=[...(e.matches(RECEIPT_TEXT)?[e]:[]),...e.querySelectorAll(RECEIPT_TEXT)];
    const roots=matches.filter(x=>!receiptExcluded(x)&&!matches.some(p=>p!==x&&p.contains(x)));
    if(!roots.length)roots.push(e);
    const text=clean(roots.map(n=>receiptText(n)).join('\n'));
    const markdown=clean(roots.map(n=>receiptText(n,true)).join('\n\n'));
    const textCandidates=[...new Set([text,markdown])];
    const files=[];
    const inText=x=>roots.some(r=>r!==e&&r.contains(x));
    const candidates=[...e.querySelectorAll('[data-file-name],[title],[download],[aria-label]')].filter(x=>!inText(x));
    for(const x of candidates){const s=x.getAttribute('data-file-name')||x.getAttribute('download')||x.getAttribute('title')||x.getAttribute('aria-label');if(s&&/\.[a-z0-9]{1,12}$/i.test(s)&&!files.includes(s))files.push(s);}
    for(const f of args.expectedFiles||[]){
      const leaves=[...e.querySelectorAll('*')].filter(x=>!x.children.length&&!inText(x));
      if(!files.includes(f.name)&&leaves.some(x=>clean(x.textContent)===f.name))files.push(f.name);
    }
    return {id:messageId(e),text,textCandidates,files,imageCount:e.querySelectorAll('img').length,textRootCount:roots.length};
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
  const snapshot={editorMethod:pmView()?'transaction':editor?.tagName==='TEXTAREA'?'textarea':editor?'native-edit':'unavailable',route,pathId,localId,title:document.title.replace(/\s*[-|·]\s*ChatGPT\s*$/i,''),state,sendEnabled:!!send&&enabled(send),text:textOf(editor),attachments:{count:at.count,items:at.items,unsupported:at.unsupported,loading:at.loading,selections:at.selections.map(s=>s.text),selectionError:at.selectionError},blocked,lastUser,finalId,model,options,ready:!!editor,oldUserscript:!!document.getElementById('eros-tab-queue')};
  // Historical lookup is limited to the first user message after the saved
  // pre-send baseline. Never scan arbitrary old identical messages for a match.
  if(Object.hasOwn(args,'receiptAfter')){
    const anchors=args.receiptAfter?users.map((e,i)=>messageId(e)===args.receiptAfter?i:-1).filter(i=>i>=0):[];
    snapshot.receiptAnchorFound=anchors.length===1;
    snapshot.receiptAnchorAmbiguous=anchors.length>1;
    snapshot.submittedUser=anchors.length===1?receipt(users[anchors[0]+1]):null;
    snapshot.receiptUserCount=users.length;
  }
  const panels=[...document.querySelectorAll('#cq2-panel')];
  snapshot.interface={formCount:allForms.length,activeFormCount:formList.length,panelCount:panels.length,panelVisible:panels.some(visible),renderedItems:panels.reduce((n,p)=>n+(p.shadowRoot?.querySelectorAll('.job').length||0),0)};
  function capture(){
    const v=pmView(),doc=v?v.state.doc.toJSON():null;
    // Preserve the raw capture for draft restoration. Only queue transport uses
    // a textual quote, since native selection anchors cannot be recreated safely.
    return {...snapshot,doc,selection:v?{from:v.state.selection.from,to:v.state.selection.to}:null,
      queueText:quotedMessage(snapshot.text,at.selections.map(s=>s.text)),queueDoc:at.selections.length?null:doc};
  }
  function guardSource(){
    if(args.guardText!==undefined&&snapshot.text!==args.guardText)throw Error('El borrador cambió durante el guardado. Se conserva la edición actual.');
    if(args.guardDoc&&JSON.stringify(capture().doc)!==JSON.stringify(args.guardDoc))throw Error('El documento del editor cambió durante el guardado.');
  }
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
    inlineContextCache=null; // Recheck node views after the edit.
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
      const saved=capture(),selected=at.selections.map(s=>s.text);
      if((args.expectDoc&&JSON.stringify(saved.queueDoc)!==JSON.stringify(args.expectDoc))||
         clean(saved.queueText)!==clean(args.expectText)||!matchesFiles(args.expectedFiles||[],selected)||
         (args.sourceText!==undefined&&snapshot.text!==args.sourceText)||
         (args.sourceDoc&&JSON.stringify(saved.doc)!==JSON.stringify(args.sourceDoc))||
         (args.selectedTexts!==undefined&&!sameSelections(selected,args.selectedTexts)))
        throw Error('El texto, la selección o los adjuntos cambiaron antes de encolar. Se conserva el borrador.');
      const guard={conversationId:args.conversationId,guardText:snapshot.text,guardDoc:saved.doc,rpcDeadline:args.rpcDeadline};
      return (async()=>{
        await CQPage({cmd:'removeHelperFiles',...guard,expectedFiles:args.expectedFiles||[],expectedSelections:selected});
        if(selected.length)await CQPage({cmd:'removeSelectedTexts',...guard,expectedSelections:selected});
        if(args.rpcDeadline&&Date.now()>args.rpcDeadline)throw Error('La limpieza del borrador ha caducado. Revisa el pendiente guardado.');
        const check=CQPage({cmd:'verifyFiles',...guard,expectedFiles:[]});
        if(!check.match)throw Error('El contexto del borrador cambió durante el guardado.');
        CQPage({cmd:'write',conversationId:args.conversationId,expectText:snapshot.text,expectDoc:saved.doc,snapshot:{text:''},rpcDeadline:args.rpcDeadline});
        for(const i of form.querySelectorAll('input[type="file"]'))i.value='';
        return true;
      })();
    }
    case 'removeFirstFile':{
      ensureRoute();guardSource();if(!matchesFiles(args.expectedFiles||[],args.expectedSelections||[]))throw Error('Los adjuntos o la selección cambiaron durante su retirada.');
      const itemIndex=at.items.findIndex(item=>item.kind!=='selection');
      if(itemIndex<0)return -1;
      const item=at.items[itemIndex];let index=(args.expectedFiles||[]).findIndex(f=>fileNameMatches(item,f.name));
      if(index<0&&item.image)index=(args.expectedFiles||[]).findIndex(f=>f.type?.startsWith('image/'));
      if(index<0)throw Error('No se puede identificar el adjunto que se va a retirar.');
      at.remove[itemIndex].click();return index;
    }
    case 'removeHelperFiles':{
      ensureRoute();guardSource();if(!matchesFiles(args.expectedFiles||[],args.expectedSelections||[]))throw Error('Hay adjuntos o selecciones distintos de los guardados.');
      return (async()=>{
        const remaining=[...(args.expectedFiles||[])];
        while(remaining.length){
          const count=remaining.length+(args.expectedSelections?.length||0);
          const index=CQPage({cmd:'removeFirstFile',conversationId:args.conversationId,expectedFiles:remaining,expectedSelections:args.expectedSelections,guardText:args.guardText,guardDoc:args.guardDoc,rpcDeadline:args.rpcDeadline});
          if(index<0)throw Error('No se pudo retirar el adjunto.');
          let removed=false;
          for(let n=0;n<20;n++){
            await new Promise(resolve=>setTimeout(resolve,75));
            const next=CQPage({cmd:'inspect'});if(args.conversationId&&!args.conversationId.startsWith('draft:')&&next.pathId!==args.conversationId)throw Error('La conversación cambió.');
            if(args.guardText!==undefined&&next.text!==args.guardText)throw Error('El borrador cambió durante el guardado.');
            if(!sameSelections(next.attachments.selections||[],args.expectedSelections||[]))throw Error('La selección cambió durante el guardado.');
            if(next.attachments.count===count-1){removed=true;break;}
          }
          if(!removed)throw Error('ChatGPT no retiró el adjunto. El original sigue guardado en la cola.');
          remaining.splice(index,1);
        }
        return true;
      })();
    }
    case 'removeFirstSelection':{
      ensureRoute();guardSource();
      if(!matchesFiles([],args.expectedSelections||[])||!at.selections.length)throw Error('La selección cambió durante el guardado.');
      at.selections[0].remove.click();return true;
    }
    case 'removeSelectedTexts':{
      ensureRoute();guardSource();
      if(!matchesFiles([],args.expectedSelections||[]))throw Error('La selección cambió durante el guardado.');
      return (async()=>{
        const remaining=[...(args.expectedSelections||[])];
        while(remaining.length){
          const previous=[...remaining];
          const result=CQPage({cmd:'removeFirstSelection',conversationId:args.conversationId,expectedSelections:remaining,guardText:args.guardText,guardDoc:args.guardDoc,rpcDeadline:args.rpcDeadline});
          if(result!==true)throw Error('La retirada de la selección no se ha confirmado.');
          remaining.shift();let removed=false;
          for(let n=0;n<20;n++){
            await new Promise(resolve=>setTimeout(resolve,50));
            const next=CQPage({cmd:'capture',conversationId:args.conversationId});
            if(args.guardText!==undefined&&next.text!==args.guardText)throw Error('El borrador cambió durante el guardado.');
            if(args.guardDoc&&JSON.stringify(next.doc)!==JSON.stringify(args.guardDoc))throw Error('El documento del editor cambió durante el guardado.');
            const actual=next.attachments.selections||[];
            if(next.attachments.unsupported)throw Error('La selección ya no se puede verificar.');
            if(sameSelections(actual,remaining)&&next.attachments.count===remaining.length){removed=true;break;}
            if(!sameSelections(actual,previous))throw Error('La selección cambió durante su retirada.');
          }
          if(!removed)throw Error('ChatGPT no retiró la selección. El texto sigue guardado en la cola para revisión.');
        }
        return true;
      })();
    }
    case 'verifyFiles':guardSource();return {match:matchesFiles(args.expectedFiles||[],args.expectedSelections||[]),loading:at.loading,snapshot};
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
