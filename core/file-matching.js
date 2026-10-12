(()=>{
'use strict';
/** Match captured File objects to native composer cards; ambiguous references are never discarded. */
function selectCapturedFiles(attachments,captured){
 if(attachments.unsupported)throw Error('Este contexto nativo no se puede transportar a otra pestaña con seguridad. El borrador sigue intacto y puedes enviarlo normalmente con Enter.');
 if(!attachments.count)return [];
 const rest=[...captured],selected=[];
 const cards=attachments.items||[];
 if(cards.length!==attachments.count)throw Error('No se reconocen todos los adjuntos. El borrador se conserva; vuelve a adjuntar esos archivos con el adjuntador normal de ChatGPT.');
 for(const card of cards){
   const matches=rest.filter(f=>card.name ? card.name===f.name :
     (' '+String(card.label||'').replace(/\s+/g,' ')+' ').includes(' '+f.name.replace(/\s+/g,' ')+' '));
   // Prefer the longest full name when one filename is a suffix of another.
   if(matches.length>1){const best=Math.max(...matches.map(f=>f.name.length));for(let i=matches.length-1;i>=0;i--)if(matches[i].name.length<best)matches.splice(i,1);}
   if(matches.length===1){selected.push(matches[0]);rest.splice(rest.indexOf(matches[0]),1);continue;}
   if(matches.length>1)throw Error('Hay varios archivos con el mismo nombre. El borrador se conserva para no confundir sus contenidos.');
   if(card.image){
     const remainingCards=cards.slice(selected.length).filter(x=>x.image);
     const images=rest.filter(f=>f.type.startsWith('image/'));
     if(images.length===remainingCards.length){selected.push(images[0]);rest.splice(rest.indexOf(images[0]),1);continue;}
   }
   throw Error('No puedo identificar el archivo original de cada adjunto. Vuelve a adjuntarlos con el botón normal de ChatGPT; el borrador no se ha tocado.');
 }
 return selected;
}

globalThis.CQSelectCapturedFiles=selectCapturedFiles;
})();
