import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {shortConfig,shortSignal,shortExit,shortOrderPlan} from '../lib/futures-short-policy.mjs';
import {FuturesShortAPI} from '../lib/futures-short-api.mjs';
import {FuturesShortRunner,atomicFuturesSave} from '../lib/futures-short-runner.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
const D=300000,end=Date.parse('2026-11-01T10:00Z'),now=end+1000;
const config=shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:new Date(end-D).toISOString()});
const settings=validateTradeSettings({});
function input(){
 const bars=Array.from({length:205},(_,i)=>{const t=end-(205-i)*D,p=210-(100+i*.02+Math.cos(i*Math.PI/5));return {openTime:t,closeTime:t+D,open:p,close:p,high:p+.1,low:p-.1,volume:1000,closed:true};});
 Object.assign(bars.at(-1),{open:105,close:104,high:105.1,low:103.8,volume:2000});
 return {bars,price:104,priceAsOf:now,now,liveBar:{openTime:end,high:104.1,low:103.9},quote:{symbol:'ABCUSDT',bidPrice:'104',askPrice:'104.01',time:now}};
}
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
  if(p==='/fapi/v1/exchangeInfo')return {symbols:[info]};
  if(p==='/fapi/v1/ticker/24hr')return [{symbol:'ABCUSDT',quoteVolume:'10000000'}];
  if(p==='/fapi/v1/klines')return [...input().bars,{...input().liveBar,closeTime:end+D,open:104,close:104,volume:20}].map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.closeTime-1]);
  if(p==='/fapi/v1/algoOrder'){const o=algos.get(q.clientAlgoId);if(!o)throw Error('ALGO_UNKNOWN');return structuredClone(o);}
  if(p==='/fapi/v1/order'){const o=orders.get(q.origClientOrderId);if(!o)throw Error('ORDER_UNKNOWN');return structuredClone(o);}
  throw Error('Unexpected read '+p);
 },async post(p,q){
  writes.push({p,q:structuredClone(q)});
  if(options.beforePost)await options.beforePost(p,q);
  if(p==='/fapi/v1/order'){
   const qty=q.side==='SELL'?Number(q.quantity)*(options.fillFraction??1):Number(q.quantity);
   const o={...q,clientOrderId:q.newClientOrderId,orderId:orders.size+1,status:options.fillFraction?'EXPIRED':'FILLED',executedQty:String(qty),avgPrice:'104'};orders.set(q.newClientOrderId,o);
   if(q.side==='SELL')positions.push({symbol:q.symbol,positionSide:'BOTH',positionAmt:String(-qty),entryPrice:'104'});else positions=positions.filter(x=>x.symbol!==q.symbol);
   if(options.unknownOnce){options.unknownOnce=false;throw Error('FUTURES_NETWORK_OUTCOME_UNKNOWN');}
   return o;
  }
  if(p==='/fapi/v1/algoOrder'){
   if(options.rejectProtection){const e=Error('PROTECTION_REJECTED');e.status=400;e.code=-2021;throw e;}
   const o={...q,orderType:q.type,algoStatus:'NEW',closePosition:true};algos.set(q.clientAlgoId,o);return o;
  }
  if(p==='/fapi/v1/marginType'){symbolConfig.marginType=q.marginType;return {};}
  if(p==='/fapi/v1/leverage'){symbolConfig.leverage=q.leverage;return {};}
  throw Error('Unexpected mutation '+p);
 },async del(p,q){writes.push({p,q});algos.get(q.clientAlgoId).algoStatus='CANCELED';return {};}};
 const runner=new FuturesShortRunner({api,file:'/unused',config:options.config||config,settings:()=>ownerSettings,control:()=>control,permission:async()=>({enableFutures:true,ipRestrict:true}),now:()=>now,save:(_,s)=>{saved=structuredClone(s);options.onSave?.(s,control,ownerSettings);}});
 runner.infos.ABCUSDT=info;runner.marketAt=now;
 return {runner,api,writes,algos,orders,a,symbolConfig,control,ownerSettings,setQuote:q=>quote={...quote,...q},setPositions:p=>positions=p,get saved(){return saved;}};
}
test('SHORT requires a fresh confirmed lower break, falling regression and volume; replay and invalidation are rejected',()=>{
 const good=shortSignal(input(),config);assert.equal(good.ready,true,good.reason);assert.ok(good.setup.lowTouches>=2&&good.setup.highTouches>=2);assert.ok(good.setup.targetPrice<104);assert.ok(good.setup.regressionSlope<0);
 for(const mutate of [i=>i.priceAsOf=now-11000,i=>i.bars.splice(150,1),i=>i.bars.at(-1).high=1,i=>i.bars.at(-1).volume=1000,i=>i.liveBar.high=NaN,i=>i.price=110,i=>i.price=1,i=>i.now=end+D,i=>i.entryAfter=end,i=>i.used=[good.setup.patternId],i=>i.bars.at(-1).closed=false,i=>i.liveBar=null]){const i=input();mutate(i);assert.equal(shortSignal(i,config).ready,false);}
 assert.equal(shortSignal(input(),shortConfig({})).ready,false);
 assert.equal(shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true'}).enabled,false);
});
test('SHORT uses owner stop/activation/gap with frozen channel target and never loosens earned protection',()=>{
 const p={entryPrice:100,targetPrice:90};let e=shortExit(p,96,settings);assert.equal(e.stopPrice,101);assert.equal(e.armed,false);
 e=shortExit(e,94,settings);assert.equal(e.stopPrice,95);assert.equal(e.armed,true);
 e=shortExit(e,94.5,{...settings,stopLossPct:3,trailingGapPp:3});assert.equal(e.stopPrice,95);
 assert.equal(shortExit(e,95,settings).exit,'TRAILING_STOP');assert.equal(shortExit(p,90,settings).exit,'CHANNEL_TAKE_PROFIT');
 assert.equal(shortExit({...p,targetPrice:99.5},99.5,settings).exit,'CHANNEL_TAKE_PROFIT');
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
 h.setQuote({bidPrice:'102',askPrice:'102.01'});await h.runner.manage(await h.runner.snapshot());await h.runner.manage(await h.runner.snapshot());
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
 const k=harness();k.a.assets[0].availableBalance='0';await k.runner.cycle();assert.equal(k.writes.length,0);assert.match(k.runner.status().reason,/35_USDT/);
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
 const k=harness({income:[{asset:'USDT',incomeType:'REALIZED_PNL',income:'-40'}]});await assert.rejects(k.runner.entryGate(),/BUDGET_INSUFFICIENT/);
});
test('empty disabled stop-all leaves Spot-only deployments entirely untouched',async()=>{
 const h=harness({config:shortConfig({}),onGet(){throw Error('UNEXPECTED_FUTURES_CALL');}});assert.deepEqual(await h.runner.closeAll(),{sold:[],failed:[]});assert.equal(h.writes.length,0);
});
test('candidate is configured only to Isolated 1x and price invalidation during the final read prevents entry',async()=>{
 const h=harness();h.symbolConfig.marginType='CROSSED';h.symbolConfig.leverage=20;await h.runner.enter('ABCUSDT',shortSignal(input(),config));
 assert.deepEqual(h.writes.filter(x=>x.p.endsWith('/leverage')).map(x=>x.q.leverage),[1]);assert.deepEqual(h.writes.filter(x=>x.p.endsWith('/marginType')).map(x=>x.q.marginType),['ISOLATED']);
 let histories=0;const k=harness({onGet(p){if(p.endsWith('/klines')&&++histories===2)k.setQuote({bidPrice:'110',askPrice:'110.01'});}});await assert.rejects(k.runner.enter('ABCUSDT',shortSignal(input(),config)));assert.equal(k.writes.some(x=>x.q.side==='SELL'),false);
});
test('unknown protection reply is not retried as another algo, and stop-all reports confirmed closures',async()=>{
 const h=harness();await h.runner.enter('ABCUSDT',shortSignal(input(),config));const p=h.runner.state.positions.ABCUSDT,ref=p.algos[0],before=h.writes.length;
 ref.status='PENDING';await h.runner.ensureAlgo(p,ref.kind,ref.price);assert.equal(h.writes.length,before);
 const result=await h.runner.closeAll();assert.deepEqual(result,{sold:['FUTURES:ABCUSDT'],failed:[]});assert.equal(h.runner.forceClose,false);
});
test('targeted installer patches are idempotent and reject an unknown context without partial writes',async()=>{
 const {patchFutures}=await import('../scripts/patch-futures-short.mjs');
 const patches=JSON.parse(fs.readFileSync(new URL('../scripts/futures-short-patches.json',import.meta.url),'utf8'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'short-patch-'));
 try{
  for(const file of ['server.mjs','binance-agent.js']){
   let source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
   for(const p of patches.filter(x=>x.file===file).reverse())source=source.replace(p.after,p.before);
   fs.writeFileSync(path.join(dir,file),source);
  }
  patchFutures(dir,patches);const once=fs.readFileSync(path.join(dir,'server.mjs'),'utf8');patchFutures(dir,patches);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),once);
  const bad=patches.map(p=>({...p}));bad.push({file:'server.mjs',before:'nonexistent context',after:'unrecognized result'});assert.throws(()=>patchFutures(dir,bad),/Unrecognized/);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),once);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('50 pre-breakout SHORT bars suffice; recovered upper wick passes but current ceiling and expiry block',()=>{
 const i=input();i.bars=i.bars.slice(-51);i.liveBar.high=110;
 const r=shortSignal(i,config);assert.equal(config.period,50);assert.equal(r.ready,true,r.reason);
 assert.deepEqual(r.setup,shortSignal({...i,bars:input().bars},config).setup);
 const ceiling=Math.min(r.setup.level,r.setup.liveLevel,r.setup.regressionCenter);
 for(const price of [ceiling,ceiling+.01])assert.equal(shortSignal({...i,price},config).reason,'SHORT_PRICE_INVALIDATED');
 assert.equal(shortSignal({...i,bars:i.bars.slice(1)},config).reason,'WAIT_FUTURES_HISTORY');
 assert.equal(shortSignal({...i,now:end+D,priceAsOf:end+D},config).reason,'SHORT_SIGNAL_EXPIRED');
});
