import test from 'node:test';import assert from 'node:assert/strict';import {assessQualityEntry,atrPolicy} from '../lib/binance-quality-policy.mjs';import {binancePositionExit} from '../lib/binance-position-exit.mjs';import {buildNetTradeJournal} from '../lib/net-trade-journal.mjs';
const end=Math.floor(Date.now()/3600000)*3600000;const bars=Array.from({length:720},(_,i)=>({openTime:end-(720-i)*300000,closeTime:end-(719-i)*300000-1,close:100+i*.02,high:100+i*.02+.1,low:100+i*.02-.1,volume:i>=717?200:100,closed:true}));
test('volume, movement and depth estimates stay disabled; hourly trend is enabled',()=>{
 for(const data of [bars,bars.map(b=>({...b,volume:0}))]){
  const result=assessQualityEntry('BTCUSDT',data,{now:end,estimatedCostPct:99});assert.equal(result.ok,true);assert.equal(result.enabled,true);assert.equal(result.code,'HOURLY_TREND_CONFIRMED');
 }
 assert.equal(assessQualityEntry('BTCUSDT',bars.map((b,i)=>({...b,close:200-i*.02})),{now:end}).code,'WAIT_HOURLY_TREND');
 assert.equal(assessQualityEntry('BTCUSDT',bars.map(b=>({...b,close:100})),{now:end}).ok,false);
 assert.equal(assessQualityEntry('BTCUSDT',bars.slice(-100),{now:end}).code,'WAIT_HOURLY_TREND_DATA');
 assert.equal(assessQualityEntry('RLUSDUSDT',bars,{now:end}).code,'WAIT_STABLECOIN');
});
test('ATR is bounded and cannot lower an existing effective protection',()=>{const a=atrPolicy(100,100);assert.equal(a.atrStopPct,2.5);assert.equal(a.atrTrailPct,4);const p={strategyId:'WYCKOFF_5M_V1',entryPrice:100,peakPrice:110,marketRank:1,...atrPolicy(.5,100)};binancePositionExit(p,110);const stop=p.effectiveStopPrice;p.atrTrailPct=4;binancePositionExit(p,109.9);assert.equal(p.effectiveStopPrice,stop);});
test('net journal allocates cost on partial sales, subtracts quote fees and exposes unvalued fees',()=>{const buys=[{type:'BUY',symbol:'ABCUSDT',at:'2026-10-13T00:00:00Z',price:10,qty:10,amountUsdt:100,commissions:[{asset:'USDT',amount:1}],wyckoffTrade:{peakPrice:12}}];const sale={type:'SELL',symbol:'ABCUSDT',at:'2026-10-13T01:00:00Z',price:12,qty:5,amountUsdt:60,commissions:[{asset:'USDT',amount:1}]};const r=buildNetTradeJournal([...buys,sale])[0];assert.equal(r.netPnlUsdt,8.5);assert.equal(r.closed,false);assert.equal(r.maxGrossPnlUsdt,10);assert.equal(buildNetTradeJournal([...buys,{...sale,commissions:[{asset:'BNB',amount:.01}]}])[0].netPnlUsdt,null);});

test('volume equal to the prior average passes',()=>{assert.equal(assessQualityEntry('BTCUSDT',bars.map(b=>({...b,volume:100})),{now:end}).ok,true);});
