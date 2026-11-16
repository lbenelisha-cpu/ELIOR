import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
const helper=source.match(/function chartPositionSnapshot\(\)\{[^\n]+/)[0];
test('chart venue selects the correct position source, including simultaneous Spot and SHORT',()=>{
 const ctx={selectedChartMarket:'SPOT',currentMode:'live',currentAgentData:{agents:[{symbol:'BTCUSDT',position:'LONG'}]},currentLiveAccount:{balances:[]},futuresChartStatus:{positions:[{symbol:'BTCUSDT',side:'SHORT'}]}};
 vm.createContext(ctx);vm.runInContext(helper,ctx);
 assert.equal(ctx.chartPositionSnapshot().agent,ctx.currentAgentData);assert.equal(ctx.chartPositionSnapshot().shortTrading,undefined);
 ctx.selectedChartMarket='FUTURES';assert.equal(ctx.chartPositionSnapshot().venue,'BINANCE_FUTURES');assert.equal(ctx.chartPositionSnapshot().shortTrading,ctx.futuresChartStatus);assert.equal(ctx.chartPositionSnapshot().agent,undefined);
 ctx.futuresChartStatus=null;assert.equal(ctx.chartPositionSnapshot().shortTrading,null);
});

function chartLifecycle(){
 const events=[];
 const context=vm.createContext({
  window:{LEVI_TRADE_AUTH:{read:()=>context.token},LEVI_FUTURES_TABLE:{update(){}},dispatchEvent:event=>events.push(event.type)},
  Event,MODE:'mode',currentMode:'live',token:'device',J:()=>{},futuresManualStatus:{from:'manual'},manualTradeCapabilities:null,futuresManualCapabilities:null,
  publishEntryPolicySnapshot(){},renderTradingRules(){},renderFuturesShortStatus(){},renderTradeControlStatus(){},tradeControlWorking:false,
  put(){},$:()=>null
 });
 vm.runInContext(fs.readFileSync(new URL('../binance-mode-refresh.js',import.meta.url),'utf8'),context);
 vm.runInContext('window.LEVI_MODE_REFRESH=LEVI_MODE_REFRESH',context);
 vm.runInContext(source.slice(source.indexOf('const modeRefresh='),source.indexOf('function refreshShortStatus()')),context);
 vm.runInContext(source.slice(source.indexOf('function mode(s){'),source.indexOf('function buyReasonLabel(')),context);
 context.read=()=>vm.runInContext('futuresChartStatus',context);
 context.poll=()=>vm.runInContext('modeRefresh.refresh()',context);
 return {context,events};
}
test('independent mode reads replace chart positions, preserve manual trade state, and ignore partial scanner mode',async()=>{
 const {context:c,events}=chartLifecycle();
 const f={checkedAt:10,positions:[{symbol:'BTCUSDT',stopPrice:8}]};
 c.J=async()=>({mode:'live',shortTrading:f});
 await c.poll();assert.equal(c.read(),f);assert.equal(c.futuresManualStatus.from,'manual');
 c.mode({mode:'live',tradeControl:{paused:false}});assert.equal(c.read(),f);
 const closed={checkedAt:20,positions:[]};
 c.J=async()=>({mode:'live',shortTrading:closed});
 await c.poll();assert.equal(c.read(),closed);
 c.J=async()=>({mode:'live',shortTrading:{policy:{},checkedAt:25}});
 await c.poll();assert.equal(c.read(),null);
 assert.deepEqual(events,['levi:chart-position-update','levi:chart-position-update','levi:chart-position-update']);
});
test('DEMO and device changes reject in-flight private data and a denied poll clears chart levels',async()=>{
 const {context:c}=chartLifecycle();
 const value={mode:'live',shortTrading:{positions:[{symbol:'BTCUSDT'}]}};
 c.J=async()=>value;await c.poll();assert.equal(c.read(),value.shortTrading);
 let resolve;c.J=()=>new Promise(r=>resolve=r);
 const inflight=c.poll();await Promise.resolve();
 c.mode({mode:'demo'});c.mode({mode:'live'});assert.equal(c.read(),null);
 resolve(value);await assert.rejects(inflight,/CONTEXT_CHANGED/);assert.equal(c.read(),null);
 const old=c.poll();await Promise.resolve();c.token='new-device';resolve(value);await assert.rejects(old,/CONTEXT_CHANGED/);
 c.J=async()=>value;await c.poll();
 c.J=async()=>{throw Object.assign(Error('unauthorized'),{status:401});};
 await assert.rejects(c.poll(),/unauthorized/);assert.equal(c.read(),null);
 c.token=null;c.J=async()=>value;await c.poll();assert.equal(c.read(),null);
});
