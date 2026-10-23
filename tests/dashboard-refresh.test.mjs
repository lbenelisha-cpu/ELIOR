import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('background refresh preserves status and overlapping loads are skipped',async()=>{
  const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
  const start=source.indexOf('let dashboardLoadInFlight=');
  const end=source.indexOf('\nasync function authenticatedControl',start);
  const labels=[];const releases=[];let requests=0;
  const context=vm.createContext({document:{hidden:false},window:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},activeView:"trade",MODE:'mode',AGENT:'agent',LIVEACC:'live',
    put:(id,label)=>{if(id==='#status')labels.push(label);},mode(){},render(){},loadActionJournal:async()=>{},
    J:async url=>{requests++;if(url==='mode')return {mode:'demo'};return {};},console,
    $:()=>({classList:{remove(){}}})});
  vm.runInContext(source.slice(start,end),context);
  await vm.runInContext('load()',context);await vm.runInContext('load()',context);
  assert.deepEqual(labels,['מתחבר…']);
  context.J=async()=>{requests++;return new Promise(r=>{releases.push(r);});};
  const pending=vm.runInContext('load()',context);const before=requests;
  await vm.runInContext('load()',context);assert.equal(requests,before);
  context.J=async()=>({});for(const release of releases)release({mode:'demo'});await pending;
  assert.deepEqual(labels,['מתחבר…']);
});
test('LIVE market first paint proceeds while the signed account is pending, then marks failed verification',async()=>{
 const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
 const start=source.indexOf('let dashboardLoadInFlight='),end=source.indexOf('\nasync function authenticatedControl',start);
 const rendered=[],labels=[];let rejectAccount;
 const ctx=vm.createContext({document:{hidden:false},window:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},activeView:"trade",MODE:'mode',AGENT:'agent',LIVEACC:'live',currentLiveAccount:null,AbortSignal,
  put:(id,label)=>labels.push(label),mode(){},render:(agent,mode)=>rendered.push({agent,mode}),
  loadActionJournal:async()=>{},loadLiveAccount:async d=>{assert.equal(d.connected,false);return null;},
  J:async url=>url==='mode'?{mode:'live'}:url==='agent'?{agents:[{symbol:'BTCUSDT'}]}:new Promise((resolve,reject)=>{rejectAccount=reject;}),console,
  $:()=>({classList:{remove(){}}})});
 vm.runInContext(source.slice(start,end),ctx);const load=vm.runInContext('load()',ctx);
 await new Promise(setImmediate);assert.equal(rendered.length,1);assert.ok(labels.some(x=>x.includes('מאמת נתוני חשבון')));
 rejectAccount(Error('LIVE_REALIZED_FEE_VALUATION_REQUIRED'));await load;
 assert.equal(rendered.length,2);assert.equal(rendered[0].agent.agents[0].symbol,'BTCUSDT');assert.ok(labels.some(x=>x.includes('נתוני שוק זמינים')));assert.ok(!labels.includes('שרת לא זמין'));
});
test('chart begins when mode is known even if the agent snapshot has not arrived',async()=>{
 const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');let resolveAgent,chartCalls=0;const agent=new Promise(r=>resolveAgent=r);
 const ctx=vm.createContext({document:{hidden:false},window:{dispatchEvent(){}},CustomEvent:class{},activeView:'trade',selectedSymbol:'BTCUSDT',MODE:'mode',AGENT:'agent',LIVEACC:'account',currentLiveAccount:null,console,
 J:async url=>url==='mode'?{mode:'demo'}:agent,mode(){},loadChart:()=>{chartCalls++;},render(){},put(){},loadActionJournal:async()=>{},$:()=>null});
 vm.runInContext(source.slice(source.indexOf('let dashboardLoadInFlight='),source.indexOf('\nasync function authenticatedControl')),ctx);
 const task=ctx.load();await new Promise(setImmediate);assert.equal(chartCalls,1);resolveAgent({agents:[]});await task;
});
