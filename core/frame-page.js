/* A same-origin, noninteractive DOM surface. Never navigates or focuses the parent.
   Executed in the top MAIN world by scripting. All selectors are token-scoped. */
globalThis.CQFrame = function CQFrame(args) {
  'use strict';
  if(args?.rpcDeadline && Date.now()>args.rpcDeadline)return {status:'unavailable',reason:'La orden de contexto interno ha caducado.'};
  if (location.origin !== 'https://chatgpt.com') throw Error('La página anfitriona no es ChatGPT.');
  const frames = () => [...document.querySelectorAll('iframe[data-cq-frame-token]')];
  const unavailable = message => ({status: 'unavailable', reason: message});
  function status(frame) {
    if (!frame?.isConnected) return {status: 'missing'};
    const base = {token: frame.dataset.cqFrameToken, url: frame.dataset.cqFrameUrl, createdAt:Number(frame.dataset.cqFrameCreated)};
    try {
      const child = frame.contentWindow;
      if (!child || child.location.href === 'about:blank') {
        return Date.now() - Number(frame.dataset.cqFrameCreated) > 45000
          ? {...base, ...unavailable('ChatGPT no ha permitido cargar la vista interna. No se abrirán pestañas ni se cambiará tu chat.')}
          : {...base, status: 'loading'};
      }
      if (child.location.origin !== location.origin) return {...base, ...unavailable('La vista interna cambió de origen. La cola se conserva sin enviar.')};
      const expected = new URL(base.url), current = new URL(child.location.href);
      if (current.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, ''))
        return {...base, ...unavailable('La vista interna no está en la conversación solicitada. No se enviará a otro chat.')};
      return {...base, status: child.document.readyState === 'loading' ? 'loading' : 'complete'};
    } catch {
      return {...base, ...unavailable('El navegador o ChatGPT bloqueó la carga interna. La cola queda guardada; tu vista no se ha cambiado.')};
    }
  }
  if (args.cmd === 'ensure') {
    const url = new URL(args.url);
    const id = url.pathname.match(/(?:^|\/)c\/([a-f0-9-]{20,64})(?:\/|$)/i)?.[1];
    if (url.origin !== location.origin || url.username || url.password || id !== args.conversationId)
      throw Error('Destino interno de conversación no válido.');
    const previous = frames().find(f => f.dataset.cqFrameKey === id);
    if (previous) return status(previous);
    if (!document.body) return {status: 'loading'};
    const frame = document.createElement('iframe');
    frame.dataset.cqFrameToken = crypto.randomUUID();
    frame.dataset.cqFrameKey = id;
    frame.dataset.cqFrameUrl = url.origin + url.pathname;
    frame.dataset.cqFrameCreated = String(Date.now());
    frame.title = 'Procesamiento interno de la cola';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('inert', '');
    // No top navigation, popup, dialog, download, camera or microphone privileges.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'none'");
    frame.setAttribute('referrerpolicy', 'same-origin');
    frame.setAttribute('loading', 'eager');
    for (const [name, value] of Object.entries({position:'fixed',left:'-14000px',top:'0',width:'1200px',height:'900px',border:'0',opacity:'0','pointer-events':'none','z-index':'-2147483648'}))
      frame.style.setProperty(name, value, 'important');
    frame.src = frame.dataset.cqFrameUrl;
    document.body.append(frame);
    return {...status(frame), status:'loading'};
  }
  const frame = frames().find(f => f.dataset.cqFrameToken === args.token);
  if (args.cmd === 'status') return status(frame);
  if (args.cmd === 'release') { frame?.remove(); return {ok:true}; }
  throw Error('Operación de contexto interno desconocida.');
};
