export const LIVE_BUY_FEE_RESERVE=1.002;
export const LIVE_EQUITY_ALLOCATION='CURRENT_EQUITY_EQUAL_FIVE_V1';
export function liveEquityAllocation(total,maxPositions=5){
  const baseUsdt=Number(total);
  if(!Number.isFinite(baseUsdt)||baseUsdt<=0||maxPositions!==5)return null;
  return {baseUsdt,positionUsdt:baseUsdt/maxPositions,maxPositions,allocationMode:LIVE_EQUITY_ALLOCATION,allocationVersion:3};
}
export function liveNextBuyAllocation(account,{maxPositions=5,maxOrderUsdt=400,minimumUsdt=5}={}){
  const activePositions=(account.balances||[]).filter(b=>!['USDT','USDC'].includes(b.asset)&&Number(b.valueUsdt||0)>=5).length;
  const availableUsdt=Number(account.usdtFree),fixedUsdt=Number(account.fixedPositionUsdt);
  const lastSlot=activePositions===maxPositions-1;
  const equalEquity=account.allocationMode===LIVE_EQUITY_ALLOCATION;
  const base={activePositions,maxPositions,lastSlot,availableUsdt,feeReserveMultiplier:LIVE_BUY_FEE_RESERVE,allocationMode:equalEquity?LIVE_EQUITY_ALLOCATION:'FIXED_EQUAL_LAST_REMAINDER'};
  const blocked=(code,extra={})=>({...base,ok:false,code,...extra});
  if(activePositions>=maxPositions)return blocked('NO_SLOT');
  if(!Number.isFinite(availableUsdt)||availableUsdt<0)return blocked('WAIT_ACCOUNT');
  const equity=equalEquity?liveEquityAllocation(account.totalValueUsdt,maxPositions):null;
  if(equalEquity?!equity:!Number.isFinite(fixedUsdt)||fixedUsdt<5)return blocked('WAIT_ALLOCATION');
  const amountUsdt=equalEquity?Math.floor(equity.positionUsdt/LIVE_BUY_FEE_RESERVE*1e8)/1e8:lastSlot?Math.floor(availableUsdt/LIVE_BUY_FEE_RESERVE*1e8)/1e8:fixedUsdt;
  const requiredUsdt=amountUsdt*LIVE_BUY_FEE_RESERVE;
  const fields={amountUsdt,requiredUsdt,minimumUsdt,missingUsdt:Math.max(0,requiredUsdt-availableUsdt),...(equalEquity?{equityUsdt:equity.baseUsdt,grossSlotUsdt:equity.positionUsdt}:{})};
  if(amountUsdt>maxOrderUsdt)return blocked('LIVE_ORDER_LIMIT',fields);
  if(amountUsdt<minimumUsdt)return blocked('BELOW_MINIMUM',{...fields,missingUsdt:Math.max(0,minimumUsdt*LIVE_BUY_FEE_RESERVE-availableUsdt)});
  if(availableUsdt<requiredUsdt)return blocked('NO_CASH',fields);
  return {...base,...fields,ok:true,code:'BUY_ALLOCATION_READY'};
}
