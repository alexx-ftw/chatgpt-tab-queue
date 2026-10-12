import {exportBackup,importBackup} from '../core/backup.mjs';
const $=id=>document.getElementById(id),say=t=>{$('notice').textContent=t;};
$('export').addEventListener('click',async()=>{
 const b=$('export');b.disabled=true;
 try{say('Guardando una copia local…');await CQClient.rpc('PAUSE');const data=await exportBackup();
  const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='chatgpt-queue-'+new Date().toISOString().slice(0,10)+'.cqbackup';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  say(`Copia preparada: ${data.state.jobs.length} mensajes. El original sigue guardado y en pausa.`);
 }catch(e){say(e.message);}finally{b.disabled=false;}
});
$('import').addEventListener('click',async()=>{
 const b=$('import'),file=$('file').files[0];if(!file){say('Selecciona el archivo de copia.');return;}
 if(file.size>370*1024*1024){say('El archivo de transferencia es demasiado grande.');return;}b.disabled=true;
 try{await CQClient.rpc('PAUSE');const count=await importBackup(JSON.parse(await file.text()));say(`${count} mensajes importados en pausa. Abre Todas las colas, revisa y reanuda.`);}
 catch(e){say(e.message);}finally{b.disabled=false;}
});
