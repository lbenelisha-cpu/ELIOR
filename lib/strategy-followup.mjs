import {entryComparisonReport} from './entry-method-comparison.mjs';
import {RESEARCH_PROTOCOL,researchSnapshot,appendResearchOutcome,tradingResearchReport} from './trading-research.mjs';
const variants=['legacy','confirmed','confirmed_trend','confirmed_volume','full_quality'];
const positive=n=>Number.isFinite(n)&&n>0;
// Forward observations, not simulated fills: no intrabar path, fee, stop or profit claims.
export function recordStrategyObservation(state,{symbol,bars,at,price,comparison,version}){
 if(!comparison||!positive(price)||!Number.isFinite(at))return;
 bars=bars.map(b=>b.closeTime%300000===299999?{...b,closeTime:b.closeTime+1}:b);
 const review=state.strategyFollowup??={version:1,startedAt:at,seen:[],pending:[],groups:{},dropped:0};
 review.researchStartedAt??=at;
 review.seen=review.seen.filter(item=>item.at>=at-7*86400000);
 const day=t=>new Date(t).toISOString().slice(0,10);
 for(const row of review.pending.filter(r=>r.symbol===symbol)){
  const end=bars.filter(b=>b.closed!==false&&b.closeTime>=row.at+1800000&&b.closeTime<=at&&b.closeTime<=row.at+2100000&&positive(b.close)).sort((a,b)=>a.closeTime-b.closeTime)[0];
  if(end&&(row.continuous||day(end.closeTime)===day(row.at))){
   const group=review.groups[row.group],change=(end.close/row.price-1)*100;
   group.resolved++;group.positive+=change>0?1:0;group.returnSum+=change;group.lastAt=end.closeTime;row.done=true;
   appendResearchOutcome(review,row,end,bars);
  }else if(at>row.at+2700000){review.groups[row.group].expired++;row.done=true;}
 }
 review.pending=review.pending.filter(r=>!r.done);
 let context=null;
 for(const variant of variants){
  const signal=variant==='legacy'?comparison.legacy:comparison.confirmed;if(!comparison.variants[variant]||!signal?.patternId)continue;
  const group=[version,signal.entryMode,variant].join('|'),id=[symbol,group,signal.patternId].join('|');
  if(review.seen.some(item=>item.id===id))continue;
  if(review.pending.length>=1000||review.seen.length>=10000){review.dropped++;continue;}
  review.groups[group]??={version,entryMode:signal.entryMode,variant,observed:0,resolved:0,positive:0,returnSum:0,expired:0};
  const continuous=version.startsWith('BINANCE_');context??=researchSnapshot(bars,at,{continuous});
  review.groups[group].observed++;review.seen.push({id,at});review.pending.push({id,group,symbol,at,price,continuous,context,researchVersion:RESEARCH_PROTOCOL.version});
 }
 review.lastAt=at;
}
export function strategyFollowupReport(state,closed=[]){
 const r=state.strategyFollowup,groups=new Map();
 for(const row of closed){
  const version=row.entryPolicyVersion||'LEGACY_OR_UNKNOWN',entryMode=row.entryMode||'unknown',key=version+'|'+entryMode;
  if(!groups.has(key))groups.set(key,{version,entryMode,closed:0,grossKnown:0,grossPnl:0,netKnown:0,netPnl:0,wins:0,losses:0,winSum:0,lossSum:0,curve:0,peak:0,maxClosedDrawdown:0});
  const g=groups.get(key);g.closed++;
  if(!row.accountingAdjusted&&Number.isFinite(row.grossPnl)){g.grossKnown++;g.grossPnl+=row.grossPnl;}
  if(!row.accountingAdjusted&&Number.isFinite(row.netPnl)){
   const net=row.netPnl;g.netKnown++;g.netPnl+=net;if(net>0){g.wins++;g.winSum+=net;}if(net<0){g.losses++;g.lossSum+=net;}
   g.curve+=net;g.peak=Math.max(g.peak,g.curve);g.maxClosedDrawdown=Math.max(g.maxClosedDrawdown,g.peak-g.curve);
  }
 }
 return {startedAt:r?.startedAt??null,lastAt:r?.lastAt??null,dropped:r?.dropped||0,method:'OBSERVED_30M_PRICE_RETURN_NO_FEES_OR_EXECUTION',entryComparison:entryComparisonReport(state),research:tradingResearchReport(r),
  observations:Object.values(r?.groups||{}).map(g=>({...g,meanReturnPct:g.resolved?g.returnSum/g.resolved:null,positivePct:g.resolved?100*g.positive/g.resolved:null})),
  actual:[...groups.values()].map(g=>({...g,netPnl:g.netKnown===g.closed?g.netPnl:null,netWinRate:g.netKnown===g.closed&&g.closed?100*g.wins/g.closed:null,expectancyNet:g.netKnown===g.closed&&g.closed?g.netPnl/g.closed:null,profitFactor:g.netKnown===g.closed&&g.lossSum<0?g.winSum/Math.abs(g.lossSum):null,averageWin:g.wins?g.winSum/g.wins:null,averageLoss:g.losses?g.lossSum/g.losses:null,maxClosedDrawdown:g.netKnown===g.closed?g.maxClosedDrawdown:null}))};
}
