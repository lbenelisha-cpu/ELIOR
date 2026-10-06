import test from 'node:test';
import assert from 'node:assert/strict';
import {assessEntryCost} from '../lib/binance-entry-cost.mjs';
const book={asks:[['100.01','100']],bids:[['100','100']]};
test('liquid quote passes with both-side fee in percentage points',()=>{
 const r=assessEntryCost(book,1000);
 assert.equal(r.ok,true);assert.ok(r.estimatedCostPct>0.29&&r.estimatedCostPct<0.32);
 assert.ok(Math.abs(r.maxCostPct-.49)<1e-9);
});
test('wide spread, missing depth and large order impact block entry',()=>{
 assert.equal(assessEntryCost({asks:[[101,100]],bids:[[100,100]]},1000).code,'WAIT_SPREAD');
 assert.equal(assessEntryCost(book,20000).code,'WAIT_LIQUIDITY');
 assert.equal(assessEntryCost({asks:[[100.01,100]],bids:[[100,.1]]},1000).code,'WAIT_LIQUIDITY');
 assert.equal(assessEntryCost({asks:[[100.01,1],[101,100]],bids:[[100,100]]},1000).code,'WAIT_LIQUIDITY');
});
test('fees can block narrow spread; invalid and crossed books fail closed',()=>{
 assert.equal(assessEntryCost(book,1000,{feePct:.3}).code,'WAIT_COST');
 for(const b of [null,{asks:[[99,100]],bids:[[100,100]]},{asks:[[100,NaN]],bids:[[99,1]]}])assert.equal(assessEntryCost(b,1000).ok,false);
 assert.equal(assessEntryCost(book,1000,{feePct:NaN}).ok,false);
});
