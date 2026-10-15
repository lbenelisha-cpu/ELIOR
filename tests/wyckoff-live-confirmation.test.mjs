import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {evaluateWyckoff} from '../lib/wyckoff-strategy.mjs';
import {createLiveConfirmationTracker} from '../lib/wyckoff-live-confirmation.mjs';
const step=300000,base=Date.UTC(2026,9,15,10);
const prices=[95,97,100,90,80,85,92,87,82,84,86,85,86,78];
const bars=prices.map((close,i)=>({openTime:base-(prices.length-i)*step,closeTime:base-(prices.length-i-1)*step-1,open:i<2?close-1:close,high:close,low:i<2?close-1:close,close,closed:true,timeframe:'5m'}));
const now=base+60000;
const args=symbol=>({symbol,bars,price:81,priceAsOf:new Date(now).toISOString(),timeframe:'5m',now,entryMode:'wyckoff_confirmation'});
function append(closes){const rows=[...bars];for(const close of closes){const openTime=rows.at(-1).closeTime+1;rows.push({openTime,closeTime:openTime+step-1,open:close,high:close,low:close,close,closed:true,timeframe:'5m'});}return rows;}

test('live reclaim confirms after Spring with no additional closed candle',()=>{
 assert.equal(evaluateWyckoff(bars,{now,timeframe:'5m'}).phase,'SPRING');
 const ev=evaluateDailyTrade(args('LIVE1USDT'));
 assert.equal(ev.entryConfirmed,true);assert.equal(ev.buyReason,'WYCKOFF_LIVE_RECLAIM');
 assert.equal(ev.strategy.wyckoff.confirmation.live,true);assert.equal(ev.strategy.wyckoff.signalTime,now);
 assert.equal(ev.wyckoffTrade.minProfitHoldMs,7*86400000);assert.equal(ev.wyckoffTrade.stopLossPct,10);
 assert.doesNotThrow(()=>assertSpringEntryReady(ev.wyckoffTrade,81,now));
 assert.throws(()=>assertSpringEntryReady(ev.wyckoffTrade,80,now),/WAIT_WYCKOFF_ENTRY_PRICE/);
});
test('a complete preceding pattern, a post-Spring tick and strict reclaim are required',()=>{
 assert.equal(evaluateDailyTrade({...args('LIVE2USDT'),bars:bars.slice(0,-1)}).entryConfirmed,false);
 assert.equal(evaluateDailyTrade({...args('LIVE3USDT'),price:80}).entryConfirmed,false);
 assert.equal(evaluateDailyTrade({...args('LIVE4USDT'),priceAsOf:new Date(base-1).toISOString()}).entryConfirmed,false);
 assert.equal(evaluateDailyTrade({...args('LIVE5USDT'),price:107}).entryConfirmed,false);
 assert.throws(()=>evaluateDailyTrade({...args('LIVE6USDT'),priceAsOf:new Date(now-100000).toISOString()}),/WAIT_FRESH_PRICE/);
 assert.throws(()=>evaluateDailyTrade({...args('LIVE7USDT'),bars:bars.map((b,i)=>i===bars.length-1?{...b,closed:false}:b)}),/UNFINISHED/);
});
test('consumed patterns never authorize a second purchase',()=>{
 const a=args('LIVE8USDT'),ev=evaluateDailyTrade(a);
 assert.equal(evaluateDailyTrade({...a,usedPatternIds:[ev.wyckoffTrade.patternId]}).entryConfirmed,false);
});
test('successive scans and a later closed confirmation retain the first live timestamp',()=>{
 const a=args('LIVE9USDT'),first=evaluateDailyTrade(a),later=base+3*step;
 const ev=evaluateDailyTrade({...a,bars:append([79,80,81]),now:later,priceAsOf:new Date(later).toISOString()});
 assert.equal(ev.entryConfirmed,true);assert.equal(ev.wyckoffTrade.setup.signalTime,first.wyckoffTrade.setup.signalTime);
 assert.equal(ev.wyckoffTrade.signalExpiresAt,now+1200000);
});
test('an unused live confirmation expires without rearming on successive current candles',()=>{
 const a=args('LIVE10USDT');evaluateDailyTrade(a);const later=now+1200000;
 const ev=evaluateDailyTrade({...a,bars:append([79,79,79,79]),now:later,priceAsOf:new Date(later).toISOString()});
 assert.equal(ev.entryConfirmed,false);assert.equal(ev.buyReason,'STALE_5M_SIGNAL');
});
test('a post-confirmation Spring break permanently invalidates that live signal',()=>{
 const a=args('LIVE11USDT');evaluateDailyTrade(a);
 assert.equal(evaluateDailyTrade({...a,price:77}).buyReason,'WYCKOFF_SIGNAL_INVALIDATED');
 assert.equal(evaluateDailyTrade(a).buyReason,'WYCKOFF_SIGNAL_INVALIDATED');
});
test('restart restores original confirmation time and invalidation from the saved decision',()=>{
 const setup=evaluateWyckoff(bars,{now,timeframe:'5m'}),options={symbol:'RESTOREUSDT',price:81,priceAsOf:new Date(now).toISOString(),now};
 const before=createLiveConfirmationTracker()(setup,options);
 const restored=createLiveConfirmationTracker()(setup,{...options,now:now+1000,priceAsOf:new Date(now+1000).toISOString(),priorLiveConfirmation:JSON.parse(JSON.stringify(before))});
 assert.equal(restored.signalTime,now);
 const invalid=createLiveConfirmationTracker()(setup,{...options,priorLiveConfirmation:{...before,signalInvalidated:true}});
 assert.equal(invalid.signalInvalidated,true);
});
