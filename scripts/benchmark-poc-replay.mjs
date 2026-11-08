import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const count=2016,now=(count+1)*300000;
const inputs=Array.from({length:50},(_,symbol)=>({side:symbol%2?'LONG':'SHORT',now,price:120+symbol,
 bars:Array.from({length:count},(_,i)=>{const p=100+symbol+Math.sin(i*.4)*3+i*.01;return {openTime:(i+1)*300000,closeTime:(i+2)*300000,open:p,close:p+.1,high:p+.5,low:p-.5,volume:100,closed:true};})}));
function load(file){const context=vm.createContext({structuredClone});for(const name of ['regression-trend.js','parallel-channel.js',file])vm.runInContext(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),context);return context.LEVI_CHANNEL_POC;}
const old=load('tests/fixtures/channel-poc-before-cache.js'),cached=load('channel-poc-model.js');
const t=performance.now(),expected=inputs.map(x=>old.analyze(x)),baselineMs=performance.now()-t;
inputs.forEach((x,i)=>assert.equal(JSON.stringify(cached.analyze(x)),JSON.stringify(expected[i])));
const warm=performance.now();inputs.forEach((x,i)=>assert.equal(JSON.stringify(cached.analyze(x)),JSON.stringify(expected[i])));
console.log(JSON.stringify({symbols:50,closedBarsPerSymbol:count,baselineMs,warmMs:performance.now()-warm}));
