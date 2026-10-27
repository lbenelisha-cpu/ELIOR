import test from 'node:test';import assert from 'node:assert/strict';
import {manualTrade,manualInput} from '../lib/colmex-manual-trades.mjs';
import {pairDevice,requireDevice,sameOrigin} from '../lib/colmex-device-access.mjs';
import {initialState,reconcile,runCycle} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK,entrySignal} from '../lib/colmex-auto-policy.mjs';
import {stockBars,applyStockObservation,newSimulation} from '../lib/colmex-simulation.mjs';
import {makeManualHandler} from '../netlify/functions/colmex-manual-trade.mjs';
import {manualDiagnosticOffer} from '../lib/colmex-manual-diagnostic.mjs';
import {BrokerWriteError} from '../lib/colmex-write-outcome.mjs';
import {validateLiveState} from '../lib/colmex-live-state.mjs';
const now=Date.parse('2026-10-20T16:00:00Z');
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_API_LOGIN:'test',COLMEX_API_PASSWORD:'private',COLMEX_DEVICE_PAIR_CODE:'123456'};
const request={side:'BUY',symbol:'AAPL',amountUsd:50,requestId:'11111111-1111-4111-8111-111111111111'};
const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1000},positions:[],orders:[],history:[]});
function broker(){return {writes:[],snapshot:async()=>snapshot(),instruments:async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:1}],details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),quote:async()=>({bp:29.99,ap:30}),history:async()=>({barDetails:[]}),async write(account,intent){this.writes.push(structuredClone(intent));return {orderId:'order'};}};}
function store(){const rows=new Map();let version=0;return {async get(k){return structuredClone(rows.get(k)?.data??null);},async getWithMetadata(k){return structuredClone(rows.get(k)??null);},async setJSON(k,data,options={}){const previous=rows.get(k);if(options.onlyIfNew&&previous||options.onlyIfMatch&&previous?.etag!==options.onlyIfMatch)return {modified:false};const etag=String(++version);rows.set(k,{data:structuredClone(data),etag});return {modified:true,etag};},async delete(k){rows.delete(k);}};}
test('fixed code is reusable across devices, rate limited and bound to account/credentials',async()=>{
 const s=store();for(let i=0;i<5;i++)await assert.rejects(pairDevice(s,env,'000000',now),/PAIR_CODE_INVALID/);await assert.rejects(pairDevice(s,env,'123456',now),/PAIR_CODE_COOLDOWN/);
 const good=store(),device=await pairDevice(good,env,'123456',now);await requireDevice(good,env,'Bearer '+device.token,now);
 const second=await pairDevice(good,env,'123456',now);assert.notEqual(second.token,device.token);await requireDevice(good,env,'Bearer '+device.token,now);await requireDevice(good,env,'Bearer '+second.token,now);
 await pairDevice(s,env,'123456',now+15*60000);
 await assert.rejects(requireDevice(good,{...env,COLMEX_API_PASSWORD:'rotated'},'Bearer '+device.token,now),/DEVICE_REQUIRED/);
 await assert.rejects(requireDevice(good,env,'Bearer '+device.token,device.expiresAt),/DEVICE_REQUIRED/);
 await assert.rejects(pairDevice(store(),{...env,CONTEXT:'deploy-preview'},'123456',now),/PAIRING_NOT_CONFIGURED/);
});
test('origin and JSON content type are mandatory on financial POST requests',()=>{
 assert.equal(sameOrigin(new Request('https://app.test/f',{headers:{origin:'https://other.test','content-type':'application/json'}})),false);
 assert.equal(sameOrigin(new Request('https://app.test/f',{headers:{origin:'https://app.test','content-type':'application/json'}})),true);
});
test('manual buy uses chosen budget, broker stop and same durable intent; duplicate request never writes twice',async()=>{
 const state=initialState(now-1000),b=broker();let persisted=false;
 const write=b.write.bind(b);b.write=async(...args)=>{assert.equal(persisted,true);return write(...args);};
 const args={input:request,state,save:async s=>{if(s.pending)persisted=true;},broker:b,env,now:()=>now,deadline:now+24000};
 const result=await manualTrade(args);assert.equal(result.status,'PENDING');assert.equal(b.writes[0].order.qty,1);assert.ok(b.writes[0].order.stopLoss>0);assert.equal(state.after.AAPL,now);
 await manualTrade(args);assert.equal(b.writes.length,1);
 await assert.rejects(manualTrade({...args,input:{...request,amountUsd:80}}),/REQUEST_ID_CONFLICT/);
});
test('unknown write outcome remains pending and a different request cannot place another order',async()=>{
 const state=initialState(now),b=broker();b.write=async()=>{throw Error('timeout');};const args={input:request,state,save:async()=>{},broker:b,env,now:()=>now,deadline:now+24000};
 await manualTrade(args);assert.equal(state.pending.manual,true);
 await assert.rejects(manualTrade({...args,input:{...request,requestId:'22222222-2222-4222-8222-222222222222'}}),/TRADE_IN_PROGRESS/);
});
test('durable save failure prevents broker mutation; invalid amount and exposure are rejected',async()=>{
 assert.equal(manualInput({...request,amountUsd:800}).amountUsd,800);assert.throws(()=>manualInput({...request,amountUsd:800.01}),/INVALID_BUY_AMOUNT/);
 const state=initialState(now),b=broker();await assert.rejects(manualTrade({input:request,state,broker:b,env,now:()=>now,deadline:now+24000,save:async s=>{if(s.pending)throw Error('save failed');}}),/save failed/);assert.equal(b.writes.length,0);
 b.snapshot=async()=>({...snapshot(),positions:[{},{},{}]});await assert.rejects(manualTrade({input:request,state:initialState(now),broker:b,env,now:()=>now,deadline:now+24000,save:async()=>{}}),/NO_FREE_SLOT/);
});
test('manual sell closes exact full long quantity, overrides hold, and requires new signal after confirmed close',async()=>{
 const state=initialState(now-1000),b=broker();b.snapshot=async()=>({...snapshot(),positions:[{id:'p',tradableInstrumentId:1,side:'buy',qty:2.5}]});
 await manualTrade({input:{...request,side:'SELL'},state,broker:b,env,now:()=>now,deadline:now+24000,save:async()=>{}});
 assert.equal(b.writes[0].kind,'CLOSE');assert.equal(b.writes[0].positionId,'p');assert.equal(b.writes[0].qty,2.5);
 reconcile(state,snapshot(),now+1000);assert.equal(state.manualRequests[request.requestId].status,'CLOSED');assert.equal(state.after.AAPL,now+1000);
});
test('manual fill becomes owned only after actual broker confirmation',async()=>{
 const state=initialState(now),b=broker();await manualTrade({input:request,state,broker:b,env,now:()=>now,deadline:now+24000,save:async()=>{}});
 const snap={...snapshot(),history:[{id:'order',status:'filled',filledQty:1,avgPrice:30,positionId:'p'}],positions:[{id:'p',tradableInstrumentId:1,side:'buy',qty:1}]};
 reconcile(state,snap,now+60000);assert.equal(state.manualRequests[request.requestId].status,'FILLED');assert.equal(state.positions[0].qty,1);assert.equal(state.positions[0].minProfitHoldMs,0);
});
test('HTTP entrypoint refuses missing device, wrong origin and preview before broker reads',async()=>{
 let reads=0;const h=makeManualHandler({env,deviceStoreFactory:store,brokerFactory:()=>{reads++;throw Error();}});
 const req=new Request('https://app.test/manual',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(request)});
 assert.equal((await h(req,{deploy:{context:'production'}})).status,401);assert.equal(reads,0);
 assert.equal((await h(new Request('https://app.test/manual',{method:'POST'}),{})).status,403);
});
test('expired Spring cannot authorize a new purchase even with a current low RSI',async()=>{
 const prices=[95,97,100,90,80,85,92,87,82,84,86,85,86,78,...Array(5).fill(79)];
 const start=now-prices.length*300000;
 const values=prices.map((close,i)=>({datetime:new Date(start+i*300000).toISOString().slice(0,19).replace('T',' '),open:i<2?close-1:close,high:close,low:i<2?close-1:close,close}));
 const series={meta:{symbol:'AAPL',currency:'USD',type:'Common Stock'},values},bars=stockBars(series,'AAPL',now);
 const live={price:60,priceAsOf:now+60000};const setup=entrySignal(bars,now+60000,start,[],live);assert.equal(setup.ready,false);
 const sim=applyStockObservation(newSimulation(start),{symbol:'AAPL',series,quote:{symbol:'AAPL',currency:'USD',close:77,last_quote_at:(now+60000)/1000,is_market_open:true},now:now+60000});assert.equal(sim.journal.length,0);
 const state=initialState(start),b=broker();b.quote=async()=>({ap:77,bp:76.99});
 await runCycle({state,broker:b,env,now:()=>now+60000,deadline:now+84000,save:async()=>{},signal:()=>setup});assert.equal(state.pending,null);
});
const priorId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const diagnosticRequest={...request,diagnostic:true,reviewRequestId:priorId,amountUsd:200};
function diagnosticState(){
 const s=initialState(now-7200000);s.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';
 s.pending={id:priorId,tag:'levi-auto:'+priorId,kind:'BUY',symbol:'AMD',at:now-3600000,reviewRequired:true,order:{tradableInstrumentId:9,qty:4,price:200},tickSize:[{leftRangeLimit:0,tickSize:.01}]};return s;
}
function diagnosticBroker(){const b=broker();b.snapshot=async()=>({...snapshot(),historyAvailable:true,state:{availableCash:1287.66}});return b;}
test('explicit manual diagnostic preserves old intent and halt; one independent durable write only',async()=>{
 const state=diagnosticState(),b=diagnosticBroker();let persisted;
 const args={input:diagnosticRequest,state,broker:b,env,now:()=>now,deadline:now+24000,save:async s=>{persisted=structuredClone(validateLiveState(s));}};
 const write=b.write.bind(b);b.write=async(...args)=>{assert.equal(persisted.pending.id,priorId);assert.equal(persisted.riskPending[0].id,request.requestId);assert.equal(persisted.manualRequests[request.requestId].diagnostic,true);return write(...args);};
 await manualTrade(args);assert.equal(b.writes.length,1);assert.equal(state.pending.id,priorId);assert.equal(state.pending.symbol,'AMD');assert.equal(state.halt,'UNRESOLVED_ORDER_REQUIRES_REVIEW');
 assert.ok(b.writes[0].order.qty*b.writes[0].order.price<=200);assert.ok(b.writes[0].order.stopLoss>0);assert.ok(b.writes[0].order.takeProfit>0);
 await manualTrade({...args,state:structuredClone(state)});assert.equal(b.writes.length,1);
 await assert.rejects(manualTrade({...args,input:{...request,amountUsd:200}}),/REQUEST_ID_CONFLICT/);
});
test('diagnostic gates reject other halts, changed identity, same instrument and concurrent intents',async()=>{
 for(const kind of ['normal','halt','source','symbol','instrument','pending','accepted','owned']){
  const state=diagnosticState(),b=diagnosticBroker();let input={...diagnosticRequest};
  if(kind==='normal')input={...request};
  if(kind==='halt')state.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';
  if(kind==='source')input.reviewRequestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if(kind==='symbol')input.symbol='AMD';
  if(kind==='instrument')b.instruments=async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:9}];
  if(kind==='pending')state.riskPending=[{id:'other',kind:'CLOSE',symbol:'OTHER',positionId:'p',at:now}];
  if(kind==='accepted')state.pending.orderId='broker-known';
  if(kind==='owned')state.pending.manual=true;
  await assert.rejects(manualTrade({input,state,broker:b,env,now:()=>now,deadline:now+24000,save:async()=>{}}));assert.equal(b.writes.length,0,kind);assert.equal(state.pending.id,priorId);
 }
 for(const input of [{...diagnosticRequest,amountUsd:200.01},{...diagnosticRequest,side:'SELL'},{...diagnosticRequest,reviewRequestId:''},{...diagnosticRequest,diagnostic:'true'}])assert.throws(()=>manualInput(input));
});
test('diagnostic requires empty verified account and reserves cash for the unknown original purchase',async()=>{
 for(const change of [{historyAvailable:false},{historyAvailable:undefined},{positions:[{id:'external'}]},{orders:[{id:'external'}]},{state:{availableCash:900}}]){
  const state=diagnosticState(),b=diagnosticBroker(),snap=await b.snapshot();b.snapshot=async()=>({...snap,...change});
  await assert.rejects(manualTrade({input:diagnosticRequest,state,broker:b,env,now:()=>now,deadline:now+24000,save:async()=>{}}));assert.equal(b.writes.length,0);
 }
 const state=diagnosticState(),b=diagnosticBroker();
 await assert.rejects(manualTrade({input:diagnosticRequest,state,broker:b,env,now:()=>now,deadline:now+24000,save:async s=>{if(s.riskPending?.length)throw Error('durability');}}),/durability/);assert.equal(b.writes.length,0);
});
test('diagnostic failure stores exact fixed code, blocks new attempts and never removes original reservation',async()=>{
 for(const outcome of ['UNKNOWN','REJECTED','NOT_SENT']){
  const state=diagnosticState(),b=diagnosticBroker();let writes=0;b.write=async()=>{writes++;throw new BrokerWriteError('WRITE_HTTP_ERROR',{outcome,httpStatus:400});};
  const args={input:diagnosticRequest,state,broker:b,env,now:()=>now,deadline:now+24000,save:async()=>{}};
  const result=await manualTrade(args);assert.equal(result.failure.httpStatus,400);assert.equal(result.failure.code,'WRITE_HTTP_ERROR');
  assert.equal(state.pending.id,priorId);assert.ok(state.halt);assert.equal(state.riskPending.length,outcome==='UNKNOWN'?1:0);
  await manualTrade({...args,state:structuredClone(state)});assert.equal(writes,1);
  await assert.rejects(manualTrade({...args,input:{...diagnosticRequest,requestId:'22222222-2222-4222-8222-222222222222'}}));assert.equal(writes,1);
 }
});
test('confirmed diagnostic fill joins protection management while old AMD still blocks automatic buys',async()=>{
 const state=diagnosticState(),b=diagnosticBroker(),snap=await b.snapshot();
 await manualTrade({input:diagnosticRequest,state,broker:b,env,now:()=>now,deadline:now+24000,save:async()=>{}});
 const qty=b.writes[0].order.qty;const confirmed={...snap,history:[{id:'order',status:'filled',filledQty:qty,avgPrice:30,positionId:'manual-p'}],positions:[{id:'manual-p',tradableInstrumentId:1,side:'buy',qty,avgPrice:30,stopLoss:29.7,takeProfit:45}]};
 reconcile(state,confirmed,now+60000);assert.equal(state.manualRequests[request.requestId].status,'FILLED');assert.equal(state.positions[0].symbol,'AAPL');assert.equal(state.positions[0].brokerProtection.status,'STOP_PRESENT');assert.equal(state.pending.id,priorId);assert.ok(state.halt);assert.equal(state.riskPending.length,0);
 assert.equal(manualDiagnosticOffer(state).reason,'DIAGNOSTIC_ALREADY_USED');
 // Offline fixture: the normal risk worker can protect this confirmed holding
 // without sending any additional BUY or resolving the unrelated AMD intent.
 confirmed.positions[0].stopLoss=null;b.snapshot=async()=>confirmed;
 await runCycle({state,broker:b,env,now:()=>now+120000,deadline:now+144000,save:async()=>{}});
 assert.equal(b.writes[1].kind,'CLOSE');assert.equal(b.writes[1].positionId,'manual-p');assert.equal(state.pending.id,priorId);assert.ok(state.halt);
});
test('authenticated diagnostic GET returns fixed failure details for this request only',async()=>{
 const devices=store(),device=await pairDevice(devices,env,'123456'),state=diagnosticState();
 state.manualRequests={[request.requestId]:{...diagnosticRequest,status:'REJECTED',failure:{code:'WRITE_VALIDATION_REJECTED',outcome:'REJECTED',httpStatus:400,at:now,raw:'private-token'}}};
 const h=makeManualHandler({env,deviceStoreFactory:()=>devices,storeFactory:()=>({get:async()=>({state})}),brokerFactory:()=>{throw Error('GET must not invoke broker');}});
 const r=await h(new Request('https://app.test/manual?requestId='+request.requestId,{headers:{authorization:'Bearer '+device.token}}),{deploy:{context:'production'}}),data=await r.json();
 assert.equal(r.status,200);assert.equal(data.failure.code,'WRITE_VALIDATION_REJECTED');assert.equal(data.failure.httpStatus,400);assert.equal(data.reviewRequired,false);assert.equal(JSON.stringify(data).includes('private-token'),false);
});
