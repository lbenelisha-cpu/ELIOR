import {analyzePositionAlpha,positionQuoteChange} from './lib/position-alpha.mjs?v=20261026-entry-alpha';
const states={NO_POSITION:'בחר פוזיציה פתוחה כדי למדוד מהכניסה',ENTRY_PRICE_UNAVAILABLE:'מחיר הכניסה אינו זמין',ENTRY_TIME_UNVERIFIED:'זמן הקנייה המקורי אינו מאומת',ENTRY_BASIS_CHANGED:'בסיס הפוזיציה השתנה · נדרש אימות הכניסה',INVALID_ENTRY_TIME:'זמן הכניסה אינו תקין',INVALID_SIDE:'כיוון הפוזיציה אינו מאומת',WAIT_FIRST_CLOSE:'ממתין לנר מלא שייסגר לאחר הכניסה',INVALID_DATA:'נתוני הנרות אינם תקינים',STALE:'מדידת עבר · ממתין לנרות עדכניים',READY:'נרות 5 דקות סגורים'};
const signed=(n,d=2)=>Number.isFinite(n)?(n>0?'+':'')+n.toFixed(d):'—';
const time=at=>Number.isFinite(at)?new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'—';
const direction=n=>!Number.isFinite(n)?'unknown':n>1e-10?'up':n< -1e-10?'down':'flat';
const arrows={up:'↗',down:'↘',flat:'→',unknown:'—'};
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const panels=new WeakMap();
export function renderPositionAlpha(host,bars,{symbol='',position=null,price=null,priceAt=null,now=Date.now()}={}){
 if(!host)return;
 let ui=panels.get(host);
 if(!ui){
  host.className='position-alpha';const fold=node('details'),summary=node('summary'),heading=node('span'),title=node('b','מהכניסה ועד עכשיו · α'),brief=node('small'),toggle=node('span','＋','position-alpha-toggle');heading.append(title,brief);summary.append(heading,toggle);
  const body=node('div',null,'position-alpha-body'),status=node('p',null,'position-alpha-status'),cards=node('div',null,'position-alpha-cards');
  const makeCard=label=>{const root=node('article'),name=node('small',label),value=node('strong'),detail=node('span');root.append(name,value,detail);cards.append(root);return {root,value,detail};};
  const entry=makeCard('מהכניסה · קצב מחיר ממוצע'),recent=makeCard('כיוון אחרון · 5 נרות סגורים'),quote=makeCard('רווח / הפסד לפי ציטוט');
  const graph=node('div',null,'position-alpha-graph'),meta=node('p',null,'position-alpha-meta');
  const note=node('p','כל נר מלא לאחר הכניסה מיוצג בממוצע (גבוה + נמוך + סגירה) / 3, באחוזים ממחיר הכניסה. הזוויות מתארות את המחיר: חיובי = עולה, שלילי = יורד. בשורט הרווח נע בכיוון ההפוך. הכיוון האחרון מחושב ברגרסיה על 5 סגירות רצופות (20 דקות בין הראשונה לאחרונה). סולם קבוע: 0.01 נקודת אחוז לדקה = 45°. הקצב מהכניסה מחושב לפי זמן שעון, כולל הפסקות מסחר; הוא עשוי להתמתן גם בלי ירידת מחיר.','position-alpha-note');
  const policy=node('p','כלי ניתוח ותיעוד. ממוצע הנר אינו מחיר ביצוע; הרווח המוצג כאן הוא לפי ציטוט לפני עמלות ומימון. הרווח החשבונאי מופיע במפת הפוזיציות ובהיסטוריית העסקאות.','position-alpha-note');
  body.append(status,cards,graph,meta,note,policy);fold.append(summary,body);host.append(fold);ui={brief,fold,status,entry,recent,quote,graph,meta,toggle};panels.set(host,ui);
  fold.addEventListener('toggle',()=>{toggle.textContent=fold.open?'−':'＋';});
 }
 const value=analyzePositionAlpha(bars,position,{now}),ready=value.status==='READY',old=value.status==='STALE';
 host.dataset.status=value.status;
 ui.status.textContent=states[value.status]||value.status;
 const ref=value.reference,q=positionQuoteChange(ref,price,priceAt,now);
 const paint=(card,rate,detail)=>{card.root.dataset.direction=direction(rate);card.value.textContent=Number.isFinite(rate)?arrows[direction(rate)]+' '+signed(rate,1)+'°':'—';card.detail.textContent=detail;};
 const entry=ready||old?value.fromEntry:null,recent=(ready||old)&&value.recent?.status==='READY'?value.recent:null;
 paint(ui.entry,entry?.angle,entry?signed(entry.changePct)+'% ממחיר הכניסה · '+signed(entry.pctPerMinute,4)+' נק׳ אחוז/דקה'+(old?' · נתון עבר':''):states[value.status]);
 paint(ui.recent,recent?.angle,recent?signed(recent.pctPerMinute,4)+' נק׳ אחוז/דקה'+(old?' · נתון עבר':''):ref.status==='READY'?'ממתין ל־5 נרות מלאים רצופים לאחר הכניסה':'—');
 ui.quote.root.dataset.direction=direction(q?.grossPnlPct);ui.quote.value.textContent=q?signed(q.grossPnlPct)+'%':'—';ui.quote.detail.textContent=q?'ברוטו · '+ref.side+' · '+time(q.at):'אין ציטוט עדכני מאומת למדידת רווח';
 ui.brief.textContent=symbol+' · '+(ready?signed(entry.changePct)+'% בממוצע הנר · כיוון אחרון '+(recent?arrows[direction(recent.angle)]+' '+signed(recent.angle,1)+'°':'ממתין'):states[value.status]);
 ui.meta.textContent=ref.status==='READY'?'מחיר כניסה '+ref.entryPrice+' · '+(ref.timeSource==='BROKER_EXECUTION'?'זמן ביצוע ברוקר':'זמן כניסה מתועד; ייתכן פער מזמן הביצוע')+': '+time(ref.entryAt)+' · נר המדידה: '+time(value.asOf)+(value.historyPartial?' · מסלול הנרות חלקי או כולל הפסקה':''):'';
 ui.graph.replaceChildren();
 if(!entry||!value.series.length)return;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 660 160');svg.setAttribute('role','img');svg.setAttribute('aria-label','שינוי מחיר ממחיר הכניסה באחוזים לאורך זמן');
 const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text)n.textContent=text;svg.append(n);};
 const points=value.series,min=Math.min(0,...points.map(p=>p.changePct)),max=Math.max(0,...points.map(p=>p.changePct)),span=Math.max(max-min,.1),x=at=>54+580*(at-ref.entryAt)/(value.asOf-ref.entryAt),y=p=>125-100*(p-min)/span;
 add('line',{x1:54,x2:634,y1:y(0),y2:y(0),stroke:'#6b8299','stroke-dasharray':'3 5'});
 add('text',{x:5,y:y(0)+4,fill:'#a4bdd0'},'0%');
 add('line',{x1:54,y1:y(0),x2:x(value.asOf),y2:y(entry.changePct),stroke:'#bba5ff','stroke-dasharray':'6 5','stroke-width':2});
 let segment=[];const draw=()=>{if(!segment.length)return;add('polyline',{points:segment.map(p=>x(p.at)+','+y(p.changePct)).join(' '),fill:'none',stroke:'#6cd5e4','stroke-width':2});for(const p of [segment[0],segment.at(-1)])add('circle',{cx:x(p.at),cy:y(p.changePct),r:2,fill:'#6cd5e4'});};
 for(const p of points){if(segment.length&&p.at-segment.at(-1).at!==300000){draw();segment=[];}segment.push(p);}draw();
 add('circle',{cx:54,cy:y(0),r:4,fill:'#bba5ff'});add('text',{x:54,y:151,fill:'#a4bdd0'},'כניסה');add('text',{x:530,y:151,fill:'#a4bdd0'},signed(entry.changePct)+'%');
 ui.graph.append(svg,node('small','סגול מקווקו: כניסה לנר האחרון · תכלת: ממוצעי הנרות · ציר אנכי באחוזים; הזום אינו קובע את α'));
}
