import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
// Write intent before sending. An unknown result is queried by the SAME identity, never resubmitted.
export class PersistedMarketOrder{
 constructor(file){this.file=file;this.pending=null;this.busy=false;if(fs.existsSync(file))this.pending=JSON.parse(fs.readFileSync(file,'utf8'));}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.pending));fs.renameSync(this.file+'.tmp',this.file);}
 async finish(order,onFill){
  if(!['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH'].includes(order?.status))throw Error('LIVE_ORDER_AWAITING_FINAL_RESULT');
  if(Number(order.executedQty)>0)await onFill(order,this.pending);
  this.pending=null;this.save();return order;
 }
 async recover(query,onFill){
  if(!this.pending)return null;if(this.busy)throw Error('LIVE_ORDER_LOCKED');this.busy=true;
  try{return await this.finish(await query(this.pending),onFill);}finally{this.busy=false;}
 }
 async submit(params,meta,post,onFill){
  if(this.busy||this.pending)throw Error('LIVE_ORDER_PENDING_RECONCILIATION');this.busy=true;
  try{
   this.pending={...meta,params:{...params,newClientOrderId:'wy-'+randomUUID().replaceAll('-','').slice(0,28)},at:new Date().toISOString()};this.save();
   let order;
   try{order=await post(this.pending.params);}
   catch(e){
    // Unknown/network errors retain intent. Explicit exchange rejections may safely clear it.
    if(e.status>=400&&e.status<500&&![-1006,-1007,-1001].includes(e.code)){this.pending=null;this.save();}
    throw e;
   }
   return await this.finish(order,onFill);
  }finally{this.busy=false;}
 }
}
