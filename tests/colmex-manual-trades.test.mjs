import test from 'node:test';import assert from 'node:assert/strict';
import {manualTrade,manualInput} from '../lib/colmex-manual-trades.mjs';
import {pairDevice,requireDevice,sameOrigin} from '../lib/colmex-device-access.mjs';
import {initialState,reconcile,runCycle} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK,entrySignal} from '../lib/colmex-auto-policy.mjs';
import {stockBars,applyStockObservation,newSimulation} from '../lib/colmex-simulation.mjs';
import {makeManualHandler} from '../netlify/functions/colmex-manual-trade.mjs';
const now=Date.parse('2026-10-20T16:00:00Z');
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_API_LOGIN:'test',COLMEX_API_PASSWORD:'private',COLMEX_DEVICE_PAIR_CODE:'123456'};
const request={side:'BUY',symbol:'AAPL',amountUsd:50,requestId:'11111111-1111-4111-8111-111111111111'};
const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1000},positions:[],orders:[],history:[]});
function broker(){return {writes:[],snapshot:async()=>snapshot(),instruments:async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:1}],details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),quote:async()=>({bp:29.99,ap:30}),history:async()=>({barDetails:[]}),async write(account,intent){this.writes.push(structuredClone(intent));return {orderId:'order'};}};}
function store(){const rows=new Map();let version=0;return {async get(k){return structuredClone(rows.get(k)?.data??null);},async getWithMetadata(k){return structuredClone(rows.get(k)??null);},async setJSON(k,data,options={}){const previous=rows.get(k);if(options.onlyIfNew&&previous||options.onlyIfMatch&&previous?.etag!==options.onlyIfMatch)return {modified:false};const etag=String(++version);rows.set(k,{data:structuredClone(data),etag});return {modified:true,etag};},async delete(k){rows.delete(k);}};}
test('one-time pairing locks after five failures, is single-use and binds to account/credentials',async()=>{
 const s=store();for(let i=0;i<5;i++)await assert.rejects(pairDevice(s,env,'000000',now),/PAIR_CODE_INVALID/);await assert.rejects(pairDevice(s,env,'123456',now),/PAIR_CODE_EXPIRED_OR_USED/);
 const good=store(),device=await pairDevice(good,env,'123456',now);await requireDevice(good,env,'Bearer '+device.token,now);
 await assert.rejects(pairDevice(good,env,'123456',now),/PAIR_CODE_EXPIRED_OR_USED/);
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
 reconcile(state,snap,now+60000);assert.equal(state.manualRequests[request.requestId].status,'FILLED');assert.equal(state.positions[0].qty,1);assert.equal(state.positions[0].minProfitHoldMs,7*86400000);
});
test('HTTP entrypoint refuses missing device, wrong origin and preview before broker reads',async()=>{
 let reads=0;const h=makeManualHandler({env,deviceStoreFactory:store,brokerFactory:()=>{reads++;throw Error();}});
 const req=new Request('https://app.test/manual',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(request)});
 assert.equal((await h(req,{deploy:{context:'production'}})).status,401);assert.equal(reads,0);
 assert.equal((await h(new Request('https://app.test/manual',{method:'POST'}),{})).status,403);
});
test('Spring older than twenty minutes can enter below its low, but used and pre-sale patterns remain blocked',async()=>{
 const prices=[95,97,100,90,80,85,92,87,82,84,86,85,86,78,...Array(5).fill(79)];
 const start=now-prices.length*300000;
 const values=prices.map((close,i)=>({datetime:new Date(start+i*300000).toISOString().slice(0,19).replace('T',' '),open:i<2?close-1:close,high:close,low:i<2?close-1:close,close}));
 const series={meta:{symbol:'AAPL',currency:'USD',type:'Common Stock'},values},bars=stockBars(series,'AAPL',now);
 const setup=entrySignal(bars,now+60000,start);assert.equal(setup.ready,true);assert.ok(now+60000-setup.setup.signalTime>20*60000);
 assert.equal(entrySignal(bars,now+60000,setup.setup.signalTime).ready,false);assert.equal(entrySignal(bars,now+60000,start,[setup.setup.patternId]).ready,false);
 const sim=applyStockObservation(newSimulation(start),{symbol:'AAPL',series,quote:{symbol:'AAPL',currency:'USD',close:77,last_quote_at:(now+60000)/1000,is_market_open:true},now:now+60000});assert.equal(sim.assets.AAPL.reason,'BUY');
 const state=initialState(start),b=broker();b.quote=async()=>({ap:77,bp:76.99});
 await runCycle({state,broker:b,env,now:()=>now+60000,deadline:now+84000,save:async()=>{},signal:()=>setup});assert.equal(state.pending.kind,'BUY');
});
