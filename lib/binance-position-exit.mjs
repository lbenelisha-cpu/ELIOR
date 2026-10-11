// Binance-only exit policy; broker and stock strategies retain their rules.
export const BINANCE_EXIT_TIERS = Object.freeze([
  {minRank:1,maxRank:10,stopLossPct:0.5,trailingStopPct:0.5},
  {minRank:11,maxRank:20,stopLossPct:0.5,trailingStopPct:1},
  {minRank:21,maxRank:50,stopLossPct:1,trailingStopPct:5},
  {minRank:51,maxRank:100,stopLossPct:2.5,trailingStopPct:4}
]);
export function binanceExitPolicy(rank) {
  return BINANCE_EXIT_TIERS.find(t=>Number.isInteger(rank)&&rank>=t.minRank&&rank<=t.maxRank)
    || BINANCE_EXIT_TIERS[3];
}
export function binancePositionExit(position, price) {
  if (!['WYCKOFF_D1_V1','WYCKOFF_5M_V1'].includes(position?.strategyId))
    return {sell:false,reason:'LEGACY_POSITION_REQUIRES_REVIEW'};
  const entry=Number(position.entryPrice);
  if (!(entry>0) || !Number.isFinite(entry) || !(price>0) || !Number.isFinite(price))
    throw Error('INVALID_BINANCE_EXIT_PRICE');
  const stored=Number(position.peakPrice);
  const peak=Math.max(entry,Number.isFinite(stored)&&stored>0?stored:entry,price);
  const {stopLossPct,trailingStopPct}=binanceExitPolicy(position.marketRank);
  const stopPrice=entry*(1-stopLossPct/100),trailingStopPrice=peak*(1-trailingStopPct/100);
  Object.assign(position,{peakPrice:peak,stopLossPct,stopPrice,
    trailingStopPct,trailingActive:true,trailingStopPrice,
    effectiveStopPrice:Math.max(stopPrice,trailingStopPrice)});
  if(price<=position.stopPrice)return {sell:true,reason:'WYCKOFF_STOP_LOSS_'+String(stopLossPct).replace('.','_')+'_PERCENT'};
  if(price<=position.trailingStopPrice)return {sell:true,reason:'WYCKOFF_TRAILING_'+String(trailingStopPct).replace('.','_')+'_PERCENT'};
  return {sell:false,reason:'WYCKOFF_HOLD'};
}
