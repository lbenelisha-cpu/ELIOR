import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';

// One background writer; yield between symbols instead of stringifying the
// entire historical journal on the price/HTTP event loop every five seconds.
export function createDecisionHistoryWriter({file,snapshot,onError=()=>{},delayMs=30000}){
 let timer=null,running=null,dirty=false;
 async function flush(){
  if(timer){clearTimeout(timer);timer=null;}
  if(running){dirty=true;return running;}
  if(!dirty)return;
  dirty=false;
  running=(async()=>{
   const rows=snapshot(),tmp=file+'.tmp';let handle;
   try{
    await mkdir(dirname(file),{recursive:true});handle=await open(tmp,'w');
    await handle.writeFile('{');let first=true;
    for(const [symbol,entries] of Object.entries(rows)){
     await handle.writeFile((first?'':',')+JSON.stringify(symbol)+':'+JSON.stringify(entries));first=false;
    }
    await handle.writeFile('}');await handle.close();handle=null;
    await rename(tmp,file);
   }catch(error){
    dirty=true;if(handle)await handle.close().catch(()=>{});
    await unlink(tmp).catch(()=>{});onError(error);
   }
  })();
  try{await running;}finally{running=null;if(dirty)schedule();}
 }
 function schedule(){
  dirty=true;
  if(!timer&&!running){timer=setTimeout(()=>{void flush();},delayMs);timer.unref();}
 }
 return {schedule,flush};
}
