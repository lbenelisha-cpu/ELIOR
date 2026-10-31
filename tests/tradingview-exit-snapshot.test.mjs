import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';

const source=fs.readFileSync(new URL('../tradingview-exit-snapshot.js',import.meta.url),'utf8');
const context={};vm.runInNewContext(source,context);
const {build,MAX_AGE}=context.LEVI_EXIT_SNAPSHOT;
const now=Date.parse('2026-10-31T11:10:00Z');
function fixture(){
 const p={strategyId:'WYCKOFF_5M_V1',entryPrice:100,qty:2,entryAt:new Date(now-3600000).toISOString(),peakPrice:106,
  exitSettings:{takeProfitPct:50,stopLossPct:1,profitActivationPct:4,trailingGapPp:2},price:105,positionQuoteAt:now-1000};
 applyTrailingExitPolicy(p);
 p.brokerProtection={status:'ACTIVE',stopPrice:103.5,verifiedAt:now-1500};
 return {mode:'live',receivedAt:now,agent:{agents:[{symbol:'TAOUSDT',position:'LONG',staleData:false,strategy:p}]},
  account:{connected:true,updatedAt:new Date(now-2000).toISOString(),balances:[{asset:'TAO',qty:2,valueUsdt:210}]}};
}
test('exports the actual execution floor, including retained stronger protection, without changing a position',()=>{
 const s=fixture(),p=s.agent.agents[0].strategy;
 p.effectiveStopPrice=104.75;applyTrailingExitPolicy(p);
 const before=JSON.stringify(s),r=build(s,'TAOUSDT',now);
 assert.equal(r.ok,true);assert.equal(r.stop,104.75);assert.equal(r.target,150);assert.equal(r.activation,104);assert.equal(r.brokerStop,103.5);
 assert.equal(r.at,now-2000);assert.equal(r.data.split('|')[1],'BINANCE:TAOUSDT');
 assert.equal(binancePositionExit(structuredClone(p),r.stop,now).sell,true);
 assert.equal(binancePositionExit(structuredClone(p),r.stop+.01,now).sell,false);
 assert.equal(JSON.stringify(s),before);
 assert.doesNotMatch(r.data,/secret|qty|connected|exitSettings/);
});
test('activation is not a sale, and frozen channel activation is carried through from the server',()=>{
 const s=fixture(),p=s.agent.agents[0].strategy;
 p.peakPrice=101;p.effectiveStopPrice=99;p.profitFloorArmed=false;applyTrailingExitPolicy(p);
 p.activationPrice=102.345;
 let r=build(s,'TAOUSDT',now);assert.equal(r.armed,false);assert.equal(r.stop,99);assert.equal(r.activation,102.345);
 p.price=98.9;r=build(s,'TAOUSDT',now);assert.equal(r.reached,'STOP');
 p.price=150;r=build(s,'TAOUSDT',now);assert.equal(r.reached,'TARGET');
});
test('rejects stale, future, disconnected, sold, demo, manual and mismatched holdings; refresh cannot redate an old quote',()=>{
 const cases=[s=>s.error=true,s=>s.mode='demo',s=>s.account.connected=false,s=>s.account.error='offline',
  s=>s.receivedAt=now-MAX_AGE-1,s=>s.receivedAt=now+1,s=>s.account.updatedAt=new Date(now-MAX_AGE-1).toISOString(),
  s=>s.agent.agents[0].strategy.positionQuoteAt=now-MAX_AGE-1,s=>s.agent.agents[0].strategy.positionQuoteAt=null,
  s=>s.agent.agents[0].staleData=true,s=>s.agent.agents[0].position='CASH',s=>s.account.balances=[],
  s=>s.account.balances[0].valueUsdt=1,s=>s.account.balances[0].qty=1,s=>s.agent.agents[0].accountOnly=true,
  s=>s.agent.agents[0].strategy.exitPolicy='UNKNOWN',s=>s.agent.agents[0].strategy.qty=0,
  s=>s.agent.agents[0].strategy.entryAt=new Date(now+10000).toISOString(),
  s=>s.agent.agents[0].strategy.effectiveStopPrice=NaN,s=>s.agent.agents[0].strategy.targetPrice=null,
  s=>s.agent.agents[0].strategy.activationPrice=undefined];
 for(const mutate of cases){const s=fixture();mutate(s);assert.equal(build(s,'TAOUSDT',now).ok,false,String(mutate));}
 assert.equal(build(fixture(),'BTCUSDT',now).ok,false);
 assert.equal(build(fixture(),'TAO|USDT',now).ok,false);
 assert.equal(build(fixture(),'TAOUSDT',now+MAX_AGE).ok,false);
});
test('unverified broker stops are not advertised as verified while planned exit remains available',()=>{
 for(const mutate of [p=>p.brokerProtection.status='MISSING',p=>p.brokerProtection.verifiedAt=now-MAX_AGE-1,p=>p.brokerProtection.hasUnsettledFill=true]){
  const s=fixture();mutate(s.agent.agents[0].strategy);const r=build(s,'TAOUSDT',now);assert.equal(r.ok,true);assert.equal(r.brokerStop,0);
 }
});
test('UI copy is read-only, rechecks freshness, handles clipboard denial and clears the prior symbol',async()=>{
 let clock=now,callback,copied=0;
 const node=()=>({children:[],textContent:'',value:'',classList:{add(){}},append(...items){this.children.push(...items);},setAttribute(){},focus(){},select(){},isConnected:true});
 class Clock extends Date{static now(){return clock;}}
 const ctx={Date:Clock,document:{createElement:node},navigator:{clipboard:{async writeText(){copied++;throw Error('denied');}}},setInterval(fn){callback=fn;}};
 vm.runInNewContext(source,ctx);const api=ctx.LEVI_EXIT_SNAPSHOT,host=node(),s=fixture();
 api.render(host,s,'TAOUSDT');const ui=host._exitUI;
 await ui.button.onclick();assert.equal(copied,1);assert.match(ui.field.value,/LEVI_EXIT_V1\|BINANCE:TAOUSDT/);assert.match(ui.copied.textContent,/העתק את הטקסט/);
 clock+=MAX_AGE;await ui.button.onclick();assert.equal(copied,1);assert.equal(ui.button.disabled,true);assert.equal(ui.field.hidden,true);
 clock=now;api.render(host,s,'TAOUSDT');await ui.button.onclick();api.render(host,s,'BTCUSDT');assert.equal(ui.field.value,'');
 api.render(host,s,'TAOUSDT');clock+=MAX_AGE;callback();assert.equal(ui.button.disabled,true);
});

test('very small asset prices export as decimal text that Pine can parse',()=>{
 const s=fixture(),p=s.agent.agents[0].strategy;
 p.entryPrice=1e-8;p.effectiveStopPrice=9.9e-9;p.targetPrice=1.5e-8;p.activationPrice=1.04e-8;p.price=1.02e-8;
 const r=build(s,'TAOUSDT',now),fields=r.data.split('|');
 assert.equal(r.ok,true);assert.equal(fields[5],'0.0000000099');assert.equal(Number(fields[5]),p.effectiveStopPrice);
});
