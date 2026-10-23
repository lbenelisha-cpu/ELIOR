import test from 'node:test';import assert from 'node:assert/strict';
import {createChartReader} from '../lib/binance-chart-reader.mjs';
const STEP=300000;
function setup(){let now=Date.UTC(2026,9,23,8,1),calls=[],release;const gate=new Promise(r=>release=r);let blocked=false;const reader=createChartReader(async path=>{const p=new URL(path,'https://test').searchParams;calls.push(p);if(blocked)await gate;const out=[];for(let t=Number(p.get('startTime'));t<=Number(p.get('endTime'));t+=STEP)out.push([t,50,52,49,51,5,t+STEP-1]);return out;},{now:()=>now});return {reader,calls,advance:ms=>now+=ms,block:()=>blocked=true,release,now:()=>now};}
test('cold 5m week starts its three pages together and preserves full MA warmup and open candle',async()=>{
 const h=setup();h.block();const pending=h.reader.read('BTCUSDT','5m','1W');await new Promise(setImmediate);assert.equal(h.calls.length,3);h.release();const r=await pending;assert.ok(r.candles.length>2200);assert.equal(r.candles.at(-1).closed,false);assert.ok(r.candles[0].openTime<r.visibleStartTime-199*STEP);
});
test('warm chart reuses snapshot, then refetches only current and newly opened candles',async()=>{
 const h=setup(),a=await h.reader.read('BTCUSDT','5m','1W');const calls=h.calls.length;assert.equal(await h.reader.read('BTCUSDT','5m','1W'),a);assert.equal(h.calls.length,calls);h.advance(6*60000);const b=await h.reader.read('BTCUSDT','5m','1W');assert.equal(h.calls.length,calls+1);assert.equal(Number(h.calls.at(-1).get('startTime')),a.candles.at(-1).openTime);assert.equal(new Set(b.candles.map(c=>c.openTime)).size,b.candles.length);assert.equal(b.candles.find(c=>c.openTime===a.candles.at(-1).openTime).closed,true);
});
test('overlapping clients share pending reads and failed refresh does not masquerade as fresh data',async()=>{
 const h=setup();h.block();const a=h.reader.read('BTCUSDT','5m','1D'),b=h.reader.read('BTCUSDT','5m','1D');await new Promise(setImmediate);assert.equal(h.calls.length,1);h.release();assert.deepEqual(await a,await b);
 const bad=createChartReader(async()=>[]);await assert.rejects(bad.read('BTCUSDT','5m','1D'),/WAIT_CURRENT/);
});
