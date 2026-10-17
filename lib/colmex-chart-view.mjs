const dayKey=b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)?b.date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(b.date));
// Market closures do not consume the window: show the last two actual trading dates.
export function lastTwoTradingDays(bars,interval='5min'){
 if(!Array.isArray(bars)||!bars.length)return [];
 if(['1week','1month'].includes(interval))return [];
 const days=[...new Set(bars.map(dayKey))].sort().slice(-2),allowed=new Set(days);
 return bars.filter(b=>allowed.has(dayKey(b)));
}
export function startCandleFlashing({root,control,doc=globalThis.document,schedule=globalThis.setInterval}){
 const reset=()=>root.classList.remove('candle-phase-off');
 control.addEventListener('change',reset);
 doc.addEventListener('visibilitychange',reset);
 return schedule(()=>{
  if(doc.hidden||!control.checked||!root.querySelector('.sim-candle-flash')){reset();return;}
  root.classList.toggle('candle-phase-off');
 },650);
}
