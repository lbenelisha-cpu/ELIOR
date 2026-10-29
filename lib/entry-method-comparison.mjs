// Candle replay only. This module has no broker, order or credential dependency.
import {qualityEntry,qualityMeasures} from './confirmed-entry-quality.mjs';
import {stockSessionGap,regularSession} from './colmex-market-hours.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
import {applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
const STEP=300000,DAY=86400000,positive=n=>Number.isFinite(n)&&n>0;
export const ENTRY_COMPARISON_POLICY=Object.freeze({version:'ENTRY_METHOD_COMPARISON_V1',mode:'SIMULATION_ONLY',methods:['current','breakout'],lookbackBars:20,minVolumeRatio:1.5,minMeanDollarVolume:10000,riskUnits:1,maxSymbols:150,maxCohorts:6,maxClosed:1000,developmentDays:14,validationDays:7,holdoutDays:7});
// Declared assumptions, not the account's fee schedule. Costs apply on BOTH legs.
export const COMPARISON_COSTS=Object.freeze({BINANCE:{feeBps:10,halfSpreadBps:5,slippageBps:5},COLMEX:{feeBps:15,halfSpreadBps:10,slippageBps:10}});
export function comparisonBars(input,at,platform){
 if(!['BINANCE','COLMEX'].includes(platform))throw Error('UNKNOWN_PLATFORM');
 const bars=input.filter(b=>b.closed!==false&&Number(b.closeTime)<=at).map(b=>({...b,closeTime:b.closeTime%STEP===STEP-1?b.closeTime+1:b.closeTime})).filter(b=>b.closeTime<=at);
 if(bars.some((b,i)=>!['open','high','low','close'].every(k=>positive(b[k]))||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low||!Number.isFinite(b.openTime)||b.closeTime-b.openTime!==STEP||b.openTime%STEP!==0||platform==='COLMEX'&&!regularSession(b.openTime)||i&&b.closeTime<=bars[i-1].closeTime))throw Error('INVALID_COMPARISON_BARS');
 // Callers may supply a bounded window, but cannot hide an internal missing bar.
 return bars;
}
const follows=(before,after,platform)=>after-before===STEP||platform==='COLMEX'&&stockSessionGap(before,after);
export function independentBreakout(bars,at,platform){
 const p=ENTRY_COMPARISON_POLICY,bar=bars.at(-1),previous=bars.slice(-p.lookbackBars-1,-1);
 if(!bar||at-bar.closeTime>=STEP||previous.length!==p.lookbackBars)return {ready:false,reason:'WAIT_BREAKOUT_HISTORY'};
 if([...previous,bar].some(b=>!Number.isFinite(b.volume)||b.volume<0))return {ready:false,reason:'WAIT_VOLUME_HISTORY'};
 const level=Math.max(...previous.map(b=>b.high)),meanVolume=previous.reduce((n,b)=>n+b.volume,0)/previous.length;
 const meanDollarVolume=previous.reduce((n,b)=>n+b.volume*b.close,0)/previous.length;
 const volumeRatio=meanVolume>0?bar.volume/meanVolume:null,measures=qualityMeasures(bars,bars.length-1,bar.close);
 const reason=bar.close<=level?'WAIT_BREAKOUT':!positive(volumeRatio)?'WAIT_VOLUME_HISTORY':volumeRatio<p.minVolumeRatio?'BREAKOUT_VOLUME_LOW':meanDollarVolume<p.minMeanDollarVolume?'BREAKOUT_LIQUIDITY_LOW':!measures.trend.ready?'WAIT_MA_HISTORY':measures.trend.blocked?'MA_DOWNTREND_BLOCK':'READY';
 return {ready:reason==='READY',reason,signalId:'breakout:'+bar.closeTime,at:bar.closeTime,price:bar.close,level,volumeRatio,meanDollarVolume};
}
export function comparisonSignals(bars,platform){
 const bar=bars.at(-1),now=bar.closeTime;
 if(bars.length<204)return {current:{ready:false,reason:'WAIT_MA_HISTORY'},breakout:{ready:false,reason:'WAIT_MA_HISTORY'}};
 const current=qualityEntry(bars,now,0,[],{price:bar.close,priceAsOf:now},{ready:false},{platform,isSessionGap:platform==='COLMEX'?stockSessionGap:null});
 return {current:{ready:current.ready,reason:current.reason,signalId:current.setup?.patternId,at:current.setup?.signalTime??now,price:bar.close,entryMode:current.setup?.entryMode??null},breakout:independentBreakout(bars,now,platform)};
}
export function blockerCategory(reason){
 const code=String(reason||'UNKNOWN');
 if(/^(READY|BUY_READY|SIGNAL_READY_OBSERVATION_ONLY)$/.test(code))return 'READY';
 if(/OUTSIDE_REGULAR_SESSION|MARKET_CLOSED/.test(code))return 'MARKET_HOURS';
 if(/SLOT|CASH|BALANCE|BUDGET|QUANTITY|MIN_NOTIONAL|INSUFFICIENT|RISK_TOO_HIGH|ALLOCATION|BELOW_MINIMUM|LIVE_ORDER_LIMIT/.test(code))return 'CAPITAL_OR_RISK';
 if(/QUOTE|HISTORY|SCHEMA|NETWORK|RATE_LIMIT|STALE|INSTRUMENT|EVALUATION_DATA|SCAN_DATA|COMPARISON_HISTORY/.test(code))return 'DATA';
 if(/AUTH|ACCOUNT|BROKER|PERMISSION|BRACKET|PENDING|UNRESOLVED|REVIEW|PAUSED|DISABLED|PROTECTION|JOURNAL|POSITION|ACTIVE_LONG|LIVE_STATE/.test(code))return 'ACCOUNT_OR_EXECUTION';
 if(/DATA|HISTORY|STALE|QUOTE|NETWORK|RATE_LIMIT|SCHEMA|INSTRUMENT|UNAVAILABLE|CONNECTED|EVALUATION|ERROR/.test(code))return 'DATA';
 return 'STRATEGY';
}
export function recordEntryBlocker(state,{symbol='*',at=Date.now(),reason,entryBlockReason=null,technicalReady=null,universe=null}){
 const root=state.entryComparison??={version:ENTRY_COMPARISON_POLICY.version,startedAt:at,cohorts:[],diagnostics:{}};
 if(root.version!==ENTRY_COMPARISON_POLICY.version)return;
 if(universe)root.universe=[...new Set(universe)].slice(0,ENTRY_COMPARISON_POLICY.maxSymbols);
 root.diagnostics??={};
 if(!Object.hasOwn(root.diagnostics,symbol)&&Object.keys(root.diagnostics).length>=ENTRY_COMPARISON_POLICY.maxSymbols+1)return;
 root.diagnostics[symbol]={symbol,at,technicalReady,reason:reason||'UNKNOWN',category:blockerCategory(reason),entryBlockReason,entryBlockCategory:entryBlockReason?blockerCategory(entryBlockReason):null};
}
const costsFor=(platform,input)=>{
 const c={...COMPARISON_COSTS[platform],...input};
 if(Object.keys(c).some(k=>!['feeBps','halfSpreadBps','slippageBps'].includes(k))||Object.values(c).some(v=>!Number.isFinite(v)||v<0||v>500))throw Error('INVALID_COMPARISON_COSTS');
 return c;
};
const phase=(at,start)=>at<start+14*DAY?'development':at<start+21*DAY?'validation':at<start+28*DAY?'holdout':'continuation';
function createTrade(pending,bar,config){
 const drag=(config.costs.halfSpreadBps+config.costs.slippageBps)/10000,entryPrice=bar.open*(1+drag),qty=1/(entryPrice*config.settings.stopLossPct/100);
 return applyTrailingExitPolicy({symbol:pending.symbol,method:pending.method,signalId:pending.signalId,signalAt:pending.signalAt,entryAt:bar.openTime,entryPrice,qty,entryCost:qty*entryPrice*(1+config.costs.feeBps/10000),peakPrice:entryPrice,lastCloseAt:bar.openTime,ambiguousBars:0},config.settings);
}
const proceeds=(trade,price,costs)=>trade.qty*price*(1-(costs.halfSpreadBps+costs.slippageBps)/10000)*(1-costs.feeBps/10000);
function pricePath(original,bar,config,path){
 const t=structuredClone(original);let exit=null;
 for(let i=0;i<path.length;i++){
  const price=path[i];
  // A gap through a stop executes at the available open, never the old stop.
  if(price<=t.effectiveStopPrice){exit={price:i===0?price:t.effectiveStopPrice,reason:t.profitFloorArmed?'TRAILING_STOP':'STOP_LOSS'};break;}
  if(price>=t.targetPrice){exit={price:t.targetPrice,reason:'TAKE_PROFIT'};break;}
  t.peakPrice=Math.max(t.peakPrice,price);applyTrailingExitPolicy(t,config.settings);
 }
 if(exit){const netR=proceeds(t,exit.price,config.costs)-t.entryCost;return {trade:t,exit:{...exit,exitAt:bar.closeTime,netR},endValue:netR};}
 return {trade:t,exit:null,endValue:proceeds(t,bar.close,config.costs)-t.entryCost};
}
export function simulateComparisonBar(trade,bar,config){
 const lowFirst=pricePath(trade,bar,config,[bar.open,bar.low,bar.high,bar.close]);
 const highFirst=pricePath(trade,bar,config,[bar.open,bar.high,bar.low,bar.close]);
 const selected=lowFirst.endValue<=highFirst.endValue?lowFirst:highFirst;
 const ambiguous=!!lowFirst.exit!==!!highFirst.exit||lowFirst.exit?.price!==highFirst.exit?.price||lowFirst.exit?.reason!==highFirst.exit?.reason;
 selected.trade.ambiguousBars+=(ambiguous?1:0);selected.trade.lastCloseAt=bar.closeTime;
 return selected;
}
function processBar(cohort,item,method,bar,config,signals){
 const stream=item.methods[method]??={seen:[],pending:null,position:null,signals:0,skippedWhileOpen:0};
 if(stream.pending){
  if(follows(stream.pending.signalAt,bar.closeTime,config.platform)&&bar.openTime-stream.pending.signalAt<STEP*3)stream.position=createTrade(stream.pending,bar,config);
  else stream.expired=(stream.expired||0)+1;
  stream.pending=null;
 }
 if(stream.position){
  const result=simulateComparisonBar(stream.position,bar,config);
  stream.position=result.trade;
  if(result.exit){
   cohort.closed.push({...result.trade,...result.exit,phase:phase(result.trade.signalAt,cohort.startedAt),crossesPhase:phase(result.trade.signalAt,cohort.startedAt)!==phase(result.exit.exitAt,cohort.startedAt)});stream.position=null;
   if(cohort.closed.length>ENTRY_COMPARISON_POLICY.maxClosed){cohort.closed.sort((a,b)=>a.exitAt-b.exitAt||a.symbol.localeCompare(b.symbol));cohort.closed.shift();cohort.pruned++;}
  }
 }
 const signal=signals?.[method];
 if(signal?.ready&&signal.signalId&&!stream.seen.includes(signal.signalId)){
  stream.seen.push(signal.signalId);stream.seen=stream.seen.slice(-200);stream.signals++;
  if(stream.position)stream.skippedWhileOpen++;
  else stream.pending={symbol:item.symbol,method,signalId:signal.signalId,signalAt:bar.closeTime};
 }
 stream.lastSignal=signal?{...signal}:stream.lastSignal;
}
// The two methods see precisely the same closed candles. Replay starts at the
// first observation; later backfilled bars are simulation, never claimed fills.
export function observeEntryComparison(state,{symbol,bars,at,platform,settings={},costs,universe=null}){
 if(!state.entryComparison)recordEntryBlocker(state,{symbol,at,reason:'WAIT_COMPARISON_DATA',universe});
 if(universe)state.entryComparison.universe=[...new Set(universe)].slice(0,ENTRY_COMPARISON_POLICY.maxSymbols);
 const root=state.entryComparison;
 try{
  const data=comparisonBars(bars,at,platform),exits=validateTradeSettings(settings);
  if(!data.length)throw Error('WAIT_COMPARISON_HISTORY');
  const config={platform,settings:exits,costs:costsFor(platform,costs)},key=JSON.stringify(config);
  let current=root.cohorts.find(c=>c.key===key);
  if(!current){
   if(root.cohorts.length>=ENTRY_COMPARISON_POLICY.maxCohorts)throw Error('COMPARISON_COHORT_CAPACITY');
   current={id:root.cohorts.length+1,key,config,startedAt:at,items:{},closed:[],pruned:0};root.cohorts.push(current);
  }
  root.activeId=current.id;root.lastAt=at;
  for(const c of root.cohorts){
   let item=c.items[symbol];
   if(!item&&c!==current)continue;
   if(!item){
    if(Object.keys(c.items).length>=ENTRY_COMPARISON_POLICY.maxSymbols)throw Error('COMPARISON_SYMBOL_CAPACITY');
    const last=data.at(-1);
    // A stale snapshot cannot initialize a cohort at an already elapsed signal.
    item=c.items[symbol]={symbol,lastAt:last.closeTime,methods:{},lastObservedAt:at,initializedAt:at};
    if(at-last.closeTime>=STEP){item.stale=true;continue;}
    if(data.some((b,i)=>i&&!follows(data[i-1].closeTime,b.closeTime,platform))){item.error='GAPPED_COMPARISON_HISTORY';continue;}
    const signals=comparisonSignals(data,platform);
    for(const method of ENTRY_COMPARISON_POLICY.methods){item.methods[method]={seen:[],pending:null,position:null,signals:0,skippedWhileOpen:0,lastSignal:signals[method]};}
    // Collect from the next completed candle, not a retrospective entry at install.
    continue;
   }
   item.lastObservedAt=at;
   const newBars=data.filter(b=>b.closeTime>item.lastAt);
   for(const bar of newBars){
    if(!follows(item.lastAt,bar.closeTime,platform)){
     item.error='COMPARISON_PATH_GAP';item.gaps=(item.gaps||0)+1;
     for(const m of Object.values(item.methods)){if(m.position){m.incomplete=(m.incomplete||0)+1;m.position=null;}if(m.pending){m.incomplete=(m.incomplete||0)+1;m.pending=null;}}
    }
    const index=data.indexOf(bar),prefix=data.slice(0,index+1);
    let start=0;for(let i=1;i<prefix.length;i++)if(!follows(prefix[i-1].closeTime,prefix[i].closeTime,platform))start=i;
    const usable=prefix.slice(start);
    const signals=c===current&&bar.closeTime>c.startedAt?comparisonSignals(usable,platform):null;
    for(const method of ENTRY_COMPARISON_POLICY.methods)processBar(c,item,method,bar,c.config,signals);
    item.lastAt=bar.closeTime;
   }
   item.stale=at-data.at(-1).closeTime>=STEP;
  }
  root.error=null;
 }catch(error){root.error=['UNKNOWN_PLATFORM','INVALID_COMPARISON_BARS','COMPARISON_COHORT_CAPACITY','COMPARISON_SYMBOL_CAPACITY','INVALID_COMPARISON_COSTS','WAIT_COMPARISON_HISTORY'].includes(error.message)?error.message:'COMPARISON_EVALUATION_FAILED';}
}
function summarize(rows){
 const sorted=[...rows].sort((a,b)=>a.exitAt-b.exitAt||a.symbol.localeCompare(b.symbol));
 let total=0,peak=0,drawdown=0;
 // Tied exits are one event, avoiding arbitrary symbol-order drawdowns.
 const events=new Map();for(const r of sorted)events.set(r.exitAt,(events.get(r.exitAt)||0)+r.netR);
 for(const net of events.values()){total+=net;peak=Math.max(peak,total);drawdown=Math.max(drawdown,peak-total);}
 const wins=rows.filter(r=>r.netR>0),losses=rows.filter(r=>r.netR<0),loss=losses.reduce((n,r)=>n-r.netR,0),win=wins.reduce((n,r)=>n+r.netR,0);
 return {closed:rows.length,netR:total,meanNetR:rows.length?total/rows.length:null,winRate:rows.length?100*wins.length/rows.length:null,profitFactor:loss>0?win/loss:null,maxClosedDrawdownR:drawdown,ambiguousTrades:rows.filter(r=>r.ambiguousBars>0).length};
}
export function entryComparisonReport(state){
 const root=state.entryComparison;
 if(!root)return null;
 return {policy:ENTRY_COMPARISON_POLICY,startedAt:root.startedAt,lastAt:root.lastAt??null,activeId:root.activeId??null,error:root.error??null,universe:root.universe||[],diagnostics:Object.values(root.diagnostics||{}).sort((a,b)=>b.at-a.at),
  cohorts:root.cohorts.map(c=>({id:c.id,config:c.config,startedAt:c.startedAt,pruned:c.pruned,symbols:Object.keys(c.items).length,dataProblems:Object.values(c.items).filter(i=>i.error).map(i=>({symbol:i.symbol,reason:i.error})),methods:ENTRY_COMPARISON_POLICY.methods.map(method=>{
   const streams=Object.values(c.items).map(i=>i.methods[method]).filter(Boolean),rows=c.closed.filter(r=>r.method===method);
   return {method,...summarize(rows),signals:streams.reduce((n,s)=>n+s.signals,0),open:streams.filter(s=>s.position).length,pending:streams.filter(s=>s.pending).length,incomplete:streams.reduce((n,s)=>n+(s.incomplete||0),0),expired:streams.reduce((n,s)=>n+(s.expired||0),0),skippedWhileOpen:streams.reduce((n,s)=>n+s.skippedWhileOpen,0),phases:['development','validation','holdout','continuation'].map(p=>({phase:p,...summarize(rows.filter(r=>r.phase===p&&!r.crossesPhase))})),crossesPhase:rows.filter(r=>r.crossesPhase).length};
  }),latest:[...c.closed].sort((a,b)=>b.exitAt-a.exitAt).slice(0,10).map(r=>({symbol:r.symbol,method:r.method,signalAt:r.signalAt,entryAt:r.entryAt,exitAt:r.exitAt,entryPrice:r.entryPrice,exitPrice:r.price,reason:r.reason,netR:r.netR,ambiguousBars:r.ambiguousBars})),open:Object.values(c.items).flatMap(i=>Object.entries(i.methods).filter(([,s])=>s.position).map(([method,s])=>({symbol:i.symbol,method,lastAt:i.lastAt,entryPrice:s.position.entryPrice,stopPrice:s.position.effectiveStopPrice}))) }))};
}
