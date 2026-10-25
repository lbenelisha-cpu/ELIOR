import {orderHasFill} from './order-has-fill.mjs';
export function buildNetTradeJournal(actions){
 const inventory=new Map(),seen=new Set(),rows=[];
 const fees=a=>{if(!Array.isArray(a.commissions))return {quote:0,known:false};const base=String(a.symbol||'').replace(/USDT$/,'');return {quote:a.commissions.reduce((n,f)=>n+(f.asset==='USDT'?Number(f.amount)||0:0),0),known:a.commissions.every(f=>['USDT',base].includes(f.asset)&&Number.isFinite(Number(f.amount))&&Number(f.amount)>=0)};};
 for(const a of [...(actions||[])].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))){
  if(a.type==='POSITION_RECONCILIATION'){
   const p=inventory.get(a.symbol);
   if(p&&p.entryAt===a.entryAt&&Number.isFinite(a.qty)&&a.qty>=0&&a.qty<p.qty){
    if(a.qty===0)inventory.delete(a.symbol);
    else{const ratio=a.qty/p.qty;p.cost*=ratio;p.buyFees=p.buyFees.map(f=>({...f,amount:Number(f.amount)*ratio}));p.qty=a.qty;p.known=false;}
   }
   continue;
  }
  const qty=Number(a.qty),amount=Number(a.amountUsdt??a.amountIls);if(!orderHasFill(a,{adopted:true})||!Number.isFinite(amount))continue;
  const id=a.orderId==null?null:a.symbol+':'+a.type+':'+a.orderId;if(id&&seen.has(id))continue;if(id)seen.add(id);
  const f=fees(a);
  if(a.type==='BUY'){
   const previous=a.replaceWalletQuantity?null:inventory.get(a.symbol),cost=amount+f.quote;
   inventory.set(a.symbol,{qty:qty+(previous?.qty||0),cost:cost+(previous?.cost||0),entryAt:previous?.entryAt||a.at,entryPrice:previous?.entryPrice||a.price,peakPrice:Math.max(Number(a.wyckoffTrade?.peakPrice||a.price),Number(previous?.peakPrice||0)),known:f.known&&(previous?.known??true),buyFees:[...(previous?.buyFees||[]),...(a.commissions||[])]});continue;
  }
  const p=inventory.get(a.symbol);if(!p)continue;
  if(qty>p.qty+Math.max(1e-8,p.qty*1e-6))continue;
  const sold=Math.min(qty,p.qty),cost=p.cost*sold/p.qty,known=p.known&&f.known;
  const net=amount-f.quote-cost,remaining=Math.max(0,p.qty-sold);
  const closed=remaining<=1e-8||Number(a.price)>0&&remaining*Number(a.price)<Number(a.dustThresholdUsdt??5);
  rows.push({symbol:a.symbol,entryAt:p.entryAt,at:a.at,entryPrice:p.entryPrice,sellPrice:a.price,peakPrice:p.peakPrice,maxGrossPnlUsdt:(p.peakPrice-p.entryPrice)*sold,netPnlUsdt:known?net:null,netPnlPct:known&&cost>0?net/cost*100:null,buyCommissions:p.buyFees.map(f=>({...f,amount:Number(f.amount)*sold/p.qty})),sellCommissions:a.commissions||null,reason:a.reason,closed,costUsdt:cost,proceedsUsdt:amount,feesComplete:known});
  if(closed){inventory.delete(a.symbol);}else{p.cost-=cost;p.qty=remaining;p.buyFees=p.buyFees.map(f=>({...f,amount:Number(f.amount)*remaining/(remaining+sold)}));}
 }
 return rows.reverse();
}
