/** Read-only diagnostic projection. Never include prompts, documents, filenames,
 * binary data, draft backups, attempt tokens, conversation titles or auth state. */
const allowed = (value, values, fallback = 'unknown') => values.includes(value) ? value : fallback;
// Error/alert messages may contain a filename or part of a prompt. Export only
// controlled categories, never a substring of the original free-form message.
function reasonCategory(value) {
 const text=String(value||'');
 if(!text)return 'none';
 if(/configur|modelo|esfuerzo|model|effort/i.test(text))return 'configuration';
 if(/frame|iframe|contexto interno/i.test(text))return 'internal-context';
 if(/sin conex|offline|network/i.test(text))return 'network';
 if(/menú|menu|diálogo|dialog/i.test(text))return 'menu-or-dialog';
 if(/editor|compositor|borrador/i.test(text))return 'composer';
 if(/incierto|uncertain|confirm/i.test(text))return 'unconfirmed-send';
 if(/pausa|pause/i.test(text))return 'paused';
 return 'other';
}
function surfaceError(error) {
 const text=String(error?.message||'');
 if(/frame.*block|block.*frame/i.test(text))return 'Frame blocked';
 if(/timeout|time.?out|tiempo/i.test(text))return 'Surface timeout';
 if(/frame|contexto|tab|pestaña/i.test(text))return 'Surface unavailable';
 return 'Inspection failed';
}
export async function collectDiagnostics(state,io,version){
 const result={version,generatedAt:new Date().toISOString(),paused:!!state.paused,tabs:[],conversations:[]};
 try{result.tabs=(await io.listTabs()).map(t=>({id:t.id,conversationId:String(t.url||'').match(/\/c\/([a-f0-9-]{20,64})/i)?.[1]||null,status:t.status||'unknown',discarded:!!t.discarded,frozen:!!t.frozen}));}
 catch{result.tabsUnavailable=true;}
 const ids=new Set([...(state.jobs||[]).map(j=>j.conversationId),...Object.keys(state.helpers||{})]);
 result.conversations=await Promise.all([...ids].slice(0,100).map(async cid=>{
  const c=state.conversations[cid]||{},h=state.helpers?.[cid];
  const row={id:cid,paused:!!c.paused,waiting:!!c.waiting,reason:reasonCategory(c.reason),jobs:(state.jobs||[]).filter(j=>j.conversationId===cid).map(j=>({status:j.status,stage:j.attempt?.stage||null,fileCount:j.files?.length||0})),surface:null};
  if(!h)return row;
  const internal=String(h.tabId).startsWith('frame:');row.surface={type:internal?'internal':'tab',hostTabId:internal?Number(String(h.tabId).split(':')[1]):h.tabId,configuring:!!h.configuring};
  try{
   const tab=await io.getTab(h.tabId);Object.assign(row.surface,{status:tab.status||'unknown',discarded:!!tab.discarded,frozen:!!tab.frozen});
   if(!tab.discarded&&!tab.frozen&&tab.status!=='loading'){
    const p=await io.page(h.tabId,{cmd:'inspect',conversationId:cid});
    row.surface.page=p?{ready:!!p.ready,editorMethod:allowed(p.editorMethod,['transaction','textarea','native-edit','unavailable']),conversationId:p.pathId||null,state:allowed(p.state,['idle','busy','unknown']),sendEnabled:!!p.sendEnabled,blocked:!!p.blocked,blocker:reasonCategory(p.blocked),hasUser:!!p.lastUser?.id,hasFinal:!!p.finalId,attachmentCount:p.attachments?.count||0,unsupportedContext:!!p.attachments?.unsupported,effort:allowed(p.model?.effort,['none','minimal','low','medium','high','xhigh','max'],null)}:null;
   }
  }catch(e){row.surface.error=surfaceError(e);}
  return row;
 }));
 return result;
}
