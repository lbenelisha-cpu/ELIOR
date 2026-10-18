export const HOURLY_TREND_RULE=Object.freeze({enabled:true,timeframe:'1h',fastSma:20,slowSma:50,closedOnly:true});
const HOUR=3600000,STEP=300000;
// Derive exactly the last 50 completed UTC hours from the existing 5m feed.
// A partial hour, stale history or missing/duplicate candle cannot approve entry.
export function assessHourlyTrend(bars,{now=Date.now()}={}){
 const end=Math.floor(now/HOUR)*HOUR,start=end-50*HOUR;
 const base={...HOURLY_TREND_RULE,asOf:Number.isFinite(end)?new Date(end-1).toISOString():null};
 const missing=()=>({...base,ok:false,code:'WAIT_HOURLY_TREND_DATA',close:null,sma20:null,sma50:null});
 if(!Array.isArray(bars)||!Number.isFinite(now))return missing();
 const rows=bars.filter(b=>Number(b.openTime)>=start&&Number(b.openTime)<end);
 if(rows.length!==600)return missing();
 const closes=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],expected=start+i*STEP;
  if(row.closed===false||Number(row.openTime)!==expected||Number(row.closeTime)!==expected+STEP-1||!(Number(row.close)>0)||!Number.isFinite(Number(row.close)))return missing();
  if(i%12===11)closes.push(Number(row.close));
 }
 const close=closes.at(-1),sma20=closes.slice(-20).reduce((n,v)=>n+v,0)/20,sma50=closes.reduce((n,v)=>n+v,0)/50;
 const aboveSma20=close>sma20,fastAboveSlow=sma20>sma50,ok=aboveSma20&&fastAboveSlow;
 return {...base,ok,code:ok?'HOURLY_TREND_CONFIRMED':'WAIT_HOURLY_TREND',close,sma20,sma50,aboveSma20,fastAboveSlow};
}
