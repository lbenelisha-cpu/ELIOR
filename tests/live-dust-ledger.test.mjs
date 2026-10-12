import test from 'node:test';
import assert from 'node:assert/strict';
import {livePositionLedger,trackedLivePositions,liveBalancePnl} from '../lib/wyckoff-live-positions.mjs';
const buy=(qty=1,price=100)=>({type:'BUY',symbol:'BTCUSDT',qty,price,amountUsdt:qty*price,wyckoffTrade:{strategyId:'WYCKOFF_5M_V1',peakPrice:price}});
test('rounded BTC remainder leaves active trades but remains in accounting',()=>{
 const actions=[{type:'SELL',symbol:'BTCUSDT',qty:.00033,price:83595.97,amountUsdt:27.5866701},buy(.00033966,83750.17)];
 const ledger=livePositionLedger(actions);assert.deepEqual(ledger.positions,{});assert.ok(Math.abs(ledger.dust.BTCUSDT.qty-.00000966)<1e-12);
 assert.notEqual(liveBalancePnl({asset:'BTC',qty:.00000966,usdtPrice:83595.97,valueUsdt:.8075370702},actions).pnlIls,null);
});
test('partial sale with meaningful remaining value stays active',()=>{assert.equal(trackedLivePositions([{type:'SELL',symbol:'BTCUSDT',qty:.4,price:100},buy()]).BTCUSDT.qty,.6);});
test('new full purchase carries only recorded dust into its next sale',()=>{
 const first=buy(),sale={type:'SELL',symbol:'BTCUSDT',qty:.99,price:100},second=buy(1,120);
 const ledger=livePositionLedger([second,sale,first]);assert.deepEqual(ledger.dust,{});assert.equal(ledger.positions.BTCUSDT.qty,1.01);assert.equal(ledger.positions.BTCUSDT.entryPrice,120);assert.equal(ledger.positions.BTCUSDT.peakPrice,120);
 const done=livePositionLedger([{type:'SELL',symbol:'BTCUSDT',qty:1.01,price:125},second,sale,first]);assert.deepEqual(done,{positions:{},dust:{}});
});
test('dust cleanup sale reduces archived quantity without opening a position',()=>{
 const ledger=livePositionLedger([{type:'SELL',symbol:'BTCUSDT',qty:.01,price:100},{type:'SELL',symbol:'BTCUSDT',qty:.99,price:100},buy()]);
 assert.deepEqual(ledger,{positions:{},dust:{}});
});
test('symbol minimum from confirmed sale classifies remainder above default threshold',()=>{
 const ledger=livePositionLedger([{type:'SELL',symbol:'BTCUSDT',qty:.94,price:100,dustThresholdUsdt:10},buy()]);
 assert.deepEqual(ledger.positions,{});assert.ok(ledger.dust.BTCUSDT.valueAtSaleUsdt<10);
});
test('unsold small purchase is never silently archived',()=>{assert.ok(trackedLivePositions([buy(.01,100)]).BTCUSDT);});
