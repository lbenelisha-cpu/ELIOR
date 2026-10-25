import test from 'node:test';
import assert from 'node:assert/strict';
import {stockScenario,protectionView,closedTradeSummary,marketHealthView} from '../lib/colmex-dashboard-math.mjs';
import {makeHandler} from '../netlify/functions/colmex-auto-status.mjs';
import {initialState} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
const now=Date.parse('2026-10-20T15:00:00Z');
const input={amount:800,entry:100,target:110,stop:99,buyFee:2,sellFee:2,slippagePct:1};
test('scenario respects total cash budget and charges fees and adverse exit slippage',()=>{
 const r=stockScenario(input);assert.equal(r.quantity,7);assert.equal(r.debit,702);assert.equal(r.unused,98);
 assert.ok(Math.abs(r.targetPnl-58.3)<1e-9);assert.ok(Math.abs(r.stopPnl+17.93)<1e-9);
 assert.ok(Math.abs(r.quantity*r.breakEven*.99-r.debit-2)<1e-9);assert.ok(r.debit<=input.amount);
});
test('unknown costs, invalid levels and unaffordable shares cannot produce reassuring profit',()=>{
 for(const changes of [{buyFee:''},{sellFee:null},{entry:0},{stop:101},{target:99},{amount:99},{buyFee:900},{slippagePct:11},{amount:Infinity}])assert.ok(stockScenario({...input,...changes}).error);
 assert.equal(stockScenario({...input,buyFee:0,sellFee:0,slippagePct:0}).targetPnl,80);
});
test('confirmed stop and pending update are separated and expire after two minutes',()=>{
 const p={symbol:'AAPL',effectiveStopPrice:108,brokerProtection:{stopLoss:103,takeProfit:150,verifiedAt:now}};
 const pending=protectionView(p,[{symbol:'AAPL',stopLoss:108}],now);assert.equal(pending.kind,'pending');assert.equal(pending.stop,103);
 assert.equal(protectionView(p,[],now+120001).kind,'unknown');assert.equal(protectionView({...p,brokerProtection:{...p.brokerProtection,stopLoss:null}},[],now).kind,'warning');
});
test('ledger never implies net profit or totals incomplete adjusted positions',()=>{
 assert.deepEqual(closedTradeSummary([{grossPnl:10},{grossPnl:null},{grossPnl:20,accountingAdjusted:true},{grossPnl:-3}]),{count:4,known:2,gross:7,net:null});
});
test('cached, stale and failed prices are not reported as a fresh live connection',()=>{
 assert.equal(marketHealthView({ok:true,cacheState:'MARKET_CLOSED_CACHE'},now).kind,'unknown');
 for(const m of [{ok:false},{ok:true,cacheState:'PROVIDER_UNAVAILABLE_CACHE'},{ok:true,observedAt:new Date(now-180001).toISOString()},{ok:true}])assert.notEqual(marketHealthView(m,now).kind,'good');
 assert.equal(marketHealthView({ok:true,observedAt:new Date(now).toISOString()},now).kind,'good');
});
test('status refuses corrupt persisted state and exposes every reservation without order payloads',async()=>{
 const env={CONTEXT:'production',COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK};
 let state={lastCycleAt:now};const h=makeHandler({env,storeFactory:()=>({get:async()=>({state})})});
 assert.equal((await h({httpMethod:'GET'})).statusCode,503);
 state=initialState(now);state.riskPending=[{kind:'CLOSE',id:'r',symbol:'AAPL',at:now,positionId:'p',qty:2}];
 const d=JSON.parse((await h({httpMethod:'GET'})).body);assert.equal(d.status,'PENDING_BROKER_CONFIRMATION');assert.equal(d.pendingActions.length,1);assert.equal(d.pendingActions[0].positionId,undefined);
});
