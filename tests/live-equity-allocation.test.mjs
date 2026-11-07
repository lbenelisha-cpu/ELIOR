import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {liveNextBuyAllocation,liveEquityAllocation,LIVE_EQUITY_ALLOCATION} from '../lib/live-buy-allocation.mjs';
import {sizeRisk} from '../lib/confirmed-risk-sizing.mjs';
import {BINANCE_CONFIRMED_POLICY,BINANCE_STOP_POLICY} from '../lib/confirmed-entry-quality.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
import {withLiveSafety} from './helpers/live-safety.mjs';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const wallet=(count=2,total=300,cash=270)=>({totalValueUsdt:total,usdtFree:cash,fixedPositionUsdt:28.72583,allocationMode:LIVE_EQUITY_ALLOCATION,balances:Array.from({length:count},(_,i)=>({asset:'COIN'+i,valueUsdt:15}))});
const input={version:BINANCE_CONFIRMED_POLICY.version,stopLossPolicy:BINANCE_STOP_POLICY,source:'CHANNEL_POC_RETEST_V1',allocationMode:LIVE_EQUITY_ALLOCATION};
const settings=validateTradeSettings({stopLossPct:2,takeProfitPct:50,profitActivationPct:8,trailingGapPp:2});
test('every slot uses one fifth of current equity with fees reserved, including the last slot',()=>{
 for(let i=0;i<5;i++){
  const account=wallet(i),before=structuredClone(account),plan=liveNextBuyAllocation(account);
  assert.equal(plan.ok,true);assert.equal(plan.amountUsdt,59.88023952);
  assert.equal(plan.grossSlotUsdt,60);assert.ok(plan.requiredUsdt<=60);assert.deepEqual(account,before);
 }
 assert.equal(liveNextBuyAllocation(wallet(4,400,300)).amountUsdt,79.84031936);
 assert.equal(liveNextBuyAllocation(wallet(0,100,100)).amountUsdt,19.96007984);
});
test('missing current equity, insufficient cash, all slots used and configured order limits cannot silently shrink an entry',()=>{
 for(const total of [null,undefined,NaN,Infinity,0,-1])assert.equal(liveNextBuyAllocation({...wallet(),totalValueUsdt:total}).code,'WAIT_ALLOCATION');
 assert.equal(liveNextBuyAllocation(wallet(4,300,59)).code,'NO_CASH');
 assert.equal(liveNextBuyAllocation(wallet(5)).code,'NO_SLOT');
 assert.equal(liveNextBuyAllocation(wallet(),{maxOrderUsdt:30}).code,'LIVE_ORDER_LIMIT');
 assert.equal(liveNextBuyAllocation(wallet(0,20,20)).code,'BELOW_MINIMUM');
 assert.equal(liveNextBuyAllocation(wallet(),{maxPositions:4}).code,'WAIT_ALLOCATION');
});
test('the configured stop does not halve equal-equity sizing; the absolute risk limit blocks instead of resizing',()=>{
 for(const stopLossPct of [1,2,4]){
  const p=sizeRisk(100,59.88023952,{...settings,stopLossPct},input);
  assert.equal(p.reason,'READY');assert.equal(p.budget,59.88023952);assert.equal(p.settings.stopLossPct,stopLossPct);
  assert.equal(p.riskPlan.riskBudgetUsd,p.budget*stopLossPct/100);
 }
 assert.equal(sizeRisk(100,400,{...settings,stopLossPct:4},input).reason,'POSITION_RISK_LIMIT');
 const legacy={...input};delete legacy.allocationMode;
 assert.equal(sizeRisk(100,60,settings,legacy).budget,30);
 assert.equal(sizeRisk(100,60,settings,{...input,version:'COLMEX_CONFIRMED_QUALITY_V2'}).budget,30);
});
test('fresh account equity drives allocation without modifying the old allocation journal or claiming unknown fees are valued',async()=>{
 let cash=270;
 const actions=[{type:'BUY',symbol:'ABCUSDT',qty:1,amountUsdt:30,commissions:[{asset:'BNB',amount:.001}]}];
 const context=vm.createContext({LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,liveEquityAllocation,LIVE_EQUITY_ALLOCATION,liveNextBuyAllocation,liveActionLog:actions,
  signedBinanceGet:async()=>({balances:[{asset:'USDT',free:cash,locked:0},{asset:'ABC',free:1,locked:0}],canTrade:true}),
  j:async()=>[{symbol:'ABCUSDT',price:30}],getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),liveBalancePnl:()=>({}),livePositionLedger:()=>({dust:[]})});
 const accounting=source.slice(source.indexOf('function liveRealizedPnl('),source.indexOf('function fixedLiveAllocation('));
 const getter=source.slice(source.indexOf('async function getLiveAccountSnapshot('),source.indexOf('\nconst equityHistory='));
 vm.runInContext('let lastDisplayAccount=null;'+accounting+getter,context);
 const a=await context.getLiveAccountSnapshot();assert.equal(a.totalValueUsdt,300);assert.equal(a.fixedPositionUsdt,60);assert.equal(a.nextBuyAllocation.amountUsdt,59.88023952);
 assert.equal(a.realizedPnlComplete,false);assert.equal(a.profitReinvestmentPaused,false);assert.equal(a.allocationWarning,'LIVE_REALIZED_FEE_VALUATION_REQUIRED');
 cash=370;const b=await context.getLiveAccountSnapshot();assert.equal(b.fixedPositionUsdt,80);assert.equal(b.nextBuyAllocation.amountUsdt,79.84031936);
 assert.equal(actions.length,1);assert.equal(actions[0].qty,1);
});
test('actual automatic order submission uses current equity and preserves the configured exit percentages',async()=>{
 let funding=wallet(),submitted=[];
 const context=vm.createContext({sizeRisk,tradeSettings:{values:settings},nativeProtection:{rows:{},uncertain:()=>false,release:async()=>{},sync:async()=>{}},
  liveManagedPositions:()=>({}),getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),
  symbolExchangeInfo:async()=>({status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],quoteAsset:'USDT',quoteAssetPrecision:8,filters:[{filterType:'MIN_NOTIONAL',minNotional:5}]}),
  getLiveAccountSnapshot:async()=>funding,liveNextBuyAllocation,LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,
  assessQualityEntry:()=>({ok:true}),ENTRY_POLICY_VERSION:'test',candles:async()=>[],recordLiveFill(){},requireLivePrice:()=>100,streams:{ABCUSDT:{}},
  liveOrders:{submit:async(p,m)=>{submitted.push({p,m});return {status:'FILLED'};}}});
 vm.runInContext(source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell(')),withLiveSafety(context));
 const riskInput={...input};delete riskInput.allocationMode;
 await context.placeLiveMarketBuy('ABCUSDT',28.72583,'CHANNEL_POC',{wyckoffTrade:{riskInput}});
 assert.equal(Number(submitted[0].p.quoteOrderQty),59.88023952);
 const trade=submitted[0].m.meta.wyckoffTrade;
 assert.deepEqual({...trade.exitSettings},settings);assert.equal(trade.riskPlan.allocationMode,LIVE_EQUITY_ALLOCATION);
 assert.ok(Math.abs(trade.riskPlan.plannedRiskUsd-1.1976047904)<1e-10);
 funding=wallet(4,300,59);await assert.rejects(()=>context.placeLiveMarketBuy('ABCUSDT',28.72583),/NO_CASH/);
 assert.equal(submitted.length,1);
});
