import test from 'node:test';
import assert from 'node:assert/strict';
import '../binance-indicators.js';
const calculate=globalThis.BinanceIndicators.calculateIndicators;
const bars=prices=>prices.map(close=>({close}));
test('RSI Wilder smoothing matches published example sequence',()=>{
 const prices=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00];
 const {rsi}=calculate(bars(prices));assert.equal(rsi[13],null);assert.ok(Math.abs(rsi[14]-70.464135)<.00001);assert.ok(Math.abs(rsi[15]-66.249619)<.00001);
});
test('flat, rising and falling prices handle zero average gains and losses',()=>{
 assert.equal(calculate(bars(Array(20).fill(100))).rsi.at(-1),50);
 assert.equal(calculate(bars(Array.from({length:20},(_,i)=>100+i))).rsi.at(-1),100);
 assert.equal(calculate(bars(Array.from({length:20},(_,i)=>100-i))).rsi.at(-1),0);
});
test('ROC uses 12-bar lag and reports percentage; insufficient history stays unknown',()=>{
 const p=Array(12).fill(100).concat(110,90);const {roc}=calculate(bars(p));assert.equal(roc[11],null);assert.ok(Math.abs(roc[12]-10)<1e-10);assert.ok(Math.abs(roc[13]+10)<1e-10);
 assert.deepEqual(calculate(bars([100,101])).rsi,[null,null]);
});
