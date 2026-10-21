import {COLMEX_MARK_TYPES,markBarIndex} from './colmex-chart-marks.mjs';
const kinds=new Map(COLMEX_MARK_TYPES.map(([kind,name,color])=>[kind,{name,color}]));
kinds.set('buy',{name:'B · קנייה מדומה',color:'#4a9dff'});
kinds.set('sell',{name:'S · מכירה מדומה',color:'#ff5f78'});
kinds.set('peak',{name:'שיא מאז הקנייה',color:'#4a9dff'});
const upper=new Set(['initialPeak','rallyHigh','peak','sell']);
// Incomplete current patterns and all historical occurrences share exact close/event anchors.
export function wyckoffArrowPoints(points,occurrences,bars,interval){
 const found=new Map();
 const add=point=>{
  if(!kinds.has(point.kind)||!Number.isFinite(point.price)||point.price<=0)return;
  const index=markBarIndex(point,bars,interval);if(index<0)return;
  const id=[point.kind,point.at,point.price].join(':');
  const previous=found.get(id);
  found.set(id,{...previous,...point,...kinds.get(point.kind),id,index,pulse:true,number:point.number??previous?.number});
 };
 for(const point of points)add(point);
 for(const item of occurrences)for(const [kind] of COLMEX_MARK_TYPES){
  const p=item.setup?.[kind];if(!p)continue;
  add({kind,price:p.price,at:p.time,anchor:kind==='confirmation'&&p.live?'event':'close',number:item.number});
 }
 return [...found.values()].sort((a,b)=>a.index-b.index||a.at-b.at);
}
export function arrowLayout(points,x,y){
 const occupied=[];
 return points.map(point=>{
  const px=x(point.index),py=y(point.price),above=upper.has(point.kind),direction=above?-1:1;
  const label=(point.number?point.number+' · ':'')+point.name,width=Math.max(54,label.length*6.1+14),height=16;
  const overlap=box=>occupied.some(b=>box.left<b.right+4&&box.right>b.left-4&&box.top<b.bottom+3&&box.bottom>b.top-3);
  let box;
  search: for(const sign of [direction,-direction])for(let row=0;row<16;row++)for(const shift of [0,-70,70]){
   const cx=Math.max(16+width/2,Math.min(758-width/2,px+shift));
   const cy=Math.max(35,Math.min(281,py+sign*(29+row*18)));
   const candidate={left:cx-width/2,right:cx+width/2,top:cy-height/2,bottom:cy+height/2,cx,cy,width,height};
   if(!overlap(candidate)){box=candidate;break search;}
  }
  // Exceptionally dense charts keep a compact hoverable arrow rather than hiding another label.
  if(box)occupied.push(box);
  const tailY=py+direction*17;
  return {point,px,py,tailY,above,label,box:box||null,head:`${px},${py} ${px-4},${py+direction*7} ${px+4},${py+direction*7}`};
 });
}
export function drawWyckoffArrows({svg,points,x,y,document:doc=globalThis.document,onSelect=()=>{}}){
 const ns='http://www.w3.org/2000/svg';
 const make=(tag,attrs,text)=>{const el=doc.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;};
 for(const a of arrowLayout(points,x,y)){
  const {point,px,py,tailY,box}=a;
  const group=make('g',{'data-wyckoff-arrow':point.id,tabindex:0,role:'button','aria-label':a.label+' · '+point.price+' · '+new Date(point.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})});
  group.append(make('title',{},group.getAttribute('aria-label')));
  if(box){
   group.append(make('line',{x1:box.cx,y1:box.cy,x2:px,y2:tailY,stroke:point.color,'stroke-opacity':.55,'stroke-width':.8,'pointer-events':'none'}));
   group.append(make('rect',{x:box.left,y:box.top,width:box.width,height:box.height,rx:4,fill:'#08111f',stroke:point.color,'stroke-width':.7}));
   group.append(make('text',{x:box.cx,y:box.cy+3.5,fill:point.color,'font-size':10,'font-weight':'bold','text-anchor':'middle',direction:'rtl'},a.label));
  }
  group.append(make('line',{x1:px,y1:tailY,x2:px,y2:py,stroke:point.color,'stroke-width':2,'pointer-events':'none'}));
  group.append(make('polygon',{points:a.head,fill:point.color,'pointer-events':'none'}));
  group.append(make('rect',{x:px-7,y:Math.min(py,tailY)-3,width:14,height:23,fill:'transparent'}));
  group.onpointerdown=e=>e.stopPropagation();
  group.onclick=e=>{e.stopPropagation();onSelect(point);};
  group.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();onSelect(point);}};
  svg.append(group);
 }
}
