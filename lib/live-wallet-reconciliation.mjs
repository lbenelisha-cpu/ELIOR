// Wallet reductions are accounting adjustments, never invented SELL fills.
// Call only while holding the execution lock, after recovering owned orders.
export const RECONCILIATION_ACTION='POSITION_RECONCILIATION';
export const quantityTolerance=qty=>Math.max(1e-12,Number(qty)*1e-8);
export class LiveWalletReconciler {
  constructor(){this.candidates=new Map();this.lastObservation=0;}
  observe(account,positions,now=Date.now()){
    const observedAt=Date.parse(account?.updatedAt);
    if(account?.connected!==true||!Array.isArray(account.balances)||!Number.isFinite(observedAt)||observedAt>now||now-observedAt>15000)
      throw Error('LIVE_ACCOUNT_SNAPSHOT_INVALID');
    const balances=new Map();
    for(const b of account.balances){
      if(!b.asset||balances.has(b.asset)||![b.free,b.locked,b.qty].every(v=>Number.isFinite(v)&&v>=0)||Math.abs(b.qty-b.free-b.locked)>quantityTolerance(b.qty))
        throw Error('LIVE_ACCOUNT_BALANCE_INVALID');
      balances.set(b.asset,b);
    }
    if(observedAt<=this.lastObservation)throw Error('LIVE_ACCOUNT_SNAPSHOT_NOT_NEW');
    this.lastObservation=observedAt;
    const adjustments=[],pending=[];
    for(const symbol of this.candidates.keys())if(!positions[symbol])this.candidates.delete(symbol);
    for(const [symbol,p] of Object.entries(positions)){
      if(!symbol.endsWith('USDT')||!(p.qty>0)||!p.entryAt)throw Error('LIVE_POSITION_IDENTITY_INVALID');
      const walletQty=balances.get(symbol.slice(0,-4))?.qty??0;
      if(walletQty>=p.qty-quantityTolerance(p.qty)){this.candidates.delete(symbol);continue;}
      const prior=this.candidates.get(symbol);
      const matching=prior&&prior.entryAt===p.entryAt&&prior.previousQty===p.qty&&Math.abs(prior.walletQty-walletQty)<=quantityTolerance(p.qty)&&observedAt-prior.observedAt<=120000;
      if(matching&&observedAt-prior.observedAt>=1000){
        const balance=balances.get(symbol.slice(0,-4));
        const archiveAsDust=walletQty>0&&Number(balance?.usdtPrice)>0&&walletQty*balance.usdtPrice<5;
        adjustments.push({type:RECONCILIATION_ACTION,symbol,entryAt:p.entryAt,previousQty:p.qty,qty:walletQty,
          at:new Date(now).toISOString(),walletObservedAt:account.updatedAt,firstObservedAt:new Date(prior.observedAt).toISOString(),
          reason:walletQty===0?'CONFIRMED_WALLET_ABSENT':'CONFIRMED_WALLET_REDUCTION',archiveAsDust,price:balance?.usdtPrice||null,realizedPnlKnown:false});
        this.candidates.delete(symbol);
      }else{
        if(!matching)this.candidates.set(symbol,{entryAt:p.entryAt,previousQty:p.qty,walletQty,observedAt});
        pending.push({symbol,recordedQty:p.qty,walletQty});
      }
    }
    return {ready:pending.length===0,checkedAt:account.updatedAt,pending,adjustments};
  }
}
