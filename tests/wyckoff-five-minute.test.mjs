import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from '../lib/wyckoff-strategy.mjs';
import {evaluateDailyTrade} from '../lib/wyckoff-evaluation.mjs';
import {loadFiveMinuteBars} from '../lib/wyckoff-five-minute-data.mjs';
import {setup} from './wyckoff-demo-helper.mjs';
const prices=[100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
const step=300000,now=Date.UTC(2026,9,10,12);
const bars=prices.map((close,i)=>({openTime:now-(prices.length-i)*step,closeTime:now-(prices.length-i-1)*step-1,open:close,high:close,low:close,close,timeframe:'5m',closed:true}));
test('5m sequence is causal, uses wick pivots and has a separate saved trade identity',()=>{
 const before=evaluateWyckoff(bars.slice(0,-1),{now,timeframe:'5m'});assert.equal(before.buyConfirmed,false);
 const s=evaluateWyckoff(bars,{now,timeframe:'5m'});assert.equal(s.buyConfirmed,true);assert.equal(s.firstLow.price,80);
 const trade=createWyckoffTrade(s,82);assert.equal(trade.strategyId,'WYCKOFF_5M_V1');assert.equal(trade.timeframe,'5m');assert.match(trade.patternId,/^5m:/);
 assert.equal(wyckoffExit(trade,107).sell,true);assert.equal(wyckoffExit(trade,82*.94).sell,true);
});
test('incomplete, gapped, wrong-timeframe and stale bars cannot confirm a new 5m entry',()=>{
 const args={symbol:'BTCUSDT',bars,price:81,priceAsOf:new Date(now).toISOString(),timeframe:'5m',now};
 assert.equal(evaluateDailyTrade(args).entryConfirmed,true);
 assert.equal(evaluateDailyTrade({...args,now:now+step,priceAsOf:new Date(now+step).toISOString()}).buyReason,'STALE_5M_SIGNAL');
 for(const invalid of [bars.slice(1).filter((_,i)=>i!==4),bars.map(x=>({...x,timeframe:'1d'})),bars.map((x,i)=>i===14?{...x,closed:false}:x)])assert.throws(()=>evaluateWyckoff(invalid,{timeframe:'5m',now}));
 const trade=createWyckoffTrade(evaluateWyckoff(bars,{timeframe:'5m',now}),81);
 assert.equal(evaluateDailyTrade({...args,usedPatternIds:[trade.patternId]}).entryConfirmed,false);
});
test('paging retrieves all 2016 closed weekly bars and excludes the open candle',async()=>{
 const end=now-1,start=now-7*86400000;
 const data=Array.from({length:2017},(_,i)=>[start+i*step,'100','101','99','100','10',start+(i+1)*step-1]);
 const calls=[];
 const fetcher=async path=>{const q=new URL('https://x'+path).searchParams;calls.push(q);return data.filter(x=>x[0]>=Number(q.get('startTime'))).slice(0,1000);};
 const result=await loadFiveMinuteBars(fetcher,'BTCUSDT',now);
 assert.equal(result.length,2016);assert.equal(result[0].openTime,start);assert.equal(result.at(-1).closeTime,end);assert.equal(calls.length,3);assert.equal(calls[0].get('interval'),'5m');
 await assert.rejects(()=>loadFiveMinuteBars(async()=>data.slice(0,10),'BTCUSDT',now),/PAGINATION|CURRENT_5M/);
});
test('5m fills retain targets, count trades, exit and cannot buy the same pattern twice',async()=>{
 const x=setup();try{
  const s=evaluateWyckoff(bars,{timeframe:'5m',now});
  const ev={ok:true,symbol:'BTCUSDT',at:new Date().toISOString(),score:100,entryConfirmed:true,entryStage:1,orderFraction:1,wyckoffTrade:createWyckoffTrade(s,100),strategy:{timeframe:'5m',wyckoff:s,sellConfirmed:false}};
  await x.trader.cycle([ev]);assert.equal(x.orders.length,1);assert.equal(x.trader.wyckoffStats().buys,1);
  assert.equal(x.trader.state.positions.BTCUSDT.strategyId,'WYCKOFF_5M_V1');
  x.prices.BTC=107;await x.trader.monitorExits();assert.equal(x.orders.length,2);assert.equal(x.trader.wyckoffStats().sells,1);
  x.prices.BTC=100;await x.trader.cycle([ev]);assert.equal(x.orders.length,2);
 }finally{x.close();}
});
