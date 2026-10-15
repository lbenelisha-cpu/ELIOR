import test from 'node:test';import assert from 'node:assert/strict';
import {binancePositionExit as exit,SPRING_EXIT_POLICY} from '../lib/binance-position-exit.mjs';
import {liveFillAction,trackedLivePositions} from '../lib/wyckoff-live-positions.mjs';
const entry=Date.UTC(2026,9,15,4,42),minute=60000;
const holding=()=>({strategyId:'WYCKOFF_5M_V1',exitPolicy:SPRING_EXIT_POLICY,entryPrice:100,peakPrice:100,entryAt:new Date(entry).toISOString(),minProfitHoldMs:15*minute});
test('10% hard stop is active before the minimum profit holding time',()=>{
 const p=holding();assert.equal(exit(p,99,entry+1000).sell,false);assert.equal(exit(p,90,entry+2000).sell,true);
});
test('peak is recorded while 80% gain exit waits; exact 15-minute boundary activates at the current price',()=>{
 const p=holding();assert.equal(exit(p,110,entry+minute).sell,false);assert.equal(p.peakPrice,110);assert.equal(p.effectiveStopPrice,90);assert.equal(p.pendingProfitStopPrice,108);assert.equal(p.trailingActive,false);
 assert.equal(exit(p,105,entry+15*minute-1).sell,false);assert.equal(p.peakPrice,110);
 assert.equal(exit(p,105,entry+15*minute).reason,'WYCKOFF_GAIN_GIVEBACK_20_PERCENT');assert.equal(p.effectiveStopPrice,108);
 // A MARKET exit executes at the observed price, not the earlier 108 threshold.
});
test('rising market can keep running after 15 minutes and the gain floor never falls',()=>{
 const p=holding();exit(p,110,entry+minute);assert.equal(exit(p,120,entry+15*minute).sell,false);assert.equal(p.effectiveStopPrice,116);assert.equal(exit(p,117,entry+16*minute).sell,false);assert.equal(p.effectiveStopPrice,116);assert.equal(exit(p,116,entry+17*minute).sell,true);
});
test('restart retains original timer and observed peak rather than starting a fresh 15 minutes',()=>{
 const p=holding();exit(p,110,entry+minute);const restored=JSON.parse(JSON.stringify(p));
 assert.equal(exit(restored,107,entry+15*minute).sell,true);assert.equal(restored.peakPrice,110);
});
test('unprofitable position continues until 10% stop; old positions have no new waiting rule',()=>{
 const p=holding();assert.equal(exit(p,95,entry+16*minute).sell,false);assert.equal(exit(p,90,entry+17*minute).sell,true);
 const old={...holding(),minProfitHoldMs:0};exit(old,110,entry+1000);assert.equal(exit(old,108,entry+2000).sell,true);
});
test('exchange fill time anchors holding period even when order intent was earlier',()=>{
 const a=liveFillAction({executedQty:'1',cummulativeQuoteQty:'100',orderId:123,status:'FILLED',transactTime:entry+30000},
  {params:{symbol:'BTCUSDT',side:'BUY'},at:new Date(entry).toISOString(),meta:{wyckoffTrade:holding()}},[]);
 const p=trackedLivePositions([a]).BTCUSDT;exit(p,110,entry+minute);
 assert.equal(exit(p,105,entry+15*minute).sell,false);assert.equal(exit(p,105,entry+15*minute+30000).sell,true);
});
test('missing entry time cannot silently enable profit exits but never prevents the 10% hard stop',()=>{
 const p={...holding(),entryAt:undefined};assert.throws(()=>exit(p,110,entry+minute),/INVALID_POSITION_ENTRY_TIME/);assert.equal(exit(p,90,entry+minute).sell,true);
});
