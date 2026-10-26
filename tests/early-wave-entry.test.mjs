import test from 'node:test';
import assert from 'node:assert/strict';
import {earlyWaveEntry,assertEarlyWaveEntry} from '../lib/early-wave-entry.mjs';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {entrySignal,legacyEntrySignal} from '../lib/colmex-auto-policy.mjs';
import {rsiSeries} from '../lib/wyckoff-spring-rsi.mjs';
const bucket=Date.parse('2026-10-26T15:00:00Z'),now=bucket+10000;
function bars(){return Array.from({length:20},(_,i)=>({openTime:bucket-(20-i)*300000,closeTime:bucket-(19-i)*300000,open:99+i*.05,high:100.5,low:i===14?100:100.1,close:100.2+i*.01,closed:true,timeframe:'5m'})).map(b=>({...b,open:b.close}));}
const options=(extra={})=>({price:101,priceAsOf:now,now,...extra});
test('a causal 1% rebound and breakout qualify without an RSI ceiling for Binance legacy mode and the Colmex comparison baseline',()=>{
 const b=bars();assert.ok(rsiSeries([...b.map(b=>b.close),101]).at(-1)>40);
 const wave=earlyWaveEntry(b,options());assert.equal(wave.buyConfirmed,true);assert.equal(wave.minimumPrice,101);assert.equal(wave.breakoutPrice,100.5);
 const binance=evaluateDailyTrade({symbol:'TESTUSDT',bars:b,price:101,priceAsOf:new Date(now).toISOString(),now,timeframe:'5m',entryMode:'spring_rsi_live',allowEarlyWave:true});
 assert.equal(binance.rawDecision,'BUY');assert.equal(binance.wyckoffTrade.entryMode,'early_wave_live');assert.equal(binance.wyckoffTrade.setup.waveLow.price,100);
 const colmex=legacyEntrySignal(b,now,0,[],options());assert.equal(colmex.ready,true);assert.equal(colmex.setup.patternId,binance.wyckoffTrade.patternId);
 assert.doesNotThrow(()=>assertSpringEntryReady(binance.wyckoffTrade,101,now));
 assert.equal(evaluateDailyTrade({symbol:'TESTUSDT',bars:b,price:101,priceAsOf:new Date(now).toISOString(),now,timeframe:'5m',entryMode:'spring_rsi_live'}).rawDecision,'HOLD');
});
test('rebound threshold is inclusive but a touch of the prior high is not a breakout',()=>{
 assert.equal(earlyWaveEntry(bars(),options({price:100.999})).entryReason,'WAIT_EARLY_WAVE_1_PERCENT');
 const b=bars();b.at(-1).high=101;assert.equal(earlyWaveEntry(b,options()).entryReason,'WAIT_EARLY_WAVE_BREAKOUT');
 assert.equal(earlyWaveEntry(b,options({price:101.001})).buyConfirmed,true);
});
test('stale, future, previous-bucket prices and incomplete history cannot enter',()=>{
 for(const extra of [{priceAsOf:now-15001},{priceAsOf:now+1},{priceAsOf:bucket-1},{price:NaN}])assert.equal(earlyWaveEntry(bars(),options(extra)).entryReason,'WAIT_FRESH_PRICE');
 for(const mutate of [b=>b.pop(),b=>b.at(-1).closed=false,b=>b.at(-1).closeTime+=300000,b=>b.splice(-3,1),b=>b.at(-1).high=99,b=>b.at(-1).open=NaN,b=>b.at(-1).timeframe='1h']){
  const b=bars();mutate(b);assert.equal(earlyWaveEntry(b,options()).buyConfirmed,false);
 }
 assert.equal(earlyWaveEntry(bars().slice(-5),options()).entryReason,'WAIT_EARLY_WAVE_HISTORY');
});
test('same-wave identity is retained through a restart, and a post-sale low is required',()=>{
 const first=earlyWaveEntry(bars(),options());
 assert.equal(earlyWaveEntry(bars(),options({used:JSON.parse(JSON.stringify([first.patternId]))})).entryReason,'PATTERN_ALREADY_USED');
 assert.equal(earlyWaveEntry(bars(),options({after:first.waveLow.time})).entryReason,'WAIT_NEW_EARLY_WAVE');
 assert.equal(legacyEntrySignal(bars(),now,first.waveLow.time,[],options()).ready,false);
});
test('final submission rejects lost breakout, expiry, and a new low in the live candle',()=>{
 const s=earlyWaveEntry(bars(),options());
 assert.throws(()=>assertEarlyWaveEntry(s,100.8,now),/EARLY_WAVE_INVALIDATED/);
 assert.throws(()=>assertEarlyWaveEntry(s,101,bucket+300000),/WAIT_CURRENT_5M_BARS/);
 assert.throws(()=>assertEarlyWaveEntry(s,101,now,{openTime:bucket,low:99.9}),/EARLY_WAVE_INVALIDATED/);
 assert.equal(earlyWaveEntry(bars(),options({liveBar:{openTime:bucket,low:99.9}})).buyConfirmed,false);
 assert.equal(earlyWaveEntry(bars(),options({liveBar:{openTime:bucket,low:100}})).buyConfirmed,true);
});
test('Binance -1ms close timestamps and Colmex exact close timestamps produce equal thresholds',()=>{
 const exact=earlyWaveEntry(bars(),options()),binance=earlyWaveEntry(bars().map(b=>({...b,closeTime:b.closeTime-1})),options());
 assert.equal(binance.buyConfirmed,true);assert.equal(exact.minimumPrice,binance.minimumPrice);
});
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
async function liveCycle({cash=1000,positions=[],orders=[],used=[],delayReservation=false}={}){
 const state=initialState(now-3600000);state.used=used;let clock=now;const writes=[],saves=[];
 const broker={snapshot:async()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:cash},positions,orders,history:[]}),
  instruments:async()=>AUTO_POLICY.symbols.map((name,i)=>({name,tradableInstrumentId:i+1,type:'EQUITY'})),
  details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),
  history:async()=>({barDetails:bars().map(b=>({t:b.openTime,o:b.open,h:b.high,l:b.low,c:b.close,v:1}))}),quote:async()=>({bp:101,ap:101.01}),
  write:async(a,i)=>{assert.ok(saves.some(s=>s.pending?.id===i.id));writes.push(structuredClone(i));return {orderId:'1'};}};
 const result=await runCycle({state,broker,env,signal:legacyEntrySignal,now:()=>clock,deadline:now+24000,save:async s=>{saves.push(structuredClone(s));if(delayReservation&&s.pending)clock+=10001;}});
 return {state,writes,result};
}
test('Legacy Colmex execution reservation persists an early-wave intent with native brackets and no short',async()=>{
 const {state,writes}=await liveCycle();assert.equal(writes.length,1);assert.equal(writes[0].setup.entryMode,'early_wave_live');assert.equal(writes[0].order.side,'buy');assert.equal(writes[0].order.stopLoss,1);assert.equal(writes[0].order.takeProfit,50);assert.ok(writes[0].order.qty*writes[0].order.price<=800);assert.equal(state.used.length,1);
});
test('Colmex early wave shares cash and slot limits and does not reuse consumed waves',async()=>{
 for(const opts of [{cash:1},{positions:[{id:'p',qty:0},{id:'q',qty:0},{id:'r',qty:0}]},{used:[earlyWaveEntry(bars(),options()).patternId]}])assert.equal((await liveCycle(opts)).writes.length,0);
});
test('a slow durable save cannot send an expired early-wave order to Colmex',async()=>{
 const {state,writes,result}=await liveCycle({delayReservation:true});assert.equal(writes.length,0);assert.equal(state.pending,null);assert.equal(result.reason,'WAIT_BROKER_QUOTE');
});
import fs from 'node:fs';
import vm from 'node:vm';
import {withLiveSafety} from './helpers/live-safety.mjs';
import {assessQualityEntry,ENTRY_POLICY_VERSION} from '../lib/binance-quality-policy.mjs';
test('Binance final order path rechecks the wave and never converts a failed long into a short',async()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),fn=source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell('));
 let livePrice=100.8;const submitted=[];
 const context=vm.createContext({Date:class extends Date{static now(){return now;}},nativeProtection:{rows:{},uncertain:()=>false,release:async()=>{},sync:async()=>{}},console:{error(){}},liveManagedPositions:()=>({}),getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),symbolExchangeInfo:async()=>({status:'TRADING',ocoAllowed:true,orderTypes:['MARKET','TAKE_PROFIT','STOP_LOSS'],quoteAsset:'USDT',filters:[]}),getLiveAccountSnapshot:async()=>({balances:[],usdtFree:100}),liveNextBuyAllocation:()=>({ok:true,amountUsdt:10}),LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,assessQualityEntry,ENTRY_POLICY_VERSION,candles:async()=>[],signedBinancePost:()=>{throw Error('No network');},recordLiveFill:()=>{},requireLivePrice:()=>livePrice,streams:{BTCUSDT:{}},assertSpringEntryReady,tradeControl:{paused:false},liveOrders:{submit:async p=>{submitted.push(p);return {};}}});
 vm.runInContext(fn,withLiveSafety(context));
 const meta={wyckoffTrade:{entryMode:'early_wave_live',exitPolicy:'PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2',setup:earlyWaveEntry(bars(),options())}};
 await assert.rejects(()=>context.placeLiveMarketBuy('BTCUSDT',10,'EARLY_WAVE_BREAKOUT',meta),/EARLY_WAVE_INVALIDATED/);assert.equal(submitted.length,0);
 livePrice=101;await context.placeLiveMarketBuy('BTCUSDT',10,'EARLY_WAVE_BREAKOUT',meta);assert.equal(submitted.length,1);assert.equal(submitted[0].side,'BUY');
});
