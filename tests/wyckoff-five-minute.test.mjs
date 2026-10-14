import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from '../lib/wyckoff-strategy.mjs';
import {evaluateDailyTrade} from '../lib/wyckoff-evaluation.mjs';
import {loadFiveMinuteBars} from '../lib/wyckoff-five-minute-data.mjs';
import {setup} from './wyckoff-demo-helper.mjs';
const prices=[95,97,100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
const step=300000,now=Date.UTC(2026,9,10,12);
const bars=prices.map((close,i)=>({openTime:now-(prices.length-i)*step,closeTime:now-(prices.length-i-1)*step-1,open:i<2?close-1:close,high:close,low:i<2?close-1:close,close,timeframe:'5m',closed:true}));
test('5m sequence is causal, uses wick pivots and has a separate saved trade identity',()=>{
 const before=evaluateWyckoff(bars.slice(0,-1),{now,timeframe:'5m'});assert.equal(before.buyConfirmed,false);
 const s=evaluateWyckoff(bars,{now,timeframe:'5m'});assert.equal(s.buyConfirmed,true);assert.equal(s.firstLow.price,80);
 const trade=createWyckoffTrade(s,82);assert.equal(trade.strategyId,'WYCKOFF_5M_V1');assert.equal(trade.timeframe,'5m');assert.match(trade.patternId,/^5m:/);
 assert.equal(wyckoffExit(trade,107).sell,true);assert.equal(wyckoffExit(trade,82*.94).sell,true);
});
test('incomplete, gapped, wrong-timeframe and stale bars cannot confirm a new 5m entry',()=>{
 const args={symbol:'BTCUSDT',bars,price:81,priceAsOf:new Date(now).toISOString(),timeframe:'5m',now};
 assert.equal(evaluateDailyTrade(args).entryConfirmed,true);
 assert.equal(evaluateDailyTrade({...args,now:now+step,priceAsOf:new Date(now+step).toISOString()}).buyReason,'STALE_5M_SIGNAL');
 for(const invalid of [bars.slice(1).filter((_,i)=>i!==4),bars.map(x=>({...x,timeframe:'1d'})),bars.map((x,i)=>i===prices.length-1?{...x,closed:false}:x)])assert.throws(()=>evaluateWyckoff(invalid,{timeframe:'5m',now}));
 const trade=createWyckoffTrade(evaluateWyckoff(bars,{timeframe:'5m',now}),81);
 assert.equal(evaluateDailyTrade({...args,usedPatternIds:[trade.patternId]}).entryConfirmed,false);
});
test('paging retrieves all 2016 closed weekly bars and excludes the open candle',async()=>{
 const end=now-1,start=now-7*86400000;
 const data=Array.from({length:2017},(_,i)=>[start+i*step,'100','101','99','100','10',start+(i+1)*step-1]);
 const calls=[];
 const fetcher=async path=>{const q=new URL('https://x'+path).searchParams;calls.push(q);return data.filter(x=>x[0]>=Number(q.get('startTime'))).slice(0,1000);};
 const result=await loadFiveMinuteBars(fetcher,'BTCUSDT',now);
 assert.equal(result.length,2016);assert.equal(result[0].openTime,start);assert.equal(result.at(-1).closeTime,end);assert.equal(calls.length,3);assert.equal(calls[0].get('interval'),'5m');
 await assert.rejects(()=>loadFiveMinuteBars(async()=>data.slice(0,10),'BTCUSDT',now),/PAGINATION|CURRENT_5M/);
});
test('5m fills retain targets, count trades, exit and cannot buy the same pattern twice',async()=>{
 const x=setup();try{
  const s=evaluateWyckoff(bars,{timeframe:'5m',now});
  const ev={ok:true,symbol:'BTCUSDT',at:new Date().toISOString(),score:100,entryConfirmed:true,entryStage:1,orderFraction:1,wyckoffTrade:createWyckoffTrade(s,100),strategy:{timeframe:'5m',wyckoff:s,sellConfirmed:false}};
  await x.trader.cycle([ev]);assert.equal(x.orders.length,1);assert.equal(x.trader.wyckoffStats().buys,1);
  assert.equal(x.trader.state.positions.BTCUSDT.strategyId,'WYCKOFF_5M_V1');
  x.prices.BTC=107;await x.trader.monitorExits();assert.equal(x.orders.length,1);
  x.prices.BTC=102;await x.trader.monitorExits();assert.equal(x.orders.length,2);assert.equal(x.trader.wyckoffStats().sells,1);
  x.prices.BTC=100;await x.trader.cycle([ev]);assert.equal(x.orders.length,2);
 }finally{x.close();}
});
test('pending signal survives three additional closed bars and then expires',()=>{
 const extend=n=>[...bars,...Array.from({length:n},(_,i)=>({openTime:now+i*step,closeTime:now+(i+1)*step-1,open:82,high:83,low:81,close:82,timeframe:'5m',closed:true}))];
 const original=evaluateWyckoff(bars,{now,timeframe:'5m'});
 for(let n=1;n<=3;n++){
  const time=now+n*step;
  const ev=evaluateDailyTrade({symbol:'PENDINGUSDT',bars:extend(n),price:82,priceAsOf:new Date(time).toISOString(),now:time,timeframe:'5m'});
  assert.equal(ev.entryConfirmed,true);assert.equal(ev.strategy.patternId,original.patternId);assert.equal(ev.strategy.signalTime,original.signalTime);
  assert.equal(evaluateDailyTrade({symbol:'USEDUSDT',bars:extend(n),price:82,priceAsOf:new Date(time).toISOString(),now:time,timeframe:'5m',usedPatternIds:[original.patternId]}).entryConfirmed,false);
 }
 assert.equal(evaluateWyckoff(extend(4),{now:now+4*step,timeframe:'5m'}).buyConfirmed,false);
 for(const change of [{low:77},{high:107}]){
  const data=extend(2);Object.assign(data[bars.length],change);
  assert.equal(evaluateWyckoff(data,{now:now+2*step,timeframe:'5m'}).buyConfirmed,false);
 }
});
test('live Spring break or target touch permanently cancels pending pattern in this process',()=>{
 for(const [symbol,price] of [['BREAKUSDT',77],['TARGETUSDT',107]]){
  const args={symbol,bars,price,priceAsOf:new Date(now).toISOString(),now,timeframe:'5m'};
  assert.equal(evaluateDailyTrade(args).buyReason,'WYCKOFF_SIGNAL_INVALIDATED');
  assert.equal(evaluateDailyTrade({...args,price:82}).entryConfirmed,false);
 }
});
test('5m initial peak requires two strictly preceding closed green candles',()=>{
 const valid=evaluateWyckoff(bars,{now,timeframe:'5m'});
 assert.equal(valid.buyConfirmed,true);
 assert.equal(valid.minGreenBeforePeak,2);
 assert.equal(valid.initialPeak.index,2);
 for(const variant of ['red','doji','missing']){
  const changed=bars.map(b=>({...b}));
  if(variant==='red'){changed[0].open=changed[0].close+1;changed[0].high=changed[0].open;}
  if(variant==='doji')changed[0].open=changed[0].close;
  if(variant==='missing')delete changed[0].open;
  assert.equal(evaluateWyckoff(changed,{now,timeframe:'5m'}).buyConfirmed,false,variant);
 }
 // The peak candle itself cannot substitute for a missing preceding green candle.
 const peakGreen=bars.map(b=>({...b}));peakGreen[0].open=peakGreen[0].close;peakGreen[2].open=peakGreen[2].close-1;peakGreen[2].low=peakGreen[2].open;
 assert.equal(evaluateWyckoff(peakGreen,{now,timeframe:'5m'}).buyConfirmed,false);
});
test('5m peak qualification is causal for every historical prefix',()=>{
 for(let i=3;i<=bars.length;i++){
  const result=evaluateWyckoff(bars.slice(0,i),{now:bars[i-1].closeTime,timeframe:'5m'});
  if(result.initialPeak){const k=result.initialPeak.index;assert.ok(k>=2);assert.ok(bars[k-1].close>bars[k-1].open);assert.ok(bars[k-2].close>bars[k-2].open);}
 }
 assert.throws(()=>evaluateWyckoff(bars,{now,timeframe:'5m',minGreenBeforePeak:-1}),/INVALID_GREEN_PEAK_COUNT/);
});
