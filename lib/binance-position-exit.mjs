import {FIXED_EXIT_POLICY,applyFixedExitPolicy} from './fixed-trade-exit.mjs';
// Legacy policies remain available for historical studies. LIVE managed trades
// explicitly migrate to FIXED_TP4_SL1_V1 before exit evaluation.
export const MINIMUM_PROFIT_HOLD_MS=7*86400000;
export const SPRING_EXIT_POLICY='SPRING_GAIN_LOCK_80_STOP_10_V1';
export function binanceInitialExitPolicy(position){
  if(position?.exitPolicy===FIXED_EXIT_POLICY)return {stopLossPct:1,takeProfitPct:4};
  return position?.exitPolicy===SPRING_EXIT_POLICY?{stopLossPct:10}:binanceExitPolicy(position?.marketRank);
}
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
export function binancePositionExit(position, price, now=Date.now()) {
  if (!['WYCKOFF_D1_V1','WYCKOFF_5M_V1'].includes(position?.strategyId))
    return {sell:false,reason:'LEGACY_POSITION_REQUIRES_REVIEW'};
  const entry=Number(position.entryPrice);
  if (!(entry>0) || !Number.isFinite(entry) || !(price>0) || !Number.isFinite(price))
    throw Error('INVALID_BINANCE_EXIT_PRICE');
  const stored=Number(position.peakPrice);
  const peak=Math.max(entry,Number.isFinite(stored)&&stored>0?stored:entry,price);
  if(position.exitPolicy===FIXED_EXIT_POLICY){
    applyFixedExitPolicy(position);position.peakPrice=peak;
    if(price<=position.stopPrice)return {sell:true,reason:'FIXED_STOP_LOSS_1_PERCENT'};
    if(price>=position.targetPrice)return {sell:true,reason:'FIXED_TAKE_PROFIT_4_PERCENT'};
    return {sell:false,reason:'FIXED_TP4_SL1_HOLD'};
  }
  if(position.exitPolicy===SPRING_EXIT_POLICY){
    const stopPrice=entry*.9;
    const gained=peak>entry;
    const trailingStopPrice=gained?entry+.8*(peak-entry):null;
    const floor=Math.max(stopPrice,Number(position.effectiveStopPrice)||0,trailingStopPrice||0);
    const minHoldMs=Number(position.minProfitHoldMs||0);
    const entryTime=Date.parse(position.profitHoldStartedAt||position.entryAt);
    const holding=minHoldMs>0&&Number.isFinite(entryTime)&&now<entryTime+minHoldMs;
    Object.assign(position,{peakPrice:peak,stopLossPct:10,stopPrice,atrEnabled:false,
      profitGivebackPct:20,profitRetentionPct:80,trailingStopPct:null,trailingActive:gained&&!holding,
      trailingStopPrice,profitProtectionPending:holding,profitProtectionStartsAt:minHoldMs>0&&Number.isFinite(entryTime)?new Date(entryTime+minHoldMs).toISOString():null,
      pendingProfitStopPrice:holding?floor:null,effectiveStopPrice:holding?stopPrice:floor});
    if(price<=stopPrice)return {sell:true,reason:'WYCKOFF_SPRING_STOP_LOSS_10_PERCENT'};
    if(minHoldMs>0&&!Number.isFinite(entryTime))throw Error('INVALID_POSITION_ENTRY_TIME');
    if(holding)return {sell:false,reason:'WYCKOFF_MINIMUM_PROFIT_HOLD'};
    if(price<=floor)return {sell:true,reason:'WYCKOFF_GAIN_GIVEBACK_20_PERCENT'};
    return {sell:false,reason:'WYCKOFF_HOLD'};
  }
  const rankPolicy=binanceExitPolicy(position.marketRank);
  const stopLossPct=position.atrEnabled&&Number(position.atrStopPct)>0?position.atrStopPct:rankPolicy.stopLossPct;
  const trailingStopPct=position.atrEnabled&&Number(position.atrTrailPct)>0?position.atrTrailPct:rankPolicy.trailingStopPct;
  const priorStop=position.atrEnabled?Number(position.effectiveStopPrice)||0:0;
  const stopPrice=entry*(1-stopLossPct/100),trailingStopPrice=peak*(1-trailingStopPct/100);
  Object.assign(position,{peakPrice:peak,stopLossPct,stopPrice,
    trailingStopPct,trailingActive:true,trailingStopPrice,
    effectiveStopPrice:Math.max(priorStop,stopPrice,trailingStopPrice)});
  if(price<=position.stopPrice)return {sell:true,reason:'WYCKOFF_STOP_LOSS_'+String(stopLossPct).replace('.','_')+'_PERCENT'};
  if(price<=position.effectiveStopPrice)return {sell:true,reason:'WYCKOFF_TRAILING_'+String(trailingStopPct).replace('.','_')+'_PERCENT'};
  return {sell:false,reason:'WYCKOFF_HOLD'};
}
