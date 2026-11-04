import {FUTURES_SHORT_POLICY} from './futures-short-policy.mjs';

// Operator-requested recovery only. This module never writes to the exchange.
export async function prepareShortHaltRelease(state,api,now=Date.now()){
 if(state?.version!==FUTURES_SHORT_POLICY.version||!['FUTURES_API_-2013','FUTURES_API_-2021'].includes(state.halt)||state.pending!==null||!state.positions||Array.isArray(state.positions)||Object.keys(state.positions).length||!Array.isArray(state.closed)||!Array.isArray(state.used)||!Number.isFinite(state.startedAt))throw Error('SHORT_RELEASE_JOURNAL_UNSAFE');
 const last=state.closed.at(-1);
 if(last?.reason!=='PROTECTION_FAILURE'||!last.symbol||!Number.isFinite(last.closedAt)||last.closedAt>now||!Array.isArray(last.algos)||!last.algos.length)throw Error('SHORT_RELEASE_INCIDENT_UNVERIFIED');
 const account=await api.get('/fapi/v2/account'),mode=await api.get('/fapi/v1/positionSide/dual');
 const usdt=account.assets?.find(a=>a.asset==='USDT');
 if(account.canTrade!==true||account.multiAssetsMargin!==false||mode.dualSidePosition!==false||!Array.isArray(account.positions)||account.positions.some(p=>p.positionAmt==null||!Number.isFinite(Number(p.positionAmt))||Number(p.positionAmt)!==0)||!usdt||!(Number(usdt.availableBalance)>=35))throw Error('SHORT_RELEASE_ACCOUNT_UNSAFE');
 for(const route of ['/fapi/v1/openOrders','/fapi/v1/openAlgoOrders']){
  const orders=await api.get(route);if(!Array.isArray(orders)||orders.length)throw Error('SHORT_RELEASE_OPEN_ORDERS');
 }
 for(const ref of last.algos){
  if(ref.status==='REJECTED')continue; // Definitive rejection means Binance never activated this identity.
  const order=await api.get('/fapi/v1/algoOrder',{clientAlgoId:ref.clientAlgoId});
  if(order.symbol!==last.symbol||order.clientAlgoId!==ref.clientAlgoId||order.side!=='BUY'||order.positionSide!=='BOTH'||order.orderType!==ref.kind||![true,'true'].includes(order.closePosition)||!['CANCELED','EXPIRED','FINISHED','REJECTED'].includes(order.algoStatus))throw Error('SHORT_RELEASE_PROTECTION_UNRESOLVED');
 }
 const next=structuredClone(state);
 next.haltReleases=[...(Array.isArray(state.haltReleases)?state.haltReleases:[]),{at:now,previousHalt:state.halt,lastClosedSymbol:last.symbol,lastClosedAt:last.closedAt}].slice(-100);
 next.resumedAt=now; // Signals from before this release cannot be replayed.
 next.halt=null;
 return next;
}
