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
  const all=view(side,good.reason);assert.equal(all.count,all.total);assert.equal(all.total,10);assert.equal(all.rows.some(r=>r.id==='data'),false);assert.equal(state(all,'execution'),'unknown');
  i.liveBar.volume=1499;
  const low=evaluate(side,i),waiting=view(side,low.reason);
  assert.match(low.reason,/VOLUME_LOW/);
  for(const id of ['channel','slope','break','center'])assert.equal(state(waiting,id),'passed',side+' '+id);
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
  const stale=view(side,evaluate(side,i).reason);assert.equal(stale.dataPending,true);assert.equal(stale.count,0);assert.equal(stale.rows.some(r=>r.id==='data'),false);
  i.priceAsOf=now;i.bars=i.bars.slice(-49);
  const missing=view(side,evaluate(side,i).reason);assert.equal(missing.dataPending,true);assert.equal(state(missing,'channel'),'unknown');
 }
});

test('candle rollover and transient quote/bar waits retain a labelled previous scan without extending its lifetime',()=>{
 for(const side of ['LONG','SHORT']){
  const tracker=globalThis.LEVI_ENTRY_CHECKLIST.createTracker(),at=end+D-1000;
  const seed={side,symbol:'ABCUSDT',marketSymbol:'ABCUSDT',reason:side==='SHORT'?'SHORT_VOLUME_LOW':'CHANNEL_VOLUME_LOW',at,now:at,expiresAt:end+D,transport:true,supported:true};
  const first=tracker.update(seed);assert.equal(state(first,'channel'),'passed');
  const expired=tracker.update({...seed,now:end+D});
  assert.equal(expired.status,'refreshing');assert.equal(expired.current,false);assert.equal(expired.count,0);assert.equal(expired.previousCount,first.count);
  assert.equal(state(expired,'channel'),'previous_passed');assert.equal(state(expired,'volume'),'previous_waiting');
  const pending={...seed,reason:side==='SHORT'?'WAIT_FUTURES_LIVE_BAR':'WAIT_CHANNEL_LIVE_BAR',at:end+D+1000,now:end+D+1000,expiresAt:end+2*D,blocker:'NO_FREE_SLOT'};
  const refresh=tracker.update(pending);assert.equal(refresh.previousAt,at);assert.equal(state(refresh,'execution'),'blocked');assert.equal(refresh.previousCount,first.count);
  const lagging=tracker.update({...pending,reason:side==='SHORT'?'GAPPED_FUTURES_HISTORY':'GAPPED_CHANNEL_HISTORY',at:end+D+2000,now:end+D+2000});
  assert.equal(lagging.status,'refreshing');assert.equal(lagging.previousAt,at);assert.equal(state(lagging,'channel'),'previous_passed');
  if(side==='SHORT')assert.equal(tracker.update({...seed,reason:'STALE_SHORT_OBSERVATION',expiresAt:null,now:end+D+2000}).status,'refreshing');
  const elapsed=at+(side==='SHORT'?180000:90000);
  const old=tracker.update({...pending,at:elapsed,now:elapsed});assert.notEqual(old.status,'refreshing');assert.equal(old.rows.some(r=>r.state.startsWith('previous_')),false);
 }
});
test('new channel rejection replaces prior confirmation; data corruption, disconnect and policy changes clear history',()=>{
 for(const side of ['LONG','SHORT']){
  const tracker=globalThis.LEVI_ENTRY_CHECKLIST.createTracker(),at=end+D-1000;
  const seed={side,symbol:'ABCUSDT',marketSymbol:'ABCUSDT',reason:side==='SHORT'?'SHORT_VOLUME_LOW':'CHANNEL_VOLUME_LOW',at,now:at,expiresAt:end+D,transport:true,supported:true};
  tracker.update(seed);
  const reject={...seed,reason:side==='SHORT'?'WAIT_TWO_TOUCHES_PER_SIDE':'WAIT_CHANNEL_TWO_TOUCHES',at:end+D+1000,now:end+D+1000,expiresAt:end+2*D};
  const fresh=tracker.update(reject);assert.equal(state(fresh,'channel'),'waiting');assert.equal(fresh.count,0);assert.notEqual(fresh.status,'refreshing');
  // An out-of-order reply cannot resurrect the previous successful channel.
  assert.equal(tracker.update({...seed,now:reject.now}).count,0);
  for(const patch of [{transport:false},{supported:false},{marketSymbol:'XYZUSDT'},{reason:'UNKNOWN_REASON'},{reason:side==='SHORT'?'INVALID_FUTURES_HISTORY':'INVALID_CHANNEL_HISTORY'}]){
   const t=globalThis.LEVI_ENTRY_CHECKLIST.createTracker();t.update(seed);const stopped=t.update({...seed,...patch,at:end+D+1000,now:end+D+1000,expiresAt:end+2*D});
   assert.equal(stopped.rows.some(r=>r.state.startsWith('previous_')),false);
   const next=t.update({...seed,now:end+D+2000});assert.notEqual(next.status,'refreshing');
  }
 }
});
test('previous checks never cross asset, market or side and are cleared on removal and auth loss',()=>{
 const tracker=globalThis.LEVI_ENTRY_CHECKLIST.createTracker(),at=end+D-1000;
 const seed={side:'LONG',symbol:'ABCUSDT',marketSymbol:'ABCUSDT',reason:'CHANNEL_VOLUME_LOW',at,now:at,transport:true,supported:true};
 tracker.update(seed);
 for(const patch of [{symbol:'OTHERUSDT',marketSymbol:'OTHERUSDT'},{side:'SHORT',expiresAt:end+D,reason:'SHORT_VOLUME_LOW'}])assert.notEqual(tracker.update({...seed,...patch,now:end+D}).status,'refreshing');
 tracker.retain([]);assert.notEqual(tracker.update({...seed,now:end+D}).status,'refreshing');
 tracker.update(seed);tracker.clear();assert.notEqual(tracker.update({...seed,now:end+D}).status,'refreshing');
});

test('independent server checks evaluate volume, liquidity and consolidation after an earlier rejection on both sides',()=>{
 for(const side of ['LONG','SHORT']){
  const i=input(side);i.price=side==='SHORT'?106:104;
  const result=evaluate(side,i);assert.equal(result.ready,false);assert.match(result.reason,/BREAK/);
  const v=view(side,result.reason,{conditions:result.conditions});assert.equal(v.parallel,true);
  assert.equal(state(v,'break'),'waiting');assert.equal(state(v,'volume'),'passed');assert.equal(state(v,'liquidity'),'passed');
  assert.equal(state(v,'range'),'passed');assert.equal(state(v,'signal'),'passed');assert.equal(state(v,'rangeBreak'),'waiting');
  assert.equal(state(v,'execution'),'unknown');
  i.liveBar.volume=1499;
  const two=evaluate(side,i),vv=view(side,two.reason,{conditions:two.conditions});
  assert.equal(two.reason,result.reason);assert.equal(state(vv,'break'),'waiting');assert.equal(state(vv,'volume'),'waiting');assert.equal(state(vv,'liquidity'),'passed');
 }
});
test('missing channel geometry leaves only dependent checks unknown; independent measurements still run',()=>{
 for(const side of ['LONG','SHORT']){
  const i=input(side);i.bars=i.bars.map((b,k)=>{const p=100+(side==='LONG'?k:-k)*.01;return {...b,open:p,high:p+.001,low:p-.001,close:p};});
  const result=evaluate(side,i);assert.equal(result.ready,false);assert.match(result.reason,/PIVOTS|TOUCHES/);
  const v=view(side,result.reason,{conditions:result.conditions});
  assert.equal(state(v,'channel'),'waiting');assert.equal(state(v,'break'),'unknown');assert.equal(state(v,'range'),'unknown');
  for(const id of ['slope','volume','liquidity'])assert.equal(state(v,id),'passed',side+' '+id);
 }
});
test('a new-signal wait or wrong regression cannot suppress independent volume results',()=>{
 for(const side of ['LONG','SHORT']){
  const i=input(side);i.entryAfter=end;
  let r=evaluate(side,i),v=view(side,r.reason,{conditions:r.conditions});
  assert.equal(r.ready,false);assert.equal(state(v,'signal'),'waiting');assert.equal(state(v,'channel'),'passed');assert.equal(state(v,'volume'),'passed');
  const wrong=input(side==='LONG'?'SHORT':'LONG');r=evaluate(side,wrong);v=view(side,r.reason,{conditions:r.conditions});
  assert.match(r.reason,/DIRECTION_BLOCK/);assert.equal(state(v,'slope'),'waiting');assert.equal(state(v,'volume'),'passed');assert.equal(state(v,'liquidity'),'passed');
 }
});
test('only complete current reports count; invalid reports cannot fall back to inferred approval',()=>{
 for(const side of ['LONG','SHORT']){
  const good=evaluate(side,input(side));assert.equal(good.ready,true);assert.equal(good.conditions.rows.every(r=>r.state==='passed'),true);
  assert.equal(view(side,good.reason,{conditions:good.conditions}).count,10);
  for(const mutate of [c=>c.version='OTHER',c=>c.side=side==='LONG'?'SHORT':'LONG',c=>c.at=now+1,c=>c.at-=300000,c=>c.expiresAt++,c=>c.rows.pop(),c=>c.rows.push(c.rows[0]),c=>c.rows[0].state='approved',c=>c.rows[0]=c.rows[1]]){
   const c=structuredClone(good.conditions);mutate(c);const v=view(side,good.reason,{conditions:c});assert.equal(v.count,0);assert.equal(v.current,false);
  }
  const stale=view(side,good.reason,{conditions:good.conditions,now:end+D});assert.equal(stale.count,0);
  const noQuote=input(side);noQuote.priceAsOf=now-20000;const r=evaluate(side,noQuote);assert.equal(r.ready,false);assert.equal(r.conditions.rows.every(x=>x.state==='unknown'),true);
 }
});

test('LONG report is persisted with its scan and reaches attention without inventing account approval',async()=>{
 const {evaluateDailyTrade}=await import('../lib/wyckoff-evaluation.mjs');
 const {recordEntryBlocker}=await import('../lib/entry-method-comparison.mjs');
 const {attentionSnapshot}=await import('../lib/market-attention.mjs');
 const i=input('LONG');i.liveBar.volume=1000;
 const ev=evaluateDailyTrade({...i,symbol:'ABCUSDT',priceAsOf:new Date(now).toISOString(),timeframe:'5m',entryMode:'confirmed_quality',channelPrimary:configs.LONG});
 const conditions=ev.entryDecisions.channel.conditions;assert.equal(conditions.rows.find(r=>r.id==='liquidity').state,'passed');
 const state={};recordEntryBlocker(state,{symbol:'ABCUSDT',at:now+10,reason:ev.buyReason,conditions});
 const row=attentionSnapshot({state,news:{},symbols:['ABCUSDT'],now:now+10,diagnostics:state.entryComparison.diagnostics}).rows[0];
 assert.deepEqual(row.longDecision.conditions,conditions);
 const v=view('LONG',row.longDecision.reason,{conditions:row.longDecision.conditions,at:row.longDecision.at,now:now+10});assert.equal(v.count,9);
 recordEntryBlocker(state,{symbol:'ABCUSDT',at:now+20,reason:'EVALUATION_DATA_UNAVAILABLE'});assert.equal(state.entryComparison.diagnostics.ABCUSDT.conditions,null);
});
