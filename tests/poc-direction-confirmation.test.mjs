import test from 'node:test';
import assert from 'node:assert/strict';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {hourlyTrend,closedPocReclaim,assertDirectionConfirmation,DIRECTION_REPORT} from '../lib/poc-direction-confirmation.mjs';
import {channelEntry,channelEntryConfig,assertChannelSubmission} from '../lib/channel-primary-entry.mjs';
import {shortSignal,shortConfig} from '../lib/futures-short-policy.mjs';
import {assertPocEntry,assertSamePoc} from '../lib/channel-poc-entry.mjs';
const STEP=300000;
for(const platform of ['BINANCE','COLMEX'])for(const side of ['LONG','SHORT'])test(platform+' '+side+' requires aligned closed-hour trend and closed reclaim at scan and final dispatch',()=>{
 const input=pocFixture({platform,side}),config=side==='LONG'?channelEntryConfig({[platform+'_CHANNEL_PRIMARY_ENABLED']:'true',[platform+'_CHANNEL_PRIMARY_AFTER']:'2026-11-06T00:00Z'},platform):{...shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:'2026-11-06T00:00Z'}),platform};
 const evaluate=i=>(side==='LONG'?channelEntry:shortSignal)(i,config),ok=evaluate(input),poc=ok.setup?.poc;
 assert.equal(ok.ready,true,ok.reason);assert.equal(ok.conditions.version,DIRECTION_REPORT);assert.equal(ok.conditions.rows.length,5);
 assert.doesNotThrow(()=>assertPocEntry(ok.setup,input.price,input.now,input.liveBar));
 // The previous touch-only fixture no longer authorizes entry in either venue.
 const touch=pocFixture({platform,side,legacy:true});touch.trendBars=input.trendBars.map(b=>({...b}));touch.trendBars.splice(-touch.bars.length,touch.bars.length,...touch.bars);
 assert.equal(evaluate(touch).ready,false);
 const reversed=structuredClone(input);for(const b of reversed.trendBars){if(b.openTime<input.bars[0].openTime){const c=side==='LONG'?200:50;Object.assign(b,{open:c,close:c,high:c+.01,low:c-.01});}}
 const blocked=evaluate(reversed);assert.equal(blocked.ready,false);assert.match(blocked.reason,/HOURLY_(LONG|SHORT)_TREND_BLOCK/);
 assert.equal(evaluate({...input,trendBars:input.bars}).reason,'WAIT_HOURLY_TREND_HISTORY');
 const gap=structuredClone(input);gap.trendBars.splice(600,1);assert.equal(evaluate(gap).reason,'INVALID_HOURLY_TREND_DATA');
 const quoteBack=poc+(side==='LONG'?-.01:.01);assert.equal(evaluate({...input,price:quoteBack}).ready,false);
 assert.throws(()=>assertPocEntry(ok.setup,quoteBack,input.now,input.liveBar),/INVALIDATED/);
 const pastB=ok.setup.pocModel.anchorB.price+(side==='LONG'?.01:-.01);
 assert.equal(evaluate({...input,price:pastB}).ready,false);
 assert.throws(()=>assertPocEntry(ok.setup,pastB,input.now,input.liveBar),/INVALIDATED/);
 const corrupt=structuredClone(ok.setup);corrupt.directionConfirmation.trend.closedAt=NaN;assert.throws(()=>assertPocEntry(corrupt,input.price,input.now,input.liveBar),/CHANGED/);
 assert.throws(()=>assertPocEntry(ok.setup,input.price,input.liveBar.closeTime,input.liveBar));
 assert.equal(evaluate({...input,pocResetAfter:input.bars.at(-1).openTime+1}).ready,false);
 const altered=structuredClone(ok.setup);altered.directionConfirmation.trend.ema+=.001;assert.throws(()=>assertSamePoc(ok.setup,altered),/DIRECTION_CONFIRMATION_CHANGED/);
 const missing=structuredClone(ok.setup);delete missing.directionConfirmation;assert.throws(()=>assertPocEntry(missing,input.price,input.now,input.liveBar),/DIRECTION_CONFIRMATION_CHANGED/);
 if(side==='LONG')assert.throws(()=>assertChannelSubmission(reversed,config,{entryMode:'channel_breakout',patternId:ok.patternId,setup:ok.setup}),/TREND_BLOCK/);
});
test('EMA uses only completed hourly groups, an SMA50 seed and the previous EMA from the same calculation',()=>{
 const end=Date.parse('2026-11-06T20:00Z'),bars=[];
 for(let h=0;h<51;h++)for(let j=0;j<12;j++)bars.push({openTime:end-(51-h)*3600000+j*STEP,closeTime:end-(51-h)*3600000+(j+1)*STEP,close:100+h,closed:true});
 const t=hourlyTrend(bars,160,'LONG','BINANCE',end);assert.equal(t.previousEma,124.5);assert.equal(t.ema,125.5);assert.equal(t.closedAt,end);assert.equal(t.passed,true);
 const partial={openTime:end,closeTime:end+STEP,close:1,closed:true};assert.deepEqual(hourlyTrend([...bars,partial],160,'LONG','BINANCE',end+STEP),t);
 const future={...partial,closeTime:end+STEP,closed:false};assert.deepEqual(hourlyTrend([...bars,future],160,'LONG','BINANCE',end),t);
 const missing=bars.filter((_,i)=>i!==300);assert.equal(hourlyTrend(missing,160,'LONG','BINANCE',end).reason,'INVALID_HOURLY_TREND_DATA');
 assert.equal(hourlyTrend(bars.slice(12),160,'LONG','BINANCE',end).reason,'WAIT_HOURLY_TREND_HISTORY');
});
test('a reclaim may follow a prior touched candle, but never a touch before B or a confirmation outside its window',()=>{
 const at=1800000000000,m={side:'LONG',frozenAt:at,profile:{poc:100},anchorB:{price:110}},bar=(i,low,close)=>({openTime:at+i*STEP,closeTime:at+(i+1)*STEP,low,high:105,close,closed:true});
 const bars=[bar(0,99,99.5),bar(1,100.1,101)],live={openTime:at+2*STEP,closeTime:at+3*STEP,high:105,low:101};
 assert.equal(closedPocReclaim(m,bars,101,live,live.openTime+1).passed,true);
 assert.equal(closedPocReclaim(m,bars,101,live,live.closeTime).passed,false);
 assert.equal(closedPocReclaim(m,bars,101,live,live.openTime+1,at+1).passed,false);
 const before=bars.map(b=>({...b,openTime:b.openTime-2*STEP,closeTime:b.closeTime-2*STEP}));assert.equal(closedPocReclaim(m,before,101,live,live.openTime+1).passed,false);
});
