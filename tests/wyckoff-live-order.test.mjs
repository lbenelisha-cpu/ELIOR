import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PersistedMarketOrder} from '../lib/persisted-market-order.mjs';
import {trackedLivePositions,liveFillAction} from '../lib/wyckoff-live-positions.mjs';
test('base commission and partial sale retain correct tracked quantity and frozen target',()=>{
 const trade={initialPeak:120,targetPrice:128.4,stopPrice:1,strategyId:'WYCKOFF_D1_V1'};
 const buy=liveFillAction({executedQty:'1',cummulativeQuoteQty:'100',status:'FILLED',orderId:1},{params:{symbol:'BTCUSDT',side:'BUY'},meta:{wyckoffTrade:trade}},[{commissionAsset:'BTC',commission:'.001'}]);
 assert.equal(buy.qty,.999);assert.equal(buy.wyckoffTrade.stopPrice,94);
 const sell={symbol:'BTCUSDT',type:'SELL',qty:.4};
 const p=trackedLivePositions([sell,buy]).BTCUSDT;assert.ok(Math.abs(p.qty-.599)<1e-10);assert.equal(p.targetPrice,128.4);
 assert.deepEqual(trackedLivePositions([{...sell,qty:.599},sell,buy]),{});
});
test('live intent persists before submission; restart queries unknown order without posting again',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wy-order-'));try{
  const file=path.join(dir,'pending.json'),ledger=new PersistedMarketOrder(file);let posts=0,fills=0,id;
  await assert.rejects(ledger.submit({symbol:'BTCUSDT',side:'BUY'},{wyckoffTrade:{initialPeak:120}},async p=>{posts++;id=p.newClientOrderId;assert.equal(JSON.parse(fs.readFileSync(file)).params.newClientOrderId,id);throw Error('timeout');},()=>{}));
  await assert.rejects(ledger.submit({}, {},()=>{},()=>{}),/PENDING/);
  const resumed=new PersistedMarketOrder(file);
  await resumed.recover(async p=>{assert.equal(p.params.newClientOrderId,id);return {status:'FILLED',executedQty:'1',cummulativeQuoteQty:'100'};},async(o,p)=>{fills++;assert.equal(p.wyckoffTrade.initialPeak,120);});
  assert.equal(posts,1);assert.equal(fills,1);assert.equal(resumed.pending,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('partial live order keeps intent until terminal status; fill journal failure keeps it for recovery',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wy-order-'));try{
  const ledger=new PersistedMarketOrder(path.join(dir,'pending.json'));
  await assert.rejects(ledger.submit({symbol:'BTCUSDT'},{},async()=>({status:'PARTIALLY_FILLED',executedQty:'0.5'}),()=>{}),/AWAITING/);assert.ok(ledger.pending);
  await assert.rejects(ledger.recover(async()=>({status:'FILLED',executedQty:'1'}),()=>{throw Error('journal unavailable');}));assert.ok(ledger.pending);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
