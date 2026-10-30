import {liveBalancePnl} from './wyckoff-live-positions.mjs';

export function accountTradeActions(symbol,trades){
 if(!Array.isArray(trades))throw Error('INVALID_TRADE_HISTORY');
 const base=symbol.slice(0,-4);
 return [...trades].sort((a,b)=>Number(b.time)-Number(a.time)||Number(b.id)-Number(a.id)).map(t=>{
  const gross=Number(t.qty),amount=Number(t.quoteQty),fee=Number(t.commission||0);
  if(t.symbol!==symbol||typeof t.isBuyer!=='boolean'||!(gross>0)||!(amount>0)||!Number.isFinite(fee)||fee<0||!Number.isFinite(Number(t.time)))throw Error('INVALID_TRADE_HISTORY');
  const orderId=t.orderId==null?null:String(t.orderId);
  if(orderId!==null&&(!/^\d+$/.test(orderId)||typeof t.orderId==='number'&&!Number.isSafeInteger(t.orderId)))throw Error('INVALID_TRADE_ORDER_ID');
  const qty=t.isBuyer?gross-(t.commissionAsset===base?fee:0):gross+(t.commissionAsset===base?fee:0);
  return {symbol,...(orderId===null?{}:{orderId}),type:t.isBuyer?'BUY':'SELL',qty,amountUsdt:amount,quoteFeeUsdt:t.commissionAsset==='USDT'?fee:0,
   price:amount/gross,at:new Date(Number(t.time)).toISOString(),commissions:fee?[{asset:t.commissionAsset,amount:fee}]:[]};
 });
}

// Display-only enrichment. Background GETs never mutate the execution journal,
// enroll external holdings, or hold up the account response.
export function createExternalCostReader({fetchTrades,now=Date.now,ttlMs=60000,maxPending=2}){
 const cache=new Map(),pending=new Set();
 function decorate(account){
  if(!account?.connected)return account;
  return {...account,balances:(account.balances||[]).map(balance=>{
   if(['USDT','USDC'].includes(balance.asset)||!(balance.valueUsdt>=5)||Number.isFinite(balance.pnlIls)&&balance.pnlIls!==null)return balance;
   const symbol=balance.asset+'USDT';if(!/^[A-Z0-9]+USDT$/.test(symbol))return balance;
   const old=cache.get(symbol),qty=Number(balance.qty),time=now();
   if((!old||old.qty!==qty||time-old.at>=ttlMs)&&!pending.has(symbol)&&pending.size<maxPending){
    pending.add(symbol);
    Promise.resolve().then(()=>fetchTrades(symbol)).then(trades=>{
     cache.delete(symbol);cache.set(symbol,{qty,at:now(),actions:accountTradeActions(symbol,trades)});
     if(cache.size>64)cache.delete(cache.keys().next().value);
    }).catch(()=>{cache.set(symbol,{qty,at:now(),error:true});}).finally(()=>pending.delete(symbol));
   }
   if(old?.qty===qty&&old.actions){
    const pnl=liveBalancePnl(balance,old.actions);
    if(pnl.pnlIls!==null)return {...balance,...pnl,costSource:'BINANCE_MY_TRADES',costObservedAt:new Date(old.at).toISOString(),costMethod:'WEIGHTED_AVERAGE_REMAINING',costStatus:'VERIFIED_QUANTITY'};
   }
   return {...balance,costStatus:pending.has(symbol)?'LOADING_HISTORY':old?.error?'HISTORY_UNAVAILABLE':'QUANTITY_NOT_RECONCILED'};
  })};
 }
 return {decorate};
}
