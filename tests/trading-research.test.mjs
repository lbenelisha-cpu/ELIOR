import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RESEARCH_PROTOCOL,researchSnapshot,researchPhase,appendResearchOutcome,dayBlockInterval,tradingResearchReport} from '../lib/trading-research.mjs';
import {recordStrategyObservation,strategyFollowupReport} from '../lib/strategy-followup.mjs';
import {renderTradingResearch} from '../trading-research-ui.js';
import {RESEARCH_SOURCES} from '../lib/trading-research-sources.mjs';
import {evaluateDailyTrade} from '../lib/wyckoff-evaluation.mjs';
const step=300000,day=86400000,at=Date.parse('2026-10-27T15:00Z');
function bars(n=205,slope=.1){return Array.from({length:n},(_,i)=>({openTime:at-(n-i)*step,closeTime:at-(n-i-1)*step,open:100+i*slope,close:100+i*slope,high:100+i*slope+.05,low:100+i*slope-.05,volume:100,closed:true}));}
const cmp=id=>({variants:{legacy:true,confirmed:false,confirmed_trend:false,confirmed_volume:false,full_quality:false},legacy:{patternId:id,entryMode:'spring_rsi_live'}});
const event=(id='one')=>({symbol:'ABCUSDT',bars:bars(),at,price:120.4,version:'BINANCE_CONFIRMED_QUALITY_V1',comparison:cmp(id)});
test('features are causal and normalized; future/open candles do not leak and missing volume is unknown',()=>{
 const b=bars(),snapshot=researchSnapshot(b,at,{continuous:true});assert.equal(snapshot.regime,'UP');assert.equal(snapshot.volumeRatio,1);assert.ok(snapshot.atrPct>0);assert.equal(snapshot.efficiency20,1);
 assert.deepEqual(researchSnapshot([...b,{...b.at(-1),closeTime:at+step,close:9999},{...b.at(-1),closed:false,close:9999}],at,{continuous:true}),snapshot);
 assert.deepEqual(researchSnapshot(b.map(x=>({...x,closeTime:x.closeTime-1})),at,{continuous:true}),snapshot);
 b.at(-1).volume=null;const unknown=researchSnapshot(b,at);assert.equal(unknown.volumeRatio,null);assert.equal(unknown.vwapDistancePct,null);
 assert.equal(researchSnapshot(bars(205,-.1),at).regime,'DOWN');assert.equal(researchSnapshot(bars(205,0),at).regime,'MIXED');
});
test('missing, stale, malformed, duplicated and out-of-order bars cannot become valid research features',()=>{
 for(const b of [bars(20),bars().filter((_,i)=>i!==100),[...bars(),bars().at(-1)],bars().reverse()])assert.equal(researchSnapshot(b,at,{continuous:true}).ready,false);
 assert.equal(researchSnapshot(bars(),at+step+1).ready,false);
 const malformed=bars();malformed.at(-1).high=1;assert.equal(researchSnapshot(malformed,at).ready,false);
});
test('calendar-approved equity session gaps are accepted for stocks but not continuous crypto',()=>{
 const a=Date.parse('2026-10-26T20:00Z'),b=Date.parse('2026-10-27T13:35Z');
 const series=bars(60).map((row,i)=>({...row,closeTime:i<40?a-(39-i)*step:b+(i-40)*step}));
 assert.equal(researchSnapshot(series,series.at(-1).closeTime,{continuous:false}).ready,true);
 assert.equal(researchSnapshot(series,series.at(-1).closeTime,{continuous:true}).ready,false);
});
test('chronological windows are frozen, and overlapping outcomes or near-boundary starts are embargoed',()=>{
 assert.equal(researchPhase(at,at+1800000,at),'development');
 assert.equal(researchPhase(at+14*day-1000,at+14*day+1000,at),'embargo');
 assert.equal(researchPhase(at+14*day+1000,at+14*day+1801000,at),'embargo');
 assert.equal(researchPhase(at+15*day,at+15*day+1800000,at),'validation');
 assert.equal(researchPhase(at+22*day,at+22*day+1800000,at),'holdout');
 assert.equal(researchPhase(at+29*day,at+29*day+1800000,at),'continuation');
});
test('outcomes survive restart without duplicates, use full closed paths and ignore intrabar highs',()=>{
 let state={};recordStrategyObservation(state,event());state=JSON.parse(JSON.stringify(state));
 const path=Array.from({length:6},(_,i)=>({closeTime:at+(i+1)*step,close:120.4+(i===2?-2:i),high:9999,low:.01,closed:true}));
 recordStrategyObservation(state,{...event(),at:at+6*step,bars:path});recordStrategyObservation(state,{...event(),at:at+6*step,bars:path});
 const r=strategyFollowupReport(state).research;assert.equal(r.retained,1);assert.equal(r.groups[0].pathComplete,1);assert.ok(r.groups[0].meanFavorableClosePct<5);assert.ok(r.groups[0].meanAdverseClosePct<0);assert.equal(r.latest[0].regime,'UP');
 assert.equal(r.groups[0].costStress[1].meanReturnAfterAssumedCostPct,r.groups[0].meanReturnPct-.3);assert.equal(r.groups[0].interval,null);
});
test('unfinished endpoints do not resolve; missing paths remain unknown and pre-upgrade observations are not backfilled',()=>{
 const state={};recordStrategyObservation(state,event());
 recordStrategyObservation(state,{...event(),at:at+1800000,bars:[{closeTime:at+1800000,close:130,closed:false}]});assert.equal(strategyFollowupReport(state).research.retained,0);
 recordStrategyObservation(state,{...event(),at:at+1800000,bars:[{closeTime:at+1800000,close:130,closed:true}]});const g=strategyFollowupReport(state).research.groups[0];assert.equal(g.pathComplete,0);assert.equal(g.meanFavorableClosePct,null);assert.equal(g.meanAdverseClosePct,null);
 const review={researchStartedAt:at};appendResearchOutcome(review,{at,price:100,id:'old'}, {closeTime:at+1800000,close:101},[]);assert.equal(review.researchSamples,undefined);
});
test('block interval requires many distinct days, preserves clusters and is deterministic',()=>{
 const samples=Array.from({length:120},(_,i)=>({at:at+Math.floor(i/4)*day,returnPct:Math.floor(i/4)%2?1:-1}));
 assert.equal(dayBlockInterval(samples.map(s=>({...s,at}))),null);assert.equal(dayBlockInterval(samples.slice(0,99)),null);
 const interval=dayBlockInterval(samples);assert.deepEqual(dayBlockInterval(samples),interval);assert.equal(interval.days,30);assert.ok(interval.low<0&&interval.high>0);
 const positive=dayBlockInterval(samples.map(s=>({...s,returnPct:2})));assert.equal(positive.low,2);assert.equal(positive.high,2);
});
test('storage retention is bounded, counted and does not combine policy versions',()=>{
 const row={id:'one',group:'V1|spring_rsi_live|legacy',symbol:'X',at,price:100,context:{regime:'UP'},researchVersion:RESEARCH_PROTOCOL.version};
 const review={researchStartedAt:at,researchSamples:Array.from({length:2000},(_,i)=>({id:'old'+i,group:'V0|spring_rsi_live|legacy',at:at-2000+i,endAt:at+1800000,returnPct:1,context:{regime:'UP'},phase:'development',pathComplete:false}))};
 appendResearchOutcome(review,row,{closeTime:at+1800000,close:102},[]);assert.equal(review.researchSamples.length,2000);assert.equal(review.researchPruned,1);assert.equal(tradingResearchReport(review).groups.length,2);
 appendResearchOutcome(review,{...row,id:'late',at:at+91*day},{closeTime:at+91*day+1800000,close:102},[]);assert.equal(review.researchSamples.length,1);assert.equal(review.researchPruned,2001);
});
test('net expectancy and profit factor never treat unknown fees as zero or an unbounded result as infinity',()=>{
 const r=strategyFollowupReport({},[{netPnl:6},{netPnl:-2}]).actual[0];assert.equal(r.expectancyNet,2);assert.equal(r.profitFactor,3);
 assert.equal(strategyFollowupReport({},[{netPnl:6},{netPnl:null}]).actual[0].expectancyNet,null);
 assert.equal(strategyFollowupReport({},[{netPnl:6}]).actual[0].profitFactor,null);
});
test('monitoring leaves the live entry result and input candles unchanged',()=>{
 const input={symbol:'ABCUSDT',bars:bars(),now:at+1000,price:120.4,priceAsOf:new Date(at+1000).toISOString(),timeframe:'5m',entryMode:'confirmed_quality',allowEarlyWave:true};
 const before=evaluateDailyTrade(input),serialized=JSON.stringify(input);recordStrategyObservation({}, {...event(),comparison:before.comparison});
 assert.equal(JSON.stringify(input),serialized);assert.deepEqual(evaluateDailyTrade(input),before);
});
test('UI presents primary sources, backend unknown state, uncertainty and research-only costs without HTML injection',()=>{
 const el=()=>({children:[],textContent:'',append(...items){this.children.push(...items);}}),host=el(),doc={createElement:el},text=node=>node.textContent+' '+node.children.map(text).join(' ');
 renderTradingResearch(host,null,{document:doc});assert.match(text(host),/טרם אומתה/);assert.match(text(host),/מקורות נבחרים/);assert.equal(RESEARCH_SOURCES.length,11);assert.ok(RESEARCH_SOURCES.every(s=>s.url.startsWith('https://')));
 const state={};recordStrategyObservation(state,event());recordStrategyObservation(state,{...event(),at:at+1800000,bars:[{closeTime:at+1800000,close:125}]});renderTradingResearch(host,strategyFollowupReport(state).research,{document:doc});
 assert.match(text(host),/תרחישי עלות בלבד/);assert.match(text(host),/אינן מוסיפות הוראות מסחר/);assert.match(text(host),/100 איתותים/);
 assert.match(fs.readFileSync(new URL('../scripts/install-confirmed-quality.sh',import.meta.url),'utf8'),/researchMonitoring\?\.version==='TRADING_RESEARCH_V1'/);
});
