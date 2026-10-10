import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {retainDecision} from '../lib/decision-chart-history.mjs';
const ctx=vm.createContext({Date});
vm.runInContext(fs.readFileSync(new URL('../binance-chart-decisions.js',import.meta.url),'utf8'),ctx);
const at='2026-10-10T12:00:00Z',time=Date.parse(at);
test('repeated checks retain timestamps/count; changed blockers and modes remain distinct',()=>{
 const row={at,mode:'demo',decision:'HOLD',buyReason:'TRADING_PAUSED'};
 let rows=retainDecision([],row);
 rows=retainDecision(rows,{...row,at:'2026-10-10T12:00:05Z'});
 assert.equal(rows.length,1);assert.equal(rows[0].checks,2);assert.equal(rows[0].firstAt,at);
 rows=retainDecision(rows,{...row,buyReason:'SPRING'});assert.equal(rows.length,2);
 rows=retainDecision(rows,{...row,mode:'live'});assert.equal(rows.length,3);
});
test('only true signals are green; failures and actual fills remain distinct',()=>{
 assert.equal(ctx.chartDecisionKind({analysisSignal:true,buyReason:'TRADING_PAUSED'}),'signal');
 assert.equal(ctx.chartDecisionKind({decision:'BUY_READY',analysisSignal:false}),'wait');
 assert.equal(ctx.chartDecisionKind({analysisError:'WAIT_FRESH_PRICE'}),'error');
 assert.equal(ctx.chartDecisionKind({type:'BUY'}),'fill');
});
test('groups share a candle, retain all details and exclude rows outside the chart',()=>{
 const candles=[{openTime:time-3600000,closeTime:time+3600000}];
 const groups=ctx.groupChartDecisions(candles,[{at,checks:5},{at,checks:2},{at:new Date(time+7200000).toISOString()},{at,type:'BUY'}]);
 assert.equal(groups.length,2);assert.equal(groups[0].checks,7);assert.equal(groups[0].rows.length,2);
});
test('future returns use only closed bars after the horizon; missing data stays pending',()=>{
 const row={at,price:100},day=86400000;
 const candles=[{closeTime:time+day-1,close:90},{closeTime:time+day+1000,close:110}];
 assert.equal(ctx.chartSignalReturn(row,candles,1,time+day),null);
 assert.ok(Math.abs(ctx.chartSignalReturn(row,candles,1,time+2*day)-10)<1e-10);
 assert.equal(ctx.chartSignalReturn(row,candles,7,time+10*day),null);
 assert.equal(ctx.chartSignalReturn(row,[{closeTime:time+10*day,close:120}],1,time+11*day),null);
});
