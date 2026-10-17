import test from 'node:test';import assert from 'node:assert/strict';
import {scanWyckoffOccurrences,mergeWyckoffOccurrences} from '../lib/wyckoff-occurrences.mjs';
import {analyzeStockHistory,newSimulation} from '../lib/colmex-simulation.mjs';
import {numberedWyckoffOccurrences} from '../lib/colmex-chart-view.mjs';
const base=Date.parse('2026-10-16T13:30:00Z'),step=300000,pattern=[95,97,100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
function rows(closes){return closes.map((close,i)=>({open:i%pattern.length<2?close-1:close,high:close,low:i%pattern.length<2?close-1:close,close,openTime:base+i*step,closeTime:base+(i+1)*step,timeframe:'5m',closed:true}));}
test('one structural setup is counted once through Spring and later reclaim, with no future confirmation',()=>{
 const bars=rows(pattern),before=scanWyckoffOccurrences(bars.slice(0,13),{now:bars.at(-1).closeTime});assert.equal(before.length,0);
 const spring=scanWyckoffOccurrences(bars.slice(0,14),{now:bars.at(-1).closeTime});assert.equal(spring.length,1);assert.equal(spring[0].confirmedAt,null);
 const confirmed=scanWyckoffOccurrences(bars,{now:bars.at(-1).closeTime});assert.equal(confirmed.length,1);assert.equal(confirmed[0].id,spring[0].id);assert.equal(confirmed[0].confirmedAt,bars.at(-1).closeTime);assert.equal(mergeWyckoffOccurrences(spring,confirmed,bars.at(-1).closeTime).length,1);
});
test('consecutive completed setups get chronological numbers without counting repeated signal candles',()=>{
 const bars=rows([...pattern,...pattern,...pattern]),history=scanWyckoffOccurrences(bars,{now:bars.at(-1).closeTime});assert.equal(history.length,3);
 const plot=bars.map(b=>({...b,date:new Date(b.openTime).toISOString()}));assert.deepEqual(numberedWyckoffOccurrences(history,plot,'5min').map(x=>x.number),[1,2,3]);
 assert.deepEqual(numberedWyckoffOccurrences(history,plot.slice(17),'5min').map(x=>x.number),[1,2]);
 const invalid=bars.filter((_,i)=>i!==7);assert.throws(()=>scanWyckoffOccurrences(invalid,{now:bars.at(-1).closeTime}),/FIVE_MINUTE/);
});
test('analysis updates during an active position without altering trading state and retains history when data fails',()=>{
 const bars=rows([...pattern,...pattern]),now=bars.at(-1).closeTime,series={meta:{symbol:'TSLA',currency:'USD',type:'Common Stock'},values:bars.map(b=>({datetime:new Date(b.openTime).toISOString().slice(0,19).replace('T',' '),open:b.open,high:b.high,low:b.low,close:b.close}))},state=newSimulation(base);state.positions.TSLA={entryPrice:81,peakPrice:100};state.journal=[{side:'BUY',symbol:'TSLA',price:81}];
 const next=analyzeStockHistory(state,{symbol:'TSLA',series,now});assert.equal(next.assets.TSLA.wyckoffHistory.length,2);assert.deepEqual(next.positions,state.positions);assert.deepEqual(next.journal,state.journal);assert.equal(next.cash,state.cash);assert.equal(state.assets.TSLA,undefined);
 const failed=analyzeStockHistory(next,{symbol:'TSLA',series:null,now});assert.equal(failed.assets.TSLA.wyckoffHistory.length,2);assert.ok(failed.assets.TSLA.wyckoffAnalysisError);assert.equal(analyzeStockHistory(next,{symbol:'TSLA',series,now}).assets.TSLA.wyckoffHistory.length,2);
});

test('scheduler saves analysis even when a quote fails during an active position',async()=>{
 const {runSimulation}=await import('../lib/colmex-simulation-runner.mjs');const bars=rows([...pattern,...pattern]),now=bars.at(-1).closeTime,series={meta:{symbol:'TSLA',currency:'USD',type:'Common Stock'},values:bars.map(b=>({datetime:new Date(b.openTime).toISOString().slice(0,19).replace('T',' '),open:b.open,high:b.high,low:b.low,close:b.close}))},state=newSimulation(base);state.cursor=6;state.positions.TSLA={entryPrice:81,peakPrice:100};let saved;
 await runSimulation({now,store:{getWithMetadata:async()=>({data:state,etag:'1'}),setJSON:async(k,data)=>{saved=data;return {modified:true};}},td:async endpoint=>{if(endpoint==='quote')throw Error('quote unavailable');return series;}});
 assert.equal(saved.assets.TSLA.wyckoffHistory.length,2);assert.deepEqual(saved.positions,state.positions);assert.equal(saved.assets.TSLA.reason,'DATA_UNAVAILABLE_OR_PROVIDER_LIMIT');assert.equal(saved.cash,state.cash);
});
