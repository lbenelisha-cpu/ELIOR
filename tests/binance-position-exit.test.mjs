import test from 'node:test';
import assert from 'node:assert/strict';
import {binancePositionExit as exit} from '../lib/binance-position-exit.mjs';
import {trackedLivePositions} from '../lib/wyckoff-live-positions.mjs';
import {evaluateDailyTrade} from '../lib/wyckoff-evaluation.mjs';
const holding=()=>({strategyId:'WYCKOFF_5M_V1',entryPrice:100,peakPrice:100,targetPrice:107,marketRank:21});
test('rank 21 decline triggers at 1% entry loss',()=>{
 const p=holding();assert.equal(exit(p,99.01).sell,false);assert.equal(exit(p,99).reason,'WYCKOFF_STOP_LOSS_1_PERCENT');
});
test('7% target does not sell; rising peaks tighten the trailing stop',()=>{
 const p=holding();for(const price of [107,110,120])assert.equal(exit(p,price).sell,false);
 assert.equal(exit(p,114.01).sell,false);assert.equal(exit(p,114).reason,'WYCKOFF_TRAILING_5_PERCENT');assert.equal(p.peakPrice,120);
});
test('restart and partial sell retain LIVE high watermark',()=>{
 const buy={type:'BUY',symbol:'BTCUSDT',qty:1,price:100,wyckoffTrade:holding()};
 const p=trackedLivePositions([buy]).BTCUSDT;exit(p,120);buy.wyckoffTrade.peakPrice=p.peakPrice;
 const restored=trackedLivePositions(JSON.parse(JSON.stringify([{type:'SELL',symbol:'BTCUSDT',qty:.2},buy]))).BTCUSDT;
 assert.equal(restored.qty,.8);assert.equal(exit(restored,114).sell,true);
});
test('existing Wyckoff positions migrate on evaluation; scan uses Binance exit policy',()=>{
 const p={...holding(),stopPrice:94};const ev=evaluateDailyTrade({symbol:'BTCUSDT',bars:[],price:98,priceAsOf:new Date().toISOString(),position:p,exitEvaluator:exit});
 assert.equal(ev.rawDecision,'SELL');assert.equal(p.stopPrice,99);
 assert.throws(()=>exit({...holding(),entryPrice:undefined},100),/INVALID/);
 assert.equal(exit({entryPrice:100},98).sell,false);
});

test('all ranking boundaries apply entry and peak stops',()=>{
 for(const [rank,loss,trail] of [[1,.5,.5],[10,.5,.5],[11,.5,1],[20,.5,1],[21,1,5],[50,1,5],[51,2.5,4],[100,2.5,4],[null,2.5,4]]){
  const p={...holding(),marketRank:rank};
  assert.equal(exit(p,100-loss).sell,true);
  const q={...holding(),marketRank:rank};exit(q,120);
  assert.equal(q.stopLossPct,loss);assert.equal(q.trailingStopPct,trail);
  assert.equal(exit(q,q.trailingStopPrice+.001).sell,false);
  assert.equal(exit(q,q.trailingStopPrice).sell,true);
 }
});
test('rank changes retain highest observed price',()=>{
 const p={...holding(),marketRank:1};exit(p,120);p.marketRank=51;
 assert.equal(exit(p,115).sell,true);assert.equal(p.peakPrice,120);
});
