import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {FIVE_MINUTE_MS} from '../lib/wyckoff-five-minute-data.mjs';
const D=300000,end=Date.parse('2026-11-06T20:00Z');
test('Spot history loads are shared and an older REST request cannot overwrite a newer closed-bar cache',async()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const fragment=source.slice(source.indexOf('const candleLoads=new Map();'),source.indexOf('\nfunction markPaperToMarket()',source.indexOf('const candleLoads=new Map();')));
 let now=end+10,resolve,calls=0;const cache=new Map();const c=vm.createContext({Map,Date:{now:()=>now},FIVE_MINUTE_MS,dailyCandleCache:cache,j:()=>{},loadFiveMinuteBars:()=>{calls++;return new Promise(r=>resolve=r);}});
 vm.runInContext(fragment+'\nglobalThis.read=candles;',c);const a=c.read('ABCUSDT'),b=c.read('ABCUSDT');assert.equal(calls,1);
 now+=D;cache.set('ABCUSDT',{bucket:Math.floor(now/D),rows:['authoritative next bar']});resolve(['older REST']);await Promise.all([a,b]);assert.deepEqual(cache.get('ABCUSDT').rows,['authoritative next bar']);
});
test('the real Spot execution cycle serializes broad and fast decisions and never repeats a filled receipt',async()=>{
 const {LiveExecutionLock}=await import('../lib/live-execution-lock.mjs');const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function executeLiveCycle('),end=source.indexOf('\nlet lastDisplayAccount=',start),code=source.slice(start,end);
 const receipts=[],account={balances:[],usdtFree:100},lock=new LiveExecutionLock();let writes=0;
 const context=vm.createContext({mode:'live',LIVE:true,AUTO_EXECUTION:true,liveStateHealth:{journalReady:true},liveOrders:{pending:null,recover:async()=>{}},liveManagedPositions:()=>({}),tradeControl:{paused:false},liveActionLog:receipts,getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),recordLiveFill:()=>{},getLiveAccountSnapshot:async()=>account,reconcileLiveHoldings:async()=>account,liveReadiness:()=>({ready:true}),nativeProtection:{rows:{}},newsEntryCandidates:x=>x,LIVE_MAX_POSITIONS:3,LIVE_MAX_USDT:35,liveNextBuyAllocation:()=>({ok:true,amountUsdt:35}),KELLY_RULESET:'test',POC_LIVE_REQUESTED:false,placeLiveMarketBuy:async(symbol,amount,reason,detail)=>{writes++;receipts.push({type:'BUY',symbol,...detail});},Set});
 vm.runInContext(code+'\nglobalThis.run=executeLiveCycle;',context);
 const ev={symbol:'ABCUSDT',ok:true,entryConfirmed:true,wyckoffTrade:{patternId:'one-current-return'}};
 await Promise.all([lock.automatic(()=>context.run([ev])),lock.automatic(()=>context.run([ev]))]);await lock.automatic(()=>context.run([ev]));assert.equal(writes,1);
});
