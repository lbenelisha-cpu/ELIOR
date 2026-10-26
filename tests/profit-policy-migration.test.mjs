import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTradeSettingsRecord,TRADE_SETTINGS_VERSION,colmexSettingsRecord} from '../lib/trade-settings.mjs';
import {applyTrailingExitPolicy,TRAILING_EXIT_POLICY,LEGACY_TRAILING_EXIT_POLICY} from '../lib/trailing-profit-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {nativeProtectionPlan} from '../lib/binance-native-protection.mjs';
import {lease,stateKey} from '../lib/colmex-auto-store.mjs';
import {initialState} from '../lib/colmex-auto-runner.mjs';
const old={revision:7,values:{takeProfitPct:20,stopLossPct:2,profitActivationPct:4,trailingGapPp:2}};
test('stored settings migrate once; subsequent user edits survive reloads',()=>{
 const r=normalizeTradeSettingsRecord(old);assert.equal(r.revision,8);assert.equal(r.policyVersion,TRADE_SETTINGS_VERSION);
 assert.deepEqual(r.values,{takeProfitPct:20,stopLossPct:2,profitActivationPct:5,trailingGapPp:1});
 assert.deepEqual(normalizeTradeSettingsRecord(r),r);
 const custom={...r,values:{...r.values,profitActivationPct:7,trailingGapPp:2}};assert.deepEqual(normalizeTradeSettingsRecord(custom),custom);
 assert.equal(normalizeTradeSettingsRecord({}).revision,0);
});
test('old armed floor survives migration even when peak has not reached the new activation',()=>{
 const p={strategyId:'WYCKOFF_5M_V1',exitPolicy:LEGACY_TRAILING_EXIT_POLICY,entryPrice:100,peakPrice:104.5,profitFloorArmed:true,effectiveStopPrice:104};
 applyTrailingExitPolicy(p);assert.equal(p.exitPolicy,TRAILING_EXIT_POLICY);assert.equal(p.activationPrice,105);assert.equal(p.effectiveStopPrice,104);
 assert.equal(binancePositionExit(p,104.2).sell,false);assert.equal(p.effectiveStopPrice,104);
 assert.equal(binancePositionExit(p,104).sell,true);
});
test('5% activation protects 4%, then each additional percentage point advances the stop',()=>{
 const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:100,peakPrice:100});
 for(const [price,stop,armed] of [[104.99,99,false],[105,104,true],[106,105,true],[110,109,true]]){
  assert.equal(binancePositionExit(p,price).sell,false);assert.equal(p.effectiveStopPrice,stop);assert.equal(p.profitFloorArmed,armed);
 }
 const restored=JSON.parse(JSON.stringify(p));applyTrailingExitPolicy(restored);assert.equal(restored.effectiveStopPrice,109);
 assert.equal(binancePositionExit(restored,108.5).sell,true);
});
test('activation native Binance protection uses stop 104 at peak 105, not a trigger at the current price',()=>{
 const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:100,qty:2});binancePositionExit(p,105);
 const info={symbol:'ABCUSDT',status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'10000'},{filterType:'PRICE_FILTER',tickSize:'.01',minPrice:'.01',maxPrice:'10000'}]};
 const plan=nativeProtectionPlan('ABCUSDT',p,105,info,2);assert.equal(plan.params.belowStopPrice,'104');assert.equal(plan.params.aboveStopPrice,'150');
});
test('Colmex migration is persisted under CAS lease, and its revision agrees with the read API',async()=>{
 const state=initialState(1);delete state.settingsPolicyVersion;state.settings=old.values;state.settingsRevision=old.revision;
 let stored={state},etag='one';const expected=colmexSettingsRecord(state);
 const store={getWithMetadata:async key=>{assert.equal(key,stateKey('123'));return {data:structuredClone(stored),etag};},setJSON:async(key,value,options)=>{assert.equal(options.onlyIfMatch,etag);stored=structuredClone(value);etag+='1';return {modified:true,etag};}};
 const lock=await lease(store,'123',()=>1000);assert.equal(lock.state.settingsRevision,expected.revision);assert.equal(lock.state.settings.profitActivationPct,5);assert.equal(stored.state.settingsPolicyVersion,TRADE_SETTINGS_VERSION);await lock.release();
 const again=await lease(store,'123',()=>1001);assert.equal(again.state.settingsRevision,8);await again.release();
});
