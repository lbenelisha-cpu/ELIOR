import test from 'node:test';import assert from 'node:assert/strict';
import {binanceWyckoffHistory,visibleBinanceOccurrences} from '../lib/binance-wyckoff-history.mjs';
const step=300000,base=Date.parse('2026-10-16T00:00:00Z'),pattern=[95,97,100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
const bars=Array.from({length:51},(_,i)=>{const c=pattern[i%17],o=i%17<2?c-1:c;return {open:o,high:c,low:o,close:c,openTime:base+i*step,closeTime:base+(i+1)*step-1,closed:true};});
test('Binance independently scans recurring structures while preserving recorded active setup',()=>{
 const now=bars.at(-1).closeTime,r=binanceWyckoffHistory(bars,[],{},now);assert.equal(r.error,null);assert.equal(r.history.length,3);
 assert.deepEqual(visibleBinanceOccurrences(r.history,bars).map(x=>x.number),[1,2,3]);
 assert.deepEqual(visibleBinanceOccurrences(r.history,bars.slice(17)).map(x=>x.number),[1,2]);
 const active={setup:r.history[0].setup};const bad=binanceWyckoffHistory(bars.filter((_,i)=>i!==4),[],active,now);assert.ok(bad.error);assert.equal(bad.history.length,1);
});
test('open bars are excluded and unconfirmed waiting snapshots cannot overwrite actual recorded confirmation',()=>{
 const now=bars.at(-1).closeTime,setup=binanceWyckoffHistory(bars,[],{},now).history[0].setup;
 const actual={...setup,confirmation:{price:82,time:base+18*step,live:true}};
 const rows=[{at:new Date(base+19*step).toISOString(),setup:{...setup,confirmation:null},analysisSignal:false},{type:'BUY',at:new Date(base+18*step).toISOString(),wyckoffTrade:{setup:actual}}];
 const r=binanceWyckoffHistory([...bars,{...bars.at(-1),closed:false,closeTime:now+step}],rows,{},now);
 assert.equal(r.history[0].setup.confirmation.price,82);assert.equal(r.history.length,3);
});
