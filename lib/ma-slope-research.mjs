import {slopeHistory,slopeExitCandidate} from './ma-slope.mjs';
import {earlyWaveEntry} from './early-wave-entry.mjs';
import {applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
import {binancePositionExit} from './binance-position-exit.mjs';
// Offline Spot LONG comparison of the early-wave entry branch only. It is not
// a replay of the complete live bot or a Futures SHORT profitability test.
export function studySlopeExits(bars,{lookbackBars=10,thresholdAngle=null,feePct=.1,slippagePct=.05,startIndex=210,endIndex=bars.length}={}){
 if(!Number.isFinite(feePct)||feePct<0||feePct>5||!Number.isFinite(slippagePct)||slippagePct<0||slippagePct>5||!Number.isInteger(startIndex)||startIndex<210||!Number.isInteger(endIndex)||endIndex>bars.length||endIndex<=startIndex)throw Error('INVALID_STUDY_OPTIONS');
 if(thresholdAngle!==null&&(!Number.isFinite(thresholdAngle)||Math.abs(thresholdAngle)>=90))throw Error('INVALID_STUDY_THRESHOLD');
 const input=bars.slice(0,endIndex);
 if(input.some((b,i)=>!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.high<b.low||b.closed===false||b.closeTime-b.openTime!==299999||i>0&&b.openTime-input[i-1].openTime!==300000))throw Error('INVALID_STUDY_BARS');
 const history=slopeHistory(input,{period:20,lookbackBars,now:input.at(-1).closeTime});
 const fee=feePct/100,slip=slippagePct/100;let cash=100,qty=0,position=null,pending=null,peak=100,maxDrawdownPct=0,after=0;
 const used=[],trades=[];
 function sell(rawPrice,time,reason){
  const fill=rawPrice*(1-slip),value=qty*fill*(1-fee);
  trades.push({entryAt:position.entryTime,exitAt:time,entryPrice:position.entryPrice,exitPrice:fill,reason,returnPct:(value/position.invested-1)*100});
  cash=value;qty=0;position=null;pending=null;after=time;
 }
 for(let i=startIndex;i<endIndex;i++){
  const b=input[i];
  if(position&&pending?.type==='SELL')sell(b.open,b.openTime,pending.reason);
  else if(!position&&pending?.type==='BUY'){
   const setup=pending.setup;
   if(b.open>=setup.minimumPrice&&b.open>setup.breakoutPrice){
    const price=b.open*(1+slip);position=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:price,peakPrice:price,entryTime:b.openTime,invested:cash});
    qty=cash/(price*(1+fee));cash=0;used.push(setup.patternId);
   }
  }
  pending=null;
  if(position){
   // Existing protection from prior observations is checked first. If both
   // stop and target occur inside one candle, take the adverse stop outcome.
   if(b.low<=position.effectiveStopPrice)sell(Math.min(b.open,position.effectiveStopPrice),b.closeTime,'PROTECTION');
   else if(b.high>=position.targetPrice)sell(position.targetPrice,b.closeTime,'TARGET');
   else{
    const exit=binancePositionExit(position,b.close,b.closeTime);
    if(exit.sell)pending={type:'SELL',reason:exit.reason};
    else if(thresholdAngle!==null&&slopeExitCandidate(history,i,{thresholdAngle,entryAt:position.entryTime}))pending={type:'SELL',reason:'SLOPE'};
   }
  }else{
   const setup=earlyWaveEntry(input.slice(Math.max(0,i-6),i),{price:b.close,priceAsOf:b.closeTime,now:b.closeTime,liveBar:b,used,after});
   if(setup.buyConfirmed)pending={type:'BUY',setup};
  }
  const value=cash+qty*b.close*(1-slip)*(1-fee);peak=Math.max(peak,value);maxDrawdownPct=Math.max(maxDrawdownPct,(peak-value)/peak*100);
 }
 if(position)sell(input.at(-1).close,input.at(-1).closeTime,'END_OF_SAMPLE');
 return {returnPct:cash-100,maxDrawdownPct,trades:trades.length,slopeExits:trades.filter(t=>t.reason==='SLOPE').length,forcedEndExits:trades.filter(t=>t.reason==='END_OF_SAMPLE').length,journal:trades};
}
