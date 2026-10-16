import {evaluateWyckoff,createWyckoffTrade} from './wyckoff-strategy.mjs';
import {createLiveConfirmationTracker} from './wyckoff-live-confirmation.mjs';
import {binancePositionExit,SPRING_EXIT_POLICY,MINIMUM_PROFIT_HOLD_MS} from './binance-position-exit.mjs';
export const SIM_SYMBOLS=['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AVGO','JPM','NFLX'];
export const SIM_VERSION='COLMEX_WYCKOFF_5M_V1';
const step=300000,positive=n=>Number.isFinite(n)&&n>0;
const parts=t=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).map(p=>[p.type,p.value]));
export function session(t){const p=parts(t);return {day:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute),weekday:p.weekday};}
export function regularSession(t){const p=session(t);return !['Sat','Sun'].includes(p.weekday)&&p.minute>=570&&p.minute<960;}
export function stockSessionGap(a,b){const x=session(a),y=session(b);return x.day!==y.day&&x.minute===960&&y.minute===575&&b>a;}
export function stockBars(series,symbol,now){
 if(series?.meta?.symbol?.toUpperCase()!==symbol||series.meta.currency!=='USD'||!['Common Stock','ETF'].includes(series.meta.type))throw Error('UNSUPPORTED_INSTRUMENT');
 const raw=series.values;if(!Array.isArray(raw))throw Error('INVALID_BARS');
 const all=raw.map(b=>{const openTime=Date.parse(String(b.datetime).replace(' ','T')+'Z');return {openTime,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),closeTime:openTime+step,timeframe:'5m',closed:true};});
 if(all.some(b=>!Number.isFinite(b.openTime)||b.openTime%step!==0||!['open','high','low','close'].every(k=>positive(b[k]))||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))throw Error('INVALID_BARS');
 all.sort((a,b)=>a.closeTime-b.closeTime);if(new Set(all.map(b=>b.closeTime)).size!==all.length)throw Error('DUPLICATE_BARS');
 return all.filter(b=>regularSession(b.openTime)&&b.closeTime<=now).slice(-500);
}
export function stockObservation(quote,symbol,now){
 const at=Number(quote?.last_quote_at||quote?.timestamp)*1000,price=Number(quote?.close);
 if(quote?.symbol?.toUpperCase()!==symbol||quote.currency!=='USD'||!positive(price)||!Number.isFinite(at)||at>now+5000||now-at>20*60000||quote.is_market_open===false||!regularSession(at))throw Error('WAIT_FRESH_MARKET_PRICE');
 return {price,at};
}
export function newSimulation(now=Date.now(),feeBps=null){
 if(feeBps!==null&&(!Number.isFinite(feeBps)||feeBps<0||feeBps>1000))throw Error('INVALID_FEE');
 return {version:SIM_VERSION,createdAt:new Date(now).toISOString(),capital:10000,cash:10000,maxPositions:5,feeBps,positions:{},assets:{},journal:[],cursor:0,lastRunAt:null,lastCycle:null};
}
export function applyStockObservation(original,{symbol,series,quote,now=Date.now()}){
 const state=structuredClone(original),asset=state.assets[symbol]||{checks:0,usedPatterns:[],lastExitAt:null,lastPriceAt:null};state.assets[symbol]=asset;asset.checks++;asset.checkedAt=new Date(now).toISOString();
 try{
  const {price,at}=stockObservation(quote,symbol,now);
  if(at<Date.parse(state.createdAt)){asset.reason='WAIT_POST_START_PRICE';return state;}
  if(at<=Number(asset.lastPriceAt||0)){asset.reason='WAIT_NEW_PRICE';return state;}
  asset.price=price;asset.lastPriceAt=at;asset.delaySeconds=Math.max(0,Math.round((now-at)/1000));
  const position=state.positions[symbol];
  if(position){
   const exit=binancePositionExit(position,price,at);if(position.peakPrice>Number(position.previousPeak||position.entryPrice)){position.peakAt=new Date(at).toISOString();position.previousPeak=position.peakPrice;}
   position.mark=price;position.markAt=new Date(at).toISOString();asset.reason=exit.reason;
   if(exit.sell){
    const proceeds=position.qty*price,fee=state.feeBps===null?0:proceeds*state.feeBps/10000,gross=proceeds-position.cost;
    state.cash+=proceeds-fee;state.journal.push({id:symbol+':SELL:'+at,side:'SELL',symbol,at:new Date(at).toISOString(),observedAt:new Date(now).toISOString(),price,qty:position.qty,amount:proceeds,fee:state.feeBps===null?null:fee,entryFee:position.entryFee,grossPnl:gross,netPnl:state.feeBps===null?null:gross-fee-position.entryFee,reason:exit.reason,entryAt:position.entryAt,entryPrice:position.entryPrice,peakPrice:position.peakPrice,patternId:position.patternId,setup:position.setup});delete state.positions[symbol];asset.lastExitAt=at;asset.confirmation=null;
   }
   return state;
  }
  if(state.journal.length>=20000){asset.reason='HISTORY_CAPACITY_REACHED';return state;}
  const bars=stockBars(series,symbol,at);
  if(bars.length<3||at-bars.at(-1).closeTime>step)throw Error('WAIT_CURRENT_5M_BARS');
  let setup=evaluateWyckoff(bars,{now:at,timeframe:'5m',isSessionGap:stockSessionGap});
  setup=createLiveConfirmationTracker()(setup,{symbol,price,priceAsOf:new Date(at).toISOString(),now:at,priorLiveConfirmation:asset.confirmation});
  asset.setup=setup;asset.reason=setup.phase;
  if(setup.confirmation?.live)asset.confirmation=setup;
  if(!setup.buyConfirmed)return state;
  const id=setup.patternId;
  if(asset.usedPatterns.includes(id)){asset.reason='PATTERN_ALREADY_USED';return state;}
  if(asset.lastExitAt&&setup.initialPeak.time<=asset.lastExitAt){asset.reason='WAIT_NEW_POST_SALE_PATTERN';return state;}
  if(setup.signalInvalidated||price<setup.springLow.price||price>=setup.targetPrice){asset.invalidPatterns=[...new Set([...(asset.invalidPatterns||[]),id])];asset.reason='WYCKOFF_SIGNAL_INVALIDATED';return state;}
  if(asset.invalidPatterns?.includes(id)){asset.reason='WYCKOFF_SIGNAL_INVALIDATED';return state;}
  if(at>=setup.signalTime+20*60000){asset.reason='STALE_5M_SIGNAL';return state;}
  if(!(price>setup.firstLow.price)){asset.reason='WAIT_RECLAIM';return state;}
  const slots=Object.keys(state.positions).length;if(slots>=state.maxPositions){asset.reason='NO_FREE_SLOT';return state;}
  const grossBudget=Math.min(state.cash,slots===state.maxPositions-1?state.cash:state.capital/state.maxPositions),cost=grossBudget/(1+(state.feeBps||0)/10000),fee=grossBudget-cost;
  if(cost<5){asset.reason='INSUFFICIENT_SIM_CASH';return state;}
  const trade=createWyckoffTrade(setup,price);state.positions[symbol]={...trade,symbol,entryPrice:price,qty:cost/price,cost,entryFee:state.feeBps===null?null:fee,entryAt:new Date(at).toISOString(),peakPrice:price,peakAt:new Date(at).toISOString(),mark:price,markAt:new Date(at).toISOString(),exitPolicy:SPRING_EXIT_POLICY,stopLossPct:10,stopPrice:price*.9,effectiveStopPrice:price*.9,atrEnabled:false,profitRetentionPct:80,profitGivebackPct:20,minProfitHoldMs:MINIMUM_PROFIT_HOLD_MS};state.cash-=grossBudget;asset.usedPatterns.push(id);asset.reason='BUY';
  state.journal.push({id:symbol+':BUY:'+at,side:'BUY',symbol,at:new Date(at).toISOString(),observedAt:new Date(now).toISOString(),price,qty:cost/price,amount:cost,fee:state.feeBps===null?null:fee,reason:setup.confirmation?.live?'WYCKOFF_LIVE_RECLAIM':'WYCKOFF_RECLAIM',patternId:id,setup:trade.setup});
 }catch(e){asset.reason=String(e.message||'DATA_UNAVAILABLE').slice(0,120);}
 return state;
}
export function simulationSummary(state){
 const open=Object.values(state.positions),value=state.cash+open.reduce((s,p)=>s+p.qty*p.mark,0),sells=state.journal.filter(x=>x.side==='SELL');
 return {value,cash:state.cash,open:open.length,buys:state.journal.filter(x=>x.side==='BUY').length,sells:sells.length,grossRealized:sells.reduce((s,x)=>s+x.grossPnl,0),pnl:value-state.capital,netKnown:state.feeBps!==null};
}
