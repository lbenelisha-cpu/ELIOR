import test from 'node:test';import assert from 'node:assert/strict';
import {buildTradeHistory,createTradeHistoryReader,historySymbol} from '../lib/binance-trade-history.mjs';
const symbol='TESTUSDT',start=Date.parse('2026-10-01T10:00:00Z');
const fill=(id,isBuyer,qty,price,extra={})=>({symbol,id,orderId:id,time:start+id*1000,isBuyer,qty:String(qty),price:String(price),quoteQty:String(qty*price),commission:'0',commissionAsset:'USDT',...extra});
test('exchange history matches partial sales using weighted cost and both quote commissions',()=>{
 const trades=[fill(1,true,10,10,{commission:'1'}),fill(2,false,4,12,{commission:'.4'}),fill(3,false,6,11,{commission:'.6'})];
 const result=buildTradeHistory(symbol,trades,[{symbol,type:'SELL',orderId:3,reason:'BROKER_STOP_LOSS'}]);
 assert.equal(result.rows[1].status,'PARTIAL');assert.equal(result.rows[0].status,'CLOSED');
 assert.ok(Math.abs(result.rows[1].netPnlUsdt-7.2)<1e-8);assert.ok(Math.abs(result.rows[0].netPnlUsdt-4.8)<1e-8);
 assert.equal(result.rows[0].entryPrice,10.1);assert.equal(result.rows[0].reason,'BROKER_STOP_LOSS');assert.equal(result.summary.unknownSales,0);
});
test('base fees reduce received quantity and multiple executions aggregate by order without duplicates',()=>{
 const buy=fill(1,true,2,100,{commission:'.002',commissionAsset:'TEST'}),sale=fill(2,false,1,110,{orderId:9}),sale2=fill(3,false,.998,110,{orderId:9});
 const r=buildTradeHistory(symbol,[sale2,buy,sale,buy]);assert.equal(r.rows.length,2);assert.equal(r.fillCount,3);assert.equal(r.rows[0].fillCount,2);assert.equal(r.rows[0].status,'CLOSED');assert.ok(Math.abs(r.rows[0].netPnlUsdt-19.78)<1e-8);
});
test('unknown purchase and third-asset fees never become net profit; a zero fee remains known',()=>{
 const r=buildTradeHistory(symbol,[fill(1,false,1,120),fill(2,true,1,100,{commission:'.001',commissionAsset:'BNB'}),fill(3,false,1,110)]);
 assert.equal(r.rows[0].netPnlUsdt,null);assert.equal(r.rows[0].unknownReason,'UNVALUED_FEE');assert.equal(r.rows[0].pnlBeforeOtherFeesUsdt,10);assert.equal(r.rows[2].unknownReason,'MISSING_BUY');
 assert.equal(buildTradeHistory(symbol,[fill(1,true,1,100,{commissionAsset:'BNB'}),fill(2,false,1,110)]).rows[0].netPnlUsdt,10);
});
test('dust retains its allocated cost for later buys and sales',()=>{
 const r=buildTradeHistory(symbol,[fill(1,true,10,1),fill(2,false,9,2),fill(3,true,1,4),fill(4,false,2,4)]);
 assert.equal(r.rows[2].status,'DUST');assert.equal(r.rows[0].netPnlUsdt,3);assert.equal(r.rows[0].entryPrice,2.5);
});
test('invalid symbols, malformed data and conflicting fills fail closed',()=>{
 for(const bad of ['BTCUSD','../USDT','BTCUSDT?token=x',null])assert.throws(()=>historySymbol(bad));
 for(const patch of [{symbol:'OTHERUSDT'},{qty:'NaN'},{commission:null},{commission:'-1'},{id:2**55},{time:Infinity},{orderId:'bad'}])assert.throws(()=>buildTradeHistory(symbol,[fill(1,true,1,100,patch)]));
 assert.throws(()=>buildTradeHistory(symbol,[fill(1,true,1,100),fill(1,true,2,100)]));
});
test('reader pages from the beginning, coalesces concurrent reads and caches per symbol',async()=>{
 let calls=0,clock=start;const batches=[[fill(1,true,1,100),fill(2,false,1,110)],[fill(3,true,1,120)]];
 const reader=createTradeHistoryReader({now:()=>clock,pageSize:2,fetchTrades:async(s,p)=>{assert.equal(s,symbol);assert.equal(p.fromId,calls===0?'0':'3');return batches[calls++];}});
 const [a,b]=await Promise.all([reader.read(symbol),reader.read(symbol)]);assert.equal(calls,2);assert.equal(a.complete,true);assert.deepEqual(a,b);await reader.read(symbol);assert.equal(calls,2);
});
test('reader declares a cap and rejects an incomplete failing response instead of returning a false full history',async()=>{
 const capped=createTradeHistoryReader({pageSize:1,maxPages:1,fetchTrades:async()=>[fill(1,true,1,100)]});assert.equal((await capped.read(symbol)).complete,false);
 let calls=0;const failed=createTradeHistoryReader({pageSize:1,fetchTrades:async()=>{if(calls++)throw Error('failed');return [fill(1,true,1,100)];}});await assert.rejects(failed.read(symbol));
 const repeated=createTradeHistoryReader({pageSize:1,fetchTrades:async()=>[fill(1,true,1,100)]});await assert.rejects(repeated.read(symbol),/PAGINATION/);
});
