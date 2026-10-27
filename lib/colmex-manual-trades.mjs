import {hasBlockingPending,pendingIntents} from './colmex-live-state.mjs';
import {reservedAccount} from './colmex-order-review.mjs';
import {AUTO_POLICY,configuredLive,planBuy,num} from './colmex-auto-policy.mjs';
import {reconcile} from './colmex-auto-runner.mjs';
import {accessError} from './colmex-device-access.mjs';
import {recordWriteFailure} from './colmex-write-outcome.mjs';
import {manualDiagnosticOffer,MANUAL_DIAGNOSTIC_MAX_USD} from './colmex-manual-diagnostic.mjs';
export function manualInput(input){
 if(!input||!['BUY','SELL'].includes(input.side)||!/^[A-Z][A-Z0-9.-]{0,14}$/.test(input.symbol||'')||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId||''))throw accessError('INVALID_REQUEST');
 if(input.side==='BUY'&&(typeof input.amountUsd!=='number'||!Number.isFinite(input.amountUsd)||input.amountUsd<=0||input.amountUsd>AUTO_POLICY.notionalUsd))throw accessError('INVALID_BUY_AMOUNT');
 if(input.diagnostic!==undefined&&typeof input.diagnostic!=='boolean')throw accessError('INVALID_REQUEST');
 if(input.diagnostic&&(input.side!=='BUY'||input.amountUsd>MANUAL_DIAGNOSTIC_MAX_USD||!/^[a-f0-9-]{36}$/i.test(input.reviewRequestId||'')))throw accessError('INVALID_DIAGNOSTIC_REQUEST');
 return {side:input.side,symbol:input.symbol,requestId:input.requestId,...(input.side==='BUY'?{amountUsd:input.amountUsd}:{}),...(input.diagnostic?{diagnostic:true,reviewRequestId:input.reviewRequestId}:{})};
}
export async function manualTrade({input,state:s,save,broker,env,now=Date.now,deadline=now()+24000}){
 const request=manualInput(input);
 if(!configuredLive(env))throw accessError('LIVE_NOT_ENABLED',403);
 s.manualRequests??={};const previous=s.manualRequests[request.requestId];
 if(previous){if(previous.side!==request.side||previous.symbol!==request.symbol||previous.amountUsd!==request.amountUsd||!!previous.diagnostic!==!!request.diagnostic||previous.reviewRequestId!==request.reviewRequestId)throw accessError('REQUEST_ID_CONFLICT',409);return {...previous,requestId:request.requestId};}
 if(Object.keys(s.manualRequests).length>=2000)throw accessError('MANUAL_HISTORY_FULL',409);
 const diagnosticGate=()=>{
  const offer=manualDiagnosticOffer(s);
  if(!offer.available)throw accessError(offer.reason,409);
  if(offer.reviewRequestId!==request.reviewRequestId)throw accessError('DIAGNOSTIC_STATE_CHANGED',409);
  if(offer.blockedSymbol===request.symbol)throw accessError('DIAGNOSTIC_SAME_INSTRUMENT',409);
  return pendingIntents(s)[0];
 };
 if(request.diagnostic)diagnosticGate();else if(s.halt)throw accessError('REQUIRES_REVIEW',409);
 const account=env.COLMEX_AUTO_ACCOUNT_ID,snap=await broker.snapshot(account);
 reconcile(s,snap,now());await save(s);
 const prior=request.diagnostic?diagnosticGate():null;
 if(!request.diagnostic&&(s.halt||hasBlockingPending(s)))throw accessError(s.halt?'REQUIRES_REVIEW':'TRADE_IN_PROGRESS',409);
 if(snap.historyAvailable===false)throw accessError('HISTORY_UNAVAILABLE',503);
 if(prior&&(snap.historyAvailable!==true||snap.positions.length||snap.orders.length||s.positions.length))throw accessError('DIAGNOSTIC_ACCOUNT_NOT_EMPTY',409);
 const instruments=await broker.instruments(account);
 if(!Array.isArray(instruments))throw accessError('INSTRUMENT_UNAVAILABLE');
 const candidates=instruments.filter(i=>i.name===request.symbol&&['EQUITY','ETF'].includes(i.type));
 if(candidates.length!==1||!/^\d+$/.test(String(candidates[0].tradableInstrumentId)))throw accessError('INSTRUMENT_UNAVAILABLE');
 const instrument=candidates[0],id=instrument.tradableInstrumentId;
 if(prior&&String(id)===String(prior.order.tradableInstrumentId))throw accessError('DIAGNOSTIC_SAME_INSTRUMENT',409);
 if(!prior&&pendingIntents(s).some(i=>i.symbol===request.symbol||i.order&&String(i.order.tradableInstrumentId)===String(id)))throw accessError('SYMBOL_ORDER_UNRESOLVED',409);
 let intent;
 if(request.side==='BUY'){
  if(snap.account.tradingRules?.supportSelfTrading!==true||snap.account.tradingRules?.supportBrackets!==true)throw accessError('BROKER_BRACKET_PERMISSION_REQUIRED');
  const details=await broker.details(id,account),quote=await broker.quote(id,account),receivedAt=now();
  const accountBudget=reservedAccount(s,snap,prior?[prior]:[]);
  const plan=planBuy({settings:s.settings||{},instrument,details,quote,receivedAt,now:now(),cash:accountBudget.cash,positions:snap.positions,orders:accountBudget.orders,amountUsd:request.amountUsd});
  if(plan.reason!=='READY')throw accessError(plan.reason);
  intent={kind:'BUY',symbol:request.symbol,patternId:'manual:'+request.requestId,tickSize:details.tickSize,order:plan.order,exitSettings:plan.exitSettings};
 }else{
  const positions=snap.positions.filter(p=>String(p.tradableInstrumentId)===String(id));
  if(positions.length!==1||String(positions[0].side).toLowerCase()!=='buy'||!(num(positions[0].qty)>0))throw accessError('NO_UNIQUE_LONG_POSITION');
  if(snap.orders.some(o=>String(o.tradableInstrumentId)===String(id)))throw accessError('EXISTING_POSITION_OR_ORDER');
  intent={kind:'CLOSE',symbol:request.symbol,positionId:String(positions[0].id),qty:num(positions[0].qty)};
 }
 if(now()>deadline-8000)throw accessError('CYCLE_DEADLINE',503);
 const at=now(),pending={id:request.requestId,at,...intent,manual:true,tag:'levi-auto:'+request.requestId};
 if(s.pending)(s.riskPending??=[]).push(pending);else s.pending=pending;
 // A manual action also invalidates older automatic entry signals for this symbol.
 s.after[request.symbol]=at;if(intent.kind==='BUY')s.used.push(intent.patternId);
 s.manualRequests[request.requestId]={...request,status:'PENDING',at};
 s.events.push({at,reason:'MANUAL_SUBMIT_'+request.side,symbol:request.symbol});s.events=s.events.slice(-200);
 await save(s); // The shared CAS lease and durable intent precede every broker mutation.
 try{const result=await broker.write(account,pending);if(result.orderId)pending.orderId=String(result.orderId);pending.acceptedAt=now();s.manualRequests[request.requestId].acknowledged=true;}
 catch(error){const {failure,resolved}=recordWriteFailure(s,pending,error,now());s.events.push({at:now(),reason:resolved?failure.code:'WRITE_OUTCOME_PENDING_RECONCILIATION',symbol:request.symbol});}
 await save(s);return {...s.manualRequests[request.requestId],requestId:request.requestId};
}
