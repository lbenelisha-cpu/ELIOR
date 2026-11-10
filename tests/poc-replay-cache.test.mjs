import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pocFixture as sourcePocFixture} from './helpers/poc-channel-fixture.mjs';
const pocFixture=options=>sourcePocFixture({...options,legacy:true});
function model(file){
 const ctx=vm.createContext({structuredClone});
 for(const name of ['regression-trend.js','parallel-channel.js',file])vm.runInContext(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),ctx);
 let calls=0;const engine=ctx.LEVI_PARALLEL;
 ctx.LEVI_PARALLEL={...engine,analyze(...args){calls++;return engine.analyze(...args);}};
 return {analyze:input=>ctx.LEVI_CHANNEL_POC.analyze(input),calls:()=>calls,ctx};
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('cached replay equals original for both sides, changing live price, corrected history and advancing closes',()=>{
 const old=model('tests/fixtures/channel-poc-before-cache.js'),cached=model('channel-poc-model.js');
 for(const direction of ['LONG','SHORT']){
  const f=pocFixture({side:direction});
  for(const side of ['LONG','SHORT'])for(const delta of [0,.2,-.2,2]){
   const input={...f,side,price:f.price+delta,now:f.now+1000,liveBar:{...f.liveBar,low:f.liveBar.low+delta,high:f.liveBar.high+delta}};
   assert.deepEqual(plain(cached.analyze(input)),plain(old.analyze(input)));
  }
  for(const key of ['open','high','low','close','volume','openTime','closeTime']){
   const input=structuredClone({...f,side:direction});input.bars[25][key]+=.01;
   assert.deepEqual(plain(cached.analyze(input)),plain(old.analyze(input)));
  }
  const input={...f,side:direction,bars:[...f.bars,{...f.liveBar,closed:true}],now:f.liveBar.closeTime+1000};
  assert.deepEqual(plain(cached.analyze(input)),plain(old.analyze(input)));
 }
});
test('repeated history skips channel replay without sharing mutable models or caching live decisions',()=>{
 const cached=model('channel-poc-model.js'),f={...pocFixture(),side:'LONG'};
 const result=cached.analyze(f),calls=cached.calls();assert.ok(result.model);
 result.model.anchorA.price=-1;result.model.profile.volumes[0]=-1;
 const next=cached.analyze({...f,price:f.price+2,now:f.now+1});
 assert.equal(cached.calls(),calls);assert.notEqual(next.model.anchorA.price,-1);assert.notEqual(next.model.profile.volumes[0],-1);
 assert.notEqual(next.reason,result.reason);assert.equal(next.conditions.at,f.now+1);
 // Replacing the geometry implementation cannot reuse its predecessor's cache.
 cached.ctx.LEVI_PARALLEL={analyze:()=>({ready:false})};assert.equal(cached.analyze(f).model,null);
});
test('cache is bounded and eviction recomputes the original answer',()=>{
 const cached=model('channel-poc-model.js'),f={...pocFixture(),side:'LONG'},expected=plain(cached.analyze(f));
 for(let i=0;i<140;i++){const input=structuredClone(f);input.bars[0].volume+=i+1;cached.analyze(input);}
 const before=cached.calls();assert.deepEqual(plain(cached.analyze(f)),expected);assert.ok(cached.calls()>before);
});
