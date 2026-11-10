import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import fs from 'node:fs';import vm from 'node:vm';
import {withLiveSafety} from './helpers/live-safety.mjs';
import {sizeRisk} from '../lib/confirmed-risk-sizing.mjs';
import {assessQualityEntry,ENTRY_POLICY_VERSION} from '../lib/binance-quality-policy.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
import {requireLivePrice} from '../lib/binance-live-price.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {channelEntryConfig,channelEntry,assertChannelSubmission,assertChannelEntry} from '../lib/channel-primary-entry.mjs';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {regularSession} from '../lib/colmex-market-hours.mjs';
const D=300000,end=Date.parse('2026-11-06T20:00:00Z'),now=end+1000;
const config=(platform='BINANCE')=>channelEntryConfig({[platform+'_CHANNEL_PRIMARY_ENABLED']:'true',[platform+'_CHANNEL_PRIMARY_AFTER']:new Date(end-D).toISOString()},platform);
function bars(platform='BINANCE'){const i=pocFixture({end,entryPrice:106,platform});return i.trendBars||i.bars;}
const input=(platform='BINANCE')=>({...pocFixture({end,entryPrice:106,platform}),bars:bars(platform),trendBars:undefined,symbol:'ABCUSDT',entryMode:'confirmed_quality',timeframe:'5m',allowEarlyWave:true});
test('LONG records initial consolidation and refuses altered evidence at submission',()=>{
 for(const platform of ['BINANCE','COLMEX']){const i=input(platform),c=config(platform),r=channelEntry(i,c);assert.equal(r.setup.consolidation.zone,'LOWER');
 const trade={entryMode:'channel_breakout',patternId:r.setup.patternId,setup:r.setup};
 assert.throws(()=>assertChannelSubmission(i,c,{...trade,setup:{...r.setup,pocModel:null}}),/POC_MODEL_CHANGED/);}
});
test('channel primary freezes A–B and enters only on the POC return on both platforms',()=>{
 for(const platform of ['BINANCE','COLMEX']){const i=input(platform),r=channelEntry(i,config(platform));assert.equal(r.ready,true,r.reason);assert.ok(r.setup.lowTouches>=2&&r.setup.highTouches>=2);assert.equal(r.conditions.rows.length,5);assert.equal(r.setup.pocModel.frozenAt,i.bars.at(-2).closeTime);assert.doesNotThrow(()=>assertChannelEntry(r.setup,106,now,i.liveBar));}
});
test('primary gate suppresses old routes, including invalid activation; exits remain independent',()=>{
 const i={...input(),priceAsOf:new Date(now).toISOString(),channelPrimary:config(),independentEntry:{enabled:true,enabledAfter:end-D},exitSettings:{stopLossPct:2,profitActivationPct:6,trailingGapPp:2}};
 const ev=evaluateDailyTrade(i);assert.equal(ev.entryConfirmed,true,ev.buyReason);assert.equal(ev.entryDecisions.selected,'channel_breakout');assert.equal(ev.wyckoffTrade.exitSettings.stopLossPct,2);assert.equal(ev.wyckoffTrade.exitSettings.profitActivationPct,6);assert.match(ev.wyckoffTrade.entryPolicyVersion,/CHANNEL_POC/);
 const bad=evaluateDailyTrade({...i,channelPrimary:channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true'})});assert.equal(bad.entryConfirmed,false);assert.equal(bad.buyReason,'CHANNEL_ACTIVATION_TIME_REQUIRED');
 const held=evaluateDailyTrade({...i,bars:[],position:ev.wyckoffTrade,exitEvaluator:()=>({sell:true,reason:'STOP'})});assert.equal(held.rawDecision,'SELL');
 assert.throws(()=>assertSpringEntryReady(ev.wyckoffTrade,105,now,i.liveBar),/INVALIDATED/);
});
test('malformed or stale market data and duplicate return receipts block entries',()=>{
 const c=config(),i=input(),good=channelEntry(i,c);
 for(const mutate of [x=>x.priceAsOf=now-15001,x=>x.bars.splice(15,1),x=>x.bars.push({...x.bars.at(-1)}),x=>x.bars.at(-1).high=1,x=>x.bars.at(-1).closed=false,x=>x.entryAfter=end,x=>x.now=end+D,x=>x.usedPatternIds=[good.setup.patternId],x=>x.liveBar.low=NaN,x=>x.liveBar=null]){const x=structuredClone(i);mutate(x);assert.equal(channelEntry(x,c).ready,false);}
 assert.equal(channelEntry(i,{}).ready,false);
 const trade={entryMode:'channel_breakout',patternId:good.setup.patternId,setup:good.setup};assert.doesNotThrow(()=>assertChannelSubmission(i,c,trade));
 assert.throws(()=>assertChannelSubmission(i,c,{...trade,entryMode:'independent_breakout'}),/PRIMARY_REQUIRED/);
});

function executor(overrides={}){
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell('));
 const writes=[],protectedSymbols=[];
 const context=vm.createContext({Date:class extends Date{static now(){return now;}},sizeRisk,tradeSettings:{values:validateTradeSettings({})},channelPrimary:config(),assertChannelSubmission,liveActionLog:[],
  nativeProtection:{rows:{},uncertain:()=>false,release:async()=>{throw Error('unexpected release');},sync:async s=>protectedSymbols.push(s)},
  liveManagedPositions:()=>({}),getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),
  symbolExchangeInfo:async()=>({status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],quoteAsset:'USDT',filters:[]}),
  getLiveAccountSnapshot:async()=>({balances:[],usdtFree:100}),liveNextBuyAllocation:()=>({ok:true,amountUsdt:20}),LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,
  assessQualityEntry,ENTRY_POLICY_VERSION,candles:async()=>bars(),signedBinancePost(){throw Error('network forbidden');},recordLiveFill(){},requireLivePrice,
  streams:{ABCUSDT:{status:'connected',lastPrice:106,lastEventAt:new Date(now).toISOString(),liveBar:input().liveBar,channelBar:input().liveBar}},assertSpringEntryReady,tradeControl:{paused:false},
  liveOrders:{submit:async(params,meta)=>{writes.push({params,meta});return {};}},...overrides});
 vm.runInContext(fn,withLiveSafety(context));return {context,writes,protectedSymbols,run:()=>context.placeLiveMarketBuy('ABCUSDT',20,'CHANNEL_BREAKOUT_READY',{wyckoffTrade:evaluateDailyTrade({...input(),priceAsOf:new Date(now).toISOString(),channelPrimary:config(),exitSettings:context.tradeSettings.values}).wyckoffTrade})};
}

test('Binance final order path preserves settings, protection and provenance and blocks cached old routes',async()=>{
 const good=executor();await good.run();assert.equal(good.writes.length,1);assert.equal(good.writes[0].meta.meta.wyckoffTrade.entryMode,'channel_breakout');assert.match(good.writes[0].meta.meta.wyckoffTrade.entryPolicyVersion,/CHANNEL_POC/);assert.equal(good.writes[0].meta.meta.wyckoffTrade.riskPlan.stopLossPct,1);assert.deepEqual(good.protectedSymbols,['ABCUSDT']);
 for(const overrides of [
  {channelPrimary:config('COLMEX')},{channelPrimary:{requested:true,enabled:false}},
  {liveReadiness:()=>({ready:false})},{nativeProtection:{rows:{},uncertain:()=>true}},
  {tradeControl:{paused:true}},{getLiveAccountSnapshot:async()=>({balances:[],usdtFree:1})},
  {streams:{ABCUSDT:{status:'connected',lastPrice:106,lastEventAt:new Date(now).toISOString(),channelBar:{...input().liveBar,volume:NaN}}}},
  {liveActionLog:[{symbol:'ABCUSDT',type:'SELL',at:new Date(now).toISOString()}]},
 ]){const x=executor(overrides);await assert.rejects(x.run);assert.equal(x.writes.length,0);}
 const old=executor();await assert.rejects(()=>old.context.placeLiveMarketBuy('ABCUSDT',20,'OLD_SIGNAL',{wyckoffTrade:{entryMode:'early_wave_confirmed'}}),/CHANNEL_PRIMARY_REQUIRED/);assert.equal(old.writes.length,0);
 const changed=executor();changed.context.candles=async()=>{changed.context.streams.ABCUSDT.lastPrice=105;return bars();};await assert.rejects(changed.run);assert.equal(changed.writes.length,0);
});
function colmexFixture(){
 const state=initialState(end-D);state.cursor=AUTO_POLICY.symbols.indexOf('AAPL');
 const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:2000},positions:[],orders:[],history:[],historyAvailable:true});
 const history=()=>({barDetails:[...bars('COLMEX'),input('COLMEX').liveBar].map(b=>({t:b.openTime,o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}))});
 const b={writes:[],reads:0,snapshot:async()=>snapshot(),instruments:async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:1}],details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),quote:async()=>({bp:106,ap:106.01}),history:async()=>{b.reads++;return history();},write:async(a,i)=>{b.writes.push(structuredClone(i));return {orderId:'offline'};}};
 const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_CHANNEL_PRIMARY_ENABLED:'true',COLMEX_CHANNEL_PRIMARY_AFTER:new Date(end-D).toISOString()};
 return {state,b,snapshot,history,args:{state,broker:b,env,now:()=>now,deadline:now+27000,save:async()=>{}}};
}
test('Colmex submits exactly one protected channel intent and rechecks history and account',async()=>{
 const f=colmexFixture();await runCycle(f.args);assert.equal(f.b.writes.length,1,JSON.stringify(f.state.checks));assert.equal(f.b.reads,2);const i=f.b.writes[0];assert.equal(i.setup.entryMode,'channel_breakout');assert.ok(i.order.stopLoss>0&&i.order.takeProfit>0);assert.equal(f.state.checks.AAPL.entryDecisions.primary,'channel_long_short');
 await runCycle({...f.args,now:()=>now+60000,deadline:now+87000});assert.equal(f.b.writes.length,1);
 for(const kind of ['activation','cash','permission','halt','changed-signal','changed-price','save']){
  const f=colmexFixture();
  if(kind==='activation')delete f.args.env.COLMEX_CHANNEL_PRIMARY_AFTER;
  if(kind==='cash')f.b.snapshot=async()=>({...f.snapshot(),state:{availableCash:1}});
  if(kind==='permission')f.b.snapshot=async()=>({...f.snapshot(),account:{tradingRules:{}}});
  if(kind==='halt')f.state.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';
  if(kind==='changed-signal')f.b.history=async()=>{const h=f.history();if(++f.b.reads>1)h.barDetails.at(-1).v=undefined;return h;};
  if(kind==='changed-price'){let count=0;f.b.quote=async()=>++count===1?{bp:106,ap:106.01}:{bp:105,ap:105.01};}
  if(kind==='save')f.args.save=async s=>{if(s.pending)throw Error('durability');};
  if(kind==='save')await assert.rejects(runCycle(f.args),/durability/);else await runCycle(f.args);
  assert.equal(f.b.writes.length,0,kind);
 }
});
test('targeted server installer is idempotent and refuses mismatched integration contexts',async()=>{
 const os=await import('node:os'),path=await import('node:path'),{patchServer}=await import('../scripts/patch-channel-primary.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'channel-primary-patch-'));try{
  const file=path.join(root,'server.mjs'),patches=[{before:'old observer',after:'new observer'}];fs.writeFileSync(file,'owner code\nold observer');patchServer(root,patches);assert.equal(fs.readFileSync(file,'utf8'),'owner code\nnew observer');patchServer(root,patches);assert.equal(fs.readFileSync(file,'utf8'),'owner code\nnew observer');
  assert.throws(()=>patchServer(root,[{before:'missing',after:'replacement'}]));assert.equal(fs.readFileSync(file,'utf8'),'owner code\nnew observer');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Binance channel protection retains frozen geometry and rejects settings changes',async()=>{
 const values=validateTradeSettings({channelProfitProtection:true,channelActivationFraction:.5});
 const x=executor({tradeSettings:{values}});await x.run();assert.equal(x.writes.length,1);const setup=x.writes[0].meta.meta.wyckoffTrade.setup;assert.ok(setup.channelProtection.targetPrice>106);assert.equal(setup.channelProtection.width,setup.channelWidth);
 const check=channelEntry({...input(),settings:values},config());assert.throws(()=>assertChannelSubmission({...input(),settings:{profitActivationPct:6}},config(),{entryMode:'channel_breakout',patternId:check.setup.patternId,setup:check.setup}),/PROTECTION_CHANGED/);
});

test('Colmex channel protection submits the frozen absolute target',async()=>{
 const values=validateTradeSettings({channelProfitProtection:true,channelActivationFraction:.5});
 const f=colmexFixture();f.state.settings=values;await runCycle(f.args);assert.equal(f.b.writes.length,1,JSON.stringify(f.state.checks));assert.equal(f.b.writes[0].setup.channelProtection.version,'CHANNEL_TAKE_PROFIT_V2');assert.equal(f.b.writes[0].order.takeProfitType,'absolute');assert.ok(Math.abs(f.b.writes[0].order.takeProfit-f.b.writes[0].setup.channelProtection.targetPrice)<.011);
});

test('LONG retains the fixed profile until a return and does not revive stale return data',()=>{
 for(const platform of ['BINANCE','COLMEX']){const c=config(platform),i=input(platform),r=channelEntry(i,c);assert.equal(r.ready,true,r.reason);assert.equal(r.setup.pocModel.channel.barTimes.length,50);
 const trade={entryMode:'channel_breakout',patternId:r.setup.patternId,setup:r.setup};assert.doesNotThrow(()=>assertChannelSubmission(i,c,trade));
 assert.throws(()=>assertChannelSubmission({...i,price:105},c,trade),/POC_RECLAIM_PRICE_INVALIDATED/);
 assert.equal(channelEntry({...i,bars:i.bars.slice(-49)},c).reason,'WAIT_CHANNEL_HISTORY');
 assert.throws(()=>assertChannelEntry(r.setup,106,end+D,i.liveBar),/WAIT_CHANNEL_LIVE_BAR/);}
});
test('LONG final order accepts a recovered wick and still installs protection',async()=>{
 const e=executor();e.context.streams.ABCUSDT.channelBar.low=100;await e.run();
 assert.equal(e.writes.length,1);assert.deepEqual(e.protectedSymbols,['ABCUSDT']);
});

test('LONG triggers after the closed POC reclaim without minimum candle volume',()=>{
 for(const platform of ['BINANCE','COLMEX']){const i=input(platform),c=config(platform);i.now=end+120000;i.priceAsOf=i.now;i.liveBar.receivedAt=i.now;i.liveBar.volume=0;
 const r=channelEntry(i,c);assert.equal(r.ready,true,r.reason);assert.equal(r.setup.signalTime,end);
 const trade={entryMode:'channel_breakout',patternId:r.setup.patternId,setup:r.setup};
 const fresh={...i,now:i.now+1000,priceAsOf:i.now+1000,liveBar:{...i.liveBar,volume:1900,receivedAt:i.now+1000}};
 assert.deepEqual(assertChannelSubmission(fresh,c,trade).setup.pocModel,r.setup.pocModel);
 for(const patch of [{receivedAt:i.now-15001},{receivedAt:i.now+1},{volume:undefined},{volume:NaN},{volume:-1},{high:100},{closed:true},{closeTime:end+D-1},{openTime:end-D}])assert.equal(channelEntry({...i,liveBar:{...i.liveBar,...patch}},c).reason,'WAIT_CHANNEL_LIVE_BAR');}
});

test('Colmex rechecks live volume and prevents stale or expired data from reaching the broker write',async()=>{
 const f=colmexFixture();f.b.history=async()=>{const h=f.history();h.barDetails.at(-1).v=1500+(++f.b.reads)*100;return h;};
 await runCycle(f.args);assert.equal(f.b.writes.length,1);assert.equal(f.b.reads,2);assert.equal(f.b.writes[0].entryLiveBar.volume,1700);
 for(const kind of ['stale-history','expired-after-save']){
  const x=colmexFixture();let clock=now;x.args.now=()=>clock;
  if(kind==='stale-history')x.b.quote=async()=>{clock+=11000;return {bp:106,ap:106.01};};
  else x.args.save=async s=>{if(s.pending)clock=end+D;};
  await runCycle(x.args);assert.equal(x.b.writes.length,0,kind);
  if(kind==='expired-after-save')assert.equal(x.state.pending,null);
 }
});
