import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const terminal=s=>['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH'].includes(s);
function decimal(n,step){
 const [coefficient,exponent='0']=Number(step).toString().split('e');
 const places=Math.max(0,(coefficient.split('.')[1]?.length||0)-Number(exponent));
 if(!(Number(step)>0)||places>12)throw Error('NATIVE_PROTECTION_FILTER_MISSING');
 // Preserve the exchange tick/lot precision; fixed 12 places exposes binary
 // floating-point tails for large prices and Binance rejects the trigger.
 const value=Number(n).toFixed(places);
 return value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;
}
const identity=prefix=>prefix+randomUUID().replaceAll('-','').slice(0,26);
function round(value,step,up=false){const n=Number(step);if(!(n>0))throw Error('NATIVE_PROTECTION_FILTER_MISSING');return Number(((up?Math.ceil:Math.floor)(value/n+(up?-1e-9:1e-9))*n).toFixed(12));}
export function nativeProtectionPlan(symbol,p,price,info,free){
 if(!(p?.entryPrice>0&&p.qty>0&&price>0)||!Number.isFinite(price))throw Error('NATIVE_PROTECTION_POSITION_INVALID');
 if(info?.symbol!==symbol||info.status!=='TRADING'||info.ocoAllowed!==true||!info.orderTypes?.includes('TAKE_PROFIT')||!info.orderTypes?.includes('STOP_LOSS'))throw Error('NATIVE_PROTECTION_NOT_SUPPORTED');
 const lot=info.filters?.find(f=>f.filterType==='LOT_SIZE'),tick=info.filters?.find(f=>f.filterType==='PRICE_FILTER');
 const quantity=round(Math.min(p.qty,free),lot?.stepSize),stop=round(p.effectiveStopPrice,tick?.tickSize,true),target=round(p.entryPrice*(1+(p.takeProfitPct??50)/100),tick?.tickSize,true);
 if(quantity<round(p.qty,lot?.stepSize))throw Error('NATIVE_PROTECTION_QUANTITY_LOCKED_ELSEWHERE');
 if(!(quantity>0&&quantity>=Number(lot.minQty)&&quantity<=Number(lot.maxQty)&&stop>0&&target>stop))throw Error('NATIVE_PROTECTION_INVALID_LEVELS');
 for(const v of [stop,target])if(v<Number(tick.minPrice)||Number(tick.maxPrice)>0&&v>Number(tick.maxPrice))throw Error('NATIVE_PROTECTION_PRICE_FILTER');
 const minimum=Math.max(0,...info.filters.filter(f=>['MIN_NOTIONAL','NOTIONAL'].includes(f.filterType)).map(f=>Number(f.minNotional)||0));
 if(quantity*Math.min(stop,price)<minimum)throw Error('NATIVE_PROTECTION_BELOW_MINIMUM');
 return {quantity:decimal(quantity,lot.stepSize),stop,target,params:{symbol,side:'SELL',quantity:decimal(quantity,lot.stepSize),aboveType:'TAKE_PROFIT',aboveStopPrice:decimal(target,tick.tickSize),belowType:'STOP_LOSS',belowStopPrice:decimal(stop,tick.tickSize),newOrderRespType:'FULL'}};
}
// All calls run inside the server's existing execution lock. Persist identities
// BEFORE writes. Unknown create/cancel outcomes are queried, never resubmitted.
export class BinanceNativeProtection{
 constructor(file,api){this.file=file;this.api=api;this.rows={};if(fs.existsSync(file))this.rows=JSON.parse(fs.readFileSync(file,'utf8'));for(const r of Object.values(this.rows))r.verifiedAt=0;}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.rows),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 uncertain(){return Object.values(this.rows).some(r=>['CREATING','CANCELING'].includes(r.phase));}
 async reconcile(symbol){
  const r=this.rows[symbol];if(!r)return null;if(r.phase==='REJECTED')return r;
  const list=await this.api.get('/api/v3/orderList',{origClientOrderId:r.params.listClientOrderId});
  if(list.symbol!==symbol||list.listClientOrderId!==r.params.listClientOrderId)throw Error('NATIVE_PROTECTION_IDENTITY_MISMATCH');
  // Query both children even after ALL_DONE: the list response alone has no fills.
  const children=[];
  for(const clientId of [r.params.aboveClientOrderId,r.params.belowClientOrderId]){
   const o=await this.api.get('/api/v3/order',{symbol,origClientOrderId:clientId});
   if(o.symbol!==symbol||o.side!=='SELL'||o.clientOrderId!==clientId)throw Error('NATIVE_PROTECTION_CHILD_MISMATCH');
   children.push(o);
   if(terminal(o.status)&&Number(o.executedQty)>0)await this.api.onFill(o,{params:{symbol,side:'SELL'},at:new Date(Number(o.updateTime||o.transactTime)||Date.now()).toISOString(),reason:clientId===r.params.aboveClientOrderId?'BROKER_TAKE_PROFIT_'+(r.takeProfitPct??50)+'_PERCENT':'BROKER_STOP_LOSS',meta:{dustThresholdUsdt:r.dustThresholdUsdt}});
  }
  if(children.every(o=>terminal(o.status))){delete this.rows[symbol];this.save();return null;}
  r.hasUnsettledFill=children.some(o=>!terminal(o.status)&&Number(o.executedQty)>0);
  r.verifiedAt=Date.now();
  if(r.phase==='CREATING'){r.phase='ACTIVE';r.confirmedAt=Date.now();this.save();}
  return r;
 }
 async release(symbol){
  let r=await this.reconcile(symbol);if(!r)return;
  if(r.phase==='REJECTED'){delete this.rows[symbol];this.save();return;}
  // Cancellation is idempotent for this exact persisted list identity. After
  // querying it, retry only its cancellation; never create a replacement early.
  r.phase='CANCELING';this.save();
  await this.api.del('/api/v3/orderList',{symbol,listClientOrderId:r.params.listClientOrderId});
  if(await this.reconcile(symbol))throw Error('NATIVE_PROTECTION_CANCEL_PENDING');
 }
 async sync(symbol,position,price){
  let r=await this.reconcile(symbol);
  // A native fill can change ownership while reconciliation is running.
  let p=this.api.position(symbol);
  if(!p){if(r)await this.release(symbol);return;}
  if(!position||p.entryAt!==position.entryAt)throw Error('NATIVE_PROTECTION_ENTRY_CHANGED');
  if(r&&r.entryAt!==p.entryAt){await this.release(symbol);r=null;p=this.api.position(symbol);if(!p)return;}
  if(r?.phase==='CANCELING'){await this.release(symbol);r=null;p=this.api.position(symbol);if(!p)return;}
  if(r?.phase==='REJECTED'&&Date.now()-r.updatedAt<30000)return;
  if(r&&r.phase!=='REJECTED'&&r.phase!=='ACTIVE')throw Error('NATIVE_PROTECTION_PENDING');
  if(!(price>0))return; // Reconcile even without a fresh quote; never create on stale data.
  if(r?.phase==='ACTIVE'&&r.quantityStep>0&&Number(p.effectiveStopPrice)<=r.stop&&Number(p.qty)>=Number(r.params.quantity)&&Number(p.qty)-Number(r.params.quantity)<r.quantityStep&&Math.abs(r.target-p.entryPrice*(1+(p.takeProfitPct??50)/100))<Math.max(Number.MIN_VALUE,Math.abs(r.target)*1e-10))return;
  if(r?.phase==='ACTIVE'&&Date.now()-r.updatedAt<5000)return;
  // At the exact +4% activation, retain the old stop until it is below market.
  if(Number(p.effectiveStopPrice)>=price)return;
  const info=await this.api.info(symbol);
  if(r?.phase==='ACTIVE'){
   r.quantityStep=Number(info.filters?.find(f=>f.filterType==='LOT_SIZE')?.stepSize);
   p.effectiveStopPrice=Math.max(Number(p.effectiveStopPrice),r.stop);
   await this.api.persistFloor(symbol,p);
   const tick=Number(info.filters?.find(f=>f.filterType==='PRICE_FILTER')?.tickSize);
   if(round(p.entryPrice*(1+(p.takeProfitPct??50)/100),tick,true)===r.target&&round(p.effectiveStopPrice,tick,true)<=r.stop&&Math.abs(Number(r.params.quantity)-p.qty)<Number(info.filters.find(f=>f.filterType==='LOT_SIZE').stepSize))return;
   // Fail before cancellation when data, quantity, or the new bracket is invalid.
   const beforePrice=this.api.price?this.api.price(symbol):price;
   const beforeFree=await this.api.free(symbol);
   const beforePlan=nativeProtectionPlan(symbol,p,beforePrice,info,beforeFree+Number(r.params.quantity));
   if(!(beforePlan.stop<beforePrice&&beforePrice<beforePlan.target))return;
   await this.release(symbol);p=this.api.position(symbol);if(!p)return;
  }
  const free=await this.api.free(symbol);
  const freshPrice=this.api.price?this.api.price(symbol):price;
  const plan=nativeProtectionPlan(symbol,p,freshPrice,info,free);
  if(!(plan.stop<freshPrice&&freshPrice<plan.target))return;
  const params={...plan.params,listClientOrderId:identity('lv-l-'),aboveClientOrderId:identity('lv-t-'),belowClientOrderId:identity('lv-s-')};
  r={phase:'CREATING',takeProfitPct:p.takeProfitPct??50,entryAt:p.entryAt,params,stop:plan.stop,target:plan.target,quantityStep:Number(info.filters.find(f=>f.filterType==='LOT_SIZE')?.stepSize),updatedAt:Date.now(),dustThresholdUsdt:Math.max(5,...info.filters.filter(f=>['MIN_NOTIONAL','NOTIONAL'].includes(f.filterType)).map(f=>Number(f.minNotional)||0))};
  this.rows[symbol]=r;this.save();
  try{await this.api.post('/api/v3/orderList/oco',params);}
  catch(e){
   if(e.status>=400&&e.status<500&&![-1006,-1007,-1001].includes(e.code)){r.phase='REJECTED';r.error=e.message;this.save();}
   throw e;
  }
  await this.reconcile(symbol);
 }
}
