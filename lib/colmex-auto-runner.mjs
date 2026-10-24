import {runPreparationCycle} from './colmex-preparation.mjs';
import {rsiSnapshot} from './rsi-screener.mjs';
import {randomUUID} from 'node:crypto';
import {AUTO_POLICY,configuredLive,planBuy,entrySignal,brokerBars,contiguousHistory,ticks,num} from './colmex-auto-policy.mjs';
import {binancePositionExit} from './binance-position-exit.mjs';
import {TRAILING_EXIT_POLICY,applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
import {regularSession} from './colmex-simulation.mjs';
export function initialState(now){return {version:1,createdAt:now,cursor:0,positions:[],pending:null,used:[],after:{},events:[],checks:{},lastCycleAt:null,halt:null};}
function event(s,now,reason,symbol){s.events.push({at:now,reason,...(symbol?{symbol}:{})});s.events=s.events.slice(-200);}
const same=(a,b)=>String(a)===String(b);
const terminal=o=>['filled','cancelled','canceled','rejected','expired'].includes(String(o.status).toLowerCase());
export function reconcile(s,snapshot,now){
 const intent=s.pending;
 const manualResult=status=>{if(intent?.manual&&s.manualRequests?.[intent.id])s.manualRequests[intent.id]={...s.manualRequests[intent.id],status,completedAt:now};};
 if(intent){
  if(intent.kind==='BUY'){
   const matches=[...snapshot.orders,...snapshot.history].filter(o=>intent.orderId?same(o.id,intent.orderId):o.userComment===intent.tag);
   const unique=[...new Map(matches.map(o=>[String(o.id),o])).values()];
   if(unique.length>1){s.halt='AMBIGUOUS_ORDER';return;}
   const order=unique[0];
   if(order&&terminal(order)){
    const filled=num(order.filledQty);
    if(filled===null||filled<0||filled>intent.order.qty+1e-8){s.halt='UNKNOWN_FILL_QUANTITY';return;}
    if(filled===0){event(s,now,'BUY_FINISHED_WITHOUT_FILL',intent.symbol);manualResult('NO_FILL');s.pending=null;}
    else {
     const positions=snapshot.positions.filter(p=>same(p.tradableInstrumentId,intent.order.tradableInstrumentId)&&(!order.positionId||same(p.id,order.positionId)));
     if(positions.length!==1){s.halt='FILL_POSITION_REQUIRES_REVIEW';return;}
     const p=positions[0],price=num(order.avgPrice),qty=num(p.qty);
     if(!(price>0&&qty>0)||Math.abs(qty-filled)>1e-8||String(p.side).toLowerCase()!=='buy'){s.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';return;}
     s.positions.push({id:String(p.id),symbol:intent.symbol,instrumentId:intent.order.tradableInstrumentId,qty,entryPrice:price,entryAt:new Date(intent.at).toISOString(),peakPrice:price,strategyId:'WYCKOFF_5M_V1',exitPolicy:TRAILING_EXIT_POLICY,minProfitHoldMs:0,tickSize:intent.tickSize,patternId:intent.patternId,setup:intent.setup});
     applyTrailingExitPolicy(s.positions.at(-1),s.settings||{});
     event(s,now,'BUY_FILL_CONFIRMED',intent.symbol);manualResult('FILLED');s.pending=null;
    }
   }
  }else{
   const p=snapshot.positions.find(p=>same(p.id,intent.positionId));
   if(intent.kind==='CLOSE'&&!p){manualResult('CLOSED');s.after[intent.symbol]=now;s.pending=null;event(s,now,'CLOSE_CONFIRMED',intent.symbol);}
   if(intent.kind==='STOP'&&p&&num(p.stopLoss)>=intent.stopLoss-1e-8){s.pending=null;event(s,now,'STOP_CONFIRMED',intent.symbol);}
   const tpConfirmed=p&&(intent.takeProfit===null?Object.hasOwn(p,'takeProfit')&&(p.takeProfit===null||p.takeProfit===''||num(p.takeProfit)===0):num(p.takeProfit)!==null&&Math.abs(num(p.takeProfit)-intent.takeProfit)<1e-8);
   if(intent.kind==='PROTECTION'&&p&&num(p.stopLoss)!==null&&num(p.stopLoss)>=intent.stopLoss-1e-8&&tpConfirmed){s.pending=null;event(s,now,'PROTECTION_CONFIRMED',intent.symbol);}
   if(['PROTECTION','STOP'].includes(intent.kind)&&!p){s.pending=null;s.after[intent.symbol]=now;event(s,now,'POSITION_CLOSED_AT_BROKER',intent.symbol);}
  }
  if(s.pending&&now-intent.at>10*60000)s.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';
 }
 for(const owned of [...s.positions]){
  const p=snapshot.positions.find(p=>same(p.id,owned.id));
  if(!p){s.positions=s.positions.filter(x=>x!==owned);s.after[owned.symbol]=now;event(s,now,'POSITION_CLOSED_AT_BROKER',owned.symbol);}
  else if(!same(p.tradableInstrumentId,owned.instrumentId)||String(p.side).toLowerCase()!=='buy')s.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';
  else if(num(p.qty)!==owned.qty){
   if(!(num(p.qty)>0&&num(p.avgPrice)>0)){s.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';continue;}
   const raised=num(p.qty)>owned.qty;owned.qty=num(p.qty);
   if(raised){owned.entryPrice=num(p.avgPrice);owned.peakPrice=owned.entryPrice;owned.profitFloorArmed=false;}
   applyTrailingExitPolicy(owned,s.settings||{});event(s,now,'MANUAL_QUANTITY_RECONCILED',owned.symbol);
  }
 }
}
export async function runCycle({state:s,save,broker,env,now=Date.now,deadline=now()+24000,signal=entrySignal}){
 if(!configuredLive(env))return {reason:'DISABLED'};
 if(s.lastCycleAt&&now()-s.lastCycleAt<55000)return {reason:'CYCLE_COOLDOWN'};
 const account=env.COLMEX_AUTO_ACCOUNT_ID;
 s.stage='ACCOUNT_SNAPSHOT';
 const snap=await broker.snapshot(account);s.lastCycleAt=now();
 reconcile(s,snap,now());await save(s);
 if(s.pending||s.halt)return {reason:s.halt||'PENDING_BROKER_CONFIRMATION'};
 const submit=async intent=>{
  if(now()>deadline-8000)return {reason:'CYCLE_DEADLINE'};
  s.pending={id:randomUUID(),at:now(),...intent};s.pending.tag='levi-auto:'+s.pending.id;
  if(intent.kind==='BUY')s.used.push(intent.patternId); // Never recycle an uncertain or rejected setup.
  event(s,now(),'SUBMIT_'+intent.kind,intent.symbol);await save(s); // Must succeed BEFORE write.
  try{const result=await broker.write(account,s.pending);if(result.orderId)s.pending.orderId=String(result.orderId);s.pending.acceptedAt=now();}
  catch{event(s,now(),'WRITE_OUTCOME_PENDING_RECONCILIATION',intent.symbol);}
  await save(s);return {reason:'PENDING_BROKER_CONFIRMATION'};
 };
 // Manual holdings are enrolled only from broker-confirmed identity, average
 // cost, long quantity and USD equity/ETF contract rules. No guessed entry price.
 const external=snap.positions.find(p=>!s.positions.some(o=>same(o.id,p.id))&&String(p.side).toLowerCase()==='buy'&&num(p.avgPrice)>0&&num(p.qty)>0);
 if(external&&now()<deadline-12000){
  const instruments=await broker.instruments(account),matches=instruments.filter(i=>same(i.tradableInstrumentId,external.tradableInstrumentId)&&['EQUITY','ETF'].includes(i.type));
  if(matches.length===1){
   const i=matches[0],details=await broker.details(i.tradableInstrumentId,account);
   if(details.quotingCurrency==='USD'&&Array.isArray(details.tickSize)&&details.tickSize.length){
    const entry=num(external.avgPrice),owned=applyTrailingExitPolicy({id:String(external.id),symbol:i.name,instrumentId:i.tradableInstrumentId,qty:num(external.qty),entryPrice:entry,entryAt:new Date(now()).toISOString(),adoptedAt:now(),sourcePurchaseAt:external.openTime??null,peakPrice:entry,strategyId:'WYCKOFF_5M_V1',entryMode:'manual_external',adoptedExternal:true,tickSize:details.tickSize},s.settings||{});
    s.positions.push(owned);event(s,now(),'MANUAL_HOLDING_ADOPTED',i.name);await save(s);
   }
  }
 }

 for(const owned of s.positions){
  applyTrailingExitPolicy(owned,s.settings||{});
  if(now()>deadline-9000)break;
  const p=snap.positions.find(p=>same(p.id,owned.id));if(!p)continue;
  const stop=num(p.stopLoss);
  if(!(stop>0)&&owned.adoptedExternal){
   if(!regularSession(now()))continue;
   const q=await broker.quote(owned.instrumentId,account),bid=num(q.bp);if(!(bid>0))throw Error('WAIT_BROKER_QUOTE');
   const exit=binancePositionExit(owned,bid,now());await save(s);
   if(exit.sell)return submit({kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:exit.reason});
   const floor=ticks(owned.effectiveStopPrice,owned.tickSize,true),target=ticks(owned.targetPrice,owned.tickSize,true);
   if(floor>0&&floor<bid&&target>bid)return submit({kind:'PROTECTION',positionId:owned.id,stopLoss:floor,takeProfit:target,symbol:owned.symbol});
   continue;
  }
  if(!(stop>0))return submit({kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:'MISSING_BROKER_STOP'});
  owned.effectiveStopPrice=Math.max(stop,Number(owned.effectiveStopPrice)||0);
  if(!regularSession(now()))continue;
  s.stage='POSITION_QUOTE';
  const quote=await broker.quote(owned.instrumentId,account),bid=num(quote.bp);
  if(!(bid>0))throw Error('WAIT_BROKER_QUOTE');
  const exit=binancePositionExit(owned,bid,now());
  await save(s);
  if(exit.sell)return submit({kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:exit.reason});
  const floor=Math.max(stop,ticks(owned.effectiveStopPrice,owned.tickSize,true)),target=ticks(owned.targetPrice,owned.tickSize,true);
  if(!(target>bid))return submit({kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:'BROKER_TAKE_PROFIT_50_PERCENT'});
  if(!(floor>0))throw Error('INVALID_PROTECTION_LEVELS');
  // A stop at the current bid can trigger immediately. At the exact activation
  // boundary retain the old broker SL until there is room for the raised stop.
  if(floor>=bid){if(num(p.takeProfit)!==target)return submit({kind:'PROTECTION',positionId:owned.id,stopLoss:stop,takeProfit:target,symbol:owned.symbol});continue;}
  if(floor>stop+1e-8||num(p.takeProfit)!==target)return submit({kind:'PROTECTION',positionId:owned.id,stopLoss:floor,takeProfit:target,symbol:owned.symbol});
 }
 if(!regularSession(now()))return runPreparationCycle({state:s,save,broker,account,now,deadline});
 if(now()>deadline-9000)return {reason:'CYCLE_DEADLINE'};
 if(snap.positions.length+snap.orders.filter(o=>String(o.side).toLowerCase()==='buy').length>=3)return {reason:'NO_FREE_SLOT'};
 if(snap.account.tradingRules?.supportSelfTrading!==true||snap.account.tradingRules?.supportBrackets!==true)return {reason:'BROKER_BRACKET_PERMISSION_REQUIRED'};
 const symbol=AUTO_POLICY.symbols[s.cursor%AUTO_POLICY.symbols.length];s.cursor++;await save(s);
 s.stage='INSTRUMENTS';
 const instruments=await broker.instruments(account);
 if(!Array.isArray(instruments))throw Error('INSTRUMENT_SCHEMA');
 const candidates=instruments.filter(i=>i.name===symbol&&['EQUITY','ETF'].includes(i.type));
 if(candidates.length!==1){s.checks[symbol]={at:now(),reason:'INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS'};await save(s);return s.checks[symbol];}
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
  s.checks[symbol]={at:now(),reason,entryRsi:setup.entryRsi??null,screenRsi,phase:setup.phase||setup.setup?.phase||setup.reason||null};await save(s);
  if(reason==='READY')return submit({kind:'BUY',symbol,patternId:setup.setup.patternId,setup:setup.setup,tickSize:details.tickSize,order:plan.order});
 }
 s.checks[symbol]={at:now(),reason:reason||'WAIT_WYCKOFF',entryRsi:setup.entryRsi??null,screenRsi,phase:setup.phase||setup.setup?.phase||setup.reason||null};await save(s);return s.checks[symbol];
}
