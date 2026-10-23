export const FIXED_EXIT_POLICY='FIXED_TP4_SL1_V1';
export const FIXED_MINIMUM_PROFIT_HOLD_MS=0;
export const TAKE_PROFIT_PCT=4;
export const STOP_LOSS_PCT=1;

export function fixedTradeLevels(entryPrice,qty=null){
 const entry=Number(entryPrice),quantity=Number(qty);
 if(!(entry>0)||!Number.isFinite(entry))return null;
 const targetPrice=entry*1.04,stopPrice=entry*.99;
 const validQty=qty!==null&&qty!==undefined&&quantity>0&&Number.isFinite(quantity);
 return {entryPrice:entry,targetPrice,stopPrice,takeProfitPct:4,stopLossPct:1,
  maxProfit:validQty?(targetPrice-entry)*quantity:null,maxLoss:validQty?(entry-stopPrice)*quantity:null,
  qty:validQty?quantity:null};
}
export function applyFixedExitPolicy(position){
 const levels=fixedTradeLevels(position.entryPrice,position.qty);
 Object.assign(position,{exitPolicy:FIXED_EXIT_POLICY,takeProfitPct:4,stopLossPct:1,minProfitHoldMs:0,
  atrEnabled:false,profitGivebackPct:null,profitRetentionPct:null,trailingActive:false,trailingStopPct:null,
  trailingStopPrice:null,profitProtectionPending:false,profitProtectionStartsAt:null,pendingProfitStopPrice:null});
 if(levels)Object.assign(position,{stopPrice:levels.stopPrice,effectiveStopPrice:levels.stopPrice,targetPrice:levels.targetPrice});
 return position;
}
