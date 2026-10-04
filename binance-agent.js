const B='https://binance-wave-agent.onrender.com',MODE=B+'/api/binance-mode',AGENT=B+'/api/binance-agent',EVAL=B+'/api/binance-agent/evaluate',RESET=B+'/api/binance-paper/reset',LIVEACC=B+'/api/binance-live-account',ACTIONLOG=B+'/api/binance-action-log';const $=s=>document.querySelector(s),fmt=(v,d=2)=>Number.isFinite(+v)?(+v).toLocaleString('he-IL',{maximumFractionDigits:d}):'—',put=(s,v)=>{const e=$(s);if(e)e.textContent=v};async function J(u,o={}){const r=await fetch(u,{cache:'no-store',...o});if(!r.ok){let x={};try{x=await r.json()}catch{}throw Error(x.error||`HTTP ${r.status}`)}return r.json()}
function mode(s){
  const isDemo=s.mode==='demo';
  $('#demoBtn')?.classList.toggle('active',isDemo);
  $('#liveBtn')?.classList.toggle('active',!isDemo);
  $('#liveAccountCard')?.classList.toggle('hidden',isDemo);
  $('#resetPaperBtn')?.classList.toggle('hidden',!isDemo);
  put('#refreshBtn',isDemo?'בדוק עכשיו':'רענן LIVE');
  put('#portfolioTitle',isDemo?'תיק DEMO · 5,000 ₪':'חשבון LIVE · Binance');
  put('#status',isDemo?'DEMO · PAPER':'LIVE · '+(s.liveTradingEnabled?'TRADING ENABLED':'READ ONLY'));
}
function render(d){const p=d.paper||{},pos=p.positions||{};put('#paperValue',fmt(p.valueIls)+' ₪');put('#paperCash',fmt(p.cashIls)+' ₪');put('#paperPnl',`${+p.profitIls>=0?'+':''}${fmt(p.profitIls)} ₪ (${+p.profitPct>=0?'+':''}${fmt(p.profitPct)}%)`);put('#slots',`${p.activePositions||0}/${p.maxPositions||3}`);put('#slotValue',fmt(p.slotIls)+' ₪');put('#paperTradesCount',(p.trades||[]).length);$('#assetsBody').innerHTML=(d.agents||[]).map(a=>{const s=a.strategy||{},dec=a.decision==='WAIT_NO_SLOT'?'WAIT · NO SLOT':a.decision;return `<tr><td><b>${a.symbol}</b></td><td>$${fmt(s.price)}</td><td>$${fmt(s.ma)}</td><td>${s.aboveMA?'🟢 מעל':'🔴 מתחת'}</td><td>${s.direction||'—'} · ${fmt(s.currentWave)}%</td><td>${fmt(s.previousDownWave)}%</td><td>${a.position}</td><td class="decision ${String(dec).toLowerCase()}">${dec}</td><td>${pos[a.symbol]?'פעיל':'—'}</td></tr>`}).join('');const ps=Object.values(pos);$('#positions').innerHTML=ps.length?ps.map(x=>`<div><b>${x.symbol}</b> · ${fmt(x.allocationIls)} ₪ · כניסה $${fmt(x.entryPrice)} · כמות ${fmt(x.qty,8)}</div>`).join(''):'<div class="mini">אין פוזיציות פעילות.</div>';$('#paperHistory').innerHTML=(p.trades||[]).slice(0,10).map(t=>`<div><b>${t.symbol}</b> · $${fmt(t.buyPrice)} → $${fmt(t.sellPrice)} · ${+t.pnlPct>=0?'+':''}${fmt(t.pnlPct)}% · ${+t.pnlIls>=0?'+':''}${fmt(t.pnlIls)} ₪</div>`).join('')||'<div class="mini">עדיין אין עסקאות סגורות.</div>'}
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
async function loadLiveAccount(){try{const d=await J(LIVEACC),a=d.account||{};put('#liveConnected',d.connected?'מחובר ✅':'לא מחובר');put('#liveTotalValue',fmt(a.totalValueUsdt)+' USDT');put('#liveUsdt',fmt(a.usdtFree)+' USDT');put('#liveCanTrade',a.canTrade?'כן':'לא');put('#liveAccountType',a.accountType||'—');put('#paperValue',fmt(a.totalValueUsdt)+' USDT');put('#paperCash',fmt(a.usdtFree)+' USDT');put('#paperPnl','—');put('#slots','—');put('#slotValue','—');put('#paperTradesCount','—');const b=(a.balances||[]).filter(x=>(+x.free)+(+x.locked)>0);$('#liveBalances').innerHTML=b.length?b.map(x=>`<div><b>${x.asset}</b> · זמין ${fmt(x.free,8)} · נעול ${fmt(x.locked,8)} · שווי ${fmt(x.valueUsdt)} USDT</div>`).join(''):'<div class="mini">אין יתרות להצגה.</div>';}catch(e){put('#liveConnected','שגיאה');put('#liveTotalValue','—');put('#liveUsdt','—');put('#liveCanTrade','—');put('#liveAccountType','—');$('#liveBalances').innerHTML='<div class="mini">'+e.message+'</div>';}}
async function load(){try{put('#status','מתחבר…');const m=await J(MODE);mode(m);render(await J(AGENT));if(m.mode==='live')await loadLiveAccount();await loadActionJournal(m.mode)}catch(e){put('#status','שרת לא זמין');console.error(e)}}async function setMode(m){try{const cur=await J(MODE);if(cur.mode===m)return load();if(m==='live'&&!confirm('לעבור ל-LIVE?'))return;await J(MODE,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});load()}catch(e){alert(e.message)}}$('#demoBtn').onclick=()=>setMode('demo');$('#liveBtn').onclick=()=>setMode('live');$('#refreshBtn').onclick=async()=>{
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
