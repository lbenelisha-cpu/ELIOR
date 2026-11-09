import test from 'node:test';
import assert from 'node:assert/strict';
import {movingAverage} from '../chart-indicator-controls.js';
test('moving averages use the full preceding history and never shorten the requested period',()=>{
 const bars=Array.from({length:250},(_,i)=>({close:i+1}));
 for(const period of [20,50,100,200]){const v=movingAverage(bars,period);assert.equal(v[period-2],null);assert.equal(v[period-1],(period+1)/2);assert.equal(v[249],250-(period-1)/2);assert.equal(v.length,bars.length);}
});
test('missing prices break a moving average until the gap has left the window',()=>{
 const bars=Array.from({length:50},()=>({close:10}));bars[10].close=NaN;const v=movingAverage(bars,20);assert.equal(v[29],null);assert.equal(v[30],10);
});
