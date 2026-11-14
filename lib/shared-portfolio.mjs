// One budget and entry mutex for Binance Spot LONG and USD-M SHORT.
// No transfers, order submission, stop changes or exit locks are performed here.
export const SHARED_PORTFOLIO_POLICY='BINANCE_SHARED_THREE_V1';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const floor=x=>Math.floor(x*100)/100;
export function sharedPortfolio({spot,futures,longManaged={},shortManaged={},pending=false,at=Date.now()}){
 if(!spot?.connected||spot.canTrade!==true||!finite(spot.totalValueUsdt)||spot.totalValueUsdt<0||!finite(spot.usdtFree)||spot.usdtFree<0||!Array.isArray(spot.balances)||futures?.canTrade!==true||!Array.isArray(futures.assets)||!Array.isArray(futures.positions))throw Error('SHARED_ACCOUNT_UNVERIFIED');
 const usdt=futures.assets.find(a=>a.asset==='USDT');
 for(const v of [usdt?.walletBalance,usdt?.unrealizedProfit,usdt?.availableBalance])if(v==null||v===''||!Number.isFinite(Number(v)))throw Error('SHARED_ACCOUNT_UNVERIFIED');
 const longs=new Set(Object.keys(longManaged));
 for(const b of spot.balances){if(!b.asset||!finite(b.valueUsdt)||b.valueUsdt<0||(Number(b.qty)>0&&!(Number(b.usdtPrice)>0)))throw Error('SHARED_ACCOUNT_UNVERIFIED');if(!['USDT','USDC'].includes(b.asset)&&b.valueUsdt>=5)longs.add(b.asset+'USDT');}
 const shorts=new Set(Object.keys(shortManaged));
 for(const p of futures.positions){if(p.positionAmt==null||p.positionAmt===''||!Number.isFinite(Number(p.positionAmt)))throw Error('SHARED_ACCOUNT_UNVERIFIED');if(Number(p.positionAmt)!==0)shorts.add(p.symbol);}
 const equityUsdt=spot.totalValueUsdt+Number(usdt.walletBalance)+Number(usdt.unrealizedProfit);
 if(!(equityUsdt>0))throw Error('SHARED_ACCOUNT_UNVERIFIED');
 const activePositions=longs.size+shorts.size;
 return {policy:SHARED_PORTFOLIO_POLICY,at,verified:true,maxPositions:3,activePositions,longPositions:longs.size,shortPositions:shorts.size,freeSlots:Math.max(0,3-activePositions),equityUsdt,grossSlotUsdt:floor(equityUsdt/3),spotAvailableUsdt:spot.usdtFree,futuresAvailableUsdt:Math.max(0,Number(usdt.availableBalance)),pending:!!pending};
}
export function sharedAllocation(state,side,{now=Date.now(),maxOrderUsdt=Infinity}={}){
 const valid=state?.verified===true&&now>=state.at&&now-state.at<15000;
 if(!valid)return {verified:false,ok:false,code:'SHARED_ACCOUNT_UNVERIFIED',maxPositions:3,freeSlots:0,maxOrderUsdt:0};
 const availableUsdt=side==='LONG'?state.spotAvailableUsdt:state.futuresAvailableUsdt;
 const gross=state.grossSlotUsdt;
 // LONG amount excludes fee reserve; SHORT planner receives a reserve-inclusive budget.
 const budget=side==='LONG'?floor(gross/1.002):gross;
 const requiredUsdt=side==='LONG'?budget*1.002:gross;
 const code=state.pending?'SHARED_ORDER_PENDING':!state.freeSlots?'SHARED_THREE_SLOTS_FULL':budget<5?'SHARED_BUDGET_BELOW_MINIMUM':availableUsdt+1e-8<requiredUsdt?'SHARED_WALLET_FUNDS_REQUIRED':budget>maxOrderUsdt?'LIVE_ORDER_LIMIT':'BUY_ALLOCATION_READY';
 const ok=code==='BUY_ALLOCATION_READY';
 return {...state,verified:true,ok,code,side,availableUsdt,requiredUsdt,missingUsdt:Math.max(0,requiredUsdt-availableUsdt),amountUsdt:budget,slotBudgetUsdt:gross,maxOrderUsdt:ok?budget:0,reserveUsdt:side==='LONG'?gross-budget:Math.max(1,budget*.003),allocationMode:SHARED_PORTFOLIO_POLICY};
}
export class SharedEntryLock{
 busy=false;
 async run(fn){if(this.busy)throw Error('SHARED_ENTRY_BUSY');this.busy=true;try{return await fn();}finally{this.busy=false;}}
}
export function installSharedPortfolio({futuresShort,readSpot,longManaged,spotOrders,maxLongUsdt,now=Date.now}){
 const lock=new SharedEntryLock();let state=null,refreshing=null,ownShortSubmission=false;
 const status=()=>state;
 async function refresh(force=false){
  if(!force&&state&&now()-state.at<5000)return state;
  if(refreshing){await refreshing;if(!force)return state;}
  const observedAt=now();const task=(async()=>{try{
   const [spot,futures]=await Promise.all([readSpot(),futuresShort.api.get('/fapi/v2/account')]);
   state=sharedPortfolio({spot,futures,longManaged:longManaged(),shortManaged:futuresShort.state.positions,pending:!!spotOrders.pending||!!futuresShort.state.pending&&!ownShortSubmission,at:observedAt});return state;
  }catch(e){state=null;throw e;}})();refreshing=task;
  try{return await task;}finally{if(refreshing===task)refreshing=null;}
 }
 function allocation(side){return sharedAllocation(state,side,{now:now(),maxOrderUsdt:side==='LONG'?maxLongUsdt:Infinity});}
 function assertAmount(side,amount){const a=allocation(side);if(!a.ok)throw Error(a.code);if(!finite(amount)||amount<5||amount>a.maxOrderUsdt+1e-8)throw Error('SHARED_AMOUNT_EXCEEDS_THIRD');return a;}
 function decorate(spot){const a=allocation('LONG');return {...spot,sharedPortfolio:state,allocationMode:SHARED_PORTFOLIO_POLICY,maxPositions:3,fixedPositionUsdt:state?.grossSlotUsdt??null,nextBuyAllocation:a};}
 const snapshot=futuresShort.snapshot.bind(futuresShort);
 futuresShort.snapshot=async(...args)=>{const a=await snapshot(...args);try{await refresh();}catch{}return a;};
 futuresShort.allocation=()=>allocation('SHORT');
 futuresShort.assertAllocation=(amount)=>{const a=allocation('SHORT');if(!a.ok)throw Error(a.code);if(amount!==undefined)assertAmount('SHORT',amount);return a;};
 futuresShort.config={...futuresShort.config,maxPositions:3,allocationPolicy:SHARED_PORTFOLIO_POLICY};
 const submit=futuresShort.submit.bind(futuresShort);
 futuresShort.submit=async(kind,params,extra={},guard)=>{
  if(kind!=='ENTRY')return submit(kind,params,extra,guard);
  return lock.run(async()=>{await refresh(true);assertAmount('SHORT',extra.slotBudgetUsdt);ownShortSubmission=true;try{return await submit(kind,params,extra,guard);}finally{ownShortSubmission=false;state=null;}});
 };
 const spotSubmit=spotOrders.submit.bind(spotOrders);
 spotOrders.submit=async(params,...args)=>{
  if(params.side==='BUY'){if(!lock.busy)throw Error('SHARED_ENTRY_LOCK_REQUIRED');await refresh(true);assertAmount('LONG',Number(params.quoteOrderQty));}
  return spotSubmit(params,...args);
 };
 return {status,refresh,allocation,decorate,runLong:fn=>lock.run(async()=>{await refresh(true);const a=allocation('LONG');if(!a.ok)throw Error(a.code);try{return await fn();}finally{state=null;}})};
}
