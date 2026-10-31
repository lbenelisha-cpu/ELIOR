import test from 'node:test';import assert from 'node:assert/strict';
import {channelProtectionSnapshot,channelProfitLevels,validateChannelProfitEntry} from '../lib/channel-profit-protection.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {liveFillAction} from '../lib/wyckoff-live-positions.mjs';
import {validateTradeSettings} from '../lib/trade-settings.mjs';
const settings={takeProfitPct:50,stopLossPct:2,profitActivationPct:5,trailingGapPp:.5,channelProfitProtection:true,channelActivationFraction:.5};
function setup(){const s={entryMode:'channel_breakout',level:100,channelWidth:4,signalTime:1};s.channelProtection={version:'CHANNEL_HALF_TARGET_V1',width:4,breakoutPrice:100,targetPrice:104,activationFraction:.5,signalTime:1};return s;}
test('geometry freezes target at signal; actual fill anchors half-distance; stop and TP remain owner settings',()=>{
 const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:101,setup:setup(),qty:1},settings);
 assert.equal(p.channelProfitProtection.targetPrice,104);assert.equal(p.activationPrice,102.5);assert.equal(p.stopPrice,98.98);assert.equal(p.targetPrice,151.5);assert.equal(p.trailingGapPp,.5);
 assert.ok(Math.abs(p.profitActivationPct-1.4851485148514851)<1e-10);
 p.peakPrice=103;applyTrailingExitPolicy(p,settings);assert.equal(p.effectiveStopPrice,102.495);
 applyTrailingExitPolicy(p,{...settings,stopLossPct:3,trailingGapPp:2});assert.equal(p.effectiveStopPrice,102.495);assert.equal(p.activationPrice,102.5);
 assert.equal(binancePositionExit(p,102.49).sell,true);
});
test('legacy/manual positions unchanged; activation opt-in and safe validation',()=>{
 assert.equal(channelProtectionSnapshot({entryMode:'manual'},settings),null);assert.equal(channelProtectionSnapshot(setup(),{}).version,'CHANNEL_TAKE_PROFIT_V2');
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

function targetSetup(width=10){const s={entryMode:'channel_breakout',level:100,channelWidth:width,signalTime:1};s.channelProtection=channelProtectionSnapshot(s,settings);return s;}
test('V2 takes profit at the frozen channel target while stop, activation and gap use owner settings',()=>{
 const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:101,setup:targetSetup(),qty:1},settings);
 assert.equal(p.targetPrice,110);assert.equal(p.profitActivationPct,5);assert.equal(p.stopLossPct,2);assert.equal(p.trailingGapPp,.5);
 assert.ok(Math.abs(p.activationPrice-106.05)<1e-10);assert.equal(p.stopPrice,98.98);assert.equal(p.exitSettings.takeProfitPct,50);
 assert.equal(binancePositionExit(p,110).sell,true);
 const restored=JSON.parse(JSON.stringify(p));applyTrailingExitPolicy(restored,{...settings,takeProfitPct:80,profitActivationPct:6});
 assert.equal(restored.targetPrice,110);assert.equal(restored.profitActivationPct,6);assert.equal(restored.effectiveStopPrice,p.effectiveStopPrice);
});
test('a close channel TP may exit before activation, without moving activation or silently replacing the target',()=>{
 const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:103.99,setup:targetSetup(4)},settings);
 assert.ok(p.takeProfitPct<.1);assert.equal(p.exitSettings.takeProfitPct,50);assert.equal(p.profitActivationPct,5);
 assert.doesNotThrow(()=>validateChannelProfitEntry(p.setup,103.99,settings));
 const r=JSON.parse(JSON.stringify(p));applyTrailingExitPolicy(r);assert.equal(r.targetPrice,104);
 assert.equal(binancePositionExit(r,104).sell,true);assert.equal(r.profitFloorArmed,false);
 assert.throws(()=>validateChannelProfitEntry(p.setup,104,settings),/TARGET_ALREADY/);
});
test('V2 actual Binance fills keep the absolute target, including slippage past it',()=>{
 const trade=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:101,setup:targetSetup(4)},settings);
 const intent={params:{symbol:'ABCUSDT',side:'BUY'},meta:{wyckoffTrade:trade},at:new Date().toISOString()};
 for(const price of [102,105]){
  const fill=liveFillAction({executedQty:'1',cummulativeQuoteQty:String(price),transactTime:Date.now()},intent,[]).wyckoffTrade;
  assert.equal(fill.targetPrice,104);assert.equal(fill.profitActivationPct,5);assert.ok(Math.abs(fill.stopPrice-price*.98)<1e-10);
  assert.equal(fill.exitSettings.takeProfitPct,50);
  if(price===105){assert.equal(fill.channelProfitProtection.status,'TARGET_PASSED_AT_FILL');assert.equal(binancePositionExit(fill,price).sell,true);}
 }
});
test('new channel target is automatic regardless of the legacy half-way opt-in and malformed geometry cannot enter',()=>{
 const s=targetSetup();
 assert.equal(channelProtectionSnapshot(s,{...settings,channelProfitProtection:false}).targetPrice,110);
 for(const width of [0,-1,NaN])assert.throws(()=>channelProtectionSnapshot({...s,channelWidth:width},settings),/INVALID_CHANNEL/);
 assert.throws(()=>validateChannelProfitEntry({...s,channelProtection:{...s.channelProtection,width:1}},101,settings),/TARGET_ALREADY/);
});
test('native Binance bracket receives the absolute channel target and retains owner stop',async()=>{
 const {nativeProtectionPlan}=await import('../lib/binance-native-protection.mjs');
 const p=applyTrailingExitPolicy({entryPrice:101,setup:targetSetup(),qty:1},settings);
 const info={symbol:'ABCUSDT',status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'10000'},{filterType:'PRICE_FILTER',tickSize:'.01',minPrice:'.01',maxPrice:'100000'},{filterType:'NOTIONAL',minNotional:'5'}]};
 const plan=nativeProtectionPlan('ABCUSDT',p,102,info,1);assert.equal(plan.target,110);assert.equal(plan.stop,98.98);assert.equal(plan.params.aboveStopPrice,'110');
});
test('Colmex V2 channel stop uses current owner settings without changing legacy volatility risk',async()=>{
 const {sizeRisk,positionRiskSettings}=await import('../lib/confirmed-risk-sizing.mjs');
 const {COLMEX_QUALITY_POLICY}=await import('../lib/confirmed-entry-quality.mjs');
 const risk=sizeRisk(101,800,settings,{version:COLMEX_QUALITY_POLICY.version,stopLossPolicy:'SETTINGS_ONLY_V1',atr:10,structureLow:90});
 assert.equal(risk.reason,'READY');assert.equal(risk.settings.stopLossPct,2);
 const p={setup:targetSetup(),riskPlan:{stopLossPct:3}};
 assert.equal(positionRiskSettings(p,settings).stopLossPct,2);
 assert.equal(positionRiskSettings({riskPlan:{stopLossPct:3}},settings).stopLossPct,3);
});
