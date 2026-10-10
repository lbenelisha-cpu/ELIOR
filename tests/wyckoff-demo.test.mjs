import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DemoTrader} from '../lib/binance-demo-trader.mjs';
import {setup} from './wyckoff-demo-helper.mjs';
const trade={strategyId:'WYCKOFF_D1_V1',patternId:'daily-peak:spring',initialPeak:120,targetPrice:128.4,firstLow:90,springLow:85,stopLossPct:6,stopPrice:93.06};
const ev=()=>({ok:true,symbol:'BTCUSDT',at:new Date().toISOString(),score:100,entryConfirmed:true,entryStage:1,orderFraction:1,wyckoffTrade:{...trade},strategy:{sellConfirmed:false}});
test('actual fill fixes 2% stop; trailing peak sells and consumed patterns persist',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev()]);assert.equal(x.orders.length,1);assert.equal(x.trader.state.positions.BTCUSDT.stopPrice,98);assert.equal(x.trader.state.positions.BTCUSDT.targetPrice,128.4);
  x.prices.BTC=130;await x.trader.monitorExits();assert.equal(x.orders.length,1);
  x.prices.BTC=126;await x.trader.monitorExits();assert.equal(x.orders.at(-1).side,'SELL');assert.equal(x.trader.state.positions.BTCUSDT,undefined);
  x.trader.state.actionLog=[];x.trader.save();x.prices.BTC=100;await x.trader.cycle([ev()]);assert.equal(x.orders.length,2);
 }finally{x.close();}
});
test('stop monitor exits at 98 without a daily scan',async()=>{
 const x=setup();try{await x.trader.cycle([ev()]);x.prices.BTC=98;await x.trader.monitorExits();assert.equal(x.orders.length,2);assert.equal(x.trader.state.trades[0].exitReason,'WYCKOFF_STOP_LOSS_2_PERCENT');}finally{x.close();}
});
test('unknown accepted order recovers after restart with frozen levels and no duplicate buy',async()=>{
 const x=setup({timeout:true});try{
  await x.trader.cycle([ev()]);assert.equal(x.orders.length,1);assert.ok(JSON.parse(readFileSync(x.stateFile)).pending);
  const restarted=new DemoTrader({key:'demo-key',secret:'demo-secret',enabled:true,maxPositions:3,stateFile:x.stateFile,fetcher:x.fetcher});
  await restarted.cycle([ev()]);assert.equal(x.orders.length,1);assert.equal(restarted.state.positions.BTCUSDT.targetPrice,128.4);assert.equal(restarted.state.positions.BTCUSDT.stopPrice,98);assert.equal(restarted.state.pending,null);
 }finally{x.close();}
});
test('parallel scans cannot submit two orders for one pattern',async()=>{
 const x=setup();try{await Promise.all([x.trader.cycle([ev()]),x.trader.cycle([ev()])]);assert.equal(x.orders.length,1);}finally{x.close();}
});
test('legacy holding cannot silently use old trailing rules or a guessed initial peak',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev()]);delete x.trader.state.positions.BTCUSDT.strategyId;
  x.prices.BTC=80;await x.trader.monitorExits();assert.equal(x.orders.length,1);assert.equal(x.trader.state.positions.BTCUSDT.reviewRequired,'LEGACY_POSITION_REQUIRES_REVIEW');
 }finally{x.close();}
});
