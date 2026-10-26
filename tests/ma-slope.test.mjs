import test from 'node:test';
import assert from 'node:assert/strict';
import {slopeHistory,analyzeSlope,slopeAngle,angleSlope,slopeReading,slopeExitCandidate} from '../lib/ma-slope.mjs';
import {stockSessionGap,equitySession} from '../lib/colmex-market-hours.mjs';
const STEP=300000,start=Date.UTC(2026,9,1);
const bars=(count=230,fn=i=>100+i)=>Array.from({length:count},(_,i)=>({openTime:start+i*STEP,closeTime:start+(i+1)*STEP-1,close:fn(i),closed:true}));
test('MA200 needs 200 bars plus the slope window; it is not an MA10',()=>{
 assert.equal(analyzeSlope(bars(199)).status,'WARMUP');assert.equal(analyzeSlope(bars(209)).status,'WAIT_WINDOW');
 const s=analyzeSlope(bars(210),{now:bars(210).at(-1).closeTime});assert.equal(s.status,'READY');assert.equal(s.slow.average,209.5);
 assert.ok(Math.abs(s.slow.pctPerMinute-100*(209.5/199.5-1)/50)<1e-10);
 assert.equal(s.minutes,50);assert.equal(analyzeSlope(bars(205),{lookbackBars:5}).minutes,25);
});
test('normalization is invariant to denomination and the fixed angle maps both directions',()=>{
 const a=analyzeSlope(bars()),b=analyzeSlope(bars(230,i=>(100+i)*.000001));
 assert.ok(Math.abs(a.slow.pctPerMinute-b.slow.pctPerMinute)<1e-10);
 assert.equal(slopeAngle(.01),45);assert.equal(slopeAngle(-.01),-45);assert.equal(slopeAngle(0),0);
 assert.ok(Math.abs(angleSlope(45)-.01)<1e-12);assert.equal(angleSlope(90),null);assert.equal(slopeAngle(NaN),null);
});
test('open and future candles cannot affect the reading; old candles never produce a current signal',()=>{
 const b=bars(),now=b.at(-1).closeTime;const future={openTime:now+1,closeTime:now+STEP,close:99999};
 assert.deepEqual(analyzeSlope([...b,future],{now}),analyzeSlope(b,{now}));
 assert.deepEqual(analyzeSlope([...b,{...future,closed:false}],{now:now+STEP}),analyzeSlope(b,{now:now+STEP}));
 const stale=analyzeSlope(b,{now:now+STEP*3});assert.equal(stale.status,'STALE');assert.equal(slopeReading(stale),'UNAVAILABLE');
});
test('gaps reset warmup, duplicate/out-of-order and invalid prices fail closed',()=>{
 const b=bars();b.splice(100,1);assert.equal(analyzeSlope(b).status,'WARMUP');
 for(const changed of [bars().concat(bars().at(-1)),bars().reverse(),bars().map((b,i)=>i===220?{...b,close:NaN}:b)])assert.equal(analyzeSlope(changed).status,'INVALID_DATA');
});
test('verified stock session breaks may warm MA200 but never compress an overnight slope window',()=>{
 const b=[];for(const day of ['2026-10-19','2026-10-20','2026-10-21','2026-10-22']){const s=equitySession(day);for(let t=s.openAt;t<s.closeAt;t+=STEP)b.push({openTime:t,closeTime:t+STEP,close:100+b.length*.01});}
 const at=234+4;
 const warm=analyzeSlope(b.slice(0,at),{now:b[at-1].closeTime,isSessionGap:stockSessionGap});assert.equal(warm.status,'WAIT_WINDOW');
 const early=b.slice(0,234+7);assert.equal(analyzeSlope(early,{now:early.at(-1).closeTime,isSessionGap:stockSessionGap,lookbackBars:5}).status,'READY');assert.equal(analyzeSlope(early,{now:early.at(-1).closeTime,isSessionGap:stockSessionGap,lookbackBars:10}).status,'WAIT_WINDOW');
 assert.equal(analyzeSlope(b,{now:b.at(-1).closeTime,isSessionGap:stockSessionGap}).status,'READY');
 assert.equal(analyzeSlope(b,{now:b.at(-1).closeTime}).status,'WARMUP');
});
test('a recent reversal can disagree with the long average and LONG/SHORT interpretation mirrors it',()=>{
 const b=bars(250,i=>i<220?100+i*.1:122-(i-220)*.2),s=analyzeSlope(b,{now:b.at(-1).closeTime});
 assert.ok(s.slow.pctPerMinute>0);assert.ok(s.fast.pctPerMinute<0);assert.equal(slopeReading(s,'LONG'),'AGAINST_CONFIRMED');assert.notEqual(slopeReading(s,'SHORT'),'AGAINST_CONFIRMED');
 const flat=analyzeSlope(bars(220,()=>100),{now:bars(220).at(-1).closeTime});assert.equal(slopeReading(flat),'FLAT');
});
test('research exit requires two closed readings after entry, handles SHORT, and rejects gaps',()=>{
 const history=[{closeTime:STEP,pctPerMinute:.02},{closeTime:2*STEP,pctPerMinute:-.01},{closeTime:3*STEP,pctPerMinute:-.02}];
 assert.equal(slopeExitCandidate(history,1),false);assert.equal(slopeExitCandidate(history,2),true);
 assert.equal(slopeExitCandidate(history,2,{entryAt:2*STEP}),false);
 assert.equal(slopeExitCandidate(history,2,{side:'SHORT'}),false);
 assert.equal(slopeExitCandidate(history.map(h=>({...h,pctPerMinute:-h.pctPerMinute})),2,{side:'SHORT'}),true);
 const gap=structuredClone(history);gap[2].closeTime+=STEP;assert.equal(slopeExitCandidate(gap,2),false);
});
