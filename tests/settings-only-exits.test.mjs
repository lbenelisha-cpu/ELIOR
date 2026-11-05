import test from 'node:test';
import assert from 'node:assert/strict';
import {applySettingsExitPolicy,applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {nativeProtectionPlan} from '../lib/binance-native-protection.mjs';
const settings={takeProfitPct:50,stopLossPct:2,profitActivationPct:8,trailingGapPp:2};
const bnb=()=>({strategyId:'WYCKOFF_5M_V1',exitPolicy:'PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2',entryPrice:717.27,peakPrice:717.77,qty:.019985,effectiveStopPrice:702.93,setup:{channelProtection:{version:'CHANNEL_TAKE_PROFIT_V2',breakoutPrice:716,width:2.59,targetPrice:718.59}}});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
test('existing BNB uses menu TP instead of 718.59 while retaining its saved stop',()=>{
 const p=applySettingsExitPolicy(bnb(),settings);
 close(p.targetPrice,1075.905);close(p.activationPrice,774.6516);close(p.stopPrice,702.9246);
 assert.equal(p.effectiveStopPrice,702.93);assert.equal(p.profitFloorArmed,false);
 assert.equal(p.channelProfitProtection.mode,'REFERENCE_ONLY');
 assert.equal(binancePositionExit(p,718.59).sell,false);
 const restored=JSON.parse(JSON.stringify(p));applyTrailingExitPolicy(restored);
 close(restored.targetPrice,1075.905);assert.equal(restored.exitCalculationSource,'SETTINGS_V1');
});
test('menu activation and gap override legacy channel activation and never lower earned protection',()=>{
 const p=bnb();p.setup.channelProtection={...p.setup.channelProtection,version:'CHANNEL_HALF_TARGET_V1',activationFraction:.5};
 applySettingsExitPolicy(p,settings);close(p.activationPrice,774.6516);
 p.peakPrice=780;applySettingsExitPolicy(p,settings);close(p.effectiveStopPrice,765.6546);
 applySettingsExitPolicy(p,{...settings,takeProfitPct:60,stopLossPct:3,trailingGapPp:4});
 close(p.targetPrice,1147.632);close(p.effectiveStopPrice,765.6546);
});
test('native broker plan uses configured target after an existing channel position is migrated',()=>{
 const p=applySettingsExitPolicy({...bnb(),entryPrice:100,peakPrice:100,qty:1,effectiveStopPrice:98},settings);
 const info={symbol:'ABCUSDT',status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'10000'},{filterType:'PRICE_FILTER',tickSize:'.01',minPrice:'.01',maxPrice:'100000'},{filterType:'NOTIONAL',minNotional:'5'}]};
 const plan=nativeProtectionPlan('ABCUSDT',p,100,info,1);assert.equal(plan.target,150);assert.equal(plan.stop,98);
});
