import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {shortConfig,shortSignal,shortExit,validateShortSettings,FUTURES_SHORT_EXIT_POLICY,shortOrderPlan,shortAllocation} from '../lib/futures-short-policy.mjs';
import {FuturesShortAPI} from '../lib/futures-short-api.mjs';
import {FuturesShortRunner,atomicFuturesSave} from '../lib/futures-short-runner.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
const D=300000,end=Date.parse('2026-11-01T10:00Z'),now=end+1000;
const config=shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:new Date(end-D).toISOString()});
const settings=validateTradeSettings({});
function input(){return pocFixture({side:'SHORT',end,entryPrice:104});}

const info={symbol:'ABCUSDT',baseAsset:'ABC',status:'TRADING',contractType:'PERPETUAL',marginAsset:'USDT',quoteAsset:'USDT',filters:[{filterType:'LOT_SIZE',minQty:'.001',maxQty:'10000',stepSize:'.001'},{filterType:'PRICE_FILTER',tickSize:'.01'},{filterType:'MIN_NOTIONAL',notional:'5'}]};
function harness(options={}){
 const writes=[],algos=new Map(),orders=new Map();let positions=[],saved,control={allowEntries:true,resumedAt:0},ownerSettings={...settings},quote=input().quote;
 const a={canTrade:true,multiAssetsMargin:false,assets:[{asset:'USDT',availableBalance:'70',walletBalance:'70'}]},symbolConfig={symbol:'ABCUSDT',marginType:'ISOLATED',leverage:1,isAutoAddMargin:false};
 const api={async get(p,q={}){
  if(options.onGet)await options.onGet(p,q);
  if(p==='/fapi/v2/account')return {...a,positions:structuredClone(positions)};
  if(p==='/fapi/v1/positionSide/dual')return {dualSidePosition:false};
  if(p==='/fapi/v1/symbolConfig')return [{...symbolConfig,symbol:q.symbol}];
  if(p==='/fapi/v1/openOrders')return [];
  if(p==='/fapi/v1/openAlgoOrders')return [...algos.values()].filter(o=>o.algoStatus==='NEW');
  if(p==='/fapi/v1/income')return options.income||[];
  if(p==='/fapi/v1/ticker/bookTicker')return {...quote,symbol:q.symbol};
  // Deployed runners also check CONTRACT_PRICE before installing native protection.
  // Use the current synthetic bid as the last trade, including low-price/stale fixtures.
  if(p==='/fapi/v1/ticker/price')return {symbol:q.symbol,price:quote.bidPrice,time:quote.time};
  if(p==='/fapi/v1/exchangeInfo')return {symbols:[info]};
  if(p==='/fapi/v1/ticker/24hr')return [{symbol:'ABCUSDT',quoteVolume:'10000000'}];
  if(p==='/fapi/v1/klines')return [...(input().trendBars||input().bars),input().liveBar].map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.closeTime-1]);
  if(p==='/fapi/v1/algoOrder'){const o=q.algoId?[...algos.values()].find(o=>o.algoId===q.algoId):algos.get(q.clientAlgoId);if(!o)throw Error('ALGO_UNKNOWN');return structuredClone(o);}
  if(p==='/fapi/v1/order'){const o=orders.get(q.origClientOrderId);if(!o)throw Error('ORDER_UNKNOWN');return structuredClone(o);}
  throw Error('Unexpected read '+p);
 },async post(p,q){
  writes.push({p,q:structuredClone(q)});
  if(options.beforePost)await options.beforePost(p,q);
  if(p==='/fapi/v1/order'){
   const qty=q.side==='SELL'?Number(q.quantity)*(options.fillFraction??1):Number(q.quantity);
   const o={...q,clientOrderId:q.newClientOrderId,orderId:orders.size+1,status:options.fillFraction?'EXPIRED':'FILLED',executedQty:String(qty),avgPrice:'104',cumQuote:String(qty*104)};orders.set(q.newClientOrderId,o);
   if(q.side==='SELL')positions.push({symbol:q.symbol,positionSide:'BOTH',positionAmt:String(-qty),entryPrice:'104'});else positions=positions.filter(x=>x.symbol!==q.symbol);
   if(options.unknownOnce){options.unknownOnce=false;throw Error('FUTURES_NETWORK_OUTCOME_UNKNOWN');}
   return o;
  }
  if(p==='/fapi/v1/algoOrder'){
   if(options.rejectProtection){const e=Error('PROTECTION_REJECTED');e.status=400;e.code=-2021;throw e;}
   const o={...q,algoId:algos.size+1000,orderType:q.type,algoStatus:'NEW',closePosition:true};algos.set(q.clientAlgoId,o);return o;
  }
  if(p==='/fapi/v1/marginType'){symbolConfig.marginType=q.marginType;return {};}
  if(p==='/fapi/v1/leverage'){symbolConfig.leverage=q.leverage;return {};}
  throw Error('Unexpected mutation '+p);
 },async del(p,q){writes.push({p,q});algos.get(q.clientAlgoId).algoStatus='CANCELED';return {};}};
 const runner=new FuturesShortRunner({api,file:'/unused',config:options.config||config,settings:()=>ownerSettings,control:()=>control,permission:async()=>({enableFutures:true,ipRestrict:true}),now:()=>now,sleep:options.sleep||(()=>Promise.resolve()),save:(_,s)=>{saved=structuredClone(s);options.onSave?.(s,control,ownerSettings);}});
 runner.infos.ABCUSDT=info;runner.marketAt=now;
 return {runner,api,writes,algos,orders,a,symbolConfig,control,ownerSettings,setQuote:q=>quote={...quote,...q},setPositions:p=>positions=p,get saved(){return saved;}};
}
test('4130 replaces only a verified owned guard after confirmed cancellation and retains the other protection',async()=>{
 const options={},h=harness(options);await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 const p=h.runner.state.positions.ABCUSDT,old=p.algos.find(x=>x.kind==='STOP_MARKET'),tp=p.algos.find(x=>x.kind==='TAKE_PROFIT_MARKET'),start=h.writes.length;
 options.beforePost=(route,q)=>{if(route==='/fapi/v1/algoOrder'&&[...h.algos.values()].some(x=>x.orderType===q.type&&x.algoStatus==='NEW')){const e=Error('FUTURES_API_-4130');e.code=-4130;e.status=400;throw e;}};
 await h.runner.ensureAlgo(p,'STOP_MARKET',105);
 assert.equal(h.algos.get(old.clientAlgoId).algoStatus,'CANCELED');assert.equal(h.algos.get(tp.clientAlgoId).algoStatus,'NEW');
 assert.equal(p.algos.find(x=>x.kind==='STOP_MARKET').price,105);assert.equal(p.algos.find(x=>x.kind==='STOP_MARKET').status,'NEW');
 const writes=h.writes.slice(start);assert.equal(writes.filter(x=>x.p==='/fapi/v1/order').length,0);
 assert.equal(writes.filter(x=>x.q.type==='STOP_MARKET').length,2);assert.equal(writes[1].q.clientAlgoId,old.clientAlgoId);
});
test('4130 fallback never cancels unverified guards and never retries an ambiguous submission',async()=>{
 for(const fault of ['identity','ambiguous','external']){
  const options={},h=harness(options);await h.runner.enter('ABCUSDT',shortSignal(input(),config));const p=h.runner.state.positions.ABCUSDT,start=h.writes.length;
  if(fault==='identity')h.algos.get(p.algos[0].clientAlgoId).side='SELL';
  if(fault==='external')p.algos=p.algos.filter(x=>x.kind!=='STOP_MARKET');
  options.beforePost=(route)=>{if(route==='/fapi/v1/algoOrder'){const e=Error(fault==='ambiguous'?'FUTURES_NETWORK_OUTCOME_UNKNOWN':'FUTURES_API_-4130');if(fault!=='ambiguous'){e.code=-4130;e.status=400;}throw e;}};
  await assert.rejects(h.runner.ensureAlgo(p,'STOP_MARKET',105));
  const writes=h.writes.slice(start);assert.equal(writes.length,1);assert.equal(writes[0].q.type,'STOP_MARKET');
 }
});
test('failed replacement is bounded and management retains its emergency close and halt',async()=>{
 const options={},h=harness(options);await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 options.beforePost=(route)=>{if(route==='/fapi/v1/algoOrder'){const e=Error('FUTURES_API_-4130');e.code=-4130;e.status=400;throw e;}};
 h.setQuote({bidPrice:'95',askPrice:'95.01'});const before=h.writes.length;
 await h.runner.manage(await h.runner.snapshot());
 assert.equal(h.runner.state.halt,'FUTURES_API_-4130');assert.ok(h.writes.slice(before).some(x=>x.p==='/fapi/v1/order'&&x.q.side==='BUY'&&x.q.reduceOnly==='true'));
 assert.equal(h.writes.slice(before).filter(x=>x.q.type==='STOP_MARKET').length,2);
});
test('4130 halt releases only after fresh owned protection and complete exchange reconciliation',async()=>{
 for(const fault of [null,'foreignOrder','foreignAlgo','stale','pending','otherHalt','unownedPosition']){
  const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));const p=h.runner.state.positions.ABCUSDT;
  h.runner.state.halt=fault==='otherHalt'?'FUTURES_FATAL':'FUTURES_API_-4130';
  if(fault==='stale')p.priceAt=now-11000;
  if(fault==='pending')h.runner.state.pending={kind:'EXIT'};
  if(fault==='unownedPosition')h.setPositions([{symbol:'FOREIGNUSDT',positionSide:'BOTH',positionAmt:'-1',entryPrice:'100'}]);
  const get=h.api.get;h.api.get=async(route,q)=>route==='/fapi/v1/openOrders'&&fault==='foreignOrder'?[{}]:route==='/fapi/v1/openAlgoOrders'&&fault==='foreignAlgo'?[...(await get(route,q)),{clientAlgoId:'foreign'}]:get(route,q);
  const writes=h.writes.length;
  try{await h.runner.recoverProtectionConflictHalt(now);}catch(e){assert.equal(fault,'unownedPosition');}
  assert.equal(h.writes.length,writes,'recovery only reads exchange state');
  if(fault)assert.ok(h.runner.state.halt);else{assert.equal(h.runner.state.halt,null);assert.equal(h.runner.state.resumedAt,now);assert.equal(h.runner.state.haltReleases.at(-1).reason,'PROTECTION_CONFLICT_RECONCILED');}
 }
});
test('shared SHORT execution universe includes verified stock contracts independently of top-volume rankings',async()=>{
 const h=harness(),get=h.api.get;h.runner.watchSymbols=()=>['GOOGLBUSDT','ABCUSDT','NVDABUSDT'];
 h.api.get=async(route,p)=>{
  if(route==='/fapi/v1/exchangeInfo')return {symbols:[info,{...info,symbol:'GOOGLUSDT',baseAsset:'GOOGL'}]};
  if(route==='/fapi/v1/ticker/24hr')throw Error('Volume cutoff must not select the shared universe');
  return get(route,p);
 };
 await h.runner.markets();assert.deepEqual(h.runner.universe,['GOOGLUSDT','ABCUSDT']);assert.equal(h.writes.length,0);
});
test('removing a shared-watch symbol rejects automatic entry and final dispatch without a SELL',async()=>{
 const h=harness();h.runner.watchSymbols=()=>['GOOGLBUSDT'];await assert.rejects(h.runner.enter('ABCUSDT',shortSignal(input(),config)),/NOT_IN_SHARED_WATCH/);assert.equal(h.writes.length,0);
 let symbols=['ABCUSDT'];const k=harness({onSave(){symbols=[];}});k.runner.watchSymbols=()=>symbols;
 await assert.rejects(k.runner.enter('ABCUSDT',shortSignal(input(),config)),/NOT_IN_SHARED_WATCH/);assert.equal(k.writes.some(w=>w.q.side==='SELL'),false);
});
test('contract-price test replies follow quote changes and retain strict endpoint failures',async()=>{
 const h=harness(),read=()=>h.api.get('/fapi/v1/ticker/price',{symbol:'ABCUSDT'});
 assert.deepEqual(await read(),{symbol:'ABCUSDT',price:'104',time:now});
 h.setQuote({bidPrice:'.02349',askPrice:'.023491',time:now-11000});
 assert.deepEqual(await read(),{symbol:'ABCUSDT',price:'.02349',time:now-11000});
 await assert.rejects(h.api.get('/fapi/v1/unexpected'),/Unexpected read/);
 const failing=harness({onGet(p){if(p==='/fapi/v1/ticker/price')throw Error('CONTRACT_PRICE_FAILURE');}});
 await assert.rejects(failing.api.get('/fapi/v1/ticker/price',{symbol:'ABCUSDT'}),/CONTRACT_PRICE_FAILURE/);
});
test('SHORT records initial upper consolidation and changed initial evidence blocks final SELL',async()=>{
 const first=shortSignal(input(),config);assert.equal(first.setup.consolidation.zone,'UPPER');
 const h=harness(),get=h.api.get;
 h.api.get=async(p,q)=>{const rows=await get(p,q);if(p==='/fapi/v1/klines')for(let k=24;k<30;k++)rows[rows.length-53+k][3]-=4;return rows;};
 await assert.rejects(h.runner.enter('ABCUSDT',first));assert.equal(h.writes.some(w=>w.q.side==='SELL'),false);
});

test('SHORT requires the five entry conditions plus fresh authoritative data and durable order deduplication',()=>{
 const good=shortSignal(input(),config);assert.equal(good.ready,true,good.reason);assert.ok(good.setup.lowTouches>=2&&good.setup.highTouches>=2);assert.ok(good.setup.targetPrice<104);assert.equal(good.conditions.rows.length,5);
 for(const mutate of [i=>i.priceAsOf=now-16000,i=>i.bars.splice(15,1),i=>i.bars.at(-1).high=1,i=>i.liveBar.high=NaN,i=>i.price=105,i=>i.now=end+D,i=>i.entryAfter=end,i=>i.used=[good.setup.patternId],i=>i.bars.at(-1).closed=false,i=>i.liveBar=null]){const i=input();mutate(i);assert.equal(shortSignal(i,config).ready,false);}
 for(const volume of [0,.0001,1,100000]){const i=input();i.liveBar.volume=volume;assert.equal(shortSignal(i,config).ready,true);}
 assert.equal(shortSignal(input(),shortConfig({})).ready,false);assert.equal(shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true'}).enabled,false);
});

test('SHORT uses owner stop/activation/gap with frozen channel target and never loosens earned protection',()=>{
 const p={entryPrice:100,targetPrice:90};let e=shortExit(p,96,settings);assert.equal(e.stopPrice,101);assert.equal(e.armed,false);
 e=shortExit(e,94,settings);assert.equal(e.stopPrice,95);assert.equal(e.armed,true);
 e=shortExit(e,94.5,{...settings,stopLossPct:3,trailingGapPp:3});assert.equal(e.stopPrice,95);
 assert.equal(shortExit(e,95,settings).exit,'TRAILING_STOP');assert.equal(shortExit(p,90,settings).exit,'CHANNEL_TAKE_PROFIT');
 assert.equal(shortExit({...p,targetPrice:99.5},99.5,settings).exit,'CHANNEL_TAKE_PROFIT');
});

test('Binance settings exit ignores the channel target and arms at the configured 8 percent',()=>{
 const s={takeProfitPct:50,stopLossPct:2,profitActivationPct:8,trailingGapPp:2};
 let p={entryPrice:100,targetPrice:99,setup:{entryMode:'CHANNEL',targetPrice:99}};
 p=shortExit(p,98,s,{targetMode:'SETTINGS'});
 assert.equal(p.exit,null);assert.equal(p.targetPrice,50);assert.equal(p.stopPrice,102);assert.equal(p.armed,false);
 p=shortExit(p,92,s,{targetMode:'SETTINGS'});
 assert.equal(p.armed,true);assert.equal(p.stopPrice,94);assert.equal(p.exit,null);
 p=shortExit(p,90,s,{targetMode:'SETTINGS'});assert.equal(p.stopPrice,92);
 assert.equal(shortExit(p,92,s,{targetMode:'SETTINGS'}).exit,'TRAILING_STOP');
 assert.equal(shortExit(p,50,s,{targetMode:'SETTINGS'}).exit,'SETTINGS_TAKE_PROFIT');
 // The Colmex caller does not opt in to the Binance policy.
 assert.equal(shortExit({entryPrice:100,targetPrice:99},99,s).exit,'CHANNEL_TAKE_PROFIT');
});

test('Binance entry uses the actual fill and settings for native TP, including partial fills',async()=>{
 for(const fillFraction of [1,.5]){
  const h=harness({fillFraction});Object.assign(h.ownerSettings,{takeProfitPct:50,stopLossPct:2,profitActivationPct:8,trailingGapPp:2});
  await h.runner.enter('ABCUSDT',shortSignal(input(),config));
  const p=h.runner.state.positions.ABCUSDT;
  assert.equal(p.targetPrice,p.entryPrice*.5);assert.equal(p.exitPolicy,FUTURES_SHORT_EXIT_POLICY);
  assert.equal(h.runner.status().policy.exitPolicy,FUTURES_SHORT_EXIT_POLICY);
  assert.equal(p.algos.find(a=>a.kind==='TAKE_PROFIT_MARKET').price,52);
  h.setQuote({bidPrice:'102',askPrice:'102.01'});await h.runner.manage(await h.runner.snapshot());
  assert.ok(h.runner.state.positions.ABCUSDT);assert.equal(h.writes.filter(x=>x.q.side==='BUY'&&x.p==='/fapi/v1/order').length,0);
 }
});

test('an existing channel SHORT replaces its native target after verification while retaining its earned stop',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 const p=h.runner.state.positions.ABCUSDT,old=p.algos.find(a=>a.kind==='TAKE_PROFIT_MARKET');
 p.targetPrice=103.5;p.setup.targetPrice=103.5;delete p.exitPolicy;
 old.price=103.5;h.algos.get(old.clientAlgoId).triggerPrice='103.5';
 p.lowPrice=90;p.armed=true;p.stopPrice=91;
 const before=h.writes.length;
 Object.assign(h.ownerSettings,{takeProfitPct:50,stopLossPct:2,profitActivationPct:8,trailingGapPp:2});
 h.setQuote({bidPrice:'90',askPrice:'90.01'});
 const restored=new FuturesShortRunner({api:h.api,file:'/unused',config,settings:()=>h.ownerSettings,control:()=>h.control,permission:async()=>({}),now:()=>now,save:()=>{},initialState:h.runner.state});
 await restored.manage(await restored.snapshot());
 const next=restored.state.positions.ABCUSDT;
 assert.equal(next.targetPrice,52);assert.equal(next.stopPrice,91);assert.equal(next.armed,true);
 assert.equal(next.setup.targetPrice,103.5,'preserve entry evidence');
 assert.equal(next.exitPolicy,FUTURES_SHORT_EXIT_POLICY);
 const changes=h.writes.slice(before),created=changes.findIndex(w=>w.q.type==='TAKE_PROFIT_MARKET'),canceled=changes.findIndex(w=>w.q.clientAlgoId===old.clientAlgoId&&!w.q.type);
 assert.ok(created>=0&&canceled>created);assert.equal(h.algos.get(old.clientAlgoId).algoStatus,'CANCELED');
 assert.equal(changes.filter(w=>w.p==='/fapi/v1/order').length,0);
});

test('changing settings updates an existing native TP and records the settings reason on exit',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 h.ownerSettings.takeProfitPct=10;
 await h.runner.manage(await h.runner.snapshot());
 const p=h.runner.state.positions.ABCUSDT;assert.equal(p.targetPrice,93.60000000000001);
 assert.equal(p.algos.find(a=>a.kind==='TAKE_PROFIT_MARKET').price,93.6);
 h.setQuote({bidPrice:'92.99',askPrice:'93'});await h.runner.manage(await h.runner.snapshot());await h.runner.manage(await h.runner.snapshot());
 assert.equal(h.runner.state.closed.at(-1).reason,'SETTINGS_TAKE_PROFIT');
});

test('impossible SHORT take profit is rejected before changing margin or sending an entry',async()=>{
 for(const takeProfitPct of [100,500]){
  assert.throws(()=>validateShortSettings({...settings,takeProfitPct}),/SHORT_TP_BELOW_100_REQUIRED/);
  const h=harness();h.ownerSettings.takeProfitPct=takeProfitPct;
  await assert.rejects(()=>h.runner.enter('ABCUSDT',shortSignal(input(),config)),/SHORT_TP_BELOW_100_REQUIRED/);
  assert.equal(h.writes.length,0);
 }
 assert.equal(validateShortSettings({...settings,takeProfitPct:99.9}).takeProfitPct,99.9);
});
test('sizing reserves fees within a 35 USDT slot and never raises leverage or buys an unsupported contract',()=>{
 const plan=shortOrderPlan(info,input().quote,shortSignal(input(),config).setup);assert.ok(Number(plan.quantity)*104.01<=34);assert.equal(plan.side,'SELL');assert.equal(plan.timeInForce,'IOC');
 assert.throws(()=>shortOrderPlan({...info,contractType:'CURRENT_QUARTER'},input().quote,{}));
 assert.throws(()=>shortOrderPlan({...info,filters:info.filters.map(x=>x.filterType==='MIN_NOTIONAL'?{...x,notional:100}:x)},input().quote,{}));
});
test('dedicated client blocks Spot, transfers, BUY entries, unsafe margin and leverage without any network call',async()=>{
 const api=new FuturesShortAPI({fetchImpl:()=>{throw Error('NETWORK_MUST_NOT_RUN');}});
 for(const [p,q]of [['/api/v3/order',{}],['/fapi/v1/leverage',{leverage:20}],['/fapi/v1/marginType',{marginType:'CROSSED'}],['/fapi/v1/order',{side:'BUY',type:'MARKET',positionSide:'BOTH'}],['/fapi/v1/algoOrder',{side:'SELL'}]])await assert.rejects(api.post(p,q),/FORBIDDEN/);
});
test('full entry installs verified close-only stop and TP; native protection is replaced before the old stop is canceled',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 const p=h.runner.state.positions.ABCUSDT;assert.ok(p.protectedAt);assert.equal(h.writes.filter(x=>x.p.endsWith('/order')).length,1);assert.equal(p.algos.length,2);
 assert.ok(p.algos.every(x=>x.status==='NEW'));assert.ok([...h.algos.values()].every(x=>x.closePosition===true&&x.side==='BUY'));
 h.ownerSettings.stopLossPct=.5;await h.runner.manage(await h.runner.snapshot());
 const stopCreates=h.writes.filter(x=>x.q.type==='STOP_MARKET');assert.equal(stopCreates.length,2);assert.equal(h.algos.get(stopCreates[0].q.clientAlgoId).algoStatus,'CANCELED');
 const newer=h.writes.indexOf(stopCreates[1]),cancel=h.writes.findIndex(x=>!x.q.type&&x.q.clientAlgoId===stopCreates[0].q.clientAlgoId);assert.ok(newer<cancel);
 h.setQuote({bidPrice:'105',askPrice:'105.01'});await h.runner.manage(await h.runner.snapshot());await h.runner.manage(await h.runner.snapshot());
 assert.equal(Object.keys(h.runner.state.positions).length,0);assert.equal(h.writes.at(-3)?.q.side==='SELL',false);assert.ok(h.writes.some(x=>x.q.side==='BUY'&&x.q.reduceOnly==='true'));
});
test('ambiguous entry survives restart, reconciles its original ID and never submits a second SELL',async()=>{
 const h=harness({unknownOnce:true});await assert.rejects(h.runner.enter('ABCUSDT',shortSignal(input(),config)),/UNKNOWN/);assert.ok(h.saved.pending);
 const r=new FuturesShortRunner({api:h.api,file:'/unused',config,settings:()=>settings,control:()=>({allowEntries:false}),permission:async()=>({}),now:()=>now,save:()=>{},initialState:h.saved});
 await r.cycle();assert.equal(h.writes.filter(x=>x.q.side==='SELL').length,1);assert.equal(r.state.pending,null);assert.ok(r.state.positions.ABCUSDT.protectedAt);
});
test('partial IOC fill gets protection for the actual position and can close without increasing it',async()=>{
 const h=harness({fillFraction:.5});await h.runner.enter('ABCUSDT',shortSignal(input(),config));const p=h.runner.state.positions.ABCUSDT;
 assert.equal(p.qty,Number(h.writes[0].q.quantity)*.5);await h.runner.close(p,'TEST');assert.equal(Number(h.writes.find(x=>x.q.side==='BUY'&&x.q.type==='MARKET').q.quantity),p.qty);
});
test('failed protection closes only the owned short and blocks further entries',async()=>{
 const h=harness({rejectProtection:true});await h.runner.enter('ABCUSDT',shortSignal(input(),config));assert.ok(h.runner.state.halt);assert.ok(h.writes.some(x=>x.q.side==='BUY'&&x.q.reduceOnly==='true'));await assert.rejects(h.runner.entryGate());
});
test('newly filled short is closed if the first protection quote fails',async()=>{
 let filled=false;const h=harness({beforePost(p,q){if(p.endsWith('/order')&&q.side==='SELL')filled=true;},onGet(p){if(filled&&p.endsWith('bookTicker'))throw Error('QUOTE_FAILURE');}});
 await h.runner.enter('ABCUSDT',shortSignal(input(),config));assert.ok(h.writes.some(x=>x.q.side==='BUY'&&x.q.reduceOnly==='true'));
});
test('balance, account mode, external positions and unsafe auto margin block entry before SELL',async()=>{
 for(const mutate of [h=>h.a.assets[0].availableBalance='0',h=>h.a.multiAssetsMargin=true,h=>h.a.canTrade=false,h=>h.symbolConfig.isAutoAddMargin=true,h=>h.setPositions([{symbol:'OTHER',positionSide:'BOTH',positionAmt:'-1',entryPrice:'10'}])]){
  const h=harness();mutate(h);await assert.rejects(h.runner.enter('ABCUSDT',shortSignal(input(),config)));assert.equal(h.writes.some(x=>x.q.side==='SELL'),false);
 }
});
test('pause or settings changes after durable intent prevent the final entry write',async()=>{
 for(const change of [(c,s)=>c.allowEntries=false,(c,s)=>s.stopLossPct=2]){
  const h=harness({onSave(s,c,owner){if(s.pending?.kind==='ENTRY')change(c,owner);}});await assert.rejects(h.runner.enter('ABCUSDT',shortSignal(input(),config)),/FINAL_ENTRY_BLOCK/);assert.equal(h.writes.some(x=>x.q.side==='SELL'),false);assert.equal(h.runner.state.pending,null);
 }
});
test('zero-balance and disabled cycles never mutate the exchange; open positions retain exits with entries disabled',async()=>{
 const h=harness({config:shortConfig({})});await h.runner.cycle();assert.equal(h.writes.length,0);
 const k=harness();k.a.assets[0].availableBalance='0';await k.runner.cycle();assert.equal(k.writes.length,0);assert.match(k.runner.status().reason,/ALLOCATION_INSUFFICIENT/);
 const j=harness();await j.runner.enter('ABCUSDT',shortSignal(input(),config));j.control.allowEntries=false;j.setQuote({bidPrice:'106',askPrice:'106.01'});await j.runner.cycle();assert.ok(j.writes.some(x=>x.q.side==='BUY'));
});
test('durable journal is private and survives restart; malformed journals block every write',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'short-journal-'));try{
  const file=path.join(dir,'state.json'),h=harness();atomicFuturesSave(file,h.runner.state);assert.equal(fs.statSync(file).mode&0o777,0o600);
  fs.writeFileSync(file,'bad');const r=new FuturesShortRunner({file,api:h.api,config,settings:()=>settings,control:()=>({allowEntries:true}),permission:async()=>({})});await r.cycle();assert.equal(h.writes.length,0);assert.match(r.status().reason,/UNREADABLE/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('two equal slots enforce capacity while ordinary entry commission does not consume the second slot',async()=>{
 const h=harness({income:[{asset:'USDT',incomeType:'COMMISSION',income:'-0.02'}]});await h.runner.enter('ABCUSDT',shortSignal(input(),config));await h.runner.entryGate();
 h.runner.state.positions.DEFUSDT={...structuredClone(h.runner.state.positions.ABCUSDT),symbol:'DEFUSDT'};await assert.rejects(h.runner.entryGate(),/TWO_SLOTS_FULL/);
 const k=harness();k.a.assets[0].walletBalance='30';k.a.assets[0].availableBalance='30';await k.runner.entryGate();assert.equal(k.runner.allocation().maxOrderUsdt,15);
});
test('empty disabled stop-all leaves Spot-only deployments entirely untouched',async()=>{
 const h=harness({config:shortConfig({}),onGet(){throw Error('UNEXPECTED_FUTURES_CALL');}});assert.deepEqual(await h.runner.closeAll(),{sold:[],failed:[]});assert.equal(h.writes.length,0);
});
test('candidate is configured only to Isolated 1x and price invalidation during the final read prevents entry',async()=>{
 const h=harness();h.symbolConfig.marginType='CROSSED';h.symbolConfig.leverage=20;await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 assert.deepEqual(h.writes.filter(x=>x.p.endsWith('/leverage')).map(x=>x.q.leverage),[1]);assert.deepEqual(h.writes.filter(x=>x.p.endsWith('/marginType')).map(x=>x.q.marginType),['ISOLATED']);
 let histories=0;const k=harness({onGet(p){if(p.endsWith('/klines')&&++histories===2)k.setQuote({bidPrice:'105',askPrice:'105.01'});}});await assert.rejects(k.runner.enter('ABCUSDT',shortSignal(input(),config)));assert.equal(k.writes.some(x=>x.q.side==='SELL'),false);
});
test('unknown protection reply is not retried as another algo, and stop-all reports confirmed closures',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));const p=h.runner.state.positions.ABCUSDT,ref=p.algos[0],before=h.writes.length;
 ref.status='PENDING';await h.runner.ensureAlgo(p,ref.kind,ref.price);assert.equal(h.writes.length,before);
 const result=await h.runner.closeAll();assert.deepEqual(result,{sold:['FUTURES:ABCUSDT'],failed:[]});assert.equal(h.runner.forceClose,false);
});
test('SHORT needs 50 pre-breakout bars and retains its fixed POC across the returning candles',()=>{
 const i=input(),good=shortSignal(i,config);assert.equal(good.ready,true,good.reason);
 assert.equal(good.setup.pocModel.channel.barTimes.length,50);assert.ok(good.setup.pocModel.frozenAt<i.liveBar.openTime);
 const early=structuredClone(i);early.bars=early.bars.slice(-50);assert.equal(shortSignal(early,config).ready,false);
 assert.equal(shortSignal({...i,price:105},config).ready,false);
 assert.equal(shortSignal({...i,now:end+D},config).ready,false);
});

const missingAlgo=()=>Object.assign(Error('FUTURES_API_-2013'),{code:-2013,status:400});
test('delayed Binance visibility verifies the original stop and TP without a duplicate order or emergency close',async()=>{
 const attempts=new Map(),delays=[];
 const h=harness({sleep:async ms=>delays.push(ms),onGet(path,q){
  if(path!=='/fapi/v1/algoOrder')return;
  assert.ok(q.algoId,'use the exchange ID persisted from the acknowledgement');
  const n=(attempts.get(q.algoId)||0)+1;attempts.set(q.algoId,n);
  if(n<4)throw missingAlgo();
 }});
 await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 assert.equal(h.runner.state.halt,null);assert.ok(h.runner.state.positions.ABCUSDT.protectedAt);
 assert.equal(h.writes.filter(x=>x.p==='/fapi/v1/algoOrder'&&x.q.type).length,2);
 assert.equal(h.writes.filter(x=>x.q.type==='MARKET').length,0);
 assert.deepEqual(delays,[150,300,600,150,300,600]);
 assert.ok(h.saved.positions.ABCUSDT.algos.every(x=>Number.isSafeInteger(x.algoId)));
});
test('persistent missing protection remains bounded, closes the owned short and keeps the durable halt',async()=>{
 let reads=0;const delays=[];
 const h=harness({sleep:async ms=>delays.push(ms),onGet(path){if(path==='/fapi/v1/algoOrder'){reads++;throw missingAlgo();}}});
 await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 assert.equal(reads,5);assert.deepEqual(delays,[150,300,600,950]);
 assert.equal(h.writes.filter(x=>x.p==='/fapi/v1/algoOrder').length,1);
 assert.equal(h.writes.filter(x=>x.q.type==='MARKET'&&x.q.reduceOnly==='true').length,1);
 assert.equal(h.saved.halt,'FUTURES_API_-2013');await assert.rejects(h.runner.entryGate(),/-2013/);
});
test('identity mismatch and non-visibility API failures are not retried or accepted as protection',async()=>{
 for(const code of [-2015,-1007]){
  const h=harness({sleep:()=>assert.fail('must not retry'),onGet(path){if(path==='/fapi/v1/algoOrder')throw Object.assign(Error('API_FAILURE'),{code,status:400});}});
  await h.runner.enter('ABCUSDT',shortSignal(input(),config));
  assert.equal(h.runner.state.halt,'API_FAILURE');assert.equal(h.writes.filter(x=>x.q.type==='MARKET').length,1);
 }
 const h=harness();const original=h.api.get;h.api.get=async(path,q)=>{const r=await original(path,q);return path==='/fapi/v1/algoOrder'?{...r,algoId:999999}:r;};
 await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 assert.equal(h.runner.state.halt,'FUTURES_PROTECTION_IDENTITY_MISMATCH');
 assert.equal(h.writes.filter(x=>x.q.type==='MARKET').length,1);
});
test('restart reconciles a pending protection identity without resubmitting it and a release rejects old signals',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 const restored=structuredClone(h.saved);restored.positions.ABCUSDT.algos[0].status='PENDING';
 delete restored.positions.ABCUSDT.algos[0].algoId; // legacy journals have only clientAlgoId
 let calls=0;const original=h.api.get;h.api.get=async(p,q)=>{if(p==='/fapi/v1/algoOrder'&&++calls===1)throw missingAlgo();return original(p,q);};
 const r=new FuturesShortRunner({api:h.api,file:'/unused',config,settings:()=>settings,control:()=>({allowEntries:false}),permission:async()=>({}),now:()=>now,sleep:async()=>{},save:()=>{},initialState:restored});
 const before=h.writes.length;await r.cycle();assert.equal(h.writes.length,before);assert.ok(r.state.positions.ABCUSDT.protectedAt);
 r.state.resumedAt=now;const i=await r.input('ABCUSDT');assert.equal(i.entryAfter,now);assert.equal(shortSignal(i,config).ready,false);
});

test('a low-priced weighted fill installs both protections despite rounded order avgPrice',async()=>{
 const h=harness(),client='lvs-'+'a'.repeat(28),qty=1445,exact=33.945447/qty;
 h.runner.state.pending={kind:'ENTRY',params:{symbol:'ABCUSDT',side:'SELL',newClientOrderId:client,quantity:String(qty)},setup:{targetPrice:.0233447},settings};
 await h.runner.finishOrder({symbol:'ABCUSDT',clientOrderId:client,orderId:7,side:'SELL',positionSide:'BOTH',status:'FILLED',executedQty:String(qty),avgPrice:'0.0234917',cumQuote:'33.9454470'});
 h.setPositions([{symbol:'ABCUSDT',positionSide:'BOTH',positionAmt:String(-qty),entryPrice:'0.0234916588235'}]);
 h.setQuote({bidPrice:'.02349',askPrice:'.023491'});
 h.runner.infos.ABCUSDT={...info,filters:info.filters.map(f=>f.filterType==='PRICE_FILTER'?{...f,tickSize:'.0000001'}:f)};
 await h.runner.manage(await h.runner.snapshot());
 const p=h.runner.state.positions.ABCUSDT;assert.equal(p.entryPrice,exact);assert.equal(h.runner.state.halt,null);assert.ok(p.protectedAt);assert.equal(p.algos.length,2);assert.ok(p.algos.every(a=>a.status==='NEW'));
 const count=h.writes.length;
 h.setPositions([{symbol:'ABCUSDT',positionSide:'BOTH',positionAmt:String(-qty),entryPrice:'.02355'}]);
 await h.runner.manage(await h.runner.snapshot());
 assert.equal(h.runner.state.halt,'FUTURES_POSITION_OWNERSHIP_CHANGED');assert.equal(h.writes.length,count);
});

test('manual POC SHORT bypasses channel signals but uses actual fill settings, reserve, native protection and durable receipt',async()=>{
 const h=harness(),intent={requestId:'poc-short-1234567890123456',symbol:'ABCUSDT',side:'SHORT',quoteUsdt:20,poc:104,expiresAt:now+60000};let checks=0;
 h.runner.input=()=>{throw Error('TECHNICAL_SIGNAL_MUST_NOT_BE_REQUIRED');};
 const result=await h.runner.enterPoc(intent,async()=>{checks++;});
 assert.equal(result.ok,true);assert.ok(checks>=2);
 const p=h.runner.state.positions.ABCUSDT;assert.equal(p.setup.entryMode,'POC');assert.ok(Math.abs(p.targetPrice-52)<1e-9);assert.ok(p.qty*p.entryPrice<=19);assert.ok(p.protectedAt);assert.equal(p.algos.length,2);
 assert.equal((await h.runner.enterPoc(intent,async()=>{})).order.orderId,result.order.orderId);assert.equal(h.writes.filter(x=>x.q.side==='SELL').length,1);
 h.ownerSettings.takeProfitPct=10;await h.runner.manage(await h.runner.snapshot());assert.ok(Math.abs(p.targetPrice-93.6)<1e-9);
});
test('POC SHORT retains ambiguous entry identity and reconciles its receipt without a new SELL',async()=>{
 const h=harness({unknownOnce:true}),intent={requestId:'poc-short-ambiguous123456',symbol:'ABCUSDT',side:'SHORT',quoteUsdt:35,poc:104,expiresAt:now+60000};
 assert.equal((await h.runner.enterPoc(intent,async()=>{})).uncertain,true);const original=h.runner.state.pending.params.newClientOrderId;
 const restarted=new FuturesShortRunner({api:h.api,file:'/unused',config,settings:()=>settings,control:()=>h.control,permission:async()=>({enableFutures:true,ipRestrict:true}),now:()=>now,save:()=>{},initialState:h.saved});
 await restarted.recover();assert.ok(restarted.state.pocResults[intent.requestId].ok);assert.equal(restarted.state.positions.ABCUSDT.entryClientOrderId,original);
 await restarted.enterPoc(intent,async()=>{});assert.equal(h.writes.filter(x=>x.q.side==='SELL').length,1);
});
test('POC SHORT final guard rejects pause/price change after durable intent without an exchange entry',async()=>{
 const h=harness(),intent={requestId:'poc-short-final-12345678',symbol:'ABCUSDT',side:'SHORT',quoteUsdt:35,poc:104,expiresAt:now+60000};let calls=0;
 const result=await h.runner.enterPoc(intent,async()=>{if(++calls===2)throw Error('POC_PRICE_MOVED');});assert.equal(result.ok,false);assert.equal(result.uncertain,false);assert.equal(h.runner.state.pending,null);assert.equal(h.writes.filter(x=>x.q.side==='SELL').length,0);
});
test('POC SHORT preserves the halt, account guards and two slot budget and protects partial fills',async()=>{
 const intent={requestId:'poc-short-gates-12345678',symbol:'ABCUSDT',side:'SHORT',quoteUsdt:35,poc:104,expiresAt:now+60000};
 for(const mutate of [h=>h.runner.state.halt='FUTURES_POSITION_OWNERSHIP_CHANGED',h=>h.a.assets[0].availableBalance='34',h=>h.a.multiAssetsMargin=true,h=>h.control.allowEntries=false,h=>h.ownerSettings.takeProfitPct=100]){
  const h=harness();mutate(h);assert.equal((await h.runner.enterPoc(intent,async()=>{})).ok,false);assert.equal(h.writes.filter(x=>x.q.side==='SELL').length,0);
 }
 const h=harness({fillFraction:.5});assert.equal((await h.runner.enterPoc(intent,async()=>{})).ok,true);assert.ok(h.runner.state.positions.ABCUSDT.protectedAt);assert.ok(h.runner.state.positions.ABCUSDT.qty<.2);
});

test('SHORT enters after the closed reclaim candle without a volume multiplier and rejects stale data or old policy',async()=>{
 const i=input();i.now=end+120000;i.priceAsOf=i.now;i.liveBar.receivedAt=i.now;
 const r=shortSignal(i,config);assert.equal(r.ready,true,r.reason);assert.ok(i.now<r.setup.expiresAt);assert.equal(i.liveBar.volume,0);
 for(const patch of [{volume:undefined},{volume:-1},{closed:true},{receivedAt:i.now-16001},{receivedAt:i.now+1}])assert.equal(shortSignal({...i,liveBar:{...i.liveBar,...patch}},config).ready,false);
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));assert.equal(h.writes.filter(w=>w.q.side==='SELL').length,1);assert.equal(h.saved.version,'FUTURES_CHANNEL_SHORT_V1');
 const old=harness();await assert.rejects(old.runner.enter('ABCUSDT',{...r,setup:{...r.setup,entryPolicyVersion:undefined}}),/POC_MODEL_CHANGED/);assert.equal(old.writes.filter(w=>w.q.side==='SELL').length,0);
});


test('a transient stale quote recovers only after fresh management and both protections, without a duplicate entry',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 h.setQuote({time:now-11000});await h.runner.manage(await h.runner.snapshot());
 assert.equal(h.runner.state.halt,'FUTURES_QUOTE_STALE');
 const before=h.writes.length;h.control.allowEntries=false;
 await h.runner.cycle();assert.equal(h.runner.state.halt,'FUTURES_QUOTE_STALE');
 h.setQuote({time:now});await h.runner.cycle();
 assert.equal(h.runner.state.halt,null);assert.equal(h.runner.state.resumedAt,now);
 assert.equal(h.runner.state.haltReleases.at(-1).reason,'FRESH_QUOTES_AND_PROTECTIONS_REVERIFIED');
 assert.equal(h.writes.length,before);assert.equal(h.runner.state.positions.ABCUSDT.algos.length,2);
});
test('quote recovery never clears a permanent halt or launders it through a later stale quote',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 h.runner.state.halt='FUTURES_PROTECTION_IDENTITY_MISMATCH';h.setQuote({time:now-11000});
 await h.runner.cycle();assert.equal(h.runner.state.halt,'FUTURES_PROTECTION_IDENTITY_MISMATCH');
 h.setQuote({time:now});await h.runner.cycle();assert.equal(h.runner.state.halt,'FUTURES_PROTECTION_IDENTITY_MISMATCH');
});
test('quote halt recovery rejects pending operations, unverified protection, stale prices and empty journals',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 h.runner.state.halt='FUTURES_QUOTE_STALE';const original=structuredClone(h.runner.state),account=await h.runner.snapshot();
 for(const mutate of [r=>r.state.pending={},r=>r.error='FAIL',r=>r.forceClose=true,r=>r.state.positions.ABCUSDT.protectedAt=now-1,r=>r.state.positions.ABCUSDT.priceAt=now-11000,r=>r.state.positions.ABCUSDT.algos.pop(),r=>r.state.positions={}]){
  h.runner.state=structuredClone(original);h.runner.error=null;h.runner.forceClose=false;mutate(h.runner);
  h.runner.recoverFreshQuoteHalt(account,now);assert.equal(h.runner.state.halt,'FUTURES_QUOTE_STALE');
 }
});

const manual=(side='OPEN_SHORT',requestId='manual-request-000001')=>({requestId,symbol:'ABCUSDT',side,mode:'live',quoteUsdt:20,all:side==='CLOSE_SHORT'});
test('manual Futures open and close use isolated short lane and durable idempotency',async()=>{
 const h=harness(),i=manual();const r=await h.runner.manualTrade(i);assert.equal(r.ok,true);
 assert.equal(h.runner.state.positions.ABCUSDT.setup.entryMode,'MANUAL');
 const before=h.writes.length;assert.deepEqual(await h.runner.manualTrade(i),r);assert.equal(h.writes.length,before);
 await assert.rejects(()=>h.runner.manualTrade({...i,symbol:'XYZUSDT'}),/CONFLICT/);
 const c=manual('CLOSE_SHORT','manual-request-close1');const close=await h.runner.manualTrade(c);assert.equal(close.ok,true);
 const exit=h.writes.filter(x=>x.p==='/fapi/v1/order').at(-1);assert.equal(exit.q.side,'BUY');assert.equal(exit.q.reduceOnly,'true');assert.equal(h.runner.state.positions.ABCUSDT,undefined);
 const n=h.writes.length;assert.deepEqual(await h.runner.manualTrade(c),close);assert.equal(h.writes.length,n);
});
test('uncertain manual Futures result is reconciled without a second entry and status never submits',async()=>{
 const h=harness({unknownOnce:true}),i=manual();assert.equal((await h.runner.manualTrade(i)).uncertain,true);
 const n=h.writes.length;assert.equal((await h.runner.manualTrade(i)).uncertain,true);assert.equal(h.writes.length,n);
 await h.runner.recover();assert.equal((await h.runner.manualTrade({...i,statusOnly:true})).ok,true);assert.equal(h.writes.length,n);
 assert.equal((await h.runner.manualTrade({...i,requestId:'unknown-request-0001',statusOnly:true})).uncertain,true);assert.equal(h.writes.length,n);
});
test('manual Futures entry retains halt, budget, reservation and permission guards; close requires owned position',async()=>{
 for(const modify of [h=>h.runner.state.halt='REVIEW',h=>h.runner.reserved=()=>true,h=>h.control.allowEntries=false]){
  const h=harness();modify(h);assert.equal((await h.runner.manualTrade(manual())).ok,false);assert.equal(h.writes.filter(x=>x.p==='/fapi/v1/order').length,0);
 }
 const h=harness();assert.equal((await h.runner.manualTrade({...manual(),quoteUsdt:36})).error,'FUTURES_AMOUNT_EXCEEDS_ALLOCATION');
 assert.equal((await h.runner.manualTrade(manual('CLOSE_SHORT','manual-close-missing1'))).ok,false);assert.equal(h.writes.length,0);
});


test('dynamic slots follow wallet deposits, realized losses and free margin, never unrealized gains',()=>{
 for(const [wallet,free,count,expected] of [[200,200,0,100],[84.27,84.27,0,42.13],[30,30,0,15],[200,40,1,40],[200,200,2,0],[200,0,0,0]]){
  assert.equal(shortAllocation({walletUsdt:wallet,availableUsdt:free,unrealizedUsdt:1000},count).maxOrderUsdt,expected);
 }
 for(const bad of [null,{}, {walletUsdt:NaN,availableUsdt:100},{walletUsdt:100,availableUsdt:-1}])assert.equal(shortAllocation(bad).maxOrderUsdt,0);
});
test('manual and automatic entries above 35 use dynamic budget, reserve, actual fill and native protections',async()=>{
 for(const mode of ['manual','auto']){
  const h=harness();h.a.assets[0].walletBalance='200';h.a.assets[0].availableBalance='200';
  if(mode==='manual')assert.equal((await h.runner.manualTrade({...manual(),quoteUsdt:100})).ok,true);
  else await h.runner.enter('ABCUSDT',shortSignal(input(),config));
  const p=h.runner.state.positions.ABCUSDT;
  assert.ok(p.qty*p.entryPrice>35&&p.qty*p.entryPrice<100);assert.equal(p.slotBudgetUsdt,100);
  assert.equal(p.closeReason,undefined);assert.equal(p.algos.filter(x=>x.status==='NEW').length,2);
 }
});
test('balance shrink at final dispatch prevents SELL and clears pending intent',async()=>{
 const options={},h=harness(options);h.a.assets[0].walletBalance='200';h.a.assets[0].availableBalance='200';
 options.onSave=s=>{if(s.pending?.kind==='ENTRY')h.a.assets[0].walletBalance='60';};
 const r=await h.runner.manualTrade({...manual(),quoteUsdt:100});
 assert.equal(r.error,'FUTURES_AMOUNT_EXCEEDS_ALLOCATION');assert.equal(h.runner.state.pending,null);
 assert.equal(h.writes.filter(x=>x.p==='/fapi/v1/order').length,0);
});
test('dynamic sizing never increases allocation to meet exchange minimum',()=>{
 const btc={...info,filters:info.filters.map(f=>f.filterType==='MIN_NOTIONAL'?{...f,notional:'100'}:f)};
 assert.throws(()=>shortOrderPlan(btc,input().quote,{targetPrice:90},42),/MIN_NOTIONAL/);
});
test('cancel -2011 accepts only identity-verified terminal orders, without a second cancel',async()=>{
 for(const status of ['CANCELED','FINISHED','EXPIRED','NEW','TRIGGERING','BAD_ID','MISSING']){
  const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));
  const p=h.runner.state.positions.ABCUSDT,ref=p.algos[0];let cancels=0;
  h.api.del=async()=>{cancels++;const o=h.algos.get(ref.clientAlgoId);o.algoStatus=status;if(status==='BAD_ID')o.symbol='OTHERUSDT';if(status==='MISSING')h.algos.delete(ref.clientAlgoId);throw Object.assign(Error('FUTURES_API_-2011'),{code:-2011,status:400});};
  if(['CANCELED','FINISHED','EXPIRED'].includes(status))await h.runner.cancelAlgo(p,ref);
  else await assert.rejects(()=>h.runner.cancelAlgo(p,ref));
  assert.equal(cancels,1);
 }
});
test('persisted -2011 halt clears only after fresh empty exchange reconciliation and never writes a trade',async()=>{
 for(const fault of ['none','externalPosition','externalOrder','externalAlgo','unknown','pending','otherHalt']){
  const h=harness();h.runner.state.halt=fault==='otherHalt'?'REVIEW':'FUTURES_API_-2011';
  if(fault==='pending')h.runner.state.pending={kind:'ENTRY'};
  if(fault==='externalPosition')h.setPositions([{symbol:'ABCUSDT',positionSide:'BOTH',positionAmt:'-1',entryPrice:'100'}]);
  const get=h.api.get;h.api.get=async(p,q)=>{if(fault==='unknown'&&p==='/fapi/v1/openOrders')throw Error('NETWORK');if(fault==='externalOrder'&&p==='/fapi/v1/openOrders')return [{symbol:'ABCUSDT'}];if(fault==='externalAlgo'&&p==='/fapi/v1/openAlgoOrders')return [{symbol:'ABCUSDT',clientAlgoId:'external'}];return get(p,q);};
  try{await h.runner.recoverProtectionConflictHalt(now);}catch{}
  assert.equal(h.runner.state.halt===null,fault==='none');assert.equal(h.writes.length,0);
  if(fault==='none')assert.equal(h.runner.state.resumedAt,now);
 }
});
