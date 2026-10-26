import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeScheduledSlope} from '../lib/ma-slope-schedule.mjs';
import {slopeDecision} from '../lib/ma-slope-decision.mjs';
import {stockSessionGap,equitySession} from '../lib/colmex-market-hours.mjs';
const STEP=300000,anchor=Date.UTC(2026,9,26,16,0);
const bars=(until=anchor,exactClose=false)=>Array.from({length:240+(until-anchor)/STEP},(_,i)=>({openTime:anchor+(i-240)*STEP,closeTime:anchor+(i-239)*STEP-(exactClose?0:1),close:100*1.001**i,closed:true}));
test('MA100 uses exactly 100 closed five-minute bars and retains MA200',()=>{
 const b=bars(),s=analyzeScheduledSlope(b,{now:anchor});
 assert.equal(s.status,'READY');assert.equal(s.fastPeriod,100);
 assert.ok(Math.abs(s.fast.average-b.slice(-100).reduce((sum,b)=>sum+b.close,0)/100)<1e-9);
 assert.ok(Math.abs(s.slow.average-b.slice(-200).reduce((sum,b)=>sum+b.close,0)/200)<1e-9);
 assert.equal(s.confirmationIntervalMs,600000);assert.equal(s.fast.closeTime-s.previousFast.closeTime,600000);
 assert.match(slopeDecision(s).detail,/MA100/);assert.match(slopeDecision(s).detail,/MA200/);assert.doesNotMatch(slopeDecision(s).detail,/MA20\b|MA1000/);
});
test('10-minute measurements hold at the intervening five-minute close and advance at the next check',()=>{
 const first=analyzeScheduledSlope(bars(),{now:anchor}),held=analyzeScheduledSlope(bars(anchor+STEP),{now:anchor+STEP});
 assert.deepEqual(held.fast,first.fast);assert.deepEqual(held.slow,first.slow);assert.equal(held.asOf,first.asOf);
 assert.equal(held.latestDataAt,anchor+STEP-1);assert.equal(held.nextCheckAt,anchor+2*STEP);
 const next=analyzeScheduledSlope(bars(anchor+2*STEP),{now:anchor+2*STEP});
 assert.equal(next.asOf,anchor+2*STEP-1);assert.notEqual(next.fast.average,first.fast.average);
});
test('20-minute measurements remain valid for the full interval only while source data keeps arriving',()=>{
 const first=analyzeScheduledSlope(bars(),{now:anchor,checkMinutes:20});
 const held=analyzeScheduledSlope(bars(anchor+3*STEP),{now:anchor+3*STEP,checkMinutes:20});
 assert.equal(held.status,'READY');assert.deepEqual(held.fast,first.fast);assert.equal(held.confirmationIntervalMs,1200000);
 assert.equal(held.fast.closeTime-held.previousFast.closeTime,1200000);
 const stale=analyzeScheduledSlope(bars(),{now:anchor+3*STEP,checkMinutes:20});assert.equal(stale.status,'STALE');assert.equal(slopeDecision(stale).state,'UNAVAILABLE');
 const next=analyzeScheduledSlope(bars(anchor+4*STEP),{now:anchor+4*STEP,checkMinutes:20});assert.equal(next.asOf,anchor+4*STEP-1);
});
test('late delivery at a check never claims an old sample is the new measurement',()=>{
 const s=analyzeScheduledSlope(bars(anchor+STEP),{now:anchor+2*STEP});
 assert.equal(s.status,'WAIT_UPDATE');assert.equal(s.asOf,anchor+STEP-1);assert.equal(slopeDecision(s).state,'UNAVAILABLE');
 const open={openTime:anchor+STEP,closeTime:anchor+2*STEP-1,close:99999,closed:false};
 assert.equal(analyzeScheduledSlope([...bars(anchor+STEP),open],{now:anchor+2*STEP}).status,'WAIT_UPDATE');
});
test('cached data, repeated calls and a data gap cannot create confirmation or freeze a valid badge',()=>{
 const b=bars(),a=analyzeScheduledSlope(b,{now:anchor});
 for(let i=1;i<5;i++){const repeated=analyzeScheduledSlope(b,{now:anchor+i*1000});assert.deepEqual(repeated.fast,a.fast);assert.deepEqual(repeated.previousFast,a.previousFast);}
 const gap=bars(anchor+2*STEP);gap.splice(-2,1);
 assert.equal(slopeDecision(analyzeScheduledSlope(gap,{now:anchor+2*STEP})).state,'UNAVAILABLE');
 assert.equal(analyzeScheduledSlope([...b,b.at(-1)],{now:anchor}).status,'INVALID_DATA');
 for(const checkMinutes of [0,5,15,NaN])assert.equal(analyzeScheduledSlope(b,{now:anchor,checkMinutes}).status,'INVALID_DATA');
});
test('broker exact-boundary timestamps and Binance millisecond endings select the same closes',()=>{
 const a=analyzeScheduledSlope(bars(),{now:anchor}),b=analyzeScheduledSlope(bars(anchor,true),{now:anchor});
 assert.equal(a.status,'READY');assert.equal(b.status,'READY');assert.equal(a.fast.average,b.fast.average);
 assert.equal(a.asOf+1,b.asOf);assert.equal(a.checkAt,b.checkAt);
});
test('exit confirmation uses the selected check interval, not two adjacent five-minute candles',()=>{
 for(const minutes of [10,20]){
  const interval=minutes*60000,s={status:'READY',fastPeriod:100,confirmationIntervalMs:interval,slow:{pctPerMinute:.01},fast:{pctPerMinute:-.02,closeTime:anchor},previousFast:{pctPerMinute:-.01,closeTime:anchor-interval}};
  assert.equal(slopeDecision(s).state,'EXIT_WARNING');assert.match(slopeDecision(s).detail,/MA100/);
  assert.equal(slopeDecision({...s,previousFast:{pctPerMinute:-.01,closeTime:anchor-STEP}}).state,'UNAVAILABLE');
  assert.equal(slopeDecision({...s,previousFast:{pctPerMinute:.01,closeTime:anchor-interval}}).state,'REVERSAL_PENDING');
 }
});
test('Colmex can warm across verified sessions but confirmation never bridges a market closure',()=>{
 const b=[];for(const day of ['2026-10-21','2026-10-22','2026-10-23','2026-10-26']){const session=equitySession(day);for(let t=session.openAt;t<session.closeAt;t+=STEP)b.push({openTime:t,closeTime:t+STEP,close:100+b.length*.01});}
 const opening=equitySession('2026-10-26').openAt,early=b.filter(b=>b.closeTime<=opening+2*STEP);
 assert.notEqual(analyzeScheduledSlope(early,{now:opening+2*STEP,isSessionGap:stockSessionGap}).status,'READY');
 const now=opening+90*60000,ready=b.filter(b=>b.closeTime<=now),s=analyzeScheduledSlope(ready,{now,isSessionGap:stockSessionGap,checkMinutes:20});
 assert.equal(s.status,'READY');assert.ok(s.previousFast.closeTime>opening);
});
