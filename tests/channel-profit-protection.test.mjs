import test from 'node:test';import assert from 'node:assert/strict';
import {channelProtectionSnapshot,channelProfitLevels,validateChannelProfitEntry} from '../lib/channel-profit-protection.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {liveFillAction} from '../lib/wyckoff-live-positions.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
const settings={takeProfitPct:50,stopLossPct:2,profitActivationPct:5,trailingGapPp:.5,channelProfitProtection:true,channelActivationFraction:.5};
function setup(){const s={entryMode:'channel_breakout',level:100,channelWidth:4,signalTime:1};s.channelProtection=channelProtectionSnapshot(s,settings);return s;}
test('geometry freezes target at signal; actual fill anchors half-distance; stop and TP remain owner settings',()=>{
 const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:101,setup:setup(),qty:1},settings);
 assert.equal(p.channelProfitProtection.targetPrice,104);assert.equal(p.activationPrice,102.5);assert.equal(p.stopPrice,98.98);assert.equal(p.targetPrice,151.5);assert.equal(p.trailingGapPp,.5);
 assert.ok(Math.abs(p.profitActivationPct-1.4851485148514851)<1e-10);
 p.peakPrice=103;applyTrailingExitPolicy(p,settings);assert.equal(p.effectiveStopPrice,102.495);
 applyTrailingExitPolicy(p,{...settings,stopLossPct:3,trailingGapPp:2});assert.equal(p.effectiveStopPrice,102.495);assert.equal(p.activationPrice,102.5);
 assert.equal(binancePositionExit(p,102.49).sell,true);
});
test('legacy/manual positions unchanged; activation opt-in and safe validation',()=>{
 assert.equal(channelProtectionSnapshot({entryMode:'manual'},settings),null);assert.equal(channelProtectionSnapshot(setup(),{}),null);
 const p=applyTrailingExitPolicy({entryPrice:100},settings);assert.equal(p.activationPrice,105);
 for(const patch of [{channelProfitProtection:'true'},{channelActivationFraction:NaN},{channelActivationFraction:0},{channelActivationFraction:1}])assert.throws(()=>validateTradeSettings({...settings,...patch}));
 assert.throws(()=>validateChannelProfitEntry(setup(),104,settings),/TARGET_ALREADY/);
 assert.throws(()=>validateChannelProfitEntry(setup(),100,{...settings,takeProfitPct:1}),/ABOVE_TAKE_PROFIT/);
});
test('sub-0.1 percent activation stays valid without corrupting base settings on restart',()=>{
 const p=applyTrailingExitPolicy({entryPrice:103.99,setup:setup()},settings);assert.ok(p.profitActivationPct<.1);assert.equal(p.exitSettings.profitActivationPct,5);
 const restored=JSON.parse(JSON.stringify(p));applyTrailingExitPolicy(restored,settings);assert.equal(restored.activationPrice,p.activationPrice);
});
test('Binance actual fill rebuilds protection and slippage past target is explicit, preserving stop',()=>{
 const trade=applyTrailingExitPolicy({entryPrice:101,setup:setup()},settings);
 const intent={params:{symbol:'ABCUSDT',side:'BUY'},meta:{wyckoffTrade:trade},at:new Date().toISOString()};
 const order={executedQty:'1',cummulativeQuoteQty:'102',transactTime:Date.now()};
 const a=liveFillAction(order,intent,[]);assert.equal(a.wyckoffTrade.activationPrice,103);assert.equal(a.wyckoffTrade.stopPrice,99.96);
 const b=liveFillAction({...order,cummulativeQuoteQty:'105'},intent,[]);assert.equal(b.wyckoffTrade.channelProfitProtection.status,'TARGET_PASSED_AT_FILL');assert.ok(Math.abs(b.wyckoffTrade.stopPrice-102.9)<1e-10);assert.equal(b.wyckoffTrade.activationPrice,110.25);
 assert.equal(channelProfitLevels({entryPrice:101,setup:{channelProtection:{...setup().channelProtection,width:5}}}).status,'INVALID_PLAN');
});
