// Presentation only: existing wallet and accounting snapshots, no exchange access.
import {accountSummary, finite} from './binance-dashboard-math.mjs';
const day = at => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
const current = (at, now, max) => finite(at)!==null && at>0 && at<=now+1000 && now-at<=max;
export function terminalView(snapshot, report, now=Date.now()) {
  const fresh=!!snapshot && !snapshot.error && !snapshot.unauthorized && current(snapshot.receivedAt,now,60000);
  const summary=fresh?accountSummary(snapshot):null;
  const positions=(summary?.positions||[]).map(p=>({
    symbol:p.symbol,qty:finite(p.qty),entry:finite(p.entryPrice),price:finite(p.usdtPrice??p.currentPrice),
    value:finite(p.valueUsdt),pnl:finite(p.pnlIls),pct:finite(p.pnlPct),
    weight:!summary.partial && summary.total>0 && finite(p.valueUsdt)!==null ? p.valueUsdt/summary.total*100 : null
  }));
  const reportReady=fresh && snapshot.mode==='live' && report?.ok===true && Array.isArray(report.rows) && current(report.asOf,now,120000);
  const rows=reportReady?report.rows.filter(r=>Number.isFinite(r.closedAt)&&r.closedAt>0&&r.closedAt<=now&&['LONG','SHORT'].includes(r.direction)).slice().sort((a,b)=>b.closedAt-a.closedAt):[];
  const today=rows.filter(r=>day(r.closedAt)===day(now)),known=today.filter(r=>Number.isFinite(r.netPnlUsdt));
  const partial=reportReady && (!!report.issues?.length || !!report.loadingShort || known.length<today.length);
  return {fresh,summary,positions,reportReady,partial,reportAt:reportReady?report.asOf:null,
    todayCount:reportReady?today.length:null,
    todayNet:reportReady && known.length?known.reduce((sum,r)=>sum+r.netPnlUsdt,0):null,
    knownCount:known.length,closed:rows.slice(0,6)};
}
