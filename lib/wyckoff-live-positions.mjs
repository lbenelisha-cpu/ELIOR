export function trackedLivePositions(actions){
 const positions={};
 for(const a of [...actions].reverse()){
  if(!(Number(a.qty)>0))continue;
  if(a.type==='BUY'&&a.wyckoffTrade)positions[a.symbol]={...a.wyckoffTrade,qty:Number(a.qty),entryPrice:a.price};
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
 const meta={...(intent.meta||{})};if(meta.wyckoffTrade)meta.wyckoffTrade={...meta.wyckoffTrade,stopPrice:price*.94};
 return {type:intent.params.side,symbol:intent.params.symbol,price,amountUsdt:amount,qty,executedQty:gross,reason:intent.reason,orderId:order.orderId,status:order.status,at:intent.at,...meta};
}
