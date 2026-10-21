import {randomUUID} from 'node:crypto';
import {AUTO_POLICY,configuredLive,planBuy,entrySignal,brokerBars,contiguousHistory,ticks,num} from './colmex-auto-policy.mjs';
import {binancePositionExit,MINIMUM_PROFIT_HOLD_MS,SPRING_EXIT_POLICY} from './binance-position-exit.mjs';
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
     s.positions.push({id:String(p.id),symbol:intent.symbol,instrumentId:intent.order.tradableInstrumentId,qty,entryPrice:price,entryAt:new Date(intent.at).toISOString(),peakPrice:price,strategyId:'WYCKOFF_5M_V1',exitPolicy:SPRING_EXIT_POLICY,minProfitHoldMs:MINIMUM_PROFIT_HOLD_MS,tickSize:intent.tickSize,patternId:intent.patternId});
     event(s,now,'BUY_FILL_CONFIRMED',intent.symbol);manualResult('FILLED');s.pending=null;
    }
   }
  }else{
   const p=snapshot.positions.find(p=>same(p.id,intent.positionId));
   if(intent.kind==='CLOSE'&&!p){manualResult('CLOSED');s.after[intent.symbol]=now;s.pending=null;event(s,now,'CLOSE_CONFIRMED',intent.symbol);}
   if(intent.kind==='STOP'&&p&&num(p.stopLoss)>=intent.stopLoss-1e-8){s.pending=null;event(s,now,'STOP_CONFIRMED',intent.symbol);}
  }
  if(s.pending&&now-intent.at>10*60000)s.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';
 }
 for(const owned of [...s.positions]){
  const p=snapshot.positions.find(p=>same(p.id,owned.id));
  if(!p){s.positions=s.positions.filter(x=>x!==owned);s.after[owned.symbol]=now;event(s,now,'POSITION_CLOSED_AT_BROKER',owned.symbol);}
  else if(num(p.qty)!==owned.qty||!same(p.tradableInstrumentId,owned.instrumentId)||String(p.side).toLowerCase()!=='buy')s.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';
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
 // Even with entries paused, never infer ownership of manually held shares.
 for(const owned of s.positions){
  if(now()>deadline-9000)break;
  const p=snap.positions.find(p=>same(p.id,owned.id));if(!p)continue;
  const stop=num(p.stopLoss);
  if(!(stop>0))return submit({kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:'MISSING_BROKER_STOP'});
  if(!regularSession(now()))continue;
  s.stage='POSITION_QUOTE';
  const quote=await broker.quote(owned.instrumentId,account),bid=num(quote.bp);
  if(!(bid>0))throw Error('WAIT_BROKER_QUOTE');
  const exit=binancePositionExit(owned,bid,now());
  await save(s);
  if(exit.sell)return submit({kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol,reason:exit.reason});
  const floor=ticks(owned.effectiveStopPrice,owned.tickSize,true);
  if(floor>stop+1e-8){if(floor>=bid)return submit({kind:'CLOSE',positionId:owned.id,qty:owned.qty,symbol:owned.symbol});return submit({kind:'STOP',positionId:owned.id,stopLoss:floor,symbol:owned.symbol});}
 }
 if(!regularSession(now()))return {reason:'OUTSIDE_REGULAR_SESSION'};
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
 const setup=signal(continuous.bars,now(),Math.max(s.createdAt,s.after[symbol]||0),s.used);
 let reason=setup.reason;
 if(setup.ready){
  s.stage='ENTRY_QUOTE';
  const quote=await broker.quote(id,account),receivedAt=now();
  const plan=planBuy({instrument,details,quote,receivedAt,now:now(),positions:snap.positions,orders:snap.orders,cash:snap.state.availableCash??snap.state.cashBalance});
  reason=plan.reason;
  if(!(num(quote.ap)<setup.setup.targetPrice)){reason='SIGNAL_PRICE_INVALIDATED';s.used.push(setup.setup.patternId);}
  s.checks[symbol]={at:now(),reason};await save(s);
  if(reason==='READY')return submit({kind:'BUY',symbol,patternId:setup.setup.patternId,tickSize:details.tickSize,order:plan.order});
 }
 s.checks[symbol]={at:now(),reason:reason||'WAIT_WYCKOFF'};await save(s);return s.checks[symbol];
}
