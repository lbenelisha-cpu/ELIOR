Warning: truncated output (original token count: 26522)
Total output lines: 1354

const B=['localhost','127.0.0.1'].includes(window.location.hostname)?window.location.origin:'https://levi-binance.2-29-48-20.sslip.io';
window.API_BASE=B;
window.binanceReadUrl=url=>{
  if(['localhost','127.0.0.1'].includes(window.location.hostname)||window.location.origin===new URL(B).origin)return url;
  const target=new URL(url,window.location.origin);
  const paths=['/api/binance-poc-paper','/api/binance-poc-live-monitor','/api/binance-live/poc','/api/binance-mode','/api/binance-agent','/api/binance-live-account','/api/binance-action-log','/api/binance-trading-pnl','/api/binance-trade-history','/api/binance-equity-history','/api/binance-ma-audit','/api/binance-chart','/api/binance-decision-history','/api/binance-market-watch','/api/binance-kelly','/api/binance-demo-account'];
  return target.origin===new URL(B).origin&&paths.includes(target.pathname)?'/.netlify/functions/binance-read-proxy?path='+encodeURIComponent(target.pathname+target.search):url;
};
window.binanceReadHeaders=url=>{
 const target=new URL(url,window.location.origin);
 if(target.origin!==new URL(B).origin||!target.pathname.startsWith('/api/binance-'))return {};
 const token=window.LEVI_TRADE_AUTH?.read();
 return token?{Authorization:'Bearer '+token}:{};
};
const MODE=B+'/api/binance-mode';
const TRADE_CONTROL=B+'/api/binance-trade-control';
const AGENT=B+'/api/binance-agent';
const EVAL=B+'/api/binance-agent/evaluate';
const RESET=B+'/api/binance-paper/reset';
const LIVEACC=B+'/api/binance-live-account';
const ACTIONLOG=B+'/api/binance-action-log';
const CHART=B+'/api/binance-chart';
const DECISION_HISTORY=B+'/api/binance-decision-history';

const $=s=>document.querySelector(s);
const fmt=(v,d=2)=>Number.isFinite(+v)?(+v).toLocaleString('he-IL',{maximumFractionDigits:d}):'—';
const put=(s,v)=>{const e=$(s);if(e)e.textContent=v};

let selectedSymbol='BTCUSDT';
let currentAgentData=null;
let currentMode='demo';
let currentLiveAccount=null;
let currentVisibleAgents=[];
let selectedInterval='5m';
let selectedRange='1W';
let chartVisibleStartTime=0;
let priceRangeScale=1;
let activeView='trade';
let demoTradingEnabled=false;
let tradeControlToken=window.LEVI_TRADE_AUTH?.read()||null;
let tradeControlWorking=false;
let moneyUnit='₪';
let chartCandles=[];
let chartDecisions=[];
let chartWorkbench=null;
let fixedRangeProfile=null;
import('./fixed-range-volume-profile.js?v=20261104-frvp').then(({createFixedRangeVolumeProfile})=>{
 fixedRangeProfile=createFixedRangeVolumeProfile({host:$('#priceChart').parentElement,toolbarHost:$('#chartTools')});
 drawCandles(chartCandles);
}).catch(()=>put('#chartTools','Fixed Range Volume Profile לא נטען · רענן את העמוד.'));
let chartTimeNavigation=null;
let chartTerminal=null;
import('./chart-terminal.js?v=20261101-chart-terminal').then(({createChartTerminal})=>{
 chartTerminal=createChartTerminal({host:$('#priceChart').parentElement,toolbarHost:$('#chartTerminalTools'),shell:$('#chartTerminal'),navigation:()=>chartTimeNavigation,onChange:()=>drawCandles(chartCandles)});
 drawCandles(chartCandles);
}).catch(()=>put('#chartTerminalTools','כלי הגרף לא נטענו · רענן את העמוד.'));
import('./chart-time-navigation.js?v=20261101-chart-terminal').then(({createChartTimeNavigation})=>{
 chartTimeNavigation=createChartTimeNavigation({host:$('#chartTimeNavigation'),onChange:()=>drawCandles(chartCandles)});
 drawCandles(chartCandles);
}).catch(()=>put('#chartTimeNavigation','מחוון הזמן לא נטען · רענן את העמוד.'));
import('./chart-workbench.js?v=20261104-frvp').then(({createWorkbench})=>{
 const saved={};try{Object.assign(saved,JSON.parse(localStorage.getItem('levi-binance-chart-tools-v1')||'{}'));}catch{}
 chartWorkbench=createWorkbench({host:document.querySelector('#priceChart').parentElement,toolbarHost:document.querySelector('#chartTools'),volumeHost:document.querySelector('#chartVolume'),getDrawings:symbol=>saved[symbol]||[],saveDrawings:(items,symbol)=>{saved[symbol]=items;try{localStorage.setItem('levi-binance-chart-tools-v1',JSON.stringify(saved));return true;}catch{return false;}}});
 drawCandles(chartCandles);
}).catch(()=>{document.querySelector('#chartTools').textContent='כלי השרטוט לא נטענו; רענן את העמוד.';});

let chartRequestId=0;
let chartAnalysisContext=null;
let manualTradeCapabilities=null;
let chartWyckoffHistory=[],chartWyckoffError=null,selectedWyckoffId=null;
const wyckoffHistoryCache=new Map();
let wyckoffHistoryEngine=null;
function decisionLabel(d){return ({ACCOUNT_HOLDING:'מוחזק בחשבון',ACTIVE_LONG:'פוזיציה פעילה',HOLD:'ממתין',BUY:'קנייה',SELL:'מכירה',BUY_READY:'מוכן לקנייה','BUY READY':'מוכן לקנייה',WAIT_NO_SLOT:'אין מקום פנוי','WAIT · NO SLOT':'אין מקום פנוי',WAIT_CASH:'ממתין למזומן',WAIT_ACCOUNT:'ממתין לנתוני חשבון',WAIT_ALLOCATION:'ממתין להקצאה',WAIT_LIVE_GATE:'מסחר אינו זמין',WAIT_EXECUTION_ERROR:'שגיאת ביצוע',WAIT_NO_ROTATION:'ממתין להחלפה','ROTATE READY':'מוכן להחלפה',ROTATE_IN:'נרכש בהחלפה',ROTATE_OUT:'נמכר בהחלפה'})[d]||d||'—';}

function commissionsText(fees){
  if(!Array.isArray(fees))return 'לא תועדו';
  if(!fees.length)return '0';
  const totals={};
  for(const f of fees)totals[f.asset]=(totals[f.asset]||0)+Number(f.amount||0);
  return Object.entries(totals).map(([asset,amount])=>fmt(amount,8)+' '+asset).join(' + ');
}

function tradeExecutionTime(at){
  const date=at?new Date(at):null;
  if(!date||!Number.isFinite(date.getTime()))return 'תאריך לא זמין';
  return new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}

function positionPnlDisplay(position,currency=moneyUnit){
  const raw=position?.pnlIls;
  if(raw===null||raw===undefined||raw===''||!Number.isFinite(Number(raw))){
    return {kind:'unknown',className:'pnl-unknown',text:'רווח / הפסד: אין נתוני כניסה'};
  }
  const value=Number(raw),kind=value>0?'profit':value<0?'loss':'flat';
  const label=value>0?'רווח לא ממומש':value<0?'הפסד לא ממומש':'ללא שינוי';
  const rawPct=position.pnlPct;
  const pct=rawPct!==null&&rawPct!==undefined&&rawPct!==''&&Number.isFinite(Number(rawPct))
    ?Number(rawPct):Number(position.allocationIls)>0?value/Number(position.allocationIls)*100:null;
  const amount=(value>0?'+':'')+fmt(value)+' '+currency;
  return {kind,className:'pnl-'+kind,text:label+': '+amount+(pct===null?'':' ('+(pct>0?'+':'')+fmt(pct)+'%)')};
}

function liveAccountPnlDisplay(account){
  if(!account)return {text:'אין נתוני חשבון',className:'pnl-unknown'};
  const holdings=(account.balances||[]).filter(x=>x.asset!=='USDT'&&Number(x.valueUsdt)>=5);
  const known=holdings.filter(x=>x.pnlIls!==null&&x.pnlIls!==undefined&&x.pnlIls!==''&&Number.isFinite(Number(x.pnlIls)));
  if(known.length!==holdings.length)return {text:'חסרה עלות קנייה · '+known.length+'/'+holdings.length+' פוזיציות',className:'pnl-unknown'};
  const pnl=known.reduce((sum,x)=>sum+Number(x.pnlIls),0);
  const cost=known.reduce((sum,x)=>sum+Number(x.allocationIls||0),0);
  return {text:(pnl>0?'+':'')+fmt(pnl)+' USDT'+(cost>0?' ('+(pnl>0?'+':'')+fmt(pnl/cost*100)+'%)':''),className:'pnl-'+(pnl>0?'profit':pnl<0?'loss':'flat')};
}

function renderPortfolioView(){
  const target=$('#portfolioViewContent');
  const source=$('#positions');
  if(target&&source)target.innerHTML=source.innerHTML;
}

function setDashboardView(view){
  activeView=['trade','portfolio','scans','journal','pnl'].includes(view)?view:'trade';
  document.querySelectorAll('.app-view').forEach(el=>{
    el.hidden=!el.classList.contains(activeView+'-view');
  });
  window.dispatchEvent(new CustomEvent('levi:trading-pnl-view'));
  const grid=$('.trading-grid');
  if(grid)grid.hidden=activeView!=='trade'&&activeView!=='scans';
  if(activeView==='scans'&&$('#scannerSection'))$('#scannerSection').open=true;
  if(activeView==='portfolio')renderPortfolioView();
  if(activeView==='journal'||activeView==='portfolio'||$('#strategyReviewPanel')?.open)loadActionJournal(currentMode);
  if(activeView==='journal'&&currentAgentData)loadDecisionHistory(selectedSymbol);
  if(activeView==='trade'||activeView==='scans')requestAnimationFrame(()=>drawCandles(chartCandles));
  document.querySelectorAll('.nav-btn[data-view], .topnav .nav-pill').forEach((btn,i)=>{
    const name=btn.dataset.view||['trade','portfolio','scans','journal'][i];
    btn.classList.toggle('active',name===activeView);
    if(name===activeView)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
  });
}

async function J(u,o={}){
  const {timeoutMs=15000,...options}=o;
  const controller=new AbortController(),external=options.signal;
  const abort=()=>controller.abort(external.reason);
  if(external?.aborted)abort();else external?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('השרת לא השיב בזמן.','TimeoutError')),timeoutMs);
  try{
    const requestUrl=String(options.method||'GET').toUpperCase()==='GET'?window.binanceReadUrl(u):u;
    const headers={...(String(options.method||'GET').toUpperCase()==='GET'?window.binanceReadHeaders?.(u):{}),...options.headers};
    const r=await fetch(requestUrl,{cache:'no-store',...options,headers,signal:controller.signal});
    if(!r.ok){
      let x={};try{x=await r.json()}catch{}
      const error=Error(x.error||`HTTP ${r.status}`);error.status=r.status;error.response=x;error.authToken=headers.Authorization?.replace(/^Bearer /,'')||null;throw error;
    }
    return await r.json();
  }finally{
    clearTimeout(timer);
    external?.removeEventListener('abort',abort);
  }
}

function renderTradeControlStatus(s){
  const el=$('#tradeControlStatus');
  if(!el)return;
  const known=typeof s.tradeControl?.paused==='boolean';
  const paused=s.tradeControl?.paused===true;
  const health=s.liveState,blocked=s.mode==='live'&&health&&health.ready!==true;
  const active=known&&!paused&&!blocked;
  const executable=s.mode==='demo'||(s.liveTradingEnabled===true&&s.autoExecution===true);
  el.classList.toggle('trading-active',active&&executable);
  el.classList.toggle('trading-paused',known&&paused);
  const reconciliation=health?.reconciliation||{};
  const symbols=items=>(Array.isArray(items)?items:[]).map(item=>typeof item==='string'?item:item?.symbol).filter(symbol=>/^[A-Z0-9]{2,30}$/.test(symbol||'')).join(', ');
  const reason=!health?.journalReady?'יומן העסקאות דורש בדיקה':health.pendingOrder?'ממתין לאימות פקודה':reconciliation.error?'לא ניתן לאמת את נתוני החשבון':health.missingProtection?.length?'הגנת בורסה טרם אומתה':symbols(reconciliation.unmanaged)?'יתרה לא מנוהלת ביומן: '+symbols(reconciliation.unmanaged):symbols(reconciliation.pending)?'פער בכמות ממתין לאימות: '+symbols(reconciliation.pending):symbols(reconciliation.unsettled)?'ממתין לאימות מילוי הגנה: '+symbols(reconciliation.unsettled):'ממתין להתאמת חשבון';
  const label=blocked?'קניות חסומות · '+reason:!known?'מצב מסחר לא ידוע':paused?'מסחר עצור · אין קניות חדשות':!executable?'מסחר LIVE לא מופעל':'מסחר אוטומטי פעיל';
  // A resume timestamp is not the start of a reconciliation failure.
  const timestamp=Date.parse(blocked?reconciliation.checkedAt:paused?s.tradeControl?.pausedAt:known&&executable?s.tradeControl?.resumedAt:null);
  const minutes=Number.isFinite(timestamp)?Math.max(0,Math.floor((Date.now()-timestamp)/60000)):null;
  const timing=blocked?(minutes===null?' · מועד בדיקת החשבון לא זמין':' · בדיקת חשבון אחרונה: '+new Date(timestamp).toLocaleString('he-IL')):minutes===null?'':' · '+(paused?'המסחר הושהה ב־':'המסחר חודש ב־')+new Date(timestamp).toLocaleString('he-IL')+' · לפני '+minutes+' דקות';
  el.textContent=label+timing+(s.mode==='demo'&&health?.managedPositions>0?' · ניהול החזקות LIVE ממשיך ברקע':'');
}

function renderFuturesShortStatus(s){
 const anchor=document.querySelector('#tradeControlStatus');if(!anchor)return;
 let panel=document.querySelector('#futuresShortStatus');
 if(!panel){panel=document.createElement('div');panel.id='futuresShortStatus';panel.style.cssText='padding:12px;margin:10px 0;border:1px solid #52647c;border-radius:8px;white-space:pre-line';anchor.insertAdjacentElement('afterend',panel);}
 if(!Object.hasOwn(s||{},'shortTrading'))return;
 const f=s.shortTrading;
 if(f?.policy?.version!=='FUTURES_CHANNEL_SHORT_V1'){panel.textContent='SHORT Futures: העדכון עדיין לא מותקן בשרת';return;}
 const p=f.policy;
 let text='SHORT · USDⓈ-M Perpetual · Isolated · 1x\nתקציב 70 USDT · עד 2 פוזיציות · 35 USDT לכל מקום, כולל רזרבה לעמלות';
 text+='\n'+(f.enabled?'מסלול מופעל; כל כניסה כפופה לבדיקה חדשה':'כניסות SHORT כבויות');
 if(f.account)text+=' · יתרה פנויה: '+Number(f.account.availableUsdt).toFixed(2)+' USDT';
 if(f.reason)text+='\nמצב: '+f.reason;
 if(f.halt)text+='\nכניסות חסומות עד בדיקת התקלה: '+f.halt;
 if(Array.isArray(f.positions)){
  text+='\nפוזיציות SHORT: '+f.positions.length+'/2';
  for(const row of f.positions)text+='\n'+row.symbol+' · כניסה '+row.entryPrice+' · TP '+row.targetPrice+' · סטופ '+(row.stopPrice??'ממתין לאימות')+' · '+(row.protectedAt?'הגנות אומתו':'הגנות דורשות בדיקה');
 }else text+='\nחבר מכשיר כדי לראות יתרות ופוזיציות';
 text+='\n'+(f.checkedAt?'בדיקה אחרונה: '+new Date(f.checkedAt).toLocaleString('he-IL'):'טרם נבדק מול הבורסה');
 panel.textContent=text;
}
let tradingRulesSnapshot=null;
function tradingRuleLines(s){
 const p=s?.channelPrimary,e=s?.exitSettings||{},lines=[];
 const n=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 if(s?.mode==='live'&&p?.requested){
  lines.push('LONG · תעלת קיצון ורגרסיה · '+(p.enabled?'המסלול מופעל; ביצוע כפוף להרשאות ולכל הבדיקות':'המסלול חסום: '+(p.error||'אינו מופעל')));
  lines.push('קנייה: '+(n(p.period)??'מספר לא ידוע של')+' נרות סגורים של 5 דקות לפני נר הפריצה · לפחות שתי נגיעות בכל גבול · רגרסיה עולה · '+(p.waitForBreakoutClose===false?'מחיר חי מעל הגבול העליון ומרכז הרגרסיה, ללא המתנה לסגירת נר הפריצה':'נר פריצה נסגר מעל הגבול העליון ומרכז הרגרסיה')+'.');
  lines.push((p.waitForBreakoutClose===false?'מחזור מצטבר בנר הפתוח: לפחות פי ':'מחזור: לפחות פי ')+(n(p.minVolumeRatio)??'—')+' מממוצע 20 הנרות הקודמים · ממוצע שווי מחזור מינימלי '+(n(p.minMeanDollarVolume)??'—')+' USDT לנר.');
  lines.push('לפני שליחה: מחיר עדכני מעל רמות הפריצה ומרכז הרגרסיה, איתות שלא נוצל, יתרה, מקום והגנות. '+(p.livePriceRule==='CURRENT_PRICE'?'נגיעה קודמת במהלך הנר אינה פוסלת לאחר התאוששות.':'השרת לא אישר את כלל ההתאוששות החדש.')+(p.waitForBreakoutClose===false?' תוקף האיתות עד סוף נר הפריצה הנוכחי; כל התנאים נבדקים שוב לפני השליחה.':' תוקף האיתות: '+(n(p.signalValidityMs)!==null?p.signalValidityMs/60000:'—')+' דקות מסגירת נר הפריצה; אין המתנה חובה נוספת.'));
  lines.push('יעד LONG חדש: הגבול העליון שנפרץ + רוחב התעלה שנקבע לפני הפריצה. וויקוף וגל מוקדם אינם מסלולי כניסה חלופיים כשהמסלול הראשי מופעל.');
 }else if(s?.mode==='demo')lines.push('מצב DEMO: כללי מסלול LIVE אינם אישור לתנאי הדמו. תנאי הנכס וסיבת ההמתנה מוצגים ליד הגרף.');
 else if(p)lines.push('מסלול התעלות אינו נבחר בשרת. יש לבדוק את מסלול הכניסה וסיבת ההמתנה של הנכס; אין להסיק שכללי התעלות פעילים.');
 else lines.push('ממתין לאימות כללי הכניסה מהשרת.');
 lines.push('הגדרות יציאה לכניסות חדשות: סטופ '+(n(e.stopLossPct)??'—')+'% · הפעלת הגנה '+(n(e.profitActivationPct)??'—')+'% · מרחק נגרר '+(n(e.trailingGapPp)??'—')+' נקודות אחוז ממחיר הכניסה. לפוזיציה קיימת יש לבדוק את הסטופ והיעד המתועדים שלה. המחירים לפני עמלות.');
 const f=s?.shortTrading?.policy;
 if(f)lines.push('SHORT Futures · '+(f.enabled?'מופעל':'כבוי')+' · '+(n(f.period)??'לא נמסר מספר')+' נרות 5 דקות · שתי נגיעות בכל גבול · רגרסיה יורדת · '+(f.waitForBreakoutClose===false?'פריצה מטה במחיר חי, ללא המתנה לסגירת הנר · מחזור מצטבר בנר הפתוח פי 1.5 מממוצע 20':'פריצה מטה בנר סגור · מחזור פי 1.5 מממוצע 20')+'. יעד: הגבול התחתון פחות רוחב התעלה. '+(f.livePriceRule==='CURRENT_PRICE'?'חזרה זמנית מעלה אינה פוסלת אם המחיר העדכני שוב מתחת לרמות.':'')+' תקציב '+(n(f.budgetUsdt)??'—')+' USDT · עד '+(n(f.maxPositions)??'—')+' פוזיציות.');
 return lines;
}
function renderTradingRules(s){
 if(!s)return;
 if(tradingRulesSnapshot?.mode!==s.mode)tradingRulesSnapshot=null;
 tradingRulesSnapshot={...tradingRulesSnapshot,...s};
 const host=$('#tradingRules');if(!host)return;
 host.replaceChildren();for(const text of tradingRuleLines(tradingRulesSnapshot)){const p=document.createElement('p');p.textContent=text;host.append(p);}
}

function mode(s){
  renderTradingRules(s);
  renderFuturesShortStatus(s);
  window.LEVI_FUTURES_TABLE?.update(s);
  const isDemo=s.mode==='demo';
  demoTradingEnabled=!!s.demoTradingEnabled;
  moneyUnit=isDemo&&demoTradingEnabled?'USDT':'₪';
  currentMode=s.mode;
  manualTradeCapabilities=s.manualTrading||null;
  renderTradeControlStatus(s);
  const paused=s.tradeControl?.paused===true;
  const stopButton=$('#stopTradingBtn'),startButton=$('#startTradingBtn');
  if(stopButton){stopButton.hidden=false;stopButton.disabled=tradeControlWorking;}
  if(startButton){startButton.hidden=!paused;startButton.disabled=tradeControlWorking;}
  const pauseButton=$('#pauseBuysBtn'),resumeButton=$('#resumeBuysBtn');
  if(pauseButton){pauseButton.hidden=paused;pauseButton.disabled=tradeControlWorking;}
  if(resumeButton){resumeButton.hidden=!paused;resumeButton.disabled=tradeControlWorking;}
  $('#demoBtn')?.classList.toggle('active',isDemo);
  $('#liveBtn')?.classList.toggle('active',!isDemo);
  $('#liveAccountCard')?.classList.toggle('hidden',isDemo);
  $('#resetPaperBtn')?.classList.toggle('hidden',!isDemo||demoTradingEnabled);
  $('#binanceDemoBalanceCard')?.classList.toggle('hidden',!isDemo);
  $('#demoTradesSection')?.classList.toggle('hidden',!isDemo);
  $('#demoRealtimePositionsSection')?.classList.toggle('hidden',!isDemo);
  put('#refreshBtn',isDemo?'בדוק עכשיו':'רענן LIVE');
  put('#portfolioTitle',isDemo?(demoTradingEnabled?'חשבון Binance Demo · USDT':'סימולציה פנימית · נפרדת מ־Binance'):'חשבון LIVE · Binance');
  put('#positionsTitle',isDemo?'פוזיציות פעילות · DEMO':'פוזיציות פעילות · LIVE');
  put('#status',isDemo?(demoTradingEnabled?'דמו Binance · מסחר אוטומטי':'סימולציה פנימית'):'LIVE · '+(s.liveTradingEnabled&&s.autoExecution?'מסחר אוטומטי מופעל':'ביצוע אוטומטי כבוי'));
}

function buyReasonLabel(r){
  const independent={WAIT_CHANNEL_LIVE_BREAKOUT:'ממתין לפריצה מעל תעלת הקיצון בזמן הנר',WAIT_FRESH_PRICE:'ממתין למחיר עדכני',CHANNEL_TARGET_ALREADY_REACHED:'המחיר כבר הגיע ליעד התעלה',CHANNEL_SIGNAL_CHANGED:'האיתות השתנה בבדיקה החוזרת',CHANNEL_PROTECTION_CHANGED:'תוכנית ההגנה השתנתה',CHANNEL_BREAKOUT_READY:'פריצת תעלת קיצון אושרה עם רגרסיה עולה',WAIT_CHANNEL_BREAKOUT:'ממתין לנר סגור מעל תעלת הקיצון',WAIT_CHANNEL_PIVOTS:'ממתין לתעלה מאושרת עם שתי נגיעות בכל גבול',WAIT_CHANNEL_TWO_TOUCHES:'חסרות שתי נגיעות בכל גבול',REGRESSION_DIRECTION_BLOCK:'הרגרסיה אינה עולה',REGRESSION_CENTER_BLOCK:'המחיר אינו מעל מרכז הרגרסיה',CHANNEL_VOLUME_LOW:'מחזור הפריצה נמוך מפי 1.5',CHANNEL_LIQUIDITY_LOW:'שווי מחזור נמוך מהמינימום',CHANNEL_PRIMARY_REQUIRED:'כניסה דורשת תעלת קיצון',WAIT_NEW_CHANNEL_SIGNAL:'ממתין לאיתות תעלה חדש אחרי הפעלה או מכירה',CHANNEL_PRICE_INVALIDATED:'המחיר חזר מתחת לסף התעלה או הרגרסיה',CHANNEL_SIGNAL_EXPIRED:'איתות התעלה פג',CHANNEL_PRIMARY_DISABLED:'מסלול תעלת קיצון אינו מורשה',CHANNEL_ACTIVATION_TIME_REQUIRED:'חסר זמן הפעלה מאומת',CHANNEL_PATTERN_ALREADY_USED:'איתות התעלה כבר נוצל',WAIT_CHANNEL_HISTORY:'חסרה היסטוריה לחישוב התעלה ונר הפריצה',GAPPED_CHANNEL_HISTORY:'חסרים נרות ברצף',INVALID_CHANNEL_HISTORY:'נתוני התעלה אינם תקינים',WAIT_CHANNEL_LIVE_BAR:'ממתין לנר החי',INDEPENDENT_BREAKOUT_READY:'פריצה עצמאית אושרה בנר סגור',WAIT_BREAKOUT:'ממתין לסגירה מעל שיא 20 הנרות',WAIT_BREAKOUT_HISTORY:'חסרים נרות לבדיקת פריצה',BREAKOUT_VOLUME_LOW:'מחזור הפריצה נמוך מפי 1.5 מהממוצע',BREAKOUT_LIQUIDITY_LOW:'שווי מחזור נמוך מהמינימום',GAPPED_BREAKOUT_HISTORY:'חסרים נרות ברצף המחירים',INVALID_BREAKOUT_HISTORY:'נתוני הפריצה אינם תקינים',WAIT_NEW_BREAKOUT_SIGNAL:'ממתין לפריצה חדשה אחרי ההפעלה או המכירה',BREAKOUT_PATTERN_ALREADY_USED:'איתות הפריצה כבר נוצל',BREAKOUT_SIGNAL_EXPIRED:'איתות הפריצה פג',BREAKOUT_PRICE_INVALIDATED:'המחיר חזר לרמת הפריצה או מתחתיה',WAIT_BREAKOUT_LIVE_BAR:'ממתין לנתוני הנר החי',INDEPENDENT_ENTRY_DISABLED:'מסלול הפריצה כבוי',READY:'תנאי הכניסה מתקיימים'};
  if(independent[r])return independent[r];
  if(['WAIT_SECOND_RECOVERY_CONFIRMATION','SECOND_RECOVERY_NOT_HIGHER','WAIT_CLOSED_CONFIRMATION','WAIT_MA_HISTORY','MA_DOWNTREND_BLOCK','WAIT_VOLUME_HISTORY','CONFIRMATION_VOLUME_LOW','WAIT_ATR_HISTORY','VOLATILITY_RISK_TOO_HIGH','QUALITY_SIGNAL_INVALIDATED'].includes(r))return decisionReasonLabel(r);
  if(/^WAIT_PROFIT_ACTIVATION_/.test(r||''))return 'ממתין לרווח '+String(r).replace('WAIT_PROFIT_ACTIVATION_','').replace('_PERCENT','')+'% להפעלת ההגנה';
  if(['EARLY_WAVE_BREAKOUT','TRAILING_PROFIT_HOLD','TRAILING_PROFIT_EXIT'].includes(r))return decisionReasonLabel(r);
  if(['WAIT_HOURLY_TREND','WAIT_HOURLY_TREND_DATA','HOURLY_TREND_CONFIRMED'].includes(r))return decisionReasonLabel(r);
  return ({
    EXTERNAL_HOLDING:'החזקה מהחשבון · ללא ניהול אוטומטי מתועד',
    QUALIFIED:'מתאים לקנייה',
    NOT_UP:'לא בגל עולה',
    BELOW_MA200:'מתחת ל־MA200',
    NO_PREVIOUS_DOWN:'אין גל ירידה קודם',
    BUYERS_7_OF_10:'7 מתוך 10 לטובת הקונים',
    WAIT_BUYERS_7_OF_10:'ממתין ל-7 קונים מול 3 מוכרים',
    WAIT_MICRO_CANDLES:'אוסף 10 נרות של 5 שניות',
    NO_DATA:'אין נתונים',
    NOT_DEMO_TRADABLE:'נסרק בלבד · לא זמין בדמו'
  })[r]||r||'—';
}

function liveEntryStatus(a,account,maxPositions){
  const waiting=(decision,code,text)=>({decision,blocker:{code,text}});
  if(a.entryConfirmed!==true||a.entryEligible===false)return {decision:'HOLD',blocker:a.blocker};
  if(!account?.connected)return waiting('WAIT_ACCOUNT','WAIT_ACCOUNT','איתות כניסה אושר · ממתין לנתוני יתרה והרשאות עדכניים');
  if(!account.tradingGate?.ready||account.tradingGate.withdrawalsEnabled)return waiting('WAIT_LIVE_GATE','WAIT_LIVE_GATE','איתות כניסה אושר · מסחר LIVE אינו זמין לפי הרשאות החשבון');
  const held=(account.balances||[]).filter(b=>!['USDT','USDC'].includes(b.asset)&&Number(b.valueUsdt||0)>=5).length;
  if(held>=maxPositions)return waiting('WAIT_NO_SLOT','NO_SLOT','איתות כניסה אושר · אין מקום פנוי לפוזיציה נוספת');
  const plan=account.nextBuyAllocation;
  const spend=Number(plan?.amountUsdt??account.fixedPositionUsdt),cash=Number(account.usdtFree);
  if(plan?.code==='LIVE_ORDER_LIMIT')return waiting('WAIT_ALLOCATION','LIVE_ORDER_LIMIT','יתרת הפוזיציה האחרונה חורגת ממגבלת סכום הקנייה שהוגדרה');
  if(!Number.isFinite(spend)||spend<5)return waiting('WAIT_ALLOCATION',plan?.code||'WAIT_ALLOCATION','איתות כניסה אושר · סכום הקנייה אינו זמין או נמוך מהמינימום');
  if(!Number.isFinite(cash))return waiting('WAIT_ACCOUNT','WAIT_ACCOUNT','איתות כניסה אושר · יתרת USDT אינה זמינה');
  const required=spend*1.002;
  if(cash<required)return waiting('WAIT_CASH','NO_CASH','איתות כניסה אושר · ממתין ליתרה: זמינים '+cash.toFixed(2)+', נדרשים '+required.toFixed(2)+' USDT כולל מרווח לעמלות · חסרים '+(required-cash).toFixed(2)+' USDT');
  if(a.lastError)return waiting('WAIT_EXECUTION_ERROR','EXECUTION_ERROR','איתות כניסה אושר · שגיאת ביצוע: '+a.lastError);
  return {decision:'BUY_READY',blocker:plan?.lastSlot?{code:'BUY_READY',text:'איתות כניסה אושר · פוזיציה אחרונה: קנייה ב־'+spend.toFixed(2)+' USDT מהיתרה, עם מרווח לעמלות'}:a.blocker};
}

function decisionFor(a,isHeld,activeCount,maxPositions,weakestActive,rotationGap,isLive,liveAccount=null){
  const s=a.strategy||{};
  if(!isLive)return a.decision==='WAIT_NO_SLOT'?'WAIT · NO SLOT':a.decision;
  if(isHeld)return a.accountOnly?'ACCOUNT_HOLDING':s.sellConfirmed?'SELL':'HOLD';
  return liveEntryStatus(a,liveAccount,maxPositions).decision;
}

function renderMarketStrip(agents){
  const map=Object.fromEntries(agents.map(a=>[a.symbol,a]));
  for(const [sym,id] of [['BTCUSDT','#tickerBTC'],['ETHUSDT','#tickerETH'],['SOLUSDT','#tickerSOL'],['BNBUSDT','#tickerBNB'],['AAVEUSDT','#tickerAAVE']]){
    const a=map[sym];
    put(id,a?.strategy?.price?'$'+fmt(a.strategy.price):'—');
  }
}

function activeContext(d,currentMode,liveAccount){
  const p=d.paper||{},agents=[...(d.agents||[])];
  const isLive=currentMode==='live';
  const liveBalances=(liveAccount?.balances||[]).filter(x=>!['USDT','USDC'].includes(x.asset)&&Number(x.valueUsdt||0)>=5);
  if(isLive&&liveAccount?.connected){
    const existing=new Set(agents.map(a=>a.symbol));
    for(const balance of liveBalances){
      const symbol=balance.asset+'USDT';
      if(!/^[A-Z0-9]+USDT$/.test(symbol)||existing.has(symbol))continue;
      agents.push({symbol,position:'LONG',decision:'HOLD',score:0,accountOnly:true,
        entryConfirmed:false,entryEligible:false,buyQualified:false,buyReason:'EXTERNAL_HOLDING',
        strategy:{price:Number(balance.usdtPrice)||null}});
      existing.add(symbol);
    }
  }
  const liveHeldSymbols=new Set(liveBalances.map(x=>x.asset+'USDT'));
  const isHeld=a=>isLive&&liveAccount?liveHeldSymbols.has(a.symbol):a.position==='LONG';
  const activeAgents=agents.filter(isHeld);
  const weakestActive=activeAgents
    .map(a=>({symbol:a.symbol,score:(a.strategy?.buyConfirmed?Number(a.score||0):0)}))
    .sort((a,b)=>a.score-b.score)[0]||null;
  return {p,agents,isLive,liveBalances,isHeld,activeAgents,weakestActive};
}

function selectScannerAsset(symbol,tr){
  selectedSymbol=symbol;
  if($('#chartSection'))$('#chartSection').open=true;
  document.querySelectorAll('#assetsBody tr').forEach(x=>x.classList.toggle('selected',x===tr));
  updateSelectedAsset(currentAgentData,currentMode,currentLiveAccount);
}
function render(d,currentMode='demo',liveAccount=null,{preserveScanner=false}={}){
  d={...d,agents:activeContext(d,currentMode,liveAccount).agents};
  rememberWyckoffDisplay(d.agents,currentMode);
  currentAgentData=d;
  renderTradingRules({mode:currentMode,...d.config});
  if(window.LEVI_MA_SLOPE_DATA?.symbol===selectedSymbol)publishSlopeData(selectedSymbol,window.LEVI_MA_SLOPE_DATA.bars);
  if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('levi-binance-rsi',{detail:d.agents||[]}));
  const wx=d.wyckoffStats||{};
  put('#wyckoffBuys',wx.buys??'—');
  put('#wyckoffSells',wx.sells??'—');
  put('#wyckoffClosed',wx.closed??'—');
  const fees=wx.fees;
  put('#tradeFeesTotal',fees?fmt(fees.totalUsdt,4)+' USDT'+(fees.complete?'':' · חלקי'):'—');
  put('#tradeFeesDetails',fees?'קנייה: '+fmt(fees.buyUsdt,4)+' · מכירה:…11522 tokens truncated…length)return;
 candleFlashOn=!candleFlashOn;drawCandles(chartCandles);
},650);
function drawCandles(candles){
  const canvas=$('#priceChart');
  const channelBadge=$('#channelTouchBadge');
  if(channelBadge){channelBadge.hidden=true;channelBadge.replaceChildren();}
  if(!canvas||!candles.length){if($('#chartPriceLegend'))$('#chartPriceLegend').hidden=true;put('#resistancePatternStatus','ממתין לנרות לזיהוי תבניות');put('#parallelChannelStatus','ממתין לנרות לתעלה מקבילה');put('#patternScenario','אין נתונים לניתוח תרחיש');chartTimeNavigation?.view([],{context:[selectedSymbol,selectedInterval,selectedRange,currentMode].join(':')});drawIndicators([]);$('#chartRises')?.replaceChildren();$('#chartFalls')?.replaceChildren();if($('#chartRises'))$('#chartRises')._renderKey=null;$('#chartRiseList')?.replaceChildren();put('#chartRiseSummary','ממתין לנרות');put('#chartRiseDetails','');globalThis.LEVI_TRADE_RISK?.render($('#binanceTradeRisk'),null,'USDT');if($('#chartRiskDetails'))$('#chartRiskDetails').hidden=true;chartWorkbench?.clear();chartTerminal?.clear();fixedRangeProfile?.clear();return;}
  const rect=canvas.getBoundingClientRect();
  const ratio=window.devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(rect.width*ratio));
  canvas.height=Math.max(1,Math.round(rect.height*ratio));
  const ctx=canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  const W=rect.width,H=rect.height;
  ctx.clearRect(0,0,W,H);
  ctx.direction="ltr";ctx.textAlign="left";

  const closes=candles.map(x=>+x.close);
  const mas=candles.map((_,i)=>{
    if(i<199)return null;
    let sum=0;for(let k=i-199;k<=i;k++)sum+=closes[k];
    return sum/200;
  });

  const firstVisible=candles.findIndex(c=>Number(c.closeTime)>=chartVisibleStartTime);
  const availableStart=firstVisible<0?candles.length:firstVisible;
  const available=candles.slice(availableStart);
  const visibleWindow=chartTimeNavigation?.view(available,{context:[selectedSymbol,selectedInterval,selectedRange,currentMode].join(':'),width:W})||{bars:available.slice(-72),start:Math.max(0,available.length-72),end:available.length};
  const start=availableStart+visibleWindow.start,end=availableStart+visibleWindow.end;
  const view=visibleWindow.bars;
  const viewMas=mas.slice(start,end);
  drawIndicators(candles,{start,end});
  if(!view.length){if($('#chartPriceLegend'))$('#chartPriceLegend').hidden=true;put('#resistancePatternStatus','אין נרות בטווח שנבחר');put('#parallelChannelStatus','ממתין לנרות לתעלה מקבילה');put('#patternScenario','אין נתונים לניתוח תרחיש בטווח שנבחר');$('#chartRises')?.replaceChildren();$('#chartFalls')?.replaceChildren();if($('#chartRises'))$('#chartRises')._renderKey=null;$('#chartRiseList')?.replaceChildren();put('#chartRiseSummary','אין נרות בטווח שנבחר');put('#chartRiseDetails','');chartWorkbench?.clear();chartTerminal?.clear();return;}
  const vals=[];
  view.forEach((c,i)=>{vals.push(+c.high,+c.low);if(viewMas[i]!=null)vals.push(viewMas[i])});
  const sellLevel=chartSellLevel(currentAgentData,currentLiveAccount,currentMode,selectedSymbol);
  const selectedPosition=(currentAgentData?.agents||[]).find(a=>a.symbol===selectedSymbol)?.strategy||{};
  const heldNow=currentMode==='live'?(currentLiveAccount?.balances||[]).some(b=>b.asset+'USDT'===selectedSymbol&&Number(b.valueUsdt)>=5):!!currentAgentData?.paper?.positions?.[selectedSymbol];
  const walletBalance=(currentLiveAccount?.balances||[]).find(b=>b.asset+'USDT'===selectedSymbol);
  const managedPosition=heldNow&&['FIXED_TP4_SL1_V1','PROFIT_FLOOR4_TRAIL1PP_STOP1_V1','PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2'].includes(selectedPosition.exitPolicy);
  const riskPosition=managedPosition?{...selectedPosition,qty:currentMode==='live'?walletBalance?.qty:currentAgentData?.paper?.positions?.[selectedSymbol]?.qty,currentPrice:selectedPosition.price,pnlIls:currentMode==='live'?walletBalance?.pnlIls:null}:heldNow&&currentMode==='live'&&walletBalance?.costStatus==='VERIFIED_QUANTITY'?{entryPrice:walletBalance.entryPrice,qty:walletBalance.qty,currentPrice:walletBalance.usdtPrice,pnlIls:walletBalance.pnlIls,displayOnly:true}:null;
  const tradeRisk=globalThis.LEVI_TRADE_RISK?.levels(riskPosition);
  globalThis.LEVI_TRADE_RISK?.render($('#binanceTradeRisk'),riskPosition,'USDT');if($('#chartRiskDetails'))$('#chartRiskDetails').hidden=!tradeRisk;
  if(tradeRisk)vals.push(tradeRisk.target,tradeRisk.stop);
  const priceText=value=>Number.isFinite(Number(value))&&Number(value)>0?fmt(value,12)+' USDT':'—';
  put('#positionEntryPrice',heldNow?priceText(riskPosition?.entryPrice??selectedPosition.entryPrice):'—');
  put('#positionPeakPrice',heldNow?priceText(selectedPosition.peakPrice):'—');
  put('#positionSellPrice',sellLevel?priceText(sellLevel.price):'—');
  if(sellLevel)vals.push(sellLevel.price);
  if(heldNow)for(const value of [selectedPosition.entryPrice,selectedPosition.peakPrice])if(Number(value)>0&&Number.isFinite(Number(value)))vals.push(Number(value));
  put('#currentSellLevel',sellLevel?'סף מכירה לפי מחיר: '+fmt(sellLevel.price,12)+' USDT · '+sellLevel.reason+' · מתעדכן עם נתוני הסוכן'+(sellLevel.rsiSell?' · קיים גם אות RSI למכירה':''):'אין סף מחיר מתועד לפוזיציה פעילה');
  const parallelOn=$('#showParallel')?.checked!==false;
  const parallel=parallelOn?globalThis.LEVI_PARALLEL?.analyze(candles.slice(0,end),{interval:selectedInterval,period:Number($('#regressionPeriod')?.value||50)}):null;
  put('#parallelChannelStatus',parallelOn?(globalThis.LEVI_PARALLEL?.describe(parallel)||'רכיב התעלה המקבילה לא נטען — נדרש עדכון'):'התעלה המקבילה מוסתרת');
  if(parallel?.ready)for(const c of view){const at=Number(c.openTime);if(at>=parallel.anchorStart&&at<=parallel.end){const p=globalThis.LEVI_REGRESSION.levels(parallel,at);vals.push(p.upper,p.lower);}}
  const regressionOn=$('#showRegression')?.checked!==false;
  const regression=regressionOn?globalThis.LEVI_REGRESSION?.analyze(candles.slice(0,end),{interval:selectedInterval,period:Number($('#regressionPeriod')?.value||50),deviations:Number($('#regressionDeviation')?.value||2)}):null;
  put('#patternScenario',regressionOn?(globalThis.LEVI_REGRESSION?.describe(regression)||'רכיב הרגרסיה לא נטען — נדרש רענון או עדכון שרת'):'תעלת הרגרסיה מוסתרת');
  if(regression?.ready)for(const c of view){const at=Number(c.openTime);if(at>=regression.start&&at<=regression.end){const p=globalThis.LEVI_REGRESSION.levels(regression,at);vals.push(p.upper,p.lower);}}
  const scaleValues=chartTerminal?.fitCandles!==false?view.flatMap(c=>[+c.high,+c.low]):vals;
  let min=Math.min(...scaleValues),max=Math.max(...scaleValues);
  const span=Math.max(max-min,Math.abs((max+min)/2)*0.0001,1e-12)*priceRangeScale;
  const mid=(max+min)/2;min=mid-span*.58;max=mid+span*.58;
  const autoDigits=Math.min(12,Math.max(2,Math.ceil(-Math.log10((max-min)/5))+1));
  const priceDigits=autoDigits;
  put('#pricePrecisionValue',priceRangeScale===1?'אוטומטי':fmt(1/priceRangeScale,2)+'×');

  const setupInView=setup=>Object.values(setup||{}).some(p=>p&&Number(p.time)>=Number(view[0].openTime)&&Number(p.time)<=Number(view.at(-1).closeTime));
  const hasPivotLabels=setupInView(selectedPosition.setup)||setupInView(displayedWyckoffSetup(selectedSymbol,currentMode)?.setup)||chartWyckoffHistory.some(item=>setupInView(item.setup));
  const left=18,right=Math.min(120,Math.max(70,priceDigits*7+25)),top=hasPivotLabels?130:48,bottom=hasPivotLabels?112:60;
  const cw=W-left-right,ch=H-top-bottom;
  const y=v=>top+(max-v)/(max-min)*ch;
  const step=cw/view.length;
  const visibleChannel=parallel?.ready&&view.filter(c=>Number(c.openTime)>=parallel.anchorStart&&Number(c.openTime)<=parallel.end).length>=2;
  const touchBadge=visibleChannel?globalThis.LEVI_PARALLEL?.badge(parallel):null;
  if(channelBadge&&touchBadge){
    const title=document.createElement('strong'),counts=document.createElement('span');
    title.textContent=touchBadge.title;counts.textContent=touchBadge.counts;
    channelBadge.append(title,counts);channelBadge.dataset.state=touchBadge.provisional?'provisional':'confirmed';
    channelBadge.title='נגיעות בנקודות קיצון מאושרות על התעלה המוצגת · אישור קיצון לאחר שני נרות נוספים · אינו אישור כניסה';
    channelBadge.hidden=false;
  }
  const body=Math.max(.5,Math.min(18,step*.68));
  if(tradeRisk){ctx.save();ctx.beginPath();ctx.rect(left,top,cw,ch);ctx.clip();const rx=left+cw*.72,rw=cw*.28;ctx.fillStyle='rgba(38,197,129,.14)';ctx.fillRect(rx,y(tradeRisk.target),rw,y(tradeRisk.entry)-y(tradeRisk.target));ctx.fillStyle='rgba(244,75,102,.16)';ctx.fillRect(rx,y(tradeRisk.entry),rw,y(tradeRisk.stop)-y(tradeRisk.entry));ctx.restore();}

  ctx.font='11px Arial';
  ctx.strokeStyle='rgba(120,145,170,.18)';
  ctx.fillStyle='#7890a8';
  ctx.lineWidth=1;
  for(let i=0;i<=5;i++){
    const yy=top+ch*i/5;
    ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(W-right,yy);ctx.stroke();
    const price=max-(max-min)*i/5;
    ctx.fillText(fmt(price,priceDigits),W-right+6,yy+4);
  }

  if(parallel?.ready)globalThis.LEVI_PARALLEL.draw({ctx,analysis:parallel,view,x:i=>left+step*(i+.5),y,bounds:{left,right:W-right,top,bottom:top+ch}});
  if(regression?.ready)globalThis.LEVI_REGRESSION.draw({ctx,analysis:regression,view,x:i=>left+step*(i+.5),y,bounds:{left,right:W-right,top,bottom:top+ch}});
  const resistance=globalThis.LEVI_RESISTANCE?.detect(candles.slice(0,end),{interval:selectedInterval});
  const resistanceDecision=(currentAgentData?.agents||[]).find(a=>a.symbol===selectedSymbol)?.entryDecisions;
  put('#resistancePatternStatus',(globalThis.LEVI_RESISTANCE?.describe(resistance,selectedInterval)||'')+(resistanceDecision?.breakout?' · מסלול פריצה בשרת: '+buyReasonLabel(resistanceDecision.breakout.reason):''));
  globalThis.LEVI_RESISTANCE?.drawCanvas({ctx,zone:resistance,view,x:i=>left+step*(i+.5),y,bounds:{left,right:W-right,top,bottom:top+ch}});

  const flashingIndices=new Set(),candleColors=new Map();
  const candleSetup=heldNow?selectedPosition.setup:displayedWyckoffSetup(selectedSymbol,currentMode)?.setup;
  const pivotColors={initialPeak:'#ffb454',firstLow:'#49cfff',rallyHigh:'#c59aff',secondRallyHigh:'#a5e67a',secondaryTest:'#ff86b8',springLow:'#52e0a4',confirmation:'#fff08a'};
  const markCandle=(stamp,color,active)=>{const i=view.findIndex(c=>stamp>=Number(c.openTime)&&stamp<=Number(c.closeTime));if(i>=0){candleColors.set(i,color);if(active)flashingIndices.add(i);}};
  for(const item of chartWyckoffHistory)for(const [key,color] of Object.entries(pivotColors)){const p=item.setup?.[key];if(p?.time)markCandle(Number(p.time)-(key==='confirmation'&&p.live?0:1),color,false);}
  for(const [key,color] of Object.entries(pivotColors)){const p=candleSetup?.[key];if(p?.time)markCandle(Number(p.time)-(key==='confirmation'&&p.live?0:1),color,heldNow);}
  if(heldNow){markCandle(Date.parse(selectedPosition.entryAt),'#348bff',true);markCandle(Date.parse(selectedPosition.peakAt),'#348bff',true);}
  ctx.save();ctx.beginPath();ctx.rect(left,top,cw,ch);ctx.clip();
  view.forEach((c,i)=>{
    const x=left+step*i+step/2;
    const up=+c.close>=+c.open;
    ctx.strokeStyle=flashingIndices.has(i)&&!candleFlashOn?'#03080d':candleColors.get(i)||(up?'#2bd88a':'#ff6172');
    ctx.fillStyle=ctx.strokeStyle;
    ctx.beginPath();ctx.moveTo(x,y(+c.high));ctx.lineTo(x,y(+c.low));ctx.stroke();
    const y1=y(Math.max(+c.open,+c.close)),y2=y(Math.min(+c.open,+c.close));
    ctx.fillRect(x-body/2,y1,body,Math.max(1,y2-y1));
  });

  ctx.strokeStyle='#397dff';
  ctx.lineWidth=2;
  ctx.beginPath();
  let began=false;
  viewMas.forEach((m,i)=>{
    if(m==null)return;
    const x=left+step*i+step/2,yy=y(m);
    if(!began){ctx.moveTo(x,yy);began=true}else ctx.lineTo(x,yy);
  });
  ctx.stroke();

  const priceLevels=[
    {price:tradeRisk?.target,label:tradeRisk?.displayOnly?'המחשת רווח +4%':tradeRisk?.trailing?'הפעלת הגנה +'+Number(tradeRisk.activation.toFixed(3))+'%':'יעד רווח +4%',color:'#64e1ae'},
    {price:heldNow?Number(riskPosition?.entryPrice??selectedPosition.entryPrice):NaN,label:'מחיר קנייה',color:'#61a9ff'},
    {price:heldNow?Number(selectedPosition.peakPrice):NaN,label:'שיא מאז הקנייה',color:'#a7d0ff'},
    {price:tradeRisk?.stop??sellLevel?.price,label:tradeRisk?.displayOnly?'המחשת הפסד −1%':tradeRisk?.armed?'סף רווח נגרר':tradeRisk?'סטופ −'+tradeRisk.sl+'%':'סף מכירה',color:tradeRisk?.armed?'#64e1ae':tradeRisk?'#ff8494':'#ffbd59'}
  ].filter(level=>Number.isFinite(level.price)&&level.price>0);
  ctx.restore();
  const legend=$('#chartPriceLegend');
  const legendRows=priceLevels.map(level=>{
    const yy=y(level.price),inside=yy>=top&&yy<=top+ch;
    if(inside){ctx.save();ctx.beginPath();ctx.rect(left,top,cw,ch);ctx.clip();ctx.strokeStyle=level.color;ctx.lineWidth=1.5;ctx.setLineDash([7,5]);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(W-right,yy);ctx.stroke();ctx.restore();}
    return {...level,value:fmt(level.price,priceDigits),outside:!inside};
  });
  if(legend){
    const key=JSON.stringify(legendRows);legend.hidden=!legendRows.length;
    if(legend._renderKey!==key){
      legend._renderKey=key;legend.replaceChildren();
      for(const level of legendRows){
        const row=document.createElement('div');row.className='chart-price-legend-item';row.style.setProperty('--level-color',level.color);
        const label=document.createElement('span');label.textContent=level.label+(level.outside?' · מחוץ לטווח':'');
        const value=document.createElement('bdi');value.dir='ltr';value.textContent=level.value;
        row.append(label,value);legend.append(row);
      }
    }
  }
  ctx.save();
  ctx.restore();
  renderChartRises(ctx,view,{left,right:W-right,top,bottom:top+ch,step,y,digits:priceDigits});
  renderChartDecisionMarkers(ctx,view,candles,chartDecisions,step,left,8,selectedInterval);
  renderWyckoffPivots(view,chartDecisions,step,left,y,priceDigits);
  renderNumberedWyckoff(view,step,left,y,priceDigits);
  renderPositionPoints(view,step,left,y,priceDigits,{top,bottom:top+ch});

  const labelCount=Math.max(2,Math.min(5,Math.floor(cw/150)));
  ctx.textAlign='center';
  ctx.fillStyle='#7890a8';
  ctx.font='11px Arial';
  const axisY=H-bottom+13;ctx.strokeStyle='#607b96';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,axisY);ctx.lineTo(W-right,axisY);ctx.stroke();
  for(let i=0;i<labelCount;i++){
    const idx=Math.min(view.length-1,Math.floor(i*(view.length-1)/(labelCount-1)));
    const c=view[idx],x=left+step*(idx+.5);
    ctx.beginPath();ctx.moveTo(x,axisY);ctx.lineTo(x,axisY+5);ctx.stroke();
    const d=new Date(c.openTime);
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d).split(', ');
    const labelX=Math.max(55,Math.min(W-right-45,x));
    ctx.fillText(parts[0],labelX,axisY+18);ctx.fillText(parts[1]||'',labelX,axisY+33);
  }
  chartWorkbench?.update({symbol:selectedSymbol,bars:view.map(b=>({...b,time:Number(b.openTime)})),low:min,high:max,width:W,height:H,bounds:{left,right:W-right,top,bottom:top+ch}});
  chartTerminal?.update({symbol:selectedSymbol,interval:selectedInterval,bars:view,low:min,high:max,width:W,height:H,bounds:{left,right:W-right,top,bottom:top+ch}});
  fixedRangeProfile?.update({symbol:selectedSymbol,interval:selectedInterval,bars:view.map(b=>({...b,time:Number(b.openTime)})),width:W,height:H,bounds:{left,right:W-right,top,bottom:top+ch},x:i=>left+step*(i+.5),y});
}

let dashboardLoadInFlight=false;
let dashboardLoaded=false;
let scannerVerifiedMode=null,scannerVerifiedAt=null;
async function load(){
  if(document.hidden||dashboardLoadInFlight)return;
  dashboardLoadInFlight=true;
  try{
    if(!dashboardLoaded)put('#status','מתחבר…');
    let receivedMode=null,agentMode=null,accountRead=null;
    const applyMode=m=>{
      if(!['live','demo'].includes(m?.mode))throw Error('מצב החשבון לא התקבל מהשרת');
      if(agentMode&&agentMode!==m.mode)return null;
      receivedMode=m;mode(m);
      if(m.mode==='live'&&!accountRead)accountRead=J(LIVEACC,{timeoutMs:35000}).catch(e=>({connected:false,error:e.message}));
      if(!dashboardLoaded&&$('#chartSection')?.open!==false&&(activeView==='trade'||activeView==='scans')&&typeof loadChart==='function'&&typeof selectedSymbol==='string')loadChart(selectedSymbol);
      return m;
    };
    const modeRead=J(MODE,{timeoutMs:35000}).then(applyMode).catch(()=>null);
    const agent=await J(AGENT,{timeoutMs:35000});
    agentMode=['live','demo'].includes(agent.mode)?agent.mode:null;
    const m=agentMode?(receivedMode?.mode===agentMode?receivedMode:applyMode({mode:agentMode,tradeControl:agent.tradeControl,liveState:agent.config?.liveState,demoTradingEnabled:agent.config?.demoTradingEnabled===true})):await modeRead;
    if(!m)throw Error('לא ניתן לאמת את מצב החשבון');
    window.LEVI_AGENT_SNAPSHOT=agent;
    window.dispatchEvent(new CustomEvent('levi:binance-agent',{detail:agent}));
    if(m.mode==='live'){
      // First paint never waits for the slower signed account reader. Refreshes
      // retain the verified scanner until that reader completes, avoiding flashes.
      if(!dashboardLoaded){
        render(agent,'live',null,{preserveScanner:false});
        put('#status','LIVE · נתוני שוק נטענו · מאמת נתוני חשבון…');
        put('#scanStatusMessage','נתוני שוק זמינים · ממתין לאימות הפוזיציות בחשבון');
        put('#scannerFreshness','ממתין לנתוני חשבון מאומתים; נתוני השוק אינם אישור להחזקות.');
      }
      const liveData=await accountRead;
      const liveAccount=await loadLiveAccount(liveData);
      render(agent,'live',liveAccount,{preserveScanner:!liveAccount&&scannerVerifiedMode==='live'});
      if(liveAccount){scannerVerifiedMode='live';scannerVerifiedAt=Date.now();put('#scannerFreshness','');}
      else{
        put('#status','LIVE · נתוני שוק זמינים · נתוני חשבון אינם זמינים');
        put('#scanStatusMessage','נסרקו '+(agent.agents||[]).length+' · נתוני השוק עודכנו · מצב הפוזיציות אינו מאומת כרגע');
        put('#scannerFreshness',scannerVerifiedMode==='live'?'לא ניתן לעדכן פוזיציות כרגע · הטבלה מציגה את העדכון האחרון מ־'+tradeExecutionTime(scannerVerifiedAt)+' · הנתונים לא אומתו מחדש':'ממתין לנתוני חשבון מאומתים להצגת רווח והפסד.');
      }
    }else{scannerVerifiedMode=null;scannerVerifiedAt=null;put('#scannerFreshness','');render(agent,m.mode,null);}
    if(activeView==='journal'||activeView==='portfolio'||$('#strategyReviewPanel')?.open)await loadActionJournal(m.mode);
    dashboardLoaded=true;
  }catch(e){
    put('#status','שגיאת טעינה · '+(e.message||'החיבור לא הצליח'));
    currentLiveAccount=null;
    globalThis.LEVI_EXIT_SNAPSHOT?.render($('#binanceExitSnapshot'),{mode:currentMode,error:true},selectedSymbol);
    if(scannerVerifiedMode==='live')put('#scannerFreshness','נתוני הטבלה מהעדכון האחרון · '+tradeExecutionTime(scannerVerifiedAt)+' · החיבור לא אומת מחדש');
    const control=$('#tradeControlStatus');
    control?.classList.remove('trading-active','trading-paused');
    put('#tradeControlStatus',e.status===401?'נדרש חיבור מכשיר לצפייה בחשבון':'מצב המסחר לא אומת · שרת לא זמין');
    if(e.status===401&&e.authToken===tradeControlToken){tradeControlToken=null;window.LEVI_TRADE_AUTH?.clear();window.LEVI_DEVICE_ACCESS?.refresh();}
    if(typeof CustomEvent==='function'){
      const detail={error:true,unauthorized:e.status===401,mode:currentMode,receivedAt:window.LEVI_DASHBOARD_SNAPSHOT?.receivedAt||null};
      window.LEVI_DASHBOARD_SNAPSHOT=detail;
      window.dispatchEvent(new CustomEvent('levi:binance-dashboard',{detail}));
    }
    console.error(e);
  }finally{
    dashboardLoadInFlight=false;
  }
}

async function authenticatedControl(url,body){
  if(!tradeControlToken){window.LEVI_DEVICE_ACCESS?.open();return null;}
  try{
    const result=await J(url,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tradeControlToken},
      body:JSON.stringify(body)
    });
    window.LEVI_TRADE_AUTH?.remember(tradeControlToken);
    return result;
  }catch(e){
    if(/401|Authenticated control required/i.test(e.message)){
      tradeControlToken=null;window.LEVI_TRADE_AUTH?.clear();
      window.LEVI_DEVICE_ACCESS?.refresh();
      const error=Error('חיבור המכשיר אינו תקף. לחץ ״חבר מכשיר למסחר״ לחיבור מחדש בקוד קצר.');error.status=401;throw error;
    }
    throw e;
  }
}

async function setMode(m){
  try{
    const cur=await J(MODE);
    if(cur.mode===m)return load();
    if(m==='live'&&!confirm('לעבור ל-LIVE?'))return;
    const result=await authenticatedControl(MODE,{mode:m});
    if(result===null)return;
    await load();
  }catch(e){alert(e.message)}
}

async function sendTradeControl(action){
  if(tradeControlWorking)return;
  if(action==='stop'&&!confirm('עצירת המסחר תשלח פקודות מכירה לכל הפוזיציות של הסוכן במצב הנבחר (DEMO או LIVE). אין אפשרות להבטיח את מחיר הביצוע. להמשיך?'))return;
  if(action==='start'&&!confirm('לחדש את המסחר האוטומטי? כניסות חדשות ידרשו איתות חדש לפי המסלול הפעיל.'))return;
  tradeControlWorking=true;
  $('#stopTradingBtn').disabled=true;
  $('#startTradingBtn').disabled=true;
  put('#tradeControlStatus',action==='stop'?'מבצע עצירה וסגירת פוזיציות…':action==='pause'?'משהה קניות · ניהול היציאות ממשיך…':'מחדש מסחר…');
  try{
    const r=await authenticatedControl(TRADE_CONTROL,{action});
    if(r===null)return;
    if(!r.ok){
      const details=(r.failed||[]).map(x=>x.symbol+': '+x.error).join('; ');
      alert('המסחר נשאר עצור. '+(r.error||details||'חלק מהפוזיציות לא נסגרו'));
    }else if(action==='stop'){
      alert('המסחר נעצר. נסגרו '+(r.sold||[]).length+' פוזיציות. אין קניות חדשות.');
    }
  }catch(e){
    if(/401|Authenticated control required/i.test(e.message)){tradeControlToken=null;window.LEVI_TRADE_AUTH?.clear();}
    alert('הפעולה לא הושלמה: '+e.message);
  }finally{
    tradeControlWorking=false;
    await load();
  }
}
$('#stopTradingBtn').onclick=()=>sendTradeControl('stop');
$('#startTradingBtn').onclick=()=>sendTradeControl('start');
if($('#pauseBuysBtn'))$('#pauseBuysBtn').onclick=()=>sendTradeControl('pause');
if($('#resumeBuysBtn'))$('#resumeBuysBtn').onclick=()=>sendTradeControl('resume');

$('#demoBtn').onclick=()=>setMode('demo');
$('#liveBtn').onclick=()=>setMode('live');
$('#refreshBtn').onclick=async()=>{
  try{
    const m=await J(MODE);
    if(m.mode==='demo')await J(EVAL,{method:'POST'});
    await load();
  }catch(e){alert(e.message)}
};
$('#resetPaperBtn').onclick=async()=>{
  if(confirm('לאפס את תיק ה-DEMO ל־5,000 ₪?')){
    await J(RESET,{method:'POST'});
    load();
  }
};

document.querySelectorAll('.nav-btn[data-view], .topnav .nav-pill').forEach((btn,i)=>{
  btn.onclick=()=>setDashboardView(btn.dataset.view||['trade','portfolio','scans','journal'][i]||'trade');
});
setDashboardView('trade');

document.querySelectorAll('.timeframe-btn').forEach(btn=>{
  btn.onclick=async()=>{
    selectedInterval=btn.dataset.interval||'5m';
    document.querySelectorAll('.timeframe-btn').forEach(x=>x.classList.toggle('active',x===btn));
    await loadChart(selectedSymbol);
  };
});

document.querySelectorAll('.range-btn').forEach(btn=>{
  btn.onclick=async()=>{
    selectedRange=btn.dataset.range||'1W';
    document.querySelectorAll('.range-btn').forEach(x=>x.classList.toggle('active',x===btn));
    await loadChart(selectedSymbol);
  };
});

if(window.ResizeObserver){new ResizeObserver(()=>drawCandles(chartCandles)).observe($('#priceChart').parentElement);}
window.addEventListener('resize',()=>drawCandles(chartCandles));
load();
setInterval(()=>{if(!document.hidden)load();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});

// Keep account detail and recent trades collapsed until explicitly opened.
document.querySelectorAll('[data-detail-toggle]').forEach(button=>{
  button.addEventListener('click',()=>{
    const content=document.getElementById(button.dataset.detailToggle);
    if(!content)return;
    content.hidden=!content.hidden;
    button.setAttribute('aria-expanded',String(!content.hidden));
    button.textContent=content.hidden?'פירוט':'סגור פירוט';
  });
});

for(const id of ['showRSI','showROC'])document.getElementById(id)?.addEventListener('change',()=>drawIndicators(chartCandles));
document.getElementById('showRises')?.addEventListener('change',()=>drawCandles(chartCandles));

document.getElementById('pricePrecisionUp')?.addEventListener('click',()=>{priceRangeScale=Math.max(.1,priceRangeScale/1.25);drawCandles(chartCandles);});
document.getElementById('pricePrecisionDown')?.addEventListener('click',()=>{priceRangeScale=Math.min(10,priceRangeScale*1.25);drawCandles(chartCandles);});
document.getElementById('pricePrecisionAuto')?.addEventListener('click',()=>{priceRangeScale=1;drawCandles(chartCandles);});

window.LEVI_POC={read:()=>J(B+'/api/binance-live/poc'),write:body=>authenticatedControl(B+'/api/binance-live/poc',body)};
window.LEVI_MANUAL_TRADES={
 context:()=>({symbol:selectedSymbol,mode:currentMode,account:currentLiveAccount,capabilities:manualTradeCapabilities}),
 submit:async body=>{try{return await authenticatedControl(B+'/api/binance-live/manual',body);}catch(error){if(error.status>=400&&error.status<500&&!error.response?.uncertain)return {...error.response,ok:false,uncertain:false,error:error.message};throw error;}},
 connected:()=>Boolean(tradeControlToken),
 connect:()=>window.LEVI_DEVICE_ACCESS?.open(),
 pair:async code=>{
  if(!/^\d{6}$/.test(code))throw Error('יש להזין שש ספרות');
  const result=await J(B+'/api/binance-control/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  if(!result.ok||!/^device-[a-f0-9]{64}$/.test(result.token))throw Error('לא התקבל אישור חיבור תקין');
  tradeControlToken=result.token;const persistent=window.LEVI_TRADE_AUTH?.remember(tradeControlToken)!==false;
  return {ok:true,persistent,expiresAt:result.expiresAt};
 },
 forget:async()=>{
  const token=tradeControlToken;tradeControlToken=null;window.LEVI_TRADE_AUTH?.clear();window.LEVI_DEVICE_ACCESS?.refresh();
  if(token)await J(B+'/api/binance-control/disconnect',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:'{}'});
 },
 refresh:async()=>{await load();await loadChart(selectedSymbol);}
};

window.addEventListener?.('levi-rsi-select',event=>{const symbol=event.detail;if(!currentAgentData?.agents?.some(a=>a.symbol===symbol))return;selectScannerAsset(symbol,null);});

window.addEventListener?.('levi-rsi-history-needed',()=>{if(!document.hidden)loadChart(selectedSymbol);});

window.addEventListener?.('trade-device-expired',()=>{tradeControlToken=null;window.LEVI_DEVICE_ACCESS?.refresh();});

// Display-only search; scanner updates and execution continue independently.
function filterAssetRows(){
 const input=document.querySelector('#assetSearch'),body=document.querySelector('#assetsBody');if(!input||!body)return;
 const query=input.value.toUpperCase().replace(/[\s/\-]/g,'');let shown=0,total=0;
 for(const row of body.querySelectorAll('tr')){total++;const match=!query||row.textContent.toUpperCase().replace(/[\s/\-]/g,'').includes(query);row.hidden=!match;if(match)shown++;}
 const status=document.querySelector('#assetSearchStatus');if(status)status.textContent=query?(shown?'מוצגים '+shown+' מתוך '+total:'לא נמצא ברשימת המעקב · נסה סימול אחר'):'';
}
const assetSearchInput=document.querySelector('#assetSearch');
if(assetSearchInput){assetSearchInput.addEventListener('input',filterAssetRows);new MutationObserver(filterAssetRows).observe(document.querySelector('#assetsBody'),{childList:true,subtree:true,characterData:true});}

// Opening display panels never changes trading mode or sends an order.
document.getElementById('chartSection')?.addEventListener('toggle',event=>{
  if(event.target.open){loadChart(selectedSymbol);requestAnimationFrame(()=>drawCandles(chartCandles));}
});
window.addEventListener('levi-dashboard-select',event=>{
  if(!currentAgentData?.agents?.some(a=>a.symbol===event.detail))return;
  setDashboardView('trade');selectScannerAsset(event.detail,null);
  document.getElementById('chartSection')?.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
});

for(const id of ['showParallel','showRegression','regressionPeriod','regressionDeviation'])document.getElementById(id)?.addEventListener('change',()=>drawCandles(chartCandles));

document.getElementById('channelStudyLink')?.addEventListener('click',()=>{const panel=document.getElementById('strategyReviewPanel');if(panel)panel.open=true;});
