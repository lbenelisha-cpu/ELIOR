import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWyckoff} from '../lib/wyckoff-strategy.mjs';
import {liveSpringRsi} from '../lib/wyckoff-spring-rsi.mjs';
import {evaluateDailyTrade} from '../lib/wyckoff-evaluation.mjs';
import {legacyEntrySignal as entrySignal} from '../lib/colmex-auto-policy.mjs';
import {chartAnalysisMarks} from '../lib/colmex-chart-view.mjs';
const step=300000,base=Date.parse('2026-10-22T13:30:00Z');
const seed=[95,97,100,90,80,85,92,87,82,84,86,85,86];
function bars(prices,green=[0,1]){return prices.map((close,i)=>({openTime:base+i*step,closeTime:base+(i+1)*step,open:green.includes(i)?close-1:close,high:close,low:green.includes(i)?close-1:close,close,timeframe:'5m',closed:true}));}
function analyze(rows){return evaluateWyckoff(rows,{now:rows.at(-1).closeTime,timeframe:'5m',rollingSearch:true});}
test('a newer lower local peak replaces an unfinished old structure in shared pattern search and the legacy comparison',()=>{
 const rows=bars([...seed,70,72,74,76,75],[0,1,14,15]);
 const s=analyze(rows);assert.equal(s.phase,'FIRST_LOW');assert.equal(s.initialPeak.price,76);assert.equal(s.initialPeak.index,16);
 const now=rows.at(-1).closeTime+1000,live={price:60,priceAsOf:now,now};
 const binance=liveSpringRsi(rows,live),colmex=entrySignal(rows,now,0,[],live);
 assert.equal(binance.initialPeak.price,76);assert.equal(binance.buyConfirmed,false);assert.equal(colmex.ready,false);assert.equal(colmex.phase,binance.phase);
});
test('an unbought Spring expires even if RSI and quote are current',()=>{
 const rows=bars([...seed,70,...Array(5).fill(71)]),now=rows.at(-1).closeTime+1000;
 assert.equal(analyze(rows).springLow,undefined);
 const live={price:50,priceAsOf:now,now};assert.equal(liveSpringRsi(rows,live).buyConfirmed,false);assert.equal(entrySignal(rows,now,0,[],live).ready,false);
});
test('an unfinished first low cannot pin the scanner for multiple sessions',()=>{
 const rows=bars([95,97,100,90,...Array(90).fill(80)]);const s=analyze(rows);
 assert.equal(s.phase,'SEARCH_PEAK');assert.equal(s.initialPeak,undefined);
});
test('sale boundary discards the previous structure while preserving RSI history',()=>{
 const rows=bars([...Array(16).fill(95),...seed,70],[16,17]),now=rows.at(-1).closeTime+1000;
 const s=liveSpringRsi(rows,{price:50,priceAsOf:now,now,after:rows.at(-2).closeTime});assert.equal(s.buyConfirmed,false);assert.equal(s.initialPeak,undefined);
});
test('held trades preserve entry structure and exits independently of the search',()=>{
 const setup={initialPeak:{price:100,time:base},firstLow:{price:80,time:base+step}};
 const position={setup,entryPrice:81,peakPrice:90,entryAt:new Date(base).toISOString(),peakAt:new Date(base+step).toISOString(),timeframe:'5m'};
 const ev=evaluateDailyTrade({symbol:'TSLA',bars:[],price:82,priceAsOf:new Date(base+2*step).toISOString(),now:base+2*step,position,entryMode:'spring_rsi_live',exitEvaluator:()=>({sell:false,reason:'HOLD'})});
 assert.equal(ev.position,'LONG');assert.equal(ev.strategy.setup,setup);
 const marks=chartAnalysisMarks([],base+2*step,{position});assert.equal(marks.cards.find(p=>p.kind==='initialPeak').price,100);
});
