import test from 'node:test';
import assert from 'node:assert/strict';
import {tradeScenario,allocationParts,accountSummary,protectionState} from '../lib/binance-dashboard-math.mjs';
const scenario={amount:100,entry:50,target:55,stop:47.5,feePct:.1};
test('scenario includes both quote-currency fees and distinguishes debit from order size',()=>{
  const r=tradeScenario(scenario);
  assert.equal(r.quantity,2);assert.ok(Math.abs(r.debit-100.1)<1e-10);
  assert.ok(Math.abs(r.targetPnl-9.79)<1e-10);assert.ok(Math.abs(r.stopPnl+5.195)<1e-10);
  assert.ok(Math.abs(r.targetFees-.21)<1e-10);
  assert.ok(Math.abs(tradeScenario({...scenario,target:r.breakEven}).targetPnl)<1e-10);
  assert.ok(Math.abs(r.ratio-9.79/5.195)<1e-10);
});
test('invalid inputs never produce a zero or optimistic scenario',()=>{
  for(const patch of [{amount:''},{entry:null},{target:50},{stop:50},{stop:-1},{feePct:-1},{feePct:6},{amount:Infinity},{entry:1e-320}])assert.ok(tradeScenario({...scenario,...patch}).error);
  assert.equal(tradeScenario({...scenario,target:50.01}).ratio,null);
  assert.equal(tradeScenario({...scenario,feePct:0}).targetPnl,10);
});
test('unknown account values and missing costs remain unknown; zero is valid',()=>{
  assert.equal(accountSummary({mode:'live',account:null}),null);
  const account={totalValueUsdt:100,usdtFree:0,balances:[{asset:'BTC',valueUsdt:100,pnlIls:null}]};
  let r=accountSummary({mode:'live',account});assert.equal(r.cash,0);assert.equal(r.pnl,null);assert.equal(r.count,1);
  account.balances[0].pnlIls=0;r=accountSummary({mode:'live',account});assert.equal(r.pnl,0);
  account.unpricedAssets=['ETH'];assert.equal(accountSummary({mode:'live',account}).partial,true);
  assert.equal(allocationParts(100,null),null);assert.equal(allocationParts(100,101),null);assert.equal(allocationParts(100,0).cashPct,0);
});
test('protection status expires and never labels a missing bracket as protected',()=>{
  const now=Date.now(),h={ready:true,managedPositions:1,reconciliation:{checkedAt:new Date(now).toISOString()},missingProtection:[]};
  assert.equal(protectionState(h,now).kind,'good');assert.equal(protectionState(h,now+61000).kind,'unknown');
  assert.equal(protectionState({...h,missingProtection:['BTCUSDT']},now).kind,'warning');
  assert.equal(protectionState(null,now).kind,'unknown');
});
