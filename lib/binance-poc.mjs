import fs from 'node:fs';
import path from 'node:path';

export const POC_VERSION=1;
export const POC_MAX_DEVIATION_PCT=.15;
const active=new Set(['WAITING','EXECUTING','UNKNOWN']);
const statuses=new Set([...active,'FILLED','NO_FILL','FAILED','CANCELLED','EXPIRED','MISSED']);
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function pocInput(input,{maxLongUsdt=400,maxShortUsdt=Number.MAX_VALUE}={}){
 if(!input||input.mode!=='live'||input.confirmed!==true)throw Error('POC_LIVE_CONFIRMATION_REQUIRED');
 const {requestId,symbol,side,direction,poc,quoteUsdt,expiresHours}=input;
 if(typeof requestId!=='string'||!/^poc-[a-zA-Z0-9-]{16,64}$/.test(requestId))throw Error('POC_INVALID_ID');
 if(typeof symbol!=='string'||! /^[A-Z0-9]{2,24}USDT$/.test(symbol))throw Error('POC_INVALID_SYMBOL');
 if(!['LONG','SHORT'].includes(side)||!['ABOVE','BELOW'].includes(direction))throw Error('POC_INVALID_DIRECTION');
 if(!positive(poc)||!positive(quoteUsdt)||quoteUsdt<5||quoteUsdt>(side==='SHORT'?maxShortUsdt:maxLongUsdt))throw Error('POC_INVALID_PRICE_OR_AMOUNT');
 if(![1,4,12,24].includes(expiresHours))throw Error('POC_INVALID_EXPIRY');
 return {requestId,symbol,side,direction,poc,quoteUsdt,expiresHours};
}
export function pocQuote(quote,now){
 if(!positive(quote?.price)||!Number.isFinite(quote?.at)||quote.at>now+1000||now-quote.at>10000)throw Error('POC_WAIT_FRESH_PRICE');
 return quote.price;
}
export function pocReached(row,price){return row.direction==='ABOVE'?price>=row.poc:price<=row.poc;}
export function pocWithinLimit(row,price){return Math.abs(price/row.poc-1)*100<=POC_MAX_DEVIATION_PCT+1e-10;}
function atomicSave(file,state){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const fd=fs.openSync(file+'.tmp','w',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(file+'.tmp',file);
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}

// Once EXECUTING is durable, only reconciliation is allowed, even after a crash
// before the exchange call. Missing evidence never authorizes a second order.
export class BinancePoc {
 constructor({file,quote,execute,reconcile,control,settings,validate=async()=>{},now=Date.now,save=atomicSave,maxLongUsdt=400,shortAllocation=()=>({maxOrderUsdt:0})}){
  Object.assign(this,{file,quote,execute,reconcile,control,settings,validate,now,saveImpl:save,maxLongUsdt,shortAllocation});
  this.state={version:POC_VERSION,rows:[]};this.busy=false;this.creating=false;this.checkedAt=null;
  try{
   if(fs.existsSync(file))this.state=JSON.parse(fs.readFileSync(file,'utf8'));
   if(this.state.version!==POC_VERSION||!Array.isArray(this.state.rows)||this.state.rows.length>500)throw Error('schema');
   const ids=new Set();
   for(const row of this.state.rows){
    pocInput({...row,mode:'live',confirmed:true},{maxLongUsdt});
    if(ids.has(row.requestId)||!statuses.has(row.status)||!Number.isFinite(row.createdAt)||row.expiresAt!==row.createdAt+row.expiresHours*3600000)throw Error('row');
    ids.add(row.requestId);
   }
  }catch{this.fatal='POC_JOURNAL_UNREADABLE';}
 }
 save(){if(this.fatal)throw Error(this.fatal);try{this.saveImpl(this.file,this.state);}catch{this.fatal='POC_JOURNAL_WRITE_FAILED';throw Error(this.fatal);}}
 snapshot(){return {ok:!this.fatal,version:POC_VERSION,error:this.fatal||null,checkedAt:this.checkedAt,control:this.control(),maxLongUsdt:this.maxLongUsdt,maxShortUsdt:this.shortAllocation().maxOrderUsdt,maxDeviationPct:POC_MAX_DEVIATION_PCT,settings:this.settings(),rows:this.fatal?[]:structuredClone(this.state.rows).reverse()};}
 async create(input){
  if(this.fatal)throw Error(this.fatal);
  const intent=pocInput(input,{maxLongUsdt:this.maxLongUsdt});
  const old=this.state.rows.find(r=>r.requestId===intent.requestId);
  if(old){if(JSON.stringify(pocInput({...old,mode:'live',confirmed:true},{maxLongUsdt:this.maxLongUsdt}))!==JSON.stringify(intent))throw Error('POC_ID_CONFLICT');return structuredClone(old);}
  if(this.creating)throw Error('POC_CREATE_BUSY');
  this.creating=true;
  try{
   if(!this.control().allowEntries)throw Error('POC_TRADING_PAUSED');
   if(this.state.rows.length>=500||this.state.rows.filter(r=>active.has(r.status)).length>=10)throw Error('POC_LIMIT_REACHED');
   if(this.state.rows.some(r=>active.has(r.status)&&r.symbol===intent.symbol&&r.side===intent.side))throw Error('POC_ALREADY_PENDING');
   await this.validate(intent);
   const q=await this.quote(intent),price=pocQuote(q,this.now());
   if(pocReached(intent,price))throw Error('POC_ALREADY_REACHED');
   if(!this.control().allowEntries)throw Error('POC_TRADING_PAUSED');
   const row={...intent,createdAt:this.now(),expiresAt:this.now()+intent.expiresHours*3600000,status:'WAITING',reason:null,initialPrice:price};
   // Use exactly the same origin for the persisted expiration.
   row.expiresAt=row.createdAt+intent.expiresHours*3600000;
   this.state.rows.push(row);this.save();return structuredClone(row);
  }finally{this.creating=false;}
 }
 reserved(symbol,side){return Boolean(this.fatal)||this.state.rows.some(r=>r.symbol===symbol&&r.side===side&&active.has(r.status));}
 cancel(id){
  if(this.fatal)throw Error(this.fatal);
  const row=this.state.rows.find(r=>r.requestId===id);if(!row)throw Error('POC_NOT_FOUND');
  if(row.status==='CANCELLED')return structuredClone(row);
  if(row.status!=='WAITING')throw Error('POC_ALREADY_DISPATCHED');
  row.status='CANCELLED';row.updatedAt=this.now();this.save();return structuredClone(row);
 }
 cancelWaiting(reason='POC_STOP_ALL'){
  if(this.fatal) return;
  for(const row of this.state.rows)if(row.status==='WAITING'){row.status='CANCELLED';row.reason=reason;row.updatedAt=this.now();}
  this.save();
 }
 async finalGuard(row,settings){
  if(this.fatal||row.status!=='EXECUTING'||!this.control().allowEntries)throw Error('POC_TRADING_PAUSED');
  const q=await this.quote(row),price=pocQuote(q,this.now());
  if(this.fatal||row.status!=='EXECUTING'||!this.control().allowEntries)throw Error('POC_TRADING_PAUSED');
  if(this.now()>=row.expiresAt)throw Error('POC_EXPIRED');
  if(JSON.stringify(settings)!==JSON.stringify(this.settings()))throw Error('POC_SETTINGS_CHANGED');
  if(!pocReached(row,price)||!pocWithinLimit(row,price))throw Error('POC_PRICE_MOVED');
  return q;
 }
 finish(row,result){
  if(result?.deferred===true){row.status='WAITING';row.reason=result.error||'POC_EXECUTION_BUSY';}
  else if(!result||result.uncertain){row.status='UNKNOWN';row.reason=result?.error||'POC_OUTCOME_UNKNOWN';}
  else if(result.ok&&Number(result.order?.executedQty)>0){row.status='FILLED';row.order=result.order;row.reason=result.order.protectionWarning||null;}
  else {row.status=result.ok?'NO_FILL':'FAILED';row.reason=result.error||'POC_NO_FILL';}
  row.updatedAt=this.now();this.save();
 }
 async tick(){
  if(this.busy||this.fatal)return;this.busy=true;
  try{
   for(const row of this.state.rows){
    if(this.fatal)break;
    if(['EXECUTING','UNKNOWN'].includes(row.status)){
     try{const result=await this.reconcile(row);if(result)this.finish(row,result);else row.status='UNKNOWN';}catch{row.status='UNKNOWN';}
     continue;
    }
    if(row.status!=='WAITING')continue;
    if(this.now()>=row.expiresAt){row.status='EXPIRED';row.updatedAt=this.now();this.save();continue;}
    if(!this.control().allowEntries){row.reason='POC_TRADING_PAUSED';continue;}
    try{
     const q=await this.quote(row),price=pocQuote(q,this.now());
     // Cancellation, pause and expiry can occur during a network read.
     if(row.status!=='WAITING'||!this.control().allowEntries)continue;
     if(this.now()>=row.expiresAt){row.status='EXPIRED';this.save();continue;}
     row.lastPrice=price;row.priceAt=q.at;row.reason=null;
     if(!pocReached(row,price))continue;
     if(!pocWithinLimit(row,price)){row.status='MISSED';row.reason='POC_PRICE_GAP';this.save();continue;}
     row.exitSettings=structuredClone(this.settings());row.status='EXECUTING';row.triggeredAt=this.now();this.save();
     const result=await this.execute(row,()=>this.finalGuard(row,row.exitSettings));
     this.finish(row,result);
    }catch(error){
     if(this.fatal)break;
     if(row.status==='EXECUTING'){row.status='UNKNOWN';row.reason='POC_OUTCOME_UNKNOWN';this.save();}
     else row.reason=error.message;
    }
   }
  }finally{this.checkedAt=this.now();this.busy=false;}
 }
}
