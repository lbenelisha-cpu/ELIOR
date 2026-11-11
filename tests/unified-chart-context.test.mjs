import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
const helper=source.match(/function chartPositionSnapshot\(\)\{[^\n]+/)[0];
test('chart venue selects the correct position source, including simultaneous Spot and SHORT',()=>{
 const ctx={selectedChartMarket:'SPOT',currentMode:'live',currentAgentData:{agents:[{symbol:'BTCUSDT',position:'LONG'}]},currentLiveAccount:{balances:[]},futuresManualStatus:{positions:[{symbol:'BTCUSDT',side:'SHORT'}]}};
 vm.createContext(ctx);vm.runInContext(helper,ctx);
 assert.equal(ctx.chartPositionSnapshot().agent,ctx.currentAgentData);assert.equal(ctx.chartPositionSnapshot().shortTrading,undefined);
 ctx.selectedChartMarket='FUTURES';assert.equal(ctx.chartPositionSnapshot().venue,'BINANCE_FUTURES');assert.equal(ctx.chartPositionSnapshot().shortTrading,ctx.futuresManualStatus);assert.equal(ctx.chartPositionSnapshot().agent,undefined);
 ctx.futuresManualStatus=null;assert.equal(ctx.chartPositionSnapshot().shortTrading,null);
});
