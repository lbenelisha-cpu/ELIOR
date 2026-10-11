export function trackedLivePositions(actions){
 const positions={};
 for(const a of [...actions].reverse()){
  if(!(Number(a.qty)>0))continue;
  if(a.type==='BUY'&&a.wyckoffTrade)positions[a.symbol]={...a.wyckoffTrade,qty:Number(a.qty),entryPrice:a.price,peakPrice:Math.max(Number(a.price),Number(a.wyckoffTrade.peakPrice)||0)};
  if(a.type==='SELL'&&positions[a.symbol]){positions[a.symbol].qty-=Number(a.qty);if(positions[a.symbol].qty<=1e-10)delete positions[a.symbol];}
 }
 return positions;
}
export function liveFillAction(order,intent,fills){
 const gross=Number(order.executedQty),amount=Number(order.cummulativeQuoteQty),price=amount/gross;
 if(!(gross>0)||!(price>0))throw Error('INVALID_LIVE_FILL');
 const base=intent.params.symbol.slice(0,-4),fee=fills.reduce((n,f)=>n+(f.commissionAsset===base?Number(f.commission):0),0);
 const qty=intent.params.side==='BUY'?gross-fee:gross+fee;
 if(!(qty>0)||!Number.isFinite(qty))throw Error('INVALID_LIVE_FILL_FEE');
 const meta={...(intent.meta||{})};if(meta.wyckoffTrade)meta.wyckoffTrade={...meta.wyckoffTrade,entryPrice:price,peakPrice:price,stopLossPct:2,stopPrice:price*.98};
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
