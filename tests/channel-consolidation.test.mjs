import test from 'node:test';
import assert from 'node:assert/strict';
import {channelConsolidation,assertConsolidationEntry,assertSameConsolidation} from '../lib/channel-consolidation.mjs';
const D=300000,start=Date.parse('2026-11-02T15:00Z');
const channel={ready:true,start:D,anchorStart:D,duration:D,width:5,intercept:100,slope:0};
function input({side='LONG',zone='MIDDLE',at=12}={}){
 const center={UPPER:103,LOWER:97,MIDDLE:100}[zone];
 // Broad alternating candles cannot be mistaken for a narrow consolidation.
 const history=Array.from({length:30},(_,i)=>({openTime:start+i*D,closeTime:start+(i+1)*D,open:100,close:100,high:105,low:95,closed:true}));
 for(let i=at;i<at+3;i++)Object.assign(history[i],{open:center,close:center+(i%2?.1:0),high:center+.5,low:center-.5});
 return {history,channel:{...channel},side,price:side==='LONG'?106:94,signalTime:start+30*D};
}
test('upper consolidation allows SHORT, lower allows LONG, central allows both, anywhere before entry',()=>{
 for(const at of [0,12,27])for(const zone of ['UPPER','LOWER','MIDDLE'])for(const side of ['LONG','SHORT']){
  const i=input({at,zone,side}),r=channelConsolidation(i),allowed=zone==='MIDDLE'||zone==='UPPER'&&side==='SHORT'||zone==='LOWER'&&side==='LONG';
  assert.equal(r.passed,allowed,JSON.stringify({at,zone,side,r}));assert.equal(r.zone,zone);assert.equal(r.startAt,start+at*D);assert.ok(r.endAt<=i.signalTime);
  if(allowed)assert.doesNotThrow(()=>assertConsolidationEntry(r,side,i.price,i.signalTime));
  else assert.equal(r.reason,'CHANNEL_CONSOLIDATION_SIDE_BLOCK');
 }
});
test('latest consolidation wins even when an older range would permit the opposite side',()=>{
 const i=input({zone:'LOWER',side:'LONG',at:2});
 for(let k=20;k<23;k++)Object.assign(i.history[k],{open:103,close:103,high:103.5,low:102.5});
 const blocked=channelConsolidation(i);assert.equal(blocked.zone,'UPPER');assert.equal(blocked.passed,false);assert.equal(blocked.startAt,start+20*D);
 for(let k=26;k<29;k++)Object.assign(i.history[k],{open:100,close:100,high:100.5,low:99.5});
 const middle=channelConsolidation(i);assert.equal(middle.zone,'MIDDLE');assert.equal(middle.passed,true);
});
test('missing ranges, two candles, wide movement and a directional run do not satisfy consolidation',()=>{
 for(const mutate of [i=>i.history.splice(13,1),i=>i.history[13].high=105,i=>{for(let k=12;k<15;k++)Object.assign(i.history[k],{open:99+k-12,close:99+k-12,high:99.1+k-12,low:98.9+k-12});}]){
  const i=input();mutate(i);assert.equal(channelConsolidation(i).reason,'WAIT_CHANNEL_CONSOLIDATION');
 }
});
test('entry requires leaving the completed range in its intended direction',()=>{
 for(const side of ['LONG','SHORT']){
  const i=input({side});i.price=side==='LONG'?100.5:99.5;
  assert.equal(channelConsolidation(i).reason,'WAIT_CHANNEL_CONSOLIDATION_BREAK');
 }
});
test('open/future candles cannot supply evidence; an overnight gap cannot be one range',()=>{
 for(const mutate of [i=>i.history[13].closed=false,i=>i.signalTime=i.history[13].openTime,i=>i.history[13].close=NaN]){
  const i=input();mutate(i);assert.equal(channelConsolidation(i).reason,'INVALID_CHANNEL_CONSOLIDATION');
 }
 const i=input();for(const b of i.history.slice(13)){b.openTime+=86400000;b.closeTime+=86400000;}i.signalTime+=86400000;
 assert.equal(channelConsolidation(i).reason,'WAIT_CHANNEL_CONSOLIDATION');
});
test('location uses channel boundaries at the range time, including a sloped channel',()=>{
 const i=input({zone:'LOWER'});i.channel.slope=.1;
 for(const [k,b] of i.history.entries())for(const key of ['open','high','low','close'])b[key]+=k*.1;
 const r=channelConsolidation(i);assert.equal(r.zone,'LOWER');assert.equal(r.passed,true);
});
test('final guard rejects absent, changed, future or mismatched consolidation evidence',()=>{
 const i=input(),e=channelConsolidation(i);
 for(const patch of [{version:'OLD'},{passed:false},{zone:'UPPER'},{endAt:i.signalTime+D},{side:'SHORT'},{rangeFraction:1},{bars:2}])assert.throws(()=>assertConsolidationEntry({...e,...patch},'LONG',106,i.signalTime),/CONSOLIDATION/);
 assert.throws(()=>assertConsolidationEntry(null,'LONG',106,i.signalTime),/CONSOLIDATION_CHANGED/);
 assert.throws(()=>assertSameConsolidation(e,{...e,low:e.low-.01}),/CONSOLIDATION_CHANGED/);
 assert.throws(()=>assertSameConsolidation(null,null),/CONSOLIDATION_CHANGED/);
 assert.doesNotThrow(()=>assertSameConsolidation(e,structuredClone(e)));
});
