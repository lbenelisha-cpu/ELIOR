import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {appendAuditBatch,collectAudit,readAuditJournal,AUDIT_HOUR} from './ma-decision-audit.mjs';
export function auditFileStore(directory){return {
 async get(key){try{return JSON.parse(await readFile(join(directory,key+'.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
 async setJSON(key,value){const file=join(directory,key+'.json');await mkdir(dirname(file),{recursive:true,mode:0o700});await writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await rename(file+'.tmp',file);}
};}
export class FileMaAudit {
 constructor({directory,now=Date.now,store=auditFileStore(directory),delayMs=3000}){this.directory=directory;this.now=now;this.store=store;this.delayMs=delayMs;this.state={};this.error=null;this.running=null;this.timer=null;this.cleanedHour=null;}
 record(row){try{const added=collectAudit(this.state,row,{limit:3000});if(this.state.dropped)this.error='AUDIT_BUFFER_CAPACITY';if(added)this.schedule();return added;}catch{this.error='AUDIT_CAPTURE_FAILED';return false;}}
 schedule(){if(!this.timer){this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.delayMs);this.timer.unref?.();}}
 async flush(){
  if(this.running)return this.running;
  this.running=(async()=>{const batch=[...(this.state.rows||[])];try{
   await appendAuditBatch(this.store,'binance',batch,this.now());
   const ids=new Set(batch.map(row=>row.id));this.state.rows=(this.state.rows||[]).filter(row=>!ids.has(row.id));this.error=this.state.dropped?'AUDIT_BUFFER_CAPACITY':null;
   const hour=Math.floor(this.now()/AUDIT_HOUR);
   if(this.directory&&hour!==this.cleanedHour){this.cleanedHour=hour;const dir=join(this.directory,'binance/hour');for(const name of await readdir(dir).catch(()=>[]))if(/^\d+\.json$/.test(name)&&Number(name.slice(0,-5))<hour-24*30)await unlink(join(dir,name)).catch(()=>{});}
  }catch{this.error='AUDIT_STORAGE_UNAVAILABLE';}finally{this.running=null;if(this.state.rows?.length)this.schedule();}})();return this.running;
 }
 async read(options){const data=await readAuditJournal(this.store,'binance',{now:this.now(),...options});return {...data,storageError:this.error,pending:this.state.rows?.length||0,dropped:this.state.dropped||0};}
}
