import test from 'node:test';import assert from 'node:assert/strict';
import {externalBinanceEntry} from '../lib/manual-holding-adoption.mjs';
import {trackedLivePositions,liveBalancePnl} from '../lib/wyckoff-live-positions.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {buildNetTradeJournal} from '../lib/net-trade-journal.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
const symbol='BTCUSDT',b={asset:'BTC',qty:.001,free:.001,usdtPrice:99000,valueUsdt:99},t={symbol,id:100,time:100000,isBuyer:true,qty:'.001',quoteQty:'100',commission:'0',commissionAsset:'USDT'};
test('verified manual BTC gets all exit rules and current quantity without archived dust',()=>{
 const a=externalBinanceEntry(b,[t],200000);assert.equal(a.wyckoffTrade.targetPrice,150000);assert.equal(a.wyckoffTrade.stopPrice,99000);assert.equal(a.wyckoffTrade.minProfitHoldMs,0);assert.equal(a.sourcePurchaseAt,new Date(100000).toISOString());
 const p=trackedLivePositions([a])[symbol];assert.equal(p.qty,.001);assert.equal(binancePositionExit(p,99000).sell,true);
 assert.equal(binancePositionExit({...p,peakPrice:100000,profitFloorArmed:false,effectiveStopPrice:99000},150000).reason,'BROKER_TAKE_PROFIT_50_PERCENT');
 const closed=[{type:'BUY',symbol,qty:.01,price:100000,wyckoffTrade:{}},{type:'SELL',symbol,qty:.00999,price:100000}].reverse();assert.equal(trackedLivePositions([a,...closed])[symbol].qty,.001);
});
test('unknown entry, unmatched wallet and missing purchase time cannot be enrolled',()=>{
 assert.throws(()=>externalBinanceEntry({...b,qty:.002},[t]),/NOT_VERIFIED/);assert.throws(()=>externalBinanceEntry(b,[]),/NOT_VERIFIED/);assert.equal(externalBinanceEntry({asset:'USDT',qty:100,valueUsdt:100},[]),null);
});
test('adoption creates an accounting baseline, not an extra historical purchase or fee',()=>{
 const a=externalBinanceEntry(b,[t],200000),sale={type:'SELL',symbol,qty:.001,price:105000,amountUsdt:105,commissions:[],at:new Date(300000).toISOString(),status:'FILLED'};
 assert.equal(liveBalancePnl(b,[a]).entryPrice,100000);const rows=buildNetTradeJournal([sale,a]);assert.equal(rows.length,1);assert.equal(rows[0].netPnlUsdt,5);
});
const now=Date.parse('2026-10-20T15:00:00Z'),env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
async function adopt({avgPrice=100,bid=100,side='buy'}={}){
 const state=initialState(now);let written;
 const broker={snapshot:async()=>({account:{tradingRules:{}},positions:[{id:'p',tradableInstrumentId:1,side,qty:2,avgPrice,stopLoss:null}],orders:[],history:[]}),instruments:async()=>[{name:'AAPL',tradableInstrumentId:1,type:'EQUITY'}],details:async()=>({quotingCurrency:'USD',tickSize:[{leftRangeLimit:0,tickSize:.01}]}),quote:async()=>({bp:bid}),write:async(a,i)=>{written=i;return {};}};
 await runCycle({state,save:async()=>{},broker,env,now:()=>now});return {state,written};
}
test('manual Colmex long is enrolled with broker average cost and receives SL1/TP50, not a fresh buy',async()=>{
 const {state,written}=await adopt();assert.equal(state.positions[0].entryMode,'manual_external');assert.equal(written.kind,'PROTECTION');assert.equal(written.stopLoss,99);assert.equal(written.takeProfit,150);
});
test('manual Colmex already below stop closes; unknown price and shorts remain unowned',async()=>{
 assert.equal((await adopt({bid:98})).written.kind,'CLOSE');assert.equal((await adopt({avgPrice:null})).state.positions.length,0);assert.equal((await adopt({side:'sell'})).state.positions.length,0);
});
test('manual Colmex peak uses prices observed after enrollment and protects +9% at +10%',async()=>{
 const {state,written}=await adopt({bid:110});assert.equal(written.stopLoss,109);assert.equal(state.positions[0].targetPrice,150);
});
