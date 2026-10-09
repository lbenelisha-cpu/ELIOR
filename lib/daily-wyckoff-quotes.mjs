import {td} from './agent.mjs';
import {evaluateWyckoff} from './wyckoff-strategy.mjs';
export async function liveWyckoffQuote(symbol,{now=Date.now(),loader=td}={}){
 const quote=await loader('price',{symbol},60),price=Number(quote.price),asOf=Date.parse(quote.cached_at);
 if(!(price>0)||!Number.isFinite(price)||!Number.isFinite(asOf)||now-asOf>90000||asOf>now+5000)throw Error('WAIT_FRESH_PRICE');
 return {price,updated_at:new Date(asOf).toISOString().replace('T',' ').replace('Z',''),priceAsOf:new Date(asOf).toISOString(),timeframe:'1d',master:0,market:50,trend:50,risk:50,momentum:50};
}
export async function dailyWyckoffQuote(symbol,{now=Date.now(),loader=td}={}){
 const [series,quote]=await Promise.all([loader('time_series',{symbol,interval:'1day',outputsize:500,order:'ASC',timezone:'UTC'},86400),liveWyckoffQuote(symbol,{now,loader})]);
 const today=new Date(now).toISOString().slice(0,10);
 const bars=(series.values||[]).map(r=>({date:String(r.datetime).slice(0,10),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close)})).filter(b=>b.date<today).sort((a,b)=>a.date.localeCompare(b.date));
 const strategy=evaluateWyckoff(bars,{now});
 const price=quote.price,asOf=Date.parse(quote.priceAsOf);
 if(now-strategy.time>7*86400000)throw Error('STALE_DAILY_HISTORY');
 const buyConfirmed=strategy.buyConfirmed&&now-strategy.time<=4*86400000&&price>strategy.firstLow.price&&price<strategy.targetPrice;
 return {price,updated_at:new Date(asOf).toISOString().replace('T',' ').replace('Z',''),priceAsOf:new Date(asOf).toISOString(),
  timeframe:'1d',wyckoff:{...strategy,buyConfirmed},market:50,trend:50,risk:50,momentum:50,master:buyConfirmed?100:0,signal:buyConfirmed?'וויקוף: קנייה':'וויקוף: המתנה'};
}
