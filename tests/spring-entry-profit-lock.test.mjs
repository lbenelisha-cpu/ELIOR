import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {binancePositionExit as exit,SPRING_EXIT_POLICY} from '../lib/binance-position-exit.mjs';
import {liveFillAction,trackedLivePositions} from '../lib/wyckoff-live-positions.mjs';
import {setup} from './wyckoff-demo-helper.mjs';
const now=Date.UTC(2026,9,15),step=300000;
const prices=[95,97,100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
const bars=prices.map((close,i)=>({openTime:now-(prices.length-i)*step,closeTime:now-(prices.length-i-1)*step-1,open:i<2?close-1:close,high:close,low:i<2?close-1:close,close,closed:true,timeframe:'5m'}));
const args=symbol=>({symbol,bars,price:81,priceAsOf:new Date(now).toISOString(),timeframe:'5m',now,entryMode:'spring_retest'});
const holding=()=>({strategyId:'WYCKOFF_5M_V1',entryPrice:50,peakPrice:50,exitPolicy:SPRING_EXIT_POLICY,entryMode:'spring_retest'});
test('Spring low alone cannot buy; full confirmation arms a retest, not a market chase',()=>{
 const a=args('SPRINGCAUSALUSDT');
 const before=evaluateDailyTrade({...a,bars:bars.slice(0,-1),now:now-step,price:78,priceAsOf:new Date(now-step).toISOString()});
 assert.equal(before.entryConfirmed,false);
 const wait=evaluateDailyTrade(a);assert.equal(wait.buyReason,'WAIT_SPRING_RETEST');assert.equal(wait.entryConfirmed,false);assert.equal(wait.entryBasePrice,78);
 const retest=evaluateDailyTrade({...a,price:77.99});assert.equal(retest.entryConfirmed,true);assert.equal(retest.buyReason,'WYCKOFF_SPRING_RETEST');assert.equal(retest.wyckoffTrade.stopLossPct,10);assert.equal(retest.wyckoffTrade.atrEnabled,false);
 assert.equal(evaluateDailyTrade({...a,price:78,usedPatternIds:[retest.wyckoffTrade.patternId]}).entryConfirmed,false);
});
test('armed confirmation survives the retest candle without requiring price above first low',()=>{
 const a=args('SPRINGCARRYUSDT');evaluateDailyTrade(a);
 const later=[...bars,{openTime:now,closeTime:now+step-1,open:81,high:81,low:77,close:77.9,closed:true,timeframe:'5m'}];
 const retest=evaluateDailyTrade({...a,bars:later,now:now+step,price:77.9,priceAsOf:new Date(now+step).toISOString()});
 assert.equal(retest.entryConfirmed,true);assert.equal(retest.wyckoffTrade.springEntryPrice,78);
});
test('expired, stale, target-invalidated and reused confirmations cannot enter',()=>{
 const a=args('SPRINGEXPIREUSDT');evaluateDailyTrade(a);
 assert.equal(evaluateDailyTrade({...a,price:78,now:now+step+1,priceAsOf:new Date(now+step+1).toISOString()}).entryConfirmed,false);
 assert.equal(evaluateDailyTrade({...a,price:78,now:now+1200000,priceAsOf:new Date(now+1200000).toISOString()}).entryConfirmed,false);
 const b=args('SPRINGTARGETUSDT');evaluateDailyTrade(b);assert.equal(evaluateDailyTrade({...b,price:107}).buyReason,'WYCKOFF_SIGNAL_INVALIDATED');assert.equal(evaluateDailyTrade({...b,price:78}).entryConfirmed,false);
});
test('immediate decline is permitted to 10% before the first profitable peak',()=>{
 const p=holding();assert.equal(exit(p,49).sell,false);assert.equal(exit(p,45.01).sell,false);assert.equal(p.effectiveStopPrice,45);
 assert.equal(exit(p,45).reason,'WYCKOFF_SPRING_STOP_LOSS_10_PERCENT');
});
test('retains 80% of gain, raises with new peaks and never loosens',()=>{
 const p=holding();assert.equal(exit(p,60).sell,false);assert.equal(p.effectiveStopPrice,58);
 assert.equal(exit(p,59).sell,false);assert.equal(p.effectiveStopPrice,58);
 assert.equal(exit(p,70).sell,false);assert.equal(p.effectiveStopPrice,66);
 assert.equal(exit(p,66).reason,'WYCKOFF_GAIN_GIVEBACK_20_PERCENT');
 const tiny=holding();exit(tiny,50.01);assert.ok(Math.abs(tiny.effectiveStopPrice-50.008)<1e-10);
});
test('fill price anchors 10% stop and persisted peak survives restart',()=>{
 const a=liveFillAction({executedQty:'1',cummulativeQuoteQty:'50',orderId:1,status:'FILLED'},
  {params:{symbol:'BTCUSDT',side:'BUY'},at:new Date(now).toISOString(),meta:{wyckoffTrade:{...holding(),entryPrice:55,stopPrice:49.5}}},[]);
 assert.equal(a.wyckoffTrade.entryPrice,50);assert.equal(a.wyckoffTrade.stopPrice,45);
 const p=trackedLivePositions([a]).BTCUSDT;exit(p,60);Object.assign(a.wyckoffTrade,{peakPrice:p.peakPrice,effectiveStopPrice:p.effectiveStopPrice});
 const restored=trackedLivePositions(JSON.parse(JSON.stringify([a]))).BTCUSDT;
 assert.equal(exit(restored,58).sell,true);assert.equal(restored.effectiveStopPrice,58);
});
test('order recheck rejects expired or rebounded prices after account requests',()=>{
 const a=args('SPRINGORDERUSDT');evaluateDailyTrade(a);const trade=evaluateDailyTrade({...a,price:78}).wyckoffTrade;
 assert.doesNotThrow(()=>assertSpringEntryReady(trade,78,now));assert.throws(()=>assertSpringEntryReady(trade,79,now),/WAIT_SPRING_RETEST/);
 assert.throws(()=>assertSpringEntryReady(trade,78,trade.springSignalExpiresAt),/STALE_5M_SIGNAL/);
});
test('Demo settlement keeps the new stop policy and monitor enforces profit giveback',async()=>{
 const x=setup();try{
  x.prices.BTC=50;
  const trade={...holding(),springEntryPrice:50,springSignalExpiresAt:Date.now()+60000,
    patternId:'spring-demo-fresh',setup:{signalTime:Date.now()-1000},entryMode:'spring_retest',timeframe:'5m'};
  await x.trader.cycle([{ok:true,symbol:'BTCUSDT',entryConfirmed:true,at:new Date().toISOString(),score:100,wyckoffTrade:trade,buyReason:'WYCKOFF_SPRING_RETEST'}]);
  assert.equal(x.orders.length,1,JSON.stringify(x.trader.state.lastCycle));assert.equal(x.trader.state.positions.BTCUSDT.stopPrice,45);
  x.prices.BTC=49;await x.trader.monitorExits();assert.equal(x.orders.length,1);
  x.prices.BTC=60;await x.trader.monitorExits();assert.equal(x.orders.length,1);
  x.prices.BTC=58;await x.trader.monitorExits();assert.equal(x.orders.length,2);
 }finally{x.close();}
});
