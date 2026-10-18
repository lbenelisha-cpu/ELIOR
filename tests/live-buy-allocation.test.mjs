import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {liveNextBuyAllocation} from '../lib/live-buy-allocation.mjs';
const wallet=(count,cash=23.81606844)=>({usdtFree:cash,fixedPositionUsdt:28.72583,balances:Array.from({length:count},(_,i)=>({asset:'COIN'+i,valueUsdt:28}))});
test('the last free slot uses the available remainder with a fee reserve',()=>{
 const p=liveNextBuyAllocation(wallet(4));assert.equal(p.ok,true);assert.equal(p.lastSlot,true);assert.ok(Math.abs(p.amountUsdt-23.76853137)<1e-7);assert.ok(p.requiredUsdt<=p.availableUsdt);assert.ok(p.availableUsdt-p.amountUsdt<.05);
});
test('earlier slots stay equal and never shrink to use insufficient cash',()=>{
 assert.equal(liveNextBuyAllocation(wallet(3,100)).amountUsdt,28.72583);assert.equal(liveNextBuyAllocation(wallet(3)).code,'NO_CASH');
 assert.equal(liveNextBuyAllocation(wallet(4,60)).amountUsdt,Math.floor(60/1.002*1e8)/1e8);
});
test('minimum order, full portfolio, missing allocation and the configured live cap remain enforced',()=>{
 assert.equal(liveNextBuyAllocation(wallet(4,4)).code,'BELOW_MINIMUM');assert.equal(liveNextBuyAllocation(wallet(4),{minimumUsdt:30}).code,'BELOW_MINIMUM');
 assert.equal(liveNextBuyAllocation(wallet(5,100)).code,'NO_SLOT');assert.equal(liveNextBuyAllocation({...wallet(4),fixedPositionUsdt:null}).code,'WAIT_ALLOCATION');
 assert.equal(liveNextBuyAllocation(wallet(4,1000)).code,'LIVE_ORDER_LIMIT');
});
test('cash assets and sold dust do not turn the fourth slot into the last slot',()=>{
 const a=wallet(3,100);a.balances.push({asset:'USDT',valueUsdt:100},{asset:'USDC',valueUsdt:50},{asset:'SOL',valueUsdt:.08});assert.equal(liveNextBuyAllocation(a).lastSlot,false);
});
test('the actual submission recalculates the last-slot amount using the fresh funding snapshot',async()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');const start=source.indexOf('async function placeLiveMarketBuy('),end=source.indexOf('async function placeLiveMarketSell(',start);
 let sent;const context=vm.createContext({assessQualityEntry:()=>({ok:true}),candles:async()=>[],ENTRY_POLICY_VERSION:'test',liveNextBuyAllocation,LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,
  getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true,withdrawalsEnabled:false}),
  symbolExchangeInfo:async()=>({status:'TRADING',quoteAsset:'USDT',quoteAssetPrecision:8,filters:[{filterType:'MIN_NOTIONAL',minNotional:'5'}]}),
  getLiveAccountSnapshot:async()=>wallet(4),recordLiveFill(){},liveOrders:{submit:async p=>{sent=p;}}});
 vm.runInContext(source.slice(start,end),context);await context.placeLiveMarketBuy('SUIUSDT',28.72583);
 assert.ok(Number(sent.quoteOrderQty)<24);assert.ok(Number(sent.quoteOrderQty)*1.002<=23.81606844);assert.equal(sent.side,'BUY');
});
