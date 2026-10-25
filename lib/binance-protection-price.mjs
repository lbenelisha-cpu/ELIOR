import {requireLivePrice} from './binance-live-price.mjs';

// A current REST ticker can arm protection while trade events are quiet.
// This reader is deliberately separate from entry/market-sale price gates.
export async function protectionPrice(symbol, stream, read, now=Date.now){
 if(!/^[A-Z0-9]+USDT$/.test(symbol))throw Error('NATIVE_PROTECTION_SYMBOL_INVALID');
 try{return requireLivePrice(stream,now(),15000);}catch{}
 const started=now();
 const ticker=await read('/api/v3/ticker/24hr?symbol='+encodeURIComponent(symbol));
 const ended=now(),age=ended-Number(ticker?.closeTime);
 const price=Number(ticker?.lastPrice),bid=Number(ticker?.bidPrice),ask=Number(ticker?.askPrice);
 if(ticker?.symbol!==symbol||![price,bid,ask].every(v=>Number.isFinite(v)&&v>0)||bid>ask||
    !Number.isFinite(age)||age< -5000||age>15000||ended-started<0||ended-started>15000){
  throw Error('NATIVE_PROTECTION_FRESH_QUOTE_REQUIRED');
 }
 return price;
}
