import test from 'node:test';
import assert from 'node:assert/strict';
import {binancePositionExit as exit} from '../lib/binance-position-exit.mjs';
import {trackedLivePositions} from '../lib/wyckoff-live-positions.mjs';
import {evaluateDailyTrade} from '../lib/wyckoff-evaluation.mjs';
const holding=()=>({strategyId:'WYCKOFF_5M_V1',entryPrice:100,peakPrice:100,targetPrice:107});
test('immediate decline triggers at 2% entry loss',()=>{
 const p=holding();assert.equal(exit(p,98.01).sell,false);assert.equal(exit(p,98).reason,'WYCKOFF_STOP_LOSS_2_PERCENT');
});
test('7% target does not sell; rising peaks tighten the trailing stop',()=>{
 const p=holding();for(const price of [107,110,120])assert.equal(exit(p,price).sell,false);
 assert.equal(exit(p,117.01).sell,false);assert.equal(exit(p,117).reason,'WYCKOFF_TRAILING_2_5_PERCENT');assert.equal(p.peakPrice,120);
});
test('restart and partial sell retain LIVE high watermark',()=>{
 const buy={type:'BUY',symbol:'BTCUSDT',qty:1,price:100,wyckoffTrade:holding()};
 const p=trackedLivePositions([buy]).BTCUSDT;exit(p,120);buy.wyckoffTrade.peakPrice=p.peakPrice;
 const restored=trackedLivePositions(JSON.parse(JSON.stringify([{type:'SELL',symbol:'BTCUSDT',qty:.2},buy]))).BTCUSDT;
 assert.equal(restored.qty,.8);assert.equal(exit(restored,117).sell,true);
});
test('existing Wyckoff positions migrate on evaluation; scan uses Binance exit policy',()=>{
 const p={...holding(),stopPrice:94};const ev=evaluateDailyTrade({symbol:'BTCUSDT',bars:[],price:98,priceAsOf:new Date().toISOString(),position:p,exitEvaluator:exit});
 assert.equal(ev.rawDecision,'SELL');assert.equal(p.stopPrice,98);
 assert.throws(()=>exit({...holding(),entryPrice:undefined},100),/INVALID/);
 assert.equal(exit({entryPrice:100},98).sell,false);
});
