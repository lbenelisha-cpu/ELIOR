import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../binance-chart-cache.js',import.meta.url),'utf8');
function setup(){let stored='{}',now=1800000000000;const window={localStorage:{getItem:()=>stored,setItem:(key,value)=>{stored=value;}}};vm.runInNewContext(source,{window,Date:class extends Date{static now(){return now;}}});return {cache:window.LEVI_CHART_CACHE,stored:()=>JSON.parse(stored),advance:ms=>now+=ms};}
const chart={visibleStartTime:1,candles:[{openTime:1799999400000,closeTime:1799999699999,open:50,high:52,low:49,close:51}],account:{secret:'never persist'},actions:[{type:'BUY'}]};
test('public candle cache survives reload data, excludes account and action information, and expires',()=>{
 const h=setup();h.cache.write('BTCUSDT:5m:1W:live',chart);const saved=h.cache.read('BTCUSDT:5m:1W:live');assert.equal(saved.candles[0].close,51);assert.equal(saved.account,undefined);assert.equal(saved.actions,undefined);assert.equal(h.cache.read('BTCUSDT:5m:1W:demo'),null);h.advance(86400001);assert.equal(h.cache.read('BTCUSDT:5m:1W:live'),null);
});
test('cache is bounded and rejects invalid OHLC or future observations',()=>{
 const h=setup();for(let i=0;i<8;i++)h.cache.write(String(i),chart);assert.equal(Object.keys(h.stored()).length,4);
 h.cache.write('bad',{candles:[{...chart.candles[0],high:1}]});assert.equal(h.cache.read('bad'),null);
 h.cache.write('future',{candles:[{...chart.candles[0],openTime:1900000000000}]});assert.equal(h.cache.read('future'),null);
});
