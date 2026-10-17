import {mergeWyckoffOccurrences} from './lib/wyckoff-occurrences.mjs';
import {lastTwoTradingDays,startCandleFlashing,chartWyckoffOccurrences,numberedWyckoffOccurrences} from './lib/colmex-chart-view.mjs?v=20261017-intervals';
import {markBarIndex} from './lib/colmex-chart-marks.mjs?v=20261017-intervals';
import {initSimulation,simulationMarks,simulationWyckoffHistory} from './colmex-simulation-ui.js?v=20261017-occurrences';
import {validDrawing,chartGeometry,moveDrawing} from './lib/colmex-chart-drawings.mjs';
'use strict';
const $=s=>document.querySelector(s),KEY='levi-colmex-stocks-ui-v1',validSymbol=s=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(s),positive=n=>Number.isFinite(Number(n))&&Number(n)>0;
const quotes={},quoteStatus={},quoteNextAt={};let quoteBusy=false;
try{const stored=JSON.parse(localStorage.getItem(KEY+'-quotes')||'{}');for(const [symbol,q] of Object.entries(stored)){if(validSymbol(symbol)&&q?.symbol===symbol&&q.currency==='USD'&&positive(q.price)&&q.source==='Twelve Data'&&Number.isFinite(q.loadedAt)&&q.loadedAt<=Date.now()&&Date.now()-q.loadedAt<86400000)quotes[symbol]=q;}}catch{}
function saveQuotes(){try{localStorage.setItem(KEY+'-quotes',JSON.stringify(quotes));}catch{}}

const wyckoffHistories={},wyckoffErrors={};
const markets={},manualCharts=new Set(),pendingMarkets=new Set();let marketRequest=0;
const STOCK_NAMES={AAPL:'Apple',MSFT:'Microsoft',NVDA:'NVIDIA',AMZN:'Amazon',GOOGL:'Alphabet',META:'Meta Platforms',TSLA:'Tesla',AVGO:'Broadcom',JPM:'JPMorgan Chase',NFLX:'Netflix'};
const DEFAULT_SYMBOLS=['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AVGO','JPM','NFLX'];
let state={symbols:[...DEFAULT_SYMBOLS],positions:{},bars:{},drawings:{}},selected='AAPL';
try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved&&Array.isArray(saved.symbols)){state.symbols=[...new Set(saved.symbols.filter(s=>typeof s==='string'&&validSymbol(s)))].slice(0,100);for(const s of state.symbols){const p=saved.positions?.[s];if(p&&positive(p.entry)&&positive(p.qty))state.positions[s]={entry:Number(p.entry),qty:Number(p.qty),mark:positive(p.mark)?Number(p.mark):null,updatedAt:p.updatedAt};const drawings=saved.drawings?.[s];if(Array.isArray(drawings))state.drawings[s]=drawings.filter(validDrawing).slice(0,100);const bars=saved.bars?.[s];if(Array.isArray(bars)&&bars.length<=2000&&bars.every(validBar))state.bars[s]=bars;}}}catch{}
// Populate ten choices while preserving existing watchlist entries and holdings.
for(const symbol of DEFAULT_SYMBOLS){if(state.symbols.length>=10)break;if(!state.symbols.includes(symbol))state.symbols.push(symbol);}
selected=state.symbols[0];
function message(s){$('#message').textContent=s;}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));return true;}catch{message('לא ניתן לשמור בדפדפן. הנתונים זמינים כעת בלבד; נסה לצמצם את גודל הייבוא.');return false;}}
function money(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);}
function mark(symbol){const sources=[markets[symbol],quotes[symbol]].filter(Boolean).sort((a,b)=>(Date.parse(b.priceAt)||0)-(Date.parse(a.priceAt)||0));const m=sources[0];const p=state.positions[symbol];if(positive(p?.mark))return {price:Number(p.mark),source:'מחיר ידני · '+new Date(p.updatedAt).toLocaleString('he-IL')};if(m&&!manualCharts.has(symbol))return {price:m.price,source:m.source+' · '+(m.priceKind==='LAST_BAR_CLOSE'?'סגירת נר אחרון · ':'מחיר ספק · ')+(m.priceAt?formatMarketTime(m.priceAt):'זמן נתון לא זמין')+' · ייתכן עיכוב'+(m.loadedAt&&Date.now()-m.loadedAt>=300000?' · נתון קודם, ממתין לרענון':'')};const bars=state.bars[symbol];return bars?.length?{price:bars.at(-1).close,source:'CSV · '+bars.at(-1).date}:null;}
function pnl(symbol){const p=state.positions[symbol],m=mark(symbol);return p&&m?{value:p.qty*m.price,gain:p.qty*(m.price-p.entry),pct:(m.price/p.entry-1)*100}:null;}
function formatMarketTime(at){return /^\d{4}-\d{2}-\d{2}$/.test(at)?at:new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});}
function chartBars(){return markets[selected]&&!manualCharts.has(selected)?markets[selected].bars:state.bars[selected]||[];}
function render(preserveForm=false,preserveChart=false){
 $('#watchCount').textContent=String(state.symbols.length);
 $('#watchList').replaceChildren();for(const s of state.symbols){const b=document.createElement('button');b.className='watch-row'+(s===selected?' active':'');b.type='button';b.setAttribute('aria-pressed',s===selected?'true':'false');const symbol=document.createElement('b');symbol.textContent=s;const price=document.createElement('span');const m=mark(s);price.textContent=m?money(m.price):(quoteStatus[s]||'ממתין לטעינה');if(m)price.title=m.source+(quoteStatus[s]?' · '+quoteStatus[s]:'');b.append(symbol,price);b.onclick=()=>{selected=s;render();loadMarket(false);};$('#watchList').append(b);}
 $('#selectedSymbol').textContent=selected;$('#positionSymbol').textContent=selected;$('#externalChart').href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent(selected);
 const m=mark(selected),p=state.positions[selected],r=pnl(selected);$('#selectedPrice').textContent=m?money(m.price):'—';$('#priceSource').textContent=m?m.source:'אין נתוני מחיר';
 $('#selectedPnl').textContent=!p?'אין פוזיציה במעקב':!r?'ממתין למחיר למעקב':(r.gain>0?'+':'')+money(r.gain)+' ('+(r.pct>0?'+':'')+r.pct.toFixed(2)+'%)';$('#selectedPnl').className=r?(r.gain>=0?'profit':'loss'):'';
 const f=$('#positionForm');if(!preserveForm){f.elements.entry.value=p?.entry??'';f.elements.qty.value=p?.qty??'';f.elements.mark.value=p?.mark??'';}
 const symbols=Object.keys(state.positions),results=symbols.map(pnl),complete=results.every(Boolean);$('#positionCount').textContent=String(symbols.length);
 $('#totalValue').textContent=!symbols.length?'—':complete?money(results.reduce((s,p)=>s+p.value,0)):'חסרים מחירים';const gain=results.filter(Boolean).reduce((s,p)=>s+p.gain,0);$('#totalPnl').textContent=!symbols.length?'—':complete?(gain>0?'+':'')+money(gain):'חסרים מחירים';$('#totalPnl').className=symbols.length&&complete?(gain>=0?'profit':'loss'):'';
 if(!preserveChart)renderChart();
}
function validBar(b){return b&&typeof b.date==='string'&&Number.isFinite(Date.parse(b.date))&&['open','high','low','close'].every(k=>positive(b[k]))&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low;}
function parseCandles(text){
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines.length<2||lines.length>20001)throw Error('נדרש קובץ עם כותרת ו־1 עד 20,000 נרות.');
 const split=line=>line.split(',').map(s=>s.trim().replace(/^"|"$/g,'')),header=split(lines.shift()).map(s=>s.toLowerCase());const keys=['date','open','high','low','close'],indices=keys.map(k=>header.indexOf(k));if(indices.some(i=>i<0))throw Error('כותרות נדרשות: Date, Open, High, Low, Close.');
 const bars=lines.filter(s=>s.trim()).map(line=>{const cells=split(line),bar={};keys.forEach((k,i)=>bar[k]=k==='date'?cells[indices[i]]:Number(cells[indices[i]]));if(!/^\d{4}-\d{2}-\d{2}(?:$|T.*(?:Z|[+-]\d{2}:\d{2})$)/.test(bar.date||'')||!validBar(bar))throw Error('נמצאו תאריך או ערכי נר לא תקינים.');if(Date.parse(bar.date)>Date.now())throw Error('הקובץ מכיל תאריך עתידי.');return bar;}).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 if(!bars.length||new Set(bars.map(b=>Date.parse(b.date))).size!==bars.length)throw Error('נדרשים נרות ללא תאריכים כפולים.');return bars.slice(-2000);
}
let drawTool='select',selectedDrawingId=null,draft=null,drag=null,chartDrawing=null;
function renderChart(){
 draft=null;drag=null;chartDrawing=null;
 const root=$('#chart'),bars=lastTwoTradingDays(chartBars(),markets[selected]?.interval||$('#marketInterval').value);$('#chartMarkDetails').textContent='לחץ על נר מסומן או על פירוט מתחת לגרף להצגת המחיר והזמן.';$('#chartMarkLegend').replaceChildren();$('#wyckoffOccurrences').replaceChildren();$('#wyckoffOccurrenceStatus').textContent='ממתין לנרות לניתוח בטווח המוצג';root.replaceChildren();if(!bars.length){paintDrawings();$('#drawingHelp').textContent='טען נרות לפני הוספת קווים לגרף';const p=document.createElement('p');p.textContent=['1week','1month'].includes($('#marketInterval').value)?'לטווח של שני ימי מסחר בחר נרות 5 דקות, שעה או יום.':'טען נתוני שוק או ייבא CSV כדי להציג גרף נרות';root.append(p);return;}
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 850 315');const add=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text)el.textContent=text;svg.append(el);return el;};
 const chartName=STOCK_NAMES[selected]||markets[selected]?.name||quotes[selected]?.name||selected;
 add('rect',{x:15,y:2,width:745,height:22,rx:4,fill:'#08111f'});
 add('text',{x:25,y:18,fill:'#edf5ff','font-size':16,'font-weight':'bold','data-chart-symbol':selected},chartName===selected?selected:selected+' · '+chartName);
 const sim=manualCharts.has(selected)?{points:[],lines:[],cards:[]}:simulationMarks(selected);const interval=markets[selected]?.interval||$('#marketInterval').value;const visiblePoints=sim.points.map(point=>({...point,index:markBarIndex(point,bars,interval)})).filter(point=>point.index>=0);const entry=state.positions[selected]?.entry,values=bars.flatMap(b=>[b.high,b.low]);for(const line of sim.lines)values.push(line.price);for(const point of visiblePoints)values.push(point.price);if(entry)values.push(entry);let lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo)*.08||hi*.01;lo-=pad;hi+=pad;const y=p=>275-(p-lo)/(hi-lo)*250,x=i=>20+(i+.5)*730/bars.length;
 for(let i=0;i<5;i++){const price=lo+(hi-lo)*i/4;add('line',{x1:15,y1:y(price),x2:760,y2:y(price),stroke:'#21364b'});add('text',{x:775,y:y(price)+4,fill:'#93a8bf','font-size':11},price.toFixed(price<10?4:2));}
 const activeEntry=sim.lines.some(l=>l.kind==='stop')?sim.cards.find(c=>c.kind==='buy'):null;
 bars.forEach((b,i)=>{const marks=visiblePoints.filter(p=>p.index===i),primary=marks.find(p=>p.kind==='peak')||marks.find(p=>p.kind==='buy'||p.kind==='sell')||marks.at(-1),color=primary?.color||(b.close>=b.open?'#67e0ae':'#ff798b'),w=Math.max(2,Math.min(12,730/bars.length*.6));const line=add('line',{x1:x(i),x2:x(i),y1:y(b.high),y2:y(b.low),stroke:color,'stroke-width':primary?2:1});const body=add('rect',{x:x(i)-w/2,y:Math.min(y(b.open),y(b.close)),width:w,height:Math.max(primary?3:1,Math.abs(y(b.open)-y(b.close))),fill:color});
  const pulse=marks.some(p=>p.pulse||(activeEntry&&p.kind==='buy'&&p.at===activeEntry.at));for(const el of [line,body]){if(pulse){el.classList.add('sim-candle-flash');el.setAttribute('data-pulse-candle',String(i));}const title=document.createElementNS(ns,'title');title.textContent=b.date+' · O '+b.open+' · H '+b.high+' · L '+b.low+' · C '+b.close;el.append(title);}
  if(marks.length){const hit=add('rect',{x:x(i)-Math.max(6,w/2),y:Math.min(y(b.high),y(b.low))-5,width:Math.max(12,w),height:Math.max(14,Math.abs(y(b.high)-y(b.low))+10),fill:'transparent',stroke:'transparent','data-mark-id':marks.map(m=>m.id).join('|'),tabindex:0,role:'button','aria-label':marks.map(m=>m.name+' '+m.price).join(' · ')});const title=document.createElementNS(ns,'title');title.textContent=marks.map(m=>m.name+' · '+m.price+' USD').join(' / ');hit.append(title);const show=()=>{$('#chartMarkDetails').textContent=marks.map(detail).join(' | ');};hit.onclick=e=>{e.stopPropagation();show();};hit.onpointerdown=e=>e.stopPropagation();hit.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();show();}};}
 });
 if(entry)add('line',{x1:15,x2:760,y1:y(entry),y2:y(entry),stroke:'#74b8ff','stroke-dasharray':'6 4'});
 const money=p=>p.toLocaleString('en-US',{maximumFractionDigits:p<10?6:4}),atTime=at=>Number.isFinite(at)?new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'זמן שיא לא תועד';
 const detail=point=>point.name+' · '+money(point.price)+' USD'+(Number.isFinite(point.at)?' · '+atTime(point.at):point.kind==='peak'?' · זמן השיא לא תועד':'');
 let previousLabelY=-Infinity;
 for(const line of [...sim.lines].sort((a,b)=>y(a.price)-y(b.price))){
  add('line',{x1:15,x2:760,y1:y(line.price),y2:y(line.price),stroke:line.color,'stroke-dasharray':'5 4','data-price-level':line.kind});
  const labelY=Math.max(y(line.price)+13,previousLabelY+17);previousLabelY=labelY;
  const name=({buy:'קנייה',sell:'מכירה',peak:'שיא',stop:'סף מכירה'})[line.kind]||line.name;
  const text=name+' · '+money(line.price)+' USD';
  add('text',{x:740,y:Math.min(290,labelY),fill:line.color,'font-size':12,'font-weight':'bold',direction:'rtl','text-anchor':'start',style:'paint-order:stroke;stroke:#08111f;stroke-width:4px;stroke-linejoin:round','data-line-label':line.kind},text);
 }
 let previousBadgeY=-Infinity;for(const line of [...sim.lines].sort((a,b)=>y(a.price)-y(b.price))){const badgeY=Math.min(270,Math.max(35,y(line.price),previousBadgeY+16));previousBadgeY=badgeY;add('line',{x1:760,y1:y(line.price),x2:770,y2:badgeY,stroke:line.color});add('rect',{x:766,y:badgeY-10,width:81,height:15,rx:3,fill:'#08111f',stroke:line.color});add('text',{x:843,y:badgeY+1,fill:line.color,'font-size':10,'text-anchor':'end'},money(line.price));}
 for(const card of sim.cards){const button=document.createElement('button');button.type='button';button.className='mark-card secondary';button.style.borderColor=card.color;const name=document.createElement('span'),value=document.createElement('b');name.textContent=card.name;value.textContent=money(card.price)+' USD';value.style.color=card.color;button.append(name,value);if(Number.isFinite(card.at)){const date=document.createElement('small');date.textContent=atTime(card.at);button.append(date);}button.onclick=()=>{$('#chartMarkDetails').textContent=detail(card)+(Number.isFinite(card.at)&&markBarIndex(card,bars,interval)<0?' · הנקודה מחוץ לטווח הנרות המוצג':'');};$('#chartMarkLegend').append(button);}
 if(!sim.cards.length)$('#chartMarkDetails').textContent=manualCharts.has(selected)?'מצב CSV · סימוני סימולציה מוסתרים כדי לא לערבב מקורות נתונים.':'טרם זוהו נקודות וואיקוף או עסקאות עבור המניה הזו; נקודות יופיעו עם התקדמות הבדיקה.';
 const history=manualCharts.has(selected)?[]:mergeWyckoffOccurrences(simulationWyckoffHistory(selected),wyckoffHistories[selected]||[]);
 const occurrences=numberedWyckoffOccurrences(history,bars,interval);
 $('#wyckoffOccurrenceStatus').textContent='תבניות וואיקוף בטווח המוצג: '+occurrences.length+' · המספור לפי סדר הזמן בטווח היומיים. הזיהוי ממשיך גם בזמן פוזיציה פעילה.'+(wyckoffErrors[selected]?' · חלק מהניתוח אינו זמין: '+wyckoffErrors[selected]:'');
 const showOccurrence=item=>{$('#chartMarkDetails').textContent='וואיקוף '+item.number+' · Spring: '+atTime(item.springAt)+' · '+(item.confirmedAt?'חזרה מעל התמיכה: '+atTime(item.confirmedAt):'Spring זוהה; טרם זוהתה חזרה מעל התמיכה')+' · זיהוי תבנית מהנרות, אינו מעיד על קנייה. '+Object.entries(item.setup).filter(([,p])=>p&&Number.isFinite(p.price)).map(([key,p])=>({initialPeak:'שיא ראשוני',firstLow:'שפל ראשון',rallyHigh:'שיא התאוששות',secondaryTest:'בדיקה חוזרת',springLow:'Spring',confirmation:'אישור חזרה'}[key]||key)+': '+money(p.price)+' USD · '+atTime(p.time)).join(' | ');};
 for(const item of occurrences){const badgeX=x(item.index),badgeY=Math.min(258,Math.max(30,y(item.setup.springLow.price)+10));const group=document.createElementNS(ns,'g');group.setAttribute('data-wyckoff-occurrence',item.id);group.setAttribute('role','button');group.setAttribute('tabindex','0');group.setAttribute('aria-label','וואיקוף '+item.number+' · '+atTime(item.springAt));const rect=document.createElementNS(ns,'rect');for(const [k,v]of Object.entries({x:badgeX-10,y:badgeY,width:20,height:18,rx:4,fill:'#243e56',stroke:'#f4dd7c'}))rect.setAttribute(k,v);const text=document.createElementNS(ns,'text');for(const [k,v]of Object.entries({x:badgeX,y:badgeY+13,fill:'#f4dd7c','font-size':12,'font-weight':'bold','text-anchor':'middle'}))text.setAttribute(k,v);text.textContent=item.number;group.append(rect,text);group.onpointerdown=e=>e.stopPropagation();group.onclick=e=>{e.stopPropagation();showOccurrence(item);};group.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();showOccurrence(item);}};svg.append(group);const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='וואיקוף '+item.number+' · '+atTime(item.springAt);button.onclick=()=>showOccurrence(item);$('#wyckoffOccurrences').append(button);}
 add('text',{x:20,y:303,fill:'#93a8bf','font-size':11},bars[0].date);add('text',{x:750,y:303,fill:'#93a8bf','font-size':11,'text-anchor':'end'},bars.at(-1).date);root.append(svg);attachDrawingTools(svg,bars,lo,hi);root.setAttribute('aria-label','גרף נרות '+selected+' · מוצגים שני ימי המסחר האחרונים בלבד.');
}
$('#watchForm').onsubmit=e=>{e.preventDefault();const s=$('#newSymbol').value.trim().toUpperCase();if(!validSymbol(s))return message('הזן סימול תקין באותיות אנגליות.');if(state.symbols.length>=100&&!state.symbols.includes(s))return message('ניתן לשמור עד 100 מניות במעקב.');if(!state.symbols.includes(s))state.symbols.push(s);selected=s;$('#newSymbol').value='';message('');save();render();loadMarket(false);};
$('#positionForm').onsubmit=e=>{e.preventDefault();const f=e.target,entry=Number(f.elements.entry.value),qty=Number(f.elements.qty.value),raw=f.elements.mark.value,mark=raw===''?null:Number(raw);if(!positive(entry)||!positive(qty)||(mark!==null&&!positive(mark)))return message('מחיר וכמות חייבים להיות מספרים חיוביים.');state.positions[selected]={entry,qty,mark,updatedAt:new Date().toISOString()};message('הפוזיציה נשמרה למעקב מקומי בלבד.');save();render();};
$('#removePosition').onclick=()=>{delete state.positions[selected];message('הפוזיציה הוסרה מהמעקב בלבד. לא נשלחה פקודת מכירה.');save();render();};
$('#csvFile').onchange=async e=>{const file=e.target.files[0],symbol=selected;if(!file)return;try{if(file.size>3000000)throw Error('גודל הקובץ המרבי הוא 3MB.');const bars=parseCandles(await file.text());state.bars[symbol]=bars;manualCharts.add(symbol);message('יובאו '+bars.length+' נרות עבור '+symbol+'. הנתונים אינם מחירים חיים.');save();render();}catch(err){message(err.message);}finally{e.target.value='';}};

async function loadMarket(force=true){
 const symbol=selected,interval=$('#marketInterval').value,key=symbol+':'+interval;
 if(force)manualCharts.delete(symbol);
 if(manualCharts.has(symbol)){ $('#marketStatus').textContent='מצב CSV · רענן נתוני שוק כדי לחזור לספק החיצוני';return; }
 if(pendingMarkets.has(key))return;
 if(!force&&markets[symbol]?.interval===interval&&Date.now()-markets[symbol].loadedAt<60000){$('#marketStatus').textContent=markets[symbol].notice;return;}
 const request=++marketRequest;pendingMarkets.add(key);$('#marketStatus').textContent='טוען '+symbol+' מ־Twelve Data…';
 try{
  const response=await fetch('/.netlify/functions/colmex-stocks-market?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(interval),{cache:'no-store',signal:AbortSignal.timeout(20000)}),data=await response.json();
  if(!response.ok)throw Error(data.error||'שגיאת מקור נתונים');
  if(data.symbol!==symbol||data.interval!==interval||data.currency!=='USD'||!positive(data.price)||!Array.isArray(data.bars)||!data.bars.length||!data.bars.every(validBar))throw Error('נתוני המקור אינם תקינים');
  if(drag||draft||manualCharts.has(symbol)||request!==marketRequest||selected!==symbol||$('#marketInterval').value!==interval)return;
  markets[symbol]={...data,loadedAt:Date.now()};quotes[symbol]={...(quotes[symbol]||{}),symbol,price:data.price,priceAt:data.priceAt,priceKind:data.priceKind,source:data.source,currency:'USD',loadedAt:Date.now()};quoteStatus[symbol]='';quoteNextAt[symbol]=Date.now()+300000;saveQuotes();
  if(['5min','10min','15min'].includes(interval)){try{wyckoffHistories[symbol]=chartWyckoffOccurrences(data.analysisBars||data.bars);wyckoffErrors[symbol]=null;}catch(e){wyckoffErrors[symbol]=e.message;}}
 if(request===marketRequest&&selected===symbol&&$('#marketInterval').value===interval){render(true);$('#marketStatus').textContent=data.notice+' נרות: '+({'1day':'יום','1h':'שעה','5min':'5 דקות','10min':'10 דקות','15min':'15 דקות'}[interval])+' · '+(data.isMarketOpen===true?'הספק מדווח: שוק פתוח':data.isMarketOpen===false?'הספק מדווח: שוק סגור':'מצב השוק לא זמין')+' · בקשת נתונים: '+new Date().toLocaleTimeString('he-IL');}
 }catch(error){if(request===marketRequest&&selected===symbol)$('#marketStatus').textContent=(error.name==='TimeoutError'?'הספק לא השיב בזמן.':error.message)+' נתונים קודמים, אם קיימים, נשארים מוצגים עם מועד הנתון.';}
 finally{pendingMarkets.delete(key);}
}
$('#loadMarket').onclick=()=>loadMarket(true);
$('#marketInterval').onchange=()=>loadMarket(true);
$('#autoMarket').onchange=()=>{if($('#autoMarket').checked)loadMarket(false);};
setInterval(()=>{if($('#autoMarket').checked&&!document.hidden&&!drag&&!draft)loadMarket(false);},60000);

function drawings(){return state.drawings[selected]||(state.drawings[selected]=[]);}
function setDrawTool(tool){drawTool=tool;draft=null;for(const b of document.querySelectorAll('[data-draw-tool]'))b.setAttribute('aria-pressed',b.dataset.drawTool===tool?'true':'false');$('#drawingHelp').textContent=tool==='horizontal'?'לחץ על הגרף להצבת קו אופקי במחיר הרצוי.':tool==='trend'?'לחץ על נקודת התחלה ואז על נקודת סיום של הקו.':'בחר קו וגרור להזזה; גרור את העיגולים לשינוי הקצוות. הקווים נשמרים לכל מניה במכשיר הזה.';paintDrawings();}
function paintDrawings(){
 $('#deleteDrawing').disabled=!drawings().some(d=>d.id===selectedDrawingId);
 if(!chartDrawing)return;const {group,geometry,svg}=chartDrawing;group.replaceChildren();
 const add=(tag,attrs,parent=group)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e;};
 for(const d of [...drawings(),...(draft?[{...draft,id:'draft',type:'trend',points:[draft.points[0],draft.preview||draft.points[0]]}]:[])]){
  const points=d.points.map(geometry.pointToPixel),horizontal=d.type==='horizontal',x1=horizontal?15:points[0].x,x2=horizontal?760:points[1].x,y1=points[0].y,y2=horizontal?y1:points[1].y;
  const line=add('line',{x1,x2,y1,y2,stroke:d.color,'stroke-width':d.id===selectedDrawingId?3:2,'pointer-events':'none'});
  const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=(horizontal?'קו אופקי · ':'קו אלכסוני · ')+d.points.map(p=>p.price.toFixed(4)).join(' → ');line.append(title);
  if(d.id==='draft')continue;
  add('line',{x1,x2,y1,y2,stroke:'transparent','stroke-width':18,'data-drawing-id':d.id,class:'drawing-hit','pointer-events':'stroke'});
  if(d.id===selectedDrawingId){(horizontal?[{x:390,y:y1}]:points).forEach((p,i)=>add('circle',{cx:p.x,cy:p.y,r:7,fill:'#08111f',stroke:d.color,'stroke-width':2,'data-drawing-id':d.id,'data-endpoint':horizontal?'':i,class:'drawing-handle'}));}
 }
}
function attachDrawingTools(svg,bars,low,high){
 const ns=svg.namespaceURI,defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),rect=document.createElementNS(ns,'rect');clip.id='colmex-drawing-clip';for(const [k,v]of Object.entries({x:15,y:25,width:745,height:250}))rect.setAttribute(k,v);clip.append(rect);defs.append(clip);svg.append(defs);const group=document.createElementNS(ns,'g');group.setAttribute('clip-path','url(#colmex-drawing-clip)');svg.append(group);svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','גרף נרות עם קווים ניתנים לגרירה. מחק מוחק קו נבחר; חצים מזיזים אותו.');
 const geometry=chartGeometry(bars,low,high);chartDrawing={svg,group,geometry};
 const pixel=event=>{const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(svg.getScreenCTM().inverse());};
 svg.onpointerdown=event=>{
  if(event.button!==0)return;const p=pixel(event);if(p.x<15||p.x>760||p.y<25||p.y>275)return;event.preventDefault();svg.focus({preventScroll:true});
  const hit=event.target.closest('[data-drawing-id]');
  if(drawTool==='select'&&hit){const d=drawings().find(x=>x.id===hit.dataset.drawingId);if(!d)return;selectedDrawingId=d.id;const endpoint=hit.dataset.endpoint;drag={id:d.id,start:p,original:structuredClone(d),endpoint:endpoint===undefined||endpoint===''?null:Number(endpoint)};svg.setPointerCapture(event.pointerId);paintDrawings();return;}
  if(drawTool==='select'){selectedDrawingId=null;paintDrawings();return;}
  const point=geometry.pixelToPoint(p),color=$('#drawingColor').value;
  if(drawings().length>=100){message('ניתן לשמור עד 100 קווים לכל מניה.');return;}
  if(drawTool==='trend'&&!draft){draft={color,points:[point],preview:point};$('#drawingHelp').textContent='כעת לחץ על נקודת הסיום של הקו.';paintDrawings();return;}
  const d={id:crypto.randomUUID(),type:drawTool,color:drawTool==='trend'?draft.color:color,points:drawTool==='trend'?[draft.points[0],point]:[point]};drawings().push(d);selectedDrawingId=d.id;draft=null;save();setDrawTool('select');
 };
 svg.onpointermove=event=>{if(drag){const p=pixel(event),i=drawings().findIndex(d=>d.id===drag.id);if(i<0)return;drawings()[i]=moveDrawing(drag.original,geometry,p.x-drag.start.x,p.y-drag.start.y,drag.endpoint);paintDrawings();}else if(draft){draft.preview=geometry.pixelToPoint(pixel(event));paintDrawings();}};
 svg.onpointerup=event=>{if(drag){drag=null;save();if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);}};
 svg.onpointercancel=()=>{if(drag){const i=drawings().findIndex(d=>d.id===drag.id);if(i>=0)drawings()[i]=drag.original;drag=null;paintDrawings();}};
 svg.onkeydown=event=>{if(event.key==='Escape'){setDrawTool('select');return;}const d=drawings().find(x=>x.id===selectedDrawingId);if(!d)return;if(['Delete','Backspace'].includes(event.key)){event.preventDefault();deleteSelectedDrawing();}const delta={ArrowLeft:[-3,0],ArrowRight:[3,0],ArrowUp:[0,-3],ArrowDown:[0,3]}[event.key];if(delta){event.preventDefault();state.drawings[selected]=drawings().map(x=>x.id===d.id?moveDrawing(d,geometry,...delta):x);save();paintDrawings();}};
 setDrawTool(drawTool);
}
function deleteSelectedDrawing(){state.drawings[selected]=drawings().filter(d=>d.id!==selectedDrawingId);selectedDrawingId=null;save();paintDrawings();}
for(const button of document.querySelectorAll('[data-draw-tool]'))button.onclick=()=>setDrawTool(button.dataset.drawTool);
$('#deleteDrawing').onclick=deleteSelectedDrawing;
$('#drawingColor').oninput=()=>{const d=drawings().find(x=>x.id===selectedDrawingId);if(d){d.color=$('#drawingColor').value;save();paintDrawings();}};
render();
loadMarket(false);

// Only quote prices are fetched for the watchlist; chart history stays selected-only.
// A paced queue shares the provider's existing eight-request/minute guard.
async function loadNextWatchQuote(){
 if(quoteBusy||document.hidden||!$('#autoMarket').checked)return;
 const now=Date.now(),symbol=state.symbols.find(s=>(quoteNextAt[s]||0)<=now&&(!quotes[s]||now-quotes[s].loadedAt>=300000)&&![...pendingMarkets].some(k=>k.startsWith(s+':')));
 if(!symbol)return;quoteBusy=true;quoteStatus[symbol]='טוען מחיר…';render(true,true);
 try{
  const r=await fetch('/.netlify/functions/colmex-stock-quote?symbol='+encodeURIComponent(symbol),{cache:'no-store',signal:AbortSignal.timeout(20000)}),data=await r.json();
  if(!r.ok||data.symbol!==symbol||data.currency!=='USD'||!positive(data.price))throw Error('QUOTE_UNAVAILABLE');
  quotes[symbol]={...data,loadedAt:Date.now()};quoteStatus[symbol]='';quoteNextAt[symbol]=Date.now()+300000;saveQuotes();
 }catch{quoteStatus[symbol]='ממתין לספק · ניסיון חוזר';quoteNextAt[symbol]=Date.now()+65000;}
 finally{quoteBusy=false;render(true,true);}
 const ready=state.symbols.filter(s=>mark(s)).length;$('#watchQuoteStatus').textContent='מחירים מוצגים: '+ready+'/'+state.symbols.length+' · טעינה מדורגת · ייתכן עיכוב';
}
$('#refreshWatchQuotes').onclick=()=>{for(const s of state.symbols){quoteNextAt[s]=0;if(quotes[s])quotes[s].loadedAt=0;}$('#autoMarket').checked=true;loadNextWatchQuote();};
setInterval(loadNextWatchQuote,12500);
loadNextWatchQuote();

initSimulation({onSelect:symbol=>{if(!state.symbols.includes(symbol))state.symbols.push(symbol);selected=symbol;$('#marketInterval').value='5min';save();render();loadMarket(true);},onUpdate:()=>{if(!drag&&!draft)renderChart();}});

startCandleFlashing({root:$('#chart'),control:$('#flashCandles')});
