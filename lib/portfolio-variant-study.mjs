import {evaluateWyckoff} from './wyckoff-strategy.mjs';
export const STEP=300000;
export function makeFeatures(rows){
 const bars=rows.map(x=>({openTime:+x[0],closeTime:+x[6],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closed:true,timeframe:'5m'}));
 for(let i=0;i<bars.length;i++){
  const b=bars[i];if(i&&b.openTime!==bars[i-1].openTime+STEP)throw Error('GAP');
  if(![b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))throw Error('INVALID_OHLC');
 }
 let atr=null,trSum=0;const hours=[];
 for(let i=0;i<bars.length;i++){
  const b=bars[i],previous=bars[i-1]?.close??b.open,tr=Math.max(b.high-b.low,Math.abs(b.high-previous),Math.abs(b.low-previous));
  if(i<14){trSum+=tr;if(i===13)atr=trSum/14;}else atr=(atr*13+tr)/14;
  b.atr=atr;
  if((b.closeTime+1)%3600000===0)hours.push(b.close);
  const mean=n=>hours.slice(-n).reduce((a,v)=>a+v,0)/n;
  b.trend=hours.length>=50&&hours.at(-1)>mean(20)&&mean(20)>mean(50);
  b.previousLow=i>=12?Math.min(...bars.slice(i-12,i).map(x=>x.low)):null;
 }
 return bars;
}
export function causalSignals(bars,fromIndex=2015){
 const signals=[];let lastIdentity=null;
 for(let i=Math.max(2015,fromIndex);i<bars.length-1;i++){
  const b=bars[i],setup=evaluateWyckoff(bars.slice(i-2015,i+1),{now:b.closeTime,timeframe:'5m'});
  if(!setup.buyConfirmed||b.close<=setup.firstLow.price||b.close>=setup.targetPrice)continue;
  const identity=setup.patternId;
  if(identity===lastIdentity)continue;
  lastIdentity=identity;
  signals.push({index:i,at:b.closeTime,signalAt:setup.signalTime,identity,firstLow:setup.firstLow.price,target:setup.targetPrice,spring:setup.springLow.price,peakTime:setup.initialPeak.time,trend:b.trend});
 }
 return signals;
}
export function exitDecision(position,bar,variant){
 position.peak=Math.max(position.peak,bar.close);
 if(variant.exit==='current'){
  const floor=bar.closeTime-position.at>=7*86400000&&position.peak>position.entry?Math.max(position.entry*.9,position.entry+.8*(position.peak-position.entry)):position.entry*.9;
  return bar.close<=floor?(floor===position.entry*.9?'STOP_10':'RETAIN_80_AFTER_7D'):null;
 }
 position.stop=Math.max(position.stop,position.peak-3*bar.atr);
 position.structureBreaks=bar.previousLow!=null&&bar.close<bar.previousLow?position.structureBreaks+1:0;
 if(bar.close<=position.stop)return 'ATR_STOP';
 if(position.peak-position.entry>=position.initialRisk&&position.structureBreaks>=2)return 'STRUCTURE_BREAK';
 return null;
}
export function runPortfolio(data,variant,{start,end,initialUsdt=143.62915,maxPositions=5,feeRate=.001,slippage=.0005,minimumOrderUsdt=5}={}){
 if(!(initialUsdt>0)||!(start<end)||feeRate<0||slippage<0)throw Error('INVALID_CONFIG');
 const symbols=Object.keys(data).sort(),positions=new Map(),used=new Set(),lastExit=new Map(),trades=[],daily=[],curve=[];
 let cash=initialUsdt,high=initialUsdt,maxDrawdownPct=0,buyCount=0,sellCount=0,fees=0,pendingSales=[],pendingBuys=[],skipCash=0,skipSlots=0,skipTrend=0,signals=0;
 const byTime=new Map();
 for(const symbol of symbols){const {bars,candidates}=data[symbol];for(const c of candidates){if(c.at<start||c.at>=end)continue;if(!byTime.has(c.at))byTime.set(c.at,[]);byTime.get(c.at).push({...c,symbol});}}
 const indexByTime=new Map(symbols.map(s=>[s,new Map(data[s].bars.map((b,i)=>[b.openTime,i]))]));
 const barAt=(symbol,time)=>data[symbol].bars[indexByTime.get(symbol).get(time)];
 function closePosition(symbol,raw,at,reason,mark=false){
  const p=positions.get(symbol),price=raw*(1-slippage),gross=p.qty*price,fee=gross*feeRate;
  cash+=gross-fee;fees+=fee;if(!mark){sellCount++;lastExit.set(symbol,at);}
  trades.push({symbol,entryAt:p.at,exitAt:at,entry:p.entry,exit:price,qty:p.qty,cost:p.cost,net:gross-fee-p.cost,netPct:(gross-fee-p.cost)/p.cost*100,R:(gross-fee-p.cost)/(p.qty*p.initialRisk),peak:p.peak,reason,marked:mark});positions.delete(symbol);
 }
 for(let time=start;time<end;time+=STEP){
  for(const sale of pendingSales){const b=barAt(sale.symbol,time);if(!b)throw Error('MISSING_EXECUTION_BAR');if(positions.has(sale.symbol))closePosition(sale.symbol,b.open,time,sale.reason);}pendingSales=[];
  for(const candidate of pendingBuys){
   if(positions.has(candidate.symbol)||(candidate.signalAt??candidate.at)<=(lastExit.get(candidate.symbol)||0)||used.has(candidate.symbol+':'+candidate.identity))continue;
   if(variant.trend&&!candidate.trend){skipTrend++;continue;}
   if(positions.size>=maxPositions){skipSlots++;continue;}
   const b=barAt(candidate.symbol,time),prior=barAt(candidate.symbol,time-STEP);if(!b||!prior?.atr)throw Error('MISSING_ENTRY_DATA');
   const entry=b.open*(1+slippage);
   if(entry<=candidate.firstLow||entry>=candidate.target)continue;
   const budget=Math.min(initialUsdt/maxPositions,cash),quote=budget/(1+feeRate);
   if(quote<minimumOrderUsdt){skipCash++;continue;}
   const qty=quote/entry,fee=quote*feeRate,cost=quote+fee,risk=variant.exit==='current'?entry*.1:Math.min(entry*.1,2.5*prior.atr);
   if(!(risk>0))throw Error('INVALID_RISK');cash-=cost;fees+=fee;buyCount++;
   positions.set(candidate.symbol,{entry,at:time,qty,cost,peak:entry,initialRisk:risk,stop:entry-risk,structureBreaks:0});used.add(candidate.symbol+':'+candidate.identity);
  }pendingBuys=[];
  for(const [symbol,p] of positions){const b=barAt(symbol,time);if(!b)throw Error('MISSING_MARK_BAR');const reason=exitDecision(p,b,variant);if(reason&&time+STEP<end)pendingSales.push({symbol,reason});}
  const at=time+STEP-1,candidates=byTime.get(at)||[];signals+=candidates.length;
  // Alphabetical ties are fixed and reproducible, never ranked by future returns.
  if(time+STEP<end)pendingBuys=candidates.sort((a,b)=>a.symbol.localeCompare(b.symbol));
  const equity=cash+[...positions].reduce((sum,[symbol,p])=>sum+p.qty*barAt(symbol,time).close*(1-slippage)*(1-feeRate),0);
  if(cash< -1e-8||positions.size>maxPositions)throw Error('CAPITAL_CONSTRAINT');high=Math.max(high,equity);maxDrawdownPct=Math.max(maxDrawdownPct,(high-equity)/high*100);
  if((time+STEP)%3600000===0||time+STEP===end)curve.push({at:time+STEP,equity});
  if((time+STEP)%86400000===0||time+STEP===end)daily.push({at:time+STEP,equity});
 }
 const openAtEnd=positions.size;
 for(const [symbol] of positions)closePosition(symbol,barAt(symbol,end-STEP).close,end,'END_MARK',true);
 const closed=trades.filter(t=>!t.marked),wins=closed.filter(t=>t.net>0).length,gains=closed.reduce((n,t)=>n+Math.max(0,t.net),0),losses=-closed.reduce((n,t)=>n+Math.min(0,t.net),0);
 return {id:variant.id,label:variant.label,start,end,initialUsdt,finalUsdt:cash,net:cash-initialUsdt,returnPct:(cash/initialUsdt-1)*100,maxDrawdownPct,buyCount,sellCount,openAtEnd,wins,winPct:closed.length?wins/closed.length*100:null,profitFactor:losses?gains/losses:null,meanR:closed.length?closed.reduce((n,t)=>n+t.R,0)/closed.length:null,fees,signals,skipCash,skipSlots,skipTrend,trades,daily,curve};
}
