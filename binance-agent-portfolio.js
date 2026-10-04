
async function refreshPortfolioPositions(){
  try{
    const base = window.API_BASE || 'https://binance-wave-agent.onrender.com';
    const r = await fetch(base + '/api/binance-agent',{cache:'no-store'});
    const d = await r.json();
    const body=document.querySelector('#activePositionsBody');
    if(!body)return;
    const ps=Object.entries(d.paper?.positions||{});
    if(!ps.length){body.innerHTML='<tr><td colspan="7">אין פוזיציות פעילות.</td></tr>';return;}
    const n=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('he-IL',{maximumFractionDigits:2}):'—';
    body.innerHTML=ps.map(([sym,p])=>{
      const pnl=Number(p.pnlIls||0),sgn=pnl>=0?'+':'';
      return `<tr><td><b>${sym}</b></td><td>${n(p.entryPrice)}</td><td>${n(p.currentPrice)}</td><td>₪ ${n(p.allocationIls)}</td><td>₪ ${n(p.currentValueIls)}</td><td>${sgn}₪ ${n(p.pnlIls)}</td><td>${sgn}${n(p.pnlPct)}%</td></tr>`;
    }).join('');
  }catch{}
}
refreshPortfolioPositions();
setInterval(refreshPortfolioPositions,30000);
