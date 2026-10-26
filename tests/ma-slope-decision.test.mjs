import test from 'node:test';
import assert from 'node:assert/strict';
import {slopeDecision} from '../lib/ma-slope-decision.mjs';
import {analyzeSlope} from '../lib/ma-slope.mjs';
const snapshot=(slow=.02,fast=.03,previous=.02)=>({status:'READY',slow:{pctPerMinute:slow},fast:{pctPerMinute:fast,closeTime:600000},previousFast:{pctPerMinute:previous,closeTime:300000}});
test('entry support requires both averages in the chosen direction and no short-term weakening',()=>{
 assert.equal(slopeDecision(snapshot()).state,'ENTRY_SUPPORT');
 assert.equal(slopeDecision(snapshot(.02,.01,.02)).state,'WEAKENING');
 assert.equal(slopeDecision(snapshot(-.02,.03,.02)).state,'MIXED');
 assert.equal(slopeDecision(snapshot(0,.03,.02)).state,'BROAD_FLAT');
});
test('exit warning needs two negative closed readings; zero and a first reversal do not confirm',()=>{
 assert.equal(slopeDecision(snapshot(.02,-.01,-.02)).state,'EXIT_WARNING');
 assert.equal(slopeDecision(snapshot(.02,-.01,.02)).state,'REVERSAL_PENDING');
 assert.equal(slopeDecision(snapshot(.02,-.01,0)).state,'REVERSAL_PENDING');
 assert.equal(slopeDecision(snapshot(.02,0,-.01)).state,'FLAT');
 assert.equal(slopeDecision(snapshot(0,0,0)).tone,'neutral');
 const first=snapshot(.02,-.01,.02);for(let i=0;i<5;i++)assert.equal(slopeDecision(first).state,'REVERSAL_PENDING');
});
test('missing, stale, invalid or nonconsecutive data never produce an actionable-looking badge',()=>{
 for(const status of ['NO_DATA','WARMUP','WAIT_WINDOW','STALE','INVALID_DATA'])assert.equal(slopeDecision({...snapshot(),status}).state,'UNAVAILABLE');
 for(const value of [null,{},snapshot(NaN),snapshot(.02,Infinity),{...snapshot(),previousFast:{pctPerMinute:-.01,closeTime:600000}},{...snapshot(),previousFast:{pctPerMinute:-.01,closeTime:0}}])assert.equal(slopeDecision(value).tone,'neutral');
});
test('SHORT analysis mirrors LONG without changing the meaning of warning or weakening',()=>{
 for(const [slow,fast,previous] of [[.02,.03,.02],[.02,.01,.02],[.02,-.01,-.02],[.02,-.01,.02],[-.02,.03,.02]])assert.deepEqual(slopeDecision(snapshot(slow,fast,previous)),slopeDecision(snapshot(-slow,-fast,-previous),'SHORT'));
 assert.throws(()=>slopeDecision(snapshot(),'OTHER'),/INVALID_SLOPE_SIDE/);
});
test('real candle analysis excludes the live candle and ages a valid badge to unavailable',()=>{
 const step=300000,now=Math.floor(Date.now()/step)*step;
 const bars=Array.from({length:230},(_,i)=>({openTime:now+(i-230)*step,closeTime:now+(i-229)*step-1,close:100*1.001**i,closed:true}));
 const ready=analyzeSlope(bars,{now});assert.equal(slopeDecision(ready).state,'ENTRY_SUPPORT');
 const open={openTime:now,closeTime:now+step-1,close:1,closed:false};
 assert.deepEqual(slopeDecision(analyzeSlope([...bars,open],{now})),slopeDecision(ready));
 assert.equal(slopeDecision(analyzeSlope(bars,{now:now+step*3})).state,'UNAVAILABLE');
});
