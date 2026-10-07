const B='https://binance-wave-agent.onrender.com';
const MODE=B+'/api/binance-mode';
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
let selectedInterval='1d';
let selectedRange='6M';
let activeView='trade';
let demoTradingEnabled=false;
let moneyUnit='₪';
let chartCandles=[];
function decisionLabel(d){return ({ACTIVE_LONG:'פוזיציה פעילה',HOLD:'ממתין',BUY:'קנייה',SELL:'מכירה',BUY_READY:'מוכן לקנייה','BUY READY':'מוכן לקנייה',WAIT_NO_SLOT:'אין מקום פנוי','WAIT · NO SLOT':'אין מקום פנוי',WAIT_NO_ROTATION:'ממתין להחלפה','ROTATE READY':'מוכן להחלפה',ROTATE_IN:'נרכש בהחלפה',ROTATE_OUT:'נמכר בהחלפה'})[d]||d||'—';}

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
  document.querySelectorAll('.nav-btn[data-view], .topnav .nav-pill').forEach((btn,i)=>{
    const name=btn.dataset.view||['trade','portfolio','scans','journal'][i];
    btn.classList.toggle('active',name===activeView);
  });
}

async function J(u,o={}){
  const r=await fetch(u,{cache:'no-store',...o});
  if(!r.ok){
    let x={}; try{x=await r.json()}catch{}
    throw Error(x.error||`HTTP ${r.status}`);
  }
  return r.json();
}

function mode(s){
  const isDemo=s.mode==='demo';
  demoTradingEnabled=!!s.demoTradingEnabled;
  moneyUnit=isDemo&&demoTradingEnabled?'USDT':'₪';
  currentMode=s.mode;
  $('#demoBtn')?.classList.toggle('active',isDemo);
  $('#liveBtn')?.classList.toggle('active',!isDemo);
  $('#liveAccountCard')?.classList.toggle('hidden',isDemo);
  $('#resetPaperBtn')?.classList.toggle('hidden',!isDemo||demoTradingEnabled);
  $('#demoTradesSection')?.classList.toggle('hidden',!isDemo);
  $('#demoRealtimePositionsSection')?.classList.toggle('hidden',!isDemo);
  put('#refreshBtn',isDemo?'בדוק עכשיו':'רענן LIVE');
  put('#portfolioTitle',isDemo?(demoTradingEnabled?'חשבון Binance Demo · USDT':'סימולציה פנימית · נפרדת מ־Binance'):'חשבון LIVE · Binance');
  put('#positionsTitle',isDemo?'פוזיציות פעילות · DEMO':'פוזיציות פעילות · LIVE');
  put('#status',isDemo?(demoTradingEnabled?'דמו Binance · מסחר אוטומטי':'סימולציה פנימית'):'LIVE · '+(s.liveTradingEnabled?'TRADING ENABLED':'READ ONLY'));
}

function buyReasonLabel(r){
  return ({
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

function decisionFor(a,isHeld,activeCount,maxPositions,weakestActive,rotationGap,isLive){
  const s=a.strategy||{};
  if(!isLive) return a.decision==='WAIT_NO_SLOT'?'WAIT · NO SLOT':a.decision;
  if(isHeld) return s.sellConfirmed?'SELL':'HOLD';
  if(s.buyConfirmed){
    if(activeCount<maxPositions) return 'BUY READY';
    const gap=weakestActive?Number(a.score||0)-weakestActive.score:-999;
    return (Number(a.score||0)>=Number(currentAgentData?.config?.rotationMinScore||65)&&gap>=rotationGap)
      ?'ROTATE READY':'WAIT_NO_ROTATION';
  }
  return 'HOLD';
}

function renderMarketStrip(agents){
  const map=Object.fromEntries(agents.map(a=>[a.symbol,a]));
  for(const [sym,id] of [['BTCUSDT','#tickerBTC'],['ETHUSDT','#tickerETH'],['SOLUSDT','#tickerSOL'],['BNBUSDT','#tickerBNB'],['AAVEUSDT','#tickerAAVE']]){
    const a=map[sym];
    put(id,a?.strategy?.price?'$'+fmt(a.strategy.price):'—');
  }
}

function activeContext(d,currentMode,liveAccount){
  const p=d.paper||{},agents=d.agents||[];
  const isLive=currentMode==='live';
  const liveBalances=(liveAccount?.balances||[]).filter(x=>x.asset!=='USDT'&&Number(x.valueUsdt||0)>=5);
  const liveHeldSymbols=new Set(liveBalances.map(x=>x.asset+'USDT'));
  const isHeld=a=>isLive?liveHeldSymbols.has(a.symbol):a.position==='LONG';
  const activeAgents=agents.filter(isHeld);
  const weakestActive=activeAgents
    .map(a=>({symbol:a.symbol,score:(a.strategy?.buyConfirmed?Number(a.score||0):0)}))
    .sort((a,b)=>a.score-b.score)[0]||null;
  return {p,agents,isLive,liveBalances,isHeld,activeAgents,weakestActive};
}

function render(d,currentMode='demo',liveAccount=null){
  currentAgentData=d;
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
  const maxPositions=Number(p.maxPositions||6);

  renderMarketStrip(agents);

  const sd=d.config?.strategyDiagnostics||{};
  const nearest=(sd.nearestToTarget||[])[0];
  put('#strategyDiagnostics',
    '1m מוכנים '+(sd.minuteReady??0)+'/'+(sd.evaluated??0)+
    ' · דשדוש '+(sd.consolidation??0)+
    ' · פריצות חזקות '+(sd.strongBreakouts??0)+
    ' · שלב 1 מוכן '+(sd.stage1Ready??0)+
    ' · שלב 2 מוכן '+(sd.stage2Ready??0)+
    ' · מועמדי ביצוע '+(sd.executionCandidates??0)+
    ' · ניסיונות BUY '+(sd.demoAttempts??0)+
    ' · בוצעו '+(sd.demoFilled??0)+
    ' · נדחו '+(sd.demoRejected??0)+
    (nearest?' · שלב 2 קרוב: '+nearest.symbol+' · חסר '+fmt(nearest.remainingPct,2)+'%':'')
  );

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
    put('#paperValue',fmt(p.valueIls)+' '+moneyUnit);
    put('#paperCash',fmt(p.cashIls)+' '+moneyUnit);
    put('#paperPnl',`${+p.profitIls>=0?'+':''}${fmt(p.profitIls)} ${moneyUnit} (${+p.profitPct>=0?'+':''}${fmt(p.profitPct)}%)`);
    put('#slots',`${p.activePositions||0}/${maxPositions}`);
    put('#slotValue',fmt(p.slotIls)+' '+moneyUnit);
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

  $('#assetsBody').innerHTML=currentVisibleAgents.map(a=>{
    const s=a.strategy||{};
    const held=isHeld(a);
    const score=Number(a.score||0);
    const pnl=positionPnlDisplay(isLive?null:paperPos[a.symbol]);
    const trendLabel=({UP:'עולה',DOWN:'יורדת'}[s.direction]||'לא ידועה');
    const dec=decisionFor(a,held,activeAgents.length,maxPositions,weakestActive,rotationGap,isLive);
    const rowClasses=[
      a.symbol===selectedSymbol?'selected':'',
      held?'active-position':'',
      held?pnl.className:'',
      (dec==='BUY'||dec==='BUY READY'||dec==='BUY_READY')?'buy-alert':'',
      dec==='ROTATE READY'?'rotate-alert':''
    ].filter(Boolean).join(' ');
    return `<tr data-symbol="${a.symbol}" class="${rowClasses}">
      <td><b>${a.symbol.replace('USDT','')}</b><div class="mini ${held?pnl.className:''}">${held?pnl.text:(a.demoTradable===false?'נסרק בלבד · לא זמין בדמו':blockerLabel(a.blocker))}</div>${held?'<div class="mini trend-note">מגמה: '+trendLabel+'</div>':''}</td>
      <td>${fmt(s.price)}</td>
      <td><b>${fmt(score,1)}</b></td>
      <td class="decision ${String(dec).toLowerCase().replaceAll(' ','-')}">${decisionLabel(dec)}</td>
    </tr>`;
  }).join('');

  document.querySelectorAll('#assetsBody tr').forEach(tr=>{
    tr.onclick=()=>{
      selectedSymbol=tr.dataset.symbol;
      document.querySelectorAll('#assetsBody tr').forEach(x=>x.classList.toggle('selected',x===tr));
      updateSelectedAsset(d,currentMode,liveAccount);
    };
  });

  if(isLive){
    $('#positions').innerHTML=liveBalances.length
      ? liveBalances.map(x=>`<div><b>${x.asset}USDT</b> · כמות ${fmt(x.qty,8)} · שווי ${fmt(x.valueUsdt)} USDT</div>`).join('')
      : '<div class="mini">אין פוזיציות LIVE פעילות.</div>';
  }else{
    const ps=Object.values(paperPos);
    $('#positions').innerHTML=ps.length
      ? ps.map(x=>{const pnl=positionPnlDisplay(x);return `<div><b>${x.symbol}</b> · ${fmt(x.allocationIls)} ${moneyUnit} · כניסה ${fmt(x.entryPrice)} · כמות ${fmt(x.qty,8)}<div class="${pnl.className}">${pnl.text}</div></div>`;}).join('')
      : '<div class="mini">אין פוזיציות פעילות.</div>';
    $('#paperHistory').innerHTML=(p.trades||[]).slice(0,10).map(t=>`<div><b>${t.symbol}</b> · $${fmt(t.buyPrice)} → $${fmt(t.sellPrice)} · ${+t.pnlPct>=0?'+':''}${fmt(t.pnlPct)}% · ${+t.pnlIls>=0?'+':''}${fmt(t.pnlIls)} ${moneyUnit}</div>`).join('')||'<div class="mini">עדיין אין עסקאות סגורות.</div>';
  }

  if(activeView==='portfolio')renderPortfolioView();
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
  const dec=decisionFor(a,isHeld(a),activeAgents.length,Number(p.maxPositions||6),weakestActive,Number(d.config?.rotationScoreGap||20),currentModeArg==='live');
  const s=a.strategy||{};

  put('#chartSymbol',a.symbol);
  put('#chartPrice',s.price?'$'+fmt(s.price):'—');
  put('#chartScore','ציון '+fmt(a.score,1));
  put('#chartMA',s.ma?'$'+fmt(s.ma):'—');
  put('#chartWave',fmt(s.currentWave,2)+'%');
  put('#chartPrevDown',fmt(s.previousDownWave,2)+'%');
  put('#chartQualification',buyReasonLabel(a.buyReason));
  const selectedPnl=positionPnlDisplay(currentModeArg==='live'?null:p.positions?.[a.symbol]);
  const badge=$('#chartDecisionBadge');
  put('#chartDecisionBadge',isHeld(a)?decisionLabel(dec)+' · '+selectedPnl.text:decisionLabel(dec));
  if(badge)for(const kind of ['profit','loss','flat','unknown'])badge.classList.toggle('pnl-'+kind,isHeld(a)&&selectedPnl.kind===kind);
  put('#chartMeta',(s.aboveMA?'מעל ממוצע 200':'מתחת לממוצע 200')+' · '+({UP:'גל עולה',DOWN:'גל יורד'}[s.direction]||'—')+' · '+buyReasonLabel(a.buyReason));

  put('#actionSelectedSymbol',a.symbol);
  put('#actionSelectedDecision',decisionLabel(dec));
  put('#actionSelectedScore',fmt(a.score,1));
  put('#actionRotationGap',rotationGapText(a,d,currentModeArg,liveAccount));
  put('#actionQualification',buyReasonLabel(a.buyReason));

  await Promise.all([loadChart(a.symbol),loadDecisionHistory(a.symbol)]);
}

function blockerLabel(b){
  if(!b)return '—';
  if(typeof b==='string')return b;
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
    put('#actionJournalTitle','יומן פעולות · '+(currentModeArg==='live'?'LIVE':'DEMO'));
    $('#actionJournal').innerHTML=list.length?list.slice(0,30).map(x=>{
      const when=x.at?new Date(x.at).toLocaleString('he-IL'):'—';
      const amount=Number.isFinite(+x.amountIls)?' · סכום '+fmt(x.amountIls)+' '+moneyUnit:Number.isFinite(+x.amountUsdt)?' · סכום '+fmt(x.amountUsdt)+' USDT':'';
      const pnl=Number.isFinite(+x.pnlIls)?' · P/L '+(+x.pnlIls>=0?'+':'')+fmt(x.pnlIls)+' '+moneyUnit:'';
      const reason=x.reason?' · '+x.reason:'';
      return `<div><b>${actionLabel(x.type)} · ${x.symbol||'—'}</b> · $${fmt(x.price)}${amount}${pnl}${reason} · ${when}</div>`;
    }).join(''):'<div class="mini">'+(currentModeArg==='live'?'עדיין אין פעולות LIVE.':'עדיין אין פעולות DEMO.')+'</div>';
  }catch(e){
    $('#actionJournal').innerHTML='<div class="mini">שגיאה בטעינת יומן הפעולות</div>';
  }
}

async function loadLiveAccount(prefetched=null){
  try{
    const d=prefetched||await J(LIVEACC),a=d.account||{};
    put('#liveConnected',d.connected?'מחובר ✅':'לא מחובר');
    put('#liveTotalValue',fmt(a.totalValueUsdt)+' USDT');
    put('#liveUsdt',fmt(a.usdtFree)+' USDT');
    put('#liveCanTrade',a.tradingGate?.spotPermission?'Spot API פעיל':'קריאה בלבד');
    put('#liveAccountType',a.accountType||'—');
    put('#paperValue',fmt(a.totalValueUsdt)+' USDT');
    put('#paperCash',fmt(a.usdtFree)+' USDT');
    put('#paperPnl','—');
    put('#slots',((a.balances||[]).filter(x=>x.asset!=='USDT'&&Number(x.valueUsdt||0)>=5).length)+'/6');
    put('#slotValue',a.totalValueUsdt>0?fmt(Math.min(Number(a.tradingGate?.liveMaxUsdt||a.totalValueUsdt),a.totalValueUsdt)/6)+' USDT':'—');
    put('#paperTradesCount','—');
    const b=(a.balances||[]).filter(x=>(+x.free)+(+x.locked)>0);
    $('#liveBalances').innerHTML=b.length?b.map(x=>`<div><b>${x.asset}</b> · ${fmt(x.qty,8)} · ${fmt(x.valueUsdt)} USDT</div>`).join(''):'<div class="mini">אין יתרות להצגה.</div>';
    return a;
  }catch(e){
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
        <div title="Slots: ${x.activeSlots}/${x.maxSlots}">${x.decisionPriceSource==='LIVE_PRICE'?'LIVE':'D1'}</div>
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
        <div>D1</div>
        <div>${decisionReasonLabel(x.buyReason)}</div>
      </div>`;
    }).join('');

    let out='';
    if(recorded.length){
      out+='<div class="decision-history-section-title">בדיקות אמיתיות שנרשמו במערכת</div>'+header+renderRecorded;
    }
    if(technical.length){
      out+='<div class="decision-history-section-title">היסטוריה יומית טכנית</div>'+header+renderTechnical;
    }
    $('#decisionHistory').innerHTML=out||'<div class="mini">אין עדיין היסטוריית החלטות.</div>';
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

async function loadChart(symbol){
  try{
    $('#chartEmpty')?.classList.add('hidden');
    const d=await J(CHART+'?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(selectedInterval)+'&range='+encodeURIComponent(selectedRange));
    put('#chartLegend','נר '+selectedInterval.toUpperCase()+' · טווח '+selectedRange+' · MA200');
    chartCandles=d.candles||[];
    drawCandles(chartCandles);
    renderCandlePower(d.candleAnalysis);
  }catch(e){
    $('#chartEmpty')?.classList.remove('hidden');
  }
}

function drawCandles(candles){
  const canvas=$('#priceChart');
  if(!canvas||!candles.length)return;
  const rect=canvas.getBoundingClientRect();
  const ratio=window.devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(rect.width*ratio));
  canvas.height=Math.max(1,Math.round(rect.height*ratio));
  const ctx=canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  const W=rect.width,H=rect.height;
  ctx.clearRect(0,0,W,H);

  const closes=candles.map(x=>+x.close);
  const mas=candles.map((_,i)=>{
    if(i<199)return null;
    let sum=0;for(let k=i-199;k<=i;k++)sum+=closes[k];
    return sum/200;
  });

  const start=Math.max(0,candles.length-120);
  const view=candles.slice(start);
  const viewMas=mas.slice(start);
  const vals=[];
  view.forEach((c,i)=>{vals.push(+c.high,+c.low);if(viewMas[i]!=null)vals.push(viewMas[i])});
  let min=Math.min(...vals),max=Math.max(...vals);
  const pad=(max-min)*.08||1;min-=pad;max+=pad;

  const left=18,right=56,top=20,bottom=32;
  const cw=W-left-right,ch=H-top-bottom;
  const y=v=>top+(max-v)/(max-min)*ch;
  const step=cw/view.length;
  const body=Math.max(2,Math.min(7,step*.55));

  ctx.font='11px Arial';
  ctx.strokeStyle='rgba(120,145,170,.18)';
  ctx.fillStyle='#7890a8';
  ctx.lineWidth=1;
  for(let i=0;i<=5;i++){
    const yy=top+ch*i/5;
    ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(W-right,yy);ctx.stroke();
    const price=max-(max-min)*i/5;
    ctx.fillText(fmt(price,price<1?4:2),W-right+6,yy+4);
  }

  view.forEach((c,i)=>{
    const x=left+step*i+step/2;
    const up=+c.close>=+c.open;
    ctx.strokeStyle=up?'#2bd88a':'#ff6172';
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

  const labelCount=5;
  ctx.fillStyle='#7890a8';
  ctx.font='11px Arial';
  for(let i=0;i<labelCount;i++){
    const idx=Math.min(view.length-1,Math.floor(i*(view.length-1)/(labelCount-1)));
    const c=view[idx],x=left+step*idx;
    const d=new Date(c.openTime);
    ctx.fillText((d.getMonth()+1)+'/'+String(d.getFullYear()).slice(-2),x,H-10);
  }
}

async function load(){
  try{
    put('#status','מתחבר…');
    const m=await J(MODE);
    mode(m);
    const agent=await J(AGENT);
    if(m.mode==='live'){
      const liveData=await J(LIVEACC);
      const liveAccount=await loadLiveAccount(liveData);
      render(agent,'live',liveAccount);
    }else{
      render(agent,'demo',null);
    }
    await loadActionJournal(m.mode);
  }catch(e){
    put('#status','שרת לא זמין');
    console.error(e);
  }
}

async function setMode(m){
  try{
    const cur=await J(MODE);
    if(cur.mode===m)return load();
    if(m==='live'&&!confirm('לעבור ל-LIVE?'))return;
    await J(MODE,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});
    load();
  }catch(e){alert(e.message)}
}

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
    selectedInterval=btn.dataset.interval||'1d';
    document.querySelectorAll('.timeframe-btn').forEach(x=>x.classList.toggle('active',x===btn));
    await loadChart(selectedSymbol);
  };
});

document.querySelectorAll('.range-btn').forEach(btn=>{
  btn.onclick=async()=>{
    selectedRange=btn.dataset.range||'6M';
    document.querySelectorAll('.range-btn').forEach(x=>x.classList.toggle('active',x===btn));
    await loadChart(selectedSymbol);
  };
});

if(window.ResizeObserver){new ResizeObserver(()=>drawCandles(chartCandles)).observe($('#priceChart').parentElement);}
window.addEventListener('resize',()=>drawCandles(chartCandles));
load();
setInterval(load,5000);
