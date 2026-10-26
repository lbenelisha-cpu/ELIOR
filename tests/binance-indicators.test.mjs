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
const riseBars=prices=>prices.map((close,i)=>({openTime:1000000+i*300000,closeTime:1000000+(i+1)*300000-1,close,closed:true}));
const rises=globalThis.BinanceIndicators.risingMoves;
test('chart rises include exactly 1%, exclude smaller moves and combine shallow pullbacks',()=>{
 assert.equal(rises(riseBars([100,100.99])).length,0);
 assert.equal(rises(riseBars([100,101]))[0].pct,1);
 const moves=rises(riseBars([100,102,101.5,104,102.96]));assert.equal(moves.length,1);assert.equal(moves[0].pct,4);assert.equal(moves[0].status,'completed');assert.equal(moves[0].endIndex,3);
 assert.equal(rises(riseBars([100,99,98,97])).length,0);assert.equal(rises(riseBars([100,100,100])).length,0);
});
test('separate rising legs keep completed history stable while the last leg develops',()=>{
 const prices=[100,104,102.9,101,102.01],moves=rises(riseBars(prices));
 assert.equal(moves.length,2);assert.equal(moves[0].status,'completed');assert.equal(moves[1].status,'developing');assert.equal(moves[1].startPrice,101);assert.ok(Math.abs(moves[1].pct-1)<1e-10);
 const extended=rises(riseBars([...prices,105,106]));assert.deepEqual(extended[0],moves[0]);assert.equal(extended[1].endPrice,106);
});
test('rises never use open/future candles, bridge gaps or infer an intrabar path from wicks',()=>{
 const rows=riseBars([100,102,120]);rows[2].closed=false;rows[1].high=150;rows[1].low=20;
 assert.equal(rises(rows)[0].pct,2);assert.equal(rises(riseBars([100,102,120]),{now:rows[1].closeTime})[0].pct,2);
 const gap=riseBars([100,102,120,121.2]);gap[2].openTime+=300000;gap[2].closeTime+=300000;gap[3].openTime+=300000;gap[3].closeTime+=300000;
 const moves=rises(gap);assert.equal(moves.length,2);assert.equal(moves[0].status,'interrupted');assert.equal(moves[1].startPrice,120);
 assert.equal(rises(riseBars([100,NaN,105])).length,0);assert.equal(rises(riseBars([0,100,101]))[0].startPrice,100);
});
test('rise percentages work for tiny crypto prices and do not mutate input candles',()=>{
 const rows=riseBars([.000004,.00000408,.0000040392]),before=structuredClone(rows),moves=rises(rows);assert.ok(Math.abs(moves[0].pct-2)<1e-10);assert.equal(moves[0].status,'completed');assert.deepEqual(rows,before);
});
