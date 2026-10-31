import {validateChannelProfitEntry} from './channel-profit-protection.mjs';
import {channelEntryConfig,channelEntry,assertChannelEntry,assertChannelSubmission} from './channel-primary-entry.mjs';
import {observeEntryComparison,recordEntryBlocker} from './entry-method-comparison.mjs';
import {colmexBreakoutConfig,colmexBreakoutEntry,assertColmexBreakout} from './colmex-independent-entry.mjs';
import {assertQualityEntry} from './confirmed-entry-quality.mjs';
import {positionRiskSettings} from './confirmed-risk-sizing.mjs';
import {recordStrategyObservation} from './strategy-followup.mjs';
import {recordWriteFailure} from './colmex-write-outcome.mjs';
import {runPreparationCycle} from './colmex-preparation.mjs';
import {rsiSnapshot} from './rsi-screener.mjs';
import {randomUUID} from 'node:crypto';
import {AUTO_POLICY,configuredLive,planBuy,entrySignal,brokerBars,contiguousHistory,ticks,num} from './colmex-auto-policy.mjs';
import {binancePositionExit} from './binance-position-exit.mjs';
import {TRAILING_EXIT_POLICY,applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
import {regularSession} from './colmex-market-hours.mjs';
import {TRADE_SETTINGS_VERSION} from './trade-settings.mjs';
import {assertEarlyWaveEntry} from './early-wave-entry.mjs';
export function initialState(now){return {version:1,settingsPolicyVersion:TRADE_SETTINGS_VERSION,createdAt:now,cursor:0,positions:[],pending:null,used:[],after:{},events:[],checks:{},lastCycleAt:null,halt:null};}
export {reconcile} from './colmex-reconciliation.mjs';
import {reconcile,event,same} from './colmex-reconciliation.mjs';
import {hasPending,hasBlockingPending,pendingIntents} from './colmex-live-state.mjs';
import {reservedAccount} from './colmex-order-review.mjs';
export async function runCycle({state:s,save,broker,env,now=Date.now,deadline=now()+24000,signal=entrySignal,audit=()=>{}}){
 if(!configuredLive(env))return {reason:'DISABLED'};
 if(s.lastCycleAt&&now()-s.lastCycleAt<55000)return {reason:'CYCLE_COOLDOWN'};
 const account=env.COLMEX_AUTO_ACCOUNT_ID;
 const breakoutConfig=colmexBreakoutConfig(env);
 const channelPrimary=channelEntryConfig(env,'COLMEX');
 const observe=record=>{try{audit({at:now(),...record});}catch{/* Analytical logging cannot block trading. */}};
 // Closed, recently verified empty accounts need no repeated six-endpoint read.
 // Pending intents, owned positions, halts and market opening always bypass this.
 if(!regularSession(now())&&!hasPending(s)&&!s.halt&&s.positions.length===0&&
    Number.isFinite(s.closedEmptySnapshotAt)&&now()>=s.closedEmptySnapshotAt&&now()-s.closedEmptySnapshotAt<5*60000){
  s.lastCycleAt=now();
  return runPreparationCycle({state:s,save,broker,account,now,deadline});
 }
 s.closedEmptySnapshotAt=null;
 s.stage='ACCOUNT_SNAPSHOT';
 const snap=await broker.snapshot(account,{includeHistory:hasPending(s)||s.positions.length>0||(s.closedTrades||[]).some(t=>t.exitPrice===null)});s.lastCycleAt=now();
 const priorPositionDetails=new Map(s.positions.map(p=>[String(p.id),structuredClone(p)]));
 const priorPositions=new Set(s.positions.map(p=>String(p.id))),priorClosed=new Set((s.closedTrades||[]).map(p=>String(p.positionId)));
 reconcile(s,snap,now());s.lastBrokerSnapshotAt=now();
 for(const p of s.positions)if(!priorPositions.has(String(p.id)))observe({symbol:p.symbol,stage:'BROKER_FILL',action:'ENTER',reason:'BUY_FILL_CONFIRMED',origin:'BROKER',price:p.entryPrice,priceAt:null,reference:'entry:'+p.id});
 for(const p of s.closedTrades||[])if(!priorClosed.has(String(p.positionId)))observe({symbol:p.symbol,stage:p.exitPrice>0?'BROKER_FILL':'CLOSE_OBSERVED',action:'EXIT',reason:p.reason,origin:'BROKER',price:p.exitPrice,priceAt:null,reference:'exit:'+p.positionId,position:priorPositionDetails.get(String(p.positionId))||p});
 if(!regularSession(now())&&!hasPending(s)&&!s.halt&&!s.positions.length&&!snap.positions.length&&!snap.orders.length)s.closedEmptySnapshotAt=now();
 await save(s);
 const earlyEntryError=intent=>{
  if(intent.kind!=='BUY')return null;
  if(channelPrimary.requested&&intent.setup?.entryMode!=='channel_breakout')return 'CHANNEL_PRIMARY_REQUIRED';
  if(intent.setup?.entryMode==='channel_breakout'){
   if(!channelPrimary.enabled)return channelPrimary.error||'CHANNEL_PRIMARY_DISABLED';
   if(now()-intent.quoteReceivedAt>10000||intent.quoteReceivedAt>now())return 'WAIT_BROKER_QUOTE';
   try{assertChannelEntry(intent.setup,intent.entryBid,now(),intent.entryLiveBar);return null;}catch(e){return e.message;}
  }
  if(intent.setup?.entryMode==='independent_breakout'){
   if(!breakoutConfig.enabled)return 'INDEPENDENT_ENTRY_DISABLED';
   if(now()-intent.quoteReceivedAt>10000||intent.quoteReceivedAt>now())return 'WAIT_BROKER_QUOTE';
   try{assertColmexBreakout(intent.setup,intent.entryBid,now(),intent.entryLiveBar);return null;}catch(e){return e.message;}
  }
  if(intent.setup?.entryPolicyVersion){
   if(now()-intent.quoteReceivedAt>10000||intent.quoteReceivedAt>now())return 'WAIT_BROKER_QUOTE';
   try{assertQualityEntry(intent.setup,intent.entryBid,now(),intent.entryLiveBar);return null;}catch(e){return e.message;}
  }
  if(intent.setup?.entryMode!=='early_wave_live')return null;
  if(now()-intent.quoteReceivedAt>10000||intent.quoteReceivedAt>now())return 'WAIT_BROKER_QUOTE';
  try{assertEarlyWaveEntry(intent.setup,intent.entryBid,now(),intent.entryLiveBar);return null;}catch(e){return e.message;}
 };
 const submit=async intent=>{
  if(now()>deadline-8000)return {reason:'CYCLE_DEADLINE'};
  if(intent.kind==='BUY'&&['independent_breakout','channel_breakout'].includes(intent.setup?.entryMode)){
   const [fresh,history]=await Promise.all([broker.snapshot(account),broker.history(intent.order.tradableInstrumentId,account)]);
   reconcile(s,fresh,now());await save(s);
   if(s.halt||hasBlockingPending(s)||fresh.historyAvailable!==true)return {reason:s.halt||'ACCOUNT_RECHECK_REQUIRED'};
   if(fresh.account?.tradingRules?.supportSelfTrading!==true||fresh.account?.tradingRules?.supportBrackets!==true)return {reason:'BROKER_BRACKET_PERMISSION_REQUIRED'};
   if(fresh.positions.length!==snap.positions.length||fresh.positions.some(p=>!snap.positions.some(old=>same(old.id,p.id)&&num(old.qty)===num(p.qty)))||s.positions.some(p=>p.brokerProtection?.status!=='STOP_PRESENT'))return {reason:'ACCOUNT_RECHECK_REQUIRED'};
   const quote=await broker.quote(intent.order.tradableInstrumentId,account),at=now(),partial=history.barDetails?.find(b=>Number(b.t)===Math.floor(at/300000)*300000);
   const liveBar=partial?{openTime:Number(partial.t),low:Number(partial.l),high:Number(partial.h)}:null;
   const entryInput={bars:brokerBars(history,at),price:num(quote.bp),priceAsOf:at,now:at,entryAfter:Math.max(s.createdAt,s.after[intent.symbol]||0),used:s.used,liveBar,settings:s.settings||{}};
   let check;
   try{check=intent.setup.entryMode==='channel_breakout'?assertChannelSubmission(entryInput,channelPrimary,{entryMode:intent.setup.entryMode,patternId:intent.patternId,setup:intent.setup}):colmexBreakoutEntry(entryInput,breakoutConfig);}catch(e){return {reason:e.message};}
   if(!check.ready)return {reason:check.reason};
   if(check.setup.patternId!==intent.patternId||check.setup.level!==intent.setup.level)return {reason:'BREAKOUT_SIGNAL_CHANGED'};
   const budget=reservedAccount(s,fresh),plan=planBuy({instrument:{type:'EQUITY',tradableInstrumentId:intent.order.tradableInstrumentId},details:intent.entryDetails,quote,receivedAt:at,now:at,positions:fresh.positions,orders:budget.orders,cash:budget.cash,settings:s.settings||{},riskInput:check.riskInput});
   if(plan.reason!=='READY')return {reason:plan.reason};
   try{validateChannelProfitEntry(check.setup,plan.order.price,s.settings||{});}catch(e){return {reason:e.message};}
   if(!(num(quote.ap)<=intent.order.price&&plan.order.qty>=intent.order.qty))return {reason:'SIGNAL_PRICE_INVALIDATED'};
   if(check.setup.channelProtection?.version==='CHANNEL_TAKE_PROFIT_V2'){
    const target=ticks(check.setup.channelProtection.targetPrice,intent.entryDetails.tickSize,true);
    if(!(target>intent.order.price))return {reason:'CHANNEL_TARGET_ALREADY_REACHED'};
    intent.order.takeProfit=target;intent.order.takeProfitType='absolute';
   }
   intent.entryBid=num(quote.bp);intent.entryLiveBar=liveBar;intent.quoteReceivedAt=at;
   if(now()>deadline-8000)return {reason:'CYCLE_DEADLINE'};
  }
  const entryError=earlyEntryError(intent);if(entryError)return {reason:entryError};
  const pending={id:randomUUID(),at:now(),...intent};pending.tag='levi-auto:'+pending.id;
  if(!s.pending)s.pending=pending;else (s.riskPending??=[]).push(pending);
  if(intent.kind==='BUY')s.used.push(intent.patternId);
  observe({symbol:intent.symbol,stage:'ORDER_INTENT',action:intent.kind==='BUY'?'ENTER':intent.kind==='CLOSE'?'EXIT':'PROTECT',reason:intent.reason||intent.kind,reference:pending.id,price:intent.entryBid??s.positions.find(p=>p.symbol===intent.symbol)?.lastBid,priceAt:intent.quoteReceivedAt??s.positions.find(p=>p.symbol===intent.symbol)?.lastQuoteAt});
  event(s,now(),'SUBMIT_'+intent.kind,intent.symbol);await save(s);
  const expired=earlyEntryError(intent);
  if(expired){
   // The durable reservation was saved, but no broker write has been attempted.
   if(s.pending===pending)s.pending=null;else s.riskPending=(s.riskPending||[]).filter(p=>p.id!==pending.id);
   observe({symbol:intent.symbol,stage:'ORDER_CANCELLED_BEFORE_WRITE',action:'WAIT',reason:expired,reference:pending.id});
   event(s,now(),'ENTRY_EXPIRED_BEFORE_WRITE',intent.symbol);await save(s);return {reason:expired};
  }
  try{const result=await broker.write(account,pending);if(result.orderId)pending.orderId=String(result.orderId);pending.acceptedAt=now();observe({symbol:intent.symbol,stage:'ORDER_ACKNOWLEDGED',action:intent.kind==='BUY'?'ENTER':intent.kind==='CLOSE'?'EXIT':'PROTECT',reason:'AWAITING_BROKER_CONFIRMATION',reference:pending.id});}
  catch(error){
   const {failure,resolved}=recordWriteFailure(s,pending,error,now());
   observe({symbol:intent.symbol,stage:resolved?'ORDER_NOT_EXECUTED':'ORDER_UNCERTAIN',action:'WAIT',reason:failure.code,reference:pending.id});
   event(s,now(),resolved?failure.code:'WRITE_OUTCOME_PENDING_RECONCILIATION',intent.symbol);
   await save(s);return {reason:resolved?failure.code:'PENDING_BROKER_CONFIRMATION'};
  }
  await save(s);return {reason:'PENDING_BROKER_CONFIRMATION'};
 };
 // Manual holdings are enrolled only from broker-confirmed identity, average
 // cost, long quantity and USD equity/ETF contract rules. No guessed entry price.
 const external=snap.positions.find(p=>!s.positions.some(o=>same(o.id,p.id))&&!pendingIntents(s).some(i=>i.order&&same(i.order.tradableInstrumentId,p.tradableInstrumentId))&&String(p.side).toLowerCase()==='buy'&&num(p.avgPrice)>0&&num(p.qty)>0);
 if(external&&!hasBlockingPending(s)&&!s.halt&&snap.historyAvailable!==false&&now()<deadline-12000){
  const instruments=await broker.instruments(account),matches=instruments.filter(i=>same(i.tradableInstrumentId,external.tradableInstrumentId)&&['EQUITY','ETF'].includes(i.type));
  if(matches.length===1){
   const i=matches[0],details=await broker.details(i.tradableInstrumentId,account);
   if(details.quotingCurrency==='USD'&&Array.isArray(details.tickSize)&&details.tickSize.length){
    const entry=num(external.avgPrice),owned=applyTrailingExitPolicy({id:String(external.id),symbol:i.name,instrumentId:i.tradableInstrumentId,qty:num(external.qty),entryPrice:entry,entryAt:new Date(now()).toISOString(),adoptedAt:now(),sourcePurchaseAt:external.openTime??null,peakPrice:entry,strategyId:'WYCKOFF_5M_V1',entryMode:'manual_external',adoptedExternal:true,tickSize:details.tickSize},s.settings||{});
    s.positions.push(owned);event(s,now(),'MANUAL_HOLDING_ADOPTED',i.name);await save(s);
   }
  }
 }

 // Evaluate all independently verified holdings before choosing one write.
 // Pending writes block only their own instrument/position; entries remain frozen.
 const ownedPositions=s.positions.filter(owned=>{
  const p=snap.positions.find(p=>same(p.id,owned.id));
  return p&&same(p.tradableInstrumentId,owned.instrumentId)&&String(p.side).toLowerCase()==='buy'&&num(p.qty)===owned.qty&&
   !pendingIntents(s).some(i=>i.positionId&&same(i.positionId,owned.id)||i.symbol===owned.symbol||i.order&&same(i.order.tradableInstrumentId,owned.instrumentId));
 });
 const candidates=[];
 for(const owned of ownedPositions){
  const p=snap.positions.find(p=>same(p.id,owned.id));
  if(!(num(p.stopLoss)>0)&&!owned.adoptedExternal)candidates.push({priority:0,kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:'MISSING_BROKER_STOP'});
 }
 if(candidates.length){const {priority,...intent}=candidates[0];return submit(intent);}
 if(regularSession(now())&&now()<deadline-9000){
  s.stage='POSITION_QUOTES';
  const quotes=await Promise.allSettled(ownedPositions.map(p=>broker.quote(p.instrumentId,account)));
  for(let index=0;index<ownedPositions.length;index++){
   const owned=ownedPositions[index],p=snap.positions.find(p=>same(p.id,owned.id)),quote=quotes[index];
   applyTrailingExitPolicy(owned,positionRiskSettings(owned,s.settings||{}));
   const stop=num(p.stopLoss),bid=quote.status==='fulfilled'?num(quote.value.bp):null;
   owned.lastRiskCheckAt=now();
   if(!(bid>0)){owned.riskStatus='WAIT_BROKER_QUOTE';observe({symbol:owned.symbol,action:'WAIT',reason:owned.riskStatus});continue;}
   owned.lastBid=bid;owned.lastQuoteAt=now();owned.riskStatus='CHECKED';
   if(stop>0)owned.effectiveStopPrice=Math.max(stop,Number(owned.effectiveStopPrice)||0);
   const exit=binancePositionExit(owned,bid,now());
   observe({symbol:owned.symbol,action:exit.sell?'EXIT':'HOLD',reason:exit.reason||'HOLD_POSITION',price:bid,priceAt:owned.lastQuoteAt});
   if(exit.sell){candidates.push({priority:0,kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:exit.reason});continue;}
   const floor=Math.max(stop||0,ticks(owned.effectiveStopPrice,owned.tickSize,true)),target=ticks(owned.targetPrice,owned.tickSize,true);
   if(!(floor>0&&target>0)){owned.riskStatus='INVALID_PROTECTION_LEVELS';continue;}
   if(!(target>bid)){candidates.push({priority:0,kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:'TAKE_PROFIT_REACHED'});continue;}
   const safeStop=floor<bid?floor:stop;
   if(safeStop>0&&(safeStop>(stop||0)+1e-8||num(p.takeProfit)!==target))candidates.push({priority:stop>0?2:1,kind:'PROTECTION',positionId:owned.id,stopLoss:safeStop,takeProfit:target,symbol:owned.symbol});
  }
  await save(s);
  candidates.sort((a,b)=>a.priority-b.priority);
  if(candidates.length){const {priority,...intent}=candidates[0];return submit(intent);}
 }
 const accountBudget=reservedAccount(s,snap);
 const entryBlock=s.halt||(hasBlockingPending(s)?'PENDING_BROKER_CONFIRMATION':null)||(regularSession(now())&&snap.positions.length+accountBudget.orders.filter(o=>String(o.side).toLowerCase()==='buy').length>=3?'NO_FREE_SLOT':null)||(regularSession(now())&&(snap.account?.tradingRules?.supportSelfTrading!==true||snap.account?.tradingRules?.supportBrackets!==true)?'BROKER_BRACKET_PERMISSION_REQUIRED':null);
 if(snap.historyAvailable===false)return {reason:'HISTORY_UNAVAILABLE'};
 if(s.positions.some(p=>p.riskStatus&&p.riskStatus!=='CHECKED'))return {reason:'POSITION_RISK_DATA_UNAVAILABLE'};
 if((s.closedTrades||[]).length>=10000)return {reason:'LEDGER_CAPACITY_REVIEW'};
 if(!regularSession(now()))return entryBlock?{reason:entryBlock}:runPreparationCycle({state:s,save,broker,account,now,deadline});
 if(now()>deadline-9000)return {reason:'CYCLE_DEADLINE'};
 s.stage='INSTRUMENTS';
 const instruments=await broker.instruments(account);
 if(!Array.isArray(instruments))throw Error('INSTRUMENT_SCHEMA');
 const inspect=async symbol=>{
 const candidates=instruments.filter(i=>i.name===symbol&&['EQUITY','ETF'].includes(i.type));
 if(candidates.length!==1)return {reason:'INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS'};
 const instrument=candidates[0],id=instrument.tradableInstrumentId;
 const symbolBlock=entryBlock||(pendingIntents(s).some(i=>i.symbol===symbol||i.order&&same(i.order.tradableInstrumentId,id))?'SYMBOL_ORDER_UNRESOLVED':null);
 if(!/^\d+$/.test(String(id)))throw Error('INSTRUMENT_SCHEMA');
 s.stage='HISTORY_AND_DETAILS';
 const [details,history]=await Promise.all([broker.details(id,account),broker.history(id,account)]);
 s.stage='WYCKOFF_HISTORY_VALIDATION';
 const continuous=contiguousHistory(brokerBars(history,now()));
 s.historyQuality={symbol,at:now(),discarded:continuous.discarded,usableBars:continuous.bars.length,resetAt:continuous.resetAt};
 observeEntryComparison(s,{symbol,bars:continuous.bars,at:now(),platform:'COLMEX',settings:s.settings||{},universe:AUTO_POLICY.symbols});
 const quote=await broker.quote(id,account),receivedAt=now();
 const partial=history.barDetails?.find(b=>Number(b.t)===Math.floor(receivedAt/300000)*300000);
 const liveBar=partial?{openTime:Number(partial.t),high:Number(partial.h),low:Number(partial.l)}:null;
 const current=signal(continuous.bars,now(),Math.max(s.createdAt,s.after[symbol]||0),s.used,{price:num(quote.bp),priceAsOf:receivedAt,liveBar,searchAfter:s.after[symbol]||0});
 const breakout=breakoutConfig.enabled?colmexBreakoutEntry({bars:continuous.bars,price:num(quote.bp),priceAsOf:receivedAt,now:now(),entryAfter:Math.max(s.createdAt,s.after[symbol]||0),used:s.used,liveBar,settings:s.settings||{}},breakoutConfig):null;
 const channel=channelPrimary.requested?channelEntry({bars:continuous.bars,price:num(quote.bp),priceAsOf:receivedAt,now:now(),entryAfter:Math.max(s.createdAt,s.after[symbol]||0),used:s.used,liveBar,settings:s.settings||{}},channelPrimary):null;
 const setup=channel||(!current.ready&&breakout?.ready?breakout:current);
 const entryDecisions=channel?{current:{ready:current.ready,reason:current.reason},breakout:{ready:false,reason:'CHANNEL_PRIMARY_REQUIRED'},channel:{ready:channel.ready,reason:channel.reason},primary:'channel_breakout',selected:channel.ready?'channel_breakout':null}:{current:{ready:current.ready,reason:current.reason},breakout:breakout?{ready:breakout.ready,reason:breakout.reason}:{ready:false,reason:'INDEPENDENT_ENTRY_DISABLED'},selected:setup===breakout?'independent_breakout':current.ready?'confirmed_quality':null};
 recordStrategyObservation(s,{symbol,bars:continuous.bars,at:receivedAt,price:num(quote.bp),comparison:current.comparison,version:AUTO_POLICY.version});
 const screenRsi=rsiSnapshot(continuous.bars,{close:num(quote.bp),observedAt:receivedAt});
 const auditEntry=(reason,action='WAIT')=>observe({symbol,action,reason,searchDiagnostic:setup.searchDiagnostic,bars:continuous.bars,price:num(quote.bp),priceAt:receivedAt});
 let reason=setup.reason;
 if(symbolBlock){
  auditEntry(symbolBlock);
  return {entryDecisions,reason:setup.ready?'SIGNAL_READY_OBSERVATION_ONLY':reason||'WAIT_WYCKOFF',entryBlockReason:symbolBlock,technicalReady:setup.ready,quality:setup.quality,searchDiagnostic:setup.searchDiagnostic,entryRsi:setup.entryRsi??null,screenRsi,phase:setup.phase||setup.setup?.phase||null};
 }
 if(setup.ready){
  s.stage='ENTRY_QUOTE';
  const plan=planBuy({settings:s.settings||{},riskInput:setup.riskInput,instrument,details,quote,receivedAt,now:now(),positions:snap.positions,orders:accountBudget.orders,cash:accountBudget.cash});
  reason=plan.reason;
  if(reason==='READY')try{validateChannelProfitEntry(setup.setup,plan.order.price,s.settings||{});}catch(e){reason=e.message;}
  if(!(num(quote.ap)<setup.setup.targetPrice)){reason='SIGNAL_PRICE_INVALIDATED';s.used.push(setup.setup.patternId);}
  if(reason==='READY'&&setup.setup.channelProtection?.version==='CHANNEL_TAKE_PROFIT_V2'){plan.order.takeProfit=ticks(setup.setup.channelProtection.targetPrice,details.tickSize,true);plan.order.takeProfitType='absolute';}
  if(reason==='READY'){auditEntry(reason,'ENTER');return {reason,entryDecisions,technicalReady:setup.ready,quality:setup.quality,searchDiagnostic:setup.searchDiagnostic,entryRsi:setup.entryRsi??null,screenRsi,phase:setup.phase||setup.setup?.phase||null,intent:{kind:'BUY',symbol,patternId:setup.setup.patternId,setup:setup.setup,...(channel||setup===breakout?{entryDetails:details,reason:channel?'CHANNEL_BREAKOUT_READY':'INDEPENDENT_BREAKOUT_READY'}:{}),quoteReceivedAt:receivedAt,entryBid:num(quote.bp),entryLiveBar:liveBar,tickSize:details.tickSize,order:plan.order,riskPlan:plan.riskPlan,exitSettings:plan.exitSettings}};}
 }
 auditEntry(reason||'WAIT_WYCKOFF');
 return {entryDecisions,reason:reason||'WAIT_WYCKOFF',technicalReady:setup.ready,quality:setup.quality,searchDiagnostic:setup.searchDiagnostic,entryRsi:setup.entryRsi??null,screenRsi,phase:setup.phase||setup.setup?.phase||setup.reason||null};
 };
 let last={reason:'CYCLE_DEADLINE'};
 for(let scanned=0;scanned<AUTO_POLICY.scanBatchSize;scanned++){
  if(!regularSession(now()))return {reason:'OUTSIDE_REGULAR_SESSION'};
  if(now()>deadline-9000)return last;
  const symbol=AUTO_POLICY.symbols[s.cursor%AUTO_POLICY.symbols.length];s.cursor++;await save(s);
  let result;
  try{result=await inspect(symbol);}
  catch(error){
   const code=error.code||error.message;
   const allowed=['INSTRUMENT_SCHEMA','HISTORY_SCHEMA','FIVE_MINUTE_TIMEFRAME_REQUIRED','AUTH_DENIED','ACCESS_DENIED','RATE_LIMIT','NETWORK','RESPONSE_SCHEMA','CYCLE_DEADLINE'];
   result={reason:allowed.includes(code)?code:'SCAN_DATA_UNAVAILABLE'};
   observe({symbol,action:'WAIT',reason:result.reason});
  }
  recordEntryBlocker(s,{symbol,at:now(),reason:result.technicalReady?'READY':result.reason,entryBlockReason:result.entryBlockReason||entryBlock||(result.technicalReady&&result.reason!=='READY'?result.reason:null),technicalReady:result.technicalReady??null,universe:AUTO_POLICY.symbols});
  const {intent,...check}=result;last=s.checks[symbol]={at:now(),...check};
  s.scanActivity={at:now(),symbol,mode:entryBlock?'OBSERVATION_ONLY':'ENTRY_SCAN',dataAvailable:!!result.screenRsi,entryBlockReason:entryBlock};
  // Storage errors and order outcomes must not be mistaken for a failed quote.
  await save(s);
  if(intent&&!entryBlock)return submit(intent); // At most one new intent per scheduled cycle.
  if(['RATE_LIMIT','AUTH_DENIED','ACCESS_DENIED','NETWORK','CYCLE_DEADLINE'].includes(last.reason))return last;
 }
 return entryBlock?{reason:entryBlock,scanReason:last.reason}:last;
}
