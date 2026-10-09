import {evaluateWyckoff} from './wyckoff-strategy.mjs';
export function brokerDailyQuotes(items,now=Date.now()){
 const quotes={},blocked=[];
 for(const [symbol,item]of Object.entries(items||{})){
  try{
   if(!Array.isArray(item.dailyBars)||item.dailyBars.length<3)throw Error('WAIT_DAILY_BARS');
   if(!Number.isFinite(item.tickTime)||Math.abs(now/1000-item.tickTime)>90||!Number.isFinite(item.ask)||!Number.isFinite(item.bid)||item.bid<=0||item.ask<item.bid)throw Error('WAIT_FRESH_PRICE');
   const bars=[...item.dailyBars].sort((a,b)=>a.closeTime-b.closeTime);
   const s=evaluateWyckoff(bars,{now});
   if(now-s.time>4*86400000)throw Error('STALE_DAILY_HISTORY');
   const buyConfirmed=s.buyConfirmed&&item.ask>s.firstLow.price&&item.ask<s.targetPrice;
   quotes[symbol]={price:item.bid,timeframe:'1d',wyckoff:{...s,buyConfirmed}};
  }catch(e){blocked.push({symbol,reason:e.message});}
 }
 return {quotes,blocked};
}
export function validateBrokerDailyBars(rows,capturedAt){
 if(rows==null)return undefined;
 if(!Array.isArray(rows)||rows.length>500)throw Error('Invalid daily bar count');
 const normalized=rows.map(r=>({closeTime:Number(r.closeTime),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),timeframe:'1d',closed:true})).sort((a,b)=>a.closeTime-b.closeTime);
 if(normalized.length)evaluateWyckoff(normalized,{now:capturedAt*1000});
 return normalized;
}
export function dailyBrokerAnalysis(legacy,items,now){
 const daily=brokerDailyQuotes(items,now),allowed=new Set(legacy.stockSymbols||Object.keys(items||{}));
 const candidates=Object.entries(daily.quotes).filter(([symbol])=>allowed.has(symbol)&&items[symbol].tradeAllowed).map(([symbol,d])=>{
  const x=items[symbol];return {symbol,description:x.description,bid:x.bid,ask:x.ask,profitMode:x.profitMode,contractSize:x.contractSize,tickSize:x.tickSize,tickValue:x.tickValue,minLot:x.minLot,lotStep:x.lotStep,spreadPercent:100*(x.ask-x.bid)/x.bid,master:d.wyckoff.buyConfirmed?100:0,market:50,trend:50,risk:50,momentum:50,signal:d.wyckoff.buyConfirmed?'וויקוף: קנייה':'וויקוף: המתנה',wyckoff:d.wyckoff,timeframe:'1d',barTime:d.wyckoff.time/1000};
 }).sort((a,b)=>b.master-a.master||a.symbol.localeCompare(b.symbol));
 return {...legacy,candidates,blocked:daily.blocked.filter(x=>allowed.has(x.symbol)),dailyBlocked:daily.blocked,barTime:Math.floor(now/86400000)*86400,complete:candidates.length>0,universeId:'WYCKOFF_D1',strategy:'WYCKOFF_D1_V1'};
}
