import {rsiSeries} from './wyckoff-spring-rsi.mjs';
export function currentRsiValue(bars,live=null,{now=Date.now(),marketClosed=false,isSessionGap=()=>false,maxAgeMs=90000}={}){
 const rows=(bars||[]).filter(b=>Number(b.close)>0&&Number.isFinite(Number(b.close))).map(b=>({close:Number(b.close),end:Number(b.closeTime)||Date.parse(b.date)+300000})).filter(b=>Number.isFinite(b.end)&&b.end<=now);
 const closes=rows.map(b=>b.close),at=Number(live?.observedAt),bucket=Math.floor(at/300000)*300000,last=rows.at(-1)?.end,gap=bucket-last;
 const useLive=!marketClosed&&Number.isFinite(at)&&at<=now&&now-at<=maxAgeMs&&Number(live?.close)>0&&Number.isFinite(Number(live?.close))&&Number.isFinite(last)&&((gap>=0&&gap<=1)||(gap>1&&isSessionGap(last,bucket)));
 if(useLive)closes.push(Number(live.close));const series=rsiSeries(closes);return {value:series.at(-1)??null,at:useLive?at:last??null,live:useLive,series,closes};
}
