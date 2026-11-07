import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PocFastWatch,createPocFastLane,POC_FAST_WATCH_POLICY} from '../lib/poc-fast-watch.mjs';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {channelEntry,channelEntryConfig,assertChannelSubmission} from '../lib/channel-primary-entry.mjs';
import {shortSignal,shortConfig} from '../lib/futures-short-policy.mjs';
import {appendClosedFiveMinuteBar,FIVE_MINUTE_MS} from '../lib/wyckoff-five-minute-data.mjs';
const D=300000,end=Date.parse('2026-11-06T20:00Z');
const config=channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true',BINANCE_CHANNEL_PRIMARY_AFTER:new Date(end-D).toISOString()});
const prepare=(side='LONG')=>{
 const input=pocFixture({side,end}),c=side==='LONG'?config:shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:new Date(end-D).toISOString()});
 const evaluate=i=>(side==='LONG'?channelEntry:shortSignal)(i,c);
 const ready=evaluate(input),waiting=structuredClone(input);waiting.price+=side==='LONG'?.1:-.1;waiting.liveBar.close=waiting.price;
 if(side==='LONG')waiting.liveBar.low=waiting.price;else waiting.liveBar.high=waiting.price;
 return {input,waiting,ready,result:evaluate(waiting),evaluate};
};
for(const side of ['LONG','SHORT'])test(side+' arms on the three completed structural gates; invalidation and stale/future evidence cannot arm',()=>{
 const f=prepare(side),w=new PocFastWatch({},()=>f.input.now);assert.equal(f.result.reason,'WAIT_POC_RETEST');w.observe('ABCUSDT',f.result);assert.equal(w.list(['ABCUSDT']).length,1);
 for(const id of ['channel','break','range']){const bad=structuredClone(f.result);bad.conditions.rows.find(r=>r.id===id).state='waiting';w.observe('ABCUSDT',bad);assert.equal(w.list(['ABCUSDT']).length,0,id);}
 for(const at of [f.input.now+1,f.input.now-15000]){const bad=structuredClone(f.result);bad.conditions.at=at;w.observe('ABCUSDT',bad);assert.equal(w.list(['ABCUSDT']).length,0);}
 w.observe('ABCUSDT',f.result);w.observe('ABCUSDT',{reason:'WAIT_CHANNEL_LIVE_BAR'});assert.equal(w.list(['ABCUSDT']).length,1);
 assert.equal(w.list(['ABCUSDT'],f.input.now+POC_FAST_WATCH_POLICY.maxEvidenceAgeMs).length,0);
 w.observe('ABCUSDT',f.result);assert.equal(w.list([]).length,0,'unwatched and held symbols are removed');
});
test('priority rotation is bounded and each candidate is polled at most once per two seconds',()=>{
 const f=prepare();let now=f.input.now;const w=new PocFastWatch({},()=>now);
 for(const s of ['CCC','AAA','BBB'])w.observe(s,f.result);
 assert.deepEqual([w.take(['AAA','BBB','CCC']),w.take(['AAA','BBB','CCC']),w.take(['AAA','BBB','CCC']),w.take(['AAA','BBB','CCC'])],['AAA','BBB','CCC',null]);
 now+=2000;assert.equal(w.take(['AAA','BBB','CCC']), 'AAA');
});
test('Spot fast lane uses a fresh final policy, ignores UI refresh and remains single-flight',async()=>{
 const f=prepare();let now=f.input.now,quote=f.waiting,release,entered=0,reads=0;
 const w=new PocFastWatch({},()=>now);w.observe('ABCUSDT',f.result);
 const lane=createPocFastLane({watch:w,symbols:()=>['ABCUSDT'],enabled:()=>true,now:()=>now,evaluate:async()=>{reads++;await new Promise(r=>release=r);const r=f.evaluate(quote);return {ok:true,entryConfirmed:r.ready,trade:r.setup};},execute:async rows=>{const r=rows[0];assertChannelSubmission(quote,config,{entryMode:'channel_breakout',patternId:r.trade.patternId,setup:r.trade});entered++;}});
 const a=lane.tick();await lane.tick();assert.equal(reads,1);release();await a;assert.equal(entered,0);
 now+=2000;quote=f.input;const b=lane.tick();release();await b;assert.equal(entered,1,'a current POC touch is evaluated without waiting for the broad scan or display');
});
test('pause during an evaluation and a bounced POC quote prevent dispatch',async()=>{
 const f=prepare();let enabled=true,execute=0;const w=new PocFastWatch({},()=>f.input.now);w.observe('ABCUSDT',f.result);
 const lane=createPocFastLane({watch:w,symbols:()=>['ABCUSDT'],enabled:()=>enabled,evaluate:async()=>{enabled=false;return {ok:true,entryConfirmed:true};},execute:()=>execute++});
 await lane.tick();assert.equal(execute,0);
 const trade={entryMode:'channel_breakout',patternId:f.ready.setup.patternId,setup:f.ready.setup};
 assert.throws(()=>assertChannelSubmission(f.waiting,config,trade),/WAIT_POC_RETEST/);
});
test('authoritative closed WebSocket bars bridge rollover; gaps, duplicates and malformed data require REST',()=>{
 const row={openTime:end-D,closeTime:end-1,open:100,close:101,low:99,high:102,volume:10,closed:true};
 const cached={bucket:(end-D)/D,rows:[{...row,openTime:end-2*D,closeTime:end-D-1}]};
 const next=appendClosedFiveMinuteBar(cached,row,end+5);assert.equal(next.bucket,end/D);assert.equal(next.rows.length,2);assert.equal(cached.rows.length,1);
 assert.equal(appendClosedFiveMinuteBar(next,row,end+5),null);
 for(const mutate of [r=>r.closed=false,r=>r.volume=-1,r=>r.low=101,r=>r.high=99,r=>r.closeTime++,r=>r.openTime++,r=>r.open=NaN]){const r={...row};mutate(r);assert.equal(appendClosedFiveMinuteBar(cached,r,end+5),null);}
 assert.equal(appendClosedFiveMinuteBar(cached,row,end-1),null);assert.equal(appendClosedFiveMinuteBar(cached,row,end+D),null);
 assert.equal(appendClosedFiveMinuteBar({...cached,rows:[{...cached.rows[0],closeTime:end-2*D-1}]},row,end+5),null);
});
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
test('removing a symbol during its fast evaluation cancels dispatch',async()=>{
 const f=prepare(),w=new PocFastWatch({},()=>f.input.now);w.observe('ABCUSDT',f.result);let symbols=['ABCUSDT'],writes=0;
 const lane=createPocFastLane({watch:w,symbols:()=>symbols,enabled:()=>true,evaluate:async()=>{symbols=[];return {ok:true,entryConfirmed:true};},execute:async()=>writes++});
 await lane.tick();assert.equal(writes,0);
});
