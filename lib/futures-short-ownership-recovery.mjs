import {futuresFillPrice} from './futures-short-fill.mjs';
const fail=()=>{throw Error('SHORT_ROUNDING_RECOVERY_UNVERIFIED');};
export async function prepareRoundedFillRecovery(state,api,now=Date.now()){
 if(state.version!=='FUTURES_CHANNEL_SHORT_V1'||state.halt!=='FUTURES_POSITION_OWNERSHIP_CHANGED'||state.pending||!Number.isFinite(state.startedAt)||!Array.isArray(state.used)||!Array.isArray(state.closed))fail();
 const entries=Object.entries(state.positions||{});if(entries.length!==1)fail();
 const [symbol,p]=entries[0];
 if(p.symbol!==symbol||!(p.qty>0)||!(p.entryPrice>0)||p.lowPrice!==p.entryPrice||p.protectedAt||p.stopPrice||p.closeReason||!Array.isArray(p.algos)||p.algos.length||!Number.isSafeInteger(p.entryOrderId)||p.entryOrderId<=0)fail();
 const order=await api.get('/fapi/v1/order',{symbol,orderId:p.entryOrderId});
 if(order.symbol!==symbol||order.orderId!==p.entryOrderId||!/^lvs-[a-f0-9]{28}$/.test(order.clientOrderId||'')||(p.entryClientOrderId&&order.clientOrderId!==p.entryClientOrderId)||order.side!=='SELL'||order.positionSide!=='BOTH'||order.type!=='LIMIT'||order.timeInForce!=='IOC'||!['FILLED','EXPIRED','EXPIRED_IN_MATCH','CANCELED'].includes(order.status)||Number(order.executedQty)!==p.qty||Number(order.avgPrice)!==p.entryPrice)fail();
 const exact=futuresFillPrice(order);
 if(Math.abs(exact-p.entryPrice)<=Math.max(1e-8,p.entryPrice*1e-6)||p.qty*exact>35||!(p.targetPrice>0&&p.targetPrice<exact))fail();
 const account=await api.get('/fapi/v2/account'),mode=await api.get('/fapi/v1/positionSide/dual');
 if(account.canTrade!==true||account.multiAssetsMargin!==false||mode.dualSidePosition!==false||!Array.isArray(account.positions)||account.positions.some(x=>!Number.isFinite(Number(x.positionAmt))))fail();
 const actual=account.positions.filter(x=>Number(x.positionAmt)!==0);
 if(actual.length!==1)fail();
 const a=actual[0];
 if(a.symbol!==symbol||a.positionSide!=='BOTH'||-Number(a.positionAmt)!==p.qty||!(a.isolated===true||a.isolated==='true')||Number(a.leverage)!==1||!Number.isFinite(Number(a.entryPrice))||Math.abs(Number(a.entryPrice)-exact)>exact*1e-10)fail();
 const configs=await api.get('/fapi/v1/symbolConfig',{symbol}),c=Array.isArray(configs)&&configs.find(x=>x.symbol===symbol);
 if(!c||c.marginType!=='ISOLATED'||Number(c.leverage)!==1||!(c.isAutoAddMargin===false||c.isAutoAddMargin==='false'))fail();
 for(const route of ['/fapi/v1/openOrders','/fapi/v1/openAlgoOrders']){
  const orders=await api.get(route);if(!Array.isArray(orders)||orders.length)fail();
 }
 const next=structuredClone(state),position=next.positions[symbol];
 position.fillPriceRecovery={at:now,previousPrice:p.entryPrice,exchangePrice:Number(a.entryPrice),orderId:order.orderId};
 position.entryPrice=exact;position.lowPrice=exact;position.entryQuote=Number(order.cumQuote);position.entryClientOrderId=order.clientOrderId;position.entryPriceSource='CUM_QUOTE';
 next.halt=null;next.resumedAt=now;
 return next;
}
