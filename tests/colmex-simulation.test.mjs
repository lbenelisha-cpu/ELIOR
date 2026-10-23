import test from 'node:test';
import assert from 'node:assert/strict';
import {newSimulation,applyStockObservation,simulationSummary,stockBars,stockObservation,stockSessionGap,regularSession} from '../lib/colmex-simulation.mjs';
import {evaluateWyckoff} from '../lib/wyckoff-strategy.mjs';
import {runSimulation} from '../lib/colmex-simulation-runner.mjs';
const base=Date.parse('2026-10-16T15:00:00Z'),step=300000;
const prices=[95,97,100,90,80,85,92,87,82,84,86,85,86,78];
const values=prices.map((close,i)=>({datetime:new Date(base-(prices.length-i)*step).toISOString().slice(0,19).replace('T',' '),open:i<2?close-1:close,high:close,low:i<2?close-1:close,close}));
const series={meta:{symbol:'AAPL',currency:'USD',type:'Common Stock'},values};
function obs(price,at=base+60000,symbol='AAPL'){return {symbol,series:{...series,meta:{...series.meta,symbol}},quote:{symbol,currency:'USD',close:price,last_quote_at:at/1000,is_market_open:true},now:at};}
function fresh(fee=null){return newSimulation(base-1000,fee);}

test('stock simulation uses shared causal Wyckoff and confirms with a post-Spring quote',()=>{
 const bars=stockBars(series,'AAPL',base);assert.equal(evaluateWyckoff(bars,{now:base,timeframe:'5m'}).phase,'SPRING');
 const state=applyStockObservation(fresh(),obs(81));assert.equal(state.assets.AAPL.reason,'BUY');assert.equal(state.journal.length,1);assert.equal(state.positions.AAPL.entryPrice,81);assert.equal(state.positions.AAPL.stopPrice,81*.9);assert.equal(state.positions.AAPL.minProfitHoldMs,7*86400000);assert.equal(state.journal[0].fee,null);assert.equal(state.cash,8000);
});
test('no current candle, wrong instrument, intraday gaps, closed market or stale quotes can create a buy',()=>{
 const opened={...series,values:[...values,{datetime:'2026-10-16 15:00:00',open:81,high:81,low:81,close:81}]};assert.equal(stockBars(opened,'AAPL',base+60000).length,values.length);
 assert.throws(()=>stockBars({...series,meta:{...series.meta,currency:'EUR'}},'AAPL',base),/UNSUPPORTED/);
 for(const input of [{...obs(81),series:{...series,values:values.filter((_,i)=>i!==5)}},{...obs(81),quote:{...obs(81).quote,is_market_open:false}},{...obs(81),now:base+22*60000},{...obs(81),series:null}]){const s=applyStockObservation(fresh(),input);assert.equal(s.journal.length,0);}
 const old=applyStockObservation(newSimulation(base+2*60000),obs(81));assert.equal(old.assets.AAPL.reason,'WAIT_POST_START_PRICE');assert.equal(old.journal.length,0);
});
test('US overnight gaps are opt-in and never loosen Binance validation; missing intraday bars stay invalid',()=>{
 const times=['2026-10-15T19:55:00Z','2026-10-15T20:00:00Z','2026-10-16T13:35:00Z'];const bars=times.map(t=>({open:10,close:10,low:9,high:11,closeTime:Date.parse(t),timeframe:'5m'}));
 assert.throws(()=>evaluateWyckoff(bars,{now:base,timeframe:'5m'}),/FIVE_MINUTE/);assert.doesNotThrow(()=>evaluateWyckoff(bars,{now:base,timeframe:'5m',isSessionGap:stockSessionGap}));assert.equal(stockSessionGap(Date.parse(times[1]),Date.parse('2026-10-16T14:00:00Z')),false);
 assert.equal(regularSession(Date.parse('2026-10-17T15:00:00Z')),false);assert.equal(regularSession(Date.parse('2026-11-02T14:35:00Z')),true);assert.equal(regularSession(Date.parse('2026-11-02T13:35:00Z')),false);
});
test('stop exits immediately, profit lock waits a week, quotes cannot duplicate fills or reuse an old pattern',()=>{
 let s=applyStockObservation(fresh(),obs(81));s=applyStockObservation(s,obs(100,base+2*60000));assert.equal(s.positions.AAPL.peakPrice,100);
 s=applyStockObservation(s,obs(90,base+3*60000));assert.equal(s.journal.length,1);assert.equal(s.assets.AAPL.reason,'WYCKOFF_MINIMUM_PROFIT_HOLD');
 const t=base+7*86400000+3*60000;s=applyStockObservation(s,obs(90,t));assert.equal(s.journal.length,2);assert.equal(s.journal[1].reason,'WYCKOFF_GAIN_GIVEBACK_20_PERCENT');assert.equal(s.journal[1].netPnl,null);assert.equal(simulationSummary(s).sells,1);
 assert.equal(applyStockObservation(s,obs(90,t)).journal.length,2);
 let loss=applyStockObservation(fresh(),obs(81));loss=applyStockObservation(loss,obs(72,base+2*60000));assert.equal(loss.journal[1].reason,'WYCKOFF_SPRING_STOP_LOSS_10_PERCENT');assert.equal(loss.assets.AAPL.lastExitAt,base+2*60000);
 loss=applyStockObservation(loss,obs(81,base+3*60000));assert.equal(loss.journal.length,2);assert.equal(loss.assets.AAPL.reason,'SEARCH_PEAK');
});
test('delayed observations record both timestamps, fees are explicit and cash accounting reconciles',()=>{
 let a=obs(81);a.now+=60000;let s=applyStockObservation(fresh(10),a);assert.notEqual(s.journal[0].at,s.journal[0].observedAt);assert.equal(s.assets.AAPL.delaySeconds,60);
 assert.ok(s.journal[0].fee>0);s=applyStockObservation(s,obs(72,base+7*60000));const j=s.journal[1];assert.ok(Math.abs(j.netPnl-(j.grossPnl-j.fee-j.entryFee))<1e-8);assert.ok(Math.abs(s.cash-10000-j.netPnl)<1e-8);assert.equal(simulationSummary(s).netKnown,true);
});
test('five slots cap entries, final slot uses remaining cash and invalidated confirmations remain invalid',()=>{
 let s=fresh();for(const symbol of ['AAPL','MSFT','NVDA','AMZN','GOOGL','META'])s=applyStockObservation(s,obs(81,base+60000,symbol));assert.equal(Object.keys(s.positions).length,5);assert.ok(s.cash>0&&s.cash<5);assert.equal(s.assets.META.reason,'NO_FREE_SLOT');
 s=applyStockObservation(s,obs(108,base+2*60000,'META'));assert.equal(s.assets.META.reason,'WYCKOFF_SIGNAL_INVALIDATED');s=applyStockObservation(s,obs(81,base+3*60000,'META'));assert.equal(s.assets.META.reason,'WYCKOFF_SIGNAL_INVALIDATED');
});
test('scheduler persists a single cycle atomically, rotates after provider failures, and does not fetch while closed',async()=>{
 let value=fresh(),version=0,calls=0;const store={async getWithMetadata(){return value?{data:structuredClone(value),etag:String(version)}:null;},async setJSON(k,v,opt){if(opt.onlyIfNew&&value||opt.onlyIfMatch&&opt.onlyIfMatch!==String(version))return {modified:false};value=structuredClone(v);version++;return {modified:true};}};
 const td=async endpoint=>{calls++;if(endpoint==='quote')return obs(81).quote;return series;};const a=await runSimulation({store,td,now:base+60000});assert.equal(a.status,'SAVED');assert.equal(value.journal.length,1);
 assert.equal((await runSimulation({store,td,now:base+60000})).status,'ALREADY_CHECKED');assert.equal(calls,2);
 await runSimulation({store,td:async()=>{throw Error('limit');},now:base+2*60000});assert.equal(value.cursor,2);assert.equal(value.assets.MSFT.reason,'DATA_UNAVAILABLE_OR_PROVIDER_LIMIT');
 const old=JSON.stringify(value);assert.equal((await runSimulation({store,td,now:Date.parse('2026-10-17T15:00:00Z')})).status,'MARKET_CLOSED');assert.equal(JSON.stringify(value),old);
});

test('Spring buys below or at first low without reclaim; Binance modules are unchanged',()=>{
 for(const price of [77,78,79,80]){
  const s=applyStockObservation(fresh(),obs(price));
  assert.equal(s.assets.AAPL.reason,'BUY');
  assert.equal(s.journal[0].reason,'WYCKOFF_SPRING');
  assert.equal(s.journal[0].setup.signalTime,base);
 }
});
test('90-second freshness is measured at receipt, never by backdating the scan',()=>{
 const input=obs(81);input.now+=90001;
 const s=applyStockObservation(fresh(),input);assert.equal(s.assets.AAPL.reason,'WAIT_FRESH_MARKET_PRICE');assert.equal(s.journal.length,0);
});
test('sale boundary resets the entire search even when an old setup confirms later',()=>{
 const s=fresh();s.assets.AAPL={checks:0,usedPatterns:[],lastExitAt:base-30000,lastPriceAt:null};
 const bought=applyStockObservation(s,obs(81));assert.equal(bought.assets.AAPL.reason,'SEARCH_PEAK');assert.equal(bought.journal.length,0);
 const before=fresh();before.assets.AAPL={checks:0,usedPatterns:[],lastExitAt:base+90000,lastPriceAt:null};
 const blocked=applyStockObservation(before,obs(81));assert.equal(blocked.assets.AAPL.reason,'SEARCH_PEAK');assert.equal(blocked.journal.length,0);
});
test('realized gains grow the fixed allocation while insufficient cash blocks a full slot',()=>{
 const s=fresh();s.allocation={initialBase:10000,realizedBaseline:0};s.cash=10100;
 s.journal.push({side:'SELL',grossPnl:100,netPnl:null});
 const bought=applyStockObservation(s,obs(81));assert.equal(bought.positions.AAPL.cost,2020);
 const poor=fresh();poor.cash=1999;const blocked=applyStockObservation(poor,obs(81));assert.equal(blocked.assets.AAPL.reason,'INSUFFICIENT_SIM_CASH');assert.equal(blocked.journal.length,0);
});
test('stock history excludes all candles outside seven calendar days',()=>{
 const old={...values[0],datetime:'2026-10-08 14:00:00'};
 assert.equal(stockBars({...series,values:[old,...values]},'AAPL',base).length,values.length);
});
