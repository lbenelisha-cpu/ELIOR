import test from 'node:test';import assert from 'node:assert/strict';
import {studySlopeExits} from '../lib/ma-slope-research.mjs';
const bars=Array.from({length:900},(_,i)=>{const open=100+4*Math.sin((i-1)/15)+i*.005,close=100+4*Math.sin(i/15)+i*.005;return {openTime:i*300000,closeTime:(i+1)*300000-1,open,close,low:Math.min(open,close)-.05,high:Math.max(open,close)+.05,closed:true};});
test('offline comparison cannot see bars after the requested sample',()=>{
 const config={thresholdAngle:0,endIndex:600},a=studySlopeExits(bars,config),b=studySlopeExits(bars.slice(0,600),config);assert.deepEqual(a,b);assert.ok(a.trades>0);
 for(const t of a.journal){assert.ok(t.exitAt>t.entryAt);assert.ok(t.exitAt<=bars[599].closeTime);}
});
test('costs are charged on both legs and data gaps abort the study',()=>{
 const a=studySlopeExits(bars,{feePct:0,slippagePct:0}),b=studySlopeExits(bars,{feePct:1,slippagePct:0});assert.equal(a.trades,b.trades);assert.ok(b.returnPct<a.returnPct);
 assert.throws(()=>studySlopeExits(bars.filter((_,i)=>i!==500)),/INVALID_STUDY_BARS/);assert.throws(()=>studySlopeExits(bars,{feePct:-1}));
});
