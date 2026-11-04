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
 const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 const ready=segments.filter(s=>s.kind!=='swing'||globalThis.LEVI_PARALLEL.badge(s.analysis));
 const available=Math.max(1,bounds.right-bounds.left-8),both=ready.length>1,gap=both?8:0;
 const regressionWidth=both?Math.min(190,(available-gap)*.44):Math.min(190,available);
 const swingWidth=both?Math.min(226,available-gap-regressionWidth):Math.min(226,available);
 const compact=both&&(regressionWidth<150||swingWidth<180);
 const legendWidth=both?regressionWidth+gap+swingWidth:ready[0]?.kind==='swing'?swingWidth:regressionWidth;
 const legendLeft=clamp(bounds.right-legendWidth-4,bounds.left+4,bounds.right-legendWidth-4);
 const legendTop=Math.max(4,bounds.top-42);
 for(const s of segments){
  const swing=s.kind==='swing',color=swing?'#ffb454':'#67bcff',x1=x(s.first.i),x2=x(s.last.i);
  if(!swing)group.append(make('polygon',{points:`${x1},${y(s.start.upper)} ${x2},${y(s.end.upper)} ${x2},${y(s.end.lower)} ${x1},${y(s.start.lower)}`,fill:'rgba(75,170,255,.09)'}));
  for(const key of ['upper','middle','lower'])group.append(make('line',{x1,x2,y1:y(s.start[key]),y2:y(s.end[key]),stroke:swing?color:key==='middle'?color:'#b7a3ff','stroke-width':swing?(key==='middle'?1:2):(key==='middle'?2.5:1.5),'stroke-dasharray':swing?(key==='middle'?'2 5':'10 4'):(key==='middle'?'6 3':'none'),'data-channel':s.kind}));
  const badge=swing?globalThis.LEVI_PARALLEL.badge(s.analysis):null;
  if(swing&&!badge)continue;
  const width=swing?swingWidth:regressionWidth,height=swing?38:30;
  const left=both?(swing?legendLeft+regressionWidth+gap:legendLeft):legendLeft;
  const top=legendTop+(swing?0:4);
  const lines=badge?(compact?[badge.title,badge.counts]:[badge.title,badge.counts]):[compact?'רגרסיה · 50':'רגרסיה · 50 נרות סגורים'];
  const label=make('g',{'data-channel-label':s.kind,'data-state':badge?(badge.provisional?'provisional':'confirmed'):'closed-bars',role:'img','aria-label':(badge?[badge.title,badge.counts]:['רגרסיה · 50 נרות סגורים']).join(' · ')});
  label.append(make('rect',{x:left,y:top,width,height,rx:5,fill:swing?'#543910':'#142c49',stroke:color,'fill-opacity':.96}));
  lines.forEach((text,i)=>label.append(make('text',{x:left+width-8,y:top+(swing?15:19)+i*(compact?14:19),fill:swing?'#ffe3ae':'#d8eaff','font-size':compact?10:width<210?11:12,'font-weight':i===0?600:400,'text-anchor':'start',direction:'rtl'},text)));
  label.append(make('title',{},(badge?[badge.title,badge.counts]:['רגרסיה · 50 נרות סגורים']).join(' · ')+(swing?' · נגיעות בקיצונים מאושרים לאחר שני נרות נוספים · אינו אישור כניסה':'')));labels.append(label);
 }
 // Caller appends labels last so candles and other analysis marks cannot cover them.
 return labels;
}
