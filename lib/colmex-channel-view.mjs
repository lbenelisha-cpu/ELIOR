// Display only: shared Binance geometry on verified stock trading-bar time.
import '../regression-trend.js';
import '../parallel-channel.js';
import {regularSession,stockSessionGap} from './colmex-market-hours.mjs';
const STEP=300000;
export function colmexChartChannels(input,{interval='5min',now=Date.now()}={}){
 const empty=reason=>({regression:{ready:false,reason,period:50},swing:{ready:false,reason,period:50},axis:new Map()});
 if(!['5min','5m'].includes(interval))return empty('FIVE_MINUTE_CHART_REQUIRED');
 let closed=[];
 for(const b of input.slice(-600)){
  const at=Date.parse(b.date),end=at+STEP;
  if(end>now||b.closed===false)continue;
  if(!Number.isFinite(at)||!regularSession(at)||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)){closed=[];continue;}
  const prior=closed.at(-1);
  if(prior&&at-prior.openTime!==STEP&&!stockSessionGap(prior.closeTime,end))closed=[];
  closed.push({...b,openTime:at,closeTime:end});
 }
 const axis=new Map(closed.map((b,i)=>[b.openTime,(i+1)*STEP]));
 const mapped=closed.map((b,i)=>({...b,openTime:(i+1)*STEP,closeTime:(i+2)*STEP}));
 const options={interval:'5m',period:50,deviations:2,now:(mapped.length+2)*STEP};
 return {regression:globalThis.LEVI_REGRESSION.analyze(mapped,options),swing:globalThis.LEVI_PARALLEL.analyze(mapped,options),axis};
}
export function channelSegments(channels,view){
 return ['regression','swing'].flatMap(kind=>{
  const a=channels[kind];if(!a.ready)return [];
  const points=view.map((b,i)=>({at:channels.axis.get(Date.parse(b.date)),i})).filter(p=>p.at>=(kind==='swing'?a.anchorStart:a.start)&&p.at<=a.end);
  if(points.length<2)return [];
  const first=points[0],last=points.at(-1);
  return [{kind,analysis:a,first,last,start:globalThis.LEVI_REGRESSION.levels(a,first.at),end:globalThis.LEVI_REGRESSION.levels(a,last.at)}];
 });
}
export function drawColmexChannels({svg,segments,x,y,bounds}){
 const ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'svg');
 // Nested viewport clips lines to the price plot without global clip IDs.
 for(const [k,v]of Object.entries({x:bounds.left,y:bounds.top,width:bounds.right-bounds.left,height:bounds.bottom-bounds.top,viewBox:`${bounds.left} ${bounds.top} ${bounds.right-bounds.left} ${bounds.bottom-bounds.top}`,overflow:'hidden','data-channel-overlay':'50'}))group.setAttribute(k,v);
 const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;group.append(n);return n;};
 for(const s of segments){
  const color=s.kind==='swing'?'#ffb454':'#67bcff';
  for(const key of ['upper','middle','lower'])add('line',{x1:x(s.first.i),x2:x(s.last.i),y1:y(s.start[key]),y2:y(s.end[key]),stroke:color,'stroke-width':key==='middle'?1:2,'stroke-dasharray':s.kind==='swing'?(key==='middle'?'2 5':'10 4'):(key==='middle'?'6 3':'none'),'data-channel':s.kind});
  const badge=s.kind==='swing'?globalThis.LEVI_PARALLEL.badge(s.analysis):null;
  const text=badge?badge.title+' · '+badge.counts:'רגרסיה · 50 נרות סגורים';
  const top=bounds.top+(s.kind==='swing'?32:14);
  const label=add('text',{x:bounds.right-8,y:top,fill:color,'font-size':11,'text-anchor':'start',direction:'rtl',style:'paint-order:stroke;stroke:#08111f;stroke-width:4px;stroke-linejoin:round','data-channel-label':s.kind},text);
  const title=document.createElementNS(ns,'title');title.textContent=text;label.append(title);
 }
 svg.append(group);
}
