// Scheduling hints only. Every entry still runs the ordinary policy and final guard.
export const POC_FAST_WATCH_POLICY=Object.freeze({version:'POC_FAST_WATCH_V1',intervalMs:2000,maxEvidenceAgeMs:600000,fastTurns:3});
const transient=/^(WAIT_FRESH_(?:FUTURES_)?PRICE|WAIT_(?:CHANNEL|FUTURES)_LIVE_BAR|(?:GAPPED|WAIT)_(?:CHANNEL|FUTURES)_HISTORY)$/;
const validSymbol=s=>typeof s==='string'&&/^[A-Z][A-Z0-9.-]{0,30}$/.test(s);
export class PocFastWatch {
 constructor(state={},now=Date.now){this.now=now;this.state=state?.version===POC_FAST_WATCH_POLICY.version&&state.rows&&typeof state.rows==='object'&&!Array.isArray(state.rows)?state:{version:POC_FAST_WATCH_POLICY.version,rows:{},turn:0};}
 observe(symbol,result,at=this.now()){
  if(!validSymbol(symbol))return;
  const reports=result?.conditionReports?Object.values(result.conditionReports):[result?.conditions];
  const candidates=reports.filter(r=>r?.version==='CHANNEL_POC_CONDITIONS_V1'&&['LONG','SHORT'].includes(r.side)&&Number.isFinite(r.at)&&r.at<=at&&at-r.at<15000&&Array.isArray(r.rows)&&['channel','break','range'].every(id=>r.rows.filter(x=>x.id===id&&x.state==='passed').length===1)&&['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(r.model?.version)&&r.model.side===r.side&&r.model.consolidation?.passed===true&&r.model.channel?.lowTouches>=2&&r.model.channel?.highTouches>=2&&r.model.frozenAt<=at&&Number.isFinite(r.model.profile?.poc)&&r.model.profile.poc>0);
  if(candidates.length){const old=this.state.rows[symbol];this.state.rows[symbol]={at:Math.min(...candidates.map(r=>r.at)),lastPollAt:old?.lastPollAt||0,sides:candidates.map(r=>({side:r.side,poc:r.model.profile.poc,modelId:r.model.id}))};}
  else if(!transient.test(result?.reason||''))delete this.state.rows[symbol];
 }
 list(symbols,now=this.now()){
  const allow=new Set(symbols);
  for(const [s,r]of Object.entries(this.state.rows))if(!allow.has(s)||!Number.isFinite(r.at)||r.at>now||now-r.at>=POC_FAST_WATCH_POLICY.maxEvidenceAgeMs||!Array.isArray(r.sides)||!r.sides.length)delete this.state.rows[s];
  return Object.entries(this.state.rows).sort((a,b)=>(a[1].lastPollAt||0)-(b[1].lastPollAt||0)||a[0].localeCompare(b[0])).map(([symbol,r])=>({symbol,...r}));
 }
 take(symbols,eligible=()=>true){
  const now=this.now(),row=this.list(symbols,now).find(r=>now-(r.lastPollAt||0)>=POC_FAST_WATCH_POLICY.intervalMs&&(Math.floor(now/300000)>Math.floor(r.at/300000)||eligible(r)));
  if(!row)return null;this.state.rows[row.symbol].lastPollAt=now;return row.symbol;
 }
 remove(symbol){delete this.state.rows[symbol];}
 snapshot(symbols){return {policy:POC_FAST_WATCH_POLICY,candidates:this.list(symbols).map(({symbol,at,lastPollAt})=>({symbol,at,lastPollAt})),lastResult:this.state.lastResult||null,lastCheckedAt:this.state.lastCheckedAt||null};}
}
// Bounded, single-flight fast lane. A slow network response cannot overlap another lane cycle.
export function createPocFastLane({watch,symbols,enabled,eligible,evaluate,execute,now=Date.now}){
 let busy=false;
 return {async tick(){if(busy||!enabled())return;busy=true;try{
  const symbol=watch.take(symbols(),eligible);if(!symbol)return;
  const result=await evaluate(symbol);watch.state.lastCheckedAt=now();watch.state.lastResult=result?.buyReason||result?.reason||'EVALUATION_UNAVAILABLE';
  if(result?.ok&&result.entryConfirmed&&enabled()&&symbols().includes(symbol))await execute([result]);
 }finally{busy=false;}}};
}
