import test from 'node:test';import assert from 'node:assert/strict';import {simulateExit,EXIT_STUDY_VARIANTS} from '../lib/exit-study.mjs';
const at=Date.parse('2026-10-12T00:00:01Z'),step=300000,entry={at:new Date(at).toISOString(),price:100,amountUsdt:30,symbol:'TESTUSDT'};
const bars=closes=>closes.map((close,i)=>({openTime:at-1000+i*step,closeTime:at-1001+(i+1)*step,open:close,close,high:close+20,low:close-20,closed:true}));
test('trail uses only already observed closes, and executes at next open with costs',()=>{
 const r=simulateExit(entry,bars([100,110,107,104,130,120,120]),EXIT_STUDY_VARIANTS[1],{horizonMs:5*step});
 assert.equal(r.exit.at,at-1000+3*step);assert.equal(r.exit.reason,'TRAIL');assert.equal(r.peakPrice,110);assert.equal(r.exit.price,104*.9995);assert.equal(r.fullHorizonBest.price,130);assert.ok(r.net<1.2);
 const changed=simulateExit(entry,bars([100,110,107,104,900,120,120]),EXIT_STUDY_VARIANTS[1],{horizonMs:5*step});assert.deepEqual(changed.exit,r.exit);
});
test('week hold suppresses profit exits, stop remains active and missing horizon is not a completed outcome',()=>{
 const r=simulateExit(entry,bars([100,110,107,104,130,120,120]),EXIT_STUDY_VARIANTS[0],{horizonMs:5*step});assert.equal(r.exit.reason,'HORIZON_MARK');
 const stopped=simulateExit(entry,bars([100,89,88,100,105,108,108]),EXIT_STUDY_VARIANTS[0],{horizonMs:5*step});assert.equal(stopped.exit.reason,'STOP_10');assert.equal(stopped.exit.price,88*.9995);
 assert.equal(simulateExit(entry,bars([100,110]),EXIT_STUDY_VARIANTS[1],{horizonMs:5*step}).covered,false);
});
