import test from 'node:test';import assert from 'node:assert/strict';
import {createChartViewport} from '../lib/chart-viewport.mjs';
const rows=Array.from({length:2016},(_,i)=>({openTime:Date.UTC(2026,9,22)+i*300000,close:i}));
test('opens at the latest readable window without changing the analysis history',()=>{
 const v=createChartViewport(),before=JSON.stringify(rows);
 const desktop=v.view(rows,{context:'BTC:5m',width:1200});assert.equal(desktop.size,96);assert.equal(desktop.bars.at(-1),rows.at(-1));
 const mobile=v.view(rows,{context:'BTC:5m',width:320});assert.equal(mobile.size,24);assert.equal(mobile.bars.at(-1),rows.at(-1));assert.equal(JSON.stringify(rows),before);
});
test('historical viewport stays anchored across append and rolling history expiry; latest resumes following',()=>{
 const v=createChartViewport();v.view(rows,{context:'A'});v.seek(500);const first=v.view(rows,{context:'A'}).bars[0];
 const refreshed=[...rows.slice(10),{openTime:rows.at(-1).openTime+300000}];
 const r=v.view(refreshed,{context:'A'});assert.equal(r.bars[0],first);assert.equal(r.start,490);assert.equal(r.following,false);
 v.latest();assert.equal(v.view(refreshed,{context:'A'}).bars.at(-1),refreshed.at(-1));
});
test('zoom retains historical start, changing symbol or timeframe resets to latest',()=>{
 const v=createChartViewport();const initial=v.view(rows,{context:'A',width:850});v.seek(200);v.zoom(.5);
 const zoom=v.view(rows,{context:'A'});assert.equal(zoom.start,200);assert.equal(zoom.size,Math.round(initial.size/2));
 const changed=v.view(rows,{context:'B'});assert.equal(changed.following,true);assert.equal(changed.bars.at(-1),rows.at(-1));
 v.showAll();assert.equal(v.view(rows,{context:'B'}).size,rows.length);v.reset();assert.ok(v.view(rows,{context:'B'}).size<100);
});
test('empty and short histories, out-of-range navigation and source replacement stay bounded',()=>{
 const v=createChartViewport();assert.equal(v.view([]).size,0);v.seek(100);v.zoom(.5);
 const short=rows.slice(0,2);assert.deepEqual(v.view(short).bars,short);v.move(-999);assert.equal(v.view(short).start,0);
 v.view(rows);v.seek(-100);assert.equal(v.view(rows).start,0);v.seek(99999);assert.equal(v.view(rows).following,true);
 v.seek(500);assert.equal(v.view(rows.slice(700)).start,0);
});
test('Colmex calendar gaps are navigated by actual candles; both timestamp formats work',()=>{
 const stock=[...rows.slice(0,80),...rows.slice(900,980)].map(b=>({date:new Date(b.openTime).toISOString()}));
 const v=createChartViewport();v.view(stock,{width:320});v.seek(65);const r=v.view(stock,{width:320});assert.equal(r.size,24);assert.deepEqual(r.bars,stock.slice(65,89));
});
