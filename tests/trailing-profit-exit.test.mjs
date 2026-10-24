import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import {TRAILING_EXIT_POLICY,applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {liveFillAction} from '../lib/wyckoff-live-positions.mjs';
import {initialState,runCycle,reconcile} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
const pos=()=>applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:100,qty:2,peakPrice:100});
test('activation is not a take-profit sale; peak +10% protects +9 percentage points',()=>{
 const p=pos();assert.equal(binancePositionExit(p,103.99).sell,false);assert.equal(p.effectiveStopPrice,99);
 assert.equal(binancePositionExit(p,104).sell,false);assert.equal(p.effectiveStopPrice,104);assert.equal(p.targetPrice,null);
 assert.equal(binancePositionExit(p,110).sell,false);assert.equal(p.effectiveStopPrice,109);assert.equal(p.trailingGapPp,1);
 assert.equal(binancePositionExit(p,109).reason,'PROFIT_FLOOR4_TRAIL1PP_EXIT');
});
test('loss boundary, fixed profit floor, high-water ratchet and restart survive lower prices',()=>{
 assert.equal(binancePositionExit(pos(),99).reason,'TRAIL_STOP_LOSS_1_PERCENT');
 const p=pos();binancePositionExit(p,104.5);assert.equal(p.effectiveStopPrice,104);assert.equal(binancePositionExit(p,104).sell,true);
 const q=pos();binancePositionExit(q,115);assert.equal(q.effectiveStopPrice,114);binancePositionExit(q,114.5);assert.equal(q.effectiveStopPrice,114);
 const restored=JSON.parse(JSON.stringify(q));applyTrailingExitPolicy(restored);assert.equal(restored.effectiveStopPrice,114);assert.equal(binancePositionExit(restored,113).sell,true);
});
test('fills anchor initial stop and activation to actual execution, not intent price',()=>{
 const r=liveFillAction({executedQty:'2',cummulativeQuoteQty:'200',status:'FILLED',orderId:1},{params:{symbol:'ABCUSDT',side:'BUY'},at:new Date().toISOString(),meta:{wyckoffTrade:{...pos(),entryPrice:105}}},[]);
 assert.equal(r.wyckoffTrade.entryPrice,100);assert.equal(r.wyckoffTrade.activationPrice,104);assert.equal(r.wyckoffTrade.effectiveStopPrice,99);assert.equal(r.wyckoffTrade.targetPrice,null);
});
test('chart displays active trailing floor rather than a fixed profit ceiling',()=>{
 const c={};vm.runInNewContext(fs.readFileSync(new URL('../trade-risk.js',import.meta.url),'utf8'),c);const p=pos();binancePositionExit(p,110);
 const r=c.LEVI_TRADE_RISK.levels(p);assert.equal(r.trailing,true);assert.equal(r.armed,true);assert.equal(r.stop,109);assert.equal(r.protectedPnl,18);
 assert.equal(c.LEVI_TRADE_RISK.levels({entryPrice:100,qty:2}),null);
});
test('Binance journal persistence retains policy, armed state and floor for a restart',()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),start=source.indexOf('function persistLivePeak('),end=source.indexOf('const liveExecution=',start);
 let writes=0;const p=pos();p.entryAt='2026-10-20T15:00:00Z';binancePositionExit(p,110);
 const buy={type:'BUY',symbol:'ABCUSDT',wyckoffTrade:{exitPolicy:'FIXED_TP4_SL1_V1',entryAt:p.entryAt,peakPrice:100}};
 const ctx={liveActionLog:[buy],tradingPositions:()=>({ABCUSDT:p}),saveLiveActionLog:()=>{writes++;return true;}};vm.runInNewContext(source.slice(start,end)+';persistLivePeak("ABCUSDT",p);',{...ctx,p});
 assert.equal(writes,1);const restored=JSON.parse(JSON.stringify(buy.wyckoffTrade));assert.equal(restored.exitPolicy,TRAILING_EXIT_POLICY);assert.equal(restored.profitFloorArmed,true);assert.equal(restored.effectiveStopPrice,109);
 applyTrailingExitPolicy({...restored,entryPrice:100});assert.equal(restored.peakPrice,110);
});
const now=Date.parse('2026-10-20T15:00:00Z'),env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
async function cycle(bid,peakPrice=100,brokerStop=99,takeProfit=null){
 const state=initialState(now);state.positions=[{...pos(),symbol:'AAPL',id:'p',instrumentId:1,peakPrice,tickSize:[{leftRangeLimit:0,tickSize:.01}]}];let written;
 const p={id:'p',tradableInstrumentId:1,side:'buy',qty:2,stopLoss:brokerStop,takeProfit};
 await runCycle({state,save:async()=>{},env,now:()=>now,broker:{snapshot:async()=>({account:{tradingRules:{}},state:{},positions:[p],orders:[],history:[]}),quote:async()=>({bp:bid}),write:async(a,i)=>{written=structuredClone(i);return {};}}});return {state,written,p};
}
test('Colmex clears old fixed TP and raises broker SL to +9% at a +10% observed peak',async()=>{
 const {written,state,p}=await cycle(110,100,99,104);assert.equal(written.kind,'PROTECTION');assert.equal(written.stopLoss,109);assert.equal(written.takeProfit,null);
 reconcile(state,{positions:[{...p,stopLoss:109,takeProfit:104}],orders:[],history:[]},now+1);assert.ok(state.pending);
 reconcile(state,{positions:[{...p,stopLoss:109,takeProfit:null}],orders:[],history:[]},now+2);assert.equal(state.pending,null);
});
test('Colmex does not sell merely at +4%, retains old SL at exact boundary, and never lowers a broker stop',async()=>{
 assert.equal((await cycle(104)).written,undefined);
 const clear=await cycle(104,100,99,104);assert.equal(clear.written.kind,'PROTECTION');assert.equal(clear.written.stopLoss,99);assert.equal(clear.written.takeProfit,null);
 const raised=await cycle(110,100,109.5,104);assert.equal(raised.written.stopLoss,109.5);
 const closed=await cycle(109,110);assert.equal(closed.written.kind,'CLOSE');assert.equal(closed.written.qty,2);
});
