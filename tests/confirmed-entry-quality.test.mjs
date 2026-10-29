import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {entrySignal,planBuy,legacyEntrySignal,AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import {qualityMeasures,assertQualityEntry} from '../lib/confirmed-entry-quality.mjs';
import {sizeRisk,positionRiskSettings} from '../lib/confirmed-risk-sizing.mjs';
import {evaluateDailyTrade,assertSpringEntryReady} from '../lib/wyckoff-evaluation.mjs';
import {initialState,runCycle,reconcile} from '../lib/colmex-auto-runner.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
import {withLiveSafety} from './helpers/live-safety.mjs';
import {assessQualityEntry,ENTRY_POLICY_VERSION} from '../lib/binance-quality-policy.mjs';
import {replayEntryChecks} from '../lib/binance-market-watch.mjs';
const end=Date.parse('2026-10-26T15:00:00Z'),now=end+1000,step=300000;
function spring(){
 const nums=[...Array.from({length:170},(_,i)=>i*.5),...Array(50).fill(95),95,97,100,90,80,85,92,87,82,84,86,85,86,79,81];
 return nums.map((n,i)=>({openTime:end-(nums.length-i)*step,closeTime:end-(nums.length-i-1)*step,open:100+(n-(i===220||i===221?1:0))*.01,high:100+(i===230?93:n)*.01,low:100+(n-(i===220||i===221?1:0))*.01,close:100+n*.01,volume:1000,closed:true,timeframe:'5m'}));
}
const live=bars=>({price:bars.at(-1).close,priceAsOf:bars.at(-1).closeTime+1000});
function wave(){const b=spring().slice(0,-2);b.push({...b.at(-1),openTime:b.at(-1).closeTime,closeTime:b.at(-1).closeTime+step,open:100.86,low:100.86,high:102.1,close:102.05,volume:1200});const shift=end-b.at(-1).closeTime;return b.map(x=>({...x,openTime:x.openTime+shift,closeTime:x.closeTime+shift}));}
test('live Colmex requires a closed reclaim; Binance quality mode agrees after timestamp normalization',()=>{
 const b=spring(),s=entrySignal(b,now,0,[],live(b));assert.equal(s.ready,true);assert.equal(s.setup.entryMode,'spring_reclaim_confirmed');assert.ok(s.entryRsi<40);assert.equal(s.quality.volume.ratio,1);
 const pending=b.slice(0,-1),t=pending.at(-1).closeTime+1000;
 assert.equal(legacyEntrySignal(pending,t,0,[],live(pending)).ready,true);assert.equal(entrySignal(pending,t,0,[],live(pending)).ready,false);
 const ev=evaluateDailyTrade({symbol:'ABCUSDT',bars:b.map(x=>({...x,closeTime:x.closeTime-1})),price:b.at(-1).close,priceAsOf:new Date(now).toISOString(),now,timeframe:'5m',entryMode:'confirmed_quality',allowEarlyWave:true});
 assert.equal(ev.rawDecision,'BUY');assert.equal(ev.wyckoffTrade.entryPolicyVersion,'BINANCE_CONFIRMED_QUALITY_V2');assert.equal(ev.wyckoffTrade.setup.firstLow.price,s.setup.firstLow.price);assert.doesNotThrow(()=>assertSpringEntryReady(ev.wyckoffTrade,b.at(-1).close,now));
});
test('trend and volume independently explain rejections; missing data, a consumed pattern and unfinished bars cannot buy',()=>{
 const b=spring();b.at(-1).volume=900;let s=entrySignal(b,now,0,[],live(b));assert.equal(s.reason,'CONFIRMATION_VOLUME_LOW');assert.equal(s.comparison.variants.confirmed_trend,true);assert.equal(s.comparison.variants.full_quality,false);
 b.at(-1).volume=null;assert.equal(entrySignal(b,now,0,[],live(b)).reason,'WAIT_VOLUME_HISTORY');
 const down=spring();for(const bar of down.slice(0,220))Object.assign(bar,{open:100.95,close:100.95,high:100.95,low:100.95});assert.equal(entrySignal(down,now,0,[],live(down)).reason,'MA_DOWNTREND_BLOCK');
 const short=spring().slice(-40);assert.equal(entrySignal(short,now,0,[],live(short)).reason,'WAIT_MA_HISTORY');
 const good=spring(),signal=entrySignal(good,now,0,[],live(good));assert.equal(entrySignal(good,now,0,[signal.setup.patternId],live(good)).ready,false);assert.equal(entrySignal(good,now,end,[],live(good)).ready,false);
 good.at(-1).closed=false;assert.throws(()=>entrySignal(good,now,0,[],live(good)),/UNFINISHED/);
});
test('early-wave route also needs a closed breakout plus trend and volume, retaining independent identity',()=>{
 const b=wave(),s=entrySignal(b,now,0,[],live(b));assert.equal(s.ready,true);assert.equal(s.setup.entryMode,'early_wave_confirmed');assert.ok(s.setup.patternId.startsWith('early-wave:'));assert.equal(s.entryRsi,null);
 b.at(-1).volume=10;assert.equal(entrySignal(b,now,0,[],live(b)).ready,false);
 const before=wave().slice(0,-1),t=before.at(-1).closeTime+1000;assert.equal(entrySignal(before,t,0,[],{price:102.05,priceAsOf:t}).ready,false);
});
test('final price checks reject loss of support, a new low, stale quotes and expired confirmation',()=>{
 const b=spring(),s=entrySignal(b,now,0,[],live(b)),p=b.at(-1).close;
 assert.throws(()=>assertQualityEntry(s.setup,s.setup.firstLow.price,now),/INVALIDATED/);
 assert.throws(()=>assertQualityEntry(s.setup,p,s.setup.signalExpiresAt),/CONFIRMATION/);
 assert.throws(()=>assertQualityEntry(s.setup,p,now,{openTime:end,low:s.setup.springLow.price-.01,high:p}),/INVALIDATED/);
 assert.equal(entrySignal(b,now,0,[],{price:p,priceAsOf:now-16000}).ready,false);
});
test('volume comparison excludes its confirmation bar and later bars; Wilder ATR is positive and causal',()=>{
 const b=spring();b.at(-1).volume=2000;const m=qualityMeasures(b,b.length-1,b.at(-1).close);assert.equal(m.volume.ratio,2);assert.ok(m.atr>0);
 const later=[...b,{...b.at(-1),closeTime:end+step,volume:999999}];assert.equal(qualityMeasures(later,b.length-1,b.at(-1).close).volume.ratio,2);
});
test('market-watch replay uses the same confirmed filters and does not label old intrabar logic as the current version',()=>{
 const rows=replayEntryChecks('ABCUSDT',spring(),{now,since:end-1000});assert.equal(rows.length,1);assert.equal(rows[0].entryMode,'spring_reclaim_confirmed');assert.equal(rows[0].source,'CLOSED_BAR_CONFIRMED_QUALITY_REPLAY');
 const low=spring();low.at(-1).volume=1;assert.equal(replayEntryChecks('ABCUSDT',low,{now,since:end-1000}).length,0);
});
const details={quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:null};
test('wider stops shrink order size, respect $8 planned risk and lot minimums; extreme volatility is rejected',()=>{
 const riskInput={version:AUTO_POLICY.version,atr:1.2,structureLow:99},input={instrument:{tradableInstrumentId:1,type:'EQUITY'},details,quote:{ap:100,bp:99.99},positions:[],orders:[],cash:1000,now,receivedAt:now,riskInput};
 const plan=planBuy(input);assert.equal(plan.reason,'READY');assert.ok(plan.order.stopLoss>1);assert.ok(plan.order.qty<7);assert.ok(plan.riskPlan.plannedRiskUsd<=8);assert.equal(plan.order.stopLossType,'offset%');
 assert.equal(planBuy({...input,riskInput:{...riskInput,atr:5}}).reason,'VOLATILITY_RISK_TOO_HIGH');
 assert.equal(planBuy({...input,details:{...details,minLot:5}}).reason,'MINIMUM_QUANTITY_ABOVE_RISK_BUDGET');
 const btc=sizeRisk(100,20,validateTradeSettings({}),{...riskInput,version:'BINANCE_CONFIRMED_QUALITY_V2'});assert.equal(btc.settings.stopLossPct,1);assert.equal(btc.budget,20);assert.ok(btc.budget*btc.settings.stopLossPct/100<=.2+1e-12);
});
test('Colmex frozen entry stop survives reconciliation/settings changes; existing positions keep their prior policy',()=>{
 const p=applyTrailingExitPolicy({entryPrice:100,peakPrice:100,riskPlan:{stopLossPct:2}},positionRiskSettings({riskPlan:{stopLossPct:2}},{stopLossPct:1}));assert.equal(p.stopPrice,98);
 applyTrailingExitPolicy(p,positionRiskSettings(p,{stopLossPct:4}));assert.equal(p.stopPrice,98);assert.equal(positionRiskSettings({}, {stopLossPct:1}).stopLossPct,1);
});
test('offline Colmex cycle writes one confirmed intent, persists risk metadata and blocks a delayed submit',async()=>{
 // Use valid regular-session timestamps over three sessions for the 204-bar MA.
 const raw=spring(),times=[];for(const day of ['2026-10-22','2026-10-23','2026-10-26'])for(let i=0;i<78;i++)times.push(Date.parse(day+'T13:30:00Z')+i*step);
 const b=raw.slice(-234).map((bar,i)=>({...bar,openTime:times[i],closeTime:times[i]+step}));
 const clockStart=b.at(-1).closeTime-1; // Last closed signal must remain inside the regular session.
 b.pop();const at=b.at(-1).closeTime+1000;
 // Place the final reclaim on the previous closed bar while retaining the whole setup.
 const source=spring().slice(-b.length);for(let i=0;i<b.length;i++)Object.assign(b[i],{open:source[i].open,high:source[i].high,low:source[i].low,close:source[i].close,volume:source[i].volume});
 const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
 for(const delay of [false,true]){let clock=at;const state=initialState(Date.parse('2026-10-21T13:30Z')),writes=[];let saved;
 const broker={snapshot:async()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1000},positions:[],orders:[],history:[]}),instruments:async()=>AUTO_POLICY.symbols.map((name,i)=>({name,tradableInstrumentId:i+1,type:'EQUITY'})),details:async()=>details,history:async()=>({barDetails:b.map(x=>({t:x.openTime,o:x.open,h:x.high,l:x.low,c:x.close,v:x.volume}))}),quote:async()=>({bp:b.at(-1).close,ap:b.at(-1).close+.01}),write:async(a,intent)=>{assert.equal(saved.pending.id,intent.id);writes.push(structuredClone(intent));return {orderId:'o'};}};
 await runCycle({state,broker,env,now:()=>clock,deadline:at+24000,save:async s=>{saved=structuredClone(s);if(delay&&s.pending)clock+=10001;}});
 assert.equal(writes.length,delay?0:1);if(!delay){const intent=writes[0];assert.equal(intent.setup.entryMode,'spring_reclaim_confirmed');assert.ok(intent.riskPlan.plannedRiskUsd<=8);assert.equal(intent.order.stopLoss,intent.exitSettings.stopLossPct);
 reconcile(state,{positions:[{id:'p',tradableInstrumentId:1,side:'buy',qty:intent.order.qty,stopLoss:99}],orders:[],history:[{id:'o',status:'filled',filledQty:intent.order.qty,avgPrice:100.8,positionId:'p'}]},clock);assert.equal(state.positions[0].riskPlan.version,AUTO_POLICY.version);
 reconcile(state,{positions:[],orders:[],history:[{id:'sell',positionId:'p',side:'sell',status:'filled',filledQty:intent.order.qty,avgPrice:101}]},clock+1000);assert.equal(state.closedTrades[0].entryMode,'spring_reclaim_confirmed');assert.equal(state.closedTrades[0].netPnl,null);
 }}
});
test('Binance final order path uses the configured stop before minimum checks and revalidates the confirmed signal',async()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),fn=source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell('));
 const b=wave(),ev=evaluateDailyTrade({symbol:'ABCUSDT',bars:b,price:102.05,priceAsOf:new Date(now).toISOString(),now,timeframe:'5m',entryMode:'confirmed_quality',allowEarlyWave:true}),meta={wyckoffTrade:ev.wyckoffTrade};
 const submitted=[];let price=102.05;
 const context=vm.createContext({Date:class extends Date{static now(){return now;}},sizeRisk,tradeSettings:{values:validateTradeSettings({})},nativeProtection:{rows:{},uncertain:()=>false,release:async()=>{},sync:async()=>{}},liveManagedPositions:()=>({}),getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),symbolExchangeInfo:async()=>({status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],quoteAsset:'USDT',filters:[]}),getLiveAccountSnapshot:async()=>({balances:[],usdtFree:100}),liveNextBuyAllocation:()=>({ok:true,amountUsdt:20}),LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,assessQualityEntry,ENTRY_POLICY_VERSION,candles:async()=>[],signedBinancePost(){throw Error('network forbidden');},recordLiveFill(){},requireLivePrice:()=>price,streams:{ABCUSDT:{}},assertSpringEntryReady,tradeControl:{paused:false},liveOrders:{submit:async(p,m)=>{submitted.push({p,m});return {};}}});
 vm.runInContext(fn,withLiveSafety(context));await context.placeLiveMarketBuy('ABCUSDT',20,'READY',meta);assert.equal(submitted.length,1);assert.equal(Number(submitted[0].p.quoteOrderQty),20);assert.equal(submitted[0].m.meta.wyckoffTrade.exitSettings.stopLossPct,1);assert.equal(submitted[0].m.meta.wyckoffTrade.riskPlan.stopLossPct,1);assert.ok(submitted[0].m.meta.wyckoffTrade.riskPlan.plannedRiskUsd<=.2+1e-12);
 price=99;await assert.rejects(()=>context.placeLiveMarketBuy('ABCUSDT',20,'READY',meta));assert.equal(submitted.length,1);
});
