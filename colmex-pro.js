import {validDrawing,chartGeometry,moveDrawing} from './lib/colmex-chart-drawings.mjs';
'use strict';
const $=s=>document.querySelector(s),KEY='levi-colmex-stocks-ui-v1',validSymbol=s=>/^[A-Z][A-Z0-9.-]{0,14}$/.test(s),positive=n=>Number.isFinite(Number(n))&&Number(n)>0;
const quotes={},quoteStatus={},quoteNextAt={};let quoteBusy=false;
try{const stored=JSON.parse(localStorage.getItem(KEY+'-quotes')||'{}');for(const [symbol,q] of Object.entries(stored)){if(validSymbol(symbol)&&q?.symbol===symbol&&q.currency==='USD'&&positive(q.price)&&q.source==='Twelve Data'&&Number.isFinite(q.loadedAt)&&q.loadedAt<=Date.now()&&Date.now()-q.loadedAt<86400000)quotes[symbol]=q;}}catch{}
function saveQuotes(){try{localStorage.setItem(KEY+'-quotes',JSON.stringify(quotes));}catch{}}

const markets={},manualCharts=new Set(),pendingMarkets=new Set();let marketRequest=0;
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
 const root=$('#chart'),bars=chartBars().slice(-90);root.replaceChildren();if(!bars.length){paintDrawings();$('#drawingHelp').textContent='טען נרות לפני הוספת קווים לגרף';const p=document.createElement('p');p.textContent='טען נתוני שוק או ייבא CSV כדי להציג גרף נרות';root.append(p);return;}
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 850 315');const add=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text)el.textContent=text;svg.append(el);return el;};
 const entry=state.positions[selected]?.entry,values=bars.flatMap(b=>[b.high,b.low]);if(entry)values.push(entry);let lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo)*.08||hi*.01;lo-=pad;hi+=pad;const y=p=>275-(p-lo)/(hi-lo)*250,x=i=>20+(i+.5)*730/bars.length;
 for(let i=0;i<5;i++){const price=lo+(hi-lo)*i/4;add('line',{x1:15,y1:y(price),x2:760,y2:y(price),stroke:'#21364b'});add('text',{x:775,y:y(price)+4,fill:'#93a8bf','font-size':11},price.toFixed(price<10?4:2));}
 bars.forEach((b,i)=>{const color=b.close>=b.open?'#67e0ae':'#ff798b',w=Math.max(2,Math.min(12,730/bars.length*.6));const line=add('line',{x1:x(i),x2:x(i),y1:y(b.high),y2:y(b.low),stroke:color});const body=add('rect',{x:x(i)-w/2,y:Math.min(y(b.open),y(b.close)),width:w,height:Math.max(1,Math.abs(y(b.open)-y(b.close))),fill:color});for(const el of [line,body]){const title=document.createElementNS(ns,'title');title.textContent=b.date+' · O '+b.open+' · H '+b.high+' · L '+b.low+' · C '+b.close;el.append(title);}});
 if(entry)add('line',{x1:15,x2:760,y1:y(entry),y2:y(entry),stroke:'#74b8ff','stroke-dasharray':'6 4'});
 add('text',{x:20,y:303,fill:'#93a8bf','font-size':11},bars[0].date);add('text',{x:750,y:303,fill:'#93a8bf','font-size':11,'text-anchor':'end'},bars.at(-1).date);root.append(svg);attachDrawingTools(svg,bars,lo,hi);root.setAttribute('aria-label','גרף נרות '+selected+' · מוצגים עד 90 נרות אחרונים.');
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
  if(data.symbol!==symbol||data.currency!=='USD'||!positive(data.price)||!Array.isArray(data.bars)||!data.bars.length||!data.bars.every(validBar))throw Error('נתוני המקור אינם תקינים');
  if(drag||draft||manualCharts.has(symbol)||request!==marketRequest||selected!==symbol||$('#marketInterval').value!==interval)return;
  markets[symbol]={...data,loadedAt:Date.now()};quotes[symbol]={...(quotes[symbol]||{}),symbol,price:data.price,priceAt:data.priceAt,priceKind:data.priceKind,source:data.source,currency:'USD',loadedAt:Date.now()};quoteStatus[symbol]='';quoteNextAt[symbol]=Date.now()+300000;saveQuotes();
  if(request===marketRequest&&selected===symbol&&$('#marketInterval').value===interval){render(true);$('#marketStatus').textContent=data.notice+' נרות: '+({'1day':'יום','1h':'שעה','5min':'5 דקות','1week':'שבוע','1month':'חודש'}[interval])+' · '+(data.isMarketOpen===true?'הספק מדווח: שוק פתוח':data.isMarketOpen===false?'הספק מדווח: שוק סגור':'מצב השוק לא זמין')+' · בקשת נתונים: '+new Date().toLocaleTimeString('he-IL');}
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
