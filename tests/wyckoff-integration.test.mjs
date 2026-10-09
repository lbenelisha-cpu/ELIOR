import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDailyTrade} from '../lib/wyckoff-evaluation.mjs';
import {evaluateWyckoff,createWyckoffTrade} from '../lib/wyckoff-strategy.mjs';
import {brokerDailyQuotes} from '../lib/broker-daily-wyckoff.mjs';
import {planCycle} from '../lib/colmex-execution.mjs';
const prices=[100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
const now=Date.UTC(2026,9,9,12);
const bars=prices.map((close,i)=>({date:new Date(Date.UTC(2026,8,24+i)).toISOString().slice(0,10),open:close,high:close,low:close,close}));
const context={symbol:'BTCUSDT',bars,price:82,priceAsOf:new Date(now).toISOString(),now};
test('daily signal authorizes one full entry; cannot reuse consumed pattern or chase above target',()=>{
 const ev=evaluateDailyTrade(context);assert.equal(ev.rawDecision,'BUY');assert.equal(ev.orderFraction,1);assert.equal(ev.wyckoffTrade.targetPrice,107);
 assert.equal(evaluateDailyTrade({...context,usedPatternIds:[ev.wyckoffTrade.patternId]}).rawDecision,'HOLD');
 assert.equal(evaluateDailyTrade({...context,price:108}).rawDecision,'HOLD');
 assert.equal(evaluateDailyTrade({...context,price:80}).rawDecision,'HOLD');
});
test('held exit works when daily history is unavailable and never adds stage two',()=>{
 const position=createWyckoffTrade(evaluateWyckoff(bars,{now}),82);
 assert.equal(evaluateDailyTrade({...context,bars:[],position,price:107}).rawDecision,'SELL');
 assert.equal(evaluateDailyTrade({...context,bars:[],position,price:100}).rawDecision,'HOLD');
 assert.equal(evaluateDailyTrade({...context,bars:[],position,price:76}).strategy.exitReason,'WYCKOFF_STOP_LOSS');
});
test('stale live prices cannot authorize entries or exits',()=>{
 assert.throws(()=>evaluateDailyTrade({...context,priceAsOf:new Date(now-91000).toISOString()}));
});
test('intraday-only broker data is explicitly blocked, not treated as D1',()=>{
 const d=brokerDailyQuotes({X:{bars}},now);assert.equal(Object.keys(d.quotes).length,0);assert.equal(d.blocked[0].reason,'WAIT_DAILY_BARS');
 const snap={orders:[],closed:[],foreignOrders:0,historyOverflow:false};
 const p=planCycle(snap,{items:{}},[],[],now/1000);assert.equal(p.command,null);assert.match(p.programs[0].status,/WAIT_DAILY_BARS/);
});
test('broker target and stop survive restart; bid quote triggers exact target sale',()=>{
 const trade=createWyckoffTrade(evaluateWyckoff(bars,{now}),82);
 const item={symbol:'X',depositCurrency:'USD',profitMode:1,capturedAt:now/1000,tickTime:now/1000,bid:107,ask:107.01,contractSize:1,tickSize:.01,tickValue:.01,minLot:.1,lotStep:.1,profitCurrency:'USD',tradeAllowed:true};
 const snapshot={orders:[{symbol:'X',ticket:9,magic:31025981,lots:1,openPrice:82}],historyOverflow:false,foreignOrders:0};
 const previous=JSON.parse(JSON.stringify([{id:1,wyckoffTrade:trade}]));
 const plan=planCycle(snapshot,{items:{X:item}},[],[],now/1000,[],false,[],previous);
 assert.equal(plan.command.action,'CLOSE');assert.equal(plan.command.reason,'WYCKOFF_TARGET_7_ABOVE_INITIAL_PEAK');assert.equal(plan.programs[0].wyckoffTrade.stopPrice,82*.94);
});
test('broker enters only from daily OHLC and remembers consumed pattern after old commands expire',()=>{
 const item={symbol:'X',depositCurrency:'USD',profitMode:1,capturedAt:now/1000,tickTime:now/1000,bid:82,ask:82.01,contractSize:1,tickSize:.01,tickValue:.01,minLot:.1,lotStep:.1,profitCurrency:'USD',tradeAllowed:true,dailyBars:bars.map(b=>({...b,closeTime:Date.parse(b.date)+86399999}))};
 const snapshot={orders:[],historyOverflow:false,foreignOrders:0};
 const daily=brokerDailyQuotes({X:item},now).quotes;
 const plan=planCycle(snapshot,{items:{X:item}},[],[],now/1000,[],false,[],[],daily);
 assert.equal(plan.command.action,'BUY');assert.equal(plan.command.wyckoffTrade.initialPeak,100);assert.equal(plan.command.wyckoffTrade.targetPrice,107);
 const prior=[{id:1,usedPatterns:[plan.command.wyckoffTrade.patternId]}];
 assert.equal(planCycle(snapshot,{items:{X:item}},[],[],now/1000,[],false,[],prior,daily).command,null);
});
