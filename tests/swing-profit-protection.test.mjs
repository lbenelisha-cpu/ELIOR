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
test('long and short use the configured trailing gap after frozen wave activation, survive serialization and never loosen a retained stop',()=>{
 for(const side of ['LONG','SHORT']){
  const protection=swingProtection(bars,{side,at});let p={side,entryPrice:100,peakPrice:150,lowPrice:50,targetPrice:30,swingProtection:protection};
  if(side==='LONG'){applyTrailingExitPolicy(p);assert.ok(Math.abs(p.effectiveStopPrice-149)<1e-9);const previous=p.effectiveStopPrice;p=JSON.parse(JSON.stringify(p));p.peakPrice=120;applyTrailingExitPolicy(p);assert.equal(p.effectiveStopPrice,previous);}
  else{p=shortExit(p,50,{takeProfitPct:70},{targetMode:'SETTINGS'});assert.ok(Math.abs(p.stopPrice-51)<1e-9);const previous=p.stopPrice;p=JSON.parse(JSON.stringify(p));p.lowPrice=70;p=shortExit(p,70,{takeProfitPct:70},{targetMode:'SETTINGS'});assert.equal(p.stopPrice,previous);}
  assert.deepEqual(p.swingProtection,protection);assert.equal(frozenSwingGap(p),protection.gapPct);
 }
});

test('wave mean sets activation independently from hard stop and configured trailing distance in both applications',async()=>{
 const {applyColmexExitPolicy}=await import('../lib/colmex-position-exit.mjs');
 const settings={stopLossPct:1,takeProfitPct:50,profitActivationPct:1,trailingGapPp:.5};
 for(const side of ['LONG','SHORT'])for(const app of ['BINANCE','COLMEX']){
  const w={version:'FIVE_CONFIRMED_SWINGS_V1',side,status:'ACTIVE',gapPct:2,waves:[2,3,1.5,2.5,1].map(pct=>({pct}))};
  let p={side,entryPrice:100,peakPrice:100,lowPrice:100,targetPrice:50,swingProtection:w,exitSettings:settings};
  const update=price=>{if(side==='LONG'){p.peakPrice=price;applyTrailingExitPolicy(p,settings);}else if(app==='COLMEX'){p.lastAsk=price;applyColmexExitPolicy(p,settings);}else p=shortExit(p,price,settings,{targetMode:'SETTINGS'});return p;};
  update(side==='LONG'?101.5:98.5);assert.equal(p.activationPrice,side==='LONG'?102:98);assert.equal(p.profitActivationPct,2);assert.equal(p.effectiveStopPrice??p.stopPrice,side==='LONG'?99:101);assert.equal(p.exitSettings.profitActivationPct,1);
  update(side==='LONG'?102:98);assert.equal(p.effectiveStopPrice??p.stopPrice,side==='LONG'?101.5:98.5);
  p=JSON.parse(JSON.stringify(p));update(side==='LONG'?101.8:98.2);assert.equal(p.effectiveStopPrice??p.stopPrice,side==='LONG'?101.5:98.5);assert.deepEqual(p.swingProtection,w);
 }
});
