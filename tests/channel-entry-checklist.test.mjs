import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import '../channel-entry-checklist.js';
import {channelEntry,channelEntryConfig} from '../lib/channel-primary-entry.mjs';
import {shortSignal,shortConfig} from '../lib/futures-short-policy.mjs';

const {project}=globalThis.LEVI_ENTRY_CHECKLIST;
const D=300000,end=Date.parse('2026-11-06T10:00:00Z'),now=end+1000;
const configs={LONG:channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true',BINANCE_CHANNEL_PRIMARY_AFTER:new Date(end-D).toISOString()}),SHORT:shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:new Date(end-D).toISOString()})};
function input(side){return pocFixture({side,end});}
const evaluate=(side,i)=>side==='SHORT'?shortSignal(i,configs[side]):channelEntry(i,configs[side]);
const view=(side,reason,extra={})=>project({side,reason,at:now,now,expiresAt:end+D,transport:true,supported:true,...extra});
const state=(v,id)=>v.rows.find(r=>r.id===id).state;
const report=(side,i=input(side),extra={})=>{const r=evaluate(side,i);return view(side,r.reason,{conditions:r.conditions,...extra});};
test('both actual entry reports contain only four technical checks and never infer account approval',()=>{
 for(const side of ['LONG','SHORT']){const i=input(side),r=evaluate(side,i),v=report(side,i);assert.equal(r.ready,true,r.reason);assert.deepEqual(v.rows.map(r=>r.id),['channel','break','poc','range','execution']);assert.equal(v.count,4);assert.equal(v.total,4);assert.equal(state(v,'execution'),'unknown');
 i.price=side==='LONG'?r.model.profile.poc+1:r.model.profile.poc-1;
 const waiting=report(side,i);assert.equal(waiting.count,3);assert.equal(state(waiting,'poc'),'waiting');assert.equal(state(waiting,'range'),'passed');}
});
test('low volumes no longer block, while duplicate return receipts are an execution restriction',()=>{
 for(const side of ['LONG','SHORT']){const i=input(side);i.liveBar.volume=0;const good=evaluate(side,i);assert.equal(good.ready,true);i.used=[good.patternId];i.usedPatternIds=i.used;const used=evaluate(side,i);assert.equal(used.ready,false);assert.equal(used.executionBlock,'DUPLICATE_RETURN_RECEIPT');const v=report(side,i,{blocker:used.executionBlock});assert.equal(v.count,4);assert.equal(state(v,'execution'),'blocked');}
});
test('new reports require current transport, correct side and complete typed rows',()=>{
 for(const side of ['LONG','SHORT']){const good=evaluate(side,input(side));
 for(const extra of [{transport:false},{supported:false},{at:null},{at:NaN},{at:now+1},{now:now+(side==='SHORT'?180000:90000)},{at:end+D-1,now:end+D},{side:'OTHER'}])assert.equal(view(side,good.reason,{conditions:good.conditions,...extra}).count,0);
 for(const mutate of [c=>c.version='OTHER',c=>c.side=side==='SHORT'?'LONG':'SHORT',c=>c.at=now+1,c=>c.at-=300000,c=>c.expiresAt++,c=>c.rows.pop(),c=>c.rows.push(c.rows[0]),c=>c.rows[0].state='approved',c=>c.rows[0]=c.rows[1]]){const c=structuredClone(good.conditions);mutate(c);assert.equal(view(side,good.reason,{conditions:c}).count,0);}
 const blocked=report(side,input(side),{blocker:'NO_FREE_SLOT'});assert.equal(blocked.count,4);assert.equal(state(blocked,'execution'),'blocked');}
});
test('unavailable data never creates a pass and missing geometry leaves dependent checks unknown',()=>{
 for(const side of ['LONG','SHORT']){const stale=input(side);stale.priceAsOf=now-20000;const v=report(side,stale);assert.equal(v.count,0);assert.equal(v.dataPending,true);
 const empty=input(side);empty.bars=empty.bars.map((b,k)=>({...b,open:100+k,high:100+k+.01,low:100+k-.01,close:100+k}));const w=report(side,empty);assert.equal(state(w,'channel'),'waiting');for(const id of ['break','poc','range'])assert.equal(state(w,id),'unknown');}
});
// Backward-compatible rendering for a VPS that has not yet installed the new policy.
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


test('report policy transitions cannot reuse previous condition rows',()=>{
 const tracker=globalThis.LEVI_ENTRY_CHECKLIST.createTracker(),base={side:'LONG',symbol:'ABCUSDT',marketSymbol:'ABCUSDT',at:now,now,transport:true,supported:true};
 tracker.update({...base,reason:'CHANNEL_VOLUME_LOW'});
 const r=evaluate('LONG',input('LONG'));const v=tracker.update({...base,reason:r.reason,conditions:r.conditions});assert.equal(v.total,4);assert.equal(v.count,4);
 const stale=tracker.update({...base,reason:r.reason,conditions:r.conditions,now:end+D});assert.equal(stale.total,4);assert.equal(stale.current,false);assert.equal(stale.previousCount,undefined);
});
test('LONG report and exact frozen model reach the attention board without inventing account approval',async()=>{
 const {evaluateDailyTrade}=await import('../lib/wyckoff-evaluation.mjs');const {recordEntryBlocker}=await import('../lib/entry-method-comparison.mjs');const {attentionSnapshot}=await import('../lib/market-attention.mjs');
 const i=input('LONG'),ev=evaluateDailyTrade({...i,symbol:'ABCUSDT',priceAsOf:new Date(now).toISOString(),timeframe:'5m',entryMode:'confirmed_quality',channelPrimary:configs.LONG});
 const conditions=ev.entryDecisions.channel.conditions;assert.equal(conditions.rows.length,4);assert.ok(conditions.model.profile.poc>0);
 const ledger={};recordEntryBlocker(ledger,{symbol:'ABCUSDT',at:now+10,reason:ev.buyReason,conditions});
 const row=attentionSnapshot({state:ledger,news:{},symbols:['ABCUSDT'],now:now+10,diagnostics:ledger.entryComparison.diagnostics}).rows[0];assert.deepEqual(row.longDecision.conditions,conditions);
 const v=view('LONG',row.longDecision.reason,{conditions:row.longDecision.conditions,at:row.longDecision.at,now:now+10});assert.equal(v.count,4);assert.equal(state(v,'execution'),'unknown');
 recordEntryBlocker(ledger,{symbol:'ABCUSDT',at:now+20,reason:'EVALUATION_DATA_UNAVAILABLE'});assert.equal(ledger.entryComparison.diagnostics.ABCUSDT.conditions,null);
});
