import {binanceExitPolicy} from './binance-position-exit.mjs';
export const LIVE_DUST_THRESHOLD_USDT=5;
// Separate sold remainders from open trades without deleting wallet/accounting history.
export function livePositionLedger(actions){
 const positions={},dust={};
 for(const a of [...actions].reverse()){
  if(!(Number(a.qty)>0))continue;
  if(a.type==='BUY'&&a.wyckoffTrade){
   const carry=Number(dust[a.symbol]?.qty||0);
   positions[a.symbol]={...a.wyckoffTrade,qty:Number(a.qty)+carry,carriedDustQty:carry,entryPrice:a.price,peakPrice:Math.max(Number(a.price),Number(a.wyckoffTrade.peakPrice)||0)};
   delete dust[a.symbol];
  }
  if(a.type==='SELL'&&positions[a.symbol]){
   const p=positions[a.symbol];p.qty=Math.max(0,p.qty-Number(a.qty));
   if(p.qty<=1e-10){delete positions[a.symbol];continue;}
   const price=Number(a.price||p.entryPrice);
   const threshold=Math.max(LIVE_DUST_THRESHOLD_USDT,Number(a.dustThresholdUsdt)||0);
   if(Number.isFinite(price)&&price>0&&p.qty*price<threshold){
    dust[a.symbol]={qty:p.qty,valueAtSaleUsdt:p.qty*price,closedAt:a.at||null,reason:'SOLD_REMAINDER',thresholdUsdt:threshold};
    delete positions[a.symbol];
   }
  }else if(a.type==='SELL'&&dust[a.symbol]){
   dust[a.symbol].qty=Math.max(0,dust[a.symbol].qty-Number(a.qty));
   if(dust[a.symbol].qty<=1e-10)delete dust[a.symbol];
  }
 }
 return {positions,dust};
}
export function trackedLivePositions(actions){
 return livePositionLedger(actions).positions;
}
export function liveFillAction(order,intent,fills){
 const gross=Number(order.executedQty),amount=Number(order.cummulativeQuoteQty),price=amount/gross;
 if(!(gross>0)||!(price>0))throw Error('INVALID_LIVE_FILL');
 const base=intent.params.symbol.slice(0,-4),fee=fills.reduce((n,f)=>n+(f.commissionAsset===base?Number(f.commission):0),0);
 const qty=intent.params.side==='BUY'?gross-fee:gross+fee;
 if(!(qty>0)||!Number.isFinite(qty))throw Error('INVALID_LIVE_FILL_FEE');
 const meta={...(intent.meta||{})};if(meta.wyckoffTrade)meta.wyckoffTrade={...meta.wyckoffTrade,entryPrice:price,peakPrice:price,stopLossPct:binanceExitPolicy(meta.wyckoffTrade.marketRank).stopLossPct,stopPrice:price*(1-binanceExitPolicy(meta.wyckoffTrade.marketRank).stopLossPct/100)};
 return {type:intent.params.side,symbol:intent.params.symbol,price,amountUsdt:amount,commissions:Object.entries(fills.reduce((a,f)=>{if(f.commissionAsset&&Number(f.commission)>0)a[f.commissionAsset]=(a[f.commissionAsset]||0)+Number(f.commission);return a;},{})).map(([asset,amount])=>({asset,amount})),quoteFeeUsdt:fills.reduce((n,f)=>n+(f.commissionAsset==='USDT'?Number(f.commission):0),0),qty,executedQty:gross,reason:intent.reason,orderId:order.orderId,status:order.status,at:intent.at,...meta};
}

// Actions are newest first. Only report P/L when recorded quantity matches the wallet.
export function liveBalancePnl(balance, actions) {
 const symbol=balance.asset+'USDT';let qty=0,cost=0;
 for(const a of [...actions].reverse()){
  if(a.symbol!==symbol||!(Number(a.qty)>0))continue;
  const amount=Number(a.amountUsdt??Number(a.price)*Number(a.qty));
  if(a.type==='BUY'&&amount>0){qty+=Number(a.qty);cost+=amount+Number(a.quoteFeeUsdt||0);}
  else if(a.type==='SELL'&&qty>0){const remaining=Math.max(0,qty-Number(a.qty));cost*=remaining/qty;qty=remaining;}
 }
 const unknown={pnlIls:null,pnlPct:null};
 if(!(qty>0)||!(cost>0)||Math.abs(qty-Number(balance.qty))>Math.max(1e-8,qty*1e-6)||!(Number(balance.usdtPrice)>0))return unknown;
 const pnl=Number(balance.valueUsdt)-cost;
 return {entryPrice:cost/qty,allocationIls:cost,pnlIls:pnl,pnlPct:pnl/cost*100};
}
