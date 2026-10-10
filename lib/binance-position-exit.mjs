// Binance-only exit policy; broker and stock strategies retain their rules.
export function binancePositionExit(position, price) {
  if (!['WYCKOFF_D1_V1','WYCKOFF_5M_V1'].includes(position?.strategyId))
    return {sell:false,reason:'LEGACY_POSITION_REQUIRES_REVIEW'};
  const entry=Number(position.entryPrice);
  if (!(entry>0) || !Number.isFinite(entry) || !(price>0) || !Number.isFinite(price))
    throw Error('INVALID_BINANCE_EXIT_PRICE');
  const stored=Number(position.peakPrice);
  const peak=Math.max(entry,Number.isFinite(stored)&&stored>0?stored:entry,price);
  Object.assign(position,{peakPrice:peak,stopLossPct:2,stopPrice:entry*.98,
    trailingStopPct:2.5,trailingActive:true,trailingStopPrice:peak*.975,
    effectiveStopPrice:Math.max(entry*.98,peak*.975)});
  if(price<=position.stopPrice)return {sell:true,reason:'WYCKOFF_STOP_LOSS_2_PERCENT'};
  if(price<=position.trailingStopPrice)return {sell:true,reason:'WYCKOFF_TRAILING_2_5_PERCENT'};
  return {sell:false,reason:'WYCKOFF_HOLD'};
}
