Warning: truncated output (original token count: 28045)
Total output lines: 1416

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
let selectedChartMarket='SPOT';
function chartPositionSnapshot(){return selectedChartMarket==='FUTURES'?{venue:'BINANCE_FUTURES',shortTrading:futuresManualStatus,mode:currentMode}:{agent:currentAgentData,account:currentLiveAccount,mode:currentMode,receivedAt:Date.now()};}
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
import('./fixed-range-volume-profile.js?v=20261107-poc-v2').then(({createFixedRangeVolumeProfile})=>{
 fixedRangeProfile=createFixedRangeVolumeProfile({host:$('#priceChart').parentElement,toolbarHost:$('#chartTools')});
 drawCandles(chartCandles);
}).catch(()=>put('#chartTools','Fixed Range Volume Profile לא נטען · רענן את העמוד.'));
let chartTimeNavigation=null;
let chartTerminal=null;
import('./chart-terminal.js?v=20261111-unified').then(({createChartTerminal})=>{
 chartTerminal=createChartTerminal({host:$('#priceChart').parentElement,toolbarHost:$('#chartTerminalTools'),shell:$('#chartTerminal'),fitToCandles:true,navigation:()=>chartTimeNavigation,onChange:()=>drawCandles(chartCandles)});
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
let manualTradeCapabilities=null,futuresManualCapabilities=null,futuresManualStatus=null;
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
 let text='SHORT · USDⓈ-M Perpetual · Isolated · 1x\nעד 2 פוזיציות · מחצית ארנק Futures לכל מקום, בכפוף למזומן הפנוי וכולל רזרבה לעמלות';
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
 if(s?.mode==='live'&&p?.requested&&['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(p.version)){
  lines.push('LONG · תעלת קיצון + פרופיל נפח + חזרה ל־POC · '+(p.enabled?'מופעל':'כבוי'));
  lines.push('ארבעה תנאים: שתי נגיעות בכל גבול; דשדוש בתחילת התעלה בחלק התחתון או האמצעי; פריצה; חזרה מלמעלה ל־POC.');
  lines.push('טווח הפרופיל: A בבסיס הגל האחרון; B מתקדם עם שיא הגל בנרות סגורים עד החזרה הראשונה ל־POC. גל חדש מקבל טווח חדש. POC משוער מנפח הנרות.');
  lines.push('רגרסיה לתצוגה בלבד. אין סף מחזור, סף נזילות, דרישת תבנית חדשה, יציאה מהדשדוש או יעד כתנאי כניסה. הרשאות, יתרה והגנות נבדקות בנפרד.');
  lines.push('יעד LONG חדש: הגבול העליון שנפרץ + רוחב התעלה שנקבע לפני הפריצה. וויקוף וגל מוקדם אינם מסלולי כניסה חלופיים כשהמסלול הראשי מופעל.');
 }else if(s?.mode==='live'&&p?.requested)lines.push('מסלול התעלות הקודם מדווח מהשרת. עדכון POC עדיין לא אומת בשרת; התנאים הפעילים מוצגים ברשימת בדיקת הכניסה.');
 else if(s?.mode==='demo')lines.push('מצב DEMO: כללי מסלול LIVE אינם אישור לתנאי הדמו. תנאי הנכס וסיבת ההמתנה מוצגים ליד הגרף.');
 else if(p)lines.push('מסלול התעלות אינו נבחר בשרת. יש לבדוק את מסלול הכניסה וסיבת ההמתנה של הנכס; אין להסיק שכללי התעלות פעילים.');
 else lines.push('ממתין לאימות כללי הכניסה מהשרת.');
 lines.push('הגדרות יציאה לכניסות חדשות: סטופ '+(n(e.stopLossPct)??'—')+'% · הפעלת הגנה '+(n(e.profitActivationPct)??'—')+'% · מרחק נגרר '+(n(e.trailingGapPp)??'—')+' נקודות אחוז ממחיר הכניסה. לפוזיציה קיימת יש לבדוק את הסטופ והיעד המתועדים שלה. המחירים לפני עמלות.');
 const f=s?.shortTrading?.policy;
 if(['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(f?.entryPolicyVersion))lines.push('SHORT Futures · '+(f.enabled?'מופעל':'כבוי')+' · תעלה מאושרת · דשדוש עליון או אמצעי בתחילת התעלה · שבירה מטה מקבעת A–B · כניסה בחזרה מלמטה ל־POC. הגנות לפי ההגדרות. '+(f.allocationPolicy==='BINANCE_SHARED_THREE_V1'?'שליש משווי Spot ו־Futures יחד · שלושה מקומות משותפים ללונג ולשורט':f.allocationPolicy==='FUTURES_WALLET_HALF_V1'?'הקצאה דינמית לפי מחצית ארנק Futures':'תקציב '+(n(f.budgetUsdt)??'—')+' USDT')+' · עד '+(n(f.maxPositions)??'—')+' פוזיציות.');
 if(f&&!['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(f.entryPolicyVersion))lines.push('SHORT: עדכון POC עדיין לא אומת בשרת. בדוק את התנאים המדווחים בכרטיס האיתות.');
 return lines;
}
function renderTradingRules(s){
 if(!s)return;
 if(tradingRulesSnapshot?.mode!==s.mode)tradingRulesSnapshot=null;
 tradingRulesSnapshot={...tradingRulesSnapshot,...s};
 const host=$('#tradingRules');if(!host)return;
 host.replaceChildren();for(const text of tradingRuleLines(tradingRulesSnapshot)){const p=document.createElement('p');p.textContent=text;host.append(p);}
}

function publishEntryPolicySnapshot(s){
  if(!['live','demo'].includes(s?.mode))return;
  const previous=window.LEVI_ENTRY_POLICY_SNAPSHOT;
  const detail=previous?.mode===s.mode?{...previous}:{mode:s.mode};
  // Partial scanner responses do not replace the independently read Futures
  // policy. This event carries labels/configuration only, never account data.
  if(Object.hasOwn(s,'channelPrimary'))detail.long=s.channelPrimary||null;
  if(Object.hasOwn(s,'shortTrading'))detail.short=s.shortTrading?.policy||null;
  window.LEVI_ENTRY_POLICY_SNAPSHOT=detail;
  window.dispatchEvent(new CustomEvent('levi:binance-entry-policies',{detail}));
}

function mode(s){
  publishEntryPolicySnapshot(s);
  renderTradingRules(s);
  renderFuturesShortStatus(s);
  window.LEVI_FUTURES_TABLE?.update(s);
  const isDemo=s.mode==='demo';
  demoTradingEnabled=!!s.demoTradingEnabled;
  moneyUnit=isDemo&&demoTradingEnabled?'USDT':'₪';
  if(currentMode!==s.mode){
    const report=$('#spotPocReview');
    if(report)report.hidden=true;
  }
  currentMode=s.mode;
  manualTradeCapabilities=s.manualTrading||null;futuresManualCapabilities=s.futuresManualTrading||null;futuresManualStatus=s.shortTrading||null;
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
  const independent={CHANNEL_POC_READY:"חזרה ל־POC אושרה · בכפוף לבדיקת ביצוע",SHORT_POC_READY:"חזרה מלמטה ל־POC אושרה · SHORT",WAIT_POC_WAVE_CLOSE:"הנר הפתוח קבע קיצון חדש · ממתין לעדכון B והפרופיל",WAIT_POC_RETEST:"הפרופיל נקבע · ממתין לחזרה ל־POC",WAIT_POC_CHANNEL_BREAKOUT:"ממתין לפריצת התעלה ולקיבוע פרופיל הנפח",WAIT_INITIAL_CHANNEL_CONSOLIDATION:"ממתין לדשדוש בתחילת התעלה",WAIT_POC_VOLUME_DATA:"חסרים נתוני נפח לחישוב POC",POC_RETURN_ALREADY_EXECUTED:"אירוע החזרה הזה כבר נשלח · מניעת הוראה כפולה",POC_PRICE_INVALIDATED:"המחיר כבר אינו בנקודת החזרה ל־POC",POC_MODEL_CHANGED:"טווח פרופיל הנפח השתנה בבדיקה החוזרת",WAIT_CHANNEL_CONSOLIDATION:'ממתין לדשדוש של לפחות 3 נרות סגורים לפני הכניסה',INVALID_CHANNEL_CONSOLIDATION:'נתוני הדשדוש אינם תקינים',CHANNEL_CONSOLIDATION_SIDE_BLOCK:'מיקום הדשדוש אינו מתאים לכיוון העסקה',WAIT_CHANNEL_CONSOLIDATION_BREAK:'ממתין ליציאה מהדשדוש בכיוון העסקה',CHANNEL_CONSOLIDATION_CHANGED:'הדשדוש השתנה או חסר בבדיקה החוזרת',WAIT_CHANNEL_LIVE_BREAKOUT:'ממתין לפריצה מעל תעלת הקיצון בזמן הנר',WAIT_FRESH_PRICE:'ממתין למחיר עדכני',CHANNEL_TARGET_ALREADY_REACHED:'המחיר כבר הגיע ליעד התעלה',CHANNEL_SIGNAL_CHANGED:'האיתות השתנה בבדיקה החוזרת',CHANNEL_PROTECTION_CHANGED:'תוכנית ההגנה השתנתה',CHANNEL_BREAKOUT_READY:'פריצת תעלת קיצון אושרה עם רגרסיה עולה',WAIT_CHANNEL_BREAKOUT:'ממתין לנר סגור מעל תעלת הקיצון',WAIT_CHANNEL_PIVOTS:'ממתין לתעלה מאושרת עם שתי נגיעות בכל גבול',WAIT_CHANNEL_TWO_TOUCHES:'חסרות שתי נגיעות בכל גבול',REGRESSION_DIRECTION_BLOCK:'הרגרסיה אינה עולה',REGRESSION_CENTER_BLOCK:'המחיר אינו מעל מרכז הרגרסיה',CHANNEL_VOLUME_LOW:'מחזור הפריצה נמוך מפי 1.5',CHANNEL_LIQUIDITY_LOW:'שווי מחזור נמוך מהמינימום',CHANNEL_PRIMARY_REQUIRED:'כניסה דורשת תעלת קיצון',WAIT_NEW_CHANNEL_SIGNAL:'ממתין לאיתות תעלה חדש אחרי הפעלה או מכירה',CHANNEL_PRICE_INVALIDATED:'המחיר חזר מתחת לסף התעלה או הרגרסיה',CHANNEL_SIGNAL_EXPIRED:'איתות …16045 tokens truncated…e)>=Number(view[0].openTime)&&Number(p.time)<=Number(view.at(-1).closeTime));
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

  const priceLevels=barrierModel?barrierModel.lines.map(line=>({...line,label:line.label+(barrierModel.stale?' · נתונים ישנים':'')})):currentMode==='live'?[]:[
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
  chartTerminal?.update({symbol:selectedSymbol,interval:selectedInterval,sourceBars:candles,bars:view,low:min,high:max,width:W,height:H,bounds:{left,right:W-right,top,bottom:top+ch}});
  fixedRangeProfile?.update({onModeChange:()=>drawCandles(chartCandles),models:selectedInterval==='5m'?{LONG:(currentAgentData?.agents||[]).find(a=>a.symbol===selectedSymbol)?.entryDecisions?.channel?.conditions?.model}:null,sourceBars:candles,symbol:selectedSymbol,interval:selectedInterval,bars:view.map(b=>({...b,time:Number(b.openTime)})),width:W,height:H,bounds:{left,right:W-right,top,bottom:top+ch},x:i=>left+step*(i+.5),y});
}

const modeRefresh=window.LEVI_MODE_REFRESH.create({
 read:()=>J(MODE,{timeoutMs:15000}),
 context:()=>window.LEVI_TRADE_AUTH?.read()||'',
 publish:s=>window.LEVI_FUTURES_TABLE?.update(s)
});
function refreshShortStatus(){
 if(document.hidden||currentMode!=='live')return;
 // Failure retains the original timestamps; stale prices/protection are never
 // advertised as fresh. The next scheduled read retries without page reload.
 modeRefresh.refresh().catch(()=>{});
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
    const modeRead=modeRefresh.refresh().then(applyMode).catch(()=>null);
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
    drawCandles(chartCandles);
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
setInterval(refreshShortStatus,15000);
window.addEventListener('online',()=>{refreshShortStatus();load();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshShortStatus();load();}});

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
 context:()=>({symbol:selectedSymbol,mode:currentMode,account:currentLiveAccount,capabilities:manualTradeCapabilities,futuresCapabilities:futuresManualCapabilities,futures:futuresManualStatus}),
 submit:async body=>{try{return await authenticatedControl(B+(body.market==='FUTURES'?'/api/binance-live/futures-manual':'/api/binance-live/manual'),body);}catch(error){if(error.status>=400&&error.status<500&&!error.response?.uncertain)return {...error.response,ok:false,uncertain:false,error:error.message};throw error;}},
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

window.addEventListener('levi-chart-market',event=>{if(!['SPOT','FUTURES'].includes(event.detail))return;selectedChartMarket=event.detail;updateSelectedAsset();drawCandles(chartCandles);});

function openLinkedStrategyReview(){
  if(location.hash==='#strategyReviewPanel'){
    const panel=document.getElementById('strategyReviewPanel');
    if(panel)panel.open=true;
  }
}
window.addEventListener('hashchange',openLinkedStrategyReview);
openLinkedStrategyReview();
