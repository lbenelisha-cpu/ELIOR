import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from '../lib/wyckoff-strategy.mjs';
const prices=[100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
export const daily=values=>values.map((close,i)=>({date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),open:close,high:close,low:close,close}));
test('complete ordered pattern buys strictly above first low, not at equality',()=>{
 const before=evaluateWyckoff(daily(prices.slice(0,-1)));assert.equal(before.buyConfirmed,false);assert.equal(before.phase,'SPRING');
 const s=evaluateWyckoff(daily(prices));assert.equal(s.buyConfirmed,true);
 assert.equal(s.initialPeak.price,100);assert.equal(s.firstLow.price,80);assert.equal(s.rallyHigh.price,92);assert.equal(s.secondaryTest.price,82);assert.equal(s.springLow.price,78);assert.equal(s.targetPrice,107);
});
test('sell target is 7% above ORIGINAL peak and stop is 6% below execution',()=>{
 const p=createWyckoffTrade(evaluateWyckoff(daily(prices)),82);
 assert.equal(p.targetPrice,107);assert.equal(p.stopPrice,82*.94);
 assert.equal(wyckoffExit(p,106.99).sell,false);assert.equal(wyckoffExit(p,107).reason,'WYCKOFF_TARGET_7_ABOVE_INITIAL_PEAK');
 assert.equal(wyckoffExit(p,p.stopPrice).reason,'WYCKOFF_STOP_LOSS');assert.equal(wyckoffExit(p,p.stopPrice+.01).sell,false);
 assert.equal(wyckoffExit({...p,peakPrice:150},100).sell,false);
});
test('insufficient consolidation, missing secondary test or no lower low never buy',()=>{
 for(const seq of [[100,90,80,85,92,87,82,84,78,81],[100,90,80,85,92,78,81],[100,90,80,85,92,87,82,84,86,85,86,80,81]])assert.equal(evaluateWyckoff(daily(seq)).buyConfirmed,false);
});
test('future bars do not modify previously observed signal; later bars do not repeat buy',()=>{
 const s=evaluateWyckoff(daily(prices));assert.equal(s.buyConfirmed,true);
 assert.equal(evaluateWyckoff(daily([...prices,83])).buyConfirmed,false);
 assert.deepEqual(evaluateWyckoff(daily(prices)),s);
});
test('replay after restart preserves frozen trade identity and exits',()=>{
 const s=evaluateWyckoff(daily(prices)),p=createWyckoffTrade(s,81);
 assert.equal(evaluateWyckoff(daily(prices)).patternId,p.patternId);
 assert.equal(wyckoffExit(JSON.parse(JSON.stringify(p)),108).sell,true);
});
test('malformed, duplicate, unsorted, nonpositive, future and open bars are rejected',()=>{
 const bars=daily(prices);
 for(const x of [[...bars,{...bars.at(-1)}],bars.toReversed(),bars.map((b,i)=>i===0?{...b,close:0}:b),bars.map((b,i)=>i===0?{...b,closed:false}:b),bars.map((b,i)=>i===0?{...b,timeframe:'5m'}:b)])assert.throws(()=>evaluateWyckoff(x));
 assert.throws(()=>evaluateWyckoff(bars,{now:Date.parse('2020-01-14')}));
});
test('entry cannot be created without confirmation or at target; unknown holdings are not assigned invented targets',()=>{
 const s=evaluateWyckoff(daily(prices));assert.throws(()=>createWyckoffTrade(s,107));assert.throws(()=>createWyckoffTrade({...s,buyConfirmed:false},81));
 assert.equal(wyckoffExit({entryPrice:81},107).reason,'LEGACY_POSITION_REQUIRES_REVIEW');
});
test('wick highs and lows set original peak and support; wick Spring requires the following closed candle',()=>{
 const b=daily(prices.slice(0,13));b[0].high=110;b[2].low=75;b[11].low=70;
 assert.equal(evaluateWyckoff(b.slice(0,12)).buyConfirmed,false);
 const s=evaluateWyckoff(b);assert.equal(s.buyConfirmed,true);assert.equal(s.initialPeak.price,110);assert.equal(s.firstLow.price,75);assert.equal(s.springLow.price,70);assert.equal(s.targetPrice,110*1.07);
});
test('close-only histories and intraday observations cannot masquerade as daily OHLC',()=>{
 assert.throws(()=>evaluateWyckoff(daily(prices).map(({date,close})=>({date,close}))),/DAILY_HIGH_LOW_REQUIRED/);
 assert.throws(()=>evaluateWyckoff(prices.map((close,i)=>({closeTime:Date.UTC(2020,0,1)+i*3600000,close,high:close,low:close}))),/DAILY_TIMEFRAME_REQUIRED/);
});
