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
let clipSequence=0;
export function drawColmexChannels({svg,segments,x,y,bounds}){
 const ns='http://www.w3.org/2000/svg';
 const make=(tag,attrs={},text)=>{const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;return n;};
 // A clipped group preserves the chart coordinates; nested SVGs inherit the page's 100% sizing.
 const id='colmex-channel-clip-'+(++clipSequence),defs=make('defs'),clip=make('clipPath',{id}),group=make('g',{'clip-path':`url(#${id})`,'data-channel-overlay':'50','pointer-events':'none'}),labels=make('g',{'pointer-events':'none'});
 clip.append(make('rect',{x:bounds.left,y:bounds.top,width:bounds.right-bounds.left,height:bounds.bottom-bounds.top}));defs.append(clip);svg.append(defs,group);
 const placed=[],clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 for(const s of segments){
  const swing=s.kind==='swing',color=swing?'#ffb454':'#67bcff',x1=x(s.first.i),x2=x(s.last.i);
  if(!swing)group.append(make('polygon',{points:`${x1},${y(s.start.upper)} ${x2},${y(s.end.upper)} ${x2},${y(s.end.lower)} ${x1},${y(s.start.lower)}`,fill:'rgba(75,170,255,.09)'}));
  for(const key of ['upper','middle','lower'])group.append(make('line',{x1,x2,y1:y(s.start[key]),y2:y(s.end[key]),stroke:swing?color:key==='middle'?color:'#b7a3ff','stroke-width':swing?(key==='middle'?1:2):(key==='middle'?2.5:1.5),'stroke-dasharray':swing?(key==='middle'?'2 5':'10 4'):(key==='middle'?'6 3':'none'),'data-channel':s.kind}));
  const badge=swing?globalThis.LEVI_PARALLEL.badge(s.analysis):null;
  if(swing&&!badge)continue;
  const lines=badge?[badge.title,badge.counts]:['רגרסיה · 50 נרות סגורים'];
  const width=Math.min(swing?226:190,bounds.right-bounds.left-8),height=swing?49:28;
  const left=clamp(x2-width,bounds.left+4,bounds.right-width-4);
  let top=clamp(y(s.end[swing?'lower':'upper'])+(swing?12:-height-8),bounds.top+4,bounds.bottom-height-4);
  for(const previous of placed)if(top<previous.bottom+6&&top+height>previous.top-6)top=previous.bottom+6+height<=bounds.bottom-4?previous.bottom+6:clamp(previous.top-height-6,bounds.top+4,bounds.bottom-height-4);
  placed.push({top,bottom:top+height});
  const label=make('g',{'data-channel-label':s.kind,'data-state':badge?(badge.provisional?'provisional':'confirmed'):'closed-bars',role:'img','aria-label':lines.join(' · ')});
  label.append(make('rect',{x:left,y:top,width,height,rx:5,fill:swing?'#543910':'#142c49',stroke:color,'fill-opacity':.96}));
  lines.forEach((text,i)=>label.append(make('text',{x:left+width-9,y:top+18+i*19,fill:swing?'#ffe3ae':'#d8eaff','font-size':width<210?11:12,'font-weight':i===0?600:400,'text-anchor':'start',direction:'rtl'},text)));
  label.append(make('title',{},lines.join(' · ')+(swing?' · נגיעות בקיצונים מאושרים לאחר שני נרות נוספים · אינו אישור כניסה':'')));labels.append(label);
 }
 // Caller appends labels last so candles and other analysis marks cannot cover them.
 return labels;
}
