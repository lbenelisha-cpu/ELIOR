import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCancelRecovery} from '../scripts/release-futures-cancel-halt.mjs';
const state=()=>({version:'FUTURES_CHANNEL_SHORT_V1',halt:'FUTURES_PROTECTION_CANCEL_PENDING',pending:null,positions:{},used:[],startedAt:1,closed:[{symbol:'BTCUSDT',closedAt:2,algos:[{clientAlgoId:'test-id',kind:'STOP_MARKET'}]}]});
const api=(changes={})=>({get:async(route)=>{
 if(route in changes)return changes[route];
 return {'/fapi/v2/account':{canTrade:true,multiAssetsMargin:false,positions:[{positionAmt:'0'}]},'/fapi/v1/positionSide/dual':{dualSidePosition:false},'/fapi/v1/openOrders':[], '/fapi/v1/openAlgoOrders':[], '/fapi/v1/algoOrder':{symbol:'BTCUSDT',clientAlgoId:'test-id',side:'BUY',positionSide:'BOTH',orderType:'STOP_MARKET',closePosition:true,algoStatus:'CANCELED'}}[route];
}});
test('GET-only verification preserves journal and accepts terminal protection',async()=>{const s=state(),before=JSON.stringify(s);assert.equal((await verifyCancelRecovery(s,api())).symbol,'BTCUSDT');assert.equal(JSON.stringify(s),before);});
test('refuses uncertain or non-flat journals',async()=>{for(const patch of [{pending:{}},{positions:{BTCUSDT:{}}},{halt:'OTHER'},{closed:[]}])await assert.rejects(verifyCancelRecovery({...state(),...patch},api()));});
test('refuses active exchange position or any open order',async()=>{for(const change of [{'/fapi/v2/account':{canTrade:true,multiAssetsMargin:false,positions:[{positionAmt:'-1'}]}},{'/fapi/v1/openOrders':[{}]},{'/fapi/v1/openAlgoOrders':[{}]},{'/fapi/v1/openOrders':{} }])await assert.rejects(verifyCancelRecovery(state(),api(change)));});
test('refuses unresolved or mismatched protection',async()=>{const original=await api().get('/fapi/v1/algoOrder');for(const patch of [{algoStatus:'NEW'},{symbol:'ETHUSDT'},{clientAlgoId:'other'},{side:'SELL'},{closePosition:false}])await assert.rejects(verifyCancelRecovery(state(),api({'/fapi/v1/algoOrder':{...original,...patch}})));});
test('exchange read failures fail closed',async()=>{await assert.rejects(verifyCancelRecovery(state(),{get:async()=>{throw Error('timeout');}}));});
test('only definitive rejected attempts without exchange id may be absent',async()=>{const absent={get:async(route)=>{if(route==='/fapi/v1/algoOrder'){const e=Error('FUTURES_API_-2013');e.code=-2013;throw e;}return api().get(route);}};const s=state();s.closed[0].algos[0].status='REJECTED';assert.equal((await verifyCancelRecovery(s,absent)).verified[0].status,'REJECTED_NOT_FOUND');for(const patch of [{status:'PENDING'},{status:'CANCELED'},{status:'REJECTED',algoId:123}]){const bad=state();Object.assign(bad.closed[0].algos[0],patch);await assert.rejects(verifyCancelRecovery(bad,absent));}});
