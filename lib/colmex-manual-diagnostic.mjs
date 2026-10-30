import {pendingIntents,isQuarantined} from './colmex-live-state.mjs';
export const MANUAL_DIAGNOSTIC_MAX_USD=200;
// An explicit user submission gets one independent attempt. This never clears
// an old intent, changes the automatic entry gate, or retries a broker write.
function reviewOffer(state,intents){
 const prior=intents[0];
 const base={maxAmountUsd:MANUAL_DIAGNOSTIC_MAX_USD,available:false,reviewRequestId:null,blockedSymbol:null};
 if(!state||state.halt!=='UNRESOLVED_ORDER_REQUIRES_REVIEW'||intents.length!==1||prior.kind!=='BUY'||!prior.reviewRequired||prior.manual||prior.orderId||prior.acceptedAt||!Number.isFinite(prior.order?.price)||prior.order.price<=0||!Number.isFinite(prior.order?.qty)||prior.order.qty<=0)
  return {...base,reason:'DIAGNOSTIC_STATE_CHANGED'};
 return {...base,reviewRequestId:prior.id,blockedSymbol:prior.symbol,reservedUsd:prior.order.qty*prior.order.price+5,available:true,reason:null};
}
// Diagnostic purchases retain their original single-intent gate.
export function legacyOrderReviewOffer(state){return reviewOffer(state,state?pendingIntents(state):[]);}
// Only one unresolved, non-isolated BUY can be selected for owner review.
// Existing quarantines remain reserved and cannot hide another blocking action.
export function orderReviewOffer(state){
 const intents=state?pendingIntents(state):[],offer=reviewOffer(state,intents.filter(i=>!isQuarantined(i)));
 if(!offer.available)return offer;
 const isolated=intents.filter(isQuarantined),existingReservedUsd=isolated.reduce((sum,i)=>sum+i.order.qty*i.order.price+5,0);
 return {...offer,existingReservedUsd,totalReservedUsd:existingReservedUsd+offer.reservedUsd,reservedSlots:isolated.length+1,excludedSymbols:[...new Set([...isolated.map(i=>i.symbol),offer.blockedSymbol])]};
}
export function manualDiagnosticOffer(state){
 const offer=legacyOrderReviewOffer(state);
 if(offer.available&&Object.values(state.manualRequests||{}).some(r=>r.diagnostic&&r.reviewRequestId===offer.reviewRequestId))return {...offer,available:false,reason:'DIAGNOSTIC_ALREADY_USED'};
 return offer;
}
