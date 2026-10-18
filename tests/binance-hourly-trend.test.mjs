import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {assessHourlyTrend} from '../lib/binance-hourly-trend.mjs';
import {makeFeatures} from '../lib/portfolio-variant-study.mjs';
const H=3600000,S=300000,end=Date.UTC(2026,9,18,15);
function bars(fn=i=>100+Math.floor(i/12)){
 return Array.from({length:600},(_,i)=>({openTime:end-50*H+i*S,closeTime:end-50*H+(i+1)*S-1,close:fn(i),closed:true}));
}
test('last completed hourly close must strictly exceed SMA20 and SMA20 must exceed SMA50',()=>{
 const up=assessHourlyTrend(bars(),{now:end+1200000});assert.equal(up.ok,true);assert.equal(up.close,149);assert.equal(up.sma20,139.5);assert.equal(up.sma50,124.5);assert.equal(up.asOf,new Date(end-1).toISOString());
 assert.equal(assessHourlyTrend(bars(()=>100),{now:end}).ok,false);
 assert.equal(assessHourlyTrend(bars(i=>200-Math.floor(i/12)),{now:end}).ok,false);
 const weakClose=bars();weakClose.at(-1).close=130;assert.equal(assessHourlyTrend(weakClose,{now:end}).ok,false);
});
test('unfinished and future hourly candles cannot change the gate; advancing the hour requires new complete data',()=>{
 const source=bars(),partial=Array.from({length:4},(_,i)=>({openTime:end+i*S,closeTime:end+(i+1)*S-1,close:1,closed:i<3}));
 assert.deepEqual(assessHourlyTrend([...source,...partial],{now:end+20*60000}),assessHourlyTrend(source,{now:end+20*60000}));
 assert.equal(assessHourlyTrend(source,{now:end+H}).code,'WAIT_HOURLY_TREND_DATA');
});
test('missing, duplicate, stale, malformed or unfinished input fails closed',()=>{
 for(const rows of [bars().slice(1),[...bars(),bars()[0]],bars().map((b,i)=>i===100?{...b,closed:false}:b),bars().map((b,i)=>i===1?{...b,close:NaN}:b),bars().map((b,i)=>i===2?{...b,closeTime:b.closeTime+1}:b)])assert.equal(assessHourlyTrend(rows,{now:end}).ok,false);
 assert.equal(assessHourlyTrend([],{now:NaN}).ok,false);
});
test('live hourly values match the fixed simulation gate on completed hours',()=>{
 const input=bars(),rows=input.map(b=>[b.openTime,b.close,b.close+1,b.close-1,b.close,1,b.closeTime]),features=makeFeatures(rows);
 for(const n of [600,588]){const subset=input.slice(0,n),now=subset.at(-1).closeTime+1;assert.equal(assessHourlyTrend(subset,{now}).ok,n===600?features[n-1].trend:false);}
});
test('automatic submission rechecks the hourly gate before order intent; no failed gate can post an order',async()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),fn=source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell('));
 let posts=0;const c=vm.createContext({getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),symbolExchangeInfo:async()=>({status:'TRADING',quoteAsset:'USDT',filters:[]}),getLiveAccountSnapshot:async()=>({balances:[],usdtFree:100}),liveNextBuyAllocation:()=>({ok:true,amountUsdt:10}),LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,assessQualityEntry:()=>({ok:false,code:'WAIT_HOURLY_TREND'}),candles:async()=>[],liveOrders:{submit:async()=>posts++}});
 vm.runInContext(fn,c);await assert.rejects(()=>c.placeLiveMarketBuy('BTCUSDT',10),/WAIT_HOURLY_TREND/);assert.equal(posts,0);
});
