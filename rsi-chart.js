import {renderCurrentRsiBadge} from './rsi-current-badge.js';
import {currentRsiValue} from './lib/current-rsi-value.mjs';
import {regularSession,stockSessionGap} from './lib/colmex-simulation.mjs';
import {rsiSeries} from './lib/wyckoff-spring-rsi.mjs';
// Always show the entry timeframe (5m), independently of the price chart selector.
export function renderRsiChart(root,bars,live=null){
 if(!root)return;root.replaceChildren();
 const marketClosed=!regularSession(Date.now());if(marketClosed)live=null;
 const snapshot=currentRsiValue(bars,live,{marketClosed,isSessionGap:stockSessionGap});if(!snapshot.live)live=null;
 const rows=[...(bars||[])];if(live)rows.push(live);
 const title=document.createElement('p');title.textContent='RSI (14) · נרות 5 דקות · תנאי כניסה: Spring ו־RSI בין 0 ל־30';root.append(title);
 if(rows.length<15){const p=document.createElement('p');p.textContent='נדרשים לפחות 15 מחירי נרות לחישוב RSI';root.append(p);return;}
 const values=rsiSeries(rows.map(b=>Number(b.close))),cut=Math.max(0,rows.length-156),view=values.slice(cut),ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 850 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','RSI 14 בטווח 0 עד 100');svg.style.width='100%';root.append(svg);
 const add=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text)el.textContent=text;svg.append(el);};
 const x=i=>20+i*730/Math.max(1,view.length-1),y=v=>140-v*1.2;
 add('rect',{x:20,y:y(30),width:730,height:36,fill:'#123d36'});
 for(const level of [0,30,70,100]){add('line',{x1:20,x2:750,y1:y(level),y2:y(level),stroke:'#526477','stroke-dasharray':'4 4'});add('text',{x:775,y:y(level)+4,fill:'#93a8bf','font-size':12},String(level));}
 add('polyline',{points:view.map((v,i)=>v==null?null:x(i)+','+y(v)).filter(Boolean).join(' '),fill:'none',stroke:'#bb90ff','stroke-width':2});
 for(const i of [0,Math.floor((view.length-1)/2),view.length-1])add('text',{x:x(i),y:168,fill:'#93a8bf','font-size':10,'text-anchor':i===0?'start':i===view.length-1?'end':'middle'},new Date(rows[cut+i].date).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}));
 renderCurrentRsiBadge(root,{value:snapshot.value,at:snapshot.at,live:snapshot.live,source:'5 דקות · קולמקס',closed:marketClosed});
 const detail=document.createElement('p');detail.textContent='RSI: '+values.at(-1).toFixed(2)+' · '+(live?'כולל מחיר חי בנר פתוח · ':'לפי נרות סגורים · ')+new Date(live?.observedAt||rows.at(-1).date).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});root.append(detail);
}
