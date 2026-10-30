import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {independentEntryConfig,independentBreakoutEntry,assertIndependentBreakoutSubmission,INDEPENDENT_ENTRY_POLICY} from '../lib/binance-independent-entry.mjs';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {sizeRisk} from '../lib/confirmed-risk-sizing.mjs';
import {assessQualityEntry,ENTRY_POLICY_VERSION} from '../lib/binance-quality-policy.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
import {requireLivePrice} from '../lib/binance-live-price.mjs';
import {renderStrategyReview} from '../strategy-followup-ui.js';
import {withLiveSafety} from './helpers/live-safety.mjs';

const STEP=300000,end=Date.parse('2026-10-30T10:00:00Z'),now=end+1000;
const config=independentEntryConfig({BINANCE_INDEPENDENT_BREAKOUT_ENABLED:'true',BINANCE_INDEPENDENT_BREAKOUT_AFTER:new Date(end-STEP).toISOString()});
function bars(){const data=Array.from({length:205},(_,i)=>({openTime:end-(205-i)*STEP,closeTime:end-(204-i)*STEP,open:100,high:101,low:99.5,close:100,volume:1000,closed:true}));Object.assign(data.at(-1),{open:100,low:100,high:104,close:103,volume:2000});return data;}
const input=(extra={})=>({symbol:'ABCUSDT',bars:bars(),price:103,priceAsOf:new Date(now).toISOString(),now,liveBar:{openTime:end,low:102.9,high:103.1},timeframe:'5m',entryMode:'confirmed_quality',allowEarlyWave:true,...extra});
const evaluate=(extra={})=>evaluateDailyTrade(input({independentEntry:config,...extra}));

test('live breakout is opt-in with an activation boundary; default and ordinary evaluations stay unchanged',()=>{
 assert.equal(independentEntryConfig({}).enabled,false);
 assert.equal(independentEntryConfig({BINANCE_INDEPENDENT_BREAKOUT_ENABLED:'true'}).enabled,false);
 assert.equal(independentEntryConfig({BINANCE_INDEPENDENT_BREAKOUT_ENABLED:'TRUE',BINANCE_INDEPENDENT_BREAKOUT_AFTER:new Date(end).toISOString()}).enabled,false);
 assert.equal(evaluateDailyTrade(input()).entryConfirmed,false);
 assert.equal(evaluate({independentEntry:{}}).entryConfirmed,false);
 assert.equal(independentBreakoutEntry(input(),{...config,enabledAfter:end}).reason,'WAIT_NEW_BREAKOUT_SIGNAL');
});
test('independent closed-bar breakout can decide BUY without a qualifying Spring/recovery pair',()=>{
 const ev=evaluate();assert.equal(ev.entryConfirmed,true);assert.equal(ev.buyReason,'INDEPENDENT_BREAKOUT_READY');
 assert.equal(ev.entryDecisions.current.ready,false);assert.equal(ev.entryDecisions.breakout.ready,true);
 assert.equal(ev.wyckoffTrade.entryMode,'independent_breakout');assert.equal(ev.wyckoffTrade.entryPolicyVersion,INDEPENDENT_ENTRY_POLICY.version);
 assert.equal(ev.wyckoffTrade.setup.volumeRatio,2);assert.equal(ev.wyckoffTrade.exitSettings.stopLossPct,1);
 assert.equal(ev.comparison.variants.full_quality,false);assert.equal(ev.wyckoffTrade.setup.secondRallyHigh,undefined);
 assert.doesNotThrow(()=>assertSpringEntryReady(ev.wyckoffTrade,103,now,input().liveBar));
});
test('both routes can qualify but the existing confirmed strategy retains priority and identity',()=>{
 const nums=[...Array.from({length:170},(_,i)=>i*.5),...Array(50).fill(95),95,97,100,90,80,85,92,87,82,84,86,85,86];
 const b=nums.map((n,i)=>({openTime:end-(nums.length+1-i)*STEP,closeTime:end-(nums.length-i)*STEP,open:100+(n-(i===220||i===221?1:0))*.01,high:100+(i===230?93:n)*.01,low:100+(n-(i===220||i===221?1:0))*.01,close:100+n*.01,volume:1000,closed:true}));
 b.push({openTime:end-STEP,closeTime:end,open:100.86,low:100.86,high:102.1,close:102.05,volume:2000,closed:true});
 const ev=evaluate({bars:b,price:102.05,liveBar:{openTime:end,low:102,high:102.1}});
 assert.equal(ev.entryDecisions.current.ready,true);assert.equal(ev.entryDecisions.breakout.ready,true);
 assert.equal(ev.entryDecisions.selected,'confirmed_quality');assert.equal(ev.wyckoffTrade.entryMode,'early_wave_confirmed');assert.equal(ev.wyckoffTrade.entryPolicyVersion,ENTRY_POLICY_VERSION);
});
test('weak volume, insufficient liquidity, downtrend and malformed/missing history cannot authorize breakout',()=>{
 for(const [change,reason] of [
  [b=>b.at(-1).volume=1499,'BREAKOUT_VOLUME_LOW'],
  [b=>b.at(-1).volume=null,'WAIT_VOLUME_HISTORY'],
  [b=>b.forEach(x=>{for(const k of ['open','high','low','close'])x[k]/=100;}),'BREAKOUT_LIQUIDITY_LOW'],
  [b=>b.splice(30,1),'GAPPED_BREAKOUT_HISTORY'],
  [b=>b.push({...b.at(-1)}),'INVALID_BREAKOUT_HISTORY'],
  [b=>b.at(-1).high=99,'INVALID_BREAKOUT_HISTORY'],
  [b=>b.splice(0,3),'WAIT_BREAKOUT_HISTORY'],
  [b=>{for(const x of b.slice(0,180))Object.assign(x,{open:200,close:200,high:201,low:199});},'MA_DOWNTREND_BLOCK']
 ]){const b=bars();change(b);assert.equal(independentBreakoutEntry(input({bars:b}),config).reason,reason);}
});
test('open/future candles, stale quotes and old or consumed patterns cannot produce a fresh entry',()=>{
 const b=bars();b.at(-1).closed=false;assert.equal(independentBreakoutEntry(input({bars:b}),config).ready,false);
 const future=bars();future.at(-1).closeTime+=STEP;assert.equal(independentBreakoutEntry(input({bars:future}),config).ready,false);
 for(const age of [15001,-1])assert.equal(independentBreakoutEntry(input({priceAsOf:new Date(now-age).toISOString()}),config).reason,'WAIT_FRESH_PRICE');
 const id=evaluate().wyckoffTrade.patternId;
 assert.equal(independentBreakoutEntry(input({usedPatternIds:[id]}),config).reason,'BREAKOUT_PATTERN_ALREADY_USED');
 assert.equal(independentBreakoutEntry(input({entryAfter:end+1}),config).reason,'WAIT_NEW_BREAKOUT_SIGNAL');
 assert.equal(independentBreakoutEntry(input({now:end+STEP,priceAsOf:new Date(end+STEP).toISOString()}),config).ready,false);
});
test('live-price invalidation and final data recheck block a cached BUY even after it was selected',()=>{
 const trade=evaluate().wyckoffTrade;
 for(const liveBar of [null,{openTime:end-STEP,low:103},{openTime:end,low:101}])assert.throws(()=>assertSpringEntryReady(trade,103,now,liveBar));
 assert.throws(()=>assertSpringEntryReady(trade,101,now,input().liveBar),/INVALIDATED/);
 assert.throws(()=>assertSpringEntryReady(trade,103,end+STEP,input().liveBar),/EXPIRED/);
 assert.throws(()=>assertIndependentBreakoutSubmission(input(),{...config,enabled:false},trade),/DISABLED/);
 const changed=bars();changed.at(-1).volume=1000;
 assert.throws(()=>assertIndependentBreakoutSubmission(input({bars:changed}),config,trade),/VOLUME_LOW/);
 assert.throws(()=>assertIndependentBreakoutSubmission(input(),config,{...trade,patternId:'forged'}),/SIGNAL_CHANGED/);
});
test('managed-position exits do not depend on the independent entry flag, candles or research state',()=>{
 const p={entryPrice:100,entryMode:'independent_breakout',timeframe:'5m'},ev=evaluate({position:p,bars:[],exitEvaluator:()=>({sell:true,reason:'STOP'})});
 assert.equal(ev.rawDecision,'SELL');assert.equal(ev.wyckoffTrade,p);assert.equal(ev.entryConfirmed,false);
});

function executor(overrides={}){
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell('));
 const writes=[],protectedSymbols=[];
 const context=vm.createContext({Date:class extends Date{static now(){return now;}},sizeRisk,tradeSettings:{values:validateTradeSettings({})},independentEntry:config,assertIndependentBreakoutSubmission,liveActionLog:[],
  nativeProtection:{rows:{},uncertain:()=>false,release:async()=>{throw Error('unexpected release');},sync:async s=>protectedSymbols.push(s)},
  liveManagedPositions:()=>({}),getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),
  symbolExchangeInfo:async()=>({status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],quoteAsset:'USDT',filters:[]}),
  getLiveAccountSnapshot:async()=>({balances:[],usdtFree:100}),liveNextBuyAllocation:()=>({ok:true,amountUsdt:20}),LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,
  assessQualityEntry,ENTRY_POLICY_VERSION,candles:async()=>bars(),signedBinancePost(){throw Error('network forbidden');},recordLiveFill(){},requireLivePrice,
  streams:{ABCUSDT:{status:'connected',lastPrice:103,lastEventAt:new Date(now).toISOString(),liveBar:input().liveBar}},assertSpringEntryReady,tradeControl:{paused:false},
  liveOrders:{submit:async(params,meta)=>{writes.push({params,meta});return {};}},...overrides});
 vm.runInContext(fn,withLiveSafety(context));return {context,writes,protectedSymbols,run:()=>context.placeLiveMarketBuy('ABCUSDT',20,'INDEPENDENT_BREAKOUT_READY',{wyckoffTrade:evaluate().wyckoffTrade})};
}
test('offline final order path retains independent provenance, risk sizing and native protection',async()=>{
 const x=executor();await x.run();assert.equal(x.writes.length,1);assert.deepEqual(x.protectedSymbols,['ABCUSDT']);
 const {params,meta}=x.writes[0];assert.equal(params.type,'MARKET');assert.equal(params.side,'BUY');assert.equal(Number(params.quoteOrderQty),20);
 assert.equal(meta.meta.wyckoffTrade.entryPolicyVersion,INDEPENDENT_ENTRY_POLICY.version);assert.equal(meta.meta.wyckoffTrade.riskPlan.stopLossPct,1);
 assert.ok(meta.meta.wyckoffTrade.riskPlan.plannedRiskUsd<=.2+1e-12);
 const smaller=executor({tradeSettings:{values:validateTradeSettings({stopLossPct:2})}});await smaller.run();assert.equal(Number(smaller.writes[0].params.quoteOrderQty),10);
});
test('account, protection, pause, capacity, funding and consumed-signal blockers stop the final write',async()=>{
 const cases=[
  {liveReadiness:()=>({ready:false})},
  {nativeProtection:{rows:{},uncertain:()=>true}},
  {liveTradingGate:()=>({ready:false})},
  {liveTradingGate:()=>({ready:true,withdrawalsEnabled:true})},
  {tradeControl:{paused:true}},
  {independentEntry:{...config,enabled:false}},
  {tradeControl:{paused:false,resumedAt:new Date(now).toISOString()}},
  {getLiveAccountSnapshot:async()=>({balances:Array.from({length:5},(_,i)=>({asset:'A'+i,valueUsdt:10})),usdtFree:100})},
  {getLiveAccountSnapshot:async()=>({balances:[],usdtFree:1})},
  {liveNextBuyAllocation:()=>({ok:false,code:'NO_SLOT'})},
  {symbolExchangeInfo:async()=>({status:'TRADING',quoteAsset:'USDT',ocoAllowed:false})},
  {liveActionLog:[{symbol:'ABCUSDT',type:'BUY',wyckoffTrade:evaluate().wyckoffTrade}]},
  {liveActionLog:[{symbol:'ABCUSDT',type:'SELL',at:new Date(now).toISOString()}]},
  {candles:async()=>{const b=bars();b.at(-1).volume=100;return b;}}
 ];
 for(const overrides of cases){const x=executor(overrides);await assert.rejects(x.run);assert.equal(x.writes.length,0);assert.equal(x.protectedSymbols.length,0);}
});
test('a price change during final history read is rechecked immediately before submission',async()=>{
 const x=executor();x.context.candles=async()=>{x.context.streams.ABCUSDT.lastPrice=100;return bars();};
 await assert.rejects(x.run);assert.equal(x.writes.length,0);
});
test('UI distinguishes live permission from observation and never claims disabled execution is active',()=>{
 const el=()=>({children:[],textContent:'',append(...x){this.children.push(...x);},replaceChildren(){this.children=[];},querySelectorAll(){return [];}}),doc={createElement:el},flatten=e=>e.textContent+' '+e.children.map(flatten).join(' ');
 for(const [enabled,executionEnabled,expected] of [[true,true,'מאופשר בלייב'],[true,false,'ביצוע LIVE אינו מופעל'],[false,true,'אינו מופעל בשרת']]){
  const host=el();renderStrategyReview(host,{independentEntry:{...config,enabled,executionEnabled}},{document:doc});assert.match(flatten(host),new RegExp(expected));
 }
});
