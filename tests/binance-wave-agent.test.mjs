import test from 'node:test';import assert from 'node:assert/strict';import {evaluateWaveStrategy,decidePosition} from '../lib/binance-wave-agent.mjs';
const candles=arr=>arr.map((close,i)=>({close,time:i}));
test('BUY requires MA, 4% and wave reversal',()=>{const base=Array.from({length:200},(_,i)=>100+i*.1);const x=[...base,130,120,126.5];const s=evaluateWaveStrategy(candles(x),{minWave:4,maPeriod:200});assert.equal(s.direction,'UP');assert.ok(s.previousDownWave>7);assert.equal(s.buyConfirmed,false);});
test('position state prevents duplicate BUY',()=>{assert.equal(decidePosition({buyConfirmed:true,sellConfirmed:false},'LONG'),'HOLD');assert.equal(decidePosition({buyConfirmed:true,sellConfirmed:false},'CASH'),'BUY')});
test('SELL only closes LONG',()=>{assert.equal(decidePosition({buyConfirmed:false,sellConfirmed:true},'LONG'),'SELL');assert.equal(decidePosition({buyConfirmed:false,sellConfirmed:true},'CASH'),'HOLD')});
