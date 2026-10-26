import {positionRiskSettings} from './confirmed-risk-sizing.mjs';
import {num} from './colmex-auto-policy.mjs';
import {applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
import {pendingIntents} from './colmex-live-state.mjs';
export const same=(a,b)=>String(a)===String(b);
export function event(s,at,reason,symbol){s.events.push({at,reason,...(symbol?{symbol}:{})});s.events=s.events.slice(-200);}
const terminal=o=>['filled','cancelled','canceled','rejected','expired'].includes(String(o.status).toLowerCase());
const uniqueOrders=rows=>[...new Map(rows.filter(o=>o?.id).map(o=>[String(o.id),o])).values()];
export function closureEvidence(history,positionId,qty){
 if(!positionId||!(qty>0))return null;
 const rows=uniqueOrders(history||[]).filter(o=>same(o.positionId,positionId)&&String(o.side).toLowerCase()==='sell'&&terminal(o)&&num(o.filledQty)>0);
 if(!rows.length||rows.some(o=>!(num(o.avgPrice)>0)))return null;
 const filled=rows.reduce((n,o)=>n+num(o.filledQty),0);
 if(Math.abs(filled-qty)>1e-8)return null;
 return {exitPrice:rows.reduce((n,o)=>n+num(o.filledQty)*num(o.avgPrice),0)/filled,orderIds:rows.map(o=>String(o.id))};
}
function recordClosed(s,p,snapshot,now,reason){
 s.closedTrades??=[];
 if(s.closedTrades.some(t=>same(t.positionId,p.id)))return;
 const proof=closureEvidence(snapshot.history,p.id,p.qty);
 s.closedTrades.push({positionId:String(p.id),symbol:p.symbol,qty:p.qty,entryPrice:p.entryPrice,entryAt:p.entryAt,closedObservedAt:now,
  exitPrice:proof?.exitPrice??null,grossPnl:proof?(proof.exitPrice-p.entryPrice)*p.qty:null,netPnl:null,fees:null,
  accountingAdjusted:!!p.accountingAdjusted,accountingStatus:proof?'FEES_UNVERIFIED':'WAIT_EXECUTION_HISTORY',exitOrderIds:proof?.orderIds||[],reason,entryMode:p.entryMode||p.setup?.entryMode||'unknown',entryPolicyVersion:p.entryPolicyVersion||p.setup?.entryPolicyVersion||null,riskPlan:p.riskPlan||null,exitSettings:p.exitSettings||null,patternId:p.patternId||null});
}
export function reconcile(s,snapshot,now){
 const priorHalt=s.halt;let resolvedPrior=false,newHalt=false;
 const halt=reason=>{if(!s.halt||['UNRESOLVED_ORDER_REQUIRES_REVIEW','FILL_POSITION_REQUIRES_REVIEW'].includes(s.halt))s.halt=reason;newHalt=true;};
 const resolve=(intent,status,reason)=>{
  if(intent.manual&&s.manualRequests?.[intent.id])s.manualRequests[intent.id]={...s.manualRequests[intent.id],status,completedAt:now};
  if(s.pending===intent){s.pending=null;resolvedPrior=true;}
  else {s.riskPending=(s.riskPending||[]).filter(i=>i!==intent);if(priorHalt==='UNRESOLVED_ORDER_REQUIRES_REVIEW')resolvedPrior=true;}
  event(s,now,reason,intent.symbol);
 };
 for(const intent of pendingIntents(s)){
  if(intent.kind==='BUY'){
   if(snapshot.historyAvailable===false)continue;
   const matches=uniqueOrders([...(snapshot.orders||[]),...(snapshot.history||[])].filter(o=>intent.orderId?same(o.id,intent.orderId):o.userComment===intent.tag));
   if(matches.length>1){halt('AMBIGUOUS_ORDER');continue;}
   const order=matches[0];
   if(order&&terminal(order)){
    const filled=num(order.filledQty);
    if(filled===null||filled<0||filled>intent.order.qty+1e-8){halt('UNKNOWN_FILL_QUANTITY');continue;}
    if(filled===0)resolve(intent,'NO_FILL','BUY_FINISHED_WITHOUT_FILL');
    else{
     const positions=snapshot.positions.filter(p=>same(p.tradableInstrumentId,intent.order.tradableInstrumentId)&&(!order.positionId||same(p.id,order.positionId)));
     const price=num(order.avgPrice);
     if(!positions.length&&price>0&&closureEvidence(snapshot.history,order.positionId,filled)){
      recordClosed(s,{id:order.positionId,symbol:intent.symbol,qty:filled,entryPrice:price,entryAt:new Date(intent.at).toISOString(),patternId:intent.patternId,setup:intent.setup,riskPlan:intent.riskPlan,exitSettings:intent.exitSettings},snapshot,now,'CLOSED_BEFORE_FIRST_POLL');
      s.after[intent.symbol]=now;resolve(intent,'CLOSED','BUY_AND_CLOSE_CONFIRMED');
     }else if(positions.length!==1)halt('FILL_POSITION_REQUIRES_REVIEW');
     else{
      const p=positions[0],qty=num(p.qty);
      if(!(price>0&&qty>0)||Math.abs(qty-filled)>1e-8||String(p.side).toLowerCase()!=='buy'){halt('POSITION_OWNERSHIP_REQUIRES_REVIEW');continue;}
      if(!s.positions.some(x=>same(x.id,p.id)))s.positions.push(applyTrailingExitPolicy({id:String(p.id),symbol:intent.symbol,instrumentId:intent.order.tradableInstrumentId,qty,entryPrice:price,entryAt:new Date(intent.at).toISOString(),peakPrice:price,strategyId:'WYCKOFF_5M_V1',tickSize:intent.tickSize,patternId:intent.patternId,entryMode:intent.setup?.entryMode||'spring_rsi_live',setup:intent.setup,entryPolicyVersion:intent.setup?.entryPolicyVersion||null,riskPlan:intent.riskPlan||null},intent.exitSettings||s.settings||{}));
      resolve(intent,'FILLED','BUY_FILL_CONFIRMED');
     }
    }
   }
  }else{
   const p=snapshot.positions.find(p=>same(p.id,intent.positionId));
   if(!p){s.after[intent.symbol]=now;resolve(intent,'CLOSED',intent.kind==='CLOSE'?'CLOSE_CONFIRMED':'POSITION_CLOSED_AT_BROKER');}
   else if(intent.kind==='STOP'&&num(p.stopLoss)!==null&&num(p.stopLoss)>=intent.stopLoss-1e-8)resolve(intent,'CONFIRMED','STOP_CONFIRMED');
   else if(intent.kind==='PROTECTION'){
    const tp=intent.takeProfit===null?Object.hasOwn(p,'takeProfit')&&(p.takeProfit===null||p.takeProfit===''||num(p.takeProfit)===0):num(p.takeProfit)!==null&&Math.abs(num(p.takeProfit)-intent.takeProfit)<1e-8;
    if(num(p.stopLoss)!==null&&num(p.stopLoss)>=intent.stopLoss-1e-8&&tp)resolve(intent,'CONFIRMED','PROTECTION_CONFIRMED');
   }
  }
  if(pendingIntents(s).includes(intent)&&now-intent.at>600000){intent.reviewRequired=true;if(!newHalt)halt('UNRESOLVED_ORDER_REQUIRES_REVIEW');}
 }
 // Only conclusively resolved, order-related halts can recover automatically.
 // An ownership/schema halt always requires a separate review.
 if(resolvedPrior&&!newHalt&&['UNRESOLVED_ORDER_REQUIRES_REVIEW','FILL_POSITION_REQUIRES_REVIEW'].includes(priorHalt)&&s.halt===priorHalt&&!pendingIntents(s).some(i=>i.reviewRequired)){
  s.halt=null;event(s,now,'CONFIRMED_ORDER_RECOVERED');
 }
 for(const owned of [...s.positions]){
  const p=snapshot.positions.find(p=>same(p.id,owned.id));
  if(!p){recordClosed(s,owned,snapshot,now,'POSITION_CLOSED_AT_BROKER');s.positions=s.positions.filter(x=>x!==owned);s.after[owned.symbol]=now;event(s,now,'POSITION_CLOSED_AT_BROKER',owned.symbol);continue;}
  if(!same(p.tradableInstrumentId,owned.instrumentId)||String(p.side).toLowerCase()!=='buy'){s.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';continue;}
  if(num(p.qty)!==owned.qty){
   if(!(num(p.qty)>0&&num(p.avgPrice)>0)){s.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';continue;}
   const raised=num(p.qty)>owned.qty;owned.qty=num(p.qty);owned.accountingAdjusted=true;
   if(raised){owned.entryPrice=num(p.avgPrice);owned.peakPrice=owned.entryPrice;owned.profitFloorArmed=false;}
   applyTrailingExitPolicy(owned,positionRiskSettings(owned,s.settings||{}));event(s,now,'MANUAL_QUANTITY_RECONCILED',owned.symbol);
  }
  owned.brokerProtection={stopLoss:num(p.stopLoss),takeProfit:num(p.takeProfit),verifiedAt:now,status:num(p.stopLoss)>0?'STOP_PRESENT':'MISSING_STOP'};
 }
 for(const closed of s.closedTrades||[]){
  if(closed.exitPrice!==null)continue;
  const proof=closureEvidence(snapshot.history,closed.positionId,closed.qty);if(!proof)continue;
  Object.assign(closed,{exitPrice:proof.exitPrice,grossPnl:(proof.exitPrice-closed.entryPrice)*closed.qty,exitOrderIds:proof.orderIds,accountingStatus:'FEES_UNVERIFIED'});
 }
}
