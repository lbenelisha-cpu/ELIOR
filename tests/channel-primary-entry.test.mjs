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
const D=300000,end=Date.parse('2026-10-30T15:00:00Z'),now=end+1000;
const config=(platform='BINANCE')=>channelEntryConfig({[platform+'_CHANNEL_PRIMARY_ENABLED']:'true',[platform+'_CHANNEL_PRIMARY_AFTER']:new Date(end-D).toISOString()},platform);
function bars(platform='BINANCE'){
 let times=[];for(let t=end-8*86400000;t<end;t+=D)if(platform==='BINANCE'||regularSession(t))times.push(t);times=times.slice(-205);
 const b=times.map((t,i)=>{const p=100+i*.02+Math.cos(i*Math.PI/5);return {openTime:t,closeTime:t+D,open:p,close:p,high:p+.1,low:p-.1,volume:1000,closed:true};});
 Object.assign(b.at(-1),{open:105,close:106,high:106.2,low:104.9,volume:2000});return b;
}
const input=(platform='BINANCE')=>({symbol:'ABCUSDT',bars:bars(platform),price:106,priceAsOf:now,now,liveBar:{openTime:end,low:105.9,high:106.1},entryMode:'confirmed_quality',timeframe:'5m',allowEarlyWave:true});
test('channel primary uses frozen pre-breakout pivots, regression and settings on both platforms',()=>{
 for(const platform of ['BINANCE','COLMEX']){
  const r=channelEntry(input(platform),config(platform));assert.equal(r.ready,true,r.reason);assert.ok(r.setup.lowTouches>=2&&r.setup.highTouches>=2);assert.ok(r.setup.regressionSlope>0);assert.ok(r.setup.level<106);assert.equal(r.setup.entryMode,'channel_breakout');
  assert.doesNotThrow(()=>assertChannelEntry(r.setup,106,now,input(platform).liveBar));
 }
});
test('primary gate suppresses old routes, including invalid activation; exits remain independent',()=>{
 const i={...input(),priceAsOf:new Date(now).toISOString(),channelPrimary:config(),independentEntry:{enabled:true,enabledAfter:end-D},exitSettings:{stopLossPct:2,profitActivationPct:6,trailingGapPp:2}};
 const ev=evaluateDailyTrade(i);assert.equal(ev.entryConfirmed,true,ev.buyReason);assert.equal(ev.entryDecisions.selected,'channel_breakout');assert.equal(ev.wyckoffTrade.exitSettings.stopLossPct,2);assert.equal(ev.wyckoffTrade.exitSettings.profitActivationPct,6);assert.match(ev.wyckoffTrade.entryPolicyVersion,/CHANNEL_PRIMARY/);
 const bad=evaluateDailyTrade({...i,channelPrimary:channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true'})});assert.equal(bad.entryConfirmed,false);assert.equal(bad.buyReason,'CHANNEL_ACTIVATION_TIME_REQUIRED');
 const held=evaluateDailyTrade({...i,bars:[],position:ev.wyckoffTrade,exitEvaluator:()=>({sell:true,reason:'STOP'})});assert.equal(held.rawDecision,'SELL');
 assert.throws(()=>assertSpringEntryReady(ev.wyckoffTrade,100,now,i.liveBar),/INVALIDATED/);
});
test('stale, consumed, malformed, gapped, weak-volume, falling-regression and invalid live-price signals cannot buy',()=>{
 const c=config(),i=input(),good=channelEntry(i,c);
 for(const mutate of [
  x=>x.priceAsOf=now-15001,x=>x.bars.splice(150,1),x=>x.bars.push({...x.bars.at(-1)}),x=>x.bars.at(-1).high=1,
  x=>x.bars.at(-1).closed=false,x=>x.bars.at(-1).volume=1000,x=>x.entryAfter=end,x=>x.now=end+D,
  x=>x.usedPatternIds=[good.setup.patternId],x=>x.liveBar.low=100,x=>x.liveBar=null,
  x=>{x.bars=x.bars.map((b,i)=>({...b,open:b.open-i*.05,high:b.high-i*.05,low:b.low-i*.05,close:b.close-i*.05}));},
 ]){const x=structuredClone(i);mutate(x);assert.equal(channelEntry(x,c).ready,false);}
 assert.equal(channelEntry(i,{}).ready,false);
 const trade={entryMode:'channel_breakout',patternId:good.setup.patternId,setup:good.setup};assert.doesNotThrow(()=>assertChannelSubmission(i,c,trade));
 assert.throws(()=>assertChannelSubmission(i,c,{...trade,entryMode:'independent_breakout'}),/PRIMARY_REQUIRED/);
 assert.throws(()=>assertChannelSubmission(i,c,{...trade,setup:{...good.setup,level:1}}),/SIGNAL_CHANGED/);
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
  streams:{ABCUSDT:{status:'connected',lastPrice:106,lastEventAt:new Date(now).toISOString(),liveBar:input().liveBar}},assertSpringEntryReady,tradeControl:{paused:false},
  liveOrders:{submit:async(params,meta)=>{writes.push({params,meta});return {};}},...overrides});
 vm.runInContext(fn,withLiveSafety(context));return {context,writes,protectedSymbols,run:()=>context.placeLiveMarketBuy('ABCUSDT',20,'CHANNEL_BREAKOUT_READY',{wyckoffTrade:evaluateDailyTrade({...input(),priceAsOf:new Date(now).toISOString(),channelPrimary:config(),exitSettings:context.tradeSettings.values}).wyckoffTrade})};
}

test('Binance final order path preserves settings, protection and provenance and blocks cached old routes',async()=>{
 const good=executor();await good.run();assert.equal(good.writes.length,1);assert.equal(good.writes[0].meta.meta.wyckoffTrade.entryMode,'channel_breakout');assert.match(good.writes[0].meta.meta.wyckoffTrade.entryPolicyVersion,/CHANNEL_PRIMARY/);assert.equal(good.writes[0].meta.meta.wyckoffTrade.riskPlan.stopLossPct,1);assert.deepEqual(good.protectedSymbols,['ABCUSDT']);
 for(const overrides of [
  {channelPrimary:config('COLMEX')},{channelPrimary:{requested:true,enabled:false}},
  {liveReadiness:()=>({ready:false})},{nativeProtection:{rows:{},uncertain:()=>true}},
  {tradeControl:{paused:true}},{getLiveAccountSnapshot:async()=>({balances:[],usdtFree:1})},
  {candles:async()=>{const b=bars();b.at(-1).volume=1;return b;}},
  {liveActionLog:[{symbol:'ABCUSDT',type:'SELL',at:new Date(now).toISOString()}]},
 ]){const x=executor(overrides);await assert.rejects(x.run);assert.equal(x.writes.length,0);}
 const old=executor();await assert.rejects(()=>old.context.placeLiveMarketBuy('ABCUSDT',20,'OLD_SIGNAL',{wyckoffTrade:{entryMode:'early_wave_confirmed'}}),/CHANNEL_PRIMARY_REQUIRED/);assert.equal(old.writes.length,0);
 const changed=executor();changed.context.candles=async()=>{changed.context.streams.ABCUSDT.lastPrice=100;return bars();};await assert.rejects(changed.run);assert.equal(changed.writes.length,0);
});
function colmexFixture(){
 const state=initialState(end-D);state.cursor=AUTO_POLICY.symbols.indexOf('AAPL');
 const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:2000},positions:[],orders:[],history:[],historyAvailable:true});
 const history=()=>({barDetails:[...bars('COLMEX').map(b=>({t:b.openTime,o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume})),{t:end,o:106,h:106.1,l:105.9,c:106,v:10}]});
 const b={writes:[],reads:0,snapshot:async()=>snapshot(),instruments:async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:1}],details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),quote:async()=>({bp:106,ap:106.01}),history:async()=>{b.reads++;return history();},write:async(a,i)=>{b.writes.push(structuredClone(i));return {orderId:'offline'};}};
 const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_CHANNEL_PRIMARY_ENABLED:'true',COLMEX_CHANNEL_PRIMARY_AFTER:new Date(end-D).toISOString()};
 return {state,b,snapshot,history,args:{state,broker:b,env,now:()=>now,deadline:now+27000,save:async()=>{}}};
}
test('Colmex submits exactly one protected channel intent and rechecks history and account',async()=>{
 const f=colmexFixture();await runCycle(f.args);assert.equal(f.b.writes.length,1,JSON.stringify(f.state.checks));assert.equal(f.b.reads,2);const i=f.b.writes[0];assert.equal(i.setup.entryMode,'channel_breakout');assert.ok(i.order.stopLoss>0&&i.order.takeProfit>0);assert.equal(f.state.checks.AAPL.entryDecisions.primary,'channel_breakout');
 await runCycle({...f.args,now:()=>now+60000,deadline:now+87000});assert.equal(f.b.writes.length,1);
 for(const kind of ['activation','cash','permission','halt','changed-signal','changed-price','save']){
  const f=colmexFixture();
  if(kind==='activation')delete f.args.env.COLMEX_CHANNEL_PRIMARY_AFTER;
  if(kind==='cash')f.b.snapshot=async()=>({...f.snapshot(),state:{availableCash:1}});
  if(kind==='permission')f.b.snapshot=async()=>({...f.snapshot(),account:{tradingRules:{}}});
  if(kind==='halt')f.state.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';
  if(kind==='changed-signal')f.b.history=async()=>{const h=f.history();if(++f.b.reads>1)h.barDetails.at(-2).v=100;return h;};
  if(kind==='changed-price'){let count=0;f.b.quote=async()=>++count===1?{bp:106,ap:106.01}:{bp:100,ap:100.01};}
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

test('enabled channel protection crosses both final submission paths with frozen geometry and rejects settings changes',async()=>{
 const values=validateTradeSettings({channelProfitProtection:true,channelActivationFraction:.5});
 const x=executor({tradeSettings:{values}});await x.run();assert.equal(x.writes.length,1);const setup=x.writes[0].meta.meta.wyckoffTrade.setup;assert.ok(setup.channelProtection.targetPrice>106);assert.equal(setup.channelProtection.width,setup.channelWidth);
 const f=colmexFixture();f.state.settings=values;await runCycle(f.args);assert.equal(f.b.writes.length,1,JSON.stringify(f.state.checks));assert.equal(f.b.writes[0].setup.channelProtection.activationFraction,.5);
 const check=channelEntry({...input(),settings:values},config());assert.throws(()=>assertChannelSubmission({...input(),settings:{}},config(),{entryMode:'channel_breakout',patternId:check.setup.patternId,setup:check.setup}),/PROTECTION_CHANGED/);
});
