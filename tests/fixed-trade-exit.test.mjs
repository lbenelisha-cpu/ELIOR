import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {FIXED_EXIT_POLICY,applyFixedExitPolicy,fixedTradeLevels} from '../lib/fixed-trade-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {liveFillAction} from '../lib/wyckoff-live-positions.mjs';
import {initialState,reconcile,runCycle} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import {AutoBroker} from '../lib/colmex-auto-broker.mjs';
const position=()=>applyFixedExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:100,qty:2,entryAt:new Date().toISOString(),peakPrice:100});
test('4% target and 1% stop activate on entry, inclusive boundaries, no peak ratchet or week hold',()=>{
 const p=position();assert.equal(p.minProfitHoldMs,0);
 assert.deepEqual(binancePositionExit(p,103.99),{sell:false,reason:'FIXED_TP4_SL1_HOLD'});
 assert.equal(binancePositionExit(p,104).reason,'FIXED_TAKE_PROFIT_4_PERCENT');
 assert.equal(binancePositionExit(p,99).reason,'FIXED_STOP_LOSS_1_PERCENT');
 assert.equal(binancePositionExit(p,99.01).sell,false);
 assert.equal(p.stopPrice,99);assert.equal(p.targetPrice,104);
 const old={...p,exitPolicy:'SPRING_GAIN_LOCK_80_STOP_10_V1',minProfitHoldMs:604800000,effectiveStopPrice:90,trailingStopPrice:105};
 applyFixedExitPolicy(old);assert.equal(old.effectiveStopPrice,99);assert.equal(old.trailingStopPrice,null);assert.equal(binancePositionExit(old,98).sell,true);
});
test('thresholds reanchor to weighted actual fill, not requested price',()=>{
 const a=liveFillAction({executedQty:'2',cummulativeQuoteQty:'200',status:'FILLED',orderId:1},{params:{symbol:'ABCUSDT',side:'BUY'},at:new Date().toISOString(),meta:{wyckoffTrade:{...position(),entryPrice:101,targetPrice:105.04}}},[]);
 assert.equal(a.wyckoffTrade.entryPrice,100);assert.equal(a.wyckoffTrade.targetPrice,104);assert.equal(a.wyckoffTrade.stopPrice,99);
});
test('chart only renders real fixed-policy positions with known quantity; money is gross',()=>{
 const context={};vm.runInNewContext(fs.readFileSync(new URL('../trade-risk.js',import.meta.url),'utf8'),context);
 const ui=context.LEVI_TRADE_RISK;
 assert.equal(ui.levels({entryPrice:100,qty:2}),null);assert.equal(ui.levels({...position(),qty:null}),null);
 const risk=ui.levels(position());assert.equal(risk.profit,8);assert.equal(risk.loss,2);assert.equal(risk.target,104);
 assert.equal(fixedTradeLevels(100,2).maxProfit,8);assert.equal(fixedTradeLevels(0,2),null);
});
const now=Date.parse('2026-10-20T15:00:00Z'),env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
function owned(){return {...position(),id:'p',instrumentId:1,symbol:'AAPL',tickSize:[{leftRangeLimit:0,tickSize:.01}]};}
test('Colmex migrates owned position, closes full quantity at target with zero hold',async()=>{
 const s=initialState(now);s.positions=[{...owned(),exitPolicy:'SPRING_GAIN_LOCK_80_STOP_10_V1',minProfitHoldMs:604800000}];let written;
 const broker={snapshot:async()=>({positions:[{id:'p',tradableInstrumentId:1,qty:2,side:'buy',stopLoss:90}],orders:[],history:[]}),quote:async()=>({bp:104}),write:async(a,i)=>{written=structuredClone(i);return {};}};
 await runCycle({state:s,save:async()=>{},broker,env,now:()=>now});
 assert.equal(written.kind,'CLOSE');assert.equal(written.qty,2);assert.equal(written.reason,'FIXED_TAKE_PROFIT_4_PERCENT');
});
test('Colmex updates both broker thresholds and reconciles both before new work',async()=>{
 const s=initialState(now);s.positions=[owned()];let written;
 const p={id:'p',tradableInstrumentId:1,qty:2,side:'buy',stopLoss:90,takeProfit:110};
 const broker={snapshot:async()=>({positions:[p],orders:[],history:[]}),quote:async()=>({bp:101}),write:async(a,i)=>{written=structuredClone(i);return {};}};
 await runCycle({state:s,save:async()=>{},broker,env,now:()=>now});
 assert.equal(written.kind,'PROTECTION');assert.equal(written.stopLoss,99);assert.equal(written.takeProfit,104);
 reconcile(s,{positions:[{...p,stopLoss:99,takeProfit:110}],orders:[],history:[]},now+1);assert.ok(s.pending);
 reconcile(s,{positions:[{...p,stopLoss:99,takeProfit:104}],orders:[],history:[]},now+2);assert.equal(s.pending,null);
 s.pending=written;reconcile(s,{positions:[],orders:[],history:[]},now+3);assert.equal(s.pending,null);assert.equal(s.positions.length,0);
});
test('broker adapter submits documented absolute SL and TP together, without retry',async()=>{
 let body;const b=new AutoBroker({env,deadline:now+24000,now:()=>now,fetchImpl:async(url,opts)=>{assert.match(url,/positions\/p$/);assert.equal(opts.method,'PATCH');body=JSON.parse(opts.body);return {ok:true,json:async()=>({s:'ok'})};}});b.reader.authorize=async()=> 'mock-token';
 await b.write('123',{kind:'PROTECTION',positionId:'p',stopLoss:99,takeProfit:104});assert.deepEqual(body,{stopLoss:99,takeProfit:104});
});
