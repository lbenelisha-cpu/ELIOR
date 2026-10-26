import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {binancePositionExit,SPRING_EXIT_POLICY} from '../lib/binance-position-exit.mjs';
import {setup} from './wyckoff-demo-helper.mjs';
const now=Date.UTC(2026,9,15),step=300000;
const prices=[95,97,100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
const bars=prices.map((close,i)=>({openTime:now-(prices.length-i)*step,closeTime:now-(prices.length-i-1)*step-1,open:i<2?close-1:close,high:close,low:i<2?close-1:close,close,closed:true,timeframe:'5m'}));
const args={symbol:'CONFIRMUSDT',bars,price:81,priceAsOf:new Date(now).toISOString(),timeframe:'5m',now,entryMode:'wyckoff_confirmation'};
test('complete confirmation immediately authorizes entry above Spring without a retest',()=>{
 const ev=evaluateDailyTrade(args);assert.equal(ev.entryConfirmed,true);assert.equal(ev.rawDecision,'BUY');assert.ok(args.price>ev.strategy.springLow.price);
 assert.equal(ev.wyckoffTrade.entryMode,'wyckoff_confirmation');assert.equal(ev.wyckoffTrade.exitPolicy,SPRING_EXIT_POLICY);assert.equal(ev.wyckoffTrade.minProfitHoldMs,7*86400000);
 assert.doesNotThrow(()=>assertSpringEntryReady(ev.wyckoffTrade,82,now));
 assert.throws(()=>assertSpringEntryReady(ev.wyckoffTrade,80,now),/WAIT_WYCKOFF_ENTRY_PRICE/);
 assert.throws(()=>assertSpringEntryReady(ev.wyckoffTrade,107,now),/WAIT_WYCKOFF_ENTRY_PRICE/);
 assert.throws(()=>assertSpringEntryReady(ev.wyckoffTrade,82,ev.wyckoffTrade.signalExpiresAt),/STALE/);
});
test('no early, stale or reused setup entry; 10% / 80% exit policy remains intact',()=>{
 const ev=evaluateDailyTrade(args);
 assert.equal(evaluateDailyTrade({...args,bars:bars.slice(0,-4),now:now-4*step,priceAsOf:new Date(now-4*step).toISOString()}).entryConfirmed,false);
 assert.equal(evaluateDailyTrade({...args,usedPatternIds:[ev.wyckoffTrade.patternId]}).entryConfirmed,false);
 assert.throws(()=>evaluateDailyTrade({...args,priceAsOf:new Date(now-100000).toISOString()}),/WAIT_FRESH_PRICE/);
 const p={...ev.wyckoffTrade,entryAt:new Date(Date.now()-8*86400000).toISOString(),entryPrice:50,peakPrice:50};assert.equal(binancePositionExit(p,45.01).sell,false);assert.equal(binancePositionExit(p,45).sell,true);
 const q={...ev.wyckoffTrade,entryAt:new Date(Date.now()-8*86400000).toISOString(),entryPrice:50,peakPrice:50};binancePositionExit(q,60);assert.equal(q.effectiveStopPrice,58);assert.equal(binancePositionExit(q,58).sell,true);
});
test('Demo confirmation entry can buy above Spring and fills retain the same exit protection',async()=>{
 const x=setup();try{
  x.prices.BTC=81;
  const ev=evaluateDailyTrade(args),trade={...ev.wyckoffTrade,setup:{...ev.wyckoffTrade.setup,signalTime:Date.now()-1000},signalExpiresAt:Date.now()+60000};
  await x.trader.cycle([{...ev,symbol:'BTCUSDT',at:new Date().toISOString(),priceAsOf:new Date().toISOString(),wyckoffTrade:trade}]);
  assert.equal(x.orders.length,1,JSON.stringify(x.trader.state.lastCycle));assert.equal(x.trader.state.positions.BTCUSDT.stopLossPct,10);
  const position=x.trader.state.positions.BTCUSDT;
  assert.equal(position.minProfitHoldMs,7*86400000);assert.ok(Number.isFinite(Date.parse(position.profitHoldStartedAt)));
  x.prices.BTC=90;await x.trader.refresh();x.trader.updatePeaks();
  x.prices.BTC=85;await x.trader.refresh();assert.equal(x.trader.updatePeaks().size,0);
  const restored=new x.trader.constructor({key:'demo-key',secret:'demo-secret',enabled:true,maxPositions:3,stateFile:x.stateFile,fetcher:x.fetcher});
  assert.equal(restored.state.positions.BTCUSDT.profitHoldStartedAt,position.profitHoldStartedAt);
  assert.equal(restored.state.positions.BTCUSDT.peakPrice,90);
  assert.equal(restored.state.positions.BTCUSDT.minProfitHoldMs,7*86400000);
 }finally{x.close();}
});
test('server selects confirmed quality entries with a candle-close wait',()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(source,/exitEvaluator:wyckoffExit,entryMode:'confirmed_quality'/);
 assert.match(source,/waitForSpringRetest:false/);
 assert.doesNotMatch(source,/springSignalValidityMinutes:20/);
});
