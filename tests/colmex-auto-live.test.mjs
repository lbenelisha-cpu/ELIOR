import test from 'node:test';import assert from 'node:assert/strict';
import {AUTO_POLICY,LIVE_ACK,configuredLive,runtimeEnvironment,planBuy,brokerBars,contiguousHistory,entrySignal,ticks} from '../lib/colmex-auto-policy.mjs';
import {initialState,reconcile,runCycle} from '../lib/colmex-auto-runner.mjs';
import {AutoBroker} from '../lib/colmex-auto-broker.mjs';
import {lease} from '../lib/colmex-auto-store.mjs';
import {makeHandler,makeFetchHandler} from '../netlify/functions/colmex-auto-status.mjs';
const now=Date.parse('2026-10-20T15:00:00Z');
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
const sizes=[{leftRangeLimit:0,tickSize:.01}];
const input={instrument:{tradableInstrumentId:1,type:'EQUITY'},details:{quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:sizes,lotStep:1,lotSize:1,minLot:1,maxLot:1000},quote:{ap:30,bp:29.99},cash:1000,positions:[],orders:[],now,receivedAt:now};
test('live requires production, exact opt-in and pinned account',()=>{assert.equal(configuredLive(env),true);for(const change of [{CONTEXT:'deploy-preview'},{COLMEX_AUTO_LIVE_ENABLED:'false'},{COLMEX_AUTO_LIVE_ACK:''},{COLMEX_AUTO_ACCOUNT_ID:'../123'}])assert.equal(configuredLive({...env,...change}),false);assert.equal(configuredLive({}),false);});
test('800 USD cap, integer shares, cash buffer, bracket stop and IOC limit',()=>{const p=planBuy(input);assert.equal(p.reason,'READY');assert.equal(p.order.qty,26);assert.ok(p.notionalUsd<=800);assert.equal(p.order.type,'limit');assert.equal(p.order.validity,'IOC');assert.ok(p.order.stopLoss>0&&p.order.stopLoss<input.quote.bp);assert.equal(planBuy({...input,cash:90}).reason,'INSUFFICIENT_UNLEVERAGED_CASH');assert.equal(planBuy({...input,cash:null}).reason,'INSUFFICIENT_UNLEVERAGED_CASH');});
test('skip expensive whole shares; support fractions only from verified lot rules',()=>{const expensive={...input,quote:{ap:850,bp:849.99}};assert.equal(planBuy(expensive).reason,'MINIMUM_QUANTITY_ABOVE_BUDGET');const p=planBuy({...expensive,details:{...input.details,lotStep:.001,minLot:.001}});assert.equal(p.reason,'READY');assert.ok(p.notionalUsd<=800);assert.ok(p.order.qty<1);assert.equal(planBuy({...input,details:{...input.details,lotStep:null}}).reason,'UNKNOWN_QUANTITY_RULES');});
test('three slots includes manual positions and pending buys; same symbol and leverage blocked',()=>{assert.equal(planBuy({...input,positions:[{},{},{}]}).reason,'NO_FREE_SLOT');assert.equal(planBuy({...input,positions:[{},{}],orders:[{side:'buy'}]}).reason,'NO_FREE_SLOT');assert.equal(planBuy({...input,positions:[{tradableInstrumentId:1}]}).reason,'EXISTING_POSITION_OR_ORDER');assert.equal(planBuy({...input,instrument:{...input.instrument,type:'EQUITY_CFD'}}).reason,'UNSUPPORTED_INSTRUMENT');assert.equal(planBuy({...input,receivedAt:now-11000}).reason,'WAIT_BROKER_QUOTE');assert.equal(planBuy({...input,now:now+86400000*4}).reason,'OUTSIDE_REGULAR_SESSION');});
test('broker history timestamps are bar opens; incomplete bars are excluded and invalid OHLC rejected',()=>{const b={t:now-300000,o:30,h:31,l:29,c:30,v:10};const bars=brokerBars({barDetails:[b,{...b,t:now+12345}]},now+50000);assert.equal(bars.length,1);assert.equal(bars[0].openTime,now-300000);assert.throws(()=>brokerBars({barDetails:[{...b,l:32}]},now));assert.equal(ticks(100.001,sizes,true),100.01);assert.equal(ticks(100.009,sizes),100);});
function snapshot(){return {account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1000},positions:[],orders:[],history:[]};}
function pending(){return {id:'intent',tag:'levi-auto:intent',kind:'BUY',at:now,symbol:'AAPL',patternId:'new-setup',tickSize:sizes,order:{tradableInstrumentId:1,qty:3}};}
test('partial fill: own only actual filled qty; terminal zero fill releases reservation',()=>{const s=initialState(now);s.pending=pending();const snap=snapshot();snap.history=[{id:'o',userComment:s.pending.tag,status:'cancelled',filledQty:2,avgPrice:30,positionId:'p'}];snap.positions=[{id:'p',tradableInstrumentId:1,side:'buy',qty:2,stopLoss:27}];reconcile(s,snap,now+60000);assert.equal(s.pending,null);assert.equal(s.positions[0].qty,2);assert.equal(s.positions[0].entryPrice,30);const z=initialState(now);z.pending=pending();reconcile(z,{...snapshot(),history:[{...snap.history[0],filledQty:0}]},now);assert.equal(z.pending,null);assert.equal(z.positions.length,0);});
test('unknown write is never retried, ambiguous position/quantity halts',()=>{const s=initialState(now);s.pending=pending();reconcile(s,snapshot(),now+660000);assert.equal(s.halt,'UNRESOLVED_ORDER_REQUIRES_REVIEW');assert.ok(s.pending);const t=initialState(now);t.pending=pending();reconcile(t,{...snapshot(),history:[{userComment:t.pending.tag,id:'o',status:'filled',filledQty:3,avgPrice:30}],positions:[{id:'p',tradableInstrumentId:1,side:'buy',qty:5}]},now);assert.equal(t.halt,'POSITION_OWNERSHIP_REQUIRES_REVIEW');});
test('external closure records new-signal boundary; modified manual shares halt',()=>{const s=initialState(now);s.positions=[{id:'p',symbol:'AAPL',qty:2,instrumentId:1}];reconcile(s,snapshot(),now+1000);assert.equal(s.positions.length,0);assert.equal(s.after.AAPL,now+1000);s.positions=[{id:'p',symbol:'AAPL',qty:2,instrumentId:1}];reconcile(s,{...snapshot(),positions:[{id:'p',qty:3,side:'buy',tradableInstrumentId:1}]},now);assert.equal(s.halt,'POSITION_OWNERSHIP_REQUIRES_REVIEW');});
function fakeBroker(){let writes=0;return {get writes(){return writes;},snapshot:async()=>snapshot(),instruments:async()=>[{name:'AAPL',tradableInstrumentId:1,type:'EQUITY'}],details:async()=>input.details,history:async()=>({barDetails:[]}),quote:async()=>input.quote,write:async()=>{writes++;throw Error('network timeout');}};}
const signal=()=>({ready:true,setup:{patternId:'fresh',springLow:{price:29},targetPrice:40}});
test('disabled cycle performs no broker reads or writes',async()=>{await runCycle({state:initialState(now),broker:{snapshot(){throw Error('must not run');}},env:{}});});
test('persist before submit; timeout leaves reservation and prevents duplicate retry',async()=>{const s=initialState(now-1000),b=fakeBroker();let savedPending=false;const save=async state=>{if(state.pending)savedPending=true;};await runCycle({state:s,save,broker:b,env,now:()=>now,deadline:now+24000,signal});assert.ok(savedPending);assert.equal(b.writes,1);assert.ok(s.pending);assert.deepEqual(s.used,['fresh']);await runCycle({state:s,save,broker:b,env,now:()=>now+60000,deadline:now+84000,signal});assert.equal(b.writes,1);});
test('failed durable save stops submission',async()=>{const s=initialState(now-1000),b=fakeBroker();await assert.rejects(runCycle({state:s,save:async state=>{if(state.pending)throw Error('store unavailable');},broker:b,env,now:()=>now,deadline:now+24000,signal}));assert.equal(b.writes,0);});
test('missing broker stop triggers exact-position emergency close, no fresh buy',async()=>{const s=initialState(now-1000),b=fakeBroker();s.positions=[{id:'p',symbol:'AAPL',qty:2,instrumentId:1,entryPrice:30,entryAt:new Date(now-1000).toISOString(),peakPrice:30,strategyId:'WYCKOFF_5M_V1',exitPolicy:'SPRING_GAIN_LOCK_80_STOP_10_V1',minProfitHoldMs:7*86400000,tickSize:sizes}];b.snapshot=async()=>({...snapshot(),positions:[{id:'p',tradableInstrumentId:1,side:'buy',qty:2,stopLoss:null}]});await runCycle({state:s,save:async()=>{},broker:b,env,now:()=>now,deadline:now+24000});assert.equal(s.pending.kind,'CLOSE');assert.equal(s.pending.positionId,'p');assert.equal(s.pending.qty,2);});
test('week hold retains original stop; after week ratchets 80% of observed gain',async()=>{for(const age of [1000,8*86400000]){const s=initialState(now-age),b=fakeBroker();s.positions=[{id:'p',symbol:'AAPL',qty:2,instrumentId:1,entryPrice:25,entryAt:new Date(now-age).toISOString(),peakPrice:30,strategyId:'WYCKOFF_5M_V1',exitPolicy:'SPRING_GAIN_LOCK_80_STOP_10_V1',minProfitHoldMs:7*86400000,tickSize:sizes}];b.snapshot=async()=>({...snapshot(),positions:[{id:'p',tradableInstrumentId:1,side:'buy',qty:2,stopLoss:22.5}],orders:[{side:'buy'},{side:'buy'}]});await runCycle({state:s,save:async()=>{},broker:b,env,now:()=>now,deadline:now+24000});if(age===1000)assert.equal(s.pending,null);else{assert.equal(s.pending.kind,'STOP');assert.equal(s.pending.stopLoss,29);}}});
test('CAS lease prevents concurrency and losing CAS prevents mutation',async()=>{let data=null,etag='0';const store={getWithMetadata:async()=>data?{data:structuredClone(data),etag}:null,setJSON:async(k,v,opts)=>{if(opts.onlyIfNew&&data||opts.onlyIfMatch&&opts.onlyIfMatch!==etag)return {modified:false};data=structuredClone(v);etag=String(Number(etag)+1);return {modified:true,etag};}};const a=await lease(store,'123',()=>now);assert.ok(a);assert.equal(await lease(store,'123',()=>now),null);etag='other-writer';await assert.rejects(a.save(a.state),/LEASE_LOST/);});
test('public status is read only and disabled by default; exposes no secrets',async()=>{const h=makeHandler({env:{COLMEX_API_PASSWORD:'private'}});const r=await h({httpMethod:'GET'});const d=JSON.parse(r.body);assert.equal(d.enabled,false);assert.equal(d.policy.notionalUsd,800);assert.equal(d.policy.maxPositions,3);assert.equal(r.body.includes('private'),false);assert.equal((await h({httpMethod:'POST'})).statusCode,405);});
test('order adapter does not retry network errors and handles ack without d',async()=>{let calls=[];const b=new AutoBroker({env,deadline:now+24000,now:()=>now,fetchImpl:async(url,opts)=>{calls.push({url,opts});throw Error('network');}});b.reader.authorize=async()=> 'test-token';await assert.rejects(b.write('123',{...pending(),order:planBuy(input).order}));assert.equal(calls.length,1);assert.equal(calls[0].opts.method,'POST');assert.match(calls[0].url,/requestId=intent$/);assert.equal(calls[0].opts.headers.Authorization,'Bearer test-token');assert.ok(JSON.parse(calls[0].opts.body).stopLoss);b.fetch=async()=>({ok:true,json:async()=>({s:'ok'})});assert.deepEqual(await b.write('123',{kind:'CLOSE',positionId:'p',qty:2}),{});});
test('rapid second invocation cannot speed up scanning or trading',async()=>{const s=initialState(now);s.lastCycleAt=now;const result=await runCycle({state:s,broker:{snapshot(){throw Error('unexpected');}},env,now:()=>now+1000});assert.equal(result.reason,'CYCLE_COOLDOWN');});
test('adapter maps live dynamic arrays, rejects wrong account and unknown position conventions',async()=>{
 const payloads={'/config':{accountDetailsConfig:{columns:[{id:'cashBalance'}]},positionsConfig:{columns:[{id:'id'},{id:'qty'},{id:'side'},{id:'tradableInstrumentId'}]},ordersConfig:{columns:[{id:'id'},{id:'side'},{id:'tradableInstrumentId'}]},ordersHistoryConfig:{columns:[]}},'/accounts':{accounts:[{id:123,type:'live',currency:'USD',status:'ACTIVE'}]},'/accounts/123/state':{accountDetailsData:[500]},'/accounts/123/positions':{positions:[['p','2','buy','1']]},'/accounts/123/orders':{orders:[]},'/accounts/123/ordersHistory':{ordersHistory:[]}};
 const b=new AutoBroker({env,deadline:now+24000,now:()=>now});b.reader.authorize=async()=> 'mock';b.get=async path=>payloads[path];const s=await b.snapshot('123');assert.equal(s.state.cashBalance,500);assert.equal(s.positions[0].qty,'2');payloads['/accounts'].accounts[0].type='demo';await assert.rejects(b.snapshot('123'),/LIVE_ACCOUNT_MISMATCH/);payloads['/accounts'].accounts[0].type='live';payloads['/accounts/123/positions'].positions[0][2]='unknown';await assert.rejects(b.snapshot('123'),/POSITION_SCHEMA/);
});

test('Fetch entrypoint reads state with native runtime and reports precise configuration without values',async()=>{let reads=0;const h=makeFetchHandler({env,storeFactory:()=>({get:async()=>{reads++;return {state:{lastCycleAt:now,positions:[],checks:{},events:[]}};}})});const r=await h(new Request('https://test/status'),{deploy:{context:'production'}});const d=await r.json();assert.equal(r.status,200);assert.equal(d.runtimeDeployContext,'production');assert.equal(d.configuration.enabledFlag,true);assert.equal(d.configuration.liveAckMatches,true);assert.equal(reads,1);assert.equal((await h(new Request('https://test/status',{method:'POST'}),{})).status,405);assert.equal(reads,1);});

test('native production context enables only the updated owner acknowledgement; old settings stay disabled',()=>{
 const values={...env};delete values.CONTEXT;
 assert.equal(configuredLive(runtimeEnvironment(values,{deploy:{context:'production'}})),true);
 assert.equal(configuredLive(runtimeEnvironment({...values,COLMEX_AUTO_LIVE_ACK:'I_ACCEPT_LIVE_100_USD_3_POSITIONS'},{deploy:{context:'production'}})),false);
 assert.equal(configuredLive(runtimeEnvironment(env,{deploy:{context:'deploy-preview'}})),false);
 assert.equal(configuredLive(runtimeEnvironment(env,{})),false);
});
test('status uses native deployment, reports old acknowledgement blocked, and cannot be enabled by env in a preview',async()=>{
 const old={...env,COLMEX_AUTO_LIVE_ACK:'I_ACCEPT_LIVE_100_USD_3_POSITIONS'};
 const storeFactory=()=>({get:async()=>null});
 const prod=await (await makeFetchHandler({env:old,storeFactory})(new Request('https://test/status'),{deploy:{context:'production'}})).json();
 assert.equal(prod.configuration.productionEnvironment,true);assert.equal(prod.configuration.liveAckMatches,false);assert.equal(prod.enabled,false);
 const preview=await (await makeFetchHandler({env,storeFactory})(new Request('https://test/status'),{deploy:{context:'deploy-preview'}})).json();assert.equal(preview.enabled,false);
});

test('cycle diagnostic allows only fixed error codes and never exposes arbitrary broker messages',async()=>{const {cycleError}=await import('../netlify/functions/colmex-auto-monitor.mjs');assert.equal(cycleError(Error('HISTORY_SCHEMA'),'HISTORY_AND_DETAILS').reason,'HISTORY_SCHEMA');assert.equal(cycleError(Error('secret broker response'),'HISTORY_AND_DETAILS').reason,'CYCLE_FAILED_NO_AUTOMATIC_RETRY_OF_ORDERS');});

test('missing historical bars start a new independent contiguous Wyckoff search',()=>{
 const bars=[0,300000,900000,1200000,1500000].map(t=>({closeTime:now-1500000+t}));
 const sliced=contiguousHistory(bars);assert.equal(sliced.discarded,2);assert.equal(sliced.bars.length,3);assert.equal(sliced.resetAt,now-600000);assert.equal(bars.length,5);
 const multiple=contiguousHistory([...bars,{closeTime:now+600000}]);assert.equal(multiple.discarded,5);assert.equal(multiple.bars.length,1);
 assert.equal(entrySignal(multiple.bars,now+600000,now).ready,false);
});
test('normal close-to-open session gaps preserve multiday history',()=>{
 const times=['2026-10-19T19:55:00Z','2026-10-19T20:00:00Z','2026-10-20T13:35:00Z','2026-10-20T13:40:00Z'].map(Date.parse);
 const h=contiguousHistory(times.map(closeTime=>({closeTime})));assert.equal(h.discarded,0);assert.equal(h.bars.length,4);
});

test('slow read budget allows twelve seconds but reserves time before cycle deadline',async()=>{
 const original=AbortSignal.timeout,budgets=[];
 AbortSignal.timeout=ms=>{budgets.push(ms);return new AbortController().signal;};
 try {
  for(const remaining of [27000,5000]){
   const b=new AutoBroker({env,deadline:now+remaining,now:()=>now,fetchImpl:async()=>({ok:true,status:200,json:async()=>({s:'ok',d:{}})})});
   await b.reader.json('/config');
  }
  assert.deepEqual(budgets,[12000,12000,12000,4000]);
 }finally{AbortSignal.timeout=original;}
});
test('slow snapshot can still analyze; insufficient time never submits a fresh order',async()=>{
 for(const elapsed of [14000,19500]){
  let clock=now;const b=fakeBroker(),s=initialState(now-1000);
  b.snapshot=async()=>{clock+=elapsed;return snapshot();};
  const result=await runCycle({state:s,save:async()=>{},broker:b,env,now:()=>clock,deadline:now+27000,signal});
  if(elapsed===14000){assert.equal(b.writes,1);assert.equal(result.reason,'PENDING_BROKER_CONFIRMATION');}
  else {assert.equal(b.writes,0);assert.equal(result.reason,'CYCLE_DEADLINE');assert.equal(s.pending,null);}
 }
});

test('800 USD permits whole shares within budget, rejects excessive amount and preserves fee reserve',()=>{const q={...input,quote:{ap:345,bp:344.99}};assert.equal(planBuy(q).order.qty,2);assert.equal(planBuy({...q,amountUsd:800.01}).reason,'INVALID_BUY_AMOUNT');assert.equal(planBuy({...q,cash:349}).reason,'INSUFFICIENT_UNLEVERAGED_CASH');assert.equal(planBuy({...q,amountUsd:100}).reason,'MINIMUM_QUANTITY_ABOVE_BUDGET');});
