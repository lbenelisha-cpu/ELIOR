import {scanCoverage,stockScanStatus} from './lib/colmex-scan-coverage.mjs?v=20261029-higher-recovery';
import {renderSearchStatus} from './colmex-search-status.js?v=20261029-higher-recovery';
import {renderSlopePanel} from './ma-slope-panel.js?v=20261026-entry-alpha';
import {renderRsiChart} from './rsi-chart.js?v=20261026-rsi40';
import {createMarketLoadGate} from './lib/colmex-market-loading.mjs?v=20261021-chart-quota';
import {wyckoffArrowPoints,drawWyckoffArrows,wyckoffEdgeBands} from './lib/colmex-wyckoff-arrows.mjs?v=20261029-time-nav';
import {mergeWyckoffOccurrences} from './lib/wyckoff-occurrences.mjs';
import {startCandleFlashing,chartWyckoffOccurrences,numberedWyckoffOccurrences,chartAnalysisMarks} from './lib/colmex-chart-view.mjs?v=20261029-higher-recovery';
import {markBarIndex} from './lib/colmex-chart-marks.mjs?v=20261017-intervals';
function publishMarket(data){if(typeof window!=='undefined'){window.LEVI_COLMEX_MARKET=data;if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('levi:colmex-market',{detail:data}));}}
const PAPER_MODE=document.body.dataset.mode==='simulation';
let paperUI=null;
const simulationMarks=s=>paperUI?.simulationMarks(s)||{points:[],cards:[],lines:[]};
const simulationWyckoffHistory=s=>paperUI?.simulationWyckoffHistory(s)||[];
import {validShape} from './lib/chart-workbench.mjs?v=20261022-tools';
import {createWorkbench} from './chart-workbench.js?v=20261022-tools';
import {createChartTimeNavigation} from './chart-time-navigation.js?v=20261029-time-nav';
import {syncWatchRows,nextWatchQuote} from './lib/colmex-watch-view.mjs?v=20261029-higher-recovery';
import {COLMEX_WATCH_SYMBOLS} from './lib/colmex-watch-universe.mjs';
'use strict';
const $=s=>document.querySelector(s),KEY='levi-colmex-stocks-ui-v1',validSymbol=s=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(s),positive=n=>Number.isFinite(Number(n))&&Number(n)>0;
const quotes={},quoteStatus={},quoteNextAt={};let quoteBusy=false;
try{const stored=JSON.parse(localStorage.getItem(KEY+'-quotes')||'{}');for(const [symbol,q] of Object.entries(stored)){if(validSymbol(symbol)&&q?.symbol===symbol&&q.currency==='USD'&&positive(q.price)&&q.source==='Colmex Pro'&&q.priceKind==='BROKER_BID'&&Number.isFinite(q.loadedAt)&&q.loadedAt<=Date.now()&&Date.now()-q.loadedAt<86400000)quotes[symbol]=q;}}catch{}
function saveQuotes(){try{localStorage.setItem(KEY+'-quotes',JSON.stringify(quotes));}catch{}}

let liveSearchState={positions:[],after:{}};
const wyckoffHistories={},wyckoffErrors={},analysisMarks={};
const markets={},manualCharts=new Set(),pendingMarkets=new Set();let marketRequest=0;const marketLoadGate=createMarketLoadGate(),marketFailures=new Map();
const STOCK_NAMES={AAPL:'Apple',MSFT:'Microsoft',NVDA:'NVIDIA',AMZN:'Amazon',GOOGL:'Alphabet',META:'Meta Platforms',TSLA:'Tesla',AVGO:'Broadcom',JPM:'JPMorgan Chase',NFLX:'Netflix'};
const DEFAULT_SYMBOLS=PAPER_MODE?COLMEX_WATCH_SYMBOLS.slice(0,20):COLMEX_WATCH_SYMBOLS;
let state={symbols:[...DEFAULT_SYMBOLS],positions:{},bars:{},drawings:{}},selected='AAPL';
try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved&&Array.isArray(saved.symbols)){state.symbols=[...new Set(saved.symbols.filter(s=>typeof s==='string'&&validSymbol(s)))].slice(0,100);for(const s of state.symbols){const p=saved.positions?.[s];if(p&&positive(p.entry)&&positive(p.qty))state.positions[s]={entry:Number(p.entry),qty:Number(p.qty),mark:positive(p.mark)?Number(p.mark):null,updatedAt:p.updatedAt};const drawings=saved.drawings?.[s];if(Array.isArray(drawings))state.drawings[s]=drawings.filter(validShape).slice(0,100);const bars=saved.bars?.[s];if(Array.isArray(bars)&&bars.length<=2000&&bars.every(validBar))state.bars[s]=bars;}}}catch{}
// Include the server watchlist while preserving custom entries and local data.
for(const symbol of DEFAULT_SYMBOLS){if(state.symbols.length>=(PAPER_MODE?20:100))break;if(!state.symbols.includes(symbol))state.symbols.push(symbol);}
selected=state.symbols[0];
function message(s){$('#message').textContent=s;}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));return true;}catch{message('לא ניתן לשמור בדפדפן. הנתונים זמינים כעת בלבד; נסה לצמצם את גודל הייבוא.');return false;}}
function money(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);}
function mark(symbol){const sources=[markets[symbol],quotes[symbol]].filter(Boolean).sort((a,b)=>(Date.parse(b.priceAt||b.observedAt)||0)-(Date.parse(a.priceAt||a.observedAt)||0));const m=sources[0];const p=state.positions[symbol];if(PAPER_MODE&&positive(p?.mark))return {price:Number(p.mark),source:'מחיר ידני · '+new Date(p.updatedAt).toLocaleString('he-IL')};if(m&&!manualCharts.has(symbol))return {price:m.price,source:m.source+' · '+(m.priceKind==='LAST_BAR_CLOSE'?'סגירת נר אחרון · ':m.priceKind==='BROKER_BID'?'Bid · שעת קריאה: ':'מחיר ספק · ')+(m.priceAt?formatMarketTime(m.priceAt):m.observedAt?formatMarketTime(m.observedAt)+' · ללא חותמת זמן לציטוט':'זמן נתון לא זמין')+' · ייתכן עיכוב'+(Number.isFinite(Date.parse(m.priceAt||m.observedAt))&&Date.now()-Date.parse(m.priceAt||m.observedAt)>=300000?' · נתון קודם, ממתין לרענון':'')};const bars=state.bars[symbol];return bars?.length?{price:bars.at(-1).close,source:'CSV · '+bars.at(-1).date}:null;}
function pnl(symbol){const p=state.positions[symbol],m=mark(symbol);return p&&m?{value:p.qty*m.price,gain:p.qty*(m.price-p.entry),pct:(m.price/p.entry-1)*100}:null;}
function formatMarketTime(at){return /^\d{4}-\d{2}-\d{2}$/.test(at)?at:new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});}
function chartBars(){return markets[selected]&&!manualCharts.has(selected)?markets[selected].bars:state.bars[selected]||[];}
function render(preserveForm=false,preserveChart=false){
 $('#watchCount').textContent=String(state.symbols.length);
 const coverage=PAPER_MODE?null:scanCoverage(liveSearchState);if($('#watchScanStatus'))$('#watchScanStatus').textContent=coverage?.summary||'';
 syncWatchRows($('#watchList'),state.symbols,{selected,createElement:tag=>document.createElement(tag),onSelect:s=>{selected=s;render();loadMarket(false);},describe:s=>{const m=mark(s);return {...(!PAPER_MODE?stockScanStatus(s,liveSearchState,Date.now(),coverage):{}),text:m?money(m.price):(quoteStatus[s]||'ממתין לטעינה'),title:m?m.source+(quoteStatus[s]?' · '+quoteStatus[s]:''):''};}});
 $('#selectedSymbol').textContent=selected;if(PAPER_MODE)$('#positionSymbol').textContent=selected;$('#externalChart').href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent(selected);
 const m=mark(selected),p=state.positions[selected],r=pnl(selected);$('#selectedPrice').textContent=m?money(m.price):'—';$('#priceSource').textContent=m?m.source:'אין נתוני מחיר';
 if(PAPER_MODE){$('#selectedPnl').textContent=!p?'אין פוזיציה במעקב':!r?'ממתין למחיר למעקב':(r.gain>0?'+':'')+money(r.gain)+' ('+(r.pct>0?'+':'')+r.pct.toFixed(2)+'%)';$('#selectedPnl').className=r?(r.gain>=0?'profit':'loss'):'';
 const f=$('#positionForm');if(!preserveForm){f.elements.entry.value=p?.entry??'';f.elements.qty.value=p?.qty??'';f.elements.mark.value=p?.mark??'';}
 const symbols=Object.keys(state.positions),results=symbols.map(pnl),complete=results.every(Boolean);$('#positionCount').textContent=String(symbols.length);
 $('#totalValue').textContent=!symbols.length?'—':complete?money(results.reduce((s,p)=>s+p.value,0)):'חסרים מחירים';const gain=results.filter(Boolean).reduce((s,p)=>s+p.gain,0);$('#totalPnl').textContent=!symbols.length?'—':complete?(gain>0?'+':'')+money(gain):'חסרים מחירים';$('#totalPnl').className=symbols.length&&complete?(gain>=0?'profit':'loss'):'';
 }
 if(!preserveChart)renderChart();
}
function validBar(b){return b&&typeof b.date==='string'&&Number.isFinite(Date.parse(b.date))&&['open','high','low','close'].every(k=>positive(b[k]))&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low;}
function parseCandles(text){
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines.length<2||lines.length>20001)throw Error('נדרש קובץ עם כותרת ו־1 עד 20,000 נרות.');
 const split=line=>line.split(',').map(s=>s.trim().replace(/^"|"$/g,'')),header=split(lines.shift()).map(s=>s.toLowerCase());const keys=['date','open','high','low','close'],indices=keys.map(k=>header.indexOf(k));if(indices.some(i=>i<0))throw Error('כותרות נדרשות: Date, Open, High, Low, Close.');
 const bars=lines.filter(s=>s.trim()).map(line=>{const cells=split(line),bar={};keys.forEach((k,i)=>bar[k]=k==='date'?cells[indices[i]]:Number(cells[indices[i]]));if(!/^\d{4}-\d{2}-\d{2}(?:$|T.*(?:Z|[+-]\d{2}:\d{2})$)/.test(bar.date||'')||!validBar(bar))throw Error('נמצאו תאריך או ערכי נר לא תקינים.');if(Date.parse(bar.date)>Date.now())throw Error('הקובץ מכיל תאריך עתידי.');return bar;}).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 if(!bars.length||new Set(bars.map(b=>Date.parse(b.date))).size!==bars.length)throw Error('נדרשים נרות ללא תאריכים כפולים.');return bars.slice(-2000);
}
const workbench=createWorkbench({host:$('#chart'),toolbarHost:$('#chartTools'),volumeHost:$('#chartVolume'),getDrawings:()=>state.drawings[selected]||[],saveDrawings:items=>{state.drawings[selected]=items;return save();}});
const chartTimeNavigation=createChartTimeNavigation({host:$('#chartTimeNavigation'),onChange:()=>renderChart()});
function renderChart(){
 renderSearchStatus($('#wyckoffSearchStatus'),analysisMarks[selected]?.searchDiagnostic,{symbol:selected,progress:analysisMarks[selected]?.searchProgress,scan:PAPER_MODE?null:stockScanStatus(selected,liveSearchState),check:liveSearchState.checks?.[selected],position:liveSearchState.positions?.some(p=>p.symbol===selected),manual:manualCharts.has(selected)||PAPER_MODE});
 renderSlopePanel($('#colmexSlope'),manualCharts.has(selected)?[]:(markets[selected]?.analysisBars||[]),{symbol:selected,platform:'colmex',source:'Colmex Pro · 5 דקות',position:!PAPER_MODE&&!manualCharts.has(selected)?liveSearchState.positions?.find(p=>p.symbol===selected):null,price:liveSearchState.positions?.find(p=>p.symbol===selected)?.lastBid,priceAt:liveSearchState.positions?.find(p=>p.symbol===selected)?.lastQuoteAt});
 const rsiQuote=quotes[selected],rsiLive=markets[selected]?.liveAnalysisBar,quoteAt=Date.parse(rsiQuote?.observedAt||rsiQuote?.priceAt);
 const freshRsiLive=rsiQuote?.priceKind==='BROKER_BID'&&quoteAt>Number(rsiLive?.observedAt||0)?{date:new Date(Math.floor(quoteAt/300000)*300000).toISOString(),close:rsiQuote.price,observedAt:quoteAt}:rsiLive;
 renderRsiChart($('#colmexRsi'),markets[selected]?.rsiAnalysisBars||markets[selected]?.analysisBars||chartBars(),freshRsiLive||null);
 if(workbench.busy&&workbench.currentSymbol===selected)return;
 const root=$('#chart'),visibleWindow=chartTimeNavigation.view(chartBars(),{context:selected+':'+(markets[selected]?.interval||$('#marketInterval').value)+':'+manualCharts.has(selected),width:root.clientWidth||850}),bars=visibleWindow.bars;$('#chartMarkDetails').textContent='לחץ על נר מסומן או על פירוט מתחת לגרף להצגת המחיר והזמן.';$('#chartMarkLegend').replaceChildren();$('#wyckoffOccurrences').replaceChildren();$('#wyckoffOccurrenceStatus').textContent='ממתין לנרות לניתוח בטווח המוצג';root.replaceChildren();if(!bars.length){workbench.clear();globalThis.LEVI_TRADE_RISK?.render($('#colmexChartRisk'),null,'USD');const p=document.createElement('p');p.textContent='טען נתוני שוק או ייבא CSV כדי להציג גרף נרות';root.append(p);return;}
 const W=Math.max(320,root.clientWidth||850),plotRight=W-95,plotWidth=plotRight-20;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+W+' 315');const add=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text)el.textContent=text;svg.append(el);return el;};
 const chartName=STOCK_NAMES[selected]||markets[selected]?.name||quotes[selected]?.name||selected;
 const actualPosition=!PAPER_MODE&&!manualCharts.has(selected)?liveSearchState.positions?.find(p=>p.symbol===selected):null;
 const tradeRisk=globalThis.LEVI_TRADE_RISK?.levels(actualPosition);
 add('rect',{x:15,y:2,width:plotRight-15,height:22,rx:4,fill:'#08111f'});
 add('text',{x:25,y:18,fill:'#edf5ff','font-size':16,'font-weight':'bold','data-chart-symbol':selected},chartName===selected?selected:selected+' · '+chartName);
 const sim=manualCharts.has(selected)?{points:[],lines:[],cards:[]}:(PAPER_MODE?simulationMarks(selected):analysisMarks[selected]||{points:[],lines:[],cards:[]});const interval=markets[selected]?.interval||$('#marketInterval').value;const history=manualCharts.has(selected)?[]:mergeWyckoffOccurrences(simulationWyckoffHistory(selected),wyckoffHistories[selected]||[]);const occurrences=$('#showWyckoffHistory')?.checked?numberedWyckoffOccurrences(history,bars,interval):[];const arrowPoints=wyckoffArrowPoints(sim.points,occurrences,bars,interval);const visiblePoints=[...sim.points.filter(p=>!arrowPoints.some(a=>a.id===p.id)).map(point=>({...point,index:markBarIndex(point,bars,interval)})).filter(point=>point.index>=0),...arrowPoints];const entry=PAPER_MODE?state.positions[selected]?.entry:null,values=bars.flatMap(b=>[b.high,b.low]);if(tradeRisk)values.push(tradeRisk.target,tradeRisk.stop,tradeRisk.entry);for(const line of sim.lines)values.push(line.price);for(const point of visiblePoints)values.push(point.price);if(entry)values.push(entry);let lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo)*.08||hi*.01;lo-=pad;hi+=pad;const x=i=>20+(i+.5)*plotWidth/bars.length,bounds=wyckoffEdgeBands(arrowPoints,x,{left:16,right:plotRight}),y=p=>bounds.bottom-(p-lo)/(hi-lo)*250;svg.setAttribute('viewBox','0 0 '+W+' '+bounds.height);root.style.aspectRatio=W+' / '+bounds.height;
 for(let i=0;i<5;i++){const price=lo+(hi-lo)*i/4;add('line',{x1:15,y1:y(price),x2:plotRight,y2:y(price),stroke:'#21364b'});add('text',{x:plotRight+15,y:y(price)+4,fill:'#93a8bf','font-size':11},price.toFixed(price<10?4:2));}
 
 bars.forEach((b,i)=>{const marks=visiblePoints.filter(p=>p.index===i),primary=marks.find(p=>p.kind==='peak')||marks.find(p=>p.kind==='buy'||p.kind==='sell')||marks.at(-1),color=primary?.color||(b.close>=b.open?'#67e0ae':'#ff798b'),w=Math.max(2,Math.min(12,plotWidth/bars.length*.6));const line=add('line',{x1:x(i),x2:x(i),y1:y(b.high),y2:y(b.low),stroke:color,'stroke-width':primary?2:1});const body=add('rect',{x:x(i)-w/2,y:Math.min(y(b.open),y(b.close)),width:w,height:Math.max(primary?3:1,Math.abs(y(b.open)-y(b.close))),fill:color});
  const pulse=marks.some(p=>!p.provisional);for(const el of [line,body]){if(pulse){el.classList.add('sim-candle-flash');el.setAttribute('data-pulse-candle',String(i));}const title=document.createElementNS(ns,'title');title.textContent=b.date+' · O '+b.open+' · H '+b.high+' · L '+b.low+' · C '+b.close;el.append(title);}
  if(marks.length){const hit=add('rect',{x:x(i)-Math.max(6,w/2),y:Math.min(y(b.high),y(b.low))-5,width:Math.max(12,w),height:Math.max(14,Math.abs(y(b.high)-y(b.low))+10),fill:'transparent',stroke:'transparent','data-mark-id':marks.map(m=>m.id).join('|'),tabindex:0,role:'button','aria-label':marks.map(m=>m.name+' '+m.price).join(' · ')});const title=document.createElementNS(ns,'title');title.textContent=marks.map(m=>m.name+' · '+m.price+' USD').join(' / ');hit.append(title);const show=()=>{$('#chartMarkDetails').textContent=marks.map(detail).join(' | ');};hit.onclick=e=>{e.stopPropagation();show();};hit.onpointerdown=e=>e.stopPropagation();hit.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();show();}};}
 });
 if(entry)add('line',{x1:15,x2:plotRight,y1:y(entry),y2:y(entry),stroke:'#74b8ff','stroke-dasharray':'6 4'});
 const money=p=>p.toLocaleString('en-US',{maximumFractionDigits:p<10?6:4}),atTime=at=>Number.isFinite(at)?new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'זמן שיא לא תועד';
 const detail=point=>point.name+' · '+money(point.price)+' USD'+(Number.isFinite(point.at)?' · '+atTime(point.at):point.kind==='peak'?' · זמן השיא לא תועד':'');
 let previousLabelY=-Infinity;
 for(const line of [...sim.lines].sort((a,b)=>y(a.price)-y(b.price))){
  add('line',{x1:15,x2:plotRight,y1:y(line.price),y2:y(line.price),stroke:line.color,'stroke-dasharray':'5 4','data-price-level':line.kind});
  const labelY=Math.max(y(line.price)+13,previousLabelY+17);previousLabelY=labelY;
  const name=({buy:'קנייה',sell:'מכירה',peak:'שיא',stop:'סף מכירה'})[line.kind]||line.name;
  const text=name+' · '+money(line.price)+' USD';
  add('text',{x:plotRight-10,y:Math.min(bounds.bottom,labelY),fill:line.color,'font-size':12,'font-weight':'bold',direction:'rtl','text-anchor':'start',style:'paint-order:stroke;stroke:#08111f;stroke-width:4px;stroke-linejoin:round','data-line-label':line.kind},text);
 }
 let previousBadgeY=-Infinity;for(const line of [...sim.lines].sort((a,b)=>y(a.price)-y(b.price))){const badgeY=Math.min(bounds.bottom-5,Math.max(bounds.top+10,y(line.price),previousBadgeY+16));previousBadgeY=badgeY;add('line',{x1:plotRight,y1:y(line.price),x2:plotRight+10,y2:badgeY,stroke:line.color});add('rect',{x:plotRight+6,y:badgeY-10,width:81,height:15,rx:3,fill:'#08111f',stroke:line.color});add('text',{x:W-7,y:badgeY+1,fill:line.color,'font-size':10,'text-anchor':'end'},money(line.price));}
 for(const card of sim.cards){const button=document.createElement('button');button.type='button';button.className='mark-card secondary';button.style.borderColor=card.color;const name=document.createElement('span'),value=document.createElement('b');name.textContent=card.name;value.textContent=money(card.price)+' USD';value.style.color=card.color;button.append(name,value);if(Number.isFinite(card.at)){const date=document.createElement('small');date.textContent=atTime(card.at);button.append(date);}button.onclick=()=>{$('#chartMarkDetails').textContent=detail(card)+(Number.isFinite(card.at)&&markBarIndex(card,bars,interval)<0?' · הנקודה מחוץ לטווח הנרות המוצג':'');};$('#chartMarkLegend').append(button);}
 if(!sim.cards.length)$('#chartMarkDetails').textContent=manualCharts.has(selected)?'מצב CSV · סימוני סימולציה מוסתרים כדי לא לערבב מקורות נתונים.':'טרם זוהו נקודות וואיקוף בנתוני הגרף. מצב הכניסה בפועל נקבע בשרת LIVE.';
 $('#wyckoffOccurrenceStatus').textContent='תבניות וואיקוף בטווח המוצג: '+occurrences.length+' · '+($('#showWyckoffHistory')?.checked?'סימונים היסטוריים מוצגים לעיון':'מוצגת התבנית הנוכחית בלבד; ללא פוזיציה החיפוש מתקדם עם הנרות')+(wyckoffErrors[selected]?' · חלק מהניתוח אינו זמין: '+wyckoffErrors[selected]:'');
 const showOccurrence=item=>{$('#chartMarkDetails').textContent='וואיקוף '+item.number+' · Spring: '+atTime(item.springAt)+' · '+(item.confirmedAt?'חזרה מעל התמיכה: '+atTime(item.confirmedAt):'Spring זוהה; טרם זוהתה חזרה מעל התמיכה')+' · זיהוי תבנית מהנרות, אינו מעיד על קנייה. '+Object.entries(item.setup).filter(([,p])=>p&&Number.isFinite(p.price)).map(([key,p])=>({initialPeak:'שיא ראשוני',firstLow:'שפל ראשון',rallyHigh:'שיא התאוששות',secondaryTest:'בדיקה חוזרת',springLow:'Spring',confirmation:'אישור חזרה'}[key]||key)+': '+money(p.price)+' USD · '+atTime(p.time)).join(' | ');};
 drawWyckoffArrows({svg,points:arrowPoints,x,y,bounds,onSelect:point=>{$('#chartMarkDetails').textContent=(point.number?'וואיקוף '+point.number+' · ':'')+detail(point)+(['buy','sell','peak'].includes(point.kind)?(PAPER_MODE?' · עסקת סימולציה.':' · נתוני הפוזיציה שבמעקב השרת.'):' · סימון ניתוח; אינו מעיד על עסקה בפועל.');}});
 for(const item of occurrences){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='וואיקוף '+item.number+' · '+atTime(item.springAt);button.onclick=()=>showOccurrence(item);$('#wyckoffOccurrences').append(button);}
 const axisY=bounds.height-43;add('line',{x1:15,x2:plotRight,y1:axisY,y2:axisY,stroke:'#607b96','data-time-axis':'Asia/Jerusalem'});
 const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const tickCount=Math.min(bars.length,Math.max(2,Math.min(5,Math.floor(plotWidth/150))));for(let tick=0;tick<tickCount;tick++){const i=tickCount===1?0:Math.round(tick*(bars.length-1)/(tickCount-1)),px=x(i),labelX=Math.max(56,Math.min(plotRight-50,px)),parts=timeFormat.format(new Date(bars[i].date)).split(', ');add('line',{x1:px,x2:px,y1:axisY,y2:axisY+5,stroke:'#607b96'});add('text',{x:labelX,y:axisY+17,fill:'#a9bdd1','font-size':11,'text-anchor':'middle'},parts[0]);add('text',{x:labelX,y:axisY+31,fill:'#a9bdd1','font-size':11,'text-anchor':'middle'},parts[1]||'');}
 if(tradeRisk){
  for(const [price,color]of [[tradeRisk.target,'#64e1ae'],[tradeRisk.stop,'#ff8494']])if(price>=lo&&price<=hi)add('line',{x1:15,x2:plotRight,y1:y(price),y2:y(price),stroke:color,'stroke-dasharray':'6 4','data-fixed-exit':true});
  for(const [a,b,color]of [[tradeRisk.entry,tradeRisk.target,'#26c581'],[tradeRisk.stop,tradeRisk.entry,'#f44b66']]){
   const top=Math.max(bounds.top,y(b)),bottom=Math.min(bounds.bottom,y(a));if(bottom>top)add('rect',{x:20+plotWidth*.74,y:top,width:plotWidth*.26,height:bottom-top,fill:color,opacity:.13,'pointer-events':'none'});
  }
 }
 root.append(svg);globalThis.LEVI_TRADE_RISK?.render($('#colmexChartRisk'),actualPosition,'USD');
 workbench.update({symbol:selected,bars:bars.map(b=>({...b,time:Date.parse(b.date)})),low:lo,high:hi,width:W,height:bounds.height,preserveAspectRatio:'xMidYMid meet',bounds:{left:20,right:plotRight,top:bounds.top,bottom:bounds.bottom}});root.setAttribute('aria-label','גרף נרות '+selected+' · '+bars.length+' נרות בחלון הזמן הנבחר.');
}
$('#watchForm').onsubmit=e=>{e.preventDefault();const s=$('#newSymbol').value.trim().toUpperCase();if(!validSymbol(s))return message('הזן סימול תקין באותיות אנגליות.');if(state.symbols.length>=100&&!state.symbols.includes(s))return message('ניתן לשמור עד 100 מניות במעקב.');if(!state.symbols.includes(s))state.symbols.push(s);selected=s;$('#newSymbol').value='';message('');save();render();loadMarket(false);};
if(PAPER_MODE)$('#positionForm').onsubmit=e=>{e.preventDefault();const f=e.target,entry=Number(f.elements.entry.value),qty=Number(f.elements.qty.value),raw=f.elements.mark.value,mark=raw===''?null:Number(raw);if(!positive(entry)||!positive(qty)||(mark!==null&&!positive(mark)))return message('מחיר וכמות חייבים להיות מספרים חיוביים.');state.positions[selected]={entry,qty,mark,updatedAt:new Date().toISOString()};message('הפוזיציה נשמרה למעקב מקומי בלבד.');save();render();};
if(PAPER_MODE)$('#removePosition').onclick=()=>{delete state.positions[selected];message('הפוזיציה הוסרה מהמעקב בלבד. לא נשלחה פקודת מכירה.');save();render();};
$('#csvFile').onchange=async e=>{const file=e.target.files[0],symbol=selected;if(!file)return;try{if(file.size>3000000)throw Error('גודל הקובץ המרבי הוא 3MB.');const bars=parseCandles(await file.text());state.bars[symbol]=bars;manualCharts.add(symbol);message('יובאו '+bars.length+' נרות עבור '+symbol+'. הנתונים אינם מחירים חיים.');save();render();}catch(err){message(err.message);}finally{e.target.value='';}};

async function loadMarket(force=true){
 globalThis.LEVI_MARKET_POWER?.load(selected);
 const symbol=selected,interval=$('#marketInterval').value,key=symbol+':'+interval;
 if(force)manualCharts.delete(symbol);
 if(manualCharts.has(symbol)){ $('#marketStatus').textContent='מצב CSV · רענן נתוני שוק כדי לחזור לספק החיצוני';return; }
 if(pendingMarkets.has(key))return;
 if(!force&&markets[symbol]?.interval===interval&&Date.now()-markets[symbol].loadedAt<60000){$('#marketStatus').textContent=markets[symbol].notice;return;}
 if(!marketLoadGate.begin(key)){const retryAt=marketLoadGate.retryAt(key);$('#marketStatus').textContent=retryAt>Date.now()?(marketFailures.get(key)||'ממתין למקור הנתונים')+' · ניסיון אוטומטי ב־'+new Date(retryAt).toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem'}):'בקשת הגרף ממתינה לסיום הטעינה הקודמת';return;}
 let succeeded=false,retryAfterMs=65000;const request=++marketRequest;pendingMarkets.add(key);$('#marketStatus').textContent='טוען '+symbol+' מקולמקס־פרו…';
 try{
  const response=await fetch('/.netlify/functions/colmex-stocks-market?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(interval),{cache:'no-store',signal:AbortSignal.timeout(30000)}),data=await response.json();
  if(!response.ok){const error=Error(data.error||'שגיאת מקור נתונים');error.retryAfterMs=Number(data.retryAfterSeconds)*1000;throw error;}
  if(data.symbol!==symbol||data.interval!==interval||data.currency!=='USD'||data.source!=='Colmex Pro'||!positive(data.price)||!Array.isArray(data.bars)||!data.bars.length||!data.bars.every(validBar))throw Error('נתוני המקור אינם תקינים');
  succeeded=true;publishMarket({ok:true,symbol,observedAt:data.observedAt,priceAt:data.priceAt,cacheState:data.cacheState,providerErrorCode:data.providerErrorCode});marketFailures.delete(key);if(manualCharts.has(symbol))return;
  markets[symbol]={...data,loadedAt:Date.now()};if(!quotes[symbol]||(Date.parse(data.priceAt)||0)>=(Date.parse(quotes[symbol].priceAt||quotes[symbol].observedAt)||0))quotes[symbol]={...(quotes[symbol]||{}),symbol,price:data.price,priceAt:data.priceAt,priceKind:data.priceKind,source:data.source,currency:'USD',observedAt:data.observedAt,loadedAt:Date.now()};if(['PROVIDER_QUOTE','BROKER_BID'].includes(data.priceKind)){quoteStatus[symbol]='';quoteNextAt[symbol]=Date.now()+300000;}saveQuotes();
  if(data.analysisBars||['5min','10min','15min'].includes(interval)){try{wyckoffHistories[symbol]=chartWyckoffOccurrences(data.analysisBars||data.bars);analysisMarks[symbol]=chartAnalysisMarks(data.analysisBars||data.bars,Date.now(),{position:liveSearchState.positions?.find(p=>p.symbol===symbol),after:liveSearchState.after?.[symbol]||0});wyckoffErrors[symbol]=null;}catch(e){wyckoffErrors[symbol]=e.message;}}
 if(!workbench.busy&&request===marketRequest&&selected===symbol&&$('#marketInterval').value===interval){render(true);$('#marketStatus').textContent=data.notice+' נרות: '+({'1day':'יום','1h':'שעה','5min':'5 דקות','10min':'10 דקות','15min':'15 דקות'}[interval])+' · '+(data.isMarketOpen===true?'הספק מדווח: שוק פתוח':data.isMarketOpen===false?'הספק מדווח: שוק סגור':'מצב השוק לא זמין')+' · בקשת נתונים: '+new Date().toLocaleTimeString('he-IL');}
 }catch(error){if(Number.isFinite(error.retryAfterMs)&&error.retryAfterMs>0)retryAfterMs=error.retryAfterMs;const reason=error.name==='TimeoutError'?'הספק לא השיב בזמן.':error.message;marketFailures.set(key,reason);publishMarket({ok:false,symbol,reason});if(request===marketRequest&&selected===symbol)$('#marketStatus').textContent=reason+' נתונים קודמים, אם קיימים, נשארים מוצגים עם מועד הנתון. '+(retryAfterMs>3600000?'ניסיון נוסף לאחר איפוס המכסה.':'ניסיון אוטומטי בעוד כ־65 שניות.');}
 finally{pendingMarkets.delete(key);marketLoadGate.finish(key,succeeded,retryAfterMs);}
}
$('#loadMarket').onclick=()=>loadMarket(true);
$('#marketInterval').onchange=()=>loadMarket(true);
$('#autoMarket').onchange=()=>{if($('#autoMarket').checked)loadMarket(false);};
setInterval(()=>{if($('#autoMarket').checked&&!document.hidden&&!workbench.busy)loadMarket(false);},30000);

render();
loadMarket(false);

// Only quote prices are fetched for the watchlist; chart history stays selected-only.
// A paced queue shares the provider's existing eight-request/minute guard.
async function loadNextWatchQuote(){
 if(quoteBusy||document.hidden||!$('#autoMarket').checked||!marketLoadGate.quoteAllowed())return;
 const now=Date.now(),symbol=nextWatchQuote(state.symbols,{quotes,nextAt:quoteNextAt,blocked:new Set([...pendingMarkets].map(k=>k.split(':')[0])),now});
 if(!symbol)return;quoteBusy=true;quoteStatus[symbol]='טוען מחיר…';render(true,true);
 try{
  const r=await fetch('/.netlify/functions/colmex-stocks-market?view=quote&symbol='+encodeURIComponent(symbol),{cache:'no-store',signal:AbortSignal.timeout(30000)}),data=await r.json();
  if(!r.ok||data.symbol!==symbol||data.currency!=='USD'||data.source!=='Colmex Pro'||!positive(data.price))throw Error('QUOTE_UNAVAILABLE');
  quotes[symbol]={...data,loadedAt:Date.now()};quoteStatus[symbol]='';quoteNextAt[symbol]=Date.now()+300000;saveQuotes();
 }catch{quoteStatus[symbol]='ממתין לספק · ניסיון חוזר';quoteNextAt[symbol]=Date.now()+65000;}
 finally{quoteBusy=false;render(true,true);if(symbol===selected)renderRsiChart($('#colmexRsi'),markets[selected]?.rsiAnalysisBars||markets[selected]?.analysisBars||chartBars(),quotes[selected]?.priceKind==='BROKER_BID'?{date:new Date(Math.floor(Date.parse(quotes[selected].observedAt)/300000)*300000).toISOString(),close:quotes[selected].price,observedAt:Date.parse(quotes[selected].observedAt)}:null);}
 const ready=state.symbols.filter(s=>mark(s)).length;$('#watchQuoteStatus').textContent='מחירים מוצגים: '+ready+'/'+state.symbols.length+' · טעינה מדורגת · ייתכן עיכוב';
}
$('#refreshWatchQuotes').onclick=()=>{for(const s of state.symbols){quoteNextAt[s]=0;if(quotes[s])quotes[s].loadedAt=0;}$('#autoMarket').checked=true;loadNextWatchQuote();};
setInterval(loadNextWatchQuote,25000);
loadNextWatchQuote();

if(PAPER_MODE){paperUI=await import('./colmex-simulation-ui.js?v=20261017-occurrences');paperUI.initSimulation({onSelect:symbol=>{if(!state.symbols.includes(symbol))state.symbols.push(symbol);selected=symbol;$('#marketInterval').value='5min';save();render();loadMarket(true);},onUpdate:()=>{if(!workbench.busy)renderChart();}});}

startCandleFlashing({root:$('#chart'),control:$('#flashCandles')});
if(globalThis.ResizeObserver){let lastWidth=0;new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(width>0&&width!==lastWidth){lastWidth=width;renderChart();}}).observe($('#chart'));}

globalThis.addEventListener?.('levi-rsi-select',event=>{const symbol=event.detail;if(!validSymbol(symbol))return;if(!state.symbols.includes(symbol))state.symbols.push(symbol);selected=symbol;$('#marketInterval').value='5min';save();render();loadMarket(false);});

$('#showWyckoffHistory')?.addEventListener('change',()=>renderChart());
globalThis.window?.addEventListener('levi:colmex-status-error',()=>{liveSearchState={positions:[],after:{},unavailable:true};render(true);});
globalThis.window?.addEventListener('levi-colmex-rsi',event=>{
 if(PAPER_MODE)return;
 liveSearchState=event.detail||{positions:[],after:{}};
 for(const [symbol,data] of Object.entries(markets)){
  try{analysisMarks[symbol]=chartAnalysisMarks(data.analysisBars||data.bars,Date.now(),{position:liveSearchState.positions?.find(p=>p.symbol===symbol),after:liveSearchState.after?.[symbol]||0});}catch{}
 }
 render(true);
});
