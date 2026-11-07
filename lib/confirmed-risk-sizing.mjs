import {CONFIRMED_QUALITY_POLICY,BINANCE_CONFIRMED_POLICY,BINANCE_STOP_POLICY} from './confirmed-entry-quality.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
// Kept self-contained for reviewed installers that stage this helper independently.
const LIVE_EQUITY_ALLOCATION='CURRENT_EQUITY_EQUAL_FIVE_V1';
export function sizeRisk(price,amount,settings,input){
 const p=CONFIRMED_QUALITY_POLICY;
 const profileSettings=input?.stopLossPolicy===BINANCE_STOP_POLICY&&['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(input?.source);
 if(!(Number.isFinite(amount)&&amount>0)||!['COLMEX_'+p.version,'BINANCE_'+p.version].includes(input?.version)||!Number.isFinite(price)||price<=0||!profileSettings&&(![input.atr,input.structureLow].every(n=>Number.isFinite(n)&&n>0)||input.structureLow>=price))return {reason:'INVALID_RISK_INPUT'};
 const settingsOnly=input.version===BINANCE_CONFIRMED_POLICY.version||input.stopLossPolicy===BINANCE_STOP_POLICY;
 settings=validateTradeSettings(settings);
 // Binance and channel V2 entries use the owner's exact stop percentage.
 // Other Colmex entry routes retain their volatility-based stop sizing.
 const stopLossPct=settingsOnly?settings.stopLossPct:Math.ceil(Math.max(settings.stopLossPct,100*p.atrMultiple*input.atr/price,100*(price-input.structureLow+input.atr*.1)/price)*100)/100;
 if(!settingsOnly&&stopLossPct>p.maxStopPct)return {reason:'VOLATILITY_RISK_TOO_HIGH'};
 const equalEquity=input.version===BINANCE_CONFIRMED_POLICY.version&&input.allocationMode===LIVE_EQUITY_ALLOCATION;
 const riskBudgetUsd=equalEquity?amount*stopLossPct/100:Math.min(p.maxRiskUsd,amount*Math.min(settings.stopLossPct,1)/100);
 if(equalEquity&&riskBudgetUsd>p.maxRiskUsd)return {reason:'POSITION_RISK_LIMIT',plannedRiskUsd:riskBudgetUsd,maxRiskUsd:p.maxRiskUsd};
 return {reason:'READY',budget:equalEquity?amount:Math.min(amount,riskBudgetUsd/(stopLossPct/100)),settings:{...settings,stopLossPct},riskPlan:{version:input.version,...(equalEquity?{allocationMode:LIVE_EQUITY_ALLOCATION}:{}),...(settingsOnly?{stopLossPolicy:BINANCE_STOP_POLICY}:{}),...(profileSettings?{source:input.source}:{atr:input.atr,structureLow:input.structureLow}),stopLossPct,riskBudgetUsd,entryLimit:price}};
}
// Colmex retains its frozen entry risk distance. Binance runtime deliberately
// passes current trade settings directly instead of using this frozen override.
export function positionRiskSettings(position,settings={}){
 const current=validateTradeSettings(settings),frozen=position.riskPlan?.stopLossPct;
 if(position.setup?.channelProtection?.version==='CHANNEL_TAKE_PROFIT_V2')return current;
 return Number.isFinite(frozen)&&frozen>0?{...current,stopLossPct:frozen}:current;
}
