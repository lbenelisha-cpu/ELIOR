import {validateTradeSettings} from './trade-settings.mjs';
export const TRAILING_EXIT_POLICY='PROFIT_FLOOR4_TRAIL1PP_STOP1_V1';
// The gap is one percentage point of entry, NOT one percent of peak.
export function trailingTradeLevels(position){
 const settings=validateTradeSettings(position?.exitSettings||{});
 const entry=Number(position?.entryPrice);
 if(!(entry>0)||!Number.isFinite(entry))return null;
 const storedPeak=Number(position.peakPrice),peak=Math.max(entry,Number.isFinite(storedPeak)?storedPeak:entry),activationPrice=entry*(1+settings.profitActivationPct/100);
 const samePolicy=position.exitPolicy===TRAILING_EXIT_POLICY;
 const saved=samePolicy?Number(position.effectiveStopPrice)||0:0;
 const armed=position.profitFloorArmed===true||peak>=activationPrice||saved>=activationPrice;
 const stopPrice=entry*(1-settings.stopLossPct/100);
 const effectiveStopPrice=armed?Math.max(activationPrice,peak-entry*settings.trailingGapPp/100,saved):Math.max(stopPrice,saved);
 return {entryPrice:entry,peakPrice:peak,activationPrice,stopPrice,effectiveStopPrice,profitFloorArmed:armed,
  protectedGainPct:(effectiveStopPrice/entry-1)*100};
}
export function applyTrailingExitPolicy(position,config=position?.exitSettings||{}){
 const settings=validateTradeSettings(config);position.exitSettings=settings;
 const levels=trailingTradeLevels(position);
 Object.assign(position,{exitPolicy:TRAILING_EXIT_POLICY,takeProfitPct:settings.takeProfitPct,targetPrice:levels?levels.entryPrice*(1+settings.takeProfitPct/100):null,stopLossPct:settings.stopLossPct,minProfitHoldMs:0,
  profitActivationPct:settings.profitActivationPct,profitFloorPct:settings.profitActivationPct,trailingGapPp:settings.trailingGapPp,atrEnabled:false,profitGivebackPct:null,profitRetentionPct:null,
  trailingStopPct:null,profitProtectionPending:false,profitProtectionStartsAt:null,pendingProfitStopPrice:null});
 if(levels)Object.assign(position,levels,{trailingActive:levels.profitFloorArmed,trailingStopPrice:levels.profitFloorArmed?levels.effectiveStopPrice:null});
 return position;
}
