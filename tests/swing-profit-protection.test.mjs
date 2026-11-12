import test from 'node:test';import assert from 'node:assert/strict';
import {swingProtection,frozenSwingGap} from '../lib/swing-profit-protection.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {shortExit} from '../lib/futures-short-policy.mjs';
const start=1800000000000,D=300000;
const bars=Array.from({length:80},(_,i)=>{const price=100+10*Math.cos((i-2)*Math.PI/5);return {openTime:start+i*D,closeTime:start+(i+1)*D,high:price+.1,low:price-.1,closed:true};});
const at=bars.at(-1).closeTime;
test('last five completed directional waves have an independently known percentage, with no future/open candles',()=>{
 for(const side of ['LONG','SHORT']){
  const p=swingProtection(bars,{side,at});assert.equal(p.status,'ACTIVE');assert.equal(p.waves.length,5);
  const expected=side==='LONG'?(110.1/89.9-1)*100:(1-89.9/110.1)*100;
  assert.ok(Math.abs(p.gapPct-expected)<1e-10);
  assert.deepEqual(swingProtection([...bars,{...bars.at(-1),openTime:at,closeTime:at+D,high:10000}],{side,at}),p);
  assert.deepEqual(swingProtection([...bars,{...bars.at(-1),closed:false,high:10000}],{side,at}),p);
  assert.ok(p.waves.every(w=>w.confirmedAt<=at));
 }
});
test('insufficient, unordered or wrong-timeframe history uses the original protection',()=>{
 for(const history of [[],bars.slice(0,20),[...bars].reverse(),bars.map(b=>({...b,closeTime:b.openTime+60000}))])assert.equal(swingProtection(history,{at}).status,'FALLBACK');
 const p=applyTrailingExitPolicy({entryPrice:100,peakPrice:106,swingProtection:swingProtection([],{at})});assert.equal(p.effectiveStopPrice,105);
});
test('long and short use the frozen extreme percentage, survive serialization and never loosen a retained stop',()=>{
 for(const side of ['LONG','SHORT']){
  const protection=swingProtection(bars,{side,at});let p={side,entryPrice:100,peakPrice:150,lowPrice:50,targetPrice:30,swingProtection:protection};
  if(side==='LONG'){applyTrailingExitPolicy(p);assert.ok(Math.abs(p.effectiveStopPrice-150*(1-protection.gapPct/100))<1e-9);const previous=p.effectiveStopPrice;p=JSON.parse(JSON.stringify(p));p.peakPrice=120;applyTrailingExitPolicy(p);assert.equal(p.effectiveStopPrice,previous);}
  else{p=shortExit(p,50,{takeProfitPct:70},{targetMode:'SETTINGS'});assert.ok(Math.abs(p.stopPrice-50*(1+protection.gapPct/100))<1e-9);const previous=p.stopPrice;p=JSON.parse(JSON.stringify(p));p.lowPrice=70;p=shortExit(p,70,{takeProfitPct:70},{targetMode:'SETTINGS'});assert.equal(p.stopPrice,previous);}
  assert.deepEqual(p.swingProtection,protection);assert.equal(frozenSwingGap(p),protection.gapPct);
 }
});
