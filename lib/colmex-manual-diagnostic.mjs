import {pendingIntents} from './colmex-live-state.mjs';
export const MANUAL_DIAGNOSTIC_MAX_USD=200;
// An explicit user submission gets one independent attempt. This never clears
// an old intent, changes the automatic entry gate, or retries a broker write.
export function manualDiagnosticOffer(state){
 const intents=state?pendingIntents(state):[],prior=intents[0];
 const base={maxAmountUsd:MANUAL_DIAGNOSTIC_MAX_USD,available:false,reviewRequestId:null,blockedSymbol:null};
 if(!state||state.halt!=='UNRESOLVED_ORDER_REQUIRES_REVIEW'||intents.length!==1||prior.kind!=='BUY'||!prior.reviewRequired||prior.manual||prior.orderId||prior.acceptedAt||!Number.isFinite(prior.order?.price)||prior.order.price<=0||!Number.isFinite(prior.order?.qty)||prior.order.qty<=0)
  return {...base,reason:'DIAGNOSTIC_STATE_CHANGED'};
 const result={...base,reviewRequestId:prior.id,blockedSymbol:prior.symbol};
 if(Object.values(state.manualRequests||{}).some(r=>r.diagnostic&&r.reviewRequestId===prior.id))return {...result,reason:'DIAGNOSTIC_ALREADY_USED'};
 return {...result,available:true,reason:null};
}
