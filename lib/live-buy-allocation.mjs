export const LIVE_BUY_FEE_RESERVE=1.002;
export function liveNextBuyAllocation(account,{maxPositions=5,maxOrderUsdt=400,minimumUsdt=5}={}){
  const activePositions=(account.balances||[]).filter(b=>!['USDT','USDC'].includes(b.asset)&&Number(b.valueUsdt||0)>=5).length;
  const availableUsdt=Number(account.usdtFree),fixedUsdt=Number(account.fixedPositionUsdt);
  const lastSlot=activePositions===maxPositions-1;
  const base={activePositions,maxPositions,lastSlot,availableUsdt,feeReserveMultiplier:LIVE_BUY_FEE_RESERVE,allocationMode:'FIXED_EQUAL_LAST_REMAINDER'};
  const blocked=(code,extra={})=>({...base,ok:false,code,...extra});
  if(activePositions>=maxPositions)return blocked('NO_SLOT');
  if(!Number.isFinite(availableUsdt)||availableUsdt<0)return blocked('WAIT_ACCOUNT');
  if(!Number.isFinite(fixedUsdt)||fixedUsdt<5)return blocked('WAIT_ALLOCATION');
  const amountUsdt=lastSlot?Math.floor(availableUsdt/LIVE_BUY_FEE_RESERVE*1e8)/1e8:fixedUsdt;
  const requiredUsdt=amountUsdt*LIVE_BUY_FEE_RESERVE;
  const fields={amountUsdt,requiredUsdt,minimumUsdt,missingUsdt:Math.max(0,requiredUsdt-availableUsdt)};
  if(amountUsdt>maxOrderUsdt)return blocked('LIVE_ORDER_LIMIT',fields);
  if(amountUsdt<minimumUsdt)return blocked('BELOW_MINIMUM',{...fields,missingUsdt:Math.max(0,minimumUsdt*LIVE_BUY_FEE_RESERVE-availableUsdt)});
  if(availableUsdt<requiredUsdt)return blocked('NO_CASH',fields);
  return {...base,...fields,ok:true,code:'BUY_ALLOCATION_READY'};
}
