import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ENTRY_COMPARISON_POLICY,comparisonBars,comparisonSignals,observeEntryComparison,entryComparisonReport,simulateComparisonBar,recordEntryBlocker,blockerCategory} from '../lib/entry-method-comparison.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {replayEntryMethods} from '../scripts/compare-entry-methods.mjs';
import {renderEntryComparison} from '../entry-comparison-ui.js';
import {equitySession} from '../lib/colmex-market-hours.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
const STEP=300000,at=Date.parse('2026-10-28T15:00:00Z');
const settings={stopLossPct:2,profitActivationPct:3,trailingGapPp:1,takeProfitPct:50};
const costs={feeBps:10,halfSpreadBps:5,slippageBps:5};
const history=(n=205)=>Array.from({length:n},(_,i)=>({openTime:at-(n-i)*STEP,closeTime:at-(n-i-1)*STEP,open:100,high:101,low:99.5,close:100,volume:1000,closed:true,timeframe:'5m'}));
const next=(bars,values={})=>[...bars,{...bars.at(-1),openTime:bars.at(-1).closeTime,closeTime:bars.at(-1).closeTime+STEP,...values}];
const breakout=b=>next(b,{open:100,low:100,high:104,close:103,volume:2000});
function observe(state,bars,extra={}){observeEntryComparison(state,{symbol:'ABCUSDT',bars,at:bars.at(-1).closeTime+1000,platform:'BINANCE',settings,costs,...extra});}
test('independent breakout passes without any Wyckoff recovery, while live-quality baseline remains blocked',()=>{
 const bars=breakout(history()),s=comparisonSignals(bars,'BINANCE');
 assert.equal(s.breakout.ready,true);assert.equal(s.current.ready,false);assert.equal(s.breakout.volumeRatio,2);
 for(const [values,reason] of [[{close:101},'WAIT_BREAKOUT'],[{volume:1400},'BREAKOUT_VOLUME_LOW'],[{volume:null},'WAIT_VOLUME_HISTORY']])assert.equal(comparisonSignals([...bars.slice(0,-1),{...bars.at(-1),...values}],'BINANCE').breakout.reason,reason);
 const cheap=bars.map(b=>({...b,open:b.open/100,high:b.high/100,low:b.low/100,close:b.close/100}));assert.equal(comparisonSignals(cheap,'BINANCE').breakout.reason,'BREAKOUT_LIQUIDITY_LOW');
});
test('only completed causal candles are accepted, with no in-place input edits',()=>{
 const b=history(),saved=JSON.stringify(b),future=next(b,{close:200,high:201});
 assert.deepEqual(comparisonBars(future,at,'BINANCE'),b);assert.deepEqual(comparisonBars(next(b,{closed:false}),at+STEP,'BINANCE'),b);
 assert.equal(JSON.stringify(b),saved);assert.throws(()=>comparisonBars([...b,b.at(-1)],at,'BINANCE'),/INVALID/);
 assert.throws(()=>comparisonBars([{...b[0],low:110}],at,'BINANCE'),/INVALID/);
 assert.deepEqual(comparisonBars(b.map(x=>({...x,closeTime:x.closeTime-1})),at,'BINANCE'),b);
});
test('signal cannot fill on its own candle; restart/repeated observations cannot duplicate trades',()=>{
 let s={},b=history();observe(s,b);b=breakout(b);observe(s,b);
 let m=s.entryComparison.cohorts[0].items.ABCUSDT.methods.breakout;assert.equal(m.position,null);assert.ok(m.pending);
 s=JSON.parse(JSON.stringify(s));observe(s,b);assert.equal(s.entryComparison.cohorts[0].items.ABCUSDT.methods.breakout.signals,1);
 b=next(b,{open:104,high:104.2,low:103.5,close:104,volume:1000});observe(s,b);
 m=s.entryComparison.cohorts[0].items.ABCUSDT.methods.breakout;assert.equal(m.position.entryAt,b.at(-1).openTime);assert.equal(m.position.entryPrice,104*1.001);
 const before=JSON.stringify(s.entryComparison.cohorts[0]);observe(s,b);assert.equal(JSON.stringify(s.entryComparison.cohorts[0]),before);
 b=next(b,{open:90,high:95,low:89,close:91});observe(s,b);
 const row=s.entryComparison.cohorts[0].closed[0];assert.equal(row.price,90);assert.ok(row.netR < -1);assert.equal(row.reason,'STOP_LOSS');
 const gross=row.qty*(90-row.entryPrice);assert.ok(row.netR<gross);
});
test('both unknown OHLC orders are considered and conservative exit is explicit, not a claimed tick fill',()=>{
 const config={settings,costs:{feeBps:0,halfSpreadBps:0,slippageBps:0}},t=applyTrailingExitPolicy({entryPrice:100,entryCost:100,qty:1,peakPrice:100,ambiguousBars:0},settings);
 const r=simulateComparisonBar(t,{open:100,low:97,high:106,close:105,closeTime:at},config);
 assert.equal(r.exit.price,98);assert.equal(r.exit.netR,-2);assert.equal(r.trade.ambiguousBars,1);assert.equal(t.peakPrice,100);
 const a=simulateComparisonBar(t,{open:100,low:99,high:106,close:105,closeTime:at},config);assert.equal(a.trade.effectiveStopPrice,105);
 const b=simulateComparisonBar({...a.trade,entryCost:100},{open:106,low:105.2,high:108,close:107,closeTime:at+STEP},config);assert.ok(b.trade.effectiveStopPrice>=a.trade.effectiveStopPrice);
});
test('missing price path is marked incomplete, never silently made into a win or loss',()=>{
 const s={};let b=history();observe(s,b);b=breakout(b);observe(s,b);b=next(b,{open:103,low:102.8,high:103.5,close:103});observe(s,b);
 b=next(next(b),{open:103,high:104,low:102,close:103});b.splice(b.length-2,1);observe(s,b);
 const c=entryComparisonReport(s).cohorts[0],m=c.methods.find(m=>m.method==='breakout');assert.equal(m.incomplete,1);assert.equal(m.closed,0);assert.equal(m.open,0);assert.ok(c.dataProblems.length);
});
test('same frozen exits and risk unit, settings changes are never merged into old outcomes',()=>{
 const s={};let b=history();observe(s,b);b=breakout(b);observe(s,b);b=next(b,{open:103,high:103.5,low:102.8,close:103});observe(s,b);
 observe(s,b,{settings:{...settings,stopLossPct:5}});
 const root=s.entryComparison;assert.equal(root.cohorts.length,2);assert.equal(root.cohorts[0].config.settings.stopLossPct,2);assert.equal(root.cohorts[1].config.settings.stopLossPct,5);
 const p=root.cohorts[0].items.ABCUSDT.methods.breakout.position;assert.ok(Math.abs(p.qty*p.entryPrice*.02-1)<1e-9);assert.equal(p.exitSettings.stopLossPct,2);
});
test('live operational blockers remain separate from strategy reasons and survive study updates',()=>{
 const s={};recordEntryBlocker(s,{symbol:'ABCUSDT',at,reason:'WAIT_SECOND_RECOVERY_CONFIRMATION',entryBlockReason:'NO_FREE_SLOT'});observe(s,history());
 const d=entryComparisonReport(s).diagnostics[0];assert.equal(d.category,'STRATEGY');assert.equal(d.entryBlockCategory,'CAPITAL_OR_RISK');assert.equal(blockerCategory('NETWORK'),'DATA');assert.equal(blockerCategory('UNRESOLVED_ORDER_REQUIRES_REVIEW'),'ACCOUNT_OR_EXECUTION');
});
test('offline full-trade replay matches incremental replay and never mutates the live executor',()=>{
 let b=breakout(history());b=next(b,{open:103,high:104,low:102,close:103});b=next(b,{open:95,high:96,low:94,close:95});
 const before=JSON.stringify(b),result=replayEntryMethods({platform:'BINANCE',settings,costs,startAt:new Date(at).toISOString(),endAt:new Date(b.at(-1).closeTime).toISOString(),markets:[{symbol:'ABCUSDT',bars:b}]});
 assert.equal(result.report.cohorts[0].methods.find(m=>m.method==='breakout').closed,1);assert.equal(JSON.stringify(b),before);
 assert.equal(ENTRY_COMPARISON_POLICY.mode,'SIMULATION_ONLY');const code=fs.readFileSync(new URL('../lib/entry-method-comparison.mjs',import.meta.url),'utf8');assert.doesNotMatch(code,/\bfetch\(|broker\.write|placeLiveMarketBuy/);
});
test('UI shows assumed costs, independent route, incomplete coverage and closed-only drawdown without injection',()=>{
 const el=()=>({children:[],textContent:'',append(...x){this.children.push(...x);}}),host=el(),doc={createElement:el},text=e=>e.textContent+' '+e.children.map(text).join(' ');
 const s={};observe(s,history());renderEntryComparison(host,entryComparisonReport(s),{document:doc});const t=text(host);assert.match(t,/אינו שולח פקודות/);assert.match(t,/אינה תשואת תיק/);assert.match(t,/עמלה משוערת/);assert.match(t,/פריצה עצמאית/);
});
test('Colmex regular-session replay handles overnight gaps and rejects premarket candles',()=>{
 const b=['2026-10-26','2026-10-27','2026-10-28'].flatMap(day=>{const session=equitySession(day);return Array.from({length:78},(_,i)=>({openTime:session.openAt+i*STEP,closeTime:session.openAt+(i+1)*STEP,open:100,high:101,low:99.5,close:100,volume:1000,closed:true,timeframe:'5m'}));}).slice(0,210);
 assert.equal(comparisonBars(b,b.at(-1).closeTime,'COLMEX').length,210);
 const s={};observe(s,b,{platform:'COLMEX'});const signal=breakout(b);observe(s,signal,{platform:'COLMEX'});const filled=next(signal,{open:103,high:104,low:102.5,close:103});observe(s,filled,{platform:'COLMEX'});
 assert.ok(s.entryComparison.cohorts[0].items.ABCUSDT.methods.breakout.position);
 assert.equal(s.entryComparison.cohorts[0].items.ABCUSDT.gaps,undefined);
 assert.throws(()=>comparisonBars([{...b[0],openTime:b[0].openTime-STEP,closeTime:b[0].closeTime-STEP}],b[0].closeTime,'COLMEX'),/INVALID_COMPARISON_BARS/);
});
test('replay is insensitive to batching, and retained results do not include unfinished positions as profits',()=>{
 const a={},b={},start=history();observe(a,start);observe(b,start);
 const one=breakout(start),two=next(one,{open:103,high:104,low:102.5,close:103}),three=next(two,{open:103,high:104,low:102.5,close:103});
 for(const x of [one,two,three])observe(a,x);observe(b,three);
 const reportA=entryComparisonReport(a),reportB=entryComparisonReport(b);
 assert.deepEqual(reportA.cohorts[0].methods,reportB.cohorts[0].methods);
 const m=reportA.cohorts[0].methods.find(m=>m.method==='breakout');assert.equal(m.open,1);assert.equal(m.closed,0);assert.equal(m.meanNetR,null);assert.equal(m.netR,0);
});
test('a ready independent breakout in a real Colmex cycle is observation only and cannot reach broker.write',async()=>{
 let b=['2026-10-26','2026-10-27','2026-10-28'].flatMap(day=>{const session=equitySession(day);return Array.from({length:78},(_,i)=>({openTime:session.openAt+i*STEP,closeTime:session.openAt+(i+1)*STEP,open:100,high:101,low:99.5,close:100,volume:1000,closed:true,timeframe:'5m'}));}).slice(0,210);
 let now=b.at(-1).closeTime+1000,writes=0;
 const s=initialState(now-1000),env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
 const broker={snapshot:async()=>({positions:[],orders:[],history:[],account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1000}}),instruments:async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:1}],details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),history:async()=>({barDetails:b.map(x=>({t:x.openTime,o:x.open,h:x.high,l:x.low,c:x.close,v:x.volume}))}),quote:async()=>({bp:b.at(-1).close,ap:b.at(-1).close+.01}),write:async()=>{writes++;throw Error('unexpected write');}};
 const run=()=>runCycle({state:s,save:async()=>{},broker,env,now:()=>now,deadline:now+27000});
 await run();s.cursor=0;b=breakout(b);now=b.at(-1).closeTime+1000;await run();
 assert.ok(s.entryComparison.cohorts[0].items.AAPL.methods.breakout.pending);assert.equal(writes,0);assert.equal(s.pending,null);assert.equal(s.used.length,0);
});
