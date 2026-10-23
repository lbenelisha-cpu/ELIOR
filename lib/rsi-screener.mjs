import {rsiSeries} from './wyckoff-spring-rsi.mjs';

// Display data only. This never grants entry eligibility or changes a trade.
export function rsiSnapshot(bars,live=null){
 const rows=(bars||[]).filter(b=>Number.isFinite(Number(b.close))&&Number(b.close)>0);
 const livePrice=Number(live?.close),liveTime=Number(live?.observedAt);
 const lastTime=Number(rows.at(-1)?.closeTime||Date.parse(rows.at(-1)?.date)||0);
 const adjacent=Math.floor(liveTime/300000)*300000-lastTime;
 const useLive=rows.length>0&&adjacent>=0&&adjacent<=1&&livePrice>0&&Number.isFinite(liveTime)&&liveTime>Number(rows.at(-1)?.closeTime||Date.parse(rows.at(-1)?.date)||0);
 const closes=rows.map(b=>Number(b.close));if(useLive)closes.push(livePrice);
 const value=rsiSeries(closes).at(-1)??null;
 const at=useLive?liveTime:Number(rows.at(-1)?.closeTime||Date.parse(rows.at(-1)?.date));
 return {value,at:Number.isFinite(at)?at:null,timeframe:'5m',period:14,includesOpenCandle:useLive};
}
export function screenRsiRows(rows,{min=0,max=100,order='asc',now=Date.now()}={}){
 return rows.filter(row=>typeof row.rsi?.value==='number'&&Number.isFinite(row.rsi.value)&&row.rsi.value>=min&&row.rsi.value<=max)
  .map(row=>({...row,old:row.old===true||!Number.isFinite(row.rsi.at)||row.rsi.at>now+60000||now-row.rsi.at>900000}))
  .sort((a,b)=>(order==='desc'?-1:1)*(a.rsi.value-b.rsi.value)||a.symbol.localeCompare(b.symbol));
}
