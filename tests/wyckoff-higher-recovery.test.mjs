import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWyckoff} from '../lib/wyckoff-strategy.mjs';
import {recoveryComparison,assertHigherRecovery} from '../lib/wyckoff-recovery.mjs';
import {qualityEntry,assertQualityEntry} from '../lib/confirmed-entry-quality.mjs';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {entrySignal} from '../lib/colmex-auto-policy.mjs';
import {scanWyckoffOccurrences,recordedWyckoffOccurrences,mergeWyckoffOccurrences} from '../lib/wyckoff-occurrences.mjs';
import {auditRecovery} from '../scripts/audit-wyckoff-recovery.mjs';
import {buildColmexMarks} from '../lib/colmex-chart-marks.mjs';
const step=300000,end=Date.parse('2026-10-26T15:00:00Z');
const seed=[95,97,100,90,80,85,92,87,82,84,93,85,86,79,81];
function bars(nums=seed){return nums.map((close,i)=>({openTime:end-(nums.length-i)*step,closeTime:end-(nums.length-i-1)*step,open:i<2?close-1:close,high:close,low:i<2?close-1:close,close,volume:1000,closed:true,timeframe:'5m'}));}
const evaluate=(b,extra={})=>evaluateWyckoff(b,{now:b.at(-1).closeTime,timeframe:'5m',rollingSearch:true,requireHigherRecovery:true,...extra});
function qualityBars(second=93){
 const nums=[...Array.from({length:170},(_,i)=>i*.5),...Array(50).fill(95),...seed.map((n,i)=>i===10?86:n)];
 return nums.map((n,i)=>({openTime:end-(nums.length-i)*step,closeTime:end-(nums.length-i-1)*step,open:100+(n-([220,221].includes(i)?1:0))*.01,high:100+(i===230?second:n)*.01,low:100+(n-([220,221].includes(i)?1:0))*.01,close:100+n*.01,volume:1000,closed:true,timeframe:'5m'}));
}
function signals(b){const now=b.at(-1).closeTime+1000,price=b.at(-1).close,live={price,priceAsOf:now};return {now,price,colmex:entrySignal(b,now,0,[],live),binance:evaluateDailyTrade({symbol:'TESTUSDT',bars:b,now,price,priceAsOf:new Date(now).toISOString(),timeframe:'5m',entryMode:'confirmed_quality',allowEarlyWave:true})};}

test('strict absolute high comparison: lower and equal second recoveries fail; higher passes',()=>{
 for(const second of [86,92,93]){
  const prices=[...seed];prices[10]=second;const b=bars(prices),s=evaluate(b);
  assert.equal(s.rallyHigh.price,92);assert.equal(s.secondRallyHigh.price,second);
  assert.equal(s.buyConfirmed,second>92);assert.equal(s.recoveryComparison.passed,second>92);
  assert.equal(s.secondRallyHigh.confirmedAt,b[11].closeTime);
  if(second<=92){assert.equal(s.entryReason,'SECOND_RECOVERY_NOT_HIGHER');assert.equal(evaluate(b,{requireHigherRecovery:false}).buyConfirmed,true);}
 }
});
test('the second high uses the wick, needs a later closed candle and never uses future data',()=>{
 const b=bars();b[10].close=86;b[10].open=86;b[10].low=86;
 assert.equal(evaluate(b).secondRallyHigh.price,93);
 const prefix=b.slice(0,11);assert.equal(evaluate(prefix).secondRallyHigh,undefined);assert.equal(evaluate(prefix).recoveryComparison.passed,false);
 assert.throws(()=>evaluate([...prefix,{...b[11],closed:false}]),/UNFINISHED/);
 for(let i=3;i<=b.length;i++){const s=evaluate(b.slice(0,i));if(s.secondRallyHigh)assert.ok(s.secondRallyHigh.confirmedAt<=b[i-1].closeTime);}
});
test('an ambiguous Spring candle cannot create its own preceding recovery high',()=>{
 const b=bars([95,97,100,90,80,85,92,87,82,84,85,93,79,81]);b[12].high=94;
 const s=evaluate(b);assert.equal(s.phase,'SIGNALLED');assert.equal(s.secondRallyHigh,undefined);assert.equal(s.buyConfirmed,false);
});
test('a later third recovery cannot replace a failed second recovery',()=>{
 const s=evaluate(bars([95,97,100,90,80,85,92,87,82,84,86,85,93,85,86,79,81]));
 assert.equal(s.secondRallyHigh.price,86);assert.equal(s.rallyHigh.price,92);assert.equal(s.buyConfirmed,false);
});
test('qualifying second recovery is not discarded as a newer initial peak; stale setups still expire',()=>{
 const b=bars();for(const i of [8,9]){b[i].open=b[i].close-1;b[i].low=b[i].open;}
 const s=evaluate(b);assert.equal(s.initialPeak.price,100);assert.equal(s.secondRallyHigh.price,93);assert.equal(s.buyConfirmed,true);
 const extended=bars([...seed,...Array(80).fill(81)]);assert.equal(evaluate(extended).buyConfirmed,false);assert.equal(evaluate(extended).secondRallyHigh,undefined);
});
test('both production platforms block lower/equal recoveries and preserve exact prices in diagnostics',()=>{
 for(const second of [86,92,93]){
  const {colmex,binance}=signals(qualityBars(second));
  assert.equal(colmex.ready,second>92);assert.equal(binance.entryConfirmed,second>92);
  assert.equal(colmex.quality.recovery.firstPrice,100.92);assert.equal(colmex.quality.recovery.secondPrice,100+second*.01);
  assert.equal(binance.strategy.wyckoff.secondRallyHigh.price,100+second*.01);
  if(second<=92){assert.equal(colmex.reason,'SECOND_RECOVERY_NOT_HIGHER');assert.equal(binance.buyReason,colmex.reason);}
 }
});
test('early-wave fallback cannot bypass the recovery rule; prior evidence can survive a breakout above initial peak',()=>{
 for(const second of [86,92,93]){
  const b=qualityBars(second).slice(0,-2);b.push({...b.at(-1),openTime:b.at(-1).closeTime,closeTime:b.at(-1).closeTime+step,open:100.86,low:100.86,high:102.1,close:102.05,volume:1200});
  const {colmex,binance}=signals(b);assert.equal(colmex.ready,second>92);assert.equal(binance.entryConfirmed,second>92);
  if(second>92){assert.equal(colmex.setup.entryMode,'early_wave_confirmed');assert.ok(colmex.setup.secondRallyHigh.confirmedAt<colmex.setup.confirmation.time);}
 }
});
test('submission rechecks evidence and rejects missing, stale or falsified pre-rule confirmations',()=>{
 const {colmex,binance,now,price}=signals(qualityBars());assert.doesNotThrow(()=>assertQualityEntry(colmex.setup,price,now));
 for(const changes of [{secondRallyHigh:undefined},{secondRallyHigh:{...colmex.setup.secondRallyHigh,price:100.92}},{secondRallyHigh:{...colmex.setup.secondRallyHigh,confirmedAt:now+1}}]){
  const setup={...colmex.setup,...changes};assert.throws(()=>assertQualityEntry(setup,price,now),/RECOVERY/);
  assert.throws(()=>assertSpringEntryReady({...binance.wyckoffTrade,setup},price,now),/RECOVERY/);
 }
 assert.throws(()=>assertHigherRecovery({rallyHigh:{price:NaN,time:1}},now),/RECOVERY/);
 assert.equal(recoveryComparison({}).passed,false);
});
test('chart reconstruction does not label a failed pattern confirmed; actual historical trades stay historical',()=>{
 const b=bars(seed.map((n,i)=>i===10?86:n)),s=evaluate(b),items=scanWyckoffOccurrences(b,{now:end});
 assert.ok(items.length);assert.equal(items.at(-1).confirmedAt,null);assert.equal(items.at(-1).setup.confirmation,undefined);
 const marks=buildColmexMarks({assets:{TEST:{setup:s}}},'TEST');assert.ok(marks.cards.some(x=>x.kind==='secondRallyHigh'));assert.ok(!marks.cards.some(x=>x.kind==='confirmation'));
 const old=evaluate(b,{requireHigherRecovery:false});assert.ok(recordedWyckoffOccurrences([old])[0].confirmedAt);
});
test('already-held positions still run exits without requiring new recovery evidence',()=>{
 let called=false;const p={strategyId:'WYCKOFF_5M_V1',entryPrice:100,firstLow:99,targetPrice:150};
 const result=evaluateDailyTrade({symbol:'TESTUSDT',bars:[],now:end,price:98,priceAsOf:new Date(end).toISOString(),position:p,timeframe:'5m',entryMode:'confirmed_quality',exitEvaluator:()=>{called=true;return {sell:true,reason:'STOP'};}});
 assert.equal(called,true);assert.equal(result.rawDecision,'SELL');
});
test('cached pre-rule chart confirmations are cleared while saved historical trade facts survive',()=>{
 const b=bars(seed.map((n,i)=>i===10?86:n)),fresh=scanWyckoffOccurrences(b,{now:end}),old=fresh.map(x=>({...x,confirmedAt:end,setup:{}}));
 assert.equal(mergeWyckoffOccurrences(old,fresh,end)[0].confirmedAt,null);
 const actual=recordedWyckoffOccurrences([evaluate(b,{requireHigherRecovery:false})]);
 assert.equal(mergeWyckoffOccurrences(actual,fresh,end)[0].confirmedAt,end);
 assert.equal(mergeWyckoffOccurrences(actual,fresh,end)[0].source,'TRADE_RECORDED_SETUP');
});
test('read-only purchase audit reconstructs only closed candles and verifies original pattern identity',async()=>{
 const b=bars(seed.map((n,i)=>i===10?86:n)),setup=evaluate(b,{requireHigherRecovery:false});delete setup.secondRallyHigh;
 const row={symbol:'SOXSBUSDT',at:new Date(end+1000).toISOString(),wyckoffTrade:{entryMode:'spring_reclaim_confirmed',setup}};
 const raw=b.map(x=>[x.openTime,x.open,x.high,x.low,x.close,1000,x.closeTime-1]);
 raw.push([end,81,200,80,200,1000,end+step-1]);let calls=0;
 const fetcher=async url=>{calls++;assert.equal(url.origin,'https://api.binance.com');assert.equal(url.pathname,'/api/v3/klines');assert.equal(url.searchParams.get('symbol'),'SOXSBUSDT');assert.equal(+url.searchParams.get('endTime'),end+999);return {ok:true,json:async()=>raw};};
 const r=await auditRecovery(row,fetcher);assert.equal(calls,1);assert.equal(r.firstPrice,92);assert.equal(r.secondPrice,86);assert.equal(r.passed,false);assert.equal(r.source,'PUBLIC_CLOSED_CANDLES_AT_ENTRY');
 const mismatch=await auditRecovery({...row,wyckoffTrade:{setup:{...setup,rallyHigh:{...setup.rallyHigh,price:99}}}},fetcher);assert.equal(mismatch.passed,null);assert.equal(mismatch.reason,'ORIGINAL_PATTERN_NOT_RECONSTRUCTED');
 const missing=await auditRecovery({symbol:'SOXSBUSDT',at:row.at},()=>{throw Error('must not fetch');});assert.equal(missing.passed,null);assert.equal(missing.reason,'RECOVERY_NOT_RECORDED');
});
