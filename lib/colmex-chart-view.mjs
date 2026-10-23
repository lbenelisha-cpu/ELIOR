import {evaluateWyckoff} from './wyckoff-strategy.mjs';
import {buildColmexMarks} from './colmex-chart-marks.mjs';
import {regularSession,stockSessionGap} from './colmex-simulation.mjs';
import {scanWyckoffOccurrences} from './wyckoff-occurrences.mjs';
import {markBarIndex} from './colmex-chart-marks.mjs?v=20261017-intervals';
const dayKey=b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)?b.date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(b.date));
// Market closures do not consume the window: show the last two actual trading dates.
export function lastTwoTradingDays(bars,interval='5min'){
 if(!Array.isArray(bars)||!bars.length)return [];
 if(['1week','1month'].includes(interval))return [];
 const days=[...new Set(bars.map(dayKey))].sort().slice(-2),allowed=new Set(days);
 return bars.filter(b=>allowed.has(dayKey(b)));
}
export function startCandleFlashing({root,control,doc=globalThis.document,schedule=globalThis.setInterval}){
 const reset=()=>root.classList.remove('candle-phase-off');
 control.addEventListener('change',reset);
 doc.addEventListener('visibilitychange',reset);
 return schedule(()=>{
  if(doc.hidden||!control.checked||!root.querySelector('.sim-candle-flash')){reset();return;}
  root.classList.toggle('candle-phase-off');
 },650);
}

function closedAnalysisBars(bars,now){return bars.map(b=>({...b,openTime:Date.parse(b.date),closeTime:Date.parse(b.date)+300000,timeframe:'5m'})).filter(b=>b.closeTime<=now&&b.openTime>=now-7*86400000&&regularSession(b.openTime));}
export function chartAnalysisMarks(bars,now=Date.now(),{position=null,after=0}={}){
 if(position){
  const marks=buildColmexMarks({positions:{chart:position}},'chart');
  for(const list of [marks.points,marks.cards,marks.lines])for(const p of list)p.name=p.name.replace('מדומה','בחשבון');
  return marks;
 }
 let closed=closedAnalysisBars(bars,now);
 let start=0;for(let i=1;i<closed.length;i++)if(closed[i].closeTime-closed[i-1].closeTime!==300000&&!stockSessionGap(closed[i-1].closeTime,closed[i].closeTime))start=i;
 closed=closed.slice(start);
 if(closed.length<3)return {points:[],cards:[],lines:[]};
 const setup=evaluateWyckoff(closed.map(({date,...b})=>b),{now,timeframe:'5m',isSessionGap:stockSessionGap,rollingSearch:true,after});
 return buildColmexMarks({assets:{chart:{setup}}},'chart');
}
export function chartWyckoffOccurrences(bars,now=Date.now()){
 const closed=closedAnalysisBars(bars,now),segments=[];let start=0;
 for(let i=1;i<closed.length;i++)if(closed[i].closeTime-closed[i-1].closeTime!==300000&&!stockSessionGap(closed[i-1].closeTime,closed[i].closeTime)){segments.push(closed.slice(start,i));start=i;}
 segments.push(closed.slice(start));
 // Preserve valid historical patterns on either side of a gap without joining them.
 return segments.flatMap(segment=>segment.length<3?[]:scanWyckoffOccurrences(segment.map(({date,...b})=>b),{now,isSessionGap:stockSessionGap}));
}
export function numberedWyckoffOccurrences(history,bars,interval){
 return [...history].sort((a,b)=>a.detectedAt-b.detectedAt).map(item=>({...item,index:markBarIndex({at:item.springAt,anchor:'close'},bars,interval)})).filter(x=>x.index>=0).map((x,i)=>({...x,number:i+1}));
}
