import {pendingIntents,isQuarantined} from './colmex-live-state.mjs';
import {orderReviewOffer} from './colmex-manual-diagnostic.mjs';
import {configuredLive,num} from './colmex-auto-policy.mjs';
import {reconcile,event} from './colmex-reconciliation.mjs';
import {accessError} from './colmex-device-access.mjs';

// Preserve unknown exposure even after the owner elects to isolate its symbol.
export function reservedAccount(state,snapshot,extra=[]){
 const intents=[...new Map([...pendingIntents(state).filter(isQuarantined),...extra].map(i=>[i.id,i])).values()];
 const reservedUsd=intents.reduce((n,i)=>n+i.order.qty*i.order.price+5,0),cash=num(snapshot.state?.availableCash??snapshot.state?.cashBalance);
 return {cash:cash===null?null:cash-reservedUsd,reservedUsd,orders:[...snapshot.orders,...intents.map(i=>({side:'buy',tradableInstrumentId:i.order.tradableInstrumentId}))]};
}
export async function releaseOrderReview({input,state,save,broker,env,now=Date.now}){
 if(!configuredLive(env))throw accessError('LIVE_NOT_ENABLED',403);
 if(input?.action!=='release_review'||!['requestId','reviewRequestId'].every(k=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input[k]||'')))throw accessError('INVALID_REQUEST');
 state.manualRequests??={};const previous=state.manualRequests[input.requestId];
 if(previous){if(previous.action!==input.action||previous.reviewRequestId!==input.reviewRequestId)throw accessError('REQUEST_ID_CONFLICT',409);return previous;}
 if(Object.keys(state.manualRequests).length>=2000)throw accessError('MANUAL_HISTORY_FULL',409);
 const verify=()=>{const offer=orderReviewOffer(state);if(!offer.available||offer.reviewRequestId!==input.reviewRequestId)throw accessError('REVIEW_STATE_CHANGED',409);return offer;};
 verify();const snap=await broker.snapshot(env.COLMEX_AUTO_ACCOUNT_ID);
 reconcile(state,snap,now());await save(state);const offer=verify(),intents=pendingIntents(state),intent=intents.find(i=>i.id===input.reviewRequestId);
 if(snap.historyAvailable!==true||snap.positions.length||snap.orders.length||state.positions.length||intents.some(i=>i.reconciliation?.matches!==0))throw accessError('REVIEW_ACCOUNT_NOT_EMPTY',409);
 const at=now();intent.quarantinedAt=at;state.halt=null;
 const budget=reservedAccount(state,snap);
 const result={requestId:input.requestId,action:input.action,reviewRequestId:input.reviewRequestId,status:'REVIEW_RELEASED',symbol:intent.symbol,at,reservedUsd:offer.reservedUsd,totalReservedUsd:offer.totalReservedUsd,excludedSymbols:offer.excludedSymbols,reservedSlots:offer.reservedSlots,availableCashAfterReservations:budget.cash};
 state.manualRequests[input.requestId]=result;state.lastResult='ORDER_REVIEW_RELEASED';
 event(state,at,'ORDER_REVIEW_RELEASED',intent.symbol);await save(state);
 return result; // No broker mutation; a later scheduled cycle applies entry rules.
}
