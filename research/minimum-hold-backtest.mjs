// Offline only. Input: symbols.json plus SYMBOL.json files with closed minutes and raw 5m warm-up.
// No account access, exchange requests, or order submission.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {evaluateWyckoff} from '../lib/wyckoff-strategy.mjs';
import {binancePositionExit,SPRING_EXIT_POLICY} from '../lib/binance-position-exit.mjs';
const directory=process.argv[2];if(!directory)throw Error('Usage: node research/minimum-hold-backtest.mjs DATA_DIRECTORY');
const symbols=JSON.parse(fs.readFileSync(path.join(directory,'symbols.json')));
for(const symbol of symbols)while(!fs.existsSync(path.join(directory,symbol+'.json')))await new Promise(resolve=>setTimeout(resolve,1000));
const sets=symbols.map(symbol=>JSON.parse(fs.readFileSync(path.join(directory,symbol+'.json'))));
const start=Math.max(...sets.map(d=>d.minutes[0].openTime))+86400000;
const end=Math.min(...sets.map(d=>d.minutes.at(-1).closeTime));
const fee=.001,slip=.0005,initial=143.62915,amount=28.72583,slots=5;
for(const d of sets){
 d.byMinute=new Map(d.minutes.map(b=>[b.openTime,b]));
 for(let i=1;i<d.minutes.length;i++)assert.equal(d.minutes[i].openTime-d.minutes[i-1].openTime,60000);
 const byFive=new Map(d.fiveRaw.filter(r=>r[6]<=end).map(r=>[r[0],{openTime:+r[0],closeTime:+r[6],open:+r[1],high:+r[2],low:+r[3],close:+r[4],closed:true}]));
 const groups=new Map();for(const b of d.minutes){const t=Math.floor(b.openTime/300000)*300000;if(!groups.has(t))groups.set(t,[]);groups.get(t).push(b);}
 for(const [t,v] of groups)if(v.length===5&&v[0].openTime===t&&v.at(-1).closeTime===t+299999&&t+299999<=end)byFive.set(t,{openTime:t,closeTime:t+299999,open:v[0].open,high:Math.max(...v.map(b=>b.high)),low:Math.min(...v.map(b=>b.low)),close:v.at(-1).close,closed:true});
 const five=[...byFive.values()].sort((a,b)=>a.openTime-b.openTime);
 assert(five[0].openTime<=start-7*86400000+300000,'Requires seven-day causal warm-up: '+d.symbol);
 for(let i=1;i<five.length;i++)assert.equal(five[i].openTime-five[i-1].openTime,300000,d.symbol);
 d.signals=new Map();
 for(let i=2;i<five.length;i++){
  const b=five[i];if(b.closeTime+1<start)continue;
  const s=evaluateWyckoff(five.slice(Math.max(0,i-2015),i+1),{timeframe:'5m',now:b.closeTime});
  d.signals.set(b.closeTime+1,s.buyConfirmed?s:null);
 }
 console.error('Prepared',d.symbol,d.signals.size);
}
function simulate(holdMinutes,route){
 let cash=initial,buys=0,sells=0,realized=0,paidFees=0,peakEquity=initial,maxDrawdownPct=0,occupiedMinutes=0,maxPositions=0;
 const trades=[],equity=[],state=new Map(sets.map(d=>[d.symbol,{position:null,pending:null,used:new Set(),cancelled:new Map(),lastSale:0,lastClose:null}]));
 const rejected={slots:0,cash:0},blockedSignals=new Set(),allSignals=new Set();
 const count=()=>[...state.values()].filter(s=>s.position).length;
 function sell(d,s,price,time,reason){
  const p=s.position;assert(time>=p.entryTime);
  if(reason==='WYCKOFF_GAIN_GIVEBACK_20_PERCENT')assert(time-p.entryTime>=holdMinutes*60000);
  const fill=price*(1-slip),proceeds=p.qty*fill*(1-fee),pnl=proceeds-amount;
  cash+=proceeds;paidFees+=p.qty*fill*fee;realized+=pnl;sells++;
  trades.push({symbol:d.symbol,entryAt:p.entryAt,exitAt:new Date(time).toISOString(),entryPrice:p.entryPrice,sellPrice:fill,pnl,peakPrice:p.peakPrice,holdMinutes:(time-p.entryTime)/60000,reason,signalTime:p.signalTime});
  s.position=null;s.lastSale=time;
 }
 function enter(d,s,b,time){
  const setup=s.pending;if(!setup||s.position)return;
  if(time>=setup.signalTime+1200000||setup.signalTime<=s.lastSale||s.used.has(setup.patternId)){s.pending=null;return;}
  for(const [k,expiry] of s.cancelled)if(expiry<=time)s.cancelled.delete(k);
  if(s.cancelled.has(setup.patternId))return;
  const price=b.open;
  if(price<setup.springLow.price||price>=setup.targetPrice){s.cancelled.set(setup.patternId,setup.signalTime+1200000);s.pending=null;return;}
  if(price<=setup.firstLow.price)return;
  if(count()>=slots){rejected.slots++;blockedSignals.add(d.symbol+':'+setup.patternId);return;}
  if(cash<amount){rejected.cash++;return;}
  assert(time>setup.signalTime);
  const fill=price*(1+slip),entryAt=new Date(time).toISOString();
  s.position={strategyId:'WYCKOFF_5M_V1',exitPolicy:SPRING_EXIT_POLICY,entryPrice:fill,peakPrice:fill,entryAt,entryTime:time,minProfitHoldMs:holdMinutes*60000,qty:amount/(1+fee)/fill,signalTime:setup.signalTime};
  s.used.add(setup.patternId);s.pending=null;cash-=amount;paidFees+=amount-amount/(1+fee);buys++;binancePositionExit(s.position,fill,time);maxPositions=Math.max(maxPositions,count());
 }
 for(let t=Math.ceil(start/60000)*60000;t+59999<=end;t+=60000){
  for(const d of sets){const s=state.get(d.symbol),setup=d.signals.get(t);if(setup&&!s.position&&!s.used.has(setup.patternId)&&setup.signalTime>s.lastSale&&t<setup.signalTime+1200000){s.pending=setup;allSignals.add(d.symbol+':'+setup.patternId);}}
  // Events are chronological across all symbols. No slot is released by a later intraminute exit.
  for(let part=0;part<4;part++){
   const time=t+Math.floor(part*59999/3);
   for(const d of sets){const s=state.get(d.symbol),b=d.byMinute.get(t);if(!b)continue;
    const prices=route==='high'?[b.open,b.high,b.low,b.close]:[b.open,b.low,b.high,b.close];
    const price=prices[part],previous=part?prices[part-1]:null;
    if(s.position){const p=s.position;
     if(part&&price<previous&&price<=p.effectiveStopPrice&&previous>=p.effectiveStopPrice){
      const threshold=p.effectiveStopPrice;const result=binancePositionExit(p,threshold,time);assert(result.sell);sell(d,s,threshold,time,result.reason);
     }else{const result=binancePositionExit(p,price,time);if(result.sell)sell(d,s,price,time,result.reason);}
    }
    if(part===3)s.lastClose=b.close;
   }
   // Entry uses the first available minute open after confirmation, not a future candle extremum.
   if(part===0)for(const d of sets){const b=d.byMinute.get(t);if(b)enter(d,state.get(d.symbol),b,time);}
  }
  const value=cash+[...state.values()].reduce((sum,s)=>sum+(s.position?s.position.qty*s.lastClose*(1-slip)*(1-fee):0),0);
  peakEquity=Math.max(peakEquity,value);maxDrawdownPct=Math.max(maxDrawdownPct,(peakEquity-value)/peakEquity*100);occupiedMinutes+=count();
  if(t%900000===0)equity.push([t+59999,value]);
 }
 const open=[...state.entries()].filter(([s,v])=>v.position).map(([symbol,s])=>({symbol,entryAt:s.position.entryAt,value:s.position.qty*s.lastClose*(1-slip)*(1-fee)}));
 const net=cash+open.reduce((sum,p)=>sum+p.value,0)-initial;
 assert.equal(buys,sells+open.length);assert(Math.abs(cash-initial+amount*open.length-realized)<1e-7);assert(maxPositions<=slots);
 return {holdMinutes,route,buys,sells,open:open.length,net,realized,unrealizedNet:net-realized,feesPaid:paidFees,maxDrawdownPct,wins:trades.filter(t=>t.pnl>0).length,averageHoldMinutes:trades.reduce((sum,t)=>sum+t.holdMinutes,0)/(sells||1),maxPositions,averageOccupiedSlots:occupiedMinutes/((end-start)/60000),blockedDistinctSignals:blockedSignals.size,distinctSignals:allSignals.size,trades,openPositions:open,equity};
}
const results=[];for(const hold of [0,15])for(const route of ['low','high']){const r=simulate(hold,route);results.push(r);console.error('Result',JSON.stringify({...r,trades:undefined,equity:undefined,openPositions:undefined}));}
console.log(JSON.stringify({start:new Date(start).toISOString(),end:new Date(end).toISOString(),symbols,initial,amount,slots,feePerSide:fee,slippagePerSide:slip,assumptions:{entry:'next-minute open after closed 5m confirmation',universe:'fixed present-day 50 symbols; not historical rank reconstruction',profitLock:'entry + 80% of highest observed gain',hardStop:'10% always active',hold:'only profit-based sales delayed; peaks tracked during hold',route:'two assumed OHLC orders, not confidence bounds',history:'rolling 2016 closed 5m candles',sizing:'fixed amount, no profit reinvestment'},results},null,2));
