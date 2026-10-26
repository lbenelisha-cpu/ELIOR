import test from 'node:test';import assert from 'node:assert/strict';
import {rsiSeries,liveSpringRsi,observeLiveCandle,assertLiveSpringRsi} from '../lib/wyckoff-spring-rsi.mjs';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {entrySignal} from '../lib/colmex-auto-policy.mjs';
import {TRAILING_EXIT_POLICY} from '../lib/trailing-profit-exit.mjs';
const base=Date.UTC(2026,9,22,15),now=base+1000,step=300000;
const prices=[...Array(16).fill(95),95,97,100,90,80,85,92,87,82,84,86,85,86];
const bars=prices.map((close,i)=>({openTime:base-(prices.length-i)*step,closeTime:base-(prices.length-i-1)*step-1,open:i===17||i===16?close-1:close,high:close,low:i===17||i===16?close-1:close,close,closed:true,timeframe:'5m'}));
const options={price:50,priceAsOf:now,now};
test('partial Spring buys before close or reclaim, on both platforms',()=>{
 const s=liveSpringRsi(bars,options);assert.equal(s.buyConfirmed,true);assert.ok(s.entryRsi<=30);assert.equal(s.springLow.live,true);assert.ok(s.confirmation.time<base+step);assert.ok(s.price>s.confirmation.price);
 const ev=evaluateDailyTrade({symbol:'TESTUSDT',bars,...options,priceAsOf:new Date(now).toISOString(),timeframe:'5m',entryMode:'spring_rsi_live'});
 assert.equal(ev.rawDecision,'BUY');assert.equal(ev.wyckoffTrade.stopLossPct,1);assert.equal(ev.wyckoffTrade.minProfitHoldMs,0);assert.doesNotThrow(()=>assertSpringEntryReady(ev.wyckoffTrade,50,now));
 assert.throws(()=>assertSpringEntryReady(ev.wyckoffTrade,100,now),/WAIT_RSI_0_40/);
 assert.equal(entrySignal(bars,now,base-step,[],options).ready,true);
});
test('RSI zero and thirty are inclusive; live replacement is checked again at execution',()=>{
 const closes=[100,103,96,...Array(11).fill(96)];assert.equal(rsiSeries([...closes,96]).at(-1),30);
 const trade={rsiCloses:closes,rsiBucket:base,initialPeak:180,targetPrice:200};assert.doesNotThrow(()=>assertLiveSpringRsi(trade,96,now));assert.throws(()=>assertLiveSpringRsi(trade,96.01,now),/WAIT_RSI_0_30/);
 assert.equal(rsiSeries(Array.from({length:15},(_,i)=>100-i)).at(-1),0);assert.equal(rsiSeries(Array(15).fill(50)).at(-1),50);
 assert.throws(()=>assertLiveSpringRsi(trade,96,base+step),/WAIT_CURRENT_5M_BARS/);
});
test('RSI alone cannot replace the structure; missing and stale prices cannot buy',()=>{
 assert.equal(liveSpringRsi(bars.slice(0,-4),options).buyConfirmed,false);
 assert.equal(liveSpringRsi(bars,{...options,price:90}).buyConfirmed,false);
 assert.equal(liveSpringRsi(bars,{...options,priceAsOf:now-15001}).entryReason,'WAIT_FRESH_PRICE');
 assert.equal(liveSpringRsi(bars,{...options,priceAsOf:now+1}).buyConfirmed,false);
 assert.equal(liveSpringRsi(bars,{...options,price:null}).buyConfirmed,false);
});
test('one structure has one identity across intrabar lows and subsequent closed Spring',()=>{
 const a=liveSpringRsi(bars,options),b=liveSpringRsi(bars,{...options,price:49});assert.equal(a.patternId,b.patternId);
 assert.equal(liveSpringRsi(bars,{...options,price:49,used:[a.patternId]}).entryReason,'PATTERN_ALREADY_USED');
 assert.equal(liveSpringRsi(bars,{...options,used:['5m:'+a.initialPeak.time+':legacy']}).buyConfirmed,false);
 const extended=[...bars,{openTime:base,closeTime:base+step-1,open:86,high:86,low:50,close:50,closed:true,timeframe:'5m'}];
 const next=liveSpringRsi(extended,{price:49,priceAsOf:base+step+1000,now:base+step+1000,used:[a.patternId]});assert.equal(next.patternId,a.patternId);assert.equal(next.buyConfirmed,false);
});
test('ticks replace a live candle, retain its range, ignore out of order events and reset each bucket',()=>{
 const a=observeLiveCandle(null,80,now),b=observeLiveCandle(a,50,now+1000),c=observeLiveCandle(b,60,now+2000);
 assert.equal(c.low,50);assert.equal(c.high,80);assert.equal(c.close,60);assert.equal(observeLiveCandle(c,100,now),c);assert.equal(observeLiveCandle(c,90,base+step).low,90);
});
test('high RSI at Spring clears pivots and cannot reuse that setup after RSI falls',()=>{
 const opt={...options,price:85,liveBar:{openTime:base,high:86,low:50},resetHighRsi:true};
 const rejected=liveSpringRsi(bars,opt);
 assert.ok(rejected.entryRsi>30);assert.equal(rejected.entryReason,'SPRING_REJECTED_RSI_HIGH');
 assert.equal(rejected.phase,'SEARCH_PEAK');assert.equal(rejected.initialPeak,undefined);assert.equal(rejected.springLow,undefined);
 const later=liveSpringRsi(bars,{...options,price:50,after:rejected.searchAfter,resetHighRsi:true});
 assert.equal(later.buyConfirmed,false);assert.equal(later.initialPeak,undefined);
 const early=liveSpringRsi(bars,{...options,price:85,resetHighRsi:true});
 assert.notEqual(early.entryReason,'SPRING_REJECTED_RSI_HIGH');
});
test('Binance and Colmex accept a fresh Spring between RSI 30 and 40 and reject above 40',()=>{
 const live={...options,price:80,liveBar:{openTime:base,high:86,low:50}};
 const ev=evaluateDailyTrade({symbol:'TESTUSDT',bars,...live,priceAsOf:new Date(now).toISOString(),timeframe:'5m',entryMode:'spring_rsi_live'});
 assert.equal(ev.rawDecision,'BUY');assert.ok(ev.wyckoffTrade.entryRsi>30&&ev.wyckoffTrade.entryRsi<40);assert.equal(ev.wyckoffTrade.entryRsiMax,40);
 assert.doesNotThrow(()=>assertSpringEntryReady(ev.wyckoffTrade,80,now,live.liveBar));
 assert.equal(entrySignal(bars,now,base-step,[],live).ready,true);
 assert.equal(entrySignal(bars,now,base-step,[],{...live,price:85}).reason,'WAIT_RSI_0_40');
 assert.equal(entrySignal(bars,now,base-step,[],{...live,price:85,rsiMax:100}).ready,false);
 const rejected=evaluateDailyTrade({symbol:'TESTUSDT',bars,...live,price:85,priceAsOf:new Date(now).toISOString(),timeframe:'5m',entryMode:'spring_rsi_live'});
 assert.equal(rejected.buyReason,'SPRING_REJECTED_RSI_HIGH');
 for(const changed of [{priceAsOf:now-15001},{used:[ev.wyckoffTrade.setup.patternId]}]){
  const opts={...live,...changed};assert.equal(liveSpringRsi(bars,{...opts,rsiMax:40}).buyConfirmed,false);
 }
});
test('RSI 40 is inclusive and execution uses policy rather than caller-provided max',()=>{
 const closes=[100,104,98,...Array(11).fill(98)];assert.ok(Math.abs(rsiSeries([...closes,98]).at(-1)-40)<1e-12);
 const trade={exitPolicy:TRAILING_EXIT_POLICY,entryMode:'spring_rsi_live',rsiCloses:closes,rsiBucket:base,initialPeak:180,targetPrice:200,entryRsiMax:100};
 assert.doesNotThrow(()=>assertSpringEntryReady(trade,98,now));
 assert.throws(()=>assertSpringEntryReady(trade,98.01,now),/WAIT_RSI_0_40/);
 assert.throws(()=>assertSpringEntryReady(trade,98,base+step),/WAIT_CURRENT_5M_BARS/);
});
