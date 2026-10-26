import {binanceExitPolicy,binanceInitialExitPolicy} from './binance-position-exit.mjs';
import {FIXED_EXIT_POLICY,applyFixedExitPolicy} from './fixed-trade-exit.mjs';
import {TRAILING_EXIT_POLICY,isTrailingExitPolicy,applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
export const LIVE_DUST_THRESHOLD_USDT=5;
// Separate sold remainders from open trades without deleting wallet/accounting history.
export function livePositionLedger(actions){
 const positions={},dust={};
 for(const a of [...actions].reverse()){
  if(a.type==='POSITION_RECONCILIATION'){
   const p=positions[a.symbol];
   if(p&&p.entryAt===a.entryAt&&Number.isFinite(a.qty)&&a.qty>=0&&a.qty<p.qty){
    if(a.qty===0||a.archiveAsDust===true)delete positions[a.symbol];
    else Object.assign(p,{qty:a.qty,accountingReconciledAt:a.at});
    delete dust[a.symbol];
    if(a.archiveAsDust===true&&a.qty>0)dust[a.symbol]={qty:a.qty,valueAtSaleUsdt:null,valueAtReconciliationUsdt:a.qty*Number(a.price),closedAt:a.at,reason:'RECONCILED_REMAINDER',thresholdUsdt:5};
   }
   continue;
  }
  if(!(Number(a.qty)>0))continue;
  if(a.type==='BUY'&&a.wyckoffTrade){
   const carry=a.replaceWalletQuantity?0:Number(dust[a.symbol]?.qty||0);
   positions[a.symbol]={...a.wyckoffTrade,qty:Number(a.qty)+carry,carriedDustQty:carry,entryAt:a.at||a.wyckoffTrade.entryAt,entryPrice:a.price,peakPrice:Math.max(Number(a.price),Number(a.wyckoffTrade.peakPrice)||0)};
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
 const meta={...(intent.meta||{})};if(meta.wyckoffTrade){meta.wyckoffTrade={...meta.wyckoffTrade,entryPrice:price,peakPrice:price,peakAt:new Date().toISOString(),stopLossPct:binanceInitialExitPolicy(meta.wyckoffTrade).stopLossPct,stopPrice:price*(1-binanceInitialExitPolicy(meta.wyckoffTrade).stopLossPct/100)};
  if(meta.wyckoffTrade.exitPolicy===FIXED_EXIT_POLICY)applyFixedExitPolicy(meta.wyckoffTrade);
  if(isTrailingExitPolicy(meta.wyckoffTrade.exitPolicy)){
   // A new fill starts its own high-water mark at actual execution, not intent.
   if(intent.params.side==='BUY')Object.assign(meta.wyckoffTrade,{effectiveStopPrice:null,profitFloorArmed:false});
   applyTrailingExitPolicy(meta.wyckoffTrade);
  }
  if(meta.wyckoffTrade.minProfitHoldMs>0)meta.wyckoffTrade.profitHoldStartedAt=Number(order.transactTime||order.updateTime)>0?new Date(Number(order.transactTime||order.updateTime)).toISOString():intent.at;
 }
 return {type:intent.params.side,symbol:intent.params.symbol,price,amountUsdt:amount,commissions:Object.entries(fills.reduce((a,f)=>{if(f.commissionAsset&&Number(f.commission)>0)a[f.commissionAsset]=(a[f.commissionAsset]||0)+Number(f.commission);return a;},{})).map(([asset,amount])=>({asset,amount})),quoteFeeUsdt:fills.reduce((n,f)=>n+(f.commissionAsset==='USDT'?Number(f.commission):0),0),qty,executedQty:gross,reason:intent.reason,orderId:order.orderId,status:order.status,at:intent.at,...meta};
}

// Actions are newest first. Only report P/L when recorded quantity matches the wallet.
export function liveBalancePnl(balance, actions) {
 const symbol=balance.asset+'USDT',unknown={pnlIls:null,pnlPct:null};
 if(!(Number(balance.qty)>0)||!(Number(balance.usdtPrice)>0))return unknown;
 const ordered=[...actions].reverse();
 function replay(start){
  let qty=0,cost=0,known=true;
  for(let i=start;i<ordered.length;i++){
   const a=ordered[i];
   if(a.symbol===symbol&&a.type==='POSITION_RECONCILIATION'){qty=Number(a.qty);known=false;continue;}
   if(a.symbol===symbol&&Number(a.qty)>0){
    const amount=Number(a.amountUsdt??Number(a.price)*Number(a.qty));
    if(a.type==='BUY'&&amount>0){if(a.replaceWalletQuantity||qty===0){qty=0;cost=0;known=true;}qty+=Number(a.qty);cost+=amount+Number(a.quoteFeeUsdt||0);}
    else if(a.type==='SELL'&&qty>0){const remaining=Math.max(0,qty-Number(a.qty));cost*=remaining/qty;qty=remaining;}
   }else if(qty>0){
    // Fees paid in this asset on another pair reduce its wallet quantity too.
    const fee=(a.commissions||[]).filter(f=>f.asset===balance.asset).reduce((n,f)=>n+Math.max(0,Number(f.amount)||0),0);
    if(fee>0){const remaining=Math.max(0,qty-fee);cost*=remaining/qty;qty=remaining;}
   }
  }
  if(!known||!(qty>0)||!(cost>0)||Math.abs(qty-Number(balance.qty))>Math.max(1e-8,qty*1e-6))return null;
  const pnl=Number(balance.valueUsdt)-cost;
  return {entryPrice:cost/qty,allocationIls:cost,pnlIls:pnl,pnlPct:pnl/cost*100};
 }
 const full=replay(0);if(full)return full;
 // A verified latest buy can anchor a new holding after old dust was removed
 // outside the bot. Require an exact wallet match; never guess an entry cost.
 const latestBuy=ordered.findLastIndex(a=>a.symbol===symbol&&a.type==='BUY'&&Number(a.qty)>0);
 return latestBuy>0?(replay(latestBuy)||unknown):unknown;
}
