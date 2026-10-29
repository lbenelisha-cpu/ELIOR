import {COLMEX_MARK_TYPES,markBarIndex} from './colmex-chart-marks.mjs';
import {COLMEX_CANDIDATE_TYPES} from './colmex-search-progress.mjs';
const kinds=new Map([...COLMEX_MARK_TYPES,...COLMEX_CANDIDATE_TYPES].map(([kind,name,color])=>[kind,{name,color}]));
kinds.set('buy',{name:'B · קנייה מדומה',color:'#4a9dff'});
kinds.set('sell',{name:'S · מכירה מדומה',color:'#ff5f78'});
kinds.set('peak',{name:'שיא מאז הקנייה',color:'#4a9dff'});
const upper=new Set(['initialPeak','rallyHigh','secondRallyHigh','peak','sell','candidatePeak','candidateRally']);
// Incomplete current patterns and all historical occurrences share exact close/event anchors.
export function wyckoffArrowPoints(points,occurrences,bars,interval){
 const found=new Map();
 const add=point=>{
  if(!kinds.has(point.kind)||!Number.isFinite(point.price)||point.price<=0)return;
  const index=markBarIndex(point,bars,interval);if(index<0)return;
  const id=[point.kind,point.at,point.price].join(':');
  const previous=found.get(id);
  found.set(id,{...previous,...point,...kinds.get(point.kind),id,index,pulse:!point.provisional,number:point.number??previous?.number});
 };
 for(const point of points)add(point);
 for(const item of occurrences)for(const [kind] of COLMEX_MARK_TYPES){
  const p=item.setup?.[kind];if(!p)continue;
  add({kind,price:p.price,at:p.time,anchor:kind==='confirmation'&&p.live?'event':'close',number:item.number});
 }
 return [...found.values()].sort((a,b)=>a.index-b.index||a.at-b.at);
}
// Reserve separate lanes outside the price plot; never move a high label below it.
function edgeSlots(points,x,{left=16,right=758}={}){
 const rows={upper:[],lower:[]};
 return points.map(point=>{
  const above=upper.has(point.kind),lanes=rows[above?'upper':'lower'];
  const label=(point.number?point.number+' · ':'')+point.name,width=Math.max(54,label.length*6.1+14),cx=Math.max(left+width/2,Math.min(right-width/2,x(point.index)));
  let row=0;while(lanes[row]?.some(b=>cx-width/2<b.right+6&&cx+width/2>b.left-6))row++;
  const slot={left:cx-width/2,right:cx+width/2,cx,width,row,above,label};(lanes[row]??=[]).push(slot);return slot;
 });
}
export function wyckoffEdgeBands(points,x,horizontal={}){
 const slots=edgeSlots(points,x,horizontal),count=above=>Math.max(0,...slots.filter(s=>s.above===above).map(s=>s.row+1));
 const top=40+count(true)*20,bottom=top+250;
 return {...horizontal,top,bottom,height:bottom+count(false)*20+65};
}
export function arrowLayout(points,x,y,bounds={top:100,bottom:350}){
 const slots=edgeSlots(points,x,bounds);
 return points.map((point,i)=>{
  const slot=slots[i],{above,label}=slot,px=x(point.index),py=y(point.price),direction=above?-1:1;
  const cy=above?35+slot.row*20:bounds.bottom+22+slot.row*20;
  const box={...slot,cy,top:cy-8,bottom:cy+8,height:16};
  return {point,px,py,tailY:py+direction*17,above,label,box,head:`${px},${py} ${px-4},${py+direction*7} ${px+4},${py+direction*7}`};
 });
}
export function drawWyckoffArrows({svg,points,x,y,bounds,document:doc=globalThis.document,onSelect=()=>{}}){
 const ns='http://www.w3.org/2000/svg';
 const make=(tag,attrs,text)=>{const el=doc.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;};
 for(const a of arrowLayout(points,x,y,bounds)){
  const {point,px,py,tailY,box}=a,dash=point.provisional?{'stroke-dasharray':'3 3'}:{};
  const group=make('g',{'data-wyckoff-arrow':point.id,tabindex:0,role:'button','aria-label':a.label+' · '+point.price+' · '+new Date(point.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})});
  group.append(make('title',{},group.getAttribute('aria-label')));
  if(box){
   group.append(make('line',{x1:box.cx,y1:a.above?box.bottom:box.top,x2:px,y2:tailY,stroke:point.color,'stroke-opacity':.55,'stroke-width':.8,...dash,'pointer-events':'none'}));
   group.append(make('rect',{x:box.left,y:box.top,width:box.width,height:box.height,rx:4,fill:'#08111f',stroke:point.color,'stroke-width':.7,...dash}));
   group.append(make('text',{x:box.cx,y:box.cy+3.5,fill:point.color,'font-size':10,'font-weight':'bold','text-anchor':'middle',direction:'rtl'},a.label));
  }
  group.append(make('line',{x1:px,y1:tailY,x2:px,y2:py,stroke:point.color,'stroke-width':2,'pointer-events':'none'}));
  group.append(make('polygon',{points:a.head,fill:point.provisional?'#08111f':point.color,stroke:point.color,'pointer-events':'none'}));
  group.append(make('rect',{x:px-7,y:Math.min(py,tailY)-3,width:14,height:23,fill:'transparent'}));
  group.onpointerdown=e=>e.stopPropagation();
  group.onclick=e=>{e.stopPropagation();onSelect(point);};
  group.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();onSelect(point);}};
  svg.append(group);
 }
}
