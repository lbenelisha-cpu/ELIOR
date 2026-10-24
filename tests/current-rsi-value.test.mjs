import test from 'node:test';import assert from 'node:assert/strict';
import {currentRsiValue} from '../lib/current-rsi-value.mjs';
import {rsiSeries} from '../lib/wyckoff-spring-rsi.mjs';
const base=Date.UTC(2026,9,20,13,30),bars=Array.from({length:30},(_,i)=>({date:new Date(base+i*300000).toISOString(),close:100+i%7,closeTime:base+(i+1)*300000})),end=bars.at(-1).closeTime;
test('RSI number follows current open-candle price without appending an extra close on every tick',()=>{
 const a=currentRsiValue(bars,{close:112,observedAt:end+1000},{now:end+1000}),b=currentRsiValue(bars,{close:95,observedAt:end+2000},{now:end+2000});assert.equal(a.live,true);assert.equal(a.closes.length,31);assert.equal(b.closes.length,31);assert.equal(a.value,rsiSeries([...bars.map(b=>b.close),112]).at(-1));assert.notEqual(a.value,b.value);
});
test('old/future quotes, history gaps and closed markets cannot show a fresh live RSI',()=>{
 for(const [live,options]of [[{close:112,observedAt:end-300000},{now:end+1000}],[{close:112,observedAt:end+10000},{now:end}],[{close:112,observedAt:end+600000},{now:end+600000}],[{close:112,observedAt:end+1000},{now:end+1000,marketClosed:true}]]){const r=currentRsiValue(bars,live,options);assert.equal(r.live,false);assert.equal(r.closes.length,30);}
});
test('no invented RSI before warmup; legitimate exchange session gaps can be supplied explicitly',()=>{
 assert.equal(currentRsiValue(bars.slice(0,5),null,{now:end}).value,null);
 assert.equal(currentRsiValue(bars,{close:110,observedAt:end+86400000},{now:end+86400000,isSessionGap:()=>true}).live,true);
});
