import {candleTime} from './lib/chart-viewport.mjs';
import {rsiSeries} from './lib/wyckoff-spring-rsi.mjs';
export function movingAverage(bars,period){
 let sum=0,count=0;return bars.map((b,i)=>{const v=Number(b.close);if(Number.isFinite(v)){sum+=v;count++;}if(i>=period){const old=Number(bars[i-period].close);if(Number.isFinite(old)){sum-=old;count--;}}return i>=period-1&&count===period?sum/period:null;});
}
export function createIndicatorControls({host,toolbar,shell}){
 const periods=[20,50,100,200],colors=['#ffc857','#48d597','#ed86d1','#397dff'];
 let settings={20:false,50:false,100:false,200:true,rsi:true},config=null,overlay=null;
 try{Object.assign(settings,JSON.parse(localStorage.getItem('levi-chart-indicators-v1')||'{}'));}catch{}
 for(const id of ['rsiPanel','colmexRsi']){const old=document.getElementById?.(id);if(old)old.style.display='none';}
 const controls=document.createElement('div');controls.dir='ltr';controls.style.cssText='display:flex;flex-wrap:wrap;gap:14px;padding:8px;align-items:center';
 const panel=document.createElement('div');panel.style.cssText='width:100%;background:#0b1420';shell.append(panel);
 for(const key of [...periods,'rsi']){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=!!settings[key];label.style.cssText='display:inline-flex;gap:5px;align-items:center';label.style.color=key==='rsi'?'#bb90ff':colors[periods.indexOf(key)];const name=document.createElement('span');name.textContent=key==='rsi'?'RSI (14)':'MA '+key;label.append(input,name);controls.append(label);input.onchange=()=>{settings[key]=input.checked;try{localStorage.setItem('levi-chart-indicators-v1',JSON.stringify(settings));}catch{}paint();};}
 toolbar.append(controls);
 const svg=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
 function paint(){
  overlay?.remove();overlay=null;panel.replaceChildren();panel.hidden=!settings.rsi;
  if(!config?.bars?.length)return;
  const {bars,width,height,bounds:b,low,high}=config,source=config.sourceBars||bars;
  const indexes=new Map(source.map((c,i)=>[candleTime(c),i]));
  const x=i=>b.left+(i+.5)*(b.right-b.left)/bars.length,y=v=>b.top+(high-v)/(high-low)*(b.bottom-b.top);
  overlay=svg('svg',{viewBox:`0 0 ${width} ${height}`,preserveAspectRatio:config.preserveAspectRatio||'none','aria-hidden':'true'});overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden';host.append(overlay);
  // A nested SVG clips overlays to the candle plot without changing its price scale.
  const plot=svg('svg',{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top,viewBox:`${b.left} ${b.top} ${b.right-b.left} ${b.bottom-b.top}`});overlay.append(plot);
  function path(values,scale){let d='',active=false;bars.forEach((bar,i)=>{const value=values[indexes.get(candleTime(bar))];if(value==null||!Number.isFinite(value)){active=false;return;}d+=(active?' L':' M')+x(i)+' '+scale(value);active=true;});return d;}
  periods.forEach((p,i)=>{if(settings[p])plot.append(svg('path',{d:path(movingAverage(source,p),y),fill:'none',stroke:colors[i],'stroke-width':2}));});
  if(settings.rsi){const title=document.createElement('div');title.textContent='RSI (14) · '+(config.interval||'')+' · חלון הזמן של הגרף';title.style.cssText='padding:6px;color:#bb90ff';panel.append(title);const chart=svg('svg',{viewBox:`0 0 ${width} 150`,role:'img','aria-label':'RSI 14'});chart.style.cssText='width:100%;display:block;max-height:180px';panel.append(chart);const ry=v=>125-v;for(const level of [0,30,50,70,100]){chart.append(svg('line',{x1:b.left,x2:b.right,y1:ry(level),y2:ry(level),stroke:'#526477','stroke-dasharray':'4 4'}));chart.append(svg('text',{x:b.right+5,y:ry(level)+4,fill:'#93a8bf','font-size':11},String(level)));}const closes=source.map(c=>Number(c.close));if(closes.every(Number.isFinite))chart.append(svg('path',{d:path(rsiSeries(closes),ry),fill:'none',stroke:'#bb90ff','stroke-width':2}));if(source.length<15){title.textContent+=' · נדרשים לפחות 15 נרות';}}
 }
 return {update(next){config=next;paint();},clear(){config=null;overlay?.remove();overlay=null;panel.replaceChildren();}};
}
