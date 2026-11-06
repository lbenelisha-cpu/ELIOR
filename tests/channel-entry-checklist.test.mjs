import test from 'node:test';
import assert from 'node:assert/strict';
import '../channel-entry-checklist.js';
import {channelEntry,channelEntryConfig} from '../lib/channel-primary-entry.mjs';
import {shortSignal,shortConfig} from '../lib/futures-short-policy.mjs';

const {project}=globalThis.LEVI_ENTRY_CHECKLIST;
const D=300000,end=Date.parse('2026-11-06T10:00:00Z'),now=end+1000;
const configs={LONG:channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true',BINANCE_CHANNEL_PRIMARY_AFTER:new Date(end-D).toISOString()}),SHORT:shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:new Date(end-D).toISOString()})};
function input(side){
 const sell=side==='SHORT';
 const bars=Array.from({length:205},(_,i)=>{const time=end-(205-i)*D,up=100+i*.02+Math.cos(i*Math.PI/5),p=sell?210-up:up;return {openTime:time,closeTime:time+D,open:p,close:p,high:p+.1,low:p-.1,volume:1000,closed:true};});
 for(const [j,b] of bars.slice(-3).entries()){const p=(sell?105.95:104.05)+(j===1?.01:0);Object.assign(b,{open:p,close:p,high:p+.1,low:p-.1});}
 return {bars,price:sell?104:106,priceAsOf:now,now,liveBar:{openTime:end,closeTime:end+D,open:105,close:sell?104:106,high:sell?105.1:106.1,low:sell?103.9:104.9,volume:2000,closed:false,receivedAt:now}};
}
const evaluate=(side,i)=>side==='SHORT'?shortSignal(i,configs[side]):channelEntry(i,configs[side]);
const view=(side,reason,extra={})=>project({side,reason,at:now,now,expiresAt:end+D,transport:true,supported:true,...extra});
const state=(v,id)=>v.rows.find(r=>r.id===id).state;

test('checklists follow real LONG and SHORT results without treating observation as account approval',()=>{
 for(const side of ['LONG','SHORT']){
  const i=input(side),good=evaluate(side,i);assert.equal(good.ready,true,good.reason);
  const all=view(side,good.reason);assert.equal(all.count,all.total);assert.equal(state(all,'execution'),'unknown');
  i.liveBar.volume=1499;
  const low=evaluate(side,i),waiting=view(side,low.reason);
  assert.match(low.reason,/VOLUME_LOW/);
  for(const id of ['data','channel','slope','break','center'])assert.equal(state(waiting,id),'passed',side+' '+id);
  assert.equal(state(waiting,'volume'),'waiting');
  for(const id of ['liquidity','signal','range','rangeBreak','plan','execution'])assert.equal(state(waiting,id),'unknown',side+' '+id);
  // No historical latch: losing the price condition removes later checkmarks.
  i.price=side==='SHORT'?106:104;
  const lost=view(side,evaluate(side,i).reason);
  assert.equal(state(lost,'break'),'waiting');assert.equal(state(lost,'channel'),'passed');assert.equal(state(lost,'volume'),'unknown');assert.ok(lost.count<waiting.count);
 }
});
test('actual liquidity, consumed-pattern and consolidation rejections retain only demonstrated passes',()=>{
 for(const side of ['LONG','SHORT']){
  const i=input(side);for(const b of i.bars)b.volume=1;i.liveBar.volume=2;
  const low=evaluate(side,i);assert.match(low.reason,/LIQUIDITY_LOW/);
  const l=view(side,low.reason);assert.equal(state(l,'volume'),'passed');assert.equal(state(l,'liquidity'),'waiting');assert.equal(state(l,'range'),'unknown');
  const used=input(side),setup=evaluate(side,used).setup;used.used=[setup.patternId];used.usedPatternIds=used.used;
  const u=view(side,evaluate(side,used).reason);assert.equal(state(u,'signal'),'waiting');assert.equal(state(u,'range'),'unknown');
  const range=input(side);
  for(let k=202;k<205;k++){const up=100+k*.02+Math.cos(k*Math.PI/5),p=side==='SHORT'?210-up:up;Object.assign(range.bars[k],{open:p,close:p,high:p+.1,low:p-.1});}
  const rejected=evaluate(side,range);assert.equal(rejected.reason,'CHANNEL_CONSOLIDATION_SIDE_BLOCK');
  const r=view(side,rejected.reason);assert.equal(state(r,'signal'),'passed');assert.equal(state(r,'range'),'waiting');assert.equal(state(r,'rangeBreak'),'unknown');
  const waiting=view(side,'WAIT_CHANNEL_CONSOLIDATION_BREAK');assert.equal(state(waiting,'range'),'passed');assert.equal(state(waiting,'rangeBreak'),'waiting');
 }
});
test('unknown, wrong-side, stale, future, unverified and expired signals cannot show checkmarks',()=>{
 for(const side of ['LONG','SHORT']){
  const reason=evaluate(side,input(side)).reason;
  for(const extra of [{transport:false},{supported:false},{at:null},{at:NaN},{at:now+1},{now:now+(side==='SHORT'?180000:90000)},{at:end+D-1,now:end+D},{reason:'READY'},{reason:'OUTSIDE_REGULAR_SESSION'},{reason:side==='SHORT'?'CHANNEL_VOLUME_LOW':'SHORT_VOLUME_LOW'},{side:'OTHER'}]){
   const v=view(side,reason,extra);assert.equal(v.count,0,JSON.stringify(extra));assert.equal(state(v,'execution'),'unknown');
  }
  const blocked=view(side,reason,{blocker:'NO_FREE_SLOT'});assert.equal(blocked.count,blocked.total);assert.equal(state(blocked,'execution'),'blocked');
  assert.equal(state(view(side,reason,{blocker:'NO_FREE_SLOT',transport:false}),'execution'),'unknown');
 }
 for(const expiresAt of [undefined,null,now-1,now])assert.equal(view('SHORT','SHORT_CHANNEL_READY',{expiresAt}).count,0);
});
test('signal and data failures do not skip ahead to authorize later conditions',()=>{
 for(const side of ['LONG','SHORT']){
  const i=input(side);i.entryAfter=end;
  const v=view(side,evaluate(side,i).reason);assert.equal(state(v,'signal'),'waiting');assert.equal(state(v,'channel'),'unknown');
  i.entryAfter=0;i.priceAsOf=now-20000;
  const stale=view(side,evaluate(side,i).reason);assert.equal(state(stale,'data'),'waiting');assert.equal(stale.count,0);
  i.priceAsOf=now;i.bars=i.bars.slice(-49);
  const missing=view(side,evaluate(side,i).reason);assert.equal(state(missing,'data'),'waiting');assert.equal(state(missing,'channel'),'unknown');
 }
});
