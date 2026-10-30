import test from 'node:test';
import assert from 'node:assert/strict';
import {accountTradeActions,createExternalCostReader} from '../lib/binance-external-cost.mjs';
import {liveBalancePnl,trackedLivePositions} from '../lib/wyckoff-live-positions.mjs';
import {externalBinanceEntry} from '../lib/manual-holding-adoption.mjs';

// Synthetic split-order fixture: old dust was removed outside Spot trading.
// No account identifiers or network calls are used in these tests.
const symbol='TESTUSDT';
const fill=(id,orderId,qty,price,time,isBuyer=true)=>({symbol,id,orderId,qty:String(qty),quoteQty:String(qty*price),price:String(price),time,isBuyer,commission:String(isBuyer?qty*.001:qty*price*.001),commissionAsset:isBuyer?'TEST':'USDT'});
const old=[fill(1,10,.02,2000,1000),fill(2,11,.0199,2050,2000,false)];
const recent=[fill(3,20,.008,2200,3000),fill(4,20,.012,2210,3001),fill(5,20,.01,2220,3001),fill(6,20,.008,2230,3002)];
const trades=[...old,...recent],qty=.038*(1-.001);
const balance={asset:'TEST',qty,free:qty,locked:0,usdtPrice:2250,valueUsdt:qty*2250};
const expectedCost=recent.reduce((n,t)=>n+Number(t.quoteQty),0);
const turn=()=>new Promise(r=>setImmediate(r));

test('a complete four-fill buy matches the wallet after unrelated old dust removal',()=>{
 const cost=liveBalancePnl(balance,accountTradeActions(symbol,trades));
 assert.ok(Number.isFinite(cost.entryPrice),'all fills of the latest order must anchor the holding');
 assert.ok(Math.abs(cost.allocationIls-expectedCost)<1e-10);
 assert.ok(Math.abs(cost.entryPrice-expectedCost/qty)<1e-8);
 // The same evidence is used by the existing managed-holding importer.
 const adoption=externalBinanceEntry(balance,trades,5000,null,{stopLossPct:2});
 assert.equal(adoption.reason,'MANUAL_HOLDING_ADOPTED');
 assert.equal(adoption.qty,qty);
 assert.ok(Math.abs(adoption.price-expectedCost/qty)<1e-8);
 assert.equal(trackedLivePositions([adoption])[symbol].qty,qty);
});

test('all fills remain indivisible: a wallet matching only the last fill is not verified',()=>{
 const last=recent.at(-1),part=Number(last.qty)-Number(last.commission);
 const incomplete={...balance,qty:part,valueUsdt:part*balance.usdtPrice};
 assert.equal(liveBalancePnl(incomplete,accountTradeActions(symbol,trades)).pnlIls,null);
 assert.throws(()=>externalBinanceEntry(incomplete,trades),/COST_NOT_VERIFIED/);
 // Unknown extra deposits or reductions still fail the exact-quantity check.
 for(const amount of [qty+.001,qty-.001])assert.equal(liveBalancePnl({...balance,qty:amount,valueUsdt:amount*balance.usdtPrice},accountTradeActions(symbol,trades)).pnlIls,null);
});

test('separate buy orders are not combined to invent a new baseline',()=>{
 const separate=trades.map(t=>({...t,orderId:t.id>=5?21:t.orderId}));
 assert.equal(liveBalancePnl(balance,accountTradeActions(symbol,separate)).pnlIls,null);
 const noIds=trades.map(({orderId,...t})=>t);
 assert.equal(liveBalancePnl(balance,accountTradeActions(symbol,noIds)).pnlIls,null);
 assert.throws(()=>accountTradeActions(symbol,[{...recent[0],orderId:20.5}]),/INVALID_TRADE_ORDER_ID/);
 assert.throws(()=>accountTradeActions(symbol,[{...recent[0],orderId:Number.MAX_SAFE_INTEGER+1}]),/INVALID_TRADE_ORDER_ID/);
});

test('a subsequent documented partial sale is accounted for after the split buy',()=>{
 const sale=fill(7,21,.01,2300,4000,false),remainder=qty-.01;
 const cost=liveBalancePnl({...balance,qty:remainder,valueUsdt:remainder*balance.usdtPrice},accountTradeActions(symbol,[sale,...trades]));
 assert.ok(Math.abs(cost.allocationIls-expectedCost*remainder/qty)<1e-10);
});

test('read-only display enrichment uses the corrected order and does not enroll it',async()=>{
 const reader=createExternalCostReader({fetchTrades:async()=>trades});
 const account={connected:true,balances:[balance]},before=JSON.stringify(account);
 reader.decorate(account);await turn();
 const b=reader.decorate(account).balances[0];
 assert.equal(b.costStatus,'VERIFIED_QUANTITY');
 assert.ok(Math.abs(b.allocationIls-expectedCost)<1e-10);
 assert.equal(b.wyckoffTrade,undefined);
 assert.equal(JSON.stringify(account),before);
});
