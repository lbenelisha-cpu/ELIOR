import test from 'node:test';import assert from 'node:assert/strict';import {aggregateStockCandles} from '../lib/stock-chart-timeframes.mjs';import {markBarIndex} from '../lib/colmex-chart-marks.mjs';
const base=Date.parse('2026-10-16T13:30:00Z'),bars=Array.from({length:6},(_,i)=>({date:new Date(base+i*300000).toISOString(),open:100+i,high:110+i,low:90+i,close:101+i}));
test('10m/15m bars preserve actual open/high/low/close and session-open alignment',()=>{
 const ten=aggregateStockCandles(bars,'10min',base+3600000),fifteen=aggregateStockCandles(bars,'15min',base+3600000);assert.equal(ten.length,3);assert.equal(fifteen.length,2);assert.deepEqual([ten[0].open,ten[0].high,ten[0].low,ten[0].close],[100,111,90,102]);assert.deepEqual([fifteen[0].open,fifteen[0].high,fifteen[0].low,fifteen[0].close],[100,112,90,103]);assert.equal(ten[0].date,'2026-10-16T13:30:00.000Z');
 assert.equal(markBarIndex({at:base+8*60000},ten,'10min'),0);assert.equal(markBarIndex({at:base+29*60000},fifteen,'15min'),1);
});
test('missing historical constituents are not invented; current incomplete bucket is labeled open',()=>{
 const missing=aggregateStockCandles(bars.filter((_,i)=>i!==1),'10min',base+3600000);assert.equal(missing.length,2);assert.equal(missing[0].date,bars[2].date);
 const open=aggregateStockCandles(bars.slice(0,1),'10min',base+60000);assert.equal(open.length,1);assert.equal(open[0].closed,false);
 const nextDay=bars.slice(0,2).map(b=>({...b,date:new Date(Date.parse(b.date)+86400000).toISOString()}));assert.equal(aggregateStockCandles([...bars,...nextDay],'10min',base+2*86400000).length,4);
});
