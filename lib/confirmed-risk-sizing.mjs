import {CONFIRMED_QUALITY_POLICY,BINANCE_CONFIRMED_POLICY,BINANCE_STOP_POLICY} from './confirmed-entry-quality.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
export function sizeRisk(price,amount,settings,input){
 const p=CONFIRMED_QUALITY_POLICY;
 if(!(Number.isFinite(amount)&&amount>0)||!['COLMEX_'+p.version,'BINANCE_'+p.version].includes(input?.version)||![price,input.atr,input.structureLow].every(n=>Number.isFinite(n)&&n>0)||input.structureLow>=price)return {reason:'INVALID_RISK_INPUT'};
 const settingsOnly=input.version===BINANCE_CONFIRMED_POLICY.version;
 settings=validateTradeSettings(settings);
 // Binance uses the owner's configured percentage exactly. ATR and structure
 // remain entry diagnostics; only Colmex retains volatility-based stop sizing.
 const stopLossPct=settingsOnly?settings.stopLossPct:Math.ceil(Math.max(settings.stopLossPct,100*p.atrMultiple*input.atr/price,100*(price-input.structureLow+input.atr*.1)/price)*100)/100;
 if(!settingsOnly&&stopLossPct>p.maxStopPct)return {reason:'VOLATILITY_RISK_TOO_HIGH'};
 const riskBudgetUsd=Math.min(p.maxRiskUsd,amount*Math.min(settings.stopLossPct,1)/100);
 return {reason:'READY',budget:Math.min(amount,riskBudgetUsd/(stopLossPct/100)),settings:{...settings,stopLossPct},riskPlan:{version:input.version,...(settingsOnly?{stopLossPolicy:BINANCE_STOP_POLICY}:{}),atr:input.atr,structureLow:input.structureLow,stopLossPct,riskBudgetUsd,entryLimit:price}};
}
// Colmex retains its frozen entry risk distance. Binance runtime deliberately
// passes current trade settings directly instead of using this frozen override.
export function positionRiskSettings(position,settings={}){
 const current=validateTradeSettings(settings),frozen=position.riskPlan?.stopLossPct;
 return Number.isFinite(frozen)&&frozen>0?{...current,stopLossPct:frozen}:current;
}
