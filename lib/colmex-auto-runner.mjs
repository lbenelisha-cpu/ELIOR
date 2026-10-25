import {runPreparationCycle} from './colmex-preparation.mjs';
import {rsiSnapshot} from './rsi-screener.mjs';
import {randomUUID} from 'node:crypto';
import {AUTO_POLICY,configuredLive,planBuy,entrySignal,brokerBars,contiguousHistory,ticks,num} from './colmex-auto-policy.mjs';
import {binancePositionExit} from './binance-position-exit.mjs';
import {TRAILING_EXIT_POLICY,applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
import {regularSession} from './colmex-market-hours.mjs';
export function initialState(now){return {version:1,createdAt:now,cursor:0,positions:[],pending:null,used:[],after:{},events:[],checks:{},lastCycleAt:null,halt:null};}
export {reconcile} from './colmex-reconciliation.mjs';
import {reconcile,event,same} from './colmex-reconciliation.mjs';
import {hasPending,pendingIntents} from './colmex-live-state.mjs';
export async function runCycle({state:s,save,broker,env,now=Date.now,deadline=now()+24000,signal=entrySignal}){
 if(!configuredLive(env))return {reason:'DISABLED'};
 if(s.lastCycleAt&&now()-s.lastCycleAt<55000)return {reason:'CYCLE_COOLDOWN'};
 const account=env.COLMEX_AUTO_ACCOUNT_ID;
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
 reconcile(s,snap,now());s.lastBrokerSnapshotAt=now();
 if(!regularSession(now())&&!hasPending(s)&&!s.halt&&!s.positions.length&&!snap.positions.length&&!snap.orders.length)s.closedEmptySnapshotAt=now();
 await save(s);
 const submit=async intent=>{
  if(now()>deadline-8000)return {reason:'CYCLE_DEADLINE'};
  const pending={id:randomUUID(),at:now(),...intent};pending.tag='levi-auto:'+pending.id;
  if(!s.pending)s.pending=pending;else (s.riskPending??=[]).push(pending);
  if(intent.kind==='BUY')s.used.push(intent.patternId);
  event(s,now(),'SUBMIT_'+intent.kind,intent.symbol);await save(s);
  try{const result=await broker.write(account,pending);if(result.orderId)pending.orderId=String(result.orderId);pending.acceptedAt=now();}
  catch{event(s,now(),'WRITE_OUTCOME_PENDING_RECONCILIATION',intent.symbol);}
  await save(s);return {reason:'PENDING_BROKER_CONFIRMATION'};
 };
 // Manual holdings are enrolled only from broker-confirmed identity, average
 // cost, long quantity and USD equity/ETF contract rules. No guessed entry price.
 const external=snap.positions.find(p=>!s.positions.some(o=>same(o.id,p.id))&&String(p.side).toLowerCase()==='buy'&&num(p.avgPrice)>0&&num(p.qty)>0);
 if(external&&!hasPending(s)&&!s.halt&&snap.historyAvailable!==false&&now()<deadline-12000){
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
   applyTrailingExitPolicy(owned,s.settings||{});
   const stop=num(p.stopLoss),bid=quote.status==='fulfilled'?num(quote.value.bp):null;
   owned.lastRiskCheckAt=now();
   if(!(bid>0)){owned.riskStatus='WAIT_BROKER_QUOTE';continue;}
   owned.lastBid=bid;owned.lastQuoteAt=now();owned.riskStatus='CHECKED';
   if(stop>0)owned.effectiveStopPrice=Math.max(stop,Number(owned.effectiveStopPrice)||0);
   const exit=binancePositionExit(owned,bid,now());
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
 if(hasPending(s)||s.halt)return {reason:s.halt||'PENDING_BROKER_CONFIRMATION'};
 if(snap.historyAvailable===false)return {reason:'HISTORY_UNAVAILABLE'};
 if(s.positions.some(p=>p.riskStatus&&p.riskStatus!=='CHECKED'))return {reason:'POSITION_RISK_DATA_UNAVAILABLE'};
 if((s.closedTrades||[]).length>=10000)return {reason:'LEDGER_CAPACITY_REVIEW'};
 if(!regularSession(now()))return runPreparationCycle({state:s,save,broker,account,now,deadline});
 if(now()>deadline-9000)return {reason:'CYCLE_DEADLINE'};
 if(snap.positions.length+snap.orders.filter(o=>String(o.side).toLowerCase()==='buy').length>=3)return {reason:'NO_FREE_SLOT'};
 if(snap.account.tradingRules?.supportSelfTrading!==true||snap.account.tradingRules?.supportBrackets!==true)return {reason:'BROKER_BRACKET_PERMISSION_REQUIRED'};
 s.stage='INSTRUMENTS';
 const instruments=await broker.instruments(account);
 if(!Array.isArray(instruments))throw Error('INSTRUMENT_SCHEMA');
 const inspect=async symbol=>{
 const candidates=instruments.filter(i=>i.name===symbol&&['EQUITY','ETF'].includes(i.type));
 if(candidates.length!==1)return {reason:'INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS'};
 const instrument=candidates[0],id=instrument.tradableInstrumentId;
 if(!/^\d+$/.test(String(id)))throw Error('INSTRUMENT_SCHEMA');
 s.stage='HISTORY_AND_DETAILS';
 const [details,history]=await Promise.all([broker.details(id,account),broker.history(id,account)]);
 s.stage='WYCKOFF_HISTORY_VALIDATION';
 const continuous=contiguousHistory(brokerBars(history,now()));
 s.historyQuality={symbol,at:now(),discarded:continuous.discarded,usableBars:continuous.bars.length,resetAt:continuous.resetAt};
 const quote=await broker.quote(id,account),receivedAt=now();
 const partial=history.barDetails?.find(b=>Number(b.t)===Math.floor(receivedAt/300000)*300000);
 const liveBar=partial?{openTime:Number(partial.t),high:Number(partial.h),low:Number(partial.l)}:null;
 const setup=signal(continuous.bars,now(),Math.max(s.createdAt,s.after[symbol]||0),s.used,{price:num(quote.bp),priceAsOf:receivedAt,liveBar,searchAfter:s.after[symbol]||0});
 const screenRsi=rsiSnapshot(continuous.bars,{close:num(quote.bp),observedAt:receivedAt});
 let reason=setup.reason;
 if(setup.ready){
  s.stage='ENTRY_QUOTE';
  const plan=planBuy({settings:s.settings||{},instrument,details,quote,receivedAt,now:now(),positions:snap.positions,orders:snap.orders,cash:snap.state.availableCash??snap.state.cashBalance});
  reason=plan.reason;
  if(!(num(quote.ap)<setup.setup.targetPrice)){reason='SIGNAL_PRICE_INVALIDATED';s.used.push(setup.setup.patternId);}
  if(reason==='READY')return {reason,entryRsi:setup.entryRsi??null,screenRsi,phase:setup.phase||setup.setup?.phase||null,intent:{kind:'BUY',symbol,patternId:setup.setup.patternId,setup:setup.setup,tickSize:details.tickSize,order:plan.order}};
 }
 return {reason:reason||'WAIT_WYCKOFF',entryRsi:setup.entryRsi??null,screenRsi,phase:setup.phase||setup.setup?.phase||setup.reason||null};
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
  }
  const {intent,...check}=result;last=s.checks[symbol]={at:now(),...check};
  // Storage errors and order outcomes must not be mistaken for a failed quote.
  await save(s);
  if(intent)return submit(intent); // At most one new intent per scheduled cycle.
  if(['RATE_LIMIT','AUTH_DENIED','ACCESS_DENIED','NETWORK','CYCLE_DEADLINE'].includes(last.reason))return last;
 }
 return last;
}
