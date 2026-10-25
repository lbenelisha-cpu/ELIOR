import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reconcile,runCycle} from '../lib/colmex-auto-runner.mjs';
import {planBuy,LIVE_ACK,contiguousHistory} from '../lib/colmex-auto-policy.mjs';
import {regularSession,marketHours} from '../lib/colmex-market-hours.mjs';
import {lease} from '../lib/colmex-auto-store.mjs';
import {AutoBroker} from '../lib/colmex-auto-broker.mjs';
const now=Date.parse('2026-10-20T15:00:00Z'),sizes=[{leftRangeLimit:0,tickSize:.01}];
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
const input={instrument:{tradableInstrumentId:1,type:'EQUITY'},details:{quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:sizes,lotStep:1,lotSize:1,minLot:1,maxLot:1000},quote:{ap:100,bp:99.99},cash:1000,positions:[],orders:[],now,receivedAt:now};
const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1000},positions:[],orders:[],history:[]});
const owned=(id,symbol,instrumentId)=>({id,symbol,instrumentId,qty:2,entryPrice:100,entryAt:new Date(now-60000).toISOString(),peakPrice:100,strategyId:'WYCKOFF_5M_V1',tickSize:sizes});
const brokerPos=(id,instrumentId,stopLoss=99)=>({id,tradableInstrumentId:instrumentId,qty:2,avgPrice:100,side:'buy',stopLoss,takeProfit:150});
const pending=()=>({id:'audit-intent',tag:'levi-auto:audit-intent',kind:'BUY',at:now,symbol:'NVDA',patternId:'audit-pattern',tickSize:sizes,order:{tradableInstrumentId:3,qty:2}});
test('holiday and early-close calendar gates both automatic and manual buy plans',()=>{
 for(const date of ['2026-11-26T16:00:00Z','2026-11-27T19:00:00Z','2026-12-24T18:00:00Z','2029-01-02T16:00:00Z']){
  const t=Date.parse(date);assert.equal(marketHours(t).open,false);assert.equal(regularSession(t),false);assert.equal(planBuy({...input,now:t,receivedAt:t}).reason,'OUTSIDE_REGULAR_SESSION');
 }
});
test('valid half-day closure preserves history, but a missing full trading day does not',()=>{
 const bars=['2026-11-27T17:55:00Z','2026-11-27T18:00:00Z','2026-11-30T14:35:00Z','2026-11-30T14:40:00Z'].map(x=>({closeTime:Date.parse(x)}));
 assert.equal(contiguousHistory(bars).discarded,0);bars[2].closeTime=Date.parse('2026-12-01T14:35:00Z');assert.ok(contiguousHistory(bars).discarded>0);
});
test('pending unknown buy cannot prevent an independent emergency close, nor duplicate it on restart',async()=>{
 const s=initialState(now-1000);s.pending=pending();s.positions=[owned('p','AAPL',1)];const written=[];
 const b={snapshot:async()=>({...snapshot(),positions:[brokerPos('p',1,null)]}),write:async(a,i)=>{written.push(structuredClone(i));throw Error('timeout');}};
 await runCycle({state:s,env,save:async()=>{},now:()=>now,broker:b});
 assert.equal(written.length,1);assert.equal(written[0].kind,'CLOSE');assert.equal(s.pending.symbol,'NVDA');assert.equal(s.riskPending[0].symbol,'AAPL');
 const restart=JSON.parse(JSON.stringify(s));await runCycle({state:restart,env,save:async()=>{},now:()=>now+60000,broker:b});assert.equal(written.length,1);
 b.snapshot=async()=>snapshot();await runCycle({state:restart,env,save:async()=>{},now:()=>now+120000,broker:b});assert.equal(restart.riskPending.length,0);assert.ok(restart.pending);assert.equal(restart.closedTrades.length,1);assert.equal(restart.closedTrades[0].netPnl,null);
});
test('a pending intent on the same instrument never receives a second write',async()=>{
 const s=initialState(now-1000);s.pending={...pending(),symbol:'AAPL',order:{qty:2,tradableInstrumentId:1}};s.positions=[owned('p','AAPL',1)];let writes=0;
 await runCycle({state:s,env,save:async()=>{},now:()=>now,broker:{snapshot:async()=>({...snapshot(),positions:[brokerPos('p',1,null)]}),write:async()=>{writes++;}}});assert.equal(writes,0);
});
test('all emergency exits outrank normal trailing updates',async()=>{
 for(const missing of [true,false]){
  const s=initialState(now-1000);s.positions=[owned('p1','AAPL',1),owned('p2','MSFT',2)];s.positions[0].peakPrice=105;const written=[];
  await runCycle({state:s,env,save:async()=>{},now:()=>now,broker:{snapshot:async()=>({...snapshot(),positions:[brokerPos('p1',1),brokerPos('p2',2,missing?null:99)]}),quote:async id=>({bp:id===1?105:98}),write:async(a,i)=>{written.push(i);return {};}}});
  assert.equal(written[0].kind,'CLOSE');assert.equal(written[0].symbol,'MSFT');
 }
});
test('a missing position is not assumed closed without matched sell fills for an unconfirmed buy',()=>{
 const s=initialState(now-1000);s.pending=pending();s.pending.orderId='buy';
 const snap={...snapshot(),history:[{id:'buy',status:'filled',filledQty:2,avgPrice:100,positionId:'closed'},{id:'sell',status:'filled',side:'sell',filledQty:1,avgPrice:99,positionId:'closed'}]};
 reconcile(s,snap,now+60000);assert.equal(s.halt,'FILL_POSITION_REQUIRES_REVIEW');assert.ok(s.pending);
 snap.history[1].filledQty=2;reconcile(s,snap,now+120000);assert.equal(s.pending,null);assert.equal(s.halt,null);assert.equal(s.closedTrades.length,1);assert.equal(s.closedTrades[0].grossPnl,-2);assert.equal(s.closedTrades[0].netPnl,null);assert.equal(s.after.NVDA,now+120000);
 reconcile(s,snap,now+180000);assert.equal(s.closedTrades.length,1);
});
test('only order-related halts with conclusive broker resolution recover',()=>{
 for(const halt of ['UNRESOLVED_ORDER_REQUIRES_REVIEW','POSITION_OWNERSHIP_REQUIRES_REVIEW']){
  const s=initialState(now-1000);s.pending=pending();s.halt=halt;
  reconcile(s,{...snapshot(),history:[{id:'o',userComment:s.pending.tag,status:'rejected',filledQty:0}]},now+660000);
  assert.equal(s.pending,null);assert.equal(s.halt,halt.startsWith('UNRESOLVED')?null:halt);
 }
});
function memoryStore(value){let data=value,etag='1';return {read:()=>structuredClone(data),getWithMetadata:async()=>data?{data:structuredClone(data),etag}:null,async setJSON(k,v,opt){if(opt.onlyIfMatch&&opt.onlyIfMatch!==etag||opt.onlyIfNew&&data)return {modified:false};data=structuredClone(v);etag+='x';return {modified:true,etag};}};}
test('corrupt existing states fail closed instead of resetting, valid v1 states migrate without losing fields',async()=>{
 for(const state of [null,{}, {...initialState(now),positions:'corrupt'}])await assert.rejects(lease(memoryStore({state,lease:{until:0}}),'123',()=>now),/STATE_SCHEMA/);
 const state=initialState(now);state.used=['old-pattern'];const l=await lease(memoryStore({state,lease:{until:0}}),'123',()=>now);assert.deepEqual(l.state.used,['old-pattern']);
});
test('release cannot persist unsaved in-memory intent after a failed save',async()=>{
 let clock=now;const store=memoryStore(null),l=await lease(store,'123',()=>clock);l.state.pending=pending();clock+=56000;
 await assert.rejects(l.save(l.state),/LEASE_EXPIRED/);await l.release();assert.equal(store.read().state.pending,null);
});
test('unavailable order history leaves verified position protections manageable and blocks entries',async()=>{
 const s=initialState(now-1000);s.positions=[owned('p','AAPL',1)];let write;
 await runCycle({state:s,env,save:async()=>{},now:()=>now,broker:{snapshot:async()=>({...snapshot(),historyAvailable:false,positions:[brokerPos('p',1,null)]}),write:async(a,i)=>{write=i;return {};}}});assert.equal(write.kind,'CLOSE');
 const empty=initialState(now);const r=await runCycle({state:empty,env,save:async()=>{},now:()=>now,broker:{snapshot:async()=>({...snapshot(),historyAvailable:false})}});assert.equal(r.reason,'HISTORY_UNAVAILABLE');
});

test('an ownership halt is never downgraded by an overdue pending order',()=>{
 const s=initialState(now);s.pending=pending();s.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';
 reconcile(s,snapshot(),now+660000);assert.equal(s.halt,'POSITION_OWNERSHIP_REQUIRES_REVIEW');
 reconcile(s,{...snapshot(),history:[{id:'o',userComment:s.pending.tag,status:'rejected',filledQty:0}]},now+720000);
 assert.equal(s.pending,null);assert.equal(s.halt,'POSITION_OWNERSHIP_REQUIRES_REVIEW');
});
test('one failed quote cannot prevent another verified holding from exiting',async()=>{
 const s=initialState(now);s.positions=[owned('p1','AAPL',1),owned('p2','MSFT',2)];let written;
 await runCycle({state:s,env,save:async()=>{},now:()=>now,broker:{snapshot:async()=>({...snapshot(),positions:[brokerPos('p1',1),brokerPos('p2',2)]}),quote:async id=>{if(id===1)throw Error('NETWORK');return {bp:98};},write:async(a,i)=>{written=i;return {};}}});
 assert.equal(written.symbol,'MSFT');assert.equal(written.kind,'CLOSE');assert.equal(s.positions[0].riskStatus,'WAIT_BROKER_QUOTE');
});
test('risk intents reserve the account even after the main intent is resolved',async()=>{
 const s=initialState(now);s.pending=null;s.riskPending=[{kind:'CLOSE',id:'risk',at:now,positionId:'p',qty:2,symbol:'AAPL'}];s.positions=[owned('p','AAPL',1)];
 const r=await runCycle({state:s,env,save:async()=>{},now:()=>now,broker:{snapshot:async()=>({...snapshot(),positions:[brokerPos('p',1)]})}});
 assert.equal(r.reason,'PENDING_BROKER_CONFIRMATION');assert.equal(s.riskPending.length,1);
});
test('broker adapter isolates missing history while critical snapshots still fail closed',async()=>{
 const cols=names=>({columns:names.map(id=>({id}))}),config={accountDetailsConfig:cols(['availableCash']),positionsConfig:cols(['id','tradableInstrumentId','side','qty']),ordersConfig:cols(['id','tradableInstrumentId','side']),ordersHistoryConfig:cols(['id','status'])};
 let fail='/ordersHistory',calls=[],malformed=false;
 const fetchImpl=async(url)=>{const path=new URL(url).pathname.replace('/traderevolution/v1','');calls.push(path);if(path.endsWith(fail))throw Error('timeout');const d=path==='/authorize'?{access_token:'fixture-token',expiration:now/1000+3600}:path==='/config'?config:path==='/accounts'?{accounts:[{id:'123',type:'live',currency:'USD',status:'ACTIVE'}]}:path.endsWith('/state')?{accountDetailsData:[1000]}:path.endsWith('/positions')?{positions:[['p',1,'buy',2]]}:path.endsWith('/orders')?{orders:[]}:{ordersHistory:malformed?[[]]:[]};return new Response(JSON.stringify({s:'ok',d}),{status:200});};
 const b=new AutoBroker({env,deadline:now+27000,now:()=>now,fetchImpl});
 const s=await b.snapshot('123');assert.equal(s.historyAvailable,false);assert.equal(s.positions.length,1);
 calls=[];const lightweight=await b.snapshot('123',{includeHistory:false});assert.equal(lightweight.historyAvailable,true);assert.equal(calls.some(p=>p.endsWith('/ordersHistory')),false);
 fail='/never';malformed=true;assert.equal((await b.snapshot('123')).historyAvailable,false);
 fail='/positions';await assert.rejects(b.snapshot('123'),/NETWORK/);
});


test('failed storage writes are tagged so the worker cannot retry an unsaved order as error state',async()=>{
 const store=memoryStore(null),l=await lease(store,'123',()=>now),write=store.setJSON;let calls=0;
 store.setJSON=async(...args)=>{if(++calls===1)throw Error('storage unavailable');return write(...args);};
 l.state.pending=pending();await assert.rejects(l.save(l.state),e=>e.statePersistenceFailure===true&&e.message==='STATE_SAVE_FAILED');
 await l.release();assert.equal(store.read().state.pending,null);
});
