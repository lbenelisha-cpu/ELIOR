import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sizeRisk} from '../lib/confirmed-risk-sizing.mjs';
import {BINANCE_CONFIRMED_POLICY,BINANCE_STOP_POLICY} from '../lib/confirmed-entry-quality.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {trackedLivePositions,liveFillAction} from '../lib/wyckoff-live-positions.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {nativeProtectionPlan} from '../lib/binance-native-protection.mjs';
import {manualBuyAmount,manualPosition} from '../lib/binance-manual-trades.mjs';
import {withLiveSafety} from './helpers/live-safety.mjs';

const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const symbol='ABCUSDT',info={symbol,status:'TRADING',ocoAllowed:true,quoteAsset:'USDT',quoteAssetPrecision:8,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'100000'},{filterType:'PRICE_FILTER',tickSize:'.01',minPrice:'.01',maxPrice:'100000'},{filterType:'NOTIONAL',minNotional:'5'}]};

test('Binance keeps the exact configured stop across volatility, structure and percentages above the old 3% cap',()=>{
 for(const stopLossPct of [.1,.555,1,2,4,50])for(const [atr,structureLow] of [[.01,99.9],[2,97],[20,10]]){
  const settings=validateTradeSettings({stopLossPct});
  const result=sizeRisk(100,20,settings,{version:BINANCE_CONFIRMED_POLICY.version,atr,structureLow});
  assert.equal(result.reason,'READY');assert.equal(result.settings.stopLossPct,stopLossPct);
  assert.equal(result.riskPlan.stopLossPct,stopLossPct);assert.equal(result.riskPlan.stopLossPolicy,BINANCE_STOP_POLICY);
  assert.ok(result.budget<=20);assert.ok(result.budget*stopLossPct/100<=Math.min(8,20*Math.min(stopLossPct,1)/100)+1e-12);
 }
 assert.equal(BINANCE_CONFIRMED_POLICY.maxStopPct,null);
 assert.equal(BINANCE_CONFIRMED_POLICY.atrMultiple,null);
 assert.equal(BINANCE_CONFIRMED_POLICY.stopLossPolicy,'SETTINGS_ONLY_V1');
});

function restoredRuntime({stopLossPct=1,peakPrice=100,effectiveStopPrice=97,mode='live',nativeStop=null}={}){
 const position=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryMode:'early_wave_confirmed',entryPrice:100,peakPrice,qty:2,riskPlan:{version:'BINANCE_CONFIRMED_QUALITY_V1',stopLossPct:3}},{stopLossPct:3});
 position.effectiveStopPrice=effectiveStopPrice;
 const buy={type:'BUY',symbol,qty:2,price:100,at:'2026-10-28T20:00:00Z',wyckoffTrade:position};
 const context=vm.createContext({trackedLivePositions,applyTrailingExitPolicy,tradeSettings:{values:validateTradeSettings({stopLossPct})},liveActionLog:[buy],nativeProtection:{rows:nativeStop?{[symbol]:{phase:'ACTIVE',entryAt:buy.at,stop:nativeStop,params:{quantity:'2'}}}:{}},mode:mode==='paper'?'demo':mode,DEMO_TRADING:mode==='demo',demoTrader:{state:{positions:{[symbol]:structuredClone(position)}}},paper:{positions:{[symbol]:structuredClone(position)}}});
 vm.runInContext(source.slice(source.indexOf('const livePeakMemory='),source.indexOf('const accountSnapshot=')),context);
 return {context,buy,read:()=>vm.runInContext('tradingPositions()',context)[symbol]};
}

test('restored Binance LIVE position ignores its old 3% risk plan and exits at the configured 1%',()=>{
 const r=restoredRuntime(),p=r.read();
 assert.equal(p.stopLossPct,1);assert.equal(p.stopPrice,99);assert.equal(p.effectiveStopPrice,99);
 assert.equal(binancePositionExit(p,99.01).sell,false);
 assert.equal(binancePositionExit(p,99).reason,'TRAIL_STOP_LOSS_1_PERCENT');
 assert.equal(binancePositionExit(p,97.92).sell,true);
 assert.equal(nativeProtectionPlan(symbol,p,100,info,2).params.belowStopPrice,'99');
 assert.equal(r.buy.wyckoffTrade.riskPlan.stopLossPct,3); // Historical provenance is not rewritten.
 r.context.tradeSettings.values=validateTradeSettings({stopLossPct:.5});
 assert.equal(r.read().stopPrice,99.5);
});

test('Binance DEMO and paper positions also use current settings instead of frozen entry risk',()=>{
 for(const mode of ['demo','paper']){
  const r=restoredRuntime({mode,stopLossPct:2});
  assert.equal(r.read().stopPrice,98);assert.equal(r.read().exitSettings.stopLossPct,2);
  r.context.tradeSettings.values=validateTradeSettings({stopLossPct:1});
  assert.equal(r.read().stopPrice,99);assert.equal(binancePositionExit(r.read(),98.9).sell,true);
 }
});

test('using settings preserves earned trailing protection and tighter verified broker stops',()=>{
 const r=restoredRuntime({peakPrice:106,effectiveStopPrice:105});
 assert.equal(r.read().stopLossPct,1);assert.equal(r.read().effectiveStopPrice,105);
 assert.equal(binancePositionExit(r.read(),104.9).reason,'TRAILING_PROFIT_EXIT');
 assert.equal(restoredRuntime({nativeStop:99.5}).read().effectiveStopPrice,99.5);
});

function manualRuntime(stopLossPct){
 const writes=[],settings=validateTradeSettings({stopLossPct});
 const ctx=vm.createContext({tradeSettings:{values:settings},nativeProtection:{rows:{},uncertain:()=>false,sync:async()=>{}},liveManagedPositions:()=>({}),manualBuyAmount,manualPosition,requireLivePrice:()=>100,streams:{[symbol]:{}},LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),symbolExchangeInfo:async()=>info,getLiveAccountSnapshot:async()=>({usdtFree:100,balances:[]}),recordLiveFill(){},signedBinancePost(){throw Error('network forbidden');},liveOrders:{submit:async(params,intent)=>{writes.push({params,intent});return {status:'FILLED'};}}});
 vm.runInContext(source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell(')),withLiveSafety(ctx));
 return {ctx,writes};
}

test('manual buy snapshots settings for the actual fill and its native stop',async()=>{
 const r=manualRuntime(5);await r.ctx.placeLiveMarketBuy(symbol,10,'MANUAL_BUY');
 assert.equal(r.writes.length,1);
 const {params,intent}=r.writes[0];assert.equal(intent.meta.wyckoffTrade.exitSettings.stopLossPct,5);
 const fill=liveFillAction({executedQty:'.1',cummulativeQuoteQty:'10',status:'FILLED',orderId:1,transactTime:Date.now()},{...intent,params,at:new Date().toISOString()},[]);
 assert.equal(fill.wyckoffTrade.stopPrice,95);
 assert.equal(nativeProtectionPlan(symbol,trackedLivePositions([fill])[symbol],100,info,.1).params.belowStopPrice,'95');
});

test('minimum protected notional uses the configured stop for manual buys instead of a hidden 1% fallback',async()=>{
 const r=manualRuntime(20);
 await assert.rejects(()=>r.ctx.placeLiveMarketBuy(symbol,6,'MANUAL_BUY'),/NATIVE_PROTECTION_BUDGET_BELOW_MINIMUM/);
 assert.equal(r.writes.length,0);
});
