import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {LiveWalletReconciler} from '../lib/live-wallet-reconciliation.mjs';
import {readLiveJournal} from '../lib/live-journal.mjs';
import {livePositionLedger,trackedLivePositions,liveBalancePnl} from '../lib/wyckoff-live-positions.mjs';
import {buildNetTradeJournal} from '../lib/net-trade-journal.mjs';
import {tradeCounts,tradeFeeTotals} from '../lib/trade-counts.mjs';
import {rsiSnapshot} from '../lib/rsi-screener.mjs';
import {assertLiveSpringRsi} from '../lib/wyckoff-spring-rsi.mjs';
import {manualSellQuantity} from '../lib/binance-manual-trades.mjs';
const t0=Date.parse('2026-10-25T18:00:00Z');
const buy={symbol:'BTCUSDT',type:'BUY',status:'FILLED',qty:2,executedQty:2,price:100,amountUsdt:200,commissions:[],orderId:1,at:new Date(t0-60000).toISOString(),wyckoffTrade:{strategyId:'WYCKOFF_5M_V1',peakPrice:110}};
const wallet=(qty,now=t0,locked=0)=>({connected:true,updatedAt:new Date(now).toISOString(),balances:qty?[{asset:'BTC',free:qty-locked,locked,qty,usdtPrice:100,valueUsdt:100*qty}]:[]});
function confirm(qty){const r=new LiveWalletReconciler(),positions=trackedLivePositions([buy]);assert.equal(r.observe(wallet(qty),positions,t0).ready,false);return r.observe(wallet(qty,t0+2000),positions,t0+2000).adjustments[0];}
test('two fresh snapshots remove a ghost without fabricating a sell or deleting the journal',()=>{
 const adjustment=confirm(0),actions=[adjustment,buy];
 assert.equal(adjustment.type,'POSITION_RECONCILIATION');
 assert.deepEqual(trackedLivePositions(actions),{});
 assert.deepEqual(buildNetTradeJournal(actions),[]);
 assert.deepEqual(tradeCounts(actions),{buys:1,sells:0,closed:0});
 assert.equal(actions[1],buy);
 assert.deepEqual(trackedLivePositions(JSON.parse(JSON.stringify(actions))),{});
});
test('confirmed quantity reduction preserves entry and high-water but marks accounting unknown',()=>{
 const adjustment=confirm(1.5),actions=[adjustment,buy],p=trackedLivePositions(actions).BTCUSDT;
 assert.equal(p.qty,1.5);assert.equal(p.peakPrice,110);assert.equal(p.entryAt,buy.at);
 assert.equal(liveBalancePnl(wallet(1.5).balances[0],actions).pnlIls,null);
 const sale={...buy,type:'SELL',qty:1.5,executedQty:1.5,amountUsdt:160,price:160/1.5,orderId:2,at:new Date(t0+4000).toISOString()};
 const rows=buildNetTradeJournal([sale,...actions]);assert.equal(rows.length,1);assert.equal(rows[0].feesComplete,false);assert.equal(rows[0].netPnlUsdt,null);
});
test('a confirmed external reduction to dust leaves no active blocker, while retaining the remainder',()=>{
 const adjustment=confirm(.01),ledger=livePositionLedger([adjustment,buy]);
 assert.equal(adjustment.archiveAsDust,true);assert.deepEqual(ledger.positions,{});
 assert.equal(ledger.dust.BTCUSDT.qty,.01);assert.equal(ledger.dust.BTCUSDT.reason,'RECONCILED_REMAINDER');
 const next={...buy,qty:1,orderId:3,at:new Date(t0+4000).toISOString()};
 assert.equal(trackedLivePositions([next,adjustment,buy]).BTCUSDT.qty,1.01);
});
test('locked owned quantity is part of wallet holdings and excess deposits do not increase managed quantity',()=>{
 for(const [qty,locked] of [[2,2],[3,0]]){const r=new LiveWalletReconciler();const result=r.observe(wallet(qty,t0,locked),trackedLivePositions([buy]),t0);assert.equal(result.ready,true);assert.deepEqual(result.adjustments,[]);}
});
test('missing, malformed, stale, repeated and changing account evidence cannot confirm a reduction',()=>{
 for(const bad of [{}, {...wallet(0),connected:false},{...wallet(0),balances:null},wallet(0,t0-15001),wallet(0,t0+1),{...wallet(0),balances:[{asset:'BTC',qty:1,free:1,locked:-1}]}]){
  assert.throws(()=>new LiveWalletReconciler().observe(bad,trackedLivePositions([buy]),t0));
 }
 const r=new LiveWalletReconciler(),p=trackedLivePositions([buy]);
 r.observe(wallet(0),p,t0);assert.throws(()=>r.observe(wallet(0),p,t0),/NOT_NEW/);
 assert.equal(r.observe(wallet(.5,t0+2000),p,t0+2000).adjustments.length,0);
 assert.equal(r.observe(wallet(2,t0+4000),p,t0+4000).ready,true);
 assert.equal(r.observe(wallet(0,t0+6000),p,t0+6000).adjustments.length,0);
});
test('a new entry identity cannot inherit an earlier candidate or reconciliation event',()=>{
 const r=new LiveWalletReconciler(),p=trackedLivePositions([buy]);r.observe(wallet(0),p,t0);
 const newer={...buy,at:new Date(t0+1000).toISOString()};
 assert.equal(r.observe(wallet(0,t0+2000),trackedLivePositions([newer]),t0+2000).adjustments.length,0);
 const adjustment=confirm(0);assert.equal(trackedLivePositions([adjustment,newer]).BTCUSDT.qty,2);
});
test('journal loader rejects missing, malformed and invalid journals without replacing them',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-journal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'actions.json');
 assert.throws(()=>readLiveJournal(file),/MISSING/);
 for(const value of ['{','{}','[null]',JSON.stringify([{...buy,qty:'NaN'}])]){fs.writeFileSync(file,value);assert.throws(()=>readLiveJournal(file));assert.equal(fs.readFileSync(file,'utf8'),value);}
 fs.writeFileSync(file,JSON.stringify([confirm(0),buy]));assert.equal(readLiveJournal(file).length,2);
});
test('canceled and expired executed quantities contribute once to net P&L, counts and fees',()=>{
 for(const status of ['CANCELED','EXPIRED','EXPIRED_IN_MATCH']){
  const sell={...buy,type:'SELL',status,qty:1,executedQty:1,amountUsdt:110,price:110,orderId:2,commissions:[{asset:'USDT',amount:.1}],at:new Date(t0).toISOString()};
  const actions=[sell,sell,buy],rows=buildNetTradeJournal(actions);
  assert.equal(rows.length,1);assert.ok(Math.abs(rows[0].netPnlUsdt-9.9)<1e-9);
  assert.deepEqual(tradeCounts(actions),{buys:1,sells:1,closed:0});
  assert.equal(tradeFeeTotals(actions).sellUsdt,.1);
  assert.equal(buildNetTradeJournal([{...sell,executedQty:0},buy]).length,0);
 }
});
test('ISO and numeric event times produce the same live RSI including the forming candle',()=>{
 const bucket=Math.floor(t0/300000)*300000,bars=Array.from({length:20},(_,i)=>({close:100+i,closeTime:bucket-(20-i-1)*300000-1}));
 const live={close:80,observedAt:bucket+1000};
 const numeric=rsiSnapshot(bars,live),iso=rsiSnapshot(bars,{...live,observedAt:new Date(live.observedAt).toISOString()});
 assert.deepEqual(iso,numeric);assert.equal(iso.includesOpenCandle,true);
 assert.equal(rsiSnapshot(bars,{...live,observedAt:'invalid'}).includesOpenCandle,false);
});
test('last entry check rejects an invalidated peak even when RSI remains low, including a reverted intrabar spike',()=>{
 const bucket=Math.floor(t0/300000)*300000,trade={initialPeak:100,targetPrice:107,rsiBucket:bucket,rsiCloses:Array.from({length:30},(_,i)=>200-i*3)};
 assert.throws(()=>assertLiveSpringRsi(trade,101,bucket+1000),/INVALIDATED/);
 assert.doesNotThrow(()=>assertLiveSpringRsi(trade,99,bucket+1000));
 assert.throws(()=>assertLiveSpringRsi(trade,99,bucket+1000,{openTime:bucket,high:100}),/INVALIDATED/);
});
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
function sellRig({preflightError=false,postCancelError=false,uncertain=false,brokerFill=false}={}){
 let released=false,restored=0,sales=0,reads=0,owned=true;
 const info={status:'TRADING',quoteAsset:'USDT',baseAssetPrecision:8,filters:[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'100'},{filterType:'MIN_NOTIONAL',minNotional:'5'}]};
 const c={liveStateHealth:{journalReady:true},liveManagedPositions:()=>owned?{BTCUSDT:{qty:2,effectiveStopPrice:99}}:{},getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),recordLiveError(){},manualSellQuantity,requireLivePrice:()=>100,streams:{BTCUSDT:{}},recordLiveFill(){},signedBinancePost(){},
  symbolExchangeInfo:async()=>{if(preflightError)throw Error('INFO_TIMEOUT');return info;},
  nativeProtection:{rows:{BTCUSDT:{phase:'ACTIVE',params:{quantity:'2'}}},reconcile:async()=>{if(brokerFill)owned=false;},release:async()=>{released=true;c.nativeProtection.rows={};},sync:async()=>{restored++;c.nativeProtection.rows.BTCUSDT={phase:'ACTIVE'};}},
  getLiveAccountSnapshot:async()=>{reads++;if(released&&postCancelError)throw Error('ACCOUNT_TIMEOUT');return wallet(2,Date.now(),released?0:2);},
  liveOrders:{pending:null,submit:async()=>{sales++;if(uncertain){c.liveOrders.pending={};throw Error('ORDER_TIMEOUT');}return {status:'FILLED'};}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function placeLiveMarketSell('),source.indexOf('function persistLivePeak(')),c);
 return {run:()=>c.placeLiveMarketSell('BTCUSDT'),get released(){return released},get restored(){return restored},get sales(){return sales},get reads(){return reads}};
}
test('exit preflight failure leaves the original bracket in place',async()=>{const r=sellRig({preflightError:true});await assert.rejects(r.run(),/INFO_TIMEOUT/);assert.equal(r.released,false);assert.equal(r.sales,0);});
test('known pre-submit failure after cancellation attempts verified protection restoration',async()=>{const r=sellRig({postCancelError:true});await assert.rejects(r.run(),/ACCOUNT_TIMEOUT/);assert.equal(r.released,true);assert.equal(r.restored,1);assert.equal(r.sales,0);});
test('unknown market execution is not overlapped by replacement protection or a second sale',async()=>{const r=sellRig({uncertain:true});await assert.rejects(r.run(),/ORDER_TIMEOUT/);assert.equal(r.sales,1);assert.equal(r.restored,0);});
test('broker fill discovered before cancellation prevents any new sale or wallet reads',async()=>{const r=sellRig({brokerFill:true});assert.equal((await r.run()).status,'CLOSED_AT_BROKER');assert.equal(r.released,false);assert.equal(r.sales,0);assert.equal(r.reads,0);});
test('automatic sale validates market filters and rereads quantity after unlocking owned protection',async()=>{const r=sellRig();assert.equal((await r.run()).status,'FILLED');assert.equal(r.released,true);assert.equal(r.reads,2);assert.equal(r.sales,1);});

function reconcileRig({nativePending=false,saveFails=false}={}){
 let reads=0;const start=Date.now()-10000;
 const c={liveActionLog:[structuredClone(buy)],liveStateHealth:{journalReady:true,reconciliation:{}},liveWalletReconciler:new LiveWalletReconciler(),lastDisplayAccount:null,
  liveOrders:{recover:async()=>{}},signedBinanceGet(){},recordLiveFill(){},
  nativeProtection:{rows:nativePending?{BTCUSDT:{phase:'ACTIVE',hasUnsettledFill:true}}:{},uncertain:()=>false,reconcile:async()=>{}},
  getLiveAccountSnapshot:async()=>wallet(1,start+(reads++)*2000),
  saveLiveActionLog:()=>!saveFails};
 c.liveManagedPositions=()=>trackedLivePositions(c.liveActionLog);
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function reconcileLiveHoldings('),source.indexOf('const LIVE_ALLOCATION_FILE=')),c);
 return c;
}
test('server reconciliation appends a durable adjustment and releases stale quantity blockers after confirmation',async()=>{
 const c=reconcileRig();await c.reconcileLiveHoldings();assert.equal(c.liveStateHealth.reconciliation.ready,false);
 await c.reconcileLiveHoldings();assert.equal(c.liveStateHealth.reconciliation.ready,true);assert.equal(c.liveActionLog.length,2);assert.equal(c.liveManagedPositions().BTCUSDT.qty,1);
});
test('server never treats an unsettled native partial execution as an external wallet adjustment',async()=>{
 const c=reconcileRig({nativePending:true});await c.reconcileLiveHoldings();await c.reconcileLiveHoldings();
 assert.equal(c.liveActionLog.length,1);assert.equal(c.liveManagedPositions().BTCUSDT.qty,2);
 assert.equal(c.liveStateHealth.reconciliation.ready,false);assert.deepEqual(Array.from(c.liveStateHealth.reconciliation.unsettled),['BTCUSDT']);
});
test('failed adjustment persistence rolls back the memory projection and keeps entries blocked',async()=>{
 const c=reconcileRig({saveFails:true});await c.reconcileLiveHoldings();
 await assert.rejects(c.reconcileLiveHoldings(),/JOURNAL_UNAVAILABLE/);assert.equal(c.liveActionLog.length,1);assert.equal(c.liveManagedPositions().BTCUSDT.qty,2);assert.equal(c.liveStateHealth.reconciliation.ready,false);
});
test('manual sell remains available for a balance locked by protection',()=>{
 for(const qty of [0,1]){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,hidden:false,open:false,addEventListener(){}});return nodes.get(id);};
  const context={document:{getElementById:get},window:{LEVI_MANUAL_TRADES:{context:()=>({mode:'live',symbol:'BTCUSDT',capabilities:{version:1},account:{balances:[{asset:'BTC',qty,free:0,locked:qty}]}})}},setInterval(){}};
  vm.runInNewContext(fs.readFileSync(new URL('../binance-manual-trades.js',import.meta.url),'utf8'),context);
  assert.equal(get('manualSellBtn').disabled,qty===0);
 }
});
