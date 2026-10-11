import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('background refresh preserves status and overlapping loads are skipped',async()=>{
  const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
  const start=source.indexOf('let dashboardLoadInFlight=');
  const end=source.indexOf('\nasync function authenticatedControl',start);
  const labels=[];let release;let requests=0;
  const context=vm.createContext({MODE:'mode',AGENT:'agent',LIVEACC:'live',
    put:(id,label)=>labels.push(label),mode(){},render(){},loadActionJournal:async()=>{},
    J:async url=>{requests++;if(url==='mode')return {mode:'demo'};return {};},console,
    $:()=>({classList:{remove(){}}})});
  vm.runInContext(source.slice(start,end),context);
  await vm.runInContext('load()',context);await vm.runInContext('load()',context);
  assert.deepEqual(labels,['מתחבר…']);
  context.J=async()=>{requests++;return new Promise(r=>{release=r;});};
  const pending=vm.runInContext('load()',context);const before=requests;
  await vm.runInContext('load()',context);assert.equal(requests,before);
  context.J=async()=>({});release({mode:'demo'});await pending;
  assert.deepEqual(labels,['מתחבר…']);
});
