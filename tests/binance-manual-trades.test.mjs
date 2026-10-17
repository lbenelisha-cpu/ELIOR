import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {manualTradeInput,manualBuyAmount,manualSellQuantity,manualPosition,ManualTradeRequests} from '../lib/binance-manual-trades.mjs';
import {liveFillAction,trackedLivePositions} from '../lib/wyckoff-live-positions.mjs';import {binancePositionExit} from '../lib/binance-position-exit.mjs';
const info={symbol:'UNIUSDT',status:'TRADING',quoteAsset:'USDT',quoteAssetPrecision:8,baseAssetPrecision:8,filters:[{filterType:'LOT_SIZE',stepSize:'.001',minQty:'.001',maxQty:'900'},{filterType:'MARKET_LOT_SIZE',stepSize:'.002',minQty:'.002',maxQty:'900'},{filterType:'MIN_NOTIONAL',minNotional:'5',applyToMarket:true}]},account={usdtFree:100,fixedPositionUsdt:28,balances:[]};
const request={requestId:'request1234567890',side:'BUY',symbol:'UNIUSDT',quoteUsdt:10,mode:'live'};
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
function store(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'levi-manual-'));return new ManualTradeRequests(path.join(dir,'requests.json'));}
test('validates explicit LIVE intent and sell-all acknowledgement',()=>{
 assert.equal(manualTradeInput(request).quoteUsdt,10);for(const patch of [{mode:'demo'},{quoteUsdt:NaN},{quoteUsdt:true},{quoteUsdt:''},{symbol:'USDT'},{requestId:'short'}])assert.throws(()=>manualTradeInput({...request,...patch}));assert.throws(()=>manualTradeInput({...request,side:'SELL'}));assert.equal(manualTradeInput({...request,side:'SELL',all:true}).all,true);
});
test('manual buy respects exact user amount rather than fixed allocation; funding, cap and slots remain enforced',()=>{
 assert.equal(manualBuyAmount(10,account,info),10);for(const amount of [0,4,Infinity,401,100])assert.throws(()=>manualBuyAmount(amount,account,info));assert.throws(()=>manualBuyAmount(10,{...account,balances:[{asset:'UNI',valueUsdt:8}]},info));assert.throws(()=>manualBuyAmount(10,{...account,balances:Array.from({length:5},(_,i)=>({asset:'COIN'+i,valueUsdt:10}))},info));
});
test('manual sell floors the whole free wallet balance to all market lot steps, not tracked quantity',()=>{
 assert.equal(Number(manualSellQuantity({free:1.23999999999,usdtPrice:10},info)),1.238);assert.equal(Number(manualSellQuantity({free:1.24,locked:10,usdtPrice:10},info)),1.24);assert.throws(()=>manualSellQuantity({free:0,usdtPrice:10},info));assert.throws(()=>manualSellQuantity({free:.1,usdtPrice:10},info));assert.throws(()=>manualSellQuantity({free:1000,usdtPrice:10},info));
 const tiny={...info,filters:[{filterType:'LOT_SIZE',stepSize:'0.00000001'}]};assert.equal(Number(manualSellQuantity({free:1.1e-7,usdtPrice:1e8},tiny)),1.1e-7);
});
test('actual manual submission sends the chosen amount and records automatic exit metadata without invented Wyckoff pivots',async()=>{
 let sent,meta;const ctx=vm.createContext({manualBuyAmount,manualPosition,requireLivePrice:()=>10,streams:{UNIUSDT:{}},LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),symbolExchangeInfo:async()=>info,getLiveAccountSnapshot:async()=>account,recordLiveFill(){},liveOrders:{submit:async(p,m)=>{sent=p;meta=m;return {status:'FILLED'};}}});
 vm.runInContext(source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell(')),ctx);await ctx.placeLiveMarketBuy('UNIUSDT',10,'MANUAL_BUY',{manualRequestId:'test'});assert.equal(Number(sent.quoteOrderQty),10);assert.equal(meta.meta.wyckoffTrade.entryMode,'manual');assert.equal(meta.meta.wyckoffTrade.minProfitHoldMs,604800000);assert.equal(meta.meta.wyckoffTrade.setup,undefined);assert.equal(meta.meta.manualRequestId,'test');
});
test('actual manual sell includes wallet holdings outside the bot; automatic sell stays limited to tracked quantity',async()=>{
 let sent;const ctx=vm.createContext({manualSellQuantity,getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),getLiveAccountSnapshot:async()=>({balances:[{asset:'UNI',free:1.24,qty:2,usdtPrice:10}]}),symbolExchangeInfo:async()=>info,tradingPositions:()=>({UNIUSDT:{qty:.9}}),floorToStep:(v,s)=>Math.floor(v/s)*s,recordLiveFill(){},liveOrders:{submit:async p=>{sent=p;}}});
 vm.runInContext(source.slice(source.indexOf('async function placeLiveMarketSell('),source.indexOf('function persistLivePeak(')),ctx);await ctx.placeLiveMarketSell('UNIUSDT','MANUAL_SELL',{sellAllBalance:true});assert.equal(Number(sent.quantity),1.24);await ctx.placeLiveMarketSell('UNIUSDT','AUTO');assert.equal(Number(sent.quantity),.9);
});
test('completed manual requests survive restart and same identity cannot submit twice or change amount',async()=>{
 const requests=store();let count=0;const options={submit:async()=>{count++;return {status:'FILLED',orderId:1};},reconcile:async()=>null,isUncertain:()=>false};const input=manualTradeInput(request);assert.equal((await requests.execute(input,options)).ok,true);assert.equal((await new ManualTradeRequests(requests.file).execute(input,options)).duplicate,true);assert.equal(count,1);await assert.rejects(()=>requests.execute({...input,quoteUsdt:11},options),/פעולה אחרת/);
});
test('ambiguous exchange result is reconciled by the same identity and never reposted',async()=>{
 const requests=store(),input=manualTradeInput(request);let posts=0;const options={submit:async()=>{posts++;throw Error('timeout');},reconcile:async()=>null,isUncertain:()=>true};assert.equal((await requests.execute(input,options)).uncertain,true);assert.equal((await new ManualTradeRequests(requests.file).execute(input,options)).uncertain,true);assert.equal(posts,1);const recovered=await requests.execute(input,{...options,reconcile:async()=>({ok:true,order:{orderId:99,status:'FILLED'}})});assert.equal(recovered.order.orderId,99);assert.equal(posts,1);
});
test('manual fill is tracked, protected by current stop and cleared by the full sale',()=>{
 const now=Date.now(),buy=liveFillAction({executedQty:'1',cummulativeQuoteQty:'100',status:'FILLED',orderId:1,transactTime:now},{params:{symbol:'UNIUSDT',side:'BUY'},meta:{wyckoffTrade:manualPosition()},at:new Date(now).toISOString(),reason:'MANUAL_BUY'},[]);const p=trackedLivePositions([buy]).UNIUSDT;assert.equal(p.entryPrice,100);assert.equal(binancePositionExit(p,89,now+1000).sell,true);assert.equal(p.setup,undefined);assert.deepEqual(trackedLivePositions([{symbol:'UNIUSDT',type:'SELL',qty:1,price:105},buy]),{});
});
test('manual route remains inside authenticated live controls and execution takes the automatic order lock',async()=>{
 assert.match(source,/u\.pathname\.startsWith\('\/api\/binance-live\/'\)/);let called=0;const ctx=vm.createContext({manualTradeInput,mode:'demo',liveExecutionInFlight:false,manualRequests:{execute:async()=>{called++;}}});vm.runInContext(source.slice(source.indexOf('async function executeManualTrade('),source.indexOf('async function executeLiveCycle(')),ctx);await assert.rejects(()=>ctx.executeManualTrade(request),/DEMO/);ctx.mode='live';ctx.liveExecutionInFlight=true;await assert.rejects(()=>ctx.executeManualTrade(request),/אחרת/);assert.equal(called,0);
});
test('status-only checks with no recorded request can never become new trades',async()=>{
 const requests=store();let posts=0;const result=await requests.execute({...manualTradeInput(request),statusOnly:true},{submit:async()=>{posts++;},reconcile:async()=>null,isUncertain:()=>false});assert.equal(posts,0);assert.equal(result.uncertain,true);assert.equal(Object.keys(requests.rows).length,0);
});
