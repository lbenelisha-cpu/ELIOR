import test from 'node:test';
import assert from 'node:assert/strict';
import {observeChannels,channelReport} from '../lib/channel-comparison.mjs';
const D=300000,start=Date.parse('2026-10-31T00:00:00Z');
const bars=(n=100)=>Array.from({length:n},(_,i)=>{const center=100+i*.1,p=center+2*Math.cos(i*Math.PI/5);return {openTime:start+i*D,closeTime:start+(i+1)*D-1,open:p,close:p,high:p+.2,low:p-.2};});
const opts={now:start+100*D,period:100,interval:'5m'};
test('parallel channel uses confirmed extrema and identical boundary slopes; midpoint is arithmetic',()=>{
 const a=globalThis.LEVI_PARALLEL.analyze(bars(),opts);assert.equal(a.ready,true);assert.ok(a.lowTouches>=2);assert.ok(a.highTouches>=1);assert.ok(Math.abs(a.slope-.1)<1e-10);
 const p=globalThis.LEVI_REGRESSION.levels(a,a.end),q=globalThis.LEVI_REGRESSION.levels(a,a.end+D);
 assert.ok(Math.abs((q.upper-p.upper)-(q.lower-p.lower))<1e-10);assert.equal(p.middle,(p.upper+p.lower)/2);assert.ok(a.anchorEnd<=a.end-2*D);
});
test('open/future candles cannot supply pivots; broken and missing channels are unavailable',()=>{
 const input=bars(),a=globalThis.LEVI_PARALLEL.analyze(input,opts);
 assert.deepEqual(globalThis.LEVI_PARALLEL.analyze([...input,...bars(110).slice(100)],opts),a);
 assert.equal(globalThis.LEVI_PARALLEL.analyze(input.slice(10),opts).ready,false);
 const flat=input.map(b=>({...b,open:100,close:100,high:101,low:99}));assert.equal(globalThis.LEVI_PARALLEL.analyze(flat,opts).ready,false);
 input[99]={...input[99],open:150,close:150,high:151,low:149};assert.equal(globalThis.LEVI_PARALLEL.analyze(input,opts).ready,false);
});
test('paired study freezes both models, survives persistence, resolves once on six exact forward bars',()=>{
 let state={};observeChannels(state,{symbol:'TEST',bars:bars(),at:opts.now});assert.equal(state.channelComparison.paired,1);
 const frozen=structuredClone(state.channelComparison.pending.TEST);
 observeChannels(state,{symbol:'TEST',bars:bars(),at:opts.now+1000});assert.equal(state.channelComparison.paired,1);
 state=JSON.parse(JSON.stringify(state));const future=bars(106);future[105]={...future[105],open:120,close:120,high:121,low:119};
 observeChannels(state,{symbol:'TEST',bars:future,at:start+106*D});const r=channelReport(state);assert.equal(r.resolved,1);
 const expected=100*Math.abs(120-globalThis.LEVI_REGRESSION.levels(frozen.parallel,start+105*D).middle)/frozen.price;
 assert.equal(r.parallel.meanErrorPct,expected);assert.equal(r.parallel.containmentPct,0);
 observeChannels(state,{symbol:'TEST',bars:future,at:start+106*D+1000});assert.equal(channelReport(state).resolved,1);
});
test('gaps expire without invented results; stale history never starts a sample',()=>{
 const state={};observeChannels(state,{symbol:'TEST',bars:bars(),at:opts.now});
 observeChannels(state,{symbol:'TEST',bars:bars(110).filter((_,i)=>i!==102),at:start+110*D});assert.equal(channelReport(state).resolved,0);assert.equal(channelReport(state).expired,1);
 const stale={};observeChannels(stale,{symbol:'TEST',bars:bars(),at:start+120*D});assert.equal(channelReport(stale).paired,0);
});
test('channel drawing clips and distinguishes its three orange dashed lines',()=>{
 const input=bars(),a=globalThis.LEVI_PARALLEL.analyze(input,opts),calls=[],ctx=new Proxy({},{get:(_,k)=>(...v)=>calls.push([k,...v]),set:(_,k,v)=>{calls.push([k,v]);return true;}});
 globalThis.LEVI_PARALLEL.draw({ctx,analysis:a,view:input,x:i=>i,y:p=>p,bounds:{left:0,top:0,right:100,bottom:200}});
 assert.equal(calls.filter(c=>c[0]==='stroke').length,3);assert.ok(calls.some(c=>c[0]==='clip'));assert.ok(calls.some(c=>c[0]==='strokeStyle'&&c[1]==='#ffb454'));
});
test('installer patch preserves installed code and rejects unknown observer anchors',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');const {patch}=await import('../scripts/patch-channel-monitor.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'channel-patch-test-'));
 try{
  fs.mkdirSync(path.join(root,'lib'));const server="// owner custom code\n  const sf={};\nnew Set([...SYMBOLS,...open]);\nconst bars=await candles(symbol);observeEntryComparison();",report='function report(){return {startedAt:r?.startedAt};}';
  fs.writeFileSync(path.join(root,'server.mjs'),server);fs.writeFileSync(path.join(root,'lib/strategy-followup.mjs'),report);patch(root);
  const result=fs.readFileSync(path.join(root,'server.mjs'),'utf8');assert.ok(result.includes('// owner custom code'));assert.ok(result.includes('observeChannels(strategyReviewState'));patch(root);assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),result);
  fs.writeFileSync(path.join(root,'server.mjs'),'unknown engine');assert.throws(()=>patch(root));assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),'unknown engine');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

 test('active long or short suspends channel geometry only and resumes with fresh history',()=>{
  const state={};observeChannels(state,{symbol:'TEST',bars:bars(),at:opts.now});
  const saved={entryPrice:110,setup:{channelProtection:{targetPrice:125}},stopPrice:108};state.position=saved;
  const prior={parallel:globalThis.LEVI_PARALLEL,regression:globalThis.LEVI_REGRESSION};
  try{
   globalThis.LEVI_PARALLEL=globalThis.LEVI_REGRESSION={analyze:()=>{throw Error('unexpected channel analysis');}};
   observeChannels(state,{symbol:'TEST',bars:new Proxy([],{get(){throw Error('unexpected history read');}}),positionOpen:true,at:opts.now+1});
   assert.equal(state.channelComparison.pending.TEST,undefined);assert.equal(state.channelComparison.lastSample.TEST,undefined);
   assert.equal(channelReport(state).suspended,1);assert.equal(channelReport(state).resolved,0);assert.equal(channelReport(state).expired,0);
   assert.equal(state.position,saved);
  }finally{globalThis.LEVI_PARALLEL=prior.parallel;globalThis.LEVI_REGRESSION=prior.regression;}
  observeChannels(state,{symbol:'TEST',bars:bars(110),positionOpen:false,at:start+110*D});
  assert.equal(state.channelComparison.pending.TEST.end,start+109*D);
 });

test('technical channel observer also suspends while a position is open',async()=>{
 const {technicalObservation}=await import('../lib/market-attention.mjs');
 const r=technicalObservation({symbol:'TESTUSDT',positionOpen:true,bars:new Proxy([],{get(){throw Error('history accessed');}})});
 assert.equal(r.ready,false);assert.equal(r.watch,false);assert.equal(r.reason,'POSITION_MANAGEMENT_ONLY');assert.equal(r.channel,undefined);
});
