import test from 'node:test';
import assert from 'node:assert/strict';
import '../channel-entry-checklist.js';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {channelEntry,channelEntryConfig} from '../lib/channel-primary-entry.mjs';
import {shortSignal,shortConfig} from '../lib/futures-short-policy.mjs';
import {renderColmexChannelConditions} from '../lib/colmex-channel-conditions.mjs';
const STEP=300000,end=Date.parse('2026-11-06T20:00Z'),at=end+STEP-1000;
const state=(v,id)=>v.rows.find(r=>r.id===id).state;
function scan(side){
 const input=pocFixture({side,end});input.now=at;input.priceAsOf=at;input.liveBar.receivedAt=at;
 const config=side==='LONG'?channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true',BINANCE_CHANNEL_PRIMARY_AFTER:new Date(end-STEP).toISOString()}):shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:new Date(end-STEP).toISOString()});
 const result=(side==='LONG'?channelEntry:shortSignal)(input,config);assert.equal(result.ready,true,result.reason);
 return {side,symbol:'ABCUSDT',marketSymbol:'ABCUSDT',schemaVersion:'CHANNEL_POC_CONDITIONS_V1',reason:result.reason,conditions:result.conditions,at,now:at,expiresAt:end+STEP,transport:true,supported:true};
}
test('both POC sides retain the actual previous scan through missing-report quote waits and empty-report candle rollover',()=>{
 for(const side of ['LONG','SHORT']){
  const tracker=globalThis.LEVI_ENTRY_CHECKLIST.createTracker(),seed=scan(side);tracker.update(seed);
  const now=end+STEP+1000;
  const pending={...seed,at:now,now,expiresAt:end+2*STEP,reason:side==='SHORT'?'WAIT_FRESH_FUTURES_PRICE':'WAIT_FRESH_PRICE',conditions:null,blocker:'NO_FREE_SLOT'};
  const view=tracker.update(pending);
  assert.equal(view.status,'refreshing');assert.equal(view.previousCount,4);assert.equal(view.current,false);assert.equal(view.count,0);
  assert.equal(state(view,'channel'),'previous_passed');assert.equal(state(view,'execution'),'blocked');
  const conditions={...seed.conditions,at:now+1,expiresAt:end+2*STEP,model:null,rows:seed.conditions.rows.map(r=>({...r,state:'unknown'}))};
  const next=tracker.update({...pending,reason:'WAIT_CHANNEL_LIVE_BAR',at:now+1,now:now+1,conditions});
  assert.equal(next.previousAt,at);assert.equal(next.previousCount,4);
  const recovered={...seed,at:now+2,now:now+2,expiresAt:end+2*STEP,conditions:{...seed.conditions,at:now+2,expiresAt:end+2*STEP}};
  assert.equal(tracker.update(recovered).count,4);
  recovered.conditions.rows=recovered.conditions.rows.map(r=>({...r,state:r.id==='range'?'waiting':r.state}));
  assert.equal(state(tracker.update(recovered),'range'),'waiting');
 }
});
test('first render after rollover can show valid recent evidence as history; a slow envelope cannot revive its expiry',()=>{
 for(const side of ['LONG','SHORT']){
  const seed=scan(side),now=end+STEP+1000;
  const view=globalThis.LEVI_ENTRY_CHECKLIST.createTracker().update({...seed,now});
  assert.equal(view.status,'refreshing');assert.equal(view.previousAt,at);assert.equal(view.current,false);assert.equal(view.count,0);
  const delayed={...seed,at:end+STEP+1,now:end+STEP+2};
  const d=globalThis.LEVI_ENTRY_CHECKLIST.createTracker().update(delayed);
  assert.equal(d.current,false);assert.equal(d.count,0);assert.equal(d.previousAt,at);assert.equal(state(d,'poc'),'previous_passed');
 }
});
test('rollover history is not extended, reused after invalidation, or shared across invalid data or a different market',()=>{
 const seed=scan('LONG');
 for(const patch of [{conditions:{...seed.conditions,side:'SHORT'}},{conditions:{...seed.conditions,rows:[]}},{transport:false},{supported:false},{marketSymbol:'XYZUSDT'},{reason:'INVALID_CHANNEL_HISTORY',conditions:null}]){
  const t=globalThis.LEVI_ENTRY_CHECKLIST.createTracker();t.update(seed);
  const v=t.update({...seed,...patch,at:end+STEP,now:end+STEP});
  assert.equal(v.rows.some(r=>r.state.startsWith('previous_')),false);
 }
 const t=globalThis.LEVI_ENTRY_CHECKLIST.createTracker();t.update(seed);
 const v=t.update({...seed,reason:'WAIT_FRESH_PRICE',conditions:null,at:at+90000,now:at+90000});
 assert.equal(v.rows.some(r=>r.state.startsWith('previous_')),false);
});
function host(){const doc={createElement:tag=>({tag,dataset:{},children:[],textContent:'',ownerDocument:doc,append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];}})};return doc.createElement('section');}
const nodes=n=>[n,...n.children.flatMap(nodes)];
const text=n=>nodes(n).map(n=>n.textContent).join(' ');
test('Colmex keeps labelled LONG and SHORT results during a new candle, and clears them for CSV, another stock or invalid data',()=>{
 const h=host(),s={channelPrimary:{version:'CHANNEL_POC_RETEST_V1',requested:true,enabled:true},checks:{AAPL:{at,reason:'CHANNEL_POC_READY',entryDecisions:{primary:'channel_long_short',channel:{conditionReports:Object.fromEntries(['LONG','SHORT'].map(side=>[side,scan(side).conditions]))}}}}};
 renderColmexChannelConditions(h,{status:s,symbol:'AAPL',now:at});
 assert.equal(nodes(h).filter(n=>n.dataset.state==='passed').length,8);
 renderColmexChannelConditions(h,{status:s,symbol:'AAPL',now:end+STEP+1000});
 assert.equal(nodes(h).filter(n=>n.dataset.state==='previous_passed').length,8);assert.match(text(h),/מתעדכן/);assert.match(text(h),/אינם אישור כניסה/);
 s.checks.AAPL={at:end+STEP+2000,reason:'WAIT_FRESH_PRICE',entryDecisions:{primary:'channel_long_short',channel:{}}};
 renderColmexChannelConditions(h,{status:s,symbol:'AAPL',now:end+STEP+2000});
 assert.equal(nodes(h).filter(n=>n.dataset.state==='previous_passed').length,8);
 renderColmexChannelConditions(h,{status:s,symbol:'AAPL',manual:true,now:end+STEP+3000});
 assert.equal(nodes(h).some(n=>n.dataset.state?.startsWith('previous_')),false);
 renderColmexChannelConditions(h,{status:s,symbol:'MSFT',now:end+STEP+3000});
 assert.equal(nodes(h).some(n=>n.dataset.state?.startsWith('previous_')),false);
});
