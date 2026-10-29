import test from 'node:test';
import assert from 'node:assert/strict';
import {COLMEX_WATCH_SYMBOLS} from '../lib/colmex-watch-universe.mjs';
import {AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {nextWatchQuote} from '../lib/colmex-watch-view.mjs';
import {runPreparationCycle} from '../lib/colmex-preparation.mjs';

const at=Date.parse('2026-10-20T15:00:00Z');
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
function fake(){
 let t=at,reads=[],catalogs=0,writes=0;
 const state=initialState(t-1000),catalog=COLMEX_WATCH_SYMBOLS.map((name,i)=>({name,type:'EQUITY',tradableInstrumentId:i+1}));
 const broker={snapshot:async()=>({positions:[],orders:[],history:[],account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1000}}),
  instruments:async()=>{catalogs++;return catalog;},
  details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),
  history:async id=>{reads.push(id);return {barDetails:[]};},quote:async()=>({bp:30,ap:30.01}),write:async()=>{writes++;return {orderId:'o'};}};
 const run=(options={})=>runCycle({state,broker,env,now:()=>t,deadline:t+27000,signal:()=>({ready:false,reason:'SEARCH_PEAK'}),save:async()=>{},...options});
 return {state,broker,run,get reads(){return reads;},get catalogs(){return catalogs;},get writes(){return writes;},get time(){return t;},advance:ms=>t+=ms};
}
test('live scanning covers fifty unique names in bounded batches and continues after corrupt history',async()=>{
 assert.equal(new Set(AUTO_POLICY.symbols).size,50);assert.equal(AUTO_POLICY.maxPositions,3);assert.equal(AUTO_POLICY.notionalUsd,800);
 const f=fake(),read=f.broker.history;
 f.broker.history=async id=>{const h=await read(id);return id===13?{barDetails:[{t:at-300000,o:30,h:20,l:29,c:30}]}:h;};
 for(let i=0;i<10;i++){await f.run();f.advance(60000);}
 assert.equal(f.catalogs,10);assert.equal(f.state.cursor,50);assert.equal(Object.keys(f.state.checks).length,50);
 assert.deepEqual(f.reads,Array.from({length:50},(_,i)=>i+1));assert.equal(f.state.checks.PLTR.reason,'HISTORY_SCHEMA');assert.equal(f.state.checks.LLY.reason,'SEARCH_PEAK');assert.equal(f.writes,0);
});
test('slow history preserves completed rows and next cycle resumes with the next stock',async()=>{
 const f=fake(),read=f.broker.history;
 f.broker.history=async id=>{f.advance(19000);return read(id);};
 await f.run();assert.deepEqual(f.reads,[1]);assert.equal(f.state.cursor,1);assert.equal(f.state.checks.AAPL.reason,'SEARCH_PEAK');
 f.advance(60000);f.broker.history=read;await f.run();assert.deepEqual(f.reads,[1,2,3,4,5,6]);assert.equal(f.writes,0);
});
test('rate limit stops the batch; next minute does not retry the same stock first',async()=>{
 const f=fake(),read=f.broker.history;f.broker.history=async id=>{if(id===1)throw Error('RATE_LIMIT');return read(id);};
 assert.equal((await f.run()).reason,'RATE_LIMIT');assert.equal(f.state.cursor,1);assert.equal(f.writes,0);
 f.advance(60000);await f.run();assert.deepEqual(f.reads,[2,3,4,5,6]);
});
test('a ready entry stops further scanning after one durable intent; full account still blocks entries',async()=>{
 const f=fake();await f.run({signal:()=>({ready:true,setup:{patternId:'fresh',targetPrice:50}})});
 assert.equal(f.writes,1);assert.deepEqual(f.reads,[1]);assert.equal(f.state.pending.kind,'BUY');assert.deepEqual(f.state.used,['fresh']);
 const full=fake();full.broker.snapshot=async()=>({positions:[],orders:[{side:'buy'},{side:'buy'},{side:'buy'}],history:[],account:{},state:{availableCash:1000}});
 assert.equal((await full.run()).reason,'NO_FREE_SLOT');assert.equal(full.catalogs,1);assert.equal(full.reads.length,5);assert.equal(full.writes,0);assert.equal(full.state.checks.AAPL.entryBlockReason,'NO_FREE_SLOT');assert.equal(full.state.entryComparison.diagnostics.AAPL.entryBlockCategory,'CAPITAL_OR_RISK');
});
test('durable check failure cannot be swallowed by the per-stock data error handler',async()=>{
 const f=fake();await assert.rejects(f.run({save:async s=>{if(s.checks.AAPL)throw Error('storage down');},signal:()=>({ready:true,setup:{patternId:'fresh',targetPrice:50}})}),/storage down/);
 assert.equal(f.writes,0);
});
test('preparation persists partial progress and does not overrun its budget',async()=>{
 const f=fake();f.advance(4*86400000);const deadline=f.time+27000;
 f.broker.history=async()=>{f.advance(19000);return {barDetails:[]};};
 const r=await runPreparationCycle({state:f.state,broker:f.broker,account:'123',save:async()=>{},now:()=>f.time,deadline});
 assert.equal(r.reason,'CYCLE_DEADLINE');assert.equal(f.state.preparation.checked,1);assert.equal(f.state.preparation.rows.AAPL.error,'WAIT_RSI_DATA');assert.equal(f.writes,0);
});
test('fifty watchlist prices get a turn before earlier prices are refreshed, including failed requests',()=>{
 const quotes={},nextAt={},seen=[];let now=at;
 for(let i=0;i<50;i++,now+=25000){
  const s=nextWatchQuote(COLMEX_WATCH_SYMBOLS,{quotes,nextAt,now});seen.push(s);
  if(i!==0)quotes[s]={loadedAt:now};nextAt[s]=now+(i===0?65000:300000);
 }
 assert.deepEqual(seen,COLMEX_WATCH_SYMBOLS);
 assert.equal(nextWatchQuote(COLMEX_WATCH_SYMBOLS,{quotes,nextAt,blocked:new Set(['AAPL']),now}),'MSFT');
 assert.equal(nextWatchQuote(['AAPL'],{nextAt:{AAPL:now+1000},now}),undefined);
});
