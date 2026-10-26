import {stockSessionGap} from './colmex-market-hours.mjs';
export const RESEARCH_PROTOCOL=Object.freeze({version:'TRADING_RESEARCH_V1',mode:'OBSERVATION_ONLY',timeframeMs:300000,horizonMs:1800000,maxHorizonMs:2100000,maxSamples:2000,retentionDays:90,developmentDays:14,validationDays:7,holdoutDays:7,embargoMs:2100000,minIntervalDays:30,minIntervalSamples:100,bootstrapReplicates:400,meanBlockDays:5,registeredVariants:5,costStressBps:[10,30,60]});
const DAY=86400000,STEP=300000,positive=x=>Number.isFinite(x)&&x>0,mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const closeAt=b=>b.closeTime%STEP===STEP-1?b.closeTime+1:b.closeTime;
const day=t=>new Date(t).toISOString().slice(0,10);
const pct=(a,b)=>100*(a/b-1);

// All features end at the observed time; unfinished candles cannot influence them.
export function researchSnapshot(input,at,{continuous=false}={}){
 const bars=input.filter(b=>b.closed!==false&&Number.isFinite(b.closeTime)&&closeAt(b)<=at).map(b=>({...b,closeTime:closeAt(b)})).slice(-205);
 const invalid=bars.some((b,i)=>![b.open,b.high,b.low,b.close].every(positive)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||i&&!(b.closeTime-bars[i-1].closeTime===STEP||!continuous&&stockSessionGap(bars[i-1].closeTime,b.closeTime)));
 if(invalid||bars.length<49||at-bars.at(-1).closeTime>STEP)return {ready:false,regime:'UNKNOWN',reason:invalid?'INVALID_OR_GAPPED_BARS':'INSUFFICIENT_OR_STALE_BARS'};
 const closes=bars.map(b=>b.close),price=closes.at(-1),tr=bars.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-closes[i]),Math.abs(b.low-closes[i])));
 let atr=mean(tr.slice(0,14));for(const v of tr.slice(14))atr=(atr*13+v)/14;
 const momentum12Pct=pct(price,closes.at(-13)),momentum48Pct=pct(price,closes.at(-49)),atrPct=100*atr/price;
 const last20=bars.slice(-20),previous20=bars.slice(-21,-1),validVolume=bars.slice(-21).every(b=>Number.isFinite(b.volume)&&b.volume>=0);
 const baseVolume=validVolume?mean(previous20.map(b=>b.volume)):null,totalVolume=validVolume?last20.reduce((s,b)=>s+b.volume,0):0;
 const vwap20=totalVolume>0?last20.reduce((s,b)=>s+(b.high+b.low+b.close)/3*b.volume,0)/totalVolume:null;
 const recent=closes.slice(-21),distance=recent.slice(1).reduce((s,x,i)=>s+Math.abs(x-recent[i]),0),efficiency20=distance>0?Math.abs(recent.at(-1)-recent[0])/distance:0;
 // Descriptive, predeclared classification; not a new entry filter.
 const regime=momentum12Pct>atrPct&&momentum48Pct>0?'UP':momentum12Pct < -atrPct&&momentum48Pct<0?'DOWN':'MIXED';
 return {ready:true,regime,dataAt:bars.at(-1).closeTime,momentum12Pct,momentum48Pct,atrPct,efficiency20,volumeRatio:positive(baseVolume)?bars.at(-1).volume/baseVolume:null,vwapDistancePct:vwap20?pct(price,vwap20):null};
}

// Boundaries are frozen at collection start, never moved to improve historical results.
export function researchPhase(at,endAt,startedAt){
 const boundaries=[14,21,28].map(d=>startedAt+d*DAY),labels=['development','validation','holdout','continuation'];
 const index=boundaries.findIndex(b=>at<b),phase=index<0?3:index;
 if(boundaries.some(b=>at<b&&endAt>=b||at>=b&&at<b+RESEARCH_PROTOCOL.embargoMs))return 'embargo';
 return labels[phase];
}

export function appendResearchOutcome(review,row,end,bars){
 if(row.researchVersion!==RESEARCH_PROTOCOL.version||!row.context||!Number.isFinite(review.researchStartedAt))return;
 const endAt=closeAt(end),path=bars.filter(b=>b.closed!==false&&closeAt(b)>row.at&&closeAt(b)<=endAt).map(b=>({at:closeAt(b),close:b.close})).sort((a,b)=>a.at-b.at);
 const first=(Math.floor(row.at/STEP)+1)*STEP,count=(endAt-first)/STEP+1;
 const pathComplete=Number.isInteger(count)&&count>0&&path.length===count&&path.every((b,i)=>b.at===first+i*STEP&&positive(b.close));
 const changes=pathComplete?[0,...path.map(b=>pct(b.close,row.price))]:null;
 const sample={id:row.id,group:row.group,symbol:row.symbol,at:row.at,endAt,returnPct:pct(end.close,row.price),context:row.context,phase:researchPhase(row.at,endAt,review.researchStartedAt),pathComplete,favorableClosePct:changes?Math.max(...changes):null,adverseClosePct:changes?Math.min(...changes):null};
 review.researchSamples??=[];
 if(review.researchSamples.some(s=>s.id===sample.id))return;
 review.researchSamples.push(sample);review.researchSamples.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
 const cutoff=endAt-RESEARCH_PROTOCOL.retentionDays*DAY,kept=review.researchSamples.filter(s=>s.at>=cutoff).slice(-RESEARCH_PROTOCOL.maxSamples);
 review.researchPruned=(review.researchPruned||0)+review.researchSamples.length-kept.length;review.researchSamples=kept;
}

// Stationary bootstrap of whole observed UTC-day clusters, including all symbols in each day.
// Exploratory percentile interval only: not adjusted for selection or multiple comparisons.
export function dayBlockInterval(samples){
 const byDay=new Map();for(const s of samples){const key=day(s.at),g=byDay.get(key)||{sum:0,n:0};g.sum+=s.returnPct;g.n++;byDay.set(key,g);}
 const days=[...byDay.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,g])=>g),n=days.length;
 if(n<RESEARCH_PROTOCOL.minIntervalDays||samples.length<RESEARCH_PROTOCOL.minIntervalSamples)return null;
 let seed=20261027;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;},means=[];
 for(let r=0;r<RESEARCH_PROTOCOL.bootstrapReplicates;r++){
  let i=Math.floor(random()*n),sum=0,count=0;
  for(let j=0;j<n;j++){if(j)i=random()<1/RESEARCH_PROTOCOL.meanBlockDays?Math.floor(random()*n):(i+1)%n;sum+=days[i].sum;count+=days[i].n;}
  means.push(sum/count);
 }
 means.sort((a,b)=>a-b);return {low:means[Math.floor(means.length*.025)],high:means[Math.ceil(means.length*.975)-1],days:n,method:'STATIONARY_DAY_BLOCK_PERCENTILE_95_EXPLORATORY'};
}
function summarize(samples,{interval=false}={}){
 const usable=samples.filter(s=>Number.isFinite(s.returnPct)),n=usable.length,returns=usable.map(s=>s.returnPct),paths=usable.filter(s=>s.pathComplete);
 return {samples:n,days:new Set(usable.map(s=>day(s.at))).size,meanReturnPct:mean(returns),positivePct:n?100*returns.filter(x=>x>0).length/n:null,pathComplete:paths.length,meanFavorableClosePct:mean(paths.map(s=>s.favorableClosePct)),meanAdverseClosePct:mean(paths.map(s=>s.adverseClosePct)),interval:interval?dayBlockInterval(usable):null,costStress:RESEARCH_PROTOCOL.costStressBps.map(bps=>({roundTripBps:bps,meanReturnAfterAssumedCostPct:n?mean(returns)-bps/100:null}))};
}
export function tradingResearchReport(review){
 const samples=review?.researchSamples||[],groups=new Map();
 for(const s of samples){if(!groups.has(s.group))groups.set(s.group,[]);groups.get(s.group).push(s);}
 return {protocol:RESEARCH_PROTOCOL,startedAt:review?.researchStartedAt??null,retained:samples.length,pruned:review?.researchPruned||0,
  inference:'EXPLORATORY_NOT_PROFIT_OR_SIGNIFICANCE',groups:[...groups].map(([key,rows])=>{
   const [version,entryMode,variant]=key.split('|');return {version,entryMode,variant,...summarize(rows.filter(s=>s.phase!=='embargo'),{interval:true}),embargoed:rows.filter(s=>s.phase==='embargo').length,
    phases:['development','validation','holdout','continuation'].map(phase=>({phase,...summarize(rows.filter(s=>s.phase===phase))})),
    regimes:['UP','DOWN','MIXED','UNKNOWN'].map(regime=>({regime,...summarize(rows.filter(s=>s.phase!=='embargo'&&s.context.regime===regime))}))};
  }),latest:[...samples].sort((a,b)=>b.at-a.at).filter((s,i,a)=>a.findIndex(x=>x.symbol===s.symbol&&x.at===s.at)===i).slice(0,5).map(s=>({symbol:s.symbol,at:s.at,...s.context}))};
}
