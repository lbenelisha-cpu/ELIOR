import {evaluateWyckoff,validateDailyBars} from './wyckoff-strategy.mjs';
const keys=['initialPeak','firstLow','rallyHigh','secondaryTest','secondRallyHigh','springLow','confirmation'];
// Detect at each historical close, never with a future bar. A later lower Spring
// or reclaim updates the same structural setup rather than counting it again.
export function scanWyckoffOccurrences(bars,{now=Date.now(),isSessionGap=null}={}){
 if(bars.length<3)return [];
 const memo=new Map(),gap=(a,b)=>{const key=a+':'+b;if(!memo.has(key))memo.set(key,typeof isSessionGap==='function'&&isSessionGap(a,b));return memo.get(key);};
 validateDailyBars(bars,{now,timeframe:'5m',isSessionGap:gap});
 const found=new Map();
 for(let end=3;end<=bars.length;end++){
  const at=bars[end-1].closeTime,s=evaluateWyckoff(bars.slice(0,end),{now:at,timeframe:'5m',isSessionGap:gap,requireHigherRecovery:true});
  if(!(s.phase==='SPRING'||s.buyConfirmed)||!s.secondaryTest||!s.springLow)continue;
  const id='W5:'+s.initialPeak.time+':'+s.firstLow.time+':'+s.secondaryTest.time,prior=found.get(id),setup={};for(const key of keys)if(s[key]&&(key!=='confirmation'||s.buyConfirmed))setup[key]={...s[key]};setup.recoveryComparison=s.recoveryComparison;setup.requireHigherRecovery=true;
  found.set(id,{id,detectedAt:prior?.detectedAt||at,springAt:s.springLow.time,confirmedAt:prior?.confirmedAt||(s.buyConfirmed?s.confirmation?.time:null)||null,setup,source:'CLOSED_5M_RECONSTRUCTION'});
 }
 return [...found.values()].sort((a,b)=>a.detectedAt-b.detectedAt);
}
export function mergeWyckoffOccurrences(previous,incoming,now=Date.now()){
 const records=new Map((previous||[]).map(x=>[x.id,x]));
 for(const x of incoming){const old=records.get(x.id),recorded=old?.source==='TRADE_RECORDED_SETUP'&&x.source!=='TRADE_RECORDED_SETUP';
  // Recompute cached chart-only confirmations under the current rule; retain
  // genuine saved historical decisions/trades as facts of their original rule.
  const current=x.source==='CLOSED_5M_RECONSTRUCTION'&&x.setup?.requireHigherRecovery;
  records.set(x.id,{...old,...(recorded?old:x),detectedAt:Math.min(old?.detectedAt||Infinity,x.detectedAt),confirmedAt:recorded?old.confirmedAt:current?x.confirmedAt??null:old?.confirmedAt||x.confirmedAt||null});
 }
 return [...records.values()].filter(x=>x.detectedAt>=now-90*86400000).sort((a,b)=>a.detectedAt-b.detectedAt).slice(-2000);
}

export function recordedWyckoffOccurrences(setups){
 return setups.filter(s=>s?.initialPeak&&s.firstLow&&s.rallyHigh&&s.secondaryTest&&s.springLow).map(setup=>({id:'W5:'+setup.initialPeak.time+':'+setup.firstLow.time+':'+setup.secondaryTest.time,detectedAt:setup.springLow.time,springAt:setup.springLow.time,confirmedAt:setup.confirmation&&!setup.confirmation.spring?setup.confirmation.time:null,setup,source:'TRADE_RECORDED_SETUP'}));
}
