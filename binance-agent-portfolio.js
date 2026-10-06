
async function refreshPortfolioPositions(){
  try{
    const base = window.API_BASE || 'https://binance-wave-agent.onrender.com';
    const r = await fetch(base + '/api/binance-agent',{cache:'no-store'});
    const d = await r.json();
    const body=document.querySelector('#activePositionsBody');
    if(!body)return;
    const currency=d.paper?.currency||'₪';
    const ps=Object.entries(d.paper?.positions||{});
    if(!ps.length){body.innerHTML='<tr><td colspan="7">אין פוזיציות פעילות.</td></tr>';return;}
    const n=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('he-IL',{maximumFractionDigits:2}):'—';
    const price=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v).toLocaleString('he-IL',{maximumSignificantDigits:8}):'—';
    body.innerHTML=ps.map(([sym,p])=>{
      const known=p.pnlIls!==null&&p.pnlIls!==undefined&&p.pnlIls!==''&&Number.isFinite(Number(p.pnlIls));
      const pnl=known?Number(p.pnlIls):null,sgn=pnl>0?'+':'';
      const cls=!known?'pnl-unknown':pnl>0?'pnl-profit':pnl<0?'pnl-loss':'pnl-flat';
      return `<tr><td><b>${sym}</b></td><td>${price(p.entryPrice)}</td><td>${price(p.currentPrice)}</td><td>${currency} ${n(p.allocationIls)}</td><td>${currency} ${n(p.currentValueIls)}</td><td class="${cls}">${known?sgn+currency+' '+n(pnl):'—'}</td><td class="${cls}">${known&&p.pnlPct!=null?((Number(p.pnlPct)>0?'+':'')+n(p.pnlPct)+'%'):'—'}</td></tr>`;
    }).join('');
  }catch{}
}
refreshPortfolioPositions();
setInterval(refreshPortfolioPositions,30000);
