// Presentation only. Receives displayed candles; never fetches or submits an order.
import {candleTime} from './lib/chart-viewport.mjs?v=20261101-chart-terminal';
const NS='http://www.w3.org/2000/svg';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const number=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v));
const fmt=v=>number(v)?Number(v).toLocaleString('en-US',{maximumSignificantDigits:8}):'—';
const clock=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function createChartTerminal({host,toolbarHost,shell,navigation,onChange=()=>{}}){
 let config=null,overlay=null,cursor=null,pinned=false,context='',fitCandles=true,expanded=false,previousOverflow='',pinchDistance=0;
 const pointers=new Map();
 host.classList.add('chart-interactive');host.tabIndex=0;
 host.setAttribute('aria-description','גרירה להזזת הזמן, גלגלת לזום, חצים להזזה. הקשה מציגה נתוני נר, Escape משחרר.');
 const toolbar=document.createElement('div');toolbar.className='terminal-toolbar';
 const title=document.createElement('strong');title.className='terminal-title';title.textContent='גרף נרות';toolbar.append(title);
 const controls=document.createElement('div');controls.className='terminal-actions';toolbar.append(controls);
 const button=(label,description,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.title=description;b.setAttribute('aria-label',description);b.onclick=action;controls.append(b);return b;};
 button('+','הגדלת נרות',()=>navigation()?.zoom(.75));button('−','הקטנת נרות',()=>navigation()?.zoom(1.35));
 button('אחרון ›','חזרה לנר האחרון',()=>{pinned=false;cursor=null;navigation()?.latest();});
 const fit=button('גובה: נרות','התאם גובה לנרות או לכל רמות העסקה',()=>{fitCandles=!fitCandles;fit.textContent=fitCandles?'גובה: נרות':'גובה: כל הרמות';fit.setAttribute('aria-pressed',String(fitCandles));onChange();});fit.setAttribute('aria-pressed','true');
 const full=button('⛶','הרחבת הגרף למסך מלא',()=>setExpanded(!expanded));
 const readout=document.createElement('div');readout.className='terminal-ohlc';readout.dir='rtl';
 const help=document.createElement('small');help.className='terminal-help';help.textContent='גרירה: תנועה בזמן · גלגלת / שתי אצבעות: זום · הקשה: נתוני נר · שעות ישראל';
 toolbarHost.replaceChildren(toolbar,readout,help);
 const fields=new Map();for(const [key,label]of [['time','נר'],['open','פתיחה'],['high','גבוה'],['low','נמוך'],['close','סגירה'],['change','שינוי'],['volume','מחזור']]){
  const item=document.createElement('span'),name=document.createElement('small'),value=document.createElement('bdi');name.textContent=label;value.textContent='—';item.append(name,value);readout.append(item);fields.set(key,value);
 }
 const svg=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
 function setExpanded(next){
  expanded=next;shell.classList.toggle('terminal-expanded',expanded);
  if(expanded){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}else{document.body.style.overflow=previousOverflow;full.focus({preventScroll:true});}
  full.textContent=expanded?'✕ סגור':'⛶';full.setAttribute('aria-label',expanded?'סגירת מסך מלא':'הרחבת הגרף למסך מלא');full.setAttribute('aria-expanded',String(expanded));
  requestAnimationFrame(()=>{onChange();window.dispatchEvent(new Event('resize'));});
 }
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&expanded){setExpanded(false);}});
 function point(e){const r=host.getBoundingClientRect();return {x:(e.clientX-r.left)*config.width/r.width,y:(e.clientY-r.top)*config.height/r.height};}
 function inside(p){const b=config.bounds;return p.x>=b.left&&p.x<=b.right&&p.y>=b.top&&p.y<=b.bottom;}
 function select(p){const b=config.bounds,i=clamp(Math.floor((p.x-b.left)/(b.right-b.left)*config.bars.length),0,config.bars.length-1);cursor={time:candleTime(config.bars[i]),price:config.high-(clamp(p.y,b.top,b.bottom)-b.top)/(b.bottom-b.top)*(config.high-config.low)};paint();}
 function ignored(e){return !!e.target.closest('button,a,input,[data-shape],[data-mark-id],[data-wyckoff-arrow],.workbench-overlay[data-mode="draw"]');}
 function paint(){
  if(!config?.bars.length)return;
  if(!overlay?.isConnected){overlay=svg('svg',{class:'terminal-crosshair','aria-hidden':'true',preserveAspectRatio:'none'});host.append(overlay);}
  overlay.setAttribute('viewBox',`0 0 ${config.width} ${config.height}`);overlay.replaceChildren();
  const b=config.bounds,idx=cursor?config.bars.findIndex(c=>candleTime(c)===cursor.time):-1,bar=config.bars[idx<0?config.bars.length-1:idx],time=candleTime(bar);
  fields.get('time').textContent=Number.isFinite(time)?clock.format(new Date(time)):'—';
  for(const k of ['open','high','low','close','volume'])fields.get(k).textContent=fmt(bar[k]);
  const change=number(bar.open)&&Number(bar.open)>0&&number(bar.close)?(Number(bar.close)/Number(bar.open)-1)*100:null;
  fields.get('change').textContent=change===null?'—':(change>0?'+':'')+change.toFixed(2)+'%';
  readout.dataset.direction=change===null?'unknown':change>=0?'up':'down';readout.dataset.pinned=String(pinned);
  const line=(x1,y1,x2,y2,color)=>overlay.append(svg('line',{x1,y1,x2,y2,stroke:color,'stroke-width':1,'stroke-dasharray':'4 4'}));
  const badge=(x,y,w,text,color='#34485c')=>{overlay.append(svg('rect',{x,y,width:w,height:22,rx:3,fill:color}));overlay.append(svg('text',{x:x+w/2,y:y+15,fill:'#f1f6fa','font-size':11,'text-anchor':'middle'},text));};
  // Latest visible close is not presented as a fresh quote or an executable price.
  const last=config.bars.at(-1),close=Number(last.close),lastY=b.top+(config.high-close)/(config.high-config.low)*(b.bottom-b.top);
  if(number(last.close)&&lastY>=b.top&&lastY<=b.bottom){const color=Number(last.close)>=Number(last.open)?'#168979':'#c6495b';line(b.left,lastY,b.right,lastY,color);badge(b.right+3,clamp(lastY-11,b.top,b.bottom-22),Math.max(44,config.width-b.right-5),fmt(close),color);}
  if(idx<0)return;
  const x=b.left+(idx+.5)*(b.right-b.left)/config.bars.length,y=clamp(b.top+(config.high-cursor.price)/(config.high-config.low)*(b.bottom-b.top),b.top,b.bottom);
  line(x,b.top,x,b.bottom,'#b5c5d5');line(b.left,y,b.right,y,'#b5c5d5');
  badge(b.right+3,clamp(y-11,b.top,b.bottom-22),Math.max(44,config.width-b.right-5),fmt(cursor.price));
  const w=Math.min(138,b.right-b.left);badge(clamp(x-w/2,b.left,b.right-w),Math.min(config.height-23,b.bottom+5),w,clock.format(new Date(time)));
 }
 host.addEventListener('wheel',e=>{if(!config||ignored(e))return;const p=point(e);if(!inside(p))return;e.preventDefault();pinned=false;cursor=null;navigation()?.zoom(e.deltaY>0?1.16:.86,(p.x-config.bounds.left)/(config.bounds.right-config.bounds.left));},{passive:false});
 host.addEventListener('pointerdown',e=>{
  if(!config||e.button!==0||ignored(e))return;const p=point(e);if(!inside(p))return;
  e.preventDefault();host.focus({preventScroll:true});host.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{...p,startX:p.x,startY:p.y,moved:false,remainder:0});
  if(pointers.size===2){const [a,b]=[...pointers.values()];pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);for(const item of pointers.values())item.moved=true;}else select(p);
 });
 host.addEventListener('pointermove',e=>{
  if(!config||ignored(e))return;const p=point(e),previous=pointers.get(e.pointerId);
  if(previous){
   const dx=p.x-previous.x;previous.x=p.x;previous.y=p.y;previous.moved ||= Math.hypot(p.x-previous.startX,p.y-previous.startY)>5;
   if(pointers.size===2){const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance>0&&Math.abs(distance-pinchDistance)>5){navigation()?.zoom(pinchDistance/distance,((a.x+b.x)/2-config.bounds.left)/(config.bounds.right-config.bounds.left));pinchDistance=distance;}pinned=false;cursor=null;}
   else if(previous.moved){const step=(config.bounds.right-config.bounds.left)/config.bars.length;previous.remainder+=dx/step;const delta=Math.trunc(previous.remainder);if(delta){navigation()?.move(-delta);previous.remainder-=delta;}pinned=false;cursor=null;}
   return;
  }
  if(!pinned){if(inside(p))select(p);else{cursor=null;paint();}}
 });
 const end=e=>{const p=pointers.get(e.pointerId);if(!p)return;if(!p.moved){pinned=!pinned;if(!pinned)cursor=null;}pointers.delete(e.pointerId);pinchDistance=0;if(pointers.size)for(const v of pointers.values()){v.moved=true;v.remainder=0;}if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);paint();};
 host.addEventListener('pointerup',end);host.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);pinchDistance=0;pinned=false;cursor=null;paint();});
 host.addEventListener('pointerleave',()=>{if(!pinned&&!pointers.size){cursor=null;paint();}});
 host.addEventListener('dblclick',e=>{if(ignored(e))return;pinned=false;cursor=null;navigation()?.reset();});
 host.addEventListener('keydown',e=>{if(e.target!==host||!config)return;const actions={ArrowLeft:()=>navigation()?.move(-Math.max(1,Math.floor(config.bars.length/5))),ArrowRight:()=>navigation()?.move(Math.max(1,Math.floor(config.bars.length/5))),'+':()=>navigation()?.zoom(.75),'-':()=>navigation()?.zoom(1.35),End:()=>navigation()?.latest(),Escape:()=>{pinned=false;cursor=null;paint();}};if(actions[e.key]){e.preventDefault();actions[e.key]();}});
 return {get fitCandles(){return fitCandles;},clear(){config=null;cursor=null;pinned=false;pointers.clear();overlay?.remove();overlay=null;title.textContent='גרף נרות';for(const value of fields.values())value.textContent='—';},update(next){if(!next?.bars?.length)return;const key=next.symbol+':'+next.interval;if(key!==context){context=key;cursor=null;pinned=false;pointers.clear();}config=next;title.textContent=next.symbol+' · '+(next.interval||'');if(cursor&&!next.bars.some(b=>candleTime(b)===cursor.time)){cursor=null;pinned=false;}paint();}};
}
