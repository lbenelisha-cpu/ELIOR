const B='https://binance-wave-agent.onrender.com',MODE=B+'/api/binance-mode',AGENT=B+'/api/binance-agent',EVAL=B+'/api/binance-agent/evaluate',RESET=B+'/api/binance-paper/reset',LIVEACC=B+'/api/binance-live-account',ACTIONLOG=B+'/api/binance-action-log';const $=s=>document.querySelector(s),fmt=(v,d=2)=>Number.isFinite(+v)?(+v).toLocaleString('he-IL',{maximumFractionDigits:d}):'—',put=(s,v)=>{const e=$(s);if(e)e.textContent=v};async function J(u,o={}){const r=await fetch(u,{cache:'no-store',...o});if(!r.ok){let x={};try{x=await r.json()}catch{}throw Error(x.error||`HTTP ${r.status}`)}return r.json()}
function mode(s){
  const isDemo=s.mode==='demo';
  $('#demoBtn')?.classList.toggle('active',isDemo);
  $('#liveBtn')?.classList.toggle('active',!isDemo);
  $('#liveAccountCard')?.classList.toggle('hidden',isDemo);
  $('#resetPaperBtn')?.classList.toggle('hidden',!isDemo);
  $('#demoTradesSection')?.classList.toggle('hidden',!isDemo);
  $('#demoRealtimePositionsSection')?.classList.toggle('hidden',!isDemo);
  put('#refreshBtn',isDemo?'בדוק עכשיו':'רענן LIVE');
  put('#portfolioTitle',isDemo?'תיק DEMO · 5,000 ₪':'חשבון LIVE · Binance');
  put('#positionsTitle',isDemo?'פוזיציות פעילות · DEMO':'פוזיציות פעילות · LIVE');
  put('#status',isDemo?'DEMO · PAPER':'LIVE · '+(s.liveTradingEnabled?'TRADING ENABLED':'READ ONLY'));
}
function render(d,currentMode='demo',liveAccount=null){
  const p=d.paper||{},paperPos=p.positions||{},agents=d.agents||[];
  const isLive=currentMode==='live';
  const liveBalances=(liveAccount?.balances||[]).filter(x=>x.asset!=='USDT'&&Number(x.valueUsdt||0)>=5);
  const liveHeldSymbols=new Set(liveBalances.map(x=>x.asset+'USDT'));

  const isHeld=a=>isLive?liveHeldSymbols.has(a.symbol):a.position==='LONG';
  const activeAgents=agents.filter(isHeld);
  const weakestActive=activeAgents
    .map(a=>({symbol:a.symbol,score:(a.strategy?.buyConfirmed?Number(a.score||0):0)}))
    .sort((a,b)=>a.score-b.score)[0]||null;
  const rotationGap=Number(d.config?.rotationScoreGap||20);
  const maxPositions=Number(p.maxPositions||3);

  if(!activeAgents.length){
    put('#scanStatusMessage','אין כרגע פוזיציה פעילה — ממתין ב־USDT להזדמנות איכותית');
  }else{
    const weakText=weakestActive?(' · הפוזיציה החלשה ביותר: '+weakestActive.symbol+' · Score '+fmt(weakestActive.score,1)):'';
    put('#scanStatusMessage',activeAgents.length+'/'+maxPositions+' פוזיציות פעילות'+weakText+' · רוטציה דורשת יתרון של +'+fmt(rotationGap,0)+' נקודות');
  }

  if(!isLive){
    put('#paperValue',fmt(p.valueIls)+' ₪');
    put('#paperCash',fmt(p.cashIls)+' ₪');
    put('#paperPnl',`${+p.profitIls>=0?'+':''}${fmt(p.profitIls)} ₪ (${+p.profitPct>=0?'+':''}${fmt(p.profitPct)}%)`);
    put('#slots',`${p.activePositions||0}/${maxPositions}`);
    put('#slotValue',fmt(p.slotIls)+' ₪');
    put('#paperTradesCount',(p.trades||[]).length);
  }

  $('#assetsBody').innerHTML=agents.map(a=>{
    const s=a.strategy||{};
    const held=isHeld(a);
    const score=Number(a.score||0);
    let gapText='—';

    if(!held&&weakestActive){
      const gap=score-weakestActive.score;
      gapText=(gap>=0?'+':'')+fmt(gap,1)+' / נדרש +'+fmt(rotationGap,0);
    }else if(held){
      gapText='פעיל';
    }

    let dec=a.decision==='WAIT_NO_SLOT'?'WAIT · NO SLOT':a.decision;
    if(isLive){
      if(held){
        dec=s.sellConfirmed?'SELL':'HOLD';
      }else if(s.buyConfirmed){
        if(activeAgents.length<maxPositions){
          dec='BUY READY';
        }else{
          const gap=weakestActive?score-weakestActive.score:-999;
          dec=(score>=Number(d.config?.rotationMinScore||65)&&gap>=rotationGap)?'ROTATE READY':'WAIT_NO_ROTATION';
        }
      }else{
        dec='HOLD';
      }
    }

    const posText=held?'LONG':'CASH';
    const slotText=held?'פעיל':'—';
    return `<tr><td><b>${a.symbol}</b></td><td>$${fmt(s.price)}</td><td>$${fmt(s.ma)}</td><td>${s.aboveMA?'🟢 מעל':'🔴 מתחת'}</td><td>${s.direction||'—'} · ${fmt(s.currentWave)}%</td><td>${fmt(s.previousDownWave)}%</td><td><b>${fmt(score,1)}</b></td><td>${gapText}</td><td>${posText}</td><td class="decision ${String(dec).toLowerCase()}">${dec}</td><td>${slotText}</td></tr>`;
  }).join('');

  if(isLive){
    $('#positions').innerHTML=liveBalances.length
      ? liveBalances.map(x=>`<div><b>${x.asset}USDT</b> · כמות ${fmt(x.qty,8)} · שווי ${fmt(x.valueUsdt)} USDT</div>`).join('')
      : '<div class="mini">אין פוזיציות LIVE פעילות.</div>';
  }else{
    const ps=Object.values(paperPos);
    $('#positions').innerHTML=ps.length
      ? ps.map(x=>`<div><b>${x.symbol}</b> · ${fmt(x.allocationIls)} ₪ · כניסה $${fmt(x.entryPrice)} · כמות ${fmt(x.qty,8)}</div>`).join('')
      : '<div class="mini">אין פוזיציות פעילות.</div>';
    $('#paperHistory').innerHTML=(p.trades||[]).slice(0,10).map(t=>`<div><b>${t.symbol}</b> · $${fmt(t.buyPrice)} → $${fmt(t.sellPrice)} · ${+t.pnlPct>=0?'+':''}${fmt(t.pnlPct)}% · ${+t.pnlIls>=0?'+':''}${fmt(t.pnlIls)} ₪</div>`).join('')||'<div class="mini">עדיין אין עסקאות סגורות.</div>';
  }
}
function actionLabel(x){return ({BUY:'קנייה',SELL:'מכירה',ROTATE_IN:'רוטציה פנימה',ROTATE_OUT:'רוטציה החוצה'})[x]||x||'פעולה'}
async function loadActionJournal(currentMode){
  try{
    const d=await J(ACTIONLOG);
    const list=currentMode==='live'?(d.live||[]):(d.demo||[]);
    put('#actionJournalTitle','יומן פעולות · '+(currentMode==='live'?'LIVE':'DEMO'));
    $('#actionJournal').innerHTML=list.length?list.slice(0,30).map(x=>{
      const when=x.at?new Date(x.at).toLocaleString('he-IL'):'—';
      const amount=Number.isFinite(+x.amountIls)?' · סכום '+fmt(x.amountIls)+' ₪':'';
      const pnl=Number.isFinite(+x.pnlIls)?' · P/L '+(+x.pnlIls>=0?'+':'')+fmt(x.pnlIls)+' ₪':'';
      const reason=x.reason?' · '+x.reason:'';
      return `<div><b>${actionLabel(x.type)} · ${x.symbol||'—'}</b> · ${fmt(x.price)}${amount}${pnl}${reason} · ${when}</div>`;
    }).join(''):'<div class="mini">'+(currentMode==='live'?'עדיין אין פעולות LIVE.':'עדיין אין פעולות DEMO.')+'</div>';
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
    put('#slots',((a.balances||[]).filter(x=>x.asset!=='USDT'&&Number(x.valueUsdt||0)>=5).length)+'/3');
    put('#slotValue',a.totalValueUsdt>0?fmt(Math.min(Number(a.tradingGate?.liveMaxUsdt||a.totalValueUsdt),a.totalValueUsdt)/3)+' USDT':'—');
    put('#paperTradesCount','—');
    const b=(a.balances||[]).filter(x=>(+x.free)+(+x.locked)>0);
    $('#liveBalances').innerHTML=b.length?b.map(x=>`<div><b>${x.asset}</b> · זמין ${fmt(x.free,8)} · נעול ${fmt(x.locked,8)} · שווי ${fmt(x.valueUsdt)} USDT</div>`).join(''):'<div class="mini">אין יתרות להצגה.</div>';
    return a;
  }catch(e){
    put('#liveConnected','שגיאה');put('#liveTotalValue','—');put('#liveUsdt','—');put('#liveCanTrade','—');put('#liveAccountType','—');
    $('#liveBalances').innerHTML='<div class="mini">'+e.message+'</div>';
    return null;
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
async function setMode(m){try{const cur=await J(MODE);if(cur.mode===m)return load();if(m==='live'&&!confirm('לעבור ל-LIVE?'))return;await J(MODE,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});load()}catch(e){alert(e.message)}}$('#demoBtn').onclick=()=>setMode('demo');$('#liveBtn').onclick=()=>setMode('live');$('#refreshBtn').onclick=async()=>{
  try{
    const m=await J(MODE);
    if(m.mode==='demo'){
      await J(EVAL,{method:'POST'});
    }
    await load();
  }catch(e){
    alert(e.message);
  }
};$('#resetPaperBtn').onclick=async()=>{if(confirm('לאפס את תיק ה-DEMO ל־5,000 ₪?')){await J(RESET,{method:'POST'});load()}};load();setInterval(load,30000);
