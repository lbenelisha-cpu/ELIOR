import test from 'node:test';import assert from 'node:assert/strict';
import {recordStrategyObservation,strategyFollowupReport} from '../lib/strategy-followup.mjs';
import {binanceStrategyReport} from '../lib/binance-strategy-followup.mjs';
import {renderStrategyReview} from '../strategy-followup-ui.js';
const at=Date.parse('2026-10-26T15:00Z'),comparison={variants:{legacy:true,confirmed:false,confirmed_trend:false,confirmed_volume:false,full_quality:false},legacy:{patternId:'one',entryMode:'spring_rsi_live'},confirmed:null};
test('forward observation is deduplicated across restarts and resolves only with a later closed price',()=>{
 let s={};const event={symbol:'AAPL',bars:[],at,price:100,version:'V1',comparison};recordStrategyObservation(s,event);s=JSON.parse(JSON.stringify(s));recordStrategyObservation(s,event);assert.equal(s.strategyFollowup.pending.length,1);
 recordStrategyObservation(s,{...event,at:at+1200000,bars:[{closeTime:at+1800000,close:110}]});assert.equal(strategyFollowupReport(s).observations[0].resolved,0);
 recordStrategyObservation(s,{...event,at:at+1800000,bars:[{closeTime:at+1800000,close:102}]});const report=strategyFollowupReport(s);assert.equal(report.observations[0].observed,1);assert.equal(report.observations[0].resolved,1);assert.ok(Math.abs(report.observations[0].meanReturnPct-2)<1e-8);assert.deepEqual(report.actual,[]);
});
test('missing continuation expires and is never counted as a losing trade',()=>{
 const s={},event={symbol:'AAPL',bars:[],at,price:100,version:'V1',comparison};recordStrategyObservation(s,event);recordStrategyObservation(s,{...event,at:at+3000000});const g=strategyFollowupReport(s).observations[0];assert.equal(g.expired,1);assert.equal(g.resolved,0);assert.equal(g.meanReturnPct,null);
});
test('Binance forward observations continue across UTC midnight for the 24-hour market',()=>{
 const start=Date.parse('2026-10-26T23:50Z'),s={},event={symbol:'BTCUSDT',bars:[],at:start,price:100,version:'BINANCE_CONFIRMED_QUALITY_V1',comparison};recordStrategyObservation(s,event);recordStrategyObservation(s,{...event,at:start+1800000,bars:[{closeTime:start+1800000,close:101}]});assert.equal(strategyFollowupReport(s).observations[0].resolved,1);
});
test('actual results are partitioned by route and policy; unverified fees do not become net zero or a win',()=>{
 const rows=[{entryMode:'spring_reclaim_confirmed',entryPolicyVersion:'V1',grossPnl:3,netPnl:null},{entryMode:'early_wave_confirmed',entryPolicyVersion:'V1',grossPnl:3,netPnl:2},{entryMode:'early_wave_confirmed',entryPolicyVersion:'V1',grossPnl:-1,netPnl:-2},{entryMode:'early_wave_confirmed',entryPolicyVersion:'V2',grossPnl:5,netPnl:4}];
 const r=strategyFollowupReport({},rows);assert.equal(r.actual.length,3);assert.equal(r.actual[0].netPnl,null);assert.equal(r.actual[0].netWinRate,null);assert.equal(r.actual[1].netPnl,0);assert.equal(r.actual[1].netWinRate,50);assert.equal(r.actual[1].maxClosedDrawdown,2);
});
test('Binance partial fills aggregate to one closed trade, retaining entry route and verified fees',()=>{
 const actions=[{type:'BUY',symbol:'ABCUSDT',at:new Date(at).toISOString(),qty:2,price:100,amountUsdt:200,orderId:1,commissions:[{asset:'USDT',amount:.2}],wyckoffTrade:{entryMode:'spring_reclaim_confirmed',entryPolicyVersion:'BINANCE_CONFIRMED_QUALITY_V1'}},...['1','2'].map((id,i)=>({type:'SELL',symbol:'ABCUSDT',at:new Date(at+(i+1)*60000).toISOString(),qty:1,price:102,amountUsdt:102,orderId:2+i,commissions:[{asset:'USDT',amount:.1}]}))];
 const report=binanceStrategyReport({},actions);assert.equal(report.actual.length,1);assert.equal(report.actual[0].closed,1);assert.equal(report.actual[0].entryMode,'spring_reclaim_confirmed');assert.ok(Math.abs(report.actual[0].netPnl-3.6)<1e-8);
});
test('review UI labels analytical price outcomes separately, clears old values and does not claim uninstalled code is active',()=>{
 const element=()=>({children:[],textContent:'',append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}}),host=element(),doc={createElement:element},text=node=>node.textContent+' '+node.children.map(text).join(' ');
 renderStrategyReview(host,{actual:[],observations:[]},{document:doc});assert.match(text(host),/אינה תשואת אסטרטגיה/);assert.match(text(host),/טרם נצברו/);
 renderStrategyReview(host,null,{document:doc});assert.match(text(host),/אינה מאשרת שהעדכון הותקן/);assert.doesNotMatch(text(host),/טרם נצברו/);
});
