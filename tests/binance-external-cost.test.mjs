import test from 'node:test';
import assert from 'node:assert/strict';
import {accountTradeActions,createExternalCostReader} from '../lib/binance-external-cost.mjs';
import {liveBalancePnl} from '../lib/wyckoff-live-positions.mjs';
const symbol='EXTUSDT',balance={asset:'EXT',qty:1.998,usdtPrice:120,valueUsdt:239.76};
const buy={symbol,id:1,time:1000,isBuyer:true,qty:'2',quoteQty:'200',commission:'.002',commissionAsset:'EXT'};
const turn=()=>new Promise(r=>setImmediate(r));
test('external fill cost includes base fees and reconciles remaining quantity after partial sells',()=>{
 const actions=accountTradeActions(symbol,[buy]);const p=liveBalancePnl(balance,actions);
 assert.equal(p.allocationIls,200);assert.ok(Math.abs(p.pnlIls-39.76)<1e-9);
 const sell={...buy,id:2,time:2000,isBuyer:false,qty:'.998',quoteQty:'110',commission:'0',commissionAsset:'USDT'};
 const remainder={...balance,qty:1,valueUsdt:120};const cost=liveBalancePnl(remainder,accountTradeActions(symbol,[sell,buy]));
 assert.ok(Math.abs(cost.allocationIls-200/1.998)<1e-9);
 assert.equal(liveBalancePnl({...balance,qty:3},actions).pnlIls,null);
 assert.throws(()=>accountTradeActions(symbol,[{...buy,symbol:'OTHERUSDT'}]));
});
test('display enrichment is nonblocking, deduplicates history GETs and never modifies execution data',async()=>{
 let calls=0,time=10000;let resolve;
 const reader=createExternalCostReader({now:()=>time,fetchTrades:()=>{calls++;return new Promise(r=>resolve=r);}});
 const snapshot={connected:true,balances:[balance]},before=JSON.stringify(snapshot);
 assert.equal(reader.decorate(snapshot).balances[0].costStatus,'LOADING_HISTORY');reader.decorate(snapshot);await turn();assert.equal(calls,1);
 resolve([buy]);await turn();const filled=reader.decorate(snapshot).balances[0];assert.equal(filled.costSource,'BINANCE_MY_TRADES');assert.equal(filled.allocationIls,200);
 assert.equal(JSON.stringify(snapshot),before);assert.equal(filled.wyckoffTrade,undefined);
 time+=61000;reader.decorate(snapshot);await turn();assert.equal(calls,2);resolve([buy]);await turn();
});
test('failures retain unknown cost and back off; changed wallet quantity never inherits cached P/L',async()=>{
 let calls=0;
 const reader=createExternalCostReader({fetchTrades:async()=>{calls++;throw Error('timeout');}});
 const snapshot={connected:true,balances:[balance]};reader.decorate(snapshot);await turn();
 const next=reader.decorate(snapshot);assert.equal(next.balances[0].costStatus,'HISTORY_UNAVAILABLE');assert.equal(calls,1);assert.equal(next.balances[0].pnlIls,undefined);
 const valid=createExternalCostReader({fetchTrades:async()=>[buy]});valid.decorate(snapshot);await turn();
 assert.equal(valid.decorate({connected:true,balances:[{...balance,qty:4}]}).balances[0].allocationIls,undefined);await turn();
});
