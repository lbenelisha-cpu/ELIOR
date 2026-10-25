const B=['localhost','127.0.0.1'].includes(window.location.hostname)?window.location.origin:'https://levi-binance.2-29-48-20.sslip.io';
window.API_BASE=B;
window.binanceReadUrl=url=>{
  if(['localhost','127.0.0.1'].includes(window.location.hostname)||window.location.origin===new URL(B).origin)return url;
  const target=new URL(url,window.location.origin);
  const paths=['/api/binance-mode','/api/binance-agent','/api/binance-live-account','/api/binance-action-log','/api/binance-chart','/api/binance-decision-history','/api/binance-market-watch','/api/binance-kelly','/api/binance-demo-account'];
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
import('./chart-workbench.js?v=20261022-tools').then(({createWorkbench})=>{
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
  activeView=['trade','portfolio','scans','journal'].includes(view)?view:'trade';
  document.querySelectorAll('.app-view').forEach(el=>{
    el.hidden=!el.classList.contains(activeView+'-view');
  });
  const grid=$('.trading-grid');
  if(grid)grid.hidden=activeView!=='trade'&&activeView!=='scans';
  if(activeView==='portfolio')renderPortfolioView();
  if(activeView==='journal'||activeView==='portfolio')loadActionJournal(currentMode);
  if(activeView==='journal'&&currentAgentData)loadDecisionHistory(selectedSymbol);
  if(activeView==='trade'||activeView==='scans')requestAnimationFrame(()=>drawCandles(chartCandles));
  document.querySelectorAll('.nav-btn[data-view], .topnav .nav-pill').forEach((btn,i)=>{
    const name=btn.dataset.view||['trade','portfolio','scans','journal'][i];
    btn.classList.toggle('active',name===activeView);
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
  const since=paused?s.tradeControl?.pausedAt:s.tradeControl?.resumedAt;
  const timestamp=Date.parse(since);
  const label=blocked?'קניות חסומות · '+(!health.journalReady?'יומן העסקאות דורש בדיקה':health.pendingOrder?'ממתין לאימות פקודה':health.reconciliation?.error?'לא ניתן לאמת את נתוני החשבון':health.missingProtection?.length?'הגנת בורסה טרם אומתה':'ממתין להתאמת חשבון'):!known?'מצב מסחר לא ידוע':paused?'מסחר עצור · אין קניות חדשות':!executable?'מסחר LIVE לא מופעל':'מסחר אוטומטי פעיל';
  const minutes=Number.isFinite(timestamp)?Math.max(0,Math.floor((Date.now()-timestamp)/60000)):null;
  el.textContent=label+(minutes===null?' · זמן שינוי לא זמין':' · מאז '+new Date(timestamp).toLocaleString('he-IL')+' · '+minutes+' דקות')+(s.mode==='demo'&&health?.managedPositions>0?' · ניהול החזקות LIVE ממשיך ברקע':'');
}

function mode(s){
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
  $('#demoTradesSection')?.classList.toggle('hidden',!isDemo);
  $('#demoRealtimePositionsSection')?.classList.toggle('hidden',!isDemo);
  put('#refreshBtn',isDemo?'בדוק עכשיו':'רענן LIVE');
  put('#portfolioTitle',isDemo?(demoTradingEnabled?'חשבון Binance Demo · USDT':'סימולציה פנימית · נפרדת מ־Binance'):'חשבון LIVE · Binance');
  put('#positionsTitle',isDemo?'פוזיציות פעילות · DEMO':'פוזיציות פעילות · LIVE');
  put('#status',isDemo?(demoTradingEnabled?'דמו Binance · מסחר אוטומטי':'סימולציה פנימית'):'LIVE · '+(s.liveTradingEnabled&&s.autoExecution?'מסחר אוטומטי מופעל':'ביצוע אוטומטי כבוי'));
}

function buyReasonLabel(r){
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
  if(!account?.connected)return waiting('WAIT_ACCOUNT','WAIT_ACCOUNT','וויקוף אושר · ממתין לנתוני יתרה והרשאות עדכניים');
  if(!account.tradingGate?.ready||account.tradingGate.withdrawalsEnabled)return waiting('WAIT_LIVE_GATE','WAIT_LIVE_GATE','וויקוף אושר · מסחר LIVE אינו זמין לפי הרשאות החשבון');
  const held=(account.balances||[]).filter(b=>!['USDT','USDC'].includes(b.asset)&&Number(b.valueUsdt||0)>=5).length;
  if(held>=maxPositions)return waiting('WAIT_NO_SLOT','NO_SLOT','וויקוף אושר · אין מקום פנוי לפוזיציה נוספת');
  const plan=account.nextBuyAllocation;
  const spend=Number(plan?.amountUsdt??account.fixedPositionUsdt),cash=Number(account.usdtFree);
  if(plan?.code==='LIVE_ORDER_LIMIT')return waiting('WAIT_ALLOCATION','LIVE_ORDER_LIMIT','יתרת הפוזיציה האחרונה חורגת ממגבלת סכום הקנייה שהוגדרה');
  if(!Number.isFinite(spend)||spend<5)return waiting('WAIT_ALLOCATION',plan?.code||'WAIT_ALLOCATION','וויקוף אושר · סכום הקנייה אינו זמין או נמוך מהמינימום');
  if(!Number.isFinite(cash))return waiting('WAIT_ACCOUNT','WAIT_ACCOUNT','וויקוף אושר · יתרת USDT אינה זמינה');
  const required=spend*1.002;
  if(cash<required)return waiting('WAIT_CASH','NO_CASH','וויקוף אושר · ממתין ליתרה: זמינים '+cash.toFixed(2)+', נדרשים '+required.toFixed(2)+' USDT כולל מרווח לעמלות · חסרים '+(required-cash).toFixed(2)+' USDT');
  if(a.lastError)return waiting('WAIT_EXECUTION_ERROR','EXECUTION_ERROR','וויקוף אושר · שגיאת ביצוע: '+a.lastError);
  return {decision:'BUY_READY',blocker:plan?.lastSlot?{code:'BUY_READY',text:'וויקוף אושר · פוזיציה אחרונה: קנייה ב־'+spend.toFixed(2)+' USDT מהיתרה, עם מרווח לעמלות'}:a.blocker};
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
  document.querySelectorAll('#assetsBody tr').forEach(x=>x.classList.toggle('selected',x===tr));
  updateSelectedAsset(currentAgentData,currentMode,currentLiveAccount);
}
function render(d,currentMode='demo',liveAccount=null,{preserveScanner=false}={}){
  d={...d,agents:activeContext(d,currentMode,liveAccount).agents};
  rememberWyckoffDisplay(d.agents,currentMode);
  currentAgentData=d;
  if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('levi-binance-rsi',{detail:d.agents||[]}));
  const wx=d.wyckoffStats||{};
  put('#wyckoffBuys',wx.buys??0);
  put('#wyckoffSells',wx.sells??0);
  put('#wyckoffClosed',wx.closed??0);
  const fees=wx.fees;
  put('#tradeFeesTotal',fees?fmt(fees.totalUsdt,4)+' USDT'+(fees.complete?'':' · חלקי'):'—');
  put('#tradeFeesDetails',fees?'קנייה: '+fmt(fees.buyUsdt,4)+' · מכירה: '+fmt(fees.sellUsdt,4)+' USDT · לפי היומן הזמין'+(fees.missingRecords?' · '+fees.missingRecords+' רשומות ללא נתוני עמלה':'')+Object.entries(fees.unvalued||{}).map(([asset,amount])=>' · טרם הומר: '+fmt(amount,8)+' '+asset).join(''):'ממתין לנתוני עמלות מהשרת');
  if(currentMode==='live')put('#paperTradesCount',wx.closed??0);
  if(d.paper?.currency)moneyUnit=d.paper.currency;
  if(d.paper?.source==='BINANCE_DEMO_SPOT'){demoTradingEnabled=true;$('#resetPaperBtn')?.classList.add('hidden');if(!d.paper.error)put('#status','דמו Binance · מסחר אוטומטי');}
  if(d.paper?.source==='BINANCE_DEMO_SPOT'){
    put('#portfolioTitle','חשבון Binance Demo · USDT');
    if(d.paper.error)put('#status','מסחר דמו מושהה · '+d.paper.error);
    else if(!d.paper.connected)put('#status','ממתין לחיבור לחשבון הדמו');
  }
  currentLiveAccount=liveAccount;
  const {p,agents,isLive,liveBalances,isHeld,activeAgents,weakestActive}=activeContext(d,currentMode,liveAccount);
  const paperPos=p.positions||{};
  const rotationGap=Number(d.config?.rotationScoreGap||20);
  const maxPositions=Number(currentMode==='live'?(d.config?.maxPositions||5):(p.maxPositions||10));

  const warning=$('#unmanagedHoldingWarning');
  if(warning){
    const unverified=isLive&&liveAccount?.connected?liveBalances.filter(b=>{
      const a=agents.find(a=>a.symbol===b.asset+'USDT');
      return !['FIXED_TP4_SL1_V1','PROFIT_FLOOR4_TRAIL1PP_STOP1_V1'].includes(a?.strategy?.exitPolicy);
    }):[];
    warning.hidden=!unverified.length;
    warning.textContent=unverified.length?'נדרש טיפול · ניהול והגנות לא אומתו: '+unverified.map(b=>b.asset).join(', ')+' · קיימת יתרה בחשבון ללא פוזיציה מנוהלת מתועדת. אין להסתמך על מכירה אוטומטית. יש לבדוק פקודות הגנה בבייננס.':'';
  }
  renderMarketStrip(agents);

  const sd=d.config?.strategyDiagnostics||{};
  const nearest=(sd.nearestToTarget||[])[0];
  put('#strategyDiagnostics','5M מוכנים '+(sd.dailyReady??0)+'/'+(sd.evaluated??0)+' · דשדוש '+(sd.consolidation??0)+' · Spring '+(sd.spring??0)+' · מועמדים '+(sd.executionCandidates??0)+' · בוצעו '+(sd.demoFilled??0)+' · נדחו '+(sd.demoRejected??0));

  if(!activeAgents.length){
    put('#scanStatusMessage','נסרקו '+agents.length+' · מוצגים '+agents.length+' · אין כרגע פוזיציה פעילה — ממתין ב־USDT להזדמנות איכותית');
  }else{
    const weakText=weakestActive?(' · החלשה ביותר: '+weakestActive.symbol+' · ציון '+fmt(weakestActive.score,1)):'';
    const interval=Number(d.config?.decisionIntervalMs||60000)/1000;
    const rotationState=activeAgents.length<maxPositions
      ? ' · בדיקה כל '+fmt(interval,0)+' שניות · '+activeAgents.length+'/'+maxPositions+' מקומות תפוסים'
      : ' · בדיקה כל '+fmt(interval,0)+' שניות · '+(d.config?.rotationEnabled?'רוטציה פעילה — נדרש יתרון +'+fmt(rotationGap,0):'רוטציה כבויה');
    const diag=d.config?.buyCandidateCount!=null
      ? ' · עברו תנאי כניסה: '+d.config.buyCandidateCount+' · מתאימים למגמה: '+(d.config.trendCandidateCount??'—')+(d.config.demoExecutionBusy?' · מנוע ביצוע עסוק':'')
      : '';
    put('#scanStatusMessage',
      'נסרקו '+agents.length+' · מוצגים '+currentVisibleAgents.length+
      ' · '+activeAgents.length+'/'+maxPositions+' פוזיציות פעילות'+weakText+rotationState+diag
    );
  }

  if(!isLive){
    put('#accountPnlLabel','רווח / הפסד');
    put('#accountPnlNote','');
    put('#holdingsNote','');
    const pnlEl=$('#paperPnl');
    if(pnlEl)for(const kind of ['profit','loss','flat','unknown'])pnlEl.classList.toggle('pnl-'+kind,false);
    put('#paperValue',fmt(p.valueIls)+' '+moneyUnit);
    put('#paperCash',fmt(p.cashIls)+' '+moneyUnit);
    put('#paperPnl',`${+p.profitIls>=0?'+':''}${fmt(p.profitIls)} ${moneyUnit} (${+p.profitPct>=0?'+':''}${fmt(p.profitPct)}%)`);
    put('#slots',`${p.activePositions||0}/${maxPositions}`);
    put('#slotValue',fmt(p.slotIls)+' '+moneyUnit+(p.allocationMode==='FIXED_10_PERCENT'?' · קבוע':''));
    put('#paperTradesCount',(p.trades||[]).length);
  }

  const displayScoreMin=Number(d.config?.rotationMinScore||65);
  currentVisibleAgents=[...agents].sort((a,b)=>{
    const aHeld=isHeld(a)?1:0,bHeld=isHeld(b)?1:0;
    if(aHeld!==bHeld)return bHeld-aHeld;

    const aBuy=(a.decision==='BUY'||a.decision==='BUY_READY'||a.decision==='BUY READY'||a.buyQualified)?1:0;
    const bBuy=(b.decision==='BUY'||b.decision==='BUY_READY'||b.decision==='BUY READY'||b.buyQualified)?1:0;
    if(aBuy!==bBuy)return bBuy-aBuy;

    return Number(b.score||0)-Number(a.score||0);
  });
  if(!currentVisibleAgents.some(a=>a.symbol===selectedSymbol)){
    selectedSymbol=activeAgents[0]?.symbol||currentVisibleAgents[0]?.symbol||agents[0]?.symbol||'BTCUSDT';
  }

  if(!preserveScanner)window.LEVI_SCANNER_VIEW.update($('#assetsBody'),currentVisibleAgents.map(a=>{
    const s=a.strategy||{};
    const held=isHeld(a);
    const score=Number(a.score||0);
    const pnl=positionPnlDisplay(isLive?liveBalances.find(x=>x.asset+'USDT'===a.symbol):paperPos[a.symbol],isLive?'USDT':moneyUnit);
    const trendLabel=({UP:'עולה',DOWN:'יורדת'}[s.direction]||'לא ידועה');
    const dec=decisionFor(a,held,activeAgents.length,maxPositions,weakestActive,rotationGap,isLive,liveAccount);
    const displayBlocker=isLive&&!held?liveEntryStatus(a,liveAccount,maxPositions).blocker:a.blocker;
    const rowClasses=[
      a.symbol===selectedSymbol?'selected':'',
      held?'active-position':'',
      held?pnl.className:'',
      (dec==='BUY'||dec==='BUY READY'||dec==='BUY_READY')?'buy-alert':'',
      dec==='ROTATE READY'?'rotate-alert':''
    ].filter(Boolean).join(' ');
    return {symbol:a.symbol,className:rowClasses,cells:[
      {html:`<b>${a.symbol.replace('USDT','')}</b><div class="mini ${held?pnl.className:''}">${held?pnl.text:(a.demoTradable===false?'נסרק בלבד · לא זמין בדמו':blockerLabel(displayBlocker))}</div>${a.accountOnly?'<div class="mini">החזקה מהחשבון · ללא ניהול אוטומטי מתועד</div>':held?'<div class="mini trend-note">מגמה: '+trendLabel+'</div>':''}`},
      {html:fmt(s.price,Math.abs(Number(s.price))<10?8:4)},
      {className:held?pnl.className:'',html:held?pnl.text:'—'},
      {className:'decision '+String(dec).toLowerCase().replaceAll(' ','-'),html:decisionLabel(dec)}
    ]};
  }),selectScannerAsset);

  if(isLive){
    $('#positions').innerHTML=liveBalances.length
      ? liveBalances.map(x=>{const pnl=positionPnlDisplay(x,'USDT');return `<div><b>${x.asset}USDT</b> · כמות ${fmt(x.qty,8)} · שווי ${fmt(x.valueUsdt)} USDT<div class="${pnl.className}">${pnl.text}</div><div class="mini">לפי עלות מתועדת · לפני עמלת מכירה ועמלות במטבע אחר</div></div>`;}).join('')
      : liveAccount?'<div class="mini">אין פוזיציות LIVE פעילות.</div>':'<div class="mini">לא ניתן לאמת כעת את הפוזיציות בחשבון LIVE.</div>';
  }else{
    const ps=Object.values(paperPos);
    $('#positions').innerHTML=ps.length
      ? ps.map(x=>{const pnl=positionPnlDisplay(x);return `<div><b>${x.symbol}</b> · ${fmt(x.allocationIls)} ${moneyUnit} · כניסה ${fmt(x.entryPrice)} · כמות ${fmt(x.qty,8)}<div class="${pnl.className}">${pnl.text}</div></div>`;}).join('')
      : '<div class="mini">אין פוזיציות פעילות.</div>';
    $('#paperHistory').innerHTML=(p.trades||[]).slice(0,10).map(t=>`<div><b>${t.symbol}</b> · $${fmt(t.buyPrice)} → $${fmt(t.sellPrice)} · ${+t.pnlPct>=0?'+':''}${fmt(t.pnlPct)}% · ${+t.pnlIls>=0?'+':''}${fmt(t.pnlIls)} ${moneyUnit}<div class="mini">עמלת קנייה: ${commissionsText(t.buyCommissions)} · עמלת מכירה: ${commissionsText(t.sellCommissions)}</div><div class="mini">מועד מכירה: ${tradeExecutionTime(t.at)} · שעון ישראל</div></div>`).join('')||'<div class="mini">עדיין אין עסקאות סגורות.</div>';
  }

  if(activeView==='portfolio')renderPortfolioView();
  if(activeView==='trade'||activeView==='scans')requestAnimationFrame(()=>drawCandles(chartCandles));
  updateSelectedAsset(d,currentMode,liveAccount);
}

function rotationGapText(a,d,currentMode,liveAccount){
  const {isHeld,activeAgents,weakestActive}=activeContext(d,currentMode,liveAccount);
  if(isHeld(a)) return 'פעיל';
  if(!a.buyQualified) return 'לא כשיר לרוטציה';
  if(!weakestActive) return 'מתאים לקנייה';
  const gap=Number(a.score||0)-weakestActive.score;
  return (gap>=0?'+':'')+fmt(gap,1)+' / נדרש +'+fmt(Number(d.config?.rotationScoreGap||20),0);
}

async function updateSelectedAsset(d=currentAgentData,currentModeArg=currentMode,liveAccount=currentLiveAccount){
  if(!d) return;
  const a=(d.agents||[]).find(x=>x.symbol===selectedSymbol)||(d.agents||[])[0];
  if(!a) return;
  selectedSymbol=a.symbol;
  const {isHeld,activeAgents,weakestActive,p}=activeContext(d,currentModeArg,liveAccount);
  const dec=decisionFor(a,isHeld(a),activeAgents.length,Number(currentModeArg==='live'?(d.config?.maxPositions||5):(p.maxPositions||6)),weakestActive,Number(d.config?.rotationScoreGap||20),currentModeArg==='live',liveAccount);
  const s=a.strategy||{};

  put('#chartSymbol',a.symbol);
  const tradingViewLink=$('#binanceTradingView');if(tradingViewLink)tradingViewLink.href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent('BINANCE:'+a.symbol);
  put('#chartPrice',s.price?'$'+fmt(s.price,Math.abs(Number(s.price))<10?8:4):'—');
  put('#chartScore','ציון '+fmt(a.score,1));
  put('#chartMA',s.ma?'$'+fmt(s.ma,Math.abs(Number(s.ma))<10?8:4):'—');
  put('#chartWave',fmt(s.currentWave,2)+'%');
  put('#chartPrevDown',fmt(s.previousDownWave,2)+'%');
  put('#chartQualification',buyReasonLabel(a.buyReason));
  const hourly=a.entryFilters;
  put('#hourlyTrendStatus',d.config?.hourlyTrendFilter?.enabled!==true?'אישור מגמה: ממתין לעדכון השרת':isHeld(a)?'אישור מגמת שעה חל על כניסות אוטומטיות חדשות':hourly?.sma20!=null?
    'מגמת שעה: '+(hourly.ok?'מאושרת':'ממתינה')+' · סגירה '+fmt(hourly.close,8)+' · ממוצע 20 '+fmt(hourly.sma20,8)+' · ממוצע 50 '+fmt(hourly.sma50,8)+' · '+new Date(hourly.asOf).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'מגמת שעה: ממתין ל־50 שעות מלאות ועדכניות');

  const selectedPnl=positionPnlDisplay(currentModeArg==='live'?liveAccount?.balances?.find(x=>x.asset+'USDT'===a.symbol):p.positions?.[a.symbol],currentModeArg==='live'?'USDT':moneyUnit);
  const badge=$('#chartDecisionBadge');
  put('#chartDecisionBadge',isHeld(a)?decisionLabel(dec)+' · '+selectedPnl.text:decisionLabel(dec));
  if(badge)for(const kind of ['profit','loss','flat','unknown'])badge.classList.toggle('pnl-'+kind,isHeld(a)&&selectedPnl.kind===kind);
  put('#chartMeta',a.accountOnly?'החזקה מהחשבון · ללא ניהול אוטומטי מתועד · עלות לפי היסטוריית בייננס כשזמינה':d.config?.hourlyTrendFilter?.enabled?'וואיקוף 5 דקות · אישור מגמת שעה · '+buyReasonLabel(a.buyReason):(Number(s.ma)>0&&Number.isFinite(Number(s.ma))?(s.aboveMA?'מעל ממוצע 200':'מתחת לממוצע 200'):'ממוצע 200 לא זמין')+' · '+({UP:'גל עולה',DOWN:'גל יורד'}[s.direction]||'—')+' · '+buyReasonLabel(a.buyReason));

  put('#actionSelectedSymbol',a.symbol);
  put('#actionSelectedDecision',decisionLabel(dec));
  put('#actionSelectedPnl',isHeld(a)?selectedPnl.text:'אין פוזיציה פעילה');
  const selectedPnlEl=$('#actionSelectedPnl');
  if(selectedPnlEl)for(const kind of ['profit','loss','flat','unknown'])selectedPnlEl.classList.toggle('pnl-'+kind,isHeld(a)&&selectedPnl.kind===kind);
  put('#actionSelectedPnlNote',isHeld(a)?(currentModeArg==='live'?'לפי עלות מתועדת · לפני עמלת מכירה ועמלות במטבע אחר':'רווח / הפסד לא ממומש'):'P&L יוצג לאחר קנייה');
  put('#actionRotationGap',rotationGapText(a,d,currentModeArg,liveAccount));
  put('#actionQualification',currentModeArg==='live'&&!isHeld(a)?blockerLabel(liveEntryStatus(a,liveAccount,Number(d.config?.maxPositions||5)).blocker):buyReasonLabel(a.buyReason));

  await Promise.all([...(activeView==='trade'||activeView==='scans'?[loadChart(a.symbol)]:[]),...(activeView==='journal'?[loadDecisionHistory(a.symbol)]:[])]);
}

function blockerLabel(b){
  if(!b)return '—';
  if(typeof b==='string')return b;
  if(['WAIT_STABLECOIN','WAIT_MOVEMENT','WAIT_VOLUME','WAIT_HOURLY_TREND','WAIT_HOURLY_TREND_DATA','WAIT_QUALITY_DATA'].includes(b.code))return decisionReasonLabel(b.code);
  return b.text||b.code||'—';
}

function decisionReasonLabel(r){
  return ({
    BUY_EXECUTED:'BUY בוצע',
    SELL_EXECUTED:'SELL בוצע',
    ROTATE_IN:'רוטציה פנימה',
    ROTATE_OUT:'רוטציה החוצה',
    NO_SLOT:'אין Slot פנוי',
    ROTATION_NOT_STRONG_ENOUGH:'לא חזק מספיק לרוטציה',
    BUY_READY:'מתאים לקנייה',
    QUALIFIED_BUT_HOLD:'מתאים לקנייה אך ממתין',
    ACTIVE_LONG:'פוזיציה פעילה · ממשיך להחזיק',
    HOLD_NOT_QUALIFIED:'HOLD · לא כשיר לכניסה',
    WAVE_BELOW_3:'לוגיקה ישנה',
    WAVE_ABOVE_8:'לוגיקה ישנה',
    NOT_STRONGER_THAN_PREVIOUS_DOWN:'הגל חלש מהירידה הקודמת',
    BELOW_MA200:'מתחת ל־MA200',
    NOT_UP:'לא בגל עולה',
    NO_PREVIOUS_DOWN:'אין גל ירידה קודם',
    STALE_5M_SIGNAL:'נר 5 הדקות האחרון אינו עדכני',
    WAIT_CURRENT_5M_HISTORY:'ממתין להיסטוריית 5 דקות עדכנית',
    FIVE_MINUTE_TIMEFRAME_REQUIRED:'חסרים נרות רציפים של 5 דקות',
    TRADING_PAUSED:'מסחר עצור · אין קניות חדשות',
    WAIT_STABLECOIN:'מטבע יציב — אינו מועמד למסחר',
    WAIT_MOVEMENT:'תנועה חלשה ביחס לעלויות',
    WAIT_VOLUME:'ממתין לאישור מחזור מסחר',
    WAIT_HOURLY_TREND:'וויקוף אושר · ממתין לסגירת שעה מעל ממוצע 20, וממוצע 20 מעל 50',
    WAIT_HOURLY_TREND_DATA:'ממתין ל־50 שעות מלאות ועדכניות לאישור מגמה',
    HOURLY_TREND_CONFIRMED:'מגמת שעה מאושרת: סגירה מעל ממוצע 20, וממוצע 20 מעל 50',
    WAIT_QUALITY_DATA:'ממתין לנתונים לאישור איכות',
    WAIT_NEW_WYCKOFF_SIGNAL:'ממתין לאישור וויקוף חדש לאחר מכירה או חידוש מסחר',
    WYCKOFF_SPRING_RSI_LIVE:'Spring ו־RSI חי בין 0 ל־30 · ללא המתנה לסגירת נר',
    SPRING_REJECTED_RSI_HIGH:'התבנית נפסלה: RSI מעל 30 ב־Spring · מחפש שיא חדש',
    WAIT_RSI_0_30:'ממתין ל־RSI חי בין 0 ל־30 בנקודת Spring',
    WAIT_RSI_DATA:'אין מספיק נרות לחישוב RSI (14)',
    WYCKOFF_LIVE_RECLAIM:'וויקוף אושר במחיר החי מעל השפל הראשון · ללא המתנה לסגירת נר',
    WAIT_SPRING_RETEST:'וויקוף אושר · ממתין לחזרת המחיר לנקודת Spring',
    WAIT_PROFIT_ACTIVATION_4_PERCENT:'סטופ 1% · ממתין לרווח 4% להפעלת נגרר',
    PROFIT_FLOOR4_TRAIL1PP_HOLD:'רצפת רווח 4% · נגרר נקודת אחוז מהשיא',
    PROFIT_FLOOR4_TRAIL1PP_EXIT:'מכירה · הגנת רווח נגררת',
    TRAIL_STOP_LOSS_1_PERCENT:'מכירה · סטופ הפסד 1%',
    BROKER_TAKE_PROFIT_50_PERCENT:'מכירה · יעד רווח 50%',
    BROKER_STOP_LOSS:'מכירה · סטופ אצל הברוקר',
    FIXED_TP4_SL1_HOLD:'יעד רווח 4% · סטופ 1% ממחיר הקנייה',
    FIXED_TAKE_PROFIT_4_PERCENT:'מכירה · יעד רווח 4%',
    FIXED_STOP_LOSS_1_PERCENT:'מכירה · סטופ 1%',
    WYCKOFF_MINIMUM_PROFIT_HOLD:'היסטוריה · המתנה להגנת רווח לפי הכלל הקודם',
    WAIT_WYCKOFF_ENTRY_PRICE:'ממתין למחיר חי מעל השפל הראשון ומתחת ליעד התבנית',
    WYCKOFF_SPRING_RETEST:'קנייה בחזרה ל־Spring לאחר אישור וויקוף',
    WYCKOFF_SPRING_STOP_LOSS_10_PERCENT:'מכירה · ירידה של 10% ממחיר הקנייה',
    WYCKOFF_GAIN_GIVEBACK_20_PERCENT:'מכירה · החזרה של 20% מהעלייה שנצברה',
    HOLD:'HOLD',
    ERROR:'שגיאה'
  })[r]||r||'—';
}

function actionLabel(x){
  return ({BUY:'קנייה',SELL:'מכירה',ROTATE_IN:'רוטציה פנימה',ROTATE_OUT:'רוטציה החוצה'})[x]||x||'פעולה';
}

async function loadActionJournal(currentModeArg){
  try{
    const d=await J(ACTIONLOG);
    const list=currentModeArg==='live'?(d.live||[]):(d.demo||[]);
    const journal=d.netJournal?.[currentModeArg]||[];
    const netPanel=$('#netTradeJournal');if(netPanel)netPanel.innerHTML=journal.length?journal.slice(0,30).map(t=>'<div><b>'+t.symbol+' · '+(t.closed?'נסגרה':'מכירה חלקית')+'</b><div>'+tradeExecutionTime(t.at)+' · קנייה '+fmt(t.entryPrice,12)+' → מכירה '+fmt(t.sellPrice,12)+'</div><div class="'+(t.netPnlUsdt===null?'pnl-unknown':t.netPnlUsdt>=0?'pnl-profit':'pnl-loss')+'">רווח נטו: '+(t.netPnlUsdt===null?'חסרים נתוני עלות / עמלות':fmt(t.netPnlUsdt,4)+' USDT ('+fmt(t.netPnlPct)+'%)')+'</div><div>שיא רווח לפני עמלות: '+fmt(t.maxGrossPnlUsdt,4)+' USDT · שיא מחיר '+fmt(t.peakPrice,12)+'</div><div>עמלת קנייה: '+commissionsText(t.buyCommissions)+' · עמלת מכירה: '+commissionsText(t.sellCommissions)+'</div><div>סיבה: '+decisionReasonLabel(t.reason)+'</div></div>').join(''):'אין עסקאות עם עלות כניסה מתועדת';
    put('#actionJournalTitle','יומן פעולות · '+(currentModeArg==='live'?'LIVE':'DEMO'));
    $('#actionJournal').innerHTML=list.length?list.slice(0,30).map(x=>{
      const when=x.at?new Date(x.at).toLocaleString('he-IL'):'—';
      const amount=Number.isFinite(+x.amountIls)?' · סכום '+fmt(x.amountIls)+' '+moneyUnit:Number.isFinite(+x.amountUsdt)?' · סכום '+fmt(x.amountUsdt)+' USDT':'';
      const pnl=Number.isFinite(+x.pnlIls)?' · P/L '+(+x.pnlIls>=0?'+':'')+fmt(x.pnlIls)+' '+moneyUnit:'';
      const fees=' · עמלה: '+commissionsText(x.commissions);
      const reason=x.reason?' · '+x.reason:'';
      return `<div><b>${actionLabel(x.type)} · ${x.symbol||'—'}</b> · $${fmt(x.price)}${amount}${pnl}${fees}${reason} · ${when}</div>`;
    }).join(''):'<div class="mini">'+(currentModeArg==='live'?'עדיין אין פעולות LIVE.':'עדיין אין פעולות DEMO.')+'</div>';
  }catch(e){
    $('#actionJournal').innerHTML='<div class="mini">שגיאה בטעינת יומן הפעולות</div>';
  }
}

async function loadLiveAccount(prefetched=null){
  try{
    const d=prefetched||await J(LIVEACC),a=d.account||{};
    if(!d.connected||!d.account)throw Error(d.error||'נתוני החשבון אינם זמינים');
    put('#liveConnected',d.connected?'מחובר ✅':'לא מחובר');
    put('#liveTotalValue',fmt(a.totalValueUsdt)+' USDT');
    put('#liveUsdt',fmt(a.usdtFree)+' USDT');
    put('#liveCanTrade',a.tradingGate?.spotPermission?'Spot API פעיל':'קריאה בלבד');
    put('#liveAccountType',a.accountType||'—');
    put('#paperValue',fmt(a.totalValueUsdt)+' USDT');
    put('#paperCash',fmt(a.usdtFree)+' USDT');
    const pnl=liveAccountPnlDisplay(a);
    put('#paperPnl',pnl.text);
    put('#accountPnlLabel','רווח / הפסד לא ממומש');
    const pnlEl=$('#paperPnl');
    if(pnlEl)for(const kind of ['profit','loss','flat','unknown'])pnlEl.classList.toggle('pnl-'+kind,pnl.className==='pnl-'+kind);
    put('#accountPnlNote','לפי עלות מתועדת · לפני עמלת מכירה ועמלות במטבע אחר · שאריות מתחת ל־5 USDT אינן כלולות'+(a.profitReinvestmentPaused?' · ההקצאה הקיימת נשמרת; עדכון מרווחים ממתין להמרת עמלה':''));
    put('#holdingsNote','הפוזיציות אינן כוללות מזומן USDT; מספר ההחזקות בבייננס כולל גם מזומן.');
    put('#slots',((a.balances||[]).filter(x=>!['USDT','USDC'].includes(x.asset)&&Number(x.valueUsdt||0)>=5).length)+'/'+(a.maxPositions||5));
    put('#slotValue',a.fixedPositionUsdt>0?fmt(a.fixedPositionUsdt)+' USDT · רגיל'+(a.nextBuyAllocation?.lastSlot&&a.nextBuyAllocation.ok?' · אחרונה: '+fmt(a.nextBuyAllocation.amountUsdt)+' USDT מהיתרה':' · אחרונה לפי היתרה'):'—');
    put('#paperTradesCount',currentAgentData?.wyckoffStats?.closed??'—');
    const b=(a.balances||[]).filter(x=>(+x.free)+(+x.locked)>0);
    $('#liveBalances').innerHTML=b.length?b.map(x=>`<div><b>${x.asset}</b> · ${fmt(x.qty,8)} · ${fmt(x.valueUsdt)} USDT${!['USDT','USDC'].includes(x.asset)&&Number(x.valueUsdt)>0&&Number(x.valueUsdt)<5?' <span class="mini">· שארית קטנה — לא נספרת כפוזיציה</span>':''}</div>`).join(''):'<div class="mini">אין יתרות להצגה.</div>';
    return a;
  }catch(e){
    put('#paperPnl','אין נתוני חשבון');put('#slots','—');
    const pnlEl=$('#paperPnl');if(pnlEl)for(const kind of ['profit','loss','flat','unknown'])pnlEl.classList.toggle('pnl-'+kind,kind==='unknown');
    put('#liveConnected','שגיאה');put('#liveTotalValue','—');put('#liveUsdt','—');put('#liveCanTrade','—');put('#liveAccountType','—');
    $('#liveBalances').innerHTML='<div class="mini">'+e.message+'</div>';
    return null;
  }
}

async function loadDecisionHistory(symbol){
  try{
    put('#decisionHistorySymbol',symbol);
    const d=await J(DECISION_HISTORY+'?symbol='+encodeURIComponent(symbol)+'&limit=20');
    const recorded=d.recorded||[];
    const technical=d.technicalDaily||[];
    const technicalWarning=d.technicalError?'<div class="mini">ההיסטוריה הטכנית אינה זמינה כרגע; מוצגות הבדיקות שנרשמו.</div>':'';

    const header='<div class="decision-row header"><div>זמן</div><div>החלטה</div><div>גל</div><div>ירידה קודמת</div><div>ציון</div><div>מקור</div><div>סיבה</div></div>';

    const renderRecorded=recorded.map(x=>{
      const when=x.at?new Date(x.at).toLocaleString('he-IL'):'—';
      const cls=x.decision==='BUY'||x.decision==='ROTATE_IN'?'good':x.decision==='SELL'||x.decision==='ROTATE_OUT'?'bad':'warn';
      return `<div class="decision-row">
        <div>${when}</div>
        <div class="${cls}">${decisionLabel(x.decision||'HOLD')}</div>
        <div>${fmt(x.currentWave,2)}%</div>
        <div>${x.previousDownWave==null?'—':fmt(x.previousDownWave,2)+'%'}</div>
        <div>${fmt(x.score,1)}</div>
        <div title="Slots: ${x.activeSlots}/${x.maxSlots}">${x.decisionPriceSource==='LIVE_PRICE'?'LIVE':x.decisionPriceSource?.startsWith('5M')?'5M':'D1'}</div>
        <div>${decisionReasonLabel(x.reason||x.buyReason)}</div>
      </div>`;
    }).join('');

    const renderTechnical=technical.map(x=>{
      const when=x.at?new Date(x.at).toLocaleDateString('he-IL'):'—';
      const cls=x.buyQualified?'good':'warn';
      return `<div class="decision-row">
        <div>${when}</div>
        <div class="${cls}">${x.technicalDecision||'HOLD'}</div>
        <div>${fmt(x.currentWave,2)}%</div>
        <div>${x.previousDownWave==null?'—':fmt(x.previousDownWave,2)+'%'}</div>
        <div>—</div>
        <div>5M</div>
        <div>${decisionReasonLabel(x.buyReason)}</div>
      </div>`;
    }).join('');

    let out='';
    if(recorded.length){
      out+='<div class="decision-history-section-title">בדיקות אמיתיות שנרשמו במערכת</div>'+header+renderRecorded;
    }
    if(technical.length){
      out+='<div class="decision-history-section-title">היסטוריה טכנית · 5 דקות</div>'+header+renderTechnical;
    }
    $('#decisionHistory').innerHTML=technicalWarning+(out||'<div class="mini">אין עדיין היסטוריית החלטות.</div>');
  }catch(e){
    $('#decisionHistory').innerHTML='<div class="mini">שגיאה בטעינת היסטוריית החלטות</div>';
  }
}


function renderCandlePower(a){
  if(!a)return;
  const trendLabel=({UP:'מגמת עלייה',DOWN:'מגמת ירידה',SIDEWAYS:'דשדוש / לא ברור'})[a.trend]||'—';
  const controlLabel=({BUYERS:'קונים חזקים יותר',SELLERS:'מוכרים חזקים יותר',BALANCED:'כוחות מאוזנים'})[a.control]||'—';
  put('#candleTrend',trendLabel);
  put('#candleControl',controlLabel);
  put('#buyerPower',fmt(a.buyerScore,1));
  put('#sellerPower',fmt(a.sellerScore,1));
  put('#candleStructure',
    (a.explanation||'')+
    ' · HH '+(a.higherHighs??0)+
    ' · HL '+(a.higherLows??0)+
    ' · LH '+(a.lowerHighs??0)+
    ' · LL '+(a.lowerLows??0)
  );
  put('#candleCount',
    'קונים '+(a.buyerCandles??0)+
    ' | מוכרים '+(a.sellerCandles??0)+
    ' | מאוזנים '+(a.neutralCandles??0)+
    ' · כלל שליטה: 7 מול 3'
  );

  const stateLabel={
    BUYERS_STRONG:'קונים שולטים',
    SELLERS_STRONG:'מוכרים שולטים',
    BUYERS_REJECTION:'קונים דחו ירידה',
    SELLERS_REJECTION:'מוכרים דחו עלייה',
    BUYERS_EDGE:'יתרון לקונים',
    SELLERS_EDGE:'יתרון למוכרים',
    NEUTRAL:'מאוזן'
  };

  const rows=(a.candles||[]).slice().reverse();
  const el=$('#candlePowerRows');
  if(!el)return;
  el.innerHTML=rows.map((x,i)=>{
    const cls=x.state.startsWith('BUYERS')?'buyers':x.state.startsWith('SELLERS')?'sellers':'neutral';
    const when=x.closeTime?new Date(x.closeTime).toLocaleString('he-IL'):'—';
    return '<div class="candle-power-row '+cls+'">'+
      '<div><b>#'+(rows.length-i)+'</b><small>'+when+'</small></div>'+
      '<div><span>O</span><b>'+fmt(x.open,x.open<1?5:2)+'</b></div>'+
      '<div><span>H</span><b>'+fmt(x.high,x.high<1?5:2)+'</b></div>'+
      '<div><span>L</span><b>'+fmt(x.low,x.low<1?5:2)+'</b></div>'+
      '<div><span>C</span><b>'+fmt(x.close,x.close<1?5:2)+'</b></div>'+
      '<div><span>גוף</span><b>'+fmt(x.bodyPct,0)+'%</b></div>'+
      '<div class="candle-state"><b>'+stateLabel[x.state]+'</b><small>'+x.reason+'</small></div>'+
    '</div>';
  }).join('');
}

async function runBinanceWyckoffScan(candles,rows,position){
 if(typeof Worker==='undefined')return wyckoffHistoryEngine.binanceWyckoffHistory(candles,rows,position);
 return new Promise((resolve,reject)=>{
  const worker=new Worker('/binance-wyckoff-worker.js?v=20261017-history',{type:'module'});
  const timer=setTimeout(()=>{worker.terminate();reject(Error('WYCKOFF_SCAN_TIMEOUT'));},15000);
  worker.onmessage=event=>{clearTimeout(timer);worker.terminate();resolve(event.data);};
  worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('WYCKOFF_SCAN_UNAVAILABLE'));};
  worker.postMessage({candles,rows,position});
 });
}
let chartLoadInFlight=null;
let chartLastReadKey=null,chartLastReadAt=0;
function loadChart(symbol){
 const key=[symbol,selectedInterval,selectedRange,currentMode].join(':');
 if(chartLoadInFlight?.key===key)return chartLoadInFlight.promise;
 if(chartLastReadKey===key&&Date.now()-chartLastReadAt<15000&&chartCandles.length)return Promise.resolve();
 const promise=loadChartRequest(symbol);chartLoadInFlight={key,promise};
 const clear=()=>{if(chartLoadInFlight?.promise===promise)chartLoadInFlight=null;};
 promise.then(clear,clear);return promise;
}
async function loadChartRequest(symbol){
  globalThis.LEVI_RSI_BADGE?.setBinance(symbol);
  const requestId=++chartRequestId;
  const interval=selectedInterval,range=selectedRange;
  const modeAtRequest=currentMode;
  const contextKey=[symbol,interval,range,modeAtRequest].join(':');
  try{
    if(chartAnalysisContext!==contextKey){
      chartCandles=[];chartDecisions=[];
      const canvas=$('#priceChart');if(canvas)canvas.width=canvas.width;
      put('#chartEmpty','טוען נתוני גרף…');$('#chartEmpty')?.classList.remove('hidden');
    }else $('#chartEmpty')?.classList.add('hidden');
    const cached=typeof window!=='undefined'?window.LEVI_CHART_CACHE?.read(contextKey):null;
    if(chartAnalysisContext!==contextKey&&cached){
      chartCandles=cached.candles;chartDecisions=[];chartVisibleStartTime=cached.visibleStartTime;
      chartAnalysisContext=contextKey;chartWyckoffHistory=[];chartWyckoffError=null;selectedWyckoffId=null;
      drawCandles(chartCandles);$('#chartEmpty')?.classList.add('hidden');
      put('#chartLegend','עותק גרף קודם מ־'+new Date(cached.savedAt).toLocaleString('he-IL')+' · ממתין לנתונים עדכניים');
    }
    const d=await J(CHART+'?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(interval)+'&range='+encodeURIComponent(range),{timeoutMs:35000});
    if(!Array.isArray(d.candles)||!d.candles.length)throw Error('לא התקבלו נרות למטבע ולטווח שנבחרו.');
    put('#chartLegend','נר '+selectedInterval.toUpperCase()+' · '+('טווח '+({'1D':'יום','2D':'יומיים','3D':'3 ימים','4D':'4 ימים','5D':'5 ימים','1W':'שבוע'}[selectedRange]||selectedRange))+' · MA200');
    if(requestId!==chartRequestId||symbol!==selectedSymbol||interval!==selectedInterval||modeAtRequest!==currentMode||(d.decisionMode&&d.decisionMode!==modeAtRequest))return;
    $('#chartEmpty')?.classList.add('hidden');
    if(chartAnalysisContext!==contextKey){
      put('#chartDecisionDetails','בחר סימון כדי לראות את תנאי הבדיקה והתוצאה.');
      chartAnalysisContext=contextKey;selectedWyckoffId=null;chartWyckoffHistory=[];chartWyckoffError=null;
    }
    chartVisibleStartTime=Number(d.visibleStartTime)||0;
    chartCandles=d.candles||[];
    chartLastReadKey=contextKey;chartLastReadAt=Date.now();
    if(typeof window!=='undefined')window.LEVI_CHART_CACHE?.write(contextKey,d);
    chartDecisions=[...(d.decisions||[]),...(d.actions||[])];
    // Price data is visible immediately; historical annotations may finish later.
    drawCandles(chartCandles);globalThis.LEVI_MARKET_POWER?.load(selectedSymbol);
    try{
    const historyEngine=wyckoffHistoryEngine||await import('/lib/binance-wyckoff-history.mjs?v=20261017-history');
    wyckoffHistoryEngine=historyEngine;
    const source=interval==='5m'?d:await J(CHART+'?symbol='+encodeURIComponent(symbol)+'&interval=5m&range='+encodeURIComponent(range),{timeoutMs:35000});
    if(requestId!==chartRequestId||symbol!==selectedSymbol||interval!==selectedInterval||modeAtRequest!==currentMode)return;
    const sourceCandles=source.candles||[];
    if(typeof window!=='undefined')window.LEVI_RSI_BADGE_SOURCE={symbol,bars:sourceCandles};
    globalThis.LEVI_RSI_BADGE?.setBinance(symbol,sourceCandles);
    const closedAt=sourceCandles.filter(b=>b.closed!==false).at(-1)?.closeTime;
    const cacheKey=[symbol,range,modeAtRequest,closedAt].join(':');
    let analysis=wyckoffHistoryCache.get(cacheKey);
    const position=(currentAgentData?.agents||[]).find(a=>a.symbol===symbol)?.strategy||{};
    if(!analysis){analysis=await runBinanceWyckoffScan(sourceCandles,[...(source.decisions||[]),...(source.actions||[])],position);wyckoffHistoryCache.clear();wyckoffHistoryCache.set(cacheKey,analysis);}
    if(requestId!==chartRequestId)return;
    chartWyckoffHistory=historyEngine.mergeBinanceRecorded(analysis.history,[...(source.decisions||[]),...(source.actions||[])],position);chartWyckoffError=analysis.error;
    }catch(historyError){if(requestId!==chartRequestId)return;const position=(currentAgentData?.agents||[]).find(a=>a.symbol===symbol)?.strategy||{};chartWyckoffHistory=wyckoffHistoryEngine?wyckoffHistoryEngine.mergeBinanceRecorded([],chartDecisions,position):[];chartWyckoffError=historyError.message;}
    if(requestId!==chartRequestId)return;
    drawCandles(chartCandles);
    globalThis.LEVI_MARKET_POWER?.load(selectedSymbol);
  }catch(e){
    if(requestId!==chartRequestId)return;
    if(chartAnalysisContext===contextKey&&chartCandles.length){
      put('#chartLegend','לא ניתן לרענן כעת · מוצגים הנרות מהטעינה האחרונה · '+e.message);
    }else{
      chartCandles=[];chartDecisions=[];
      $('#chartDecisionMarkers')?.replaceChildren();
      const canvas=$('#priceChart');if(canvas)canvas.width=canvas.width;
      put('#chartEmpty','לא ניתן לטעון את הגרף · '+e.message);
      $('#chartEmpty')?.classList.remove('hidden');
    }
  }
}

function drawIndicators(candles){
  const engine=globalThis.BinanceIndicators;if(!engine)return;
  const values=engine.calculateIndicators(candles);
  for(const [key,name,color,bounds,levels] of [['rsi','RSI (14)','#bb90ff',[0,100],[30,70]],['roc','ROC (12)','#40d5de',null,[0]]]){
    const show=$('#show'+key.toUpperCase())?.checked;
    const panel=$('#'+key+'Panel');if(panel)panel.hidden=!show;
    if(show){const series=key==='rsi'?(globalThis.LEVI_RSI_BADGE?.series()||(selectedInterval==='5m'?values.rsi:[])):values[key];engine.drawIndicator($('#'+key+'Chart'),series.slice(-120),{name:key==='rsi'?name+' · 5 דקות':name,color,bounds,levels});}
  }
}
function chartSellLevel(data,liveAccount,mode,symbol){
 const agent=(data?.agents||[]).find(a=>a.symbol===symbol);
 const held=mode==='live'?(liveAccount?.balances||[]).some(b=>b.asset+'USDT'===symbol&&Number(b.valueUsdt)>=5):!!data?.paper?.positions?.[symbol];
 if(!held||!agent||agent.staleData)return null;
 const strategy=agent.strategy||{},position=mode==='live'?strategy:data.paper.positions[symbol];
 const stop=Number(strategy.effectiveStopPrice??position.effectiveStopPrice??strategy.stopPrice??position.stopPrice);
 if(!(stop>0)||!Number.isFinite(stop))return null;
 return {price:stop,reason:strategy.profitProtectionPending?'עצירת הפסד · הגנת רווח תופעל ב־'+tradeExecutionTime(strategy.profitProtectionStartsAt):strategy.trailingActive?'הגנה מהשיא':'עצירת הפסד',rsiSell:strategy.rsiExit?.sell===true};
}

function renderPositionPoints(view,step,left,y,digits){
 const root=$('#wyckoffPivots');if(!root)return;
 const level=chartSellLevel(currentAgentData,currentLiveAccount,currentMode,selectedSymbol);if(!level)return;
 const strategy=(currentAgentData?.agents||[]).find(a=>a.symbol===selectedSymbol)?.strategy||{};
 for(const [kind,label,at,price] of [['buy','קנייה בפועל',strategy.entryAt,strategy.entryPrice],['peak','השיא מאז הקנייה',strategy.peakAt,strategy.peakPrice]]){
  const time=Date.parse(at);if(!Number.isFinite(time)||!(Number(price)>0))continue;
  const index=view.findIndex(c=>time>=Number(c.openTime)&&time<=Number(c.closeTime));if(index<0)continue;
  const yy=y(Number(price));if(yy<94||yy>root.clientHeight-112)continue;
  const dot=document.createElement('button');dot.type='button';dot.className='position-candle-hit';
  dot.style.left=(left+step*(index+.5))+'px';dot.style.top=Math.min(y(Number(view[index].high)),y(Number(view[index].low)))-5+'px';dot.style.width=Math.max(12,step*.7)+'px';dot.style.height=Math.max(16,Math.abs(y(Number(view[index].high))-y(Number(view[index].low)))+10)+'px';
  dot.title=label+' · '+fmt(price,digits)+' USDT · '+tradeExecutionTime(at);dot.setAttribute('aria-label',dot.title);
  dot.onclick=()=>put('#chartDecisionDetails',dot.title);root.append(dot);
 }
}

let candleFlashOn=true;
setInterval(()=>{
 if(document.hidden||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
 const agent=(currentAgentData?.agents||[]).find(a=>a.symbol===selectedSymbol);
 const held=currentMode==='live'?(currentLiveAccount?.balances||[]).some(b=>b.asset+'USDT'===selectedSymbol&&Number(b.valueUsdt)>=5):!!currentAgentData?.paper?.positions?.[selectedSymbol];
 if(!held||!chartCandles.length)return;
 candleFlashOn=!candleFlashOn;drawCandles(chartCandles);
},650);
function drawCandles(candles){
  drawIndicators(candles);
  const canvas=$('#priceChart');
  if(!canvas||!candles.length){globalThis.LEVI_TRADE_RISK?.render($('#binanceTradeRisk'),null,'USDT');chartWorkbench?.clear();return;}
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
  const start=firstVisible<0?candles.length:firstVisible;
  const view=candles.slice(start);
  const viewMas=mas.slice(start);
  if(!view.length){chartWorkbench?.clear();return;}
  const vals=[];
  view.forEach((c,i)=>{vals.push(+c.high,+c.low);if(viewMas[i]!=null)vals.push(viewMas[i])});
  const sellLevel=chartSellLevel(currentAgentData,currentLiveAccount,currentMode,selectedSymbol);
  const selectedPosition=(currentAgentData?.agents||[]).find(a=>a.symbol===selectedSymbol)?.strategy||{};
  const heldNow=currentMode==='live'?(currentLiveAccount?.balances||[]).some(b=>b.asset+'USDT'===selectedSymbol&&Number(b.valueUsdt)>=5):!!currentAgentData?.paper?.positions?.[selectedSymbol];
  const walletBalance=(currentLiveAccount?.balances||[]).find(b=>b.asset+'USDT'===selectedSymbol);
  const managedPosition=heldNow&&['FIXED_TP4_SL1_V1','PROFIT_FLOOR4_TRAIL1PP_STOP1_V1'].includes(selectedPosition.exitPolicy);
  const riskPosition=managedPosition?{...selectedPosition,qty:currentMode==='live'?walletBalance?.qty:currentAgentData?.paper?.positions?.[selectedSymbol]?.qty,currentPrice:selectedPosition.price,pnlIls:currentMode==='live'?walletBalance?.pnlIls:null}:heldNow&&currentMode==='live'&&walletBalance?.costStatus==='VERIFIED_QUANTITY'?{entryPrice:walletBalance.entryPrice,qty:walletBalance.qty,currentPrice:walletBalance.usdtPrice,pnlIls:walletBalance.pnlIls,displayOnly:true}:null;
  const tradeRisk=globalThis.LEVI_TRADE_RISK?.levels(riskPosition);
  globalThis.LEVI_TRADE_RISK?.render($('#binanceTradeRisk'),riskPosition,'USDT');
  if(tradeRisk)vals.push(tradeRisk.target,tradeRisk.stop);
  const priceText=value=>Number.isFinite(Number(value))&&Number(value)>0?fmt(value,12)+' USDT':'—';
  put('#positionEntryPrice',heldNow?priceText(riskPosition?.entryPrice??selectedPosition.entryPrice):'—');
  put('#positionPeakPrice',heldNow?priceText(selectedPosition.peakPrice):'—');
  put('#positionSellPrice',sellLevel?priceText(sellLevel.price):'—');
  if(sellLevel)vals.push(sellLevel.price);
  if(heldNow)for(const value of [selectedPosition.entryPrice,selectedPosition.peakPrice])if(Number(value)>0&&Number.isFinite(Number(value)))vals.push(Number(value));
  put('#currentSellLevel',sellLevel?'סף מכירה לפי מחיר: '+fmt(sellLevel.price,12)+' USDT · '+sellLevel.reason+' · מתעדכן עם נתוני הסוכן'+(sellLevel.rsiSell?' · קיים גם אות RSI למכירה':''):'אין סף מחיר מתועד לפוזיציה פעילה');
  let min=Math.min(...vals),max=Math.max(...vals);
  const span=Math.max(max-min,Math.abs((max+min)/2)*0.002,1e-12)*priceRangeScale;
  const mid=(max+min)/2;min=mid-span*.58;max=mid+span*.58;
  const autoDigits=Math.min(12,Math.max(2,Math.ceil(-Math.log10((max-min)/5))+1));
  const priceDigits=autoDigits;
  put('#pricePrecisionValue',priceRangeScale===1?'אוטומטי':fmt(1/priceRangeScale,2)+'×');

  const left=18,right=Math.min(120,Math.max(70,priceDigits*7+25)),top=130,bottom=112;
  const cw=W-left-right,ch=H-top-bottom;
  const y=v=>top+(max-v)/(max-min)*ch;
  const step=cw/view.length;
  const body=Math.max(.5,Math.min(7,step*.55));
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

  const flashingIndices=new Set(),candleColors=new Map();
  const candleSetup=heldNow?selectedPosition.setup:displayedWyckoffSetup(selectedSymbol,currentMode)?.setup;
  const pivotColors={initialPeak:'#ffb454',firstLow:'#49cfff',rallyHigh:'#c59aff',secondaryTest:'#ff86b8',springLow:'#52e0a4',confirmation:'#fff08a'};
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
    {price:tradeRisk?.target,label:tradeRisk?.displayOnly?'המחשת רווח +4%':tradeRisk?.trailing?'הפעלת הגנה +'+tradeRisk.activation+'%':'יעד רווח +4%',color:'#64e1ae'},
    {price:heldNow?Number(riskPosition?.entryPrice??selectedPosition.entryPrice):NaN,label:'מחיר קנייה',color:'#61a9ff'},
    {price:heldNow?Number(selectedPosition.peakPrice):NaN,label:'שיא מאז הקנייה',color:'#a7d0ff'},
    {price:tradeRisk?.stop??sellLevel?.price,label:tradeRisk?.displayOnly?'המחשת הפסד −1%':tradeRisk?.armed?'סף רווח נגרר':tradeRisk?'סטופ −'+tradeRisk.sl+'%':'סף מכירה',color:tradeRisk?.armed?'#64e1ae':tradeRisk?'#ff8494':'#ffbd59'}
  ].filter(level=>Number.isFinite(level.price)&&level.price>0);
  ctx.restore();
  const labelRows=[];
  for(const level of priceLevels){
    const yy=y(level.price),inside=yy>=top&&yy<=top+ch;
    if(inside){ctx.save();ctx.beginPath();ctx.rect(left,top,cw,ch);ctx.clip();ctx.strokeStyle=level.color;ctx.lineWidth=1.5;ctx.setLineDash([7,5]);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(W-right,yy);ctx.stroke();ctx.restore();}
    let labelY=Math.max(top+14,Math.min(top+ch-10,yy-8));
    while(labelRows.some(row=>Math.abs(row-labelY)<19)&&labelY<top+ch-20)labelY+=20;
    if(labelRows.some(row=>Math.abs(row-labelY)<19))labelY=Math.max(top+14,labelY-40);
    labelRows.push(labelY);
    const text=level.label+' '+fmt(level.price,priceDigits)+(inside?'':' · מחוץ לטווח');
    ctx.save();ctx.font='12px Arial';ctx.textAlign='left';ctx.fillStyle='#081522';ctx.fillRect(left+4,labelY-14,Math.min(cw-8,ctx.measureText(text).width+12),19);ctx.fillStyle=level.color;ctx.fillText(text,left+10,labelY);ctx.restore();
  }
  ctx.save();
  ctx.restore();
  renderChartDecisionMarkers(ctx,view,candles,chartDecisions,step,left,8,selectedInterval);
  renderWyckoffPivots(view,chartDecisions,step,left,y,priceDigits);
  renderNumberedWyckoff(view,step,left,y,priceDigits);
  renderPositionPoints(view,step,left,y,priceDigits);

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
    ctx.fillText(parts[0],labelX,H-86);ctx.fillText(parts[1]||'',labelX,H-71);
  }
  chartWorkbench?.update({symbol:selectedSymbol,bars:view.map(b=>({...b,time:Number(b.openTime)})),low:min,high:max,width:W,height:H,bounds:{left,right:W-right,top,bottom:top+ch}});
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
      if(!dashboardLoaded&&(activeView==='trade'||activeView==='scans')&&typeof loadChart==='function'&&typeof selectedSymbol==='string')loadChart(selectedSymbol);
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
    if(activeView==='journal'||activeView==='portfolio')await loadActionJournal(m.mode);
    dashboardLoaded=true;
  }catch(e){
    put('#status','שגיאת טעינה · '+(e.message||'החיבור לא הצליח'));
    currentLiveAccount=null;
    if(scannerVerifiedMode==='live')put('#scannerFreshness','נתוני הטבלה מהעדכון האחרון · '+tradeExecutionTime(scannerVerifiedAt)+' · החיבור לא אומת מחדש');
    const control=$('#tradeControlStatus');
    control?.classList.remove('trading-active','trading-paused');
    put('#tradeControlStatus',e.status===401?'נדרש חיבור מכשיר לצפייה בחשבון':'מצב המסחר לא אומת · שרת לא זמין');
    if(e.status===401&&e.authToken===tradeControlToken){tradeControlToken=null;window.LEVI_TRADE_AUTH?.clear();window.LEVI_DEVICE_ACCESS?.refresh();}
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
  if(action==='start'&&!confirm('לחדש את המסחר האוטומטי? כניסות חדשות יחכו לאות וויקוף חדש.'))return;
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

document.getElementById('pricePrecisionUp')?.addEventListener('click',()=>{priceRangeScale=Math.max(.1,priceRangeScale/1.25);drawCandles(chartCandles);});
document.getElementById('pricePrecisionDown')?.addEventListener('click',()=>{priceRangeScale=Math.min(10,priceRangeScale*1.25);drawCandles(chartCandles);});
document.getElementById('pricePrecisionAuto')?.addEventListener('click',()=>{priceRangeScale=1;drawCandles(chartCandles);});

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
