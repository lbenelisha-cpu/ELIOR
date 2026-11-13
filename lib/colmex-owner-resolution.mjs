import {configuredLive,AUTO_POLICY} from './colmex-auto-policy.mjs';
import {pendingIntents} from './colmex-live-state.mjs';
import {reconcile,event} from './colmex-reconciliation.mjs';
import {accessError} from './colmex-device-access.mjs';
export const META_REVIEW_ID='aed2b9b1-1b98-45b8-9dd8-bd5ca0c640c9';
// A specific owner attestation, never an inference from an empty broker history.
export async function resolveOwnerConfirmedUnreceived({input,state,save,broker,env,now=Date.now}){
 if(!configuredLive(env))throw accessError('LIVE_NOT_ENABLED',403);
 if(input?.action!=='resolve_meta_unreceived'||input.reviewRequestId!==META_REVIEW_ID||input.confirmation!=='OWNER_CONFIRMS_BROKER_DID_NOT_RECEIVE_META'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId||''))throw accessError('INVALID_REQUEST');
 state.manualRequests??={};const previous=state.manualRequests[input.requestId];
 if(previous){if(previous.action!==input.action||previous.reviewRequestId!==input.reviewRequestId)throw accessError('REQUEST_ID_CONFLICT',409);return previous;}
 const verify=()=>{
 const intents=pendingIntents(state),i=intents[0];
 if(state.halt!=='UNRESOLVED_ORDER_REQUIRES_REVIEW'||intents.length!==1||i?.id!==META_REVIEW_ID||i.symbol!=='META'||i.kind!=='BUY'||i.manual!==true||!i.reviewRequired||i.orderId||i.acceptedAt||i.writeFailure?.code!=='WRITE_BROKER_ERROR'||i.writeFailure?.outcome!=='UNKNOWN'||state.manualRequests[i.id]?.status!=='PENDING'||state.positions.length)throw accessError('REVIEW_STATE_CHANGED',409);
 return i;
 };
 verify();const snap=await broker.snapshot(env.COLMEX_AUTO_ACCOUNT_ID),at=now();
 if(String(snap.account?.id)!==String(env.COLMEX_AUTO_ACCOUNT_ID)||snap.account?.type!=='live'||snap.historyAvailable!==true||!Array.isArray(snap.history)||!Array.isArray(snap.orders)||!Array.isArray(snap.positions)||snap.orders.length||snap.positions.length)throw accessError('REVIEW_ACCOUNT_NOT_EMPTY',409);
 reconcile(state,snap,at);const i=verify();
 if(i.reconciliation?.at!==at||i.reconciliation.matches!==0||i.reconciliation.relatedHistoryCount!==0)throw accessError('REVIEW_STATE_CHANGED',409);
 const next=structuredClone(state);
 next.ownerConfirmedMetaResolution={at,requestId:input.requestId,reviewRequestId:META_REVIEW_ID,outcome:'NOT_RECEIVED_OWNER_CONFIRMED',evidenceSource:'OWNER_STATEMENT',intent:structuredClone(i),brokerObservation:{at,accountId:snap.account.id,openOrders:0,openPositions:0,historyCount:snap.history.length,matches:0}};
 next.manualRequests[META_REVIEW_ID]={...next.manualRequests[META_REVIEW_ID],status:'NOT_RECEIVED_OWNER_CONFIRMED',completedAt:at};
 next.pending=null;next.riskPending=[];next.halt=null;
 for(const symbol of AUTO_POLICY.symbols)next.after[symbol]=Math.max(next.after[symbol]||0,at);
 next.after.META=Math.max(next.after.META||0,at);next.checks={};next.lastResult='OWNER_REVIEW_RESOLVED';
 event(next,at,'OWNER_CONFIRMED_NOT_RECEIVED','META');
 const result={requestId:input.requestId,reviewRequestId:META_REVIEW_ID,action:input.action,status:'OWNER_REVIEW_RESOLVED',symbol:'META',at};
 next.manualRequests[input.requestId]=result;
 await save(next);Object.assign(state,next);return result;
}
